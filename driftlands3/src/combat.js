// Fighting: the Long Gallery's chord lances and Bell, the Tenders (the city's flying wardens), wall turrets, and
// the machines the player is sent to break (grapples, winch hearts).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer } from './assetbuf.js';
import { cityMaterial } from './city.js';
import { CASTER_LAYER } from './shadow.js';
import boatGlb from './assets/d2/boat.glb';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
export const PLAYER_COL = [0.55, 2.6, 2.2], ENEMY_COL = [3.2, 0.5, 0.22];
const BOLT_SPEED = 540, ENEMY_BOLT = 175;

// ---- iron machines: vertex colour is the paint, alpha marks the parts that glow. The shader plates them over:
// seams every few metres, rivets inside the seams, rust creeping out of them.
const M_VS = /* glsl */ `
attribute vec4 color;
varying vec3 vWorld; varying vec3 vN; varying vec4 vC; varying vec3 vObj; varying vec3 vObjN;
void main(){ vC = color; vObj = position; vObjN = normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const BUMP = /* glsl */ `
vec3 bumpN(vec3 N, vec3 p, float h, float k){
  vec3 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - k * g);
}`;
const M_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec4 vC; varying vec3 vObj; varying vec3 vObjN;
uniform vec3 uGlow; uniform float uPulse; uniform float uHit; uniform float uPlate;
${COMMON}
${BUMP}
void main(){
  vec3 N = normalize(vN);
  vec3 on = normalize(vObjN), an = abs(on);
  vec2 uv = (an.x > an.y && an.x > an.z) ? vObj.zy : (an.y > an.z ? vObj.xz : vObj.xy);
  vec2 pc = uv / uPlate, pf = abs(fract(pc) - 0.5);
  float edge = max(pf.x, pf.y);
  float seam = smoothstep(0.45, 0.49, edge);
  vec2 rv = fract(uv / (uPlate * 0.25) + 0.5) - 0.5;
  float rivet = smoothstep(0.22, 0.12, length(rv)) * smoothstep(0.28, 0.34, edge) * (1.0 - smoothstep(0.41, 0.45, edge));
  float plate = hash12(floor(pc) + floor(dot(on, vec3(1.0, 2.0, 4.0)) * 1.5) * 7.0);
  float w = fbm3(vObj * 0.9);
  float rust = smoothstep(0.50, 0.80, fbm3(vObj * 0.33 + 7.0) + seam * 0.22);
  vec3 alb = vC.rgb * (0.74 + 0.36 * plate + 0.25 * w);
  alb = mix(alb, vec3(0.36, 0.16, 0.08) * (0.7 + 0.6 * w), rust * 0.8);
  alb *= 1.0 - 0.6 * seam;
  alb = mix(alb, alb * 1.6 + 0.03, rivet);
  float metal = mix(0.9, 0.2, rust), rough = mix(0.32 + 0.25 * w, 0.88, rust);
  float dist = length(uCamPos - vWorld), fine = 1.0 - smoothstep(120.0, 420.0, dist);
  float h = ((1.0 - seam) * 0.07 + rivet * 0.07 + w * 0.03 - rust * 0.02) * fine;
  vec3 n = bumpN(N, vWorld, h, 1.0);
  float lamp = step(0.5, vC.a);
  alb = mix(alb, vec3(0.02), lamp);
  gHatchPos = vObj; gHatchN = on; gHatch = 0.5;
  vec3 col = litSurfacePBRx(alb * (1.0 - metal), n, N, vWorld, 1.0, 1.0, 0.1, rough, mix(vec3(0.04), alb, metal));
  col += uGlow * lamp * (0.7 + 0.3 * sin(uTime * 5.0 + vObj.y)) * uPulse;
  // light from the lamps spills onto the iron beside them
  col += uGlow * alb * 0.05 * uPulse * (1.0 - lamp);
  col += vec3(1.0, 0.8, 0.7) * uHit;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;
// the core of a winch heart: a ball of the stuff the Chord is made of, veined and restless
const C_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec4 vC; varying vec3 vObj; varying vec3 vObjN;
uniform vec3 uGlow; uniform float uPulse; uniform float uHit;
${COMMON}
void main(){
  vec3 N = normalize(vN), V = normalize(uCamPos - vWorld);
  vec3 p = vObj * 0.42;
  float t = uTime * 0.35;
  float n1 = fbm3(p + vec3(0.0, t, 0.0) + fbm3(p * 1.7 - t) * 1.6);
  float veins = pow(1.0 - abs(2.0 * n1 - 1.0), 5.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  float beat = 0.82 + 0.18 * sin(uTime * 2.6) * sin(uTime * 0.9 + 1.0);
  vec3 hot = mix(uGlow, vec3(1.0, 0.92, 0.7) * max(uGlow.r, max(uGlow.g, uGlow.b)), veins);
  vec3 col = hot * (0.22 + 1.9 * veins + 0.9 * fres) * beat * uPulse;
  col += vec3(1.0, 0.85, 0.7) * uHit * 3.0;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;
function paint(geo, hex, glow = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = c.r; a[i * 4 + 1] = c.g; a[i * 4 + 2] = c.b; a[i * 4 + 3] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 4)); g.deleteAttribute('uv');
  return g;
}
// smooth-shaded variant, for rings and balls
function paintSmooth(geo, hex, glow = 0) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = c.r; a[i * 4 + 1] = c.g; a[i * 4 + 2] = c.b; a[i * 4 + 3] = glow; }
  const g = geo.index ? geo.toNonIndexed() : geo;
  const cc = new Float32Array(g.attributes.position.count * 4); for (let i = 0; i < cc.length; i += 4) { cc[i] = c.r; cc[i + 1] = c.g; cc[i + 2] = c.b; cc[i + 3] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(cc, 4)); g.deleteAttribute('uv');
  return g;
}
const T = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
function machineMat(glow, plate = 3.1) {
  return new THREE.ShaderMaterial({ vertexShader: M_VS, fragmentShader: M_FS, uniforms: { ...U, uGlow: { value: new THREE.Vector3(...glow) }, uPulse: { value: 1 }, uHit: { value: 0 }, uPlate: { value: plate } } });
}
function coreMat(glow) {
  return new THREE.ShaderMaterial({ vertexShader: M_VS, fragmentShader: C_FS, uniforms: { ...U, uGlow: { value: new THREE.Vector3(...glow) }, uPulse: { value: 1 }, uHit: { value: 0 } } });
}
const IRON = '#454852', DARK = '#24262d', RUST = '#6e3b29', BRASS = '#b38a45';
function turretGeo() {
  const parts = [
    paint(T(new THREE.CylinderGeometry(3.6, 4.6, 2.4, 12), 0, -2.8, 0), DARK),
    paint(T(new THREE.TorusGeometry(3.7, 0.45, 6, 20), 0, -1.6, 0, Math.PI / 2), BRASS),
    paintSmooth(new THREE.SphereGeometry(3.3, 20, 14), IRON),
    paint(T(new THREE.BoxGeometry(5.2, 1.6, 3.2), 0, 0.2, 2.2), DARK),
    paint(T(new THREE.CylinderGeometry(0.5, 0.66, 7.5, 10), 1.35, 0.2, 5.4, Math.PI / 2), DARK),
    paint(T(new THREE.CylinderGeometry(0.5, 0.66, 7.5, 10), -1.35, 0.2, 5.4, Math.PI / 2), DARK),
    paint(T(new THREE.CylinderGeometry(0.8, 0.8, 0.9, 10), 1.35, 0.2, 9.1, Math.PI / 2), BRASS),
    paint(T(new THREE.CylinderGeometry(0.8, 0.8, 0.9, 10), -1.35, 0.2, 9.1, Math.PI / 2), BRASS),
    paintSmooth(T(new THREE.SphereGeometry(1.15, 14, 10), 0, 1.5, 2.6), '#ffffff', 1),
  ];
  return mergeGeometries(parts);
}
// a grapple: an iron claw closed on the rock, a lamp in its palm, the cable's eye above it
function grappleGeo() {
  const parts = [paint(new THREE.CylinderGeometry(5.5, 7.6, 5, 12), DARK), paintSmooth(T(new THREE.TorusGeometry(6.2, 1.3, 10, 28), 0, 4.2, 0, Math.PI / 2), IRON),
    paintSmooth(T(new THREE.SphereGeometry(3.3, 20, 14), 0, 4.6, 0), '#ffffff', 1),
    paintSmooth(T(new THREE.TorusGeometry(3.0, 0.9, 8, 20), 0, 10.5, 0), RUST),
    paint(T(new THREE.CylinderGeometry(0.8, 0.8, 3.2, 8), 0, 8.2, 0), DARK)];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; parts.push(paint(T(new THREE.BoxGeometry(1.1, 1.1, 1.1), Math.cos(a) * 6.2, 5.6, Math.sin(a) * 6.2), BRASS)); }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + 0.4;
    const claw = new THREE.BoxGeometry(2.2, 13, 3.2); claw.translate(0, -6, 0); claw.rotateZ(0.5); claw.translate(7.5, 1, 0); claw.rotateY(a);
    const knuckle = new THREE.CylinderGeometry(1.9, 1.9, 3.8, 10); knuckle.rotateX(Math.PI / 2); knuckle.translate(7.5, 1.4, 0); knuckle.rotateY(a);
    parts.push(paint(claw, i % 2 ? IRON : RUST), paint(knuckle, DARK));
  }
  return mergeGeometries(parts);
}
// A winch heart: three gimbal rings turning about a restless core, hung from a yoke bolted to the wall behind it.
// The frame looks out along +z (away from the wall).
function heartGeos() {
  const ring = (R, tube, col, studs) => {
    const parts = [paintSmooth(new THREE.TorusGeometry(R, tube, 10, 56), col)];
    for (let i = 0; i < studs; i++) { const a = i / studs * Math.PI * 2; const b = new THREE.BoxGeometry(tube * 2.7, tube * 2.7, tube * 2.5); b.rotateZ(a); b.translate(Math.cos(a) * R, Math.sin(a) * R, 0); parts.push(paint(b, i % 2 ? BRASS : DARK)); }
    return mergeGeometries(parts);
  };
  const yoke = new THREE.TorusGeometry(17, 1.5, 8, 28, Math.PI); yoke.rotateZ(Math.PI / 2); yoke.rotateY(-Math.PI / 2);
  const mount = [paint(yoke, IRON),
    paint(T(new THREE.CylinderGeometry(3.0, 4.6, 12, 12), 0, 0, -22, Math.PI / 2), DARK),
    paint(T(new THREE.CylinderGeometry(8, 8, 2, 14), 0, 0, -27.5, Math.PI / 2), IRON),
    paint(T(new THREE.CylinderGeometry(2.3, 2.3, 4, 10), 0, 17, 0), BRASS), paint(T(new THREE.CylinderGeometry(2.3, 2.3, 4, 10), 0, -17, 0), BRASS),
    paint(T(new THREE.CylinderGeometry(0.9, 0.9, 5, 8), 0, 14.2, 0), DARK), paint(T(new THREE.CylinderGeometry(0.9, 0.9, 5, 8), 0, -14.2, 0), DARK)];
  // four prongs reaching in from the wall plate toward the core, their tips lit
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.CylinderGeometry(0.5, 1.1, 15, 8); arm.rotateX(Math.PI / 2); arm.translate(Math.cos(a) * 6.5, Math.sin(a) * 6.5, -19);
    const tip = new THREE.SphereGeometry(1.0, 10, 8); tip.translate(Math.cos(a) * 6.5, Math.sin(a) * 6.5, -11.2);
    mount.push(paint(arm, DARK), paintSmooth(tip, '#ffffff', 1));
  }
  return { mount: mergeGeometries(mount), rings: [ring(14.6, 1.05, IRON, 12), ring(11.8, 0.9, RUST, 10), ring(9.2, 0.75, IRON, 8)], core: paintSmooth(new THREE.IcosahedronGeometry(5.6, 4), '#ffffff', 1) };
}

export class Combat {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.fx = game.fx;
    this.bolts = []; this.drones = []; this.turrets = []; this.targets = [];
    this.events = [];
    this.fireT = 0; this.side = 1; this.bellT = 0; this.bellCd = 11; this.kills = 0;
    this.tokens = 5;      // the enemy's shared rate of fire: however many there are, the sky never fills with more than she can weather
    this.maxDrones = 36;
    this.tGeo = turretGeo(); this.gGeo = grappleGeo(); this.hGeo = heartGeos(); this.husks = [];
    this.fix = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  }
  async load(renderer, quality) {
    const buf = await assetBuffer(boatGlb);
    const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, '', res, rej));
    this.dMeshes = [];
    const jobs = [];
    gltf.scene.traverse((o) => { if (o.isMesh) jobs.push(o); });
    for (const o of jobs) {
      const mat = await cityMaterial(o.name.replace(/_/g, ' '), renderer, quality);
      const im = new THREE.InstancedMesh(o.geometry, mat, this.maxDrones);
      im.count = 0; im.frustumCulled = false; im.layers.enable(CASTER_LAYER);
      this.scene.add(im); this.dMeshes.push(im);
    }
  }
  clear() {
    for (const d of this.drones) if (d.rig) this.scene.remove(d.rig);
    this.bolts.length = 0; this.drones.length = 0;
    for (const t of this.turrets) this.scene.remove(t.mesh);
    for (const t of this.targets) this.scene.remove(t.mesh);
    for (const h of this.husks) this.scene.remove(h);
    this.husks.length = 0;
    this.turrets.length = 0; this.targets.length = 0; this.events.length = 0; this.bellT = 0; this.tokens = 5; if (this.wrecks) this.wrecks.length = 0;
  }
  // ---------------------------------------------------------------- spawning
  spawnDrone(pos, o = {}) {
    if (this.drones.length >= this.maxDrones) return null;
    const d = { kind: 'drone', pos: pos.clone(), vel: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), quat: new THREE.Quaternion(), hp: o.hp ?? 55, maxHp: o.hp ?? 55, r: o.r ?? 7, scale: o.scale ?? 1.5,
      speed: o.speed ?? 56, state: 'approach', t: 0, fireT: 1 + Math.random() * 2, burst: 0, bank: 0, seed: Math.random() * 100, boss: !!o.boss, alive: true, hit: 0, orbit: rnd(1), dmg: o.dmg ?? 4, passive: !!o.passive };
    if (o.dir) d.fwd.copy(o.dir).normalize();
    if (d.boss) {
      // the Harbourmaster carries a heart of its own, slung under the keel in its rings
      const mat = machineMat([7, 1.2, 0.3]), cmat = coreMat([5, 1.1, 0.26]);
      const rig = new THREE.Group();
      d.rings = this.hGeo.rings.slice(0, 2).map((g, i) => { const r = new THREE.Mesh(g, mat); r.layers.enable(CASTER_LAYER); r.rotation.set(i * 1.3, 0.4, 0); rig.add(r); return r; });
      const core = new THREE.Mesh(this.hGeo.core, cmat); rig.add(core);
      rig.scale.setScalar(d.scale * 0.2);
      this.scene.add(rig); d.rig = rig; d.mat = mat; d.cmat = cmat;
      d.light = this.fx.light(d.pos, [0, 0, 0], 220, Infinity);
    }
    this.drones.push(d); return d;
  }
  spawnTurret(pos, normal, o = {}) {
    const mat = machineMat([6, 0.5, 0.2], 1.25);
    const mesh = new THREE.Mesh(this.tGeo, mat); mesh.scale.setScalar(o.scale ?? 1.6);
    mesh.position.copy(pos); mesh.layers.enable(CASTER_LAYER);
    this.scene.add(mesh);
    const t = { kind: 'turret', pos: pos.clone(), vel: new THREE.Vector3(), normal: (normal || UP).clone(), hp: o.hp ?? 60, maxHp: o.hp ?? 60, r: 7 * (o.scale ?? 1.6) / 1.6, mesh, mat, fireT: 1.5 + Math.random() * 2, burst: 0, alive: true, hit: 0, range: o.range ?? 460 };
    this.turrets.push(t); return t;
  }
  // kind: 'grapple' or 'heart'
  addTarget(kind, pos, o = {}) {
    const mat = machineMat(kind === 'heart' ? [7, 1.2, 0.3] : [6, 0.7, 0.25]);
    let mesh, rings = null, core = null, cmat = null;
    if (kind === 'heart') {
      mesh = new THREE.Group();
      const mount = new THREE.Mesh(this.hGeo.mount, mat); mount.layers.enable(CASTER_LAYER); mesh.add(mount);
      rings = this.hGeo.rings.map((g, i) => { const r = new THREE.Mesh(g, mat); r.layers.enable(CASTER_LAYER); r.rotation.set(i * 1.1, i * 0.7, 0); mesh.add(r); return r; });
      cmat = coreMat([4.2, 0.95, 0.22]); core = new THREE.Mesh(this.hGeo.core, cmat); mesh.add(core);
      mesh.userData.mount = mount;
    } else { mesh = new THREE.Mesh(this.gGeo, mat); mesh.layers.enable(CASTER_LAYER); }
    mesh.position.copy(pos); mesh.scale.setScalar(o.scale ?? 1); if (o.quat) mesh.quaternion.copy(o.quat);
    this.scene.add(mesh);
    const t = { kind, pos: pos.clone(), vel: new THREE.Vector3(), hp: o.hp ?? 150, maxHp: o.hp ?? 150, r: (o.r ?? (kind === 'heart' ? 14 : 9)) * (o.scale ?? 1), mesh, mat, rings, core, cmat, spin: 0, alive: true, hit: 0, label: o.label || '', objective: true, onDown: o.onDown || null };
    if (kind === 'heart') t.light = this.fx.light(pos, [0, 0, 0], 150, Infinity);
    this.targets.push(t); return t;
  }
  enemies() { return this._en || (this._en = []); }
  refresh() { const e = this.enemies(); e.length = 0; for (const d of this.drones) if (d.alive) e.push(d); for (const t of this.turrets) if (t.alive) e.push(t); for (const t of this.targets) if (t.alive) e.push(t); return e; }
  // the enemy nearest the aim ray, for the lock bracket and for leading shots
  pick(o, dir, maxAng = 0.075, maxDist = 1000) {
    let best = null, bs = maxAng;
    for (const e of this.refresh()) {
      _v.copy(e.pos).sub(o); const d = _v.length(); if (d > maxDist || d < 5) continue;
      const ang = Math.acos(Math.min(1, _v.dot(dir) / d)) - Math.atan2(e.r, d) * 0.7;
      if (ang < bs) { bs = ang; best = e; }
    }
    return best;
  }
  lead(e, from, speed, out) {
    const d = e.pos.distanceTo(from), t = d / speed;
    out.copy(e.pos).addScaledVector(e.vel, t);
    const t2 = out.distanceTo(from) / speed;
    return out.copy(e.pos).addScaledVector(e.vel, t2);
  }
  // ---------------------------------------------------------------- the player's weapons
  firePlayer(ship, aim, dt) {
    this.fireT -= dt;
    if (this.fireT > 0) return false;
    this.fireT = 0.085;
    this.side = -this.side;
    const p = ship.local(this.side * 3.6, 3.3, 13.5, new THREE.Vector3());
    const tgt = aim.target ? this.lead(aim.target, p, BOLT_SPEED, _w) : aim.point;
    const dir = _v.copy(tgt).sub(p).normalize();
    // the lances cannot fire back through the ship
    if (dir.dot(ship.fwd) < 0.25) dir.copy(ship.fwd);
    dir.x += rnd(0.004); dir.y += rnd(0.004); dir.z += rnd(0.004); dir.normalize();
    this.bolts.push({ p, v: dir.clone().multiplyScalar(BOLT_SPEED).addScaledVector(ship.vel, 0.3), life: 1.15, team: 0, dmg: 10, col: PLAYER_COL, len: 22, w: 0.55 });
    this.fx.glow(p, 5, [1.2, 5, 4.2]);
    this.fx.light(p, [1.5, 7, 6], 60, 0.09);
    return true;
  }
  bell(ship) {
    if (this.bellT > 0) return false;
    this.bellT = this.bellCd;
    const p = ship.local(0, 8, 0, new THREE.Vector3()), R = 210;
    this.fx.shock(p, R * 1.3, 1.1, 0.06);
    this.fx.spawn(3, p, _v.set(0, 0, 0), 0.9, 20, R * 2.2, [1.5, 5, 4.4], 1);
    this.fx.spawn(0, p, _v.set(0, 0, 0), 0.32, 26, 90, [1.2, 4.6, 4.0], 0.4);
    this.fx.light(p, [10, 40, 34], 420, 0.9);
    for (const e of this.refresh()) {
      const d = e.pos.distanceTo(p); if (d > R + e.r) continue;
      this.hurt(e, e.kind === 'drone' ? 45 : 35, p);
      if (e.kind === 'drone' && e.alive) { e.vel.addScaledVector(_v.copy(e.pos).sub(p).normalize(), 60); e.state = 'break'; e.t = 2; }
    }
    for (const b of this.bolts) if (b.team === 1 && b.p.distanceTo(p) < R) { b.life = 0; this.fx.sparks(b.p, 3, null, 20, [3, 1, 0.4]); }
    this.events.push({ type: 'bell', pos: p });
    return true;
  }
  hurt(e, dmg, from) {
    if (!e.alive || e.invuln) return;
    e.hp -= dmg; e.hit = 1;
    if (e.onHurt) e.onHurt(e);
    if (e.hp > 0) return;
    e.alive = false; this.kills++;
    const big = e.kind === 'heart' ? 3.2 : e.kind === 'grapple' ? 2.2 : e.boss ? 3.5 : e.kind === 'turret' ? 1.3 : 1;
    this.fx.explosion(e.pos, big, e.kind === 'drone' || e.kind === 'turret' ? [1, 0.45, 0.15] : [1, 0.6, 0.25]);
    if (big > 2) for (let i = 0; i < 5; i++) { _v.copy(e.pos).add(_w.set(rnd(12), rnd(12), rnd(12))); this.g.after(0.12 + i * 0.14, ((q) => () => this.fx.explosion(q, 1.1 + Math.random(), [1, 0.5, 0.2], { quiet: true }))(_v.clone())); }
    if (e.kind === 'heart') {
      // the yoke stays on the wall, dark; the rings and the core are gone
      for (const r of e.rings) e.mesh.remove(r); e.mesh.remove(e.core);
      e.mat.uniforms.uPulse.value = 0; e.mat.uniforms.uHit.value = 0;
      this.husks.push(e.mesh);
      if (e.light) e.light.life = 0;
    } else if (e.mesh) this.scene.remove(e.mesh);
    if (e.rig) { this.scene.remove(e.rig); if (e.light) e.light.life = 0; }
    if (e.kind === 'drone') { this.wrecks = this.wrecks || []; this.wrecks.push({ pos: e.pos.clone(), vel: e.vel.clone().multiplyScalar(0.7), t: 0, quat: e.quat.clone(), spin: new THREE.Vector3(rnd(3), rnd(3), rnd(3)), scale: e.scale }); }
    this.events.push({ type: 'kill', kind: e.kind, pos: e.pos.clone(), e });
    if (e.onDown) e.onDown(e);
  }
  // ---------------------------------------------------------------- per frame
  update(dt, ship, world) {
    const fx = this.fx, time = U.uTime.value;
    this.bellT = Math.max(0, this.bellT - dt);
    this.tokens = Math.min(5, this.tokens + dt * 2.5 / (1 + 0.4 * ((this.g.cp && this.g.cp.deaths) || 0)));   // and it eases off a pilot who keeps being lost
    // ---- drones
    const sp = ship.pos;
    for (const d of this.drones) {
      if (!d.alive) continue;
      d.t -= dt; d.hit = Math.max(0, d.hit - dt * 5);
      const toShip = _v.copy(sp).addScaledVector(ship.vel, 0.6).sub(d.pos); const dist = toShip.length();
      const want = _w;
      if (d.passive) { want.copy(d.fwd); }
      else if (d.state === 'approach') {
        // come in on an offset line, each from its own side
        _x.set(Math.cos(d.seed + time * 0.2), 0.25 * Math.sin(d.seed * 1.7), Math.sin(d.seed + time * 0.2)).multiplyScalar(Math.min(160, dist * 0.35));
        want.copy(toShip).add(_x).normalize();
        if (dist < 520) { d.state = 'attack'; d.t = 5 + Math.random() * 2; }
      } else if (d.state === 'attack') {
        want.copy(toShip).normalize();
        if (dist < (d.boss ? 170 : 110) || d.t <= 0) { d.state = 'break'; d.t = 2 + Math.random() * 1.6; d.breakDir = new THREE.Vector3(rnd(), 0.2 + Math.random() * 0.6, rnd()).normalize(); }
      } else {
        want.copy(d.fwd).addScaledVector(d.breakDir || UP, 0.9).normalize();
        if (d.t <= 0 || dist > 900) d.state = 'approach';
      }
      // keep clear of walls, rock and the cloud sea
      if (world.sdf) {
        _x.copy(d.pos).addScaledVector(d.fwd, 45);
        const s = world.sdf(_x.x, _x.y, _x.z);
        if (s < 34) { const g = world.grad(_x.x, _x.y, _x.z); want.addScaledVector(g, (34 - s) / 34 * 3).normalize(); }
      }
      if (d.pos.y < world.floor + 25) want.y += (world.floor + 25 - d.pos.y) * 0.05;
      for (const o of this.drones) if (o !== d && o.alive) { _x.copy(d.pos).sub(o.pos); const l = _x.length(); if (l < 40 && l > 0.01) want.addScaledVector(_x, (40 - l) / 40 / l * 1.2); }
      want.normalize();
      // turn toward it at a limited rate
      const turn = (d.boss ? 0.7 : 1.5) * dt;
      const ang = d.fwd.angleTo(want);
      if (ang > 1e-4) { _x.crossVectors(d.fwd, want).normalize(); d.fwd.applyAxisAngle(_x, Math.min(ang, turn)).normalize(); d.bank += ((_x.y * Math.min(ang, 0.6) * -1.4) - d.bank) * Math.min(1, dt * 3); }
      const spd = d.speed * (d.state === 'break' ? 1.25 : 1);
      d.vel.lerp(_x.copy(d.fwd).multiplyScalar(spd), Math.min(1, dt * 3));
      d.pos.addScaledVector(d.vel, dt);
      _m.lookAt(d.pos, _x.copy(d.pos).sub(d.fwd), UP); d.quat.setFromRotationMatrix(_m);
      _q.setFromAxisAngle(_x.set(0, 0, 1), d.bank); d.quat.multiply(_q);
      // fire in bursts when the bow bears on the ship
      d.fireT -= dt;
      if (!d.passive && d.state === 'attack' && dist < 560 && d.fwd.dot(_x.copy(toShip).normalize()) > 0.965) {
        if (d.fireT <= 0 && this.tokens >= 1) {
          this.enemyBolt(d.pos, ship, d.boss ? 0.055 : 0.048, d.dmg, d.fwd);
          d.burst++; d.fireT = d.burst % (d.boss ? 8 : 3) === 0 ? (d.boss ? 1.2 : 2.3 + Math.random() * 1.4) : 0.13;
        }
      }
      if (d.rig) {
        const hurt = 1 - d.hp / d.maxHp, sp = 0.8 + 2.2 * hurt + d.hit * 2;
        d.rig.position.copy(d.pos).addScaledVector(_x.set(0, 1, 0).applyQuaternion(d.quat), -2.9 * d.scale);
        d.rig.quaternion.copy(d.quat);
        d.rings[0].rotation.y += dt * sp; d.rings[1].rotation.x += dt * sp * 1.4;
        d.mat.uniforms.uHit.value = d.hit * 0.5; d.cmat.uniforms.uHit.value = d.hit * 0.4;
        d.cmat.uniforms.uPulse.value = (1 + 0.6 * hurt) * (hurt > 0.6 ? 0.75 + 0.25 * Math.sin(time * 29) : 1);
        const L = 16 + 8 * Math.sin(time * 2.6); d.light.p.copy(d.rig.position); d.light.col = [L, L * 0.28, L * 0.07];
        if (!fx.lights.includes(d.light)) fx.lights.push(d.light);
        fx.glow(d.rig.position, 5 * d.scale, [2.4, 0.5, 0.14], 0.006);
      }
      // eye and exhaust
      _x.copy(d.pos).addScaledVector(d.fwd, 5 * d.scale);
      fx.glow(_x, 1.6 * d.scale, [5, 0.6, 0.25], 0.0035);
      _x.copy(d.pos).addScaledVector(d.fwd, -6 * d.scale);
      fx.glow(_x, 2.2 * d.scale, [2.2, 0.9, 0.3]);
      if (d.hp < d.maxHp * 0.5 && Math.random() < dt * 14) fx.smoke(d.pos, _x.set(rnd(2), 2, rnd(2)), 4 * d.scale, 1.6, 0.06, 0.6);
    }
    // ---- wrecks fall, burning
    if (this.wrecks) {
      for (const w of this.wrecks) {
        w.t += dt; w.vel.y -= 26 * dt; w.pos.addScaledVector(w.vel, dt);
        _q.setFromAxisAngle(_x.copy(w.spin).normalize(), w.spin.length() * dt); w.quat.premultiply(_q);
        if (Math.random() < dt * 30) fx.smoke(w.pos, _x.set(rnd(3), 3, rnd(3)), 5, 2.4, 0.05, 0.7);
        if (Math.random() < dt * 20) fx.spawn(0, w.pos, _x.set(rnd(4), rnd(4), rnd(4)), 0.35, 3, 6, [5, 2, 0.5], 0.9);
        const s = world.sdf ? world.sdf(w.pos.x, w.pos.y, w.pos.z) : 100;
        if (s < 3 || w.pos.y < world.floor - 30 || w.t > 7) { if (s < 3) fx.explosion(w.pos, 0.8, [1, 0.5, 0.2], { quiet: true }); w.dead = true; }
      }
      this.wrecks = this.wrecks.filter((w) => !w.dead);
    }
    // ---- instance matrices for drones and wrecks
    let n = 0;
    const put = (pos, quat, scale) => { if (n >= this.maxDrones) return; _m.compose(pos, quat, _s.setScalar(scale)).multiply(this.fix); for (const im of this.dMeshes) im.setMatrixAt(n, _m); n++; };
    for (const d of this.drones) if (d.alive) put(d.pos, d.quat, d.scale);
    if (this.wrecks) for (const w of this.wrecks) put(w.pos, w.quat, w.scale);
    for (const im of this.dMeshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    this.drones = this.drones.filter((d) => d.alive);
    // ---- turrets
    for (const t of this.turrets) {
      if (!t.alive) continue;
      t.hit = Math.max(0, t.hit - dt * 5); t.mat.uniforms.uHit.value = t.hit * 0.6;
      const dist = t.pos.distanceTo(sp);
      const sees = dist < t.range && !ship.docked;
      if (sees) { _m.lookAt(sp, t.pos, UP); _q.setFromRotationMatrix(_m); t.mesh.quaternion.slerp(_q, Math.min(1, dt * 2.5)); }
      t.mat.uniforms.uPulse.value = sees ? 1.6 : 0.5;
      t.fireT -= dt;
      if (sees && t.fireT <= 0) {
        // do not fire through walls
        const los = world.city ? world.city.raycast(t.pos, _v.copy(sp).sub(t.pos).normalize(), dist - 30, 1.5) : -1;
        if (this.tokens < 1) t.fireT = 0.2;
        else if (los < 0 || los < 12) {
          _x.set(0, 0, 1).applyQuaternion(t.mesh.quaternion);
          this.enemyBolt(_w.copy(t.pos).addScaledVector(_x, 10), ship, 0.05, 4, _x);
          t.burst++; t.fireT = t.burst % 3 === 0 ? 3 + Math.random() * 1.5 : 0.18;
        } else t.fireT = 0.5;
      }
      fx.glow(_x.set(0, 1.4, 4).applyQuaternion(t.mesh.quaternion).add(t.pos), 2.4, [5, 0.6, 0.2], 0.003);
    }
    this.turrets = this.turrets.filter((t) => t.alive);
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.hit = Math.max(0, t.hit - dt * 5); t.mat.uniforms.uHit.value = t.hit * 0.5;
      t.mat.uniforms.uPulse.value = 1 + 0.5 * Math.sin(time * 3);
      if (t.kind === 'heart') {
        // the rings turn faster and less evenly as it is hurt
        const hurt = 1 - t.hp / t.maxHp, sp = 0.35 + 1.6 * hurt + t.hit * 1.5;
        t.rings[0].rotation.y += dt * sp; t.rings[1].rotation.x += dt * sp * 1.37; t.rings[2].rotation.y -= dt * sp * 1.9; t.rings[2].rotation.z += dt * sp * 0.6;
        const flick = hurt > 0.5 ? 0.75 + 0.25 * Math.sin(time * 31) * Math.sin(time * 13.7) : 1;
        t.cmat.uniforms.uPulse.value = (1 + 0.5 * hurt) * flick; t.cmat.uniforms.uHit.value = t.hit * 0.4;
        if (t.light) { const L = (11 + 5 * Math.sin(time * 2.6)) * flick; t.light.col = [L, L * 0.28, L * 0.07]; if (!fx.lights.includes(t.light)) fx.lights.push(t.light); }
        fx.glow(t.pos, t.r * 1.25, [1.5, 0.3, 0.08], 0.006);
      } else fx.glow(t.pos, t.r * 0.9, [3.5, 0.6, 0.2], 0.004);
      if (t.hp < t.maxHp * 0.6 && Math.random() < dt * 10) fx.smoke(_x.copy(t.pos).add(_w.set(rnd(t.r), rnd(t.r), rnd(t.r))), _w.set(rnd(2), 5, rnd(2)), 7, 2.5, 0.06, 0.6);
      if (t.hp < t.maxHp * 0.35 && Math.random() < dt * 6) fx.sparks(t.pos, 4, null, 30, [4, 2, 0.6]);
    }
    this.targets = this.targets.filter((t) => t.alive);
    // ---- bolts
    const en = this.refresh();
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const step = _v.copy(b.v).multiplyScalar(dt), len = step.length();
      const dir = _w.copy(step).multiplyScalar(1 / Math.max(len, 1e-6));
      let hitT = -1, hitE = null;
      if (b.team === 0) {
        for (const e of en) {
          if (!e.alive) continue;
          _x.copy(e.pos).sub(b.p); const along = _x.dot(dir);
          if (along < -e.r || along > len + e.r) continue;
          const perp2 = _x.lengthSq() - along * along;
          if (perp2 < e.r * e.r) { const tt = Math.max(0, along - Math.sqrt(e.r * e.r - perp2)); if (hitT < 0 || tt < hitT) { hitT = tt; hitE = e; } }
        }
      } else if (!ship.docked) {
        for (const S of ship.spheresWorld()) {
          _x.copy(S.c).sub(b.p); const along = _x.dot(dir);
          if (along < -S.r || along > len + S.r) continue;
          if (_x.lengthSq() - along * along < S.r * S.r) { hitT = Math.max(0, along); hitE = ship; break; }
        }
      }
      if (hitE) {
        b.p.addScaledVector(dir, hitT); b.life = 0;
        if (hitE === ship) {
          if (ship.damage(b.dmg)) { this.events.push({ type: 'shipHit', dmg: b.dmg, pos: b.p.clone() }); fx.sparks(b.p, 10, null, 26, [4, 1.4, 0.5]); fx.light(b.p, [16, 5, 2], 50, 0.2); }
        } else {
          this.hurt(hitE, b.dmg, b.p);
          fx.sparks(b.p, 7, _x.copy(dir).negate(), 30, [1.5, 4, 3.6], 0.8, 0.45); fx.spawn(0, b.p, _x.set(0, 0, 0), 0.16, 3, 9, [2, 7, 6], 1);
          this.events.push({ type: 'hit', pos: b.p.clone(), e: hitE });
        }
        continue;
      }
      b.p.add(step);
      // walls and rock
      if (world.sdf && (b.n = (b.n || 0) + 1) % 2 === 0) {
        const s = world.sdf(b.p.x, b.p.y, b.p.z);
        if (s < 1.5) {
          b.life = 0;
          const g = world.grad(b.p.x, b.p.y, b.p.z);
          fx.sparks(b.p, b.team === 0 ? 6 : 4, g, 22, b.team === 0 ? [1.5, 4, 3.6] : [4, 1.2, 0.4], 0.7, 0.4);
          fx.spawn(0, b.p, _x.set(0, 0, 0), 0.14, 2.5, 7, b.team === 0 ? [2, 6, 5] : [6, 1.6, 0.5], 1);
          if (Math.random() < 0.3) fx.smoke(b.p, g.multiplyScalar(3), 3, 1.2, 0.2, 0.4);
        }
      }
      if (b.life > 0) fx.bolt(b.p, dir, b.len, b.w, b.col);
    }
    if (this.bolts.length > 0) this.bolts = this.bolts.filter((b) => b.life > 0);
  }
  enemyBolt(from, ship, spread, dmg, fwd) {
    this.tokens -= 1;
    const d = from.distanceTo(ship.pos), t = d / ENEMY_BOLT;
    const aim = _x.copy(ship.pos).addScaledVector(ship.vel, t * 0.85); aim.y += 6;
    const dir = aim.sub(from).normalize();
    dir.x += rnd(spread); dir.y += rnd(spread); dir.z += rnd(spread); dir.normalize();
    const p = from.clone().addScaledVector(dir, 6);
    this.bolts.push({ p, v: dir.clone().multiplyScalar(ENEMY_BOLT), life: 4.2, team: 1, dmg, col: ENEMY_COL, len: 13, w: 0.75 });
    this.fx.glow(p, 4, [6, 1.2, 0.4]);
    this.events.push({ type: 'enemyShot', pos: p });
  }
}
