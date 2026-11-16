// Tileable 3D cloud noise generated on the GPU, one slice per draw into a 3D render target.
// shape (128^3): R perlin-worley, G worley fbm (f4), B worley fbm (f8), A perlin fbm
// detail (32^3): R/G/B worley fbm at f2/f4/f8, A their blend (used for edge erosion)
import * as THREE from 'three';

const VS = /* glsl */ `out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = /* glsl */ `
precision highp float; precision highp int;
in vec2 vUv; out vec4 fragColor;
uniform float uZ; uniform float uSize; uniform int uKind; uniform float uSeed;

uvec3 pcg3(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(ivec3 c, int P){
  ivec3 w = ((c % P) + P) % P;
  return vec3(pcg3(uvec3(w) + uvec3(uint(uSeed) * 7919u, uint(uSeed) * 104729u, 31u))) * (1.0 / 4294967295.0);
}
float perlin(vec3 x, int P){
  vec3 i = floor(x), f = x - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float r = 0.0;
  for (int c = 0; c < 8; c++) {
    vec3 o = vec3(c & 1, (c >> 1) & 1, (c >> 2) & 1);
    vec3 g = normalize(hash3(ivec3(i + o), P) * 2.0 - 1.0 + 1e-4);
    float d = dot(g, f - o);
    vec3 w = mix(1.0 - u, u, o);
    r += d * w.x * w.y * w.z;
  }
  return r;
}
float worley(vec3 x, int P){
  vec3 i = floor(x), f = x - i;
  float best = 9.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    vec3 o = vec3(a, b, c);
    vec3 pt = o + hash3(ivec3(i + o), P);
    vec3 d = pt - f;
    best = min(best, dot(d, d));
  }
  return 1.0 - clamp(sqrt(best), 0.0, 1.0);
}
float wfbm(vec3 p, int f){
  return worley(p * float(f), f) * 0.625 + worley(p * float(f * 2), f * 2) * 0.25 + worley(p * float(f * 4), f * 4) * 0.125;
}
float pfbm(vec3 p, int f){
  float s = 0.0, a = 1.0, n = 0.0;
  for (int o = 0; o < 5; o++) { s += perlin(p * float(f), f) * a; n += a; a *= 0.5; f *= 2; }
  return clamp((s / n) * 1.25 + 0.5, 0.0, 1.0);
}
float remap(float v, float a, float b, float c, float d){ return c + (v - a) / (b - a) * (d - c); }

void main(){
  vec3 p = vec3(gl_FragCoord.xy, uZ + 0.5) / uSize;
  if (uKind == 0) {
    float pf = pfbm(p, 4);
    float w1 = wfbm(p, 4);
    float pw = clamp(remap(pf, w1 - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    fragColor = vec4(pw, w1, wfbm(p, 8), pf);
  } else {
    float a = wfbm(p, 2), b = wfbm(p, 4), c = wfbm(p, 8);
    fragColor = vec4(a, b, c, a * 0.625 + b * 0.25 + c * 0.125);
  }
}`;

function make(renderer, size, kind, mat, quad, scene, cam) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
  const t = rt.texture;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  mat.uniforms.uSize.value = size; mat.uniforms.uKind.value = kind;
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = z;
    renderer.setRenderTarget(rt, z);
    renderer.render(scene, cam);
  }
  return rt;
}

export function generateCloudNoise(renderer, { shape = 128, detail = 32, seed = 11 } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { uZ: { value: 0 }, uSize: { value: shape }, uKind: { value: 0 }, uSeed: { value: seed } },
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(g, mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  const s = make(renderer, shape, 0, mat, quad, scene, cam);
  const d = make(renderer, detail, 1, mat, quad, scene, cam);
  renderer.setRenderTarget(prev);
  g.dispose(); mat.dispose();
  return { shape: s.texture, detail: d.texture, targets: [s, d] };
}
