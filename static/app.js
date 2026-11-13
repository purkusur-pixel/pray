'use strict';
/*
 * Namaz Vakitleri PWA
 * - Veriler telefonun yerel deposunda tutulur (≈30 gün, 15'i gösterilir); geçmiş günler silinir.
 *     nv_loc : seçili konum (ülke/il/ilçe id + adlar)
 *     nv_pt  : günlük vakitler, sıkıştırılmış biçimde
 * - Her açılışta geçmiş günler çerezden silinir.
 * - Kalan gün 15'in altına düşünce ≈30 güne tamamlanır (≈15 günde 1 istek, günde en fazla 1; internet yoksa eski veri).
 * - Konum değişince eski vakitler silinir ve yeni konum için 14 gün çekilir.
 */

const SHOW_DAYS = 15;         // listede her zaman bu kadar gün (bugün dahil)
const FETCH_DAYS = 31;        // bir istekte istenen en fazla gün (kaynak ≈30 gün verir)
const SAFETY_DAYS = 2;        // yenileme 2 gün erken başlar: 2 gün internetsiz kalsanız da liste 15 gün kalır
const REFILL_AT = SHOW_DAYS + SAFETY_DAYS;
// En az trafik: telefonda ≈30 gün tutulur, 15'i gösterilir. Kalan gün 15'in altına düşünce
// (≈14 günde bir, 2 gün güvenlik payıyla) tek istekle yeniden ≈30 güne tamamlanır → yılda ≈26 istek.
// Aynı gün ikinci istek yok; internet yoksa eski veri gösterilir, bağlantı gelince tamamlanır.
const NAMES = ['İmsak', 'Güneş', 'Öğle', 'İkindi', 'Akşam', 'Yatsı'];
const HIJRI_MONTHS = ['Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir', 'Cemaziyelevvel', 'Cemaziyelahir',
  'Recep', 'Şaban', 'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'];
const C_LOC = 'nv_loc';
const C_PT = 'nv_pt';
const DEFAULT_COUNTRY = 2; // Türkiye

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const S = { days: [], dayKey: null, busy: false, timer: null, cards: null, view: 'times' };

