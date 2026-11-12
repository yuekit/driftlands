// The cables: the Tall City reeling the islands in. Each is a long catenary tube that never draws thinner than a
// pen line, can go slack, and can be cut (the island end whips away and falls into the cloud).
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';
import { CASTER_LAYER } from './shadow.js';

const VS = /* glsl */ `
attribute vec3 aCentre; attribute vec2 aT;
uniform float uSlack; uniform float uCut; uniform float uLen; uniform float uRadius; uniform float uHatchK; uniform float uTime; uniform float uSeed;
varying vec3 vWorld; varying vec3 vN; varying float vT; varying float vFade; varying float vAng;
void main(){
  vec3 c = aCentre;
  float t = aT.x; vAng = aT.y;                                  // 0 at the city, 1 at the island
  float belly = sin(t * 3.14159);
  c.y -= uSlack * belly * uLen * 0.07;
  c.xz += vec2(sin(uTime * 0.31 + uSeed + t * 5.0), cos(uTime * 0.27 + uSeed * 1.7 + t * 4.0)) * belly * (1.5 + 6.0 * uSlack);
  // cut: the free end falls away, swinging from the city
  float k = uCut * uCut;
  c.y -= k * t * t * uLen * 0.75;
  c.xz += vec2(sin(uSeed), cos(uSeed)) * k * t * t * uLen * 0.12 * sin(uCut * 6.0);
  vec4 wp = modelMatrix * vec4(c, 1.0);
  float dist = length(cameraPosition - wp.xyz);
  float r = max(uRadius, dist * uHatchK * 1.3);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  wp.xyz += n * r;
  vWorld = wp.xyz; vN = n; vT = t; vFade = uRadius / r;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */ `
uniform float uCut; uniform float uLen; uniform vec3 uTint; uniform float uLive;
varying vec3 vWorld; varying vec3 vN; varying float vT; varying float vFade; varying float vAng;
${COMMON}
void main(){
  if (uCut > 0.0 && vT > 1.0 - uCut * 0.25) discard;
  vec3 n = normalize(vN);
  // six strands laid up in a slow twist, rust in the lay between them
  float lay = vAng * 6.0 + vT * uLen * 1.9;
  float strand = abs(sin(lay * 0.5));
  float near = vFade > 0.999 ? 1.0 - smoothstep(60.0, 260.0, length(uCamPos - vWorld)) : 0.0;
  vec3 alb = mix(vec3(0.10, 0.045, 0.03), vec3(0.085, 0.085, 0.095), smoothstep(0.15, 0.6, strand)) * uTint;
  alb = mix(vec3(0.07, 0.065, 0.07) * uTint, alb, near);
  float ao = mix(0.85, 0.35 + 0.65 * smoothstep(0.0, 0.5, strand), near);
  vec3 col = litSurfacePBR(alb * 0.5, n, vWorld, 1.0, ao, 0.3, 0.42, alb * 2.2 * (0.4 + 0.6 * strand));
  // a pulse of light runs down the cable while it is hauling
  float run = fract(vT * uLen / 420.0 + uTime * 0.35);
  col += vec3(3.0, 0.5, 0.2) * smoothstep(0.93, 1.0, run) * uLive * (1.0 - uCut);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  // far away the tube is drawn wider than it is: thin it out to a faint line rather than a rope
  if (vFade < 0.999) { float keep = clamp(vFade * 2.2, 0.0, 1.0); if (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) > keep) discard; }
}`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class Cable {
  constructor(scene, from, to, opts = {}) {
    const N = opts.segs ?? 120, R = 8, sag = opts.sag ?? 0.045;
    this.from = from.clone(); this.to = to.clone(); this.len = from.distanceTo(to);
    const pos = [], cen = [], nor = [], ts = [], idx = [];
    const dir = _a.copy(to).sub(from).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const c = _b.copy(from).lerp(to, t); c.y -= Math.sin(t * Math.PI) * this.len * sag;
      for (let j = 0; j <= R; j++) {            // the seam is doubled so the strand angle runs a clean 0..2 pi
        const a = j / R * Math.PI * 2, n = new THREE.Vector3().addScaledVector(side, Math.cos(a)).addScaledVector(up, Math.sin(a));
        pos.push(c.x, c.y, c.z); cen.push(c.x, c.y, c.z); nor.push(n.x, n.y, n.z); ts.push(t, a);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j, b = a + 1, c = a + R + 1, d = b + R + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCentre', new THREE.Float32BufferAttribute(cen, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 2)); g.setIndex(idx);
    this.u = { uSlack: { value: 0 }, uCut: { value: 0 }, uLen: { value: this.len }, uRadius: { value: opts.radius ?? 1.1 }, uSeed: { value: Math.random() * 20 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uLive: { value: 1 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...U, ...this.u } }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cut = 0; this.cutting = false; this.slack = 0; this.slackGoal = 0; this.sag = sag;
  }
  // a point along the hanging cable (t: 0 city .. 1 island)
  at(t, out = new THREE.Vector3()) { out.copy(this.from).lerp(this.to, t); out.y -= Math.sin(t * Math.PI) * this.len * (this.sag + this.slack * 0.07); return out; }
  sever() { this.cutting = true; this.u.uLive.value = 0; }
  hide() { this.cut = 1; this.cutting = true; this.u.uCut.value = 1; this.u.uLive.value = 0; this.mesh.visible = false; }
  update(dt) {
    if (this.cutting && this.cut < 1) { this.cut = Math.min(1, this.cut + dt / 9); this.u.uCut.value = this.cut; if (this.cut >= 1) this.mesh.visible = false; }
    this.slack += (this.slackGoal - this.slack) * Math.min(1, dt * 0.5); this.u.uSlack.value = this.slack;
  }
  reset() { this.cut = 0; this.cutting = false; this.slack = 0; this.slackGoal = 0; this.u.uCut.value = 0; this.u.uSlack.value = 0; this.u.uLive.value = 1; this.mesh.visible = true; }
}
