"""Elmalılı Arapça glif (A3/A3b PUA) -> iskelet harf dizisi (hareke yok)."""
import re, collections
L = {}
def put(s, ch):
    for h in s.split(): L[('A3', int(h, 16) + 0xe000)] = ch
put('11 12 b9 ba bb bc', 'ك'); put('13 46 cf d0 d1 47 d8 d9 d5 d6', 'ي'); put('14 b1 b3 b4', 'ف'); put('15 4d 4e 4f 9e 9f', 'ب')
put('16 17 bd be', 'ل'); put('18 de', 'لا'); put('24 b5 b6 b7 b8', 'ق'); put('44 45', 'ا')
put('50 51 52 53', 'ت'); put('54 55 56 57', 'ث'); put('58 59 5a 5b 98 99', 'ج'); put('5c 5d 5f', 'ح'); put('64 65 66', 'خ')
put('67 68', 'د'); put('69 6a', 'ذ'); put('6b 6c', 'ر'); put('6d 6e', 'ز'); put('73 74 75 76', 'ش'); put('77 78 79 7a', 'ص')
put('7b 7c 7e', 'ض'); put('81 a2 a3 a4', 'ط'); put('a5 a6 a7 a8', 'ظ'); put('a9 aa ab ac', 'ع'); put('ad ae af b0', 'غ')
put('c1 c2 c3 c4', 'م'); put('c5 c6 c7 c8', 'ن'); put('c9 ca cb cc d3 d4', 'ه'); put('cd ce', 'و')
put('33 34 35 36 37 38 39 3a 3b 3c', '#'); put('7d', '|')
for h, ch in [('62', 'ح'), ('63', 'خ'), ('6f', 'س'), ('70', 'س'), ('71', 'س'), ('72', 'س'), ('7f', '|'), ('80', 'ض')]:
    L[('A3b', int(h, 16) + 0xe000)] = ch
TX = re.compile(r'<text x="([^"]*)" y="([^"]*)" class="(\w+)"[^>]*>(.*?)</text>', re.S)
def svg_text(s):
    g = []
    for m in TX.finditer(s):
        xs = list(map(float, m.group(1).split())); cs = m.group(4)
        for i, c in enumerate(cs):
            g.append((xs[i] if i < len(xs) else xs[-1], m.group(3), ord(c)))
    g.sort(key=lambda t: -t[0])
    return ''.join(L.get((f, c), '') for _, f, c in g)
# Tanzil -> iskelet
TR = str.maketrans({'ٱ': 'ا', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ي', 'ى': 'ي', 'ة': 'ه', 'ی': 'ي'})
def rasm(t):
    t = t.translate(TR)
    return ''.join(ch for ch in t if 'ا' <= ch <= 'ي' and ch not in 'ءـ')
# Z* yazı tipleri A3'ün alt kümeleri: glif görüntüsü birebir eşleşenler
import json as _j, os as _o
_nn = _j.load(open(_o.path.join(_o.path.dirname(__file__), 'nn.json')))
for _k, _v in _nn.items():
    _f, _h = _k.split('|')
    if _f.startswith('Z') and _v[1] <= 0.02: L[(_f, int(_h, 16))] = _v[0]
