// Cascaded sun shadows for moving things (creatures, glider, trees, rocks). Islands keep their baked shadows.
// Three cascades share one depth atlas (side by side); every lit surface samples it through dynShadow() in COMMON,
// with a blocker search so contact points are sharp and long shadows soften (percentage-closer soft shadows).
import * as THREE from 'three';
import { U } from './glsl.js';

export const CASTER_LAYER = 3;
export const CASCADES = [
  { extent: 48, ahead: 30 },
  { extent: 180, ahead: 140 },
  { extent: 640, ahead: 480 },
];
U.uShadowMap = { value: null };
U.uShadowMats = { value: CASCADES.map(() => new THREE.Matrix4()) };
U.uShadowOn = { value: 0 };
U.uShadowTexel = { value: 1 / 2048 };
U.uCascadeTexelWorld = { value: new THREE.Vector3() };

export function markCaster(obj) { obj.traverse((o) => { if (o.isMesh) o.layers.enable(CASTER_LAYER); }); }

export class SunShadow {
  constructor(renderer, size = 2048) {
    this.renderer = renderer;
    this.size = size;
    this.extent = CASCADES[CASCADES.length - 1].extent;
    const n = CASCADES.length;
    const depthTexture = new THREE.DepthTexture(size * n, size, THREE.UnsignedIntType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(size * n, size, { depthBuffer: true, depthTexture, type: THREE.UnsignedByteType, format: THREE.RedFormat });
    this.cams = CASCADES.map((c) => {
      const cam = new THREE.OrthographicCamera(-c.extent, c.extent, c.extent, -c.extent, 1, 2400);
      cam.layers.set(CASTER_LAYER);
      return cam;
    });
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.enabled = true;
    U.uShadowMap.value = depthTexture;
    this._sync();
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  _sync() {
    U.uShadowTexel.value = 1 / this.size;
    U.uCascadeTexelWorld.value.set(...CASCADES.map((c) => (c.extent * 2) / this.size));
  }
  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.rt.setSize(size * CASCADES.length, size);
    this._sync();
  }
  // camera: the view camera; cascades are centred progressively further along its view direction
  render(scene, camera) {
    if (!this.enabled) { U.uShadowOn.value = 0; return; }
    const L = U.uSunDir.value, r = this.renderer;
    const fwd = this._f.set(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y *= 0.5; fwd.normalize();
    const rt = this.rt, W = this.size * CASCADES.length;
    scene.overrideMaterial = this.mat;
    rt.viewport.set(0, 0, W, this.size); rt.scissor.set(0, 0, W, this.size); rt.scissorTest = false;
    r.setRenderTarget(rt);
    r.clear(true, true, false);
    CASCADES.forEach((c, i) => {
      const cam = this.cams[i];
      const focus = this._v.copy(camera.position).addScaledVector(fwd, c.ahead);
      cam.position.copy(focus).addScaledVector(L, 1200);
      cam.up.set(0, 1, 0);
      cam.lookAt(focus);
      cam.updateMatrixWorld();
      // snap to the cascade's texel grid so edges do not crawl as the camera moves
      const texel = (c.extent * 2) / this.size;
      const lp = this._u.copy(focus).applyMatrix4(cam.matrixWorldInverse);
      const sx = Math.round(lp.x / texel) * texel - lp.x, sy = Math.round(lp.y / texel) * texel - lp.y;
      this._r.setFromMatrixColumn(cam.matrixWorld, 0); this._u.setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(this._r, sx).addScaledVector(this._u, sy);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      U.uShadowMats.value[i].copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      rt.viewport.set(i * this.size, 0, this.size, this.size);
      rt.scissor.set(i * this.size, 0, this.size, this.size); rt.scissorTest = true;
      r.setRenderTarget(rt);
      r.render(scene, cam);
    });
    rt.scissorTest = false; rt.viewport.set(0, 0, W, this.size);
    scene.overrideMaterial = null;
    r.setRenderTarget(null);
    U.uShadowOn.value = 1;
  }
}
