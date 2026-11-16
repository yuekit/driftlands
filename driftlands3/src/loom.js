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
    this.put(T.loom, 'BldgLG_D', 96, -98, -0.6);
    this.put(T.loom, 'BldgLG_C', -78, 126, 2.4);
    this.put(T.loom, 'BldgLG_G', 160, 6, 1.2);
    // the Great Loom on the upper terrace: six cranes re-cut in bamboo round the dome, where the lines are spun
    this.great = this.put(T.loom, 'GreatLoom', -118, -66, 0.4);
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
    // every table dyes its thatch its own colour
    const DYE = new Map([[T.loom, '#3f8f78'], [T.shuttle, '#a85f74'], [T.spindle, '#4c5fa0'], [T.rootfall, '#7d8f4a']]);
    for (const o of this.objects) if (DYE.has(o.isl)) o.setTint({ roof: DYE.get(o.isl), k: [0, 0.5, 0] });
    this.dress(rnd);
    // the warp of the Great Loom: a line from each arm to the swift
    this.warp = this.great.meta.sockets.arm.map((a, i) => ({ rope: new Rope(this.scene, { radius: 0.3, sag: 0.02, sway: 0.4, lanterns: 5, dye: [[0.8, 0.2, 0.12], [0.16, 0.5, 0.42], [0.85, 0.6, 0.15]][i % 3] }), a, b: this.great.meta.sockets.swift[0] }));
    this.stones(rnd); this.makeKites(rnd);
    // ---- lantern lines from table to table
    this.bridge('loom', 'spindle', 14); this.bridge('loom', 'shuttle', 14); this.bridge('spindle', 'shuttle', 22);
    if (T.rootfall) this.bridge('shuttle', 'rootfall', 18);
    // the places the story uses
    this.posts = [
      ...(this.wren ? [{ name: 'Halloway\'s house', obj: this.wren, lift: 22 }] : []),
      { name: 'the Long House', obj: this.long, lift: 26 },
      { name: 'the Hall', obj: this.hall, lift: 30 },
      { name: 'the Great Loom', obj: this.great, lift: 34 },
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
  // the warp stones: tall pillars standing out of the cloud round the tables, each with a house on its head
  stones(rnd) {
    const T = this.tables, c = { x: (T.loom.pos.x + T.spindle.pos.x + T.shuttle.pos.x) / 3, z: (T.loom.pos.z + T.spindle.pos.z + T.shuttle.pos.z) / 3 };
    const names = ['WarpStoneA', 'WarpStoneB', 'WarpStoneC', 'WarpStoneD'], placed = [];
    this.warpStones = [];
    for (let tries = 0; tries < 600 && placed.length < 9; tries++) {
      const ang = rnd() * 6.2832, rad = 420 + rnd() * 620, x = c.x + Math.cos(ang) * rad, z = c.z + Math.sin(ang) * rad;
      // not where Halyard comes to lie (the west), not under a table, not on top of another stone
      if (Math.cos(ang) < -0.45 && Math.abs(Math.sin(ang)) < 0.75) continue;
      if (Object.values(T).some((I) => I && Math.hypot(I.pos.x - x, I.pos.z - z) < I.spec.radius + 150)) continue;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < 260)) continue;
      const name = names[placed.length % names.length], sc = 1.25 + rnd() * 0.45;
      const o = this.kit.make(name, { scale: sc });
      this.scene.add(o.group); o.place(x, -26 - rnd() * 30, z, rnd() * 6.2832); o.litGoal = 0; o.setTint({ roof: '#b06a52', k: [0, 0.45, 0] });
      this.objects.push(o); this.warpStones.push(o); placed.push([x, z]);
    }
    // a lantern line from the head of the nearer stones to the rim of the nearest table
    for (const o of this.warpStones) {
      let best = null, bd = 1e9; for (const k of ['loom', 'spindle', 'shuttle']) { const d = Math.hypot(T[k].pos.x - o.centre.x, T[k].pos.z - o.centre.z) - T[k].spec.radius; if (d < bd) { bd = d; best = k; } }
      if (bd > 430) continue;
      const top = o.toWorld(...o.meta.sockets.top[0]); top.y -= 4;
      const rim = this.rimToward(best, top, 12);
      this.ropes.push({ rope: new Rope(this.scene, { radius: 0.4, sag: 0.09, sway: 1.8, lanterns: Math.round(bd / 28) }), A: { pos: top }, B: rim.isl, la: new THREE.Vector3(), lb: rim.local });
    }
  }
  // kite houses: Weaver huts under Windwright rotors, out on errands round the tables
  makeKites(rnd) {
    const T = this.tables, tabs = [T.loom, T.shuttle, T.spindle, T.loom, T.shuttle, T.loom];
    const CLOTH = ['#e07a3a', '#3f9c8a', '#d9b23c', '#c4506a', '#5f78c0', '#e07a3a'];
    this.kites = tabs.map((isl, i) => {
      const o = this.kit.make(i % 2 ? 'KiteB' : 'KiteA', { scale: 1.5, tint: { cloth: CLOTH[i], roof: CLOTH[(i + 2) % 6], k: [0, 0.4, 0.55] } });
      this.scene.add(o.group); o.litGoal = 1; this.objects.push(o);
      return { o, isl, t: rnd(), rate: 0.012 + rnd() * 0.008, R: isl.spec.radius + 120 + rnd() * 160, lift: 70 + rnd() * 90, side: i % 2 ? 1 : -1, ph: rnd() * 6 };
    });
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
  // where a line leaves the Great Loom: the tip of one of its arms
  armTip(i, out = new THREE.Vector3()) { const a = this.great.meta.sockets.arm[i % this.great.meta.sockets.arm.length]; return this.great.toWorld(a[0], a[1], a[2], out); }
  update(dt, cam, fx, lodK = 1) {
    const lampK = U.uLampK.value, T = U.uTime.value;
    for (const k of this.kites) {
      k.t += dt * k.rate;
      const a = k.t * 6.2832 * k.side, p = k.isl.pos, g = k.o.group;
      const x = p.x + Math.cos(a) * k.R, z = p.z + Math.sin(a) * k.R * 0.8, y = p.y + k.lift + Math.sin(T * 0.3 + k.ph) * 6;
      const hx = -Math.sin(a) * k.side, hz = Math.cos(a) * 0.8 * k.side;
      g.position.set(x, y, z); g.rotation.set(Math.sin(T * 0.4 + k.ph) * 0.03, Math.atan2(hx, hz), -0.12 * k.side + Math.cos(T * 0.33 + k.ph) * 0.03);
    }
    for (const o of this.objects) { o.sync(); o.lod(cam, lodK, dt); }
    for (const w of this.warp) { w.rope.set(this.great.toWorld(w.a[0], w.a[1], w.a[2], _v), this.great.toWorld(w.b[0], w.b[1] - 3, w.b[2], _q2)); w.rope.litGoal = this.great.litGoal; w.rope.update(dt, fx, cam, lampK); }
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
    for (const o of this.objects) { const dc = Math.hypot(x - o.centre.x, y - o.centre.y, z - o.centre.z) - o.radius; if (dc > d || dc > 160) continue; d = Math.min(d, o.sdf(x, y, z)); }
    return d;
  }
}
const _q2 = new THREE.Vector3();

