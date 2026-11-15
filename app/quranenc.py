"""QuranEnc.com (Kur'an-ı Kerim Ansiklopedisi) — meal ve tefsir önbelleği.

QuranEnc / IslamHouse yeniden yayım şartları: metin değiştirilmez, kaynak (QuranEnc.com), tercüman/yayımcı ve
SÜRÜM numarası gösterilir, yeni sürüm çıkınca kopya güncellenir. Bu modül:
  * /api/qe/list            — tüm dillerdeki meal/tefsir listesi (günde en fazla bir kez kaynaktan alınır)
  * /api/qe/{key}/{cüz}     — bir mealin bir cüzü (başka dilde meal indirmek için)
  * /api/tefsir/{cüz}       — Türkçe Muhtasar tefsir
Sunucu her sureyi kaynaktan YALNIZCA BİR KEZ çeker ve saklar; sürüm değişirse yeniden çeker.
Kaynağa giden istek kullanıcı sayısından bağımsızdır (meal başına en fazla 114 istek).
"""
import asyncio
import json
import os
import re
import time

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from . import config

router = APIRouter(tags=["quranenc"])
BASE = os.getenv("QURANENC_BASE_URL", "https://quranenc.com/api/v1").rstrip("/")
TEFSIR = {
    "mokhtasar": ("turkish_mokhtasar", "Kur'an-ı Kerim Muhtasar Tefsiri (el-Muhtasar fi't-Tefsîr) Türkçe tercümesi — "
                                       "Tefsir Araştırmaları Merkezi, QuranEnc.com. Metin değiştirilmeden yayımlanmıştır."),
}
KEY_RE = re.compile(r"^[a-z0-9_]{3,60}$")
LIST_TTL = 86400
_store = None
_locks: dict[str, asyncio.Lock] = {}
_upstream = asyncio.Semaphore(4)          # kaynağa aynı anda en fazla 4 istek
_meta = None
_list_fail = 0.0                          # liste alınamadıysa kaynağı 10 dakika yormamak için


def init(store) -> None:
    global _store
    _store = store
    # eski sürümün tefsir önbelleği (tefsir:turkish_mokhtasar:<sure>) artık qe:<anahtar>:<sure> altında
    if not store.kv_get("qe:migrated"):
        for s in range(1, 115):
            store.kv_delete(f"tefsir:turkish_mokhtasar:{s}")
        store.kv_delete("tefsir:turkish_mokhtasar:ver")
        store.kv_set("qe:migrated", 1)


def _juz_map():
    global _meta
    if _meta is None:
        _meta = json.loads((config.STATIC_DIR / "quran" / "meta.json").read_text(encoding="utf-8"))
    return _meta


def _verses_of_juz(n: int) -> dict[int, tuple[int, int]]:
    m = _juz_map()
    js, counts = m["js"], [s[2] for s in m["s"]]
    start = tuple(js[n - 1])
    end = tuple(js[n]) if n < 30 else (115, 0)
    out = {}
    for s in range(start[0], min(114, end[0]) + 1):
        a0 = start[1] if s == start[0] else 1
        a1 = (end[1] - 1) if s == end[0] else counts[s - 1]
        if a1 >= a0:
            out[s] = (a0, a1)
    return out


async def _get(url: str):
    async with _upstream:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=6.0), follow_redirects=True,
                                     headers={"User-Agent": "namaz-vakitleri/1.0 (+quranenc cache)"}) as c:
            r = await c.get(url)
            r.raise_for_status()
            return r.json()


def _slim(x: dict) -> dict | None:
    k = str(x.get("key") or "")
    if not KEY_RE.match(k):
        return None
    return {"k": k, "l": str(x.get("language_iso_code") or k.split("_")[0])[:12],
            "v": str(x.get("version") or ""), "t": str(x.get("title") or k)[:200],
            "d": str(x.get("description") or "")[:400], "dir": "rtl" if x.get("direction") == "rtl" else "ltr"}


async def _list() -> list[dict]:
    """Tüm çeviriler (kısa alanlar). Günde bir kez yenilenir; kaynak yoksa eldeki liste kullanılır."""
    c = _store.kv_get("qe:list")
    if c and time.time() - c.get("t", 0) < LIST_TTL:
        return c["items"]
    lock = _locks.setdefault("list", asyncio.Lock())
    async with lock:
        c = _store.kv_get("qe:list")
        if c and time.time() - c.get("t", 0) < LIST_TTL:
            return c["items"]
        global _list_fail
        if not c and time.time() - _list_fail < 600:
            return []
        items = []
        for path in ("/translations/list?localization=tr", "/translations/list/?localization=tr", "/translations/list"):
            try:
                data = await _get(BASE + path)
                raw = data.get("translations", data) if isinstance(data, dict) else data
                items = [s for s in (_slim(x) for x in raw if isinstance(x, dict)) if s]
                if items:
                    break
            except (httpx.HTTPError, ValueError, AttributeError, TypeError):
                continue
        if not items:
            if c:
                c["t"] = time.time() - LIST_TTL + 3600          # bir saat sonra tekrar dene
                _store.kv_set("qe:list", c)
                return c["items"]
            _list_fail = time.time()
            return []
        _store.kv_set("qe:list", {"t": time.time(), "items": items})
        return items


