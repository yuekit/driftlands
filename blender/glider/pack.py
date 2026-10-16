import bpy, sys
src, dst = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=src)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=dst, compress=True)
print('packed', dst)
