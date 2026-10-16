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
uniform vec3 uSkyZen, uSkySun, uSkyAnti, uSkyBelow, uAmbLo, uAmbHi, uBounce, uHorGlow, uSunDisc;
uniform float uSunVis, uMoon;
uniform sampler2D uShadowMap; uniform mat4 uShadowMat; uniform float uShadowOn; uniform float uShadowTexel;

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
vec3 applyFog(vec3 col, vec3 wp){
  vec3 dir; float f = fogAmount(wp, dir);
  vec3 fc = skyColor(vec3(dir.x, max(dir.y, -0.05) * 0.4, dir.z));
  return mix(col, fc, f);
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
float dynShadow(vec3 wp, vec3 n){
  if (uShadowOn < 0.5) return 1.0;
  float ndl = dot(n, uSunDir);
  vec3 nb = n * (0.15 + 0.3 * (1.0 - abs(ndl)));
  vec4 sc = uShadowMat * vec4(wp + nb, 1.0);
  vec3 s = sc.xyz / sc.w;
  vec2 e = min(s.xy, 1.0 - s.xy);
  float fade = smoothstep(0.0, 0.06, min(e.x, e.y));
  if (fade <= 0.0 || s.z >= 1.0) return 1.0;
  float ang = hash13(floor(wp * 23.0) + fract(uTime * 7.0) * 61.0) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);
  float rad = 1.9 * uShadowTexel;
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = POISSON[i];
    o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
    float d = texture(uShadowMap, s.xy + o * rad).r;
    sum += step(s.z - 0.00035, d);
  }
  return mix(1.0, sum * 0.125, fade);
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
vec3 litSurfacePBR(vec3 albedo, vec3 n, vec3 wp, float sunVis, float ao, float wrap, float rough, vec3 f0){
  sunVis *= dynShadow(wp, n);
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
  vec3 col = albedo * kd * (uSunColor * diff * sunVis + ambientLight(n) * ao);
  col += uSunColor * spec * sunVis;
  col += envLight(reflect(-V, n), rough) * Fenv * specOcc;
  float rim = pow(1.0 - NoV, 4.0);
  col += mix(albedo, vec3(1.0), 0.45) * uSunColor * rim * (0.03 + 0.2 * pow(max(dot(-V, uSunDir), 0.0), 2.0)) * ao * (0.4 + 0.6 * sunVis);
  return col;
}
vec3 litSurface(vec3 albedo, vec3 n, vec3 wp, float sunVis, float ao, float wrap){
  return litSurfacePBR(albedo, n, wp, sunVis, ao, wrap, 0.78, vec3(0.04));
}
`;

export function srgb(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b); // THREE.Color(hex) converts to linear with ColorManagement
}
