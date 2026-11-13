"""Hatim dağıtma — sunucuda en az veri.

Her paylaşılan link = SQLite'ta TEK satır (tipik 1–3 KB):
    id     : linkteki 10 karakterlik rastgele kod
    admin  : linki oluşturanın gizli anahtarının özeti (anahtarın kendisi yalnızca onun telefonunda)
    data   : sıkıştırılmış JSON — başlık, açıklama, dua tarihi, ayar, hatimler ve 30 cüz
    v      : sürüm (değişmediyse telefon 304 alır, gövde gönderilmez)
    upd    : son işlem zamanı — 180 gün hiç açılmayan/işlem görmeyen kayıt kendiliğinden silinir

Cüz: 0 = boş, [durum, isim, cihaz] — durum 1 okunuyor / 2 okundu; cihaz, cüzü alan telefonun
rastgele kimliğinin 8 karakterlik özeti (aldığı cüzü yalnızca o telefon ve link sahibi değiştirebilsin).
E-posta, telefon, konum, IP gibi hiçbir kişisel bilgi tutulmaz; isim, kişinin kendi yazdığı addır.
"""
import hashlib
import hmac
import json
import re
import secrets
import string
import time
from datetime import date

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

router = APIRouter(prefix="/api/hatim", tags=["hatim"])
_store = None

