// Effects drawn over the finished picture: particles (fire, smoke, sparks, rings), bolts, glows; plus the moving
// point lights and the shock rings that bend the image. See the note above FXU in post.js.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';
import { FXU, FX_DEPTH } from './post.js';

const PREMULT = { transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };

const P_VS = /* glsl */ `
attribute vec4 aP; attribute vec4 aV; attribute vec4 aS; attribute vec4 aC; attribute vec2 aK;
uniform float uTime; uniform vec2 uWind; uniform vec3 uSunDir;
varying vec2 vQ; varying vec4 vC; varying float vT; varying float vType; varying float vSeed; varying vec3 vWorld; varying vec3 vSunV;
void main(){
  float age = uTime - aP.w, life = aV.w, t = age / max(life, 1e-4), type = aK.x;
  if (t < 0.0 || t >= 1.0 || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float dr = aS.z;
  float k = dr > 1e-3 ? (1.0 - exp(-dr * age)) / dr : age;
  vec3 p = aP.xyz + aV.xyz * k; p.y -= aS.w * age * age * 0.5;
  if (type == 1.0) p.xz += uWind * age * 2.5;
  vec3 vel = aV.xyz * exp(-dr * age); vel.y -= aS.w * age;
  float size = mix(aS.x, aS.y, type == 1.0 ? 1.0 - (1.0 - t) * (1.0 - t) : t);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 q = position.xy;
  if (type == 2.0) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = normalize(vv.xy + 1e-5);
    float len = size + length(vv.xy) * 0.04;
    mv.xy += d * q.x * len + vec2(-d.y, d.x) * q.y * size;
  } else {
    float a = aK.y * 6.2831 + (type == 1.0 ? age * (aK.y - 0.5) * 0.9 : 0.0);
    float c = cos(a), s = sin(a);
    mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
  }
  gl_Position = projectionMatrix * mv;
  vQ = q * 2.0; vC = aC; vT = t; vType = type; vSeed = aK.y; vWorld = p;
  vSunV = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
}`;
const P_FS = /* glsl */ `
varying vec2 vQ; varying vec4 vC; varying float vT; varying float vType; varying float vSeed; varying vec3 vWorld; varying vec3 vSunV;
${COMMON}
${FX_DEPTH}
void main(){
  float gap = fxGap();
  if (gap <= 0.0) discard;
  float soft = clamp(gap / 5.0, 0.0, 1.0);
  float r = length(vQ);
  if (vType == 1.0) {
    // smoke: a billowing puff, lit by the sky and the sun, still glowing from the fire when young
    float n = vnoise(vec3(vQ * 1.6 + vSeed * 37.0, vT * 1.8 + vSeed * 9.0)) * 0.65 + vnoise(vec3(vQ * 3.7 - vSeed * 11.0, vT * 2.6)) * 0.35;
    float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.9) * vC.a * smoothstep(0.0, 0.06, vT) * (1.0 - vT) * soft;
    if (a < 0.004) discard;
    vec3 nn = normalize(vec3(vQ, sqrt(max(1.0 - min(r * r, 1.0), 0.0)) + 0.25));
    float sun = clamp(dot(nn, vSunV) * 0.6 + 0.4, 0.0, 1.0);
    vec4 cv = cityVol(vWorld);
    vec3 col = vC.rgb * (ambientLight(vec3(0.0, 1.0, 0.0)) * (0.5 + 0.5 * cv.r) + uSunColor * sun * 0.45 * cv.g);
    col += pointLights(vWorld, nn, vC.rgb, 1.0) * 0.6;
    float heat = exp(-vT * 7.0);
    col += vec3(3.4, 1.1, 0.25) * heat * heat * (0.4 + 0.6 * n);
    col = applyFog(col, vWorld);
    gl_FragColor = vec4(col * a, a);
  } else if (vType == 2.0) {
    float a = smoothstep(1.0, 0.0, abs(vQ.y)) * smoothstep(1.0, 0.5, abs(vQ.x)) * (1.0 - vT * vT) * soft;
    gl_FragColor = vec4(vC.rgb * a * vC.a, 0.0);
  } else if (vType == 3.0) {
    float k = (r - 0.84) / 0.07; float a = exp(-k * k) * (1.0 - vT) * (1.0 - vT) * soft;
    gl_FragColor = vec4(vC.rgb * a * vC.a, 0.0);
  } else {
    float a = exp(-r * r * 3.2) * smoothstep(1.0, 0.6, r);
    float f = smoothstep(0.0, 0.04, vT) * (1.0 - vT);
    gl_FragColor = vec4(vC.rgb * a * f * f * vC.a * soft, 0.0);
  }
}`;

