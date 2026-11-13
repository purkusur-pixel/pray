#!/usr/bin/env bash
# =====================================================================
#  namaz.sporyazilimlari.com.tr — kurulum / güncelleme
#  Sunucu: Oracle Linux 9 + sunucuda Nginx (conf.d) + Docker, SELinux açık
#
#  Kullanım (zip /home/opc'a atıldıktan sonra):
#     cd ~ && rm -rf ezan-pwa && unzip -oq ezan-pwa.zip && sudo bash ezan-pwa/deploy/kurulum.sh
#
#  Ne yapar:
#   1. Dosyaları /home/opc/namaz-vakitleri klasörüne koyar (.env korunur)
#   2. Konteyneri derler ve 127.0.0.1:8070'te başlatır (dışarıya açık değil)
#   3. SSL sertifikası: varsa mevcut olanı kullanır, yoksa Let's Encrypt'ten alır
#   4. /etc/nginx/conf.d/namaz.conf ekler — nginx -t başarısız olursa geri alır,
#      diğer sitelere (apartman, baseapp, ana site) DOKUNMAZ
#   5. Siteyi test eder
#  Güncelleme için aynı komut.
# =====================================================================
set -euo pipefail

DOMAIN="namaz.sporyazilimlari.com.tr"
OWNER_USER="${SUDO_USER:-opc}"
OWNER_HOME="$(getent passwd "$OWNER_USER" | cut -d: -f6 || true)"; OWNER_HOME="${OWNER_HOME:-/home/opc}"
DEST="${DEST:-$OWNER_HOME/namaz-vakitleri}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
CONF_DIR="${CONF_DIR:-/etc/nginx/conf.d}"
CONF="$CONF_DIR/namaz.conf"
WEBROOT=/var/www/letsencrypt

