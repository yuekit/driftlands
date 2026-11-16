// The Tall City: a kit of 57 parts instanced 1,975 times, dressed in the game's own lighting, with a baked light
// volume (sky and sun visibility, distance to the nearest wall) that also serves collisions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer, assetTexture, assetGrey } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';
import { CITY_MATS } from './d2assets.js';
import cityGlb from './assets/d2/city.glb';
import cityBin from './assets/d2/city.bin';
import cityIndex from './assets/d2/city.json';
import volInfo from './assets/d2/cityvol.json';
import volUp from './assets/d2/cityvol_up.webp';
import volSun from './assets/d2/cityvol_sun.webp';
import volDist from './assets/d2/cityvol_dist.webp';
import volDn from './assets/d2/cityvol_dn.webp';

// where the city stands in the world and how much larger than the kit it is built (its makers were not our size)
// East of Verdigris Reach, so the run in has the low sun off the starboard bow: towers to port show their lit
// flanks, towers to starboard stand against the light.
export const CITY_POS = new THREE.Vector3(4105, 250, 565);
export const CITY_SCALE = 5;

U.uCityGlow = { value: 0.0 };                                   // 0 dormant .. 1 every window lit
U.uCityGlowCol = { value: new THREE.Vector3(1.0, 0.62, 0.28) };
U.uCityWave = { value: new THREE.Vector4(0, 0, 0, -1) };        // xyz centre, w radius of the wave of waking light
U.uCityAlarm = { value: 0.0 };                                  // red watch lights while the Tenders are hostile

const VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
void main(){
  vUv = uv;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
uniform sampler2D tC; uniform sampler2D tN; uniform sampler2D tE;
uniform float uCut; uniform float uMetal; uniform float uWin; uniform float uEmis; uniform float uNSign;
uniform float uCityGlow; uniform vec3 uCityGlowCol; uniform vec4 uCityWave; uniform float uCityAlarm;
${COMMON}
void main(){
  vec4 c = texture(tC, vUv);
  if (uCut > 0.5 && c.a < 0.5) discard;
  float metal = uCut > 0.5 ? uMetal : c.a;
  vec4 nt = texture(tN, vUv);
  vec3 Ng = normalize(vN); if (!gl_FrontFacing) Ng = -Ng;
  // tangent frame from screen derivatives (the kit has no tangents)
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld); vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
  vec3 dp2p = cross(dp2, Ng), dp1p = cross(Ng, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec2 tn = (nt.xy * 2.0 - 1.0) * vec2(1.0, uNSign);
  float dist = length(uCamPos - vWorld);
  tn *= 1.0 - 0.6 * smoothstep(400.0, 1400.0, dist);      // distant normals average out
  vec3 n = normalize(T * im * tn.x + B * im * tn.y + Ng * sqrt(max(1.0 - dot(tn, tn), 0.0)));
  float rough = clamp(nt.b, 0.08, 1.0);
  vec3 alb = c.rgb;
  // weather: soot streaks run down the walls, dust settles on ledges
  float streak = vnoise(vec3(vWorld.x * 0.11, vWorld.y * 0.012, vWorld.z * 0.11));
  float grime = smoothstep(0.35, 0.8, streak) * (1.0 - abs(Ng.y));
  alb *= 1.0 - 0.32 * grime;
  rough = mix(rough, 0.9, grime * 0.5);
  float ledge = smoothstep(0.75, 0.95, Ng.y) * (0.5 + 0.5 * vnoise(vWorld * 0.07));
  alb = mix(alb, vec3(0.30, 0.25, 0.24), ledge * 0.35);
  gHatchPos = vWorld; gHatchN = Ng; gHatch = 0.85;
  vec3 col = litSurfacePBRx(alb * (1.0 - metal), n, Ng, vWorld, 1.0, 1.0, 0.0, rough, mix(vec3(0.04), alb, metal));
  // ---- the city's own light
  vec3 em = texture(tE, vUv).rgb * uEmis;
  float wake = uCityWave.w < 0.0 ? 0.0 : smoothstep(uCityWave.w, uCityWave.w - 110.0, distance(vWorld, uCityWave.xyz));
  float glow = max(uCityGlow, wake);
  if (uWin > 0.0 && abs(Ng.y) < 0.35) {
    // windows cut for its makers: tall slots in the dark panels, lit from within floor by floor
    vec2 hd = normalize(vec2(Ng.z, -Ng.x) + 1e-5);
    vec2 g = vec2(dot(vWorld.xz, hd), vWorld.y) / vec2(7.0, 11.0);
    vec2 cell = floor(g), f = fract(g);
    float h = hash12(cell + floor(dot(vWorld.xz, Ng.xz) * 0.02) * 17.0);
    float h2 = hash12(cell * 1.7 + 31.0);
    float shape = smoothstep(0.0, 0.06, min(f.x - 0.3, 0.7 - f.x)) * smoothstep(0.0, 0.04, min(f.y - 0.18, 0.86 - f.y));
    float dark = smoothstep(0.10, 0.03, dot(c.rgb, vec3(0.33)));
    float lit = step(1.0 - (0.08 + 0.8 * glow), h);
    float flick = 0.85 + 0.15 * sin(uTime * (1.0 + h2 * 3.0) + h * 40.0);
    vec3 wc = mix(uCityGlowCol, vec3(1.0, 0.86, 0.6), h2 * 0.5) * (0.5 + h2);
    wc = mix(wc, vec3(1.0, 0.10, 0.05), uCityAlarm * step(0.8, h2));
    em += wc * shape * dark * lit * flick * (0.25 + 2.6 * glow + 1.2 * uCityAlarm * step(0.8, h2)) * uWin;
  }
  col += em * (1.0 + 2.0 * uNight);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

const WINDOWED = /^(wall|border dwn|bridge)/;
let BLACK = null;
const matCache = {};
// one of the kit's materials in the game's lighting (also used for the Tenders' craft, which come from the same kit)
export async function cityMaterial(name, renderer, quality = 2) {
  if (matCache[name]) return matCache[name];
  const M = CITY_MATS[name];
  if (!BLACK) { BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true; }
  const nMax = quality >= 3 ? 0 : quality >= 1 ? 1024 : 512, cMax = quality >= 1 ? 0 : 512;
  const [tC, tN, tE] = await Promise.all([assetTexture(M.c, { srgb: true, maxSize: cMax }), assetTexture(M.n, { maxSize: nMax }), M.e ? assetTexture(M.e, { srgb: true }) : BLACK]);
  for (const t of [tC, tN]) renderer.initTexture(t);
  return (matCache[name] = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { ...U, tC: { value: tC }, tN: { value: tN }, tE: { value: tE }, uCut: { value: M.cut ? 1 : 0 }, uMetal: { value: M.metal }, uWin: { value: WINDOWED.test(name) ? 1 : 0 }, uEmis: { value: M.e ? 6 : 0 }, uNSign: { value: -1 } },
    side: M.cut ? THREE.DoubleSide : THREE.FrontSide,
  }));
}