/* ------------------------------------------------------------ çerezler */
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value, maxAgeSec) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; SameSite=Lax`;
  if (location.protocol === 'https:') c += '; Secure';
  document.cookie = c;
}
const delCookie = (name) => setCookie(name, '', 0);

/* ------------------------------------------------------------ yerel depo
 * Veriler telefonun yerel deposunda (localStorage) tutulur: çerezler her HTTP isteğiyle sunucuya
 * tekrar gönderildiği için (≈1,3 KB × her istek) yerel depo trafiği azaltır. Yerel depo
 * kullanılamazsa (bazı gizli pencereler) çereze düşülür. Eski çerezler bir kez taşınıp silinir.
 */
const LS = (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; } catch { return null; } })();
function sget(name) {
  if (LS) { try { const v = LS.getItem(name); if (v !== null) return v; } catch { /* yok */ } }
  return getCookie(name);
}
function sset(name, value, maxAgeSec) {
  if (LS) { try { LS.setItem(name, value); delCookie(name); return; } catch { /* dolu/engelli */ } }
  setCookie(name, value, maxAgeSec);
}
function sdel(name) {
  if (LS) { try { LS.removeItem(name); } catch { /* yok */ } }
  delCookie(name);
}
if (LS) {                                             // eski sürümden kalan çerezleri taşı
  for (const n of ['nv_loc', 'nv_pt', 'nv_qb']) {
    const v = getCookie(n);
    if (v !== null) { try { if (LS.getItem(n) === null) LS.setItem(n, v); } catch { /* yok */ } delCookie(n); }
  }
}

/* ------------------------------------------------------------ konum */
function readLoc() {
  try {
    const v = JSON.parse(sget(C_LOC) || 'null');
    return v && v.i && v.s ? v : null;
  } catch { return null; }
}
function saveLoc(loc) { sset(C_LOC, JSON.stringify(loc), 365 * 86400); }

/* --------------------------------------------- vakitlerin çerez biçimi
 * nv_pt = "<ilçeId>~<sonİndirmeGünü YYYYMMDD>|<gün>_<gün>_..."
 *   sonİndirmeGünü: bu ilçe için sunucuya en son başarıyla gidilen gün (günde 1 istek sınırı için)
 * gün   = YYYYMMDD + 6×HHMM + "~" + hicri(kısa)
 * örn.  20261024055907261302160118341953~12.5.1448   (≈43 bayt/gün, 14 gün ≈ 600 bayt)
 * Saatler ilçenin yerel saatidir; cihaz saatine göre değerlendirilir.
 */
function encodeDays(cityId, days, fetched) {
  return cityId + '~' + (fetched || '').replaceAll('-', '') + '|' + days.map((d) =>
    d.d.replaceAll('-', '') + d.t.map((x) => x.replace(':', '')).join('') + '~' + (d.h || '')
  ).join('_');
}
function decodeDays(str) {
  const [head, rest] = (str || '').split('|');
  const [cid, f = ''] = (head || '').split('~');
  const fetched = /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : '';
  if (!rest) return { city: Number(cid) || null, days: [], fetched };
  const days = rest.split('_').map((p) => {
    const [a, h] = p.split('~');
    if (!/^\d{32}$/.test(a)) return null;
    const t = [];
    for (let i = 0; i < 6; i++) {
      const s = a.slice(8 + i * 4, 12 + i * 4);
      t.push(s.slice(0, 2) + ':' + s.slice(2));
    }
    return { d: `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`, t, h: h || '' };
  }).filter(Boolean);
  return { city: Number(cid), days, fetched };
}
function readStore(cityId) {
  const r = decodeDays(sget(C_PT));
  return r.city === cityId ? { days: r.days, fetched: r.fetched } : { days: [], fetched: '' };
}
const readDays = (cityId) => readStore(cityId).days;
function saveDays(cityId, days, fetched = '') {
  if (!days.length) { sdel(C_PT); return; }
  const last = days[days.length - 1];
  // Çerez, son kayıtlı günün sonunda tarayıcı tarafından da kendiliğinden silinir
  const maxAge = (toEpoch(last.d, '23:59') + 60e3 - Date.now()) / 1000;
  sset(C_PT, encodeDays(cityId, days, fetched), maxAge);
}

/* ------------------------------------------------------------ zaman (cihaz yerel saati) */
function toEpoch(dayStr, hhmm) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
const isoLocal = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
const todayKey = () => isoLocal(new Date());
function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
}
function prune(days) {
  const tk = todayKey();
  return days.filter((d) => d.d >= tk).slice(0, FETCH_DAYS);
}
function mergeDays(a, b) {
  const map = new Map(a.map((d) => [d.d, d]));
  for (const d of b) map.set(d.d, d);
  return [...map.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
}

/* ------------------------------------------------------------ ağ */
async function api(path) {
  let r;
  try { r = await fetch(path, { headers: { Accept: 'application/json' } }); }
  catch { const e = new Error('İnternet bağlantısı yok.'); e.offline = true; throw e; }
  let body = null;
  try { body = await r.json(); } catch { /* boş */ }
  if (!r.ok) throw new Error((body && body.detail) || `Sunucu hatası (${r.status})`);
  return body;
}

/* ------------------------------------------------------------ ana akış */
async function ensureData() {
  if (S.busy) return;
  const loc = readLoc();
  renderHeader(loc);
  if (!loc) {
    S.days = []; render();
    if (!S.triedFirstAuto) {
      S.triedFirstAuto = true;
      showState('Konumunuz bulunuyor…');
      if (await autoLocate(true)) return;          // bulundu: applyNewLoc ensureData'yı tekrar çağırır
      $('stateBox').hidden = true;
    }
    openPicker(true); return;
  }
  if (loc.a) autoLocate();                          // arka planda; vakitler beklemeden çizilir

  let { days, fetched } = readStore(loc.i);
  const before = days.length;
  days = prune(days);
  if (days.length !== before) saveDays(loc.i, days, fetched);   // geçmiş günleri çerezden sil
  S.days = days;
  S.fetched = fetched;
  S.dayKey = todayKey();

  // Kalan gün 15'ten azsa ≈30 güne tamamla — ama bu ilçe için bugün zaten indirildiyse tekrar gitme.
  const today = S.dayKey;
  const need = FETCH_DAYS - days.length;
  const due = days.length < REFILL_AT && fetched !== today && Date.now() >= (S.retryAt || 0);
  if (due && !navigator.onLine) {
    S.pendingOnline = true;                          // bağlantı gelince otomatik denenecek
  } else if (due) {
    const start = days.length ? addDays(days[days.length - 1].d, 1) : today;
    S.busy = true;
    if (!days.length) showState('Vakitler yükleniyor…');
    try {
      const res = await api(`/api/times?state=${loc.s}&city=${loc.i}&start=${start}&days=${need}`);
      // Yanıt gelene kadar kullanıcı konumu değiştirdiyse bu veriyi yazma
      const cur = readLoc();
      if (cur && cur.i === loc.i) {
        days = prune(mergeDays(days, res.days || []));
        saveDays(loc.i, days, today);              // bugün indirildi: bugün bir daha istek yok
        S.days = days; S.fetched = today;
        S.dayKey = todayKey();
      }
    } catch (e) {
      if (e.offline) S.pendingOnline = true;           // internet yok: gelince tekrar dene
      else S.retryAt = Date.now() + 30 * 60e3;         // sunucu hatası: 30 dk sonra tekrar dene
      if (!days.length) showState(e.offline ? 'İnternet bağlantısı yok. Bağlanınca vakitler otomatik gelecek.' : e.message, true);
    } finally {
      S.busy = false;
    }
  }
  render();
  syncLink();                                         // ilçe değiştiyse Siri'ye bildir (değişmediyse istek yok)
}

/* ------------------------------------------------------------ çizim */
const fmtLong = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDow = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' });
const utcDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
function hijriLong(h) {
  const p = (h || '').split('.').map(Number);
  return p.length === 3 && p[1] >= 1 && p[1] <= 12 ? `${p[0]} ${HIJRI_MONTHS[p[1] - 1]} ${p[2]}` : '';
}
const title = (s) => (s || '').toLocaleLowerCase('tr-TR').replace(/(^|[\s\-\/(])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));

function renderHeader(loc) {
  $('placeName').textContent = loc ? title(loc.n) : 'Konum seçilmedi';
  $('placeSub').textContent = loc ? [title(loc.sn), title(loc.cn)].filter((x, i, a) => x && a.indexOf(x) === i && x !== title(loc.n)).join(', ') : '';
}

function showState(msg, retry = false) {
  $('hero').hidden = true;
  $('upcoming').hidden = true;
  $('stateBox').hidden = false;
  $('stateMsg').textContent = msg;
  $('btnRetry').hidden = !retry;
}

function render() {
  renderHeader(readLoc());
  const days = S.days;
  if (!days.length) {
    if (readLoc() && !S.busy && $('stateBox').hidden) showState('Bu konum için kayıtlı vakit yok.', true);
    $('storeInfo').textContent = '';
    document.title = 'Namaz Vakitleri';
    return;
  }
  $('stateBox').hidden = true;
  $('hero').hidden = false;
  $('btnSiri').hidden = false;
  $('upcoming').hidden = days.length < 2;
  $('upcomingTitle').textContent = `Önümüzdeki ${Math.min(days.length, SHOW_DAYS)} gün`;

  const today = days[0];
  $('gregDate').textContent = fmtLong.format(utcDate(today.d));
  $('hijriDate').textContent = hijriLong(today.h);

  S.cards = null;
  $('todayTimes').innerHTML = today.t.map((t, i) =>
    `<li data-i="${i}"><span class="n">${NAMES[i]}</span><span class="t">${t}</span><span class="r"></span></li>`).join('');

  $('upcomingBody').innerHTML = days.slice(0, SHOW_DAYS).map((d, idx) => {
    const dt = utcDate(d.d);
    return `<tr class="${idx === 0 ? 'today' : ''}"><td>${fmtShort.format(dt)}<span class="dow">${fmtDow.format(dt)}</span></td>` +
      d.t.map((t) => `<td>${t}</td>`).join('') + '</tr>';
  }).join('');

  const first = days[0].d, last = days[days.length - 1].d;
  const upd = S.fetched ? (S.fetched === todayKey() ? 'bugün' : fmtShort.format(utcDate(S.fetched))) : '—';
  // Kalan gün REFILL_AT'in altına düştüğü gün yeni indirme yapılır
  const nextDl = days.length >= REFILL_AT ? fmtShort.format(utcDate(days[days.length - REFILL_AT + 1].d))
    : (S.fetched === todayKey() ? 'yarın' : 'şimdi');
  $('storeInfo').textContent = `Telefonda ${days.length} gün (${fmtShort.format(utcDate(first))} – ${fmtShort.format(utcDate(last))}) · son indirme: ${upd} · sonraki: ${nextDl}`;
  tick();
  maybeSay();
}


/* Kalan süreyi açıkça yaz: "2 saat 15 dakika", "15 dakika", "1 dakikadan az" */
function remainParts(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const totalMin = Math.floor(sec / 60);          // saat:dakika:saniye satırıyla tutarlı
  return { sec, totalMin, h: Math.floor(totalMin / 60), m: totalMin % 60 };
}
function remainText(ms) {
  const { sec, h, m } = remainParts(ms);
  if (sec < 60) return '1 dakikadan az';
  if (h === 0) return `${m} dakika`;
  return m === 0 ? `${h} saat` : `${h} saat ${m} dakika`;
}
function remainShort(ms) {
  const { sec, h, m } = remainParts(ms);
  if (sec < 60) return '<1 dk';
  return h ? (m ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
}
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
const NAMES_DAT = ['İmsak', 'Güneşin doğuşuna', 'Öğle', 'İkindi', 'Akşam', 'Yatsı'];
const nextLabelFor = (i, tomorrow = false) =>
  (tomorrow ? 'Yarın ' : '') + (i === 1 ? NAMES_DAT[1] : `${NAMES_DAT[i]} vaktine`) + ' kalan süre';

function tick() {
  const days = S.days;
  if (!days.length) return;

  // Gün döndüyse: geçmişi sil, gerekirse yeni veri çek
  if (todayKey() !== S.dayKey) { ensureData(); return; }

  const now = Date.now();
  const today = days[0];
  const ep = today.t.map((t) => toEpoch(today.d, t));
  let cur = -1;
  ep.forEach((e, i) => { if (e <= now) cur = i; });
  const nextIdx = ep.findIndex((e) => e > now);
  let nextAt = null, label = '', nextName = '';
  if (nextIdx >= 0) {
    nextAt = ep[nextIdx]; label = nextLabelFor(nextIdx); nextName = NAMES[nextIdx];
  } else if (days[1]) {
    nextAt = toEpoch(days[1].d, days[1].t[0]); label = nextLabelFor(0, true); nextName = 'İmsak';
  }

  // Kartlar: geçen/şimdiki/sonraki ve her gelecek vakit için kalan süre (yalnızca değişen yazılır)
  if (!S.cards) S.cards = [...document.querySelectorAll('#todayTimes li')].map((li) => ({ li, r: li.querySelector('.r') }));
  S.cards.forEach(({ li, r }, i) => {
    li.classList.toggle('is-current', i === cur);
    li.classList.toggle('is-next', i === nextIdx);
    li.classList.toggle('is-past', i < cur);
    setText(r, ep[i] > now ? remainShort(ep[i] - now) + ' kaldı' : '');
  });

  // Şu an hangi vaktin içindeyiz (imsaktan önce: önceki günün yatsısı)
  setText($('nowLabel'), cur === 1 ? 'Güneş doğdu' : `Şu an ${NAMES[cur >= 0 ? cur : 5]} vakti`);

  if (nextAt) {
    const left = nextAt - now;
    const { sec, totalMin } = remainParts(left);
    const total = sec < 60 ? `${sec} saniye` : `${totalMin} dakika`;
    setText($('nextLabel'), label);
    setText($('countdown'), remainText(left));
    setHTML($('countdownSub'), `Toplam <b>${total}</b> · ${hms(left)} · ${nextName} ${new Date(nextAt).toTimeString().slice(0, 5)}`);
    if (S.view === 'times') document.title = `${remainShort(left)} · ${nextName}`;
  } else {
    setText($('nextLabel'), '');
    setText($('countdown'), 'Yarının verisi yok');
    setText($('countdownSub'), 'İnternete bağlanınca otomatik çekilecek.');
    document.title = 'Namaz Vakitleri';
  }
}
function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
function setHTML(el, v) { if (el && el._h !== v) { el.innerHTML = v; el._h = v; } }

/* ------------------------------------------------------------ konum seçici */
const dlg = $('picker');
let mandatory = false;

function fillSelect(sel, items, placeholder, selectedId) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((p) => `<option value="${p.id}">${escapeHtml(title(p.name))}</option>`).join('');
  sel.disabled = !items.length;
  if (selectedId && items.some((p) => p.id === Number(selectedId))) sel.value = String(selectedId);
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pickerError(msg) { $('pickerErr').textContent = msg || ''; $('pickerErr').hidden = !msg; }
function updateSave() { $('btnSave').disabled = !$('selCity').value; }

async function loadCountries(selected) {
  const list = await api('/api/countries');
  fillSelect($('selCountry'), list, 'Ülke seçin', selected);
}
async function loadStates(countryId, selected, resetCities = false) {
  fillSelect($('selState'), [], 'Yükleniyor…');
  if (resetCities) fillSelect($('selCity'), [], 'Önce il seçin');
  if (!countryId) { fillSelect($('selState'), [], 'Önce ülke seçin'); return; }
  const list = await api(`/api/states/${countryId}`);
  fillSelect($('selState'), list, 'İl / eyalet seçin', selected);
}
async function loadCities(stateId, selected) {
  fillSelect($('selCity'), [], 'Yükleniyor…');
  if (!stateId) { fillSelect($('selCity'), [], 'Önce il seçin'); return; }
  const list = await api(`/api/cities/${stateId}`);
  fillSelect($('selCity'), list, 'İlçe / şehir seçin', selected);
}

async function openPicker(isMandatory = false) {
  mandatory = isMandatory;
  $('btnCancel').hidden = mandatory;
  { const l = readLoc(); $('chkAuto').checked = l ? !!l.a : true; }
  pickerError('');
  if (!dlg.open) dlg.showModal();
  const loc = readLoc();
  try {
    // Üç liste birbirini beklemeden aynı anda istenir
    const c = loc ? loc.c : DEFAULT_COUNTRY;
    await Promise.all([
      loadCountries(c),
      loadStates(c, loc ? loc.s : null),
      loc ? loadCities(loc.s, loc.i) : Promise.resolve(),
    ]);
  } catch (e) {
    pickerError(e.message);
  }
  updateSave();
}

$('selCountry').addEventListener('change', async (e) => {
  pickerError('');
  try { await loadStates(e.target.value, null, true); } catch (err) { pickerError(err.message); }
  updateSave();
});
$('selState').addEventListener('change', async (e) => {
  pickerError('');
  try { await loadCities(e.target.value); } catch (err) { pickerError(err.message); }
  updateSave();
});
$('selCity').addEventListener('change', updateSave);

$('btnSave').addEventListener('click', () => {
  const sc = $('selCountry'), ss = $('selState'), si = $('selCity');
  if (!si.value) return;
  const optText = (sel) => sel.options[sel.selectedIndex].textContent;
  const loc = {
    c: Number(sc.value), s: Number(ss.value), i: Number(si.value),
    cn: optText(sc), sn: optText(ss), n: optText(si),
  };
  if ($('chkAuto').checked) loc.a = 1;
  dlg.close();
  applyNewLoc(loc, false);                          // yeni ilçe: eski tarihler silinir, 14 gün çekilir
});
$('btnCancel').addEventListener('click', () => dlg.close());
dlg.addEventListener('cancel', (e) => { if (mandatory) e.preventDefault(); });
$('btnLoc').addEventListener('click', () => openPicker(false));
$('btnRetry').addEventListener('click', () => (readLoc() ? ensureData() : openPicker(true)));

/* ----- Cihaz konumu: önce hızlı (ağ/wifi), olmazsa GPS ile bir kez daha dene */
function geoError(e) {
  if (!window.isSecureContext) return 'Konum yalnızca https:// adresinde çalışır.';
  switch (e && e.code) {
    case 1: return 'Konum izni verilmedi. Tarayıcı ayarlarından bu siteye konum izni verip tekrar deneyin.';
    case 2: return 'Konum bulunamadı. Telefonun konum (GPS) ayarı açık mı?';
    case 3: return 'Konum zaman aşımına uğradı. Açık alanda ya da Wi-Fi açıkken tekrar deneyin.';
    default: return (e && e.message) || 'Konum alınamadı.';
  }
}
function getPosition(precise = false, maxAge = null) {
  if (!('geolocation' in navigator)) return Promise.reject(new Error('Bu cihaz/tarayıcı konum desteklemiyor.'));
  const once = (high, timeout) => new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: high, timeout, maximumAge: maxAge ?? (high ? 60e3 : 5 * 60e3) }));
  return once(precise, precise ? 20000 : 8000).catch((e) => {
    if (e && e.code === 1) throw e;                 // izin yoksa tekrar sormanın anlamı yok
    return once(!precise, 20000);
  });
}

/* ----- "Bulunduğum yeri bul": tarayıcı konumu → sunucu en yakın ilçeyi bulur → listeler doldurulur */
$('btnGeo').addEventListener('click', async () => {
  pickerError('');
  const btn = $('btnGeo');
  const note = $('geoNote');
  const noteText = note.textContent;
  btn.disabled = true;
  note.textContent = 'Konum alınıyor…';
  try {
    let pos;
    try { pos = await getPosition(false); } catch (e) { throw new Error(geoError(e)); }
    note.textContent = 'En yakın ilçe aranıyor…';
    const { latitude, longitude } = pos.coords;
    const loc = await api(`/api/nearest?lat=${latitude.toFixed(3)}&lon=${longitude.toFixed(3)}`);
    await Promise.all([loadCountries(loc.c), loadStates(loc.c, loc.s), loadCities(loc.s, loc.i)]);
    $('chkAuto').checked = true;
    note.textContent = `Bulundu: ${title(loc.n)}, ${title(loc.sn)} (~${loc.km} km). Kaydet'e basın.`;
    updateSave();
    return;
  } catch (e) {
    pickerError(e && e.code ? geoError(e) : ((e && e.message) || 'Konum bulunamadı.'));
  } finally {
    btn.disabled = false;
    updateSave();
  }
  note.textContent = noteText;
});

