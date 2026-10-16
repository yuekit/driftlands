// Procedural creatures: one genome schema, an instanced part renderer, and seven species behaviours.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';
import { mulberry32 } from './noise.js';
import { TubeBatch } from './tubes.js';
import { InstHistory } from './velocity.js';
import { SKIN, SKIN_GLSL } from './skins.js';
import { MeshPool, ANCHORS } from './parts.js';

// ------------------------------------------------------------------ colour (OKLCH)
function oklchToLinear(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return new THREE.Vector3(
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s));
}
const mixHue = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };
export const oklchCss = (c) => `oklch(${(c[0] * 100).toFixed(1)}% ${c[1].toFixed(3)} ${c[2].toFixed(1)})`;

// ------------------------------------------------------------------ species genomes
// Every species is expressed in the same schema; the body planner reads it.
export const NIGHT_TAGS = new Set(['sleep', 'nightglow', 'nightrise', 'nightsong']);
export const SPECIES = [
  {
    id: 'stilt', behaviours: ['walk', 'graze', 'alert', 'sleep'],  plan: 'walker', island: 0, common: 'Verdigris stiltwalker',
    genome: { legs: 4, upper: 5.2, lower: 6.6, segs: 3, segR: 1.35, neck: 5.2, head: 0.95, tail: 2.2,
      colA: [0.86, 0.075, 62], colB: [0.48, 0.12, 300], pattern: 1, pscale: 1.6, glow: 0, speed: 2.2, count: 5 },
    size: 'about 11 m at the shoulder', hint: 'Something tall moves slowly across the Verdigris plateau.',
  },
  {
    id: 'polyp', behaviours: ['open', 'closing', 'nightglow'],  plan: 'sessile', island: 0, common: 'Bloom polyp',
    genome: { stalk: 10, petals: 8, petalLen: 5.4, head: 1.3,
      colA: [0.84, 0.10, 115], colB: [0.72, 0.16, 35], pattern: 3, pscale: 1, glow: 0.35, count: 26 },
    size: 'stalks 6–9 m, crown about 7 m across', hint: 'Flower-like shapes on the Verdigris rim seem to flinch.',
  },
  {
    id: 'kite', behaviours: ['flock', 'escort', 'nightglow'],  plan: 'flyer', island: 1, common: 'Ribbon kite',
    genome: { span: 5.6, body: 2.5, tail: 9, flap: 3.2,
      colA: [0.42, 0.15, 265], colB: [0.93, 0.05, 80], pattern: 3, pscale: 1, glow: 0.05, speed: 17, count: 14 },
    size: 'wingspan about 9 m, tail ribbon twice that', hint: 'A flock circles the Ochre Table. They are curious about gliders.',
  },
  {
    id: 'crawler', behaviours: ['crawl', 'arch', 'inverted', 'nightglow'],  plan: 'crawler', island: 1, common: 'Arch centipede',
    genome: { segs: 15, segLen: 2.3, segR: 1.6, leg: 2.6, antenna: 3.4,
      colA: [0.42, 0.16, 285], colB: [0.84, 0.15, 70], pattern: 2, pscale: 1.4, glow: 0.1, speed: 2.6, count: 6 },
    size: 'about 34 m long', hint: 'Something long and blue clings to the arches of the Ochre Table, even upside down.',
  },
  {
    id: 'lantern', behaviours: ['drift', 'flare', 'nightrise'],  plan: 'drifter', island: 2, common: 'Lantern drifter',
    genome: { bell: 3.0, tentacles: 7, tentLen: 9, colA: [0.70, 0.10, 225], colB: [0.70, 0.18, 345], pattern: 3, pscale: 1, glow: 0.3, count: 16 },
    size: 'bell about 5 m across, tentacles to 8 m', hint: 'Soft lights pulse in the air around the Coral Rookery.',
  },
  {
    id: 'whale', behaviours: ['circle', 'close', 'song', 'nightsong'],  plan: 'leviathan', island: 2, common: 'Rookery sky whale',
    genome: { segs: 14, length: 64, girth: 10.5, fin: 26, colA: [0.42, 0.07, 250], colB: [0.80, 0.06, 45], pattern: 3, pscale: 1, glow: 0.0, speed: 10, count: 1 },
    size: 'about 64 m long', hint: 'Something enormous circles above the Coral Rookery.',
  },
  {
    id: 'hybrid', behaviours: ['walk', 'graze', 'alert', 'seam', 'sleep'],  plan: 'walker', island: -1, common: 'Seam strider', hybrid: ['stilt', 'crawler'],
    genome: null,
    size: 'about 8 m tall, 12 m long', hint: 'Something new will walk where two islands meet.',
  },
];

// genome crossover: half from each parent, colours blended in OKLCH
export function crossover(a, b, seed) {
  const rnd = mulberry32(seed);
  const ga = a.genome, gb = b.genome;
  const mixc = (x, y, t) => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, mixHue(x[2], y[2], t)];
  return {
    legs: 6, upper: (ga.upper + gb.leg) * 0.55, lower: (ga.lower + gb.leg) * 0.6,
    segs: Math.round((ga.segs + gb.segs) * 0.28), segR: (ga.segR + gb.segR) * 0.5, neck: ga.neck * 0.5, head: ga.head * 0.9, tail: 4,
    colA: ((c) => [0.6, Math.min(c[1], 0.085), c[2]])(mixc(gb.colA, ga.colA, 0.35 + rnd() * 0.1)), colB: mixc(gb.colB, ga.colB, 0.4), pattern: gb.pattern, pscale: (ga.pscale + gb.pscale) * 0.5,
    glow: 0.15, speed: 1.9, count: 4, antenna: gb.antenna,
  };
}
SPECIES[6].genome = crossover(SPECIES[0], SPECIES[3], 77);

// latin binomial from genome traits
const ROOTS = { walker: ['Altipes', 'Gressor', 'Stelocaulis'], sessile: ['Anthopolyp', 'Florimedusa', 'Calyx'], flyer: ['Taeniopteryx', 'Aeroraja', 'Vexillum'],
  crawler: ['Arcuscolex', 'Fornicipes', 'Lithoscolex'], drifter: ['Lucernula', 'Nubimedusa', 'Pharomedusa'], leviathan: ['Nubicetus', 'Aerobalaena', 'Caelocetus'] };
const EPITHETS = ['verdigris', 'ochracea', 'corallina', 'pellucida', 'longipes', 'vagans', 'serena', 'aurantia', 'caerulea', 'pulsans', 'migrans', 'hybrida'];
for (const sp of SPECIES) {
  const r = mulberry32(sp.id.length * 131 + sp.id.charCodeAt(0));
  const roots = ROOTS[sp.plan];
  const genus = roots[Math.floor(r() * roots.length)];
  let ep;
  if (sp.id === 'stilt') ep = 'verdigris';
  else if (sp.id === 'hybrid') ep = 'hybrida';
  else if (sp.id === 'kite') ep = 'ochracea';
  else if (sp.id === 'crawler') ep = 'caerulea';
  else if (sp.id === 'lantern') ep = 'pulsans';
  else if (sp.id === 'whale') ep = 'serena';
  else ep = 'pellucida';
  sp.latin = `${genus} ${ep}`;
  sp.colA = oklchToLinear(...sp.genome.colA);
  sp.colB = oklchToLinear(...sp.genome.colB);
}
// skins from the Blender library: [layer, tile size in metres, strength]
const SKINS = {
  stilt: { skin: [SKIN.pebble, 2.2, 1.0], legs: [SKIN.hide, 1.1, 0.9], fin: [SKIN.membrane, 1.4, 0.8] },
  hybrid: { skin: [SKIN.chitin, 2.4, 1.0], legs: [SKIN.chitin, 1.3, 0.9], fin: [SKIN.membrane, 1.4, 0.8] },
  polyp: { skin: [SKIN.plant, 1.6, 0.9], fin: [SKIN.membrane, 1.8, 0.9] },
  kite: { skin: [SKIN.hide, 1.2, 0.6], wing: [SKIN.membrane, 2.4, 0.65] },
  crawler: { skin: [SKIN.chitin, 1.9, 1.0], legs: [SKIN.chitin, 0.8, 0.8] },
  lantern: { skin: [SKIN.jelly, 3.2, 0.9] },
  whale: { skin: [SKIN.hide, 5.5, 1.0], fin: [SKIN.hide, 3.0, 0.9] },
};
for (const sp of SPECIES) { const k = SKINS[sp.id]; if (k) { sp.skin = k.skin; sp.partSkin = k.fin || null; sp.skins = k; } }

