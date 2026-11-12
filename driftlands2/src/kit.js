// Blender-built nature kit: floating rocks, boulders, trees, small mushrooms, grass and ferns.
// Shapes and surface detail are baked in Blender; colour comes from each island's palette at runtime.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import rocksB64 from './assets/rocks.glb';
import floraB64 from './assets/flora.glb';
import { U, COMMON, srgb } from './glsl.js';
import { assetBuffer } from './assetbuf.js';

async function parse(asset) {
  const buf = await assetBuffer(asset);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
}
function collect(gltf) {
  const meshes = {}; let mat = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.attributes.uv && g.index && !g.attributes.tangent) g.computeTangents();
    g.computeBoundingBox(); g.computeBoundingSphere();
    meshes[o.name] = g;
    if (o.material && o.material.normalMap) mat = o.material;
  });
  return { meshes, mat };
}

export async function loadKit() {
  const [r, f] = await Promise.all([parse(rocksB64), parse(floraB64)]);
  const rock = collect(r), flora = collect(f);
  const aniso = (t) => { if (t) { t.anisotropy = 8; t.needsUpdate = true; } return t; };
  return {
    rock: rock.meshes, flora: flora.meshes,
    tex: {
      rockN: aniso(rock.mat.normalMap), rockD: aniso(rock.mat.roughnessMap || rock.mat.metalnessMap),
      floraC: aniso(flora.mat.map), floraN: aniso(flora.mat.normalMap), floraD: aniso(flora.mat.roughnessMap || flora.mat.metalnessMap),
    },
  };
}

