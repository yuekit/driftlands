// The naturalist's glider: mesh, flight model, chase camera, trails.
import * as THREE from 'three';
import { U, COMMON, srgb } from './glsl.js';

const G_VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const G_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
uniform vec3 uColor; uniform float uPattern; uniform vec3 uC2; uniform vec3 uC3; uniform float uTrans;
${COMMON}
void main(){
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  vec3 alb = uColor;
  if (uPattern > 0.5) {
    float u = abs(vUv.x - 0.5) * 2.0; // 0 centre .. 1 tip
    float b = step(0.62, u) * step(u, 0.78);
    float b2 = step(0.86, u);
    alb = mix(uColor, uC2, b);
    alb = mix(alb, uC3, b2);
    alb *= 0.92 + 0.08 * step(0.5, fract(vUv.y * 6.0));
    alb = mix(alb, uC3, step(0.95, vUv.y) * 0.8);
  }
  vec3 col = litSurface(alb, n, vWorld, 1.0, 1.0, 0.3);
  // translucency: sunlight through fabric
  float through = max(dot(-V, uSunDir), 0.0);
  col += alb * uSunColor * pow(through, 2.0) * uTrans;
  gl_FragColor = vec4(col, 1.0);
}`;

function gmat(color, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: G_VS, fragmentShader: G_FS, side: THREE.DoubleSide,
    uniforms: { ...U, uColor: { value: srgb(color) }, uPattern: { value: opts.pattern ? 1 : 0 }, uC2: { value: srgb(opts.c2 || color) }, uC3: { value: srgb(opts.c3 || color) }, uTrans: { value: opts.trans || 0 } },
  });
}

function wingGeometry() {
  // parametric delta wing; u across span (0..1), v chord (0 leading .. 1 trailing)
  const NU = 28, NV = 8;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = j / NV;
    const s = (u - 0.5) * 2; // -1..1
    const as = Math.abs(s);
    const lead = 2.3 - as * 3.7;          // z of leading edge
    const trail = -0.9 - as * 0.7 + Math.sin(as * Math.PI * 3) * 0.12 * as; // scalloped trailing edge
    const z = lead + (trail - lead) * v;
    const x = s * 5.2 * (1 - v * 0.04);
    const camber = Math.sin(v * Math.PI) * 0.28 * (1 - as * 0.6);
    const dihedral = as * 0.35 - as * as * 0.15;
    const billow = Math.sin(v * Math.PI) * Math.sin(as * Math.PI) * 0.12;
    pos.push(x, camber + dihedral + billow, z);
    uv.push(u, v);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

class Trail {
  constructor(scene, n = 48, width = 0.35, color = [1, 0.95, 0.9]) {
    this.n = n; this.pts = []; this.width = width;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; uniform vec3 uC; void main(){ gl_FragColor = vec4(uC, vA); }`,
      uniforms: { uC: { value: new THREE.Vector3(...color) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(p, side, strength) {
    this.pts.unshift({ p: p.clone(), s: side.clone(), a: strength });
    if (this.pts.length > this.n) this.pts.pop();
    for (let i = 0; i < this.n; i++) {
      const it = this.pts[Math.min(i, this.pts.length - 1)];
      const f = 1 - i / this.n;
      const w = this.width * f;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3, sg = k ? 1 : -1;
        this.pos[o] = it.p.x + it.s.x * w * sg; this.pos[o + 1] = it.p.y + it.s.y * w * sg; this.pos[o + 2] = it.p.z + it.s.z * w * sg;
        this.alpha[i * 2 + k] = i < this.pts.length ? it.a * f * f : 0;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aA.needsUpdate = true;
  }
}

export class Glider {
  constructor(scene) {
    this.root = new THREE.Group();
    this.scarfAnchor = new THREE.Vector3(0, 0.3, 0.4);
    this.tipL = new THREE.Vector3(-5.1, 1.95, -1.5); this.tipR = new THREE.Vector3(5.1, 1.95, -1.5);
    this.body = new THREE.Group();
    this.root.add(this.body);
    const wing = new THREE.Mesh(wingGeometry(), gmat('#f0e2c4', { pattern: true, c2: '#c4553a', c3: '#2f6f73', trans: 0.55 }));
    wing.position.y = 1.6;
    this.wing = wing;
    this.body.add(wing);
    const frame = gmat('#2a2230');
    // keel + crossbar + control frame
    this.body.add(tube([0, 1.75, 2.4], [0, 1.85, -1.4], 0.06, frame));
    this.body.add(tube([-4.6, 1.95, -0.6], [4.6, 1.95, -0.6], 0.05, frame));
    this.body.add(tube([0, 1.7, 0.2], [-0.85, -0.25, 0.55], 0.04, frame));
    this.body.add(tube([0, 1.7, 0.2], [0.85, -0.25, 0.55], 0.04, frame));
    this.body.add(tube([-0.85, -0.25, 0.55], [0.85, -0.25, 0.55], 0.04, frame));
    // pilot (prone)
    const coat = gmat('#b9773d'), dark = gmat('#3b2f3a'), skin = gmat('#e2b48e'), hat = gmat('#5b7f6a'), bag = gmat('#7a4b33');
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.0, 6, 10), coat);
    torso.rotation.x = Math.PI / 2; torso.position.set(0, 0.25, -0.25);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 6, 8), dark);
    legs.rotation.x = Math.PI / 2; legs.position.set(0, 0.3, -1.25);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), skin); head.position.set(0, 0.36, 0.55);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), hat); brim.position.set(0, 0.5, 0.55); brim.rotation.x = -0.5;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat); crown.position.set(0, 0.5, 0.55); crown.rotation.x = -0.5;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.6), bag); pack.position.set(0, 0.6, -0.3);
    this.body.add(torso, legs, head, brim, crown, pack);
    this.body.add(tube([-0.25, 0.25, 0.25], [-0.75, -0.2, 0.55], 0.07, coat));
    this.body.add(tube([0.25, 0.25, 0.25], [0.75, -0.2, 0.55], 0.07, coat));
    this.body.add(tube([0, 0.55, -0.1], [0, 1.7, 0.0], 0.025, frame));
    this.head = head;
    // pilot's lamp, lit after dark
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.lampMat);
    lamp.position.set(0, -0.2, 0.62);
    this.body.add(lamp);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.position.copy(lamp.position); this.body.add(halo); this.halo = halo;
    // scarf ribbon
    this.scarfN = 12;
    this.scarf = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    this.scarfPrev = this.scarf.map((v) => v.clone());
    const sg = new THREE.BufferGeometry();
    this.scarfPos = new Float32Array(this.scarfN * 2 * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.scarfPos, 3));
    const sidx = []; for (let i = 0; i < this.scarfN - 1; i++) { const a = i * 2; sidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    sg.setIndex(sidx);
    const suv = []; for (let i = 0; i < this.scarfN; i++) suv.push(0, i / this.scarfN, 1, i / this.scarfN);
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
    sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.scarfN * 6).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.scarfMesh = new THREE.Mesh(sg, gmat('#d23c2c', { trans: 0.4 }));
    this.scarfMesh.frustumCulled = false;
    scene.add(this.scarfMesh);
    scene.add(this.root);

    this.trails = [new Trail(scene), new Trail(scene)];

    // flight state
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = -0.06; this.roll = 0; this.speed = 24;
    this.vel = new THREE.Vector3();
    this.climb = 0; this.lift = 0;
    this.perched = false; this.perchIsland = null; this.perchLocal = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.impact = 0;
    this.stall = 0;
    this.wingFlex = 0;
  }

  useModel(model) {
    // swap the code-built airframe for the Blender model; keep the dynamic scarf and trails
    this.procParts = this.body.children.slice();
    for (const c of this.procParts) c.visible = false;
    this.body.add(model.root);
    this.model = model;
    if (model.parts.HeadAnchor) this.head = model.parts.HeadAnchor;
    this.wing = new THREE.Object3D();              // the modelled sail does not flex
    this.scarfAnchor.set(0, 0.36, 0.46);
    const tail = model.parts.ScarfTailEnd;
    if (tail) {                                     // a modelled scarf drapes the back; the ribbon flies on from its end
      this.root.updateMatrixWorld(true);
      this.scarfAnchor.copy(tail.getWorldPosition(new THREE.Vector3())).applyMatrix4(this.root.matrixWorld.clone().invert());
      this.scarfW = 0.036; this.scarfSeg = 0.13;
    }
    this.tipL.set(-5.12, 1.92, -1.2); this.tipR.set(5.12, 1.92, -1.2);
    this.setNight(this.nightK || 0);
  }

  setNight(n) {
    this.nightK = n;
    if (this.model && this.model.mats.lamp) {
      const k = Math.max(0, (n - 0.15) / 0.85);
      this.model.mats.lamp.uniforms.uEmit.value.set(7 * k, 4.6 * k, 2.2 * k);
    }
    const k = Math.max(0, (n - 0.15) / 0.85);
    this.lampMat.color.setRGB(9 * k, 6.5 * k, 3.5 * k);
    this.halo.material.color.setRGB(0.5 * k, 0.35 * k, 0.18 * k);
  }

  place(p, yaw) {
    this.pos.copy(p); this.yaw = yaw; this.pitch = -0.06; this.roll = 0; this.speed = 26; this.perched = false;
    this.scarf.forEach((s) => s.copy(p)); this.scarfPrev.forEach((s) => s.copy(p));
  }

  update(dt, input, world, events) {
    const g = 9.8;
    if (this.perched) {
      // sit on the rock; steer to turn on the spot
      this.pos.copy(this.perchLocal).add(this.perchIsland.pos);
      this.yaw -= input.roll * dt * 1.2;
      this.pitch += (0.12 - this.pitch) * Math.min(1, dt * 3);
      this.roll += (0 - this.roll) * Math.min(1, dt * 3);
      this.speed = 0;
      if (input.launch) {
        this.perched = false; this.speed = 25; this.pitch = 0.08; this.pos.y += 2.0; this.boost = 13;
        events.push({ type: 'launch' });
      }
    } else {
      let tp = -0.06 + input.pitch * 0.6;
      if (this.speed < 14) { const s = (14 - this.speed) / 6; tp = Math.min(tp, -0.45 * s); this.stall = Math.min(1, s); } else this.stall = 0;
      this.pitch += (tp - this.pitch) * Math.min(1, dt * 2.0);
      const tr = input.roll * 0.98;
      // roll answers faster at speed; turbulence nudges the wings
      this.roll += (tr - this.roll) * Math.min(1, dt * (1.9 + this.speed * 0.035));
      this.roll += (this.turbRoll || 0) * dt;
      const yawRate = (g * Math.tan(this.roll)) / Math.max(this.speed, 9) * 1.45;
      this.yaw -= yawRate * dt;
      const drag = 0.00104 * this.speed * this.speed * (1 + 0.45 * Math.abs(Math.sin(this.roll)));
      this.speed += (-g * Math.sin(this.pitch) - drag) * dt;
      this.speed = Math.max(7, Math.min(78, this.speed));
      this.fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      this.lift = this.thermal = world.thermals.lift(this.pos);
      // ridge lift: wind meeting a cliff face is pushed upward along it
      this.ridge = this.ridgeLift(world);
      // turbulence: rough air at thermal edges, over ridges and in crosswinds (smooth, layered sines)
      const t = performance.now() * 0.001;
      const rough = Math.min(1.4, Math.abs(this.lift) * 0.22 + this.ridge * 0.25 + (world.gust || 0) * 0.9);
      const n1 = Math.sin(t * 2.3 + 1.7) * Math.sin(t * 0.91) + Math.sin(t * 5.7) * 0.35;
      const n2 = Math.sin(t * 1.7 + 0.3) * Math.sin(t * 3.1 + 2.2);
      this.turb = rough * n1 * 0.9;
      this.turbRoll = rough * n2 * 0.22;
      this.lift += this.ridge + this.turb;
      this.vel.copy(this.fwd).multiplyScalar(this.speed);
      this.boost = (this.boost || 0) * Math.exp(-dt * 0.8);
      this.vel.y += this.lift + this.boost;
      this.pos.addScaledVector(this.vel, dt);
      this.climb += ((this.vel.y) - this.climb) * Math.min(1, dt * 1.5);
      this.collide(world, events);
    }
    this.impact = Math.max(0, this.impact - dt * 2);
    this.fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));

    // pose
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = -this.pitch;
    this.root.rotation.z = this.roll;
    // wing flex with speed
    this.wingFlex += ((this.speed - 24) * 0.004 - this.wingFlex) * Math.min(1, dt * 3);
    this.wing.scale.set(1, 1 - this.wingFlex, 1);
    this.root.updateMatrixWorld();
    this.updateScarf(dt);
    // wing tip trails
    const speedK = Math.max(0, Math.min(1, (this.speed - 30) / 22)) + Math.min(1, Math.abs(this.roll) * 0.8) * 0.25;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const l = this.tipL.clone().applyMatrix4(this.root.matrixWorld);
    const r = this.tipR.clone().applyMatrix4(this.root.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
    this.trails[0].push(l, up, this.perched ? 0 : speedK * 0.7);
    this.trails[1].push(r, up, this.perched ? 0 : speedK * 0.7);
  }

  ridgeLift(world) {
    const W = this.windDir || (this.windDir = new THREE.Vector3(0.937, 0, 0.351));
    const k = world.ridgeK || 1;
    const p = this.pos;
    let best = 0;
    for (const isl of world.islands) {
      if (p.distanceToSquared(isl.pos) > 330 * 330) continue;
      // sample the rock just upwind-below the glider: that is the face the wind is climbing
      const qx = p.x - W.x * 18, qy = p.y - 14, qz = p.z - W.z * 18;
      const d = isl.sdfWorld(qx, qy, qz);
      if (d > 75 || d < 0) continue;
      const e = 1.5;
      const nx = isl.sdfWorld(qx + e, qy, qz) - isl.sdfWorld(qx - e, qy, qz);
      const ny = isl.sdfWorld(qx, qy + e, qz) - isl.sdfWorld(qx, qy - e, qz);
      const nz = isl.sdfWorld(qx, qy, qz + e) - isl.sdfWorld(qx, qy, qz - e);
      const l = Math.hypot(nx, ny, nz) || 1;
      const facing = Math.max(0, -(nx * W.x + nz * W.z) / l);   // the face looks into the wind
      const steep = 1 - Math.max(0, ny / l);                     // flat tops deflect nothing
      const near = Math.max(0, Math.min(1, (75 - d) / 55));
      best = Math.max(best, 3.4 * k * facing * steep * near * near);
    }
    return best;
  }

  collide(world, events) {
    const p = this.pos;
    for (const isl of world.islands) {
      if (p.distanceToSquared(isl.pos) > 300 * 300) continue;
      const d = isl.sdfWorld(p.x, p.y, p.z);
      const R = 2.4;
      if (d < R) {
        const e = 0.5;
        const n = new THREE.Vector3(
          isl.sdfWorld(p.x + e, p.y, p.z) - isl.sdfWorld(p.x - e, p.y, p.z),
          isl.sdfWorld(p.x, p.y + e, p.z) - isl.sdfWorld(p.x, p.y - e, p.z),
          isl.sdfWorld(p.x, p.y, p.z + e) - isl.sdfWorld(p.x, p.y, p.z - e)).normalize();
        if (n.y > 0.62 && this.speed < 36 && this.pitch > -0.5 && (this.boost || 0) < 2) {
          // gentle touchdown → perch
          p.addScaledVector(n, R - d - 0.6);
          this.perched = true; this.perchIsland = isl; this.perchLocal.copy(p).sub(isl.pos);
          this.speed = 0; this.roll = 0;
          events.push({ type: 'land', island: isl });
          return;
        }
        p.addScaledVector(n, R - d + 0.3);
        const v = this.fwd.clone();
        const vn = v.dot(n);
        if (vn < 0) v.addScaledVector(n, -1.7 * vn).normalize();
        this.yaw = Math.atan2(v.x, v.z);
        this.pitch = Math.asin(Math.max(-1, Math.min(1, v.y)));
        const hit = Math.min(1, Math.abs(vn) * this.speed / 30);
        this.speed *= 1 - 0.45 * Math.abs(vn);
        this.impact = Math.max(this.impact, hit);
        if (hit > 0.1) events.push({ type: 'bump', strength: hit });
      }
    }
    for (const it of world.rocks.items) {
      if (!it.world) continue;
      const rr = (it.radius || 6.5 * it.scale) + 2;
      const dv = p.clone().sub(it.world);
      const dist = dv.length();
      if (dist < rr) {
        const n = dv.normalize();
        p.copy(it.world).addScaledVector(n, rr + 0.2);
        const v = this.fwd.clone(); const vn = v.dot(n);
        if (vn < 0) v.addScaledVector(n, -1.7 * vn).normalize();
        this.yaw = Math.atan2(v.x, v.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, v.y)));
        this.speed *= 0.75; this.impact = 0.6; events.push({ type: 'bump', strength: 0.6 });
      }
    }
  }

  updateScarf(dt) {
    const anchor = this.scarfAnchor.clone().applyMatrix4(this.root.matrixWorld);
    const s = this.scarf, sp = this.scarfPrev;
    const seg = this.scarfSeg || 0.16;
    const wind = this.vel.clone().multiplyScalar(-1);
    if (this.perched) wind.set(0.8, 0, 0.3).multiplyScalar(4);
    s[0].copy(anchor);
    for (let i = 1; i < s.length; i++) {
      const cur = s[i].clone();
      const vel = s[i].clone().sub(sp[i]).multiplyScalar(0.9);
      s[i].add(vel).addScaledVector(wind, dt * dt * 0.9 * (0.6 + 0.4 * Math.sin(performance.now() * 0.02 + i)));
      s[i].y -= 9.8 * dt * dt * 0.3;
      sp[i].copy(cur);
    }
    for (let k = 0; k < 3; k++) for (let i = 1; i < s.length; i++) {
      const d = s[i].clone().sub(s[i - 1]); const l = d.length() || 1;
      s[i].copy(s[i - 1]).addScaledVector(d, seg / l);
    }
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    for (let i = 0; i < s.length; i++) {
      const w = (this.scarfW || 0.09) * (1 - i / s.length * 0.4);
      const o = i * 6;
      this.scarfPos[o] = s[i].x - side.x * w; this.scarfPos[o + 1] = s[i].y - side.y * w; this.scarfPos[o + 2] = s[i].z - side.z * w;
      this.scarfPos[o + 3] = s[i].x + side.x * w; this.scarfPos[o + 4] = s[i].y + side.y * w; this.scarfPos[o + 5] = s[i].z + side.z * w;
    }
    this.scarfMesh.geometry.attributes.position.needsUpdate = true;
    this.scarfMesh.geometry.computeBoundingSphere();
  }
}

