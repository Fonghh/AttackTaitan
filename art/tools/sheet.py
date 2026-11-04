"""把預覽圖拼成一張（手機上一次看完）：python3 art/tools/sheet.py <名稱>"""
import glob
import os
import sys

from PIL import Image

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'previews'))
name = sys.argv[1]
order = ['front', 'side', 'back', 'three']
files = [os.path.join(root, f'{name}-{v}.png') for v in order if os.path.exists(os.path.join(root, f'{name}-{v}.png'))]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
sheet = Image.new('RGB', (w * len(ims), h), 'white')
for i, im in enumerate(ims):
    sheet.paste(im, (i * w, 0))
out = os.path.join(root, f'{name}-sheet.png')
sheet.save(out)
print(out)