// ------------------------------------------------------------------ part renderer
const C_VS = /* glsl */ `
attribute vec3 aColB; attribute vec4 aParams; attribute float aGlowBoost; attribute vec4 aSkinI; attribute vec4 tangent;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying float vBoost;
varying vec2 vUv; varying vec4 vSkin; varying vec3 vTan;
void main(){
  vLocal = position; vColA = instanceColor; vColB = aColB; vParams = aParams; vBoost = aGlowBoost; vUv = uv; vSkin = aSkinI;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  mat3 m = mat3(modelMatrix) * mat3(instanceMatrix);
  vNormal = normalize(m * normal); vTan = normalize(m * tangent.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const C_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying float vBoost;
varying vec2 vUv; varying vec4 vSkin; varying vec3 vTan;
uniform float uFinMode;
${COMMON}
${SKIN_GLSL}
void main(){
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  float pat = 0.0;
  int mode = int(vParams.x + 0.5);
  float ps = vParams.y;
  if (mode == 1) pat = smoothstep(0.42, 0.5, abs(fract(vLocal.y * ps * 2.0 + vLocal.x * 0.3) - 0.5) * 2.0);
  else if (mode == 2) pat = smoothstep(0.62, 0.7, vnoise(vLocal * ps * 3.0 + 7.0));
  else if (mode == 3) pat = smoothstep(0.05, 0.85, uFinMode > 0.5 ? vLocal.x : -vLocal.y);
  vec3 alb = mix(vColA, vColB, pat);
  float glowMask = 0.4 + 0.6 * pat, occ = 1.0, skinAmt = 0.0;
  if (uSkinOn > 0.5 && vSkin.w > 0.0) {
    vec2 uv = vUv * vSkin.yz;
    skinAmt = vSkin.w * (1.0 - smoothstep(120.0, 420.0, length(uCamPos - vWorld)));
    Skin sk = skinSample(uv, vSkin.x, dFdx(uv), dFdy(uv));
    vec3 T = normalize(vTan - n * dot(n, vTan)), B = cross(n, T);
    n = normalize(n + (T * sk.dn.x + B * sk.dn.y) * skinAmt);
    alb = mix(alb, mix(alb, vColB * 1.1, 0.75), sk.m1 * skinAmt * 0.8);
    alb *= mix(1.0, sk.tone * 1.18, skinAmt);
    occ = mix(1.0, 0.75 + 0.25 * sk.tone, skinAmt);
    glowMask = mix(glowMask, 0.15 + 1.4 * sk.m2 + 0.4 * pat, skinAmt * step(0.01, vParams.z));
  }
  vec3 col = litSurface(alb, n, vWorld, vParams.w, occ, 0.45);
  if (skinAmt > 0.0) col += skinSpec(n, vWorld, vSkin.x, skinAmt, vParams.w);
  // soft subsurface glow when back-lit
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += alb * uSunColor * back * (uFinMode > 0.5 ? 0.55 : 0.3) * (1.0 - abs(dot(n, V)));
  float glow = vParams.z * glowMask * (1.0 + vBoost) * (1.0 + uNight * 2.2);
  col += vColB * glow * 2.2;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

class PartPool {
  constructor(geo, max, scene, finMode = 0, kind = 'ell') {
    this.max = max; this.kind = kind;
    if (!geo.attributes.tangent) geo.computeTangents();
    geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aGlowBoost', new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSkinI', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ vertexShader: C_VS, fragmentShader: C_FS, uniforms: { ...U, uFinMode: { value: finMode } }, side: finMode ? THREE.DoubleSide : THREE.FrontSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.colB = geo.attributes.aColB.array;
    this.params = geo.attributes.aParams.array;
    this.boost = geo.attributes.aGlowBoost.array;
    this.skin = geo.attributes.aSkinI.array;
    this.mat = this.mesh.instanceMatrix.array;
    this.colA = this.mesh.instanceColor.array;
    this.n = 0; this.key = null;
    this.hist = new InstHistory(this.mesh, max);
    scene.add(this.mesh);
  }
  begin() { this.hist.begin(this.n); this.n = 0; }
  add(m4, sp, sun = 1, boost = 0, glowOverride = -1, skin) {
    if (this.n >= this.max) return;
    const i = this.n++;
    m4.toArray(this.mat, i * 16);
    this.hist.record(i, this.key);
    const a = sp.colA, b = sp.colB, g = sp.genome;
    this.colA[i * 3] = a.x; this.colA[i * 3 + 1] = a.y; this.colA[i * 3 + 2] = a.z;
    this.colB[i * 3] = b.x; this.colB[i * 3 + 1] = b.y; this.colB[i * 3 + 2] = b.z;
    this.params[i * 4] = sp.patOverride ?? g.pattern; this.params[i * 4 + 1] = g.pscale; this.params[i * 4 + 2] = glowOverride >= 0 ? glowOverride : g.glow; this.params[i * 4 + 3] = sun;
    this.boost[i] = boost;
    const sk = skin !== undefined ? skin : (sp.partSkin || sp.skin);
    if (sk) {
      // tiles from the part's world size: x/z columns are radius (or span/chord), y is length
      const e = m4.elements;
      const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
      let tu, tv;
      if (this.kind === 'fin') { tu = Math.max(1, sx / sk[1]); tv = Math.max(1, sz / sk[1]); }
      else if (this.kind === 'limb') { tu = Math.max(1, Math.round(2 * Math.PI * Math.max(sx, sz) / sk[1])); tv = Math.max(1, sy / sk[1]); }
      else { tu = Math.max(1, Math.round(2 * Math.PI * Math.max(sx, sz) / sk[1])); tv = Math.max(1, Math.PI * sy / sk[1]); }
      this.skin[i * 4] = sk[0]; this.skin[i * 4 + 1] = tu; this.skin[i * 4 + 2] = tv; this.skin[i * 4 + 3] = sk[2] ?? 1;
    } else this.skin[i * 4 + 3] = 0;
  }
  end() {
    this.mesh.count = this.n;
    this.hist.end(this.n);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    const g = this.mesh.geometry.attributes;
    g.aColB.needsUpdate = true; g.aParams.needsUpdate = true; g.aGlowBoost.needsUpdate = true; g.aSkinI.needsUpdate = true;
  }
}

function finGeometry() {
  // cupped blade in the XZ plane, root at x=0 spanning to x=1; three vertices across the chord
  const pos = [], idx = [], uv = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const chord = Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.55 + (1 - t) * 0.25;
    const sweep = -t * t * 0.35;
    const lift = Math.sin(t * Math.PI) * 0.05;
    pos.push(t, lift, sweep + chord * 0.5, t, lift + chord * 0.16, sweep, t, lift, sweep - chord * 0.5);
    uv.push(t, 0, t, 0.5, t, 1);
    if (i > 0) {
      const a = (i - 1) * 3;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function limbGeometry() {
  const g = new THREE.CylinderGeometry(0.7, 1, 1, 9, 1, false);
  g.translate(0, 0.5, 0);
  return g;
}

// scratch
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Draw {
  constructor(scene) {
    this.scene = scene;
    this.pEll = new PartPool(new THREE.SphereGeometry(1, 18, 12), 4000, scene, 0, 'ell');
    this.pLimb = new PartPool(limbGeometry(), 4000, scene, 0, 'limb');
    this.pFin = new PartPool(finGeometry(), 1500, scene, 1, 'fin');
    this.tubes = new TubeBatch(scene);
    this.glass = new TubeBatch(scene, 30000, 160000, true);
    this.eyes = null;
  }
  setParts(parts) {
    if (!parts) return;
    const G = parts.geos, T = parts.tex;
    this.parts = {};
    for (const [name, max, thin] of [['StiltHead', 12, 0], ['HybridHead', 8, 0], ['CrawlerHead', 10, 0], ['WhaleHead', 2, 0], ['WhaleFin', 8, 1], ['WhaleFluke', 2, 1]])
      if (G[name]) this.parts[name] = new MeshPool(this.scene, G[name], T, max, { thin: !!thin });
    if (G.PolypPetal) this.pPetal = new PartPool(G.PolypPetal.clone(), 1200, this.scene, 1, 'fin');
  }
  // stable per-creature keys so each batch can find last frame's transform of the same part (motion vectors)
  owner(id) { this.ownerId = id; this.seq = 0; }
  k(pool) { pool.key = (this.ownerId || 0) * 4096 + (this.seq++); return pool; }
  part(name, p, q, scale, sp, sun = 1, boost = 0, glow = -1, tile = 0) { const P = this.parts && this.parts[name]; if (P) this.k(P).add(p, q, scale, sp, sun, boost, glow, tile); }
  petal(p, q, len, sp, sun = 1, boost = 0) { _m.compose(p, q, _s.set(len, len, len)); this.k(this.pPetal).add(_m, sp, sun, boost, -1, sp.partSkin); }
  begin() {
    if (!this.eyes) this.eyes = new EyePool(this.scene);
    this.pEll.begin(); this.pLimb.begin(); this.pFin.begin(); this.tubes.begin(); this.glass.begin(); this.eyes.begin();
    if (this.parts) for (const k in this.parts) this.parts[k].begin();
    if (this.pPetal) this.pPetal.begin();
  }
  end() {
    this.pEll.end(); this.pLimb.end(); this.pFin.end(); this.tubes.end(); this.glass.end(); this.eyes.end();
    if (this.parts) for (const k in this.parts) this.parts[k].end();
    if (this.pPetal) this.pPetal.end();
  }
  eye(p, q, r, o) { this.eyes.add(p, q, r, o); }
  tube(pts, radii, o) { return this.k(o.glass ? this.glass : this.tubes).add(pts, radii, o); }
  ellipsoid(p, q, sx, sy, sz, sp, sun = 1, boost = 0, glow = -1) {
    _m.compose(p, q, _s.set(sx, sy, sz)); this.k(this.pEll).add(_m, sp, sun, boost, glow);
  }
  sphere(p, r, sp, sun = 1, boost = 0, glow = -1) { _m.compose(p, _q.identity(), _s.set(r, r, r)); this.k(this.pEll).add(_m, sp, sun, boost, glow); }
  limb(a, b, r, sp, sun = 1, boost = 0, glow = -1) {
    _v.subVectors(b, a); const len = _v.length(); if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, _v.multiplyScalar(1 / len));
    _m.compose(a, _q, _s.set(r, len, r)); this.k(this.pLimb).add(_m, sp, sun, boost, glow);
  }
  finAt(p, q, span, chord, sp, sun = 1, boost = 0, skin) { _m.compose(p, q, _s.set(span, 1, chord)); this.k(this.pFin).add(_m, sp, sun, boost, -1, skin); }
}


// ------------------------------------------------------------------ eyes: lids that blink, an eyeball that looks around
const E_VS = /* glsl */ `
attribute vec3 aIris; attribute vec4 aEye; attribute vec4 aEyeB;
varying vec3 vWorld; varying vec3 vN; varying vec3 vL; varying vec3 vLid; varying vec3 vIris; varying vec4 vEye; varying vec4 vEyeB;
void main(){
  vL = position; vLid = instanceColor; vIris = aIris; vEye = aEye; vEyeB = aEyeB;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const E_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vL; varying vec3 vLid; varying vec3 vIris; varying vec4 vEye; varying vec4 vEyeB;
${COMMON}
void main(){
  vec3 p = normalize(vL);
  vec3 n = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  float ptype = vEye.x, blink = vEye.y, glowK = vEye.z, irisR = vEye.w;
  float sun = vEyeB.x, sclera = vEyeB.w; vec2 gaze = vEyeB.yz;
  // lid opening: an ellipse around +Z that closes from both lids
  float open = 1.0 - blink;
  float oy = 0.6 * open + 0.002;
  float e = (p.x * p.x) / 0.7 + (p.y - 0.06 * blink) * (p.y - 0.06 * blink) / (oy * oy);
  float inside = ptype > 2.5 ? smoothstep(-0.35, -0.1, p.z) : step(0.0, p.z) * (1.0 - smoothstep(0.8, 1.0, e));
  // the eyeball turns inside the lids
  vec3 g = normalize(vec3(sin(gaze.x) * cos(gaze.y), sin(gaze.y), cos(gaze.x) * cos(gaze.y)));
  vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), g)), ey = cross(g, ex);
  float th = acos(clamp(dot(p, g), -1.0, 1.0));
  vec2 q = vec2(dot(p, ex), dot(p, ey));
  float r = th / irisR;
  float a = atan(q.y, q.x);
  float pr = 0.42 + 0.14 * uNight;
  vec2 sq = q / max(sin(irisR), 0.05);
  float pupil = 0.0;
  if (ptype < 0.5) pupil = 1.0 - smoothstep(pr - 0.05, pr + 0.02, r);
  else if (ptype < 1.5) pupil = 1.0 - smoothstep(0.85, 1.05, length(vec2(sq.x / (pr * (0.22 + 0.5 * uNight)), sq.y / (pr * 1.55))));
  else if (ptype < 2.5) pupil = 1.0 - smoothstep(0.85, 1.05, length(vec2(sq.x / (pr * 1.35), sq.y / (pr * (0.4 + 0.3 * uNight)))));
  float iris = 1.0 - smoothstep(0.95, 1.03, r);
  float fib = vnoise(vec3(a * 8.0, r * 5.0, 1.0)) * 0.6 + vnoise(vec3(a * 21.0, r * 9.0, 4.0)) * 0.4;
  vec3 irisCol = vIris * (0.5 + 0.8 * fib) * mix(1.3, 0.5, smoothstep(0.55, 1.0, r));
  irisCol = mix(irisCol, vIris * 1.7, smoothstep(0.62, 0.45, r) * 0.45);
  vec3 scl = mix(vIris * 0.15 + 0.025, vec3(0.86, 0.83, 0.77), sclera);
  vec3 ball = mix(scl, irisCol, iris);
  ball = mix(ball, vec3(0.004), pupil);
  if (ptype > 2.5) {                       // compound eye: a dome of facets
    vec2 f = p.xy * 8.0; f.x += step(1.0, mod(floor(f.y), 2.0)) * 0.5;
    vec2 c = fract(f) - 0.5;
    float edge = max(abs(c.x), abs(c.y));
    float facet = smoothstep(0.5, 0.4, edge);
    ball = mix(vec3(0.02), vIris * (0.55 + 0.45 * vnoise(floor(f).xyy * 3.1)), facet);
    n = normalize(n + vec3(c * 0.6, 0.0) * facet);
  }
  float crease = smoothstep(0.7, 1.0, e) * (1.0 - smoothstep(1.0, 1.5, e)) * step(ptype, 2.5);
  vec3 alb = mix(vLid * (1.0 - crease * 0.55), ball, inside);
  vec3 col = litSurface(alb, n, vWorld, sun, 1.0 - crease * 0.5, 0.3);
  if (inside > 0.0) {
    vec3 H = normalize(V + uSunDir);
    float spec = pow(max(dot(n, H), 0.0), 380.0) * 7.0;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 wet = uSunColor * spec * dynShadow(vWorld, n) * sun + skyColor(R) * fres * 0.7;
    wet += vec3(1.0, 0.97, 0.92) * 0.35 * pow(max(dot(R, normalize(V + vec3(0.25, 0.55, 0.0))), 0.0), 90.0);   // catchlight
    float shine = pow(max(dot(n, V), 0.0), 5.0) * uNight;
    col += (wet + vIris * (shine * 2.6 * max(pupil, iris * 0.4) + glowK * iris * 1.6)) * inside;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

class EyePool {
  constructor(scene, max = 400) {
    const geo = new THREE.SphereGeometry(1, 32, 22);
    this.max = max;
    const mk = (k) => new THREE.InstancedBufferAttribute(new Float32Array(max * k), k).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aIris', mk(3)); geo.setAttribute('aEye', mk(4)); geo.setAttribute('aEyeB', mk(4));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: E_VS, fragmentShader: E_FS, uniforms: { ...U } }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.a = geo.attributes; this.n = 0;
  }
  begin() { this.n = 0; }
  add(p, q, r, o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    _m.compose(p, q, _s.set(r, r, r)); _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    const L = o.lid, I = o.iris;
    this.mesh.instanceColor.array.set([L.x, L.y, L.z], i * 3);
    this.a.aIris.array.set([I.x, I.y, I.z], i * 3);
    this.a.aEye.array.set([o.pupil || 0, o.blink || 0, o.glow || 0, o.irisR || 0.62], i * 4);
    this.a.aEyeB.array.set([o.sun ?? 1, o.gaze ? o.gaze[0] : 0, o.gaze ? o.gaze[1] : 0, o.sclera || 0], i * 4);
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.a.aIris.needsUpdate = true; this.a.aEye.needsUpdate = true; this.a.aEyeB.needsUpdate = true;
  }
}

// per-creature eye behaviour: blinks, saccades, and looking at the glider
const _iq = new THREE.Quaternion(), _gv = new THREE.Vector3();
class Gaze {
  constructor(rnd, rate = 1) { this.rnd = rnd; this.next = 1 + rnd() * 4; this.bt = 0; this.sac = [0, 0]; this.sacT = 0; this.rate = rate; this.last = -1; this.cur = [0, 0]; }
  tick(time) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last)); this.last = time;
    this.next -= dt;
    if (this.next < 0) { this.next = (1.5 + this.rnd() * 5) / this.rate; this.bt = 0.17 / Math.sqrt(this.rate); if (this.rnd() < 0.2) this.next = 0.3; }
    this.bt = Math.max(0, this.bt - dt);
    this.blink = this.bt > 0 ? Math.sin(Math.PI * (1 - this.bt / (0.17 / Math.sqrt(this.rate)))) : 0;
    this.sacT -= dt;
    if (this.sacT < 0) { this.sacT = 0.4 + this.rnd() * 2.2; this.sac = [(this.rnd() - 0.5) * 0.55, (this.rnd() - 0.5) * 0.3]; }
    this.dt = dt;
  }
  // gaze angles for an eye at p with orientation q, toward target (or wandering)
  look(p, q, target, maxA = 0.6) {
    let want = this.sac;
    if (target) {
      _iq.copy(q).invert(); _gv.subVectors(target, p).normalize().applyQuaternion(_iq);
      if (_gv.z > -0.2) want = [Math.max(-maxA, Math.min(maxA, Math.atan2(_gv.x, _gv.z))), Math.max(-maxA * 0.6, Math.min(maxA * 0.6, Math.asin(Math.max(-1, Math.min(1, _gv.y)))))];
    }
    const k = Math.min(1, (this.dt || 0.016) * 14);
    this.cur[0] += (want[0] - this.cur[0]) * k; this.cur[1] += (want[1] - this.cur[1]) * k;
    return [this.cur[0], this.cur[1]];
  }
}
const _yq = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
const _bm = new THREE.Matrix4();
function basisQ(fwd, upHint) {
  const z = fwd.clone().normalize();
  const y = upHint.clone().addScaledVector(z, -upHint.dot(z)); if (y.lengthSq() < 1e-6) y.set(0, 0, 1).addScaledVector(z, -z.z); y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(_bm.makeBasis(x, y, z));
}
function anchorW(origin, q, local, scale, mirror = 1) { return new THREE.Vector3(local[0] * mirror, local[1], local[2]).multiplyScalar(scale).applyQuaternion(q).add(origin); }
function splayQ(q, angle) { return q.clone().multiply(_yq.setFromAxisAngle(_Y, angle)); }

