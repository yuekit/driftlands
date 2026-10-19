// Render pipeline: scene -> volumetric clouds -> composite (+ink outlines) -> godrays -> bloom -> grade.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';

const VS = /* glsl */ `out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsQuad(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

function rt(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, generateMipmaps: false, ...opts,
  });
}

// High cumulus layer, shared by the cloud march and the cloud-shadow map.
const HIGH_GLSL = /* glsl */ `
const float HB = 380.0, HT = 620.0;
uniform sampler3D tNoise; uniform sampler3D tDetail; uniform float uCover;
float remap(float v, float a, float b, float c, float d){ return c + (v - a) / (b - a) * (d - c); }
vec3 highWind(){ return vec3(uWind.x, 0.0, uWind.y) * uTime * 9.0; }
float highCover(vec2 xz){
  vec4 wt = texture(tNoise, vec3(xz.x * 0.00011, 0.23, xz.y * 0.00011));
  float c = wt.a * 0.7 + wt.g * 0.3;
  return smoothstep(0.66 - uCover * 0.3, 0.84 - uCover * 0.3, c);
}
float highDensity(vec3 p, float lod){
  float h = (p.y - HB) / (HT - HB);
  if (h < 0.0 || h > 1.0) return 0.0;
  vec3 w = highWind();
  float cov = highCover(p.xz + w.xz);
  if (cov < 0.01) return 0.0;
  float topH = mix(0.35, 1.0, cov);                     // dense patches build taller towers
  float grad = smoothstep(0.0, 0.07, h) * smoothstep(topH, topH * 0.5, h);
  vec4 n = texture(tNoise, (p + w) * 0.0016);
  float fb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = clamp(remap(n.r, fb - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0) * grad;
  base = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
  if (base <= 0.0) return 0.0;
  if (lod < 0.5) {
    vec4 d4 = texture(tDetail, (p + w * 1.3) * 0.0052 + vec3(0.0, uTime * 0.004, 0.0));
    float dn = d4.r * 0.5 + d4.g * 0.32 + d4.b * 0.18;
    float dm = mix(dn, 1.0 - dn, clamp(h * 4.0, 0.0, 1.0));   // wispy underside, billowy tops
    base = clamp(remap(base, dm * 0.62, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return base * 0.09;
}`;

// Cloud shadow map: transmittance through the high layer along the sun, on a camera-centred grid.
const CLOUDSHADOW_FS = /* glsl */ `
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 fragColor;
${COMMON}
${HIGH_GLSL}
void main(){
  vec4 B = uCloudShadowBox;
  vec2 xz = B.xy + (vUv - 0.5) * 2.0 * B.z;
  vec3 sd = uSunDir / max(uSunDir.y, 0.12);
  float od = 0.0;
  for (int i = 0; i < 6; i++) {
    float y = HB + (HT - HB) * (float(i) + 0.5) / 6.0;
    vec3 p = vec3(xz, 0.0).xzy + sd * (y - B.w); p.y = y;
    od += highDensity(p, 1.0);
  }
  od *= (HT - HB) / 6.0 * length(sd);
  fragColor = vec4(exp(-od * 0.9), 0.0, 0.0, 1.0);
}`;

const CLOUD_FS = /* glsl */ `
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 fragColor;
${COMMON}
${HIGH_GLSL}
uniform sampler2D tDepth; uniform vec3 uCloudLo; uniform vec3 uCloudHi; uniform vec4 uIsl[4];
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform float uNear; uniform float uFar;
uniform vec2 uRes; uniform float uSteps; uniform float uFrame; uniform float uHigh; uniform float uShaft; uniform float uShaftSteps;

float linDepth(float z){ float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }

const float YB = -110.0;
float cloudTop(vec2 xz, out float tower){
  vec4 c = texture(tNoise, vec3(xz.x * 0.00045, 0.31, xz.y * 0.00045));
  tower = smoothstep(0.56, 0.86, c.a) * smoothstep(0.35, 0.7, c.b);
  vec4 c2 = texture(tNoise, vec3(xz.x * 0.0016, 0.71, xz.y * 0.0016));
  return uCloudTop + (c.b - 0.5) * 55.0 + (c2.a - 0.5) * 30.0 + tower * 110.0;
}
// mist skirts hanging beneath each island
float mistAmt(vec3 p){
  float m = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 I = uIsl[i];
    float dxz = length(p.xz - I.xz);
    float ring = smoothstep(I.w * 1.9, I.w * 0.7, dxz);
    float band = smoothstep(I.y - 175.0, I.y - 75.0, p.y) * (1.0 - smoothstep(I.y - 34.0, I.y + 4.0, p.y));
    m = max(m, ring * band);
  }
  return m;
}
// islands shade the clouds and mist below them
float islandShade(vec3 p){
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 I = uIsl[i];
    if (p.y > I.y - 8.0) continue;
    vec3 q = p + uSunDir * ((I.y - 20.0 - p.y) / max(uSunDir.y, 0.05));
    float d = length(q.xz - I.xz);
    s = min(s, mix(1.0, 0.18, smoothstep(I.w * 1.0, I.w * 0.55, d)));
  }
  return s;
}
float seaDensity(vec3 p, float lod){
  float md = 0.0;
  float mist = mistAmt(p);
  if (mist > 0.01) {
    vec3 w2 = vec3(uWind.x, 0.2, uWind.y) * uTime * 3.5;
    float n = texture(tNoise, (p + w2) * 0.0065).a * 0.6 + texture(tNoise, (p + w2 * 1.6) * 0.019).b * 0.4;
    md = clamp((n * mist - 0.3) * 1.8, 0.0, 1.0) * 0.024;
  }
  float tower; float top = cloudTop(p.xz, tower);
  float h = (p.y - YB) / (top - YB);
  if (h > 1.0 || h < 0.0) return md;
  vec3 w = vec3(uWind.x, 0.0, uWind.y) * uTime * 6.0;
  vec4 n = texture(tNoise, (p + w) * 0.0042);
  float shape = n.a * 0.55 + n.b * 0.45;
  float grad = smoothstep(1.0, mix(0.72, 0.55, tower), h) * smoothstep(0.0, 0.25, h);
  float base = clamp(remap(shape * grad, 0.12, 1.0, 0.0, 1.0), 0.0, 1.0);
  if (base <= 0.0) return md;
  if (lod < 0.5) {
    float dn = texture(tDetail, (p + w * 1.6) * 0.034 + vec3(0.0, uTime * 0.012, 0.0)).a;
    float dm = mix(dn, 1.0 - dn, clamp(h * 2.5, 0.0, 1.0));   // torn wisps low, cauliflower tops
    base = clamp(remap(base, dm * 0.45 * (1.0 - h * 0.35), 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return base * (0.055 + 0.04 * (1.0 - h)) + md;
}
float dens(int L, vec3 p, float lod){ return L == 0 ? seaDensity(p, lod) : highDensity(p, lod); }
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
// dual-lobe phase: a strong forward lobe gives silver linings around the sun
float phaseF(float c, float k){ return mix(hg(c, 0.68 * k), hg(c, -0.22 * k), 0.38) * 3.0 + 0.22; }
// one slab, front to back; returns its in-scattered light with aerial perspective applied
void march(int L, vec3 ro, vec3 rd, float t0, float t1, float steps, float jitter, float cosT, inout vec3 S, inout float T){
  float dt = L == 0 ? clamp((t1 - t0) / steps, 2.5, 90.0) : clamp((t1 - t0) / steps, 5.0, 260.0);
  // the high layer steps finer near the camera and coarser far away, so close clouds don't show slicing stripes
  if (L == 1) dt = clamp(12.0 + t0 * 0.035, 12.0, 260.0);
  float t = t0 + dt * jitter;
  float maxI = L == 0 ? steps * 1.5 : 80.0;
  float back = 0.0, fine = 0.0;
  float Tl = 1.0; vec3 Sl = vec3(0.0); float distAcc = 0.0, wAcc = 0.0;
  vec3 sunC = uSunColor * 1.15;
  float p0 = phaseF(cosT, 1.0), p1 = phaseF(cosT, 0.5), p2 = phaseF(cosT, 0.25);
  float ls0 = L == 0 ? 6.0 : 12.0;
  for (float i = 0.0; i < 128.0; i += 1.0) {
    if (i >= maxI || t > t1 || Tl * T < 0.015) break;
    if (L == 1) dt = clamp(12.0 + t * 0.035, 12.0, 260.0);
    vec3 p = ro + rd * t;
    float lod = t > (L == 0 ? 1600.0 : 7000.0) ? 1.0 : 0.0;
    float d = dens(L, p, lod);
    // landed in cloud after a long stride over clear sky: step back and come in at the fine step
    if (d > 0.0 && back > 0.0) { t -= back; back = 0.0; fine = 2.0; continue; }
    if (d > 0.0) {
      float od = 0.0; float ls = ls0; vec3 lp = p;
      int nl = L == 1 ? (lod > 0.5 ? 2 : 3) : 4;
      for (int j = 0; j < 4; j++) { if (j >= nl) break; lp += uSunDir * ls; od += dens(L, lp, j == 0 ? lod : 1.0) * ls; ls *= 2.3; }
      // multiple scattering: three octaves with weaker extinction and a broader phase
      float ms = exp(-od * 1.5) * p0 + 0.5 * exp(-od * 0.75) * p1 + 0.25 * exp(-od * 0.375) * p2;
      float powder = 1.0 - exp(-d * 60.0);
      float hh;
      if (L == 0) { float tower; float top = cloudTop(p.xz, tower); hh = clamp((p.y - YB) / (top - YB), 0.0, 1.0); }
      else hh = clamp((p.y - HB) / (HT - HB), 0.0, 1.0);
      vec3 amb = L == 0 ? mix(uCloudLo, uCloudHi, hh * hh) * (0.45 + 0.55 * hh)
                        : mix(uCloudLo, uCloudHi, hh) * (0.95 + 0.4 * hh) + uCloudHi * 0.4 * (1.0 - hh);   // the bright cloud sea lights the undersides
      float shade = L == 0 ? islandShade(p) * cloudShadowAt(p) : 1.0;
      vec3 Ls = sunC * ms * 0.8 * mix(0.55, 1.0, powder) * shade + amb;
      float tr = exp(-d * dt);
      Sl += Tl * (Ls - Ls * tr);
      distAcc += t * Tl * (1.0 - tr); wAcc += Tl * (1.0 - tr);
      Tl *= tr;
    }
    float st = dt * (d > 0.0 ? 1.0 : (L == 1 ? (fine > 0.0 ? 1.0 : 2.0) : 1.35));   // the high layer is mostly clear sky: stride over it
    back = d > 0.0 || L == 0 || fine > 0.0 ? 0.0 : st - dt;
    fine = max(fine - 1.0, 0.0);
    t += st;
  }
  if (wAcc <= 0.0) return;
  vec3 pp = ro + rd * (distAcc / wAcc);
  vec3 dir; float f = fogAmount(pp, dir);
  vec3 fc = skyColor(vec3(rd.x, max(rd.y, -0.05) * 0.4, rd.z)) + mieGlow(rd);
  Sl = mix(Sl, fc * (1.0 - Tl), f * 0.92);
  S += T * Sl; T *= Tl;
}
// volumetric sun shafts: march the cascaded shadow map through a thin height-varying haze
// returns (forward-scattered light in lit haze, fraction of the haze in shadow)
vec4 shafts(vec3 ro, vec3 rd, float tMax, float cosT, float jitter){
  float n = uShaftSteps;
  float dt = tMax / n;
  float t = dt * jitter;
  float lit = 0.0, shd = 0.0, Th = 1.0;
  for (float i = 0.0; i < 32.0; i += 1.0) {
    if (i >= n) break;
    vec3 p = ro + rd * t;
    float sig = 0.0004 + 0.005 * exp(-max(p.y - uCloudTop, 0.0) / 60.0);
    float vis = hardShadow(p) * mix(1.0, cloudShadowAt(p), 0.35);
    lit += Th * vis * sig * dt;
    shd += Th * (1.0 - vis) * sig * dt;
    Th *= exp(-sig * dt);
    t += dt;
  }
  float ph = max(hgPhase(cosT, 0.6) - 0.05, 0.0);       // only the forward excess: the fog already holds the rest
  return vec4(uSunColor * lit * ph * uSunVis * 0.35, shd);
}
vec2 slab(vec3 ro, vec3 rd, float y0, float y1, float tMax){
  float t0, t1;
  if (abs(rd.y) < 1e-4) { t0 = 0.0; t1 = (ro.y > y0 && ro.y < y1) ? 9000.0 : -1.0; }
  else { float ta = (y0 - ro.y) / rd.y, tb = (y1 - ro.y) / rd.y; t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb); }
  return vec2(t0, min(t1, tMax));
}

void main(){
  vec2 uv = vUv;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); v /= v.w;
  vec3 dv = normalize(v.xyz);
  vec3 rd = normalize((uCamWorld * vec4(dv, 0.0)).xyz);
  vec3 ro = uCamPos;
  float zr = texture(tDepth, uv).r;
  float sceneDist = zr >= 0.99999 ? 1e9 : linDepth(zr) / max(-dv.z, 1e-4);
  float yTop = max(uCloudTop + 135.0, 196.0);
  vec2 A = slab(ro, rd, YB, yTop, min(sceneDist, 9000.0));
  vec2 Bh = uHigh > 0.5 ? slab(ro, rd, HB, HT, min(sceneDist, 12000.0)) : vec2(1.0, 0.0);
  float cosT = dot(rd, uSunDir);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803398875);
  float T = 1.0; vec3 S = vec3(0.0);
  float hs = max(12.0, uSteps * 0.4);
  bool aOk = A.y > A.x, bOk = Bh.y > Bh.x;
  if (aOk && bOk && Bh.x < A.x) {
    march(1, ro, rd, Bh.x, Bh.y, hs, jitter, cosT, S, T);
    march(0, ro, rd, A.x, A.y, uSteps, jitter, cosT, S, T);
  } else {
    if (aOk) march(0, ro, rd, A.x, A.y, uSteps, jitter, cosT, S, T);
    if (bOk) march(1, ro, rd, Bh.x, Bh.y, hs, jitter, cosT, S, T);
  }
  if (uShadowOn > 0.5 && uShaft > 0.0) {
    vec4 sh = shafts(ro, rd, min(min(sceneDist, A.y > A.x ? A.x + 40.0 : 1e9), 800.0), cosT, jitter);
    float f = 1.0 - clamp(sh.a * 0.75 * uShaft * uSunVis, 0.0, 0.4);   // haze in shadow scatters no sunlight
    S = S * f + sh.rgb * uShaft; T *= f;
    if (uShaft > 5.0) { S = vec3(sh.a * 4.0, dot(sh.rgb, vec3(0.3)) * 4.0, 0.0); T = 0.0; }
  }
  fragColor = vec4(S, T);
}`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tCloud; uniform sampler2D tAO;
uniform vec2 uRes; uniform vec2 uCloudRes; uniform vec2 uAORes; uniform float uNear; uniform float uFar; uniform float uInk; uniform float uAOStr;
uniform mat4 uProj; uniform mat4 uInvProj; uniform vec3 uSunView; uniform float uContact; uniform float uFrame;
float linDepth(float z){ float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
vec3 viewAt(vec2 uv, float z){ vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
// screen-space contact shadows: a short march toward the sun through the depth buffer grounds feet, stems and petals
float contactShadow(vec2 uv, float z){
  vec3 P = viewAt(uv, z);
  float dist = -P.z;
  if (dist > 90.0) return 0.0;
  float len = clamp(dist * 0.035, 0.25, 2.2);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803398875);
  float occ = 0.0;
  for (int i = 0; i < 10; i++) {
    float t = (float(i) + jit) / 10.0;
    vec3 S = P + uSunView * len * t + vec3(0.0, 0.0, 0.02 * dist * 0.01);
    vec4 c = uProj * vec4(S, 1.0);
    vec2 su = c.xy / c.w * 0.5 + 0.5;
    if (su.x < 0.0 || su.y < 0.0 || su.x > 1.0 || su.y > 1.0) break;
    float sz = texture(tDepth, su).r;
    if (sz >= 0.99999) continue;
    float dz = viewAt(su, sz).z - S.z;            // > 0: the depth buffer is in front of the ray
    float thick = 0.05 + dist * 0.004;
    if (dz > thick * 0.3 && dz < len * 1.5 + thick) { occ = 1.0 - t * 0.6; break; }
  }
  return occ * (1.0 - smoothstep(45.0, 90.0, dist));
}
void main(){
  vec2 px = 1.0 / uRes;
  vec3 col = texture(tScene, vUv).rgb;
  float zr = texture(tDepth, vUv).r;
  float d0 = linDepth(zr);
  // ambient occlusion, depth-aware upsample from half resolution
  if (uAOStr > 0.0 && zr < 0.99999) {
    vec2 ap = vUv * uAORes - 0.5; vec2 ab = floor(ap); vec2 af = ap - ab;
    float aacc = 0.0, aw = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec2 tc = (ab + vec2(i, j) + 0.5) / uAORes;
      float zs = texture(tDepth, tc).r;
      float ds = zs >= 0.99999 ? 1e6 : linDepth(zs);
      float wd = 1.0 / (1e-3 + abs(ds - d0) / max(d0, 1.0) * 60.0);
      float wb = (i == 0 ? 1.0 - af.x : af.x) * (j == 0 ? 1.0 - af.y : af.y);
      aacc += texture(tAO, tc).r * (wb * wd + 1e-5); aw += wb * wd + 1e-5;
    }
    float ao = aacc / aw;
    col *= mix(1.0, ao * ao, uAOStr);
  }
  if (uContact > 0.0 && zr < 0.99999) col *= 1.0 - contactShadow(vUv, zr) * 0.5 * uContact;
  // ink outline (Moebius): depth discontinuities on the near side
  if (uInk > 0.0 && zr < 0.99999) {
    float e = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = i == 0 ? vec2(px.x, 0) : i == 1 ? vec2(-px.x, 0) : i == 2 ? vec2(0, px.y) : vec2(0, -px.y);
      float zn = texture(tDepth, vUv + o * 1.25).r;
      float dn = zn >= 0.99999 ? 1e6 : linDepth(zn);
      e = max(e, (dn - d0) / d0);
    }
    float edge = smoothstep(0.035, 0.12, e) * (1.0 - smoothstep(250.0, 1400.0, d0));
    col = mix(col, col * vec3(0.18, 0.12, 0.2), edge * uInk);
  }
  // depth-aware upsample of the half-res cloud buffer
  vec2 cp = vUv * uCloudRes - 0.5;
  vec2 base = floor(cp); vec2 f = cp - base;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 tc = (base + vec2(i, j) + 0.5) / uCloudRes;
    float zs = texture(tDepth, tc).r;
    float ds = zs >= 0.99999 ? 1e6 : linDepth(zs);
    float dr = zr >= 0.99999 ? 1e6 : d0;
    float wd = 1.0 / (1e-3 + abs(ds - dr) / max(dr, 1.0) * 40.0);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float w = wb * wd + 1e-5;
    acc += texture(tCloud, tc) * w; wsum += w;
  }
  vec4 c = acc / wsum;
  col = col * c.a + c.rgb;
  if (!(col.r == col.r && col.g == col.g && col.b == col.b)) col = vec3(0.6, 0.55, 0.6);
  fragColor = vec4(min(col, vec3(60.0)), 1.0);
}`;

const AO_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uRes; uniform float uFrame; uniform float uRadius;
vec3 viewPos(vec2 uv){ float z = texture(tDepth, uv).r; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main(){
  float z = texture(tDepth, vUv).r;
  if (z >= 0.99999) { fragColor = vec4(1.0); return; }
  vec2 px = 2.0 / uRes;
  vec3 P = viewPos(vUv);
  vec3 Px = viewPos(vUv + vec2(px.x, 0.0)), Pnx = viewPos(vUv - vec2(px.x, 0.0));
  vec3 Py = viewPos(vUv + vec2(0.0, px.y)), Pny = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(Px.z - P.z) < abs(P.z - Pnx.z) ? Px - P : P - Pnx;
  vec3 dy = abs(Py.z - P.z) < abs(P.z - Pny.z) ? Py - P : P - Pny;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, -P) < 0.0) N = -N;
  float R = clamp(-P.z * 0.035, 0.8, 4.0) * uRadius;
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803398875);
  float occ = 0.0;
  const int NS = 10;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + ign) / float(NS);
    float a = (float(i) * 2.39996 + ign * 6.2831853);
    float zc = fract(fi * 7.31 + ign) * 2.0 - 1.0;
    float rr = sqrt(max(0.0, 1.0 - zc * zc));
    vec3 d = vec3(cos(a) * rr, sin(a) * rr, zc);
    if (dot(d, N) < 0.0) d = -d;
    d = normalize(d + N * 0.15);
    vec3 S = P + d * R * mix(0.15, 1.0, fi * fi);
    vec4 c = uProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, R / max(abs(P.z - sz), 1e-3));
    occ += step(S.z + 0.04 * R, sz) * range;
  }
  float ao = 1.0 - occ / float(NS);
  ao = mix(1.0, ao, 1.0 - smoothstep(180.0, 520.0, -P.z));
  fragColor = vec4(ao, ao, ao, 1.0);
}`;

const TAA_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth;
uniform mat4 uInvVP; uniform mat4 uPrevVP; uniform vec2 uRes; uniform float uReset; uniform float uFeedback; uniform vec2 uNF;
uniform sampler2D tVel; uniform float uVelOn;
vec3 toYC(vec3 c){ return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYC(vec3 y){ return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
vec3 tm(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itm(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
void main(){
  vec2 px = 1.0 / uRes;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cur = vec3(0.0);
  float closest = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * px;
    vec3 c = toYC(tm(max(texture(tCur, vUv + o).rgb, 0.0)));
    if (x == 0 && y == 0) cur = c;
    m1 += c; m2 += c * c;
    closest = min(closest, texture(tDepth, vUv + o).r);
  }
  vec3 mu = m1 / 9.0; vec3 sig = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
  vec3 lo = mu - 1.2 * sig, hi = mu + 1.2 * sig;
  vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, closest * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec4 pc = uPrevVP * wp; vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  // objects that move on their own carry their own motion vectors
  float zc = texture(tDepth, vUv).r;
  float linC = 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - (zc * 2.0 - 1.0) * (uNF.y - uNF.x));
  vec4 mv = uVelOn > 0.5 ? texture(tVel, vUv) : vec4(0.0);
  bool useVel = mv.a > 0.5 && abs(mv.z - linC) < 0.03 * linC + 0.3;
  if (useVel) puv = vUv - mv.xy;
  vec3 hist = toYC(tm(max(texture(tHist, puv).rgb, 0.0)));
  hist = clamp(hist, lo, hi);
  float fb = uFeedback;
  if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0 || uReset > 0.5) fb = 0.0;
  float vel = length((puv - vUv) * uRes);
  fb *= mix(1.0, 0.8, clamp(vel / 40.0, 0.0, 1.0));
  // things riding with the camera (the glider) cannot be reprojected from depth alone
  float lin = 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - (closest * 2.0 - 1.0) * (uNF.y - uNF.x));
  if (!useVel) fb *= mix(0.45, 1.0, smoothstep(14.0, 30.0, lin));
  vec3 res = fromYC(mix(cur, hist, fb));
  fragColor = vec4(itm(clamp(res, 0.0, 0.999)), 1.0);
}`;

