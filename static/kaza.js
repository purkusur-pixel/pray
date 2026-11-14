/* Kaza namazı / orucu takibi — tamamen telefonda (sunucuya hiçbir şey gönderilmez).
 * nv_kaza = {"v":{sabah:480,...}, "t":{sabah:<son değişiklik ms>,...}}
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = () => window.App;
  const KEY = 'nv_kaza';
  const ITEMS = [
    ['sabah', 'Sabah'], ['ogle', 'Öğle'], ['ikindi', 'İkindi'], ['aksam', 'Akşam'],
    ['yatsi', 'Yatsı'], ['vitr', 'Vitir'], ['oruc', 'Oruç'],
  ];
  const NAMAZ = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi', 'vitr'];
  const MAX = 99999;
  const NAME = Object.fromEntries(ITEMS);

  let st = null;          // {v, t}
  const undo = [];        // önceki durumlar (yalnızca bu oturum)
  let calcRes = null;

  function load() {
    try { st = JSON.parse(A().sget(KEY) || 'null'); } catch { st = null; }
    if (!st || typeof st !== 'object') st = {};
    st.v = st.v || {}; st.t = st.t || {};
    for (const [k] of ITEMS) st.v[k] = Math.max(0, Math.min(MAX, parseInt(st.v[k], 10) || 0));
  }
  function save() { A().sset(KEY, JSON.stringify(st), 3650 * 86400); }
  function snapshot() {
    undo.push(JSON.stringify(st));
    if (undo.length > 50) undo.shift();
    $('kzUndo').disabled = false;
  }
  function change(k, val, record = true) {
    val = Math.max(0, Math.min(MAX, Math.round(val)));
    if (val === st.v[k]) return false;
    if (record) snapshot();
    st.v[k] = val; st.t[k] = Date.now();
    save(); renderItem(k); renderSummary();
    return true;
  }

  const fmtN = (n) => n.toLocaleString('tr-TR');
  function fmtT(ms) {
    if (!ms) return 'henüz değişmedi';
    const d = new Date(ms);
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------------------------------------ kartlar */
  function build() {
    $('kzGrid').innerHTML = ITEMS.map(([k, n]) => `
      <div class="kz-item${k === 'oruc' ? ' kz-oruc' : ''}" data-k="${k}">
        <div class="kz-name">${n}</div>
        <button class="kz-num" type="button" data-edit="${k}" aria-label="${n} sayısını düzenle"></button>
        <div class="kz-time"></div>
        <div class="kz-btns">
          <button class="kz-b" type="button" data-k="${k}" data-d="-1" aria-label="${n}: bir azalt (kıldım)">−</button>
          <button class="kz-b" type="button" data-k="${k}" data-d="1" aria-label="${n}: bir artır">+</button>
        </div>
      </div>`).join('');
    for (const [k] of ITEMS) renderItem(k);
  }
  function renderItem(k) {
    const el = $('kzGrid').querySelector(`[data-k="${k}"].kz-item`);
    if (!el) return;
    el.querySelector('.kz-num').textContent = fmtN(st.v[k]);
    el.querySelector('.kz-time').textContent = fmtT(st.t[k]);
    el.classList.toggle('zero', st.v[k] === 0);
  }
  function renderSummary() {
    const nam = NAMAZ.reduce((a, k) => a + st.v[k], 0);
    $('kzTotal').textContent = nam || st.v.oruc
      ? `${fmtN(nam)} vakit namaz${st.v.oruc ? ` · ${fmtN(st.v.oruc)} gün oruç` : ''}` : 'Borç yok';
    // Ne zaman biter
    const per = Math.max(1, Math.min(20, parseInt($('kzPerDay').value, 10) || 1));
    const maxN = Math.max(...NAMAZ.map((k) => st.v[k]));
    let out;
    if (!maxN) out = st.v.oruc ? `Namaz borcunuz yok. Oruç: ${fmtN(st.v.oruc)} gün.` : 'Kaza borcunuz görünmüyor. Allah kabul etsin.';
    else {
      const days = Math.ceil(maxN / per);
      const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30), d = days % 365 % 30;
      const parts = [y && `${y} yıl`, m && `${m} ay`, d && `${d} gün`].filter(Boolean).join(' ');
      const end = new Date(Date.now() + days * 86400000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      out = `Her gün ${per} günlük kaza (her vakitten ${per}) kılarsanız yaklaşık <b>${parts}</b> sonra, <b>${end}</b> civarında biter.`;
    }
    $('kzPlanOut').innerHTML = out;
  }

  /* ± düğmeleri: dokun = 1, basılı tut = hızlanarak tekrar */
  let hold = null;
  function stopHold() { if (hold) { clearTimeout(hold.t); hold = null; } }
  $('kzGrid').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.kz-b'); if (!b) return;
    e.preventDefault();
    const k = b.dataset.k, d = +b.dataset.d;
    snapshot();
    change(k, st.v[k] + d, false);
    navigator.vibrate?.(8);
    let n = 0;
    const step = () => {
      n++;
      const amount = n > 25 ? 10 : 1;
      change(k, st.v[k] + d * amount, false);
      hold.t = setTimeout(step, n > 8 ? 60 : 140);
    };
    hold = { t: setTimeout(step, 450) };
    b.setPointerCapture?.(e.pointerId);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('kzGrid').addEventListener(ev, stopHold);
  $('kzGrid').addEventListener('contextmenu', (e) => { if (e.target.closest('.kz-b')) e.preventDefault(); });
  $('kzGrid').addEventListener('keydown', (e) => {          // klavye: Enter/Space
    const b = e.target.closest('.kz-b');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); change(b.dataset.k, st.v[b.dataset.k] + +b.dataset.d); }
  });

  /* Sayıya dokununca tam değer */
  let editK = null;
  $('kzGrid').addEventListener('click', (e) => {
    const n = e.target.closest('[data-edit]'); if (!n) return;
    editK = n.dataset.edit;
    $('kzEditT').textContent = NAME[editK] + (editK === 'oruc' ? ' (gün)' : '');
    $('kzEditV').value = st.v[editK];
    $('kzEditDlg').showModal();
    $('kzEditV').select();
  });
  $('kzEditDlg').addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]'); if (!q) return;
    const inp = $('kzEditV');
    inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + +q.dataset.q);
  });
  $('kzEditDlg').addEventListener('close', () => {
    if ($('kzEditDlg').returnValue === 'ok' && editK) {
      const v = parseInt($('kzEditV').value, 10);
      if (!Number.isNaN(v)) change(editK, v);
    }
    editK = null;
  });

  $('kzUndo').addEventListener('click', () => {
    const prev = undo.pop();
    if (prev) { st = JSON.parse(prev); save(); build(); renderSummary(); A().toast('Son değişiklik geri alındı'); }
    $('kzUndo').disabled = !undo.length;
  });
  $('kzCalcBtn').addEventListener('click', () => {
    $('kzCalc').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ($('kzDur').hidden ? $('kzFrom') : $('kzY')).focus({ preventScroll: true }), 400);
  });
  $('kzPerDay').addEventListener('input', () => { A().sset('nv_kzper', $('kzPerDay').value, 3650 * 86400); renderSummary(); });

  /* ------------------------------------------------------------ hesapla */
  let mode = 'dur';
  document.querySelectorAll('[data-kzm]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.kzm;
    document.querySelectorAll('[data-kzm]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('kzDur').hidden = mode !== 'dur'; $('kzDates').hidden = mode !== 'date'; $('kzDatesNote').hidden = mode !== 'date';
    $('kzRes').hidden = true;
  }));
  const num = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
  $('kzDo').addEventListener('click', () => {
    let days;
    if (mode === 'dur') days = num('kzY') * 365 + num('kzM') * 30 + num('kzD');
    else {
      const f = $('kzFrom').value, t = $('kzTo').value;
      if (!f || !t) { A().toast('Başlangıç ve bitiş tarihini seçin'); return; }
      days = Math.round((Date.parse(t) - Date.parse(f)) / 86400000);
      if (days <= 0) { A().toast('Bitiş tarihi başlangıçtan sonra olmalı'); return; }
    }
    if (!days) { A().toast('Süre girin'); return; }
    const nd = Math.max(0, days - num('kzMinus'));
    calcRes = {};
    for (const k of NAMAZ) calcRes[k] = k === 'vitr' && !$('kzVitr').checked ? 0 : nd;
    calcRes.oruc = $('kzOruc').checked ? Math.round(days * 30 / 365) : 0;
    $('kzResList').innerHTML = `<p class="kz-small">${fmtN(days)} gün${num('kzMinus') ? ` (namaz için ${fmtN(nd)} gün)` : ''}:</p>` +
      ITEMS.map(([k, n]) => `<div><span>${n}</span><b>${fmtN(calcRes[k])}</b></div>`).join('');
    $('kzRes').hidden = false;
  });
  async function apply(add) {
    if (!calcRes) return;
    const has = ITEMS.some(([k]) => st.v[k]);
    if (!add && has) {
      const ok = await A().ask({ title: 'Mevcut sayılar silinsin mi?', text: 'Hesaplanan değerler şimdiki sayıların yerine yazılacak.',
        buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Yerine yaz', value: 'ok' }] });
      if (ok !== 'ok') return;
    }
    snapshot();
    for (const [k] of ITEMS) {
      const val = add ? st.v[k] + calcRes[k] : calcRes[k];
      if (val !== st.v[k] && (add ? calcRes[k] : true)) { st.v[k] = Math.min(MAX, val); st.t[k] = Date.now(); }
    }
    save(); build(); renderSummary();
    $('kzRes').hidden = true;
    A().toast(add ? 'Kazalarınıza eklendi' : 'Kazalarınız güncellendi');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('kzAdd').addEventListener('click', () => apply(true));
  $('kzSet').addEventListener('click', () => apply(false));

  /* ------------------------------------------------------------ yedek / sıfırla */
  $('kzBackup').addEventListener('click', async () => {
    const code = 'KAZA1:' + btoa(unescape(encodeURIComponent(JSON.stringify(st))));
    try { await navigator.clipboard.writeText(code); A().toast('Yedek kodu kopyalandı — not defterine ya da kendinize mesaj olarak kaydedin'); }
    catch { await A().ask({ title: 'Yedek kodu', text: 'Kodu seçip kopyalayın ve güvenli bir yere kaydedin.', input: code, buttons: [{ label: 'Kapat', value: 'ok' }] }); }
  });
  $('kzRestore').addEventListener('click', async () => {
    const r = await A().ask({ title: 'Yedekten geri yükle', text: '“KAZA1:” ile başlayan yedek kodunu yapıştırın. Şimdiki sayıların yerine geçer.',
      input: '', buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Geri yükle', value: 'ok' }] });
    if (!r || r.value !== 'ok') return;
    try {
      // Mesajlaşma uygulamalarından gelen fazlalıklar (öndeki/arkadaki yazı, satır bölme, *kalın*, URL-güvenli base64) tolere edilir
      const m = String(r.text || '').match(/KAZA1\s*:\s*([\s\S]+)/i);
      if (!m) throw new Error();
      // satırlara bölünmüş olabilir: parçaları sırayla ekleyip ilk çözülen hâli al (arkadaki yazı karışmaz)
      const parts = m[1].split(/\s+/).map((x) => x.replace(/[^A-Za-z0-9+/=_-]/g, '')).filter(Boolean);
      let data = null;
      for (let n = 1; n <= parts.length && !data; n++) {
        let b64 = parts.slice(0, n).join('').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
        b64 += '='.repeat((4 - (b64.length % 4)) % 4);
        try { data = JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch { /* bir parça daha ekle */ }
      }
      if (!data || typeof data.v !== 'object' || Array.isArray(data.v)) throw new Error();
      const v = {}, t = {};
      for (const [k] of ITEMS) {
        const n = Math.round(Number(data.v[k]) || 0); v[k] = Math.max(0, Math.min(99999, n));
        if (data.t && Number.isFinite(+data.t[k])) t[k] = +data.t[k];
      }
      snapshot();
      A().sset(KEY, JSON.stringify({ v, t }), 3650 * 86400);
      load(); save(); build(); renderSummary();
      A().toast('Yedek geri yüklendi');
    } catch { A().toast('Kod okunamadı. Tamamını kopyaladığınızdan emin olun.'); }
  });
  $('kzReset').addEventListener('click', async () => {
    const ok = await A().ask({ title: 'Bütün kazalar sıfırlansın mı?', text: 'Tüm sayılar 0 olur. Hemen sonra “Geri al” ile dönebilirsiniz.',
      buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label: 'Sıfırla', value: 'ok', cls: 'danger' }] });
    if (ok !== 'ok') return;
    snapshot();
    for (const [k] of ITEMS) if (st.v[k]) { st.v[k] = 0; st.t[k] = Date.now(); }
    save(); build(); renderSummary();
  });

  /* ------------------------------------------------------------ başlat */
  let built = false;
  function show() {
    if (!A()) return;
    if (!built) {
      load();
      const per = A().sget('nv_kzper'); if (per) $('kzPerDay').value = per;
      build(); built = true;
    }
    renderSummary();
  }
  window.Kaza = { show };
  if (!$('viewKaza').hidden) show();
})();