// two-bone IK; returns knee position
function solveKnee(hip, foot, L1, L2, hint, out) {
  _v.subVectors(foot, hip);
  let d = _v.length();
  d = Math.min(d, L1 + L2 - 0.01);
  const dir = _v.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _w.copy(hint).addScaledVector(dir, -hint.dot(dir)).normalize();
  return out.copy(hip).addScaledVector(dir, a).addScaledVector(_w, h);
}

// ------------------------------------------------------------------ walkers (stiltwalker + hybrid)
class Walker {
  constructor(sp, home, rnd, opts = {}) {
    this.sp = sp; this.g = sp.genome; this.rnd = rnd;
    this.islands = opts.islands; this.home = home;
    this.spawnOff = new THREE.Vector3((rnd() - 0.5) * 30, 0, (rnd() - 0.5) * 30);
    this.pos = new THREE.Vector3();
    this.heading = rnd() * 6.28;
    this.target = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.state = 'walk'; this.stateT = 2 + rnd() * 6;
    this.neckT = new THREE.Vector3();
    const n = this.g.legs;
    this.feet = []; this.legs = [];
    this.bodyLen = this.g.segs * this.g.segR * 1.5;
    for (let i = 0; i < n; i++) {
      const pair = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      const along = n === 4 ? (pair === 0 ? 0.7 : -0.7) : (1 - pair) * 0.9;
      this.legs.push({ along: along * this.bodyLen * 0.5 + 0.2, side, foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, group: (pair + (side > 0 ? 1 : 0)) % 2 });
    }
    this.phase = rnd() * 6;
    this.center = new THREE.Vector3(); this.radius = this.g.upper + this.g.lower;
    this.reach = (this.g.upper + this.g.lower) * 0.78;
    this.init = false;
    this.bodyY = 0;
    this.tags = new Set();
    this.alert = 0;
    this.headPos = new THREE.Vector3();
  }
  ground(x, z) {
    let best = NaN;
    for (const isl of this.islands) { const h = isl.groundAt(x, z); if (!isNaN(h) && (isNaN(best) || h > best)) best = h; }
    return best;
  }
  walkable(x, z) {
    let h = NaN, isl = null;
    for (const I of this.islands) { const gh = I.groundAt(x, z); if (!isNaN(gh) && (isNaN(h) || gh > h)) { h = gh; isl = I; } }
    if (isNaN(h)) return false;
    const lh = h - isl.pos.y;
    if (lh > 14 || lh < -12) return false;
    const h2 = this.ground(x + 3, z), h3 = this.ground(x, z + 3), h4 = this.ground(x - 3, z), h5 = this.ground(x, z - 3);
    if (isNaN(h2) || isNaN(h3) || isNaN(h4) || isNaN(h5)) return false;
    return Math.abs(h2 - h) < 3.5 && Math.abs(h3 - h) < 3.5 && Math.abs(h4 - h) < 3.5 && Math.abs(h5 - h) < 3.5;
  }
  pickTarget() {
    const homeW = this.homeWorld();
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rnd() * 6.28, r = 10 + this.rnd() * 55;
      const x = homeW.x + Math.cos(a) * r, z = homeW.z + Math.sin(a) * r;
      if (this.walkable(x, z)) { this.target.set(x, 0, z); return; }
    }
    this.target.set(homeW.x, 0, homeW.z);
  }
  homeWorld() { return _w.set(this.home.x + this.home.island.pos.x, 0, this.home.z + this.home.island.pos.z).clone(); }
  update(dt, ctx) {
    const g = this.g;
    if (!this.init) {
      // relative spawn: home is island-local
      const hw = this.homeWorld();
      this.pos.set(hw.x + this.spawnOff.x, 0, hw.z + this.spawnOff.z);
      if (!this.walkable(this.pos.x, this.pos.z)) this.pos.set(hw.x, 0, hw.z);
      this.pickTarget();
      this.prevIsl = this.home.island.pos.clone();
    }
    // carry along with island drift
    const ip = this.home.island.pos;
    if (this.prevIsl) { this.pos.x += ip.x - this.prevIsl.x; this.pos.z += ip.z - this.prevIsl.z; for (const l of this.legs) { l.foot.x += ip.x - this.prevIsl.x; l.foot.z += ip.z - this.prevIsl.z; l.foot.y += ip.y - this.prevIsl.y; l.to.add(_v.subVectors(ip, this.prevIsl)); l.from.add(_v); } }
    this.prevIsl = ip.clone();

    const dg = ctx.glider.pos.distanceTo(this.pos);
    this.alert += ((dg < 70 ? 1 : 0) - this.alert) * Math.min(1, dt * 2);
    this.stateT -= dt;
    if (this.stateT <= 0) {
      if (this.state === 'walk') { this.state = this.rnd() < 0.55 ? 'graze' : 'walk'; this.stateT = this.state === 'graze' ? 4 + this.rnd() * 4 : 5 + this.rnd() * 6; if (this.state === 'walk') this.pickTarget(); }
      else { this.state = 'walk'; this.stateT = 5 + this.rnd() * 8; this.pickTarget(); }
    }
    if ((ctx.night || 0) > 0.6 && dg >= 70) { this.state = 'sleep'; this.stateT = 2; }
    else if (this.state === 'sleep') { this.state = 'walk'; this.stateT = 3 + this.rnd() * 3; this.pickTarget(); }
    let speed = 0;
    if (this.state === 'walk' || (dg < 34 && !ctx.glider.perched)) {
      const to = _v.set(this.target.x - this.pos.x, 0, this.target.z - this.pos.z);
      if (dg < 34) { to.set(this.pos.x - ctx.glider.pos.x, 0, this.pos.z - ctx.glider.pos.z); }
      const dist = to.length();
      if (dist < 3 && dg >= 34) { this.pickTarget(); }
      const want = Math.atan2(to.x, to.z);
      let dh = ((want - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.heading += Math.max(-1, Math.min(1, dh)) * dt * 0.7;
      speed = g.speed * (dg < 34 ? 2.0 : 1) * Math.max(0, Math.cos(dh) * 0.8 + 0.2) * (1 - this.alert * 0.6 * (dg >= 34 ? 1 : 0));
    }
    let nx = this.pos.x + Math.sin(this.heading) * speed * dt, nz = this.pos.z + Math.cos(this.heading) * speed * dt;
    // keep herd members apart
    if (this.herd) for (const o of this.herd) {
      if (o === this || !o.init) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      const min = (this.g.upper + this.g.lower) * 1.1;
      if (d2 < min * min && d2 > 1e-4) { const d = Math.sqrt(d2), push = (min - d) * dt * 1.2; nx += dx / d * push; nz += dz / d * push; }
      else if (d2 <= 1e-4) { nx += (this.rnd() - 0.5) * 2; nz += (this.rnd() - 0.5) * 2; }
    }
    if (this.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; } else { this.heading += 1.2 * dt * 3; this.pickTarget(); }
    this.speed = speed;
    const gy = this.ground(this.pos.x, this.pos.z);
    const ty = (isNaN(gy) ? this.bodyY : gy) + this.reach - (this.state === 'graze' ? 1.2 : this.state === 'sleep' ? 2.6 : 0);
    if (!this.init) this.bodyY = ty;
    this.bodyY += (ty - this.bodyY) * Math.min(1, dt * 2);
    this.phase += dt * (1 + speed);
    this.pos.y = this.bodyY + Math.sin(this.phase * 2) * 0.12 * Math.min(1, speed);

    // feet
    const fw = _v.set(Math.sin(this.heading), 0, Math.cos(this.heading)).clone();
    const rt = new THREE.Vector3(fw.z, 0, -fw.x);
    const stride = 2.6 + speed * 0.6;
    const stepDur = Math.max(0.28, 0.75 - speed * 0.08);
    let anyGroup = -1;
    for (const l of this.legs) if (l.t < 1) anyGroup = l.group;
    for (const l of this.legs) {
      const spread = (g.upper + g.lower) * 0.42;
      const rest = this.pos.clone().addScaledVector(fw, l.along * 1.1 + speed * 0.45).addScaledVector(rt, l.side * spread);
      const ry = this.ground(rest.x, rest.z); rest.y = isNaN(ry) ? this.bodyY - this.reach : ry;
      if (!this.init) { l.foot.copy(rest); l.to.copy(rest); l.t = 1; }
      if (l.t >= 1 && l.foot.distanceTo(rest) > stride && (anyGroup === -1 || anyGroup === l.group)) {
        l.from.copy(l.foot); l.to.copy(rest).addScaledVector(fw, stride * 0.35); const ty2 = this.ground(l.to.x, l.to.z); if (!isNaN(ty2)) l.to.y = ty2; l.t = 0; anyGroup = l.group;
      }
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / stepDur);
        const s = l.t * l.t * (3 - 2 * l.t);
        l.foot.lerpVectors(l.from, l.to, s);
        l.foot.y += Math.sin(Math.PI * l.t) * (1.4 + speed * 0.2);
        if (l.t >= 1 && ctx.audio && dg < 150) ctx.audio.footstep(l.foot, this.sp.id);
      }
    }
    this.init = true;
    this.center.copy(this.pos);
    this.sun = this.home.island.shadeAt(this.pos.x, this.pos.z) * 0.85 + 0.15;
    // behaviour tags for the journal
    this.tag = dg < 70 ? 'alert' : this.state === 'sleep' ? 'sleep' : this.state === 'graze' ? 'graze' : speed > 0.5 ? 'walk' : 'rest';
    if (this.sp.id === 'hybrid') {
      const hw = this.homeWorld();
      if (Math.hypot(this.pos.x - hw.x, this.pos.z - hw.z) < 32 && this.tag !== 'alert' && this.tag !== 'sleep') this.tag = 'seam';
    }
    this.fw = fw; this.rt = rt;
  }
  draw(D, ctx) {
    if (!this.fw) return;
    const g = this.g, sp = this.sp, sun = this.sun;
    const lsp = this.legSp || (this.legSp = { ...sp, patOverride: sp.id === 'hybrid' ? 2 : 0, skin: sp.skins.legs });
    const far = ctx.camPos.distanceTo(this.pos);
    if (far > 1500 || !ctx.visible(this.pos, this.radius * 1.6)) return;
    const lod = far < 160 ? 1 : far < 400 ? 0.55 : 0.3;
    const fw = this.fw, rt = this.rt;
    const hybrid = this.sp.id === 'hybrid';
    // head target
    const base = this.pos.clone().addScaledVector(fw, this.bodyLen * 0.5 + g.segR * 0.3); base.y += g.segR * 0.35;
    let head;
    if (this.tag === 'graze' || this.tag === 'sleep') {
      head = base.clone().addScaledVector(fw, g.neck * (this.tag === 'sleep' ? 0.45 : 0.7));
      const gh = this.ground(head.x, head.z);
      head.y = (isNaN(gh) ? head.y - g.neck : gh) + (this.tag === 'sleep' ? 1.6 : 0.8 + Math.abs(Math.sin(ctx.time * 3)) * 0.4);
    } else {
      head = base.clone().addScaledVector(fw, g.neck * 0.55); head.y += g.neck * 0.75;
      if (this.alert > 0.05) { const toG = ctx.glider.pos.clone().sub(head).normalize(); head.addScaledVector(toG, 1.6 * this.alert); head.y += 1.2 * this.alert; }
    }
    this.neckT.lerp(head, this.init2 ? 0.1 : 1); this.init2 = true;
    head = this.neckT;
    const ctrl = base.clone().addScaledVector(UP, g.neck * 0.6);
    // one continuous spine: tail tip, tail, body, neck, head, snout
    const pts = [], rad = [];
    const tailTip = this.pos.clone().addScaledVector(fw, -this.bodyLen * 0.5 - g.tail - g.segR * 0.4).addScaledVector(rt, Math.sin(this.phase * 0.7) * 0.8);
    tailTip.y += -0.9 + Math.sin(this.phase) * 0.3;
    pts.push(tailTip); rad.push(0.07);
    const tailBase = this.pos.clone().addScaledVector(fw, -this.bodyLen * 0.5 - g.segR * 0.45); tailBase.y += 0.15;
    pts.push(tailBase); rad.push(g.segR * 0.42);
    const nb = hybrid ? g.segs * 2 + 1 : 3;
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1);
      const p = this.pos.clone().addScaledVector(fw, (t - 0.5) * this.bodyLen);
      p.y += Math.sin(this.phase * 2 + i) * 0.06 - Math.sin(Math.PI * t) * 0.18 + t * 0.35;
      let r = g.segR * (0.8 + 0.2 * Math.sin(Math.PI * t));
      if (hybrid) r *= i % 2 ? 0.74 : 1.06;
      pts.push(p); rad.push(r);
    }
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      pts.push(base.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(ctrl, 2 * (1 - t) * t).addScaledVector(head, t * t));
      rad.push(g.segR * (0.42 - t * 0.14));
    }
    const hd = head.clone().sub(ctrl).normalize();
    const headName = hybrid ? 'HybridHead' : 'StiltHead';
    const sculpt = D.parts && D.parts[headName];
    let hq2 = null;
    if (sculpt) {
      // the neck runs into the sculpted head's collar; the head itself stays level unless grazing
      const hdir = hd.clone(); if (this.tag !== 'graze' && this.tag !== 'sleep') { hdir.y *= 0.3; } hdir.normalize();
      hq2 = basisQ(hdir, UP);
      pts.push(head.clone().addScaledVector(hdir, -g.head * 0.35)); rad.push(g.head * 0.45);
      pts.push(head.clone().addScaledVector(hdir, -g.head * 0.05)); rad.push(g.head * 0.43);
      D.part(headName, head, hq2, g.head, sp, sun, 0, hybrid ? 0.25 : -1, (sp.skin[1]) / 1.0);
    } else {
      pts.push(head.clone().addScaledVector(hd, -g.head * 0.3)); rad.push(g.head * 0.62);
      pts.push(head.clone().addScaledVector(hd, g.head * 0.5)); rad.push(g.head * 0.5);
      pts.push(head.clone().addScaledVector(hd, g.head * 1.15)); rad.push(g.head * 0.12);
    }
    D.tube(pts, rad, { rings: Math.max(14, Math.round((hybrid ? 72 : 60) * lod)), sp, sun, squash: 0.9, up: UP });
    // legs: hip, knee, ankle, foot pad
    const hint = new THREE.Vector3();
    const knee = new THREE.Vector3();
    for (const l of this.legs) {
      const hip = this.pos.clone().addScaledVector(fw, l.along).addScaledVector(rt, l.side * g.segR * 0.62);
      hip.y -= g.segR * 0.15;
      hint.copy(rt).multiplyScalar(l.side * 0.6).add(UP).addScaledVector(fw, l.along > 0 ? 0.2 : -0.2);
      solveKnee(hip, l.foot, g.upper, g.lower, hint, knee);
      const ankle = l.foot.clone().lerp(knee, 0.14);
      const thigh = hip.clone().lerp(knee, 0.45), shin = knee.clone().lerp(ankle, 0.5);
      const toe = l.foot.clone().addScaledVector(fw, 0.25);
      D.tube([hip, thigh, knee, shin, ankle, toe], [g.segR * 0.4, g.segR * 0.24, 0.36, 0.2, 0.27, 0.3],
        { rings: Math.max(6, Math.round(20 * lod)), sp: lsp, sun, up: fw });
      if (far < 300) D.ellipsoid(toe.clone().addScaledVector(UP, 0.05), _q.setFromAxisAngle(UP, this.heading), 0.38, 0.22, 0.45, hybrid ? lsp : SP_HOOF, sun);
    }
    this.headPos.copy(head);
    if (far < 400) {
      const hq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hd);
      const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(hq), eu = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
      this.gz = this.gz || new Gaze(this.rnd);
      this.gz.tick(ctx.time);
      const tgt = (this.alert > 0.15 || ctx.glider.pos.distanceTo(head) < 110) ? ctx.glider.pos : null;
      const blink = this.tag === 'sleep' ? 1 : this.gz.blink;
      for (const s of [-1, 1]) {
        let ep, eq, er;
        if (hq2) { const A = ANCHORS[headName]; ep = anchorW(head, hq2, A.eye, g.head, s); eq = splayQ(hq2, s * 0.95); er = A.eyeR * g.head * 1.04; }
        else { ep = head.clone().addScaledVector(ex, s * g.head * 0.46).addScaledVector(eu, g.head * 0.18).addScaledVector(hd, g.head * 0.12); eq = splayQ(hq, s * 0.85); er = 0.27 * g.head; }
        D.eye(ep, eq, er, { lid: sp.colA, iris: hybrid ? IRIS.hybrid : IRIS.stilt, pupil: hybrid ? 1 : 2, blink, gaze: this.gz.look(ep, eq, tgt), glow: hybrid ? 0.25 : 0, sun: this.sun, irisR: 0.66 });
      }
      // crest
      if (!hq2) D.finAt(head.clone().addScaledVector(eu, g.head * 0.35).addScaledVector(hd, -g.head * 0.3), hq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2 - 0.35))), g.head * 2.4, g.head * 1.3, sp, sun);
      if (g.antenna) for (const s of [-1, 1]) {
        const a0 = hq2 ? anchorW(head, hq2, [0.2, 0.62, 0.3], g.head, s) : head.clone().addScaledVector(eu, g.head * 0.3).addScaledVector(ex, s * 0.3);
        const a1 = a0.clone().addScaledVector(hd, g.antenna * 0.5).addScaledVector(ex, s * 0.6).addScaledVector(eu, 0.8);
        const a2 = a0.clone().addScaledVector(hd, g.antenna).addScaledVector(ex, s * 1.1).addScaledVector(eu, 1.0 + Math.sin(ctx.time * 4 + s) * 0.25);
        D.tube([a0, a1, a2], [0.12, 0.08, 0.04], { rings: 8, sp, sun });
      }
    }
  }
}

