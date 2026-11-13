import os, struct, zlib
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run1')
def png(path, w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
os.makedirs(os.path.join(out, 'img'), exist_ok=True)
for i, c in enumerate([(200, 80, 80), (80, 160, 80), (80, 80, 200)]):
    png(os.path.join(out, 'img', 'fig%d.png' % i), 800, 400, c)
L = ['# Rich plan (invented)', '']
for s in range(1, 9):
    L += ['## Section %d' % s, '', 'Intro paragraph for section %d with $E = mc^2$ inline math.' % s, '',
          '![figure %d](img/fig%d.png)' % (s, s % 3), '',
          '```mermaid', 'graph TD', '  A%d[Start] --> B%d[Check]' % (s, s), '  B%d --> C%d[Done]' % (s, s), '```', '',
          '```python', 'def step_%d(x):' % s, '    return x * %d' % s, '```', '',
          '$$', '\sum_{i=1}^{%d} i = %d' % (s, s * (s + 1) // 2), '$$', '']
    L += ['- [ ] task %d.%d' % (s, t) for t in range(1, 7)] + ['']
open(os.path.join(out, 'rich-plan.md'), 'w', newline='\r\n').write('\n'.join(L))
