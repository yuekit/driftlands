// Shared GLSL: atmosphere, fog, lighting, noise.
import * as THREE from 'three';
import { SUN_DIR } from './islands-sdf.js';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(...SUN_DIR) },
  uSunColor: { value: new THREE.Vector3(1.0, 0.70, 0.46).multiplyScalar(3.2) },
  uCamPos: { value: new THREE.Vector3() },
  uFogDensity: { value: 1 / 3000 },
  uWind: { value: new THREE.Vector2(0.8, 0.3) },
  uCloudTop: { value: 22 },
  uFlash: { value: 0 },
  uNight: { value: 0 },
  uPxScale: { value: 1 },
  uCloudShadow: { value: null }, uCloudShadowBox: { value: new THREE.Vector4(0, 0, 1600, 500) }, uCloudShadowOn: { value: 0 },
  uCover: { value: 0.5 },   // high cumulus coverage
  uPush: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1e4, 0, 0)) },   // glider wake: xyz, strength   // render height / 1080: keeps point sprites the same size at every quality level
};

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform vec2 uWind;
uniform float uCloudTop;
uniform float uNight;
uniform float uPxScale;
uniform vec3 uSkyZen, uSkySun, uSkyAnti, uSkyBelow, uAmbLo, uAmbHi, uBounce, uHorGlow, uSunDisc;
uniform float uSunVis, uMoon;
uniform vec4 uPush[4];
uniform sampler2D uCloudShadow; uniform vec4 uCloudShadowBox; uniform float uCloudShadowOn;
uniform sampler2D uShadowMap; uniform mat4 uShadowMats[3]; uniform float uShadowOn; uniform float uShadowTexel; uniform vec3 uCascadeTexelWorld;

float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)), hash13(i+vec3(1,0,0)), f.x),
                 mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x),
                 mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 x){
  vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
float fbm3(vec3 p){ float a=0.0, w=0.5; for(int i=0;i<4;i++){ a+=w*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); w*=0.5;} return a; }
float fbm2(vec2 p){ float a=0.0, w=0.5; for(int i=0;i<5;i++){ a+=w*vnoise2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.7); w*=0.5;} return a; }

vec3 skyColor(vec3 d){
  float sd = dot(d, uSunDisc);
  vec2 dh = normalize(d.xz + vec2(1e-5));
  float az = clamp(dot(dh, normalize(uSunDisc.xz)) * 0.5 + 0.5, 0.0, 1.0);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 hor = mix(uSkyAnti, uSkySun, pow(az, 1.7));
  float t = pow(max(h, 0.0), 0.46);
  vec3 col = mix(hor, uSkyZen, clamp(t * 1.05, 0.0, 1.0));
  col += uHorGlow * 0.3 * pow(az, 5.0) * exp(-abs(h) * 10.0);
  col = mix(col, uSkyBelow, smoothstep(0.0, -0.3, h));
  col += uSunColor * (pow(max(sd, 0.0), 7.0) * 0.07 + pow(max(sd, 0.0), 90.0) * 0.35) * uSunVis;
  float md = dot(d, uSunDir);
  col += vec3(0.5, 0.62, 1.0) * (pow(max(md, 0.0), 40.0) * 0.12 + pow(max(md, 0.0), 400.0) * 0.4) * uMoon;
  return col;
}

