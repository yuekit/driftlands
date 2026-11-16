import bpy,sys
from mathutils import Vector
f=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=f)
for o in sorted(bpy.data.objects,key=lambda o:o.name):
    if o.type!='MESH': print(o.type,o.name); continue
    bb=[o.matrix_world@Vector(c) for c in o.bound_box]
    mn=[round(min(v[i] for v in bb),2) for i in range(3)]; mx=[round(max(v[i] for v in bb),2) for i in range(3)]
    print(f"{o.name:28} origin={[round(v,2) for v in o.matrix_world.translation]} rot={[round(v,2) for v in o.matrix_world.to_euler()]} scl={[round(v,3) for v in o.matrix_world.to_scale()]} min={mn} max={mx} uvs={[u.name for u in o.data.uv_layers]} act={o.data.uv_layers.active.name if o.data.uv_layers.active else None}")
