# Tall City (IL.ranch) -> city.glb (unique parts), city.json (index + instance matrices offsets), city.bin (float32 3x4 rows)
# python3 tall_build.py <level.json> <out dir>
import bpy, sys, os, json, collections
import numpy as np
sys.path.insert(0, '/home/user/work'); sys.path.insert(0, '/home/user/tools-ref/kyber')
import tall_lib as T
from glbwrite import Glb, weld
level, out = sys.argv[-2], sys.argv[-1]; os.makedirs(out, exist_ok=True)
L, parts, inst = T.collect(level)
SKIP_FBX = {'boat'}          # the flying boats are exported on their own (they move)
g = Glb(); index = []; blob = []; off = 0; nt = 0; soups = []
def flipped(s):
    o = {k: s[k][:, ::-1].copy() for k in ('P', 'N', 'UV')}; return o
for key in sorted(parts, key=lambda k: (k[0], k[2], k[1])):
    p = parts[key]
    if key[0] in SKIP_FBX: continue
    Ms = np.array(inst[key]); det = np.linalg.det(Ms[:, :3, :3])
    for mirrored in (False, True):
        sel = (det < 0) == mirrored
        if not sel.any(): continue
        s = flipped(p['soup']) if mirrored else p['soup']
        name = f"p{len(index)}"
        UV = s['UV'].copy(); UV[..., 1] = 1 - UV[..., 1]
        (P, N, uv), idx = weld(s['P'], s['N'], UV)
        g.mesh(name, p['mat'], P, N, uv, idx)
        m = Ms[sel][:, :3, :].astype(np.float32)
        index.append({'name': name, 'part': f"{key[0]}#{key[2]}", 'mat': p['mat'], 'tris': int(len(idx)), 'count': int(len(m)), 'offset': off, 'mirrored': mirrored,
                      'r': float(np.linalg.norm(P, axis=1).max())})
        blob.append(m.reshape(-1)); off += m.size; nt += len(idx) * len(m)
        soups.append((s['P'], Ms[sel]))
g.save(os.path.join(out, 'city_raw.glb'))
np.concatenate(blob).astype('<f4').tofile(os.path.join(out, 'city.bin'))
allP = np.concatenate([(P.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]) for P, Ms in soups for M in Ms[:: max(1, len(Ms) // 40)]])
meta = {'parts': index, 'bounds': {'min': allP.min(0).round(2).tolist(), 'max': allP.max(0).round(2).tolist()}, 'particles': L['particles'], 'sun': L['lights'][0]['dir'] if L['lights'] else None}
json.dump(meta, open(os.path.join(out, 'city.json'), 'w'))
print('parts', len(index), 'instances', sum(i['count'] for i in index), 'tris placed', nt, 'mirrored parts', sum(1 for i in index if i['mirrored']), 'bounds', meta['bounds'])
print(collections.Counter(i['mat'] for i in index))
# triangles in world space for the volume bake
tri = np.concatenate([(P.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]).reshape(-1, 3, 3) for P, Ms in soups for M in Ms]).astype(np.float32)
np.save(os.path.join(out, 'city_tris.npy'), tri); print('world tris', tri.shape)
