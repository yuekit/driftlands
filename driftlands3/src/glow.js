// Night light from bioluminescence: glowing caps and creatures splat coloured pools of light into a
// camera-centred top-down map that every lit surface samples (see glowLight in glsl.js).
import * as THREE from 'three';
import { U } from './glsl.js';

const MAX = 3072;

const VS = /* glsl */ `
attribute vec4 aLight;   // x, z, radius, world height
attribute vec3 aCol;
uniform vec4 uBox; uniform float uSize;
varying vec3 vCol; varying float vY;
void main(){
  vCol = aCol; vY = aLight.w;
  gl_Position = vec4((aLight.xy - uBox.xy) / uBox.z, 0.0, 1.0);
  gl_PointSize = max(2.0, aLight.z / uBox.z * uSize);
}`;
const FS = /* glsl */ `
varying vec3 vCol; varying float vY;
uniform float uHeightPass;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float f = (1.0 - d2); f *= f;
  float w = f * (vCol.r + vCol.g + vCol.b);
  // second pass: light-weighted mean emitter height, so cliffs below a glade stay dark
  gl_FragColor = uHeightPass > 0.5 ? vec4(w * vY * 0.01, w, 0.0, 1.0) : vec4(vCol * f, 1.0);
}`;

export class GlowMap {
  constructor(renderer, size = 256, half = 220) {
    this.renderer = renderer; this.size = size; this.half = half;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rt = new THREE.WebGLRenderTarget(size, size, o);
    this.rtH = new THREE.WebGLRenderTarget(size, size, o);
    this.light = new Float32Array(MAX * 4); this.col = new Float32Array(MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    this.aLight = new THREE.BufferAttribute(this.light, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLight', this.aLight); g.setAttribute('aCol', this.aCol);
    this.box = new THREE.Vector4(0, 0, half, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uBox: { value: this.box }, uSize: { value: size }, uHeightPass: { value: 0 } },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.points);
    this.cam = new THREE.Camera();
    this.n = 0;
    U.uGlowMap.value = this.rt.texture; U.uGlowH.value = this.rtH.texture;
  }
  add(x, y, z, r, g, b, k, radius, top) {
    if (this.n >= MAX || k <= 0.001) return;
    const B = this.box;
    if (Math.abs(x - B.x) > B.z + radius || Math.abs(z - B.y) > B.z + radius) return;
    // lights high above the ground reach it weaker and wider
    const h = Math.max(0, y - top);
    const att = 1 / (1 + (h / 10) ** 2);
    const i = this.n++;
    this.light.set([x, z, radius * (1 + h * 0.04), y], i * 4);
    this.col.set([r * k * att, g * k * att, b * k * att], i * 3);
  }
  // collect emitters and render; night = 0..1
  update(camPos, islands, eco, night) {
    const B = U.uGlowBox.value;
    if (night < 0.04) { B.w = 0; return; }
    const texel = (2 * this.half) / this.size;
    this.box.set(Math.round(camPos.x / texel) * texel, Math.round(camPos.z / texel) * texel, this.half, 1);
    this.n = 0;
    const s = night * 3.2;
    for (const isl of islands) {
      const p = isl.group.position, top = p.y;
      if (!isl.glowSpots) continue;
      for (const L of isl.glowSpots) this.add(L[0] + p.x, L[1] + p.y, L[2] + p.z, L[3], L[4], L[5], L[6] * s, L[7], top + L[1] - 1);
    }
    const tmp = this._v || (this._v = new THREE.Vector3());
    for (const c of eco.list) {
      const g = c.g && c.g.glow;
      if (!g || g < 0.04) continue;
      let pos = c.pos;
      if (!pos && c.island && c.local) pos = tmp.copy(c.local).add(c.island.pos);
      if (!pos) continue;
      const col = c.sp.colB, top = c.island ? c.island.pos.y : pos.y - 2;
      this.add(pos.x, pos.y, pos.z, col.x, col.y, col.z, g * s * 1.2, 12, top);
    }
    this.aLight.needsUpdate = true; this.aCol.needsUpdate = true;
    this.aLight.addUpdateRange?.(0, this.n * 4); this.aCol.addUpdateRange?.(0, this.n * 3);
    this.points.geometry.setDrawRange(0, this.n);
    const r = this.renderer, prev = r.getRenderTarget();
    const cc = r.getClearColor(this._cc || (this._cc = new THREE.Color())), ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const [t, hp] of [[this.rt, 0], [this.rtH, 1]]) {
      this.mat.uniforms.uHeightPass.value = hp;
      r.setRenderTarget(t); r.clear();
      if (this.n) r.render(this.scene, this.cam);
    }
    r.setClearColor(cc, ca); r.setRenderTarget(prev);
    B.set(this.box.x, this.box.y, this.half, 1);
  }
}
