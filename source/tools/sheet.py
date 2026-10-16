# Contact sheet: python3 tools/sheet.py out.png dirA [dirB] -- rows = views, columns = dirs
import sys, os
from PIL import Image, ImageDraw
out, dirs = sys.argv[1], sys.argv[2:]
names = sorted(f for f in os.listdir(dirs[-1]) if f.endswith('.png'))
w, h = 480, 270
sheet = Image.new('RGB', (w * len(dirs), h * len(names)), (20, 20, 20))
for r, n in enumerate(names):
    for c, d in enumerate(dirs):
        p = os.path.join(d, n)
        if not os.path.exists(p): p = os.path.join(d, 'v7-' + n)
        if os.path.exists(p): sheet.paste(Image.open(p).convert('RGB').resize((w, h)), (c * w, r * h))
        ImageDraw.Draw(sheet).text((c * w + 6, r * h + 4), os.path.basename(d) + ' ' + n, fill=(255, 255, 0))
sheet.save(out)
