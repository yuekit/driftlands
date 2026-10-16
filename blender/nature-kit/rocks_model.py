"""Build rocks_src.blend: high-detail floating rocks (with hanging roots) and boulders, editable by hand.
Usage: python rocks_model.py <npz_dir> <out.blend>"""
import sys, os, glob, math, random
import numpy as np
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import *

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
reset(['Floating rocks', 'Roots', 'Boulders'])

def rock_material():
    m = bpy.data.materials.new('M_Rock'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    moss = nt.nodes.new('ShaderNodeAttribute'); moss.attribute_name = 'Moss'
    curv = nt.nodes.new('ShaderNodeAttribute'); curv.attribute_name = 'Curvature'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = hexrgb('#b08a6c'); mix.inputs['B'].default_value = hexrgb('#6f9a5a')
    nt.links.new(moss.outputs['Fac'], mix.inputs['Factor'])
    br = nt.nodes.new('ShaderNodeMix'); br.data_type = 'RGBA'; br.blend_type = 'MULTIPLY'
    nt.links.new(mix.outputs['Result'], br.inputs['A'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1); ramp.color_ramp.elements[1].color = (1.6, 1.6, 1.6, 1)
    nt.links.new(curv.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], br.inputs['B']); br.inputs['Factor'].default_value = 1
    nt.links.new(br.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    return m

def root_material():
    m = bpy.data.materials.new('M_Root'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = hexrgb('#5b4636'); b.inputs['Roughness'].default_value = 0.8
    return m

RM, ROOTM = rock_material(), root_material()
rng = random.Random(7)

def add_roots(name, d, coll_off):
    v, n = d['verts'], d['normals']
    under = np.where((n[:, 1] < -0.55) & (v[:, 1] < -1.0))[0]
    if len(under) == 0: return
    # spread seeds over the underside
    picks = []
    order = list(under); rng.shuffle(order)
    for i in order:
        p = v[i]
        if all(np.linalg.norm(p - q) > 1.6 for q in picks): picks.append(p)
        if len(picks) >= 9: break
    V, F, UV = [], [], []
    for p in picks:
        L = rng.uniform(2.5, 7.5); r0 = rng.uniform(0.06, 0.14)
        a = rng.uniform(0, 6.28)
        pts = [Vector(p) + Vector((0, 0.3, 0))]
        cur = Vector(p)
        k = 5
        for s in range(1, k + 1):
            t = s / k
            cur = cur + Vector((math.cos(a + t * 2) * 0.35, -L / k, math.sin(a + t * 2) * 0.35)) + Vector((rng.gauss(0, .2), 0, rng.gauss(0, .2)))
            pts.append(cur.copy())
        cpts = catmull(pts, 5)
        radii = [r0 * (1 - 0.85 * (i / (len(cpts) - 1))) ** 1.2 + 0.008 for i in range(len(cpts))]
        vv, ff, uu = tube(cpts, radii, seg=6)
        o = len(V); V += vv; F += [tuple(x + o for x in f) for f in ff]; UV += uu
        # a side branch
        if rng.random() < 0.7:
            j = rng.randint(len(cpts) // 4, len(cpts) // 2)
            b0 = cpts[j]; bpts = [b0]
            ba = rng.uniform(0, 6.28); bl = L * rng.uniform(0.3, 0.55)
            for s in range(1, 4):
                bpts.append(b0 + Vector((math.cos(ba) * 0.5 * s, -bl * s / 3, math.sin(ba) * 0.5 * s)))
            bc = catmull(bpts, 4)
            br = [radii[j] * 0.6 * (1 - 0.85 * i / (len(bc) - 1)) + 0.006 for i in range(len(bc))]
            vv, ff, uu = tube(bc, br, seg=5)
            o = len(V); V += vv; F += [tuple(x + o for x in f) for f in ff]; UV += uu
    ob = mesh_obj(name + '_Roots', V, F, 'Roots', ROOTM, uvs=UV, location=coll_off)
    return ob

files = sorted(glob.glob(os.path.join(SRC, '*.npz')))
xo = {'Float': 0.0, 'Bould': 0.0}
for f in files:
    name = os.path.splitext(os.path.basename(f))[0]
    d = np.load(f)
    V = [T(*p) for p in d['verts']]
    F = d['faces'][:, ::-1].tolist()            # skimage winding -> outward in Blender's handedness
    floating = name.startswith('Float')
    key = 'Float' if floating else 'Bould'
    off = (xo[key], 0 if floating else 30, 0)
    xo[key] += 20 if floating else 6
    ob = mesh_obj(name, V, F, 'Floating rocks' if floating else 'Boulders', RM, location=off)
    me = ob.data
    for an, arr in (('Curvature', np.clip(d['curv'] * 0.18 + 0.5, 0, 1)), ('Moss', d['moss'])):
        a = me.color_attributes.new(an, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', np.repeat(arr[:, None], 4, 1).astype(np.float32).ravel())
    # normals check: make sure faces point outward
    me.update()
    c = sum((p.center for p in me.polygons), Vector()) / len(me.polygons)
    outward = sum((p.center - c).dot(p.normal) for i, p in enumerate(me.polygons) if i % 50 == 0)
    if outward < 0:
        me.flip_normals(); print('flipped', name)
    if floating: add_roots(name, d, off)
    print(name, len(me.vertices), 'verts')
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