// chase camera with lens mode
export class ChaseCam {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.lens = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.shake = 0;
    this.roll = 0;
    this.fov = 62;
    this.turn = 0; this.prevYaw = null;
    this.dip = 0; this.dipV = 0;
  }
  // a vertical jolt: positive drops the camera (landing), negative lifts it (hitting a thermal)
  bump(a) { this.dipV += a * 6; }
  snap(g) { this.update(g, 1, { aimX: 0, aimY: 0 }, true); }
  update(g, dt, input, snap = false) {
    const cam = this.camera;
    const yaw = g.yaw, pitch = g.pitch;
    // smoothed turn rate (rad/s), for the look-ahead
    if (this.prevYaw !== null && dt > 0 && !snap) {
      let dy = yaw - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.turn += (Math.max(-1.2, Math.min(1.2, dy / dt)) - this.turn) * (1 - Math.exp(-dt * 2.5));
    }
    this.prevYaw = yaw;
    if (g.perched) this.turn *= 0.9;
    const flat = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const k = snap ? 1 : 1 - Math.exp(-dt * 4.0);
    // lens free-look offsets
    const tYaw = this.lens > 0.01 ? -input.aimX * 1.45 : -(input.lookX || 0) * 1.6;
    const tPitch = this.lens > 0.01 ? input.aimY * 1.15 - 0.12 : (input.lookY || 0) * 0.5;
    const kl = snap ? 1 : 1 - Math.exp(-dt * 5);
    this.lookYaw += (tYaw - this.lookYaw) * kl;
    this.lookPitch += (tPitch - this.lookPitch) * kl;
    let desired, target;
    if (g.perched) {
      desired = g.pos.clone().addScaledVector(flat, -11).add(new THREE.Vector3(0, 5.5, 0));
      target = g.pos.clone().addScaledVector(flat, 25).add(new THREE.Vector3(0, 1, 0));
    } else {
      const back = 12 + Math.max(0, g.speed - 30) * 0.08;
      desired = g.pos.clone().addScaledVector(flat, -back).add(new THREE.Vector3(0, 7.4 - pitch * 6, 0));
      target = g.pos.clone().addScaledVector(g.fwd, 26).add(new THREE.Vector3(0, -0.2, 0));
      // look into the turn: lead the view toward where the glider is heading next
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      target.addScaledVector(side, this.turn * 15);
      desired.addScaledVector(side, -this.turn * 2.5);
    }
    // gamepad right stick: swing the chase camera around the glider
    if (this.lens < 0.01 && (Math.abs(this.lookYaw) > 1e-3 || Math.abs(this.lookPitch) > 1e-3)) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
      desired.sub(g.pos).applyQuaternion(q).add(g.pos); desired.y -= this.lookPitch * 10;
      target.sub(g.pos).applyQuaternion(q).add(g.pos); target.y += this.lookPitch * 20;
    }
    // lens: over-the-shoulder, aimed by free look
    if (this.lens > 0.001) {
      const head = g.head.getWorldPosition(new THREE.Vector3());
      const ly = yaw + this.lookYaw, lp = this.lookPitch;
      const dir = new THREE.Vector3(Math.sin(ly) * Math.cos(lp), Math.sin(lp), Math.cos(ly) * Math.cos(lp));
      const lensPos = head.clone().addScaledVector(dir, 1.2);
      const lensTarget = lensPos.clone().addScaledVector(dir, 50);
      desired.lerp(lensPos, this.lens);
      target.lerp(lensTarget, this.lens);
    }
    this.pos.lerp(desired, this.lens > 0.5 ? 1 - Math.exp(-dt * 9) : k);
    this.look.lerp(target, this.lens > 0.5 ? 1 - Math.exp(-dt * 12) : (snap ? 1 : 1 - Math.exp(-dt * 6)));
    cam.position.copy(this.pos);
    // springy vertical jolt
    this.dipV += (-this.dip * 40 - this.dipV * 9) * Math.min(dt, 0.05);
    this.dip += this.dipV * Math.min(dt, 0.05);
    cam.position.y -= this.dip;
    // stall buffet and rough air
    if (!g.perched) this.shake = Math.max(this.shake, g.stall * 0.22, Math.abs(g.turb || 0) * 0.05);
    g.root.visible = this.lens < 0.6; g.scarfMesh.visible = this.lens < 0.6;
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    this.roll += ((g.perched ? 0 : g.roll * 0.32) * (1 - this.lens) - this.roll) * (snap ? 1 : 1 - Math.exp(-dt * 3));
    cam.rotateZ(-this.roll);
    const fovT = g.perched ? 58 : Math.max(56, Math.min(84, 60 + (g.speed - 24) * 0.42));
    this.fov += (fovT * (1 - this.lens) + 28 * this.lens - this.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
