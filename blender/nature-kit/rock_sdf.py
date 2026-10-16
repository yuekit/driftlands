"""Rock shapes as signed-distance fields (three.js space, Y up, metres) -> marching-cubes meshes.

Each rock: verts, faces, per-vertex curvature (convex>0) and moss mask, saved to rocks/<name>.npz.
Floating rocks echo the islands: a flat mossy cap, faceted cliff sides with sedimentary grooves,
and a tapering, lumpy keel. Boulders are angular, bedded and chipped.
"""
import sys, math, time
import numpy as np
from skimage.measure import marching_cubes
from scipy.ndimage import gaussian_filter, map_coordinates

# ------------------------------------------------------------------ gradient noise (vectorised)
class Noise:
    def __init__(self, seed):
        r = np.random.default_rng(seed)
        self.perm = np.concatenate([r.permutation(256)] * 2).astype(np.int32)
        g = r.normal(size=(256, 3)); self.grad = (g / np.linalg.norm(g, axis=1, keepdims=True)).astype(np.float32)
    def __call__(self, x, y, z):
        P, G = self.perm, self.grad
        xi, yi, zi = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32), np.floor(z).astype(np.int32)
        xf, yf, zf = (x - xi).astype(np.float32), (y - yi).astype(np.float32), (z - zi).astype(np.float32)
        xi &= 255; yi &= 255; zi &= 255
        f = lambda t: t * t * t * (t * (t * 6 - 15) + 10)
        u, v, w = f(xf), f(yf), f(zf)
        out = 0
        acc = {}
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    h = P[P[P[xi + dx] + yi + dy] + zi + dz]
                    g = G[h]
                    acc[(dx, dy, dz)] = g[..., 0] * (xf - dx) + g[..., 1] * (yf - dy) + g[..., 2] * (zf - dz)
        lerp = lambda a, b, t: a + (b - a) * t
        x00 = lerp(acc[(0, 0, 0)], acc[(1, 0, 0)], u); x10 = lerp(acc[(0, 1, 0)], acc[(1, 1, 0)], u)
        x01 = lerp(acc[(0, 0, 1)], acc[(1, 0, 1)], u); x11 = lerp(acc[(0, 1, 1)], acc[(1, 1, 1)], u)
        return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
    def fbm(self, x, y, z, octaves=4, lac=2.03, gain=0.5):
        s, a, f = 0, 1.0, 1.0
        for i in range(octaves):
            s = s + a * self(x * f + i * 17.1, y * f + i * 5.3, z * f - i * 9.7); a *= gain; f *= lac
        return s
    def ridged(self, x, y, z, octaves=3):
        s, a, f = 0, 1.0, 1.0
        for i in range(octaves):
            s = s + a * (1 - np.abs(self(x * f + i * 3.7, y * f - i * 7.1, z * f + i * 1.9))) ** 2; a *= 0.5; f *= 2.1
        return s

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def ellipsoid(X, Y, Z, c, r):
    q = np.sqrt(((X - c[0]) / r[0]) ** 2 + ((Y - c[1]) / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2)
    return (q - 1) * min(r)

def rand_dirs(rng, n, ymin, ymax):
    out = []
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi) if i == 0 else out[-1][3] + 2 * math.pi / n * rng.uniform(0.7, 1.3)
        y = rng.uniform(ymin, ymax); h = math.sqrt(max(0, 1 - y * y))
        out.append((math.cos(a) * h, y, math.sin(a) * h, a))
    return [np.array(o[:3], np.float32) for o in out]

