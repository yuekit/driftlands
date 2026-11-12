# Tall City volume bake: occupancy -> sky visibility (upper and lower hemisphere), sun visibility, distance field.
#   python3 tall_volume.py <out dir with city_tris.npy, city.json> <dst.vol> [voxel=1.0] [pad=8]
# Output: <dst>.json (dims, origin, voxel size, atlas layout) and four grey WebP atlases of z slices:
# <dst>_up (sky visibility from above), _sun (sun visibility), _dist (distance to the nearest surface, 0..DMAX units), _dn (sky visibility from below).
import sys, json, numpy as np
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
VOX = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
PAD = float(sys.argv[4]) if len(sys.argv) > 4 else 8.0
DMAX = 20.0
SUN = np.array([0.62, 0.30, 0.73]); SUN /= np.linalg.norm(SUN)

tri = np.load(src + '/city_tris.npy').astype(np.float64)
meta = json.load(open(src + '/city.json'))
lo = np.array(meta['bounds']['min']) - PAD; hi = np.array(meta['bounds']['max']) + PAD
dims = np.ceil((hi - lo) / VOX).astype(int)
print('grid', dims, 'voxels', dims.prod() / 1e6, 'M')

# ---- surface voxelisation: sample every triangle on a barycentric grid finer than half a voxel
occ = np.zeros(dims, dtype=bool)
e = np.stack([np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1), np.linalg.norm(tri[:, 2] - tri[:, 1], axis=1), np.linalg.norm(tri[:, 0] - tri[:, 2], axis=1)], 1).max(1)
n = np.clip(np.ceil(e / (0.45 * VOX)).astype(int), 1, 400)
for k in np.unique(n):
    T = tri[n == k]
    i, j = np.meshgrid(np.arange(k + 1), np.arange(k + 1), indexing='ij'); m = (i + j) <= k
    u = i[m] / k; v = j[m] / k; w = 1 - u - v
    for s in range(0, len(T), 20000):
        t = T[s:s + 20000]
        P = t[:, None, 0] * w[None, :, None] + t[:, None, 1] * u[None, :, None] + t[:, None, 2] * v[None, :, None]
        ix = np.floor((P.reshape(-1, 3) - lo) / VOX).astype(int)
        ok = ((ix >= 0) & (ix < dims)).all(1); ix = ix[ok]
        occ[ix[:, 0], ix[:, 1], ix[:, 2]] = True
print('occupied', occ.sum(), 'of', occ.size, round(occ.mean() * 100, 2), '%')

# ---- light sweep: light arriving at every voxel from direction L (pointing at the light), the open boundary is lit
def sweep(L):
    a = int(np.argmax(np.abs(L))); s = 1 if L[a] > 0 else -1
    b, c = [x for x in range(3) if x != a]
    db, dc = L[b] / abs(L[a]), L[c] / abs(L[a])
    O = np.moveaxis(occ, a, 0)                      # slices along the dominant axis
    out = np.empty(O.shape, dtype=np.float32)
    order = range(O.shape[0] - 1, -1, -1) if s > 0 else range(O.shape[0])
    prev = np.ones(O.shape[1:], dtype=np.float32)   # light leaving the slice before this one
    for k in order:
        inc = ndimage.shift(prev, (-db, -dc), order=1, mode='constant', cval=1.0)
        out[k] = inc
        prev = inc * (~O[k])
    return np.moveaxis(out, 0, a)

sun = np.zeros(dims, dtype=np.float32)
jit = [(0, 0), (0.02, 0.01), (-0.02, 0.012), (0.008, -0.022), (-0.012, -0.018)]
for jx, jy in jit:
    L = SUN + np.array([jx, jy, -jx]); L /= np.linalg.norm(L); sun += sweep(L)
sun /= len(jit)
print('sun mean', sun.mean())

N = 64
up = np.zeros(dims, dtype=np.float32); dn = np.zeros(dims, dtype=np.float32); wu = wd = 0.0
ga = np.pi * (3 - np.sqrt(5))
for i in range(N):
    y = 1 - 2 * (i + 0.5) / N; r = np.sqrt(1 - y * y); th = ga * i
    L = np.array([np.cos(th) * r, y, np.sin(th) * r])
    v = sweep(L)
    if y > 0: w = 0.35 + 0.65 * y; up += v * w; wu += w
    else: w = 0.35 - 0.65 * y; dn += v * w; wd += w
up /= wu; dn /= wd
print('sky up mean', up.mean(), 'down', dn.mean())

dist = ndimage.distance_transform_edt(~occ).astype(np.float32) * VOX
dist = np.maximum(dist - 0.5 * VOX, 0)
print('dist max', dist.max())

# four grey atlases (z slices laid out in a grid), lossy WebP: smooth fields compress far better this way than deflate
from PIL import Image
import math
nx, ny, nz = [int(d) for d in dims]
cols = int(math.ceil(math.sqrt(nz * ny / nx))); rows = int(math.ceil(nz / cols))
def atlas(a, name, q):
    v = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    A = np.zeros((rows * ny, cols * nx), np.uint8)
    for z in range(nz):
        r, c = divmod(z, cols)
        A[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = v[:, :, z].T      # row = y, column = x
    Image.fromarray(A).save(f'{dst}_{name}.webp', quality=q, method=6)
    import os; return os.path.getsize(f'{dst}_{name}.webp')
sizes = [atlas(up, 'up', 88), atlas(sun, 'sun', 88), atlas(np.clip(dist / DMAX, 0, 1), 'dist', 94), atlas(dn, 'dn', 84)]
json.dump({'dims': [nx, ny, nz], 'origin': [float(x) for x in lo], 'voxel': VOX, 'cols': cols, 'rows': rows, 'dmax': DMAX}, open(dst + '.json', 'w'))
print('atlas', cols, 'x', rows, 'bytes', sizes, sum(sizes) / 1e6, 'MB')
np.save(src + '/city_dist.npy', dist.astype(np.float16)); np.save(src + '/city_occ.npy', occ)