ID_RE = re.compile(r"^[A-Za-z0-9]{10}$")
DEV_RE = re.compile(r"^[A-Za-z0-9_-]{16,40}$")
ALPHABET = string.ascii_letters + string.digits
MAX_ROUNDS = 10            # bir linkte en fazla 10 hatim; fazlası olunca en eski tamamlanan silinir
INACTIVE_DAYS = 180
CREATE_PER_IP_DAY = 20
_creates: dict[str, tuple[str, int]] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS hatim (
    id TEXT PRIMARY KEY,
    admin TEXT NOT NULL,
    data TEXT NOT NULL,
    v INTEGER NOT NULL,
    upd INTEGER NOT NULL
);
"""


def init(store) -> None:
    global _store
    _store = store
    with store._lock, store._conn:
        store._conn.executescript(_SCHEMA)


def cleanup() -> int:
    """180 gün dokunulmayan hatimleri sil."""
    with _store._lock, _store._conn:
        cur = _store._conn.execute("DELETE FROM hatim WHERE upd < ?", (int(time.time()) - INACTIVE_DAYS * 86400,))
        return cur.rowcount


# ---------------------------------------------------------------- yardımcılar
def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:32]


def _tag(dev: str) -> str:
    return hashlib.sha256(dev.encode()).hexdigest()[:8]


def _clean(s: str | None, n: int) -> str:
    s = re.sub(r"\s+", " ", (s or "").replace("\x00", "")).strip()
    return s[:n]


def _clean_date(s: str | None) -> str:
    if not s:
        return ""
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        raise HTTPException(422, "Tarih geçersiz")


def _new_round(h: dict) -> None:
    n = h.get("nx", 1)
    h["nx"] = n + 1
    h["r"].append({"n": n, "f": 0, "c": [0] * 30})
    if len(h["r"]) > MAX_ROUNDS:
        old = next((i for i, r in enumerate(h["r"][:-1]) if r["f"]), 0)
        h["r"].pop(old)


def _load(hid: str):
    if not ID_RE.match(hid):
        raise HTTPException(404, "Hatim bulunamadı")
    rows = _store._exec("SELECT admin,data,v FROM hatim WHERE id=?", (hid,))
    if not rows:
        raise HTTPException(404, "Bu hatim linki silinmiş ya da değiştirilmiş")
    admin, data, v = rows[0]
    return admin, json.loads(data), v


def _save(hid: str, h: dict, v: int) -> int:
    v += 1
    _store._exec("UPDATE hatim SET data=?, v=?, upd=? WHERE id=?",
                 (json.dumps(h, ensure_ascii=False, separators=(",", ":")), v, int(time.time()), hid))
    return v


def _is_owner(admin_hash: str, key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(admin_hash, _hash(key))


def _require_owner(admin_hash: str, key: str | None) -> None:
    if not _is_owner(admin_hash, key):
        raise HTTPException(403, "Bu işlemi yalnızca hatmi oluşturan yapabilir")


def _out(h: dict, v: int, extra: dict | None = None) -> JSONResponse:
    body = {"t": h["t"], "d": h["d"], "dt": h["dt"], "a": h["a"], "r": h["r"], "v": v, **(extra or {})}
    return JSONResponse(body, headers={"ETag": f'"{v}"', "Cache-Control": "no-cache"})


def _round(h: dict, n: int) -> dict:
    for r in h["r"]:
        if r["n"] == n:
            return r
    raise HTTPException(404, "Bu hatim bulunamadı (silinmiş olabilir)")


def _maybe_auto(h: dict, r: dict) -> None:
    """Otomatik yeni hatim: son hatimde 30 cüzün hepsi dağıtıldıysa (ya da tamamlandı işaretlendiyse)."""
    if h["a"] and r is h["r"][-1] and (r["f"] or all(c for c in r["c"])):
        _new_round(h)


# ---------------------------------------------------------------- modeller
class CreateIn(BaseModel):
    t: str
    d: str = ""
    dt: str = ""
    a: bool = False
    n: int = 1


class SettingsIn(BaseModel):
    t: str | None = None
    d: str | None = None
    dt: str | None = None
    a: bool | None = None


class CuzIn(BaseModel):
    r: int
    c: int                 # 1..30
    op: str                # take | read | unread | free
    name: str = ""
    dev: str


class DoneIn(BaseModel):
    f: bool


# ---------------------------------------------------------------- uç noktalar
@router.post("")
async def create(body: CreateIn, request: Request):
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    today = date.today().isoformat()
    day, cnt = _creates.get(ip, (today, 0))
    if day != today:
        cnt = 0
    if cnt >= CREATE_PER_IP_DAY:
        raise HTTPException(429, "Bugün çok fazla hatim oluşturuldu, yarın tekrar deneyin")
    if len(_creates) > 20000:
        _creates.clear()
    _creates[ip] = (today, cnt + 1)

    title = _clean(body.t, 80)
    if not title:
        raise HTTPException(422, "Başlık gerekli")
    h = {"t": title, "d": _clean(body.d, 300), "dt": _clean_date(body.dt), "a": 1 if body.a else 0, "r": [], "nx": 1}
    for _ in range(max(1, min(body.n, 5))):
        _new_round(h)
    key = secrets.token_urlsafe(18)
    for _ in range(5):
        hid = "".join(secrets.choice(ALPHABET) for _ in range(10))
        try:
            _store._exec("INSERT INTO hatim(id,admin,data,v,upd) VALUES(?,?,?,?,?)",
                         (hid, _hash(key), json.dumps(h, ensure_ascii=False, separators=(",", ":")), 1, int(time.time())))
            break
        except Exception:
            continue
    else:
        raise HTTPException(500, "Link oluşturulamadı, tekrar deneyin")
    return _out(h, 1, {"id": hid, "key": key})


@router.get("/{hid}/own")
async def own(hid: str, x_hatim_key: str | None = Header(None)):
    """Yönetici linkiyle açılınca: bu anahtar gerçekten bu hatmin sahibi mi?"""
    admin, _, _ = _load(hid)
    return JSONResponse({"own": _is_owner(admin, x_hatim_key)}, headers={"Cache-Control": "no-store"})


@router.get("/{hid}")
async def get(hid: str, request: Request):
    admin, h, v = _load(hid)
    if request.headers.get("if-none-match") == f'"{v}"':
        return Response(status_code=304, headers={"ETag": f'"{v}"', "Cache-Control": "no-cache"})
    return _out(h, v)


@router.post("/{hid}/cuz")
async def cuz(hid: str, body: CuzIn, x_hatim_key: str | None = Header(None)):
    admin, h, v = _load(hid)
    if not DEV_RE.match(body.dev):
        raise HTTPException(422, "Cihaz kimliği geçersiz")
    if not 1 <= body.c <= 30:
        raise HTTPException(422, "Cüz 1–30 arası olmalı")
    owner = _is_owner(admin, x_hatim_key)
    r = _round(h, body.r)
    i = body.c - 1
    cur = r["c"][i]
    tag = _tag(body.dev)
    mine = bool(cur) and cur[2] == tag
    name = _clean(body.name, 30)

    if body.op in ("take", "read") and not cur:
        if not name:
            raise HTTPException(422, "Adınızı yazın")
        r["c"][i] = [1 if body.op == "take" else 2, name, tag]
    elif not cur:
        pass                                             # boş cüzü bırakmak/okunmadı yapmak: değişiklik yok
    elif not (mine or owner):
        raise HTTPException(409, f"Bu cüzü {cur[1]} aldı")
    elif body.op == "free":
        r["c"][i] = 0
    elif body.op in ("take", "read", "unread"):
        state = {"take": cur[0], "read": 2, "unread": 1}[body.op]
        r["c"][i] = [state, name or cur[1], cur[2]]
    else:
        raise HTTPException(422, "Geçersiz işlem")
    _maybe_auto(h, r)
    v = _save(hid, h, v)
    return _out(h, v, {"tag": tag})


@router.patch("/{hid}")
async def settings(hid: str, body: SettingsIn, x_hatim_key: str | None = Header(None)):
    admin, h, v = _load(hid)
    _require_owner(admin, x_hatim_key)
    if body.t is not None:
        t = _clean(body.t, 80)
        if not t:
            raise HTTPException(422, "Başlık gerekli")
        h["t"] = t
    if body.d is not None:
        h["d"] = _clean(body.d, 300)
    if body.dt is not None:
        h["dt"] = _clean_date(body.dt)
    if body.a is not None:
        h["a"] = 1 if body.a else 0
        if h["a"] and h["r"]:
            _maybe_auto(h, h["r"][-1])
    return _out(h, _save(hid, h, v))


@router.post("/{hid}/round")
async def add_round(hid: str, x_hatim_key: str | None = Header(None)):
    admin, h, v = _load(hid)
    _require_owner(admin, x_hatim_key)
    _new_round(h)
    return _out(h, _save(hid, h, v))


@router.post("/{hid}/round/{n}/done")
async def round_done(hid: str, n: int, body: DoneIn, x_hatim_key: str | None = Header(None)):
    admin, h, v = _load(hid)
    _require_owner(admin, x_hatim_key)
    r = _round(h, n)
    r["f"] = 1 if body.f else 0
    if r["f"]:
        _maybe_auto(h, r)
    return _out(h, _save(hid, h, v))


@router.delete("/{hid}/round/{n}")
async def delete_round(hid: str, n: int, x_hatim_key: str | None = Header(None)):
    admin, h, v = _load(hid)
    _require_owner(admin, x_hatim_key)
    r = _round(h, n)
    h["r"].remove(r)
    if not h["r"]:
        _new_round(h)
    return _out(h, _save(hid, h, v))


@router.post("/{hid}/relink")
async def relink(hid: str, x_hatim_key: str | None = Header(None)):
    """Linki değiştir: aynı hatim yeni bir kodla devam eder, eski link çalışmaz."""
    admin, h, v = _load(hid)
    _require_owner(admin, x_hatim_key)
    for _ in range(5):
        new = "".join(secrets.choice(ALPHABET) for _ in range(10))
        try:
            _store._exec("UPDATE hatim SET id=?, upd=? WHERE id=?", (new, int(time.time()), hid))
            return {"id": new}
        except Exception:
            continue
    raise HTTPException(500, "Link değiştirilemedi, tekrar deneyin")


@router.delete("/{hid}")
async def delete(hid: str, x_hatim_key: str | None = Header(None)):
    admin, _, _ = _load(hid)
    _require_owner(admin, x_hatim_key)
    _store._exec("DELETE FROM hatim WHERE id=?", (hid,))
    return {"ok": True}
