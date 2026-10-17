// Island water: planar mirror reflection, analytic waves, a shallow bed with caustics, shore and channel foam.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';

export const WATER_VS = /* glsl */ `
varying vec3 vWorld; varying vec2 vLocal;
void main(){ vLocal = position.xy; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

export const WATER_FS = /* glsl */ `
varying vec3 vWorld; varying vec2 vLocal;
uniform sampler2D tMirror; uniform mat4 uMirrorMat; uniform float uMirrorOn;
uniform float uChannel; uniform vec2 uFlow;
${COMMON}
vec2 waveGrad(vec2 p, vec2 d, float k, float a, float sp){ float ph = dot(p, d) * k + uTime * sp; return d * (a * k * cos(ph)); }
float caustic(vec2 p, float t){
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
void main(){
  vec2 p = vWorld.xz;
  vec2 fl = uFlow * uTime;
  // normal: a few travelling waves plus flow-advected ripples
  vec2 g = waveGrad(p, normalize(vec2(uWind.x, uWind.y)), 0.9, 0.035, 1.7)
         + waveGrad(p, normalize(vec2(0.3, -1.0)), 1.7, 0.018, 2.6)
         + waveGrad(p, normalize(vec2(-0.8, 0.45)), 3.1, 0.009, 3.9);
  vec2 q = (p - fl) * 0.9;
  float h0 = vnoise2(q + uTime * 0.35) + 0.5 * vnoise2(q * 2.7 - uTime * 0.6);
  float hx = vnoise2(q + vec2(0.06, 0) + uTime * 0.35) + 0.5 * vnoise2((q + vec2(0.06, 0)) * 2.7 - uTime * 0.6);
  float hz = vnoise2(q + vec2(0, 0.06) + uTime * 0.35) + 0.5 * vnoise2((q + vec2(0, 0.06)) * 2.7 - uTime * 0.6);
  g += vec2(h0 - hx, h0 - hz) * mix(0.9, 1.6, uChannel);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(uCamPos - vWorld);
  float NoV = max(dot(n, V), 1e-3);
  float sunVis = dynShadow(vWorld, vec3(0.0, 1.0, 0.0)) * cloudShadowAt(vWorld) * uSunVis;

  // shape: radial distance in the pool disc, across-flow distance in the channel
  float r = uChannel > 0.5 ? abs(vLocal.x) * 2.0 : length(vLocal);
  float depth = uChannel > 0.5 ? 0.25 + 0.7 * (1.0 - r * r) : 0.15 + 3.4 * (1.0 - r * r);

  // the bed, seen through the surface: caustic-lit stone, absorbed with depth
  vec3 Tn = refract(-V, n, 0.75);
  vec2 bedP = p + Tn.xz / max(-Tn.y, 0.2) * depth;
  float cs = caustic(bedP * 0.55 + fl * 0.3, uTime * 0.55) * 0.7 + caustic(bedP * 1.1 - fl * 0.2 + 3.1, uTime * 0.8) * 0.3;
  vec3 bedAlb = mix(vec3(0.36, 0.33, 0.24), vec3(0.14, 0.22, 0.13), vnoise2(bedP * 0.3));
  vec3 bed = bedAlb * (uSunColor * 0.42 * sunVis * (0.4 + cs * 1.8) + ambientLight(vec3(0.0, 1.0, 0.0)) * 0.45);
  float path = depth * (1.0 + 1.0 / NoV) * 0.5;
  vec3 Tr = exp(-path * vec3(0.95, 0.36, 0.30));
  vec3 scat = vec3(0.012, 0.075, 0.085) * (ambientLight(vec3(0.0, 1.0, 0.0)) + uSunColor * 0.25 * sunVis);
  vec3 body = bed * Tr + scat * (1.0 - Tr);

  // reflection: the mirror where we have one, the sky otherwise
  float fr = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec3 R = reflect(-V, n);
  vec3 refl = skyColor(normalize(vec3(R.x, abs(R.y), R.z)));
  if (uMirrorOn > 0.5) {
    vec4 mc = uMirrorMat * vec4(vWorld, 1.0);
    vec2 muv = mc.xy / mc.w + n.xz * 0.02;
    refl = texture(tMirror, clamp(muv, 0.002, 0.998)).rgb;
  }
  vec3 col = mix(body, refl, fr);
  // sun glint (GGX, glassy)
  vec3 H = normalize(V + uSunDir);
  float a = 0.012, NoH = max(dot(n, H), 0.0), NoL = max(dot(n, uSunDir), 0.0);
  float d = NoH * NoH * (a - 1.0) + 1.0;
  col += uSunColor * (a / (3.14159 * d * d)) * NoL * 0.25 * fr * 4.0 * sunVis;

  // foam: a broken ring along the shore, streaks down the channel
  float fn = vnoise2((p - fl * 1.2) * 0.8) * 0.6 + vnoise2((p - fl * 1.6) * 2.3) * 0.4;
  float shore = uChannel > 0.5 ? smoothstep(0.55, 1.0, r + fn * 0.35) : smoothstep(0.88, 1.0, r + (fn - 0.5) * 0.12);
  float streak = uChannel * smoothstep(0.62, 0.8, vnoise2(vec2(vLocal.x * 9.0, (p - fl * 2.0).y * 0.15 + (p - fl * 2.0).x * 0.15)) * 0.7 + fn * 0.4);
  float foam = clamp(shore * smoothstep(0.35, 0.65, fn + shore * 0.3) + streak * 0.7, 0.0, 1.0);
  vec3 foamCol = vec3(0.95) * (uSunColor * 0.5 * (0.35 + 0.65 * sunVis) + ambientLight(vec3(0.0, 1.0, 0.0)));
  col = mix(col, foamCol, foam * 0.85);

  col += vec3(0.2, 0.9, 0.8) * uNight * 0.08 * (0.5 + 0.5 * sin(uTime + vWorld.x * 0.3)) * (0.5 + cs);
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

export function waterMaterial(mirror, channel = false, flow = [0, 0]) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS,
    uniforms: { ...U, tMirror: mirror.uTex, uMirrorMat: mirror.uMat, uMirrorOn: mirror.uOn, uChannel: { value: channel ? 1 : 0 }, uFlow: { value: new THREE.Vector2(...flow) } },
  });
}

