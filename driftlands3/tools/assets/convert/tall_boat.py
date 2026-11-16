# Tall City flying boat -> boat_raw.glb (one mesh per material, in the boat's own frame)
# python3 tall_boat.py <level.json> <out dir>
import bpy, sys, os, json
import numpy as np
sys.path.insert(0, '/home/user/work'); sys.path.insert(0, '/home/user/tools-ref/kyber')
import tall_lib as T
from glbwrite import Glb, weld
level, out = sys.argv[-2], sys.argv[-1]
L, parts, inst = T.collect(level)
keys = [k for k in parts if k[0] == 'boat']
print('boat keys', [(k, parts[k]['mat'], len(inst[k]), len(parts[k]['soup']['P'])) for k in keys])
# group instances into boats: each part's i-th instance belongs to boat i
ref = max(keys, key=lambda k: len(parts[k]['soup']['P']))
R0 = np.array(inst[ref][0]); Rinv = np.linalg.inv(R0)
bymat = {}
for k in keys:
    M = Rinv @ np.array(inst[k][0]); s = parts[k]['soup']
    P = s['P'].reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
    N = s['N'].reshape(-1, 3) @ np.linalg.inv(M[:3, :3])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    UV = s['UV'].copy(); UV[..., 1] = 1 - UV[..., 1]
    b = bymat.setdefault(parts[k]['mat'], [[], [], []])
    b[0].append(P.reshape(-1, 3, 3)); b[1].append(N.reshape(-1, 3, 3)); b[2].append(UV)
allP = np.concatenate([np.concatenate(b[0]).reshape(-1, 3) for b in bymat.values()])
c = (allP.min(0) + allP.max(0)) / 2
g = Glb(); info = {}
for mat, b in bymat.items():
    P = np.concatenate(b[0]) - c; N = np.concatenate(b[1]); UV = np.concatenate(b[2])
    (p, n, uv), idx = weld(P, N, UV)
    g.mesh(mat.replace(' ', '_'), mat, p.astype(np.float32), n.astype(np.float32), uv.astype(np.float32), idx)
    info[mat] = {'tris': int(len(idx)), 'min': p.min(0).round(2).tolist(), 'max': p.max(0).round(2).tolist()}
g.save(os.path.join(out, 'boat_raw.glb'))
json.dump({'parts': info, 'size': (allP.max(0) - allP.min(0)).round(2).tolist(), 'world': [np.array(m)[:3, 3].round(1).tolist() for m in inst[ref]]}, open(os.path.join(out, 'boat_raw.json'), 'w'))
print(json.dumps(info), (allP.max(0) - allP.min(0)).round(2))
