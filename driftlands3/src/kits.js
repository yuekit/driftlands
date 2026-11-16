// The two model kits of Driftlands III: Gaea (the Weavers' woven houses) and City in the Sky (the Windwrights' rust
// town). Every model is one mesh at three levels of detail. All of a kit's materials live in two texture arrays
// (colour + metal, normal + roughness + occlusion), picked per vertex, so a whole house is a single draw call and is
// lit by the game's own sun, sky, fog, ink and shadows. Each model also carries a small distance field for collisions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer, assetBitmap } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';
import { KITS, GAE, CSK } from './d3assets.js';

const SRC = { gae: GAE, csk: CSK };
const KIND = { '': 0, paper: 1, glass: 2, water: 3, lamp: 4, leaf: 5, thatch: 6, cloth: 7, decal: 8, wall: 9, weave: 10 };

U.uKitFlat = { value: 0.22 };    // how far the photographed textures are pulled toward their flat local colour (the plate look)
U.uLampK = { value: 0 };         // 0 by day .. 1 at night: how strongly lit paper, windows and lamps show

const VS = /* glsl */ `
attribute vec4 aData;
uniform float uObjScale; uniform vec4 uUvT;
uniform sampler2D tSpin; uniform float uSpinRow; uniform float uSpinAng;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vData;
void main(){
  vUv = uv * uUvT.zw + uUvT.xy; vData = aData;
  vec3 pos = position, nrm = normal;
  #ifndef FAR_LEVEL
  int sg = int(aData.b * 255.0 + 0.5);
  if (sg > 0) {
    // a rotor: turn this vertex about its hub (hub and reach in one row of the table, axis and rate in the next)
    vec4 h = texelFetch(tSpin, ivec2(sg - 1, int(uSpinRow)), 0), a = texelFetch(tSpin, ivec2(sg - 1, int(uSpinRow) + 1), 0);
    float ang = uSpinAng * a.w, c = cos(ang), sn = sin(ang);
    vec3 d = pos - h.xyz;
    pos = h.xyz + d * c + cross(a.xyz, d) * sn + a.xyz * dot(a.xyz, d) * (1.0 - c);
    nrm = nrm * c + cross(a.xyz, nrm) * sn + a.xyz * dot(a.xyz, nrm) * (1.0 - c);
  }
  #endif
  #ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
  #else
  mat4 m = modelMatrix;
  #endif
  vObj = position * uObjScale;
  vec4 wp = m * vec4(pos, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(m) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
precision highp sampler2DArray;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vData;
uniform sampler2DArray tCA; uniform sampler2DArray tNA; uniform sampler2DArray tCB; uniform sampler2DArray tNB;
uniform sampler2D tInfo;
uniform float uLit; uniform float uSeed; uniform vec3 uGlowCol; uniform float uKitFlat; uniform float uLampK; uniform float uSink;
${COMMON}
void main(){
  int id = int(vData.g * 255.0 + 0.5);
  vec4 I0 = texelFetch(tInfo, ivec2(id, 0), 0), I1 = texelFetch(tInfo, ivec2(id, 1), 0);
  vec2 gx = dFdx(vUv), gy = dFdy(vUv);
  vec3 uvw = vec3(vUv, I0.y);
  vec4 c, nt;
  if (I0.x < 0.5) { c = textureGrad(tCA, uvw, gx, gy); nt = textureGrad(tNA, uvw, gx, gy); }
  else { c = textureGrad(tCB, uvw, gx, gy); nt = textureGrad(tNB, uvw, gx, gy); }
  bool cut = I0.z > 0.5 && I0.z < 1.5;
  if (cut && c.a < 0.42) discard;
  int kind = int(I1.x + 0.5);
  float metal = I0.z > 0.5 ? I0.w : clamp((c.a * 255.0 - 1.0) / 254.0, 0.0, 1.0);
  vec3 Ng = normalize(vN); if (!gl_FrontFacing) Ng = -Ng;
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);
  // tangent frame from screen derivatives (the kits carry no tangents)
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
  vec3 dp2p = cross(dp2, Ng), dp1p = cross(Ng, dp1);
  vec3 T = dp2p * gx.x + dp1p * gy.x, B = dp2p * gx.y + dp1p * gy.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec2 tn = (nt.xy * 2.0 - 1.0) * vec2(1.0, -1.0);
  tn *= 1.0 - 0.7 * smoothstep(250.0, 900.0, dist);
  vec3 n = normalize(T * im * tn.x + B * im * tn.y + Ng * sqrt(max(1.0 - dot(tn, tn), 0.0)));
  float rough = clamp(nt.b, 0.06, 1.0);
  float ao = vData.r * mix(1.0, nt.a, 0.75);
  vec3 alb = c.rgb;
  // the plate look: local colour first, photographed grit second
  alb = mix(alb, I1.yzw * (0.6 + 0.8 * dot(alb, vec3(0.33)) / max(dot(I1.yzw, vec3(0.33)), 0.02)), uKitFlat);
  float wrap = 0.0, thin = 0.0;
  vec3 f0 = mix(vec3(0.04), alb, metal);
  vec3 em = vec3(0.0);
  float lamp = uLit * uLampK;
  if (kind == 1) {            // rice paper: sunlight comes through it by day, lamplight by night
    thin = 0.55; wrap = 0.35;
    float h = hash12(floor(vObj.xz * 0.11) + uSeed);
    em = (alb + 0.12) * uGlowCol * (0.85 + 0.12 * sin(uTime * (0.7 + h) + h * 30.0)) * lamp * 7.5;
  } else if (kind == 2) {     // glass: dark by day, a lit room behind some of the panes by night
    vec3 q = floor(vObj * 0.42 + 0.5 * Ng);
    float h = hash12(q.xz + q.y * 7.3 + uSeed), h2 = hash12(q.zx * 1.7 + q.y * 3.1 + uSeed);
    float on = step(1.0 - 0.72 * uLit, h);
    alb = mix(alb * 0.25, vec3(0.012, 0.02, 0.026), 0.6); rough = 0.14; metal = 0.0; f0 = vec3(0.07);
    em = mix(uGlowCol, vec3(1.0, 0.85, 0.6), h2) * on * (0.5 + 0.8 * h2) * uLampK * 2.6;
  } else if (kind == 3) {     // standing water in tanks and troughs
    alb = vec3(0.02, 0.09, 0.11); rough = 0.05; metal = 0.0; f0 = vec3(0.03);
  } else if (kind == 4) {     // lamp glass
    em = (alb + 0.15) * uGlowCol * (0.25 + 7.0 * lamp);
  } else if (kind == 9) {     // a house wall: by night a few small lit windows, shuttered and patched like everything else here
    if (uLampK > 0.02 && abs(Ng.y) < 0.4) {
      vec2 hd = normalize(vec2(Ng.z, -Ng.x) + 1e-5);
      vec2 g = vec2(dot(vObj.xz, hd), vObj.y) / vec2(3.1, 3.7);
      vec2 cell = floor(g), f = fract(g);
      float h = hash12(cell + floor(dot(vObj.xz, Ng.xz) * 0.06) * 17.0 + uSeed), h2 = hash12(cell * 1.7 + 31.0 + uSeed);
      float shape = smoothstep(0.0, 0.05, min(f.x - 0.36, 0.64 - f.x)) * smoothstep(0.0, 0.05, min(f.y - 0.34, 0.72 - f.y));
      // the cross of a window frame
      shape *= 1.0 - 0.8 * max(smoothstep(0.012, 0.0, abs(f.x - 0.5)), smoothstep(0.012, 0.0, abs(f.y - 0.55)));
      float on = step(1.0 - 0.42 * uLit, h);
      em = mix(uGlowCol, vec3(1.0, 0.85, 0.6), h2) * shape * on * (0.6 + 0.7 * h2) * uLampK * 4.0 * (0.9 + 0.1 * sin(uTime * (1.0 + 3.0 * h2) + h * 40.0));
    }
  } else if (kind == 10) {    // a woven wall: lamplight leaks through the weave from the rooms behind
    wrap = 0.15;
    if (uLampK > 0.02) {
      vec3 q = floor(vObj * 0.19);
      float h = hash12(q.xz + q.y * 5.1 + uSeed);
      float lum = dot(c.rgb, vec3(0.33));
      float rel = lum / max(dot(I1.yzw, vec3(0.33)), 0.02);      // the gaps of the weave are its dark places
      em = uGlowCol * smoothstep(1.05, 0.55, rel) * (0.15 + 0.85 * step(0.4, h)) * lamp * 3.2;
    }
  } else if (kind == 5) { wrap = 0.5; thin = 0.5; }
  else if (kind == 6) { wrap = 0.18; rough = max(rough, 0.8); }
  else if (kind == 7) { wrap = 0.28; thin = 0.3; }
  // rain darkens and glosses everything it reaches
  float wet = frontW(vWorld.xz) * uFrontK.y * smoothstep(-0.2, 0.5, Ng.y);
  alb *= 1.0 - 0.3 * wet; rough = mix(rough, 0.25, wet * 0.6);
  gHatchPos = vObj; gHatchN = Ng; gHatch = 0.8;
  vec3 col = litSurfacePBRx(alb * (1.0 - metal), n, Ng, vWorld, 1.0, ao, wrap, rough, f0);
  if (thin > 0.0) col += thinTransmission(alb, Ng, V, vWorld, 1.0, thin) * ao;
  col += em * (0.4 + 0.6 * ao);
  // a house that is losing the sky goes into the cloud: the fog takes it from below
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

// the far level: no textures, the material's own colour (with baked occlusion) at every vertex
const FS_FAR = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj; varying vec2 vUv; varying vec4 vData;
uniform float uLit; uniform float uSeed; uniform vec3 uGlowCol; uniform float uLampK;
${COMMON}
void main(){
  vec3 Ng = normalize(vN); if (!gl_FrontFacing) Ng = -Ng;
  vec3 alb = min(pow(vData.rgb, vec3(2.2)) * 1.7, vec3(0.9));
  vec3 col = litSurfacePBRx(alb, Ng, Ng, vWorld, 1.0, 1.0, 0.1, 0.8, vec3(0.04));
  float h = hash12(floor(vObj.xz * 0.2) + floor(vObj.y * 0.2) * 3.7 + uSeed);
  col += (alb + 0.05) * uGlowCol * vData.a * uLit * uLampK * (0.6 + 1.6 * h);
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

async function sized(asset, size) {
  let bmp = await assetBitmap(asset);
  if (bmp.width !== size || bmp.height !== size) {
    const small = await createImageBitmap(bmp, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bmp.close(); bmp = small;
  }
  return bmp;
}

// a texture array filled straight from decoded images, one layer at a time (no copies through JavaScript memory)
async function makeArray(renderer, assets, size, srgb, onLayer) {
  const gl = renderer.getContext(), layers = Math.max(1, assets.length);
  const tex = gl.createTexture();
  const bind = () => renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  bind();
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(size)) + 1, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, size, size, layers);
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const layer = next++;
      const bmp = await sized(assets[layer], size);
      bind();
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      bmp.close(); onLayer && onLayer();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  bind();
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const ext = renderer.extensions.get('EXT_texture_filter_anisotropic');
  if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  renderer.state.unbindTexture();
  // hand it to three as a texture it never uploads itself
  const t = new THREE.DataArrayTexture(null, size, size, layers);
  const props = renderer.properties.get(t); props.__webglTexture = tex; props.__webglInit = true;
  return t;
}

export class Kit {
  constructor(key) { this.key = key; this.info = KITS[key]; this.src = SRC[key]; this.geo = {}; this.sdfs = {}; this.seed = 0; }
  // names: the models to load (all of them if left out)
  async load(renderer, quality = 2, names = null, onProgress = () => {}) {
    const info = this.info, src = this.src;
    names = names || Object.keys(src.models);
    const k = quality >= 3 ? 1 : quality >= 1 ? 0.5 : 0.25;
    const sA = Math.max(256, info.sizeA * k), sB = Math.max(128, info.sizeB * k);
    let done = 0; const total = (src.texA.length + src.texB.length) * 2 + names.length;
    const tick = () => onProgress(++done / total);
    const [tCA, tNA, tCB, tNB] = await Promise.all([
      makeArray(renderer, src.texA.map((t) => t.c), sA, true, tick), makeArray(renderer, src.texA.map((t) => t.n), sA, false, tick),
      makeArray(renderer, src.texB.map((t) => t.c), sB, true, tick), makeArray(renderer, src.texB.map((t) => t.n), sB, false, tick),
    ]);
    const M = info.materials, W = 128, data = new Float32Array(W * 2 * 4);
    M.forEach((m, i) => {
      data.set([m.set, m.layer, m.cut ? 1 : m.flat ? 2 : 0, m.metal], i * 4);
      data.set([KIND[m.kind] || 0, m.avg[0], m.avg[1], m.avg[2]], (W + i) * 4);
    });
    const tInfo = new THREE.DataTexture(data, W, 2, THREE.RGBAFormat, THREE.FloatType);
    tInfo.minFilter = tInfo.magFilter = THREE.NearestFilter; tInfo.needsUpdate = true;
    // rotors: two rows a model (hub + reach, axis + rate), one column a rotor
    const all = Object.keys(info.models), SW = 256, sd = new Float32Array(SW * all.length * 2 * 4);
    this.spinRow = {};
    all.forEach((name, mi) => {
      this.spinRow[name] = mi * 2;
      (info.models[name].spin || []).forEach((r, k) => {
        const rate = (k % 2 ? -1 : 1) * Math.max(0.5, Math.min(5, 9 / r[6]));      // small rotors turn faster, neighbours opposite ways
        sd.set([r[0], r[1], r[2], r[6]], (mi * 2 * SW + k) * 4); sd.set([r[3], r[4], r[5], rate], ((mi * 2 + 1) * SW + k) * 4);
      });
    });
    const tSpin = new THREE.DataTexture(sd, SW, all.length * 2, THREE.RGBAFormat, THREE.FloatType);
    tSpin.minFilter = tSpin.magFilter = THREE.NearestFilter; tSpin.needsUpdate = true;
    this.shared = { tCA: { value: tCA }, tNA: { value: tNA }, tCB: { value: tCB }, tNB: { value: tNB }, tInfo: { value: tInfo }, tSpin: { value: tSpin } };
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let next = 0;
    const worker = async () => {
      while (next < names.length) {
        const name = names[next++], a = src.models[name];
        if (!a) { console.warn('kit model missing', this.key, name); tick(); continue; }
        const [buf, sdf] = await Promise.all([assetBuffer(a.glb), assetBuffer(a.sdf)]);
        const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
        const levels = [null, null, null];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          // undo the quantisation transform once, here (into plain floats: the packed integers cannot hold metres)
          const g = o.geometry, src = g.attributes.position, M = o.matrixWorld, arr = new Float32Array(src.count * 3), v = new THREE.Vector3();
          for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(M); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
          g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          if (g.attributes.color) { g.setAttribute('aData', g.attributes.color); g.deleteAttribute('color'); }
          g.computeBoundingSphere(); g.computeBoundingBox();
          levels[+o.name.slice(1)] = g;
        });
        this.geo[name] = levels; this.sdfs[name] = new Uint8Array(sdf);
        tick();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return this;
  }
  material(far, own) {
    return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: far ? FS_FAR : FS, defines: far ? { FAR_LEVEL: 1 } : {}, uniforms: { ...U, ...this.shared, ...own }, side: THREE.DoubleSide });
  }
  // one placed model with its three levels; the caller positions obj.group
  make(name, opts = {}) { return new KitObject(this, name, opts); }
  // many copies of a small model drawn together (no collision, one level)
  instanced(name, count, level = 1) {
    const g = this.geo[name][level] || this.geo[name][0];
    const own = { uLit: { value: 1 }, uSeed: { value: 0 }, uGlowCol: { value: new THREE.Vector3(1.0, 0.62, 0.3) }, uObjScale: { value: 1 }, uSink: { value: 0 }, uUvT: { value: new THREE.Vector4(...this.info.models[name].uv) }, uSpinRow: { value: this.spinRow[name] }, uSpinAng: { value: 0 } };
    const mesh = new THREE.InstancedMesh(g, this.material(false, own), count);
    mesh.frustumCulled = false; mesh.userData.own = own;
    return mesh;
  }
}

const _p = new THREE.Vector3(), _m = new THREE.Matrix4();
export class KitObject {
  constructor(kit, name, { scale = 1, glow = [1.0, 0.62, 0.3], cast = true } = {}) {
    this.kit = kit; this.name = name; this.meta = kit.info.models[name];
    if (!this.meta || !kit.geo[name]) throw new Error(`kit model ${kit.key}/${name} is not loaded`);
    this.group = new THREE.Group(); this.group.scale.setScalar(scale); this.scale = scale;
    this.own = { uLit: { value: 0 }, uSeed: { value: (kit.seed += 7.31) % 97 }, uGlowCol: { value: new THREE.Vector3(...glow) }, uObjScale: { value: scale }, uSink: { value: 0 }, uUvT: { value: new THREE.Vector4(...this.meta.uv) }, uSpinRow: { value: kit.spinRow[name] }, uSpinAng: { value: 0 } };
    const near = kit.material(false, this.own), far = kit.material(true, this.own);
    const G = kit.geo[name];
    this.levels = G.map((g, i) => { const m = new THREE.Mesh(g, i === 2 ? far : near); m.visible = false; m.matrixAutoUpdate = false; this.group.add(m); return m; });
    if (cast) {
      // shadows are cast by the middle level whatever is being shown
      this.caster = new THREE.Mesh(G[1], near); this.caster.layers.set(CASTER_LAYER); this.caster.matrixAutoUpdate = false; this.group.add(this.caster);
    }
    const b = this.meta, c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    this.localCentre = new THREE.Vector3(...c);
    this.localRadius = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
    this.centre = new THREE.Vector3(); this.radius = this.localRadius * scale;
    this.inv = new THREE.Matrix4(); this.level = -1; this.lit = 0; this.litGoal = 0; this.spin = 1; this.spinGoal = 1;
    this.sdfData = kit.sdfs[name];
  }
  // call after moving the group
  sync() {
    const g = this.group; g.updateMatrixWorld(true);
    this.inv.copy(g.matrixWorld).invert();
    this.centre.copy(this.localCentre).applyMatrix4(g.matrixWorld);
    this.radius = this.localRadius * g.scale.x; this.scale = g.scale.x;
  }
  place(x, y, z, yaw = 0) { this.group.position.set(x, y, z); this.group.rotation.set(0, yaw, 0); this.sync(); return this; }
  // which level to show from this camera; lodK > 1 keeps detail further out
  lod(cam, lodK = 1, dt = 0.016) {
    const d = Math.max(0, cam.distanceTo(this.centre) - this.radius), r = this.radius;
    let want = d < (60 + r * 1.6) * lodK ? 0 : d < (420 + r * 5) * lodK ? 1 : 2;
    // a little stickiness so a level does not flicker at its boundary
    if (this.level >= 0 && want !== this.level) { const edge = want < this.level ? 0.9 : 1.1; const d2 = d / edge; const w2 = d2 < (60 + r * 1.6) * lodK ? 0 : d2 < (420 + r * 5) * lodK ? 1 : 2; if (w2 === this.level) want = this.level; }
    if (want !== this.level) { this.levels.forEach((m, i) => { m.visible = i === want; }); this.level = want; }
    if (this.caster) this.caster.visible = d < 950;
    this.lit += (this.litGoal - this.lit) * Math.min(1, dt * 0.8); this.own.uLit.value = this.lit;
    this.spin += (this.spinGoal - this.spin) * Math.min(1, dt * 0.35); this.own.uSpinAng.value += dt * this.spin * 3.0;
  }
  // metres from a world point to the nearest part of the model (unsigned; a lower bound when far away)
  sdf(x, y, z) {
    const dc = Math.hypot(x - this.centre.x, y - this.centre.y, z - this.centre.z) - this.radius;
    const S = this.scale, s = this.meta.sdf, pad = s.dmax * S;
    if (dc > pad) return dc;
    const e = this.inv.elements;
    const lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const [nx, ny, nz] = s.dims, v = s.voxel, o = s.origin;
    let fx = (lx - o[0]) / v - 0.5, fy = (ly - o[1]) / v - 0.5, fz = (lz - o[2]) / v - 0.5, out = 0;
    if (fx < 0) { out += fx * fx; fx = 0; } else if (fx > nx - 1.001) { const d = fx - (nx - 1.001); out += d * d; fx = nx - 1.001; }
    if (fy < 0) { out += fy * fy; fy = 0; } else if (fy > ny - 1.001) { const d = fy - (ny - 1.001); out += d * d; fy = ny - 1.001; }
    if (fz < 0) { out += fz * fz; fz = 0; } else if (fz > nz - 1.001) { const d = fz - (nz - 1.001); out += d * d; fz = nz - 1.001; }
    const ix = fx | 0, iy = fy | 0, iz = fz | 0, tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const D = this.sdfData, i0 = ix + nx * (iy + ny * iz), sy = nx, sz = nx * ny;
    const c00 = D[i0] * (1 - tx) + D[i0 + 1] * tx, c10 = D[i0 + sy] * (1 - tx) + D[i0 + sy + 1] * tx;
    const c01 = D[i0 + sz] * (1 - tx) + D[i0 + sz + 1] * tx, c11 = D[i0 + sz + sy] * (1 - tx) + D[i0 + sz + sy + 1] * tx;
    const d = ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz) / 255 * s.dmax * S;
    return out > 0 ? Math.sqrt(out) * v * S + d : d;
  }
  // a point given in the model's own metres, in the world
  toWorld(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.group.matrixWorld); }
  // the model's lamps in the world (positions refreshed on each call)
  lampsWorld() {
    if (!this._lamps) this._lamps = this.meta.lamps.map(() => new THREE.Vector3());
    this.meta.lamps.forEach((l, i) => this._lamps[i].set(l[0], l[1], l[2]).applyMatrix4(this.group.matrixWorld));
    return this._lamps;
  }
}