const RAYMASK_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
${COMMON}
uniform sampler2D tDepth; uniform sampler2D tCloud; uniform mat4 uInvProj; uniform mat4 uCamWorld;
void main(){
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); v /= v.w;
  vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz), 0.0)).xyz);
  float sky = texture(tDepth, vUv).r >= 0.99999 ? 1.0 : 0.0;
  float T = texture(tCloud, vUv).a;
  float s = max(dot(rd, uSunDisc), 0.0);
  float m = max(dot(rd, uSunDir), 0.0);
  float glow = (pow(s, 60.0) * 3.0 + pow(s, 8.0) * 0.25) * uSunVis + (pow(m, 120.0) * 4.0 + pow(m, 12.0) * 0.2) * uMoon;
  fragColor = vec4(uSunColor * glow * sky * T * 0.25, 1.0);
}`;

const RADIAL_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tMask; uniform vec2 uSun; uniform float uAmt;
void main(){
  vec2 d = (uSun - vUv); float n = 48.0;
  vec2 st = d / n * 0.95;
  vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0;
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  uv += st * jit;
  for (int i = 0; i < 48; i++) { acc += texture(tMask, uv).rgb * w; w *= 0.965; uv += st; }
  fragColor = vec4(acc / n * uAmt, 1.0);
}`;

