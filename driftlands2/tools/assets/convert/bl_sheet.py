# contact sheet of every mesh object: python3 bl_sheet.py out.png file [cols=6] [skip=a,b]
import bpy,sys,math
from mathutils import Vector
out,f=sys.argv[1],sys.argv[2]; opt=dict(a.split('=',1) for a in sys.argv[3:])
bpy.ops.wm.read_factory_settings(use_empty=True)
fl=f.lower()
if fl.endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=f)
elif fl.endswith('.obj'): bpy.ops.wm.obj_import(filepath=f)
else: bpy.ops.import_scene.gltf(filepath=f)
skip=opt.get('skip','').split(',')
COL={'m':(0.85,0.85,0.82,1),'m_new':(0.9,0.88,0.84,1),'g':(0.15,0.4,0.5,1),'g.001':(0.15,0.4,0.5,1),'g_bri':(1,0.75,0.3,1),'b':(0.08,0.08,0.1,1),'grw':(0.3,0.6,0.25,1)}
for m in bpy.data.materials:
    if m.node_tree:
        b=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if b and m.name in COL:
            for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
            b.inputs['Base Color'].default_value=COL[m.name]
objs=sorted([o for o in bpy.data.objects if o.type=='MESH' and o.name not in skip],key=lambda o:o.name)
for o in list(bpy.data.objects):
    if o.type=='MESH' and o not in objs: bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update()
cols=int(opt.get('cols',6)); cell=0
info=[]
for o in objs:
    bb=[o.matrix_world@Vector(c) for c in o.bound_box]
    mn=Vector([min(v[i] for v in bb) for i in range(3)]); mx=Vector([max(v[i] for v in bb) for i in range(3)])
    info.append((o,mn,mx)); cell=max(cell,(mx-mn).x,(mx-mn).y,(mx-mn).z*0.8)
cell*=1.1
rows=math.ceil(len(objs)/cols)
for i,(o,mn,mx) in enumerate(info):
    cx=(i%cols)*cell; cy=-(i//cols)*cell*1.25
    o.location.x+=cx-(mn.x+mx.x)/2; o.location.y+=cy-(mn.y+mx.y)/2; o.location.z-=mn.z
    print('OBJ',i,o.name,[round(v,1) for v in (mx-mn)])
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=10; sc.cycles.use_denoising=False; sc.cycles.device='CPU'; sc.cycles.max_bounces=1
W=cols*cell; H=rows*cell*1.25
sc.render.resolution_x=2000; sc.render.resolution_y=int(2000*H/W*0.9)
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.45,0.55,0.7,1)
sun=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); sun.data.energy=4; sun.rotation_euler=(0.9,0,0.6); sc.collection.objects.link(sun)
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=W*1.02; cam.data.clip_end=W*20
c=Vector((W/2-cell/2,-(rows-1)*cell*1.25/2,cell*0.3)); d=Vector((0.0,-0.82,0.57))
cam.location=c+d*W*3; cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler()
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