/* ------------------------------------------------------------ otomatik konum
 * nv_loc.a = 1 ise: uygulama açılınca (en fazla 10 dakikada bir) cihaz konumu alınır,
 * en yakın ilçe farklıysa vakitler o ilçeye göre yenilenir. Konum sunucuda saklanmaz.
 */
let autoBusy = false, lastAuto = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3500);
}
function applyNewLoc(loc, announce) {
  const old = readLoc();
  if (!old || old.i !== loc.i) { sdel(C_PT); S.days = []; Q.reset(); }
  saveLoc(loc);
  if (announce && old && old.i !== loc.i) toast(`Konum güncellendi: ${title(loc.n)}`);
  ensureData();
  if (S.view === 'qibla') Q.show();
}
async function autoLocate(force = false) {
  const loc = readLoc();
  if (autoBusy || (loc && !loc.a) || (!force && Date.now() - lastAuto < 10 * 60e3)) return false;
  autoBusy = true; lastAuto = Date.now();
  try {
    const pos = await getPosition(false, force ? 0 : 5 * 60e3);
    const { latitude: la, longitude: lo } = pos.coords;
    // Son kontrol edilen noktaya 3 km'den yakınsa ilçe değişmemiştir: istek atma
    const [pla, plo] = (sget('nv_pos') || '').split(',').map(Number);
    if (loc && Number.isFinite(pla) && Math.hypot((la - pla) * 111, (lo - plo) * 111 * Math.cos(la * Math.PI / 180)) < 3) return true;
    sset('nv_pos', `${la.toFixed(2)},${lo.toFixed(2)}`, 365 * 86400);   // ≈1 km hassasiyet, yalnızca telefonda
    const r = await api(`/api/nearest?lat=${la.toFixed(3)}&lon=${lo.toFixed(3)}`);
    const cur = readLoc();
    if (!cur || cur.i !== r.i) applyNewLoc({ c: r.c, s: r.s, i: r.i, cn: r.cn, sn: r.sn, n: r.n, a: 1 }, true);
    return true;
  } catch {
    return false;                 // izin yok / konum yok: mevcut ilçeyle devam
  } finally {
    autoBusy = false;
  }
}