const THRESH_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 c = vec3(0.0);
  c += texture(tSrc, vUv + uTexel * vec2(-1, -1)).rgb; c += texture(tSrc, vUv + uTexel * vec2(1, -1)).rgb;
  c += texture(tSrc, vUv + uTexel * vec2(-1, 1)).rgb; c += texture(tSrc, vUv + uTexel * vec2(1, 1)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(1.1, 3.0, l);
  fragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;
const DOWN_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 a = texture(tSrc, vUv + uTexel * vec2(-2, -2)).rgb, b = texture(tSrc, vUv + uTexel * vec2(0, -2)).rgb, c = texture(tSrc, vUv + uTexel * vec2(2, -2)).rgb;
  vec3 d = texture(tSrc, vUv + uTexel * vec2(-2, 0)).rgb, e = texture(tSrc, vUv).rgb, f = texture(tSrc, vUv + uTexel * vec2(2, 0)).rgb;
  vec3 g = texture(tSrc, vUv + uTexel * vec2(-2, 2)).rgb, h = texture(tSrc, vUv + uTexel * vec2(0, 2)).rgb, i = texture(tSrc, vUv + uTexel * vec2(2, 2)).rgb;
  vec3 j = texture(tSrc, vUv + uTexel * vec2(-1, -1)).rgb, k = texture(tSrc, vUv + uTexel * vec2(1, -1)).rgb;
  vec3 l = texture(tSrc, vUv + uTexel * vec2(-1, 1)).rgb, m = texture(tSrc, vUv + uTexel * vec2(1, 1)).rgb;
  vec3 r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  fragColor = vec4(r, 1.0);
}`;
const UP_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tSrc; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uMix;
void main(){
  vec3 s = vec3(0.0);
  s += texture(tSrc, vUv + uTexel * vec2(-1, -1)).rgb; s += texture(tSrc, vUv + uTexel * vec2(0, -1)).rgb * 2.0; s += texture(tSrc, vUv + uTexel * vec2(1, -1)).rgb;
  s += texture(tSrc, vUv + uTexel * vec2(-1, 0)).rgb * 2.0; s += texture(tSrc, vUv).rgb * 4.0; s += texture(tSrc, vUv + uTexel * vec2(1, 0)).rgb * 2.0;
  s += texture(tSrc, vUv + uTexel * vec2(-1, 1)).rgb; s += texture(tSrc, vUv + uTexel * vec2(0, 1)).rgb * 2.0; s += texture(tSrc, vUv + uTexel * vec2(1, 1)).rgb;
  s /= 16.0;
  fragColor = vec4(texture(tPrev, vUv).rgb + s * uMix, 1.0);
}`;

