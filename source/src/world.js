// World: sky, islands (meshes, water, falls, flora), floating rocks, distant isles, thermals.
import * as THREE from 'three';
import { U, COMMON, srgb } from './glsl.js';
import { ISLANDS, makeSDF } from './islands-sdf.js';
import { mulberry32 } from './noise.js';
import { rockMaterial, rootMaterial, floraKitMaterial, groundGeometry } from './kit.js';

// ------------------------------------------------------------------ palettes
const PAL = [
  // rockA, rockB, rockC, top1, top2, under
  ['#c9a27e', '#9a5a46', '#ead7b8', '#5f9a74', '#a9c07a', '#463656'],
  ['#cf9a62', '#a65a42', '#e8cfa4', '#dcb585', '#cfa071', '#563a4c'],
  ['#e89c9e', '#b66b8f', '#f7d4c6', '#f1b4a6', '#93d0c2', '#4b3d66'],
];

// ------------------------------------------------------------------ sky
const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */ `
varying vec3 vDir;
${COMMON}
vec3 starField(vec3 d){
  // three layers of hashed stars on a cube-ish lattice
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float sc = 140.0 + float(i) * 170.0;
    vec3 p = d * sc;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(id + float(i) * 17.0);
    if (h > 0.986) {
      vec3 o = vec3(hash13(id + 3.1), hash13(id + 7.7), hash13(id + 1.3)) - 0.5;
      float r = length(f - o * 0.6);
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 6.0) + h * 40.0);
      float b = smoothstep(0.09, 0.0, r) * tw * (h - 0.986) * 70.0;
      vec3 c = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(id + 5.0));
      acc += c * b;
    }
  }
  return acc;
}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d);
  float sd = dot(d, uSunDisc);
  col += uSunColor * 7.0 * smoothstep(0.99955, 0.99985, sd) * uSunVis * smoothstep(-0.02, 0.01, d.y);
  // night: stars, moon, aurora
  if (uNight > 0.01 && d.y > -0.05) {
    float hz = smoothstep(-0.02, 0.25, d.y);
    col += starField(d) * uNight * hz;
    // milky band
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, -0.78))) * 3.2, 2.0));
    col += vec3(0.10, 0.08, 0.18) * band * fbm2(vec2(atan(d.z, d.x) * 3.0, d.y * 6.0)) * uNight * hz;
    // aurora curtains on the far side from the moon
    float azm = atan(d.z, d.x);
    float curtain = fbm2(vec2(azm * 4.0 + uTime * 0.03, uTime * 0.05)) ;
    float fold = sin(azm * 7.0 + curtain * 6.0 + uTime * 0.12) * 0.5 + 0.5;
    float hgt = smoothstep(0.08, 0.2, d.y) * (1.0 - smoothstep(0.2, 0.55, d.y + fold * 0.08));
    float away = smoothstep(0.1, -0.6, dot(normalize(d.xz), normalize(uSunDir.xz)));
    vec3 ac = mix(vec3(0.15, 1.0, 0.65), vec3(0.75, 0.3, 1.0), smoothstep(0.15, 0.45, d.y));
    col += ac * hgt * pow(fold, 3.0) * curtain * away * uNight * 0.55;
    // moon disc
    float md = dot(d, uSunDir);
    float disc = smoothstep(0.9991, 0.9994, md);
    float shade = 0.75 + 0.25 * vnoise(d * 900.0);
    col = mix(col, vec3(1.0, 0.97, 0.9) * 2.6 * shade, disc * uMoon);
  }
  // painterly high cloud streaks
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.16) * 1.6;
    uv += uWind * uTime * 0.004;
    vec2 su = mat2(0.86, 0.5, -0.5, 0.86) * uv;
    float n = fbm2(su * vec2(0.9, 3.4)) ;
    float n2 = fbm2(uv * 3.0 + n * 1.5);
    float dens = smoothstep(0.58, 0.86, n * 0.75 + n2 * 0.35) * smoothstep(0.0, 0.12, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    float fw = pow(max(sd, 0.0), 3.0);
    vec3 cc = mix(vec3(0.92, 0.68, 0.80), vec3(1.0, 0.70, 0.45) * 1.35, fw) * 0.8;
    cc = mix(cc * (uSunColor / 3.2), cc * 0.06, uNight);
    cc = mix(cc, skyColor(d) * 1.25, 0.25);
    col = mix(col, cc, dens * mix(0.6, 0.45, uNight));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSky() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: { ...U }, side: THREE.BackSide, depthWrite: false,
  }));
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ------------------------------------------------------------------ island material
const ISL_VS = /* glsl */ `
attribute float aAo; attribute float aSun;
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal; varying float vAo; varying float vSun;
uniform float uSunOverride;
void main(){
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp; n = mat3(instanceMatrix) * n;
#endif
  vec4 wp = modelMatrix * lp;
  vWorld = wp.xyz; vLocal = position; vNormal = normalize(mat3(modelMatrix) * n);
  vAo = aAo; vSun = mix(aSun, 1.0, uSunOverride);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ISL_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal; varying float vAo; varying float vSun;
${COMMON}
uniform vec3 uRockA, uRockB, uRockC, uTop1, uTop2, uUnder;
uniform vec4 uParams; // thickness, strataFreq, sandiness, seed
uniform float uDetail;
uniform sampler2D tRockD, tRockN, tMossD, tMossN;

vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(5.0)); return w / (w.x + w.y + w.z); }
// layered coordinates: side planes are squashed vertically so plates read as sedimentary beds
void triUV(vec3 p, float s, out vec2 ux, out vec2 uy, out vec2 uz){ ux = vec2(p.z, p.y * 1.7) * s; uy = p.xz * s; uz = vec2(p.x, p.y * 1.7) * s; }
vec4 triD(sampler2D t, vec2 ux, vec2 uy, vec2 uz, vec3 w){ return texture(t, ux) * w.x + texture(t, uy) * w.y + texture(t, uz) * w.z; }
vec3 triN(sampler2D t, vec2 ux, vec2 uy, vec2 uz, vec3 w, out float curv){
  vec4 a = texture(t, ux), b = texture(t, uy), c = texture(t, uz);
  curv = a.b * w.x + b.b * w.y + c.b * w.z;
  vec2 ta = a.xy * 2.0 - 1.0, tb = b.xy * 2.0 - 1.0, tc = c.xy * 2.0 - 1.0;
  return vec3(0.0, ta.y, ta.x) * w.x + vec3(tb.x, 0.0, tb.y) * w.y + vec3(tc.x, tc.y, 0.0) * w.z;
}

