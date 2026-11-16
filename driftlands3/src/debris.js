// Falling rock and dust for the island collision.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';
import { mulberry32 } from './noise.js';

const R_VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal;
void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = wp.xyz; vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const R_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal;
${COMMON}
void main(){ vec3 n = normalize(vNormal); vec3 alb = mix(vec3(0.62, 0.36, 0.22), vec3(0.85, 0.62, 0.42), vnoise(vWorld * 0.8)); gl_FragColor = vec4(applyFog(litSurface(alb, n, vWorld, 1.0, 0.85, 0.2), vWorld), 1.0); }`;
const D_VS = /* glsl */ `
attribute vec4 aD; // age, life, size, alpha
varying float vA;
void main(){ vec4 mv = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float t = clamp(aD.x / max(aD.y, 0.001), 0.0, 1.0); gl_PointSize = clamp(aD.z * (0.4 + t * 1.6) * 900.0 / -mv.z, 1.0, 240.0); vA = aD.w * (1.0 - t) * smoothstep(0.0, 0.05, t); }`;
const D_FS = /* glsl */ `
varying float vA;
${COMMON}
void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d)) * vA; vec3 c = vec3(0.92, 0.72, 0.56) * (uSunColor * 0.25 + ambientLight(vec3(0,1,0))); gl_FragColor = vec4(c, a * 0.55); }`;

export class Debris {
  constructor(scene) {
    this.max = 280;
    this.rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: R_VS, fragmentShader: R_FS, uniforms: { ...U } }), this.max);
    this.rocks.count = 0; this.rocks.frustumCulled = false;
    scene.add(this.rocks);
    this.items = [];
    this.dmax = 700;
    const g = new THREE.BufferGeometry();
    this.dpos = new Float32Array(this.dmax * 3); this.dd = new Float32Array(this.dmax * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.dpos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aD', new THREE.BufferAttribute(this.dd, 4).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: D_VS, fragmentShader: D_FS, uniforms: { ...U }, transparent: true, depthWrite: false }));
    this.dust.frustumCulled = false; this.dust.renderOrder = 5;
    scene.add(this.dust);
    this.dusts = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3();
    this.pending = [];
  }
  burst(pos, dir, k) {
    const rnd = mulberry32(Math.floor(Math.random() * 1e6));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < this.max; i++) {
      const p = pos.clone().addScaledVector(side, (rnd() - 0.5) * 120).add(new THREE.Vector3((rnd() - 0.5) * 20, -rnd() * 40 + 5, (rnd() - 0.5) * 20));
      this.items.push({ p, v: new THREE.Vector3((rnd() - 0.5) * 8, rnd() * 6, (rnd() - 0.5) * 8).addScaledVector(side, (rnd() - 0.5) * 6), s: 0.8 + rnd() * rnd() * 7, rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), w: (rnd() - 0.5) * 2, delay: rnd() * rnd() * 6 });
    }
    for (let i = 0; i < this.dmax; i++) {
      const fall = rnd() < 0.45;
      this.dusts.push({ p: pos.clone().addScaledVector(side, (rnd() - 0.5) * 160).add(new THREE.Vector3((rnd() - 0.5) * 30, (rnd() - 0.5) * 50 - (fall ? 20 : 0), (rnd() - 0.5) * 30)), v: fall ? new THREE.Vector3((rnd() - 0.5) * 2, -6 - rnd() * 10, (rnd() - 0.5) * 2) : new THREE.Vector3((rnd() - 0.5) * 9, rnd() * 6 - 1, (rnd() - 0.5) * 9), age: -rnd() * rnd() * 5, life: 8 + rnd() * 10, size: 10 + rnd() * 30 });
    }
  }
  update(dt) {
    if (!this.items.length && !this.dusts.length) return;
    let n = 0;
    for (const it of this.items) {
      if (it.delay > 0) { it.delay -= dt; continue; }
      it.v.y -= 9.8 * dt; it.p.addScaledVector(it.v, dt);
      it.rot.x += it.w * dt; it.rot.y += it.w * dt * 0.7;
      if (n < this.max) { this.q.setFromEuler(it.rot); this.m.compose(it.p, this.q, this.s.setScalar(it.s)); this.rocks.setMatrixAt(n++, this.m); }
    }
    this.items = this.items.filter((it) => it.p.y > -150);
    this.rocks.count = n; this.rocks.instanceMatrix.needsUpdate = true;
    let k = 0;
    for (const d of this.dusts) {
      d.age += dt;
      if (d.age < 0) { this.dd[k * 4] = 0; this.dd[k * 4 + 1] = 1; this.dd[k * 4 + 2] = 0; this.dd[k * 4 + 3] = 0; this.dpos.set([d.p.x, d.p.y, d.p.z], k * 3); k++; continue; }
      d.p.addScaledVector(d.v, dt); d.v.multiplyScalar(1 - dt * 0.3); d.v.y -= dt * 0.4;
      this.dpos[k * 3] = d.p.x; this.dpos[k * 3 + 1] = d.p.y; this.dpos[k * 3 + 2] = d.p.z;
      this.dd[k * 4] = d.age; this.dd[k * 4 + 1] = d.life; this.dd[k * 4 + 2] = d.size; this.dd[k * 4 + 3] = 1;
      k++;
    }
    this.dusts = this.dusts.filter((d) => d.age < d.life);
    this.dust.geometry.setDrawRange(0, k);
    this.dust.geometry.attributes.position.needsUpdate = true; this.dust.geometry.attributes.aD.needsUpdate = true;
  }
}
