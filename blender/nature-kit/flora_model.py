"""Driftlands flora kit, built in Blender from script (three.js space via T(): Y up, metres).

Trees are modelled at real size with their base at the object origin; each part is its own object
(stalk, roots, ring, cap, gills...) parented by name prefix, so it is easy to edit by hand.
Every material carries two extra outputs for the game, named nodes '__tint' and '__glow':
  tint 0 = take the island's trunk colour, 0.5 = keep the painted colour, 1 = take the cap colour
  glow 0..1 = how strongly the part glows at night.
Usage: python flora_model.py <out.blend>"""
import sys, os, math, random
import numpy as np
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import T, reset, link, hexrgb, catmull, frames

OUT = (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])[0]
reset(['Parasol trees', 'Lantern trees', 'Coral trees', 'Small mushrooms', 'Ground cover'])

# ------------------------------------------------------------------ geometry helpers (three space)
def make(name, coll, V, F, mat, desired=None, loc=(0, 0, 0), smooth=True):
    """V in three space; desired(c3, n3) -> vector the face normal should agree with."""
    V = np.asarray(V, np.float64)
    if desired is not None:
        F2 = []
        for f in F:
            a, b, c = V[f[0]], V[f[1]], V[f[2 if len(f) == 3 else 2]]
            n = np.cross(b - a, c - a)
            if np.linalg.norm(n) < 1e-14 and len(f) == 4: n = np.cross(V[f[2]] - a, V[f[3]] - a)
            cen = V[list(f)].mean(0)
            F2.append(tuple(f[::-1]) if np.dot(n, desired(cen)) < 0 else tuple(f))
        F = F2
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(T(*v)) for v in V], [], [tuple(int(i) for i in f) for f in F])
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me); ob.location = T(*loc); link(ob, coll)
    if smooth: me.shade_smooth()
    if mat: me.materials.append(mat)
    return ob

def lathe(profile, seg, center=(0, 0, 0), rmod=None, ymod=None, closed_top=False):
    """profile: [(r, y)] from inner to outer. Returns V, F. r==0 at the first point makes a pole."""
    V, F = [], []
    cx, cy, cz = center
    pole = profile[0][0] < 1e-6
    rings = profile[1:] if pole else profile
    if pole: V.append((cx, cy + profile[0][1], cz))
    base = len(V)
    for i, (r, y) in enumerate(rings):
        for k in range(seg):
            a = 2 * math.pi * k / seg
            rr = r * (rmod(a, i / max(1, len(rings) - 1)) if rmod else 1)
            yy = y + (ymod(a, i / max(1, len(rings) - 1), r) if ymod else 0)
            V.append((cx + rr * math.cos(a), cy + yy, cz + rr * math.sin(a)))
    for i in range(len(rings) - 1):
        for k in range(seg):
            a = base + i * seg + k; b = base + i * seg + (k + 1) % seg
            F.append((a, b, b + seg, a + seg))
    if pole:
        for k in range(seg): F.append((0, base + (k + 1) % seg, base + k))
    return V, F

def tube3(points, radii, seg=10, rmod=None, cap=True):
    P = [Vector(p) for p in points]; Fr = frames(P)
    V, F = [], []
    for i, (p, t, N, B) in enumerate(Fr):
        r = radii[i]
        for k in range(seg):
            a = 2 * math.pi * k / seg
            rr = r * (rmod(a, i / max(1, len(P) - 1)) if rmod else 1)
            V.append(tuple(p + (N * math.cos(a) + B * math.sin(a)) * rr))
    for i in range(len(P) - 1):
        for k in range(seg):
            a = i * seg + k; b = i * seg + (k + 1) % seg
            F.append((a, b, b + seg, a + seg))
    if cap:
        c = len(V); V.append(tuple(P[-1] + Fr[-1][1] * radii[-1] * 0.3)); o = (len(P) - 1) * seg
        for k in range(seg): F.append((o + k, o + (k + 1) % seg, c))
    return V, F, P

def from_line(P):
    """desired-normal function: away from the nearest point of polyline P (three space)."""
    A = np.array([tuple(p) for p in P])
    def fn(c):
        d = A - c; j = np.argmin((d * d).sum(1))
        # project onto neighbouring segment for accuracy
        best = A[j]
        for k in (j - 1, j):
            if 0 <= k < len(A) - 1:
                s = A[k + 1] - A[k]; t = np.clip(np.dot(c - A[k], s) / max(1e-12, np.dot(s, s)), 0, 1)
                q = A[k] + s * t
                if np.sum((c - q) ** 2) < np.sum((c - best) ** 2): best = q
        return c - best
    return fn

