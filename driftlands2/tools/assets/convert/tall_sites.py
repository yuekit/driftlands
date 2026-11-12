# Picks places in the Tall City for the game: winch hearts (against a wall, in the sun where possible, with a clear run
# out toward the islands), turret seats near each heart, and open air for patrols.
#   python3 tall_sites.py <out dir> <dst.json> [x y z of the direction from the city to the islands, in the kit's frame]
import numpy as np, json, sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
dist = np.load(src + '/city_dist.npy').astype(np.float32); occ = np.load(src + '/city_occ.npy')
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../src/assets/d2')
info = json.load(open(ASSETS + '/cityvol.json'))
lo = np.array(info['origin']); dims = np.array(info['dims']); nx, ny, nz = dims
rng = np.random.default_rng(7)
def D(p):
    i = np.floor(np.asarray(p) - lo).astype(int)
    if (i < 0).any() or (i >= dims).any(): return 30.0
    return float(dist[tuple(i)])
def grad(p, e=1.5):
    g = np.array([D(p + [e, 0, 0]) - D(p - [e, 0, 0]), D(p + [0, e, 0]) - D(p - [0, e, 0]), D(p + [0, 0, e]) - D(p - [0, 0, e])])
    n = np.linalg.norm(g); return g / n if n > 1e-6 else np.array([0, 1.0, 0])
def clear(p, d, far, r=1.0):
    t = 0.0
    while t < far:
        q = p + d * t; s = D(q)
        if s < r: return t
        t += max(0.7, s * 0.7)
    return far
TO_ISLES = np.array([float(a) for a in sys.argv[3:6]] if len(sys.argv) >= 6 else [-0.99, -0.02, -0.09]); TO_ISLES /= np.linalg.norm(TO_ISLES)
# the baked sun visibility, back out of its atlas, so the hearts can be set where the light falls
atlas = np.asarray(Image.open(ASSETS + '/cityvol_sun.webp').convert('L')).astype(np.float32) / 255
def SUN(p):
    i = np.floor(np.asarray(p) - lo).astype(int)
    if (i < 0).any() or (i >= dims).any(): return 1.0
    r, c = i[2] // info['cols'], i[2] % info['cols']
    return float(atlas[r * ny + i[1], c * nx + i[0]])
# ---- hearts: hung 3.4..4.6 units off a solid wall that looks toward the islands, open air all round the front of
# them (so they can be seen and shot at), in the sun where possible, spread out in height and across the face
def occupied(p):
    i = np.floor(np.asarray(p) - lo).astype(int)
    if (i < 0).any() or (i >= dims).any(): return 0.0
    return float(occ[tuple(i)] > 0)
dirs = []
for i in range(60):                                   # a Fibonacci sphere of probe directions
    y = 1 - 2 * (i + 0.5) / 60; r = np.sqrt(1 - y * y); a = i * 2.39996
    dirs.append(np.array([np.cos(a) * r, y, np.sin(a) * r]))
cands = []
free = np.argwhere((dist > 3.4) & (dist < 4.6))
free = free[rng.choice(len(free), min(len(free), 90000), replace=False)]
for i in free:
    p = lo + i + 0.5
    if p[1] < -34 or p[1] > 62: continue
    g = grad(p)
    if abs(g[1]) > 0.45 or g @ TO_ISLES < 0.15: continue          # on a wall, and one that faces the islands
    if clear(p, TO_ISLES, 260, 2.6) < 260: continue
    if clear(p, g, 60, 3.0) < 60: continue
    backing = np.mean([occupied(p - g * k) for k in np.arange(4.6, 9.1, 0.75)])
    if backing < 0.5: continue                                      # a wall, not a girder
    front = [d for d in dirs if d @ g > 0.15]
    openness = np.mean([clear(p, d, 26, 2.0) >= 26 for d in front])
    if openness < 0.75: continue
    sun = np.mean([SUN(p + g * k) for k in (0.5, 2.0, 3.5)])
    cands.append((p, g, openness, backing, sun))
print('heart candidates', len(cands))
hearts = []
cands.sort(key=lambda c: -(c[2] * 6 + c[4] * 4 + c[3]))
for sep in (60, 45, 30):
    for p, g, openness, backing, sun in cands:
        if all(np.linalg.norm(p - h['p']) > sep and abs(p[1] - h['p'][1]) > 10 for h in hearts):
            hearts.append({'p': p, 'n': g, 'box': round(openness * 10), 'sun': sun})
        if len(hearts) == 4: break
    if len(hearts) == 4: break
# ---- turrets: on walls 20..45 units from a heart, seeing the open air in front of it
def seats(centre, n, rmin, rmax):
    out = []
    tries = 0
    while len(out) < n and tries < 40000:
        tries += 1
        p = centre + rng.normal(size=3) * rmax * 0.6
        s = D(p)
        if s < 1.0 or s > 2.2: continue
        if not (rmin < np.linalg.norm(p - centre) < rmax): continue
        g = grad(p)
        if clear(p + g * 1.5, g, 40, 1.0) < 40: continue           # an open field of fire
        if clear(p + g * 2, (centre - p) / np.linalg.norm(centre - p), np.linalg.norm(centre - p) - 6, 0.8) < np.linalg.norm(centre - p) - 6: continue
        if any(np.linalg.norm(p - o['p']) < 14 for o in out): continue
        out.append({'p': p, 'n': g})
    return out
turrets = []
for h in hearts: h['turrets'] = seats(h['p'] + h['n'] * 8, 3, 14, 48)
# ---- open air: big empty spots for patrol points and spawns, in and around the city
air = []
big = np.argwhere(dist > 9)
for i in big[rng.choice(len(big), 4000, replace=False)]:
    p = lo + i + 0.5
    if p[1] < -30 or p[1] > 80: continue
    if all(np.linalg.norm(p - a) > 34 for a in air): air.append(p)
    if len(air) >= 40: break
# canyon waypoints: fairly open but walled spots inside the bounds
out = {'hearts': [{'p': h['p'].round(2).tolist(), 'n': h['n'].round(3).tolist(), 'box': int(h['box']), 'turrets': [{'p': t['p'].round(2).tolist(), 'n': t['n'].round(3).tolist()} for t in h['turrets']]} for h in hearts],
       'air': [a.round(1).tolist() for a in air], 'toIsles': TO_ISLES.round(4).tolist()}
json.dump(out, open(dst, 'w'))
for h, hh in zip(out['hearts'], hearts): print(h['p'], h['n'], 'box', h['box'], 'sun', round(hh['sun'], 2), 'turrets', len(h['turrets']))
print('air', len(air))