const IRIS = { stilt: new THREE.Vector3(0.95, 0.52, 0.12), hybrid: new THREE.Vector3(0.55, 0.85, 0.18), kite: new THREE.Vector3(0.98, 0.82, 0.35), crawler: new THREE.Vector3(0.95, 0.75, 0.2), whale: new THREE.Vector3(0.35, 0.68, 0.95) };
const SP_HOOF = { colA: new THREE.Vector3(0.09, 0.07, 0.06), colB: new THREE.Vector3(0.2, 0.17, 0.14), genome: { pattern: 3, pscale: 1, glow: 0 }, skin: [1, 0.5, 0.8] };
const SP_EYE = { colA: new THREE.Vector3(0.02, 0.015, 0.03), colB: new THREE.Vector3(1.0, 0.85, 0.5), genome: { pattern: 0, pscale: 1, glow: 0.0 } };

// ------------------------------------------------------------------ sessile bloom polyps
class Polyp {
  constructor(sp, island, local, normal, rnd) {
    this.sp = sp; this.g = sp.genome; this.island = island;
    this.local = local; this.normal = normal; this.rnd = rnd;
    this.h = this.g.stalk * (0.75 + rnd() * 0.5);
    this.open = 1; this.phase = rnd() * 6.28;
    this.center = new THREE.Vector3(); this.radius = this.g.petalLen + 2;
    this.sun = 1; this.tag = 'open';
    this.closedT = 0;
    this.yaw = rnd() * 6.28;
  }
  update(dt, ctx) {
    const base = this.local.clone().add(this.island.pos);
    this.base = base;
    const sway = new THREE.Vector3(Math.sin(ctx.time * 0.7 + this.phase) * 0.6, 0, Math.cos(ctx.time * 0.5 + this.phase) * 0.6);
    this.top = base.clone().addScaledVector(this.normal, this.h).add(sway);
    this.center.copy(this.top);
    const dg = ctx.glider.pos.distanceTo(this.top);
    const want = dg < 48 ? 0 : 1;
    if (want === 0 && this.open > 0.6 && ctx.audio && dg < 120) ctx.audio.polypClose(this.top);
    this.open += (want - this.open) * Math.min(1, dt * (want ? 0.5 : 5));
    this.tag = this.open < 0.5 ? 'closing' : (ctx.night || 0) > 0.6 ? 'nightglow' : 'open';
    this.sun = this.island.shadeAt(this.top.x, this.top.z) * 0.8 + 0.2;
  }
  draw(D, ctx) {
    if (!this.top || ctx.camPos.distanceTo(this.top) > 1300 || !ctx.visible(this.top, 14)) return;
    const sp = this.sp, g = this.g, sun = this.sun;
    const far = ctx.camPos.distanceTo(this.top);
    const nrm = this.normal;
    // stalk
    const sp0 = this.base.clone().addScaledVector(nrm, -0.6);
    const stalk = [sp0], sr = [0.75];
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const p = this.base.clone().lerp(this.top, t);
      p.x += Math.sin(t * 3 + this.phase) * 0.5; p.z += Math.cos(t * 2.3 + this.phase) * 0.35;
      stalk.push(p); sr.push(0.6 - t * 0.25);
    }
    const bulb0 = this.top.clone().addScaledVector(nrm, -g.head * 0.9);
    stalk.push(bulb0); sr.push(0.36);
    D.tube(stalk, sr, { rings: far < 150 ? 14 : 6, sp: SP_STALK, sun, pattern: 5, up: new THREE.Vector3(1, 0, 0) });
    // bulb: lobed, ribbed
    const bp = [bulb0, this.top.clone().addScaledVector(nrm, -g.head * 0.25), this.top.clone().addScaledVector(nrm, g.head * 0.35), this.top.clone().addScaledVector(nrm, g.head * 0.8)];
    D.tube(bp, [0.4, g.head * 0.95, g.head * 0.85, g.head * 0.3], { rings: far < 150 ? 14 : 6, sp, sun, glow: 0.1, pattern: 5, up: new THREE.Vector3(1, 0, 0), lobes: { k: g.petals, amp: 0.14, from: 0.2, to: 1, phase: this.yaw * g.petals } });
    const qn = new THREE.Quaternion().setFromUnitVectors(UP, nrm);
    D.sphere(this.top.clone().addScaledVector(nrm, g.head * 0.85), g.head * 0.5, SP_CORE, 1, this.open * 1.5 + (ctx.night || 0) * 2, 0.6 * this.open + 0.3);
    // two rings of petals open and close
    const ang = 1.45 - this.open * 1.15;
    for (let ring = 0; ring < 2; ring++) {
      const n = g.petals, len = g.petalLen * (ring ? 0.68 : 1);
      for (let i = 0; i < n; i++) {
        const a = this.yaw + ((i + ring * 0.5) / n) * Math.PI * 2 + Math.sin(ctx.time * 0.8 + i) * 0.05;
        const q = qn.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, ang + ring * 0.25, 'YZX')));
        const pp = this.top.clone().addScaledVector(nrm, g.head * (0.3 + ring * 0.15));
        if (D.pPetal) D.petal(pp, q, len, sp, sun, this.open * 0.4 + (ctx.night || 0) * 0.8);
        else D.finAt(pp, q, len, len * 0.55, sp, sun, this.open * 0.4 + (ctx.night || 0) * 0.8);
      }
    }
  }
}
const SP_STALK = { colA: new THREE.Vector3(0.55, 0.62, 0.32), colB: new THREE.Vector3(0.8, 0.82, 0.5), genome: { pattern: 3, pscale: 1, glow: 0 }, skin: [SKIN.plant, 1.1, 1.0] };
const SP_CORE = { colA: new THREE.Vector3(1.0, 0.62, 0.22), colB: new THREE.Vector3(1.0, 0.75, 0.3), genome: { pattern: 0, pscale: 1, glow: 0.6 } };

