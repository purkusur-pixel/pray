/* Hatim dağıtma.
 * Telefonda: nv_hatim = [{id, key?, t, o}] (açtığınız/oluşturduğunuz hatimler; key yalnızca sahibinde),
 *            nv_hc_<id> = son görülen hatim (internetsiz gösterim + değişmediyse 304),
 *            nv_hname = adınız, nv_dev = bu telefonun rastgele kimliği.
 * Sunucuda: link başına tek kayıt (app/hatim.py).
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = () => window.App;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const YEAR = 3650 * 86400;

  /* ------------------------------------------------------------ yerel kayıtlar */
  const list = () => { try { const v = JSON.parse(A().sget('nv_hatim') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const saveList = (l) => A().sset('nv_hatim', JSON.stringify(l), YEAR);
  const entry = (id) => list().find((x) => x.id === id) || null;
  function upsert(id, patch) {
    const l = list(); const i = l.findIndex((x) => x.id === id);
    if (i >= 0) Object.assign(l[i], patch); else l.unshift({ id, key: null, t: '', ...patch });
    saveList(l);
  }
  function removeLocal(id) { saveList(list().filter((x) => x.id !== id)); try { A().sdel('nv_hc_' + id); } catch { /* yok */ } }
  const cacheGet = (id) => { try { return JSON.parse(A().sget('nv_hc_' + id) || 'null'); } catch { return null; } };
  const cacheSet = (id, h) => A().sset('nv_hc_' + id, JSON.stringify(h), YEAR);

  function devId() {
    let k = A().sget('nv_dev');
    if (!k || !/^[A-Za-z0-9_-]{16,40}$/.test(k)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      k = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      A().sset('nv_dev', k, YEAR);
    }
    return k;
  }
  let myTag = null;
  async function initTag() {
    myTag = A().sget('nv_htag');
    if (myTag) return;
    try {
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(devId()));
      myTag = [...new Uint8Array(d)].slice(0, 4).map((x) => x.toString(16).padStart(2, '0')).join('');
      A().sset('nv_htag', myTag, YEAR);
    } catch { /* güvenli olmayan bağlantı: sunucunun döndürdüğü etiket kullanılır */ }
  }

  /* ------------------------------------------------------------ sunucu */
  async function api(method, path, body, key) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Hatim-Key'] = key;
    let r;
    try { r = await fetch('/api/hatim' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch { const e = new Error('İnternet bağlantısı yok'); e.offline = true; throw e; }
    if (!r.ok) {
      let msg = 'İşlem yapılamadı';
      try { const j = await r.json(); if (j.detail) msg = typeof j.detail === 'string' ? j.detail : msg; } catch { /* yok */ }
      const e = new Error(msg); e.status = r.status; throw e;
    }
    return r.json();
  }
  /** Hatmi getir: değişmediyse sunucu 304 döner (gövdesiz). */
  async function fetchHatim(id) {
    const c = cacheGet(id);
    let r;
    try {
      r = await fetch('/api/hatim/' + id, { headers: c ? { 'If-None-Match': `"${c.v}"` } : {}, cache: 'no-cache' });
    } catch { return { h: c, offline: true }; }
    if (r.status === 304 && c) return { h: c };
    if (r.status === 404) return { gone: true, h: c };
    if (!r.ok) return { h: c, error: true };
    const h = await r.json();
    cacheSet(id, h);
    if (h.t && entry(id)?.t !== h.t) upsert(id, { t: h.t });
    return { h };
  }

  /* ------------------------------------------------------------ yardımcılar */
  const linkOf = (id) => `${location.origin}/h/${id}`;
  const adminLinkOf = (id, key) => `${location.origin}/h/${id}#k=${key}`;
  function duaText(dt) {
    if (!dt) return '';
    const d = new Date(dt + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    const s = d.toLocaleDateString((window.LOC || 'tr-TR'), { day: 'numeric', month: 'long', weekday: 'long' });
    if (diff > 1) return `Hatim duası: ${s} · ${diff} gün kaldı`;
    if (diff === 1) return `Hatim duası yarın: ${s}`;
    if (diff === 0) return 'Hatim duası bugün';
    return `Hatim duası ${s} günüydü`;
  }
  const stats = (r) => {
    const taken = r.c.filter(Boolean).length, read = r.c.filter((c) => c && c[0] === 2).length;
    return { taken, read, free: 30 - taken };
  };
  const currentRound = (h) => h.r.find((r) => !r.f) || h.r[h.r.length - 1];
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); A().toast(msg || 'Kopyalandı'); }
    catch { await A().ask({ title: 'Kopyalayın', text: 'Seçip kopyalayın:', input: text, buttons: [{ label: 'Kapat', value: 'ok' }] }); }
  }
  async function share(id, title) {
    const url = linkOf(id), text = `${title} — hatme katılın, bir cüz alın:`;
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy(`${text} ${url}`, 'Paylaşım metni kopyalandı');
  }

  /* ------------------------------------------------------------ pencereler (JS ile kurulur) */
  function makeDlg(id) {
    const d = document.createElement('dialog'); d.id = id;
    d.innerHTML = '<div class="picker"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    return d;
  }
  const linkDlg = makeDlg('hLinkDlg');
  const cuzDlg = makeDlg('hCuzDlg');

  function showLink(id, title, heading = 'Hatim oluşturuldu') {
    const url = linkOf(id);
    const wa = 'https://wa.me/?text=' + encodeURIComponent(`${title} — hatme katılın, bir cüz alın: ${url}`);
    linkDlg.firstChild.innerHTML = `
      <h2>${esc(heading)}</h2>
      <p class="ask-p">Hatmi dağıtmak için linkiniz:</p>
      <div class="h-linkbox">${esc(url)}</div>
      <div class="h-linkbtns">
        <button class="btn" type="button" data-a="share">Paylaş</button>
        <button class="btn ghost" type="button" data-a="copy">Linki kopyala</button>
        <a class="btn ghost" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      <p class="kz-small">Bu hatim “Hatimlerim” listenizde kalır; yönetim düğmeleri (tamamlandı, yeni hatim, link değiştir) yalnızca sizde görünür.</p>
      <div class="actions"><button class="btn" type="button" data-a="ok">Devam et</button></div>`;
    linkDlg.firstChild.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'share') share(id, title);
      else if (a === 'copy') { copy(url, 'Link kopyalandı'); e.target.textContent = 'Link kopyalandı ✓'; }
      else if (a === 'ok') linkDlg.close();
    };
    linkDlg.showModal();
  }

  /* ------------------------------------------------------------ liste */
  function renderList(update = true) {
    const l = list().sort((a, b) => (b.o || 0) - (a.o || 0));   // son açılan en üstte
    $('hEmpty').hidden = l.length > 0;
    $('hItems').innerHTML = l.map((x) => {
      const h = cacheGet(x.id);
      let sub = '';
      if (h && h.r?.length) {
        const r = currentRound(h), s = stats(r);
        sub = `${r.n}. hatim · ${s.taken}/30 alındı · ${s.read} okundu${r.f ? ' · tamamlandı ✓' : ''}`;
      }
      const dua = h ? duaText(h.dt) : '';
      return `<a class="card h-item" href="#hatim/${esc(x.id)}">
        <span class="h-item-main"><b>${esc(x.t || h?.t || 'Hatim')}</b>
          <small>${esc(sub || 'Açmak için dokunun')}</small>${dua ? `<small class="h-dua">${esc(dua)}</small>` : ''}</span>
        <span class="h-badge${x.key ? ' own' : ''}">${x.key ? 'Sizin' : 'Katılımcı'}</span></a>`;
    }).join('');
    // Arkada güncelle: değişmeyen hatim için sunucu 304 döner (gövdesiz). Değişen olursa liste bir kez yeniden çizilir.
    if (update && navigator.onLine && l.length) {
      Promise.all(l.map((x) => fetchHatim(x.id))).then(() => { if (curId === null && S_view() === 'hatim') renderList(false); });
    }
  }
  const S_view = () => A().view();

  /* ------------------------------------------------------------ ayrıntı */
  let curId = null, curH = null, gone = false, pollT = null;
  const hiddenRounds = new Set();       // `${id}:${n}` — gizlenen hatimler (bu oturum)
  const shownRounds = new Set();        // tamamlanmış ama açılan

  function isMine(c) { return c && myTag && c[2] === myTag; }

  function renderDetail() {
    const box = $('hDetail');
    const e = entry(curId), own = !!e?.key;
    if (gone) {
      box.innerHTML = `<button class="h-back" type="button" data-a="back">‹ Hatimlerim</button>
        <div class="card"><h3>${esc(e?.t || 'Hatim')}</h3>
        <p>Bu hatim silinmiş ya da linki değiştirilmiş. Hatmi oluşturan kişiden yeni linki isteyin.</p>
        <div class="actions left"><button class="btn ghost" type="button" data-a="forget">Listemden çıkar</button></div></div>`;
      return;
    }
    if (!curH) { box.innerHTML = `<button class="h-back" type="button" data-a="back">‹ Hatimlerim</button><p class="h-loading">Yükleniyor…</p>`; return; }
    const h = curH, cr = currentRound(h), s = stats(cr), pct = Math.round(s.taken / 30 * 100);
    const dua = duaText(h.dt);
    let html = `<button class="h-back" type="button" data-a="back">‹ Hatimlerim</button>
      <section class="h-hero">
        <h2>${esc(h.t)}</h2>${h.d ? `<p class="h-desc">${esc(h.d)}</p>` : ''}
        ${dua ? `<p class="h-dua-big">${esc(dua)}</p>` : ''}
      </section>
      <section class="card h-prog">
        <div class="h-prog-top"><span>${cr.n}. hatim · alınan cüzler</span><b>%${pct}</b></div>
        <div class="h-bar"><i style="width:${pct}%"></i><i class="r" style="width:${Math.round(s.read / 30 * 100)}%"></i></div>
        <div class="h-chips"><span>${s.free ? `${s.free} cüz boş` : 'Bütün cüzler alındı'}</span><span>${s.read} cüz okundu</span>
          ${cr.f ? '<span class="ok">Tamamlandı ✓</span>' : ''}</div>
        ${!s.free && !cr.f ? '<p class="h-elhamd">Elhamdülillah! Bütün cüzler alındı.</p>' : ''}
      </section>
      <div class="h-legend"><span><i class="lg-free"></i>Boş</span><span><i class="lg-take"></i>Okunuyor</span><span><i class="lg-read"></i>Okundu</span>
        <button class="btn ghost h-refresh" type="button" data-a="refresh">↻ Yenile</button></div>
      <p class="kz-small h-tip">Almak istediğiniz cüze dokunun. Aldığınız cüzü okuyunca yine dokunup “Okudum” deyin.</p>`;
    for (const r of h.r) {
      const k = `${curId}:${r.n}`;
      const hidden = r.f ? !shownRounds.has(k) : hiddenRounds.has(k);
      const st = stats(r);
      html += `<section class="h-round${r.f ? ' done' : ''}">
        <div class="h-rhead">
          ${own ? `<button class="h-rbtn" type="button" data-a="rdel" data-n="${r.n}">Sil</button>` : '<span></span>'}
          <b>${r.n}. Hatim <small>${r.f ? 'tamamlandı ✓' : `${st.taken}/30`}</small></b>
          <button class="h-rbtn gold" type="button" data-a="rtoggle" data-n="${r.n}">${hidden ? 'Göster' : 'Gizle'}</button>
        </div>`;
      if (!hidden) {
        html += '<div class="h-grid">' + r.c.map((c, i) => {
          const cls = !c ? 'free' : c[0] === 2 ? 'read' : 'take';
          const lab = !c ? 'Boş' : c[0] === 2 ? '✓ Okundu' : 'Okunuyor';
          return `<button type="button" class="h-cuz ${cls}${isMine(c) ? ' mine' : ''}" data-n="${r.n}" data-c="${i + 1}"
            aria-label="${i + 1}. cüz, ${c ? esc(c[1]) + ', ' + lab : 'boş'}">
            <span class="h-no">${i + 1}</span><span class="h-nm">${c ? esc(c[1]) : 'Boş'}</span>${c ? `<span class="h-st">${lab}</span>` : ''}</button>`;
        }).join('') + '</div>';
        if (own) {
          html += `<div class="actions left h-rown"><button class="btn ghost" type="button" data-a="rdone" data-n="${r.n}">
            ${r.f ? 'Tamamlandı işaretini kaldır' : '✓ Bu hatmi tamamlandı olarak işaretle'}</button></div>`;
        }
      }
      html += '</section>';
    }
    if (own) {
      html += `<section class="card h-admin"><h3>Yönetim <small>(yalnızca sizde görünür)</small></h3>
        <div class="h-admin-grid">
          <button class="btn" type="button" data-a="addround">+ Yeni hatim ekle</button>
          <button class="btn ghost" type="button" data-a="edit">Ayarlar</button>
          <button class="btn ghost" type="button" data-a="relink">Linki değiştir</button>
          <button class="btn ghost" type="button" data-a="adminlink">Yönetici linkini kopyala</button>
          <button class="btn ghost danger" type="button" data-a="delete">Hatmi sil</button>
        </div>
        <p class="kz-small">Otomatik yeni hatim: <b>${h.a ? 'açık' : 'kapalı'}</b>. “Linki değiştir” eski linki kapatır; hatim yeni linkle aynen devam eder.
          Yönetici linkiyle başka telefonunuzdan da yönetebilirsiniz — kimseyle paylaşmayın.</p></section>`;
    } else {
      html += `<div class="actions left"><button class="btn ghost" type="button" data-a="forget">Listemden çıkar</button></div>`;
    }
    html += `<div class="h-sharebar"><button class="btn" type="button" data-a="share">Paylaş</button>
      <button class="btn ghost" type="button" data-a="copy">Linki kopyala</button></div>`;
    box.innerHTML = html;
  }

  async function openDetail(id) {
    curId = id; gone = false; curH = cacheGet(id);
    upsert(id, { o: Date.now() });
    $('hList').hidden = true; $('hDetail').hidden = false;
    renderDetail(); window.scrollTo(0, 0);
    await refresh();
    startPoll();
  }
  async function refresh(manual) {
    if (!curId) return;
    const id = curId;
    const r = await fetchHatim(id);
    if (id !== curId) return;
    if (r.gone) gone = true;
    else if (r.h) curH = r.h;
    if (manual && r.offline) A().toast('İnternet yok — son görülen hali gösteriliyor');
    renderDetail();
  }
  function startPoll() {
    clearInterval(pollT);
    pollT = setInterval(() => { if (!document.hidden && curId && S_view() === 'hatim' && navigator.onLine) refresh(); }, 45000);
  }
  function closeDetail() { curId = null; curH = null; clearInterval(pollT); $('hDetail').hidden = true; $('hList').hidden = false; renderList(); }

  /* cüz işlemleri */
  async function cuzOp(n, c, op, name) {
    const e = entry(curId);
    try {
      const h = await api('POST', `/${curId}/cuz`, { r: n, c, op, name: name || '', dev: devId() }, e?.key);
      if (h.tag && !myTag) { myTag = h.tag; A().sset('nv_htag', h.tag, YEAR); }
      delete h.tag; curH = h; cacheSet(curId, h); renderDetail();
      navigator.vibrate?.(15);
    } catch (err) {
      A().toast(err.message);
      if (err.status === 409) refresh();
      if (err.status === 404) { gone = true; renderDetail(); }
    }
  }
  function cuzDialog(n, c) {
    const r = curH.r.find((x) => x.n === n); if (!r) return;
    const cur = r.c[c - 1], own = !!entry(curId)?.key, mine = isMine(cur);
    const p = cuzDlg.firstChild;
    if (cur && !mine && !own) {
      A().toast(`${c}. cüzü ${cur[1]} aldı (${cur[0] === 2 ? 'okundu' : 'okunuyor'})`);
      return;
    }
    if (!cur) {
      p.innerHTML = `<h2>${n}. hatim · ${c}. cüz</h2>
        <label>Adınız<input id="hcName" maxlength="30" autocomplete="name" placeholder="Listede görünecek ad"></label>
        <p class="picker-err" id="hcErr" hidden>Adınızı yazın.</p>
        <div class="h-cuzbtns"><button class="btn" type="button" data-op="take">Bu cüzü okuyacağım</button>
          <button class="btn ghost" type="button" data-op="read">Okudum, işaretle</button>
          <button class="btn ghost" type="button" data-op="x">Vazgeç</button></div>`;
      const inp = p.querySelector('#hcName'); inp.value = A().sget('nv_hname') || '';
      p.onclick = (e) => {
        const op = e.target.closest('[data-op]')?.dataset.op; if (!op) return;
        if (op === 'x') { cuzDlg.close(); return; }
        const name = inp.value.trim();
        if (!name) { p.querySelector('#hcErr').hidden = false; inp.focus(); return; }
        A().sset('nv_hname', name, YEAR);
        cuzDlg.close(); cuzOp(n, c, op, name);
      };
      cuzDlg.showModal();
      if (!inp.value) inp.focus();
      return;
    }
    const other = !mine && own;
    p.innerHTML = `<h2>${c}. cüz · ${esc(cur[1])}</h2>
      ${other ? '<p class="kz-small">Bu cüzü başkası aldı; hatmin sahibi olarak değiştiriyorsunuz.</p>' : ''}
      <p class="ask-p">${cur[0] === 2 ? 'Bu cüz okundu olarak işaretli.' : 'Cüzü okudunuz mu?'}</p>
      <div class="h-cuzbtns">
        ${cur[0] === 2 ? '<button class="btn ghost" type="button" data-op="unread">Okunmadı yap</button>'
          : '<button class="btn" type="button" data-op="read">Evet, okudum</button><button class="btn ghost" type="button" data-op="x">Hayır, henüz okuyorum</button>'}
        <button class="btn ghost danger" type="button" data-op="free">Cüzü bırak (boşalt)</button>
        ${cur[0] === 2 ? '<button class="btn ghost" type="button" data-op="x">Kapat</button>' : ''}
      </div>`;
    p.onclick = (e) => {
      const op = e.target.closest('[data-op]')?.dataset.op; if (!op) return;
      cuzDlg.close();
      if (op !== 'x') cuzOp(n, c, op);
    };
    cuzDlg.showModal();
  }

  /* yönetim */
  async function ownerOp(fn, okMsg) {
    try { const res = await fn(entry(curId).key); if (res && res.r) { curH = res; cacheSet(curId, res); } renderDetail(); if (okMsg) A().toast(okMsg); return res; }
    catch (err) { A().toast(err.message); if (err.status === 404) { gone = true; renderDetail(); } return null; }
  }
  $('hDetail').addEventListener('click', async (e) => {
    const cz = e.target.closest('.h-cuz');
    if (cz) { cuzDialog(+cz.dataset.n, +cz.dataset.c); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, n = +b.dataset.n, id = curId;
    const ask = (title, text, label, cls) => A().ask({ title, text, buttons: [{ label: 'Vazgeç', value: null, cls: 'ghost' }, { label, value: 'ok', cls }] });
    switch (a) {
      case 'back': location.hash = '#hatim'; break;
      case 'refresh': refresh(true); break;
      case 'share': share(id, curH?.t || 'Hatim'); break;
      case 'copy': copy(linkOf(id), 'Link kopyalandı'); break;
      case 'rtoggle': {
        const k = `${id}:${n}`, r = curH.r.find((x) => x.n === n);
        if (r?.f) { if (shownRounds.has(k)) shownRounds.delete(k); else shownRounds.add(k); }
        else if (hiddenRounds.has(k)) hiddenRounds.delete(k); else hiddenRounds.add(k);
        renderDetail(); break;
      }
      case 'rdone': {
        const r = curH.r.find((x) => x.n === n);
        ownerOp((key) => api('POST', `/${id}/round/${n}/done`, { f: !r.f }, key), r.f ? 'İşaret kaldırıldı' : `${n}. hatim tamamlandı olarak işaretlendi`);
        break;
      }
      case 'rdel':
        if (await ask(`${n}. hatim silinsin mi?`, 'Bu hatimdeki bütün cüz kayıtları silinir.', 'Sil', 'danger') === 'ok')
          ownerOp((key) => api('DELETE', `/${id}/round/${n}`, null, key), 'Silindi');
        break;
      case 'addround': ownerOp((key) => api('POST', `/${id}/round`, null, key), 'Yeni hatim eklendi'); break;
      case 'edit': openForm(curH); break;
      case 'adminlink':
        copy(adminLinkOf(id, entry(id).key), 'Yönetici linki kopyalandı — yalnızca kendi telefonunuzda açın'); break;
      case 'relink': {
        if (await ask('Link değiştirilsin mi?', 'Eski link çalışmaz; o linki kaydetmiş kişiler hatmi göremez. Hatim, cüzler ve isimler yeni linkle aynen devam eder. Yeni linki tekrar paylaşmanız gerekir.', 'Linki değiştir') !== 'ok') break;
        const res = await ownerOp((key) => api('POST', `/${id}/relink`, null, key));
        if (res && res.id) {
          const old = entry(id), c = cacheGet(id);
          removeLocal(id); upsert(res.id, { key: old.key, t: old.t, o: Date.now() });
          if (c) cacheSet(res.id, c);
          curId = res.id; history.replaceState(null, '', '#hatim/' + res.id);
          showLink(res.id, curH.t, 'Yeni link hazır');
        }
        break;
      }
      case 'delete':
        if (await ask('Hatim tamamen silinsin mi?', 'Link herkes için kapanır ve bütün kayıtlar sunucudan silinir. Geri alınamaz.', 'Sil', 'danger') !== 'ok') break;
        if (await ownerOp((key) => api('DELETE', `/${id}`, null, key)) !== null) { removeLocal(id); location.hash = '#hatim'; A().toast('Hatim silindi'); }
        break;
      case 'forget':
        if (await ask('Listenizden çıkarılsın mı?', 'Hatim silinmez; yalnızca bu telefondaki listenizden kalkar. Linki tekrar açarsanız geri gelir.', 'Çıkar') === 'ok') {
          removeLocal(id); location.hash = '#hatim';
        }
        break;
    }
  });

  /* ------------------------------------------------------------ oluştur / ayarlar */
  let formFor = null;     // null = yeni, yoksa düzenlenen hatim
  function openForm(h) {
    formFor = h || null;
    $('hFormT').textContent = h ? 'Hatim ayarları' : 'Yeni hatim dağıt';
    $('hfOk').textContent = h ? 'Kaydet' : 'Oluştur';
    $('hfT').value = h?.t || ''; $('hfD').value = h?.d || ''; $('hfDt').value = h?.dt || '';
    $('hfA').checked = !!h?.a; $('hfN').value = '1'; $('hfN').textContent = '1';
    $('hfNWrap').hidden = !!h; $('hfErr').hidden = true;
    $('hFormDlg').showModal();
  }
  $('hNew').addEventListener('click', () => openForm(null));
  $('hfCancel').addEventListener('click', () => $('hFormDlg').close());
  $('hFormDlg').addEventListener('click', (e) => {
    const st = e.target.closest('[data-st]'); if (!st) return;
    const v = Math.max(1, Math.min(5, (+$('hfN').textContent || 1) + +st.dataset.st));
    $('hfN').textContent = String(v);
  });
  $('hForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { t: $('hfT').value.trim(), d: $('hfD').value.trim(), dt: $('hfDt').value, a: $('hfA').checked };
    if (!body.t) { $('hfErr').textContent = 'Başlık yazın.'; $('hfErr').hidden = false; return; }
    $('hfOk').disabled = true;
    try {
      if (formFor) {
        await ownerOp((key) => api('PATCH', `/${curId}`, body, key), 'Ayarlar kaydedildi');
        upsert(curId, { t: body.t });
        $('hFormDlg').close();
      } else {
        const res = await api('POST', '', { ...body, n: +$('hfN').textContent || 1 });
        const { id, key } = res; delete res.id; delete res.key;
        upsert(id, { key, t: res.t, o: Date.now() }); cacheSet(id, res);
        $('hFormDlg').close();
        location.hash = '#hatim/' + id;
        showLink(id, res.t);
      }
    } catch (err) {
      $('hfErr').textContent = err.message; $('hfErr').hidden = false;
    } finally { $('hfOk').disabled = false; }
  });

  /* ------------------------------------------------------------ giriş */
  async function takeLink() {
    const x = A().takeHatimLink(); if (!x) return null;
    const ex = entry(x.id);
    if (!ex) upsert(x.id, { o: Date.now() });
    if (x.key && !ex?.key) {
      try {
        const r = await api('GET', `/${x.id}/own`, null, x.key);
        if (r.own) { upsert(x.id, { key: x.key }); A().toast('Bu hatmi yönetici olarak eklediniz'); }
      } catch { /* yok */ }
    }
    return x.id;
  }
  async function show() {
    if (!A()) return;
    await initTag();
    const fromLink = await takeLink();
    if (fromLink) { history.replaceState(null, '', '#hatim/' + fromLink); }
    const m = location.hash.match(/^#hatim\/([A-Za-z0-9]{10})$/);
    if (m) { if (curId !== m[1]) openDetail(m[1]); else refresh(); }
    else { if (curId) closeDetail(); else renderList(); }
  }
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#hatim')) show(); else clearInterval(pollT); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && curId && S_view() === 'hatim') refresh(); });
  window.Hatim = { show };
  if (!$('viewHatim').hidden) show();
})();
