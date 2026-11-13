"""Vakit veri kaynakları.

* EzanVaktiSource  (varsayılan) — https://ezanvakti.emushaf.net
    Ücretsiz, hesap/anahtar gerektirmez; Diyanet'in yayınladığı aylık tabloyu yansıtır.
    /ulkeler, /sehirler/{ulke}, /ilceler/{sehir}, /vakitler/{ilce} (~30 gün), /lookup (koordinatlar)
* DiyanetSource — https://awqatsalah.diyanet.gov.tr (resmi; hesap gerekir, günde 5 istek/endpoint)
* MockSource — ağa çıkmadan sahte veri (geliştirme için)

Hepsi aynı arayüzü sunar ve her dış istek gönderilmeden ÖNCE günlük sayaca yazılır;
limit doluysa istek hiç gönderilmez.
"""
import asyncio
import base64
import json
import logging
import math
import time
from datetime import date, datetime, timedelta

import httpx

from . import config
from .store import Store

log = logging.getLogger("sources")
USER_AGENT = "NamazVakitleriPWA/1.1 (+self-hosted)"


class QuotaExceeded(Exception):
    pass


class UpstreamError(Exception):
    pass


class NotSupported(Exception):
    pass


def quota_day() -> str:
    return datetime.now(config.QUOTA_TZ).date().isoformat()


def make_day(date_short: str, times: list, hijri: str | None) -> dict | None:
    """Ortak küçük biçim: {d: YYYY-MM-DD, t: [imsak, güneş, öğle, ikindi, akşam, yatsı], h: hicri}.

    Saatler, ilçenin YEREL saatidir (kaynak README'si de cihaz saat dilimine göre
    kullanılmasını söylüyor), bu yüzden saat dilimi bilgisi tutulmaz.
    """
    try:
        d = datetime.strptime((date_short or "").strip(), "%d.%m.%Y").date()
    except ValueError:
        return None
    t = [(x or "").strip()[:5] for x in times]
    if not all(len(x) == 5 and x[2] == ":" for x in t):
        return None
    return {"d": d.isoformat(), "t": t, "h": (hijri or "").strip()}


class BaseSource:
    name = "base"

    def __init__(self, store: Store):
        self.store = store
        self._http: httpx.AsyncClient | None = None

    async def close(self):
        if self._http:
            await self._http.aclose()

    def _reserve(self, endpoint: str, limit: int | None = None) -> None:
        limit = limit or config.QUOTA_PER_ENDPOINT_PER_DAY
        day = quota_day()
        used = self.store.quota_used(day, endpoint)
        if used >= limit:
            raise QuotaExceeded(f"{endpoint} için günlük istek sınırı doldu ({used}/{limit})")
        self.store.quota_inc(day, endpoint)

    # Alt sınıflar şunları uygular:
    async def countries(self) -> list[dict]: raise NotImplementedError
    async def states(self, country_id: int) -> list[dict]: raise NotImplementedError
    async def cities(self, state_id: int) -> list[dict]: raise NotImplementedError
    async def prayer_times(self, city_id: int) -> list[dict]: raise NotImplementedError

    async def lookup(self) -> list[list]:
        """[[lat, lon, ilceId, ülkeAdı, şehirAdı, ilçeAdı], ...]"""
        raise NotSupported("Bu kaynak konumdan ilçe bulmayı desteklemiyor")


