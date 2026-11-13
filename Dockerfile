# Namaz Vakitleri — tek konteyner, port AÇMAZ.
# Uygulama /run/namaz/namaz.sock soketinden çalışır; alt alan adını (namaz.sporyazilimlari.com.tr)
# sunucudaki Nginx ya da compose içindeki Caddy bu sokete yönlendirir.
ARG BASE_IMAGE=python:3.12-slim
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DB_PATH=/srv/data/cache.sqlite3 \
    UVICORN_UDS=/run/namaz/namaz.sock

WORKDIR /srv
COPY requirements.txt .
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY app ./app
COPY static ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /srv/data /run/namaz \
 && chown -R 33:33 /srv/data /run/namaz

# www-data (uid 33) — Debian/Ubuntu sunucudaki Nginx kullanıcısıyla aynı uid
USER 33:33
VOLUME ["/srv/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import os,httpx; u=os.environ.get('UVICORN_UDS'); \
c=httpx.Client(transport=httpx.HTTPTransport(uds=u)) if u else httpx.Client(); \
r=c.get('http://localhost:8000/api/status' if not u else 'http://localhost/api/status'); \
raise SystemExit(0 if r.status_code==200 else 1)"

ENTRYPOINT ["docker-entrypoint.sh"]