// Planar reflection for one horizontal water plane (oblique near plane clips everything below it).
export class Mirror {
  constructor(renderer) {
    this.renderer = renderer;
    this.scale = 0.4;
    this.enabled = true;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera();
    this.uTex = { value: this.rt.texture };
    this.uMat = { value: new THREE.Matrix4() };
    this.uOn = { value: 0 };
    this.meshes = [];   // the water surfaces, hidden while rendering the reflection
    this.anchor = null; // an object whose world position sits on the water plane
    this.radius = 40;
    this._v = new THREE.Vector3(); this._p = new THREE.Vector3(); this._t = new THREE.Vector3();
    this._plane = new THREE.Plane(); this._clip = new THREE.Vector4(); this._q = new THREE.Vector4();
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._s = new THREE.Sphere();
  }
  render(scene, camera, W, H) {
    this.uOn.value = 0;
    if (!this.enabled || !this.anchor) return;
    const P = this.anchor.getWorldPosition(this._p);
    const cp = camera.position;
    if (cp.y < P.y + 0.2 || cp.distanceTo(P) > 650) return;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    if (!this._frustum.intersectsSphere(this._s.set(P, this.radius))) return;
    const w = Math.max(2, Math.round(W * this.scale)), h = Math.max(2, Math.round(H * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    // mirror the camera across y = P.y
    const c = this.cam;
    c.position.set(cp.x, 2 * P.y - cp.y, cp.z);
    const fwd = this._v.set(0, 0, -1).transformDirection(camera.matrixWorld);
    this._t.copy(cp).add(fwd); this._t.y = 2 * P.y - this._t.y;
    c.up.set(0, 1, 0).transformDirection(camera.matrixWorld); c.up.y = -c.up.y;
    c.lookAt(this._t);
    c.near = camera.near; c.far = 2500;
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    // oblique near plane (Lengyel)
    this._plane.setFromNormalAndCoplanarPoint(this._v.set(0, 1, 0), P).applyMatrix4(c.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = c.projectionMatrix.elements, q = this._q;
    q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    this.uMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(camera.projectionMatrix).multiply(c.matrixWorldInverse);

    const r = this.renderer, prev = r.getRenderTarget();
    for (const m of this.meshes) m.visible = false;
    U.uCamPos.value.copy(c.position);
    r.setRenderTarget(this.rt);
    r.render(scene, c);
    U.uCamPos.value.copy(cp);
    for (const m of this.meshes) m.visible = true;
    r.setRenderTarget(prev);
    this.uOn.value = 1;
  }
}