void main(){
  vec3 p = vLocal + uParams.w;
  vec3 n0 = normalize(vNormal);
  float dist = length(vWorld - uCamPos);
  float near = 1.0 - smoothstep(50.0, 240.0, dist);
  vec3 w = triW(n0);

  // ---- rock: two scales of the generated rock set
  vec2 ux, uy, uz;
  triUV(p, 1.0 / 17.0, ux, uy, uz);
  vec4 rd = triD(tRockD, ux, uy, uz, w);
  float rcurv; vec3 rpert = triN(tRockN, ux, uy, uz, w, rcurv);
  float rh = rd.r, rcav = rd.g, rtint = rd.b, lichen = rd.a;
  if (uDetail > 0.5 && near > 0.0) {
    vec2 vx, vy, vz; triUV(p + 7.3, 1.0 / 4.6, vx, vy, vz);
    vec4 rd2 = triD(tRockD, vx, vy, vz, w);
    float c2; vec3 rp2 = triN(tRockN, vx, vy, vz, w, c2);
    rpert += rp2 * 0.6 * near;
    rcav = max(rcav, rd2.g * 0.7 * near);
    rh = mix(rh, rh * 0.7 + rd2.r * 0.3, near);
    rcurv = mix(rcurv, max(rcurv, c2), 0.5 * near);
  }
  // strata palette
  float warp = fbm3(p * vec3(0.02, 0.05, 0.02)) * 7.0;
  float band = p.y * uParams.y + warp + rh * 1.2;
  float s1 = fract(band * 0.155);
  vec3 rock = mix(uRockA, uRockB, smoothstep(0.52, 0.6, s1) * 0.8);
  rock = mix(rock, uRockC, smoothstep(0.80, 0.84, s1) * 0.55);
  rock *= 0.9 + 0.1 * sin(band * 3.3);
  float streak = vnoise(vec3(p.x * 0.35, p.y * 0.018, p.z * 0.35));
  float steep = 1.0 - n0.y * n0.y;
  rock *= mix(1.0, 0.8, smoothstep(0.55, 0.9, streak) * steep);
  rock *= (0.74 + 0.48 * rh) * mix(0.88, 1.12, rtint);
  rock *= 1.0 - rcav * 0.4;
  rock = mix(rock, rock * 1.32 + 0.025, smoothstep(0.55, 0.85, rcurv) * 0.8);    // worn, sunlit edges
  rock = mix(rock, mix(uTop2, uTop1, 0.4) * 1.05, lichen * 0.45 * smoothstep(0.0, 0.6, n0.y));

  // ---- moss: grows on tops and fills hollows first
  float cn = fbm3(p * 0.06);
  float topN = smoothstep(0.5, 0.86, n0.y + (cn - 0.5) * 0.5);
  float mossAmt = 0.0; float mcav = 0.0; vec3 mpert = vec3(0.0); vec3 cover = vec3(0.0);
  if (topN > 0.005) {
    vec2 mx, my, mz; triUV(p + 3.1, 1.0 / 8.5, mx, my, mz);
    vec4 md = triD(tMossD, mx, my, mz, w);
    float mc; mpert = triN(tMossN, mx, my, mz, w, mc);
    mcav = md.g;
    mossAmt = smoothstep(0.44, 0.56, topN * 1.15 - 0.08 + (md.r - rh) * 0.55 + rcav * 0.25 * topN);
    cover = mix(uTop1, uTop2, smoothstep(0.38, 0.66, fbm3(p * 0.021 + 4.0)));
    cover *= (0.62 + 0.62 * md.r) * mix(0.86, 1.14, md.b);
    cover = mix(cover, cover * vec3(1.15, 1.1, 0.75) + 0.02, smoothstep(0.6, 0.95, mc) * 0.5);   // sunlit tips
    cover = mix(cover, vec3(1.0, 0.86, 0.7) * 0.9, md.a * 0.8);                                  // tiny flowers
  }
  vec3 alb = mix(rock, cover, mossAmt);
  float und = smoothstep(-uParams.x * 0.7, -uParams.x * 2.6, p.y);
  alb = mix(alb, uUnder * (0.8 + 0.4 * rh), und * 0.72);

  // ---- normal + light
  float bumpK = uDetail > 0.5 ? 1.0 : 0.6;
  vec3 n = normalize(n0 + mix(rpert * 1.0, mpert * 0.75, mossAmt) * bumpK);
  float cavAO = 1.0 - mix(rcav * 0.5, mcav * 0.35, mossAmt);
  float ao = vAo * cavAO * (0.8 + 0.2 * smoothstep(-0.2, 0.6, n.y));
  vec3 col = litSurface(alb, n, vWorld, vSun, ao, 0.12);
  // Moebius-style hatching in the shade (fades in close so it never fights the texture)
  float light = clamp(dot(n0, uSunDir), 0.0, 1.0) * vSun;
  float hl = sin(dot(vLocal, vec3(0.9, 1.6, 0.5)) * 2.2);
  float hw = fwidth(hl);
  float hatch = smoothstep(0.6 - hw, 0.6 + hw, hl) * (1.0 - smoothstep(0.0, 0.35, light)) * smoothstep(40.0, 120.0, dist) * (1.0 - smoothstep(160.0, 420.0, dist));
  col *= 1.0 - hatch * 0.14 * (1.0 - uNight);
  // bioluminescent moss at night
  if (uNight > 0.01 && uDetail > 0.5) {
    float sp = vnoise(p * 0.55) * 0.7 + vnoise(p * 1.9) * 0.3;
    float dots = smoothstep(0.74, 0.8, sp) * mossAmt;
    float vn = vnoise(p * vec3(0.12, 0.3, 0.12));
    float vw = fwidth(vn);
    float veins = (1.0 - smoothstep(vw * 0.6, vw * 2.0, abs(vn - 0.5))) * (1.0 - mossAmt) * 0.3 * smoothstep(0.55, 0.72, vnoise(p * 0.025 + 11.0));
    float pulse = 0.7 + 0.3 * sin(uTime * 0.9 + p.x * 0.05 + p.z * 0.04);
    col += mix(uTop2, vec3(0.3, 1.0, 0.85), 0.5) * (dots + veins + rcav * mossAmt * 0.15) * uNight * pulse * 1.6;
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

const SURF = { rock: null, moss: null };
export function setSurfaceTextures(t) { SURF.rock = t.rock; SURF.moss = t.moss; }

export function islandMaterial(palIndex, isl, detail = true) {
  const p = PAL[palIndex];
  return new THREE.ShaderMaterial({
    vertexShader: ISL_VS, fragmentShader: ISL_FS,
    uniforms: {
      ...U,
      uRockA: { value: srgb(p[0]) }, uRockB: { value: srgb(p[1]) }, uRockC: { value: srgb(p[2]) },
      uTop1: { value: srgb(p[3]) }, uTop2: { value: srgb(p[4]) }, uUnder: { value: srgb(p[5]) },
      uParams: { value: new THREE.Vector4(isl.thickness, isl.strataFreq, 0, isl.seed % 97) },
      uSunOverride: { value: 0 }, uDetail: { value: detail ? 1 : 0 },
      tRockD: { value: SURF.rock && SURF.rock.data }, tRockN: { value: SURF.rock && SURF.rock.normal },
      tMossD: { value: SURF.moss && SURF.moss.data }, tMossN: { value: SURF.moss && SURF.moss.normal },
    },
  });
}

function geomFrom(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('aAo', new THREE.BufferAttribute(m.ao, 1));
  g.setAttribute('aSun', new THREE.BufferAttribute(m.sun, 1));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ water
const WATER_VS = /* glsl */ `
varying vec3 vWorld;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WATER_FS = /* glsl */ `
varying vec3 vWorld;
${COMMON}
void main(){
  vec2 q = vWorld.xz * 0.25;
  float t = uTime;
  float h0 = vnoise2(q + vec2(t * 0.3, t * 0.2)) + 0.5 * vnoise2(q * 2.3 - vec2(t * 0.5, -t * 0.1));
  float hx = vnoise2(q + vec2(0.05, 0) + vec2(t * 0.3, t * 0.2)) + 0.5 * vnoise2((q + vec2(0.05, 0)) * 2.3 - vec2(t * 0.5, -t * 0.1));
  float hz = vnoise2(q + vec2(0, 0.05) + vec2(t * 0.3, t * 0.2)) + 0.5 * vnoise2((q + vec2(0, 0.05)) * 2.3 - vec2(t * 0.5, -t * 0.1));
  vec3 n = normalize(vec3((h0 - hx) * 2.5, 1.0, (h0 - hz) * 2.5));
  vec3 V = normalize(uCamPos - vWorld);
  vec3 R = reflect(-V, n);
  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 refl = skyColor(normalize(vec3(R.x, abs(R.y), R.z)));
  vec3 deep = vec3(0.04, 0.22, 0.24) * (ambientLight(vec3(0, 1, 0)) + uSunColor * 0.25);
  vec3 col = mix(deep, refl, fr);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 220.0) * 6.0;
  col += vec3(0.2, 0.9, 0.8) * uNight * 0.08 * (0.5 + 0.5 * sin(uTime + vWorld.x * 0.3));
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

const FALL_VS = /* glsl */ `
attribute vec2 aUv; attribute float aFade;
varying vec2 vUv2; varying float vFade; varying vec3 vWorld;
void main(){ vUv2 = aUv; vFade = aFade; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FALL_FS = /* glsl */ `
varying vec2 vUv2; varying float vFade; varying vec3 vWorld;
uniform float uMist;
${COMMON}
void main(){
  float u = vUv2.x, v = vUv2.y;
  float sp = 9.0 + v * 0.06;
  float s = vnoise2(vec2(u * 11.0, v * 0.06 - uTime * sp * 0.06)) * 0.6 + vnoise2(vec2(u * 37.0, v * 0.22 - uTime * sp * 0.22)) * 0.4;
  float edge = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u);
  float a;
  vec3 col;
  if (uMist > 0.5) {
    a = edge * (0.2 + 0.25 * s) * vFade;
    col = vec3(0.92, 0.95, 1.0);
  } else {
    a = edge * smoothstep(0.22, 0.7, s + 0.18 - (1.0 - edge) * 0.3) * vFade;
    col = mix(vec3(0.42, 0.78, 0.84), vec3(1.0, 0.99, 0.96), smoothstep(0.45, 0.85, s));
  }
  vec3 lit = col * (uSunColor * 0.42 + ambientLight(vec3(0.0, 0.3, 0.0)) * 0.9) + vec3(0.2, 0.7, 0.8) * uNight * 0.25 * col;
  lit = applyFog(lit, vWorld);
  gl_FragColor = vec4(lit, clamp(a, 0.0, 1.0));
}`;

function buildFall(f, isl) {
  // ballistic sheet
  const v0 = f.fromPool ? 4.2 : 2.2;
  const pts = [];
  let t = 0; const g = 9.8;
  while (true) {
    const y = f.lip[1] - 0.5 * g * t * t;
    pts.push([f.lip[0] + f.dir[0] * v0 * t, y, f.lip[2] + f.dir[2] * v0 * t]);
    if (y < -isl.thickness - 230) break;
    t += Math.max(0.05, 0.6 / (1 + g * t));
  }
  const side = [-f.dir[2], 0, f.dir[0]];
  const pos = [], uv = [], fade = [], idx = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const w = f.width * 1.5 * (1 + len * 0.005);
    const fd = Math.min(1, len / 4) * (1 - Math.max(0, Math.min(1, (len - 150) / 90)));
    for (let s = 0; s < 2; s++) {
      const k = (s - 0.5) * w;
      pos.push(pts[i][0] + side[0] * k, pts[i][1], pts[i][2] + side[2] * k);
      uv.push(s, len); fade.push(fd);
    }
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  return geo;
}

// ------------------------------------------------------------------ flora
const FLORA_VS = /* glsl */ `
attribute float aH; attribute vec2 aInst; // sun, sway
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vCol; varying float vH; varying float vSun; varying float vGust;
uniform float uFadeFar; uniform float uKind;
${COMMON}
void main(){
  vec3 p = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = length(wp.xyz - uCamPos);
  float sc = 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, dist);
  p *= sc;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  float ph = wp.x * 0.07 + wp.z * 0.05;
  float gust = smoothstep(0.38, 0.85, vnoise2(wp.xz * 0.016 - uWind * uTime * 0.5));
  float sway = ((sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.3) * (0.5 + 0.5 * gust) + gust * 1.1) * aInst.y;
  vGust = gust;
  w.xz += vec2(uWind.x, uWind.y) * sway * aH * aH;
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vCol = instanceColor; vH = aH; vSun = aInst.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLORA_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vCol; varying float vH; varying float vSun; varying float vGust;
uniform vec3 uBase; uniform float uGlow; uniform float uKind;
${COMMON}
void main(){
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 alb = mix(uBase, vCol, smoothstep(0.0, 1.0, vH));
  vec3 col = litSurface(alb, n, vWorld, vSun, 0.55 + 0.45 * vH, 0.5);
  vec3 V = normalize(uCamPos - vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  col += vCol * uSunColor * back * 0.35 * vSun * vH;
  col += vCol * (uGlow * (1.0 + uNight * 6.0) + uNight * 0.12) * vH * vH;
  col *= 1.0 + vGust * 0.28 * vH * (1.0 - uNight);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

function floraMaterial(base, glow, fadeFar, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader: FLORA_VS, fragmentShader: FLORA_FS,
    uniforms: { ...U, uBase: { value: srgb(base) }, uGlow: { value: glow }, uFadeFar: { value: fadeFar }, uKind: { value: 0 } },
    side,
  });
}

function tuftGeometry(blades = 5, curl = 0.35) {
  const pos = [], nor = [], h = [], idx = [];
  const rnd = mulberry32(17);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.6;
    const lean = 0.25 + rnd() * curl;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.09 + rnd() * 0.06;
    const base = pos.length / 3;
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const x = dx * lean * t * t, z = dz * lean * t * t, y = t * (0.85 + rnd() * 0.3);
      const ww = w * (1 - t * 0.92);
      pos.push(x - dz * ww, y, z + dx * ww, x + dz * ww, y, z - dx * ww);
      nor.push(dx * 0.4, 0.9, dz * 0.4, dx * 0.4, 0.9, dz * 0.4);
      h.push(t, t);
      if (s > 0) { const i = base + (s - 1) * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  g.setIndex(idx);
  return g;
}

function stalkGeometry(bend = 0.2) {
  const g = new THREE.CylinderGeometry(0.42, 1, 1, 8, 8, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position; const h = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + bend * y * y);
    h.push(y * 0.5);
  }
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  g.computeVertexNormals();
  return g;
}
function capGeometry(kind) {
  let g;
  if (kind === 'puff') { g = new THREE.SphereGeometry(1, 16, 12); g.scale(1, 0.72, 1); }
  else if (kind === 'umbrella') {
    g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42); g.scale(1, 0.55, 1);
  } else if (kind === 'spike') { g = new THREE.ConeGeometry(1, 1, 6, 1); g.translate(0, 0.5, 0); }
  else { g = new THREE.SphereGeometry(1, 14, 10); }
  const h = new Float32Array(g.attributes.position.count).fill(1);
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}

const FLORA_SPEC = [
  { // Verdigris
    tufts: { count: 9000, colors: ['#7fb36a', '#a9c47c', '#6a9f72', '#c9b866'], base: '#2b4a3a', scale: [1.6, 3.2], fade: 320 },
    trees: { count: 44, avoid: [-65, -20, 55], trunk: '#a8906e', caps: ['#e86a4a', '#f2b35e', '#6fb7a7', '#e98a6c'], cap: 'umbrella', h: [9, 24], capR: [4, 8.5], bend: 0.28 },
  },
  { // Ochre
    tufts: { count: 3200, colors: ['#c99a5b', '#9a7040', '#e0c07a'], base: '#5a3a28', scale: [1.2, 2.6], fade: 380 },
    trees: { count: 46, trunk: '#6f9fb0', caps: ['#7ec8e3', '#b9a6e8', '#9fe0d0'], cap: 'puff', h: [5, 14], capR: [2.0, 3.0], bend: 0.12, capStretch: 1.7, glow: 0.12, thick: 2.6, matchTrunk: true },
  },
  { // Coral
    tufts: { count: 5200, colors: ['#f08aa0', '#8fd6c2', '#f6c7a6', '#c3a0e6'], base: '#7a3b5a', scale: [1.4, 3.0], fade: 400 },
    trees: { count: 52, trunk: '#c98488', caps: ['#9fe2cf', '#fff1d8', '#ffc0b0'], cap: 'puff', h: [7, 20], capR: [3, 6.5], bend: 0.4, glow: 0.06 },
  },
];

function buildFlora(island, cand) {
  const spec = FLORA_SPEC[island.index];
  const rnd = mulberry32(island.spec.seed + 5);
  const group = new THREE.Group();
  const nC = cand.length / 8;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), pos = new THREE.Vector3();
  const col = new THREE.Color();
  // tufts
  {
    const t = spec.tufts;
    const mesh = new THREE.InstancedMesh(tuftGeometry(6), floraMaterial(t.base, 0, t.fade, THREE.DoubleSide), t.count);
    const inst = new Float32Array(t.count * 2);
    let n = 0;
    for (let i = 0; i < nC && n < t.count; i++) {
      const dens = cand[i * 8 + 6];
      if (rnd() > dens * 1.5 - 0.15) continue;
      const pl = island.spec.pool;
      if (pl && ((cand[i * 8] - pl.c[0]) / (pl.r[0] + 2)) ** 2 + ((cand[i * 8 + 2] - pl.c[2]) / (pl.r[1] + 2)) ** 2 < 1) continue;
      pos.set(cand[i * 8], cand[i * 8 + 1] - 0.15, cand[i * 8 + 2]);
      nrm.set(cand[i * 8 + 3], cand[i * 8 + 4], cand[i * 8 + 5]);
      q.setFromUnitVectors(up, nrm.lerp(up, 0.5).normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
      const s = t.scale[0] + (t.scale[1] - t.scale[0]) * rnd() * rnd();
      sc.set(s * (0.8 + rnd() * 0.5), s, s * (0.8 + rnd() * 0.5));
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(n, m4);
      col.set(t.colors[Math.floor(rnd() * t.colors.length)]).multiplyScalar(0.75 + rnd() * 0.4);
      mesh.setColorAt(n, col);
      inst[n * 2] = cand[i * 8 + 7]; inst[n * 2 + 1] = 0.35 + rnd() * 0.3;
      n++;
    }
    mesh.count = n;
    mesh.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  // trees: trunk + cap
  {
    const t = spec.trees;
    const trunk = new THREE.InstancedMesh(stalkGeometry(t.bend), floraMaterial(t.trunk, 0, 1600), t.count);
    const cap = new THREE.InstancedMesh(capGeometry(t.cap), floraMaterial('#000000', t.glow || 0, 1600, THREE.DoubleSide), t.count);
    const instT = new Float32Array(t.count * 2), instC = new Float32Array(t.count * 2);
    let n = 0;
    const placed = [];
    for (let i = nC - 1; i >= 0 && n < t.count; i--) {
      const ny = cand[i * 8 + 4];
      if (ny < 0.86) continue;
      const x = cand[i * 8], y = cand[i * 8 + 1], z = cand[i * 8 + 2];
      if (island.spec.pool && Math.hypot(x - island.spec.pool.c[0], z - island.spec.pool.c[2]) < 34) continue;
      if (placed.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 120)) continue;
      if (t.avoid && (x - t.avoid[0]) ** 2 + (z - t.avoid[1]) ** 2 < t.avoid[2] ** 2) continue;
      if (rnd() > 0.35 + cand[i * 8 + 6] * 0.5) continue;
      placed.push([x, z]);
      const h = t.h[0] + (t.h[1] - t.h[0]) * rnd();
      const r = (0.55 + h * 0.04) * (t.thick || 1);
      const yaw = rnd() * 6.28;
      q.setFromAxisAngle(up, yaw);
      pos.set(x, y - 0.5, z);
      m4.compose(pos, q, sc.set(r, h, r));
      trunk.setMatrixAt(n, m4);
      const capCol = t.caps[Math.floor(rnd() * t.caps.length)];
      col.set(t.matchTrunk ? capCol : t.trunk); if (t.matchTrunk) col.multiplyScalar(0.8); trunk.setColorAt(n, col);
      // cap position at top of bent trunk
      const tip = new THREE.Vector3(t.bend * h, h, 0).applyQuaternion(q).add(pos);
      const cr = t.capR[0] + (t.capR[1] - t.capR[0]) * rnd();
      sc.set(cr, cr * (t.capStretch || 1), cr);
      const cq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -t.bend * 0.8));
      m4.compose(tip.add(new THREE.Vector3(0, t.cap === 'puff' ? cr * 0.4 : t.cap === 'spike' ? -0.5 : -cr * 0.1, 0)), cq, sc);
      cap.setMatrixAt(n, m4);
      col.set(capCol); cap.setColorAt(n, col);
      instT[n * 2] = cand[i * 8 + 7]; instT[n * 2 + 1] = 0.05;
      instC[n * 2] = cand[i * 8 + 7]; instC[n * 2 + 1] = 0.0;
      n++;
    }
    trunk.count = n; cap.count = n;
    trunk.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(instT, 2));
    cap.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(instC, 2));
    trunk.frustumCulled = false; cap.frustumCulled = false;
    group.add(trunk, cap);
    island.trees = placed;
  }
  return group;
}