// ------------------------------------------------------------------ ribbon kites (flock)
class Kite {
  constructor(sp, island, rnd, idx) {
    this.sp = sp; this.g = sp.genome; this.island = island; this.rnd = rnd; this.idx = idx;
    const a = rnd() * 6.28;
    this.orbitR = 120 + rnd() * 70; this.orbitY = 25 + rnd() * 50; this.dir = 1;
    this.pos = new THREE.Vector3(Math.cos(a) * this.orbitR, this.orbitY, Math.sin(a) * this.orbitR).add(island.pos);
    this.vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(this.g.speed);
    this.trail = Array.from({ length: 14 }, () => this.pos.clone());
    this.flapPhase = rnd() * 6; this.flapAmt = 0;
    this.center = this.pos; this.radius = this.g.span + 2;
    this.escort = 0; this.escortSlot = new THREE.Vector3((idx % 2 ? 1 : -1) * (14 + (idx % 5) * 6), 3 + (idx % 3) * 4, -8 - (idx % 4) * 7);
    this.tag = 'flock'; this.curious = rnd() < 0.6;
    this.trailT = 0;
  }
  update(dt, ctx, flock) {
    const g = this.g, gl = ctx.glider;
    const c = this.island.pos;
    const rel = this.pos.clone().sub(c);
    const dg = gl.pos.distanceTo(this.pos);
    if (this.curious && dg < 140 && !gl.perched && this.escort <= 0 && Math.random() < dt * 0.6) this.escort = 14 + Math.random() * 12;
    if (gl.perched || dg > 260) this.escort = Math.min(this.escort, 0.5);
    this.escort -= dt;
    let desired;
    if (this.escort > 0) {
      const gq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, gl.yaw, 0));
      const slot = this.escortSlot.clone().applyQuaternion(gq).add(gl.pos);
      slot.y += Math.sin(ctx.time + this.idx) * 2;
      desired = slot.sub(this.pos).multiplyScalar(0.9).add(gl.vel.clone());
      this.tag = 'escort';
    } else {
      const tangent = new THREE.Vector3(-rel.z, 0, rel.x).normalize().multiplyScalar(g.speed);
      const rr = Math.hypot(rel.x, rel.z);
      tangent.x -= rel.x / rr * (rr - this.orbitR) * 0.15; tangent.z -= rel.z / rr * (rr - this.orbitR) * 0.15;
      tangent.y = (this.orbitY + Math.sin(ctx.time * 0.3 + this.idx) * 15 - rel.y) * 0.3;
      desired = tangent;
      this.tag = (ctx.night || 0) > 0.6 ? 'nightglow' : 'flock';
    }
    // separation
    for (const o of flock) if (o !== this) {
      const d = this.pos.distanceTo(o.pos);
      if (d < 9 && d > 0.01) desired.addScaledVector(this.pos.clone().sub(o.pos).normalize(), (9 - d) * 1.5);
    }
    if (dg < 10) desired.addScaledVector(this.pos.clone().sub(gl.pos).normalize(), (10 - dg) * 3);
    // avoid rock
    const d = this.island.sdfWorld(this.pos.x, this.pos.y, this.pos.z);
    if (d < 14) desired.y += (14 - d) * 2;
    const maxSp = this.escort > 0 ? 70 : g.speed * 1.4;
    if (desired.length() > maxSp) desired.setLength(maxSp);
    const prevY = this.vel.y;
    this.vel.lerp(desired, Math.min(1, dt * 1.6));
    this.pos.addScaledVector(this.vel, dt);
    // flap when climbing or slow
    const wantFlap = this.vel.y > 1 || this.vel.length() < g.speed * 0.8 ? 1 : 0.15;
    this.flapAmt += (wantFlap - this.flapAmt) * Math.min(1, dt * 2);
    this.flapPhase += dt * g.flap * (1 + this.flapAmt);
    this.trailT += dt;
    if (this.trailT > 0.06) { this.trailT = 0; this.trail.unshift(this.pos.clone()); this.trail.pop(); }
    this.bank = Math.max(-0.9, Math.min(0.9, (this.vel.clone().cross(desired).y) * -0.02));
  }
  draw(D, ctx) {
    const far = ctx.camPos.distanceTo(this.pos);
    if (far > 1600 || !ctx.visible(this.pos, 30)) return;
    const g = this.g, sp = this.sp;
    const fw = this.vel.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const lod = far < 200 ? 1 : 0.5;
    // manta body
    const P = this.pos;
    D.tube([P.clone().addScaledVector(fw, g.body * 1.05), P.clone().addScaledVector(fw, g.body * 0.45), P.clone().addScaledVector(fw, -g.body * 0.3), P.clone().addScaledVector(fw, -g.body * 1.0)],
      [0.25, 1.15, 0.9, 0.2], { rings: Math.round(14 * lod) + 4, sp, squash: 0.45, up, pattern: 3 });
    // flexible membrane wings: flattened tubes whose outer half lags the flap
    const flap = Math.sin(this.flapPhase) * (0.12 + 0.6 * this.flapAmt);
    const flap2 = Math.sin(this.flapPhase - 0.9) * (0.12 + 0.75 * this.flapAmt);
    const side = new THREE.Vector3().crossVectors(fw, up).normalize();
    for (const s of [-1, 1]) {
      const out1 = side.clone().multiplyScalar(s).applyAxisAngle(fw, -flap * s);
      const out2 = side.clone().multiplyScalar(s).applyAxisAngle(fw, -flap2 * s);
      const root = P.clone().addScaledVector(side, s * 0.6).addScaledVector(fw, -0.2);
      const mid = root.clone().addScaledVector(out1, g.span * 0.5).addScaledVector(fw, -g.span * 0.12);
      const tip = mid.clone().addScaledVector(out2, g.span * 0.55).addScaledVector(fw, -g.span * 0.42);
      D.tube([root, mid, tip], [g.span * 0.42, g.span * 0.36, g.span * 0.05], { rings: Math.round(12 * lod) + 4, sp, squash: 0.07, up, pattern: 5, skin: sp.skins.wing });
    }
    const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    if (far < 260) {
      this.gz = this.gz || new Gaze(this.rnd, 1.4); this.gz.tick(ctx.time);
      const tgt = this.escort > 0 || ctx.glider.pos.distanceTo(P) < 80 ? ctx.glider.pos : null;
      for (const s of [-1, 1]) {
        const ep = P.clone().addScaledVector(fw, g.body * 0.72).addScaledVector(ex, s * 0.48).addScaledVector(up, 0.14);
        const eq = splayQ(q, s * 1.05);
        D.eye(ep, eq, 0.21, { lid: sp.colA, iris: IRIS.kite, pupil: 0, blink: this.gz.blink, gaze: this.gz.look(ep, eq, tgt, 0.7), glow: 0.15, sun: 1, irisR: 0.7 });
      }
    }
    // ribbon tail
    if (far < 900) {
      const pts = [P.clone().addScaledVector(fw, -g.body * 0.9)], rad = [0.35];
      const sd = new THREE.Vector3().crossVectors(fw, UP).normalize();
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i].clone();
        const k = i / this.trail.length;
        p.y += Math.sin(ctx.time * 6 - i * 0.7) * 0.6 * k;
        p.addScaledVector(sd, Math.sin(ctx.time * 4.3 - i * 0.55) * 1.2 * k);
        pts.push(p); rad.push(0.42 * (1 - k) + 0.08);
      }
      D.tube(pts, rad, { rings: Math.round(40 * lod), sp: SP_RIBBON, squash: 0.12, up: UP, pattern: 5, glow: 0.25 });
    }
  }
}
const SP_RIBBON = { colA: new THREE.Vector3(0.95, 0.30, 0.08), colB: new THREE.Vector3(1.0, 0.78, 0.35), genome: { pattern: 5, pscale: 1, glow: 0.25 }, skin: [SKIN.membrane, 1.6, 0.7] };

