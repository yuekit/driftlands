"""Bake the rock kit: decimate each high-detail rock to a game mesh, share one UV atlas, bake
normal (tangent) + AO + curvature + moss from the high mesh, export rocks.glb.
Usage: python bake_rocks.py <rocks_src.blend> <out_dir> [atlas] [ao_samples]
Any mesh in 'Floating rocks' or 'Boulders' is a rock; '<name>_Roots' in 'Roots' rides along unbaked."""
import sys, os, math
import numpy as np
import bpy
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 2048
AO_S = int(args[3]) if len(args) > 3 else 32
TARGET = {'Floating rocks': 2600, 'Boulders': 760}
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; vl = bpy.context.view_layer
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
if sc.world is None: sc.world = bpy.data.worlds.new('BakeWorld')
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes.get('Background')
if bg: bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 1
sc.world.light_settings.distance = 1.2
for c in bpy.data.collections: c.hide_viewport = False; c.hide_render = False
def walk(lc):
    lc.exclude = False; lc.hide_viewport = False
    for ch in lc.children: walk(ch)
walk(vl.layer_collection)

def sel(objs, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.hide_set(False); o.select_set(True)
    vl.objects.active = active

low_coll = bpy.data.collections.new('LOW'); sc.collection.children.link(low_coll)
pairs = []
for cname, target in TARGET.items():
    coll = bpy.data.collections.get(cname)
    if not coll: continue
    for H in sorted([o for o in coll.objects if o.type == 'MESH'], key=lambda o: o.name):
        name = H.name
        sel([H], H)
        for m in list(H.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        H.name = name + '_HIGH'
        L = H.copy(); L.data = H.data.copy(); L.name = name; L.data.name = name
        low_coll.objects.link(L)
        for a in list(L.data.color_attributes): L.data.color_attributes.remove(a)
        for u in list(L.data.uv_layers): L.data.uv_layers.remove(u)
        dm = L.modifiers.new('dec', 'DECIMATE'); dm.ratio = min(1.0, target / max(1, len(L.data.polygons)))
        sel([L], L); bpy.ops.object.modifier_apply(modifier='dec')
        L.data.shade_smooth()
        pairs.append((H, L, cname))
        print(name, 'low faces', len(L.data.polygons))

lows = [L for _, L, _ in pairs]
for L in lows: L.data.uv_layers.new(name='UVMap')
sel(lows, lows[0])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')

def img(name, size, fill, data=True):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if data: im.colorspace_settings.name = 'Non-Color'
    im.pixels[:] = np.tile(np.array(fill, np.float32), size * size); return im
bakemat = bpy.data.materials.new('Kit_Rock_Bake'); bakemat.use_nodes = True
tex = bakemat.node_tree.nodes.new('ShaderNodeTexImage'); bakemat.node_tree.nodes.active = tex
for L in lows: L.data.materials.clear(); L.data.materials.append(bakemat)

def emit_mat(attr):
    m = bpy.data.materials.get('__emit_' + attr) or bpy.data.materials.new('__emit_' + attr); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = attr
    e = nt.nodes.new('ShaderNodeEmission'); o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(a.outputs['Color'], e.inputs['Color']); nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
    return m

def bake_all(kind, image, **kw):
    tex.image = image
    for H, L, cname in pairs:
        ext = 0.35 if cname == 'Floating rocks' else 0.08
        sel([H, L], L)
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=ext, max_ray_distance=ext * 3,
                            margin=6, use_clear=False, **kw)

sc.cycles.samples = 1
nrm = img('rock_normal', SIZE, (0.5, 0.5, 1.0, 1.0))
bake_all('NORMAL', nrm, normal_space='TANGENT')
nrm.filepath_raw = f'{OUT}/rock_normal.png'; nrm.file_format = 'PNG'; nrm.save()

orig = {H.name: list(H.data.materials) for H, _, _ in pairs}
chans = {}
for attr in ('Curvature', 'Moss'):
    em = emit_mat(attr)
    for H, _, _ in pairs: H.data.materials.clear(); H.data.materials.append(em)
    im = img('rock_' + attr, SIZE, (0.5 if attr == 'Curvature' else 0.0,) * 3 + (1.0,))
    bake_all('EMIT', im); chans[attr] = np.array(im.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., 0]
for H, _, _ in pairs:
    H.data.materials.clear()
    for m in orig[H.name]: H.data.materials.append(m)
sc.cycles.samples = AO_S
ao = img('rock_ao', SIZE, (1, 1, 1, 1))
bake_all('AO', ao)
A = np.array(ao.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., 0]
data = img('rock_data', SIZE, (1, 0.5, 0, 1))
data.pixels[:] = np.stack([A, chans['Curvature'], chans['Moss'], np.ones_like(A)], -1).ravel()
data.filepath_raw = f'{OUT}/rock_data.png'; data.file_format = 'PNG'; data.save()

# export material: normal + data (data rides in the metallic-roughness slot: R=AO, G=curvature, B=moss)
em = bpy.data.materials.new('Rock'); em.use_nodes = True; nt = em.node_tree
b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
td = nt.nodes.new('ShaderNodeTexImage'); td.image = data
sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(td.outputs['Color'], sp.inputs['Color'])
nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
for L in lows: L.data.materials.clear(); L.data.materials.append(em); L.location = (0, 0, 0)
roots = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_Roots')]
for r in roots: r.location = (0, 0, 0)
sel(lows + roots, lows[0])
bpy.ops.export_scene.gltf(filepath=f'{OUT}/rocks.glb', export_format='GLB', use_selection=True, export_tangents=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_yup=True, export_apply=True,
                          export_materials='EXPORT', export_vertex_color='NONE')
# keep a baked copy (game meshes only) for inspection
for H, _, _ in pairs: bpy.data.objects.remove(H, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/rocks_baked.blend', compress=True)
print('exported', os.path.getsize(f'{OUT}/rocks.glb'))