const FINAL_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tSrc; uniform sampler2D tBloom; uniform sampler2D tRays;
uniform float uTime; uniform float uExposure; uniform float uLens; uniform float uFlash; uniform vec3 uFlashColor;
uniform vec2 uRes; uniform float uFade; uniform float uRayAmt; uniform float uShake; uniform float uSpeedFx; uniform float uSharpen;
uniform sampler2D tAdapt; uniform float uAutoAmt; uniform float uAutoKey; uniform float uTone;
uniform vec3 uLift; uniform vec3 uGain; uniform float uSat; uniform float uContrast;
uniform vec3 uWB; uniform float uMono; uniform vec3 uMonoMix; uniform float uBlack; uniform float uGrain; uniform float uVig;
uniform vec3 uShadowTint; uniform vec3 uHiTint; uniform float uAR;
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
vec3 agxCurve(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
// AgX (Blender / Filament): hue-stable highlights, so saturated sunsets roll off to white instead of clipping to yellow
vec3 agx(vec3 c){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = inset * (SRGB_TO_2020 * c);
  c = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
  c = outset * agxCurve(c);
  c = pow(max(c, 0.0), vec3(2.2));
  return clamp(REC2020_TO_SRGB * c, 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec2 cc = uv - 0.5; cc.x *= uRes.x / uRes.y;
  float r = length(cc);
  // subtle chromatic aberration toward the edges, more at speed
  float ca = (0.0012 + uSpeedFx * 0.0025) * r * r * 2.0;
  vec3 col;
  col.r = texture(tSrc, uv + (uv - 0.5) * ca).r;
  col.g = texture(tSrc, uv).g;
  col.b = texture(tSrc, uv - (uv - 0.5) * ca).b;
  if (uSharpen > 0.0) {
    vec2 tx = 1.0 / uRes;
    vec3 c0 = texture(tSrc, uv).rgb;
    vec3 nb = texture(tSrc, uv + vec2(tx.x, 0.0)).rgb + texture(tSrc, uv - vec2(tx.x, 0.0)).rgb + texture(tSrc, uv + vec2(0.0, tx.y)).rgb + texture(tSrc, uv - vec2(0.0, tx.y)).rgb;
    col += clamp((c0 - nb * 0.25) * uSharpen, -0.25 * c0, vec3(0.5));
  }
  col += texture(tBloom, uv).rgb * 0.085;
  col += texture(tRays, uv).rgb * uRayAmt;
  // auto-exposure: partial adaptation toward a key value, so the art-directed exposure still leads
  float avgLog = texture(tAdapt, vec2(0.5)).r;
  float autoX = clamp(pow(uAutoKey / exp(avgLog), uAutoAmt), 0.45, 2.2);
  col *= uExposure * autoX * uWB;
  // naturalist's lens: desaturate and darken outside the aperture
  if (uLens > 0.0) {
    float ap = smoothstep(0.34, 0.27, r);
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 outside = mix(col, vec3(l) * vec3(0.95, 0.9, 1.0), 0.75) * 0.42;
    col = mix(col, mix(outside, col * 1.05, ap), uLens);
  }
  col = uTone > 0.5 ? agx(col * 1.25) : aces(col);
  // grade: per-island lift and gain, saturation, gentle S-curve, cool violet lift in shadows, warm highlights
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = col * uGain + uLift * (1.0 - col);
  col = max(mix(vec3(lum), col, uSat), 0.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += uShadowTint * (1.0 - lum);
  col = mix(col, col * uHiTint, smoothstep(0.5, 1.0, lum));
  // monochrome through a coloured filter (the mix weights act like a lens filter on panchromatic film)
  col = mix(col, vec3(dot(col, uMonoMix)), uMono);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // faded blacks
  col = col * (1.0 - uBlack) + uBlack * vec3(0.92, 0.95, 1.0);
  // vignette + grain
  col *= mix(1.0, 1.0 - uVig, smoothstep(0.45, 1.05, r));
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;
  // photo frame: darken outside the chosen aspect ratio
  if (uAR > 0.0) {
    float sa = uRes.x / uRes.y;
    vec2 q = abs(uv - 0.5) * 2.0;
    float outF = sa > uAR ? step(uAR / sa, q.x) : step(sa / uAR, q.y);
    col *= 1.0 - 0.82 * outF;
  }
  col = mix(col, uFlashColor, uFlash);
  col *= uFade;
  fragColor = vec4(col, 1.0);
}`;

const LUM_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tSrc;
void main(){
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 d = vUv - 0.5; float w = 1.0 - smoothstep(0.1, 0.75, length(d * vec2(1.0, 1.6))) * 0.7; // centre-weighted metering
  fragColor = vec4(log(max(l, 1e-4)) * w, w, 0.0, 1.0);
}`;
const ADAPT_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uK; uniform float uLevels;
void main(){
  vec4 m = textureLod(tLum, vec2(0.5), uLevels);
  float cur = m.x / max(m.y, 1e-4);
  float prev = texture(tPrev, vec2(0.5)).r;
  fragColor = vec4(uK >= 1.0 ? cur : mix(prev, cur, uK), 0.0, 0.0, 1.0);
}`;

// Lens depth of field: GPU autofocus, half-res golden-angle disc gather with separate near and far fields, full-res merge.
const DOF_COMMON = /* glsl */ `
uniform sampler2D tDepth; uniform sampler2D tFocus; uniform vec2 uNF; uniform float uAperture;
float linZ(float z){ return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - (z * 2.0 - 1.0) * (uNF.y - uNF.x)); }
// signed circle of confusion, in units of the largest blur radius: negative in front of the focal plane
// uAperture folds focal length, f-number and sensor size into metres (thin lens, focus distance well beyond the focal length)
float cocOf(float z){ float F = texture(tFocus, vec2(0.5)).r, l = linZ(z); return clamp((l - F) / l * uAperture / F, -1.0, 1.0); }`;

const FOCUS_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
${DOF_COMMON}
uniform sampler2D tPrev; uniform vec2 uUV; uniform float uDist; uniform float uK;
void main(){
  float d = uDist;
  if (d <= 0.0) {
    // nearest surface in a small cross around the focus point, so a thin subject wins over the sky behind it
    d = 1e9;
    for (int i = 0; i < 9; i++) { vec2 o = vec2(float(i % 3 - 1), float(i / 3 - 1)) * vec2(0.006, 0.01); d = min(d, linZ(texture(tDepth, uUV + o).r)); }
  }
  float prev = texture(tPrev, vec2(0.5)).r;
  fragColor = vec4(uK >= 1.0 || prev <= 0.0 ? d : exp(mix(log(prev), log(d), uK)), 0.0, 0.0, 1.0);
}`;

const DOFPRE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
${DOF_COMMON}
uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec3 col = vec3(0.0); float wsum = 0.0, kmin = 1.0, kmax = -1.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + vec2(i % 2 == 0 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5) * uTexel;
    vec3 c = texture(tSrc, uv).rgb;
    float k = cocOf(texture(tDepth, uv).r);
    float w = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));   // Karis weight keeps single hot texels from blooming into discs
    col += c * w; wsum += w; kmin = min(kmin, k); kmax = max(kmax, k);
  }
  fragColor = vec4(col / wsum, kmax >= -kmin ? kmax : kmin);
}`;

const DOFBLUR_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uMaxR;
float weigh(float coc, float radius){ return clamp((coc - radius + 2.0) / 2.0, 0.0, 1.0); }
void main(){
  float cc = texture(tSrc, vUv).a * uMaxR;
  vec3 bg = vec3(0.0), fg = vec3(0.0); float bw = 0.0, fw = 0.0;
  const int N = 64;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(N)) * uMaxR;
    float a = fi * 2.39996323;
    vec4 s = textureLod(tSrc, vUv + vec2(cos(a), sin(a)) * r * uTexel, 0.0);
    float sc = s.a * uMaxR;
    // far field: a sample may only spread onto pixels at least as far out of focus as itself
    float b = weigh(max(0.0, min(sc, cc)), r);
    bg += s.rgb * b; bw += b;
    // near field spreads over everything behind it
    float f = weigh(-sc, r);
    fg += s.rgb * f; fw += f;
  }
  bg /= max(bw, 1e-4); fg /= max(fw, 1e-4);
  float near = min(1.0, fw * 3.14159265 / float(N));
  fragColor = vec4(mix(bg, fg, near), near);
}`;

