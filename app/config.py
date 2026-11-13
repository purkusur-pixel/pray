"""Uygulama ayarları (.env veya ortam değişkenlerinden okunur)."""
import os
from pathlib import Path
from zoneinfo import ZoneInfo


def _load_dotenv(path: Path) -> None:
    """Ek bağımlılık gerektirmeyen basit .env okuyucu."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


BASE_DIR = Path(__file__).resolve().parent.parent
_load_dotenv(BASE_DIR / ".env")

# Veri kaynağı:
#   ezanvakti -> https://ezanvakti.emushaf.net (ücretsiz, hesap/anahtar gerekmez,
#                Diyanet'in yayınladığı vakitlerin aynısı)  [varsayılan]
#   diyanet   -> https://awqatsalah.diyanet.gov.tr (resmi, ücretsiz ama hesap gerekir)
PROVIDER = os.getenv("PROVIDER", "ezanvakti").strip().lower()

EZANVAKTI_BASE_URL = os.getenv("EZANVAKTI_BASE_URL", "https://ezanvakti.emushaf.net").rstrip("/")

# Diyanet Awqat Salah hesabı (yalnızca PROVIDER=diyanet için)
AWQAT_BASE_URL = os.getenv("AWQAT_BASE_URL", "https://awqatsalah.diyanet.gov.tr").rstrip("/")
AWQAT_EMAIL = os.getenv("AWQAT_EMAIL", "")
AWQAT_PASSWORD = os.getenv("AWQAT_PASSWORD", "")

# Dış kaynağa endpoint (parametresiyle) başına günlük en fazla istek.
# Diyanet Standart rol: 5. ezanvakti için resmi limit yok; ücretsiz servisi yormamak için 10.
QUOTA_PER_ENDPOINT_PER_DAY = int(os.getenv(
    "QUOTA_PER_ENDPOINT_PER_DAY", "5" if PROVIDER == "diyanet" else "10"))

# Kotanın hangi saat dilimine göre sıfırlandığını varsayıyoruz
QUOTA_TZ = ZoneInfo(os.getenv("QUOTA_TZ", "Europe/Istanbul"))

# İstemciye bir seferde verilecek en fazla gün (kaynak ≈30 gün verir; istemci 15'ini gösterir)
MAX_DAYS = int(os.getenv("MAX_DAYS", "31"))

# Ülke/il/ilçe listeleri nadiren değişir: sunucu önbellekte bu kadar gün tutar
PLACES_TTL_DAYS = int(os.getenv("PLACES_TTL_DAYS", "30"))

# SQLite dosyası (token, kota sayaçları, önbellek)
DB_PATH = Path(os.getenv("DB_PATH", str(BASE_DIR / "data" / "cache.sqlite3")))

# Gerçek API yerine sahte veri üret (geliştirme / test için)
MOCK = os.getenv("MOCK", os.getenv("AWQAT_MOCK", "0")) == "1"

# Konum bulma için ilçe koordinat listesinin (ezanvakti /lookup) önbellek süresi
LOOKUP_TTL_DAYS = int(os.getenv("LOOKUP_TTL_DAYS", "30"))

# Kendi API'mizi kötüye kullanıma karşı basit IP sınırı (dakikada istek)
# Mobil operatörler yüzlerce aboneyi tek IP'den çıkarır (CGNAT): sınır cömert tutulur
CLIENT_RATE_PER_MIN = int(os.getenv("CLIENT_RATE_PER_MIN", "600"))

# Sitenin yayınlandığı alan adı(ları). Başka Host başlığıyla gelen istekler reddedilir.
# Virgülle ayırın. Boş bırakılırsa kontrol yapılmaz (yerel geliştirme).
ALLOWED_HOSTS = [h.strip() for h in os.getenv(
    "ALLOWED_HOSTS", "namaz.sporyazilimlari.com.tr").split(",") if h.strip()]
if ALLOWED_HOSTS:
    # Konteyner içi sağlık kontrolü ve yerel geliştirme için her zaman izinli
    ALLOWED_HOSTS += [h for h in ("localhost", "127.0.0.1") if h not in ALLOWED_HOSTS]

STATIC_DIR = BASE_DIR / "static"
