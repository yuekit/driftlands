# usage: python3 bl_view.py out.png file [tex=path] [hide=a,b] [only=a,b] [views=n] [res=1400]
import bpy,sys,math,os
from mathutils import Vector
out,f=sys.argv[1],sys.argv[2]
opt=dict(a.split('=',1) for a in sys.argv[3:])
bpy.ops.wm.read_factory_settings(use_empty=True)
fl=f.lower()
if fl.endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=f)
elif fl.endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=f)
elif fl.endswith('.obj'): bpy.ops.wm.obj_import(filepath=f)
else: bpy.ops.import_scene.gltf(filepath=f)
hide=opt.get('hide','').split(',') if opt.get('hide') else []
only=opt.get('only','').split(',') if opt.get('only') else None
for o in list(bpy.data.objects):
    if o.type=='MESH' and (o.name in hide or (only and o.name not in only)): bpy.data.objects.remove(o,do_unlink=True)
if 'tex' in opt:
    img=bpy.data.images.load(os.path.abspath(opt['tex']))
    for m in bpy.data.materials:
        if not m.node_tree: continue
        b=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if not b: continue
        if 'Glass' in m.name: b.inputs['Base Color'].default_value=(0.2,0.5,0.6,1); b.inputs['Roughness'].default_value=0.1; continue
        for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
        for l in list(b.inputs['Normal'].links): m.node_tree.links.remove(l)
        t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=img
        m.node_tree.links.new(t.outputs['Color'],b.inputs['Base Color'])
bpy.context.view_layer.update()
objs=[o for o in bpy.data.objects if o.type=='MESH']
mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        v=o.matrix_world@Vector(c)
        for i in range(3): mn[i]=min(mn[i],v[i]); mx[i]=max(mx[i],v[i])
c=(mn+mx)/2; size=(mx-mn); R=size.length/2
print('BOUNDS',[round(v,2) for v in mn],[round(v,2) for v in mx])
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=int(opt.get('spp',24)); sc.cycles.use_denoising=False; sc.cycles.device='CPU'
res=int(opt.get('res',1100)); sc.render.resolution_x=res; sc.render.resolution_y=int(res*0.62)
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.55,0.62,0.75,1); w.node_tree.nodes['Background'].inputs[1].default_value=1.0
sun=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); sun.data.energy=4; sun.rotation_euler=(0.9,0,0.7); sc.collection.objects.link(sun)
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.lens=40; cam.data.clip_end=R*50; cam.data.clip_start=R*0.01
n=int(opt.get('views',4))
el=float(opt.get('el',0.35))
for i in range(n):
    a=i/n*math.tau+0.6
    d=Vector((math.cos(a)*math.cos(el),math.sin(a)*math.cos(el),math.sin(el)))
    cam.location=c+d*R*float(opt.get('dist',2.6))
    cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=out.replace('.png',f'_{i}.png'); bpy.ops.render.render(write_still=True)