/* ------------------------------------------------------------ kıble
 * Açı sunucudan gelir (gerçek kuzeye göre + WMM2025 manyetik sapma) ve seçili ilçe için
 * küçük bir çerezde (nv_qb ≈ 30 bayt) saklanır: çevrimdışı da çalışır.
 * Telefon pusulası manyetik kuzeyi verir; sapma eklenerek gerçek kuzeye çevrilir.
 */
const C_QB = 'nv_qb';
const KAABA = [21.422487, 39.826206];
const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;          // b'den a'ya işaretli fark (+ = sağa)
const YONLER = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'];
const yonAdi = (deg) => YONLER[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const fmt1 = (x) => Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 1 });

const Q = (() => {
  const el = {
    root: document.querySelector('.qibla'), rot: $('dialRot'), kaaba: $('kaaba'), status: $('qStatus'),
    big: $('qBig'), sub: $('qSub'), btn: $('btnCompass'), gps: $('btnQGps'), help: $('qHelp'), live: $('qLive'),
  };
  let data = null;               // { bearing, declination, km, label, city?, src }
  let listening = false, heading = null, sx = 1, sy = 0, raf = 0, drawn = null, aligned = false, absSeen = false, noSensorTimer = 0;
  const helpText = el.help.textContent;
  const cards = [...document.querySelectorAll('#dialRot .card')];

  // Kadran çizgileri (bir kez)
  (() => {
    const ns = 'http://www.w3.org/2000/svg', g = $('ticks');
    for (let a = 0; a < 360; a += 5) {
      const major = a % 30 === 0, r = a * Math.PI / 180, r1 = major ? 132 : 140;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', (Math.sin(r) * r1).toFixed(1)); l.setAttribute('y1', (-Math.cos(r) * r1).toFixed(1));
      l.setAttribute('x2', (Math.sin(r) * 148).toFixed(1)); l.setAttribute('y2', (-Math.cos(r) * 148).toFixed(1));
      l.setAttribute('class', major ? 'tick major' : 'tick');
      g.appendChild(l);
    }
  })();

  function bearingTo(lat, lon) {
    const p1 = lat * Math.PI / 180, p2 = KAABA[0] * Math.PI / 180, dl = (KAABA[1] - lon) * Math.PI / 180;
    const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return { bearing: Math.round(((b * 180 / Math.PI) + 360) % 360 * 10) / 10, km: Math.round(6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))) };
  }
  function readQb(cityId) {
    const [id, b, d, km] = (sget(C_QB) || '').split('|');
    if (Number(id) !== cityId || b === undefined) return null;
    return { bearing: Number(b), declination: d === '' ? null : Number(d), km: Number(km) };
  }
  function saveQb(cityId, r) {
    sset(C_QB, `${cityId}|${r.bearing}|${r.declination ?? ''}|${r.km}`, 365 * 86400);
  }

  function status(msg) { setText(el.status, msg); }

  async function load() {
    const loc = readLoc();
    if (!loc) { status('Önce konum seçin ya da “GPS ile hassas konum”a basın.'); return; }
    if (data && data.src === 'gps') return;                         // GPS seçildiyse onu koru
    if (data && data.city === loc.i) { paint(); return; }
    const label = title(loc.n);
    const cached = readQb(loc.i);
    if (cached) { data = { ...cached, label, city: loc.i, src: 'city' }; paint(); return; }
    status('Kıble yönü hesaplanıyor…');
    try {
      const r = await api(`/api/qibla?city=${loc.i}`);
      saveQb(loc.i, r);
      data = { bearing: r.bearing, declination: r.declination, km: r.km, label, city: loc.i, src: 'city' };
      paint();
    } catch (e) {
      status(`${e.message}. “GPS ile hassas konum” ile deneyin.`);
    }
  }

  async function useGps() {
    el.gps.disabled = true;
    status('Konum alınıyor…');
    try {
      let pos;
      try { pos = await getPosition(true); } catch (e) { throw new Error(geoError(e)); }
      const { latitude: la, longitude: lo, accuracy } = pos.coords;
      let r;
      try { r = await api(`/api/qibla?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}`); }
      catch { r = { ...bearingTo(la, lo), declination: data ? data.declination : null }; }   // çevrimdışı: cihazda hesapla
      data = { bearing: r.bearing, declination: r.declination, km: r.km, label: `GPS (±${Math.round(accuracy)} m)`, src: 'gps' };
      paint();
    } catch (e) {
      status(e.message);
    } finally {
      el.gps.disabled = false;
    }
  }

  function paint() {
    if (!data) return;
    status(`Konum: ${data.label}`);
    el.kaaba.setAttribute('transform', `rotate(${data.bearing})`);
    // Hem gerçek kuzeye göre (harita) hem pusulaya göre (manyetik) açı: diğer uygulamalarla karşılaştırma için
    // Telefonun kendi Pusula uygulamasıyla karşılaştırmak için: “Gerçek Kuzey” açıksa ilk, kapalıysa ikinci değer
    const magDeg = data.declination != null ? ((data.bearing - data.declination) % 360 + 360) % 360 : null;
    setText(el.sub, `Kıble yönü: ${yonAdi(data.bearing)} (${fmt1(data.bearing)}°) · Kâbe'ye ${Number(data.km).toLocaleString('tr-TR')} km`
      + (magDeg !== null ? ` · Pusula uygulamasında ${Math.round(data.bearing)}° (Gerçek Kuzey açık) ya da ${Math.round(magDeg)}° (kapalı)` : ''));
    aligned = null;
    draw();
  }

  // ---- pusula
  // iPhone (webkitCompassHeading) ve Android (deviceorientationabsolute) MANYETİK kuzeyi verir
  // (WebKit kaynağı: CLHeading.magneticHeading). Manyetik sapma eklenerek gerçek kuzeye çevrilir.
  let lastT = 0, accuracy = null, lastVibe = -Infinity;
  const ENTER = 3, LEAVE = 6;            // "dönüksünüz": 3°'ye girince açılır, 6°'yi aşınca kapanır (titreşmesin)
  const BAD_ACC = 20;                    // iPhone hassasiyeti ±20°'den kötüyse onay verilmez
  function feed(magHeading, acc = null) {
    const so = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    let h = (magHeading + so + 360) % 360;
    if (data && data.declination != null) h = (h + data.declination + 360) % 360;   // manyetik → gerçek kuzey
    accuracy = acc;
    const r = h * Math.PI / 180, now = performance.now();
    if (heading === null) { sx = Math.cos(r); sy = Math.sin(r); setText(el.help, helpText); }
    else {
      // zamana bağlı yumuşatma (≈0,25 sn): olay sıklığı ne olursa olsun aynı davranır
      const a = 1 - Math.exp(-Math.min(0.5, (now - lastT) / 1000) / 0.25);
      sx += (Math.cos(r) - sx) * a; sy += (Math.sin(r) - sy) * a;
    }
    lastT = now;
    heading = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function onAbs(e) { if (e.alpha == null) return; absSeen = true; feed((360 - e.alpha) % 360); }
  function onRel(e) {
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {      // iPhone
      feed(e.webkitCompassHeading, typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null);
    } else if (e.absolute && e.alpha != null && !absSeen) {
      feed((360 - e.alpha) % 360);
    }
  }

  function draw() {
    raf = 0;
    const h = heading === null ? 0 : heading;                        // pusula yoksa kuzey yukarıda
    if (drawn === null || Math.abs(angleDiff(h, drawn)) > 0.2) {
      // SVG özniteliğiyle döndür (Safari'de CSS dönüşümünden daha güvenilir)
      el.rot.setAttribute('transform', `rotate(${(-h).toFixed(1)})`);
      // K/D/G/B harfleri kadranla dönmesin, hep dik okunsun
      cards.forEach((t) => t.setAttribute('transform', `rotate(${h.toFixed(1)} ${t.getAttribute('x')} ${t.getAttribute('y')})`));
      drawn = h;
    }
    if (!data) return;
    if (heading === null) { setText(el.big, `${fmt1(data.bearing)}°`); setText(el.live, ''); return; }
    const badAcc = accuracy !== null && (accuracy < 0 || accuracy > BAD_ACC);
    setText(el.live, `Telefonun baktığı yön: ${Math.round(heading)}° (${yonAdi(heading)})` + (accuracy !== null && accuracy >= 0 ? ` · hassasiyet ±${Math.round(accuracy)}°` : ''));
    const diff = angleDiff(data.bearing, heading);
    const ok = !badAcc && (aligned ? Math.abs(diff) <= LEAVE : Math.abs(diff) <= ENTER);
    if (ok !== aligned) {
      aligned = ok;
      el.root.classList.toggle('aligned', ok);
      if (ok && navigator.vibrate && performance.now() - lastVibe > 3000) { navigator.vibrate(60); lastVibe = performance.now(); }
    }
    if (badAcc) {
      setText(el.big, 'Pusula kalibre değil');
      setText(el.help, 'Telefonu havada “8” çizer gibi birkaç kez çevirin; metal eşyalardan ve kılıflardaki mıknatıslardan uzaklaşın. iPhone: Ayarlar › Gizlilik ve Güvenlik › Konum Servisleri › Sistem Servisleri › “Pusula Kalibrasyonu” açık olmalı.');
      return;
    }
    if (el.help.textContent !== helpText) setText(el.help, helpText);
    setText(el.big, ok ? 'Kıbleye dönüksünüz ✓' : `${Math.round(Math.abs(diff))}° ${diff > 0 ? 'sağa' : 'sola'} dönün`);
  }

  async function start(auto = false) {
    if (listening) return;
    if (typeof DeviceOrientationEvent === 'undefined') { setText(el.help, noSensorMsg()); el.btn.hidden = true; return; }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS dokunuş olmadan izin istemeye izin vermez -> düğme gösterilir; Chrome hemen 'granted' döner
      let res;
      try { res = await DeviceOrientationEvent.requestPermission(); } catch { res = 'needs-tap'; }
      if (res !== 'granted') {
        el.btn.hidden = false;
        if (!auto) setText(el.help, res === 'denied'
          ? 'Pusula izni verilmedi. iPhone: Ayarlar › Safari › “Hareket ve Yönelim Erişimi”ni açıp sayfayı yenileyin.'
          : '“Pusulayı başlat” düğmesine dokunarak izin verin.');
        return;
      }
    }
    window.addEventListener('deviceorientationabsolute', onAbs);
    window.addEventListener('deviceorientation', onRel);
    listening = true;
    el.btn.hidden = true;
    setText(el.help, helpText);
    clearTimeout(noSensorTimer);
    // 3 sn içinde veri gelmezse yalnızca bilgi ver; dinlemeye devam et (bazı sensörler geç açılır)
    noSensorTimer = setTimeout(() => { if (heading === null) setText(el.help, noSensorMsg()); }, 3000);
  }
  function noSensorMsg() {
    return data
      ? `Bu cihazda pusula verisi alınamadı. Kuzeyi bulup saat yönünde ${fmt1(data.bearing)}° dönün (kadranda Kâbe simgesinin gösterdiği yön).`
      : 'Bu cihazda pusula verisi alınamadı.';
  }
  function stop() {
    window.removeEventListener('deviceorientationabsolute', onAbs);
    window.removeEventListener('deviceorientation', onRel);
    listening = false; heading = null; absSeen = false; accuracy = null; aligned = null;
    el.root.classList.remove('aligned');
    if (raf) cancelAnimationFrame(raf); raf = 0;
    clearTimeout(noSensorTimer);
  }
  function show() {
    load();
    start(true);           // Android/Chrome: hemen başlar. iPhone: "Pusulayı başlat" düğmesi kalır.
  }
  function reset() { data = null; }

  el.btn.addEventListener('click', () => start(false));
  el.gps.addEventListener('click', useGps);
  return { show, stop, reset };
})();

