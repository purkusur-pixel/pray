"""FastAPI sunucusu: namaz vakitlerini önbellekleyip PWA'ya servis eder.

Çalıştırma:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import hashlib
import re
import logging
import math
import mimetypes
import time
import unicodedata
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config, hatim, quranenc
from .sources import NotSupported, QuotaExceeded, UpstreamError, make_source, quota_day
from .store import Store

# Python 3.12'de bazıları tanımlı değil: pdf.js modülleri ve Kur'an yazı tipi doğru türle gitsin
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("font/woff2", ".woff2")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

store = Store()
hatim.init(store)
quranenc.init(store)
client = make_source(store)
_city_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
_place_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_last_cleanup = 0.0


def _today() -> date:
    return datetime.now(config.QUOTA_TZ).date()


def _cleanup() -> None:
    """Saatte en fazla bir kez: geçmiş günleri ve eski kota kayıtlarını sil."""
    global _last_cleanup
    if time.time() - _last_cleanup < 3600:
        return
    _last_cleanup = time.time()
    removed = store.prayer_cleanup(_today() - timedelta(days=1))
    store.quota_cleanup((_today() - timedelta(days=7)).isoformat())
    store.link_cleanup()
    gone = hatim.cleanup()
    if gone:
        log.info("%d kullanılmayan hatim silindi", gone)
    if removed:
        log.info("Önbellekten %d geçmiş gün silindi", removed)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _cleanup()
    log.info("Veri kaynağı: %s", client.name)
    task = asyncio.create_task(_warmup())
    yield
    task.cancel()
    await client.close()


app = FastAPI(title="Namaz Vakitleri", lifespan=lifespan, docs_url=None, redoc_url=None)


if config.ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.ALLOWED_HOSTS)

# ------------------------------------------------------------ basit IP sınırı
_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        # Gerçek ziyaretçi IP'si: Nginx'in koyduğu X-Real-IP (dışarıdan gelen değeri Nginx ezer),
        # yoksa uvicorn --proxy-headers ile çözülen istemci adresi.
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
        now = time.time()
        if len(_hits) > 50000:                       # çok sayıda IP birikirse eskileri temizle
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                del _hits[k]
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= config.CLIENT_RATE_PER_MIN:
            return JSONResponse({"detail": "Çok fazla istek, biraz bekleyin."}, status_code=429)
        q.append(now)
    response = await call_next(request)
    # /static dosyaları sürüm parametreli (?v=N): tarayıcı 30 gün önbellekte tutabilir
    path = request.url.path
    if response.status_code == 200:
        if path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=2592000"
        elif path.startswith(("/api/countries", "/api/states/", "/api/cities/")):
            # Ülke/il/ilçe listeleri nadiren değişir: tarayıcı 1 gün tekrar sormasın
            response.headers["Cache-Control"] = "public, max-age=86400"
        elif path.startswith(("/api/nearest", "/api/qibla", "/api/siri")):
            response.headers["Cache-Control"] = "no-store"
    return response


# ------------------------------------------------------------- yer listeleri
_mem: dict[str, tuple[float, object]] = {}


async def _cached_places(key: str, fetch, ttl_days: int = config.PLACES_TTL_DAYS, sort: bool = True):
    ttl = ttl_days * 86400
    hit = _mem.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    data = store.places_get(key, ttl)
    if data is not None:
        _mem[key] = (time.time() + 3600, data)
        return data
    async with _place_locks[key]:
        data = store.places_get(key, ttl)       # kilit beklerken başkası çekmiş olabilir
        if data is not None:
            _mem[key] = (time.time() + 3600, data)
            return data
        try:
            data = await fetch()
        except (QuotaExceeded, UpstreamError) as e:
            stale = store.places_get_stale(key)
            if stale is not None:
                log.warning("%s: %s — eski önbellek kullanılıyor", key, e)
                return stale
            raise HTTPException(503, f"Liste şu an alınamıyor: {e}")
        if sort:
            data.sort(key=lambda p: p["name"])
        store.places_set(key, data)
        _mem[key] = (time.time() + 3600, data)
        return data


@app.get("/api/countries")
async def countries():
    return await _cached_places("countries", client.countries)


@app.get("/api/states/{country_id}")
async def states(country_id: int):
    return await _cached_places(f"states:{country_id}", lambda: client.states(country_id))


@app.get("/api/cities/{state_id}")
async def cities(state_id: int):
    return await _cached_places(f"cities:{state_id}", lambda: client.cities(state_id))


# ---------------------------------------------------------- namaz vakitleri
REQUIRED_AHEAD = 20   # sunucu bugünden en az 20 gün ilerisini elinde tutar; kaynak ≈30 gün verir


async def _ensure_days(city_id: int, start: date, end: date) -> None:
    """Önbellekte eksik gün varsa kaynaktan çek (ilçe başına günde en fazla 1 başarılı çekim).

    Kaynak tek seferde ≈30 gün verir. İstemci 31 gün isteyebilir; sondaki eksik 1-2 gün için her gün
    kaynağa gitmemek adına yalnızca bugünden 20 gün ilerisine kadar olan kısım ZORUNLU sayılır.
    Böylece her ilçe kullanıcı sayısından bağımsız olarak ≈10 günde bir çekilir.
    """
    need_end = min(end, _today() + timedelta(days=REQUIRED_AHEAD))
    if need_end < start:
        need_end = start
    want = (need_end - start).days + 1
    if len(store.prayer_get_range(city_id, start, need_end)) >= want:
        return
    async with _city_locks[city_id]:
        if len(store.prayer_get_range(city_id, start, need_end)) >= want:
            return
        today = quota_day()
        if store.fetch_day_get(city_id) == today:
            # Bugün zaten çekildi; kaynak aynı gün yeni tarih vermez, tekrar isteme.
            return
        try:
            days = await client.prayer_times(city_id)
        except (QuotaExceeded, UpstreamError) as e:
            log.warning("İlçe %s vakit hatası: %s", city_id, e)
            if not store.prayer_get_range(city_id, start, end):
                raise HTTPException(503, f"Vakitler şu an alınamıyor: {e}")
            return
        store.prayer_put_many(city_id, days)
        store.fetch_day_set(city_id, today)
        log.info("İlçe %s: %d gün alındı", city_id, len(days))


@app.get("/api/times")
async def times(
    state: int = Query(..., description="İl/eyalet id"),
    city: int = Query(..., description="İlçe/şehir id"),
    start: date | None = Query(None, description="İlk gün (YYYY-MM-DD)"),
    days: int = Query(config.MAX_DAYS, ge=1, le=config.MAX_DAYS),
):
    _cleanup()
    today = _today()
    # Saat dilimi farkı için bir gün geriye izin ver, çok ileri tarih isteme
    start = max(start or today, today - timedelta(days=1))
    if start > today + timedelta(days=45):
        raise HTTPException(400, "Başlangıç tarihi çok ileri")

    # İlçe gerçekten bu ile mi ait? (rastgele id ile kota tüketilmesini engeller)
    city_list = await cities(state)
    match = next((c for c in city_list if c["id"] == city), None)
    if not match:
        raise HTTPException(404, "İlçe bulunamadı")

    end = start + timedelta(days=days - 1)
    await _ensure_days(city, start, end)
    rows = store.prayer_get_range(city, start, end)
    return {"city": match, "days": rows}


# ------------------------------------------------------------------ Siri
VAKIT = ["İmsak", "Güneş", "Öğle", "İkindi", "Akşam", "Yatsı"]
VAKIT_KUCUK = ["imsak", "güneş", "öğle", "ikindi", "akşam", "yatsı"]


def _sure(minutes: int) -> str:
    if minutes < 1:
        return "1 dakikadan az"
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h} saat {m} dakika"
    return f"{h} saat" if h else f"{m} dakika"


def _dur_en(minutes: int) -> str:
    if minutes < 1:
        return "less than a minute"
    h, m = divmod(minutes, 60)
    hs = f"{h} hour{'s' if h != 1 else ''}" if h else ""
    ms = f"{m} minute{'s' if m != 1 else ''}" if m else ""
    return " ".join(x for x in (hs, ms) if x)


VAKIT_EN = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"]


def siri_text(place: str, days: list[dict], now: datetime, lang: str = "tr") -> str:
    """Siri'nin sesli okuyacağı tek cümlelik özet (tr / en)."""
    today = now.date().isoformat()
    rows = [d for d in days if d["d"] >= today]
    for d in rows:
        day = date.fromisoformat(d["d"])
        for i, t in enumerate(d["t"]):
            hh, mm = map(int, t.split(":"))
            at = datetime(day.year, day.month, day.day, hh, mm, tzinfo=now.tzinfo)
            if at > now:
                left = int((at - now).total_seconds() // 60)
                tomorrow = d["d"] != today
                if lang == "en":
                    if i == 1:
                        return f"{place}. {_dur_en(left)} until {'tomorrow' + chr(39) + 's ' if tomorrow else ''}sunrise. Sunrise is at {t}."
                    ad = f"tomorrow{chr(39)}s {VAKIT_EN[i]}" if tomorrow else VAKIT_EN[i]
                    return f"{place}. {_dur_en(left)} until {ad}. {VAKIT_EN[i]} is at {t}."
                ad = f"Yarın {VAKIT_KUCUK[i]}" if tomorrow else VAKIT[i]
                if i == 1:
                    return f"{place}. {'Yarın güneşin' if tomorrow else 'Güneşin'} doğmasına {_sure(left)} kaldı. Güneş saat {t}."
                return f"{place}. {ad} vaktine {_sure(left)} kaldı. {VAKIT[i]} saat {t}."
    if lang == "en":
        return f"{place}. Tomorrow's times are not available yet; open the app once."
    return f"{place}. Yarının vakitleri henüz yok, uygulamayı bir kez açın."


_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{16,40}$")


@app.post("/api/link")
async def link(request: Request):
    """Uygulama, seçili ilçeyi telefona özel rastgele anahtarla bildirir (yalnızca ilçe değişince).

    Siri kestirmesi bu anahtarla sorar: konum gerekmez, uygulamada seçili ilçe kullanılır.
    """
    try:
        body = await request.json()
        key, state, city = str(body["k"]), int(body["s"]), int(body["i"])
        tz = str(body.get("tz") or "Europe/Istanbul")[:64]
    except Exception:
        raise HTTPException(400, "Geçersiz istek")
    if not _KEY_RE.match(key):
        raise HTTPException(400, "Geçersiz anahtar")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        tz = "Europe/Istanbul"
    if not any(c["id"] == city for c in await cities(state)):     # gerçekten o ile ait ilçe mi
        raise HTTPException(404, "İlçe bulunamadı")
    store.link_set(key, state, city, tz)
    return {"ok": True}


@app.get("/api/siri", response_class=PlainTextResponse)
async def siri(k: str | None = Query(None, description="Uygulamanın Siri anahtarı"),
               state: int | None = Query(None), city: int | None = Query(None),
               lat: str | None = Query(None), lon: str | None = Query(None),
               tz: str = Query("Europe/Istanbul", description="Saat dilimi"),
               at: datetime | None = Query(None, include_in_schema=False),
               l: str = Query("tr", description="Cevap dili: tr / en")):
    """iPhone Kestirmeler / Siri için: sonraki vakte kalan süre, düz metin.

    k verilirse uygulamada seçili ilçeye göre (önerilen; konum gerekmez);
    lat/lon verilirse en yakın ilçeye göre; yoksa state/city ile sabit ilçeye göre. Konum saklanmaz.
    """
    en = l.lower().startswith("en")
    if k is not None:
        row = store.link_get(k) if _KEY_RE.match(k) else None
        if not row:
            return ("This shortcut is not linked to the app yet. Open the Prayer Times app once." if en else
                    "Bu kestirme henüz uygulamaya bağlı değil. Namaz uygulamasını bir kez açın.")
        state, city, tz = row
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("Europe/Istanbul")
    now = (at.replace(tzinfo=zone) if at and at.tzinfo is None else at) or datetime.now(zone)
    now = now.astimezone(zone).replace(microsecond=0)   # saniye korunur: uygulamadaki sayaçla aynı dakika
    try:
        if lat is not None or lon is not None:
            # Türkçe iPhone sayıları virgülle verebilir: "39,9208"
            try:
                la = float((lat or "").strip().replace(",", "."))
                lo = float((lon or "").strip().replace(",", "."))
                if not (-90 <= la <= 90 and -180 <= lo <= 180):
                    raise ValueError
            except ValueError:
                return ("Konum okunamadı. Kestirmedeki adreste ENLEM ve BOYLAM yerine "
                        "Mevcut Konum'un Enlem ve Boylam değerlerini koyun.")
            near = await nearest(lat=la, lon=lo)
            state, city = near["s"], near["i"]
        if state is None or city is None:
            return "Konum alınamadı. Kestirmede Mevcut Konumu Al adımını kontrol edin."
        res = await times(state=state, city=city, start=now.date(), days=2)
    except HTTPException as e:
        return "Prayer times are not reachable right now." if en else f"Vakitlere şu an ulaşılamıyor. {e.detail}"
    name = res["city"]["name"]
    place = name[:1] + name[1:].replace("I", "ı").replace("İ", "i").lower() if name.isupper() else name
    return siri_text(place, res["days"], now, "en" if en else "tr")


@app.get("/api/status")
async def status():
    """Bugün dış kaynağa yapılan istekler (gizli bilgi içermez)."""
    return {
        "source": client.name,
        "version": VERSION,
        "quota_day": quota_day(),
        "limit": config.QUOTA_PER_ENDPOINT_PER_DAY,
        "used": [{"endpoint": e, "count": c} for e, c in store.quota_today(quota_day())],
    }



# ------------------------------------------------------- konumdan ilçe bulma
def _norm(s: str) -> str:
    s = (s or "").replace("i", "İ").replace("ı", "I").upper()
    s = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in s if ch.isalnum() and not unicodedata.combining(ch))


