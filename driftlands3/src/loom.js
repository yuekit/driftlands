// The Loom: the Weavers' village on three tables of pale stone west of Rootfall Hollow (the Loom itself, the Spindle
// and the Shuttle), with one house on Rootfall's own back where Wren Halloway has lived these ten years.
// Houses are the Gaea kit; they ride their islands, so each is a child of its island's group.
import * as THREE from 'three';
import { outlineRadius } from './islands-sdf.js';
import { mulberry32 } from './noise.js';
import { Rope } from './ropes.js';
import { U } from './glsl.js';

export const LOOM_SCALE = 1.35;
const LG = ['BldgLG_A', 'BldgLG_B', 'BldgLG_C', 'BldgLG_D', 'BldgLG_E', 'BldgLG_F', 'BldgLG_G', 'BldgLG_H', 'BldgLG_I', 'BldgLG_J'];
const MD = ['BldgMD_A', 'BldgMD_B', 'BldgMD_C', 'BldgMD_D', 'BldgMD_E', 'BldgMD_F', 'BldgMD_G', 'BldgMD_H', 'BldgMD_I', 'BldgMD_J'];
const SM = ['BldgSM_A', 'BldgSM_B', 'BldgSM_C', 'BldgSM_D', 'BldgSM_E', 'BldgSM_F', 'BldgSM_G', 'BldgSM_H', 'BldgSM_I', 'BldgSM_J'];
export const LOOM_MODELS = [...LG, ...MD, ...SM, 'Lantern_B', 'Flag_F', 'Gate_A'];

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Loom {
  constructor(scene, kit, islands) {
    this.scene = scene; this.kit = kit; this.S = LOOM_SCALE;
    const by = (k) => islands.find((I) => I.spec.key === k);
    this.tables = { loom: by('loom'), spindle: by('spindle'), shuttle: by('shuttle'), rootfall: by('rootfall') };
    this.objects = []; this.spots = []; this.lamps = []; this.flags = []; this.ropes = []; this.gates = [];
    this.lit = 0;       // how much of the village has its lamps lit (the story raises it)
    const T = this.tables, rnd = mulberry32(3301);
    // ---- the Loom: the great table. The twin towers of the Hall stand in the middle, the dome on the upper terrace.
    this.hall = this.put(T.loom, 'BldgLG_B', 30, 40, 0.3);
    this.dome = this.put(T.loom, 'BldgLG_A', 96, -98, -0.6);
    this.put(T.loom, 'BldgLG_C', -78, 126, 2.4);
    this.put(T.loom, 'BldgLG_G', 160, 6, 1.2);
    this.put(T.loom, 'BldgLG_D', -118, -66, 0.9);
    this.put(T.loom, 'BldgLG_E', -154, 38, -0.4);
    this.put(T.loom, 'BldgLG_H', -18, -112, 0.2);
    this.put(T.loom, 'BldgMD_F', 136, 96, 2.0);
    this.fill(T.loom, MD, 9, rnd); this.fill(T.loom, SM, 14, rnd);
    // ---- the Spindle: one tall house on a pillar
    this.spire = this.put(T.spindle, 'BldgLG_J', 6, -4, 1.1);
    this.fill(T.spindle, SM, 2, rnd);
    // ---- the Shuttle: the long hall laid along the long table
    this.long = this.put(T.shuttle, 'BldgLG_F', -34, -8, 0.94);
    this.put(T.shuttle, 'BldgLG_I', 62, 72, 0.4);
    this.fill(T.shuttle, MD, 3, rnd); this.fill(T.shuttle, SM, 6, rnd);
    // ---- Rootfall: Wren's house
    if (T.rootfall) this.wren = this.fill(T.rootfall, ['BldgSM_C'], 1, rnd)[0] || null;
    this.dress(rnd);
    // ---- lantern lines from table to table
    this.bridge('loom', 'spindle', 14); this.bridge('loom', 'shuttle', 14); this.bridge('spindle', 'shuttle', 22);
    if (T.rootfall) this.bridge('shuttle', 'rootfall', 18);
    // the places the story uses
    this.posts = [
      ...(this.wren ? [{ name: 'Halloway\'s house', obj: this.wren, lift: 22 }] : []),
      { name: 'the Long House', obj: this.long, lift: 26 },
      { name: 'the Hall', obj: this.hall, lift: 30 },
      { name: 'the Dome', obj: this.dome, lift: 30 },
      { name: 'the Spindle', obj: this.spire, lift: 30 },
    ];
    this.centre = new THREE.Vector3(); this.refreshCentre();
  }
  refreshCentre() { const T = this.tables; this.centre.copy(T.loom.pos).add(T.spindle.pos).add(T.shuttle.pos).multiplyScalar(1 / 3); }
  ground(isl, x, z, r = 0) {
    const p = isl.pos; let best = -1e9, lo = 1e9;
    for (const [dx, dz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45], [0.32, 0.32], [-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32]]) {
      const y = isl.groundAt(p.x + x + dx * r, p.z + z + dz * r) - p.y;
      if (isNaN(y)) return null;
      best = Math.max(best, y); lo = Math.min(lo, y);
    }
    return { y: best, drop: best - lo };
  }
  put(isl, model, x, z, yaw) {
    const o = this.kit.make(model, { scale: this.S });
    const b = o.meta, r = Math.max(b.max[0], -b.min[0], b.max[2], -b.min[2]) * this.S;
    const g = this.ground(isl, x, z, r * 0.8) || { y: 0 };
    o.group.position.set(x, g.y - 0.5, z); o.group.rotation.y = yaw;
    isl.group.add(o.group); o.sync();
    o.isl = isl; o.foot = r; o.litGoal = 0;
    this.objects.push(o); this.spots.push({ isl, x, z, r: r * 0.86, o });
    return o;
  }
  // scatter houses over a table wherever there is room: clear of each other, of the rim and of any step in the ground
  fill(isl, models, count, rnd) {
    const out = [], spec = isl.spec;
    for (let tries = 0; tries < 900 && out.length < count; tries++) {
      const model = models[Math.floor(rnd() * models.length)];
      if (this.objects.filter((o) => o.name === model && o.isl === isl).length >= 2) continue;
      const b = this.kit.info.models[model], r = Math.max(b.max[0], -b.min[0], b.max[2], -b.min[2]) * this.S * 0.86;
      const ang = rnd() * 6.2832, rim = outlineRadius(spec, ang) - r - 14;
      if (rim < 4) continue;
      const rad = Math.sqrt(rnd()) * rim, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (this.spots.some((s) => s.isl === isl && Math.hypot(s.x - x, s.z - z) < s.r + r + 5)) continue;
      const g = this.ground(isl, x, z, r);
      if (!g || g.drop > 3.2) continue;
      out.push(this.put(isl, model, x, z, rnd() * 6.2832));
    }
    return out;
  }
  // lantern posts and banners round the houses, drawn as instanced copies on each table
  dress(rnd) {
    const S = this.S, per = new Map();
    for (const s of this.spots) {
      const list = per.get(s.isl) || { lamps: [], flags: [] }; per.set(s.isl, list);
      const n = s.r > 34 ? 5 : s.r > 16 ? 3 : 2, a0 = rnd() * 6.28;
      for (let i = 0; i < n; i++) {
        const a = a0 + i / n * 6.2832, R = s.r / 0.86 + 3 + rnd() * 3, x = s.x + Math.cos(a) * R, z = s.z + Math.sin(a) * R;
        const y = s.isl.groundAt(s.isl.pos.x + x, s.isl.pos.z + z) - s.isl.pos.y;
        if (isNaN(y) || this.spots.some((q) => q !== s && q.isl === s.isl && Math.hypot(q.x - x, q.z - z) < q.r)) continue;
        if (i === 0 && s.r > 30) list.flags.push([x, y - 0.3, z, rnd() * 6.28]);
        else list.lamps.push([x, y - 0.3, z, rnd() * 6.28, s.o]);
      }
    }
    for (const [isl, list] of per) {
      const mk = (model, arr, scale) => {
        if (!arr.length) return null;
        const im = this.kit.instanced(model, arr.length, 0);
        arr.forEach((p, i) => { _m.compose(_v.set(p[0], p[1], p[2]), _q.setFromAxisAngle(UP, p[3]), _s.setScalar(scale)); im.setMatrixAt(i, _m); });
        im.instanceMatrix.needsUpdate = true; im.layers.enable(3); im.userData.own.uObjScale.value = scale;
        isl.group.add(im); return im;
      };
      mk('Lantern_B', list.lamps, S * 1.25); mk('Flag_F', list.flags, S * 0.95);
      for (const p of list.lamps) this.lamps.push({ isl, local: new THREE.Vector3(p[0], p[1] + 7.6 * S * 1.25, p[2]), house: p[4], ph: rnd() * 20 });
    }
  }
  // a lantern line between two tables, from rim to rim
  bridge(a, b, lanterns) {
    const A = this.tables[a], B = this.tables[b];
    const d = _v.set(B.pos.x - A.pos.x, 0, B.pos.z - A.pos.z).normalize(), ang = Math.atan2(d.z, d.x);
    const ra = outlineRadius(A.spec, ang) - 10, rb = outlineRadius(B.spec, ang + Math.PI) - 10;
    const la = new THREE.Vector3(d.x * ra, 0, d.z * ra), lb = new THREE.Vector3(-d.x * rb, 0, -d.z * rb);
    const ya = A.groundAt(A.pos.x + la.x, A.pos.z + la.z) - A.pos.y, yb = B.groundAt(B.pos.x + lb.x, B.pos.z + lb.z) - B.pos.y;
    la.y = (isNaN(ya) ? 0 : ya) + 13; lb.y = (isNaN(yb) ? 0 : yb) + 13;
    // a gate at each end to carry it
    for (const [isl, l] of [[A, la], [B, lb]]) {
      const g = this.kit.make('Gate_A', { scale: this.S * 1.3 });
      g.group.position.set(l.x, l.y - 13.3, l.z); g.group.rotation.y = -ang + Math.PI / 2; isl.group.add(g.group); g.sync(); g.isl = isl;
      this.objects.push(g); this.gates.push(g);
    }
    const rope = new Rope(this.scene, { radius: 0.5, sag: 0.07, sway: 1.6, lanterns });
    this.ropes.push({ rope, A, B, la, lb });
  }
  // a rim point of a table facing a world position, a little above the turf (for mooring lines)
  rimToward(key, target, lift = 9) {
    const I = this.tables[key], ang = Math.atan2(target.z - I.pos.z, target.x - I.pos.x), r = outlineRadius(I.spec, ang) - 8;
    const local = new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    const y = I.groundAt(I.pos.x + local.x, I.pos.z + local.z) - I.pos.y; local.y = (isNaN(y) ? 0 : y) + lift;
    return { isl: I, local, world: (out = new THREE.Vector3()) => out.copy(local).add(I.pos) };
  }
  postPos(i, out = new THREE.Vector3()) { const p = this.posts[i]; return out.copy(p.obj.centre).setY(p.obj.centre.y + p.obj.radius * 0.5 + p.lift); }
  setLit(v) { for (const o of this.objects) o.litGoal = v; for (const r of this.ropes) r.rope.litGoal = v; this.lit = v; }
  update(dt, cam, fx, lodK = 1) {
    const lampK = U.uLampK.value, T = U.uTime.value;
    for (const o of this.objects) { o.sync(); o.lod(cam, lodK, dt); }
    for (const r of this.ropes) { r.rope.set(_v.copy(r.la).add(r.A.pos), _q2.copy(r.lb).add(r.B.pos)); r.rope.update(dt, fx, cam, lampK); }
    if (!fx) return;
    // lantern posts: a point of light each when near enough to matter
    for (const l of this.lamps) {
      const k = l.house.lit * (0.25 + 0.75 * lampK);
      if (k < 0.02) continue;
      _v.copy(l.local).add(l.isl.pos);
      const d = cam.distanceTo(_v); if (d > 1800) continue;
      const fl = 0.88 + 0.12 * Math.sin(T * 1.7 + l.ph);
      fx.glow(_v, 2.4 + 2 * k, [5.5 * k * fl, 2.9 * k * fl, 0.9 * k * fl], 0.0014);
    }
  }
  sdf(x, y, z) {
    let d = 1e9;
    for (const o of this.objects) { const dc = Math.hypot(x - o.centre.x, y - o.centre.y, z - o.centre.z) - o.radius; if (dc > d || dc > 120) continue; d = Math.min(d, o.sdf(x, y, z)); }
    return d;
  }
}
const _q2 = new THREE.Vector3();
