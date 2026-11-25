"""Uygulamadaki Kur'an metninden ayetlerin kelimeleri (besmele ayrı)."""
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
import glob, json
_Q = None
BSM = None
def Q():
    global _Q, BSM
    if _Q is None:
        _Q = {}
        for f in glob.glob(ROOT + '/static/quran/*.json'):
            if f.endswith('meta.json'): continue
            for p in json.load(open(f))['p'].values():
                for s, a, t in p: _Q[(s, a)] = t
        BSM = _Q[(1, 1)].split(' ')
    return _Q
def words(s, a):
    w = Q()[(s, a)].split(' ')
    if a == 1 and s not in (1, 9) and len(w) > 4 and w[0].endswith('سْمِ') and w[1] == BSM[1]:
        w = w[4:]
    return w
