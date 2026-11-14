"""Kur'an ayet sesleri — Al Quran Cloud CDN (cdn.islamic.network) üzerinden, sunucuda HİÇBİR ŞEY SAKLAMADAN.

Telefon sesleri aynı alan adından ister (/ses/64/ar.alafasy/<ayet-no>.mp3); sunucu isteği CDN'e iletir ve cevabı
olduğu gibi akıtır. Böylece:
  * tarayıcının çapraz-kaynak (CORS) kısıtı olmaz: telefon dosyayı kendi deposuna indirip internetsiz çalabilir,
  * sunucunun diskinde ses tutulmaz (yalnız geçerken akar), bellek kullanımı küçük bir arabellekle sınırlıdır,
  * tarayıcı dosyayı uzun süre önbellekte tutar (dosyalar değişmez).
Ayet numarası Kur'an genelindeki sıradır (1–6236). Kaynak şartı: kişisel ve eğitim amaçlı dinleme/indirme serbest.
"""
import io
import logging
import math
import os
import struct
import wave

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from . import config

router = APIRouter(tags=["ses"])
BASE = os.getenv("SES_BASE_URL", "https://cdn.islamic.network/quran/audio").rstrip("/")
RECITERS = {"ar.alafasy"}                 # Mişârî Râşid el-Afâsî
BITRATES = {"64", "128"}
_client: httpx.AsyncClient | None = None
logging.getLogger("httpx").setLevel(logging.WARNING)   # binlerce ayet isteği günlüğü doldurmasın


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=8.0), follow_redirects=True,
                                    headers={"User-Agent": "namaz-vakitleri/1.0 (+ayet sesi)"},
                                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))
    return _client


def _mock_wav(n: int) -> bytes:
    """Geliştirme (MOCK=1): kaynağa gitmeden kısa bir ton."""
    rate, dur, f = 8000, 0.6, 330 + (n % 7) * 40
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * f * i / rate))) for i in range(int(rate * dur))))
    return buf.getvalue()


@router.get("/ses/{br}/{edition}/{n}.mp3", include_in_schema=False)
async def ses(br: str, edition: str, n: int, request: Request):
    if br not in BITRATES or edition not in RECITERS or not 1 <= n <= 6236:
        raise HTTPException(404, "Bulunamadı")
    cache = {"Cache-Control": "public, max-age=31536000, immutable"}
    if config.MOCK:
        return Response(_mock_wav(n), media_type="audio/wav", headers=cache)
    headers = {}
    if rng := request.headers.get("range"):
        headers["Range"] = rng                  # oynatıcı ileri sarınca yalnız gereken parça gelir
    client = _http()
    try:
        r = await client.send(client.build_request("GET", f"{BASE}/{br}/{edition}/{n}.mp3", headers=headers), stream=True)
    except httpx.HTTPError as e:
        raise HTTPException(503, "Ses kaynağına ulaşılamıyor") from e
    if r.status_code not in (200, 206):
        await r.aclose()
        raise HTTPException(502 if r.status_code >= 500 else 404, "Ses alınamadı")
    out = {k: r.headers[k] for k in ("content-length", "content-range", "accept-ranges", "etag", "last-modified") if k in r.headers}
    out.update(cache)
    return StreamingResponse(r.aiter_raw(), status_code=r.status_code, media_type="audio/mpeg", headers=out,
                             background=BackgroundTask(r.aclose))