# ======================================================================
class EzanVaktiSource(BaseSource):
    name = "ezanvakti"

    def __init__(self, store: Store):
        super().__init__(store)
        self._http = httpx.AsyncClient(
            base_url=config.EZANVAKTI_BASE_URL,
            timeout=httpx.Timeout(12.0, connect=5.0),
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            follow_redirects=True,
        )

    async def _get(self, path: str, limit: int | None = None):
        self._reserve(path, limit)
        try:
            r = await self._http.get(path)
        except httpx.HTTPError as e:
            raise UpstreamError(f"{path}: bağlantı hatası ({e.__class__.__name__})")
        if r.status_code == 429:
            raise QuotaExceeded(f"{path}: kaynak 429 döndürdü")
        if r.status_code != 200:
            raise UpstreamError(f"{path}: HTTP {r.status_code}")
        try:
            return r.json()
        except ValueError:
            raise UpstreamError(f"{path}: geçersiz JSON")

    @staticmethod
    def _places(data, prefix: str) -> list[dict]:
        out = []
        for p in data or []:
            try:
                out.append({"id": int(p[f"{prefix}ID"]), "name": p.get(f"{prefix}Adi") or p.get(f"{prefix}AdiEn") or ""})
            except (KeyError, ValueError, TypeError):
                continue
        if not out:
            raise UpstreamError(f"{prefix} listesi boş geldi")
        return out

    async def countries(self):
        return self._places(await self._get("/ulkeler"), "Ulke")

    async def states(self, country_id):
        return self._places(await self._get(f"/sehirler/{country_id}"), "Sehir")

    async def cities(self, state_id):
        return self._places(await self._get(f"/ilceler/{state_id}"), "Ilce")

    async def prayer_times(self, city_id):
        rows = await self._get(f"/vakitler/{city_id}")
        if not isinstance(rows, list):
            raise UpstreamError(f"/vakitler/{city_id}: beklenmeyen yanıt")
        out = []
        for r in rows:
            day = make_day(r.get("MiladiTarihKisa"),
                           [r.get(k) for k in ("Imsak", "Gunes", "Ogle", "Ikindi", "Aksam", "Yatsi")],
                           r.get("HicriTarihKisa"))
            if day:
                out.append(day)
        if not out:
            raise UpstreamError(f"/vakitler/{city_id}: boş veri")
        return out

    async def lookup(self):
        rows = await self._get("/lookup", limit=4)   # büyük dosya: günde en fazla 4 kez (30 gün önbellek)
        out = []
        for r in rows or []:
            try:
                out.append([round(float(r["lat"]), 4), round(float(r["lon"]), 4), int(r["IlceID"]),
                            r.get("UlkeAdi", ""), r.get("SehirAdi", ""), r.get("IlceAdi", "")])
            except (KeyError, ValueError, TypeError):
                continue
        if not out:
            raise UpstreamError("/lookup boş geldi")
        return out


# ======================================================================
def _jwt_exp(token: str) -> float | None:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except Exception:
        return None


