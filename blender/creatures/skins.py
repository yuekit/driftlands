"""Driftlands creature skin library: six tileable procedural skins (Cycles), baked to float maps.
Each material emits (height, mask1, mask2):  mask1 = where the creature's second colour shows,
mask2 = where it glows at night. 4D noise on a flat torus makes every map tile seamlessly.
Usage: python skins.py <out_dir> [size]   -> <out_dir>/skin_<n>.npy and skins_src.blend"""
import sys, os, math
import numpy as np
import bpy
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = args[0]; SIZE = int(args[1]) if len(args) > 1 else 512
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
sc.world = bpy.data.worlds.new('W')

class N:
    def __init__(self, name):
        m = bpy.data.materials.new(name); m.use_nodes = True
        self.m = m; self.nt = m.node_tree; self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        uv = self.nt.nodes.new('ShaderNodeTexCoord')
        sep = self.nt.nodes.new('ShaderNodeSeparateXYZ'); self.nt.links.new(uv.outputs['UV'], sep.inputs[0])
        self.u, self.v = sep.outputs['X'], sep.outputs['Y']
    def L(self, a, b): self.nt.links.new(a, b)
    def _in(self, s, v):
        if isinstance(v, (int, float)): s.default_value = v
        else: self.L(v, s)
    def m_(self, op, a, b=0.0, c=None, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        self._in(n.inputs[0], a); self._in(n.inputs[1], b)
        if c is not None: self._in(n.inputs[2], c)
        return n.outputs[0]
    def torus(self, su=1.0, sv=1.0, off=(0, 0)):
        """flat-torus 4D coordinates: features per tile = node scale; su/sv stretch u or v (integers keep tiling)"""
        tw = 2 * math.pi
        au = self.m_('MULTIPLY', self.m_('ADD', self.u, off[0]), tw); av = self.m_('MULTIPLY', self.m_('ADD', self.v, off[1]), tw)
        ru, rv = su / tw, sv / tw
        c = self.nt.nodes.new('ShaderNodeCombineXYZ')
        self._in(c.inputs[0], self.m_('MULTIPLY', self.m_('COSINE', au), ru)); self._in(c.inputs[1], self.m_('MULTIPLY', self.m_('SINE', au), ru))
        self._in(c.inputs[2], self.m_('MULTIPLY', self.m_('COSINE', av), rv))
        return c.outputs[0], self.m_('MULTIPLY', self.m_('SINE', av), rv)
    def noise(self, co, scale, detail=4.0, rough=0.5, distort=0.0):
        V, W = co; n = self.nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '4D'
        self.L(V, n.inputs['Vector']); self.L(W, n.inputs['W'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distort
        return n.outputs['Fac']
    def voronoi(self, co, scale, feature='F1', out='Distance', rnd=1.0, metric='EUCLIDEAN'):
        V, W = co; n = self.nt.nodes.new('ShaderNodeTexVoronoi'); n.voronoi_dimensions = '4D'; n.feature = feature; n.distance = metric
        self.L(V, n.inputs['Vector']); self.L(W, n.inputs['W'])
        n.inputs['Scale'].default_value = scale; n.inputs['Randomness'].default_value = rnd
        return n.outputs[out]
    def ss(self, x, lo, hi):
        n = self.nt.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
        self._in(n.inputs['Value'], x); n.inputs['From Min'].default_value = lo; n.inputs['From Max'].default_value = hi
        return n.outputs['Result']
    def emit(self, h, m1, m2):
        c = self.nt.nodes.new('ShaderNodeCombineColor'); self._in(c.inputs[0], h); self._in(c.inputs[1], m1); self._in(c.inputs[2], m2)
        e = self.nt.nodes.new('ShaderNodeEmission'); self.L(c.outputs[0], e.inputs['Color'])
        self.L(e.outputs[0], self.out.inputs['Surface']); return self.m

def warp(M, co, amt, scale):
    """domain warp a torus coordinate by 4D noise (stays tileable)"""
    V, W = co
    nv = M.nt.nodes.new('ShaderNodeTexNoise'); nv.noise_dimensions = '4D'; M.L(V, nv.inputs['Vector']); M.L(W, nv.inputs['W'])
    nv.inputs['Scale'].default_value = scale; nv.inputs['Detail'].default_value = 2
    sub = M.nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; M.L(nv.outputs['Color'], sub.inputs[0]); sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    sc_ = M.nt.nodes.new('ShaderNodeVectorMath'); sc_.operation = 'SCALE'; M.L(sub.outputs[0], sc_.inputs[0]); sc_.inputs['Scale'].default_value = amt
    add = M.nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'; M.L(V, add.inputs[0]); M.L(sc_.outputs[0], add.inputs[1])
    return add.outputs[0], W

def pebble():      # 0: packed tubercle scales, mixed sizes, some speckled
    M = N('Skin_0_Pebble'); co = warp(M, M.torus(), 0.025, 3)
    e1 = M.voronoi(co, 16, 'DISTANCE_TO_EDGE'); e2 = M.voronoi(M.torus(off=(0.37, 0.11)), 6, 'DISTANCE_TO_EDGE')
    dome1 = M.m_('POWER', M.ss(e1, 0.0, 0.3), 0.6)
    dome2 = M.m_('POWER', M.ss(e2, 0.0, 0.32), 0.7)
    big = M.ss(M.noise(M.torus(off=(.2, .7)), 3, 2), 0.52, 0.62)
    h = M.m_('ADD', M.m_('MULTIPLY', dome1, M.m_('SUBTRACT', 1.0, big)), M.m_('MULTIPLY', dome2, M.m_('MULTIPLY', big, 1.2)))
    h = M.m_('ADD', M.m_('MULTIPLY', h, 0.85), M.m_('MULTIPLY', M.noise(M.torus(), 60, 3), 0.08))
    cell = M.voronoi(co, 16, 'F1', 'Color')
    sep = M.nt.nodes.new('ShaderNodeSeparateColor'); M.L(cell, sep.inputs[0])
    speck = M.m_('MULTIPLY', M.ss(sep.outputs[0], 0.78, 0.83), M.m_('SUBTRACT', 1.0, big))
    return M.emit(h, M.m_('MAXIMUM', speck, M.m_('MULTIPLY', big, 0.3)), 0.0)

def hide():        # 1: wrinkled leathery hide, transverse folds, pores, crusted patches
    M = N('Skin_1_Hide')
    fold = M.m_('ABSOLUTE', M.m_('SUBTRACT', M.noise(warp(M, M.torus(1, 4), 0.06, 2), 2.0, 6, 0.55), 0.5))
    folds = M.m_('SUBTRACT', 1.0, M.ss(fold, 0.0, 0.08))
    fine = M.m_('ABSOLUTE', M.m_('SUBTRACT', M.noise(M.torus(), 9, 5), 0.5))
    fines = M.m_('SUBTRACT', 1.0, M.ss(fine, 0.0, 0.06))
    pore = M.ss(M.voronoi(M.torus(off=(.5, .5)), 40, 'F1'), 0.12, 0.05)
    patch = M.ss(M.noise(M.torus(off=(.3, .9)), 3, 4), 0.6, 0.66)
    crust = M.m_('MULTIPLY', patch, M.m_('SUBTRACT', 1.0, M.ss(M.voronoi(M.torus(), 30, 'SMOOTH_F1'), 0.0, 0.5)))
    h = M.m_('ADD', 0.55, M.m_('SUBTRACT', M.m_('MULTIPLY', crust, 0.45), M.m_('ADD', M.m_('MULTIPLY', folds, 0.35), M.m_('ADD', M.m_('MULTIPLY', fines, 0.12), M.m_('MULTIPLY', pore, 0.15)))))
    return M.emit(h, patch, M.m_('MULTIPLY', pore, M.m_('SUBTRACT', 1.0, patch)))

def chitin():      # 2: overlapping plates with grooves, shingle tilt and pits
    M = N('Skin_2_Chitin'); co = warp(M, M.torus(1, 2), 0.025, 2)
    edge = M.voronoi(co, 5, 'DISTANCE_TO_EDGE'); f1 = M.voronoi(co, 5, 'F1')
    plate = M.ss(edge, 0.0, 0.06)
    h = M.m_('MULTIPLY', plate, M.m_('ADD', 0.75, M.m_('MULTIPLY', f1, 0.35)))
    pits = M.ss(M.voronoi(M.torus(off=(.1, .4)), 55, 'F1'), 0.1, 0.03)
    h = M.m_('SUBTRACT', h, M.m_('MULTIPLY', pits, 0.12))
    rim = M.m_('MULTIPLY', M.ss(edge, 0.03, 0.06), M.m_('SUBTRACT', 1.0, M.ss(edge, 0.08, 0.16)))
    return M.emit(h, rim, M.m_('MULTIPLY', pits, 0.6))

def jelly():       # 3: smooth bell with radial canals and nematocyst dots
    M = N('Skin_3_Jelly')
    wob = M.noise(M.torus(), 3, 3)
    canal = M.m_('ABSOLUTE', M.m_('SINE', M.m_('ADD', M.m_('MULTIPLY', M.u, 2 * math.pi * 8), M.m_('MULTIPLY', wob, 4.0))))
    canals = M.m_('SUBTRACT', 1.0, M.ss(canal, 0.0, 0.28))
    dots = M.ss(M.voronoi(M.torus(off=(.6, .2)), 34, 'F1'), 0.13, 0.06)
    h = M.m_('ADD', M.m_('MULTIPLY', wob, 0.4), M.m_('ADD', M.m_('MULTIPLY', canals, 0.25), M.m_('MULTIPLY', dots, 0.25)))
    return M.emit(h, canals, M.m_('MAXIMUM', dots, M.m_('MULTIPLY', canals, 0.5)))

def membrane():    # 4: veined membrane, two orders of veins
    M = N('Skin_4_Membrane'); co = warp(M, M.torus(1, 2), 0.05, 2.5)
    v1 = M.m_('SUBTRACT', 1.0, M.ss(M.voronoi(co, 3, 'DISTANCE_TO_EDGE'), 0.0, 0.035))
    v2 = M.m_('SUBTRACT', 1.0, M.ss(M.voronoi(warp(M, M.torus(off=(.3, .3)), 0.04, 6), 9, 'DISTANCE_TO_EDGE'), 0.0, 0.022))
    veins = M.m_('MAXIMUM', v1, M.m_('MULTIPLY', v2, 0.6))
    h = M.m_('ADD', M.m_('MULTIPLY', veins, 0.6), M.m_('MULTIPLY', M.noise(M.torus(), 14, 3), 0.15))
    return M.emit(h, veins, veins)

def plant():       # 5: velvety fibres along the length with stomata dots
    M = N('Skin_5_Plant')
    fib = M.noise(M.torus(12, 1), 3, 6, 0.6)
    st = M.ss(M.voronoi(M.torus(off=(.2, .8)), 26, 'F1'), 0.1, 0.05)
    rib = M.m_('ABSOLUTE', M.m_('SINE', M.m_('MULTIPLY', M.u, 2 * math.pi * 6)))
    h = M.m_('ADD', M.m_('MULTIPLY', fib, 0.5), M.m_('SUBTRACT', M.m_('MULTIPLY', rib, 0.1), M.m_('MULTIPLY', st, 0.15)))
    return M.emit(h, M.ss(rib, 0.7, 1.0), M.m_('MULTIPLY', st, 0.7))

mats = [pebble(), hide(), chitin(), jelly(), membrane(), plant()]
bpy.ops.mesh.primitive_plane_add(size=2); plane = bpy.context.active_object; plane.name = 'SkinSwatch'
for i, m in enumerate(mats):
    plane.data.materials.clear(); plane.data.materials.append(m)
    img = bpy.data.images.new(f'skin_{i}', SIZE, SIZE, alpha=False, float_buffer=True); img.colorspace_settings.name = 'Non-Color'
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img; m.node_tree.nodes.active = t
    bpy.ops.object.select_all(action='DESELECT'); plane.select_set(True); bpy.context.view_layer.objects.active = plane
    bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
    a = np.array(img.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[::-1, :, :3]
    np.save(f'{OUT}/skin_{i}.npy', a); print('baked', m.name, a.min(axis=(0, 1)), a.max(axis=(0, 1)))
    m.node_tree.nodes.remove(t)
# swatches laid out for editing: one plane per skin
plane.data.materials.clear(); plane.data.materials.append(mats[0])
for i, m in enumerate(mats[1:], 1):
    p = plane.copy(); p.data = plane.data.copy(); p.location.x = i * 2.2; p.name = f'SkinSwatch_{i}'
    p.data.materials.clear(); p.data.materials.append(m); bpy.context.collection.objects.link(p)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/skins_src.blend', compress=True)
