// Motion vectors for things that move on their own (creatures, the glider). Each dynamic batch keeps last
// frame's transforms keyed by a stable id, a velocity pass renders screen-space motion into a target, and TAA
// reprojects those pixels with it instead of with camera motion alone, so wings and tentacles stop ghosting.
import * as THREE from 'three';

export const VEL_LAYER = 4;

// previous instance matrices for an InstancedMesh, matched across frames by key
export class InstHistory {
  constructor(mesh, max) {
    this.mesh = mesh;
    this.buf = new THREE.InstancedInterleavedBuffer(new Float32Array(max * 16), 16).setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < 4; k++) mesh.geometry.setAttribute('aPrev' + k, new THREE.InterleavedBufferAttribute(this.buf, 4, k * 4));
    this.copy = new Float32Array(max * 16);
    this.map = new Map(); this.prevMap = new Map();
  }
  begin(n) {
    this.copy.set(this.mesh.instanceMatrix.array.subarray(0, n * 16));
    const t = this.prevMap; this.prevMap = this.map; this.map = t; this.map.clear();
  }
  record(i, key) {
    const pm = key == null ? undefined : this.prevMap.get(key);
    const src = pm !== undefined ? this.copy.subarray(pm * 16, pm * 16 + 16) : this.mesh.instanceMatrix.array.subarray(i * 16, i * 16 + 16);
    this.buf.array.set(src, i * 16);
    if (key != null) this.map.set(key, i);
  }
  end(n) {
    this.buf.needsUpdate = true;
    this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, Math.max(1, n) * 16);
  }
}

const VEL_FS = /* glsl */ `
precision highp float;
in vec4 vCur; in vec4 vPrev; in float vDepth;
out vec4 fragColor;
void main(){ fragColor = vec4((vCur.xy / vCur.w - vPrev.xy / vPrev.w) * 0.5, vDepth, 1.0); }`;
const HEAD = /* glsl */ `
uniform mat4 uCurVP; uniform mat4 uPrevVP;
out vec4 vCur; out vec4 vPrev; out float vDepth;
void emit(vec4 wp, vec4 wpp){
  gl_Position = projectionMatrix * viewMatrix * wp;
  vCur = uCurVP * wp; vPrev = uPrevVP * wpp; vDepth = -(viewMatrix * wp).z;
}`;
const VS = {
  tube: HEAD + `
in vec3 aPrev;
void main(){ emit(modelMatrix * vec4(position, 1.0), modelMatrix * vec4(aPrev, 1.0)); }`,
  inst: HEAD + `
in vec4 aPrev0; in vec4 aPrev1; in vec4 aPrev2; in vec4 aPrev3;
void main(){ mat4 pm = mat4(aPrev0, aPrev1, aPrev2, aPrev3); emit(modelMatrix * instanceMatrix * vec4(position, 1.0), modelMatrix * pm * vec4(position, 1.0)); }`,
  rigid: HEAD + `
uniform mat4 uPrevModel;
void main(){ emit(modelMatrix * vec4(position, 1.0), uPrevModel * vec4(position, 1.0)); }`,
};

export class VelocityPass {
  constructor() {
    this.curVP = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4();
    const mk = (kind) => new THREE.ShaderMaterial({
      vertexShader: VS[kind], fragmentShader: VEL_FS, glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
      uniforms: { uCurVP: { value: this.curVP }, uPrevVP: { value: this.prevVP }, uPrevModel: { value: new THREE.Matrix4() } },
    });
    this.mats = { tube: mk('tube'), inst: mk('inst'), rigid: mk('rigid') };
    this.list = [];
    this.enabled = true;
    const rigid = this.mats.rigid;
    this._rigidHook = function () { rigid.uniforms.uPrevModel.value.copy(this.userData.prevMW); rigid.uniformsNeedUpdate = true; };
  }
  register(mesh, kind) {
    mesh.traverse((o) => {
      if (!o.isMesh || o.userData.velReg) return;
      o.userData.velReg = true;
      o.layers.enable(VEL_LAYER);
      const k = kind === 'rigid' && o.isInstancedMesh ? 'inst' : kind;
      if (k === 'rigid') o.userData.prevMW = o.matrixWorld.clone();
      this.list.push({ o, kind: k, mat: null });
    });
  }
  render(renderer, scene, camera, target) {
    const bg = scene.background, layers = camera.layers.mask;
    for (const e of this.list) {
      e.mat = e.o.material; e.o.material = this.mats[e.kind];
      if (e.kind === 'rigid') { e.cb = e.o.onBeforeRender; e.o.onBeforeRender = this._rigidHook; }
    }
    scene.background = null;
    camera.layers.set(VEL_LAYER);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    camera.layers.mask = layers;
    scene.background = bg;
    for (const e of this.list) {
      e.o.material = e.mat;
      if (e.kind === 'rigid') { e.o.onBeforeRender = e.cb; e.o.userData.prevMW.copy(e.o.matrixWorld); }
    }
  }
}
