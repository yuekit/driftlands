// The skerries: bare floating rocks strung across the Reach, between the islands and the Tall City. They are the
// Floating Island kit's islet, instanced, in the game's own light, with a collision shape made from its profile.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';
import isletGlb from './assets/d2/islet.glb';

// how wide the islet is at twelve heights from its tip (y = -0.69) to its top (y = 13.35), in its own units
const PROFILE = [0.87, 1.97, 5.06, 4.76, 5.24, 5.63, 6.22, 6.14, 7.11, 7.99, 8.39, 8.19], Y0 = -0.69, H = 14.04;

const VS = /* glsl */ `
uniform mat3 uUvM;
varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
void main(){
  vUv = (uUvM * vec3(uv, 1.0)).xy;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz; vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
uniform sampler2D tC; uniform sampler2D tN; uniform sampler2D tG; uniform float uHasG;
${COMMON}
void main(){
  vec3 Ng = normalize(vN);
  vec3 alb = texture(tC, vUv).rgb;
  vec3 nt = texture(tN, vUv).xyz * 2.0 - 1.0;
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld); vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
  vec3 dp2p = cross(dp2, Ng), dp1p = cross(Ng, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec3 n = normalize(T * im * nt.x - B * im * nt.y + Ng * max(nt.z, 0.2));
  float gloss = uHasG > 0.5 ? texture(tG, vUv).r : 0.2;
  // the same weather the islands wear: moss where it is flat, bare banded stone on the flanks, wet in the rain
  float flat_ = smoothstep(0.55, 0.85, Ng.y);
  float band = 0.85 + 0.3 * vnoise(vec3(vWorld.x * 0.02, vWorld.y * 0.22, vWorld.z * 0.02));
  alb = mix(alb * vec3(1.05, 0.92, 0.86) * band, alb * vec3(0.72, 1.0, 0.62) * 1.15, flat_ * 0.7);
  float wet = frontW(vWorld.xz) * uFrontK.y;
  alb *= 1.0 - 0.35 * wet;
  float rough = clamp(mix(1.0 - 0.7 * gloss, 0.35, wet * 0.7), 0.1, 1.0);
  gHatchPos = vWorld; gHatchN = Ng; gHatch = 0.9;
  float ao = 0.55 + 0.45 * smoothstep(-0.6, 0.6, Ng.y);
  vec3 col = litSurfacePBRx(alb, n, Ng, vWorld, 1.0, ao, 0.0, rough, vec3(0.04));
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

export class Skerries {
  // max: the most skerries there will ever be
  async load(scene, max = 12) {
    const gltf = await new Promise(async (res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(await assetBuffer(isletGlb), '', res, rej));
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const m = src.material, map = m.map, nm = m.normalMap, gm = m.roughnessMap || m.metalnessMap || m.specularIntensityMap || null;
    for (const t of [map, nm, gm]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.needsUpdate = true; }
    if (map) map.updateMatrix();
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { ...U, tC: { value: map }, tN: { value: nm }, tG: { value: gm }, uHasG: { value: gm ? 1 : 0 }, uUvM: { value: map ? map.matrix.clone() : new THREE.Matrix3() } },
    });
    this.mesh = new THREE.InstancedMesh(src.geometry, mat, max);
    this.mesh.count = 0; this.src = src.matrixWorld.clone();
    this.mesh.frustumCulled = false; this.mesh.layers.enable(CASTER_LAYER);
    scene.add(this.mesh);
    this.spots = [];
    return this;
  }
  // spots: [{ pos (the islet's tip), scale, yaw }]
  place(spots) {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    spots.forEach((sp, i) => {
      M.compose(sp.pos, q.setFromAxisAngle(up, sp.yaw), s.setScalar(sp.scale)).multiply(this.src);
      this.mesh.setMatrixAt(i, M);
    });
    this.mesh.count = spots.length; this.mesh.instanceMatrix.needsUpdate = true;
    this.spots = spots.map((sp) => ({ ...sp, top: sp.pos.y + (Y0 + H) * sp.scale, r: 8.4 * sp.scale }));
    this.min = new THREE.Vector3(1e9, 1e9, 1e9); this.max = new THREE.Vector3(-1e9, -1e9, -1e9);
    for (const sp of this.spots) { this.min.x = Math.min(this.min.x, sp.pos.x - sp.r); this.max.x = Math.max(this.max.x, sp.pos.x + sp.r); this.min.z = Math.min(this.min.z, sp.pos.z - sp.r); this.max.z = Math.max(this.max.z, sp.pos.z + sp.r); }
  }
  // metres to the nearest skerry (a body of revolution with the islet's own profile)
  sdf(x, y, z) {
    let best = 1e9;
    for (const s of this.spots) {
      const dx = x - s.pos.x, dz = z - s.pos.z, rr = Math.hypot(dx, dz);
      if (rr - s.r > best || rr - s.r > 400) continue;
      const ly = (y - s.pos.y) / s.scale, t = (ly - Y0) / H * (PROFILE.length - 1);
      let d;
      if (t <= 0) d = Math.hypot(rr, (Y0 - ly) * s.scale);
      else if (t >= PROFILE.length - 1) d = Math.hypot(Math.max(rr - PROFILE[PROFILE.length - 1] * s.scale, 0), (ly - Y0 - H) * s.scale);
      else { const i = Math.floor(t), f = t - i; d = (rr - (PROFILE[i] * (1 - f) + PROFILE[i + 1] * f) * s.scale) * 0.8; }
      if (d < best) best = d;
    }
    return best;
  }
}