// ------------------------------------------------------------------ arch centipedes (surface crawlers)
class Crawler {
  constructor(sp, island, rnd, start) {
    this.sp = sp; this.g = sp.genome; this.island = island; this.rnd = rnd;
    this.local = start.clone();
    this.heading = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.hist = [];
    this.center = new THREE.Vector3(); this.radius = 8;
    this.turn = 0; this.phase = 0; this.tag = 'crawl';
    this.settle();
    for (let i = 0; i < 80; i++) this.hist.push({ p: this.local.clone(), n: this.normal.clone() });
  }
  sdf(p) { return this.island.sdfFns.sdf(p.x, p.y, p.z); }
  grad(p) {
    const e = 0.5, f = this.island.sdfFns.sdf;
    const a = f(p.x + e, p.y - e, p.z - e), b = f(p.x - e, p.y - e, p.z + e), c = f(p.x - e, p.y + e, p.z - e), d = f(p.x + e, p.y + e, p.z + e);
    return new THREE.Vector3(a - b - c + d, -a - b + c + d, -a + b - c + d).normalize();
  }
  settle() {
    for (let i = 0; i < 3; i++) {
      const d = this.sdf(this.local) - 0.9;
      const n = this.grad(this.local);
      this.local.addScaledVector(n, -d);
      this.normal.copy(n);
    }
  }
  update(dt, ctx) {
    const g = this.g;
    this.turn += (this.rnd() - 0.5) * dt * 3; this.turn *= 0.98;
    const n = this.normal;
    this.heading.applyAxisAngle(n, this.turn * dt);
    // bias: stay on the upper half of the island where it can be seen
    if (this.local.y < -25) this.heading.addScaledVector(UP, 0.05);
    if (Math.hypot(this.local.x, this.local.z) > this.island.spec.radius + 70) this.heading.addScaledVector(this.local.clone().setY(0).normalize(), -0.08);
    this.heading.addScaledVector(n, -this.heading.dot(n)).normalize();
    this.local.addScaledVector(this.heading, g.speed * dt);
    this.settle();
    this.phase += dt * g.speed * 2.5;
    const last = this.hist[0];
    if (last.p.distanceTo(this.local) > 0.4) { this.hist.unshift({ p: this.local.clone(), n: this.normal.clone() }); if (this.hist.length > 120) this.hist.pop(); }
    this.center.copy(this.local).add(this.island.pos);
    this.tag = (ctx.night || 0) > 0.6 ? 'nightglow' : this.normal.y < -0.3 ? 'inverted' : this.local.y > 8 ? 'arch' : 'crawl';
  }
  draw(D, ctx) {
    const ip = this.island.pos, g = this.g, sp = this.sp;
    const far = ctx.camPos.distanceTo(this.center);
    if (far > 1300 || !ctx.visible(this.center, 30)) return;
    // sample the trail every half segment
    const pts = [], nrm = [];
    const half = g.segLen * 0.5;
    const head = this.local.clone().addScaledVector(this.heading, g.segR * 1.2);
    pts.push(head.add(ip)); nrm.push(this.normal);
    let want = half, acc = 0, prevP = this.local;
    pts.push(this.local.clone().add(ip)); nrm.push(this.normal);
    for (let i = 1; i < this.hist.length && pts.length < g.segs * 2 + 2; i++) {
      const h = this.hist[i];
      const l = h.p.distanceTo(prevP);
      while (acc + l >= want && pts.length < g.segs * 2 + 2) {
        const t = (want - acc) / l;
        pts.push(prevP.clone().lerp(h.p, t).add(ip)); nrm.push(h.n);
        want += half;
      }
      acc += l; prevP = h.p;
    }
    if (pts.length < 4) return;
    // lift the body off the rock along the surface normal
    for (let i = 0; i < pts.length; i++) pts[i].addScaledVector(nrm[i], g.segR * 0.35);
    const rad = pts.map((_, i) => {
      const u = i / (pts.length - 1);
      const taper = i === 0 ? 0.45 : (1.1 - u * 0.55);
      return g.segR * taper * (i > 0 && i % 2 === 0 ? 0.72 : 1.0);
    });
    const csc = D.parts && D.parts.CrawlerHead;
    let cq = null, cs = rad[1];
    if (csc) {
      // sculpted head plate rides the first segment; the body tube starts behind it
      cq = basisQ(pts[0].clone().sub(pts[1]), this.normal);
      D.part('CrawlerHead', pts[1], cq, cs, sp, 1, 0, -1);
      D.tube(pts.slice(1), rad.slice(1), { rings: far < 300 ? pts.length * 4 : pts.length * 2, sp, squash: 0.68, up: this.normal });
    } else D.tube(pts, rad, { rings: far < 300 ? pts.length * 4 : pts.length * 2, sp, squash: 0.68, up: this.normal });
    if (far > 450) return;
    // legs on every segment
    for (let i = 1; i < pts.length - 1; i += 2) {
      const p = pts[i], n = nrm[i];
      const f = pts[i - 1].clone().sub(pts[i + 1]).normalize();
      const side = new THREE.Vector3().crossVectors(n, f).normalize();
      const r = rad[i];
      for (const sd of [-1, 1]) {
        const ph = this.phase + i * 0.45 + (sd > 0 ? Math.PI : 0);
        const hip = p.clone().addScaledVector(side, sd * r * 0.7);
        const foot = p.clone().addScaledVector(side, sd * (r + g.leg)).addScaledVector(n, -g.segR * 0.9).addScaledVector(f, Math.sin(ph) * 0.7);
        const knee = hip.clone().lerp(foot, 0.45).addScaledVector(n, g.segR * 0.7 + Math.max(0, Math.cos(ph)) * 0.5);
        D.tube([hip, knee, foot], [r * 0.2, r * 0.14, r * 0.06], { rings: far < 200 ? 7 : 4, sp, pattern: 0, up: f, skin: sp.skins.legs });
      }
    }
    // antennae and eyes
    const p0 = pts[0], p1 = pts[1];
    const f0 = p0.clone().sub(p1).normalize();
    const n0 = this.normal, s0 = new THREE.Vector3().crossVectors(n0, f0).normalize();
    for (const sd of [-1, 1]) {
      const a0 = cq ? anchorW(pts[1], cq, ANCHORS.CrawlerHead.antenna, cs, -sd) : p0.clone().addScaledVector(n0, rad[1] * 0.4).addScaledVector(s0, sd * rad[1] * 0.3);
      const a1 = a0.clone().addScaledVector(f0, g.antenna * 0.5).addScaledVector(n0, 0.9).addScaledVector(s0, sd * 0.8);
      const a2 = a0.clone().addScaledVector(f0, g.antenna).addScaledVector(n0, 0.6 + Math.sin(ctx.time * 5 + sd) * 0.35).addScaledVector(s0, sd * 1.6);
      D.tube([a0, a1, a2], [0.12, 0.07, 0.03], { rings: 8, sp, pattern: 0 });
      let ep, eq, er;
      if (cq) { ep = anchorW(pts[1], cq, ANCHORS.CrawlerHead.eye, cs, -sd); eq = cq; er = ANCHORS.CrawlerHead.eyeR * cs * 1.05; }
      else { ep = p0.clone().addScaledVector(n0, rad[1] * 0.38).addScaledVector(s0, sd * rad[1] * 0.42); eq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s0, n0, f0)); er = 0.36; }
      D.eye(ep, splayQ(eq, -sd * 0.9), er, { lid: sp.colA, iris: IRIS.crawler, pupil: 3, glow: 0.35, sun: 1 });
    }
  }
}