async def _find(key: str) -> dict | None:
    return next((x for x in await _list() if x["k"] == key), None)


async def _sura(key: str, s: int, ver: str) -> dict[int, list[str]]:
    """{ayet: [metin, dipnot]} — kalıcı önbellekten; yoksa ya da sürüm değiştiyse kaynaktan bir kez."""
    ck = f"qe:{key}:{s}"

    def fresh():
        c = _store.kv_get(ck)
        if c and not c["d"] and time.time() - c.get("t", 0) > 86400:
            return None                             # kaynakta boş çıkan sure: günde bir yeniden dene
        if c and (not ver or c.get("v") == ver):
            return {int(k): v for k, v in c["d"].items()}
        return None

    if (hit := fresh()) is not None:
        return hit
    async with _locks.setdefault(ck, asyncio.Lock()):
        if (hit := fresh()) is not None:
            return hit
        try:
            data = await _get(f"{BASE}/translation/sura/{key}/{s}")
        except (httpx.HTTPError, ValueError) as e:
            old = _store.kv_get(ck)                     # kaynak yoksa eski sürüm de iş görür
            if old:
                return {int(k): v for k, v in old["d"].items()}
            raise HTTPException(503, "Kaynağa (QuranEnc.com) şu an ulaşılamıyor, biraz sonra tekrar deneyin") from e
        out = {}
        for r in (data.get("result", []) if isinstance(data, dict) else []):
            try:
                out[int(r["aya"])] = [str(r.get("translation") or "").strip(), str(r.get("footnotes") or "").strip()]
            except (KeyError, ValueError, TypeError):
                continue
        # Boş sure (ör. tercümesi henüz tamamlanmamış tefsir) hata sayılmaz: ayetler "metin yok" diye görünür
        _store.kv_set(ck, {"v": ver, "t": time.time(), "d": {str(k): v for k, v in out.items()}})
        return out


async def _juz_rows(key: str, juz: int, ver: str) -> list[list]:
    rows = []
    for s, (a0, a1) in _verses_of_juz(juz).items():
        sura = await _sura(key, s, ver)
        rows += [[s, a, *sura.get(a, ["", ""])] for a in range(a0, a1 + 1)]
    return rows


@router.get("/api/qe/list")
async def qe_list():
    items = await _list()
    if not items:
        raise HTTPException(503, "Meal listesi şu an alınamıyor, biraz sonra tekrar deneyin")
    return JSONResponse({"items": items, "src": "QuranEnc.com — Kur'an-ı Kerim Ansiklopedisi"},
                        headers={"Cache-Control": "public, max-age=21600"})


@router.get("/api/qe/{key}/{juz}")
async def qe_juz(key: str, juz: int):
    if not 1 <= juz <= 30 or not KEY_RE.match(key):
        raise HTTPException(404, "Bulunamadı")
    info = await _find(key)
    if not info:
        raise HTTPException(404, "Bu meal QuranEnc.com listesinde yok")
    rows = await _juz_rows(key, juz, info["v"])
    body = {"k": key, "j": juz, "ver": info["v"], "title": info["t"], "dir": info["dir"],
            "src": f"{info['t']} — QuranEnc.com, sürüm {info['v']}. Metin değiştirilmeden yayımlanmıştır.", "t": rows}
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=604800"})


@router.get("/api/tefsir/{juz}")
async def tefsir(juz: int, k: str = Query("mokhtasar")):
    if not 1 <= juz <= 30 or not (k in TEFSIR or re.fullmatch(r"[a-z]{2,20}_mokhtasar", k)):
        raise HTTPException(404, "Bulunamadı")
    if k in TEFSIR:
        key, src = TEFSIR[k]
        info = await _find(key)                  # listede olmasa da (liste alınamadıysa) doğrudan kaynaktan denenir
    else:                                        # Muhtasar Tefsir'in başka dildeki tercümesi (english_mokhtasar …)
        key, info = k, await _find(k)
        if not info:
            raise HTTPException(404, "Bulunamadı")
        src = f"{info['t']} — QuranEnc.com, sürüm {info['v']}. Metin değiştirilmeden yayımlanmıştır."
    ver = info["v"] if info else ""
    rows = await _juz_rows(key, juz, ver)
    return JSONResponse({"j": juz, "k": k, "ver": ver, "src": src, "t": rows},
                        headers={"Cache-Control": "public, max-age=604800"})