def merge(*parts):
    V, F = [], []
    for v, f in parts:
        o = len(V); V += list(v); F += [tuple(i + o for i in x) for x in f]
    return V, F

def sphere3(c, r, sub=2, stretch=(1, 1, 1), bump=None):
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    V = []
    for v in bm.verts:
        d = Vector(v.co).normalized()
        k = 1 + (bump(d) if bump else 0)
        V.append((c[0] + d.x * r * stretch[0] * k, c[1] + d.y * r * stretch[1] * k, c[2] + d.z * r * stretch[2] * k))
    F = [tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
    return V, F

# ------------------------------------------------------------------ material builder
class Mat:
    def __init__(self, name, seed=0, translucent=0.0):
        m = bpy.data.materials.new(name); m.use_nodes = True
        self.m = m; self.nt = m.node_tree; self.b = self.nt.nodes['Principled BSDF']
        tc = self.nt.nodes.new('ShaderNodeTexCoord')
        mp = self.nt.nodes.new('ShaderNodeMapping'); mp.inputs['Location'].default_value = (seed * 13.7, seed * 7.1, 0)
        self.nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); self.co = mp.outputs['Vector']
        self.b.inputs['Roughness'].default_value = 0.72
    def _in(self, sock, v):
        if isinstance(v, (int, float)): sock.default_value = v
        elif isinstance(v, tuple): sock.default_value = v
        else: self.nt.links.new(v, sock)
    def node(self, kind, **kw):
        n = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if k in n.bl_rna.properties: setattr(n, k, v)
            else: self._in(n.inputs[k.replace('_', ' ')], v)
        return n
    def math(self, op, a, b=0.0, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        self._in(n.inputs[0], a); self._in(n.inputs[1], b); return n.outputs[0]
    def mixf(self, f, a, b):
        n = self.nt.nodes.new('ShaderNodeMix'); n.data_type = 'FLOAT'
        self._in(n.inputs['Factor'], f); self._in(n.inputs[2], a); self._in(n.inputs[3], b); return n.outputs[0]
    def mixc(self, f, a, b):
        n = self.nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'
        self._in(n.inputs['Factor'], f); self._in(n.inputs[6], a); self._in(n.inputs[7], b); return n.outputs[2]
    def grey(self, v):
        n = self.nt.nodes.new('ShaderNodeCombineColor'); self._in(n.inputs[0], v); self._in(n.inputs[1], v); self._in(n.inputs[2], v); return n.outputs[0]
    def smooth(self, x, lo, hi):
        n = self.nt.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
        self._in(n.inputs['Value'], x); n.inputs['From Min'].default_value = lo; n.inputs['From Max'].default_value = hi
        return n.outputs['Result']
    def coord(self, loc=(0, 0, 0), scale=(1, 1, 1)):
        mp = self.nt.nodes.new('ShaderNodeMapping'); self._in(mp.inputs['Vector'], self.co)
        mp.inputs['Location'].default_value = loc; mp.inputs['Scale'].default_value = scale
        return mp.outputs['Vector']
    def noise(self, co, scale, detail=4.0, rough=0.55):
        n = self.nt.nodes.new('ShaderNodeTexNoise'); self._in(n.inputs['Vector'], co)
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']
    def voronoi(self, co, scale, feature='F1', out='Distance', rnd=1.0):
        n = self.nt.nodes.new('ShaderNodeTexVoronoi'); n.feature = feature; self._in(n.inputs['Vector'], co)
        n.inputs['Scale'].default_value = scale; n.inputs['Randomness'].default_value = rnd
        return n.outputs[out]
    def radial(self, center3, count):
        """sin(count * angle around the vertical axis through center3) in [-1, 1]"""
        c = T(*center3)
        mp = self.nt.nodes.new('ShaderNodeMapping'); self._in(mp.inputs['Vector'], self.co)
        mp.inputs['Location'].default_value = (-c.x, -c.y, 0)
        g = self.nt.nodes.new('ShaderNodeTexGradient'); g.gradient_type = 'RADIAL'; self._in(g.inputs['Vector'], mp.outputs['Vector'])
        return self.math('SINE', self.math('MULTIPLY', g.outputs['Fac'], 2 * math.pi * count))
    def finish(self, color, tint, glow, height=None, strength=0.35, dist=0.04, rough=None):
        self._in(self.b.inputs['Base Color'], color)
        t = self.nt.nodes.new('ShaderNodeMath'); t.name = '__tint'; t.operation = 'ADD'; self._in(t.inputs[0], tint); t.inputs[1].default_value = 0
        g = self.nt.nodes.new('ShaderNodeMath'); g.name = '__glow'; g.operation = 'ADD'; self._in(g.inputs[0], glow); g.inputs[1].default_value = 0
        if height is not None:
            bn = self.nt.nodes.new('ShaderNodeBump'); bn.inputs['Strength'].default_value = strength; bn.inputs['Distance'].default_value = dist
            self._in(bn.inputs['Height'], height); self.nt.links.new(bn.outputs['Normal'], self.b.inputs['Normal'])
        if rough is not None: self._in(self.b.inputs['Roughness'], rough)
        return self.m

CREAM = hexrgb('#f3e7cf')

def mat_cap(name, seed, spot_scale=1.2, spot_size=0.22, center=(0, 0, 0)):
    M = Mat(name, seed)
    co = M.co
    vd = M.voronoi(M.coord(scale=(spot_scale,) * 3), 1.0)
    jitter = M.noise(M.coord(scale=(0.6,) * 3), 1.0, 2)
    spot = M.smooth(M.math('ADD', vd, M.math('MULTIPLY', jitter, -0.12)), spot_size + 0.03, spot_size - 0.03)
    mott = M.noise(co, 2.8, 6)
    streak = M.radial(center, 140)
    g = M.math('ADD', M.math('MULTIPLY', mott, 0.22), 0.72)
    g = M.math('ADD', g, M.math('MULTIPLY', streak, 0.025))
    col = M.mixc(spot, M.grey(g), CREAM)
    tint = M.mixf(spot, 1.0, 0.5)
    glow = M.math('MULTIPLY', spot, 0.55)
    h = M.math('ADD', M.math('MULTIPLY', spot, 0.8), M.math('MULTIPLY', mott, 0.3))
    return M.finish(col, tint, glow, h, 0.45, 0.05, 0.55)

def mat_gills(name, seed, center):
    M = Mat(name, seed)
    lam = M.math('ABSOLUTE', M.radial(center, 120))
    groove = M.smooth(lam, 0.35, 0.0)
    fine = M.noise(M.co, 9.0, 3)
    g = M.math('SUBTRACT', 0.9, M.math('MULTIPLY', groove, 0.3))
    col = M.grey(M.math('ADD', g, M.math('MULTIPLY', fine, 0.06)))
    glow = M.math('MULTIPLY', M.math('SUBTRACT', 1.0, groove), 0.9)
    return M.finish(col, 0.75, glow, M.math('SUBTRACT', 1.0, groove), 0.6, 0.03, 0.8)

def mat_stalk(name, seed, fibre=(5, 5, 0.3), base_dark=1.4):
    M = Mat(name, seed)
    fib = M.noise(M.coord(scale=fibre), 3.0, 8, 0.6)
    fl = M.smooth(M.voronoi(M.coord(scale=(2.4, 2.4, 1.1)), 1.0), 0.13, 0.07)
    z = M.node('ShaderNodeSeparateXYZ', Vector=M.co).outputs['Z']
    stain = M.mixf(M.smooth(z, 0.0, base_dark), 0.5, 1.0)
    g = M.math('MULTIPLY', M.math('ADD', 0.62, M.math('MULTIPLY', fib, 0.32)), stain)
    col = M.mixc(M.math('MULTIPLY', fl, 0.7), M.grey(g), CREAM)
    tint = M.mixf(M.math('MULTIPLY', fl, 0.7), 0.0, 0.5)
    return M.finish(col, tint, 0.0, M.math('ADD', fib, M.math('MULTIPLY', fl, 0.6)), 0.55, 0.04, 0.8)

def mat_ring(name, seed):
    M = Mat(name, seed)
    w = M.noise(M.coord(scale=(4, 4, 9)), 2.0, 5)
    col = M.mixc(M.math('MULTIPLY', w, 0.4), CREAM, hexrgb('#d9c7a6'))
    return M.finish(col, 0.5, 0.15, w, 0.5, 0.02, 0.75)

def mat_lantern(name, seed, center, ribs):
    M = Mat(name, seed)
    seam = M.smooth(M.math('ABSOLUTE', M.radial(center, ribs / 2)), 0.08, 0.0)
    vein = M.smooth(M.voronoi(M.coord(scale=(1.1, 1.1, 0.55)), 1.0, 'DISTANCE_TO_EDGE'), 0.025, 0.0)
    mott = M.noise(M.co, 2.2, 5)
    g = M.math('ADD', 0.8, M.math('MULTIPLY', mott, 0.16))
    lines = M.math('MAXIMUM', seam, M.math('MULTIPLY', vein, 0.45))
    col = M.mixc(lines, M.grey(g), M.grey(0.97))
    tint = M.mixf(lines, 1.0, 0.8)
    glow = M.mixf(lines, 0.5, 1.0)
    return M.finish(col, tint, glow, M.math('ADD', lines, M.math('MULTIPLY', mott, 0.3)), 0.4, 0.04, 0.6)

def mat_wrinkle(name, seed, scale=2.2):
    M = Mat(name, seed)
    wv = M.noise(M.coord(scale=(0.45, 0.45, 3.2)), scale, 7, 0.62)
    wv = M.smooth(wv, 0.3, 0.75)
    n = M.noise(M.co, 4.0, 6)
    z = M.node('ShaderNodeSeparateXYZ', Vector=M.co).outputs['Z']
    stain = M.mixf(M.smooth(z, 0.0, 1.2), 0.55, 1.0)
    g = M.math('MULTIPLY', M.math('ADD', 0.6, M.math('ADD', M.math('MULTIPLY', wv, 0.18), M.math('MULTIPLY', n, 0.14))), stain)
    return M.finish(M.grey(g), 0.0, 0.0, M.math('ADD', wv, M.math('MULTIPLY', n, 0.4)), 0.55, 0.05, 0.85)

def mat_coralpuff(name, seed):
    M = Mat(name, seed)
    lob = M.voronoi(M.coord(scale=(2.2,) * 3), 1.0, 'SMOOTH_F1')
    pore = M.smooth(M.voronoi(M.coord(scale=(11,) * 3), 1.0), 0.16, 0.08)
    mott = M.noise(M.co, 3.0, 5)
    g = M.math('ADD', 0.82, M.math('MULTIPLY', mott, 0.14))
    col = M.mixc(pore, M.grey(g), M.grey(0.55))
    glow = M.mixf(pore, 0.2, 1.0)
    h = M.math('SUBTRACT', M.math('MULTIPLY', lob, -1.0), M.math('MULTIPLY', pore, 0.4))
    return M.finish(col, M.mixf(pore, 1.0, 0.8), glow, h, 0.5, 0.06, 0.65)

# ------------------------------------------------------------------ trees
rng = random.Random(3)

def parasol(name, x0, seed, H=16.0, capR=6.5, capH=1.6, rs=1.0, lean=(0.6, 0.0), ring_at=0.7, droop=0.5, wave=5, rim_up=0.0):
    coll = 'Parasol trees'; loc = (x0, 0, 0)
    top = (lean[0], H, lean[1])
    # stalk: S-curve, fluted, flared base and a bulb under the cap
    ctrl = [(0, -0.6, 0), (0, 0.5, 0), (lean[0] * 0.2, H * 0.35, lean[1] * 0.2), (lean[0] * 0.7, H * 0.72, lean[1] * 0.7), top]
    P = catmull(ctrl, 5)
    n = len(P)
    def rr(t):
        flare = 1 + 0.75 * math.exp(-t * 14) 
        return rs * 1.25 * flare * (1 - 0.2 * t) * (1 + 0.22 * math.exp(-((t - 0.97) / 0.05) ** 2))
    radii = [rr(i / (n - 1)) for i in range(n)]
    V, F, Pl = tube3(P, radii, 14, rmod=lambda a, t: 1 + 0.045 * math.sin(a * 9 + t * 4) + 0.02 * math.sin(a * 23), cap=False)
    make(name + '_Stalk', coll, V, F, mat_stalk(name + '_M_Stalk', seed), from_line(Pl), loc)
    # buttress roots
    RV, RF = [], []
    for j in range(5):
        a = j / 5 * 6.28 + rng.uniform(-0.3, 0.3); L = rng.uniform(1.6, 2.6)
        pts = [(math.cos(a) * rs * 0.3, 1.6, math.sin(a) * rs * 0.3), (math.cos(a) * rs * 1.3, 0.55, math.sin(a) * rs * 1.3),
               (math.cos(a) * (rs + L * 0.7), -0.15, math.sin(a) * (rs + L * 0.7)), (math.cos(a) * (rs + L), -0.55, math.sin(a) * (rs + L))]
        cp = catmull(pts, 3)
        v, f, pl = tube3(cp, [rs * 0.75 * (1 - 0.82 * i / (len(cp) - 1)) + 0.06 for i in range(len(cp))], 7, rmod=lambda a, t: 1 + 0.25 * math.cos(2 * a))
        o = len(RV); RV += v; RF += [tuple(i + o for i in x) for x in f]
    rp = [Vector(p) for p in [(0, -1, 0), (0, 2, 0)]]
    make(name + '_Roots', coll, RV, RF, bpy.data.materials[name + '_M_Stalk'], lambda c: np.array([c[0], 0.25 * (c[1] + 0.6), c[2]]), loc)
    # skirt ring (annulus) hanging from the stalk
    ry = H * ring_at; ri = int(ring_at * (n - 1)); rc = P[ri]; r0 = radii[ri] * 0.98
    prof = [(r0, 0.05), (r0 + 0.45, -0.15), (r0 + 0.95, -0.6), (r0 + 1.2, -1.25), (r0 + 1.28, -1.55)]
    V, F = lathe(prof, 28, (rc.x, rc.y, rc.z), rmod=lambda a, t: 1 + 0.07 * t * math.sin(a * 7 + 1.3), ymod=lambda a, t, r: -0.15 * t * (0.5 + 0.5 * math.sin(a * 5)))
    make(name + '_Ring', coll, V, F, mat_ring(name + '_M_Ring', seed), lambda c: np.array([c[0] - rc.x, 0.6, c[2] - rc.z]), loc)
    # cap: dome with umbo and wavy, drooping rim
    cy = H + 0.15
    rings = 11
    prof = []
    for i in range(rings + 1):
        u = i / rings; r = capR * u
        y = capH * (1 - u ** 2.1) + 0.35 * math.exp(-(u / 0.13) ** 2) - droop * max(0, u - 0.82) ** 2 / 0.0324 * 0.6 + rim_up * u ** 6
        prof.append((r, y))
    wv = lambda a, t, r: (0.18 * t ** 3) * math.sin(a * wave + seed) + 0.06 * t ** 2 * math.sin(a * 13 + 2 * seed)
    capc = (top[0], cy, top[2])
    V, F = lathe(prof, 48, capc, rmod=lambda a, t: 1 + 0.035 * t * math.sin(a * wave + seed), ymod=wv)
    # rim lip: roll under to the gill surface
    capm = mat_cap(name + '_M_Cap', seed, 1.25 if capR > 6 else 1.5, 0.22, capc)
    make(name + '_Cap', coll, V, F, capm, lambda c: np.array([c[0] - capc[0], 2.5, c[2] - capc[2]]), loc)
    # gills: underside from the rim back to the stalk bulb
    gp = []
    for i in range(7):
        u = 1 - i / 6
        r = radii[-1] * 0.95 + (capR * 0.985 - radii[-1] * 0.95) * u
        uu = r / capR
        ytop = capH * (1 - uu ** 2.1) - droop * max(0, uu - 0.82) ** 2 / 0.0324 * 0.6 + rim_up * uu ** 6
        y = ytop - 0.12 - 0.55 * (1 - u) ** 0.7 * (1 - uu) * 2.2
        gp.append((r, y))
    gp = gp[::-1]
    V, F = lathe(gp, 48, capc, rmod=lambda a, t: 1 + 0.035 * t * math.sin(a * wave + seed), ymod=lambda a, t, r: wv(a, r / capR, r) - 0.02)
    make(name + '_Gills', coll, V, F, mat_gills(name + '_M_Gills', seed, capc), lambda c: np.array([0, -1.0, 0]), loc)
    tip = bpy.data.objects.new(name + '_Tip', None); tip.location = T(*(Vector(loc) + Vector(capc))); link(tip, coll)

def lantern(name, x0, seed, H=6.0, R=2.4, S=1.65, rb=2.0, ribs=10, twin=False):
    coll = 'Lantern trees'; loc = (x0, 0, 0)
    stalk_m = mat_wrinkle(name + '_M_Trunk', seed)
    heads = []
    if twin:
        forks = [(-1.1, H, 0.2, 0.8), (1.0, H * 0.82, -0.3, 0.72)]
    else:
        forks = [(0.3, H, 0.0, 1.0)]
    TV, TF = [], []
    for k, (fx, fy, fz, sc) in enumerate(forks):
        ctrl = [(0, -0.7, 0), (0, 0.6, 0), (fx * 0.3, fy * 0.45, fz * 0.3), (fx, fy, fz)]
        P = catmull(ctrl, 5); n = len(P)
        def rr(t):  # bottle trunk: fat belly, narrow neck
            belly = math.exp(-((t - 0.25) / 0.3) ** 2)
            return (rb * (0.55 + 0.45 * belly) * (1 + 0.35 * math.exp(-t * 12))) * (1 - 0.55 * t ** 1.6) * (0.75 if twin else 1)
        radii = [rr(i / (n - 1)) for i in range(n)]
        v, f, pl = tube3(P, radii, 16, rmod=lambda a, t: 1 + 0.05 * math.sin(a * 6 + t * 9) * (1 - t), cap=False)
        o = len(TV); TV += v; TF += [tuple(i + o for i in x) for x in f]
        heads.append(((fx, fy + R * S * sc * 0.82, fz), sc, pl))
    lines = [h[2] for h in heads]
    def trunk_dir(c):
        return min((from_line(l)(c) for l in lines), key=lambda d: np.dot(d, d))
    make(name + '_Trunk', coll, TV, TF, stalk_m, trunk_dir, loc)
    for k, (c, sc, _) in enumerate(heads):
        # ribbed puff: pumpkin/lantern segments, pinched top with a finial
        prof = []
        for i in range(15):
            th = math.pi * i / 14
            prof.append((R * sc * math.sin(th) * (1 + 0.08 * math.sin(th * 2)), -R * S * sc * math.cos(th) * 0.95))
        prof[0] = (0.0, prof[0][1]); prof = prof[::-1]
        V, F = lathe(prof, 44, c, rmod=lambda a, t: 1 + 0.12 * abs(math.sin(a * ribs / 2)) ** 0.7 - 0.06)
        make(name + f'_Puff{k}', coll, V, F, mat_lantern(name + f'_M_Puff{k}', seed + k, c, ribs), lambda q, c=c: np.array(q) - np.array(c), loc)
        # finial
        ft = (c[0], c[1] + R * S * sc * 0.95, c[2])
        v, f, pl = tube3([ft, (ft[0], ft[1] + 0.5 * sc, ft[2]), (ft[0] + 0.1, ft[1] + 0.9 * sc, ft[2])], [0.25 * sc, 0.12 * sc, 0.05], 8)
        make(name + f'_Finial{k}', coll, v, f, mat_ring(name + f'_M_Finial{k}', seed), from_line(pl), loc)
        tip = bpy.data.objects.new(name + f'_Tip{k}', None); tip.location = T(*(Vector(loc) + Vector(c))); link(tip, coll)

def coral(name, x0, seed, H=12.0, spread=4.5, arms=4, puffR=1.7):
    coll = 'Coral trees'; loc = (x0, 0, 0)
    r = random.Random(seed)
    TV, TF, lines = [], [], []
    def branch(p0, d0, L, r0, depth):
        pts = [Vector(p0)]; d = Vector(d0).normalized()
        for s in range(4):
            d = (d + Vector((r.uniform(-.25, .25), 0.18, r.uniform(-.25, .25)))).normalized()
            pts.append(pts[-1] + d * L / 4)
        cp = catmull(pts, 2)
        rad = [r0 * (1 - 0.45 * i / (len(cp) - 1)) for i in range(len(cp))]
        v, f, pl = tube3(cp, rad, 7 if depth < 2 else 10, cap=depth > 0)
        o = len(TV); TV.extend(v); TF.extend(tuple(i + o for i in x) for x in f); lines.append(pl)
        tipp = cp[-1]
        if depth == 0:
            return [(tipp, rad[-1])]
        out = []
        n = 2 if depth == 1 else arms
        for k in range(n):
            a = k / n * 6.28 + r.uniform(-0.4, 0.4)
            dd = Vector((math.cos(a), 0.9 if depth == 2 else 0.6, math.sin(a)))
            out += branch(tipp, dd, L * 0.62, rad[-1] * 0.85, depth - 1)
        return out
    trunkL = H * 0.42
    tips = branch((0, -0.6, 0), (0.25, 1, 0.1), trunkL, 0.95, 2)
    # root flare
    for j in range(4):
        a = j / 4 * 6.28 + 0.4
        cp = catmull([(math.cos(a) * 0.2, 1.0, math.sin(a) * 0.2), (math.cos(a) * 0.9, 0.1, math.sin(a) * 0.9), (math.cos(a) * 1.7, -0.5, math.sin(a) * 1.7)], 4)
        v, f, pl = tube3(cp, [0.5 * (1 - 0.8 * i / (len(cp) - 1)) + 0.05 for i in range(len(cp))], 8)
        o = len(TV); TV.extend(v); TF.extend(tuple(i + o for i in x) for x in f); lines.append(pl)
    def dirfn(c): return min((from_line(l)(c) for l in lines), key=lambda d: np.dot(d, d))
    make(name + '_Branches', coll, TV, TF, mat_wrinkle(name + '_M_Branch', seed, 3.5), dirfn, loc)
    PV, PF = [], []
    for k, (tp, tr) in enumerate(tips):
        R0 = puffR * r.uniform(0.75, 1.15)
        c0 = Vector(tp) + Vector((0, R0 * 0.55, 0))
        blobs = [(c0, R0)] + [(c0 + Vector((r.uniform(-1, 1), r.uniform(-0.3, 0.8), r.uniform(-1, 1))).normalized() * R0 * 0.7, R0 * r.uniform(0.5, 0.72)) for _ in range(4)]
        for bc, br in blobs:
            v, f = sphere3(tuple(bc), br, 2, bump=lambda d: 0.05 * math.sin(d.x * 9 + k) * math.sin(d.y * 8) * math.sin(d.z * 7))
            o = len(PV); PV += v; PF += [tuple(i + o for i in x) for x in f]
    cents = np.array([tuple(Vector(tp) + Vector((0, 1.0, 0))) for tp, _ in tips])
    def pdir(c):
        j = np.argmin(((cents - c) ** 2).sum(1)); return np.array(c) - cents[j]
    make(name + '_Puffs', coll, PV, PF, mat_coralpuff(name + '_M_Puff', seed), None, loc)   # icospheres are already outward
    tip = bpy.data.objects.new(name + '_Tip', None); tip.location = T(*(Vector(loc) + Vector((0, H, 0)))); link(tip, coll)

def mushrooms(name, x0, seed, n=5, size=1.0):
    coll = 'Small mushrooms'; loc = (x0, 0, 0)
    r = random.Random(seed)
    SV, SF, CV, CF, GV, GF, lines, cents = [], [], [], [], [], [], [], []
    for i in range(n):
        a = r.uniform(0, 6.28); d = r.uniform(0, 0.55) * size if i else 0
        h = size * r.uniform(0.45, 1.0) * (1.0 if i == 0 else 0.75)
        base = (math.cos(a) * d, -0.1, math.sin(a) * d)
        lean = (math.cos(a) * h * 0.25, h, math.sin(a) * h * 0.25)
        cp = catmull([base, (base[0] + lean[0] * 0.3, h * 0.5, base[2] + lean[2] * 0.3), (base[0] + lean[0], h, base[2] + lean[2])], 3)
        rs = 0.06 * size + h * 0.05
        v, f, pl = tube3(cp, [rs * (1.25 - 0.35 * j / (len(cp) - 1)) for j in range(len(cp))], 7, cap=False)
        o = len(SV); SV += v; SF += [tuple(k + o for k in x) for x in f]; lines.append(pl)
        cr = h * r.uniform(0.38, 0.55); c = (cp[-1].x, cp[-1].y, cp[-1].z); cents.append(c)
        prof = [(cr * u, cr * 0.75 * (1 - u ** 2.3) - 0.12 * cr * max(0, u - 0.85) / 0.15) for u in [j / 5 for j in range(6)]]
        v, f = lathe(prof, 16, c)
        o = len(CV); CV += v; CF += [tuple(k + o for k in x) for x in f]
        gp = [(rs, -0.02 * cr), (cr * 0.55, 0.05 * cr), (cr * 0.98, 0.0)]
        v, f = lathe(gp, 16, c)
        o = len(GV); GV += v; GF += [tuple(k + o for k in x) for x in f]
    C = np.array(cents)
    near = lambda q: C[np.argmin(((C - q) ** 2).sum(1))]
    make(name + '_Stems', coll, SV, SF, mat_stalk(name + '_M_Stem', seed, (12, 12, 1.5), 0.25), lambda c: min((from_line(l)(c) for l in lines), key=lambda d: np.dot(d, d)), loc)
    make(name + '_Caps', coll, CV, CF, mat_cap(name + '_M_Cap', seed, 9.0, 0.2, (0, 0, 0)), lambda c: np.array(c) - near(c) + np.array([0, 0.3 * size, 0]), loc)
    make(name + '_Gills', coll, GV, GF, mat_gills(name + '_M_Gills', seed, (0, 0, 0)), lambda c: np.array([0, -1.0, 0]), loc)

# ------------------------------------------------------------------ ground cover (game uses its own shading; geometry only)
def grass(name, x0, seed, blades=11, height=1.0, flower=False):
    r = random.Random(seed); V, F = [], []
    for b in range(blades):
        a = b / blades * 6.28 + r.uniform(-0.4, 0.4); lean = r.uniform(0.15, 0.55)
        h = height * r.uniform(0.55, 1.1); w = r.uniform(0.05, 0.085)
        dx, dz = math.cos(a), math.sin(a); tw = r.uniform(-0.8, 0.8)
        base = len(V); segs = 3
        for s in range(segs + 1):
            t = s / segs
            cx, cy, cz = dx * lean * t * t * h + dx * 0.05, h * t * (1 - 0.15 * t * lean), dz * lean * t * t * h + dz * 0.05
            ww = w * (1 - t ** 1.4 * 0.95)
            ang = a + 1.5708 + tw * t
            V.append((cx - math.cos(ang) * ww, cy, cz - math.sin(ang) * ww)); V.append((cx + math.cos(ang) * ww, cy, cz + math.sin(ang) * ww))
            if s: i = base + (s - 1) * 2; F.append((i, i + 1, i + 3, i + 2))
        if flower and b % 3 == 0:
            tip = V[-1]; c = len(V)
            for k in range(5):
                aa = k / 5 * 6.28
                V.append((tip[0] + math.cos(aa) * 0.06, tip[1] + 0.03, tip[2] + math.sin(aa) * 0.06))
            V.append((tip[0], tip[1] + 0.06, tip[2]))
            for k in range(5): F.append((c + k, c + (k + 1) % 5, c + 5))
    make(name, 'Ground cover', V, F, None, lambda c: np.array([0, 1.0, 0]), (x0, 0, 0))

def fern(name, x0, seed, fronds=7, L=1.6):
    r = random.Random(seed); V, F = [], []
    for k in range(fronds):
        a = k / fronds * 6.28 + r.uniform(-0.2, 0.2); dx, dz = math.cos(a), math.sin(a)
        ll = L * r.uniform(0.7, 1.05); n = 6
        spine = [(dx * ll * t * 0.8, ll * (1.35 * t - 1.05 * t * t) + 0.05, dz * ll * t * 0.8) for t in [i / n for i in range(n + 1)]]
        px, pz = -dz, dx
        for i in range(1, n):
            p = spine[i]; nxt = spine[i + 1]; t = i / n
            leaf = 0.32 * ll * (1 - t) ** 0.8 * (0.4 + t)
            for side in (-1, 1):
                b0 = len(V)
                tipx = p[0] + px * side * leaf + (nxt[0] - p[0]) * 0.8
                tipz = p[2] + pz * side * leaf + (nxt[2] - p[2]) * 0.8
                V += [p, (p[0] + px * side * leaf * 0.5 + (nxt[0] - p[0]) * 0.1, p[1] + 0.02, p[2] + pz * side * leaf * 0.5 + (nxt[2] - p[2]) * 0.1),
                      (tipx, p[1] - 0.04 * leaf, tipz), nxt]
                F.append((b0, b0 + 1, b0 + 2, b0 + 3))
        # stem
        for i in range(n):
            b0 = len(V); a0, a1 = spine[i], spine[i + 1]
            V += [(a0[0] + px * 0.015, a0[1], a0[2] + pz * 0.015), (a0[0] - px * 0.015, a0[1], a0[2] - pz * 0.015),
                  (a1[0] - px * 0.012, a1[1], a1[2] - pz * 0.012), (a1[0] + px * 0.012, a1[1], a1[2] + pz * 0.012)]
            F.append((b0, b0 + 1, b0 + 2, b0 + 3))
    make(name, 'Ground cover', V, F, None, lambda c: np.array([0, 1.0, 0]), (x0, 0, 0))

parasol('Parasol_A', 0, 1, H=16, capR=6.5, capH=1.7, rs=1.0, lean=(0.7, 0.2), droop=0.6, wave=5)
parasol('Parasol_B', 22, 2, H=12, capR=5.4, capH=0.9, rs=0.85, lean=(-0.5, 0.4), droop=0.2, wave=7, rim_up=0.45)
parasol('Parasol_C', 44, 3, H=20, capR=7.6, capH=2.8, rs=1.15, lean=(0.9, -0.5), droop=0.9, wave=4)
lantern('Lantern_A', 70, 4, H=6.5, R=2.4, S=1.6, rb=2.0, ribs=10)
lantern('Lantern_B', 86, 5, H=7.5, R=2.0, S=1.7, rb=2.3, ribs=8, twin=True)
coral('Coral_A', 110, 6, H=12, arms=3, puffR=1.8)
coral('Coral_B', 130, 7, H=14, arms=4, puffR=1.5)
mushrooms('Mushrooms_A', 150, 8, 5, 1.0)
mushrooms('Mushrooms_B', 154, 9, 3, 1.4)
grass('Grass_A', 160, 10, 7, 1.0)
grass('Grass_B', 162, 11, 6, 1.15, flower=True)
fern('Fern_A', 165, 12, 5, 1.6)
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('saved', OUT)
