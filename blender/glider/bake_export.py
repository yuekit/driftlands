"""Bake the glider's procedural materials into texture atlases and export a game-ready .glb.

Usage: python bake_export.py <source.blend> <out_dir> [atlas_size] [ao_samples]
Works on any edited version of glider_src.blend: every mesh except Sail and LampGlass is joined into
'Body' and baked; the Sail keeps its painted livery and gets a baked occlusion map.
"""
import sys, os, math
import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 2048
AO_SAMPLES = int(args[3]) if len(args) > 3 else 32
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.render.bake.margin = 8
if sc.world is None:
    sc.world = bpy.data.worlds.new('BakeWorld')
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes.get('Background')
if bg: bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 1.0
sc.world.light_settings.distance = 0.5
vl = bpy.context.view_layer


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    vl.objects.active = active or objs[0]


# ---------------------------------------------------------------- 1. apply modifiers, make single-user meshes
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.hide_set(False); o.hide_render = False
select_only(meshes)
bpy.ops.object.make_single_user(object=True, obdata=True)
for o in meshes:
    select_only([o])
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:
            print('modifier skipped', o.name, m.name, e)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

sail = bpy.data.objects['Sail']
lamp = bpy.data.objects['LampGlass']
body_parts = [o for o in meshes if o not in (sail, lamp)]
# every part keeps a 'UVMap' layer for its procedural patterns
fallback = bpy.data.materials.get('M_Fittings')
for o in body_parts:
    if not o.data.materials or any(m is None for m in o.data.materials):
        print('no material on', o.name)
        if not o.data.materials: o.data.materials.append(fallback)
        for i, m in enumerate(o.data.materials):
            if m is None: o.data.materials[i] = fallback
for o in body_parts:
    if 'UVMap' not in o.data.uv_layers:
        o.data.uv_layers.new(name='UVMap')

# ---------------------------------------------------------------- 2. join the body and lay out an atlas
select_only(body_parts, body_parts[0])
bpy.ops.object.join()
body = vl.objects.active
body.name = 'Body'
body.data.name = 'Body'
atlas = body.data.uv_layers.new(name='Atlas')
body.data.uv_layers.active = atlas
select_only([body])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.6, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')
print('body tris', sum(len(p.vertices) - 2 for p in body.data.polygons))


def new_img(name, size, data=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if data:
        img.colorspace_settings.name = 'Non-Color'
    return img


def set_bake_target(obj, img):
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get('__bake__') or nt.nodes.new('ShaderNodeTexImage')
        node.name = '__bake__'; node.image = img; node.location = (1200, 400)
        nt.nodes.active = node


def bsdf_of(mat):
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return None


def bake_input_as_emission(obj, input_name, img):
    """Route one Principled input to an emission shader, bake EMIT, then restore the graph."""
    saved = []
    for slot in obj.material_slots:
        m = slot.material; nt = m.node_tree
        b = bsdf_of(m); out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        old = [l.from_socket for l in nt.links if l.to_socket == out.inputs['Surface']]
        em = nt.nodes.new('ShaderNodeEmission'); em.name = '__em__'
        src = b.inputs[input_name]
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, em.inputs['Color'])
        else:
            v = src.default_value
            em.inputs['Color'].default_value = (v, v, v, 1) if isinstance(v, float) else tuple(v)
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        saved.append((nt, out, old, em))
    set_bake_target(obj, img)
    select_only([obj])
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=8)
    for nt, out, old, em in saved:
        nt.nodes.remove(em)
        if old:
            nt.links.new(old[0], out.inputs['Surface'])


def save(img, path, fmt='PNG'):
    img.filepath_raw = path; img.file_format = fmt; img.save()


sc.cycles.samples = 1
col = new_img('body_color', SIZE)
bake_input_as_emission(body, 'Base Color', col); save(col, f'{OUT}/body_color.png')
rough = new_img('body_rough', SIZE, True)
bake_input_as_emission(body, 'Roughness', rough)
metal = new_img('body_metal', SIZE, True)
bake_input_as_emission(body, 'Metallic', metal)

