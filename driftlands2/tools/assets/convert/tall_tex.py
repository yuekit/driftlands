# Tall City URP Lit (specular workflow) textures -> metal/rough WebP pairs.
#   <mat>_c.webp  RGB base colour (sRGB), A = metalness (opaque materials) or the cut-out alpha
#   <mat>_n.webp  R,G = tangent normal x,y   B = roughness
# python3 tall_tex.py <out dir>
import sys, os, json, glob
import numpy as np
from PIL import Image
sys.path.insert(0, '/home/user/tools-ref/kyber')
from unity import parse_mat, guid_index
SRC = '/home/user/assets-src/tall'; out = sys.argv[-1]; os.makedirs(out, exist_ok=True)
idx = guid_index(SRC)
used = sorted({p['mat'] for p in json.load(open('/home/user/work/out/city.json'))['parts']} | {'boat', 'motor 1', 'motor 2', 'motor 3', 'control'})
BIG = ('wall', 'ground', 'border', 'bridge', 'holder')
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
ss = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
meta = {}
for name in used:
    m = parse_mat(os.path.join(SRC, 'Assets/TallCity/Materials', name + '.mat'))
    load = lambda k: Image.open(idx[m['tex'][k]['guid']]) if k in m['tex'] and idx.get(m['tex'][k]['guid']) else None
    a, n, s, e = load('_BaseMap'), load('_BumpMap'), load('_SpecGlossMap'), load('_EmissionMap')
    cut = '_ALPHATEST_ON' in m['kw']
    key = name.replace(' ', '_')
    A = np.asarray(a.convert('RGBA'), np.float32) / 255
    S = np.asarray(s.convert('RGBA').resize(a.size, Image.LANCZOS), np.float32) / 255
    sl = lin(S[..., :3]); metal = ss(0.10, 0.30, sl.max(-1))
    base = lin(A[..., :3]) * (1 - metal[..., None]) + sl * metal[..., None]
    base = np.clip(srgb(np.maximum(base, 0.012)), 0, 1)
    rough = np.clip(1 - S[..., 3], 0.04, 1)
    csize = 1024
    nsize = 2048 if name.startswith(BIG) else 1024
    alpha = A[..., 3] if cut else metal
    C = Image.fromarray((np.concatenate([base, alpha[..., None]], -1) * 255 + 0.5).astype(np.uint8), 'RGBA').resize((csize, csize), Image.LANCZOS)
    C.save(os.path.join(out, key + '_c.webp'), quality=90, method=6, alpha_quality=92, exact=True)
    N = np.asarray(n.convert('RGB'), np.float32) / 255
    R = np.asarray(Image.fromarray((rough * 255).astype(np.uint8)).resize(n.size, Image.LANCZOS), np.float32) / 255
    NN = Image.fromarray((np.stack([N[..., 0], N[..., 1], R], -1) * 255 + 0.5).astype(np.uint8), 'RGB').resize((nsize, nsize), Image.LANCZOS)
    NN.save(os.path.join(out, key + '_n.webp'), quality=88, method=6)
    meta[key] = {'cut': cut, 'metal': round(float(metal.mean()), 3), 'rough': round(float(rough.mean()), 3), 'avg': [round(float(v), 3) for v in lin(base).reshape(-1, 3).mean(0)]}
    if e is not None:
        Image.fromarray(np.asarray(e.convert('RGB'))).resize((512, 512), Image.LANCZOS).save(os.path.join(out, key + '_e.webp'), quality=88); meta[key]['emissive'] = [m['c']['_EmissionColor'][k] for k in 'rgb']
    print(key, a.size, 'cut' if cut else '', meta[key]['metal'], meta[key]['rough'])
json.dump(meta, open(os.path.join(out, 'materials.json'), 'w'), indent=0)
