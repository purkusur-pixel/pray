"""Yalnız denetler, hiçbir şey yazmaz:  python3 check.py src/dosya.txt [...]"""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qwords
SEG = re.compile(r'\{(\d+)\|([^{}]*)\}')
err = 0; n = 0; seen = set()
for f in sys.argv[1:]:
    for ln, line in enumerate(open(f), 1):
        line = line.strip()
        if not line or line.startswith('#'): continue
        try:
            head, sent = line.split(' || ', 1)
            parts = [x.strip() for x in head.split(' | ')]
            s, a = map(int, parts[0].split(':')); g = parts[1:]
        except Exception:
            print(f'{f}:{ln} BİÇİM HATASI: {line[:70]}'); err += 1; continue
        try: w = qwords.words(s, a)
        except KeyError: print(f'{s}:{a} böyle ayet yok'); err += 1; continue
        if len(w) != len(g): print(f'{s}:{a} kelime sayısı {len(w)} ama karşılık {len(g)}'); err += 1
        idx = [int(i) for i, _ in SEG.findall(sent)]
        if any(i >= len(w) for i in idx): print(f'{s}:{a} renk numarası kelime sayısını aşıyor'); err += 1
        if any(not t.strip() for _, t in SEG.findall(sent)): print(f'{s}:{a} boş renk parçası'); err += 1
        rest = SEG.sub('', sent)
        if '{' in rest or '}' in rest: print(f'{s}:{a} süslü parantez hatası'); err += 1
        if len(set(idx)) < len(w) * 0.5: print(f'{s}:{a} UYARI: kelimelerin yarısından azı mealde renkli')
        if (s, a) in seen: print(f'{s}:{a} iki kez'); err += 1
        seen.add((s, a)); n += 1
print(f'{n} ayet, {err} hata')
sys.exit(1 if err else 0)
