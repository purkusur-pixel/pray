"""Elmalılı bölümlerini ayet ayet böler.
Bölüm html'i: [em-intro] em-ay... em-meal  gövde <p>...
Gövdede kitabın süslü ayet işaretleri (|...|) arasındaki alıntılar o bölümün ayetlerinden parçalardır;
her ayetin açıklaması, o ayetten ilk alıntının geçtiği cümleden başlar (sıra hep ileri)."""
import json, re, sys, collections
sys.path.insert(0, '/home/claude/elm/split'); sys.path.insert(0, '/home/claude/pray/tools/kelime')
from dec import svg_text, rasm
from qwords import Q
R = '/home/claude/elm/groups_v1'
SVG = re.compile(r'<svg.*?</svg>', re.S)
na = lambda s: s.replace('ا', '')

def strip_quran(h):
    """em-ay ve em-meal'i çıkar (sure girişi kalır)"""
    h = re.sub(r'<p class="em-ay">.*?</p>', '', h, flags=re.S)
    h = re.sub(r'<div class="em-meal">.*?</div>', '', h, flags=re.S)
    return h

def quotes(h):
    """gövdedeki ayet alıntıları: (konum, iskelet) — |...| işaretli olanlar"""
    out = []
    svgs = list(SVG.finditer(h))
    i = 0
    while i < len(svgs):
        t = svg_text(svgs[i].group(0)); st = svgs[i].start()
        # satır sonunda bölünen alıntıyı birleştir
        while t.startswith('|') and t.count('|') % 2 == 1 and i + 1 < len(svgs) and svgs[i + 1].start() - svgs[i].end() < 40:
            i += 1; t += svg_text(svgs[i].group(0))
        for part in re.split(r'[|#]+', t):
            if len(na(part)) >= 3: out.append((st, na(part), '|' in t)); break
        i += 1
    return out

def locate(q, ays, cur):
    """alıntının ait olduğu ayet (cur ve sonrası; birden çoksa en yakını)"""
    hits = [k for k, s in ays if k >= cur and q in s]
    return hits[0] if hits else None

def cut_point(h, pos):
    """pos'taki alıntıyı içeren cümlenin başı (paragraf içinde)"""
    ps = h.rfind('<p>', 0, pos)
    if ps < 0: ps = h.rfind('<p', 0, pos)
    seg = h[ps:pos]
    txt_end = None
    for m in re.finditer(r'[.!?:]\s+(?=[^<]*$|[A-ZÇĞİÖŞÜ«])', seg):
        txt_end = m.end()
    if txt_end is None or pos - (ps + txt_end) > 400: return ps, True
    return ps + txt_end, False

def ayah_rasm(s, k):
    from qwords import words
    return na(rasm(' '.join(words(s, k))))

def candidates(h, ays, orn=True):
    out = []
    for pos, q, o in quotes(h):
        if orn and not o: continue
        if not orn and len(q) < 8: continue
        ks = [k for k, st in ays if q in st and st.find(q) <= max(6, len(st) // 3)]
        if ks: out.append((pos, ks))
    return out

def chain(cands, a0):
    """en uzun artan ayet zinciri (a0'dan büyük)"""
    n = len(cands); best = {}   # (i,k) -> (len, prev)
    order = []
    for i, (pos, ks) in enumerate(cands):
        for k in ks:
            if k <= a0: continue
            bl, bp = 1, None
            for (j, kk), (l, _) in best.items():
                if j < i and kk < k and l + 1 > bl: bl, bp = l + 1, (j, kk)
            if (i, k) not in best or best[(i, k)][0] < bl: best[(i, k)] = (bl, bp)
    if not best: return []
    end = max(best, key=lambda x: (best[x][0], -x[0]))
    ks = []
    while end: ks.append(end[1]); end = best[end][1]
    ks.reverse()
    # her ayet için zincir sırasına uyan en erken alıntı
    cuts = []; i0 = -1
    for k in ks:
        for i, (pos, kk) in enumerate(cands):
            if i > i0 and k in kk: cuts.append((pos, k)); i0 = i; break
    return cuts

def split_group(s, a0, a1, h):
    h = strip_quran(h)
    ays = [(k, ayah_rasm(s, k)) for k in range(a0, a1 + 1)]
    ie = h.find('</div>', h.find('<div class="em-intro">')) if '<div class="em-intro">' in h else -1   # sure girişi bölünmez
    cand = lambda orn: [c for c in candidates(h, ays, orn) if c[0] > ie]
    cuts = chain(cand(True), a0) if a1 > a0 else []
    if not cuts and a1 > a0: cuts = chain(cand(False), a0)
    secs = []; start = 0; sa = a0; shift = [0]; h0 = h
    for pos, k in cuts:
        cp, at_p = cut_point(h, pos + shift[0])
        if at_p:
            secs.append([sa, k - 1, h[start:cp]]); start = cp
        else:
            secs.append([sa, k - 1, h[start:cp] + '</p>']); h = h[:cp] + '<p>' + h[cp:]; shift[0] += 3; start = cp
        sa = k
    secs.append([sa, a1, h[start:]])
    out = []
    for x in secs:
        if out and len(re.sub('<[^>]+>', '', SVG.sub('x', out[-1][2])).strip()) < 40:
            out[-1] = [out[-1][0], x[1], out[-1][2] + x[2]]
        else: out.append(x)
    return out, len(cuts)

if __name__ == '__main__':
    IDX = json.load(open(R + '/index.json'))['s']
    ss = sys.argv[1:] or list(IDX)
    tot = found = 0
    for s in ss:
        for i, (a0, a1) in enumerate(IDX[s]):
            d = json.load(open(f'{R}/{s}/{i}.json'))
            secs, n = split_group(int(s), a0, a1, d['h'])
            tot += a1 - a0; found += n
            print(s, (a0, a1), n, [(x[0], x[1], len(re.sub('<[^>]+>', '', SVG.sub('', x[2])))) for x in secs])
    print('geçiş', found, '/', tot)