// bolts: a bright core in a coloured sheath, a ribbon turned to face the camera
const B_VS = /* glsl */ `
attribute vec4 aA; attribute vec4 aB; attribute vec3 aCol;
varying vec2 vQ; varying vec3 vCol;
void main(){
  vec3 dir = normalize(aB.xyz);
  vec3 c = aA.xyz + dir * position.x * aA.w;
  vec3 side = normalize(cross(dir, cameraPosition - c));
  float dist = length(cameraPosition - c);
  float w = max(aB.w, dist * 0.0018);            // never thinner than about two pixels
  vec4 mv = viewMatrix * vec4(c + side * position.y * w * 2.0, 1.0);
  gl_Position = projectionMatrix * mv;
  vQ = position.xy * 2.0; vCol = aCol;
}`;
const B_FS = /* glsl */ `
varying vec2 vQ; varying vec3 vCol;
${FX_DEPTH}
void main(){
  if (fxGap() <= 0.0) discard;
  float y = abs(vQ.y), x = vQ.x;
  float taper = smoothstep(-1.0, -0.2, x) * smoothstep(1.0, 0.75, x);
  float core = smoothstep(0.28, 0.0, y) * taper;
  float halo = exp(-y * y * 5.0) * taper;
  gl_FragColor = vec4(vCol * halo * 1.6 + vec3(1.0) * core * 6.0 * max(vCol.r, max(vCol.g, vCol.b)) * 0.4, 0.0);
}`;

// glows: one soft additive disc each, rebuilt every frame (drone eyes, exhausts, muzzle flashes, lamps)
const G_VS = /* glsl */ `
attribute vec4 aA; attribute vec4 aCol;
varying vec2 vQ; varying vec4 vCol;
void main(){
  vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
  float dist = -mv.z;
  mv.xy += position.xy * 2.0 * max(aA.w, dist * aCol.a);   // aCol.a: least size as a fraction of distance
  gl_Position = projectionMatrix * mv;
  vQ = position.xy * 2.0; vCol = aCol;
}`;
const G_FS = /* glsl */ `
varying vec2 vQ; varying vec4 vCol;
${FX_DEPTH}
void main(){
  float gap = fxGap();
  if (gap <= -1.5) discard;
  float r = length(vQ);
  float a = (exp(-r * r * 4.5) + 0.25 * exp(-r * r * 1.2)) * smoothstep(1.0, 0.7, r) * clamp((gap + 1.5) / 3.0, 0.0, 1.0);
  gl_FragColor = vec4(vCol.rgb * a, 0.0);
}`;

function quad() { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; }
function iattr(g, name, n, size) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; }

class Batch {
  constructor(scene, max, attrs, vs, fs, uniforms = {}) {
    this.max = max; this.n = 0;
    const g = quad(); this.a = {};
    for (const [name, size] of attrs) this.a[name] = iattr(g, name, max, size);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...FXU, ...uniforms }, ...PREMULT }));
    this.mesh.frustumCulled = false; g.instanceCount = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  end() { this.mesh.geometry.instanceCount = this.n; for (const k in this.a) { const a = this.a[k]; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize); a.needsUpdate = true; } }
}

