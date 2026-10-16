"""Cycles preview renders of the glider. Usage: python render_preview.py <blend> <samples> <views,...> [size]"""
import sys, math, os
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
def T(x, y, z): return Vector((x, -z, y))

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
blend = args[0]; samples = int(args[1]); views = args[2].split(','); size = int(args[3]) if len(args) > 3 else 640
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = samples
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_x = size; sc.render.resolution_y = int(size * 0.62)
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.cycles.max_bounces = 4

# golden-hour sun + sky gradient world
world = bpy.data.worlds.new('Sky'); sc.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 0.9
grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'LINEAR'
tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, -math.pi / 2, 0)
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.78, 0.55, 0.62, 1); ramp.color_ramp.elements[1].color = (0.12, 0.25, 0.6, 1)
nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(tc.outputs['Normal'], mp.inputs['Vector'])
nt.links.new(mp.outputs['Vector'], grad.inputs['Vector']); nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

sun_dir = Vector((0.62, 0.30, 0.73)).normalized()          # game sun direction (three.js)
sd = T(*sun_dir)
sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4.2; sun.color = (1.0, 0.72, 0.5); sun.angle = math.radians(2.5)
so = bpy.data.objects.new('Sun', sun); sc.collection.objects.link(so)
so.rotation_euler = (-sd).to_track_quat('-Z', 'Y').to_euler()
fill = bpy.data.lights.new('Fill', 'SUN'); fill.energy = 0.6; fill.color = (0.5, 0.6, 1.0)
fo = bpy.data.objects.new('Fill', fill); sc.collection.objects.link(fo)
fo.rotation_euler = (T(0.3, -1.0, -0.4)).to_track_quat('-Z', 'Y').to_euler()

cam_data = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
VIEWS = {
    'chase':   ((0, 6.0, -12.5), (0, 0.9, 1.0), 34),
    'front34': ((-7.5, 3.6, 8.0), (0, 0.9, 0.0), 34),
    'rear34':  ((8.0, 4.5, -8.5), (0, 0.9, -0.2), 34),
    'side':    ((11.0, 1.2, 0.2), (0, 0.9, 0.0), 30),
    'below':   ((-3.5, -5.0, 4.5), (0, 0.6, 0.0), 40),
    'pilot':   ((-1.4, 0.9, 2.2), (0, 0.25, 0.3), 32),
    'instr':   ((0.62, 0.12, 1.30), (0.17, -0.21, 0.64), 26),
    'scarf':   ((-1.9, 1.9, -2.2), (-0.3, 0.45, -0.1), 30),
    'top':     ((0.5, 13.0, -2.5), (0, 1.6, 0.2), 40),
}
for v in views:
    pos, tgt, fov = VIEWS[v]
    cam.location = T(*pos)
    d = T(*tgt) - T(*pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam_data.angle = math.radians(fov)
    sc.render.filepath = os.path.join(HERE, f'prev_{v}.png')
    bpy.ops.render.render(write_still=True)
    print('done', v)