g()   { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
y()   { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mHATA: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || exec sudo -E bash "$0" "$@"

# ---------------------------------------------------------------- ön kontroller
command -v docker >/dev/null || die "Docker bulunamadı."
docker compose version >/dev/null 2>&1 || die "'docker compose' bulunamadı."
docker info >/dev/null 2>&1 || die "Docker servisi çalışmıyor: sudo systemctl start docker"
command -v nginx >/dev/null || die "Nginx bulunamadı."
[ -d "$CONF_DIR" ] || die "$CONF_DIR yok."
nginx -t >/dev/null 2>&1 || die "Mevcut Nginx ayarı ZATEN hatalı (nginx -t). Önce onu düzeltin; hiçbir şeye dokunmadım."
g "Sunucu: $(. /etc/os-release; echo "$PRETTY_NAME") · $(uname -m) · SELinux: $(getenforce 2>/dev/null || echo yok)"

# ---------------------------------------------------------------- 1) dosyalar
g "Dosyalar $DEST klasörüne kopyalanıyor…"
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  # .env korunur; geri kalan her şey zip'teki sürümle değiştirilir
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} +
  cp -a "$SRC/." "$DEST/"
fi
[ -f "$DEST/.env" ] || cp "$DEST/.env.example" "$DEST/.env"
chown -R "$OWNER_USER": "$DEST" 2>/dev/null || true
cd "$DEST"

# Port: .env'de varsa o, yoksa 8070'ten başlayarak boş olan ilk port
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'" || true; }
port_busy() { ss -Hltn "sport = :$1" | grep -q .; }
PORT="$(env_get NAMAZ_PORT)"
if [ -z "$PORT" ]; then
  PORT=8070
  while port_busy "$PORT"; do PORT=$((PORT + 1)); done
  printf '\n# Uygulamanın sunucu içi portu (dışarıya açık değil)\nNAMAZ_PORT=%s\n' "$PORT" >> .env
fi
g "Uygulama portu (yalnızca sunucu içi): 127.0.0.1:$PORT"

# ---------------------------------------------------------------- 2) konteyner
g "Konteyner derleniyor ve başlatılıyor (ilk seferde birkaç dakika sürebilir)…"
docker compose up -d --build
ok=0
for _ in $(seq 1 60); do
  if curl -fsS --noproxy '*' --max-time 3 -H "Host: localhost" "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ $ok = 1 ] || { docker compose logs --tail 40 namaz; die "Uygulama başlamadı (yukarıdaki loglara bakın)."; }
g "Uygulama çalışıyor."

# ---------------------------------------------------------------- 3) SELinux
if command -v getenforce >/dev/null && [ "$(getenforce)" = Enforcing ]; then
  if ! getsebool httpd_can_network_connect 2>/dev/null | grep -q " on$"; then
    g "SELinux: Nginx'in yerel uygulamaya bağlanmasına izin veriliyor (httpd_can_network_connect)…"
    setsebool -P httpd_can_network_connect 1
  fi
fi

# ---------------------------------------------------------------- 4) Nginx yardımcıları
reload_nginx() { systemctl reload nginx 2>/dev/null || nginx -s reload; }

# Yeni bir Nginx dosyasını güvenle uygula: nginx -t geçmezse eskisine dön
apply_conf() {   # $1 = yeni içerik dosyası
  local backup=""
  if [ -f "$CONF" ]; then backup="$(mktemp)"; cp -a "$CONF" "$backup"; fi
  cp "$1" "$CONF"; chmod 644 "$CONF"
  if command -v restorecon >/dev/null; then restorecon "$CONF" 2>/dev/null || true; fi
  if nginx -t >/dev/null 2>&1; then
    reload_nginx
    if [ -n "$backup" ]; then rm -f "$backup"; fi
    return 0
  fi
  nginx -t 2>&1 | tail -5 >&2 || true
  if [ -n "$backup" ]; then cp -a "$backup" "$CONF"; rm -f "$backup"; else rm -f "$CONF"; fi
  die "Nginx ayarı hatalı çıktı; değişiklik geri alındı. Diğer siteler etkilenmedi."
}

cert_covers() {  # $1 = sertifika -> DOMAIN'i kapsıyor ve en az 1 gün geçerli mi?
  [ -f "$1" ] || return 1
  openssl x509 -in "$1" -noout -checkend 86400 >/dev/null 2>&1 || return 1
  openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null \
    | grep -qE "DNS:($DOMAIN|\*\.sporyazilimlari\.com\.tr)(,|$)"
}

# ---------------------------------------------------------------- 5) sertifika
CERT=""; KEY=""
# a) Daha önce tam bu alan adı için alınmış sertifika
if cert_covers "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
fi
# b) Diğer sitelerde kullanılan *.sporyazilimlari.com.tr (wildcard) sertifikası varsa onu kullan
if [ -z "$CERT" ]; then
  while read -r c k; do
    if cert_covers "$c" && [ -f "$k" ]; then CERT="$c"; KEY="$k"; break; fi
  done < <(for f in "$CONF_DIR"/*.conf; do
             [ "$f" = "$CONF" ] && continue
             awk '$1=="ssl_certificate"{gsub(";","",$2); c=$2} $1=="ssl_certificate_key"{gsub(";","",$2); print c, $2}' "$f"
           done 2>/dev/null | sort -u)
fi
[ -n "$CERT" ] && g "Mevcut sertifika kullanılacak: $CERT"

# c) Yoksa Let's Encrypt (webroot): önce yalnızca 80 dinleyen geçici ayar
if [ -z "$CERT" ]; then
  if ! command -v certbot >/dev/null; then
    g "certbot kuruluyor…"
    dnf -y -q install certbot >/dev/null 2>&1 \
      || { dnf -y -q install oracle-epel-release-el9 >/dev/null 2>&1 || true; dnf -y -q install certbot >/dev/null 2>&1; } \
      || die "certbot kurulamadı."
  fi
  mkdir -p "$WEBROOT/.well-known/acme-challenge"
  if command -v restorecon >/dev/null; then restorecon -R "$WEBROOT" 2>/dev/null || true; fi
  tmp="$(mktemp)"
  cat > "$tmp" <<NG
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 503; }
}
NG
  g "Let's Encrypt sertifikası alınıyor…"
  apply_conf "$tmp"; rm -f "$tmp"
  EMAIL_ARGS=(--register-unsafely-without-email); [ -n "${EMAIL:-}" ] && EMAIL_ARGS=(-m "$EMAIL")
  if ! certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos "${EMAIL_ARGS[@]}"; then
    rm -f "$CONF"; reload_nginx
    die "Sertifika alınamadı (geçici ayar kaldırıldı, diğer siteler etkilenmedi). DNS ve 80 portunu kontrol edip tekrar çalıştırın."
  fi
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh
  systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- 6) asıl Nginx ayarı
g "Nginx ayarı ekleniyor: $CONF"
mkdir -p "$WEBROOT"
tmp="$(mktemp)"
sed -e "s#__PORT__#$PORT#g" -e "s#__CERT__#$CERT#g" -e "s#__KEY__#$KEY#g" "$DEST/deploy/nginx-namaz.conf" > "$tmp"
apply_conf "$tmp"; rm -f "$tmp"

# ---------------------------------------------------------------- 7) test
g "Test ediliyor…"
# Nginx reload birkaç saniyede devreye girer: tekrar dene
code=000; err=""
for _ in $(seq 1 15); do
  sleep 2
  code=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 10 \
         --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/status" 2>/tmp/namaz-curl.err || true)
  [ "$code" = 200 ] && break
done
err="$(cat /tmp/namaz-curl.err 2>/dev/null || true)"; rm -f /tmp/namaz-curl.err
if [ "$code" = 200 ]; then
  g "HAZIR  ->  https://$DOMAIN"
else
  y "HTTPS testi '$code' döndü. ${err}"
  y "Kontrol:  sudo tail -20 /var/log/nginx/error.log"
  y "          cd $DEST && sudo docker compose logs --tail 40"
  exit 1
fi
