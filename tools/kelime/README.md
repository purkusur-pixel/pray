# Kelime kelime renkli meal — kaynak dosyaları

`src/*.txt` her satırda bir ayet: `sure:ayet | karşılık0 | karşılık1 … || renkli meal`
Renkli mealde `{i|metin}` metni i. Arapça kelimenin rengiyle gösterir; süslü parantez dışındaki sözler Arapçada ayrı karşılığı olmayan eklerdir.
Kelimeler uygulamadaki Tanzil metninden boşlukla ayrılır (sure başındaki besmele hariç).

- `python3 ws.py 2 2` → sure kelimelerini numaralarıyla listeler
- `python3 compile.py` → denetler ve `static/meal/kelime/<cüz>.json` ile `static/meal/index.json`'u günceller

Yapay zekâ yardımıyla doğrudan Arapçadan hazırlanmıştır; bir âlim tarafından gözden geçirilmemiştir.
