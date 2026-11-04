"""把 art/previews/<name>-anim/<動作>_<i>.png 拼成一張（每列一個動作）。用系統的 python3 跑。"""
import os, sys, glob
from PIL import Image, ImageDraw
name = sys.argv[1]
d = os.path.join(os.path.dirname(__file__), '..', 'previews', f'{name}-anim')
rows = {}
for p in sorted(glob.glob(os.path.join(d, '*.png'))):
    a, i = os.path.basename(p)[:-4].rsplit('_', 1)
    rows.setdefault(a, []).append((int(i), p))
order = sorted(rows, key=lambda a: min(os.path.getmtime(p) for _, p in rows[a]))
ims = {a: [Image.open(p) for _, p in sorted(v)] for a, v in rows.items()}
w, h = ims[order[0]][0].size
cols = max(len(v) for v in ims.values())
sheet = Image.new('RGB', (w * cols, h * len(order)), 'white')
dr = ImageDraw.Draw(sheet)
for r, a in enumerate(order):
    for c, im in enumerate(ims[a]):
        sheet.paste(im, (c * w, r * h))
    dr.text((6, r * h + 4), a, fill=(20, 20, 20))
out = os.path.join(d, '..', f'{name}-anim-sheet.png')
sheet.save(out)
print(os.path.abspath(out))