class DiyanetSource(BaseSource):
    """Resmi Awqat Salah API'si (hesap gerekir). Token SQLite'ta saklanır, gereksiz Login yapılmaz."""
    name = "diyanet"

    def __init__(self, store: Store):
        super().__init__(store)
        self._token_lock = asyncio.Lock()
        self._http = httpx.AsyncClient(
            base_url=config.AWQAT_BASE_URL, timeout=httpx.Timeout(20.0),
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )

    async def _login(self) -> dict:
        if not config.AWQAT_EMAIL or not config.AWQAT_PASSWORD:
            raise UpstreamError("AWQAT_EMAIL / AWQAT_PASSWORD tanımlı değil (.env)")
        self._reserve("/api/Auth/Login")
        r = await self._http.post("/api/Auth/Login",
                                  json={"email": config.AWQAT_EMAIL, "password": config.AWQAT_PASSWORD})
        return self._save_token(r, "Login")

    async def _refresh(self, tok: dict) -> dict:
        self._reserve("/api/Auth/RefreshToken/*", limit=48)
        r = await self._http.get(f"/api/Auth/RefreshToken/{tok['refresh']}",
                                 headers={"Authorization": f"Bearer {tok['access']}"})
        return self._save_token(r, "RefreshToken")

    def _save_token(self, r: httpx.Response, what: str) -> dict:
        if r.status_code != 200:
            raise UpstreamError(f"{what} başarısız: HTTP {r.status_code}")
        body = r.json()
        data = body.get("data") or {}
        access = data.get("accessToken")
        if not body.get("success", True) or not access:
            raise UpstreamError(f"{what} başarısız: {body.get('message')}")
        exp = _jwt_exp(access) or (time.time() + 30 * 60)
        tok = {"access": access, "refresh": data.get("refreshToken"), "exp": exp, "refresh_exp": exp + 15 * 60}
        self.store.kv_set("token", tok)
        return tok

    async def _token(self, force_new: bool = False) -> str:
        async with self._token_lock:
            tok = self.store.kv_get("token")
            now = time.time()
            if tok and not force_new and tok["exp"] - 60 > now:
                return tok["access"]
            if tok and tok.get("refresh") and tok["refresh_exp"] - 30 > now:
                try:
                    return (await self._refresh(tok))["access"]
                except UpstreamError as e:
                    log.warning("Refresh başarısız, Login denenecek: %s", e)
            return (await self._login())["access"]

    async def _get(self, path: str):
        token = await self._token()
        self._reserve(path)
        r = await self._http.get(path, headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 401:
            self.store.kv_delete("token")
            token = await self._token(force_new=True)
            self._reserve(path)
            r = await self._http.get(path, headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 429:
            raise QuotaExceeded(f"{path}: Diyanet 429 döndürdü")
        if r.status_code != 200:
            raise UpstreamError(f"{path}: HTTP {r.status_code}")
        body = r.json()
        if not body.get("success", True):
            raise UpstreamError(f"{path}: {body.get('message') or 'hata'}")
        return body.get("data")

    @staticmethod
    def _places(data):
        return [{"id": int(p["id"]), "name": p.get("name") or p.get("code") or ""} for p in (data or [])]

    async def countries(self):
        return self._places(await self._get("/api/Place/Countries"))

    async def states(self, country_id):
        return self._places(await self._get(f"/api/Place/States/{country_id}"))

    async def cities(self, state_id):
        return self._places(await self._get(f"/api/Place/Cities/{state_id}"))

    async def prayer_times(self, city_id):
        errors = []
        for kind in ("Monthly", "Weekly"):     # Monthly: 1 istekle ~30 gün
            try:
                rows = await self._get(f"/api/PrayerTime/{kind}/{city_id}") or []
                out = [d for d in (make_day(r.get("gregorianDateShort"),
                                            [r.get(k) for k in ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha")],
                                            r.get("hijriDateShort")) for r in rows) if d]
                if out:
                    return out
                errors.append(f"{kind}: boş veri")
            except (QuotaExceeded, UpstreamError) as e:
                errors.append(str(e))
        raise UpstreamError(" | ".join(errors))


# ======================================================================
MOCK_COUNTRIES = [{"id": 2, "name": "TÜRKİYE"}, {"id": 13, "name": "ALMANYA"}]
MOCK_STATES = {2: [{"id": 539, "name": "İSTANBUL"}, {"id": 506, "name": "ANKARA"}, {"id": 541, "name": "İZMİR"}],
               13: [{"id": 854, "name": "BREMEN"}]}
MOCK_CITIES = {539: [{"id": 9541, "name": "İSTANBUL"}, {"id": 9535, "name": "BEYKOZ"}],
               506: [{"id": 9206, "name": "ANKARA"}], 541: [{"id": 9560, "name": "İZMİR"}],
               854: [{"id": 10930, "name": "BREMEN"}]}
MOCK_LOOKUP = [[41.0082, 28.9784, 9541, "TÜRKİYE", "İSTANBUL", "İSTANBUL"],
               [41.1339, 29.0921, 9535, "TÜRKİYE", "İSTANBUL", "BEYKOZ"],
               [39.9334, 32.8597, 9206, "TÜRKİYE", "ANKARA", "ANKARA"],
               [38.4237, 27.1428, 9560, "TÜRKİYE", "İZMİR", "İZMİR"],
               [53.0793, 8.8017, 10930, "ALMANYA", "BREMEN", "BREMEN"]]


class MockSource(BaseSource):
    name = "mock"

    async def countries(self): return MOCK_COUNTRIES
    async def states(self, country_id): return MOCK_STATES.get(country_id, [])
    async def cities(self, state_id): return MOCK_CITIES.get(state_id, [])
    async def lookup(self): return MOCK_LOOKUP

    async def prayer_times(self, city_id):
        today = datetime.now(config.QUOTA_TZ).date()
        shift = (city_id % 7) - 3
        out = []
        for i in range(30):
            d = today + timedelta(days=i)
            s = math.sin((d.timetuple().tm_yday - 80) / 365 * 2 * math.pi)
            base = [360 - 70 * s, 445 - 80 * s, 785, 960 + 70 * s, 1105 + 90 * s, 1190 + 100 * s]
            t = [f"{int(m + shift) // 60:02d}:{int(m + shift) % 60:02d}" for m in base]
            out.append({"d": d.isoformat(), "t": t, "h": f"{(i + 2) % 30 + 1}.5.1448"})
        return out


def make_source(store: Store) -> BaseSource:
    if config.MOCK:
        return MockSource(store)
    if config.PROVIDER == "diyanet":
        return DiyanetSource(store)
    return EzanVaktiSource(store)
