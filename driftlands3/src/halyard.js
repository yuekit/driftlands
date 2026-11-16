// Halyard: the Windwrights' town, which has never touched ground. Twenty-one patched iron houses (the City in the Sky
// kit) each held up by its own engines and tied to its neighbours by line, flying in a loose formation round the
// Roundhouse. The whole town moves: it has an anchor point and a heading, and every house keeps its station from that.
import * as THREE from 'three';
import { Rope } from './ropes.js';
import { U } from './glsl.js';

export const HALYARD_SCALE = 1.6;
// model, station (x to starboard, y up, z ahead) in metres from the Roundhouse, yaw, name
const STATIONS = [
  ['BldgLgAirPort', 0, 0, 0, 0, 'the Roundhouse'],
  ['BldgSmGovernorsShip', 70, 90, 700, 0, 'the Pilot house'],
  ['BldgMdEntranceArch', -40, 20, 470, 0, 'the Gate'],
  ['BldgLgShipYard', -400, -30, 150, 0.5, 'the Yard'],
  ['BldgLgAirFactory', 400, 30, 90, -0.4, 'the Wind Works'],
  ['BldgLgResCluster', 300, 100, -330, 2.6, 'the Stacks'],
  ['BldgMdHotel', -290, 140, -250, 1.1, 'the Wayhouse'],
  ['BldgMdObservatory', 120, 250, 300, -0.9, 'the Glass'],
  ['BldgMdFloatingManor', -200, 190, 400, 0.3, 'the Manor'],
  ['BldgMdFlyingFarm', 520, -70, 400, 1.9, 'the Farm'],
  ['BldgMdRepairStation', -600, 50, -150, -0.7, 'the Mend'],
  ['BldgMdResClusterA', 180, -50, -600, 0.8, 'Low Row'],
  ['BldgMdResClusterB', -150, -80, -540, -2.2, 'Back Row'],
  ['BldgSmBrewery', 650, 70, -220, 2.2, 'the Still'],
  ['BldgSmFishingVillage', -520, -170, 380, 0.2, 'the Netters'],
  ['BldgSmGasStation', 250, -120, 290, -1.5, 'the Pump'],
  ['BldgSmNomadsHouse', -700, 100, -600, 0.4, 'a straggler'],
  ['BldgSmNomadsHouse', 600, 150, -700, -2.6, 'a straggler'],
  ['BldgSmPostOffice', -110, 110, -760, 3.0, 'the Post'],
  ['BldgSmSmallFactory', 410, -20, 650, 1.0, 'the Forge'],
  ['BldgSmWeatherStation', -380, 300, 100, -1.9, 'the Vane'],
];
export const HALYARD_MODELS = [...new Set(STATIONS.map((s) => s[0])), 'PropFlyingBoat'];

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
export class Halyard {
  constructor(scene, kit) {
    this.scene = scene; this.kit = kit; this.S = HALYARD_SCALE;
    this.anchor = new THREE.Vector3(); this.heading = 0; this.spread = 1; this.speed = 0;
    this.group = new THREE.Group(); scene.add(this.group);
    this.houses = STATIONS.map(([model, x, y, z, yaw, name], i) => {
      const o = kit.make(model, { scale: this.S, glow: [1.0, 0.7, 0.36] });
      this.group.add(o.group);
      const h = { o, name, station: new THREE.Vector3(x, y, z), yaw, ph: i * 2.37, sink: 0, sinkGoal: 0, moor: 0, pos: o.group.position, i };
      o.house = h;
      return h;
    });
    this.hub = this.houses[0];
    // every house is tied to the nearest house nearer the Roundhouse: that is what holds the town in one piece
    this.lines = [];
    for (const h of this.houses.slice(1)) {
      let best = this.hub, bd = h.station.length();
      for (const q of this.houses) { if (q === h || q.station.length() >= h.station.length()) continue; const d = q.station.distanceTo(h.station); if (d < bd) { bd = d; best = q; } }
      const rope = new Rope(scene, { radius: 0.4, sag: 0.05, sway: 0.8, tint: [0.2, 0.19, 0.2], dye: [0.5, 0.2, 0.1], lanterns: Math.max(3, Math.round(bd / 60)) });
      this.lines.push({ rope, a: h, b: best });
    }
    // skiffs running errands between the houses
    this.boats = [];
    for (let i = 0; i < 9; i++) {
      const o = kit.make('PropFlyingBoat', { scale: 2.4, glow: [1.0, 0.7, 0.36] });
      this.group.add(o.group);
      const a = this.houses[(i * 5 + 1) % this.houses.length], b = this.houses[(i * 7 + 4) % this.houses.length];
      this.boats.push({ o, a, b: b === a ? this.hub : b, t: i * 0.37, rate: 0.045 + (i % 4) * 0.008, lift: 20 + (i % 3) * 16, side: i % 2 ? 1 : -1 });
    }
    this.lit = 0; this.time = 0;
    this.place(new THREE.Vector3(0, 300, 0), 0);
  }
  // put the whole town somewhere at once
  place(anchor, heading) { this.anchor.copy(anchor); this.heading = heading; this.update(0, null, null); }
  stationWorld(h, out = new THREE.Vector3()) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading), st = h.station, k = this.spread;
    return out.set(this.anchor.x + (st.x * c + st.z * s) * k, this.anchor.y + st.y * k, this.anchor.z + (-st.x * s + st.z * c) * k);
  }
  house(name) { return this.houses.find((h) => h.name === name); }
  // where a line makes fast on a house: under its lee side, a little out from the hull
  ring(h, toward, out = new THREE.Vector3()) {
    const o = h.o; _w.set(toward.x - o.centre.x, 0, toward.z - o.centre.z).normalize();
    return out.copy(o.centre).addScaledVector(_w, o.radius * 0.45).setY(o.centre.y - o.radius * 0.28);
  }
  setLit(v) { for (const h of this.houses) h.o.litGoal = v; for (const b of this.boats) b.o.litGoal = v; this.lit = v; }
  update(dt, cam, fx, lodK = 1) {
    this.time += dt;
    const T = this.time, lampK = U.uLampK.value;
    for (const h of this.houses) {
      this.stationWorld(h, _v);
      h.sink += (h.sinkGoal - h.sink) * Math.min(1, dt * 0.12);
      const calm = 1 - 0.75 * h.moor;       // a moored house rides easier
      _v.y += Math.sin(T * 0.21 + h.ph) * 5 * calm - h.sink * 190;
      _v.x += Math.sin(T * 0.13 + h.ph * 1.7) * 3 * calm; _v.z += Math.cos(T * 0.11 + h.ph * 0.6) * 3 * calm;
      const g = h.o.group;
      g.position.copy(_v);
      g.rotation.set(Math.sin(T * 0.17 + h.ph) * 0.012 * calm + h.sink * 0.16, this.heading + h.yaw, Math.cos(T * 0.19 + h.ph * 1.3) * 0.012 * calm + h.sink * 0.1);
      h.o.sync();
      // her engines: labouring when she is hooked, stopped when they fail, idling once she rides on a line
      h.o.spinGoal = h.failing ? 0.04 : h.hooked ? 1.6 : 1 - 0.8 * h.moor;
      if (cam) h.o.lod(cam, lodK, dt);
    }
    for (const b of this.boats) {
      b.t += dt * b.rate;
      const A = b.a.o.centre, B = b.b.o.centre, ang = b.t * 6.2832;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1, R = L / 2 + 70;
      const ux = dx / L, uz = dz / L, ca = Math.cos(ang), sa = Math.sin(ang) * b.side;
      const x = mx + ux * ca * R - uz * sa * (R * 0.5 + 50), z = mz + uz * ca * R + ux * sa * (R * 0.5 + 50);
      const y = (A.y + B.y) / 2 + b.lift + Math.sin(ang * 2 + b.lift) * 14 - Math.max(b.a.sink, b.b.sink) * 60;
      const g = b.o.group, px = g.position.x, pz = g.position.z;
      g.position.set(x, y, z);
      if (dt > 0) { const yaw = Math.atan2(x - px, z - pz); g.rotation.set(0, yaw + Math.PI / 2, 0); }   // the skiff's bow is along its own +x
      b.o.sync(); if (cam) b.o.lod(cam, lodK, dt);
      if (fx && cam && b.o.lit * lampK > 0.05 && cam.distanceTo(g.position) < 1500) fx.glow(_v.copy(g.position).setY(y + 3), 2.2, [4 * b.o.lit * lampK, 2.4 * b.o.lit * lampK, 0.8 * b.o.lit * lampK], 0.0012);
    }
    for (const l of this.lines) {
      l.rope.set(_v.copy(l.a.o.centre).setY(l.a.o.centre.y - l.a.o.radius * 0.15), _w.copy(l.b.o.centre).setY(l.b.o.centre.y - l.b.o.radius * 0.15));
      l.rope.litGoal = Math.min(l.a.o.litGoal, l.b.o.litGoal);
      if (cam) l.rope.update(dt, fx, cam, lampK);
    }
    if (!fx || !cam) return;
    for (const h of this.houses) {
      const o = h.o, d = cam.distanceTo(o.centre);
      if (d > 5200) continue;
      // a riding light at the masthead of every house: steady amber, or red and hurried when she is in trouble
      const trouble = h.sinkGoal > 0.05 ? 1 : 0;
      const k = trouble ? Math.max(0, Math.sin(T * 5 + h.ph)) : 0.55 + 0.45 * Math.max(0, Math.sin(T * 0.8 + h.ph)) ** 4;
      _v.copy(o.centre).setY(o.centre.y + o.radius * 0.62);
      const nk = 0.35 + 0.65 * lampK;      // by day a riding light is a pinprick
      fx.glow(_v, (3 + 4 * k) * (trouble ? 1.3 : nk), trouble ? [6 * k, 0.6 * k, 0.2 * k] : [2.2 * k * nk, 1.5 * k * nk, 0.5 * k * nk], trouble ? 0.0026 : 0.0009 + 0.0012 * lampK);
      if (d < 900 && o.lit * lampK > 0.05) for (const p of o.lampsWorld()) fx.glow(p, 2.2, [4.5 * o.lit * lampK, 2.6 * o.lit * lampK, 0.9 * o.lit * lampK], 0.0012);
      // a house going down trails smoke from her engines
      if (h.sinkGoal > 0.05 && dt > 0 && d < 2400 && Math.random() < dt * 9) fx.spawn(1, _v.copy(o.centre).setY(o.centre.y - o.radius * 0.3), _w.set(Math.random() * 6 - 3, 9, Math.random() * 6 - 3), 4.5, 6, 30, [0.18, 0.16, 0.17], 0.5, 0.3, -0.4);
    }
  }
  sdf(x, y, z) {
    let d = 1e9;
    for (const h of this.houses) { const o = h.o, dc = Math.hypot(x - o.centre.x, y - o.centre.y, z - o.centre.z) - o.radius; if (dc > d || dc > 160) { if (dc < d) d = dc; continue; } d = Math.min(d, o.sdf(x, y, z)); }
    return d;
  }
  get radius() { return 1000 * this.spread; }
}
