import bpy, sys, os, math, json
import numpy as np
sys.path.insert(0, '/home/user/work'); sys.path.insert(0, '/home/user/tools-ref/kyber')
import tall_lib as T
from unity import parse_mat, guid_index
from mathutils import Matrix, Vector
L, parts, inst = T.collect('/home/user/work/tall_level.json')
print('parts', len(parts), 'instances', sum(len(v) for v in inst.values()), 'tris unique', sum(len(p['soup']['P']) for p in parts.values()), 'tris placed', sum(len(parts[k]['soup']['P']) * len(v) for k, v in inst.items()))
for k, p in sorted(parts.items()): print(k[0], k[2], p['mat'], len(p['soup']['P']), 'x', len(inst[k]), 'skinned' if p['skinned'] else '')
idx = guid_index(T.SRC)
bpy.ops.wm.read_factory_settings(use_empty=True)
mats = {}
def mat(name):
    if name in mats: return mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    p = os.path.join(T.SRC, 'Assets/TallCity/Materials', name + '.mat')
    if os.path.exists(p):
        pm = parse_mat(p); t = pm['tex'].get('_BaseMap')
        if t and idx.get(t['guid']):
            img = bpy.data.images.load(idx[t['guid']]); tn = m.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img
            m.node_tree.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    mats[name] = m; return m
Yup = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # y-up world -> blender z-up
col = bpy.context.scene.collection
for key, p in parts.items():
    s = p['soup']; nt = len(s['P'])
    me = bpy.data.meshes.new('m'); me.from_pydata(s['P'].reshape(-1, 3).tolist(), [], np.arange(nt * 3).reshape(-1, 3).tolist())
    uv = me.uv_layers.new(); uv.data.foreach_set('uv', s['UV'].reshape(-1).astype(np.float32))
    me.materials.append(mat(p['mat'])); me.update()
    for M in inst[key]:
        o = bpy.data.objects.new('o', me); o.matrix_world = Yup @ Matrix(M.tolist()); col.objects.link(o)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.use_denoising = False; sc.cycles.device = 'CPU'; sc.cycles.max_bounces = 2
sc.render.resolution_x = 1280; sc.render.resolution_y = 800
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.62, 0.8, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.2
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (0.95, 0, 0.6); col.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); sc.camera = cam; cam.data.clip_end = 5000; cam.data.lens = 28
def shot(name, eye, at, lens=28):
    cam.data.lens = lens
    e = Yup @ Vector(eye); a = Yup @ Vector(at); cam.location = e; cam.rotation_euler = (a - e).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'/home/user/work/prev/tall_{name}.png'; bpy.ops.render.render(write_still=True)
c = (-20, -30, -43)
shot('far1', (260, 40, 200), c); shot('far2', (-300, -20, -260), c); shot('top', (-20, 420, -42.9), c, 35)
shot('demo', (6.1, -15.8, 32.21), (6.1 - 0.32 * 50, -15.8 + 0.2655 * 50, 32.21 - 0.9088 * 50), 20)
shot('low', (120, -150, 90), (-20, 20, -43), 24); shot('in1', (-20, 60, 10), (-20, 0, -60), 18)
