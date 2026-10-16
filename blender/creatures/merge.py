import bpy
bpy.ops.wm.open_mainfile(filepath='/home/claude/creaturebl/creatures_src.blend')
with bpy.data.libraries.load('/home/claude/creaturebl/skins/skins_src.blend') as (src, dst):
    dst.objects = [n for n in src.objects if n.startswith('SkinSwatch')]
c = bpy.data.collections.new('Skin library'); bpy.context.scene.collection.children.link(c)
for i, o in enumerate(dst.objects):
    c.objects.link(o); o.location = (i * 2.4, -12, 0)
bpy.ops.wm.save_as_mainfile(filepath='/home/claude/creaturebl/Driftlands_creatures.blend', compress=True)
print('merged', [o.name for o in dst.objects])
