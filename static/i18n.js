/* Uygulama dili. Arayüz Türkçe yazılır; seçilen dilde ekrandaki metinler sözlükten (static/i18n/<dil>.json) çevrilir.
 * Kur'an, meal, hadis, dua metinleri çevrilmez (kendi dilleri / mealleri vardır).
 * Seçim yalnız bu telefonda (localStorage nv_lang) tutulur; sunucuya gitmez. */
(() => {
  const LANGS = [
    ['tr', 'Türkçe', 'tr-TR'], ['en', 'English', 'en-GB'], ['ar', 'العربية', 'ar'], ['id', 'Bahasa Indonesia', 'id-ID'],
    ['ur', 'اردو', 'ur-PK'], ['hi', 'हिन्दी', 'hi-IN'], ['bn', 'বাংলা', 'bn-BD'], ['fa', 'فارسی', 'fa-IR'], ['ms', 'Bahasa Melayu', 'ms-MY'],
  ];
  const RTL = new Set(['ar', 'ur', 'fa']);
  let lang = 'tr';
  try { lang = localStorage.getItem('nv_lang') || 'tr'; } catch { /* yok */ }
  if (!LANGS.some((l) => l[0] === lang)) lang = 'tr';
  const meta = LANGS.find((l) => l[0] === lang);
  window.LOC = `${meta[2]}-u-nu-latn`;                    // tarih/sayı biçimi (rakamlar Latin)
  window.UILANG = lang;
  const html = document.documentElement;
  html.lang = lang;
  if (RTL.has(lang)) html.dir = 'rtl';

  // Çevrilmeyecek bölgeler: Arapça metin, meal/tefsir/hadis/dua içerikleri, yer adları, PDF
  const SKIP = 'script,style,textarea,svg,[data-notr],.k-ar,.q-page,.qm-ar,.qm-tr,.qm-fn,.qm-tef,.hd-page,.d-list,.e-list,.k-sres,'
    + '#placeName,#placeSub,.pdf-doc,#siriDlg,.k-mlg summary b,.k-ml b,.k-ml small,.k-mlist small,.hd-sec,.q-bsm,.q-sh,#dList .d-card,option:not([value=""]),'
    + '.h-toc,.k-toc,.k-hbook b,.k-hbook small,.d-src';
  // Sayılar ve (sayı içeren metinlerde) ay/gün adları yer tutucu sayılır: "15 Kasım" ≈ "15 November"
  let TOK = null;
  function tokRe() {
    if (TOK) return TOK;
    const set = new Set();
    try {
      const f = (o, d) => new Intl.DateTimeFormat(window.LOC, { ...o, timeZone: 'UTC' }).formatToParts(d);
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2026, m, 15));
        for (const o of [{ month: 'long', day: 'numeric' }, { month: 'short', day: 'numeric' }, { month: 'long' }, { month: 'short' }]) {
          const p = f(o, d).find((x) => x.type === 'month'); if (p) set.add(p.value);
        }
      }
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.UTC(2026, 10, 15 + i));
        for (const o of [{ weekday: 'long' }, { weekday: 'short' }]) { const p = f(o, d).find((x) => x.type === 'weekday'); if (p) set.add(p.value); }
      }
    } catch { /* yok */ }
    const ws = [...set].filter((w) => /\p{L}/u.test(w)).sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    TOK = new RegExp(`${ws.length ? `(?<![\\p{L}])(?:${ws.join('|')})(?![\\p{L}])|` : ''}\\d+(?:[.,:]\\d+)*`, 'gu');
    return TOK;
  }
  let D = null, WRE = null;
  const collect = (() => { try { return localStorage.getItem('nv_i18n_collect') === '1'; } catch { return false; } })();
  const miss = new Set(); window.__i18nMiss = miss;

  function tr(src) {
    const t = src.trim();
    if (!t || !/\p{L}/u.test(t)) return null;
    if (collect) { miss.add(/\d/.test(t) ? t.replace(tokRe(), () => '{n}') : t); return null; }
    if (!D) return null;
    let out = D.s[t];
    if (out === undefined && /\d/.test(t)) {
      const nums = [];
      const key = t.replace(tokRe(), (m) => `{${nums.push(m) - 1}}`);
      const tpl = D.s[key];
      if (tpl !== undefined) out = tpl.replace(/\{(\d+)\}/g, (m, i) => (nums[+i] !== undefined ? nums[+i] : m));
    }
    if (out === undefined && WRE) {
      let hit = false;
      const r = t.replace(WRE, (m) => { hit = true; return D.w[m]; });
      if (hit) out = r;
    }
    if (out === undefined) return null;
    return src.replace(t, out);
  }
  window.T = (s) => (lang === 'tr' ? s : tr(s) ?? s);   // kodun içinden gerekirse

  const DONE = new WeakMap();
  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const cur = n.data, rec = DONE.get(n);
    if (rec === cur) return;
    const out = tr(cur);
    if (out != null && out !== cur) { DONE.set(n, out); n.data = out; }
  }
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  function doEl(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (!v) continue;
      const k = '__i18n_' + a; if (el[k] === v) continue;
      const o = tr(v);
      if (o != null && o !== v) { el[k] = o; el.setAttribute(a, o); }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
    doEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  function start() {
    walk(document.body);
    if (document.title) { const o = tr(document.title); if (o) document.title = o; }
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') { if (r.target.nodeType === 1 && !r.target.closest(SKIP)) doEl(r.target); }
        else r.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  if (lang !== 'tr' || collect) {
    html.classList.add('i18n-wait');
    const done = () => { html.classList.remove('i18n-wait'); };
    let ver = ''; try { ver = new URL(document.currentScript.src).searchParams.get('v') || ''; } catch { /* yok */ }
    const go = () => { start(); done(); };
    const t0 = setTimeout(done, 2500);                      // sözlük gecikirse Türkçe göster
    (collect ? Promise.resolve({ s: {} }) : fetch(`/static/i18n/${lang}.json?v=${ver}`).then((r) => r.json()))
      .then((d) => {
        D = { s: d.s || {}, w: d.w || {} };
        const ws = Object.keys(D.w).sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (ws.length) WRE = new RegExp(`(?<![\\p{L}])(?:${ws.join('|')})(?![\\p{L}])`, 'gu');
      })
      .catch(() => {})
      .finally(() => { clearTimeout(t0); if (document.body) go(); else document.addEventListener('DOMContentLoaded', go); });
  }

  /* Dil seçme penceresi (başlıktaki dil düğmesi) */
  function picker() {
    let dlg = document.getElementById('langDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'langDlg'; dlg.className = 'lang-dlg'; dlg.setAttribute('data-notr', '');
      dlg.innerHTML = `<div class="lang-h"><b>Dil · Language · اللغة</b><button type="button" class="lang-x" aria-label="Kapat">✕</button></div>
        <div class="lang-list">${LANGS.map(([k, n]) => `<button type="button" data-l="${k}" class="${k === lang ? 'on' : ''}" lang="${k}" dir="${RTL.has(k) ? 'rtl' : 'ltr'}">${n}</button>`).join('')}</div>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('.lang-x')) { dlg.close(); return; }
        const b = e.target.closest('[data-l]'); if (!b) return;
        try { localStorage.setItem('nv_lang', b.dataset.l); } catch { /* yok */ }
        location.reload();
      });
    }
    dlg.showModal();
  }
  window.I18N = { lang, langs: LANGS, picker, rtl: RTL.has(lang) };
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btnLang');
    if (b) { b.querySelector('span').textContent = lang.toUpperCase(); b.addEventListener('click', picker); }
  });
})();