const DOFTENT_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor; uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  vec4 o = uTexel.xyxy * vec2(-0.5, 0.5).xxyy;
  fragColor = (texture(tSrc, vUv + o.xy) + texture(tSrc, vUv + o.zy) + texture(tSrc, vUv + o.xw) + texture(tSrc, vUv + o.zw)) * 0.25;
}`;

const DOFMERGE_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
${DOF_COMMON}
uniform sampler2D tSrc; uniform sampler2D tDof; uniform float uMaxPx;
void main(){
  vec3 src = texture(tSrc, vUv).rgb;
  vec4 d = texture(tDof, vUv);
  float s = smoothstep(1.0, 3.0, abs(cocOf(texture(tDepth, vUv).r)) * uMaxPx);   // under a pixel or so, keep the full-res image
  fragColor = vec4(mix(src, d.rgb, s + d.a - s * d.a), 1.0);
}`;

// Thin-lens blur scale for the DOF pass: focal length from the vertical field of view on a 24 mm tall
// sensor, divided by the f-number. 'boost' exaggerates it, since the subjects here are big and far away.
export function apertureFor(fovDeg, fNumber, boost = 4) {
  const f = 0.012 / Math.tan((fovDeg * Math.PI) / 360);
  return boost * (f * f) / (fNumber * 0.024) * (1080 / 22);
}

