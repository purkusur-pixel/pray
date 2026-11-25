"""src/*.txt -> pray/static/meal/kelime/<cüz>.json   satır: 's:a | karşılık0 | karşılık1 ... || {i|metin} ek söz {j|metin}'"""
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
import glob, hashlib, json, os, re, sys
import qwords
OUT = ROOT + '/static/meal/kelime'
META = json.load(open(ROOT + '/static/quran/meta.json'))
JS = META['js']                      # her cüzün ilk ayeti
def juz(s, a):
    j = 1
    for i, (ss, aa) in enumerate(JS):
        if (ss, aa) <= (s, a): j = i + 1
    return j
SEG = re.compile(r'\{(\d+)\|([^{}]*)\}')
err = 0; rows = {}
for f in sorted(glob.glob(os.path.dirname(__file__) + '/src/*.txt')):
    for ln, line in enumerate(open(f), 1):
        line = line.strip()
        if not line or line.startswith('#'): continue
        try:
            head, sent = line.split(' || ', 1)
            parts = [x.strip() for x in head.split(' | ')]
            s, a = map(int, parts[0].split(':')); g = parts[1:]
        except Exception as e:
            print(f'{f}:{ln} biçim hatası: {line[:60]}'); err += 1; continue
        w = qwords.words(s, a)
        if len(w) != len(g):
            print(f'{s}:{a} kelime sayısı {len(w)} ≠ karşılık {len(g)}'); err += 1; continue
        bad = [int(i) for i, _ in SEG.findall(sent) if int(i) >= len(w)]
        if bad or SEG.sub('', sent).count('{') or SEG.sub('', sent).count('}'):
            print(f'{s}:{a} renk işareti hatalı'); err += 1; continue
        if (s, a) in rows: print(f'{s}:{a} iki kez'); err += 1
        rows[(s, a)] = {'g': g, 'm': sent.strip()}
if err: sys.exit(f'{err} hata')
os.makedirs(OUT, exist_ok=True)
by = {}
for (s, a), v in sorted(rows.items()): by.setdefault(juz(s, a), []).append([s, a, v])
ver = hashlib.sha1(json.dumps(sorted((f'{k[0]}:{k[1]}', v) for k, v in rows.items()), ensure_ascii=False).encode()).hexdigest()[:10]
SRC = 'Kelime kelime renkli meal — yapay zekâ yardımıyla doğrudan Arapçadan hazırlanmıştır; bir âlim tarafından gözden geçirilmemiştir.'
for n in range(1, 31):
    json.dump({'ver': ver, 'src': SRC, 't': by.get(n, [])}, open(f'{OUT}/{n}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
tot = sum(len(qwords.words(*k)) for k in qwords.Q())
done = sum(len(v['g']) for v in rows.values())
print(f'ayet {len(rows)}/6236 · kelime {done}/{tot} · sürüm {ver}')
json.dump({'ver': ver, 'ayet': len(rows), 'sure': sorted({s for s, _ in rows})}, open(f'{OUT}/durum.json', 'w'))

# meal listesine ikinci sıraya ekle / sürümü güncelle
IX = ROOT + '/static/meal/index.json'
ix = [x for x in json.load(open(IX)) if x['key'] != 'kelime']
ix.insert(1, {'key': 'kelime', 'name': 'Kelime Kelime Renkli Meal (Yapay Zekâ)', 'desc': 'Her Arapça kelime ile Türkçe karşılığı aynı renkte',
              'version': ver, 'live': True, 'credit': SRC + ' Arapça metin: Tanzil (değiştirilmeden).'})
open(IX, 'w').write('[\n' + ',\n'.join(json.dumps(x, ensure_ascii=False, indent=None) for x in ix) + '\n]\n')
