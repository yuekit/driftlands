// The Long Gallery: the Meridian Institute's airship. Model, materials, flight and the chase camera.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer, assetTexture } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';
import shipGlb from './assets/d2/ship.glb';
import shipC from './assets/d2/ship_c.webp';
import shipM from './assets/d2/ship_m.webp';

const VS = /* glsl */ `
attribute vec4 aData;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec3 vObjN; varying vec2 vUv; varying vec2 vData;
void main(){
  vUv = uv; vData = aData.xy;
  vObj = position; vObjN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// The pack's texture is a swatch card: flat colours picked by UV. Each swatch becomes a material here, with grain,
// weave and wear worked out in the ship's own space so nothing swims when she turns.
const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec3 vObjN; varying vec2 vUv; varying vec2 vData;
uniform sampler2D tC; uniform sampler2D tM;
uniform vec3 uPrimary; uniform vec3 uSecondary; uniform float uLamp; uniform float uHit; uniform vec3 uPivot;
${COMMON}
float key(vec3 c, vec3 k){ return 1.0 - smoothstep(0.04, 0.10, distance(c, k)); }
vec3 bumpN(vec3 N, vec3 p, float h, float k){
  vec3 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - k * g);
}
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 pal = texture(tC, vUv).rgb;
  vec3 mk = texture(tM, vUv).rgb;
  float cls = floor(vData.y * 8.0 + 0.5);
  float ao = mix(1.0, vData.x, 0.9);
  vec3 op = vObj + uPivot;                 // position in the whole ship's frame
  float kWoodA = key(pal, vec3(0.188, 0.098, 0.040)), kWoodB = key(pal, vec3(0.352, 0.188, 0.080));
  float kIron = key(pal, vec3(0.0)), kGold = key(pal, vec3(0.631, 0.392, 0.098));
  float kCream = key(pal, vec3(0.745, 0.687, 0.578)), kRed = key(pal, vec3(0.434, 0.051, 0.051));
  float cloth = (cls == 2.0 || cls == 4.0) ? 1.0 : 0.0;
  vec3 alb = pal; float rough = 0.62, metal = 0.0, h = 0.0;
  // painted planks and canvas take the Institute's colours through the pack's masks
  alb = mix(alb, alb * uPrimary, mk.r);
  alb = mix(alb, alb * uSecondary, mk.g);
  // timber: grain runs fore and aft, boards differ a little from one another
  float wood = max(kWoodA, kWoodB);
  if (wood > 0.01) {
    vec3 gp = op * vec3(7.0, 7.0, 0.55);
    float g = fbm3(gp + fbm3(gp * 0.5) * 1.5);
    float board = hash12(floor(vec2(op.y * 2.6 + op.x * 0.7, op.z * 0.21)));
    vec3 w = mix(vec3(0.20, 0.102, 0.048), vec3(0.40, 0.215, 0.095), kWoodB / max(wood, 1e-3));
    w *= 0.72 + 0.5 * g + 0.16 * (board - 0.5);
    alb = mix(alb, w, wood); rough = mix(rough, 0.5 + 0.3 * g, wood); h += wood * g * 0.012;
  }
  // iron fittings and brass
  alb = mix(alb, vec3(0.30, 0.31, 0.34) * (0.8 + 0.4 * vnoise(op * 9.0)), kIron); metal = mix(metal, 1.0, kIron); rough = mix(rough, 0.46, kIron);
  float brass = kGold * (1.0 - cloth);
  alb = mix(alb, vec3(0.93, 0.66, 0.30) * (0.85 + 0.3 * vnoise(op * 14.0)), brass); metal = mix(metal, 1.0, brass); rough = mix(rough, 0.32, brass);
  alb = mix(alb, vec3(0.62, 0.45, 0.22) * (0.8 + 0.4 * vnoise(op * vec3(30.0, 30.0, 30.0))), kGold * cloth);      // hemp rope
  alb = mix(alb, vec3(0.80, 0.72, 0.58), kCream); rough = mix(rough, 0.5, kCream);
  // canvas: a weave you can see up close, panels sewn in gores, weathering toward the keel of the envelope
  if (cloth > 0.5) {
    float weave = (sin(op.x * 46.0) * sin(op.y * 46.0 + op.z * 46.0)) * 0.5 + 0.5;
    float stain = fbm3(op * vec3(0.22, 0.5, 0.22) + 3.0);
    float fine = 1.0 - smoothstep(30.0, 90.0, length(uCamPos - vWorld));
    alb *= (0.90 + 0.10 * weave * fine) * (0.80 + 0.32 * stain);
    alb = mix(alb, alb * vec3(0.86, 0.78, 0.70), smoothstep(0.2, -0.9, normalize(vObjN).y) * 0.5 * step(3.5, cls));
    rough = 0.82; h += weave * 0.002 * fine;
  }
  if (cls == 5.0) { alb = vec3(0.02, 0.03, 0.05); rough = 0.08; }
  vec3 n = bumpN(N, vWorld, h, 1.0);
  gHatchPos = op; gHatchN = normalize(vObjN); gHatch = 0.55;
  vec3 col = litSurfacePBRx(alb * (1.0 - metal), n, N, vWorld, 1.0, ao, cloth * 0.35, rough, mix(vec3(cls == 5.0 ? 0.08 : 0.04), alb, metal));
  if (cloth > 0.5) col += thinTransmission(alb, n, V, vWorld, 1.0, cls == 2.0 ? 0.75 : 0.22) * ao;
  // lamps, lit portholes and cabin glass
  vec3 lampCol = vec3(1.0, 0.62, 0.24);
  col += lampCol * mk.b * kRed * (1.2 + 5.0 * uLamp);
  col += lampCol * kRed * (1.0 - mk.b) * 0.25 * (1.0 + 3.0 * uLamp);
  if (cls == 5.0) col += lampCol * (0.12 + 1.5 * uLamp) * (0.6 + 0.4 * vnoise(op * 2.0));
  col += vec3(1.0, 0.75, 0.6) * uHit;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

export async function loadShip(renderer) {
  const [buf, tC, tM] = await Promise.all([assetBuffer(shipGlb), assetTexture(shipC, { srgb: true, aniso: 4 }), assetTexture(shipM, { aniso: 4 })]);
  for (const t of [tC, tM]) { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; renderer.initTexture(t); }
  const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, '', res, rej));
  const root = gltf.scene, parts = {}, mats = [];
  const shared = { tC: { value: tC }, tM: { value: tM }, uPrimary: { value: new THREE.Vector3(0.92, 0.84, 0.70) }, uSecondary: { value: new THREE.Vector3(0.74, 0.22, 0.13) }, uLamp: { value: 0 }, uHit: { value: 0 } };
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.name) parts[o.name] = o;
    if (!o.isMesh) return;
    const g = o.geometry;
    if (g.attributes.color) { g.setAttribute('aData', g.attributes.color); g.deleteAttribute('color'); }
    const pivot = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    o.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...U, ...shared, uPivot: { value: pivot } }, side: THREE.DoubleSide });
    mats.push(o.material);
    o.layers.enable(CASTER_LAYER); o.frustumCulled = false;
  });
  return { root, parts, mats, shared };
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
export const CRUISE = 44, BOOST = 86, SLOW = 15;
// collision spheres in the ship's frame: hull fore, mid, aft; envelope fore and aft
const SPHERES = [[0, 2.5, 10, 4.5], [0, 2.5, 0, 5.5], [0, 3, -10, 5.5], [0, 15.5, 7, 7.5], [0, 15.5, -5, 8]];

export class Airship {
  constructor(scene, model) {
    this.model = model;
    this.root = new THREE.Group();
    this.root.add(model.root);
    scene.add(this.root);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1); this.up = new THREE.Vector3(0, 1, 0); this.right = new THREE.Vector3(-1, 0, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.speed = CRUISE; this.boost = 0; this.energy = 1; this.hull = 100; this.maxHull = 100;
    this.hitFlash = 0; this.impact = 0; this.spin = 0; this.lamp = 0;
    this.docked = false; this.invuln = 0; this.wreck = 0;
    this.ctlX = 0; this.ctlY = 0;
    this.rest = {};
    for (const k in model.parts) this.rest[k] = model.parts[k].rotation.clone();
  }
  place(p, yaw, pitch = 0) {
    this.pos.copy(p); this.yaw = yaw; this.pitch = pitch; this.roll = 0; this.yawRate = 0;
    this.orient(); this.vel.copy(this.fwd).multiplyScalar(this.speed); this.sync();
  }
  orient() {
    _e.set(-this.pitch, this.yaw, this.roll);
    this.root.quaternion.setFromEuler(_e);
    this.fwd.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    this.right.set(-1, 0, 0).applyQuaternion(this.root.quaternion);
  }
  sync() { this.root.position.copy(this.pos); this.root.updateMatrixWorld(true); }
  // ctl: x turn (-1 left .. 1 right), y climb (-1 down .. 1 up), boost, brake
  update(dt, ctl, world, events) {
    if (dt <= 0) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.ctlX += (ctl.x - this.ctlX) * Math.min(1, dt * 5); this.ctlY += (ctl.y - this.ctlY) * Math.min(1, dt * 5);
    const wantBoost = ctl.boost && this.energy > 0.02 && !ctl.brake;
    this.boost += ((wantBoost ? 1 : 0) - this.boost) * Math.min(1, dt * 3);
    this.energy = Math.max(0, Math.min(1, this.energy + (wantBoost ? -dt / 5.5 : dt / 9)));
    const target = ctl.brake ? SLOW : CRUISE + (BOOST - CRUISE) * this.boost;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 1.1 : 0.8));
    const agile = 1 - 0.4 * this.boost + (ctl.brake ? 0.35 : 0);
    this.yawRate += (-ctl.x * 0.72 * agile - this.yawRate) * Math.min(1, dt * 2.4);
    this.yaw += this.yawRate * dt;
    this.pitch += (ctl.y * 0.62 - this.pitch) * Math.min(1, dt * 1.7);
    // she is wall-shy: when something solid is coming up the helm eases away from it on its own
    if (world && world.sdf) {
      const look = 0.9 + this.speed * 0.012;
      _v.copy(this.pos).addScaledVector(this.vel, look); _v.y += 8;
      const d = world.sdf(_v.x, _v.y, _v.z);
      if (d < 30) {
        const g = world.grad(_v.x, _v.y, _v.z), k = (30 - d) / 30;
        this.yawRate += -g.dot(this.right) * k * dt * 2.6;
        this.pitch += g.y * k * dt * 0.9;
        this.shy = k;
      } else this.shy = 0;
    }
    this.roll += (-this.yawRate * 0.62 - this.roll) * Math.min(1, dt * 2.2);
    this.orient();
    _v.copy(this.fwd).multiplyScalar(this.speed);
    this.vel.lerp(_v, Math.min(1, dt * 2.6));
    if (world && world.wind) this.vel.addScaledVector(world.wind, dt * 0.6);
    this.pos.addScaledVector(this.vel, dt);
    // the cloud sea holds her up: she can skim it but not sink
    const floor = (world ? world.floor : 30);
    if (this.pos.y < floor) { this.pos.y += (floor - this.pos.y) * Math.min(1, dt * 3); if (this.vel.y < 0) this.vel.y *= 1 - Math.min(1, dt * 4); this.pitch = Math.max(this.pitch, -0.05); }
    if (world && world.ceiling && this.pos.y > world.ceiling) { this.pos.y += (world.ceiling - this.pos.y) * Math.min(1, dt * 2); this.pitch = Math.min(this.pitch, 0.05); }
    this.sync();
    this.impact = Math.max(0, this.impact - dt * 2);
    if (world && world.sdf) this.collide(world, events);
    this.animate(dt);
  }
  collide(world, events) {
    const m = this.root.matrixWorld;
    let hit = 0;
    for (const s of SPHERES) {
      _v.set(s[0], s[1], s[2]).applyMatrix4(m);
      const d = world.sdf(_v.x, _v.y, _v.z);
      if (d >= s[3]) continue;
      const g = world.grad(_v.x, _v.y, _v.z);
      const pen = s[3] - d;
      this.pos.addScaledVector(g, pen * 0.9);
      const vn = this.vel.dot(g);
      if (vn < 0) { this.vel.addScaledVector(g, -vn * 1.35); hit = Math.max(hit, -vn); }
      // glance off: turn the bow away from the wall
      const side = g.dot(this.right);
      this.yawRate += -side * 0.35; this.pitch += g.y * 0.04;
    }
    if (hit > 0) {
      this.speed = Math.max(SLOW, this.vel.length() * 0.8);
      this.sync();
      if (hit > 6 && this.impact <= 0.01) { this.impact = Math.min(1, hit / 40); events && events.push({ type: 'crash', strength: this.impact, pos: this.pos.clone() }); }
    }
  }
  damage(n) {
    if (this.invuln > 0 || this.docked) return false;
    this.hull = Math.max(0, this.hull - n); this.hitFlash = 1;
    return true;
  }
  animate(dt) {
    const P = this.model.parts, R = this.rest;
    this.spin += dt * (8 + this.speed * 0.5);
    for (const k in P) {
      if (k.startsWith('Ship_Propeller') || k.startsWith('Air_Balloon_Propeller')) P[k].rotation.z = R[k].z + this.spin * (k.endsWith('_R') ? -1 : 1);
    }
    const rud = this.ctlX * 0.45, elev = this.ctlY * 0.35;
    if (P.Wing_Back) P.Wing_Back.rotation.y = R.Wing_Back.y + rud * 0.6;
    if (P.Wing_Bottom_01) P.Wing_Bottom_01.rotation.y = R.Wing_Bottom_01.y + rud * 0.5;
    for (const k of ['Tail_Wing_01_L', 'Tail_Wing_01_R', 'Tail_Wing_02_L', 'Tail_Wing_02_R']) if (P[k]) P[k].rotation.y = R[k].y + rud;
    for (const k of ['Wing_B_L', 'Wing_B_R', 'Wing_S_L', 'Wing_S_R']) if (P[k]) P[k].rotation.x = R[k].x + elev * (k.startsWith('Wing_B') ? 1 : 0.6) + this.ctlX * 0.2 * (k.endsWith('_L') ? 1 : -1);
    const flap = Math.sin(U.uTime.value * 1.3) * 0.03;
    if (P.Wing_L) P.Wing_L.rotation.y = R.Wing_L.y + rud * 0.35 + flap;
    if (P.Wing_R) P.Wing_R.rotation.y = R.Wing_R.y + rud * 0.35 - flap;
    if (P.ShipWheel) P.ShipWheel.rotation.z = R.ShipWheel.z - this.ctlX * 2.2;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.model.shared.uHit.value = this.hitFlash * 0.5;
    this.model.shared.uLamp.value = this.lamp;
  }
  spheresWorld() {
    if (!this._sw) this._sw = SPHERES.map((s) => ({ c: new THREE.Vector3(), r: s[3] }));
    SPHERES.forEach((s, i) => this._sw[i].c.set(s[0], s[1], s[2]).applyMatrix4(this.root.matrixWorld));
    return this._sw;
  }
  // world position of a point given in the ship's frame
  local(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.root.matrixWorld); }
}

// Chase camera: sits behind and above so the envelope stays out of the middle of the view, lags the turn a little,
// widens with speed and never passes through a wall.
export class ShipCam {
  constructor(camera) {
    this.camera = camera; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.fov = 62; this.shake = 0; this.roll = 0; this.kick = 0;
    this.shakeScale = 1; this.fovBias = 0; this.dist = 64; this.height = 21;
  }
  snap(s) { this.yaw = s.yaw; this.pitch = s.pitch; this.update(s, 1, {}, null, true); }
  update(s, dt, inp, world, snap = false) {
    const cam = this.camera, k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    let dy = s.yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k; this.pitch += (s.pitch - this.pitch) * k;
    const lookYaw = this.yaw - (inp.lookX || 0) * 1.5;
    const cy = Math.cos(lookYaw), sy = Math.sin(lookYaw);
    const dist = this.dist + s.boost * 10 - (inp.aimZoom || 0) * 14, h = this.height - this.pitch * 22 + (inp.lookY || 0) * 14;
    const desired = _v.set(s.pos.x - sy * dist, s.pos.y + h, s.pos.z - cy * dist);
    // keep the lens out of walls: pull in along the line from the ship
    if (world && world.sdf) {
      const o = s.pos, dx = desired.x - o.x, dyy = desired.y - (o.y + 12), dz = desired.z - o.z;
      let t = 1;
      for (let i = 4; i <= 10; i++) { const f = i / 10; if (world.sdf(o.x + dx * f, o.y + 12 + dyy * f, o.z + dz * f) < 5) { t = Math.max(0.35, (i - 1) / 10); break; } }
      if (t < 1) desired.set(o.x + dx * t, o.y + 12 + dyy * t, o.z + dz * t);
    }
    this.pos.lerp(desired, snap ? 1 : 1 - Math.exp(-dt * 5));
    const ahead = 120;
    this.look.set(s.pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * ahead, s.pos.y + 25 + Math.sin(this.pitch) * ahead * 0.8, s.pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * ahead);
    cam.position.copy(this.pos);
    if (this.shake > 0) {
      const a = this.shake * this.shakeScale;
      cam.position.x += (Math.random() - 0.5) * a; cam.position.y += (Math.random() - 0.5) * a; cam.position.z += (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    this.roll += (s.roll * 0.22 - this.roll) * (snap ? 1 : 1 - Math.exp(-dt * 3));
    cam.rotateZ(-this.roll);
    this.kick = Math.max(0, this.kick - dt * 5);
    const fovT = 60 + s.boost * 15 + (s.speed - CRUISE) * 0.05 + this.fovBias - (inp.aimZoom || 0) * 12 + this.kick * 2;
    this.fov += (fovT - this.fov) * (snap ? 1 : 1 - Math.exp(-dt * 4));
    cam.fov = this.fov; cam.updateProjectionMatrix();
  }
}
