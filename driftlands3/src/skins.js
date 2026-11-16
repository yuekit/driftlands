// Creature skin library (sculpted in Blender, see creatures blend): six tileable skins in two texture arrays.
// A: normal xy + tone, B: second-colour mask, glow mask, height.
import * as THREE from 'three';
import { U } from './glsl.js';
import skinsUrl from './assets/skins.jpg';

export const SKIN_COUNT = 6;
export const SKIN = { pebble: 0, hide: 1, chitin: 2, jelly: 3, membrane: 4, plant: 5 };
function blank() {
  const d = new Uint8Array(4 * SKIN_COUNT);
  for (let i = 0; i < SKIN_COUNT; i++) d.set([128, 128, 220, 255], i * 4);
  const t = new THREE.DataArrayTexture(d, 1, 1, SKIN_COUNT); t.needsUpdate = true; return t;
}
U.tSkinA = { value: blank() };
U.tSkinB = { value: blank() };
U.uSkinOn = { value: 0 };

export function loadSkins() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = img.height / 2, W = img.width;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = img.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      const make = (row) => {
        const data = new Uint8Array(S * S * 4 * SKIN_COUNT);
        for (let l = 0; l < SKIN_COUNT; l++) data.set(cx.getImageData(l * S, row * S, S, S).data, l * S * S * 4);
        const t = new THREE.DataArrayTexture(data, S, S, SKIN_COUNT);
        t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
        t.anisotropy = 4; t.needsUpdate = true;
        return t;
      };
      U.tSkinA.value = make(0); U.tSkinB.value = make(1); U.uSkinOn.value = 1;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = skinsUrl;
  });
}

// GLSL shared by every creature surface. Call skinSample(uv, layer, dx, dy) then apply.
export const SKIN_GLSL = /* glsl */ `
uniform highp sampler2DArray tSkinA; uniform highp sampler2DArray tSkinB; uniform float uSkinOn;
const float SKIN_SPEC[6] = float[6](0.35, 0.18, 1.0, 1.3, 0.55, 0.2);
const float SKIN_GLOSS[6] = float[6](30.0, 18.0, 70.0, 90.0, 40.0, 16.0);
struct Skin { vec2 dn; float tone; float m1; float m2; float h; };
Skin skinSample(vec2 uv, float layer, vec2 gx, vec2 gy){
  vec4 a = textureGrad(tSkinA, vec3(uv, layer), gx, gy);
  vec4 b = textureGrad(tSkinB, vec3(uv, layer), gx, gy);
  Skin s; s.dn = vec2(a.x * 2.0 - 1.0, -(a.y * 2.0 - 1.0)); s.tone = a.z; s.m1 = b.x; s.m2 = b.y; s.h = b.z;
  return s;
}
vec3 skinSpec(vec3 n, vec3 wp, float layer, float amt, float sunVis){
  int li = int(layer + 0.5);
  vec3 V = normalize(uCamPos - wp); vec3 H = normalize(V + uSunDir);
  float g = SKIN_GLOSS[li];
  float sp = pow(max(dot(n, H), 0.0), g) * (g + 8.0) / 60.0 * SKIN_SPEC[li] * amt;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
  return uSunColor * sp * max(dot(n, uSunDir), 0.0) * sunVis * dynShadow(wp, n) + skyColor(reflect(-V, n)) * fres * 0.25 * SKIN_SPEC[li] * amt;
}
`;