async def _lookup_rows() -> list:
    """[[lat, lon, ilceId, ülke, il, ilçe], ...] — tüm ilçelerin koordinatları (30 gün önbellek)."""
    try:
        rows = await _cached_places("lookup", client.lookup, ttl_days=config.LOOKUP_TTL_DAYS, sort=False)
    except NotSupported as e:
        raise HTTPException(501, str(e))
    if not rows:
        raise HTTPException(503, "Konum listesi alınamadı")
    return rows


def _same(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    return bool(a) and bool(b) and (a == b or a in b or b in a)


@app.get("/api/nearest")
async def nearest(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """Koordinata en yakın ilçeyi bul. Koordinat yalnızca bu sunucuda kullanılır, saklanmaz."""
    rows = await _lookup_rows()
    k = math.cos(math.radians(lat))

    def dist(r):
        return (r[0] - lat) ** 2 + ((r[1] - lon) * k) ** 2

    # En yakın birkaç aday: ilki listede eşleşmezse (ör. yeni/eski ilçe kodu) sonrakine geç
    candidates, seen = [], set()
    for r in sorted(rows, key=dist):
        if r[2] not in seen:
            seen.add(r[2]); candidates.append(r)
        if len(candidates) >= 5:
            break
    country_list = await countries()
    for best in candidates:
        found = await _match_place(best, country_list)
        if found:
            found["km"] = round(math.sqrt(dist(best)) * 111.2, 1)
            return found
    raise HTTPException(404, f"{candidates[0][5]} eşleştirilemedi, listeden seçin")


async def _match_place(row, country_list) -> dict | None:
    """Koordinat listesindeki satırı (yalnızca adlar) ülke/il/ilçe id'lerine çevir."""
    ilce_id, ulke, sehir = row[2], row[3], row[4]
    country = next((c for c in country_list if _norm(c["name"]) == _norm(ulke)), None) \
        or next((c for c in country_list if _same(c["name"], ulke)), None)
    if not country:
        return None
    state_list = await states(country["id"])
    # Önce adı eşleşen il; yurt dışında liste il yerine ülke adını verdiği için
    # bulunamazsa o ülkenin illerine sırayla bakılır (listeler 30 gün önbellekte kalır)
    ordered = [s for s in state_list if _same(s["name"], sehir)]
    if country["id"] != 2:      # Türkiye'de il adı her zaman doğru: tüm illeri taramaya gerek yok
        ordered += [s for s in state_list if s not in ordered]
    for st in ordered:
        try:
            city_list = await cities(st["id"])
        except HTTPException:
            continue
        city = next((c for c in city_list if c["id"] == ilce_id), None)
        if city:
            return {"c": country["id"], "s": st["id"], "i": city["id"],
                    "cn": country["name"], "sn": st["name"], "n": city["name"]}
    return None


# ------------------------------------------------------------------ kıble
KAABA = (21.422487, 39.826206)
_geomag = None


def _declination(lat: float, lon: float) -> float | None:
    """Manyetik sapma (WMM2025). Telefon pusulası manyetik kuzeyi gösterir."""
    global _geomag
    try:
        if _geomag is None:
            from pygeomag import GeoMag
            _geomag = GeoMag(coefficients_file="wmm/WMM_2025.COF")
        now = datetime.now()
        year = now.year + (now.timetuple().tm_yday - 1) / 365.25
        return round(_geomag.calculate(glat=lat, glon=lon, alt=0, time=year).d, 2)
    except Exception as e:      # model yoksa kıble yine gerçek kuzeye göre verilir
        log.warning("Manyetik sapma hesaplanamadı: %s", e)
        return None


def qibla_for(lat: float, lon: float) -> dict:
    p1, p2 = math.radians(lat), math.radians(KAABA[0])
    dl = math.radians(KAABA[1] - lon)
    bearing = math.degrees(math.atan2(math.sin(dl) * math.cos(p2),
                                      math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) % 360
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    km = 6371.0088 * 2 * math.asin(math.sqrt(min(1.0, h)))
    dec = _declination(lat, lon)
    return {"lat": round(lat, 4), "lon": round(lon, 4), "bearing": round(bearing, 1),
            "declination": dec, "magnetic": round((bearing - dec) % 360, 1) if dec is not None else None,
            "km": round(km)}


@app.get("/api/qibla")
async def qibla(lat: float | None = Query(None, ge=-90, le=90), lon: float | None = Query(None, ge=-180, le=180),
                city: int | None = Query(None, description="İlçe id (konum izni yoksa)")):
    """Kıble açısı (gerçek kuzeyden), manyetik sapma ve Kâbe'ye uzaklık. Konum saklanmaz."""
    if lat is None or lon is None:
        if city is None:
            raise HTTPException(400, "lat/lon ya da city gerekli")
        row = next((r for r in await _lookup_rows() if r[2] == city), None)
        if not row:
            raise HTTPException(404, "Bu ilçenin koordinatı bulunamadı")
        lat, lon = row[0], row[1]
    return qibla_for(lat, lon)


# ------------------------------------------------------------- arka plan ısınma
async def _warmup():
    """Sunucu açılınca sık kullanılan listeleri yavaşça önbelleğe al: ilk ziyaretçi beklemesin."""
    try:
        await asyncio.sleep(3)
        await countries()
        tr = await states(2)
        await _lookup_rows()
        _declination(41.0, 29.0)
        ttl = config.PLACES_TTL_DAYS * 86400
        n = 0
        for st in tr:
            if store.places_get(f"cities:{st['id']}", ttl) is None:
                try:
                    await cities(st["id"])
                    n += 1
                except HTTPException:
                    pass
                await asyncio.sleep(1.5)          # ücretsiz servisi yormamak için yavaş
        log.info("Isınma tamam (%d il listesi yeni alındı)", n)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.warning("Isınma yarıda kaldı: %s", e)


# ---------------------------------------------------------------- PWA dosyaları
NO_CACHE = {"Cache-Control": "no-cache"}


def _asset_version() -> str:
    """static/ klasöründeki tüm dosyaların içeriğinden kısa sürüm kodu.

    Herhangi bir dosya değişince sürüm de değişir: telefonlar yeni sürümü kendiliğinden tanır,
    kimsenin elle sürüm numarası artırması gerekmez.
    """
    h = hashlib.sha256()
    for f in sorted(config.STATIC_DIR.rglob("*")):
        if f.is_file():
            h.update(f.relative_to(config.STATIC_DIR).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:8]


VERSION = _asset_version()
_INDEX = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8").replace("__VER__", VERSION)
_SW = (config.STATIC_DIR / "sw.js").read_text(encoding="utf-8").replace("__VER__", VERSION)
log.info("Uygulama sürümü: %s", VERSION)


def _versioned(body: str, media: str, request: Request, extra: dict | None = None) -> Response:
    etag = f'"{VERSION}"'
    headers = {**NO_CACHE, "ETag": etag, **(extra or {})}
    if request.headers.get("if-none-match") == etag:          # değişmediyse gövdesiz 304
        return Response(status_code=304, headers=headers)
    return Response(body, media_type=media, headers=headers)


@app.get("/", include_in_schema=False)
async def index(request: Request):
    return _versioned(_INDEX, "text/html; charset=utf-8", request)


@app.get("/sw.js", include_in_schema=False)
async def service_worker(request: Request):
    # Kök kapsamda servis edilmeli ki tüm sayfayı kontrol edebilsin
    return _versioned(_SW, "application/javascript; charset=utf-8", request, {"Service-Worker-Allowed": "/"})


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return FileResponse(config.STATIC_DIR / "manifest.webmanifest",
                        media_type="application/manifest+json", headers=NO_CACHE)


@app.get("/.well-known/assetlinks.json", include_in_schema=False)
async def assetlinks():
    """Android (TWA/PWABuilder) paketi için alan adı doğrulaması: static/.well-known/assetlinks.json konursa sunulur."""
    f = config.STATIC_DIR / ".well-known" / "assetlinks.json"
    if not f.is_file():
        raise HTTPException(404, "Yok")
    return FileResponse(f, media_type="application/json")


@app.get("/h/{hid}", include_in_schema=False)
async def hatim_link(request: Request, hid: str):
    """Paylaşılan hatim linki: uygulamanın kendisi açılır, Hatim sekmesi bu hatmi gösterir."""
    return _versioned(_INDEX, "text/html; charset=utf-8", request)


app.include_router(hatim.router)
app.include_router(quranenc.router)
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