// Things that belong to neither town: bare floating crags along the way in, and (after the splice) what the two towns
// build together: stone kites and spliced houses, moored along the lines.
export class Strays {
  constructor(scene, kit) { this.scene = scene; this.kit = kit; this.crags = []; this.hybrids = []; this.rise = 0; this.riseGoal = 0; }
  // spots: [{ pos, scale, yaw }]
  placeCrags(spots) {
    const names = ['CragA', 'CragB', 'CragC'];
    spots.forEach((sp, i) => { const o = this.kit.make(names[i % 3], { scale: sp.scale }); this.scene.add(o.group); o.place(sp.pos.x, sp.pos.y, sp.pos.z, sp.yaw); o.base = sp.pos.clone(); o.ph = i * 1.7; this.crags.push(o); });
  }
  // list: [{ name, pos, yaw, scale, tint }]
  placeHybrids(list) {
    for (const h of list) { const o = this.kit.make(h.name, { scale: h.scale || 1.4, tint: h.tint || null, glow: [1.0, 0.66, 0.33] }); this.scene.add(o.group); o.home = h.pos.clone(); o.yaw = h.yaw || 0; o.ph = this.hybrids.length * 2.1; o.litGoal = 1; this.hybrids.push(o); }
  }
  update(dt, cam, lodK, time) {
    for (const o of this.crags) { o.group.position.y = o.base.y + Math.sin(time * 0.11 + o.ph) * 3; o.sync(); o.lod(cam, lodK, dt); }
    this.rise += (this.riseGoal - this.rise) * Math.min(1, dt * 0.09);
    const k = this.rise, e = k * k * (3 - 2 * k);
    for (const o of this.hybrids) {
      // until the splice they do not exist: they come up out of the cloud during the fair
      o.group.visible = k > 0.004;
      o.group.position.set(o.home.x, o.home.y - (1 - e) * 420 + Math.sin(time * 0.17 + o.ph) * 4, o.home.z); o.group.rotation.set(0, o.yaw + Math.sin(time * 0.05 + o.ph) * 0.2, 0);
      o.sync(); if (o.group.visible) o.lod(cam, lodK, dt);
    }
  }
  sdf(x, y, z) {
    let d = 1e9;
    for (const o of this.crags) { const dc = Math.hypot(x - o.centre.x, y - o.centre.y, z - o.centre.z) - o.radius; if (dc > d || dc > 200) continue; d = Math.min(d, o.sdf(x, y, z)); }
    if (this.rise > 0.5) for (const o of this.hybrids) { const dc = Math.hypot(x - o.centre.x, y - o.centre.y, z - o.centre.z) - o.radius; if (dc > d || dc > 200) continue; d = Math.min(d, o.sdf(x, y, z)); }
    return d;
  }
}
