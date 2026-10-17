// Sculpted creature parts from Blender (heads, whale fins and flukes, bloom petals), drawn instanced and
// fitted to the procedural bodies each frame. Baked: normal + AO + colour/glow masks; skin from the library.
import * as THREE from 'three';
import { InstHistory } from './velocity.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import partsB64 from './assets/parts.glb';
import ANCHORS from './assets/parts_anchors.json';
import { U, COMMON } from './glsl.js';
import { SKIN_GLSL } from './skins.js';

export { ANCHORS };
function b64ToBuffer(b64) { const bin = atob(b64); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o.buffer; }

export function loadParts() {
  return new Promise((resolve) => {
    new GLTFLoader().parse(b64ToBuffer(partsB64), '', (gltf) => {
      const geos = {}; let mat = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        if (g.attributes.uv && g.index && !g.attributes.tangent) g.computeTangents();
        g.computeBoundingSphere();
        geos[o.name] = g;
        if (o.material && o.material.normalMap) mat = o.material;
      });
      const tex = { n: mat.normalMap, d: mat.roughnessMap || mat.metalnessMap };
      for (const t of Object.values(tex)) { t.anisotropy = 8; t.needsUpdate = true; }
      resolve({ geos, tex });
    }, (e) => { console.warn('creature parts unavailable', e); resolve(null); });
  });
}

const P_VS = /* glsl */ `
attribute vec4 tangent; attribute vec3 aColB; attribute vec4 aParams; attribute vec4 aSkinI;
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying vec3 vLocal; varying vec3 vLN;
varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying vec4 vSkin; varying vec3 vR0; varying vec3 vR1; varying vec3 vR2;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vUv = uv; vLocal = position; vLN = normal;
  mat3 m = mat3(modelMatrix) * mat3(instanceMatrix);
  vR0 = normalize(m[0]); vR1 = normalize(m[1]); vR2 = normalize(m[2]);
  float det = sign(dot(cross(m[0], m[1]), m[2]));
  vN = normalize(m * normal) * 1.0; vT = normalize(m * tangent.xyz); vTs = tangent.w * det;
  vColA = instanceColor; vColB = aColB; vParams = aParams; vSkin = aSkinI;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const P_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying vec3 vLocal; varying vec3 vLN;
varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying vec4 vSkin; varying vec3 vR0; varying vec3 vR1; varying vec3 vR2;
uniform sampler2D tN, tD; uniform float uThin;
${COMMON}
${SKIN_GLSL}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  bool back = !gl_FrontFacing;
  if (back) N = -N;
  vec3 tt = vT - N * dot(N, vT);
  vec3 Tg = dot(tt, tt) > 1e-8 ? normalize(tt) : normalize(cross(N, vec3(0.0, 1.0, 0.3)));
  vec3 B = cross(N, Tg) * vTs;
  vec3 tn = texture(tN, vUv).xyz * 2.0 - 1.0;
  vec3 n = normalize(Tg * tn.x + B * tn.y + N * tn.z);
  vec4 d = texture(tD, vUv);
  float ao = d.r, m1 = d.g, m2 = d.b;
  vec3 alb = mix(vColA, vColB * 1.05, m1);
  float occ = ao, skinAmt = 0.0;
  if (uSkinOn > 0.5 && vSkin.z > 0.0) {
    // the body's skin, projected from three sides in the part's own space
    skinAmt = vSkin.z * (1.0 - smoothstep(120.0, 420.0, length(uCamPos - vWorld)));
    vec3 ln = normalize(vLN); vec3 w = pow(abs(ln), vec3(4.0)); w /= w.x + w.y + w.z;
    vec3 p = vLocal * vSkin.y;
    Skin sx = skinSample(p.zy, vSkin.x, dFdx(p.zy), dFdy(p.zy));
    Skin sy = skinSample(p.xz, vSkin.x, dFdx(p.xz), dFdy(p.xz));
    Skin sz = skinSample(p.xy, vSkin.x, dFdx(p.xy), dFdy(p.xy));
    vec3 pert = vec3(0.0, sx.dn.y, sx.dn.x) * w.x + vec3(sy.dn.x, 0.0, sy.dn.y) * w.y + vec3(sz.dn.x, sz.dn.y, 0.0) * w.z;
    vec3 pw = mat3(vR0, vR1, vR2) * pert;
    n = normalize(n + pw * skinAmt * (back ? -1.0 : 1.0));
    float tone = sx.tone * w.x + sy.tone * w.y + sz.tone * w.z;
    float sm1 = sx.m1 * w.x + sy.m1 * w.y + sz.m1 * w.z;
    alb = mix(alb, mix(alb, vColB * 1.1, 0.6), sm1 * skinAmt * 0.6);
    alb *= mix(1.0, tone * 1.18, skinAmt);
    occ *= mix(1.0, 0.75 + 0.25 * tone, skinAmt);
  }
  vec3 col = litSurface(alb, n, vWorld, vParams.w, occ, 0.4);
  if (skinAmt > 0.0) col += skinSpec(n, vWorld, vSkin.x, skinAmt, vParams.w);
  col += alb * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.15 * (1.0 - abs(dot(n, V)));
  col += thinTransmission(alb, n, V, vWorld, vParams.w, uThin * 0.8);
  float glow = vParams.z * (0.03 + 1.8 * m2) * (1.0 + vParams.x) * (1.0 + uNight * 2.2);
  col += vColB * glow * 1.8;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

const _m = new THREE.Matrix4(), _s = new THREE.Vector3();
export class MeshPool {
  constructor(scene, geo, tex, max, { thin = false } = {}) {
    this.max = max;
    const g = geo.clone();
    const mk = (k) => new THREE.InstancedBufferAttribute(new Float32Array(max * k), k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aColB', mk(3)); g.setAttribute('aParams', mk(4)); g.setAttribute('aSkinI', mk(4));
    const mat = new THREE.ShaderMaterial({ vertexShader: P_VS, fragmentShader: P_FS, side: THREE.DoubleSide,
      uniforms: { ...U, tN: { value: tex.n }, tD: { value: tex.d }, uThin: { value: thin ? 1 : 0 } } });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.a = g.attributes; this.n = 0; this.key = null;
    this.hist = new InstHistory(this.mesh, max);
  }
  begin() { this.hist.begin(this.n); this.n = 0; }
  // scale: number or Vector3 (negative x mirrors)
  add(p, q, scale, sp, sun = 1, boost = 0, glow = -1, skinTile = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    if (typeof scale === 'number') _s.set(scale, scale, scale); else _s.copy(scale);
    _m.compose(p, q, _s); _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    this.hist.record(i, this.key);
    const a = sp.colA, b = sp.colB;
    this.mesh.instanceColor.array.set([a.x, a.y, a.z], i * 3);
    this.a.aColB.array.set([b.x, b.y, b.z], i * 3);
    this.a.aParams.array.set([boost, 0, glow >= 0 ? glow : sp.genome.glow, sun], i * 4);
    const sk = sp.skin;
    const k = Math.abs(typeof scale === 'number' ? scale : scale.y);
    if (sk) this.a.aSkinI.array.set([sk[0], k / (skinTile || sk[1]), sk[2] ?? 1, 0], i * 4); else this.a.aSkinI.array[i * 4 + 2] = 0;
  }
  end() {
    this.mesh.count = this.n;
    this.hist.end(this.n);
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.a.aColB.needsUpdate = true; this.a.aParams.needsUpdate = true; this.a.aSkinI.needsUpdate = true;
  }
}