float fogAmount(vec3 wp, out vec3 dir){
  vec3 v = wp - uCamPos; float dist = length(v); dir = v / max(dist, 1e-3);
  float avgH = 0.5 * (wp.y + uCamPos.y);
  float hf = exp(-max(avgH - 20.0, 0.0) * 0.0055) + 0.22;
  float x = dist * uFogDensity * hf;
  return 1.0 - exp(-x * sqrt(x));
}
// aerial perspective: wavelength-dependent extinction (blue scatters first, so distant rock turns violet-blue
// and bright things redden) plus forward Mie scattering that makes haze glow on the sun side
float hgPhase(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
vec3 mieGlow(vec3 dir){
  float cs = dot(dir, uSunDisc);
  return uSunColor * (hgPhase(cs, 0.6) * 0.5 + hgPhase(cs, 0.25) * 0.15) * uSunVis * (0.6 + 0.4 * (1.0 - uNight));
}
vec3 applyFog(vec3 col, vec3 wp){
  vec3 v = wp - uCamPos; float dist = length(v); vec3 dir = v / max(dist, 1e-3);
  float avgH = 0.5 * (wp.y + uCamPos.y);
  float hf = exp(-max(avgH - 20.0, 0.0) * 0.0055) + 0.22;
  float x = dist * uFogDensity * hf;
  vec3 xc = x * vec3(0.74, 0.95, 1.3);
  vec3 T = exp(-xc * sqrt(xc));
  vec3 fc = skyColor(vec3(dir.x, max(dir.y, -0.05) * 0.4, dir.z));
  fc += mieGlow(dir);
  return col * T + fc * (1.0 - T);
}
// lighting shared by every lit surface
vec3 ambientLight(vec3 n){
  float up = n.y * 0.5 + 0.5;
  vec3 sky = mix(uAmbLo, uAmbHi, up);
  vec3 bounce = uBounce * smoothstep(0.3, -0.9, n.y);
  vec2 sh = normalize(uSunDisc.xz + vec2(1e-5));
  float side = max(dot(normalize(n.xz + vec2(1e-5)), sh), 0.0) * (1.0 - abs(n.y));
  return sky * (0.5 + 0.5 * up) + bounce * 0.75 + uSkySun * side * side * 0.18 * uSunVis;
}
const vec2 POISSON[8] = vec2[8](vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.071), vec2(0.421, -0.651), vec2(-0.019, 0.940), vec2(0.940, -0.090));
// one cascade with a blocker search (PCSS): penumbra grows with the distance between caster and receiver
float cascadeShadow(int ci, vec3 wp, vec3 n, float ang){
  float tw = ci == 0 ? uCascadeTexelWorld.x : ci == 1 ? uCascadeTexelWorld.y : uCascadeTexelWorld.z;
  float ndl = dot(n, uSunDir);
  vec3 nb = n * tw * (1.2 + 2.0 * (1.0 - abs(ndl)));
  vec4 sc = uShadowMats[ci] * vec4(wp + nb, 1.0);
  vec3 s = sc.xyz / sc.w;
  float ext = tw / uShadowTexel;              // cascade width in metres
  float bias = 0.00004 + tw * 0.00012;
  float ca = cos(ang), sa = sin(ang);
  float u0 = float(ci) / 3.0;
  // blocker search
  float srch = clamp(2.5 / ext, 2.0 * uShadowTexel, 0.03);
  float bsum = 0.0, bn = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = POISSON[i]; o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * srch;
    vec2 uv = s.xy + o;
    float d = texture(uShadowMap, vec2(u0 + clamp(uv.x, 0.0, 1.0) / 3.0, uv.y)).r;
    if (d < s.z - bias) { bsum += d; bn += 1.0; }
  }
  if (bn < 0.5) return 1.0;
  float dz = (s.z - bsum / bn) * 2400.0;      // caster to receiver, metres
  float pen = clamp(dz * 0.02 / ext, 1.4 * uShadowTexel, srch);
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = POISSON[i]; o = vec2(o.x * sa + o.y * ca, -o.x * ca + o.y * sa) * pen;
    vec2 uv = s.xy + o;
    float d = texture(uShadowMap, vec2(u0 + clamp(uv.x, 0.0, 1.0) / 3.0, uv.y)).r;
    sum += step(s.z - bias, d);
  }
  return sum * 0.125;
}
float cascadeFit(int ci, vec3 wp){
  vec4 sc = uShadowMats[ci] * vec4(wp, 1.0);
  vec2 e = min(sc.xy, 1.0 - sc.xy);
  return sc.z >= 1.0 ? 0.0 : smoothstep(0.0, 0.08, min(e.x, e.y));
}
float dynShadow(vec3 wp, vec3 n){
  if (uShadowOn < 0.5) return 1.0;
  float ang = hash13(floor(wp * 23.0) + fract(uTime * 7.0) * 61.0) * 6.2831853;
  float f0 = cascadeFit(0, wp), f1 = cascadeFit(1, wp), f2 = cascadeFit(2, wp);
  if (f0 >= 1.0) return cascadeShadow(0, wp, n, ang);
  if (f0 > 0.0) return mix(cascadeShadow(1, wp, n, ang), cascadeShadow(0, wp, n, ang), f0);
  if (f1 >= 1.0) return cascadeShadow(1, wp, n, ang);
  if (f1 > 0.0) return mix(cascadeShadow(2, wp, n, ang), cascadeShadow(1, wp, n, ang), f1);
  if (f2 > 0.0) return mix(1.0, cascadeShadow(2, wp, n, ang), f2);
  return 1.0;
}
// ---- physically based specular (GGX) with an analytic sky environment
float D_GGX(float NoH, float a){ float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * d * d + 1e-7); }
float V_Smith(float NoV, float NoL, float a){ float k = a * 0.5; return 0.25 / ((NoV * (1.0 - k) + k) * (NoL * (1.0 - k) + k)); }
vec3 F_Schlick(vec3 f0, float c){ float f = pow(1.0 - c, 5.0); return f0 + (1.0 - f0) * f; }
// split-sum environment BRDF, analytic fit (Karis, mobile)
vec2 envBRDF(float NoV, float rough){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022); const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1; float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
// the sky as an environment: sharp along R for glossy surfaces, fading to the ambient lobe as roughness rises
vec3 envLight(vec3 R, float rough){
  vec3 sharp = skyColor(normalize(vec3(R.x, max(R.y, -0.3), R.z)));
  return mix(sharp, ambientLight(R) * 1.1, smoothstep(0.15, 0.9, rough));
}
// rough: perceptual roughness 0..1; f0: reflectance at normal incidence (0.04 for most non-metals)
// ambN: direction the sky light is gathered from (a bent normal where one is baked)
// plants bend away from the glider's downwash as it skims over them; hgt = 0..1 up the plant, size in metres
vec3 pushOffset(vec3 root, float hgt, float size){
  vec3 o = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 P = uPush[i];
    vec2 d = root.xz - P.xz;
    float r = length(d);
    float above = P.y - root.y;
    float s = P.w * smoothstep(12.0, 1.0, r) * smoothstep(18.0, 3.0, above) * step(-2.0, above);
    if (s <= 0.0) continue;
    float ripple = 0.75 + 0.25 * sin(r * 1.3 - uTime * 9.0);
    vec2 dir = d / max(r, 0.3);
    o.xz += dir * s * ripple * hgt * hgt * size * 1.0;
    o.y -= s * hgt * size * 0.35;
  }
  return o;
}
// shadow of the high cumulus layer: project along the sun onto the shadow map's plane
float cloudShadowAt(vec3 p){
  if (uCloudShadowOn < 0.5) return 1.0;
  vec4 B = uCloudShadowBox;
  vec3 q = p + uSunDir * ((B.w - p.y) / max(uSunDir.y, 0.12));
  vec2 uv = (q.xz - B.xy) / (2.0 * B.z) + 0.5;
  float edge = smoothstep(0.5, 0.42, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
  return mix(1.0, texture(uCloudShadow, uv).r, edge);
}
vec3 litSurfacePBRx(vec3 albedo, vec3 n, vec3 ambN, vec3 wp, float sunVis, float ao, float wrap, float rough, vec3 f0){
  sunVis *= dynShadow(wp, n) * cloudShadowAt(wp);
  vec3 V = normalize(uCamPos - wp);
  float ndl = dot(n, uSunDir);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float NoV = max(dot(n, V), 1e-3), NoL = max(ndl, 0.0);
  float a = max(rough * rough, 0.02);
  vec3 H = normalize(V + uSunDir);
  float NoH = max(dot(n, H), 0.0), VoH = max(dot(V, H), 0.0);
  vec3 F = F_Schlick(f0, VoH);
  vec3 spec = D_GGX(NoH, a) * V_Smith(NoV, NoL, a) * F * NoL;
  vec2 ab = envBRDF(NoV, rough);
  vec3 Fenv = f0 * ab.x + ab.y;
  float specOcc = clamp(pow(NoV + ao, exp2(-16.0 * a - 1.0)) - 1.0 + ao, 0.0, 1.0);
  vec3 kd = 1.0 - Fenv;
  vec3 col = albedo * kd * (uSunColor * diff * sunVis + ambientLight(ambN) * ao);
  col += uSunColor * spec * sunVis;
  col += envLight(reflect(-V, n), rough) * Fenv * specOcc;
  float rim = pow(1.0 - NoV, 4.0);
  col += mix(albedo, vec3(1.0), 0.45) * uSunColor * rim * (0.03 + 0.2 * pow(max(dot(-V, uSunDir), 0.0), 2.0)) * ao * (0.4 + 0.6 * sunVis);
  return col;
}
vec3 litSurfacePBR(vec3 albedo, vec3 n, vec3 wp, float sunVis, float ao, float wrap, float rough, vec3 f0){
  return litSurfacePBRx(albedo, n, n, wp, sunVis, ao, wrap, rough, f0);
}
vec3 litSurface(vec3 albedo, vec3 n, vec3 wp, float sunVis, float ao, float wrap){
  return litSurfacePBR(albedo, n, wp, sunVis, ao, wrap, 0.78, vec3(0.04));
}
`;

export function srgb(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b); // THREE.Color(hex) converts to linear with ColorManagement
}