// ------------------------------------------------------------------ lantern drifters
class Lantern {
  constructor(sp, island, rnd, idx) {
    this.sp = sp; this.g = sp.genome; this.island = island; this.rnd = rnd;
    const a = rnd() * 6.28, r = 110 + rnd() * 90;
    this.local = new THREE.Vector3(Math.cos(a) * r, -50 + rnd() * 110, Math.sin(a) * r);
    this.vel = new THREE.Vector3();
    this.phase = rnd() * 6.28; this.period = 2.6 + rnd() * 1.4;
    this.axis = new THREE.Vector3(0, 1, 0);
    this.tent = Array.from({ length: this.g.tentacles }, () => Array.from({ length: 7 }, () => new THREE.Vector3()));
    this.tentPrev = this.tent.map((t) => t.map((v) => v.clone()));
    this.center = new THREE.Vector3(); this.radius = this.g.bell * 1.6;
    this.flare = 0; this.tag = 'drift'; this.init = false;
    this.drift = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize();
  }
  update(dt, ctx) {
    const g = this.g;
    this.phase += dt * Math.PI * 2 / this.period;
    const pulse = Math.max(0, Math.sin(this.phase));
    const wp = this.local.clone().add(this.island.pos);
    const dg = ctx.glider.pos.distanceTo(wp);
    if (dg < 40) { this.flare = 1; this.vel.addScaledVector(wp.clone().sub(ctx.glider.pos).normalize(), dt * 6); }
    this.flare = Math.max(0, this.flare - dt * 0.4);
    const nightL = (ctx.night || 0) > 0.6;
    this.tag = this.flare > 0.3 ? 'flare' : nightL ? 'nightrise' : 'drift';
    if (nightL && this.local.y < 130) this.vel.y += dt * 0.9;
    // jet upward along axis during contraction
    this.vel.addScaledVector(this.axis, pulse * pulse * dt * 3.2);
    this.vel.y -= dt * 0.5;
    this.vel.addScaledVector(this.drift, dt * 0.3);
    // keep in their shell around the island
    const rr = Math.hypot(this.local.x, this.local.z);
    if (rr < 110) { this.vel.x += this.local.x / rr * dt * 2; this.vel.z += this.local.z / rr * dt * 2; }
    if (rr > 220) { this.vel.x -= this.local.x / rr * dt * 2; this.vel.z -= this.local.z / rr * dt * 2; }
    if (this.local.y < -70) this.vel.y += dt * 2;
    if (this.local.y > ((ctx.night || 0) > 0.6 ? 140 : 80)) this.vel.y -= dt * 2;
    this.vel.multiplyScalar(1 - dt * 0.6);
    this.local.addScaledVector(this.vel, dt);
    this.axis.lerp(new THREE.Vector3(this.vel.x * 0.1, 1, this.vel.z * 0.1).normalize(), dt);
    this.center.copy(this.local).add(this.island.pos);
    this.pulse = pulse;
    // tentacles: verlet chains
    const c = this.center;
    for (let k = 0; k < this.tent.length; k++) {
      const a = (k / this.tent.length) * Math.PI * 2;
      const anchor = c.clone().add(new THREE.Vector3(Math.cos(a) * g.bell * 0.6, -g.bell * 0.3, Math.sin(a) * g.bell * 0.6));
      const t = this.tent[k], tp = this.tentPrev[k];
      if (!this.init) for (let i = 0; i < t.length; i++) { t[i].copy(anchor).y -= i; tp[i].copy(t[i]); }
      t[0].copy(anchor);
      for (let i = 1; i < t.length; i++) {
        const cur = t[i].clone();
        t[i].add(t[i].clone().sub(tp[i]).multiplyScalar(0.94));
        t[i].y -= dt * dt * 4;
        t[i].x += Math.sin(ctx.time * 1.3 + i + k) * dt * 0.02;
        tp[i].copy(cur);
      }
      const seg = g.tentLen / t.length;
      for (let it = 0; it < 2; it++) for (let i = 1; i < t.length; i++) {
        const d = t[i].clone().sub(t[i - 1]); const l = d.length() || 1;
        t[i].copy(t[i - 1]).addScaledVector(d, seg / l);
      }
    }
    this.init = true;
  }
  draw(D, ctx) {
    const far = ctx.camPos.distanceTo(this.center);
    if (far > 1600 || !ctx.visible(this.center, 14)) return;
    const g = this.g, sp = this.sp, A = this.axis, C = this.center, b = g.bell, pl = this.pulse;
    const boost = this.flare * 2.0 + pl * 0.4 + (ctx.night || 0) * 1.2;
    const sq = 1 - pl * 0.18, wide = 1 + pl * 0.12;
    const at = (h) => C.clone().addScaledVector(A, h * b / sq);
    const side = Math.abs(A.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    // bell: dome, flared scalloped rim, closed underside
    D.tube([at(0.62), at(0.5), at(0.22), at(-0.08), at(-0.22), at(-0.3)],
      [0.05 * b, 0.62 * b * wide, 0.95 * b * wide, 1.1 * b * wide * sq, 0.82 * b, 0.25 * b],
      { rings: far < 300 ? 26 : 12, sp, boost, pattern: 5, up: side, glass: true, lobes: { k: 8, amp: 0.13, from: 0.45, to: 1.0, phase: this.phase * 0.2 } });
    // glowing core and mouth stalk hang inside the clear bell
    const core = C.clone().addScaledVector(A, b * 0.08);
    D.sphere(core, b * 0.26 * (1 + pl * 0.15), SP_LCORE, 1, boost, 1.0);
    D.tube([C.clone().addScaledVector(A, b * 0.05), C.clone().addScaledVector(A, -b * 0.45), C.clone().addScaledVector(A, -b * 0.95)], [b * 0.16, b * 0.12, b * 0.05],
      { rings: far < 300 ? 10 : 5, sp, boost: boost * 0.7, glow: 0.8, pattern: 5, up: side, lobes: { k: 4, amp: 0.35, from: 0.3, to: 1, phase: this.phase * 0.1 } });
    // four horseshoe gonads glowing inside the clear bell
    const s1 = side.clone().addScaledVector(A, -side.dot(A)).normalize(), s2 = new THREE.Vector3().crossVectors(A, s1);
    const gq = new THREE.Quaternion().setFromUnitVectors(UP, A);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const gp = C.clone().addScaledVector(A, b * 0.2).addScaledVector(s1, Math.cos(a) * b * 0.42).addScaledVector(s2, Math.sin(a) * b * 0.42);
      D.ellipsoid(gp, gq, b * 0.24, b * 0.07, b * 0.24, SP_GONAD, 1, boost * 0.6, 0.7);
    }
    // frilled oral arms + fine tentacles
    for (let k = 0; k < this.tent.length; k++) {
      const t = this.tent[k];
      const oral = k < 3;
      const pts = oral ? t.slice(0, 5) : t;
      const rad = pts.map((_, i) => (oral ? 0.42 : 0.17) * b / 3 * (1 - i / pts.length) + 0.03);
      D.tube(pts, rad, { rings: far < 300 ? 14 : 6, sp, boost: boost * 0.5, glow: 0.6, pattern: 5, up: side,
        lobes: oral ? { k: 3, amp: 0.6, from: 0.1, to: 1, phase: k } : null });
    }
  }
}
const SP_SKIRT = { colA: new THREE.Vector3(0.55, 0.75, 0.95), colB: new THREE.Vector3(1.0, 0.45, 0.8), patOverride: 3, genome: { pattern: 3, pscale: 1, glow: 0.35 } };
const SP_GONAD = { colA: new THREE.Vector3(1.0, 0.5, 0.75), colB: new THREE.Vector3(1.0, 0.62, 0.85), genome: { pattern: 0, pscale: 1, glow: 0.7 } };
const SP_LCORE = { colA: new THREE.Vector3(1.0, 0.62, 0.3), colB: new THREE.Vector3(1.0, 0.55, 0.25), genome: { pattern: 0, pscale: 1, glow: 1.0 } };