// ------------------------------------------------------------------ Blender kit flora + boulders
const KIT_TREES = [
  { variants: [['Parasol_A', 16], ['Parasol_B', 12], ['Parasol_C', 20]], sway: 0.05, smin: 0.6, smax: 1.3 },
  { variants: [['Lantern_A', 6.5], ['Lantern_B', 7.5]], sway: 0.03, smin: 1.0, smax: 1.8 },
  { variants: [['Coral_A', 12], ['Coral_B', 14]], sway: 0.06, smin: 0.8, smax: 1.6 },
];
const KIT_GROUND = [['Grass_A', 0.55], ['Grass_B', 0.33], ['Fern_A', 0.12]];
const STEM = ['#e4d6bd', '#d9c39a', '#eed3c8'];

function islandNormalAt(island, x, z) {
  const p = island.group.position, e = 1.2;
  const h = (a, b) => island.groundAt(a + p.x, b + p.z) - p.y;
  const nx = h(x - e, z) - h(x + e, z), nz = h(x, z - e) - h(x, z + e);
  const v = new THREE.Vector3(nx, 2 * e, nz);
  return isNaN(v.x + v.z) ? new THREE.Vector3(0, 1, 0) : v.normalize();
}

function buildFloraKit(island, cand, kit) {
  const spec = FLORA_SPEC[island.index];
  const ks = KIT_TREES[island.index];
  const pal = PAL[island.spec.palette];
  const rnd = mulberry32(island.spec.seed + 5);
  const group = new THREE.Group();
  group.userData.casters = [];
  const nC = cand.length / 8;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), pos = new THREE.Vector3();
  const col = new THREE.Color();
  const pool = island.spec.pool;
  const inPool = (x, z, pad) => pool && ((x - pool.c[0]) / (pool.r[0] + pad)) ** 2 + ((z - pool.c[2]) / (pool.r[1] + pad)) ** 2 < 1;

  // ---- ground cover: grass, flowering grass, ferns
  {
    const t = spec.tufts;
    const picks = [];
    for (let i = 0; i < nC && picks.length < t.count; i++) {
      const dens = cand[i * 8 + 6];
      if (rnd() > dens * 1.5 - 0.15) continue;
      if (inPool(cand[i * 8], cand[i * 8 + 2], 2)) continue;
      picks.push(i);
    }
    const meshes = KIT_GROUND.map(([name, share]) => {
      const n = Math.ceil(picks.length * share);
      const mesh = new THREE.InstancedMesh(groundGeometry(kit.flora[name]), floraMaterial(t.base, 0, t.fade, THREE.DoubleSide), n);
      mesh.userData.inst = new Float32Array(n * 2); mesh.userData.n = 0; mesh.userData.fern = name.startsWith('Fern');
      mesh.frustumCulled = false; group.add(mesh);
      return mesh;
    });
    for (const i of picks) {
      let r = rnd(), k = 0;
      while (k < KIT_GROUND.length - 1 && r > KIT_GROUND[k][1]) { r -= KIT_GROUND[k][1]; k++; }
      const mesh = meshes[k]; const ud = mesh.userData;
      if (ud.n >= mesh.count) continue;
      pos.set(cand[i * 8], cand[i * 8 + 1] - 0.15, cand[i * 8 + 2]);
      nrm.set(cand[i * 8 + 3], cand[i * 8 + 4], cand[i * 8 + 5]);
      q.setFromUnitVectors(up, nrm.lerp(up, 0.5).normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
      const s = (t.scale[0] + (t.scale[1] - t.scale[0]) * rnd() * rnd()) * (ud.fern ? 0.75 : 1);
      sc.set(s * (0.85 + rnd() * 0.4), s, s * (0.85 + rnd() * 0.4));
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(ud.n, m4);
      (ud.pos || (ud.pos = [])).push(pos.x, pos.z);
      col.set(t.colors[Math.floor(rnd() * t.colors.length)]).multiplyScalar((0.75 + rnd() * 0.4) * (ud.fern ? 0.85 : 1));
      mesh.setColorAt(ud.n, col);
      ud.inst[ud.n * 2] = cand[i * 8 + 7]; ud.inst[ud.n * 2 + 1] = (0.35 + rnd() * 0.3) * (ud.fern ? 0.6 : 1);
      ud.n++;
    }
    group.userData.ground = meshes;
    for (const mesh of meshes) {
      mesh.count = mesh.userData.n;
      mesh.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(mesh.userData.inst, 2));
    }
  }

  // ---- trees
  const placed = [];
  {
    const t = spec.trees;
    const chosen = [];
    for (let i = nC - 1; i >= 0 && chosen.length < t.count; i--) {
      if (cand[i * 8 + 4] < 0.86) continue;
      const x = cand[i * 8], y = cand[i * 8 + 1], z = cand[i * 8 + 2];
      if (pool && Math.hypot(x - pool.c[0], z - pool.c[2]) < 34) continue;
      if (placed.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 120)) continue;
      if (t.avoid && (x - t.avoid[0]) ** 2 + (z - t.avoid[1]) ** 2 < t.avoid[2] ** 2) continue;
      if (rnd() > 0.35 + cand[i * 8 + 6] * 0.5) continue;
      placed.push([x, z]);
      chosen.push({ x, y, z, sun: cand[i * 8 + 7], v: Math.floor(rnd() * ks.variants.length), h: t.h[0] + (t.h[1] - t.h[0]) * rnd(), yaw: rnd() * 6.28, cap: t.caps[Math.floor(rnd() * t.caps.length)] });
    }
    ks.variants.forEach(([name, href], vi) => {
      const list = chosen.filter((c) => c.v === vi);
      if (!list.length) return;
      const geo = kit.flora[name];
      const mat = floraKitMaterial(kit, { trunk: t.trunk, matchTrunk: !!t.matchTrunk, glow: t.glow || 0, height: geo.boundingBox.max.y, fade: 1600 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const inst = new Float32Array(list.length * 2);
      list.forEach((c, n) => {
        const s = Math.min(ks.smax, Math.max(ks.smin, c.h / href * (t.thick ? 0.9 : 1)));
        q.setFromAxisAngle(up, c.yaw);
        pos.set(c.x, c.y - 0.35 * s, c.z);
        m4.compose(pos, q, sc.set(s * (0.92 + rnd() * 0.16), s, s * (0.92 + rnd() * 0.16)));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, col.set(c.cap));
        inst[n * 2] = c.sun; inst[n * 2 + 1] = ks.sway;
      });
      mesh.geometry = geo.clone();
      mesh.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
      mesh.frustumCulled = false;
      mesh.userData.kind = 'tree:' + name;
      group.add(mesh); group.userData.casters.push(mesh);
    });
    island.trees = placed;
  }

  // ---- small mushroom clusters: at tree feet and in damp hollows
  {
    const spots = [];
    for (const [x, z] of placed) {
      if (rnd() < 0.7) { const a = rnd() * 6.28, d = 3.5 + rnd() * 4; spots.push([x + Math.cos(a) * d, z + Math.sin(a) * d]); }
      if (rnd() < 0.3) { const a = rnd() * 6.28, d = 5 + rnd() * 6; spots.push([x + Math.cos(a) * d, z + Math.sin(a) * d]); }
    }
    for (let i = 0; i < nC && spots.length < placed.length * 1.6 + 24; i += 7) {
      if (cand[i * 8 + 6] > 0.55 && cand[i * 8 + 4] > 0.8 && rnd() < 0.05) spots.push([cand[i * 8], cand[i * 8 + 2]]);
    }
    const p = island.group.position;
    const vars = ['Mushrooms_A', 'Mushrooms_B'];
    const byV = [[], []];
    for (const [x, z] of spots) {
      const gy = island.groundAt(x + p.x, z + p.z) - p.y;
      if (isNaN(gy) || inPool(x, z, 3)) continue;
      byV[rnd() < 0.55 ? 0 : 1].push([x, gy, z]);
    }
    const capCols = spec.trees.caps;
    vars.forEach((name, vi) => {
      const list = byV[vi]; if (!list.length) return;
      const geo = kit.flora[name].clone();
      const mat = floraKitMaterial(kit, { trunk: STEM[island.index], glow: (spec.trees.glow || 0) + 0.05, height: geo.boundingBox.max.y, fade: 420 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const inst = new Float32Array(list.length * 2);
      list.forEach(([x, y, z], n) => {
        const nn = islandNormalAt(island, x, z);
        q.setFromUnitVectors(up, nn.lerp(up, 0.6).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
        const s = 1.4 + rnd() * rnd() * 2.2;
        m4.compose(pos.set(x, y - 0.1, z), q, sc.setScalar(s));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, col.set(capCols[Math.floor(rnd() * capCols.length)]));
        inst[n * 2] = island.shadeAt(x + p.x, z + p.z) * 0.8; inst[n * 2 + 1] = 0.02;
      });
      geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
      mesh.userData.kind = 'mush:' + name;
      (group.userData.small || (group.userData.small = [])).push(mesh);
      mesh.frustumCulled = false; group.add(mesh);
    });
  }

  // ---- boulders: half-buried on the open, rocky ground
  {
    const names = ['Boulder_0', 'Boulder_1', 'Boulder_2', 'Boulder_3'];
    const want = 46 + Math.floor(rnd() * 20);
    const lists = names.map(() => []);
    const taken = [];
    let got = 0;
    for (let tries = 0; tries < nC && got < want; tries++) {
      const i = Math.floor(rnd() * nC);
      const dens = cand[i * 8 + 6], ny = cand[i * 8 + 4];
      if (ny < 0.6 || rnd() > (1 - dens) * 0.9 + 0.05) continue;
      const x = cand[i * 8], y = cand[i * 8 + 1], z = cand[i * 8 + 2];
      if (inPool(x, z, 4)) continue;
      if (placed.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 30)) continue;
      if (taken.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 40)) continue;
      taken.push([x, z]);
      const big = rnd();
      const s = 0.8 + big * big * 2.6;
      lists[Math.floor(rnd() * names.length)].push({ x, y, z, nx: cand[i * 8 + 3], ny, nz: cand[i * 8 + 5], s, sun: cand[i * 8 + 7] });
      // scatter a few smaller stones around the big ones
      if (s > 1.3) for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28, d = s * (2.2 + rnd() * 2.0);
        const p = island.group.position;
        const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d, gy = island.groundAt(xx + p.x, zz + p.z) - p.y;
        if (!isNaN(gy) && !inPool(xx, zz, 3)) lists[Math.floor(rnd() * names.length)].push({ x: xx, y: gy, z: zz, nx: 0, ny: 1, nz: 0, s: 0.3 + rnd() * 0.35, sun: cand[i * 8 + 7] });
      }
      got++;
    }
    // clear the grass off the stones so they read
    const stones = lists.flat();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const gm of group.userData.ground) {
      const P = gm.userData.pos || [];
      for (let i = 0; i < gm.count; i++) {
        const x = P[i * 2], z = P[i * 2 + 1];
        for (const b of stones) if ((b.x - x) ** 2 + (b.z - z) ** 2 < (b.s * 1.9) ** 2) { gm.setMatrixAt(i, zero); break; }
      }
      gm.instanceMatrix.needsUpdate = true;
    }
    const mat = rockMaterial(kit, pal, SURF, { strata: 3.2, tile: 12, seed: island.spec.seed % 37 });
    names.forEach((name, vi) => {
      const list = lists[vi]; if (!list.length) return;
      const geo = kit.rock[name].clone();
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const sun = new Float32Array(list.length);
      const hy = geo.boundingBox.min.y;
      list.forEach((b, n) => {
        nrm.set(b.nx, b.ny, b.nz).lerp(up, 0.45).normalize();
        q.setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
        m4.compose(pos.set(b.x, b.y + hy * b.s * 0.55, b.z), q, sc.set(b.s * (0.9 + rnd() * 0.2), b.s * (0.85 + rnd() * 0.3), b.s * (0.9 + rnd() * 0.2)));
        mesh.setMatrixAt(n, m4);
        sun[n] = b.sun;
      });
      geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(sun, 1));
      mesh.userData.kind = 'boulder:' + name;
      mesh.frustumCulled = false; group.add(mesh); group.userData.casters.push(mesh);
    });
  }
  return group;
}