/* ------------------------------------------------------------ sekmeler */
const VIEWS = { times: ['viewTimes', 'tabTimes'], qibla: ['viewQibla', 'tabQibla'], kaza: ['viewKaza', 'tabKaza'], hatim: ['viewHatim', 'tabHatim'], kitap: ['viewKitap', 'tabKitap'] };
function setView(v) {
  S.view = v;
  for (const [k, [view, tab]] of Object.entries(VIEWS)) {
    $(view).hidden = k !== v;
    if (k === v) $(tab).setAttribute('aria-current', 'page'); else $(tab).removeAttribute('aria-current');
  }
  $('storeInfo').hidden = v !== 'times';
  if (v === 'qibla') { document.title = 'Kıble · Namaz Vakitleri'; Q.show(); } else Q.stop();
  if (v === 'times') tick();
  if (v === 'kaza') { document.title = 'Kaza · Namaz Vakitleri'; window.Kaza?.show(); }
  if (v === 'hatim') { document.title = 'Hatim · Namaz Vakitleri'; window.Hatim?.show(); }
  if (v === 'kitap') { document.title = 'Kitaplar · Namaz Vakitleri'; window.Kitap?.show(); }
  if (v !== 'times') window.scrollTo(0, 0);
}
const route = () => {
  const h = location.hash;
  setView(h === '#kible' ? 'qibla' : h === '#kaza' ? 'kaza' : h.startsWith('#hatim') ? 'hatim' : h.startsWith('#kitap') ? 'kitap' : 'times');
};
/* Paylaşılan hatim linki: /h/<kod>  (yönetici linki: /h/<kod>#k=<anahtar>) → Hatim sekmesinde açılır */
S.hatimLink = null;
{
  const m = location.pathname.match(/^\/h\/([A-Za-z0-9]{10})\/?$/);
  if (m) {
    const k = (location.hash.match(/^#k=([A-Za-z0-9_-]{16,40})$/) || [])[1] || null;
    S.hatimLink = { id: m[1], key: k };
    history.replaceState(null, '', '/#hatim');
  }
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ Siri / Google: sesli kalan süre */
function deviceTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul'; } catch { return 'Europe/Istanbul'; }
}
/* Siri, uygulamadaki ilçeyi kullanır: telefona özel rastgele anahtar + ilçe sunucuya bildirilir
 * (yalnızca ilçe değişince, tek küçük istek). Kestirme bu anahtarla sorar; konum gerekmez. */
function siriKey() {
  let k = sget('nv_key');
  if (!k || !/^[A-Za-z0-9_-]{16,40}$/.test(k)) {
    const b = new Uint8Array(18); crypto.getRandomValues(b);
    k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sset('nv_key', k, 3650 * 86400);
  }
  return k;
}
let linkBusy = false;
async function syncLink() {
  const loc = readLoc();
  if (!loc || linkBusy || !navigator.onLine) return false;
  const tz = deviceTz(), sig = `${loc.s}|${loc.i}|${tz}`;
  if (sget('nv_keysync') === sig) return true;          // sunucu zaten bu ilçeyi biliyor: istek yok
  linkBusy = true;
  try {
    const r = await fetch('/api/link', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: siriKey(), s: loc.s, i: loc.i, tz }) });
    if (r.ok) { sset('nv_keysync', sig, 3650 * 86400); return true; }
  } catch { /* çevrimdışı: sonraki açılışta */ } finally { linkBusy = false; }
  return false;
}
/* Kılavuz ve sesli cevap dili: tr / en (seçim telefonda saklanır) */
const isAndroid = /android/i.test(navigator.userAgent);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function guideLang() {
  const v = sget('nv_glang');
  if (v === 'tr' || v === 'en') return v;
  return 'tr';            // telefon İngilizce olsa da varsayılan Türkçe; EN yalnızca seçilirse
}
function siriUrl(lang = guideLang()) { return `${location.origin}/api/siri?k=${siriKey()}${lang === 'en' ? '&l=en' : ''}`; }

