# Tall City: level.json (scene.py) + FBX -> unique mesh parts and instance lists. Reuses the kyber bl_city helpers.
import bpy, sys, os, json, math, collections
import numpy as np
sys.path.insert(0, '/home/user/tools-ref/kyber')
import fbxmodel
SRC = '/home/user/assets-src/tall'
def xform(s, M):
    M = np.asarray(M, np.float64); R = M[:3, :3]
    P = s['P'] @ R.T + M[:3, 3]
    N = s['N'] @ np.linalg.inv(R); N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-12)
    out = dict(s); out['P'] = P.astype(np.float32); out['N'] = N.astype(np.float32)
    if np.linalg.det(R) < 0:
        for k in ('P', 'N', 'UV'): out[k] = out[k][:, ::-1]
    return out
lib = {}
def load_fbx(path):
    if (path, 'loaded') in lib: return
    lib[(path, 'loaded')] = True
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=False)
    models, _ = fbxmodel.read(path)
    geo = {}
    for m in models.values(): geo.setdefault(m['name'], fbxmodel.geometric_matrix(m['P']))
    seen = {}
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if o.type != 'MESH': continue
        base = o.name[:-4] if o.name[-4:-3] == '.' and o.name[-3:].isdigit() else o.name
        i = seen.get(base, 0); seen[base] = i + 1
        me = o.data; me.calc_loop_triangles(); nt = len(me.loop_triangles)
        if not nt: continue
        lt = np.zeros(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', lt)
        lv = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv)
        co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        cn = np.zeros(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
        if me.uv_layers.active:
            uv = np.zeros(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        else: uv = np.zeros((len(me.loops), 2), np.float32)
        slot = np.zeros(nt, np.int32); me.loop_triangles.foreach_get('material_index', slot)
        s = {'P': co[lv[lt]].reshape(nt, 3, 3), 'N': cn[lt].reshape(nt, 3, 3), 'UV': uv[lt].reshape(nt, 3, 2)}
        s = xform(s, geo.get(base, np.eye(4))); s['slot'] = slot; s['used'] = sorted(set(int(x) for x in slot))
        lib[(path, fbxmodel.mesh_id(base, i))] = s
def get_mesh(ref):
    path, fid = ref
    if not path or not path.lower().endswith('.fbx'): return None
    load_fbx(path); return lib.get((path, fid))
mname = lambda p: os.path.splitext(os.path.basename(p))[0] if p else 'default'
def collect(level):
    """parts: {(fbx base, meshid, k): {'mat': name, 'soup': ...}}, inst: {key: [4x4 matrices]}"""
    L = json.load(open(level)); parts = {}; inst = collections.defaultdict(list); names = {}
    for n in L['nodes']:
        s = get_mesh(n['mesh'])
        if s is None: print('missing', n['mesh']); continue
        fb = os.path.splitext(os.path.basename(n['mesh'][0]))[0]
        for k, slot in enumerate(s['used']):
            if k >= len(n['mats']): break
            key = (fb, n['mesh'][1], k)
            if key not in parts:
                sel = s['slot'] == slot
                parts[key] = {'mat': mname(n['mats'][k]), 'soup': {a: s[a][sel] for a in ('P', 'N', 'UV')}, 'skinned': n['skinned'], 'node': n['name']}
            elif parts[key]['mat'] != mname(n['mats'][k]): print('MAT VARIANT', key, parts[key]['mat'], mname(n['mats'][k]))
            inst[key].append(np.array(n['M']))
    return L, parts, inst
