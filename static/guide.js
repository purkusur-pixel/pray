/* Sesli asistan kılavuzu — iPhone (Siri kestirmesi) ve Android (Google ile aç + sesli okuma).
 * Türkçe / İngilizce; seçilen dil sesli cevabın dilini de belirler.
 * Görseller, gerçek ekranların sadeleştirilmiş çizimleridir (SVG, temaya uyumlu, internetsiz çalışır).
 * app.js'teki window.App arayüzünü kullanır.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = () => window.App;

  /* ------------------------------------------------------------ metinler */
  const TXT = {
    tr: {
      title: 'Sesli asistana ekle',
      langNote: 'Seçtiğiniz dil, sesli cevabın dilini de belirler.',
      close: 'Kapat',
      ios: {
        lead: `Bir kez kestirme oluşturun, sonra <b>“Hey Siri, Namaz”</b> deyin: Siri, uygulamada seçili ilçeye göre sonraki vakte kalan süreyi sesli söyler. Konum izni gerekmez; kurulum yaklaşık 2 dakika sürer.`,
        urlLabel: 'Size özel kestirme adresi',
        copy: 'Adresi kopyala', copied: 'Kopyalandı ✓', test: 'Dene',
        willSay: 'Siri şunu söyleyecek:', testFail: 'Şu an denenemedi (internet bağlantısını kontrol edin).',
        steps: [
          ['Adresi kopyalayın', `Yukarıdaki <b>Adresi kopyala</b> düğmesine dokunun. Adres bu telefona özeldir ve uygulamada seçili ilçeyi kullanır.`, null],
          ['Kestirmeler uygulamasını açın', `iPhone ile gelen <b>Kestirmeler</b> <small>(Shortcuts)</small> uygulamasını açın; silinmişse App Store'dan ücretsiz indirin. Alttaki <b>Kestirmeler</b> sekmesinde sağ üstteki <b>+</b> düğmesine dokunun.`, 'iosHome'],
          [`“URL'nin İçeriğini Al” eylemini ekleyin`, `<b>Eylem Ekle</b>'ye dokunun, arama kutusuna <b>içerik</b> (İngilizce telefonda <b>contents</b>) yazın ve <b>URL'nin İçeriğini Al</b> <small>(Get Contents of URL)</small>'ı seçin. Dikkat: adı çok benzeyen <b>URL Bileşenini Al</b> <small>(Get Component of URL)</small> yanlıştır; o yalnızca “https” gösterir.`, 'iosSearch'],
          ['Adresi yapıştırın', `Eylemdeki mavi <b>URL</b> yazısına dokunun, içindekini silin, alana basılı tutup <b>Yapıştır</b>'a dokunun. Diğer ayarları değiştirmeyin.`, 'iosPaste'],
          [`“Sonucu Göster” eylemini ekleyin`, `Alttaki arama kutusuna <b>Sonucu Göster</b> <small>(Show Result)</small> yazıp dokunun. Yeni eylemde <b>URL'nin İçeriği</b> yazmalı. Siri ile sorunca bu sonucu sesli okur.`, 'iosShow'],
          [`Adını “Namaz” yapın`, `En üstteki kestirme adına dokunun → <b>Adı Değiştir</b> <small>(Rename)</small> → <b>Namaz</b> yazın → sağ üstte <b>Bitti</b> <small>(Done)</small>.`, 'iosRename'],
          [`Siri'ye sorun`, `<b>“Hey Siri, Namaz”</b> deyin (ya da yan tuşa basılı tutup “Namaz” deyin). İlk seferde iPhone sunucuya bağlanmak için izin isterse <b>Her Zaman İzin Ver</b>'e dokunun.`, 'iosSiri'],
        ],
        tips: [
          `<b>Siri yalnızca yazıyor, sesli okumuyorsa:</b> Ayarlar › Siri › <b>Siri Yanıtları</b> bölümünde <b>Sesli Yanıtları Tercih Et</b>'i seçin. Türkçe cevap için Siri dili Türkçe olmalıdır.`,
          `<b>Telefonunuz İngilizce ise:</b> telefonun dilini değiştirmeniz gerekmez. Türkçe cevabın Türkçe sesle okunması için yalnızca Siri'nin dilini Türkçe yapın: Settings › Siri › <b>Language</b> › <b>Türkçe</b> (ses: <b>Siri Voice</b> › Türkçe). Siri dili İngilizce kalırsa Türkçe cümleyi İngilizce aksanla okur.`,
          `<b>İlçe değişince</b> kestirmeyi değiştirmeniz gerekmez; Siri uygulamada seçili ilçeye göre söyler (otomatik konum takibi açıksa yeni ilçeye kendiliğinden geçer).`,
          `<b>Daha önce konumlu kestirme kurduysanız:</b> kestirmeyi açın, <b>Mevcut Konumu Al</b> adımını silin ve adresi bu yenisiyle değiştirin.`,
          `Sunucuda yalnızca rastgele bir anahtar ve ilçe numarası tutulur; konumunuz ya da kişisel bilginiz tutulmaz.`,
        ],
      },
      and: {
        lead: `Ek uygulama gerekmez. Uygulamayı yükleyin, sonra Google Asistan'a (ya da Gemini'ye) <b>“Hey Google, Namaz'ı aç”</b> deyin: uygulama açılır ve sonraki vakte kalan süreyi sesli söyler. Vakitler telefonda kayıtlı olduğu için internetsiz de çalışır.`,
        steps: [
          ['Uygulamayı yükleyin', `Bu sayfayı <b>Chrome</b>'da açın. Üstteki <b>Yükle</b> düğmesine ya da Chrome menüsündeki (⋮) <b>Uygulamayı yükle</b>'ye dokunun. Ana ekranda <b>Namaz</b> simgesi belirir.`, 'andInstall', 'install'],
          ['Açılınca sesli söylemeyi açın', `Aşağıdaki kutuyu işaretleyin ve <b>Dinle</b> ile sesi deneyin.`, null, 'say'],
          [`Google'a söyleyin`, `<b>“Hey Google, Namaz'ı aç”</b> deyin (olmazsa “Namaz Vakitleri'ni aç”). Uygulama açılır ve kalan süreyi okur. Arkada açıksa öne gelip yine söyler.`, 'andVoice'],
          ['Tek dokunuşla kısayol (isteğe bağlı)', `Ana ekranda <b>Namaz</b> simgesine basılı tutun: menüde <b>Kalan süreyi söyle</b> çıkar. Ona basılı tutup boş bir yere sürüklerseniz ayrı bir simge olur; dokununca süreyi söyler.`, 'andLong'],
        ],
        installed: 'Uygulama yüklü ✓', installNow: 'Şimdi yükle', installHow: 'Nasıl yüklenir?',
        sayChk: 'Uygulama açılınca kalan süreyi sesli söyle', listen: '🔊 Dinle',
        tips: [
          `<b>Ses çıkmazsa:</b> Chrome bazı telefonlarda dokunmadan ses çalınmasına izin vermez. O zaman ekranın altında <b>🔊 Kalan süreyi dinle</b> düğmesi çıkar; bir kez dokunmanız yeterli.`,
          `<b>Ses yoksa ya da yabancı aksanla okuyorsa:</b> Ayarlar › Sistem › Diller › <b>Metin okuma çıkışı</b> bölümünde Google motorunun <b>Türkçe</b> ses verisini yükleyin (menü adları markaya göre biraz değişebilir).`,
          `Google'a doğrudan “Hey Google, öğle namazı ne zaman?” diye de sorabilirsiniz; ancak Google kendi kaynağını kullanır ve vakit Diyanet'inkinden farklı olabilir. Bu uygulama Diyanet vakitlerini söyler.`,
        ],
      },
      mk: {
        shortcuts: 'Kestirmeler', newShortcut: 'Yeni Kestirme', done: 'Bitti', addAction: 'Eylem Ekle',
        getContents: `URL'nin İçeriğini Al`, openUrls: `URL'leri Aç`, getContentsOf: `URL'nin içeriğini al`,
        show: 'Göster', contentsOfUrl: `URL'nin İçeriği`, showResult: 'Sonucu Göster', paste: 'Yapıştır',
        rename: 'Adı Değiştir', chooseIcon: 'Simge Seç', addHome: 'Ana Ekrana Ekle', heySiri: '“Hey Siri, Namaz”',
        newTab: 'Yeni sekme', history: 'Geçmiş', downloads: 'İndirilenler', installApp: 'Uygulamayı yükle',
        heyGoogle: `“Hey Google, Namaz'ı aç”`, shortSay: 'Kalan süreyi söyle', shortQibla: 'Kıble', appInfo: 'Uygulama bilgileri',
        sample: 'Akçaabat. Öğle vaktine 45 dakika kaldı. Öğle saat 12:10.',
      },
    },
    en: {
      title: 'Add to voice assistant',
      langNote: 'The language you choose is also the language of the spoken answer.',
      close: 'Close',
      ios: {
        lead: `Create a shortcut once, then say <b>“Hey Siri, Namaz”</b>: Siri tells you the time left until the next prayer for the district selected in the app. No location permission is needed; setup takes about 2 minutes.`,
        urlLabel: 'Your personal shortcut address',
        copy: 'Copy address', copied: 'Copied ✓', test: 'Test',
        willSay: 'Siri will say:', testFail: 'Could not test right now (check your internet connection).',
        steps: [
          ['Copy the address', `Tap <b>Copy address</b> above. The address belongs to this phone and uses the district selected in the app.`, null],
          ['Open the Shortcuts app', `Open the built-in <b>Shortcuts</b> app (if you deleted it, get it free from the App Store). On the <b>Shortcuts</b> tab, tap <b>+</b> in the top-right corner.`, 'iosHome'],
          ['Add “Get Contents of URL”', `Tap <b>Add Action</b>, type <b>contents</b> in the search field and choose <b>Get Contents of URL</b>. Careful: the similarly named <b>Get Component of URL</b> is wrong — it only shows “https”.`, 'iosSearch'],
          ['Paste the address', `Tap the blue <b>URL</b> in the action, clear it, then touch and hold the field and tap <b>Paste</b>. Leave the other settings as they are.`, 'iosPaste'],
          ['Add “Show Result”', `Type <b>Show Result</b> in the search field at the bottom and tap it. The new action should say <b>Contents of URL</b>. When you ask Siri, it reads this result aloud.`, 'iosShow'],
          ['Name it “Namaz”', `Tap the shortcut name at the top → <b>Rename</b> → type <b>Namaz</b> → tap <b>Done</b> in the top-right corner.`, 'iosRename'],
          ['Ask Siri', `Say <b>“Hey Siri, Namaz”</b> (or hold the side button and say “Namaz”). If the iPhone asks for permission to connect the first time, tap <b>Always Allow</b>.`, 'iosSiri'],
        ],
        tips: [
          `<b>If Siri only shows the answer without speaking:</b> go to Settings › Siri › <b>Siri Responses</b> and choose <b>Prefer Spoken Responses</b>. For English answers, Siri's language should be English.`,
          `<b>Phone in English but want Turkish answers?</b> Choose <b>TR</b> at the top and copy the address again, then set only Siri's language to Turkish: Settings › Siri › <b>Language</b> › <b>Türkçe</b>. The phone itself can stay in English.`,
          `<b>When you change district</b> you don't need to edit the shortcut; Siri uses the district selected in the app (with auto-location on, it switches automatically).`,
          `<b>If you set up the older location-based shortcut:</b> open it, delete the <b>Get Current Location</b> step and replace the address with this new one.`,
          `The server keeps only a random key and a district number — no location or personal data.`,
        ],
      },
      and: {
        lead: `No extra app is needed. Install the app, then tell Google Assistant (or Gemini) <b>“Hey Google, open Namaz”</b>: the app opens and says the time left until the next prayer. Prayer times are stored on the phone, so it works offline too.`,
        steps: [
          ['Install the app', `Open this page in <b>Chrome</b>. Tap the <b>Install</b> button at the top, or <b>Install app</b> in Chrome's menu (⋮). A <b>Namaz</b> icon appears on your home screen.`, 'andInstall', 'install'],
          ['Turn on “speak at launch”', `Tick the box below and tap <b>Listen</b> to test the voice.`, null, 'say'],
          ['Tell Google', `Say <b>“Hey Google, open Namaz”</b> (or “open Namaz Vakitleri”). The app opens and reads the time left. If it is already open in the background, it comes to the front and speaks again.`, 'andVoice'],
          ['One-tap shortcut (optional)', `Touch and hold the <b>Namaz</b> icon on the home screen: the menu shows <b>Kalan süreyi söyle</b> (Say time left). Hold it and drag it to an empty spot to get its own icon; tapping it speaks the time.`, 'andLong'],
        ],
        installed: 'App installed ✓', installNow: 'Install now', installHow: 'How to install?',
        sayChk: 'Say the time left when the app opens', listen: '🔊 Listen',
        tips: [
          `<b>No sound?</b> On some phones Chrome doesn't allow audio without a tap. A <b>🔊 Hear the time left</b> button then appears at the bottom; one tap is enough.`,
          `<b>No voice, or the wrong accent:</b> Settings › System › Languages › <b>Text-to-speech output</b>: install the <b>English</b> voice data for Google's engine (menu names vary slightly by brand).`,
          `You can also ask Google directly (“Hey Google, when is Dhuhr?”), but Google uses its own source, which may differ from Diyanet times. This app says the Diyanet times.`,
        ],
      },
      mk: {
        shortcuts: 'Shortcuts', newShortcut: 'New Shortcut', done: 'Done', addAction: 'Add Action',
        getContents: 'Get Contents of URL', openUrls: 'Open URLs', getContentsOf: 'Get contents of',
        show: 'Show', contentsOfUrl: 'Contents of URL', showResult: 'Show Result', paste: 'Paste',
        rename: 'Rename', chooseIcon: 'Choose Icon', addHome: 'Add to Home Screen', heySiri: '“Hey Siri, Namaz”',
        newTab: 'New tab', history: 'History', downloads: 'Downloads', installApp: 'Install app',
        heyGoogle: '“Hey Google, open Namaz”', shortSay: 'Kalan süreyi söyle', shortQibla: 'Kıble', appInfo: 'App info',
        sample: 'Akçaabat. 45 minutes until Dhuhr. Dhuhr is at 12:10.',
      },
    },
  };

  /* ------------------------------------------------------------ çizim yardımcıları
   * Tüm görseller 180×320 telefon çerçevesi içinde. Renkler CSS'teki .mk-* sınıflarından gelir. */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" class="${o.c || 'mk-ink'}" font-size="${o.s || 9}"${o.w ? ` font-weight="${o.w}"` : ''}${o.a ? ` text-anchor="${o.a}"` : ''}>${esc(s)}</text>`;
  const R = (x, y, w, h, rx, c, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${c}"${extra}/>`;
  const HL = (x, y, w, h, rx = 8) => `<rect class="mk-hl" x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="${rx + 3}"/>`;
  const TAP = (x, y) => `<circle class="mk-tap" cx="${x}" cy="${y}" r="8"/><circle class="mk-ring" cx="${x}" cy="${y}" r="8"/>`;
  function wrap(text, n) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/)) {
      if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
    return out;
  }
  const lines = (x, y, arr, o = {}) => arr.map((l, i) => T(x, y + i * (o.lh || 12), l, o)).join('');
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const appIcon = (x, y, s) => `<g><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}" fill="#0e1a2b"/>` +
    `<circle cx="${x + s * 0.47}" cy="${y + s * 0.5}" r="${s * 0.3}" fill="#d4a24c"/><circle cx="${x + s * 0.58}" cy="${y + s * 0.44}" r="${s * 0.25}" fill="#0e1a2b"/></g>`;
  const status = (dark) => T(22, 22, '9:41', { s: 8, w: 600, c: dark ? 'mk-inv' : 'mk-ink' });
  let fadeN = 0;
  /* h < 320: telefonun yalnızca üst kısmı gösterilir (boş alan olmasın), alt kenar yumuşakça kaybolur */
  const phone = (inner, dark = false, h = 320) => {
    const id = 'gf' + (++fadeN);
    const fade = h < 320 ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--surface);stop-opacity:0"/>` +
      `<stop offset="1" style="stop-color:var(--surface);stop-opacity:1"/></linearGradient></defs><rect x="0" y="${h - 26}" width="180" height="27" fill="url(#${id})"/>` : '';
    return `<svg viewBox="0 0 180 ${h}" class="mk" aria-hidden="true">` +
      `<rect class="mk-frame" x="0" y="0" width="180" height="320" rx="26"/>` +
      `<rect class="${dark ? 'mk-scr-d' : 'mk-scr'}" x="6" y="6" width="168" height="308" rx="21"/>` +
      `<rect class="mk-frame" x="68" y="12" width="44" height="11" rx="5.5"/>${status(dark)}${inner}${fade}</svg>`;
  };
  const urlShort = () => trunc(location.host + '/api/siri?k=…', 30);
  const sheet = (y) => `<path class="mk-card" d="M6 ${y + 14} q0 -14 14 -14 h140 q14 0 14 14 V293 q0 21 -21 21 H27 q-21 0 -21 -21 Z"/>`;
  const actionCard = (y, color, title, pill, hl) =>
    R(16, y, 148, 46, 10, 'mk-card') + R(24, y + 9, 13, 13, 3.5, color) +
    T(43, y + 19, title, { s: 8.5, w: 600 }) + R(24, y + 27, 118, 13, 6.5, 'mk-pill') +
    T(30, y + 36.5, pill, { s: 7.5, c: 'mk-blue', w: 600 }) + (hl ? HL(24, y + 27, 118, 13, 6.5) : '');

  const ART = {
    iosHome(m) {
      const tiles = [['mk-t1', 16, 64], ['mk-t2', 92, 64], ['mk-t3', 16, 118], ['mk-t4', 92, 118]]
        .map(([c, x, y]) => R(x, y, 72, 46, 10, c) + R(x + 9, y + 9, 12, 12, 3, 'mk-wht') + R(x + 9, y + 32, 38, 5, 2.5, 'mk-wht')).join('');
      return phone(
        T(18, 50, m.shortcuts, { s: 15, w: 700 }) +
        `<circle cx="152" cy="33" r="9" class="mk-card"/>` + T(152, 37, '+', { s: 13, w: 700, a: 'middle', c: 'mk-blue' }) +
        HL(143, 24, 18, 18, 9) + TAP(156, 38) + tiles, false, 186);
    },
    iosSearch(m) {
      return phone(
        T(90, 40, m.newShortcut, { s: 9, w: 700, a: 'middle' }) + T(160, 40, m.done, { s: 8, a: 'end', c: 'mk-mut' }) +
        R(30, 62, 120, 26, 8, 'mk-dash') + T(90, 78, '＋ ' + m.addAction, { s: 8.5, a: 'middle', c: 'mk-blue', w: 600 }) +
        sheet(118) +
        R(18, 132, 144, 20, 10, 'mk-field') + T(28, 145.5, '⌕  URL', { s: 8.5 }) + R(62, 136, 1.2, 12, 0, 'mk-blue-f') +
        R(18, 162, 13, 13, 3.5, 'mk-blue-f') + T(38, 172, 'URL', { s: 8.5 }) +
        R(18, 186, 13, 13, 3.5, 'mk-blue-f') + T(38, 196, m.getContents, { s: 8.5, w: 600 }) + HL(14, 182, 150, 21, 7) + TAP(140, 193) +
        R(18, 210, 13, 13, 3.5, 'mk-blue-f') + T(38, 220, m.openUrls, { s: 8.5, c: 'mk-mut' }) +
        `<line x1="18" y1="232" x2="162" y2="232" class="mk-line"/>`, false, 244);
    },
    iosPaste(m) {
      return phone(
        T(90, 40, m.newShortcut, { s: 9, w: 700, a: 'middle' }) + T(160, 40, m.done, { s: 8, a: 'end', c: 'mk-blue' }) +
        actionCard(70, 'mk-blue-f', m.getContentsOf, urlShort(), true) +
        R(52, 56, 52, 18, 6, 'mk-pop') + T(78, 68, m.paste, { s: 8, a: 'middle', c: 'mk-inv', w: 600 }) + TAP(96, 110) +
        R(30, 128, 120, 22, 8, 'mk-dash') + T(90, 142, '⌄', { s: 9, a: 'middle', c: 'mk-mut' }), false, 170);
    },
    iosShow(m) {
      return phone(
        T(90, 40, m.newShortcut, { s: 9, w: 700, a: 'middle' }) + T(160, 40, m.done, { s: 8, a: 'end', c: 'mk-blue' }) +
        actionCard(58, 'mk-blue-f', m.getContentsOf, urlShort(), false) +
        `<line x1="90" y1="104" x2="90" y2="114" class="mk-line"/>` +
        actionCard(114, 'mk-t3', m.show, m.contentsOfUrl, false) + HL(16, 114, 148, 46, 10) +
        sheet(196) + R(18, 210, 144, 20, 10, 'mk-field') + T(28, 223.5, '⌕  ' + m.showResult, { s: 8.5 }) +
        R(18, 240, 13, 13, 3.5, 'mk-t3') + T(38, 250, m.showResult, { s: 8.5, w: 600 }) + TAP(130, 247), false, 272);
    },
    iosRename(m) {
      return phone(
        T(90, 40, 'Namaz  ⌄', { s: 9.5, w: 700, a: 'middle' }) + HL(62, 30, 56, 14, 6) +
        T(160, 40, m.done, { s: 8, a: 'end', c: 'mk-blue', w: 700 }) +
        R(40, 52, 100, 74, 10, 'mk-menu') +
        T(52, 68, m.rename, { s: 8.5, w: 600 }) + HL(44, 57, 92, 16, 6) + TAP(124, 66) +
        `<line x1="46" y1="78" x2="134" y2="78" class="mk-line"/>` + T(52, 92, m.chooseIcon, { s: 8.5, c: 'mk-mut' }) +
        `<line x1="46" y1="100" x2="134" y2="100" class="mk-line"/>` + T(52, 114, m.addHome, { s: 8.5, c: 'mk-mut' }) +
        actionCard(146, 'mk-blue-f', m.getContentsOf, urlShort(), false) +
        `<line x1="90" y1="192" x2="90" y2="200" class="mk-line"/>` +
        actionCard(200, 'mk-t3', m.show, m.contentsOfUrl, false), false, 262);
    },
    iosSiri(m, sample) {
      const ans = wrap(sample, 27).slice(0, 5);
      const h = 18 + ans.length * 12;
      return phone(
        T(90, 70, m.heySiri, { s: 10, w: 600, a: 'middle', c: 'mk-inv' }) +
        R(16, 170, 148, h, 14, 'mk-glass') + lines(26, 186, ans, { s: 8.5, c: 'mk-inv', lh: 12 }) +
        `<defs><radialGradient id="orb" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fde68a"/><stop offset=".55" stop-color="#d4a24c"/><stop offset="1" stop-color="#7c3aed" stop-opacity=".2"/></radialGradient></defs>` +
        `<circle cx="90" cy="283" r="17" fill="url(#orb)" class="mk-orb"/>` +
        `<path d="M122 276 q5 7 0 14 M128 271 q9 12 0 24" class="mk-wave"/><path d="M58 276 q-5 7 0 14 M52 271 q-9 12 0 24" class="mk-wave"/>`, true);
    },
    andInstall(m) {
      return phone(
        R(14, 30, 128, 18, 9, 'mk-field') + T(22, 42, trunc(location.host, 24), { s: 7.5, c: 'mk-mut' }) +
        T(158, 43, '⋮', { s: 13, w: 700, a: 'middle' }) + TAP(158, 39) +
        R(14, 58, 152, 90, 12, 'mk-hero') + T(24, 78, 'Namaz', { s: 9, w: 700, c: 'mk-inv' }) + T(24, 104, '45 dk', { s: 16, w: 700, c: 'mk-inv' }) +
        R(76, 52, 98, 100, 10, 'mk-menu') +
        T(86, 70, m.newTab, { s: 8, c: 'mk-mut' }) + T(86, 90, m.history, { s: 8, c: 'mk-mut' }) + T(86, 110, m.downloads, { s: 8, c: 'mk-mut' }) +
        appIcon(84, 124, 11) + T(99, 133, m.installApp, { s: 8, w: 700 }) + HL(80, 120, 90, 18, 6) + TAP(150, 132) +
        R(14, 164, 152, 26, 10, 'mk-card') + R(14, 198, 152, 26, 10, 'mk-card'), false, 228);
    },
    andVoice(m, sample) {
      const ans = wrap(sample, 26).slice(0, 4);
      return phone(
        R(14, 32, 152, 50 + ans.length * 12, 14, 'mk-hero') +
        `<path d="M28 48 h5 l6 -5 v14 l-6 -5 h-5 z" class="mk-acc-f"/><path d="M43 45 q3 4 0 8 M47 42 q6 7 0 14" class="mk-wave"/>` +
        T(56, 52, 'Namaz', { s: 9, w: 700, c: 'mk-inv' }) + lines(26, 74, ans, { s: 8.5, c: 'mk-inv', lh: 12 }) +
        [0, 1, 2, 3].map((i) => `<circle cx="${34 + i * 37}" cy="${160}" r="9" class="mk-card"/>`).join('') +
        sheet(196) +
        `<circle cx="70" cy="222" r="4" class="mk-acc-f"/><circle cx="82" cy="222" r="4" class="mk-t2"/><circle cx="94" cy="222" r="4" class="mk-t3"/><circle cx="106" cy="222" r="4" class="mk-t1"/>` +
        T(90, 252, m.heyGoogle, { s: 9.5, w: 700, a: 'middle' }) +
        R(66, 270, 48, 4, 2, 'mk-mut-f'));
    },
    andLong(m) {
      const grid = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
        if (r === 1 && c === 0) continue;
        if (r >= 2 && r <= 3 && c <= 2) continue;          // menünün altı
        if (r === 4 && c === 3) continue;                    // sürükleme hedefi
        grid.push(R(22 + c * 38, 40 + r * 52, 24, 24, 7, 'mk-card'));
      }
      return phone(
        grid.join('') + appIcon(22, 92, 24) + T(34, 126, 'Namaz', { s: 6.5, a: 'middle', c: 'mk-mut' }) + HL(22, 92, 24, 24, 7) + TAP(40, 110) +
        R(18, 132, 112, 74, 10, 'mk-menu') +
        `<path d="M30 146 h4 l5 -4 v11 l-5 -4 h-4 z" class="mk-acc-f"/>` + T(46, 150, m.shortSay, { s: 8, w: 700 }) + HL(22, 137, 104, 18, 6) +
        appIcon(28, 164, 10) + T(46, 172, m.shortQibla, { s: 8 }) +
        `<line x1="24" y1="182" x2="124" y2="182" class="mk-line"/>` + T(28, 196, 'ⓘ  ' + m.appInfo, { s: 7.5, c: 'mk-mut' }) +
        `<path d="M120 152 C 150 170, 150 220, 141 238" class="mk-arrow"/>` + `<path d="M135 233 l6 7 l4 -8" class="mk-arrow"/>` +
        R(136, 248, 24, 24, 7, 'mk-dash'), false, 290);
    },
  };

  /* ------------------------------------------------------------ pencere */
  const dlg = $('siriDlg'), body = $('guideBody');
  let plat = null;

  function render() {
    const app = A(); if (!app) return;
    const lang = app.lang(), L = TXT[lang], P = plat === 'android' ? L.and : L.ios, m = L.mk;
    document.querySelectorAll('#siriDlg [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    document.querySelectorAll('#siriDlg [data-plat]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.plat === plat)));
    $('gTitle').textContent = L.title;
    $('btnSiriClose').setAttribute('aria-label', L.close);
    dlg.lang = lang;
    const sample = (app.place() && app.speechText(lang)) || m.sample;

    let h = `<p class="g-lead">${P.lead}</p><p class="g-note">${esc(L.langNote)}</p>`;
    if (plat === 'ios') {
      h += `<div class="g-box"><label class="g-lbl" for="siriUrl">${esc(P.urlLabel)}</label>
        <input id="siriUrl" readonly>
        <div class="actions left"><button class="btn" id="btnSiriCopy" type="button">${esc(P.copy)}</button>
        <button class="btn ghost" id="btnSiriTry" type="button">${esc(P.test)}</button></div>
        <p class="siri-preview" id="siriPreview" hidden></p></div>`;
    }
    h += '<ol class="g-steps">' + P.steps.map(([t, d, art, ctl], i) => {
      let c = '';
      if (ctl === 'install') {
        c = app.isStandalone() ? `<p class="g-ok">${esc(P.installed)}</p>`
          : `<button class="btn" type="button" data-act="install">${esc(app.canInstall() ? P.installNow : P.installHow)}</button>`;
      } else if (ctl === 'say') {
        c = `<label class="chk g-chk"><input type="checkbox" id="chkSay"${app.sayOn() ? ' checked' : ''}> ${esc(P.sayChk)}</label>
          <button class="btn ghost" type="button" data-act="listen">${esc(P.listen)}</button>`;
      }
      const fig = art ? `<figure class="g-fig">${ART[art](m, sample)}</figure>` : '';
      return `<li class="g-step"><span class="g-num">${i + 1}</span><div class="g-txt"><h3>${t}</h3><p>${d}</p>${c ? `<div class="g-ctl">${c}</div>` : ''}</div>${fig}</li>`;
    }).join('') + '</ol>';
    h += '<ul class="g-tips">' + P.tips.map((x) => `<li>${x}</li>`).join('') + '</ul>';
    h += `<div class="actions"><button class="btn ghost" type="button" data-act="close">${esc(L.close)}</button></div>`;
    body.innerHTML = h;

    if (plat === 'ios') {
      $('siriUrl').value = app.siriUrl(lang);
      $('btnSiriCopy').addEventListener('click', async () => {
        const input = $('siriUrl');
        try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
        $('btnSiriCopy').textContent = P.copied;
      });
      $('btnSiriTry').addEventListener('click', async () => {
        const out = $('siriPreview');
        out.hidden = false; out.textContent = '…';
        try {
          await app.syncLink();
          const r = await fetch($('siriUrl').value, { cache: 'no-store' });
          out.textContent = `${P.willSay} “${(await r.text()).trim()}”`;
        } catch { out.textContent = P.testFail; }
      });
    }
    const chk = $('chkSay');
    if (chk) chk.addEventListener('change', () => app.setSay(chk.checked));
  }

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'listen') A().speak();
    else if (act === 'install') A().install();
  });
  document.querySelectorAll('#siriDlg [data-lang]').forEach((b) => b.addEventListener('click', () => { A().setLang(b.dataset.lang); render(); }));
  document.querySelectorAll('#siriDlg [data-plat]').forEach((b) => b.addEventListener('click', () => {
    plat = b.dataset.plat; render(); body.scrollTop = 0;
  }));
  $('btnSiriClose').addEventListener('click', () => dlg.close());

  window.Guide = {
    open(p) {
      const app = A();
      plat = p || plat || (app.isAndroid ? 'android' : 'ios');
      render();
      if (!dlg.open) dlg.showModal();
      body.scrollTop = 0;
    },
    refresh() { if (dlg.open) render(); },
  };
  if (location.hash === '#sesli') window.Guide.open();
})();