/* Sunucudaki Siri cümlesinin aynısı, telefondaki verilerden (internetsiz de çalışır) */
const NAMES_LOW = ['imsak', 'güneş', 'öğle', 'ikindi', 'akşam', 'yatsı'];
const NAMES_EN = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
function durTr(min) {
  if (min < 1) return '1 dakikadan az';
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h} saat ${m} dakika` : h ? `${h} saat` : `${m} dakika`;
}
function durEn(min) {
  if (min < 1) return 'less than a minute';
  const h = Math.floor(min / 60), m = min % 60, p = [];
  if (h) p.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) p.push(`${m} minute${m > 1 ? 's' : ''}`);
  return p.join(' ');
}
function speechText(lang = guideLang()) {
  const loc = readLoc(), place = loc ? title(loc.n) : '';
  const now = Date.now(), today = todayKey();
  for (const d of S.days) {
    for (let i = 0; i < 6; i++) {
      const at = toEpoch(d.d, d.t[i]);
      if (at <= now) continue;
      const left = Math.floor((at - now) / 60000), tm = d.d !== today, t = d.t[i];
      if (lang === 'en') {
        if (i === 1) return `${place}. ${durEn(left)} until ${tm ? "tomorrow's " : ''}sunrise. Sunrise is at ${t}.`;
        return `${place}. ${durEn(left)} until ${tm ? "tomorrow's " : ''}${NAMES_EN[i]}. ${NAMES_EN[i]} is at ${t}.`;
      }
      if (i === 1) return `${place}. ${tm ? 'Yarın güneşin' : 'Güneşin'} doğmasına ${durTr(left)} kaldı. Güneş saat ${t}.`;
      return `${place}. ${tm ? 'Yarın ' + NAMES_LOW[i] : NAMES[i]} vaktine ${durTr(left)} kaldı. ${NAMES[i]} saat ${t}.`;
    }
  }
  return lang === 'en' ? `${place}. Prayer times are not loaded yet.` : `${place}. Vakitler henüz yüklenmedi.`;
}

/* Sesli okuma. Chrome bazı telefonlarda dokunmadan ses çalmaya izin vermez:
 * o zaman ekranda "Kalan süreyi dinle" düğmesi çıkar, tek dokunuş yeter. */
const Say = {
  ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  speak(fromUser = false) {
    const lang = guideLang();
    if (!this.ok) { if (fromUser) toast(lang === 'en' ? 'This browser cannot speak.' : 'Bu tarayıcı sesli okuyamıyor.'); return; }
    if (!S.days.length) { if (fromUser) toast(speechText(lang)); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speechText(lang));
    u.lang = lang === 'en' ? 'en-US' : 'tr-TR';
    const v = synth.getVoices().find((x) => (x.lang || '').toLowerCase().replace('_', '-').startsWith(lang));
    if (v) u.voice = v;
    let started = false;
    u.onstart = () => { started = true; $('sayBar').hidden = true; };
    u.onerror = () => { if (!started && !fromUser) this.offer(); };
    synth.speak(u);
    if (!fromUser) setTimeout(() => { if (!started) this.offer(); }, 2500);
  },
  offer() {
    $('sayBarT').textContent = guideLang() === 'en' ? 'Hear the time left' : 'Kalan süreyi dinle';
    $('sayBar').hidden = false;
    clearTimeout(this._t); this._t = setTimeout(() => { $('sayBar').hidden = true; }, 30000);
  },
};
$('btnSay').addEventListener('click', () => { $('sayBar').hidden = true; Say.speak(true); });
$('btnSayX').addEventListener('click', () => { $('sayBar').hidden = true; });
if (Say.ok) { try { speechSynthesis.getVoices(); speechSynthesis.addEventListener?.('voiceschanged', () => {}); } catch { /* yok */ } }

/* Ne zaman kendiliğinden söylenir:
 *  - ikon kısayolu "Kalan süreyi söyle" (/?say=1) ile açılınca,
 *  - "Açılınca sesli söyle" açıksa: yüklü uygulama açılınca ya da 30 sn'den uzun arkadan öne gelince
 *    ("Hey Google, Namaz'ı aç"). */
S.sayPending = new URLSearchParams(location.search).has('say')
  || (sget('nv_say') === '1' && isStandaloneApp() && location.hash !== '#kible');
if (location.search) history.replaceState(null, '', location.pathname + location.hash);
function isStandaloneApp() {
  return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
function maybeSay() {
  if (!S.sayPending || !S.days.length) return;
  S.sayPending = false;
  setView('times');
  Say.speak(false);
}

/* Kart: platforma göre metin; dokununca kılavuz (static/guide.js) */
(function cardText() {
  const t = isIOS ? ['Siri ile sor', '“Hey Siri, Namaz” deyince kalan süreyi söylesin']
    : isAndroid ? ['Google ile sor', '“Hey Google, Namaz\'ı aç” deyince kalan süreyi söylesin']
      : ['Sesli asistana ekle', 'iPhone (Siri) ve Android (Google) için adım adım kılavuz'];
  $('siriCardT').textContent = t[0]; $('siriCardS').textContent = t[1];
})();
$('btnSiri').addEventListener('click', () => { syncLink(); if (window.Guide) window.Guide.open(); });

/* ------------------------------------------------------------ uygulamayı yükle
 * Android/Chrome/Edge: tarayıcının kendi yükleme penceresi (beforeinstallprompt).
 * iPhone/iPad: Apple bu pencereye izin vermez -> "Paylaş › Ana Ekrana Ekle" adımları gösterilir.
 * Uygulama zaten yüklüyse (ana ekrandan açıldıysa) düğme hiç görünmez.
 */
const isStandalone = isStandaloneApp;
let installEvt = null;
function updateInstallBtn() { $('btnInstall').hidden = isStandalone() || !(installEvt || isIOS); }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; updateInstallBtn(); if (window.Guide) window.Guide.refresh(); });
window.addEventListener('appinstalled', () => { installEvt = null; updateInstallBtn(); toast('Uygulama yüklendi'); if (window.Guide) window.Guide.refresh(); });
async function doInstall() {
  if (installEvt) {
    installEvt.prompt();
    try { const { outcome } = await installEvt.userChoice; if (outcome === 'accepted') installEvt = null; } catch { /* yok */ }
    updateInstallBtn();
    return;
  }
  $('installIos').hidden = !isIOS; $('installOther').hidden = isIOS;
  $('installDlg').showModal();
}
$('btnInstall').addEventListener('click', doInstall);
$('btnInstallClose').addEventListener('click', () => $('installDlg').close());
updateInstallBtn();

/* Onay / seçim penceresi (kaza ve hatim sekmeleri kullanır) */
function ask({ title, text = '', buttons = [{ label: 'Tamam', value: 'ok' }], input = null }) {
  const dlg = $('askDlg');
  $('askT').textContent = title;
  $('askP').textContent = text; $('askP').hidden = !text;
  const ta = $('askIn'); ta.hidden = input === null; ta.value = input || '';
  const box = $('askBtns'); box.innerHTML = '';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn' + (b.cls ? ' ' + b.cls : '');
      el.textContent = b.label;
      el.addEventListener('click', () => { finish(input !== null && b.value !== null ? { value: b.value, text: ta.value } : b.value); dlg.close(); });
      box.appendChild(el);
    }
    dlg.addEventListener('close', () => finish(null), { once: true });
    dlg.showModal();
  });
}

/* static/guide.js, kaza.js, hatim.js'in kullandığı küçük arayüz */
window.App = {
  lang: guideLang, setLang: (l) => sset('nv_glang', l, 3650 * 86400),
  siriUrl, syncLink, speechText, speak: () => Say.speak(true),
  sayOn: () => sget('nv_say') === '1', setSay: (on) => sset('nv_say', on ? '1' : '0', 3650 * 86400),
  isIOS, isAndroid, isStandalone: isStandaloneApp, canInstall: () => !!installEvt, install: doInstall,
  place: () => { const l = readLoc(); return l ? title(l.n) : ''; }, toast,
  sget, sset, sdel, ask, view: () => S.view, takeHatimLink: () => { const x = S.hatimLink; S.hatimLink = null; return x; },
};

/* ------------------------------------------------------------ başlat */
route();
ensureData();
function startTimer() { if (!S.timer) S.timer = setInterval(tick, 1000); }
function stopTimer() { clearInterval(S.timer); S.timer = null; }
startTimer();
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopTimer(); Q.stop(); hiddenAt = Date.now(); return; }
  // "Hey Google, Namaz'ı aç" arkadaki uygulamayı öne getirir: 30 sn'den uzun aradan sonra yine söyle
  if (hiddenAt && Date.now() - hiddenAt > 30e3 && sget('nv_say') === '1' && isStandaloneApp()) S.sayPending = true;
  startTimer(); ensureData();
  if (S.view === 'qibla') Q.show();
});
window.addEventListener('online', () => { if (S.pendingOnline) { S.pendingOnline = false; ensureData(); } });

/* ------------------------------------------------------------ güncelleme
 * Uyarı YALNIZCA açık olan sayfa eski sürümken yeni sürüm devreye girdiğinde çıkar:
 * ilk kurulumda ya da güncelleme yokken hiçbir şey gösterilmez.
 */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;   // false = ilk kurulum
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('updateBar').hidden = false;
  });
  $('btnUpdate').addEventListener('click', () => location.reload());
  $('btnUpdateX').addEventListener('click', () => { $('updateBar').hidden = true; });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // Güncelleme kontrolü en fazla günde bir (değişmediyse sunucu gövdesiz 304 döner)
      const last = Number(sget('nv_swchk') || 0);
      if (Date.now() - last > 24 * 3600e3) {
        sset('nv_swchk', String(Date.now()), 7 * 86400);
        reg.update().catch(() => {});
      }
    } catch { /* desteklenmiyor */ }
  });
}
