// Stateless GPU particles: every position is a function of a per-particle seed and time, so tens of
// thousands cost one draw and no CPU work. Pollen and night spores drift around the camera; spray
// peels off the waterfalls.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';

const HASH = /* glsl */ `
vec4 hash41(float p){ vec4 p4 = fract(vec4(p) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }`;

// ------------------------------------------------------------------ ambient pollen and spores
const MOTE_VS = /* glsl */ `
attribute float aSeed;
uniform float uBox; uniform vec4 uIslA[3];
varying vec3 vCol; varying float vA; varying float vGlow;
${COMMON}
${HASH}
void main(){
  vec4 h = hash41(aSeed * 17.31 + 3.7);
  vec4 h2 = hash41(aSeed * 5.13 + 91.1);
  // drift with the wind, wobble on slow eddies, wrap inside a box that follows the camera
  vec3 drift = vec3(uWind.x, 0.12, uWind.y) * uTime * (1.2 + h2.x * 1.6);
  vec3 wob = vec3(sin(uTime * (0.3 + h2.y * 0.5) + h.x * 40.0), sin(uTime * (0.2 + h2.z * 0.4) + h.y * 30.0) * 0.6, cos(uTime * (0.25 + h2.w * 0.5) + h.z * 50.0)) * (1.5 + h2.x * 2.5);
  vec3 p = h.xyz * uBox + drift + wob;
  p = uCamPos + mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  // only near the islands: above their tops, thinning with distance
  float near = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 I = uIslA[i];
    float d = length(p.xz - I.xz) / (I.w * 1.6);
    near = max(near, smoothstep(1.0, 0.45, d) * smoothstep(I.y - 30.0, I.y - 5.0, p.y) * smoothstep(I.y + 90.0, I.y + 20.0, p.y));
  }
  float dist = length(p - uCamPos);
  float edge = smoothstep(uBox * 0.5, uBox * 0.3, dist) * smoothstep(0.6, 3.0, dist);
  vA = near * edge * step(h.w, 0.7 + 0.3 * uNight);
  vGlow = uNight;
  // pollen catches the sun, more when we look toward it; spores glow by themselves at night
  vec3 V = normalize(uCamPos - p);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  float sunVis = cloudShadowAt(p) * uSunVis;
  vec3 pollen = mix(vec3(1.0, 0.86, 0.55), vec3(0.95, 0.98, 0.8), h2.y) * (uSunColor * (0.3 + 2.2 * fwd) * sunVis + ambientLight(vec3(0.0, 1.0, 0.0)) * 0.5);
  vec3 spore = mix(vec3(0.15, 1.0, 0.7), vec3(0.6, 0.35, 1.0), h2.z) * (2.2 + 1.4 * sin(uTime * (1.0 + h2.w * 2.0) + h.x * 20.0));
  vCol = mix(pollen, spore, uNight);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = mix(0.07, 0.16, h2.x) * (1.0 + uNight * 0.5);
  gl_PointSize = clamp(sz * projectionMatrix[1][1] * 540.0 * uPxScale / max(-mv.z, 0.1), 2.2 * uPxScale, 12.0 * uPxScale);
  if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const MOTE_FS = /* glsl */ `
varying vec3 vCol; varying float vA; varying float vGlow;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (1.0 - d); a *= a;
  gl_FragColor = vec4(vCol * a * vA, 1.0);
}`;

export class Motes {
  constructor(scene, islands, count = 24000) {
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = i;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.islands = islands;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
      uniforms: { ...U, uBox: { value: 110 }, uIslA: { value: [0, 1, 2].map(() => new THREE.Vector4()) } },
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 3;
    scene.add(this.points);
    this.count = count;
  }
  setDensity(k) { this.points.geometry.setDrawRange(0, Math.round(this.count * k)); }
  update() {
    const cp = U.uCamPos.value, A = this.mat.uniforms.uIslA.value;
    const near = this.islands.slice().sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
    A.forEach((v, i) => { const I = near[i]; if (I) v.set(I.pos.x, I.pos.y, I.pos.z, I.spec.radius); else v.set(0, -1e5, 0, 1); });
  }
}

// ------------------------------------------------------------------ waterfall spray
const SPRAY_VS = /* glsl */ `
attribute float aSeed;
uniform vec3 uLip; uniform vec3 uDir; uniform float uV0; uniform float uWidth;
varying float vA; varying vec3 vCol; varying float vSoft;
${COMMON}
${HASH}
void main(){
  vec4 h = hash41(aSeed * 13.7 + 1.3);
  vec4 h2 = hash41(aSeed * 3.1 + 7.9);
  float life = 2.2 + h.w * 2.5;
  float age = fract(h.z + uTime / life) * life;
  // leaves the sheet somewhere along its first seconds of fall, drifts out and slows, sinks
  float t0 = h.x * h.x * 3.4;
  vec3 side = vec3(-uDir.z, 0.0, uDir.x);
  vec3 start = uLip + uDir * uV0 * t0 + vec3(0.0, -4.9 * t0 * t0, 0.0) + side * (h.y - 0.5) * uWidth * 1.4;
  vec3 vel = (side * (h2.x - 0.5) * 2.0 + uDir * (0.3 + h2.y)) * (2.0 + t0 * 1.5) + vec3(0.0, -9.8 * t0 * 0.6, 0.0);
  float drag = (1.0 - exp(-age * 0.9)) / 0.9;
  vec3 wp = (modelMatrix * vec4(start + vel * drag + vec3(0.0, -1.2 * age, 0.0), 1.0)).xyz;
  wp.xz += uWind * age * 1.5;
  float fadeIn = smoothstep(0.0, 0.4, age), fadeOut = 1.0 - smoothstep(life * 0.5, life, age);
  vA = fadeIn * fadeOut * (0.25 + 0.5 * h2.z);
  vec3 V = normalize(uCamPos - wp);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  vCol = vec3(0.93, 0.96, 1.0) * (uSunColor * (0.35 + 1.2 * fwd) * uSunVis * cloudShadowAt(wp) + ambientLight(vec3(0.0, 1.0, 0.0)) * 0.9) + vec3(0.2, 0.7, 0.8) * uNight * 0.15;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = (0.5 + age * 0.9) * (0.6 + h2.w * 0.8);
  gl_PointSize = clamp(sz * projectionMatrix[1][1] * 540.0 * uPxScale / max(-mv.z, 0.1), 1.0, 64.0 * uPxScale);
  vA *= smoothstep(400.0, 150.0, -mv.z);
}`;
const SPRAY_FS = /* glsl */ `
varying float vA; varying vec3 vCol;
${COMMON}
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (1.0 - d) * vA;
  gl_FragColor = vec4(vCol, a * a * 0.9);
}`;

export function makeSpray(f, count = 1400) {
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = i + f.lip[0] * 31.7;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPRAY_VS, fragmentShader: SPRAY_FS,
    uniforms: {
      ...U, uLip: { value: new THREE.Vector3(...f.lip) }, uDir: { value: new THREE.Vector3(f.dir[0], 0, f.dir[2]).normalize() },
      uV0: { value: f.fromPool ? 4.2 : 2.2 }, uWidth: { value: f.width },
    },
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 3;
  return pts;
}
