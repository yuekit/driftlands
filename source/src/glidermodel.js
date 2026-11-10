// Loads the Blender-built glider (embedded .glb) and dresses it in the game's own lighting.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gliderB64 from './assets/glider.glb';
import { U, COMMON } from './glsl.js';
import { assetBuffer } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';

const VS = /* glsl */ `
attribute vec4 tangent;
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  mat3 nm = mat3(modelMatrix);
  vN = normalize(nm * normal);
  vT = normalize(nm * tangent.xyz); vTs = tangent.w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vT; varying float vTs; varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tORM;
uniform float uTrans; uniform float uNormalK; uniform vec3 uEmit;
${COMMON}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  if (!gl_FrontFacing) N = -N;
  vec3 tt = vT - N * dot(N, vT);
  vec3 Tg = dot(tt, tt) > 1e-8 ? normalize(tt) : normalize(cross(N, vec3(0.0, 1.0, 0.3)));
  vec3 B = cross(N, Tg) * vTs;
  vec3 tn = texture(tNormal, vUv).xyz * 2.0 - 1.0;
  tn.xy *= uNormalK;
  vec3 n = normalize(Tg * tn.x + B * tn.y + N * tn.z);
  vec3 alb = texture(tColor, vUv).rgb;
  vec3 orm = texture(tORM, vUv).rgb;
  float ao = mix(1.0, orm.r, 0.85), rough = clamp(orm.g, 0.05, 1.0), metal = orm.b;
  vec3 diffuseAlb = alb * (1.0 - metal * 0.85);
  vec3 col = litSurfacePBR(diffuseAlb, n, vWorld, 1.0, ao, 0.25, rough, mix(vec3(0.04), alb, metal));
  // sunlight glowing through the sail fabric
  if (uTrans > 0.0) {
    col += thinTransmission(alb, n, V, vWorld, 1.0, uTrans * 1.1) * ao;
  }
  col += uEmit;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;


function dress(mesh, opts = {}) {
  const src = mesh.material;
  const geo = mesh.geometry;
  if (!geo.attributes.tangent && geo.attributes.uv && geo.index) geo.computeTangents();
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true;
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  for (const t of [src.map, src.normalMap, src.roughnessMap, src.aoMap]) if (t) t.anisotropy = 8;
  const m = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: {
      ...U,
      tColor: { value: src.map || white }, tNormal: { value: src.normalMap || flat },
      tORM: { value: src.roughnessMap || src.aoMap || white },
      uTrans: { value: opts.trans || 0 }, uNormalK: { value: opts.normalK ?? 1 }, uEmit: { value: new THREE.Vector3() },
    },
    side: opts.side ?? THREE.FrontSide,
  });
  mesh.material = m;
  return m;
}

export async function loadGliderModel() {
  const buf = await assetBuffer(gliderB64);
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(buf, '', (gltf) => {
      const root = gltf.scene;
      const parts = {};
      root.traverse((o) => { if (o.name) parts[o.name] = o; });
      const mats = {};
      if (parts.Body) mats.body = dress(parts.Body, { normalK: 1.0 });
      if (parts.Sail) mats.sail = dress(parts.Sail, { trans: 0.55, normalK: 0.8, side: THREE.DoubleSide });
      if (parts.LampGlass) mats.lamp = dress(parts.LampGlass, {});
      root.traverse((o) => { if (o.isMesh) { o.layers.enable(CASTER_LAYER); o.frustumCulled = false; } });
      resolve({ root, parts, mats });
    }, reject);
  });
}
