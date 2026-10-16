"""Tiny vectorised SDF toolkit (numpy) for sculpting creature parts. Coordinates: three.js, Y up, +Z forward."""
import numpy as np, math, json, time
from skimage.measure import marching_cubes
from scipy.ndimage import gaussian_filter, map_coordinates

class Grid:
    def __init__(self, lo, hi, res):
        self.lo = np.array(lo, np.float32); self.res = res
        self.xs = [np.arange(lo[i], hi[i], res, dtype=np.float32) for i in range(3)]
        self.X, self.Y, self.Z = np.meshgrid(*self.xs, indexing='ij')
    @property
    def P(self): return self.X, self.Y, self.Z

def smin(a, b, k):
    if k <= 0: return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def sub(a, b, k=0.0): return smax(a, -b, k)

def sph(P, c, r):
    X, Y, Z = P; return np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2) - r
def ell(P, c, r):
    X, Y, Z = P
    k0 = np.sqrt(((X - c[0]) / r[0]) ** 2 + ((Y - c[1]) / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2)
    k1 = np.sqrt(((X - c[0]) / r[0] ** 2) ** 2 + ((Y - c[1]) / r[1] ** 2) ** 2 + ((Z - c[2]) / r[2] ** 2) ** 2)
    return k0 * (k0 - 1) / (k1 + 1e-6)
def frame(axis, up=(0, 1, 0)):
    a = np.array(axis, float); a /= np.linalg.norm(a)
    u = np.array(up, float); u = u - a * np.dot(u, a)
    if np.linalg.norm(u) < 1e-6: u = np.array([1.0, 0, 0]) - a * a[0]
    u /= np.linalg.norm(u); s = np.cross(u, a)
    return np.stack([s, u, a])          # rows: side, up, axis
def ell_rot(P, c, R, r):
    """ellipsoid with axes R (rows) and radii r along them"""
    X, Y, Z = P; dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
    q = [dx * R[i][0] + dy * R[i][1] + dz * R[i][2] for i in range(3)]
    return ell(q, (0, 0, 0), r)
def rcone(P, a, b, ra, rb):
    """round cone (tapered capsule) from a (radius ra) to b (radius rb)"""
    X, Y, Z = P; a = np.array(a, float); b = np.array(b, float)
    ba = b - a; l2 = np.dot(ba, ba); rr = ra - rb; a2 = l2 - rr * rr; il2 = 1.0 / l2
    px, py, pz = X - a[0], Y - a[1], Z - a[2]
    y = px * ba[0] + py * ba[1] + pz * ba[2]; z = y - l2
    xx = (px * l2 - ba[0] * y) ** 2 + (py * l2 - ba[1] * y) ** 2 + (pz * l2 - ba[2] * y) ** 2
    y2 = y * y * l2; z2 = z * z * l2
    k = np.sign(rr) * rr * rr * xx
    out = np.where(np.sign(z) * a2 * z2 > k, np.sqrt(xx + z2) * il2 - rb,
          np.where(np.sign(y) * a2 * y2 < k, np.sqrt(xx + y2) * il2 - ra, (np.sqrt(xx * a2 * il2) + y * rr) * il2 - ra))
    return out
def chain(P, pts, radii, k=0.05):
    d = None
    for i in range(len(pts) - 1):
        e = rcone(P, pts[i], pts[i + 1], radii[i], radii[i + 1])
        d = e if d is None else smin(d, e, k)
    return d
def mirror(fn):
    """apply a sculpt function for x>0 and its mirror (symmetry)"""
    def f(P):
        X, Y, Z = P; return fn((np.abs(X), Y, Z))
    return f

class Noise:
    def __init__(self, seed):
        r = np.random.default_rng(seed); self.perm = np.concatenate([r.permutation(256)] * 2).astype(np.int32)
        g = r.normal(size=(256, 3)); self.grad = (g / np.linalg.norm(g, axis=1, keepdims=True)).astype(np.float32)
    def __call__(self, x, y, z):
        P, G = self.perm, self.grad
        xi, yi, zi = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32), np.floor(z).astype(np.int32)
        xf, yf, zf = (x - xi).astype(np.float32), (y - yi).astype(np.float32), (z - zi).astype(np.float32)
        xi &= 255; yi &= 255; zi &= 255
        f = lambda t: t * t * t * (t * (t * 6 - 15) + 10); u, v, w = f(xf), f(yf), f(zf)
        acc = {}
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    g = G[P[P[P[xi + dx] + yi + dy] + zi + dz]]
                    acc[(dx, dy, dz)] = g[..., 0] * (xf - dx) + g[..., 1] * (yf - dy) + g[..., 2] * (zf - dz)
        L = lambda a, b, t: a + (b - a) * t
        return L(L(L(acc[0, 0, 0], acc[1, 0, 0], u), L(acc[0, 1, 0], acc[1, 1, 0], u), v), L(L(acc[0, 0, 1], acc[1, 0, 1], u), L(acc[0, 1, 1], acc[1, 1, 1], u), v), w)
    def fbm(self, x, y, z, o=4):
        s, a, f = 0, 1.0, 1.0
        for i in range(o): s = s + a * self(x * f + i * 17.1, y * f + i * 5.3, z * f - i * 9.7); a *= 0.5; f *= 2.03
        return s

def mesh(G, d, masks=None, smooth=0.6):
    ds = gaussian_filter(d, smooth) if smooth else d
    v, f, nrm, _ = marching_cubes(ds, 0.0, spacing=(G.res,) * 3, allow_degenerate=False)
    v = v + G.lo
    out = dict(verts=v.astype(np.float32), faces=f.astype(np.int32))
    if masks is not None:
        P = (v[:, 0], v[:, 1], v[:, 2])
        for k, fn in masks.items(): out[k] = np.clip(fn(P), 0, 1).astype(np.float32)
    print(f'  {len(v)} verts {len(f)} faces')
    return out
def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
