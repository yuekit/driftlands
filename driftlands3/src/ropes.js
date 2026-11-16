// Ropes: the Weavers' lines. A rope hangs in a catenary between two points that may both be moving (a house riding the
// wind, the ship carrying an end), never draws thinner than a pen line, and can carry paper lanterns along its length.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';

const VS = /* glsl */ `
attribute vec2 aT;
uniform vec3 uA; uniform vec3 uB; uniform float uSag; uniform float uRadius; uniform float uHatchK; uniform float uSeed; uniform float uSway; uniform float uTime;
varying vec3 vWorld; varying vec3 vN; varying float vT; varying float vFade; varying float vAng; varying float vLen;
vec3 centre(float t){
  vec3 c = mix(uA, uB, t); float len = distance(uA, uB), belly = sin(t * 3.14159);
  c.y -= belly * len * uSag;
  c.xz += vec2(sin(uTime * 0.41 + uSeed + t * 5.0), cos(uTime * 0.33 + uSeed * 1.7 + t * 4.0)) * belly * uSway;
  return c;
}
void main(){
  float t = aT.x; vAng = aT.y; vT = t; vLen = distance(uA, uB);
  vec3 c = centre(t), d = normalize(centre(t + 0.004) - centre(t - 0.004));
  vec3 side = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0)), up = cross(side, d);
  vec3 n = side * cos(aT.y) + up * sin(aT.y);
  float dist = length(cameraPosition - c);
  float r = max(uRadius, dist * uHatchK * 1.2);
  vWorld = c + n * r; vN = n; vFade = uRadius / r;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
const FS = /* glsl */ `
uniform vec3 uTint; uniform vec3 uDye; uniform float uShow;
varying vec3 vWorld; varying vec3 vN; varying float vT; varying float vFade; varying float vAng; varying float vLen;
${COMMON}
void main(){
  if (vT > uShow) discard;
  vec3 n = normalize(vN);
  // three strands laid up, with a dyed yarn marking every few fathoms
  float lay = vAng * 3.0 + vT * vLen * 2.6;
  float strand = abs(sin(lay * 0.5));
  float near = vFade > 0.999 ? 1.0 - smoothstep(50.0, 220.0, length(uCamPos - vWorld)) : 0.0;
  float mark = smoothstep(0.82, 0.9, fract(vT * vLen / 14.0));
  vec3 alb = mix(uTint, uDye, mark) * mix(1.0, 0.55 + 0.45 * strand, near);
  vec3 col = litSurfacePBR(alb, n, vWorld, 1.0, mix(0.9, 0.5 + 0.5 * strand, near), 0.4, 0.85, vec3(0.03));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  if (vFade < 0.999) { float keep = clamp(vFade * 2.4, 0.0, 1.0); if (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) > keep) discard; }
}`;

let GEO = null;
function ropeGeo(N = 96, R = 6) {
  if (GEO) return GEO;
  const ts = [], idx = [], pos = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= R; j++) { ts.push(i / N, j / R * Math.PI * 2); pos.push(0, 0, 0); }
  for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j, b = a + 1, c = a + R + 1, d = b + R + 1; idx.push(a, c, b, b, c, d); }
  GEO = new THREE.BufferGeometry();
  GEO.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); GEO.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 2)); GEO.setIndex(idx);
  return GEO;
}

const _v = new THREE.Vector3();
export class Rope {
  // opts: radius, sag (fraction of the span), sway (metres), tint, dye, lanterns (how many hang from it)
  constructor(scene, opts = {}) {
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
    this.sag = opts.sag ?? 0.06; this.lanterns = opts.lanterns ?? 0; this.lit = 0; this.litGoal = 0; this.show = 1; this.seed = Math.random() * 20;
    this.u = { uA: { value: this.a }, uB: { value: this.b }, uSag: { value: this.sag }, uRadius: { value: opts.radius ?? 0.45 }, uSeed: { value: this.seed }, uSway: { value: opts.sway ?? 1.2 },
      uTint: { value: new THREE.Vector3(...(opts.tint || [0.62, 0.5, 0.32])) }, uDye: { value: new THREE.Vector3(...(opts.dye || [0.75, 0.16, 0.1])) }, uShow: { value: 1 } };
    this.mesh = new THREE.Mesh(ropeGeo(), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...U, ...this.u } }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh); this.scene = scene;
  }
  set(a, b) { this.a.copy(a); this.b.copy(b); return this; }
  get length() { return this.a.distanceTo(this.b); }
  at(t, out = new THREE.Vector3()) {
    const len = this.a.distanceTo(this.b), belly = Math.sin(t * Math.PI), T = U.uTime.value, sw = this.u.uSway.value;
    out.copy(this.a).lerp(this.b, t); out.y -= belly * len * this.sag;
    out.x += Math.sin(T * 0.41 + this.seed + t * 5) * belly * sw; out.z += Math.cos(T * 0.33 + this.seed * 1.7 + t * 4) * belly * sw;
    return out;
  }
  // lanterns as points of light (and, close to, a little paper body drawn by the glow itself)
  update(dt, fx, cam, lampK) {
    this.lit += (this.litGoal - this.lit) * Math.min(1, dt * 0.7);
    this.u.uSag.value = this.sag; this.u.uShow.value = this.show;
    if (!this.lanterns || !this.mesh.visible || !fx) return;
    const mid = this.at(0.5, _v), d = cam.distanceTo(mid), len = this.length;
    if (d > 2600 + len) return;
    const n = d > 1400 ? Math.ceil(this.lanterns / 3) : this.lanterns;
    const k = 0.25 + 0.75 * lampK, L = this.lit;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; if (t > this.show) break;
      const p = this.at(t, _v); p.y -= 1.6;
      const fl = 0.85 + 0.15 * Math.sin(U.uTime.value * (1.3 + (i % 5) * 0.21) + i * 2.1 + this.seed);
      // unlit, a lantern is a pale paper dot; lit, it glows the Weavers' orange
      fx.glow(p, 1.3 + 2.4 * L * k, [0.22 + 5.4 * L * k * fl, 0.19 + 2.7 * L * k * fl, 0.15 + 0.75 * L * k * fl], 0.0006 + 0.0017 * L * k);
    }
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.material.dispose(); }
}
