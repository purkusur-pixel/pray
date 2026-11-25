import sys, qwords
a0, a1 = int(sys.argv[1]), int(sys.argv[2])
for s in range(a0, a1 + 1):
    a = 1
    while (s, a) in qwords.Q():
        print(f'{s}:{a}', ' | '.join(f'{i}:{x}' for i, x in enumerate(qwords.words(s, a)))); a += 1