# ------------------------------------------------------------------ shapes
def floating(seed, R=6.0, depth=11.0):
    rng = np.random.default_rng(seed); N = Noise(seed)
    ext = (R * 1.35, 3.0, depth + 1.5)
    res = 0.085
    xs = np.arange(-ext[0], ext[0], res, dtype=np.float32); ys = np.arange(-ext[2], ext[1], res, dtype=np.float32)
    X, Y, Z = np.meshgrid(xs, ys, xs, indexing='ij')
    sx, sz = rng.uniform(0.8, 1.1), rng.uniform(0.75, 1.0)
    # cap slab + tapering keel + lumps
    t = np.clip(-Y / depth, 0, 1)
    lean = rng.uniform(-0.35, 0.35, 2) * R
    Xl, Zl = X - lean[0] * t * t, Z - lean[1] * t * t
    rad = np.sqrt((Xl / sx) ** 2 + (Zl / sz) ** 2) + N.fbm(X * 0.09, Y * 0.04, Z * 0.09, 2) * R * 0.22
    prof = R * (1 - t ** rng.uniform(1.4, 2.0)) * (1 - 0.18 * t) + 0.25
    d = (rad - prof) * 0.8
    d = smax(d, -Y - depth, 0.6)
    for i in range(rng.integers(2, 4)):
        a = rng.uniform(0, 6.28); rr = R * rng.uniform(0.25, 0.5)
        c = (math.cos(a) * rr, -depth * rng.uniform(0.35, 0.7), math.sin(a) * rr)
        lump = ellipsoid(X, Y, Z, c, (R * 0.32, depth * rng.uniform(0.28, 0.4), R * 0.3))
        d = smin(d, lump, 1.2)
    top = 0.5 + N.fbm(X * 0.12, 0, Z * 0.12, 3) * 0.7 + 0.25 * np.exp(-(rad / R) ** 2 * 2)
    d = smax(d, Y - top, 0.35)
    # faceted cliffs: plane cuts, mostly vertical, a few downward
    for n in rand_dirs(rng, 9, -0.25, 0.15) + rand_dirs(rng, 4, -0.85, -0.55):
        dot = X * n[0] + Y * n[1] + Z * n[2]
        sup = np.max(dot[d < 0])
        d = smax(d, dot - sup * rng.uniform(0.8, 0.93), 0.12)
    return finish(d, X, Y, Z, xs, ys, res, N, rng, strata=1.0, wobble=0.3, keel=True)

def boulder(seed, size=(3.0, 2.0, 2.4)):
    rng = np.random.default_rng(seed); N = Noise(seed)
    res = 0.03
    e = max(size) * 0.75
    xs = np.arange(-e, e, res, dtype=np.float32); ys = np.arange(-size[1] * 0.75, size[1] * 0.75, res, dtype=np.float32)
    X, Y, Z = np.meshgrid(xs, ys, xs, indexing='ij')
    d = ellipsoid(X, Y, Z, (0, 0, 0), (size[0] / 2, size[1] / 2, size[2] / 2))
    d = smin(d, ellipsoid(X, Y, Z, (size[0] * 0.18, size[1] * 0.12, -size[2] * 0.1), (size[0] * 0.35, size[1] * 0.4, size[2] * 0.33)), 0.3)
    for n in rand_dirs(rng, 11, -0.3, 0.8):
        dot = X * n[0] + Y * n[1] + Z * n[2]
        sup = np.max(dot[d < 0])
        d = smax(d, dot - sup * rng.uniform(0.72, 0.9), 0.035)
    d = smax(d, -Y - size[1] * 0.42, 0.1)       # flat-ish bed it sits on
    return finish(d, X, Y, Z, xs, ys, res, N, rng, strata=0.4, wobble=0.05, keel=False, scale=size[0] / 3, frac=0.1, fine=0.025)