export class Pipeline {
  constructor(renderer, noise) {
    this.renderer = renderer;
    this.scale = 1;
    this.cloudScale = 0.5;
    this.steps = 48;
    this.ink = 0.55;
    this.ao = 0.75; this.taa = true; this.contact = 1;
    this.prevVP = new THREE.Matrix4(); this.hasPrev = false; this.prevCam = new THREE.Vector3(); this.histIdx = 0;
    this.halton = [];
    const hal = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    for (let i = 1; i <= 8; i++) this.halton.push([hal(i, 2) - 0.5, hal(i, 3) - 0.5]);
    const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
    this.cloudMat = mk(CLOUD_FS, {
      ...U, tDepth: { value: null }, tNoise: { value: noise.shape }, tDetail: { value: noise.detail }, uHigh: { value: 1 }, uShaft: { value: 1 }, uShaftSteps: { value: 20 }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uNear: { value: 0.5 }, uFar: { value: 20000 }, uRes: { value: new THREE.Vector2() }, uSteps: { value: 48 }, uFrame: { value: 0 },
      uIsl: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(0, -1e5, 0, 1)] },   // the four islands nearest the camera
    });
    this.csMat = mk(CLOUDSHADOW_FS, { ...U, tNoise: { value: noise.shape }, tDetail: { value: noise.detail } });
    this.csRT = rt(256, 256);
    this.highClouds = true;
    U.uCloudShadow.value = this.csRT.texture;
    this.compMat = mk(COMPOSITE_FS, {
      tScene: { value: null }, tDepth: { value: null }, tCloud: { value: null }, tAO: { value: null }, uRes: { value: new THREE.Vector2() }, uCloudRes: { value: new THREE.Vector2() },
      uAORes: { value: new THREE.Vector2() }, uNear: { value: 0.5 }, uFar: { value: 20000 }, uInk: { value: this.ink }, uAOStr: { value: 0 },
      uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uSunView: { value: new THREE.Vector3() }, uContact: { value: 1 }, uFrame: { value: 0 },
    });
    this.aoMat = mk(AO_FS, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uRadius: { value: 1 } });
    this.taaMat = mk(TAA_FS, { tVel: { value: null }, uVelOn: { value: 0 }, tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uReset: { value: 1 }, uFeedback: { value: 0.9 }, uNF: { value: new THREE.Vector2(0.5, 20000) } });
    this.maskMat = mk(RAYMASK_FS, { ...U, tDepth: { value: null }, tCloud: { value: null }, uInvProj: this.cloudMat.uniforms.uInvProj, uCamWorld: this.cloudMat.uniforms.uCamWorld });
    this.radialMat = mk(RADIAL_FS, { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uAmt: { value: 1 } });
    this.threshMat = mk(THRESH_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.downMat = mk(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = mk(UP_FS, { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
    this.finalMat = mk(FINAL_FS, {
      tSrc: { value: null }, tBloom: { value: null }, tRays: { value: null }, uTime: U.uTime, uExposure: { value: 0.92 }, uLens: { value: 0 },
      uFlash: { value: 0 }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) }, uRes: { value: new THREE.Vector2() }, uFade: { value: 1 },
      uRayAmt: { value: 0.6 }, uShake: { value: 0 }, uSpeedFx: { value: 0 }, uSharpen: { value: 0 },
      tAdapt: { value: null }, uAutoAmt: { value: 0.55 }, uAutoKey: { value: 0.32 }, uTone: { value: 1 },
      uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1.36 }, uContrast: { value: 0.5 },
      uWB: { value: new THREE.Vector3(1, 1, 1) }, uMono: { value: 0 }, uMonoMix: { value: new THREE.Vector3(0.2126, 0.7152, 0.0722) }, uBlack: { value: 0 },
      uGrain: { value: 0.028 }, uVig: { value: 0.28 }, uShadowTint: { value: new THREE.Vector3(-0.009, 0, 0.0252) }, uHiTint: { value: new THREE.Vector3(1.03, 1, 0.95) }, uAR: { value: 0 },
    });
    const dofU = () => ({ tDepth: { value: null }, tFocus: { value: null }, uNF: { value: new THREE.Vector2(0.5, 20000) }, uAperture: { value: 0 } });
    this.focusMat = mk(FOCUS_FS, { ...dofU(), tPrev: { value: null }, uUV: { value: new THREE.Vector2(0.5, 0.5) }, uDist: { value: 0 }, uK: { value: 1 } });
    this.dofPreMat = mk(DOFPRE_FS, { ...dofU(), tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.dofBlurMat = mk(DOFBLUR_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxR: { value: 10 } });
    this.dofTentMat = mk(DOFTENT_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.dofMergeMat = mk(DOFMERGE_FS, { ...dofU(), tSrc: { value: null }, tDof: { value: null }, uMaxPx: { value: 20 } });
    // depth of field: aperture 0 = off; focusDist > 0 = manual, otherwise autofocus at focusUV
    this.dof = { aperture: 0, focusDist: 0, focusUV: new THREE.Vector2(0.5, 0.5), speed: 6, snap: false, focus: 0 };
    this.lumMat = mk(LUM_FS, { tSrc: { value: null } });
    this.adaptMat = mk(ADAPT_FS, { tLum: { value: null }, tPrev: { value: null }, uK: { value: 1 }, uLevels: { value: 7 } });
    const art = (o = {}) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, ...o });
    this.focusRT = [art(), art()]; this.focusIdx = 0;
    this.adapt = [art(), art()]; this.adaptIdx = 0; this.adaptReset = true; this.dt = 1 / 60;
    this.lum = new THREE.WebGLRenderTarget(128, 128, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
    this.quad = fsQuad(this.cloudMat);
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.Camera();
    this.frame = 0;
    this.targets = null;
    this.timer = null;
    this.vel = null;
  }

  resize(w, h, pixelRatio) {
    const W = Math.max(2, Math.round(w * pixelRatio * this.scale)), H = Math.max(2, Math.round(h * pixelRatio * this.scale));
    if (this.targets && this.targets.W === W && this.targets.H === H && this.targets.cs === this.cloudScale) return;
    if (this.targets) for (const t of this.targets.list) t.dispose();
    const depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);
    const scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture, samples: 4 });
    const CW = Math.max(2, Math.round(W * this.cloudScale)), CH = Math.max(2, Math.round(H * this.cloudScale));
    const cloud = rt(CW, CH);
    const comp = rt(W, H);
    const ao = rt(Math.max(2, Math.round(W / 2)), Math.max(2, Math.round(H / 2)));
    const hist = [rt(W, H), rt(W, H)];
    const mask = rt(Math.round(W / 4), Math.round(H / 4));
    const rays = rt(Math.round(W / 4), Math.round(H / 4));
    const bloom = [];
    let bw = Math.round(W / 2), bh = Math.round(H / 2);
    for (let i = 0; i < 6; i++) { bloom.push(rt(Math.max(2, bw), Math.max(2, bh))); bw = Math.round(bw / 2); bh = Math.round(bh / 2); }
    const bloomUp = bloom.map((b) => rt(b.width, b.height));
    const vel = rt(W, H, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const HW = Math.max(2, Math.round(W / 2)), HH = Math.max(2, Math.round(H / 2));
    const dofA = rt(HW, HH), dofB = rt(HW, HH), dofOut = rt(W, H);
    this.targets = { W, H, cs: this.cloudScale, scene, cloud, comp, ao, hist, mask, rays, bloom, bloomUp, vel, dofA, dofB, dofOut, list: [scene, cloud, comp, ao, ...hist, mask, rays, ...bloom, ...bloomUp, vel, dofA, dofB, dofOut] };
    this.hasPrev = false;
    U.uPxScale.value = H / 1080;
    this.aoMat.uniforms.uRes.value.set(W, H);
    this.compMat.uniforms.uAORes.value.set(ao.width, ao.height);
    this.taaMat.uniforms.uRes.value.set(W, H);
    this.cloudMat.uniforms.uRes.value.set(CW, CH);
    this.compMat.uniforms.uRes.value.set(W, H);
    this.compMat.uniforms.uCloudRes.value.set(CW, CH);
    this.finalMat.uniforms.uRes.value.set(W, H);
  }

  readAdapt() {
    const b = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.adapt[1 - this.adaptIdx], 0, 0, 1, 1, b);
    return b[0];
  }
  renderFocus(camera) {
    const D = this.dof, T = this.targets, fm = this.focusMat.uniforms;
    const cur = this.focusRT[this.focusIdx], prev = this.focusRT[1 - this.focusIdx];
    fm.tDepth.value = T.scene.depthTexture; fm.tPrev.value = prev.texture; fm.uNF.value.set(camera.near, camera.far);
    fm.uUV.value.copy(D.focusUV); fm.uDist.value = D.focusDist;
    fm.uK.value = D.snap ? 1 : 1 - Math.exp(-this.dt * D.speed);
    D.snap = false;
    this.pass(this.focusMat, cur);
    this.focusIdx = 1 - this.focusIdx;
    this.focusTex = cur.texture;
  }
  // current focus distance in metres (a GPU readback: call it sparingly)
  readFocus() {
    const b = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.focusRT[1 - this.focusIdx], 0, 0, 1, 1, b);
    return b[0];
  }
  renderDof(src, camera) {
    const T = this.targets, D = this.dof;
    const maxPx = 22 * (T.H / 1080);
    for (const m of [this.dofPreMat, this.dofMergeMat]) {
      const u = m.uniforms;
      u.tDepth.value = T.scene.depthTexture; u.tFocus.value = this.focusTex; u.uNF.value.set(camera.near, camera.far); u.uAperture.value = D.aperture;
    }
    const pu = this.dofPreMat.uniforms;
    pu.tSrc.value = src.texture; pu.uTexel.value.set(1 / T.W, 1 / T.H);
    this.pass(this.dofPreMat, T.dofA);
    const bu = this.dofBlurMat.uniforms;
    bu.tSrc.value = T.dofA.texture; bu.uTexel.value.set(1 / T.dofA.width, 1 / T.dofA.height); bu.uMaxR.value = maxPx / 2;
    this.pass(this.dofBlurMat, T.dofB);
    const tu = this.dofTentMat.uniforms;
    tu.tSrc.value = T.dofB.texture; tu.uTexel.value.set(1 / T.dofB.width, 1 / T.dofB.height);
    this.pass(this.dofTentMat, T.dofA);
    const mu = this.dofMergeMat.uniforms;
    mu.tSrc.value = src.texture; mu.tDof.value = T.dofA.texture; mu.uMaxPx.value = maxPx;
    this.pass(this.dofMergeMat, T.dofOut);
    return T.dofOut;
  }
  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera) {
    const T = this.targets, r = this.renderer;
    const tm = this.timer && this.timer.enabled ? (n) => this.timer.begin(n) : () => {};
    this.frame++;
    camera.updateMatrixWorld();
    // sub-pixel jitter for temporal accumulation
    const P0 = this._P0 || (this._P0 = new THREE.Matrix4());
    P0.copy(camera.projectionMatrix);
    if (this.taa) {
      const j = this.halton[this.frame % this.halton.length];
      camera.projectionMatrix.elements[8] += (j[0] * 2) / T.W;
      camera.projectionMatrix.elements[9] += (j[1] * 2) / T.H;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }
    // cloud shadow map, centred on the camera and snapped to its texel grid
    const B = U.uCloudShadowBox.value;
    U.uCloudShadowOn.value = this.highClouds ? 1 : 0;
    this.cloudMat.uniforms.uHigh.value = this.highClouds ? 1 : 0;
    if (this.highClouds) {
      tm('cloudshadow');
      const texel = (2 * B.z) / 256;
      B.x = Math.round(camera.position.x / texel) * texel; B.y = Math.round(camera.position.z / texel) * texel;
      this.pass(this.csMat, this.csRT);
    }
    tm('scene');
    r.setRenderTarget(T.scene);
    r.render(scene, camera);
    tm('clouds');

    const cu = this.cloudMat.uniforms;
    cu.tDepth.value = T.scene.depthTexture;
    cu.uInvProj.value.copy(camera.projectionMatrixInverse);
    cu.uCamWorld.value.copy(camera.matrixWorld);
    cu.uNear.value = camera.near; cu.uFar.value = camera.far;
    cu.uSteps.value = this.steps; cu.uFrame.value = this.frame % 64;
    this.pass(this.cloudMat, T.cloud);

    if (this.ao > 0) {
      tm('ssao');
      const au = this.aoMat.uniforms;
      au.tDepth.value = T.scene.depthTexture;
      au.uProj.value.copy(camera.projectionMatrix); au.uInvProj.value.copy(camera.projectionMatrixInverse);
      au.uFrame.value = this.frame % 64;
      this.pass(this.aoMat, T.ao);
    }
    const pu = this.compMat.uniforms;
    pu.tAO.value = T.ao.texture; pu.uAOStr.value = this.ao;
    pu.tScene.value = T.scene.texture; pu.tDepth.value = T.scene.depthTexture; pu.tCloud.value = T.cloud.texture;
    pu.uNear.value = camera.near; pu.uFar.value = camera.far; pu.uInk.value = this.ink;
    pu.uProj.value.copy(camera.projectionMatrix); pu.uInvProj.value.copy(camera.projectionMatrixInverse);
    pu.uSunView.value.copy(U.uSunDir.value).transformDirection(camera.matrixWorldInverse);
    pu.uContact.value = this.contact * U.uSunVis.value * (1 - U.uNight.value * 0.8);
    pu.uFrame.value = this.frame % 64;
    tm('composite');
    this.pass(this.compMat, T.comp);

    // temporal resolve
    let out = T.comp;
    const VP = this._VP || (this._VP = new THREE.Matrix4());
    const VP0 = this._VP0 || (this._VP0 = new THREE.Matrix4());
    VP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    VP0.multiplyMatrices(P0, camera.matrixWorldInverse);
    if (this.taa) {
      const tu = this.taaMat.uniforms;
      tu.uVelOn.value = 0;
      if (this.vel && this.vel.enabled && this.hasPrev) {
        tm('velocity');
        this.vel.curVP.copy(VP0); this.vel.prevVP.copy(this.prevVP);
        this.vel.render(r, scene, camera, T.vel);
        tu.tVel.value = T.vel.texture; tu.uVelOn.value = 1;
      }
      tm('taa');
      const cur = T.hist[this.histIdx], prev = T.hist[1 - this.histIdx];
      const jumped = !this.hasPrev || this.prevCam.distanceTo(camera.position) > 40;
      tu.tCur.value = T.comp.texture; tu.tHist.value = prev.texture; tu.tDepth.value = T.scene.depthTexture;
      tu.uNF.value.set(camera.near, camera.far);
      tu.uInvVP.value.copy(VP).invert(); tu.uPrevVP.value.copy(this.prevVP); tu.uReset.value = jumped ? 1 : 0;
      this.pass(this.taaMat, cur);
      out = cur; this.histIdx = 1 - this.histIdx;
    }
    this.prevVP.copy(VP0); this.prevCam.copy(camera.position); this.hasPrev = true;

    // depth of field (focus is tracked every frame so it is settled when the lens opens)
    tm('dof');
    this.renderFocus(camera);
    if (this.dof.aperture > 0.002) out = this.renderDof(out, camera);

    // god rays when the sun is on screen
    const rayDir = U.uSunVis.value > 0.2 ? U.uSunDisc.value : U.uSunDir.value;
    const sp = rayDir.clone().multiplyScalar(10000).add(camera.position).project(camera);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(rayDir);
    let rayAmt = 0;
    tm('rays');
    if (facing > 0.15) {
      rayAmt = Math.min(1, (facing - 0.15) * 3) * 0.45;
      this.maskMat.uniforms.tDepth.value = T.scene.depthTexture;
      this.maskMat.uniforms.tCloud.value = T.cloud.texture;
      this.pass(this.maskMat, T.mask);
      this.radialMat.uniforms.tMask.value = T.mask.texture;
      this.radialMat.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      this.pass(this.radialMat, T.rays);
    } else {
      r.setRenderTarget(T.rays); r.setClearColor(0x000000, 1); r.clear();
    }

    // exposure metering: log luminance, mip-averaged, eased over time
    tm('exposure');
    this.lumMat.uniforms.tSrc.value = out.texture;
    this.pass(this.lumMat, this.lum);
    const am = this.adaptMat.uniforms, aCur = this.adapt[this.adaptIdx], aPrev = this.adapt[1 - this.adaptIdx];
    am.tLum.value = this.lum.texture; am.tPrev.value = aPrev.texture;
    am.uK.value = this.adaptReset ? 1 : 1 - Math.exp(-this.dt * 1.6);
    this.adaptReset = false;
    this.pass(this.adaptMat, aCur);
    this.adaptIdx = 1 - this.adaptIdx;
    this.finalMat.uniforms.tAdapt.value = aCur.texture;
    // bloom
    tm('bloom');
    this.threshMat.uniforms.tSrc.value = out.texture;
    this.threshMat.uniforms.uTexel.value.set(1 / T.W, 1 / T.H);
    this.pass(this.threshMat, T.bloom[0]);
    for (let i = 1; i < T.bloom.length; i++) {
      this.downMat.uniforms.tSrc.value = T.bloom[i - 1].texture;
      this.downMat.uniforms.uTexel.value.set(1 / T.bloom[i - 1].width, 1 / T.bloom[i - 1].height);
      this.pass(this.downMat, T.bloom[i]);
    }
    let prev = T.bloom[T.bloom.length - 1];
    for (let i = T.bloom.length - 2; i >= 0; i--) {
      this.upMat.uniforms.tSrc.value = prev.texture;
      this.upMat.uniforms.tPrev.value = T.bloom[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.pass(this.upMat, T.bloomUp[i]);
      prev = T.bloomUp[i];
    }

    const fu = this.finalMat.uniforms;
    fu.tSrc.value = out.texture; fu.tBloom.value = T.bloomUp[0].texture; fu.tRays.value = T.rays.texture;
    tm('final');
    fu.uRayAmt.value = rayAmt; fu.uSharpen.value = this.taa ? 0.35 : 0;
    this.pass(this.finalMat, null);
    if (this.timer && this.timer.enabled) { this.timer.end(); this.timer.poll(); }
    // restore the unjittered projection for gameplay maths
    camera.projectionMatrix.copy(P0);
    camera.projectionMatrixInverse.copy(P0).invert();
  }
}