// ------------------------------------------------------------------ Island runtime
export class Island {
  constructor(index, data, scene, kit) {
    this.index = index;
    this.spec = ISLANDS[index];
    this.name = this.spec.name;
    this.sdfFns = makeSDF(index);
    this.group = new THREE.Group();
    this.basePos = new THREE.Vector3(...this.spec.world);
    this.group.position.copy(this.basePos);
    this.offset = new THREE.Vector3(); // drift offset (convergence)
    this.bob = 0;
    const mat = islandMaterial(this.spec.palette, this.spec);
    this.mesh = new THREE.Mesh(geomFrom(data.hi), mat);
    this.group.add(this.mesh);
    this.loGeo = geomFrom(data.lo);
    this.height = data.height;
    this.falls = data.falls;
    this.material = mat;

    // water pool + channel
    if (this.spec.pool) {
      const pl = this.spec.pool;
      const wmat = new THREE.ShaderMaterial({ vertexShader: WATER_VS, fragmentShader: WATER_FS, uniforms: { ...U } });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), wmat);
      disc.rotation.x = -Math.PI / 2; disc.scale.set(pl.r[0], pl.r[1], 1);
      disc.position.set(pl.c[0], pl.level, pl.c[2]);
      this.group.add(disc);
      const f = this.falls.find((ff) => ff.fromPool);
      if (f) {
        const a = new THREE.Vector3(pl.c[0], pl.level, pl.c[2]);
        const b = new THREE.Vector3(...f.lip); b.y = pl.level;
        const len = a.distanceTo(b);
        const ch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wmat);
        ch.rotation.order = 'YXZ';
        ch.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); ch.rotation.x = -Math.PI / 2;
        ch.scale.set(f.width * 1.1, len, 1);
        ch.position.copy(a.clone().add(b).multiplyScalar(0.5));
        this.group.add(ch);
      }
    }
    // waterfalls
    this.fallMeshes = [];
    for (const f of this.falls) {
      const geo = buildFall(f, this.spec);
      const fm = new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: FALL_FS, uniforms: { ...U, uMist: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, fm);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.fallMeshes.push(mesh);
    }
    this.flora = kit ? buildFloraKit(this, data.candidates, kit) : buildFlora(this, data.candidates);
    this.group.add(this.flora);
    scene.add(this.group);
  }
  get pos() { return this.group.position; }
  // per-island culling for the kit: ground cover only when near, shadows only near the shadow focus
  lod(cam, focus, extent) {
    const ud = this.flora.userData;
    if (!ud.casters) return;
    const R = this.spec.radius || 150;
    const dc = Math.hypot(cam.x - this.pos.x, cam.z - this.pos.z) - R;
    const near = dc < 430;
    const gd = this.groundDensity ?? 1;
    for (const m of ud.ground) { m.visible = near; m.count = Math.floor(m.userData.n * gd); }
    if (ud.small) for (const m of ud.small) m.visible = dc < 470;
    const df = Math.hypot(focus.x - this.pos.x, focus.z - this.pos.z) - R;
    const cast = df < extent * 1.2;
    if (cast !== ud.casting) {
      ud.casting = cast;
      for (const m of ud.casters) { if (cast) m.layers.enable(3); else m.layers.disable(3); }
    }
  }
  sdfWorld(x, y, z) {
    const p = this.group.position;
    return this.sdfFns.sdf(x - p.x, y - p.y, z - p.z);
  }
  // world-space ground height (top surface) or NaN
  groundAt(x, z) {
    const h = this.height, p = this.group.position;
    const fx = (x - p.x - h.x0) / h.cell, fz = (z - p.z - h.z0) / h.cell;
    const i = Math.floor(fx), k = Math.floor(fz);
    if (i < 0 || k < 0 || i >= h.nx - 1 || k >= h.nz - 1) return NaN;
    const a = h.data[i + h.nx * k], b = h.data[i + 1 + h.nx * k], c = h.data[i + h.nx * (k + 1)], d = h.data[i + 1 + h.nx * (k + 1)];
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) return NaN;
    const u = fx - i, v = fz - k;
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v + p.y;
  }
  shadeAt(x, z) {
    const h = this.height, p = this.group.position;
    const i = Math.round((x - p.x - h.x0) / h.cell), k = Math.round((z - p.z - h.z0) / h.cell);
    if (i < 0 || k < 0 || i >= h.nx || k >= h.nz) return 1;
    return h.shade[i + h.nx * k];
  }
  update(t) {
    this.bob = Math.sin(t * 0.13 + this.index * 2.1) * 2.2;
    this.group.position.set(this.basePos.x + this.offset.x, this.basePos.y + this.offset.y + this.bob, this.basePos.z + this.offset.z);
  }
}