export class City {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.copy(CITY_POS);
    this.group.scale.setScalar(CITY_SCALE);
    this.S = CITY_SCALE;
    this.meshes = []; this.mats = {};
    this.parts = cityIndex.parts;
    this.bounds = cityIndex.bounds;
  }
  async load(renderer, onProgress = () => {}, quality = 2) {
    const [glbBuf, binBuf] = await Promise.all([assetBuffer(cityGlb), assetBuffer(cityBin)]);
    this.inst = new Float32Array(binBuf);
    const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(glbBuf, '', res, rej));
    const geo = {};
    gltf.scene.traverse((o) => { if (o.isMesh) geo[o.name] = o.geometry; });
    this.geo = geo;
    // materials, loading their textures as we go
    const names = [...new Set(this.parts.map((p) => p.mat))];
    let done = 0;
    await Promise.all(names.map(async (name) => { this.mats[name] = await cityMaterial(name, renderer, quality); onProgress(++done / (names.length + 1)); }));
    const m4 = new THREE.Matrix4();
    for (const p of this.parts) {
      const g = geo[p.name];
      if (!g) { console.warn('city part missing', p.name); continue; }
      const mesh = new THREE.InstancedMesh(g, this.mats[p.mat], p.count);
      for (let i = 0; i < p.count; i++) {
        const o = p.offset + i * 12, a = this.inst;
        m4.set(a[o], a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5], a[o + 6], a[o + 7], a[o + 8], a[o + 9], a[o + 10], a[o + 11], 0, 0, 0, 1);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.layers.enable(CASTER_LAYER);
      mesh.userData.part = p;
      this.group.add(mesh); this.meshes.push(mesh);
    }
    await this.loadVolume();
    onProgress(1);
    return this;
  }
  async loadVolume() {
    const [nx, ny, nz] = volInfo.dims, { cols } = volInfo;
    const chan = await Promise.all([volUp, volSun, volDist, volDn].map(assetGrey));
    const data = new Uint8Array(nx * ny * nz * 4);
    this.dist = new Uint8Array(nx * ny * nz);
    for (let z = 0; z < nz; z++) {
      const r = Math.floor(z / cols), c = z % cols;
      for (let y = 0; y < ny; y++) {
        const src = (r * ny + y) * chan[0].width + c * nx, dst = (z * ny + y) * nx;
        for (let x = 0; x < nx; x++) {
          const o = (dst + x) * 4;
          data[o] = chan[0].data[src + x]; data[o + 1] = chan[1].data[src + x]; data[o + 2] = chan[2].data[src + x]; data[o + 3] = chan[3].data[src + x];
          this.dist[dst + x] = chan[2].data[src + x];
        }
      }
    }
    const tex = new THREE.Data3DTexture(data, nx, ny, nz);
    tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1; tex.needsUpdate = true;
    this.volTex = tex;
    this.dims = [nx, ny, nz]; this.voxel = volInfo.voxel; this.origin = volInfo.origin; this.dmax = volInfo.dmax;
    this.syncUniforms();
  }
  // call after moving or rescaling the group
  syncUniforms() {
    const S = this.group.scale.x, p = this.group.position, [nx, ny, nz] = this.dims, v = this.voxel, o = this.origin;
    this.S = S;
    U.uCityVol.value = this.volTex;
    U.uVolO.value.set(p.x + o[0] * S, p.y + o[1] * S, p.z + o[2] * S);
    U.uVolInv.value.set(1 / (nx * v * S), 1 / (ny * v * S), 1 / (nz * v * S));
    U.uVolOff.value = v * S * 0.9;
    U.uVolOn.value = 1;
    this.min = new THREE.Vector3(p.x + this.bounds.min[0] * S, p.y + this.bounds.min[1] * S, p.z + this.bounds.min[2] * S);
    this.max = new THREE.Vector3(p.x + this.bounds.max[0] * S, p.y + this.bounds.max[1] * S, p.z + this.bounds.max[2] * S);
    this.centre = this.min.clone().add(this.max).multiplyScalar(0.5);
    this.radius = this.min.distanceTo(this.max) * 0.5;
  }
  toWorld(x, y, z, out = new THREE.Vector3()) { const p = this.group.position; return out.set(p.x + x * this.S, p.y + y * this.S, p.z + z * this.S); }
  // distance in metres from a world point to the nearest wall (approximate beyond the volume, capped at dmax inside it)
  sdf(x, y, z) {
    const S = this.S, p = this.group.position, o = this.origin, v = this.voxel, [nx, ny, nz] = this.dims;
    let fx = ((x - p.x) / S - o[0]) / v - 0.5, fy = ((y - p.y) / S - o[1]) / v - 0.5, fz = ((z - p.z) / S - o[2]) / v - 0.5;
    let out = 0;
    if (fx < 0) { out += fx * fx; fx = 0; } else if (fx > nx - 1.001) { const d = fx - (nx - 1.001); out += d * d; fx = nx - 1.001; }
    if (fy < 0) { out += fy * fy; fy = 0; } else if (fy > ny - 1.001) { const d = fy - (ny - 1.001); out += d * d; fy = ny - 1.001; }
    if (fz < 0) { out += fz * fz; fz = 0; } else if (fz > nz - 1.001) { const d = fz - (nz - 1.001); out += d * d; fz = nz - 1.001; }
    const ix = fx | 0, iy = fy | 0, iz = fz | 0, tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const D = this.dist, i0 = ix + nx * (iy + ny * iz), sx = 1, sy = nx, sz = nx * ny;
    const c00 = D[i0] * (1 - tx) + D[i0 + sx] * tx, c10 = D[i0 + sy] * (1 - tx) + D[i0 + sy + sx] * tx;
    const c01 = D[i0 + sz] * (1 - tx) + D[i0 + sz + sx] * tx, c11 = D[i0 + sz + sy] * (1 - tx) + D[i0 + sz + sy + sx] * tx;
    const d = ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz) / 255 * this.dmax * S;
    return out > 0 ? Math.sqrt(out) * v * S + Math.max(d, 0) : d;
  }
  grad(x, y, z, out = new THREE.Vector3(), e = 4) {
    out.set(this.sdf(x + e, y, z) - this.sdf(x - e, y, z), this.sdf(x, y + e, z) - this.sdf(x, y - e, z), this.sdf(x, y, z + e) - this.sdf(x, y, z - e));
    const l = out.length();
    return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 1, 0);
  }
  // sphere-trace a ray through the distance field; returns the distance to the first wall or -1
  raycast(o, d, maxT, hitR = 2.5) {
    let t = 0;
    for (let i = 0; i < 96 && t < maxT; i++) {
      const s = this.sdf(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (s < hitR) return t;
      t += Math.max(s - hitR * 0.5, 2);
    }
    return -1;
  }
  // world positions of every instance of the parts whose name starts with a prefix; with top = true, the middle of
  // the top of each one (a lamp's head, a mast's tip) rather than its origin
  instancesOf(prefix, top = false) {
    const out = [], a = this.inst;
    for (const p of this.parts) {
      if (!p.part.startsWith(prefix)) continue;
      let lx = 0, ly = 0, lz = 0;
      if (top && this.geo[p.name]) { const g = this.geo[p.name]; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; lx = (b.min.x + b.max.x) / 2; ly = b.max.y; lz = (b.min.z + b.max.z) / 2; }
      for (let i = 0; i < p.count; i++) {
        const o = p.offset + i * 12;
        out.push(this.toWorld(a[o] * lx + a[o + 1] * ly + a[o + 2] * lz + a[o + 3], a[o + 4] * lx + a[o + 5] * ly + a[o + 6] * lz + a[o + 7], a[o + 8] * lx + a[o + 9] * ly + a[o + 10] * lz + a[o + 11]));
      }
    }
    return out;
  }
}
