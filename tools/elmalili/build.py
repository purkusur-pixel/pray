"""groups_v1 (Elmalılı'nın bölümleri) -> ayet ayet bölümler: static/tefsir/elmalili (index v2)"""
import json, os, re, shutil, sys
sys.argv = ['x']; exec(open('/home/claude/elm/split/split.py').read().split("if __name__")[0])
OUT = '/home/claude/pray/static/tefsir/elmalili'
src = json.load(open(R + '/index.json'))
idx = {'v': 2, 'fonts': src['fonts'], 's': {}}
for s in list(os.listdir(OUT)):
    if s.isdigit(): shutil.rmtree(os.path.join(OUT, s))
tl = lambda x: len(re.sub('<[^>]+>', '', SVG.sub('x', x)).strip())
n = 0
for s, gs in src['s'].items():
    os.makedirs(f'{OUT}/{s}', exist_ok=True); lst = []
    for gi, (a0, a1) in enumerate(gs):
        d = json.load(open(f'{R}/{s}/{gi}.json'))
        secs, _ = split_group(int(s), a0, a1, d['h'])
        for x0, x1, hh in secs:
            hh = re.sub(r'<p>\s*</p>', '', hh).strip()
            e = tl(hh) < 40
            o = {'a': [x0, x1], 'h': '' if e else hh}
            if d.get('y'): o['y'] = 1
            json.dump(o, open(f'{OUT}/{s}/{len(lst)}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
            lst.append([x0, x1, 0] if e else [x0, x1]); n += 1
    idx['s'][s] = lst
json.dump(idx, open(OUT + '/index.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('bölüm', n)
