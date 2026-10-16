"""Render each kit object (plus its _Roots etc. companions) from a 3/4 view.
Usage: python kit_preview.py <blend> <out_dir> <samples> <size> [name,name,...]"""
import sys, os, math
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kitlib import T, hexrgb
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
blend, out, samples, size = args[0], args[1], int(args[2]), int(args[3])
only = args[4].split(',') if len(args) > 4 else None
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
sc.render.resolution_x = size; sc.render.resolution_y = size
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.5, 0.62, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 4.0; sun.data.color = (1, 0.8, 0.62); sun.data.angle = math.radians(3)
sd = T(0.62, 0.55, 0.56).normalized(); sun.rotation_euler = (-sd).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
TINTS = {'Parasol': ('#e86a4a', '#a8906e'), 'Lantern': ('#7ec8e3', '#5f8fa0'), 'Coral': ('#9fe2cf', '#c98488'), 'Mushrooms': ('#e98a6c', '#c8b8a0')}
def tintify(mat, cap, trunk):
    nt = mat.node_tree; t = nt.nodes.get('__tint'); b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not t or not b or not b.inputs['Base Color'].is_linked: return
    src = b.inputs['Base Color'].links[0].from_socket
    m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'; m2.use_clamp = True; nt.links.new(t.outputs[0], m2.inputs[0]); m2.inputs[1].default_value = 2
    m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY_ADD'; m3.use_clamp = True; nt.links.new(t.outputs[0], m3.inputs[0]); m3.inputs[1].default_value = 2; m3.inputs[2].default_value = -1
    a = nt.nodes.new('ShaderNodeMix'); a.data_type = 'RGBA'; nt.links.new(m2.outputs[0], a.inputs['Factor']); a.inputs[6].default_value = hexrgb(trunk); a.inputs[7].default_value = (1, 1, 1, 1)
    c = nt.nodes.new('ShaderNodeMix'); c.data_type = 'RGBA'; nt.links.new(m3.outputs[0], c.inputs['Factor']); nt.links.new(a.outputs[2], c.inputs[6]); c.inputs[7].default_value = hexrgb(cap)
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    nt.links.new(src, mul.inputs[6]); nt.links.new(c.outputs[2], mul.inputs[7]); nt.links.new(mul.outputs[2], b.inputs['Base Color'])
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    k = o.name.split('_')[0]
    if k in TINTS:
        for m in o.data.materials:
            if m and not m.get('_tinted'): tintify(m, *TINTS[k]); m['_tinted'] = 1
keys = []
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.name.startswith('LOW_'):
        k = '_'.join(o.name.split('_')[:2])
        if k not in keys: keys.append(k)
for key in keys:
    if only and key not in only: continue
    group = [o for o in bpy.data.objects if o.type == 'MESH' and (o.name == key or o.name.startswith(key + '_'))]
    class _M: name = key
    m = _M
    for o in bpy.data.objects:
        if o.type == 'MESH': o.hide_render = o not in group
    pts = [o.matrix_world @ Vector(c) for o in group for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2; r = (hi - lo).length / 2
    d = Vector((0.75, -1.0, 0.42)).normalized()
    dist = r / math.tan(cam.data.angle / 2) * 1.08
    cam.location = c + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out, m.name + '.png')
    bpy.ops.render.render(write_still=True); print('done', m.name)
