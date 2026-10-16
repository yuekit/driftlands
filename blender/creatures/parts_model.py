"""Build creatures_src.blend: sculpted heads, fins and petals (high detail), editable in Blender.
Mask colour attribute: R = where the creature's second colour shows, G = night glow.
Anchors (eye sockets etc.) are empties parented to each part. Usage: python parts_model.py <parts_dir> <out.blend>"""
import sys, os, glob, json
import numpy as np
import bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import T, reset, link, hexrgb, mesh_obj
from mathutils import Vector
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
reset(['Heads', 'Fins', 'Petals'])
COLS = {'Stilt': ('#e9d2b4', '#5b2a9e'), 'Hybrid': ('#a39a86', '#e3b13a'), 'Crawler': ('#4f3ea6', '#f0c34a'),
        'Whale': ('#3f5f8a', '#e8d2bd'), 'Polyp': ('#f0a24a', '#f3d46a')}
def pmat(name, a, b):
    m = bpy.data.materials.new('Preview_' + name); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Mask'
    sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(at.outputs['Color'], sp.inputs[0])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(sp.outputs[0], mx.inputs['Factor'])
    mx.inputs[6].default_value = hexrgb(a); mx.inputs[7].default_value = hexrgb(b)
    nt.links.new(mx.outputs[2], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.55
    em = nt.nodes.new('ShaderNodeMath'); em.operation = 'MULTIPLY'; nt.links.new(sp.outputs[1], em.inputs[0]); em.inputs[1].default_value = 3
    nt.links.new(mx.outputs[2], bs.inputs['Emission Color']); nt.links.new(em.outputs[0], bs.inputs['Emission Strength'])
    return m
anchors = json.load(open(os.path.join(SRC, 'anchors.json')))
x = 0
for f in sorted(glob.glob(os.path.join(SRC, '*.npz'))):
    name = os.path.splitext(os.path.basename(f))[0]
    d = np.load(f)
    key = next((k for k in COLS if name.startswith(k)), 'Stilt')
    coll = 'Fins' if 'Fin' in name or 'Fluke' in name else 'Petals' if 'Petal' in name else 'Heads'
    ob = mesh_obj(name, [T(*p) for p in d['verts']], d['faces'].tolist(), coll, pmat(name, *COLS[key]), location=(x, 0, 0))
    me = ob.data
    m = np.zeros((len(d['verts']), 4), np.float32); m[:, 3] = 1
    if 'm1' in d: m[:, 0] = d['m1']
    if 'm2' in d: m[:, 1] = d['m2']
    a = me.color_attributes.new('Mask', 'FLOAT_COLOR', 'POINT'); a.data.foreach_set('color', m.ravel())
    c = sum((p.center for p in me.polygons), Vector()) / len(me.polygons)
    if sum((p.center - c).dot(p.normal) for i, p in enumerate(me.polygons) if i % 40 == 0) < 0: me.flip_normals()
    for k, v in anchors.get(name, {}).items():
        if isinstance(v, list) and len(v) == 3:
            for s in ([1, -1] if v[0] != 0 else [1]):
                e = bpy.data.objects.new(f'{name}_{k}' + ('' if v[0] == 0 else ('_R' if s > 0 else '_L')), None)
                e.empty_display_size = 0.1; e.location = T(v[0] * s, v[1], v[2]); e.parent = ob; link(e, coll)
    ob['anchors'] = json.dumps(anchors.get(name, {}))
    x += 4 if coll != 'Heads' or not name.startswith('Whale') else 4
    print(name, len(me.vertices))
# bloom petal: a light parametric sheet (cupped, frilled, midrib); the game shades it with the membrane skin
import math
NU, NV = 24, 8
V, F, UV = [], [], []
for i in range(NU + 1):
    t = i / NU
    w = 0.3 * math.sin(math.pi * t ** 0.8) ** 0.8 + 0.035 * (1 - t) if t < 1 else 0.004
    for j in range(NV + 1):
        u = j / NV * 2 - 1
        cup = 0.13 * u * u * (0.3 + t) + 0.018 * math.sin(math.pi * t)
        frill = 0.02 * math.sin(t * 20 + u * 2) * max(0.0, (abs(u) - 0.55) / 0.45)
        rib = 0.01 * math.exp(-(u / 0.15) ** 2) * (1 - t)
        V.append(T(t, cup + frill + rib, u * w)); UV.append((t, j / NV))
for i in range(NU):
    for j in range(NV):
        a = i * (NV + 1) + j; F.append((a, a + NV + 1, a + NV + 2, a + 1))
pm = pmat('PolypPetal', *COLS['Polyp'])
pt = mesh_obj('PolypPetal', V, F, 'Petals', pm, uvs=UV, location=(x, 0, 0))
mk = np.zeros((len(V), 4), np.float32); mk[:, 3] = 1
for i in range(NU + 1):
    for j in range(NV + 1):
        t = i / NU; mk[i * (NV + 1) + j, 0] = max(0, min(1, (t - 0.45) / 0.5)); mk[i * (NV + 1) + j, 1] = max(0, min(1, (t - 0.6) / 0.4)) * 0.8
pt.data.color_attributes.new('Mask', 'FLOAT_COLOR', 'POINT').data.foreach_set('color', mk.ravel())
print('PolypPetal', len(V))
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