def finish(d, X, Y, Z, xs, ys, res, N, rng, strata, wobble, keel, scale=1.0, frac=0.35, fine=0.05):
    k = 1.0 / scale
    # sedimentary grooves on the sides (bedding planes), warped
    tilt = rng.normal(0, 0.06, 2)
    yy = (Y + X * tilt[0] + Z * tilt[1]) * k
    bed = yy * 1.1 + N.fbm(X * 0.12 * k, Y * 0.03 * k, Z * 0.12 * k, 2) * 0.9 + np.sin(yy * 0.7 + 1.3) * 0.6   # uneven thicknesses
    layer = np.floor(bed); fr = bed - layer
    h = np.sin(layer * 12.9898 + rng.uniform(0, 100)) * 43758.5453; h = h - np.floor(h)      # per-layer hash
    step = (h - 0.5) * 0.32 * strata * scale                                                  # each bed sits in or out
    edge = np.clip((0.5 - np.abs(fr - 0.5)) / 0.08, 0, 1)                                    # soften bed boundaries
    groove = np.clip(1 - np.abs(fr - 0.5) * 9.0, 0, 1) ** 2 * (h > 0.35)
    d = d + step * edge + groove * 0.1 * strata * scale
    # erosion + chips
    d = d + N.fbm(X * 0.22 * k, Y * 0.22 * k, Z * 0.22 * k, 3) * wobble
    d = d - np.maximum(N.ridged(X * 0.7 * k, Y * 0.9 * k, Z * 0.7 * k, 3) - 1.15, 0) * frac * scale     # fracture lines
    d = d + (N.ridged(X * 1.8 * k, Y * 2.4 * k, Z * 1.8 * k, 2) - 0.9) * fine * scale
    d = d + N.fbm(X * 3.0 * k, Y * 3.0 * k, Z * 3.0 * k, 2) * 0.03 * scale
    t0 = time.time()
    ds = gaussian_filter(d, 0.5)
    v, f, nrm, _ = marching_cubes(ds, 0.0, spacing=(res, res, res), allow_degenerate=False)
    v += np.array([xs[0], ys[0], xs[0]], np.float32)
    # curvature = divergence of the unit gradient, smoothed
    gx, gy, gz = np.gradient(gaussian_filter(d, 1.6), res)
    gl = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6
    div = np.gradient(gx / gl, res, axis=0) + np.gradient(gy / gl, res, axis=1) + np.gradient(gz / gl, res, axis=2)
    idx = ((v - np.array([xs[0], ys[0], xs[0]])) / res).T
    curv = map_coordinates(div, idx, order=1) * scale
    nrm = -nrm if np.mean(np.sum(nrm * (v - v.mean(0)), 1)) < 0 else nrm
    nrm = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9)
    # moss: tops and sheltered ledges, patchy
    patch = N.fbm(v[:, 0] * 0.4 * k, v[:, 1] * 0.4 * k, v[:, 2] * 0.4 * k, 3)
    moss = np.clip((nrm[:, 1] - 0.45 + patch * 0.6 - np.clip(curv, 0, 2) * 0.12) / 0.3, 0, 1)
    if keel:
        moss = np.maximum(moss, np.clip((v[:, 1] + 0.2) / 0.6, 0, 1) * np.clip((nrm[:, 1] + 0.2) / 0.4, 0, 1))
    print(f'  mesh {len(v)} verts {len(f)} faces  ({time.time() - t0:.1f}s)')
    return dict(verts=v.astype(np.float32), faces=f[:, ::-1].astype(np.int32) if False else f.astype(np.int32),
                normals=nrm.astype(np.float32), curv=curv.astype(np.float32), moss=moss.astype(np.float32))

if __name__ == '__main__':
    out = sys.argv[1]
    jobs = [('FloatRock_0', lambda: floating(11, 6.2, 11.5)), ('FloatRock_1', lambda: floating(23, 5.4, 9.0)),
            ('FloatRock_2', lambda: floating(37, 7.0, 13.0)), ('FloatRock_3', lambda: floating(41, 4.6, 7.5)),
            ('Boulder_0', lambda: boulder(5, (3.0, 2.1, 2.5))), ('Boulder_1', lambda: boulder(8, (2.4, 1.3, 2.0))),
            ('Boulder_2', lambda: boulder(13, (3.4, 2.8, 2.6))), ('Boulder_3', lambda: boulder(19, (2.0, 1.1, 1.7)))]
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    for name, fn in jobs:
        if only and name not in only: continue
        t = time.time(); r = fn(); np.savez_compressed(f'{out}/{name}.npz', **r); print(name, f'{time.time() - t:.1f}s')