const _v = new THREE.Vector3(), _c = new THREE.Vector3();
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

export class Fx {
  constructor(max = 7000) {
    this.scene = new THREE.Scene();
    this.max = max; this.head = 0; this.dirty = false;
    const g = quad();
    this.aP = iattr(g, 'aP', max, 4); this.aV = iattr(g, 'aV', max, 4); this.aS = iattr(g, 'aS', max, 4); this.aC = iattr(g, 'aC', max, 4); this.aK = iattr(g, 'aK', max, 2);
    g.instanceCount = max;
    this.pmesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: P_VS, fragmentShader: P_FS, uniforms: { ...U, ...FXU }, ...PREMULT }));
    this.pmesh.frustumCulled = false;
    this.scene.add(this.pmesh);
    this.bolts = new Batch(this.scene, 700, [['aA', 4], ['aB', 4], ['aCol', 3]], B_VS, B_FS);
    this.glows = new Batch(this.scene, 400, [['aA', 4], ['aCol', 4]], G_VS, G_FS);
    this.lights = []; this.shocks = [];
    this.density = 1;
  }
  // type: 0 glow, 1 smoke, 2 spark, 3 ring
  spawn(type, p, v, life, s0, s1, col, alpha = 1, drag = 0, grav = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max; this.dirty = true;
    this.aP.setXYZW(i, p.x, p.y, p.z, U.uTime.value); this.aV.setXYZW(i, v.x, v.y, v.z, life);
    this.aS.setXYZW(i, s0, s1, drag, grav); this.aC.setXYZW(i, col[0], col[1], col[2], alpha); this.aK.setXY(i, type, Math.random());
  }
  glow(p, size, col, minFrac = 0) {
    const b = this.glows; if (b.n >= b.max) return;
    b.a.aA.setXYZW(b.n, p.x, p.y, p.z, size); b.a.aCol.setXYZW(b.n, col[0], col[1], col[2], minFrac); b.n++;
  }
  bolt(p, dir, len, width, col) {
    const b = this.bolts; if (b.n >= b.max) return;
    b.a.aA.setXYZW(b.n, p.x, p.y, p.z, len); b.a.aB.setXYZW(b.n, dir.x, dir.y, dir.z, width); b.a.aCol.setXYZ(b.n, col[0], col[1], col[2]); b.n++;
  }
  light(p, col, radius, life) { const L = { p: p.clone(), col, radius, life, t: 0 }; this.lights.push(L); return L; }
  shock(p, maxR, life = 0.9, strength = 0.03) { this.shocks.push({ p: p.clone(), maxR, life, t: 0, strength }); }

  sparks(p, n, dir, speed, col = [3, 1.6, 0.6], spread = 0.6, life = 0.7) {
    n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      _v.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(spread);
      if (dir) _v.add(dir).normalize();
      _v.multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.spawn(2, p, _v, life * (0.5 + Math.random()), 0.22, 0.05, col, 1, 1.2, 14);
    }
  }
  smoke(p, v, size, life = 3, dark = 0.12, alpha = 0.7) { this.spawn(1, p, v, life, size * 0.45, size * 1.8, [dark, dark * 0.95, dark * 0.9], alpha, 0.9, -1.2); }
  // a burst: flash, fireball, sparks, a ring, rolling smoke, a light and a jolt of bent air
  explosion(p, s = 1, tint = [1, 0.55, 0.2], opts = {}) {
    const k = this.density;
    this.spawn(0, p, _v.set(0, 0, 0), 0.22, 6 * s, 26 * s, [9 * tint[0] + 3, 9 * tint[1] + 3, 9 * tint[2] + 3], 1);
    for (let i = 0; i < Math.ceil(9 * k); i++) {
      _v.set(rnd(), rnd() + 0.2, rnd()).normalize().multiplyScalar(s * (7 + Math.random() * 16));
      _c.copy(p).addScaledVector(_v, 0.05);
      this.spawn(0, _c, _v, 0.5 + Math.random() * 0.5, 5 * s, 10 * s, [5 * tint[0], 5 * tint[1], 5 * tint[2]], 0.8, 2.5, -2);
    }
    for (let i = 0; i < Math.ceil(11 * k); i++) {
      _v.set(rnd(), rnd() * 0.7 + 0.3, rnd()).normalize().multiplyScalar(s * (4 + Math.random() * 12));
      _c.copy(p).addScaledVector(_v, 0.1);
      this.smoke(_c, _v, s * (7 + Math.random() * 6), 2.2 + Math.random() * 2.2, 0.07 + Math.random() * 0.08, 0.75);
    }
    this.sparks(p, 26 * s, null, 34 * s + 18, [4 * tint[0] + 1, 3 * tint[1] + 0.6, 2 * tint[2] + 0.2], 1, 1.1);
    this.spawn(3, p, _v.set(0, 0, 0), 0.5, 4 * s, 46 * s, [2.5 * tint[0] + 0.5, 2.5 * tint[1] + 0.5, 2.5 * tint[2] + 0.5], 0.9);
    this.light(p, [34 * tint[0] + 6, 34 * tint[1] + 4, 34 * tint[2] + 2], 110 * s + 40, 0.55);
    if (!opts.quiet) this.shock(p, 0.05 + 0.04 * s, 0.6, 0.012 * s);
  }
  // per frame: decay lights into the shared uniforms, place shock rings on screen
  update(dt, camera, finalU) {
    if (this.dirty) { for (const a of [this.aP, this.aV, this.aS, this.aC, this.aK]) a.needsUpdate = true; this.dirty = false; }
    this.bolts.end(); this.glows.end();
    const L = this.lights;
    for (const l of L) l.t += dt;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].t >= L[i].life) L.splice(i, 1);
    const cp = camera.position;
    const score = (l) => { const f = l.life === Infinity ? 1 : 1 - l.t / l.life; return (l.col[0] + l.col[1] + l.col[2]) * f * f * l.radius / (60 + l.p.distanceTo(cp)); };
    if (L.length > 8) L.sort((a, b) => score(b) - score(a));
    for (let i = 0; i < 8; i++) {
      const l = L[i];
      if (!l) { U.uPLC.value[i].set(0, 0, 0); continue; }
      const f = l.life === Infinity ? (l.k ?? 1) : (1 - l.t / l.life) ** 2;
      U.uPL.value[i].set(l.p.x, l.p.y, l.p.z, l.radius); U.uPLC.value[i].set(l.col[0] * f, l.col[1] * f, l.col[2] * f);
    }
    const S = this.shocks;
    for (const s of S) s.t += dt;
    for (let i = S.length - 1; i >= 0; i--) if (S[i].t >= S[i].life) S.splice(i, 1);
    if (finalU) for (let i = 0; i < 4; i++) {
      const s = S[S.length - 1 - i], u = finalU.uShock.value[i];
      if (!s) { u.w = 0; continue; }
      _v.copy(s.p).project(camera);
      const dist = s.p.distanceTo(cp), f = s.t / s.life;
      const behind = _v.z > 1;
      // world radius to screen heights
      const px = s.maxR > 1 ? (s.maxR * f) / (dist * Math.tan(camera.fov * Math.PI / 360) * 2) : s.maxR * f * 10 * Math.min(1, 150 / Math.max(dist, 40));
      u.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, px, behind ? 0 : s.strength * (1 - f) * (s.maxR > 1 ? 1 : Math.min(1, 300 / Math.max(dist, 60))));
    }
  }
  clear() { for (let i = 0; i < this.max; i++) this.aV.setW(i, 0); this.dirty = true; this.lights.length = 0; this.shocks.length = 0; }
}
