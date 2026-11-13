/* Servis çalışanı — en az trafik için:
 * - Uygulama kabuğu (HTML/CSS/JS/ikon) önbellekten açılır; açılışlarda ağa gidilmez.
 * - __VER__ sunucu tarafından dosya içeriklerinden hesaplanır. Herhangi bir dosya değişince bu dosya da
 *   değişir; tarayıcı (en fazla günde bir) kontrol edip yeni sürümü arka planda kurar.
 * - Namaz vakitleri burada tutulmaz (telefonun yerel deposunda); /api/* her zaman ağa gider.
 */
const VERSION = '__VER__';
const CACHE = 'nv-shell-' + VERSION;
const SHELL = [
  '/',
  '/static/style.css?v=' + VERSION,
  '/static/app.js?v=' + VERSION,
  '/static/guide.js?v=' + VERSION,
  '/static/kaza.js?v=' + VERSION,
  '/static/hatim.js?v=' + VERSION,
  '/static/kitap.js?v=' + VERSION,
  '/manifest.webmanifest',
  '/static/icons/icon.svg',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // 'reload': tarayıcının HTTP önbelleğindeki eski kopyayı değil, sunucudaki yeni sürümü al
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nv-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;              // veri: her zaman ağ
  if (url.pathname.startsWith('/static/quran/') || url.pathname.startsWith('/static/meal/')) return;   // Kur'an/meal cüzleri: uygulama kendi deposuna (IndexedDB) kaydeder
  // Sürümü yolunda olan değişmez dosyalar (pdf.js, yazı tipi): güncellemelerde silinmeyen ayrı önbellek
  if (url.pathname.startsWith('/static/vendor/') || url.pathname.startsWith('/static/fonts/')) {
    e.respondWith(caches.open('nv-assets').then(async (cache) => {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(url.pathname, res.clone());
      return res;
    }));
    return;
  }

  const key = e.request.mode === 'navigate' ? '/' : e.request;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  }));
});