// ------------------------------------------------------------------ rocks
const ROCK_VS = /* glsl */ `
attribute vec4 tangent; attribute float aSun;
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying float vSun;
void main(){
  vec4 lp = vec4(position, 1.0); vec3 n = normal; vec3 t = tangent.xyz;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp; n = mat3(instanceMatrix) * n; t = mat3(instanceMatrix) * t;
#endif
  vec4 wp = modelMatrix * lp;
  vWorld = wp.xyz; vLocal = position; vUv = uv; vSun = aSun;
  vN = normalize(mat3(modelMatrix) * n); vT = normalize(mat3(modelMatrix) * t); vTs = tangent.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ROCK_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying float vSun;
${COMMON}
uniform vec3 uRockA, uRockB, uRockC, uTop1, uTop2, uUnder;
uniform vec4 uParams;   // x: underside depth (0 = none), y: strata frequency, z: detail tiling, w: seed
uniform sampler2D tN, tD, tRockD, tRockN, tMossD;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 tt = vT - N * dot(N, vT);
  vec3 Tg = dot(tt, tt) > 1e-8 ? normalize(tt) : normalize(cross(N, vec3(0.0, 1.0, 0.3)));
  vec3 B = cross(N, Tg) * vTs;
  float dist = length(vWorld - uCamPos);
  float near = 1.0 - smoothstep(60.0, 260.0, dist);
  // baked sculpt detail + a tiled micro layer from the generated rock set
  vec3 tn = texture(tN, vUv).xyz * 2.0 - 1.0;
  vec2 duv = vUv * uParams.z;
  vec4 rd = texture(tRockD, duv);
  vec2 dn = (texture(tRockN, duv).xy * 2.0 - 1.0) * 0.55 * near;
  tn.xy += dn;
  vec3 n = normalize(Tg * tn.x + B * tn.y + N * tn.z);
  vec4 d = texture(tD, vUv);
  float ao = d.r, curv = (d.g - 0.5) * 2.0, moss = d.b;
  float rh = rd.r, rcav = rd.g * near;
  // strata palette (same recipe as the islands, in the rock's own space)
  vec3 p = vLocal + uParams.w;
  float warp = fbm3(p * vec3(0.06, 0.12, 0.06)) * 3.0;
  float band = p.y * uParams.y + warp + rh * 1.2;
  float s1 = fract(band * 0.155);
  vec3 rock = mix(uRockA, uRockB, smoothstep(0.52, 0.6, s1) * 0.8);
  rock = mix(rock, uRockC, smoothstep(0.80, 0.84, s1) * 0.55);
  rock *= 0.9 + 0.1 * sin(band * 3.3);
  rock *= (0.78 + 0.44 * rh) * mix(0.9, 1.1, rd.b);
  rock *= 1.0 - rcav * 0.35;
  rock = mix(rock, rock * 1.35 + 0.03, smoothstep(0.15, 0.7, curv) * 0.75);      // worn edges catch the light
  rock *= 1.0 - smoothstep(0.0, -0.7, curv) * 0.3;                             // grime in the cracks
  // moss from the baked mask, broken up by the moss texture
  vec4 md = texture(tMossD, duv * 1.7);
  float mossAmt = smoothstep(0.42, 0.62, moss + (md.r - 0.5) * 0.45 - rcav * 0.1);
  vec3 cover = mix(uTop1, uTop2, smoothstep(0.35, 0.65, fbm3(p * 0.09 + 4.0)));
  cover *= (0.62 + 0.62 * md.r) * mix(0.86, 1.14, md.b);
  cover = mix(cover, vec3(1.0, 0.86, 0.7) * 0.9, md.a * 0.6);
  vec3 alb = mix(rock, cover, mossAmt);
  if (uParams.x > 0.0) {
    float und = smoothstep(-uParams.x * 0.25, -uParams.x * 0.8, vLocal.y);
    alb = mix(alb, uUnder * (0.8 + 0.4 * rh), und * 0.6);
  }
  float occ = ao * (1.0 - rcav * 0.3);
  gHatchPos = vLocal; gHatchN = N; gHatch = 0.85 - 0.4 * mossAmt;
  vec3 col = litSurface(alb, n, vWorld, vSun, occ, 0.12);
  if (uNight > 0.01) {
    float sp = vnoise(p * 1.4) * 0.7 + vnoise(p * 4.1) * 0.3;
    float dots = smoothstep(0.72, 0.8, sp) * mossAmt;
    float pulse = 0.7 + 0.3 * sin(uTime * 0.9 + p.x * 0.3 + p.z * 0.2);
    col += mix(uTop2, vec3(0.3, 1.0, 0.85), 0.5) * (dots + smoothstep(0.0, -0.8, curv) * mossAmt * 0.2) * uNight * pulse * 1.6;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

export function rockMaterial(kit, pal, surf, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ROCK_VS, fragmentShader: ROCK_FS,
    uniforms: {
      ...U,
      uRockA: { value: srgb(pal[0]) }, uRockB: { value: srgb(pal[1]) }, uRockC: { value: srgb(pal[2]) },
      uTop1: { value: srgb(pal[3]) }, uTop2: { value: srgb(pal[4]) }, uUnder: { value: srgb(pal[5]) },
      uParams: { value: new THREE.Vector4(opts.under || 0, opts.strata || 0.9, opts.tile || 16, opts.seed || 0) },
      tN: { value: kit.tex.rockN }, tD: { value: kit.tex.rockD },
      tRockD: { value: surf.rock.data }, tRockN: { value: surf.rock.normal }, tMossD: { value: surf.moss.data },
    },
  });
}

// roots dangling under floating rocks: simple, wind-swayed
const ROOT_VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vDepth;
uniform float uTime; uniform vec2 uWind;
void main(){
  vec3 p = position;
  float hang = smoothstep(1.0, 9.0, -p.y);
  vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ph = wp0.x * 0.05 + wp0.z * 0.07 + p.x * 0.4;
  p.xz += (vec2(sin(uTime * 0.8 + ph), cos(uTime * 0.6 + ph * 1.3)) * 0.35 + uWind * 0.4) * hang * hang;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz; vDepth = -position.y;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ROOT_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vDepth;
uniform vec3 uCol, uTip;
${COMMON}
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 alb = mix(uCol, uTip, smoothstep(3.0, 10.0, vDepth)) * (0.85 + 0.3 * vnoise(vWorld * vec3(3.0, 0.4, 3.0)));
  vec3 col = litSurface(alb, n, vWorld, 0.8, 0.8, 0.3);
  col += uTip * uNight * 0.35 * smoothstep(4.0, 10.0, vDepth) * (0.6 + 0.4 * sin(uTime * 1.3 + vWorld.y * 0.6));
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;
export function rootMaterial(pal) {
  return new THREE.ShaderMaterial({
    vertexShader: ROOT_VS, fragmentShader: ROOT_FS, side: THREE.DoubleSide,
    uniforms: { ...U, uCol: { value: srgb(pal[5]).multiplyScalar(0.9) }, uTip: { value: srgb(pal[4]).multiplyScalar(0.8) } },
  });
}

// ------------------------------------------------------------------ flora
const FLORA_VS = /* glsl */ `
attribute vec4 tangent; attribute vec2 aInst;   // sun, sway
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying vec3 vCap; varying float vSun; varying float vGust;
uniform float uHeight; uniform float uFadeFar;
${COMMON}
void main(){
  vec4 wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = length(wp0.xyz - uCamPos);
  vec3 p = position * (1.0 - smoothstep(uFadeFar * 0.75, uFadeFar, dist));
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  float h = clamp(position.y / uHeight, 0.0, 1.2);
  float ph = wp0.x * 0.07 + wp0.z * 0.05;
  float gust = smoothstep(0.38, 0.85, vnoise2(wp0.xz * 0.016 - uWind * uTime * 0.5));
  float sway = ((sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.25) * (0.5 + 0.5 * gust) + gust * 0.9) * aInst.y;
  w.xz += uWind * sway * h * h * uHeight * 0.06 * (1.0 + 2.0 * uFrontK.z * frontW(wp0.xz));
  w.xyz += pushOffset(wp0.xyz, min(h, 1.0), min(uHeight * length(instanceMatrix[1].xyz) * 0.25, 1.2));
  vGust = gust;
  vWorld = w.xyz; vUv = uv; vCap = instanceColor; vSun = aInst.x;
  mat3 m = mat3(modelMatrix) * mat3(instanceMatrix);
  vN = normalize(m * normal); vT = normalize(m * tangent.xyz); vTs = tangent.w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLORA_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv; varying vec3 vCap; varying float vSun; varying float vGust;
uniform sampler2D tC, tN, tD;
uniform vec3 uTrunk; uniform float uMatchTrunk; uniform float uGlow;
${COMMON}
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 tt = vT - N * dot(N, vT);
  vec3 Tg = dot(tt, tt) > 1e-8 ? normalize(tt) : normalize(cross(N, vec3(0.0, 1.0, 0.3)));
  vec3 B = cross(N, Tg) * vTs;
  vec3 tn = texture(tN, vUv).xyz * 2.0 - 1.0;
  tn.xy *= 1.7;
  vec3 n = normalize(Tg * tn.x + B * tn.y + N * tn.z);
  vec3 base = texture(tC, vUv).rgb;
  vec4 d = texture(tD, vUv);
  float ao = d.r, tint = d.g, glow = d.b;
  vec3 trunk = mix(uTrunk, vCap * 0.8, uMatchTrunk);
  vec3 tc = tint < 0.5 ? mix(trunk * 1.5, vec3(1.0), tint * 2.0) : mix(vec3(1.0), vCap * 1.22, tint * 2.0 - 1.0);
  vec3 alb = base * tc;
  float capK = smoothstep(0.55, 0.9, tint);
  vec3 col = litSurface(alb, n, vWorld, vSun, ao, 0.45);
  vec3 V = normalize(uCamPos - vWorld);
  col += thinTransmission(vCap, n, V, vWorld, vSun, capK * 0.55) * ao;    // light through the caps and petals
  col += mix(tc, vCap, 0.5) * glow * (uGlow * (1.0 + uNight * 6.0) + uNight * 0.3) * (0.75 + 0.25 * sin(uTime * 0.8 + vWorld.x * 0.1));
  col *= 1.0 + vGust * 0.18 * capK * (1.0 - uNight);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

export function floraKitMaterial(kit, { trunk = '#a8906e', matchTrunk = false, glow = 0, height = 10, fade = 1600 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: FLORA_VS, fragmentShader: FLORA_FS, side: THREE.DoubleSide,
    uniforms: {
      ...U,
      tC: { value: kit.tex.floraC }, tN: { value: kit.tex.floraN }, tD: { value: kit.tex.floraD },
      uTrunk: { value: srgb(trunk) }, uMatchTrunk: { value: matchTrunk ? 1 : 0 }, uGlow: { value: glow },
      uHeight: { value: height }, uFadeFar: { value: fade },
    },
  });
}

// ground cover geometry for the existing tuft shader: add the 0..1 height attribute it sways with
export function groundGeometry(geo) {
  const g = geo.clone();
  const p = g.attributes.position; let top = 0;
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
  const h = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) h[i] = Math.max(0, p.getY(i)) / top;
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  // blade normals lean toward the sky so clumps light softly, like a lawn rather than paper strips
  const n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i); if (v.y < 0) v.negate();
    v.multiplyScalar(0.4).add(new THREE.Vector3(0, 0.9, 0)).normalize(); n.setXYZ(i, v.x, v.y, v.z);
  }
  // normalise to unit height so the old tuft scales still apply
  g.scale(1 / top, 1 / top, 1 / top);
  g.deleteAttribute('uv'); g.deleteAttribute('tangent');
  return g;
}
