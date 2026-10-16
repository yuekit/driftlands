"""Turn a user-edited glider .blend into a clean bake source: keep editable + additions, drop pre-baked LODs and studio rig."""
import sys, bpy
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
bpy.ops.wm.open_mainfile(filepath=args[0])
def skip(c): n=c.name.lower(); return 'game lod' in n or 'studio' in n or 'not exported' in n
drop=set()
for c in bpy.data.collections:
    if skip(c): drop |= set(c.objects)
for o in bpy.data.objects:
    if o.type in ('CAMERA','LIGHT') or o.name.startswith('Game_'): drop.add(o)
for o in drop: bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    if skip(c): bpy.data.collections.remove(c)
for c in bpy.data.collections: c.hide_viewport=False; c.hide_render=False; c.hide_select=False
def walk(lc):
    lc.exclude=False; lc.hide_viewport=False
    for ch in lc.children: walk(ch)
walk(bpy.context.view_layer.layer_collection)
for o in bpy.data.objects:
    o.hide_viewport=False; o.hide_render=False
    if o.name in bpy.context.view_layer.objects: o.hide_set(False)
for m in list(bpy.data.materials):
    if m.users==0: bpy.data.materials.remove(m)
for i in list(bpy.data.images):
    if i.users==0: bpy.data.images.remove(i)
# where a modelled scarf tail ends, the game's animated ribbon takes over
tail=next((o for o in bpy.data.objects if o.type=='MESH' and 'scarf' in o.name.lower() and 'tail' in o.name.lower()), None)
if tail and 'ScarfTailEnd' not in bpy.data.objects:
    from mathutils import Vector
    mw=tail.matrix_world; vs=[mw@v.co for v in tail.data.vertices]
    end=sorted(vs, key=lambda v: v.y)[-2:]          # furthest aft pair (Blender +Y is aft)
    e=bpy.data.objects.new('ScarfTailEnd', None); e.location=(end[0]+end[1])/2
    e['width']=(end[0]-end[1]).length
    tail.users_collection[0].objects.link(e); print('TAILEND', tuple(e.location), e['width'])
dg=bpy.context.evaluated_depsgraph_get(); tot=0
for o in bpy.data.objects:
    if o.type=='MESH':
        e=o.evaluated_get(dg); m=e.to_mesh(); m.calc_loop_triangles(); tot+=len(m.loop_triangles); e.to_mesh_clear()
print('KEPT', len(bpy.data.objects), 'TRIS', tot)
bpy.ops.wm.save_as_mainfile(filepath=args[1])