nrm = new_img('body_normal', SIZE, True)
set_bake_target(body, nrm); select_only([body])
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=True, margin=8)
save(nrm, f'{OUT}/body_normal.png')

sc.cycles.samples = AO_SAMPLES
ao = new_img('body_ao', SIZE, True)
set_bake_target(body, ao); select_only([body])
bpy.ops.object.bake(type='AO', use_clear=True, margin=8)

def px(img):
    a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    return a
orm = new_img('body_orm', SIZE, True)
A, Rg, Mt = px(ao), px(rough), px(metal)
o = np.stack([A[..., 0], Rg[..., 0], Mt[..., 0], np.ones_like(A[..., 0])], -1)
orm.pixels[:] = o.ravel(); save(orm, f'{OUT}/body_orm.png')

# ---------------------------------------------------------------- 3. sail occlusion (painted colour + normal stay)
SAIL_AO = SIZE // 2
sao = new_img('sail_ao', SAIL_AO, True)
set_bake_target(sail, sao); select_only([sail])
bpy.ops.object.bake(type='AO', use_clear=True, margin=8)
S = px(sao)
sorm = new_img('sail_orm', SAIL_AO, True)
sorm.pixels[:] = np.stack([S[..., 0], np.full_like(S[..., 0], 0.72), np.zeros_like(S[..., 0]), np.ones_like(S[..., 0])], -1).ravel()
save(sorm, f'{OUT}/sail_orm.png')

# ---------------------------------------------------------------- 4. export materials (plain glTF PBR)
def export_material(name, color_img, orm_img, normal_img, uv='UVMap'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = uv
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = color_img; nt.links.new(uvn.outputs['UV'], tc.inputs['Vector']); nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm_img; to.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(uvn.outputs['UV'], to.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    # glTF occlusion: a settings group node named glTF Material Output with an Occlusion input
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp
    nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal_img; tn.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(uvn.outputs['UV'], tn.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map = uv
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m

body_mat = export_material('Body', col, orm, nrm, 'Atlas')
body.data.materials.clear(); body.data.materials.append(body_mat)
# keep only the atlas UVs on the exported body
uvp = body.data.uv_layers.get('UVMap')
if uvp: body.data.uv_layers.remove(uvp)
body.data.uv_layers['Atlas'].name = 'UVMap'
for n in body_mat.node_tree.nodes:
    if n.type in ('UVMAP', 'NORMAL_MAP'):
        n.uv_map = 'UVMap'

sc_img = bpy.data.images.get('sail_color'); sn_img = bpy.data.images.get('sail_normal')
sail_mat = export_material('Sail', sc_img, sorm, sn_img, 'UVMap')
sail.data.materials.clear(); sail.data.materials.append(sail_mat)

lm = bpy.data.materials.new('LampGlass'); lm.use_nodes = True
b = bsdf_of(lm); b.inputs['Base Color'].default_value = (1.0, 0.8, 0.55, 1); b.inputs['Roughness'].default_value = 0.15
lamp.data.materials.clear(); lamp.data.materials.append(lm)

# shading: smooth with sharp creases
for o in (body, sail, lamp):
    o.data.shade_smooth()

# ---------------------------------------------------------------- 5. export
keep = {body, sail, lamp} | {o for o in bpy.data.objects if o.type == 'EMPTY'}
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/glider_baked.blend')
bpy.ops.export_scene.gltf(filepath=f'{OUT}/glider.glb', export_format='GLB', use_selection=False,
                          export_tangents=True, export_image_format='JPEG', export_jpeg_quality=88,
                          export_yup=True, export_apply=True, export_materials='EXPORT')
print('exported', os.path.getsize(f'{OUT}/glider.glb'))