// ------------------------------------------------------------------ sky whale
class Whale {
  constructor(sp, island) {
    this.sp = sp; this.g = sp.genome; this.island = island;
    this.ang = 0.6; this.R = 300;
    this.hist = [];
    this.center = new THREE.Vector3(); this.radius = 30;
    this.tag = 'circle'; this.songT = 6;
    this.head = new THREE.Vector3();
    for (let i = 0; i < 240; i++) this.hist.push(this.path(this.ang - i * (0.4 / this.R), 0));
    this.head.copy(this.hist[0]);
  }
  path(a, t) {
    const c = this.island.pos;
    return new THREE.Vector3(c.x + Math.cos(a) * this.R * (1 + 0.15 * Math.sin(a * 2)), c.y + 95 + Math.sin(a * 3) * 30 + Math.sin(t * 0.1) * 8, c.z + Math.sin(a) * this.R);
  }
  step(dt, t = 0) {
    this.ang += dt * this.g.speed / this.R;
    this.head.copy(this.path(this.ang, t));
    this.hist.unshift(this.head.clone()); if (this.hist.length > 260) this.hist.pop();
  }
  update(dt, ctx) {
    this.step(dt, ctx.time);
    this.center.copy(this.hist[Math.min(40, this.hist.length - 1)]);
    this.songT -= dt;
    this.tag = ctx.glider.pos.distanceTo(this.center) < 90 ? 'close' : 'circle';
    if (this.songT < 0) { this.songT = ((ctx.night || 0) > 0.6 ? 7 : 14) + Math.random() * 12; this.singing = 4; if (ctx.audio) ctx.audio.whaleSong(this.center); }
    this.singing = Math.max(0, (this.singing || 0) - dt);
    if (this.singing > 0) this.tag = (ctx.night || 0) > 0.6 ? 'nightsong' : 'song';
  }
  draw(D, ctx) {
    const g = this.g, sp = this.sp;
    if (!this.hist.length) return;
    const L = g.length, N = g.segs;
    const seg = L / N;
    // resample the trail at exact arc-length intervals
    const pts = [this.hist[0].clone()];
    let want = seg, acc = 0;
    for (let i = 1; i < this.hist.length && pts.length < N + 1; i++) {
      const a = this.hist[i - 1], b = this.hist[i];
      const l = a.distanceTo(b);
      while (acc + l >= want && pts.length < N + 1) { pts.push(a.clone().lerp(b, (want - acc) / l)); want += seg; }
      acc += l;
    }
    if (pts.length < 4) return;
    const t = ctx.time;
    for (let i = 0; i < pts.length; i++) pts[i].y += Math.sin(t * 0.8 - i * 0.45) * (0.3 + i * 0.14);
    // extend a rounded nose
    const nose = pts[0].clone().add(pts[0].clone().sub(pts[1]).multiplyScalar(0.35));
    pts.unshift(nose);
    const girth = g.girth;
    const rad = pts.map((_, i) => {
      const u = i / (pts.length - 1);
      const head = Math.sqrt(Math.min(1, u / 0.14 + 0.08));
      const body = 1 - Math.pow(u, 1.5) * 0.88;
      return girth * head * body + 0.3;
    });
    rad[0] = girth * 0.35;
    const hsc = D.parts && D.parts.WhaleHead;
    const K = hsc ? 3 : 0, uk = K / (pts.length - 1);
    const F = D.tube(hsc ? pts.slice(K) : pts, hsc ? rad.slice(K) : rad, { rings: hsc ? 48 : 56, sp, squash: 0.86, up: UP, keepFrames: true });
    if (!F) return;
    for (const f of F) f.fw.negate();
    const fr = (u) => { u = hsc ? Math.max(0, (u - uk) / (1 - uk)) : u; return F[Math.min(F.length - 1, Math.round(u * (F.length - 1)))]; };
    const basisOf = (f) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.side, f.up, f.fw));
    let whq = null;
    if (hsc) { whq = basisOf(F[0]); D.part('WhaleHead', F[0].p, whq, F[0].r, sp, 1, this.singing > 0 ? 1.5 : 0, 0.5); }
    // eyes
    const fe = fr(0.07);
    this.gz = this.gz || new Gaze(mulberry32(7), 0.5); this.gz.tick(t);
    const wq = whq || new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fe.side, fe.up, fe.fw));
    const near = ctx.glider.pos.distanceTo(fe.p) < 160;
    for (const s of [-1, 1]) {
      const ep = whq ? anchorW(F[0].p, whq, ANCHORS.WhaleHead.eye, F[0].r, s) : fe.p.clone().addScaledVector(fe.side, s * fe.r * 0.84).addScaledVector(fe.up, fe.r * 0.02);
      const eq = splayQ(wq, s * 1.3);
      D.eye(ep, eq, whq ? ANCHORS.WhaleHead.eyeR * F[0].r * 1.05 : 0.9, { lid: sp.colA, iris: IRIS.whale, pupil: 0, blink: this.gz.blink, gaze: this.gz.look(ep, eq, near ? ctx.glider.pos : null, 0.7), glow: 0.3, sun: 1, sclera: 0.35, irisR: 0.55 });
    }
    // bioluminescent flank dots
    for (let i = 0; i < 12; i++) {
      const f = fr(0.16 + i * 0.05);
      for (const s of [-1, 1]) D.sphere(f.p.clone().addScaledVector(f.side, s * f.r * 0.93).addScaledVector(f.up, -f.r * 0.3), 0.5, SP_DOTS, 1, (this.singing > 0 ? 2.5 : 0.3) * (0.5 + 0.5 * Math.sin(t * 3 - i)), 0.8);
    }
    // pectoral and rear fins
    for (const [u, span] of [[0.24, g.fin], [0.55, g.fin * 0.5]]) {
      const f = fr(u);
      const q = basisOf(f);
      const flap = Math.sin(t * 0.9 - u * 4) * 0.35;
      for (const s of [-1, 1]) {
        if (D.parts && D.parts.WhaleFin) {
          // sculpted pectoral: mirrored for the left side, rolled down and flapping slowly
          const fq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(0.35 - flap) * s));
          D.part('WhaleFin', f.p.clone().addScaledVector(f.side, s * f.r * 0.72).addScaledVector(f.up, -f.r * 0.35), fq, new THREE.Vector3(span * s, span, span), sp, 1, 0, -1, sp.skin[1] * 0.6);
        } else {
          const fq = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s < 0 ? Math.PI : 0, (flap - 0.2) * s)));
          D.finAt(f.p.clone().addScaledVector(f.side, s * f.r * 0.7).addScaledVector(f.up, -f.r * 0.2), fq, span, span * 0.45, sp, 1);
        }
      }
    }
    // tail flukes
    const ft = F[F.length - 1];
    const tq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ft.side, ft.up, ft.fw));
    const fl = Math.sin(t * 0.8 - 6) * 0.25;
    if (D.parts && D.parts.WhaleFluke) {
      D.part('WhaleFluke', ft.p.clone().addScaledVector(ft.fw, ft.r * 0.5), tq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fl)), g.fin * 0.62, sp, 1, 0, -1, sp.skin[1] * 0.6);
    } else for (const s of [-1, 1]) {
      const fq = tq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(fl, s < 0 ? Math.PI * 0.78 : Math.PI * 0.22, 0)));
      D.finAt(ft.p, fq, g.fin * 0.6, g.fin * 0.32, sp, 1);
    }
  }
}
const SP_WEYE = { colA: new THREE.Vector3(0.05, 0.04, 0.06), colB: new THREE.Vector3(0.6, 0.9, 1.0), genome: { pattern: 0, pscale: 1, glow: 0.4 } };
const SP_DOTS = { colA: new THREE.Vector3(0.5, 0.9, 1.0), colB: new THREE.Vector3(0.55, 0.95, 1.0), genome: { pattern: 0, pscale: 1, glow: 0.8 } };

// ------------------------------------------------------------------ manager
export class Ecosystem {
  constructor(scene, islands, islandData) {
    this.D = new Draw(scene);
    this.islands = islands;
    this.list = [];
    this.bySpecies = {};
    for (const sp of SPECIES) this.bySpecies[sp.id] = [];
    const rnd = mulberry32(2024);
    const add = (c) => { this.list.push(c); this.bySpecies[c.sp.id].push(c); };
    const S = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
    // stiltwalker herd on Verdigris
    const I0 = islands[0], I1 = islands[1], I2 = islands[2];
    for (let i = 0; i < S.stilt.genome.count; i++) add(new Walker(S.stilt, { x: -65, z: -20, island: I0 }, rnd, { islands: [I0] }));
    // polyps on Verdigris rim
    const cand = islandData[0].candidates;
    let placed = 0;
    for (let i = 0; i < cand.length / 8 && placed < S.polyp.genome.count; i++) {
      const x = cand[i * 8], y = cand[i * 8 + 1], z = cand[i * 8 + 2];
      const r = Math.hypot(x, z);
      if (r < 70 || cand[i * 8 + 4] < 0.75 || y < -12) continue;
      if (I0.trees && I0.trees.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 60)) continue;
      if (this.bySpecies.polyp.some((p) => p.local.distanceTo(new THREE.Vector3(x, y, z)) < 10)) continue;
      add(new Polyp(S.polyp, I0, new THREE.Vector3(x, y - 0.3, z), new THREE.Vector3(cand[i * 8 + 3], cand[i * 8 + 4], cand[i * 8 + 5]).lerp(UP, 0.6).normalize(), rnd));
      placed++;
    }
    // kites around Ochre
    for (let i = 0; i < S.kite.genome.count; i++) add(new Kite(S.kite, I1, rnd, i));
    this.flock = this.bySpecies.kite;
    for (const w of this.bySpecies.stilt) w.herd = this.bySpecies.stilt;
    // crawlers on Ochre arches/buttes
    const starts = [[128, 26, -12], [-30, 58, -20], [25, 36, 38], [150, 10, -15], [-62, 24, 42], [100, 15, -20]];
    for (let i = 0; i < S.crawler.genome.count; i++) add(new Crawler(S.crawler, I1, rnd, new THREE.Vector3(...starts[i % starts.length])));
    // lanterns + whale at Coral
    for (let i = 0; i < S.lantern.genome.count; i++) add(new Lantern(S.lantern, I2, rnd, i));
    add(new Whale(S.whale, I2));
    this.hybridsSpawned = false;
  }
  setParts(parts) { this.D.setParts(parts); }
  spawnHybrids(seamLocal) {
    if (this.hybridsSpawned) return;
    this.hybridsSpawned = true;
    const rnd = mulberry32(99);
    const S = SPECIES[6];
    for (let i = 0; i < S.genome.count; i++) {
      const w = new Walker(S, { x: seamLocal.x, z: seamLocal.z, island: this.islands[0] }, rnd, { islands: [this.islands[0], this.islands[1]] });
      w.herd = this.bySpecies.hybrid;
      this.list.push(w); this.bySpecies.hybrid.push(w);
    }
  }
  update(dt, ctx) {
    for (const c of this.list) {
      if (c instanceof Kite) c.update(dt, ctx, this.flock); else c.update(dt, ctx);
    }
  }
  draw(ctx) {
    const D = this.D;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this._pm = this._pm || new THREE.Matrix4(); this._fr = this._fr || new THREE.Frustum(); this._sph = this._sph || new THREE.Sphere();
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._fr.setFromProjectionMatrix(this._pm);
    ctx.visible = (p, r) => { this._sph.center.copy(p); this._sph.radius = r; return this._fr.intersectsSphere(this._sph); };
    D.begin();
    this.list.forEach((c, i) => { if (c.uid === undefined) c.uid = this.uidNext = (this.uidNext || 0) + 1; D.owner(c.uid); c.draw(D, ctx); });
    D.end();
  }
}
