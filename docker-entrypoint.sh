#!/bin/sh
# UVICORN_UDS doluysa (varsayılan) soket dosyasından çalışır, port açmaz.
# Boş bırakılırsa yalnızca Docker ağı içinde 8000'i dinler (Traefik / Nginx Proxy Manager için);
# bu port compose'ta dışarıya yayınlanmaz.
set -e
# --no-access-log: istek kaydı (IP, adres) tutulmaz — uygulama veri toplamaz.
COMMON="--workers 1 --proxy-headers --forwarded-allow-ips=* --no-server-header --no-access-log"

if [ -n "$UVICORN_UDS" ]; then
  dir=$(dirname "$UVICORN_UDS")
  if ! [ -w "$dir" ]; then
    echo "HATA: $dir yazılabilir değil. Sunucuda şunu çalıştırın:  sudo install -d -o 33 -g 33 ./run" >&2
    exit 1
  fi
  rm -f "$UVICORN_UDS"
  exec uvicorn app.main:app --uds "$UVICORN_UDS" $COMMON
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 $COMMON
