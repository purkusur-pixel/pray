/* Kitaplar: Kur'an-ı Kerîm (cüz cüz indirilir), Kütüb-i Sitte (kitap kitap indirilir), PDF kitaplar (ilmihal vb.).
 * Her şey telefonda (IndexedDB) tutulur; sunucuda okuma bilgisi yoktur.
 * Adresler: #kitap · #kitap/kuran · #kitap/kuran/<sayfa> · #kitap/h/<kitap> · #kitap/h/<kitap>/<sayfa> · #kitap/f/<dosya>/<sayfa>
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = () => window.App;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const YEAR = 3650 * 86400;
  const VER = document.querySelector('meta[name=nv-ver]')?.content || '1';
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIG[d]);
  const fmtMB = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toLocaleString((window.LOC || 'tr-TR'), { maximumFractionDigits: 1 }) + ' MB');
  const fmtN = (n) => Number(n).toLocaleString((window.LOC || 'tr-TR'));
  const jget = (k, d) => { try { return JSON.parse(A().sget(k) || 'null') ?? d; } catch { return d; } };
  const jset = (k, v) => A().sset(k, JSON.stringify(v), YEAR);

  /* ------------------------------------------------------------ telefon deposu (IndexedDB) */
  const DB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('nv-kitap', 1);
      r.onupgradeneeded = () => { for (const s of ['quran', 'books', 'files']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { p = null; rej(r.error); };
    }));
    const run = async (store, mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode); const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Depolama hatası'));
      });
    };
    return {
      get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
      put: (s, k, v) => run(s, 'readwrite', (st) => st.put(v, k)),
      del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
      keys: (s) => run(s, 'readonly', (st) => st.getAllKeys()),
    };
  })();
  let persistAsked = false;
  function askPersist() {           // tarayıcı yer açmak için indirilenleri silmesin
    if (persistAsked) return; persistAsked = true;
    try { navigator.storage?.persist?.(); } catch { /* yok */ }
  }

  /* ------------------------------------------------------------ okuma ilerlemesi */
  const prog = () => jget('nv_kprog', {});           // {"q":302, "h:bukhari":12, "f:<id>":5}
  function saveProg(key, page, title, sub) {
    const p = prog(); p[key] = page; jset('nv_kprog', p);
    jset('nv_klast', { key, page, title, sub, at: Date.now() });
  }
  const fontSize = (k, d) => jget('nv_kfont', {})[k] || d;
  function setFont(k, v) { const f = jget('nv_kfont', {}); f[k] = v; jset('nv_kfont', f); }

  /* ------------------------------------------------------------ Kur'an verisi */
  let QM = null;                                       // meta: sureler, cüz başları, sayfa başları
  const qMem = new Map();                              // cüz -> veri (bellekte)
  async function qMeta() {
    if (QM) return QM;
    let m = await DB.get('quran', 'meta').catch(() => null);
    if (!m) {
      const r = await fetch('/static/quran/meta.json'); if (!r.ok) throw new Error('Kur\'an bilgisi alınamadı');
      m = await r.json(); DB.put('quran', 'meta', m).catch(() => {});
    }
    return (QM = m);
  }
  const cmpRef = (a, b) => a[0] - b[0] || a[1] - b[1];
  function juzOf(s, a) { let j = 1; for (let i = 0; i < 30; i++) if (cmpRef(QM.js[i], [s, a]) <= 0) j = i + 1; return j; }
  const fileOfPage = (p) => juzOf(...QM.p[p - 1]);   // sayfanın ilk ayetinin cüzü (dosyada sayfanın tamamı var)
  function pageOf(s, a) { let lo = 1, hi = 604; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cmpRef(QM.p[m - 1], [s, a]) <= 0) lo = m; else hi = m - 1; } return lo; }
  async function qHave() { return new Set((await DB.keys('quran').catch(() => [])).filter((k) => typeof k === 'number')); }
  async function qLoad(n, download = true) {
    if (qMem.has(n)) return qMem.get(n);
    let d = await DB.get('quran', n).catch(() => null);
    if (d && !d.w && navigator.onLine) {                   // durak işaretsiz eski kayıt: işaretli sürümü al (olmazsa eskisi kalır)
      try { const r = await fetch(`/static/quran/${n}.json`); if (r.ok) { const nd = await r.json(); await DB.put('quran', n, nd); d = nd; } } catch { /* sonra */ }
    }
    if (!d && download) {
      if (!navigator.onLine) throw Object.assign(new Error(`${n}. cüz henüz indirilmedi; internete bağlanınca otomatik iner.`), { offline: true });
      const r = await fetch(`/static/quran/${n}.json`);
      if (!r.ok) throw new Error(`${n}. cüz indirilemedi`);
      d = await r.json(); askPersist();
      await DB.put('quran', n, d);
    }
    if (d) qMem.set(n, d);
    return d;
  }

  /* ------------------------------------------------------------ meal ve tefsir (cüz cüz, telefonda) */
  let MI = null;
  async function mealIndex() {
    if (MI) return MI;
    let m = await DB.get('quran', 'mealidx').catch(() => null);
    if (!m || !navigator.onLine) { if (m) return (MI = m); }
    try { const r = await fetch('/static/meal/index.json?v=' + VER); if (r.ok) { m = await r.json(); DB.put('quran', 'mealidx', m).catch(() => {}); } } catch { /* çevrimdışı */ }
    if (!m) throw new Error('Meal bilgisi alınamadı');
    return (MI = m);
  }
  const mealOn = () => !!jget('nv_kmeal', false);
  const tefAllowed = () => (window.UILANG || 'tr') === 'tr';            // tefsir yalnız Türkçe arayüzde
  const tefOn = () => tefAllowed() && !!jget('nv_ktef', false);
  const GONE = new Set(['rwwad', 'shaban', 'shahin']);                // kaldırılan Türkçe mealler
  const mealKey = () => { const k = jget('nv_kmealk', 'elmalili'); return GONE.has(k) ? 'elmalili' : k; };
  (async () => {                                                     // kaldırılan meallerin telefondaki cüzlerini bir kez temizle
    try {
      if (jget('nv_kmealclean', 0) >= 2) return;
      for (const k of await DB.keys('quran')) if (typeof k === 'string' && /^(m:(rwwad|shaban|shahin)|t:saadi):/.test(k)) await DB.del('quran', k);
      jset('nv_kmealclean', 2);
    } catch { /* sonra */ }
  })();
  const TEFS = new Proxy({}, { get: (o, k) => (k === 'elmalili' ? "Elmalılı · Hak Dini Kur'an Dili" : window.T ? window.T('Muhtasar Tefsir') : 'Muhtasar Tefsir') });
  const tefKey = () => { const k = jget('nv_ktefk', 'mokhtasar'); return /^(mokhtasar|elmalili|[a-z]+_mokhtasar)$/.test(k) ? k : 'mokhtasar'; };
  const isElm = () => tefKey() === 'elmalili';
  /* Elmalılı tefsiri (Hak Dini Kur'an Dili): Elmalılı'nın kendi ayırdığı ayet grupları hâlinde; her bölüm ayrı dosya, açıldıkça telefona iner.
     Arapça ibareler kitabın kendi yazı tipiyle, sayfadaki hâliyle (SVG) çizilir. */
  const ELM = '/static/tefsir/elmalili/';
  let EI = null, EMF = false;
  async function elmIdx() {
    if (EI) return EI;
    let m = await DB.get('quran', 'e:idx').catch(() => null);
    if (!m || (navigator.onLine && m.ver !== VER)) {
      try { const r = await fetch(ELM + 'index.json?v=' + VER); if (r.ok) { m = await r.json(); m.ver = VER; DB.put('quran', 'e:idx', m).catch(() => {}); } } catch { /* çevrimdışı */ }
    }
    if (!m) throw new Error('Tefsir bilgisi alınamadı; internete bağlanınca iner.');
    if (!EMF) {
      EMF = true;
      const st = document.createElement('style');
      st.textContent = m.fonts.map((f) => `@font-face{font-family:"em-${f}";src:url(${ELM}f/${f}.woff2) format("woff2")}.em-body text.${f}{font-family:"em-${f}"}`).join('');
      document.head.appendChild(st);
    }
    return (EI = m);
  }
  /** (sure, ayet) -> bölüm sırası */
  const elmFind = (ix, s, a) => (ix.s[s] || []).findIndex((r) => a >= r[0] && a <= r[1]);
  async function elmGroup(s, i) {
    const k = `e:${s}:${i}`;
    if (qMem.has(k)) return qMem.get(k);
    let d = await DB.get('quran', k).catch(() => null);
    if (!d) {
      if (!navigator.onLine) throw Object.assign(new Error('Bu tefsir bölümü henüz indirilmedi; internete bağlanınca iner.'), { offline: true });
      const r = await fetch(`${ELM}${s}/${i}.json?v=${EI?.v || 1}`);
      if (!r.ok) throw new Error('Tefsir indirilemedi');
      d = await r.json();
      askPersist(); await DB.put('quran', k, d);
    }
    qMem.set(k, d);
    return d;
  }
  const elmLabel = (s, r) => `${sLabel(sName(s))} ${r[0] === r[1] ? r[0] + '. âyet' : r[0] + '–' + r[1] + '. âyetler'}`;
  function elmBody(d) {
    return `<div class="em-body" dir="ltr">${d.h}${d.y ? `<p class="em-src">Bu bölüm, eserin elimizdeki baskısında eksik olduğu için Yazma Eserler Kurumu baskısından alınmıştır
      (Hak Dini Kur'an Dili, İnceleme – Tenkitli Metin, haz. A. C. Köksal – M. Kaya, 2021); yazımı bu baskınınkidir.</p>` : ''}</div>`;
  }
  /** Bir bölümün kutusu: başlığına dokununca açılır, içerik o zaman iner */
  const elmBox = (s, i, r, open) => `<details class="em" data-s="${s}" data-i="${i}"${open ? ' open' : ''}><summary><b>${TEFS.elmalili}</b><span>${esc(elmLabel(s, r))}</span></summary><div class="em-in"></div></details>`;
  async function elmFill(det) {
    const box = det.querySelector('.em-in');
    if (!det.open || box.dataset.ok) return;
    box.dataset.ok = '1'; box.innerHTML = '<p class="k-wait">Yükleniyor…</p>';
    try { await elmIdx(); box.innerHTML = elmBody(await elmGroup(+det.dataset.s, +det.dataset.i)); }
    catch (e) { delete box.dataset.ok; box.innerHTML = `<p class="k-wait">${esc(e.message)}</p>`; }
  }
  const tefKind = () => (tefKey() === 'mokhtasar' ? 't' : 't:' + tefKey());   // 't' = Türkçe Muhtasar; 't:english_mokhtasar' …
  const isQe = (key) => key.includes('_');                           // başka dilde meal (QuranEnc anahtarı: english_saheeh …)
  /* Başka dillerde eklenen mealler (telefonda): [{k, t, l, v, dir}] */
  const extraMeals = () => jget('nv_kmealx', []);
  /* Arayüz dili değişince Kur'an okurken o dilde bir meal ve (varsa) o dilde Muhtasar tefsir seçilir; kişi sonra değiştirebilir */
  const LANG_MEAL = { en: ['english_saheeh', 'english_rwwad'], ar: ['arabic_moyassar'], id: ['indonesian_affairs', 'indonesian_sabiq'], ur: ['urdu_junagarhi'],
    hi: ['hindi_omari'], bn: ['bengali_zakaria'], fa: ['persian_ih'], ms: ['malay_basumayyah'] };
  async function langAuto() {
    const L = window.UILANG || 'tr';
    if (jget('nv_lauto', 'tr') === L) return;
    if (L === 'tr') {
      if (jget('nv_lautok', '') && mealKey() === jget('nv_lautok', '')) jset('nv_kmealk', 'elmalili');
      jset('nv_ktefk', 'mokhtasar'); jset('nv_lauto', 'tr'); return;
    }
    if (!navigator.onLine) return;
    let items; try { items = await qeList(); } catch { return; }
    const by = (k) => items.find((x) => x.k === k);
    const m = (LANG_MEAL[L] || []).map(by).find(Boolean) || items.find((x) => x.l === L && !/_(mokhtasar|saadi)$/.test(x.k));
    if (m) {
      if (!extraMeals().some((x) => x.k === m.k)) jset('nv_kmealx', extraMeals().concat([{ k: m.k, t: m.t, l: m.l, v: m.v, dir: m.dir }]));
      jset('nv_kmealk', m.k); jset('nv_lautok', m.k);
    }
    const tk = items.find((x) => x.l === L && /_mokhtasar$/.test(x.k));
    jset('nv_ktefk', tk ? tk.k : 'mokhtasar');
    jset('nv_lauto', L);
  }
  setTimeout(() => { langAuto().catch(() => {}); }, 1500);
  let LN = null;
  function langName(l) {
    if (String(l).startsWith('x-')) return l.slice(2);
    try { LN = LN || new Intl.DisplayNames([window.UILANG || 'tr'], { type: 'language' }); const n = LN.of(l); return n && n !== l ? n[0].toLocaleUpperCase(window.UILANG || 'tr') + n.slice(1) : l.toUpperCase(); }
    catch { return String(l).toUpperCase(); }
  }
  async function mealList() {
    const idx = await mealIndex().catch(() => []);
    return idx.concat(extraMeals().map((x) => ({ key: x.k, name: `${langName(x.l)} · ${x.t}`, dir: x.dir, qe: true,
      credit: isFz(x.k) ? `${x.t} — fawazahmed0/quran-api${x.d ? ' (' + x.d + ')' : ''}. Metin değiştirilmeden yayımlanmıştır.`
        : `${x.t} — QuranEnc.com (Kur'an-ı Kerim Ansiklopedisi), sürüm ${x.v}. Metin değiştirilmeden yayımlanmıştır.` })));
  }
  /** kind: 'm:<meal>', 't' (Muhtasar tefsir) ya da 't:saadi' — cüz başına bir dosya, telefonda saklanır */
  async function juzData(kind, n) {
    const k = `${kind}:${n}`;
    if (qMem.has(k)) return qMem.get(k);
    let d = await DB.get('quran', k).catch(() => null);
    const tef = kind[0] === 't';
    if (d && !tef && d.v !== 2) d = null;          // dipnotsuz eski kayıt: yeniden indir
    if (!d) {
      if (!navigator.onLine) throw Object.assign(new Error(`${tef ? 'Tefsir' : 'Meal'} (${n}. cüz) henüz indirilmedi; internete bağlanınca iner.`), { offline: true });
      const mk = kind.slice(2);
      if (!tef && isFz(mk)) {                                        // fawazahmed0/quran-api: doğrudan CDN'den
        const j = await fzFetch(`/editions/${mk.slice(3)}/juzs/${n}.min.json`);
        const x = extraMeals().find((m) => m.k === mk);
        d = { v: 2, ver: '', src: x ? `${x.t} — fawazahmed0/quran-api${x.d ? ' (' + x.d + ')' : ''}` : '', m: Object.fromEntries((j.juzs || []).map((r) => [r.chapter + ':' + r.verse, r.text])) };
        askPersist(); await DB.put('quran', k, d); qMem.set(k, d); return d;
      }
      const url = kind === 't' ? `/api/tefsir/${n}` : tef ? `/api/tefsir/${n}?k=${encodeURIComponent(mk)}`
        : isQe(mk) ? `/api/qe/${encodeURIComponent(mk)}/${n}` : `/static/meal/${mk}/${n}.json`;
      const r = await fetch(url);
      if (!r.ok) { let msg = 'İndirilemedi'; try { msg = (await r.json()).detail || msg; } catch { /* yok */ } throw new Error(msg); }
      const j = await r.json();
      const rows = Array.isArray(j) ? j : j.t;
      d = tef
        ? { ver: j.ver, src: j.src, m: Object.fromEntries(rows.map((x) => [x[0] + ':' + x[1], [x[2], x[3]]])) }
        : { v: 2, ver: j.ver, src: j.src, m: Object.fromEntries(rows.map((x) => [x[0] + ':' + x[1], x[3] ? [x[2], x[3]] : x[2]])) };   // [meal, dipnot]
      askPersist();
      await DB.put('quran', k, d);
    }
    qMem.set(k, d);
    return d;
  }

  /* ------------------------------------------------------------ hadis kitapları */
  let HB = null;
  async function hBooks() {
    if (HB) return HB;
    const r = await fetch('/static/books/hadis.json?v=' + VER); HB = await r.json(); return HB;
  }
  const hMem = new Map();
  /* Hadis dili: arayüz diline göre (fawazahmed0/hadith-api'de o dilde baskı yoksa hadis kitapları gizlenir) */
  const HLANG = { tr: 'tur', en: 'eng', id: 'ind', ur: 'urd', bn: 'ben', ar: 'ara' };
  const hCode = () => HLANG[window.UILANG || 'tr'] || null;
  const hKey = (id) => (hCode() === 'tur' ? id : `${id}:${hCode()}`);          // ana metnin telefondaki anahtarı
  const hArMain = () => hCode() === 'ara';                                      // Arapça arayüzde ana metin Arapça
  const hName = (b) => b.nm?.[window.UILANG]?.[0] || b.name;
  const hAuthor = (b) => b.nm?.[window.UILANG]?.[1] || b.author;
  const hSize = (b) => (hCode() === 'tur' ? b.trSize : b.sz?.[hCode()] || 0);
  const hUrls = (b) => (hCode() === 'tur' ? b.tr : [`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${hCode()}-${b.id}.min.json`,
    `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/${hCode()}-${b.id}.min.json`]);
  const hSec = (b, book, sec) => (hCode() === 'tur' ? b.sec[sec] : book?.sec?.[sec]) || '';
  const H_ALLKEYS = (id) => [id, id + ':ar', ...Object.values(HLANG).filter((c) => c !== 'tur').map((c) => `${id}:${c}`)];
  async function fetchProgress(urls, onProg) {
    let last;
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (!r.body || !r.body.getReader) return await r.text();
        const rd = r.body.getReader(); const parts = []; let got = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProg(got); }
        const all = new Uint8Array(got); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        return new TextDecoder().decode(all);
      } catch (e) { last = e; }
    }
    throw last || new Error('İndirilemedi');
  }
  const downloading = new Map();           // id -> {got, part}
  async function hDownload(id, arabic) {
    const b = (await hBooks()).books.find((x) => x.id === id); if (!b) return;
    if (!navigator.onLine) { A().toast('İnternet bağlantısı yok'); return; }
    askPersist();
    const key = arabic ? id + ':ar' : hKey(id);
    downloading.set(key, { got: 0 }); renderSoon();
    try {
      const txt = await fetchProgress(arabic ? b.arUrl : hUrls(b), (got) => { downloading.set(key, { got }); renderSoon(); });
      downloading.set(key, { got: -1 }); renderSoon();           // işleniyor
      await new Promise((r) => setTimeout(r, 30));
      const j = JSON.parse(txt);
      if (arabic) {
        const m = {}; for (const h of j.hadiths) if (h.text) m[h.hadithnumber] = h.text;
        await DB.put('books', key, { m });
      } else {
        const list = j.hadiths.map((h) => [h.hadithnumber, h.text || '', h.reference?.book ?? 0]);
        await DB.put('books', key, { list, sec: j.metadata?.sections || null, at: Date.now() });
      }
      hMem.delete(hKey(id));
      A().toast(`${hName(b)}${arabic ? ' (Arapça)' : ''} indirildi`);
    } catch (e) {
      A().toast('İndirilemedi: ' + (e.message || 'bağlantı hatası'));
    } finally { downloading.delete(key); render(); }
  }
  /** Kitabı sayfalara böl (yazı boyutundan bağımsız, sabit sayfa numaraları için ≈1500 harf/sayfa). */
  async function hLoad(id) {
    const mk = hKey(id);
    if (hMem.has(mk)) return hMem.get(mk);
    const d = await DB.get('books', mk); if (!d) return null;
    const ar = hArMain() ? null : await DB.get('books', id + ':ar').catch(() => null);
    const pages = []; let cur = [], len = 0;
    const secStart = {};
    for (let i = 0; i < d.list.length; i++) {
      const h = d.list[i];
      const l = (h[1] || (ar?.m?.[h[0]] || '')).length + 80;
      const newSec = i > 0 && h[2] !== d.list[i - 1][2];
      if (cur.length && (len + l > 1500 || newSec)) { pages.push(cur); cur = []; len = 0; }
      if (!(h[2] in secStart)) secStart[h[2]] = pages.length + 1;
      cur.push(i); len += l;
    }
    if (cur.length) pages.push(cur);
    const book = { list: d.list, ar: ar?.m || null, pages, secStart, sec: d.sec || null };
    hMem.set(mk, book);
    return book;
  }

  /* ------------------------------------------------------------ PDF kitaplar */
  let pdfjs = null;
  async function loadPdfJs() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('/static/vendor/pdfjs-4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs-4.10.38/pdf.worker.min.mjs';
    return pdfjs;
  }
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'application/pdf,.pdf'; fileInput.hidden = true;
  document.body.appendChild(fileInput);
  let fileKind = 'kitap';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]; fileInput.value = '';
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { A().toast('Lütfen PDF dosyası seçin'); return; }
    askPersist();
    const id = 'f' + Date.now().toString(36);
    const name = f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Kitap';
    try {
      await DB.put('files', id, { name, kind: fileKind, size: f.size, added: Date.now(), blob: f });
      A().toast(`“${name}” kitaplığınıza eklendi`);
      location.hash = `#kitap/f/${id}/${1}`;
    } catch { A().toast('Dosya kaydedilemedi (telefonda yer kalmamış olabilir)'); }
  });
  function pickPdf(kind) { fileKind = kind; fileInput.click(); }

  /* ------------------------------------------------------------ çizim */
  const root = () => $('kitapRoot');
  let rq = 0;
  function renderSoon() { if (!rq) rq = requestAnimationFrame(() => { rq = 0; if (routeKind() === 'lib') render(); else updateDl(); }); }
  function routeKind() { const h = location.hash; return h === '#kitap' || h === '#kitap/' || h === '#kitap/hadis' ? 'lib' : 'other'; }

  async function renderLib() {
    const [have, hb, fkeys] = await Promise.all([qHave(), hBooks().catch(() => null), DB.keys('files').catch(() => [])]);
    const bkeys = new Set(await DB.keys('books').catch(() => []));
    const files = (await Promise.all(fkeys.map(async (k) => ({ id: k, ...(await DB.get('files', k)) })))).filter((x) => x.name);
    const last = jget('nv_klast', null);
    let h = '<div class="sec-head"><h2>Kitaplık</h2><span class="sec-sub" id="kStore"></span></div>';
    if (last) {
      h += `<a class="card k-cont" href="${esc(lastHref(last))}"><span class="k-cont-ic">▶</span>
        <span><small>Kaldığınız yerden devam edin</small><b>${esc(last.title)}</b><small>${esc(last.sub || '')}</small></span></a>`;
    }
    // Yüklediğiniz kitaplar listenin başında
    const myFiles = files.slice().sort((a, b) => (prog()['f:' + b.id] ? 1 : 0) - (prog()['f:' + a.id] ? 1 : 0) || b.added - a.added);
    if (myFiles.length) h += `<section class="card k-book k-mine"><h3>Kitaplarım</h3>${fileRows(myFiles)}</section>`;
    // Kur'an
    const qp = prog().q;
    h += `<section class="card k-book k-quran">
      <div class="k-bhead"><span class="k-ar">القرآن الكريم</span><div><h3>Kur'an-ı Kerîm</h3>
      <small>30 cüz · 604 sayfa (Medine Mushafı) · Elmalılı meali, Muhtasar tefsir · telefonda ${have.size}/30 cüz</small></div></div>
      <div class="k-actions"><a class="btn" href="#kitap/kuran">Cüzler ve sureler</a>
      ${qp ? `<a class="btn ghost" href="#kitap/kuran/${qp}">Devam et (s. ${qp})</a>` : '<a class="btn ghost" href="#kitap/kuran/1">Okumaya başla</a>'}
      <button class="btn ghost" type="button" data-k="mealread">Meal ve tefsirle oku</button>
      <a class="btn ghost" href="#kitap/ara">🔍 Kelime ara</a>
      <a class="btn ghost" href="#kitap/meal">Başka dilde meal</a></div>
    </section>`;
    h += `<a class="card k-book k-dua" href="#kitap/dua${prog().d ? '/' + prog().d : ''}"><span class="k-ar">الأدعية</span>
      <span><h3>Dua Kitabı</h3><small>Namaz duaları, tesbihat, namaz sureleri ve Kur'an'dan dualar · Arapça, okunuş ve anlam</small></span></a>`;
    h += `<a class="card k-book k-dua k-esma" href="#kitap/esma"><span class="k-ar">الأسماء الحسنى</span>
      <span><h3>Esmâü'l-Hüsnâ</h3><small>Allah'ın 99 güzel ismi · Arapça, okunuş ve anlam</small></span></a>`;
    // Hadis kitapları: tek kart, dokununca liste açılır
    const hbn = (hb?.books || []).filter((b) => bkeys.has(hKey(b.id))).length;
    if (hCode()) h += `<a class="card k-book k-dua k-hadis" href="#kitap/hadis"><span class="k-ar">الكتب الستة</span>
      <span><h3>Hadis Kitapları</h3><small>${hCode() === 'tur' ? 'Kütüb-i Sitte · Buhârî, Müslim, Ebû Dâvûd, Tirmizî, Nesâî, İbn Mâce' : esc((hb?.books || []).map(hName).join(', '))}${hbn ? ` · ${(window.T || ((x) => x))('telefonda')} ${hbn}` : ''}</small></span></a>`;
    // PDF ekle
    h += `<section class="card k-book"><h3>PDF kitap ekle</h3><p class="kz-small">Telefonunuzdaki PDF kitapları ekleyin;
      telefonda saklanır, kaldığınız sayfa hatırlanır. Eklenenler kitaplığın başında görünür.</p>
      <div class="k-actions"><button class="btn" type="button" data-k="addpdf" data-kind="kitap">PDF kitap ekle</button></div></section>`;
    h += `<details class="card k-about k-dm" id="kDm"><summary><b>Veri yönetimi</b><small>Telefona inen Kur'an, meal, ses ve kitapları görün, silin</small></summary>
      <div id="kDmBody" class="k-dmb"><p class="kz-small">Hesaplanıyor…</p></div></details>`;
    h += aboutHtml();
    root().innerHTML = h;
    $('kDm').addEventListener('toggle', (e) => { if (e.target.open) dmDraw(); });
    dmStats().then((st) => { const el = $('kStore'); if (el) el.textContent = st.total ? `Telefonda ${fmtMB(st.total)}` : 'Telefonda kitap yok'; }).catch(() => {});
  }
  let DG = null;
  /** Kitaplığın en altındaki tek açıklama: kaynaklar, sürümler ve gizlilik (her sayfada ayrı ayrı yazmak yerine) */
  function aboutHtml() {
    const ex = extraMeals();
    return `<details class="card k-about"><summary><b>Kitaplık hakkında</b><small>Kaynaklar ve açıklamalar</small></summary>
      <ul>
        <li><b>Kur'an-ı Kerîm:</b> Arapça metin Tanzil Projesi'nden (tanzil.net) birebir alınmıştır; durak işaretleri Kral Fehd Kur'an Kompleksi'nin Medine Mushafı metnine göre eklenmiştir; sayfa düzeni Medine Mushafı'dır (604 sayfa).</li>
        <li><b>Kur'an sesleri:</b> Mişârî Râşid el-Afâsî kıraati, ayet ayet; Al Quran Cloud (cdn.islamic.network). Kişisel ve eğitim amaçlı dinleme içindir; sunucumuz sesleri saklamaz, yalnız aktarır.</li>
        <li><b>Meal:</b> Elmalılı Hamdi Yazır, Hak Dini Kur'an Dili meali.</li>
        <li><b>Tefsir:</b> Muhtasar Tefsir (Tefsir Araştırmaları Merkezi) Türkçe tercümesi, QuranEnc.com.</li>
        <li><b>Elmalılı tefsiri:</b> Elmalılı M. Hamdi Yazır (ö. 1942), Hak Dini Kur'an Dili, asıl (sadeleştirilmemiş) metin; Arapça ibareler kitabın kendi yazı tipiyle çizilmiştir. Elimizdeki baskıda eksik olan Tevbe 34–129, Hûd 61–123 ve Ra'd 12–43 kısımları Yazma Eserler Kurumu baskısından (haz. A. C. Köksal – M. Kaya, 2021) alınmıştır.</li>
        <li><b>Başka dillerde mealler:</b> QuranEnc.com (Kur'an-ı Kerim Ansiklopedisi); metinler değiştirilmeden, güncel sürümüyle gösterilir.${ex.length ? ' Eklediğiniz: ' + ex.map((x) => `${esc(x.t)} (sürüm ${esc(x.v)})`).join(', ') + '.' : ''}</li>
        <li><b>Hadis kitapları:</b> fawazahmed0/hadith-api; Türkçe tercümeyi hazırlayanın adı kaynakta belirtilmemiştir. Hadis numaraları o baskıya göredir.</li>
        <li><b>Dua Kitabı ve Esmâü'l-Hüsnâ:</b> âyetler Kur'an metninden, hadis duaları Kütüb-i Sitte'den alınmıştır; okunuşlar ve kısa anlamlar bu uygulama için hazırlanmıştır. Okunuşlar yaklaşıktır, doğru okuyuşu bir hocadan öğrenin.</li>
        <li><b>Yazı tipleri:</b> Amiri Quran ve Noto Naskh Arabic.</li>
        <li><b>Gizlilik:</b> İndirilen kitaplar, eklediğiniz PDF'ler ve kaldığınız yerler yalnızca bu telefonda tutulur.</li>
      </ul></details>`;
  }
  async function digerBooks() {
    if (DG) return DG;
    try { const r = await fetch('/static/books/diger.json?v=' + VER); if (r.ok) DG = await r.json(); } catch { /* çevrimdışı */ }
    return DG;
  }
  function fileRows(list) {
    return '<div class="k-files">' + list.map((f) => {
      const p = prog()['f:' + f.id];
      return `<div class="k-file"><span><b>${esc(f.name)}</b><small>${fmtMB(f.size)}${p ? ` · sayfa ${p}` : ''}</small></span>
        <a class="btn" href="#kitap/f/${f.id}/${p || 1}">${p ? 'Devam' : 'Oku'}</a>
        <button class="btn ghost" type="button" data-k="delfile" data-id="${f.id}" aria-label="Sil">Sil</button></div>`;
    }).join('') + '</div>';
  }
  function dlText(dl, size) {
    if (dl.got < 0) return 'İşleniyor…';
    return `İndiriliyor… ${fmtMB(dl.got)}`;
  }
  function updateDl() {
    document.querySelectorAll('[data-dl]').forEach((el) => {
      const dl = downloading.get(el.dataset.dl); if (dl && dl.n === undefined) el.innerHTML = dlText(dl, 0);
    });
  }
  function lastHref(l) {
    if (l.key === 'q') return `#kitap/kuran/${l.page}`;
    if (l.key === 'd') return `#kitap/dua/${l.page}`;
    if (l.key === 'e') return `#kitap/esma/${l.page || ''}`;
    if (l.key.startsWith('h:')) return `#kitap/h/${l.key.slice(2)}/${l.page}`;
    if (l.key.startsWith('f:')) return `#kitap/f/${l.key.slice(2)}/${l.page}`;
    return '#kitap';
  }

  /* ---------- Kur'an: dizin */
  let qTab = 'juz';
  const WAQF_INFO = [
    ['مَثَلًاۘ', 'Mim (Lâzım):', 'Durmak gerekir; geçilirse anlam bozulabilir.'],
    ['ٱللَّهِۗ', 'Kılâ:', 'Durmak, geçmekten daha iyidir.'],
    ['قَامُوا۟ۚ', 'Cim (Câiz):', 'Durmak da geçmek de olur.'],
    ['مَرَضًاۖ', 'Sılâ:', 'Geçmek (vasl), durmaktan daha iyidir.'],
    ['رَيْبَۛ', 'Muânaka (üç nokta):', 'Yakın iki yerde bulunur; birinde durulur, ikisinde birden durulmaz.'],
  ];
  async function renderQIndex() {
    await qMeta();
    const have = await qHave(), cur = prog().q;
    let h = `<div class="k-top"><a class="h-back" href="#kitap">‹ Kitaplık</a></div>
      <div class="sec-head"><h2>Kur'an-ı Kerîm</h2><span class="sec-sub">${have.size}/30 cüz telefonda</span></div>
      <form class="k-search" id="kSearch"><input type="search" id="kSearchQ" enterkeyhint="search" autocomplete="off" placeholder="Kur'an'da kelime ara (meal ya da Arapça)">
        <button class="btn" type="submit">Ara</button></form>
      <form class="k-goto" id="kGoto"><label>Sayfaya git<input type="number" inputmode="numeric" enterkeyhint="go" min="1" max="604" id="kGotoP" placeholder="1–604" value="${cur || ''}"></label>
        <button class="btn" type="submit">Aç</button></form>
      ${cur ? `<a class="card k-cont" href="#kitap/kuran/${cur}"><span class="k-cont-ic">▶</span><span><small>Kaldığınız yer</small><b>${pgL(cur)} · ${jzL(juzOfPage(cur))}</b><small>${esc(surahsOnPage(cur))}</small></span></a>` : ''}
      <div class="seg seg-wide k-tabs"><button type="button" data-qt="juz" aria-pressed="${qTab === 'juz'}">Cüzler</button><button type="button" data-qt="sure" aria-pressed="${qTab === 'sure'}">Sureler</button></div>`;
    if (qTab === 'juz') {
      h += '<div class="k-juz">' + Array.from({ length: 30 }, (_, i) => {
        const n = i + 1, p = QM.j[i];
        return `<a class="k-jz${have.has(n) ? ' have' : ''}" href="#kitap/kuran/${p}"><b>${jzL(n)}</b><small>${sAbbr()} ${p}</small><i>${have.has(n) ? '✓' : '⤓'}</i></a>`;
      }).join('') + '</div>';
    } else {
      h += '<div class="k-sure">' + QM.s.map((s, i) => {
        const p = pageOf(i + 1, 1);
        return `<a class="k-sr" href="#kitap/kuran/${p}"><span class="k-srn">${i + 1}</span><span><b>${esc(sName(i + 1))}</b><small>${TT(`${s[2]} ayet`)} · ${TT(s[3] === 'M' ? 'Mekkî' : 'Medenî')} · ${sAbbr()} ${p}</small></span><span class="k-ar">${esc(s[0])}</span></a>`;
      }).join('') + '</div>';
    }
    h += `<div class="k-actions k-qdl"><button class="btn ghost" type="button" data-k="qall">Tümünü indir (≈1,5 MB)</button>
      ${have.size ? '<button class="btn ghost danger" type="button" data-k="qdel">İndirilenleri sil</button>' : ''}</div>
      <p class="kz-small">Cüzler okudukça kendiliğinden iner (her biri ≈50 KB); internetsiz okumak için önceden “Tümünü indir” diyebilirsiniz.</p>
      <details class="card k-waqf"><summary><b>Durak (vakıf) işaretleri</b><small>Medine Mushafı</small></summary>
        <ul>${WAQF_INFO.map(([m, n, t]) => `<li><span class="k-ar k-wm">${m}</span><span><b>${n}</b> ${t}</span></li>`).join('')}</ul>
        <p class="kz-small">İşaret, üzerinde bulunduğu kelimenin sonundaki durma yerini gösterir. Ayet sonunda (۝) durmak sünnettir.</p></details>`;
    root().innerHTML = h;
  }
  const juzOfPage = (p) => fileOfPage(p);
  /* Arayüz diline göre sure adı, sayfa/cüz etiketi */
  const UL = () => window.UILANG || 'tr';
  const TT = (x) => (window.T ? window.T(x) : x);
  const SURE_LAT = ["Al-Fatihah", "Al-Baqarah", "Al-Imran", "An-Nisa", "Al-Ma'idah", "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus", "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr", "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha", "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan", "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum", "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir", "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir", "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah", "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf", "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman", "Al-Waqi'ah", "Al-Hadid", "Al-Mujadilah", "Al-Hashr", "Al-Mumtahanah", "As-Saff", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij", "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah", "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "Abasa", "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj", "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad", "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin", "Al-Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-Adiyat", "Al-Qari'ah", "At-Takathur", "Al-Asr", "Al-Humazah", "Al-Fil", "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr", "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas"];
  const sName = (i) => (UL() === 'tr' ? QM.s[i - 1][1] : /^(ar|ur|fa)$/.test(UL()) ? QM.s[i - 1][0] : SURE_LAT[i - 1]);
  const SURE_PRE = { en: 'Surah ', id: 'Surah ', ms: 'Surah ', ar: 'سورة ', ur: 'سورۃ ', fa: 'سوره ', hi: 'सूरह ', bn: 'সূরা ' };
  const sLabel = (names) => (UL() === 'tr' ? names + ' suresi' : (SURE_PRE[UL()] || '') + names);
  const pgL = (p) => TT(`Sayfa ${p}`);
  const jzL = (n) => TT(`${n}. cüz`);
  const sAbbr = () => TT('s.');
  function surahsOnPage(p) {
    const a = QM.p[p - 1], b = p < 604 ? QM.p[p] : [115, 0];
    const names = []; for (let s = a[0]; s <= Math.min(114, b[1] === 1 ? b[0] - 1 : b[0]); s++) names.push(sName(s));
    return sLabel(names.join(', '));
  }

  /* ---------- Kur'an: sayfa */
  /** Medine (Osmanî) yazımını Türkiye mushaflarındaki işaretlemeye yaklaştırır (yalnız gösterim; harfler aynı):
   *  sakin harflere cezm, kelime başındaki idğam şeddesini kaldırır, iklâb mimini ve okunmayan harf işaretlerini siler,
   *  vasl elifini düz elif, ءَا'yı اٰ yapar. */
  function trStyle(t) {
    const VOW = /[ً-ࣰْ-ࣲ]/;            // hareke, tenvin, şedde, cezm
    const LET = /[ء-غف-يٱ]/;
    const NOSUK = new Set(['ا', 'ى', 'ٱ', 'ء', 'و', 'ي', 'ة']);   // med harfleri vb.: cezm eklenmez
    const g = [];
    for (const ch of t) {
      if (LET.test(ch) || ch === ' ' || !g.length) g.push({ b: ch, m: '' });
      else g[g.length - 1].m += ch;
    }
    const isLet = (x) => x && LET.test(x.b);
    for (let i = 0; i < g.length; i++) {
      const x = g[i];
      if (!isLet(x)) continue;
      const iqlab = /[ۭۢ]/.test(x.m);
      x.m = x.m.replace(/[ۭ۟۠ۢ]/g, '');           // okunmayan harf (۟ ۠), iklâb mimi (ۢ ۭ)
      if (i === 0 || g[i - 1].b === ' ') x.m = x.m.replace('ّ', ''); // kelime başı şedde = önceki kelimeden idğam
      if (VOW.test(x.m) || NOSUK.has(x.b)) continue;
      const nx = g[i + 1];
      if (!nx) continue;
      if (nx.b === ' ') x.m = 'ْ' + x.m;                          // kelime sonunda sakin harf
      else if (isLet(nx) && (!/ّ/.test(nx.m) || iqlab)) x.m = 'ْ' + x.m;   // kelime içi (şemsî lam hariç)
    }
    return g.map((x) => (x.b === 'ٱ' ? 'ا' : x.b) + x.m).join('')
      .replace(/ءَا(?![ً-ْٰٓ])/g, 'اٰ')
      .replace(/ـ(?:َٔ|َٔ)ا(?![ً-ْٰٓ])/g, 'اٰ')   // الْـَٔاخِرَة → الْاٰخِرَة   // ءَامَنُوا → اٰمَنُوا
      .replace(/\u064F\u06E5/g, '\u0657').replace(/\u0650\u06E6/g, '\u0656');   // لَهُۥ → لَهٗ (ters ötre), بِهِۦ → بِهٖ (uzun esre)
  }
  /** Bilgisayar hattında Türkiye mushaflarındaki gibi yazım; Mushaf hattında Medine Mushafı'nın aslı */
  const qa = (t) => (hatPc() ? trStyle(t) : t);
  const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';   // Tanzil metnindeki harfi harfine besmele (hareke sırası dahil)
  const B_TAIL = BASMALA.split(' ').slice(1).join(' ');
  /** Sure başındaki besmeleyi metnin kendi yazımıyla ayır: [besmele, kalan] ya da null.
   *  İlk kelime şeddeli de yazılabilir (Tîn, Kadr): şedde (U+0651) yok sayılarak karşılaştırılır. */
  function splitBasmala(t) {
    const w = t.split(' '), b0 = BASMALA.split(' ')[0].replace(/\u0651/g, '');
    if (w.length > 4 && w[0].replace(/\u0651/g, '') === b0 && w.slice(1, 4).join(' ') === B_TAIL) return [w.slice(0, 4).join(' '), w.slice(4).join(' ')];
    return null;
  }
  async function renderQPage(p) {
    await qMeta();
    p = Math.max(1, Math.min(604, p | 0));
    const n = fileOfPage(p), fs = fontSize('q', 27);
    root().innerHTML = readerShell({ back: '#kitap/kuran', title: pgL(p), sub: `${jzL(n)} · ${surahsOnPage(p)}`, page: p, max: 604, kind: 'q', rtl: true });
    const body = $('kBody');
    let data;
    try {
      body.innerHTML = '<p class="k-wait">Yükleniyor…</p>';
      data = await qLoad(n);
    } catch (e) {
      body.innerHTML = `<div class="k-wait"><p>${esc(e.message)}</p><button class="btn" type="button" data-k="retry">Tekrar dene</button></div>`;
      return;
    }
    const rows = data.p[p] || [];
    // sonraki cüzü önceden indir (küçük, ≈15 KB sıkıştırılmış): okurken internet kesilse de devam edilsin
    const ahead = fileOfPage(Math.min(604, p + 3));
    if (ahead !== n && navigator.onLine) {
      qLoad(ahead).catch(() => {});
      if (mealOn()) juzData('m:' + mealKey(), ahead).catch(() => {});
    }
    if (mealOn()) { await renderQMeal(p, n, rows, fs); return; }
    let html = '';
    for (const [s, a, t] of rows) {
      let txt = t;
      if (a === 1) {
        html += `<div class="q-sure"><span class="k-ar">سُورَةُ ${esc(QM.s[s - 1][0])}</span><small>${esc(sLabel(sName(s)))} · ${TT(`${QM.s[s - 1][2]} ayet`)}</small></div>`;
        const sp = s !== 1 && s !== 9 ? splitBasmala(txt) : null;
        if (sp) { html += `<div class="q-bsm">${esc(qa(sp[0]))}</div>`; txt = sp[1]; }
      }
      html += `<span class="q-ay" id="ay-${s}-${a}">${esc(qa(txt))}</span> <span class="q-no" aria-label="${a}. ayet">۝${arNum(a)}</span> `;
    }
    body.innerHTML = `<div class="q-page" style="font-size:${fs}px">${html}</div>`;
    saveProg('q', p, `${TT("Kur'an-ı Kerîm")} · ${pgL(p)}`, `${jzL(n)} · ${surahsOnPage(p)}`);
    showPendingAy();
  }
  /** Aramadan gelindiyse bulunan ayete kaydır ve kısa süre vurgula */
  let pendingAy = null;
  function showPendingAy() {
    sesMark(); sesFab(); if (P.s && cur.kind === 'q') sesAutoPage(cur.page);
    if (!pendingAy) return;
    const el = $('ay-' + pendingAy); pendingAy = null;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollIntoView({ block: 'center' }); el.classList.add('q-hl'); setTimeout(() => el.classList.remove('q-hl'), 2600); });
  }

  /* ---------- Kur'an: meal (ve tefsir) ile ayet ayet */
  function sureHead(s) {
    return `<div class="q-sure"><span class="k-ar">سُورَةُ ${esc(QM.s[s - 1][0])}</span><small>${esc(sLabel(sName(s)))} · ${TT(`${QM.s[s - 1][2]} ayet`)}</small></div>`;
  }
  async function renderQMeal(p, n, rows, fs) {
    const body = $('kBody');
    const mk = mealKey(), idx = await mealList();
    const mi = idx.find((x) => x.key === mk) || idx[0];
    const juzs = [...new Set(rows.map(([s, a]) => juzOf(s, a)))];
    let meal = {}, mealErr = '', mealSrc = '', tef = null, tefErr = '';
    try { for (const j of juzs) { const d = await juzData('m:' + (mi?.key || 'elmalili'), j); Object.assign(meal, d.m); if (d.src) mealSrc = d.src; } } catch (e) { mealErr = e.message; }
    let eix = null;
    if (tefOn() && isElm()) { try { eix = await elmIdx(); } catch (e) { tefErr = e.message; } }
    else if (tefOn()) {
      try { tef = { m: {} }; for (const j of juzs) { const d = await juzData(tefKind(), j); Object.assign(tef.m, d.m); tef.ver = d.ver; tef.src = d.src; } }
      catch (e) { tefErr = e.message; tef = null; }
    }
    const tfs = Math.max(14, Math.round(fs * 0.62)), mdir = mi?.dir === 'rtl' ? 'rtl' : 'ltr';
    let h = `<div class="qm-bar"><label>Meal <select id="kMealSel">${idx.map((x) => `<option value="${esc(x.key)}"${x.key === mi?.key ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
      <option value="__lib">＋ Başka dilde meal…</option></select></label>
      ${tefAllowed() && (window.UILANG || 'tr') === 'tr' ? `<label>Tefsir <select id="kTefSel">${['mokhtasar', 'elmalili'].map((k) => `<option value="${k}"${tefKey() === k ? ' selected' : ''}>${k === 'elmalili' ? 'Elmalılı (Hak Dini Kur\'an Dili)' : 'Muhtasar Tefsir'}</option>`).join('')}</select></label>` : ''}
</div>`;
    if (mealErr) h += `<p class="k-wait">${esc(mealErr)} <button class="btn ghost" type="button" data-k="retry">Tekrar dene</button></p>`;
    if (tefErr) h += `<p class="k-wait">${esc(tefErr)}</p>`;
    h += '<div class="qm-list">';
    for (const [ri, [s, a, t]] of rows.entries()) {
      let txt = t;
      if (a === 1) {
        h += sureHead(s);
        const sp = s !== 1 && s !== 9 ? splitBasmala(txt) : null;
        if (sp) { h += `<div class="q-bsm k-ar" style="font-size:${fs}px">${esc(qa(sp[0]))}</div>`; txt = sp[1]; }
      }
      const mv = meal[s + ':' + a], tf = tef?.m[s + ':' + a];
      const tr = Array.isArray(mv) ? mv[0] : mv, fn = Array.isArray(mv) ? mv[1] : '';
      h += `<article class="qm" id="ay-${s}-${a}">
        <div class="qm-ar k-ar" style="font-size:${fs}px">${esc(qa(txt))} <span class="q-no">۝${arNum(a)}</span></div>
        ${tr !== undefined ? `<p class="qm-tr" dir="${mdir}" style="font-size:${tfs}px"><b>${s}:${a}</b> ${noteMarks(tr)}</p>` : ''}
        ${fn ? `<p class="qm-fn" dir="${mdir}" style="font-size:${tfs - 2}px">${noteMarks(fn, true)}</p>` : ''}
        <div class="qm-acts">${tf || !tefAllowed() || eix ? '' : `<button class="qm-tb" type="button" data-k="tef1" data-s="${s}" data-a="${a}">Tefsirini göster</button>`}
          <button class="qm-tb" type="button" data-k="aycopy" data-s="${s}" data-a="${a}">Ayeti kopyala</button></div>
        ${tf ? `<div class="qm-tef" style="font-size:${tfs - 1}px"><b>${TEFS[tefKey()]}</b> ${esc(tf[0])}${tf[1] ? `<small>${esc(tf[1])}</small>` : ''}</div>`
          : '<div class="qm-tef" hidden></div>'}
      </article>`;
      if (eix) {                                                  // Elmalılı: bölümün bu sayfadaki son ayetinden sonra
        const gi = elmFind(eix, s, a), nx = rows[ri + 1];
        if (gi >= 0 && !(nx && nx[0] === s && elmFind(eix, s, nx[1]) === gi)) h += elmBox(s, gi, eix.s[s][gi], false);
      }
    }
    h += '</div>';
    body.innerHTML = h;
    $('kMealSel')?.addEventListener('change', (e) => {
      if (e.target.value === '__lib') { e.target.value = mi?.key || ''; location.hash = '#kitap/meal'; return; }
      jset('nv_kmealk', e.target.value); render();
    });
    $('kTefSel')?.addEventListener('change', (e) => { jset('nv_ktefk', e.target.value); render(); });
    body.querySelectorAll('details.em').forEach((d) => d.addEventListener('toggle', () => elmFill(d)));
    saveProg('q', p, `${TT("Kur'an-ı Kerîm")} · ${pgL(p)}`, `${jzL(n)} · ${surahsOnPage(p)}`);
    showPendingAy();
  }
  /** Dipnot işaretlerini [1] üst simge yap (metin önce güvenli hale getirilir). */
  function noteMarks(t, isNote) {
    const e = esc(t).replace(/\n/g, '<br>');
    return isNote ? e.replace(/(^|<br>)\s*\[(\d+)\]\s*/g, '$1<sup>$2</sup> ') : e.replace(/\[(\d+)\]/g, '<sup>$1</sup>');
  }
  /** Ayeti kopyala: Arapça metin + ekranda görünen meal (hangi dildeyse) + kaynaklar + ses dosyasının adresi */
  async function copyAyah(btn) {
    const s = +btn.dataset.s, a = +btn.dataset.a, art = btn.closest('.qm');
    const ar = (art.querySelector('.qm-ar')?.childNodes[0]?.textContent || '').trim();
    const trEl = art.querySelector('.qm-tr');
    const tr = trEl ? trEl.textContent.replace(/^\s*\d+:\d+\s*/, '').trim() : '';
    const mk = mealKey(), mi = (await mealList()).find((x) => x.key === mk);
    const lines = [`${ar} ﴿${arNum(a)}﴾`, '', tr ? `${s}:${a} ${tr}` : '', '',
      `${sLabel(sName(s))} ${s}:${a}`,
      mi && tr ? `${TT('Meal:')} ${mi.name}` : '',
      `${TT('Arapça metin:')} Tanzil (tanzil.net)`,
      `${TT('Ses (Mişârî Râşid el-Afâsî):')} https://cdn.islamic.network/quran/audio/${sesCfg().br}/ar.alafasy/${gnum(s, a)}.mp3`];
    const text = lines.filter((x, i) => x !== '' || (i > 0 && lines[i - 1] !== '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    try { await navigator.clipboard.writeText(text); A().toast(TT('Ayet kopyalandı ✓')); }
    catch { await A().ask({ title: 'Seçip kopyalayın:', input: text, buttons: [{ label: 'Tamam', value: null }] }); }
  }
  async function showTef1(btn) {
    const s = +btn.dataset.s, a = +btn.dataset.a, box = btn.closest('.qm').querySelector('.qm-tef');
    btn.disabled = true; btn.textContent = 'Yükleniyor…';
    if (isElm()) {
      try {
        const ix = await elmIdx(), gi = elmFind(ix, s, a);
        if (gi < 0) throw new Error('Bu ayet için tefsir yok.');
        box.outerHTML = elmBox(s, gi, ix.s[s][gi], true);
        const det = btn.closest('.qm').querySelector('details.em');
        det.addEventListener('toggle', () => elmFill(det)); elmFill(det); btn.remove();
      } catch (e) { btn.disabled = false; btn.textContent = 'Tefsirini göster'; A().toast(e.message); }
      return;
    }
    try {
      const d = await juzData(tefKind(), juzOf(s, a)), tf = d.m[s + ':' + a] || ['', ''];
      box.innerHTML = `<b>${TEFS[tefKey()]}</b> ${esc(tf[0] || 'Bu ayet için tefsir metni yok.')}${tf[1] ? `<small>${esc(tf[1])}</small>` : ''}`;
      box.style.fontSize = btn.closest('.qm').querySelector('.qm-tr')?.style.fontSize || '';
      box.hidden = false; btn.remove();
    } catch (e) { btn.disabled = false; btn.textContent = 'Tefsirini göster'; A().toast(e.message); }
  }

  /* ---------- Kur'an'da kelime arama (telefonda; meal ya da Arapça metin) */
  const AR_MARK = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/;
  const AR_RE = /[؀-ۿ]/;
  function normAr(c) {
    if (AR_MARK.test(c)) return '';
    if ('ٱأإآ'.includes(c)) return 'ا';
    if (c === 'ى' || c === 'ئ') return 'ي';
    if (c === 'ة') return 'ه';
    if (c === 'ؤ') return 'و';
    return c;
  }
  function normLat(c) { return c.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i'); }
  /** metni harf harf sadeleştir; her sade harfin asıl metindeki yerini de tut (vurgulamak için) */
  function normMap(s, f) { let out = ''; const map = []; for (let i = 0; i < s.length; i++) { const c = f(s[i]); for (const ch of c) { out += ch; map.push(i); } } return [out, map]; }
  const normQ = (q, ar) => (ar ? normMap(q, normAr)[0] : normMap(q, normLat)[0]).replace(/\s+/g, ' ').trim();
  function hilite(text, nq, f) {
    const [n, map] = normMap(text, f); const parts = []; let from = 0, i = n.indexOf(nq);
    if (i < 0) return esc(text);
    while (i >= 0) {
      let a = map[i], b = map[i + nq.length - 1] + 1;
      while (b < text.length && f(text[b]) === '') b++;                   // ardındaki harekeler de vurgulansın
      if (a >= from) { parts.push(esc(text.slice(from, a)), '<mark>', esc(text.slice(a, b)), '</mark>'); from = b; }
      i = n.indexOf(nq, i + nq.length);
    }
    parts.push(esc(text.slice(from)));
    return parts.join('');
  }
  let SR = null;                                    // son arama: {q, ar, key, hits:[[s,a,text]]}
  let srShown = 100;
  async function runSearch(q, onProg) {
    const ar = AR_RE.test(q), nq = normQ(q, ar), key = mealKey(), f = ar ? normAr : normLat;
    if (nq.length < 2) throw new Error('En az 2 harf yazın');
    const hits = [];
    for (let n = 1; n <= 30; n++) {
      onProg?.(n);
      if (ar) {
        const d = await qLoad(n);
        for (const pg of Object.keys(d.p).map(Number).sort((x, y) => x - y)) {
          for (const [s, a, t] of d.p[pg]) if (juzOf(s, a) === n && normMap(t, f)[0].includes(nq)) hits.push([s, a, t, pg]);
        }
      } else {
        const d = await juzData('m:' + key, n);
        for (const [ref, v] of Object.entries(d.m)) {
          const t = Array.isArray(v) ? v[0] : v;
          if (t && normMap(t, f)[0].includes(nq)) { const [s, a] = ref.split(':').map(Number); hits.push([s, a, t, 0]); }
        }
      }
    }
    return { q, ar, nq, key, hits };
  }
  async function renderSearch(q) {
    await qMeta();
    const idx = await mealList(), mi = idx.find((x) => x.key === mealKey()) || idx[0];
    let h = `<div class="k-top"><a class="h-back" href="#kitap/kuran">‹ Kur'an-ı Kerîm</a></div>
      <div class="sec-head"><h2>Kur'an'da ara</h2></div>
      <form class="k-search" id="kSearch"><input type="search" id="kSearchQ" enterkeyhint="search" autocomplete="off" placeholder="Kelime yazın: sabır, rahmet, الصبر…" value="${esc(q)}">
        <button class="btn" type="submit">Ara</button></form>
      <p class="kz-small">Türkçe (Latin harfli) yazarsanız <b>${esc(mi?.name || 'meal')}</b> mealinde, Arapça yazarsanız Kur'an metninde arar.
        Harekesiz yazabilirsiniz; ş/s, ı/i, â/a ayrımı yapılmaz. Meali değiştirmek için Kur'an sayfasında “Meal” listesini kullanın.</p>
      <div id="kSRes"></div>`;
    root().innerHTML = h;
    if (!q) { $('kSearchQ').focus(); return; }
    const box = $('kSRes');
    if (!(SR && SR.q === q && SR.key === mealKey())) {
      srShown = 100;
      box.innerHTML = '<p class="k-wait" id="kSProg">Aranıyor…</p>';
      try {
        SR = await runSearch(q, (n) => { const el = $('kSProg'); if (el) el.textContent = `Aranıyor… ${n}/30 cüz${navigator.onLine ? ' (ilk aramada metin telefona iner, sonra internetsiz de arar)' : ''}`; });
      } catch (e) {
        box.innerHTML = `<div class="card"><p>${esc(e.offline ? 'Arama için Kur\'an metni ve meal telefonda olmalı. İnternete bağlanıp bir kez arayın; sonra internetsiz de çalışır.' : e.message)}</p></div>`;
        return;
      }
    }
    drawSearch();
  }
  function drawSearch() {
    const box = $('kSRes'); if (!box || !SR) return;
    const { hits, ar, nq } = SR, f = ar ? normAr : normLat;
    if (!hits.length) { box.innerHTML = `<div class="card"><p>“${esc(SR.q)}” bulunamadı. Kelimenin kökünü (ör. “sabr”, “şükr”) ya da farklı yazılışını deneyin.</p></div>`; return; }
    const sures = new Set(hits.map((x) => x[0])).size;
    let h = `<p class="k-scount"><b>${fmtN(hits.length)}</b> ayet · ${sures} surede</p><div class="k-sres">`;
    for (const [s, a, t, pg] of hits.slice(0, srShown)) {
      const page = pg || pageOf(s, a);
      h += `<a class="card k-sr-it" href="#kitap/kuran/${page}" data-k="gores" data-ay="${s}-${a}" data-m="${ar ? 0 : 1}">
        <small>${esc(sName(s))} ${s}:${a} · ${sAbbr()} ${page}</small>
        <span class="${ar ? 'k-ar k-sr-ar' : 'k-sr-tr'}"${ar ? ' dir="rtl"' : ''}>${hilite(t, nq, f)}</span></a>`;
    }
    h += '</div>';
    if (hits.length > srShown) h += `<button class="btn ghost k-more-btn" type="button" data-k="srmore">Daha fazla göster (${fmtN(hits.length - srShown)})</button>`;
    box.innerHTML = h;
  }

  /* ---------- Başka dillerde meal (QuranEnc.com, sunucu üzerinden; telefona cüz cüz iner) */
  const BUILTIN_QE = /_(mokhtasar|saadi)$|^turkish_(mokhtasar|saadi)$/;           // tefsirler meal listesinde gösterilmez
  let mlFilter = '';
  async function qeList(force) {
    let c = await DB.get('quran', 'qelist').catch(() => null);
    if (navigator.onLine && (force || !c || Date.now() - c.at > 86400000)) {
      try { const r = await fetch('/api/qe/list'); if (r.ok) { const j = await r.json(); c = { at: Date.now(), items: j.items }; DB.put('quran', 'qelist', c).catch(() => {}); } } catch { /* çevrimdışı */ }
    }
    if (!c) throw new Error('Meal listesi alınamadı. İnternete bağlanıp tekrar deneyin.');
    return c.items;
  }
  /* İkinci kaynak: fawazahmed0/quran-api (Tanzil vb. kaynaklı ~400 meal; telefona doğrudan, cüz cüz iner) */
  const FZ_ISO = {"Achinese": "ace", "Afar": "aa", "Afrikaans": "af", "Albanian": "sq", "Amharic": "am", "Assamese": "as", "Azerbaijani": "az", "Bambara": "bm", "Bengali": "bn", "Berber": "ber", "Bosnian": "bs", "Bulgarian": "bg", "Burmese": "my", "Catalan": "ca", "Chichewa": "ny", "Chinese(simplified)": "zh", "Chinese(traditional)": "zh-Hant", "Croatian": "hr", "Czech": "cs", "Dagbani": "dag", "Danish": "da", "Dari": "prs", "Divehi": "dv", "Dutch": "nl", "English": "en", "Esperanto": "eo", "Filipino": "fil", "Finnish": "fi", "French": "fr", "Fulah": "ff", "Ganda": "lg", "German": "de", "Gujarati": "gu", "Hausa": "ha", "Hebrew": "he", "Hindi": "hi", "Hungarian": "hu", "Indonesian": "id", "Iranun": "ill", "Italian": "it", "Japanese": "ja", "Javanese": "jv", "Kannada": "kn", "Kazakh": "kk", "Kendayan": "knx", "Khmer": "km", "Kinyarwanda": "rw", "Kirghiz": "ky", "Korean": "ko", "Kurdish": "ckb", "Kurmanji": "kmr", "Lingala": "ln", "Luyia": "luy", "Macedonian": "mk", "Malay": "ms", "Malayalam": "ml", "Maltese": "mt", "Maranao": "mrw", "Marathi": "mr", "Nepali": "ne", "Norwegian": "no", "Oromo": "om", "Panjabi": "pa", "Persian": "fa", "Polish": "pl", "Portuguese": "pt", "Pushto": "ps", "Romanian": "ro", "Rundi": "rn", "Russian": "ru", "Serbian": "sr", "Shona": "sn", "Sindhi": "sd", "Sinhala": "si", "Slovak": "sk", "Somali": "so", "Sotho": "st", "Spanish": "es", "Swahili": "sw", "Swedish": "sv", "Tajik": "tg", "Tamil": "ta", "Tatar": "tt", "Telugu": "te", "Thai": "th", "Turkish": "tr", "Twi": "tw", "Uighur": "ug", "Ukrainian": "uk", "Urdu": "ur", "Uzbek": "uz", "Vietnamese": "vi", "Xhosa": "xh", "Yau": "yau", "Yoruba": "yo", "Zulu": "zu"};
  const FZ_SKIP = /-(la|lad)$|^ara-|^tur-(muslimshahin|sabanpiris|shabanbritch|elmalilihamdiya|latinalphabet1?)$/;
  const FZ_TRN = {"tur-abdulbakigolpin": "Abdülbâki Gölpınarlı", "tur-ademugur": "Adem Uğur", "tur-alibulac": "Ali Bulaç", "tur-alifikriyavuz": "Ali Fikri Yavuz", "tur-celalyldrm": "Celal Yıldırım", "tur-diyanetisleri": "Diyanet İşleri", "tur-diyanetisleri1": "Diyanet İşleri (2)", "tur-diyanetvakfi": "Diyanet Vakfı", "tur-edipyuksel": "Edip Yüksel", "tur-elmallsadelesti": "Elmalılı Hamdi Yazır (sadeleştirilmiş)", "tur-elmallsadelesti1": "Elmalılı Hamdi Yazır (sadeleştirilmiş, 2)", "tur-fizilalilkuran": "Fî Zılâli'l-Kur'ân", "tur-gultekinonan": "Gültekin Onan", "tur-hasanbasricanta": "Hasan Basri Çantay", "tur-ibnikesir": "İbn Kesîr", "tur-iskenderalimihr": "İskender Ali Mihr", "tur-muhammedesed": "Muhammed Esed", "tur-muhammetabay": "Muhammet Abay", "tur-suatyildirim": "Suat Yıldırım", "tur-suleymanates": "Süleyman Ateş", "tur-tefhimulkuran": "Tefhîmu'l-Kur'ân", "tur-wwwislamhouseco": "IslamHouse.com", "tur-yasarnuriozturk": "Yaşar Nuri Öztürk", "tur-yasarnuriozturk1": "Yaşar Nuri Öztürk (2)", "tur-ynozturk": "Yaşar Nuri Öztürk (3)"};   // Türkçe adların doğru yazımı
  const FZ_BASE = ['https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1', 'https://raw.githubusercontent.com/fawazahmed0/quran-api/1'];
  async function fzFetch(path) {
    let last;
    for (const b of FZ_BASE) { try { const r = await fetch(b + path); if (r.ok) return await r.json(); last = new Error('HTTP ' + r.status); } catch (e) { last = e; } }
    throw last || new Error('İndirilemedi');
  }
  async function fzList() {
    let c = await DB.get('quran', 'fzlist').catch(() => null);
    if (navigator.onLine && (!c || Date.now() - c.at > 7 * 86400000)) {
      try {
        const j = await fzFetch('/editions.min.json');   // {ad: {name, author, language, direction, source}}
        const items = Object.values(j).filter((e) => e.language !== 'Latin' && !FZ_SKIP.test(e.name)).map((e) => ({
          k: 'fz:' + e.name, l: FZ_ISO[e.language] || 'x-' + e.language, t: FZ_TRN[e.name] || e.author, d: e.source ? 'kaynak: ' + e.source.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '', v: '', dir: e.direction, src: 'fz' }));
        c = { at: Date.now(), items }; DB.put('quran', 'fzlist', c).catch(() => {});
      } catch { /* çevrimdışı */ }
    }
    return c ? c.items : [];
  }
  const isFz = (key) => key.startsWith('fz:');
  async function mealHave(key) {
    const pre = `m:${key}:`;
    return (await DB.keys('quran').catch(() => [])).filter((k) => typeof k === 'string' && k.startsWith(pre)).length;
  }
  async function renderMealLib() {
    const idx = await mealIndex().catch(() => []), ex = extraMeals(), mk = mealOn() ? mealKey() : '';
    let h = `<div class="k-top"><a class="h-back" href="#kitap/kuran${prog().q ? '/' + prog().q : ''}">‹ Kur'an-ı Kerîm</a></div>
      <div class="sec-head"><h2>Mealler</h2></div>
      <h3 class="k-sec">Türkçe mealler</h3><div class="k-mlist">`;
    for (const m of idx) {
      h += `<div class="card k-ml"><div><b>${esc(m.name)}</b><small>${esc(m.desc || '')}</small></div>
        <button class="btn${m.key === mk ? '' : ' ghost'}" type="button" data-k="mealuse" data-id="${esc(m.key)}">${m.key === mk ? 'Okunuyor' : 'Oku'}</button></div>`;
    }
    h += '</div>';
    if (ex.length) {
      h += '<h3 class="k-sec">Eklediğiniz mealler <small class="k-sec-sub">telefonda saklanır, internetsiz okunur</small></h3><div class="k-mlist">';
      for (const m of ex) {
        const n = await mealHave(m.k), dl = downloading.get('ml:' + m.k);
        h += `<div class="card k-ml"><div><b>${esc(langName(m.l))} · ${esc(m.t)}</b><small>sürüm ${esc(m.v)} · ${dl ? `<span data-dl="ml:${esc(m.k)}">İndiriliyor… ${dl.n}/30</span>` : `telefonda ${n}/30 cüz`}</small></div>
          <div class="k-mlbtn"><button class="btn${m.k === mk ? '' : ' ghost'}" type="button" data-k="mealuse" data-id="${esc(m.k)}">${m.k === mk ? 'Okunuyor' : 'Oku'}</button>
          ${n < 30 && !dl ? `<button class="btn ghost" type="button" data-k="mealdl" data-id="${esc(m.k)}">Tümünü indir</button>` : ''}
          <button class="btn ghost danger" type="button" data-k="mealrm" data-id="${esc(m.k)}" aria-label="Kaldır">Kaldır</button></div></div>`;
      }
      h += '</div>';
    }
    h += `<h3 class="k-sec">Meal ekle: Türkçe ve diğer diller <small class="k-sec-sub">Seçtiğiniz meal okudukça cüz cüz telefona iner; “Tümünü indir” ile hepsini önceden alabilirsiniz.</small></h3>
      <input type="search" class="k-mlfilter" id="kMlF" placeholder="Dil ya da mütercim ara: İngilizce, Almanca, Kürtçe…" value="${esc(mlFilter)}" autocomplete="off">
      <div id="kMlAll"><p class="k-wait">Liste alınıyor…</p></div>`;
    root().innerHTML = h;
    $('kMlF').addEventListener('input', (e) => { mlFilter = e.target.value; drawMealAll(); });
    try {
      const [qe, fz] = await Promise.all([qeList().catch(() => []), fzList()]);
      MLALL = qe.filter((x) => !BUILTIN_QE.test(x.k)).map((x) => ({ ...x, d: [x.d, 'QuranEnc.com'].filter(Boolean).join(' · ') })).concat(fz);
      if (!MLALL.length) throw new Error('Meal listesi alınamadı. İnternete bağlanıp tekrar deneyin.');
    } catch (e) { $('kMlAll').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn" type="button" data-k="retry">Tekrar dene</button></div>`; return; }
    drawMealAll();
  }
  let MLALL = [];
  function drawMealAll() {
    const box = $('kMlAll'); if (!box) return;
    const have = new Set(extraMeals().map((x) => x.k)), fq = normQ(mlFilter, false);
    const groups = new Map();
    for (const x of MLALL) {
      const ln = langName(x.l);
      if (fq && !normQ(`${ln} ${x.l} ${x.t} ${x.d} ${x.k}`, false).includes(fq)) continue;
      if (!groups.has(ln)) groups.set(ln, []); groups.get(ln).push(x);
    }
    const pri = [langName(window.UILANG || 'tr'), langName('tr')];      // önce arayüz dili, sonra Türkçe
    const rk = (n) => { const i = pri.indexOf(n); return i < 0 ? 9 : i; };
    const names = [...groups.keys()].sort((a, b) => rk(a) - rk(b) || a.localeCompare(b, 'tr'));
    if (!names.length) { box.innerHTML = '<p class="kz-small">Sonuç yok.</p>'; return; }
    box.innerHTML = names.map((ln) => `<details class="card k-mlg"${fq || names.length < 4 ? ' open' : ''}><summary><b>${esc(ln)}</b> <small>${groups.get(ln).length}</small></summary>
      ${groups.get(ln).map((x) => `<div class="k-ml"><div><b dir="auto">${esc(x.t)}</b><small dir="auto">${esc(x.d)}${x.v ? ' · sürüm ' + esc(x.v) : ''}</small></div>
        ${have.has(x.k) ? '<span class="k-ok">Eklendi ✓</span>' : `<button class="btn ghost" type="button" data-k="mealadd" data-id="${esc(x.k)}">Ekle</button>`}</div>`).join('')}</details>`).join('');
  }
  async function mealDownloadAll(key) {
    if (!navigator.onLine) { A().toast('İnternet bağlantısı yok'); return; }
    const st = { n: 0 }; downloading.set('ml:' + key, st);
    try {
      for (let n = 1; n <= 30; n++) {
        st.n = n; const el = document.querySelector(`[data-dl="ml:${CSS.escape(key)}"]`); if (el) el.textContent = `İndiriliyor… ${n}/30`;
        await juzData('m:' + key, n);
      }
      A().toast('Meal telefona indirildi');
    } catch (e) { A().toast(e.message || 'İndirilemedi'); }
    finally { downloading.delete('ml:' + key); if (cur.kind === 'ml') renderMealLib(); }
  }

  /* ---------- Esmâü'l-Hüsnâ */
  let ESMA = null;
  async function esmaData() {
    if (ESMA) return ESMA;
    let d = await DB.get('books', 'esma').catch(() => null);
    if (!d || (navigator.onLine && d.ver !== VER)) {
      try { const r = await fetch('/static/books/esma.json?v=' + VER); if (r.ok) { d = await r.json(); d.ver = VER; DB.put('books', 'esma', d).catch(() => {}); } } catch { /* çevrimdışı */ }
    }
    if (!d) throw new Error('Esmâü\'l-Hüsnâ henüz telefona inmedi; internete bağlanınca iner.');
    const L = window.UILANG || 'tr';
    if (L !== 'tr') {                                                // isimlerin okunuşu ve anlamı seçilen dilde
      let x = await DB.get('books', 'esma-' + L).catch(() => null);
      if (!x || (navigator.onLine && x.ver !== VER)) {
        try { const r = await fetch(`/static/books/esma-${L}.json?v=${VER}`); if (r.ok) { x = await r.json(); x.ver = VER; DB.put('books', 'esma-' + L, x).catch(() => {}); } } catch { /* çevrimdışı */ }
      }
      if (x?.n?.length === d.n.length) d = { ...d, n: d.n.map((it, i) => [it[0], it[1], x.n[i][0], x.n[i][1]]) };
    }
    return (ESMA = d);
  }
  /* ---------- Zikirmatik: basit sayaç; sayı yalnız bu telefonda saklanır */
  const ZK_T = [33, 99, 100, 500, 1000, 0];                          // 0 = sınırsız
  const zk = () => { const z = jget('nv_zikir', {}); const t = Math.floor(+z.t); return { c: +z.c || 0, t: z.t === undefined || !(t >= 0 && t <= 1e5) ? 33 : t, v: z.v !== false, tot: +z.tot || 0, tur: +z.tur || 0, id: z.id || '' }; };
  let ZKD = null;
  /** Örnek zikirler (bilgilendirme): Arapça, okunuş, anlam, önerilen sayı, kaynak */
  async function zikirData() {
    if (ZKD) return ZKD;
    let d = await DB.get('books', 'zikir').catch(() => null);
    if (!d || (navigator.onLine && d.ver !== VER)) {
      try { const r = await fetch('/static/books/zikir.json?v=' + VER); if (r.ok) { d = await r.json(); d.ver = VER; DB.put('books', 'zikir', d).catch(() => {}); } } catch { /* çevrimdışı */ }
    }
    return (ZKD = d);
  }
  const zkSave = (z) => jset('nv_zikir', z);
  /** Kaza sekmesindeki Zikirmatik bölmesi (el: kutu) */
  async function renderZikir(el) {
    const R = el;
    const zd = await zikirData().catch(() => null), tr = (window.UILANG || 'tr') === 'tr';
    const zm = (x) => (tr ? x.m : x.en), zf = (x) => (tr ? x.f : x.f_en);
    R.innerHTML = `<div class="k-zik"><div class="zk">
        <div class="zk-cur" id="zkCur"></div>
        <div class="zk-t" role="group" aria-label="Hedef">${ZK_T.map((t) => `<button type="button" data-t="${t}">${t || '∞'}</button>`).join('')}</div>
        <button type="button" class="zk-btn" id="zkBtn" aria-label="Say"><span class="zk-n" id="zkN">0</span><span class="zk-s" id="zkS"></span></button>
        <div class="zk-acts"><button class="btn ghost" type="button" id="zkUndo">− 1</button>
          <button class="btn ghost" type="button" id="zkReset">Sıfırla</button>
          <label class="zk-v"><input type="checkbox" id="zkVib"> Titreşim</label></div>
        <p class="kz-small zk-tot" id="zkTot"></p></div>
      ${zd ? `<section class="zk-list"><h3>${esc(zd.title)}</h3><p class="kz-small">${esc(tr ? zd.note : zd.note_en)}</p>
        ${zd.z.map((x) => `<details class="card zk-it" id="zk-${x.id}"><summary><span class="k-ar zk-ar">${esc(x.ar)}</span>
          <span class="zk-ok"><b>${esc(x.tr)}</b><small>${esc(zm(x))}</small></span><span class="zk-c">${x.n}</span></summary>
          <div class="zk-in"><p>${esc(zf(x))}</p><p class="kz-small"><span>Kaynak</span> · ${esc(x.k)}</p>
          <button class="btn" type="button" data-zid="${x.id}">Bu zikri say (${x.n})</button></div></details>`).join('')}
        <button class="btn ghost zk-free" type="button" data-zid="">Serbest sayaç</button></section>` : ''}</div>`;
    const btn = R.querySelector('#zkBtn');
    const draw = (z, pop) => {
      R.querySelector('#zkN').textContent = z.c;
      R.querySelector('#zkS').textContent = z.t ? `${z.c % z.t === 0 && z.c ? z.t : z.c % z.t} / ${z.t}${z.tur ? ` · ${z.tur}. tur` : ''}` : '';
      R.querySelectorAll('.zk-t button').forEach((b) => b.classList.toggle('on', +b.dataset.t === z.t));
      btn.style.setProperty('--p', z.t ? ((z.c % z.t === 0 && z.c ? z.t : z.c % z.t) / z.t) : 0);
      R.querySelector('#zkVib').checked = z.v;
      const x = zd?.z.find((q) => q.id === z.id);
      R.querySelector('#zkCur').innerHTML = x ? `<div class="k-ar zk-car">${esc(x.ar)}</div><b>${esc(x.tr)}</b><small>${esc(zm(x))}</small>` : '';
      R.querySelectorAll('.zk-it').forEach((d) => d.classList.toggle('on', d.id === 'zk-' + z.id));
      R.querySelector('#zkTot').textContent = z.tot ? `Toplam: ${z.tot}` : '';
      if (pop) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    };
    const tap = (e) => {
      e.preventDefault();
      const z = zk(); z.c += 1; z.tot += 1;
      const done = z.t && z.c % z.t === 0;
      if (done) z.tur = z.c / z.t;
      if (z.v) navigator.vibrate?.(done ? [120, 80, 120] : 12);
      zkSave(z); draw(z, true);
      if (done) A().toast((window.T || ((x) => x))('{0} tamamlandı').replace('{0}', z.t));
    };
    btn.addEventListener('pointerdown', tap);
    btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') tap(e); });
    btn.addEventListener('click', (e) => e.preventDefault());
    R.querySelector('#zkUndo').addEventListener('click', () => { const z = zk(); if (!z.c) return; z.c -= 1; z.tot = Math.max(0, z.tot - 1); z.tur = z.t ? Math.floor(z.c / z.t) : 0; zkSave(z); draw(z); });
    R.querySelector('#zkReset').addEventListener('click', () => { const z = zk(); if (!z.c) return; if (!confirm((window.T || ((x) => x))('Sayaç sıfırlansın mı?'))) return; z.c = 0; z.tur = 0; zkSave(z); draw(z); });
    R.querySelector('#zkVib').addEventListener('change', (e) => { const z = zk(); z.v = e.target.checked; zkSave(z); });
    R.querySelector('.zk-list')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zid]'); if (!b) return;
      const z = zk(), x = zd.z.find((q) => q.id === b.dataset.zid);
      if (z.c && !confirm((window.T || ((q) => q))('Sayaç sıfırlansın mı?'))) return;
      z.id = x ? x.id : ''; z.c = 0; z.tur = 0; if (x) z.t = x.n;
      zkSave(z); draw(z); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    R.querySelector('.zk-t').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const z = zk(); z.t = +b.dataset.t; z.tur = z.t ? Math.floor(z.c / z.t) : 0; zkSave(z); draw(z);
    });
    draw(zk());
  }

  let esQuery = '';
  async function renderEsma(focus) {
    const d = await esmaData(), fs = fontSize('e', 30);
    root().innerHTML = `<div class="k-reader k-e"><div class="k-rbar"><a class="h-back" href="#kitap" aria-label="Geri">‹</a>
        <div class="k-rtitle"><b>${esc(d.title)}</b><small>Allah'ın 99 güzel ismi</small></div>
        <button class="k-ib" type="button" data-k="fminus" aria-label="Yazıyı küçült">A−</button>
        <button class="k-ib" type="button" data-k="fplus" aria-label="Yazıyı büyüt">A+</button></div>
      <div class="k-body" id="kBody" style="--efs:${fs}px">
        <div class="card e-head"><div class="k-ar e-title">${esc(d.ar)}</div><p>${esc(d.intro)}</p><p class="kz-small">${esc(d.hadis)}</p></div>
        <input type="search" class="k-mlfilter" id="kEsF" placeholder="İsim ya da anlam ara: Rahmân, rızk, affeden…" value="${esc(esQuery)}" autocomplete="off">
        <div class="e-list" id="kEsL"></div></div></div>`;
    $('kEsF').addEventListener('input', (e) => { esQuery = e.target.value; drawEsma(); });
    drawEsma();
    if (focus) { const el = $('es-' + focus); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('q-hl'); setTimeout(() => el.classList.remove('q-hl'), 2600); } }
    saveProg('e', focus || 0, "Esmâü'l-Hüsnâ", focus ? `${focus}. ${d.n[focus - 1][2]}` : '');
  }
  function drawEsma() {
    const fq = normQ(esQuery, AR_RE.test(esQuery)), ar = AR_RE.test(esQuery);
    const list = ESMA.n.filter(([no, a, t, m]) => !fq || (ar ? normMap(a, normAr)[0].includes(fq) : normQ(`${no} ${t} ${m}`, false).includes(fq)));
    $('kEsL').innerHTML = list.length ? list.map(([no, a, t, m]) => `<article class="card e-it" id="es-${no}" data-k="esit" data-id="${no}">
      <span class="e-no">${no}</span><div class="k-ar e-ar">${esc(a)}</div><div class="e-tr"><b>${esc(t)}</b><span>${esc(m)}</span></div></article>`).join('')
      : '<p class="kz-small">Sonuç yok.</p>';
  }

  /* ---------- Dua Kitabı: seçme dualar + Kur'an duaları hemen; hadis bölümleri (büyük dosya) açılınca iner */
  let DUA = null, DUAH = null;
  const DPAGE = 40;
  const dShown = {};                 // bölüm -> gösterilen kart sayısı
  let dQuery = '';
  const KIND = { ayet: 'Âyet', hadis: 'Hadis', dua: 'Dua' };
  async function duaHadis() {
    if (DUAH) return DUAH;
    const r = await fetch('/static/books/dua-hadis.json?v=' + VER);
    if (!r.ok) throw new Error('Hadis duaları indirilemedi (internet bağlantısını kontrol edin)');
    return (DUAH = await r.json());
  }
  function dCard(it) {
    const ar = it.arx ? esc(it.arx) : it.ar.map(([a, t]) => `${esc(qa(t))} <span class="q-no">۝${arNum(a)}</span>`).join(' ');
    return `<article class="d-card d-${it.k || 'dua'}"><div class="d-head"><b>${esc(it.t)}</b><i class="d-tag">${KIND[it.k] || 'Dua'}</i></div>
      ${it.ref ? `<small class="d-ref">${esc(it.ref)}</small>` : ''}
      ${it.bsm ? `<div class="d-ar d-bsm">${esc(qa(BASMALA))}</div>` : ''}
      <div class="d-ar">${ar}</div>
      ${it.ok ? `<p class="d-ok"><span>Okunuşu</span>${esc(it.ok)}</p>` : ''}
      <p class="d-tr"><span>${it.k === 'hadis' && !it.ok ? 'Türkçesi' : 'Anlamı'}</span>${esc(it.tr)}</p>${it.note ? `<p class="d-note">${esc(it.note)}</p>` : ''}</article>`;
  }
  const trLower = (x) => String(x || '').toLocaleLowerCase('tr-TR');
  async function renderDua(sec, topic) {
    if (!DUA) { const r = await fetch('/static/books/dua.json?v=' + VER); if (!r.ok) throw new Error('Dua kitabı açılamadı (internet bağlantısını kontrol edin)'); DUA = await r.json(); }
    const nCore = DUA.sec.length, total = DUA.sec.reduce((a, x) => a + x.items.length, 0) + DUA.big.reduce((a, x) => a + x.n, 0);
    const names = [...DUA.sec.map((x) => [x.t, x.items.length]), ...DUA.big.map((x) => [x.t, x.n])];
    const fs = fontSize('d', 26), tfs = Math.max(14, Math.round(fs * 0.62));
    let h = `<div class="k-reader k-d${hatPc() ? ' hat-pc' : ''}"><div class="k-rbar"><a class="h-back" href="#kitap" aria-label="Geri">‹</a>
      <div class="k-rtitle"><b>Dua Kitabı</b><small>${fmtN(total)} dua · ${names.length} bölüm</small></div>
      <button class="k-ib k-ibt" type="button" data-k="hat">${hatPc() ? 'Mushaf' : 'Bilgisayar'}</button>
      <button class="k-ib" type="button" data-k="fminus" aria-label="Yazıyı küçült">A−</button>
      <button class="k-ib" type="button" data-k="fplus" aria-label="Yazıyı büyüt">A+</button></div>
      <nav class="d-chips"><button type="button" data-k="dtopic" data-n="-1" class="tp${topic !== undefined ? ' on' : ''}">☰ Konular</button>${names.map((x, i) => `<button type="button" data-k="dsec" data-n="${i + 1}" class="${sec === i + 1 ? 'on' : ''}${i >= nCore ? ' hd' : ''}">${esc(x[0].replace('Hadislerdeki dualar: ', 'Hadis: '))}</button>`).join('')}</nav>
      <div class="d-tools"><input type="search" id="dSearch" placeholder="Dualarda ara (ör. şifa, yağmur, borç)" value="${esc(dQuery)}" enterkeyhint="search">
        <div class="d-legend"><span class="ayet">Âyet</span><span class="hadis">Hadis</span><span class="dua">Dua</span></div></div>
      <div class="k-body d-body" id="kBody" style="--dfs:${fs}px;--dtfs:${tfs}px"><div id="dList"></div></div></div>`;
    root().innerHTML = h;
    $('dSearch').addEventListener('input', () => { clearTimeout(dSearchT); dSearchT = setTimeout(() => { dQuery = $('dSearch').value.trim(); drawDua(cur.page, dQuery.length >= 2 ? undefined : cur.topic); }, 250); });
    await drawDua(sec, topic);
  }
  let dSearchT = 0;
  async function drawDua(sec, topic) {
    const box = $('dList'); if (!box) return;
    const nCore = DUA.sec.length;
    if (topic !== undefined && dQuery.length < 2) {               // konulara göre
      if (topic < 0) {
        box.innerHTML = '<h3 class="d-sec">Konulara göre dualar</h3><div class="d-topics">' + DUA.topics.map((t, i) =>
          `<button type="button" class="d-topic" data-k="dtopic" data-n="${i}"><b>${esc(t.t)}</b><small>${fmtN(t.r.length)} dua</small></button>`).join('') + '</div>';
        return;
      }
      const t = DUA.topics[topic]; if (!t) return;
      const key = 'k' + topic, n = dShown[key] || DPAGE;
      const needH = t.r.slice(0, n).some((r) => r[0] === 'h');
      let H = null;
      if (needH) { box.innerHTML = `<h3 class="d-sec">${esc(t.t)}</h3><p class="k-wait">Yükleniyor…</p>`; try { H = await duaHadis(); } catch { /* çevrimdışı */ } }
      const items = t.r.slice(0, n).map((r) => r[0] === 'c' ? DUA.sec[r[1]].items[r[2]] : H?.sec[r[1]].items[r[2]]).filter(Boolean);
      box.innerHTML = `<button class="h-back" type="button" data-k="dtopic" data-n="-1">‹ Bütün konular</button><h3 class="d-sec">${esc(t.t)} <small>(${fmtN(t.r.length)})</small></h3>`
        + items.map(dCard).join('') + (needH && !H ? '<p class="kz-small">Hadis duaları için internet gerekiyor (bir kez iner).</p>' : '')
        + (n < t.r.length ? `<button class="btn ghost d-loadmore" type="button" data-k="dmore" data-n="${key}">Daha fazla göster (${fmtN(t.r.length - n)} kaldı)</button>` : '');
      return;
    }
    if (dQuery.length >= 2) {                         // arama: bütün bölümlerde
      const q = trLower(dQuery);
      let all = DUA.sec.flatMap((x) => x.items);
      try { all = all.concat((await duaHadis()).sec.flatMap((x) => x.items)); } catch { /* çevrimdışı: yalnız seçme dualar */ }
      const hits = all.filter((it) => trLower(it.t + ' ' + it.tr + ' ' + (it.ok || '') + ' ' + (it.ref || '')).includes(q));
      box.innerHTML = `<h3 class="d-sec">“${esc(dQuery)}” için ${fmtN(hits.length)} sonuç</h3>` + (hits.slice(0, 80).map(dCard).join('') || '<p class="k-wait">Sonuç bulunamadı.</p>')
        + (hits.length > 80 ? '<p class="kz-small">İlk 80 sonuç gösteriliyor; aramayı daraltın.</p>' : '');
      return;
    }
    if (!sec || sec <= nCore) {                       // seçme dualar ve Kur'an duaları (hepsi)
      box.innerHTML = DUA.sec.map((x, i) => `<h3 class="d-sec" id="dsec-${i + 1}">${esc(x.t)}</h3>` + x.items.map(dCard).join('')).join('')
        + `<h3 class="d-sec">Hadislerdeki dualar</h3><div class="d-more">${DUA.big.map((x, i) => `<button class="btn ghost" type="button" data-k="dsec" data-n="${nCore + i + 1}">${esc(x.t.replace('Hadislerdeki dualar: ', ''))} · ${fmtN(x.n)}</button>`).join('')}</div>`;
      if (sec) requestAnimationFrame(() => { $('dsec-' + sec)?.scrollIntoView({ block: 'start' }); document.querySelector('.d-chips button.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); });
      return;
    }
    const bi = sec - nCore - 1, meta = DUA.big[bi];
    box.innerHTML = `<h3 class="d-sec" id="dsec-${sec}">${esc(meta.t)}</h3><p class="k-wait">Yükleniyor… (ilk açılışta bir kez iner)</p>`;
    let data;
    try { data = await duaHadis(); } catch (e) { box.innerHTML = `<div class="k-wait"><p>${esc(e.message)}</p><button class="btn" type="button" data-k="retry">Tekrar dene</button></div>`; return; }
    const items = data.sec[bi].items, n = Math.min(items.length, dShown[sec] || DPAGE);
    box.innerHTML = `<h3 class="d-sec" id="dsec-${sec}">${esc(meta.t)} <small>(${fmtN(items.length)})</small></h3>` + items.slice(0, n).map(dCard).join('')
      + (n < items.length ? `<button class="btn ghost d-loadmore" type="button" data-k="dmore" data-n="${sec}">Daha fazla göster (${fmtN(items.length - n)} kaldı)</button>` : '');
    requestAnimationFrame(() => document.querySelector('.d-chips button.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  /* ---------- Hadis kitapları listesi */
  async function renderHList() {
    const hb = await hBooks();
    const bkeys = new Set(await DB.keys('books').catch(() => []));
    let h = `<div class="k-top"><a class="h-back" href="#kitap">‹ Kitaplık</a></div>
      <div class="sec-head"><h2>Hadis Kitapları</h2><span class="sec-sub">Kütüb-i Sitte</span></div>
      <p class="kz-small">Altı temel hadis kitabı. Okumak istediğinizi indirin; telefonda saklanır, internetsiz okunur.</p><div class="k-hlist">`;
    for (const b of hb?.books || []) {
      const has = bkeys.has(hKey(b.id)), hasAr = !hArMain() && bkeys.has(b.id + ':ar'), dl = downloading.get(hKey(b.id)), dlAr = downloading.get(b.id + ':ar');
      const p = prog()['h:' + b.id];
      let st;
      if (dl) st = `<span class="k-dl" data-dl="${hKey(b.id)}">${dlText(dl, hSize(b))}</span>`;
      else if (has) st = `<span class="k-ok">${TT('Telefonda ✓')}${hasAr ? ' · ' + TT('Arapça ✓') : ''}${p ? ' · ' + TT(`sayfa ${p}`) : ''}</span>`;
      else st = `<span class="k-muted">≈${fmtMB(hSize(b))} · ${fmtN(b.total)} hadis</span>`;
      h += `<div class="card k-hbook">
        <div class="k-hmain"><b>${esc(hName(b))}</b><small>${esc(hAuthor(b))}</small>${st}
          ${dlAr ? `<span class="k-dl" data-dl="${b.id}:ar">Arapça: ${dlText(dlAr, b.arSize)}</span>` : ''}</div>
        <div class="k-hbtn">${has ? `<a class="btn" href="#kitap/h/${b.id}${p ? '/' + p : ''}">${p ? 'Devam' : 'Oku'}</a>`
          : `<button class="btn" type="button" data-k="dl" data-id="${b.id}"${dl ? ' disabled' : ''}>İndir</button>`}
          <a class="btn ghost k-more" href="#kitap/h/${b.id}" aria-label="${esc(hName(b))}">⋯</a></div></div>`;
    }
    h += '</div>';
    root().innerHTML = h;
  }

  /* ---------- Hadis: kitap sayfası (bilgi + içindekiler) */
  async function renderHInfo(id) {
    const b = (await hBooks()).books.find((x) => x.id === id);
    if (!b) { location.hash = '#kitap/hadis'; return; }
    const keys = new Set(await DB.keys('books').catch(() => []));
    const has = keys.has(hKey(id)), hasAr = hArMain() || keys.has(id + ':ar'), p = prog()['h:' + id];
    let h = `<div class="k-top"><a class="h-back" href="#kitap/hadis">‹ Hadis Kitapları</a></div>
      <section class="h-hero k-hhero"><span class="k-ar">${esc(b.ar)}</span><h2>${esc(hName(b))}</h2><p class="h-desc">${esc(hAuthor(b))} · ${TT(`${fmtN(b.total)} hadis`)}</p></section>`;
    if (hCode() === 'tur' && b.trCount < b.total * 0.9) {
      h += `<p class="card kz-small">Bu kitabın Türkçe tercümesi kaynakta eksik (${fmtN(b.trCount)}/${fmtN(b.total)} hadis). Tercümesi olmayan hadisleri okumak için Arapça metni de indirin.</p>`;
    }
    if (!has) {
      h += `<div class="card"><p>Kitap telefonunuza bir kez indirilir (≈${fmtMB(hSize(b))}, internet hızına göre yarım–birkaç dakika), sonra internetsiz okunur.</p>
        <div class="k-actions"><button class="btn" type="button" data-k="dl" data-id="${id}"${downloading.has(hKey(id)) ? ' disabled' : ''}>İndir</button>
        ${hArMain() ? '' : `<button class="btn ghost" type="button" data-k="dlar" data-id="${id}"${downloading.has(id + ':ar') ? ' disabled' : ''}>Arapça metni de indir (≈${fmtMB(b.arSize)})</button>`}</div>
        <p class="k-dlstat">${downloading.has(hKey(id)) ? `<span data-dl="${hKey(id)}">${dlText(downloading.get(hKey(id)), 0)}</span>` : ''}</p></div>`;
      root().innerHTML = h; return;
    }
    const book = await hLoad(id);
    h += `<form class="k-goto" id="kGotoH"><label>Sayfaya git<input type="number" inputmode="numeric" min="1" max="${book.pages.length}" id="kGotoP" placeholder="1–${book.pages.length}"></label>
      <label>Hadis no<input type="number" inputmode="numeric" min="1" id="kGotoN" placeholder="örn. 52"></label><button class="btn" type="submit">Aç</button></form>`;
    if (p) h += `<a class="card k-cont" href="#kitap/h/${id}/${p}"><span class="k-cont-ic">▶</span><span><small>Kaldığınız yer</small><b>Sayfa ${p} / ${book.pages.length}</b></span></a>`;
    h += '<h3 class="k-sec">Bölümler</h3><div class="k-toc">';
    for (const [sec, page] of Object.entries(book.secStart).sort((x, y) => x[1] - y[1])) {     // kitaptaki sırasıyla
      const name = hSec(b, book, sec) || (sec === '0' ? (page === 1 ? 'Giriş' : 'Diğer hadisler') : `${sec}. bölüm`);
      h += `<a class="k-tc" href="#kitap/h/${id}/${page}"><span class="k-srn">${sec}</span><b>${esc(name)}</b><small>s. ${page}</small></a>`;
    }
    h += `</div><div class="k-actions k-qdl">
      ${hasAr ? '' : `<button class="btn ghost" type="button" data-k="dlar" data-id="${id}"${downloading.has(id + ':ar') ? ' disabled' : ''}>Arapça metni de indir (≈${fmtMB(b.arSize)})</button>`}
      <button class="btn ghost danger" type="button" data-k="hdel" data-id="${id}">Telefondan sil</button></div>
      <p class="k-dlstat">${downloading.has(id + ':ar') ? `<span data-dl="${id}:ar">${dlText(downloading.get(id + ':ar'), 0)}</span>` : ''}</p>`;
    root().innerHTML = h;
  }

  /* ---------- Hadis: okuma */
  async function renderHPage(id, p) {
    const b = (await hBooks()).books.find((x) => x.id === id);
    const book = b && await hLoad(id);
    if (!book) { location.hash = `#kitap/h/${id}`; return; }
    p = Math.max(1, Math.min(book.pages.length, p | 0));
    const idx = book.pages[p - 1], first = book.list[idx[0]];
    const secName = hSec(b, book, first[2]);
    const showAr = book.ar && jget('nv_kar', true);
    root().innerHTML = readerShell({ back: `#kitap/h/${id}`, title: hName(b), sub: `${secName ? secName + ' · ' : ''}sayfa ${p}`, page: p, max: book.pages.length, kind: 'h', ar: !!book.ar, arOn: showAr });
    const fs = fontSize('h', 17);
    let html = '';
    let prevSec = null;
    for (const i of idx) {
      const [num, tr, sec] = book.list[i];
      if (sec !== prevSec && (i === 0 || book.list[i - 1][2] !== sec)) html += `<h3 class="hd-sec">${esc(hSec(b, book, sec))}</h3>`;
      prevSec = sec;
      const ar = book.ar?.[num];
      html += `<article class="hd"><div class="hd-no">Hadis ${String(num).replace('.', ',')}</div>
        ${showAr && ar ? `<p class="hd-ar" dir="rtl" lang="ar">${esc(ar)}</p>` : ''}
        ${tr ? `<p class="hd-tr" dir="auto"${hArMain() ? ' lang="ar"' : ''}>${esc(tr)}</p>` : (ar && !showAr ? `<p class="hd-ar" dir="rtl" lang="ar">${esc(ar)}</p>` : (ar ? '' : '<p class="kz-small">Bu hadisin tercümesi kaynakta yok. Arapça metni indirerek okuyabilirsiniz.</p>'))}</article>`;
    }
    $('kBody').innerHTML = `<div class="hd-page" style="font-size:${fs}px">${html}</div>`;
    saveProg('h:' + id, p, `${hName(b)} · Sayfa ${p}`, secName);
  }

  /* ---------- PDF: okuma — bütün sayfalar alt alta (normal PDF okuyucu gibi), görünenler çizilir */
  let pdfDoc = null, pdfId = null, pdfScale = 1, pdfObs = null, pdfSizes = [], pdfCur = 1, pdfJob = 0;
  async function renderPdf(id, p) {
    const same = pdfId === id && pdfDoc && document.querySelector(`#kBody .pdf-doc[data-id="${CSS.escape(id)}"]`);
    if (same) { pdfScrollTo(p); return; }                     // aynı belgede sayfaya git: yeniden açmadan kaydır
    const f = await DB.get('files', id).catch(() => null);
    if (!f) { A().toast('Dosya bulunamadı'); location.hash = '#kitap'; return; }
    root().innerHTML = readerShell({ back: '#kitap', title: f.name, sub: '', page: p, max: f.pages || 9999, kind: 'f' });
    const body = $('kBody');
    try {
      if (pdfId !== id || !pdfDoc) {
        pdfScale = 1;
        body.innerHTML = '<p class="k-wait">Açılıyor…</p>';
        const lib = await loadPdfJs();
        pdfDoc = await lib.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()), isEvalSupported: false }).promise;
        pdfId = id;
        if (f.pages !== pdfDoc.numPages) { f.pages = pdfDoc.numPages; DB.put('files', id, f).catch(() => {}); }
      }
    } catch (e) {
      body.innerHTML = `<div class="k-wait"><p>PDF açılamadı${navigator.onLine ? '' : ' (PDF okuyucu ilk kullanımda internetten bir kez yüklenir)'}.</p></div>`;
      return;
    }
    const n = pdfDoc.numPages;
    p = Math.max(1, Math.min(n, p | 0));
    $('kPageIn').max = n; $('kPageMax').textContent = `/ ${n}`;
    // sayfa boyutları: ilk sayfanınki hepsine varsayılır, çizildikçe gerçeğiyle düzeltilir
    const vp1 = (await pdfDoc.getPage(1)).getViewport({ scale: 1 });
    pdfSizes = Array.from({ length: n }, () => [vp1.width, vp1.height]);
    body.innerHTML = `<div class="pdf-doc" data-id="${esc(id)}">${pdfSizes.map((_, i) => `<div class="pdf-pg" data-p="${i + 1}"><span>${i + 1}</span></div>`).join('')}</div>`;
    pdfLayout();
    if (pdfObs) pdfObs.disconnect();
    pdfObs = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) pdfDraw(+e.target.dataset.p); }, { rootMargin: '1200px 0px' });
    body.querySelectorAll('.pdf-pg').forEach((el) => pdfObs.observe(el));
    pdfCur = p; pdfScrollTo(p, true);
    pdfShowPage(p, f.name);
  }
  /** Yer tutucuların boyutu: genişlik = ekran × yakınlaştırma */
  function pdfLayout() {
    const body = $('kBody'); if (!body) return;
    const w = Math.max(200, (body.clientWidth || 360)) * pdfScale;
    body.classList.toggle('zoomed', pdfScale > 1);
    body.querySelectorAll('.pdf-pg').forEach((el) => {
      const [pw, ph] = pdfSizes[+el.dataset.p - 1];
      el.style.width = Math.floor(w) + 'px'; el.style.height = Math.floor(w * ph / pw) + 'px';
    });
  }
  async function pdfDraw(pn, force) {
    const el = document.querySelector(`.pdf-pg[data-p="${pn}"]`); if (!el || !pdfDoc) return;
    const job = pdfJob;
    if (!force && el.dataset.s === String(pdfScale)) return;    // bu boyutta zaten çizili
    el.dataset.s = String(pdfScale);
    const page = await pdfDoc.getPage(pn);
    const vp0 = page.getViewport({ scale: 1 });
    if (pdfSizes[pn - 1][1] / pdfSizes[pn - 1][0] !== vp0.height / vp0.width) { pdfSizes[pn - 1] = [vp0.width, vp0.height]; pdfLayout(); }
    const w = parseFloat(el.style.width), scale = w / vp0.width;
    let dpr = Math.min(3, window.devicePixelRatio || 1);
    while (dpr > 1 && vp0.width * vp0.height * (scale * dpr) ** 2 > 8e6) dpr -= 0.25;   // telefon tuval sınırı
    const vp = page.getViewport({ scale: scale * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); c.className = 'k-pdf';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (job !== pdfJob || el.dataset.s !== String(pdfScale)) return;
    el.querySelector('canvas')?.remove(); el.appendChild(c);
    // bellek: uzaktaki sayfaların çizimini bırak
    const all = [...document.querySelectorAll('.pdf-pg canvas')];
    if (all.length > 10) for (const x of all) { const pg = x.parentElement; if (pg && Math.abs(+pg.dataset.p - pdfCur) > 5) { x.remove(); delete pg.dataset.s; } }
  }
  function pdfScrollTo(p, instant) {
    const el = document.querySelector(`.pdf-pg[data-p="${p}"]`); if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
    pdfCur = p; pdfShowPage(p);
  }
  function pdfShowPage(p, name) {
    cur.page = p;
    if ($('kPageCur')) $('kPageCur').textContent = p;
    if ($('kPageIn')) $('kPageIn').value = p;
    if ($('kSub') && pdfDoc) $('kSub').textContent = `sayfa ${p} / ${pdfDoc.numPages}`;
    const t = document.querySelector('.k-rtitle b')?.textContent || name || '';
    saveProg('f:' + pdfId, p, `${t} · Sayfa ${p}`, '');
  }
  // kaydırdıkça hangi sayfadayız
  let pdfScrollT = 0;
  window.addEventListener('scroll', () => {
    if (cur.kind !== 'f' || !pdfDoc) return;
    clearTimeout(pdfScrollT);
    pdfScrollT = setTimeout(() => {
      const mid = window.innerHeight / 2;
      for (const el of document.querySelectorAll('.pdf-pg')) {
        const r = el.getBoundingClientRect();
        if (r.top <= mid && r.bottom >= mid) { const p = +el.dataset.p; if (p !== pdfCur) { pdfCur = p; pdfShowPage(p); history.replaceState(null, '', location.hash.replace(/\/\d+$/, '') + '/' + p); } break; }
      }
    }, 120);
  }, { passive: true });
  /** Yakınlaştır: odak noktası (parmakların ortası / ekran ortası) yerinde kalsın */
  function pdfZoom(ns, focus) {
    const body = $('kBody'), doc = body?.querySelector('.pdf-doc'); if (!doc) return;
    const br = body.getBoundingClientRect(), dr = doc.getBoundingClientRect();
    const ox = focus ? focus.x - br.left : body.clientWidth / 2, oy = focus ? focus.y : window.innerHeight / 2;
    const fx = (focus ? focus.x : br.left + ox) - dr.left, fy = oy - dr.top;     // belge içindeki nokta
    const k = ns / pdfScale;
    pdfScale = ns; pdfJob++;
    pdfLayout();
    body.scrollLeft = Math.max(0, fx * k - ox);
    const top = doc.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top + fy * k - oy));
    document.querySelectorAll('.pdf-pg').forEach((el) => { const r = el.getBoundingClientRect(); if (r.bottom > -800 && r.top < window.innerHeight + 800) pdfDraw(+el.dataset.p, true); else { el.querySelector('canvas')?.remove(); delete el.dataset.s; } });
  }

  /* ---------- okuyucu iskeleti (üst çubuk + gövde + alt gezinme) */
  const hatPc = () => jget('nv_khat', 'pc') !== 'mushaf';     // varsayılan: bilgisayar hattı (daha kolay okunur)
  function readerShell({ back, title, sub, page, max, kind, rtl, ar, arOn }) {
    return `<div class="k-reader k-${kind}${hatPc() ? ' hat-pc' : ''}">
      <div class="k-rbar"><a class="h-back" href="${back}" aria-label="Geri">‹</a>
        <div class="k-rtitle"><b>${esc(title)}</b><small id="kSub">${esc(sub)}</small></div>
        ${ar ? `<button class="k-ib${arOn ? ' on' : ''}" type="button" data-k="artoggle" aria-pressed="${!!arOn}" title="Arapça metin">ع</button>` : ''}
        ${kind === 'q' ? `<button class="k-ib k-ibt" type="button" data-k="hat" title="Yazı hattı">${hatPc() ? 'Mushaf' : 'Bilgisayar'}</button>` : ''}
        ${kind === 'q' ? `<button class="k-ib k-ibt${mealOn() ? ' on' : ''}" type="button" data-k="mealtoggle" aria-pressed="${mealOn()}">Meal</button>
          ${mealOn() && tefAllowed() ? `<button class="k-ib k-ibt${tefOn() ? ' on' : ''}" type="button" data-k="teftoggle" aria-pressed="${tefOn()}">Tefsir</button>` : ''}` : ''}
        <button class="k-ib" type="button" data-k="fminus" aria-label="Yazıyı küçült">A−</button>
        <button class="k-ib" type="button" data-k="fplus" aria-label="Yazıyı büyüt">A+</button></div>
      <div class="k-body${rtl ? ' rtl' : ''}" id="kBody"></div>
      <div class="k-nav">
        <button class="btn ghost" type="button" data-k="${rtl ? 'next' : 'prev'}">${rtl ? '‹ Sonraki' : '‹ Önceki'}</button>
        <button class="k-pgbtn" type="button" data-k="goto" aria-expanded="false" aria-controls="kGo"><b id="kPageCur">${page}</b><span id="kPageMax">/ ${max === 9999 ? '…' : max}</span> <i>▾</i></button>
        <div class="k-gopanel card" id="kGo" hidden>
          <form class="k-goform" id="kPgForm"><label>Sayfaya git<input type="number" inputmode="numeric" enterkeyhint="go" id="kPageIn" min="1" max="${max}" value="${page}" aria-label="Sayfa numarası"></label>
            <button class="btn" type="submit">Git</button></form>
          ${kind === 'q' ? `<div class="k-gosel"><label>Sure<select id="kGoSure"><option value="">Seçin…</option>${(QM?.s || []).map((x, i) => `<option value="${i + 1}">${i + 1}. ${esc(x[1])}</option>`).join('')}</select></label>
            <label>Cüz<select id="kGoJuz"><option value="">Seçin…</option>${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}. cüz</option>`).join('')}</select></label></div>
            <a class="btn ghost k-gosearch" href="#kitap/ara">🔍 Kur'an'da kelime ara</a>` : ''}
        </div>
        <button class="btn ghost" type="button" data-k="${rtl ? 'prev' : 'next'}">${rtl ? 'Önceki ›' : 'Sonraki ›'}</button>
      </div></div>`;
  }

  /* ------------------------------------------------------------ Kur'an sesleri (ayet ayet)
   * Kaynak: Al Quran Cloud CDN, sunucu üzerinden akış (/ses/…; sunucuda saklanmaz). Okuyan: Mişârî Râşid el-Afâsî.
   * Ayarlar (kalite, hız) yalnız bu telefonda tutulur. İndirilen sesler tarayıcının Cache deposunda ('nv-ses'). */
  const SES_ED = 'ar.alafasy', SES_NAME = 'Mişârî Râşid el-Afâsî', SES_CACHE = 'nv-ses2';
  try { caches.delete('nv-ses'); } catch { /* yok */ }       // önceki sürümün (bozuk inmiş olabilecek) sesleri
  const RATES = [0.75, 1, 1.25, 1.5];
  const sesCfg = () => ({ br: 64, rate: 1, ...jget('nv_ses', {}) });
  const sesSet = (o) => jset('nv_ses', { ...sesCfg(), ...o });
  const sesUrl = (n, br = sesCfg().br) => `/ses/${br}/${SES_ED}/${n}.mp3`;            // sunucu üzerinden (yedek yol) + depo anahtarı
  const cdnUrl = (n, br = sesCfg().br) => `https://cdn.islamic.network/quran/audio/${br}/${SES_ED}/${n}.mp3`;   // doğrudan kaynak
  let corsOK = null;                                   // kaynak doğrudan indirmeye izin veriyor mu (ilk denemede öğrenilir)
  let CUM = null;
  function gnum(s, a) {                               // Kur'an genelindeki ayet sırası (1–6236)
    if (!CUM) { CUM = [0]; for (const x of QM.s) CUM.push(CUM[CUM.length - 1] + x[2]); }
    return CUM[s - 1] + a;
  }
  function nextPos(s, a) { return a < QM.s[s - 1][2] ? [s, a + 1] : s < 114 ? [s + 1, 1] : null; }
  function prevPos(s, a) { return a > 1 ? [s, a - 1] : s > 1 ? [s - 1, QM.s[s - 2][2]] : null; }
  const needBasmala = (s, a) => a === 1 && s !== 1 && s !== 9;   // sure başında besmele (Fâtiha'da ayettir, Tevbe'de okunmaz)
  async function sesCache() { return 'caches' in window ? caches.open(SES_CACHE) : null; }
  async function sesHit(n) {
    const c = await sesCache(); if (!c) return null;
    const br = sesCfg().br;
    return (await c.match(sesUrl(n, br))) || (await c.match(sesUrl(n, br === 64 ? 128 : 64)));
  }

  const P = { s: 0, a: 0, bas: false, playing: false, tok: 0, blobs: new Map(), pf: new Set(), dl: null };
  let audio = null;
  function aud() {
    if (audio) return audio;
    audio = document.createElement('audio'); audio.preload = 'auto';
    audio.setAttribute('playsinline', ''); audio.setAttribute('webkit-playsinline', ''); audio.hidden = true;
    document.body.appendChild(audio);
    const real = () => audio.src && audio.src !== SILENT;
    audio.addEventListener('ended', () => { if (real()) sesEnded(); });
    audio.addEventListener('play', () => { if (real()) { P.playing = true; sesBar(); } });
    audio.addEventListener('pause', () => { if (real()) { P.playing = false; sesBar(); } });
    audio.addEventListener('error', () => {
      if (!P.s || !real()) return;
      P.playing = false; sesBar();
      const c = audio.error?.code;
      A().toast(c === 4 ? 'Ses dosyası çalınamadı (biçim). Lütfen bildirin: kod 4' : c === 2 ? 'Ses inerken bağlantı koptu' : `Ses çalınamadı (kod ${c || '?'})`);
    });
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const on = (k, f) => { try { ms.setActionHandler(k, f); } catch { /* desteklenmiyor */ } };
      on('play', () => aud().play()); on('pause', () => aud().pause());
      on('previoustrack', () => sesStep(-1)); on('nexttrack', () => sesStep(1)); on('stop', sesStop);
    }
    return audio;
  }
  /* iPhone: ses yalnız dokunuşla başlatılabilir. İlk dokunuşta aynı oynatıcıyı sessiz kısa bir sesle "açarız";
     sonra ayetler (indirme bitince, ekran kapalıyken bile) aynı oynatıcıdan çalar. */
  let SILENT = null, unlocked = false;
  function sesUnlock() {
    const el = aud();
    if (unlocked) return;
    if (!SILENT) {
      const n = 400, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
      const w = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
      SILENT = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    }
    unlocked = true;
    el.src = SILENT;
    const pr = el.play(); if (pr) pr.catch(() => { unlocked = false; });
  }
  /** Ayet sesini al: telefonda varsa oradan; yoksa indirip telefona da kaydet (aynı dosya iki kez inmesin) */
  /** Gelen dosya gerçekten ses mi (MP3: "ID3" ya da çerçeve başı; geliştirmede WAV)? Bozuksa saklanmaz. */
  async function isAudio(blob) {
    const h = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) || (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0) || (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46);
  }
  async function sesFetch(n) {                         // indir, doğrula, telefona kaydet → Blob
    let blob = null, why = '';
    if (corsOK !== false) {                            // önce doğrudan kaynaktan (sunucuyu yormadan)
      try {
        const r = await fetch(cdnUrl(n), { mode: 'cors' });
        if (r.ok) { const b = await r.blob(); if (await isAudio(b)) { blob = b; corsOK = true; } }
      } catch { if (corsOK === null) corsOK = false; }
    }
    if (!blob) {                                       // olmazsa kendi sunucumuz üzerinden
      const net = await fetch(sesUrl(n));
      if (!net.ok) why = `Ses alınamadı (${net.status})`;
      else { const b = await net.blob(); if (await isAudio(b)) blob = b; else why = 'Ses dosyası bozuk geldi'; }
    }
    if (!blob) throw new Error(why || 'Ses alınamadı');
    try { const c = await sesCache(); if (c) await c.put(sesUrl(n), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size) } })); } catch { /* yer yok */ }
    return blob;
  }
  async function sesGet(n) {
    if (P.blobs.has(n)) return P.blobs.get(n);
    const hit = await sesHit(n);
    const blob = hit ? await hit.blob() : navigator.onLine ? await sesFetch(n) : null;
    if (!blob) return null;
    const u = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'audio/mpeg' })); P.blobs.set(n, u); return u;
  }
  /** Sıradaki ayeti belleğe al: arka planda (ekran kapalıyken) geçiş beklemeden olsun */
  function sesPrefetch(n) {
    if (!n || P.blobs.has(n) || P.pf.has(n)) return;
    P.pf.add(n);
    sesGet(n).catch(() => {}).finally(() => P.pf.delete(n));
  }
  function sesTrim(keep) {
    for (const [n, u] of P.blobs) if (!keep.includes(n)) { URL.revokeObjectURL(u); P.blobs.delete(n); }
  }
  async function sesPlay(s, a, bas) {
    sesUnlock();                                       // dokunuşun içinde, ilk beklemeden önce
    await qMeta();
    P.s = s; P.a = a; P.bas = bas ?? needBasmala(s, a);
    const n = P.bas ? 1 : gnum(s, a), tok = ++P.tok;
    P.playing = true; sesBar(); sesMark();
    let src = P.blobs.get(n);                          // hazırsa beklemeden (arka planda da çalsın)
    if (!src) {
      const hit = await sesHit(n).catch(() => null);
      if (tok !== P.tok) return;
      if (hit) { src = URL.createObjectURL(await hit.blob()); P.blobs.set(n, src); }
      else if (navigator.onLine) src = cdnUrl(n);       // telefonda yoksa kaynaktan doğrudan çal (indirme arkada sürer)
      if (!src) { P.playing = false; sesBar(); A().toast('Bu ayetin sesi telefonda yok. İnternete bağlanın ya da “⋯ › İndir” ile önceden indirin.'); return; }
    }
    if (tok !== P.tok) return;
    const el = aud(), rate = sesCfg().rate;
    el.src = src; el.defaultPlaybackRate = rate; el.playbackRate = rate;
    el.play().catch((e) => {
      if (e.name === 'AbortError') return;
      P.playing = false; sesBar();
      if (e.name === 'NotAllowedError') A().toast('Dinlemek için ▶ düğmesine dokunun');
      else A().toast('Ses çalınamadı');
    });
    sesAutoPage(pageOf(s, a));
    const nx = P.bas ? gnum(s, a) : (() => { const q = nextPos(s, a); return q ? (needBasmala(q[0], q[1]) ? 1 : gnum(q[0], q[1])) : 0; })();
    sesTrim([n, nx, gnum(s, a)]); sesPrefetch(nx); if (!P.bas) { const q = nextPos(s, a); if (q) sesPrefetch(gnum(q[0], q[1])); }
    sesMeta(); sesBar(); sesFollow();
  }
  function sesEnded() {
    if (P.bas) { sesPlay(P.s, P.a, false); return; }
    const q = nextPos(P.s, P.a);
    if (!q) { sesStop(); return; }
    sesPlay(q[0], q[1]);
  }
  function sesStep(d) {
    if (!P.s) return;
    const q = d > 0 ? nextPos(P.s, P.a) : prevPos(P.s, P.a);
    if (q) sesPlay(q[0], q[1]);
  }
  function sesToggle() {
    if (!P.s) return;
    const el = aud();
    if (el.paused) { if (!el.src || el.src === SILENT) sesPlay(P.s, P.a); else el.play().catch(() => {}); } else el.pause();
  }
  function sesStop() {
    P.tok++; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    P.s = 0; P.playing = false; sesTrim([]); sesMark(); sesBar();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  const sesTitle = () => (P.s ? `${sName(P.s)} ${P.a}` : '');
  function sesMeta() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: P.bas ? `${sName(P.s)} · ${TT('Besmele')}` : `${sLabel(sName(P.s))}, ${P.a}`,
      artist: SES_NAME, album: "Kur'an-ı Kerîm", artwork: [{ src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
  }
  /** Okunan ayeti vurgula; sayfa değiştiyse okuyucu da o sayfaya geçsin */
  function sesMark() {
    document.querySelectorAll('.q-play').forEach((x) => x.classList.remove('q-play'));
    if (!P.s) return;
    const el = $(`ay-${P.s}-${P.a}`); if (!el) return;
    el.classList.add('q-play');
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 190) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function sesFollow() {
    if (cur.kind === 'q' && location.hash.startsWith('#kitap/kuran/')) {
      const p = pageOf(P.s, P.a);
      if (p !== cur.page) { goPage(p); return; }
    }
    sesMark();
  }

  /* --- çalar çubuğu (sade): ✕  ⏮  ⏯  ⏭  Sure ayet  ⋯ */
  const IC = {
    play: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M6 5h2v14H6zm3.5 7 9.5 6.5v-13z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M16 5h2v14h-2zM5 5.5v13l9.5-6.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>',
    spk: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  };
  function sesEl() {
    let bar = $('sesBar');
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'sesBar'; bar.className = 'ses-bar'; bar.hidden = true;
    bar.innerHTML = `<div class="ses-sheet" id="sesSheet" hidden></div>
      <div class="ses-row">
        <button type="button" class="ses-b ses-x" data-s="close" aria-label="Kapat">${IC.close}</button>
        <button type="button" class="ses-b" data-s="prev" aria-label="Önceki ayet">${IC.prev}</button>
        <button type="button" class="ses-b ses-pp" data-s="toggle" aria-label="Oynat / duraklat"></button>
        <button type="button" class="ses-b" data-s="next" aria-label="Sonraki ayet">${IC.next}</button>
        <button type="button" class="ses-t" data-s="goto"><b id="sesT"></b><small id="sesSub"></small></button>
        <button type="button" class="ses-b ses-more" data-s="more" aria-label="Hız, kalite, indirme">⋯</button>
      </div>`;
    document.body.appendChild(bar);
    const fab = document.createElement('button');
    fab.id = 'sesFab'; fab.type = 'button'; fab.className = 'ses-fab'; fab.hidden = true; fab.setAttribute('aria-label', 'Bu sayfayı dinle');
    fab.innerHTML = IC.spk; document.body.appendChild(fab);
    fab.addEventListener('click', async () => {
      sesUnlock();
      await qMeta(); const p = cur.page || 1; const st = QM.p[p - 1];
      sesPlay(st[0], st[1]);
    });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const k = b.dataset.s;
      if (k === 'toggle') sesToggle();
      else if (k === 'prev') sesStep(-1);
      else if (k === 'next') sesStep(1);
      else if (k === 'close') { $('sesSheet').hidden = true; sesStop(); }
      else if (k === 'more') { const sh = $('sesSheet'); sh.hidden = !sh.hidden; if (!sh.hidden) sesSheet(); }
      else if (k === 'goto') { if (P.s) location.hash = `#kitap/kuran/${pageOf(P.s, P.a)}`; }
      else if (k === 'rate') { sesSet({ rate: +b.dataset.v }); if (audio) { audio.defaultPlaybackRate = audio.playbackRate = +b.dataset.v; } sesSheet(); sesBar(); }
      else if (k === 'br') { sesSet({ br: +b.dataset.v }); sesSheet(); A().toast(`${b.dataset.v} kbps: sonraki ayetten itibaren`); }
      else if (k === 'dl') sesDownload(b.dataset.v);
      else if (k === 'dlstop') { if (P.dl) P.dl.stop = true; }
    });
    return bar;
  }
  function sesBar() {
    const bar = sesEl(), on = !!P.s;
    bar.hidden = !on; document.body.classList.toggle('ses-on', on);
    sesFab();
    if (!on) { $('sesSheet').hidden = true; return; }
    bar.querySelector('.ses-pp').innerHTML = P.playing ? IC.pause : IC.play;
    $('sesT').textContent = P.bas ? `${sName(P.s)} · ${TT('Besmele')}` : sesTitle();
    const c = sesCfg();
    $('sesSub').textContent = P.dl ? `İndiriliyor ${P.dl.done}/${P.dl.total}` : `Afâsî · ${c.rate}× · ${c.br} kbps`;
  }
  function sesFab() {
    const show = !P.s && location.hash.startsWith('#kitap/kuran/');
    if (!$('sesFab')) { if (!show) return; sesEl(); }
    $('sesFab').hidden = !show;
  }
  window.addEventListener('hashchange', () => { sesFab(); const sh = $('sesSheet'); if (sh) sh.hidden = true; });
  document.addEventListener('click', (e) => {                // dışarı dokununca ayar paneli kapansın
    const sh = $('sesSheet'); if (sh && !sh.hidden && !e.target.closest('#sesBar')) { sh.hidden = true; e.preventDefault(); e.stopPropagation(); }
  }, true);
  async function sesSheet() {
    const sh = $('sesSheet'); if (!sh || sh.hidden) return;
    const c = sesCfg(), s = P.s || 1, a = P.a || 1, p = pageOf(s, a), j = juzOf(s, a);
    const n = await sesCount();
    sh.innerHTML = `<div class="ses-g"><span>Hız</span>${RATES.map((r) => `<button type="button" class="ses-c${r === c.rate ? ' on' : ''}" data-s="rate" data-v="${r}">${r}×</button>`).join('')}</div>
      <div class="ses-g"><span>Kalite</span>${[64, 128].map((b) => `<button type="button" class="ses-c${b === c.br ? ' on' : ''}" data-s="br" data-v="${b}">${b} kbps</button>`).join('')}</div>
      <div class="ses-g"><span>İndir</span>
        ${P.dl ? `<button type="button" class="ses-c" data-s="dlstop">Durdur (${P.dl.done}/${P.dl.total})</button>`
          : `<button type="button" class="ses-c" data-s="dl" data-v="p">${p}. sayfa</button>
             <button type="button" class="ses-c" data-s="dl" data-v="s">${esc(sLabel(sName(s)))}</button>
             <button type="button" class="ses-c" data-s="dl" data-v="j">${j}. cüz</button>`}</div>
      <p class="ses-note">Telefonda ${fmtN(n)} ayet sesi · Okuyan: ${SES_NAME} · İndirilenler internetsiz çalar; silmek için Kitaplık › Veri yönetimi.</p>`;
  }
  async function sesCount() { try { const c = await sesCache(); return c ? (await c.keys()).length : 0; } catch { return 0; } }
  /** Sayfa / sure / cüz seslerini telefona indir (aynı anda 3 dosya, sunucuyu yormadan) */
  function sesRange(kind, page) {
    const s = P.s || 1, a = P.a || 1;
    let from, to;
    if (kind === 'p') { const p = page || pageOf(s, a); from = gnum(...QM.p[p - 1]); to = p < 604 ? gnum(...QM.p[p]) - 1 : 6236; }
    else if (kind === 's') { from = gnum(s, 1); to = gnum(s, QM.s[s - 1][2]); }
    else { const j = juzOf(s, a); from = gnum(...QM.js[j - 1]); to = j < 30 ? gnum(...QM.js[j]) - 1 : 6236; }
    const ns = []; for (let n = from; n <= to; n++) ns.push(n);
    if (!ns.includes(1) && QM.s.some((x, i) => i + 1 !== 9 && i > 0 && gnum(i + 1, 1) >= from && gnum(i + 1, 1) <= to)) ns.unshift(1);   // besmele
    return ns;
  }
  async function sesDownload(kind) {
    if (P.dl) return;
    if (!navigator.onLine) { A().toast('İnternet bağlantısı yok'); return; }
    const c = await sesCache(); if (!c) { A().toast('Bu tarayıcı indirmeyi desteklemiyor'); return; }
    askPersist();
    const ns = sesRange(kind), have = new Set((await c.keys()).map((r) => new URL(r.url).pathname));
    const todo = ns.filter((n) => !have.has(sesUrl(n)));
    P.dl = { done: ns.length - todo.length, total: ns.length, stop: false };
    sesBar(); sesSheet();
    let i = 0, err = 0;
    const worker = async () => {
      while (i < todo.length && !P.dl.stop) {
        const n = todo[i++];
        for (let t = 0; t < 3; t++) {
          try {
            await sesFetch(n); break;
          } catch { if (t === 2) err++; await new Promise((ok) => setTimeout(ok, 800)); }
        }
        P.dl.done++; sesBar(); if (P.dl.done % 5 === 0) sesSheet();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const stopped = P.dl.stop; P.dl = null; sesBar(); sesSheet();
    A().toast(stopped ? 'İndirme durduruldu' : err ? `${err} ayet indirilemedi; tekrar deneyin` : 'İndirildi: internetsiz dinleyebilirsiniz');
  }
  /** Ses açıkken okunan / açılan sayfanın sesleri arka planda sessizce telefona iner */
  const autoDone = new Set(), autoQ = []; let autoBusy = false;
  function sesAutoPage(p) {
    if (!p || !P.s || autoDone.has(p) || !navigator.onLine || !('caches' in window)) return;
    autoDone.add(p); autoQ.push(p);
    if (!autoBusy) sesAutoRun();
  }
  async function sesAutoRun() {
    autoBusy = true;
    try {
      const c = await sesCache();
      while (autoQ.length && c) {
        const p = autoQ.shift();
        for (const n of sesRange('p', p)) {
          if (!navigator.onLine) break;
          if (P.blobs.has(n) || await c.match(sesUrl(n))) continue;
          try { await sesFetch(n); } catch { autoDone.delete(p); break; }
        }
      }
    } finally { autoBusy = false; }
  }
  /** Mushafta ayete dokununca o ayetten itibaren oku */
  function sesTap(e) {
    if (e.target.closest('a,button,select,input,.qm-tef,.qm-tr,.qm-fn')) return false;
    const el = e.target.closest('.q-ay, .qm-ar'); if (!el) return false;
    const box = el.classList.contains('q-ay') ? el : el.closest('.qm');
    const m = /^ay-(\d+)-(\d+)$/.exec(box?.id || ''); if (!m) return false;
    sesPlay(+m[1], +m[2]); return true;
  }
  async function sesClear() { try { await caches.delete(SES_CACHE); } catch { /* yok */ } P.blobs.forEach((u) => URL.revokeObjectURL(u)); P.blobs.clear(); autoDone.clear(); }

  /* ------------------------------------------------------------ veri yönetimi (kitaplığın altında) */
  async function dmStats() {
    const qk = await DB.keys('quran').catch(() => []), bk = new Set(await DB.keys('books').catch(() => []));
    const fk = await DB.keys('files').catch(() => []);
    const hb = await hBooks().catch(() => null);
    const text = qk.filter((k) => typeof k === 'number').length;
    const meal = qk.filter((k) => typeof k === 'string' && /^(m|t|e):/.test(k)).length;
    let ses = 0, sesB = 0;
    try {
      const c = await sesCache();
      if (c) { const ks = await c.keys(); ses = ks.length; for (const r of ks.slice(0, 7000)) { const x = await c.match(r); sesB += +(x?.headers.get('content-length') || 0); } }
    } catch { /* yok */ }
    const hads = (hb?.books || []).filter((b) => H_ALLKEYS(b.id).some((k) => bk.has(k)));
    const hadB = hads.reduce((t, b) => t + (bk.has(b.id) ? b.trSize || 0 : 0) + (bk.has(b.id + ':ar') ? b.arSize || 0 : 0)
      + Object.entries(b.sz || {}).reduce((u, [c, n]) => u + (bk.has(`${b.id}:${c}`) ? n : 0), 0), 0);
    let pdfB = 0; for (const k of fk) { const f = await DB.get('files', k).catch(() => null); pdfB += f?.size || f?.data?.size || 0; }
    const textB = text * 47e3, mealB = meal * 32e3;
    let usage = 0; try { usage = (await navigator.storage?.estimate?.())?.usage || 0; } catch { /* yok */ }
    return { text, textB, meal, mealB, ses, sesB, hads, hadB, pdf: fk.length, pdfB, usage, total: textB + mealB + sesB + hadB + pdfB };
  }
  async function dmDraw() {
    const box = $('kDmBody'); if (!box) return;
    const st = await dmStats();
    const row = (t, d, k, n) => `<div class="k-dmr"><span><b>${t}</b><small>${d}</small></span>${n ? `<button class="btn ghost danger" type="button" data-k="${k}">Sil</button>` : ''}</div>`;
    const mb = (b) => (b ? ' · ' + fmtMB(b) : '');
    box.innerHTML = `${row("Kur'an metni", `${st.text}/30 cüz${mb(st.textB)} · okudukça yeniden iner`, 'dm-text', st.text)}
      ${row('Mealler ve tefsir', `${st.meal} cüz dosyası${mb(st.mealB)}`, 'dm-meal', st.meal)}
      ${row("Kur'an sesleri", `${fmtN(st.ses)} ayet${mb(st.sesB)}`, 'dm-ses', st.ses)}
      ${row('Hadis kitapları', st.hads.length ? esc(st.hads.map(hName).join(', ')) + mb(st.hadB) : 'indirilen yok', 'dm-hadis', st.hads.length)}
      ${row("PDF'ler", st.pdf ? `${st.pdf} dosya${mb(st.pdfB)}` : 'eklenen yok', 'dm-pdf', st.pdf)}
      <p class="kz-small">Kitaplar toplamı: ${fmtMB(st.total)}. Uygulamanın kendi dosyaları (internetsiz açılması için, ≈10 MB) bu hesaba dahil değil;
        silinen veri telefonun genel depo göstergesine birkaç dakika sonra yansıyabilir. Okuma yerleriniz, kaza sayılarınız ve ayarlarınız silinmez.</p>`;
  }
  async function dmDelete(k) {
    const T = { 'dm-text': "Kur'an metni", 'dm-meal': 'Mealler ve tefsir', 'dm-ses': "Kur'an sesleri", 'dm-hadis': 'Hadis kitapları', 'dm-pdf': "Eklediğiniz PDF'lerin tümü" };
    const ok = await A().ask({ title: `${T[k]} silinsin mi?`, text: 'Telefondaki kopyalar silinir; gerektiğinde yeniden indirilir. Okuma yerleriniz korunur.',
      buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Sil', value: 'ok', cls: 'danger' }] });
    if (ok !== 'ok') return;
    if (k === 'dm-ses') await sesClear();
    else if (k === 'dm-pdf') { for (const key of await DB.keys('files').catch(() => [])) await DB.del('files', key).catch(() => {}); pdfId = null; pdfDoc = null; }
    else if (k === 'dm-hadis') {
      const hb = await hBooks().catch(() => null);
      for (const b of hb?.books || []) { for (const k of H_ALLKEYS(b.id)) await DB.del('books', k).catch(() => {}); }
      hMem.clear();
    } else {
      for (const key of await DB.keys('quran').catch(() => [])) {
        if (k === 'dm-text' ? typeof key === 'number' : (typeof key === 'string' && /^(m|t|e):/.test(key))) { await DB.del('quran', key).catch(() => {}); qMem.delete(key); }
      }
      if (k === 'dm-text') qMem.clear();
    }
    A().toast('Silindi'); if (k === 'dm-pdf') render(); else { dmDraw(); dmStats().then((st) => { const el = $('kStore'); if (el) el.textContent = st.total ? `Telefonda ${fmtMB(st.total)}` : 'Telefonda kitap yok'; }); }
  }

  /* ------------------------------------------------------------ yönlendirme */
  let cur = { kind: 'lib' };
  function parse() {
    const parts = location.hash.replace(/^#kitap\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return { kind: 'lib' };
    if (parts[0] === 'dua') return /^k\d*$/.test(parts[1] || '') ? { kind: 'd', page: 0, topic: parts[1].length > 1 ? +parts[1].slice(1) : -1 } : { kind: 'd', page: +parts[1] || 0 };
    if (parts[0] === 'kuran') return parts[1] ? { kind: 'q', page: +parts[1] || 1 } : { kind: 'qi' };
    if (parts[0] === 'ara') { let q = ''; try { q = decodeURIComponent(parts.slice(1).join('/')); } catch { /* bozuk */ } return { kind: 'qs', q }; }
    if (parts[0] === 'meal') return { kind: 'ml' };
    if ((parts[0] === 'hadis' || parts[0] === 'h') && !hCode()) return { kind: 'lib' };     // bu dilde hadis kitabı yok
    if (parts[0] === 'hadis') return { kind: 'hl' };
    if (parts[0] === 'esma') return { kind: 'es', page: +parts[1] || 0 };
    if (parts[0] === 'zikir') { history.replaceState(null, '', '#kaza/zikir'); dispatchEvent(new HashChangeEvent('hashchange')); return { kind: 'lib' }; }
    if (parts[0] === 'h' && parts[1]) return parts[2] ? { kind: 'h', id: parts[1], page: +parts[2] || 1 } : { kind: 'hi', id: parts[1] };
    if (parts[0] === 'f' && parts[1]) return { kind: 'f', id: parts[1], page: +parts[2] || 1 };
    return { kind: 'lib' };
  }
  async function render() {
    cur = parse();
    try {
      if (cur.kind === 'lib') await renderLib();
      else if (cur.kind === 'qi') await renderQIndex();
      else if (cur.kind === 'd') await renderDua(cur.page, cur.topic);
      else if (cur.kind === 'q') await renderQPage(cur.page);
      else if (cur.kind === 'qs') await renderSearch(cur.q);
      else if (cur.kind === 'ml') await renderMealLib();
      else if (cur.kind === 'hl') await renderHList();
      else if (cur.kind === 'es') await renderEsma(cur.page);
      else if (cur.kind === 'hi') await renderHInfo(cur.id);
      else if (cur.kind === 'h') await renderHPage(cur.id, cur.page);
      else if (cur.kind === 'f') await renderPdf(cur.id, cur.page);
      sesFab();
    } catch (e) {
      root().innerHTML = `<div class="k-top"><a class="h-back" href="#kitap">‹ Kitaplık</a></div><div class="card"><p>${esc(e.message || 'Bir hata oluştu')}</p>
        <button class="btn" type="button" data-k="retry">Tekrar dene</button></div>`;
    }
  }
  /** Sayfa değiştir: geçmişe her sayfayı eklemeden (geri tuşu kitaplığa döner). */
  function goPage(p) {
    const base = location.hash.replace(/\/\d+$/, '');
    history.replaceState(null, '', `${base}/${p}`);
    if (cur.kind === 'f') { render(); return; }               // PDF: o sayfaya kaydırır
    render().then(() => { window.scrollTo(0, 0); if (P.s) sesMark(); });
  }
  function step(d) {
    const max = +($('kPageIn')?.max || 9999);
    const p = (cur.page || 1) + d;
    if (p < 1 || p > max) { A().toast(d > 0 ? 'Son sayfa' : 'İlk sayfa'); return; }
    goPage(p);
  }

  root().addEventListener('click', async (e) => {
    if (cur.kind === 'q' && sesTap(e)) return;
    const b = e.target.closest('[data-k],[data-qt]'); if (!b) return;
    if (b.dataset.qt) { qTab = b.dataset.qt; renderQIndex(); return; }
    const k = b.dataset.k, id = b.dataset.id;
    switch (k) {
      case 'next': step(1); break;
      case 'goto': {
        const pn = $('kGo'), open = pn.hidden; pn.hidden = !open; b.setAttribute('aria-expanded', String(open));
        if (open) { const i = $('kPageIn'); i.value = cur.page || 1; i.focus(); i.select?.(); }
        break;
      }
      case 'gores': pendingAy = b.dataset.ay; if (b.dataset.m === '1' && !mealOn()) jset('nv_kmeal', true); break;
      case 'srmore': srShown += 100; drawSearch(); break;
      case 'mealuse': jset('nv_kmealk', id); jset('nv_kmeal', true); location.hash = `#kitap/kuran/${prog().q || 1}`; break;
      case 'mealadd': {
        const x = MLALL.find((m) => m.k === id); if (!x) break;
        const ex = extraMeals().filter((m) => m.k !== id); ex.push({ k: x.k, t: x.t, l: x.l, v: x.v, dir: x.dir, src: x.src, d: x.d }); jset('nv_kmealx', ex);
        A().toast(`${langName(x.l)} meali eklendi`); renderMealLib(); break;
      }
      case 'mealdl': mealDownloadAll(id); renderMealLib(); break;
      case 'mealrm': {
        const ok = await A().ask({ title: 'Meal kaldırılsın mı?', text: 'Telefona inen cüzleri de silinir. İstediğiniz zaman tekrar ekleyebilirsiniz.',
          buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Kaldır', value: 'ok', cls: 'danger' }] });
        if (ok !== 'ok') break;
        jset('nv_kmealx', extraMeals().filter((m) => m.k !== id));
        if (mealKey() === id) jset('nv_kmealk', 'elmalili');
        for (const k of await DB.keys('quran').catch(() => [])) if (typeof k === 'string' && k.startsWith(`m:${id}:`)) { await DB.del('quran', k).catch(() => {}); qMem.delete(k); }
        renderMealLib(); break;
      }
      case 'esit': { const n = +id; const it = ESMA?.n[n - 1]; if (it) saveProg('e', n, "Esmâü'l-Hüsnâ", `${n}. ${it[2]}`); break; }
      case 'prev': step(-1); break;
      case 'retry': render(); break;
      case 'fplus': case 'fminus': {
        if (cur.kind === 'f') {
          const ns = Math.max(1, Math.min(4, pdfScale + (k === 'fplus' ? 0.5 : -0.5)));
          if (ns === pdfScale) { A().toast(k === 'fplus' ? 'En büyük boyut' : 'Sayfa ekrana sığdırıldı'); break; }
          A().toast(`%${Math.round(ns * 100)}`); pdfZoom(ns);
          break;
        }
        if (cur.kind === 'es') {
          const v = Math.max(20, Math.min(56, fontSize('e', 30) + (k === 'fplus' ? 3 : -3))); setFont('e', v);
          $('kBody').style.setProperty('--efs', v + 'px'); break;
        }
        if (cur.kind === 'd') {
          const v = Math.max(18, Math.min(44, fontSize('d', 26) + (k === 'fplus' ? 2 : -2))); setFont('d', v);
          const bd = $('kBody'); bd.style.setProperty('--dfs', v + 'px'); bd.style.setProperty('--dtfs', Math.max(14, Math.round(v * 0.62)) + 'px'); break;
        }
        const key = cur.kind === 'q' ? 'q' : 'h', d = key === 'q' ? 27 : 17;
        const v = Math.max(key === 'q' ? 18 : 13, Math.min(key === 'q' ? 48 : 30, fontSize(key, d) + (k === 'fplus' ? 2 : -2)));
        setFont(key, v);
        if (key === 'q' && mealOn()) { render(); break; }
        const pg = document.querySelector('.q-page, .hd-page'); if (pg) pg.style.fontSize = v + 'px';
        break;
      }
      case 'artoggle': jset('nv_kar', !jget('nv_kar', true)); render(); break;
      case 'mealtoggle': jset('nv_kmeal', !mealOn()); render(); break;
      case 'dsec': {
        const n = +b.dataset.n; history.replaceState(null, '', `#kitap/dua/${n}`); cur.page = n; cur.topic = undefined;
        dQuery = ''; if ($('dSearch')) $('dSearch').value = '';
        document.querySelectorAll('.d-chips button').forEach((x) => x.classList.toggle('on', +x.dataset.n === n));
        const core = n <= DUA.sec.length;
        if (core && $('dsec-' + n)) $('dsec-' + n).scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (core) { await drawDua(n); }
        else { await drawDua(n); window.scrollTo(0, 0); }
        saveProg('d', n, 'Dua Kitabı', (core ? DUA.sec[n - 1].t : DUA.big[n - DUA.sec.length - 1].t)); break;
      }
      case 'dmore': {
        const key = b.dataset.n; dShown[key] = (dShown[key] || DPAGE) + DPAGE; const y = window.scrollY;
        if (key.startsWith('k')) await drawDua(0, +key.slice(1)); else await drawDua(+key);
        window.scrollTo(0, y); break;
      }
      case 'dtopic': {
        const n = +b.dataset.n; cur.topic = n; cur.page = 0; dQuery = ''; if ($('dSearch')) $('dSearch').value = '';
        history.replaceState(null, '', n < 0 ? '#kitap/dua/k' : `#kitap/dua/k${n}`);
        document.querySelectorAll('.d-chips button').forEach((x) => x.classList.toggle('on', x.classList.contains('tp')));
        await drawDua(0, n); window.scrollTo(0, 0);
        if (n >= 0) saveProg('d', 0, 'Dua Kitabı', DUA.topics[n].t);
        break;
      }
      case 'hat': jset('nv_khat', hatPc() ? 'mushaf' : 'pc'); A().toast(hatPc() ? 'Bilgisayar hattı · Türkiye mushafı yazımı' : 'Mushaf hattı · Medine Mushafı yazımı'); render(); break;
      case 'teftoggle': jset('nv_ktef', !tefOn()); render(); break;
      case 'tef1': showTef1(b); break;
      case 'aycopy': copyAyah(b); break;
      case 'mealread': jset('nv_kmeal', true); location.hash = `#kitap/kuran/${prog().q || 1}`; break;
      case 'openapp': {
        const o = b.dataset.open;
        if (o === 'meallib') { location.hash = '#kitap/meal'; break; }
        jset('nv_kmeal', true);
        if (o.startsWith('meal:')) jset('nv_kmealk', o.slice(5));
        if (o === 'tefsir') jset('nv_ktef', true);
        location.hash = `#kitap/kuran/${prog().q || 1}`;
        break;
      }
      case 'dl': hDownload(id, false); break;
      case 'dlar': hDownload(id, true); break;
      case 'hdel': {
        const ok = await A().ask({ title: 'Kitap telefondan silinsin mi?', text: 'İstediğiniz zaman tekrar indirebilirsiniz. Kaldığınız sayfa korunur.',
          buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Sil', value: 'ok', cls: 'danger' }] });
        if (ok !== 'ok') break;
        for (const k of H_ALLKEYS(id)) await DB.del('books', k).catch(() => {});
        hMem.clear();
        location.hash = '#kitap/hadis'; break;
      }
      case 'qall': {
        if (!navigator.onLine) { A().toast('İnternet bağlantısı yok'); break; }
        b.disabled = true;
        for (let n = 1; n <= 30; n++) { b.textContent = `İndiriliyor… ${n}/30`; try { await qLoad(n); if (mealOn()) await juzData('m:' + mealKey(), n); } catch { A().toast(`${n}. cüz indirilemedi`); break; } }
        A().toast('Kur\'an-ı Kerîm telefona indirildi'); renderQIndex(); break;
      }
      case 'qdel': {
        const ok = await A().ask({ title: 'İndirilen cüzler silinsin mi?', text: 'Okudukça tekrar iner. Kaldığınız sayfa korunur.',
          buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Sil', value: 'ok', cls: 'danger' }] });
        if (ok !== 'ok') break;
        for (const k of await DB.keys('quran').catch(() => [])) if (k !== 'meta' && k !== 'mealidx' && k !== 'qelist') await DB.del('quran', k).catch(() => {});
        qMem.clear(); renderQIndex(); break;
      }
      case 'addpdf': pickPdf(b.dataset.kind); break;
      case 'dm-text': case 'dm-meal': case 'dm-ses': case 'dm-hadis': case 'dm-pdf': dmDelete(k); break;
      case 'delfile': {
        const ok = await A().ask({ title: 'Kitap silinsin mi?', text: 'Dosya bu telefondan silinir.',
          buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Sil', value: 'ok', cls: 'danger' }] });
        if (ok !== 'ok') break;
        await DB.del('files', id).catch(() => {}); if (pdfId === id) { pdfId = null; pdfDoc = null; } renderLib(); break;
      }
    }
  });
  root().addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'kPgForm') {
      const max = +($('kPageIn').max || 9999), v = Math.max(1, Math.min(max, +$('kPageIn').value || 0));
      if (v) { $('kGo').hidden = true; goPage(v); } return;
    }
    if (e.target.id === 'kSearch') {
      const q = $('kSearchQ').value.trim(); if (!q) return;
      $('kSearchQ').blur(); location.hash = '#kitap/ara/' + encodeURIComponent(q); return;
    }
    if (e.target.id === 'kGoto') { const v = Math.max(1, Math.min(604, +$('kGotoP').value || 0)); if (v) location.hash = `#kitap/kuran/${v}`; return; }
    if (e.target.id === 'kGotoH') {
      const id = cur.id, book = await hLoad(id);
      const n = +$('kGotoN').value, pg = +$('kGotoP').value;
      if (n) {
        const i = book.list.findIndex((h) => Math.floor(h[0]) === n);
        if (i < 0) { A().toast('Bu numarada hadis yok'); return; }
        const page = book.pages.findIndex((ix) => ix.includes(i)) + 1;
        location.hash = `#kitap/h/${id}/${page}`;
      } else if (pg) location.hash = `#kitap/h/${id}/${Math.max(1, Math.min(book.pages.length, pg))}`;
    }
  });
  root().addEventListener('change', (e) => {
    if (e.target.id === 'kGoSure' && e.target.value) { pendingAy = `${+e.target.value}-1`; $('kGo').hidden = true; goPage(pageOf(+e.target.value, 1)); }
    if (e.target.id === 'kGoJuz' && e.target.value) { $('kGo').hidden = true; goPage(QM.j[+e.target.value - 1]); }
  });
  /* PDF: iki parmakla büyüt/küçült, çift dokunuşla büyüt/sığdır (sayfa düzeni bozulmadan) */
  let pinch = null, lastTap = 0;
  const tdist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  function pdfZoomTo(ns, focus) {
    ns = Math.max(1, Math.min(4, Math.round(ns * 4) / 4));
    if (ns === pdfScale) return;
    pdfZoom(ns, focus);
  }
  root().addEventListener('touchstart', (e) => {
    if (cur.kind !== 'f' || !e.target.closest('#kBody')) return;
    if (e.touches.length === 2) {
      const c = $('kBody').querySelector('.pdf-doc'); if (!c) return;
      const t = e.touches, x = (t[0].clientX + t[1].clientX) / 2, y = (t[0].clientY + t[1].clientY) / 2, r = c.getBoundingClientRect();
      pinch = { d0: tdist(t), x, y, c, k: 1 };
      c.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
      tx0 = null;                                            // iki parmak: sayfa çevirme değil
    }
  }, { passive: true });
  root().addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();                                      // tarayıcı tüm ekranı büyütmesin
    const k = Math.max(1 / pdfScale, Math.min(4 / pdfScale, tdist(e.touches) / pinch.d0));
    pinch.k = k; pinch.c.style.transform = `scale(${k})`;
  }, { passive: false });
  root().addEventListener('touchend', (e) => {
    if (cur.kind === 'f' && pinch && e.touches.length < 2) {
      const p = pinch; pinch = null;
      p.c.style.transform = ''; p.c.style.transformOrigin = '';
      if (Math.abs(p.k - 1) > 0.04) pdfZoomTo(pdfScale * p.k, { x: p.x, y: p.y });
      lastTap = 0; return;
    }
    if (cur.kind === 'f' && e.changedTouches.length === 1 && e.touches.length === 0 && e.target.closest('#kBody')) {
      const t = e.changedTouches[0], now = Date.now();
      if (tx0 !== null && Math.abs(t.clientX - tx0) < 12 && Math.abs(t.clientY - ty0) < 12) {
        if (now - lastTap < 320) { lastTap = 0; tx0 = null; pdfZoomTo(pdfScale > 1 ? 1 : 2.5, { x: t.clientX, y: t.clientY }); return; }
        lastTap = now;
      }
    }
  }, { passive: true });
  // iOS Safari'nin kendi sayfa büyütmesini PDF'te kapat (büyütmeyi biz yapıyoruz)
  root().addEventListener('gesturestart', (e) => { if (cur.kind === 'f') e.preventDefault(); });
  // Kaydırma ile sayfa çevirme: Kur'an'da mushaf gibi (parmağı sağa çekmek = sonraki sayfa)
  let tx0 = null, ty0 = 0;
  root().addEventListener('touchstart', (e) => { if (!e.target.closest('#kBody') || e.touches.length > 1) { tx0 = null; return; } tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
  root().addEventListener('touchend', (e) => {
    if (tx0 === null) return;
    const dx = e.changedTouches[0].clientX - tx0, dy = e.changedTouches[0].clientY - ty0; tx0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (!['q', 'h'].includes(cur.kind)) return;                             // yalnız sayfalı okuyucularda (PDF aşağı kayar)
    const rtl = cur.kind === 'q';
    step((dx > 0) === rtl ? 1 : -1);
  }, { passive: true });

  function show() { if (!A()) return; qMeta().catch(() => {}); render(); }
  window.Kitap = { show, zikir: renderZikir };
  if (!$('viewKitap').hidden) show();
})();