// ------------------------------------------------------------------ floating rocks
export class Rocklets {
  constructor(scene, rockData, islands) {
    const rnd = mulberry32(404);
    this.items = [];
    this.meshes = [];
    for (let v = 0; v < rockData.length; v++) {
      for (let pi = 0; pi < 3; pi++) {
        const mat = islandMaterial(pi, ISLANDS[pi], false);
        mat.uniforms.uSunOverride.value = 0.65;
        const geo = geomFrom(rockData[v]);
        const count = 6;
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.meshes.push(mesh);
        for (let i = 0; i < count; i++) {
          const isl = islands[pi];
          const ang = rnd() * Math.PI * 2;
          const r = isl.spec.radius + 60 + rnd() * 180;
          this.items.push({
            mesh, i, isl, local: new THREE.Vector3(Math.cos(ang) * r, -40 + rnd() * 110, Math.sin(ang) * r),
            scale: 0.6 + rnd() * rnd() * 2.4, yaw: rnd() * 6.28, spin: (rnd() - 0.5) * 0.05, phase: rnd() * 6.28,
          });
        }
      }
    }
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
  }
  update(t) {
    const { m4, q, p, s } = this;
    for (const it of this.items) {
      p.copy(it.local).add(it.isl.pos); p.y += Math.sin(t * 0.3 + it.phase) * 3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw + t * it.spin);
      s.setScalar(it.scale);
      m4.compose(p, q, s);
      it.mesh.setMatrixAt(it.i, m4);
      it.world = it.world || new THREE.Vector3(); it.world.copy(p);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}


// floating rocks from the Blender kit: four sculpted shapes with hanging roots, tinted per island
export class RockletsKit {
  constructor(scene, kit, islands) {
    const rnd = mulberry32(404);
    this.items = []; this.meshes = [];
    const names = ['FloatRock_0', 'FloatRock_1', 'FloatRock_2', 'FloatRock_3'];
    for (let pi = 0; pi < islands.length; pi++) {
      const isl = islands[pi];
      const pal = PAL[isl.spec.palette];
      const per = names.map(() => []);
      for (let i = 0; i < 7; i++) {
        const ang = rnd() * Math.PI * 2;
        const r = isl.spec.radius + 60 + rnd() * 180;
        per[Math.floor(rnd() * names.length)].push({
          isl, local: new THREE.Vector3(Math.cos(ang) * r, -40 + rnd() * 110, Math.sin(ang) * r),
          scale: 0.6 + rnd() * rnd() * 2.4, yaw: rnd() * 6.28, spin: (rnd() - 0.5) * 0.05, phase: rnd() * 6.28,
        });
      }
      const mat = rockMaterial(kit, pal, SURF, { under: 12, strata: 1.1, tile: 12, seed: pi * 11 });
      const rmat = rootMaterial(pal);
      names.forEach((name, vi) => {
        const list = per[vi]; if (!list.length) return;
        const geo = kit.rock[name].clone();
        geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(1), 1));
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        mesh.frustumCulled = false; scene.add(mesh); this.meshes.push(mesh);
        const rg = kit.rock[name + '_Roots'];
        const roots = rg ? new THREE.InstancedMesh(rg, rmat, list.length) : null;
        if (roots) { roots.frustumCulled = false; scene.add(roots); this.meshes.push(roots); }
        const rad = geo.boundingSphere.radius * 0.72;
        list.forEach((it, i) => { it.mesh = mesh; it.roots = roots; it.i = i; it.baseR = rad; this.items.push(it); });
      });
    }
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }
  update(t) {
    const { m4, q, p, s } = this;
    for (const it of this.items) {
      p.copy(it.local).add(it.isl.pos); p.y += Math.sin(t * 0.3 + it.phase) * 3;
      q.setFromAxisAngle(this.up, it.yaw + t * it.spin);
      s.setScalar(it.scale);
      m4.compose(p, q, s);
      it.mesh.setMatrixAt(it.i, m4);
      if (it.roots) it.roots.setMatrixAt(it.i, m4);
      it.world = it.world || new THREE.Vector3(); it.world.copy(p);
      it.radius = it.baseR * it.scale;
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ distant islands
export function distantIslands(scene, islands) {
  const rnd = mulberry32(77);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const per = 3;
  for (const isl of islands) {
    const mat = islandMaterial(isl.spec.palette, isl.spec, false);
    const mesh = new THREE.InstancedMesh(isl.loGeo, mat, per);
    for (let i = 0; i < per; i++) {
      const ang = (isl.index * per + i) / (per * 3) * Math.PI * 2 + rnd() * 0.3;
      const r = 3200 + rnd() * 2400;
      p.set(Math.cos(ang) * r + 150, 60 + rnd() * 380, Math.sin(ang) * r + 200);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.6 - 0.3);
      s.setScalar(0.9 + rnd() * 2.2);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    }
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

// ------------------------------------------------------------------ thermals (rising spore columns)
const THERM_VS = /* glsl */ `
attribute vec4 aSeed; // thermal index, phase, radius frac, size
uniform vec4 uTherm[12];
varying float vA; varying vec3 vC;
${COMMON}
void main(){
  int ti = int(aSeed.x);
  vec4 th = uTherm[ti];
  float H = 470.0 - 10.0;
  float y = mod(aSeed.y * H + uTime * (7.0 + aSeed.w * 4.0), H);
  float ang = aSeed.y * 40.0 + uTime * 0.35 + y * 0.02;
  float r = th.w * (0.15 + 0.85 * aSeed.z) * (0.75 + 0.4 * y / H);
  vec3 wp = vec3(th.x + cos(ang) * r, 10.0 + y, th.z + sin(ang) * r);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = clamp((0.5 + aSeed.w * 0.9) * 900.0 / dist, 1.0, 6.0);
  vA = smoothstep(0.0, 40.0, y) * smoothstep(H, H - 120.0, y) * (1.0 - smoothstep(380.0, 850.0, dist)) * smoothstep(8.0, 60.0, dist) * th.y;
  vC = mix(vec3(1.0, 0.86, 0.62), vec3(0.85, 1.0, 0.9), aSeed.z);
}`;
const THERM_FS = /* glsl */ `
varying float vA; varying vec3 vC; uniform float uNight;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC * (1.6 + uNight * 1.0), a * vA * 0.6); }`;

const COL_VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vY;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vY = position.y / 460.0 + 0.5; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const COL_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vY;
${COMMON}
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float edge = 1.0 - abs(dot(normalize(vN), V));
  float ang = atan(vN.z, vN.x);
  float streak = vnoise2(vec2(ang * 5.0, vWorld.y * 0.018 - uTime * 0.5)) * 0.7 + 0.3;
  float fade = smoothstep(0.0, 0.18, vY) * smoothstep(1.0, 0.6, vY);
  float dist = length(uCamPos - vWorld);
  float near = smoothstep(40.0, 220.0, dist);
  float a = pow(edge, 2.5) * streak * fade * (0.035 + 0.075 * near);
  gl_FragColor = vec4(mix(vec3(1.0, 0.82, 0.58) * 1.6, vec3(0.4, 0.9, 0.8) * 0.9, uNight), a * (1.0 - uNight * 0.35));
}`;

export class Thermals {
  constructor(scene, islands) {
    // [island index or -1, local/world x, z, radius, strength]
    this.defs = [
      [0, 168, 40, 50, 6.8], [0, -150, -95, 46, 6.2],
      [1, -130, 95, 48, 6.6], [1, 60, -160, 44, 6.0],
      [2, 150, -40, 48, 6.6], [2, -120, -120, 44, 6.2],
      [-1, 330, -140, 52, 7.0], [-1, -150, 400, 52, 7.0], [-1, 210, 380, 46, 6.4],
    ];
    this.islands = islands;
    this.list = this.defs.map((d) => ({ x: 0, z: 0, r: d[3], w: d[4], vis: 1 }));
    const per = 300;
    const n = this.defs.length * per;
    const seeds = new Float32Array(n * 4);
    const rnd = mulberry32(5);
    for (let i = 0; i < n; i++) { seeds[i * 4] = Math.floor(i / per); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = Math.sqrt(rnd()); seeds[i * 4 + 3] = rnd(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.uTherm = { value: Array.from({ length: 12 }, () => new THREE.Vector4()) };
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: THERM_VS, fragmentShader: THERM_FS, uniforms: { ...U, uTherm: this.uTherm },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.frustumCulled = false; m.renderOrder = 4;
    scene.add(m);
    // soft glowing column so thermals read from a distance
    const colMat = new THREE.ShaderMaterial({
      vertexShader: COL_VS, fragmentShader: COL_FS, uniforms: { ...U },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.cols = this.defs.map((d) => {
      const g2 = new THREE.CylinderGeometry(d[3] * 0.85, d[3] * 1.15, 460, 28, 1, true);
      const c = new THREE.Mesh(g2, colMat); c.renderOrder = 3; c.frustumCulled = false;
      scene.add(c); return c;
    });
    this.update();
  }
  update() {
    this.defs.forEach((d, i) => {
      let x = d[1], z = d[2];
      if (d[0] >= 0) { x += this.islands[d[0]].pos.x; z += this.islands[d[0]].pos.z; }
      const t = this.list[i]; t.x = x; t.z = z;
      this.uTherm.value[i].set(x, t.vis, z, d[3]);
      if (this.cols) this.cols[i].position.set(x, 240, z);
    });
  }
  // vertical air speed at a point
  lift(p) {
    let w = 0;
    for (const t of this.list) {
      const dx = p.x - t.x, dz = p.z - t.z;
      const r2 = (dx * dx + dz * dz) / (t.r * t.r);
      if (r2 < 1) w += t.w * (1 - r2) * (1 - Math.max(0, Math.min(1, (p.y - 440) / 60)));
      else if (r2 < 1.7) w -= 0.6 * (1 - (r2 - 1) / 0.7);
    }
    return w;
  }
}
