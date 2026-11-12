# Fantasy Ship (Yorakeys) FBX -> ship.glb: Y-up, bow +Z, metres (SCALE), baked AO in COLOR_0.r, part class in COLOR_0.g,
# moving parts as their own nodes with the origin at their hub. python3 ship_build.py <Fantasy_Ship.fbx> out.glb
import bpy, sys, json, math
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, '/home/user/tools-ref/kyber')
from glbwrite import Glb, weld
SRC, OUT = sys.argv[-2], sys.argv[-1]
SCALE = 0.5
DROP = {'Air_Balloon_V2', 'Hood_01'}
CLS = {'hull': 0, 'detail': 1, 'sail': 2, 'prop': 3, 'balloon': 4, 'glass': 5}
MOVING = ['Ship_Propeller_01.L', 'Ship_Propeller_01.R', 'Ship_Propeller_02.L', 'Ship_Propeller_02.R', 'Ship_Propeller_03.L', 'Ship_Propeller_03.R', 'Air_Balloon_Propeller_L',
          'ShipWheel', 'Wing_Back', 'Wing_B.L', 'Wing_B.R', 'Wing_L', 'Wing_R', 'Tail_Wing_01.L', 'Tail_Wing_01.R', 'Tail_Wing_02.L', 'Tail_Wing_02.R', 'Wing_Bottom_01', 'Wing_S.L', 'Wing_S.R']
def cls_of(o, matname):
    n = o.name
    if 'Glass' in matname: return 'glass'
    if 'Propeller' in n: return 'prop'
    if n.startswith(('Wing_', 'Tail_Wing')) and 'Connector' not in n: return 'sail'
    if n == 'TailFrame' and matname == 'Texture_02': return 'sail'
    if n == 'Air_Balloon': return 'balloon'
    if n in ('Ship_Details', 'ShipWheel'): return 'detail'
    return 'hull'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
for o in list(bpy.data.objects):
    if o.name in DROP or o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
# ---- bake ambient occlusion into a vertex colour attribute
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 96; sc.cycles.use_denoising = False
bpy.context.scene.world = bpy.data.worlds.new('w')
for o in objs:
    me = o.data
    if 'AO' not in me.color_attributes: me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = me.color_attributes['AO']; me.color_attributes.render_color_index = me.color_attributes.find('AO')
for o in objs:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    try: bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    except Exception as e: print('BAKE FAIL', o.name, e)
print('baked')
# ---- extract
Yup = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float) * SCALE      # blender (x,y,z) -> (x, z, -y)
g = Glb(); info = {}
static = {}
def soup_of(o):
    me = o.data; me.calc_loop_triangles(); nt = len(me.loop_triangles)
    lt = np.zeros(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', lt)
    lv = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv)
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    cn = np.zeros(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
    uvl = me.uv_layers.get('UVMap') or me.uv_layers.active
    uv = np.zeros(len(me.loops) * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    ao = np.zeros(len(me.vertices) * 4, np.float32); me.color_attributes['AO'].data.foreach_get('color', ao); ao = ao.reshape(-1, 4)[:, 0]
    slot = np.zeros(nt, np.int32); me.loop_triangles.foreach_get('material_index', slot)
    M = np.array(o.matrix_world); R = M[:3, :3]
    P = co @ R.T + M[:3, 3]; N = cn @ np.linalg.inv(R); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    P = P @ Yup.T; N = N @ (Yup / SCALE).T
    vi = lv[lt]
    return P[vi].reshape(nt, 3, 3), N[lt].reshape(nt, 3, 3), uv[lt].reshape(nt, 3, 2), ao[vi].reshape(nt, 3), slot
def emit(name, parts, origin=None, extras=None):
    P = np.concatenate([p[0] for p in parts]); N = np.concatenate([p[1] for p in parts]); UV = np.concatenate([p[2] for p in parts]); C = np.concatenate([p[3] for p in parts])
    if origin is not None: P = P - origin
    UV = UV.copy(); UV[..., 1] = 1 - UV[..., 1]
    (p, n, uv, c), idx = weld(P, N, UV, [C])
    col = np.concatenate([c, np.ones((len(c), 1), np.float32)], 1)
    M = np.eye(4)
    if origin is not None: M[:3, 3] = origin
    g.mesh(name, 'ship', p, n, uv, idx, color=col, matrix=M, extras=extras)
    return len(idx)
tot = 0
for o in sorted(objs, key=lambda o: o.name):
    P, N, UV, AO, slot = soup_of(o)
    names = [ms.material.name if ms.material else '' for ms in o.material_slots]
    cl = np.array([CLS[cls_of(o, names[s] if s < len(names) else '')] for s in slot], np.float32)
    C = np.stack([AO, np.repeat(cl[:, None], 3, 1) / 8.0, np.zeros_like(AO)], -1)
    part = (P, N, UV, C)
    if o.name in MOVING:
        mn = P.reshape(-1, 3).min(0); mx = P.reshape(-1, 3).max(0); c = (mn + mx) / 2
        key = o.name.replace('.', '_')
        tot += emit(key, [part], origin=c, extras={'min': (mn - c).round(3).tolist(), 'max': (mx - c).round(3).tolist()})
        info[key] = {'pos': c.round(3).tolist(), 'size': (mx - mn).round(3).tolist()}
    else:
        for k in sorted(set(cl.tolist())):
            sel = cl == k
            static.setdefault('glass' if k == 5 else 'body', []).append((P[sel], N[sel], UV[sel], C[sel]))
for k, parts in static.items(): tot += emit(k, parts)
g.save(OUT)
allP = np.concatenate([p[0].reshape(-1, 3) for parts in static.values() for p in parts])
info['bounds'] = {'min': allP.min(0).round(2).tolist(), 'max': allP.max(0).round(2).tolist()}
json.dump(info, open(OUT.replace('.glb', '.json'), 'w'), indent=1)
print('tris', tot, json.dumps(info)[:1500])
