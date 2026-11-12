// The Bell: a white spire in the lamp square, older than the city that grew up round it and the one clean thing in
// it. Dark glass runs up its flanks; when it is rung the glass fills with light from the foot upward.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { U, COMMON } from './glsl.js';
import { assetBuffer } from './assetbuf.js';
import { CASTER_LAYER } from './shadow.js';
import spireGlb from './assets/d2/spire.glb';

const VS = /* glsl */ `
uniform vec3 uScl;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj;
void main(){ vObj = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal / (uScl * uScl)); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj;
uniform float uKind; uniform float uLit; uniform float uBase; uniform float uHeight;
${COMMON}
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float h01 = clamp((vWorld.y - uBase) / uHeight, 0.0, 1.0);
  vec3 alb, f0 = vec3(0.04); float rough, metal = 0.0; vec3 em = vec3(0.0);
  if (uKind < 0.5) {
    // enamel: bone white, fired in courses, a little soot where the rain runs off the iron above it
    float course = smoothstep(0.90, 1.0, sin(vWorld.y * 1.9));
    float streak = smoothstep(0.45, 0.85, vnoise(vec3(vWorld.x * 0.5, vWorld.y * 0.04, vWorld.z * 0.5))) * (1.0 - abs(N.y));
    alb = vec3(0.80, 0.78, 0.72) * (1.0 - 0.10 * course) * (1.0 - 0.22 * streak);
    alb = mix(alb, alb * vec3(1.0, 0.93, 0.82), smoothstep(0.25, 0.0, h01) * 0.5);
    rough = 0.30 + 0.25 * streak; f0 = vec3(0.05);
  } else if (uKind < 1.5) {
    // glass: black until the Bell is rung, then light climbs it
    alb = vec3(0.015, 0.02, 0.025); rough = 0.07; f0 = vec3(0.07);
    float front = smoothstep(0.0, 0.08, uLit * 1.12 - h01);
    float flow = 0.7 + 0.3 * sin(vWorld.y * 0.55 - uTime * 4.0);
    em = vec3(0.45, 1.0, 0.88) * (0.035 + 7.0 * front * flow * (0.4 + 0.6 * uLit));
  } else {
    alb = vec3(0.93, 0.66, 0.30) * (0.85 + 0.3 * vnoise(vObj * 40.0)); metal = 1.0; rough = 0.28;
  }
  gHatchPos = vWorld; gHatchN = N; gHatch = 0.35;
  vec3 col = litSurfacePBRx(alb * (1.0 - metal), N, N, vWorld, 1.0, 1.0, 0.0, rough, mix(f0, alb, metal));
  // the lit glass throws its colour on the enamel beside it
  col += alb * vec3(0.45, 1.0, 0.88) * uLit * 0.22 * (1.0 - step(0.5, uKind));
  col += em * (1.0 + uNight);
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

export class BellSpire {
  // base: where its foot stands (world); height and width in metres (it is drawn out taller than the kit made it)
  async load(scene, base, height = 300, width = 26) {
    const gltf = await new Promise(async (res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(await assetBuffer(spireGlb), '', res, rej));
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    const s = height / size.y, sw = width / Math.max(size.x, size.z);
    this.group = new THREE.Group();
    this.group.add(root);
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    this.group.scale.set(sw, s, sw);
    this.group.position.copy(base);
    this.base = base.clone(); this.height = height; this.radius = width * 0.5;
    this.top = base.clone(); this.top.y += height;
    this.lit = 0; this.goal = 0;
    this.u = { uLit: { value: 0 }, uBase: { value: base.y }, uHeight: { value: height }, uScl: { value: new THREE.Vector3(sw, s, sw) } };
    const KIND = { m: 0, m_new: 0, g: 1, g_bri: 1, b: 2 };
    root.traverse((o) => {
      if (!o.isMesh) return;
      const kind = KIND[o.material.name] ?? 0;
      o.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...U, ...this.u, uKind: { value: kind } }, side: THREE.DoubleSide });
      o.layers.enable(CASTER_LAYER); o.frustumCulled = false;
    });
    scene.add(this.group);
    return this;
  }
  // distance from a point to the spire (a column that narrows a little is near enough)
  sdf(x, y, z) {
    const b = this.base, dy = y - b.y, t = Math.max(0, Math.min(1, dy / this.height));
    const r = this.radius * (1 - 0.14 * t);
    const d = Math.hypot(x - b.x, z - b.z) - r;
    return dy > this.height ? Math.hypot(Math.max(d, 0), dy - this.height) : d;
  }
  update(dt) { this.lit += (this.goal - this.lit) * Math.min(1, dt * 0.45); this.u.uLit.value = this.lit; }
}
