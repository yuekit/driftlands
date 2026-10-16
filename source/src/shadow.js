// Dynamic sun shadows for moving things (creatures, glider, trees). Islands keep their baked shadows;
// every lit surface samples this map through litSurface() in COMMON.
import * as THREE from 'three';
import { U } from './glsl.js';

export const CASTER_LAYER = 3;
U.uShadowMap = { value: null };
U.uShadowMat = { value: new THREE.Matrix4() };
U.uShadowOn = { value: 0 };
U.uShadowTexel = { value: 1 / 2048 };

export function markCaster(obj) { obj.traverse((o) => { if (o.isMesh) o.layers.enable(CASTER_LAYER); }); }

export class SunShadow {
  constructor(renderer, size = 2048, extent = 170) {
    this.renderer = renderer;
    this.size = size; this.extent = extent;
    const depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture, type: THREE.UnsignedByteType, format: THREE.RedFormat });
    this.cam = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 1600);
    this.cam.layers.set(CASTER_LAYER);
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.enabled = true;
    U.uShadowMap.value = depthTexture;
    U.uShadowTexel.value = 1 / size;
    this._v = new THREE.Vector3();
  }
  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.rt.setSize(size, size);
    U.uShadowTexel.value = 1 / size;
  }
  render(scene, focus) {
    if (!this.enabled) { U.uShadowOn.value = 0; return; }
    const L = U.uSunDir.value;
    const cam = this.cam;
    // snap the focus to the shadow texel grid so edges do not crawl as the camera moves
    cam.position.copy(focus).addScaledVector(L, 800);
    cam.up.set(0, 1, 0);
    cam.lookAt(focus);
    cam.updateMatrixWorld();
    const texel = (this.extent * 2) / this.size;
    const lp = this._v.copy(focus).applyMatrix4(cam.matrixWorldInverse);
    const sx = Math.round(lp.x / texel) * texel - lp.x, sy = Math.round(lp.y / texel) * texel - lp.y;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, sx).addScaledVector(up, sy);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    U.uShadowMat.value.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const r = this.renderer;
    const prevBg = scene.background;
    scene.overrideMaterial = this.mat;
    r.setRenderTarget(this.rt);
    r.clear(true, true, false);
    r.render(scene, cam);
    scene.overrideMaterial = null;
    scene.background = prevBg;
    U.uShadowOn.value = 1;
  }
}
