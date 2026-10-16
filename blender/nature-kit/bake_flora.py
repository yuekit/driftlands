"""Bake the flora kit: join each plant's parts, share one atlas, bake colour / normal / AO and the
game's tint + glow masks, export flora.glb. Ground cover (Grass_*, Fern_*) exports as plain geometry.
Usage: python bake_flora.py <flora_src.blend> <out_dir> [atlas] [ao_samples]"""
import sys, os, math
import numpy as np
import bpy
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 2048
AO_S = int(args[3]) if len(args) > 3 else 32
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; vl = bpy.context.view_layer
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
if sc.world is None: sc.world = bpy.data.worlds.new('BakeWorld')
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes.get('Background')
if bg: bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 1
sc.world.light_settings.distance = 2.5
for c in bpy.data.collections: c.hide_viewport = False; c.hide_render = False
def walk(lc):
    lc.exclude = False; lc.hide_viewport = False
    for ch in lc.children: walk(ch)
walk(vl.layer_collection)
def sel(objs, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.hide_set(False); o.select_set(True)
    vl.objects.active = active

GROUND = ('Grass', 'Fern')
groups = {}
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    key = '_'.join(o.name.split('_')[:2])
    groups.setdefault(key, []).append(o)
plants, ground = [], []
fallback = None
for key, objs in sorted(groups.items()):
    for o in objs:
        sel([o], o)
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    if key.split('_')[0] in GROUND:
        j = objs[0]
        if len(objs) > 1: sel(objs, objs[0]); bpy.ops.object.join(); j = vl.objects.active
        j.name = key; ground.append(j); continue
    for o in objs:
        if not o.data.materials or any(m is None for m in o.data.materials):
            fallback = fallback or next(m for m in bpy.data.materials if '__tint' in m.node_tree.nodes)
            if not o.data.materials: o.data.materials.append(fallback)
            for i, m in enumerate(o.data.materials):
                if m is None: o.data.materials[i] = fallback
    sel(objs, objs[0]); bpy.ops.object.join(); j = vl.objects.active
    j.name = key; j.data.name = key
    for u in list(j.data.uv_layers): j.data.uv_layers.remove(u)
    j.data.uv_layers.new(name='UVMap')
    plants.append(j)
    print(key, 'tris', sum(len(p.vertices) - 2 for p in j.data.polygons))

sel(plants, plants[0])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')

def img(name, size, fill, data=True):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if data: im.colorspace_settings.name = 'Non-Color'
    im.pixels[:] = np.tile(np.array(fill, np.float32), size * size); return im
def mats():
    seen = []
    for p in plants:
        for m in p.data.materials:
            if m not in seen: seen.append(m)
    return seen
def target(image):
    for m in mats():
        nt = m.node_tree; n = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        n.name = '__bake__'; n.image = image; nt.nodes.active = n
def bake(kind, image, **kw):
    target(image); sel(plants, plants[0])
    bpy.ops.object.bake(type=kind, use_clear=False, margin=6, **kw)
def bake_socket(fn, image):
    saved = []
    for m in mats():
        nt = m.node_tree; out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        old = [l.from_socket for l in nt.links if l.to_socket == out.inputs['Surface']]
        em = nt.nodes.new('ShaderNodeEmission'); src = fn(m)
        if isinstance(src, tuple): em.inputs['Color'].default_value = src
        else: nt.links.new(src, em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out.inputs['Surface']); saved.append((nt, out, old, em))
    bake('EMIT', image)
    for nt, out, old, em in saved:
        nt.nodes.remove(em)
        if old: nt.links.new(old[0], out.inputs['Surface'])
def base_color(m):
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    s = b.inputs['Base Color']
    return s.links[0].from_socket if s.is_linked else tuple(s.default_value)
def named(nm, default):
    def f(m):
        n = m.node_tree.nodes.get(nm)
        return n.outputs[0] if n else (default, default, default, 1.0)
    return f

sc.cycles.samples = 1
col = img('flora_color', SIZE, (0.5, 0.5, 0.5, 1), data=False); bake_socket(base_color, col)
tint = img('flora_tint', SIZE, (0.5,) * 3 + (1,)); bake_socket(named('__tint', 0.5), tint)
glow = img('flora_glow', SIZE, (0,) * 3 + (1,)); bake_socket(named('__glow', 0.0), glow)
nrm = img('flora_normal', SIZE, (0.5, 0.5, 1, 1)); bake('NORMAL', nrm, normal_space='TANGENT')
sc.cycles.samples = AO_S
ao = img('flora_ao', SIZE, (1, 1, 1, 1)); bake('AO', ao)
px = lambda im: np.array(im.pixels[:], np.float32).reshape(SIZE, SIZE, 4)
data = img('flora_data', SIZE, (1, 0.5, 0, 1))
data.pixels[:] = np.stack([px(ao)[..., 0], px(tint)[..., 0], px(glow)[..., 0], np.ones((SIZE, SIZE), np.float32)], -1).ravel()
for im, nm in ((col, 'flora_color'), (nrm, 'flora_normal'), (data, 'flora_data')):
    im.filepath_raw = f'{OUT}/{nm}.png'; im.file_format = 'PNG'; im.save()

em = bpy.data.materials.new('Flora'); em.use_nodes = True; nt = em.node_tree
b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
td = nt.nodes.new('ShaderNodeTexImage'); td.image = data
sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(td.outputs['Color'], sp.inputs['Color'])
nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
gm = bpy.data.materials.new('Ground'); gm.use_nodes = True
for p in plants: p.data.materials.clear(); p.data.materials.append(em); p.location = (0, 0, 0)
for g in ground: g.data.materials.clear(); g.data.materials.append(gm); g.location = (0, 0, 0)
for o in [o for o in bpy.data.objects if o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
sel(plants + ground, plants[0])
bpy.ops.export_scene.gltf(filepath=f'{OUT}/flora.glb', export_format='GLB', use_selection=True, export_tangents=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_yup=True, export_apply=True,
                          export_materials='EXPORT', export_vertex_color='NONE')
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/flora_baked.blend', compress=True)
print('exported', os.path.getsize(f'{OUT}/flora.glb'))
