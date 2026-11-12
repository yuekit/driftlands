// GPU-generated, tileable surface texture sets for the islands.
// Each material has a "data" texture (R height, G cavity, B tint variation, A secondary mask)
// and a "normal" texture (RG tangent normal, B curvature/edge, A unused).
import * as THREE from 'three';

const VS = /* glsl */ `out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const LIB = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform float uSeed;
vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + uSeed; return fract(sin(p) * 43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 1.7) * 45758.5453); }
// periodic value noise, period P cells
float pnoise(vec2 x, float P){
  vec2 i = floor(x), f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h21(mod(i, P)), b = h21(mod(i + vec2(1, 0), P)), c = h21(mod(i + vec2(0, 1), P)), d = h21(mod(i + vec2(1, 1), P));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 uv, float P, int oct){
  float a = 0.0, w = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; a += w * pnoise(uv * P, P); n += w; P *= 2.0; w *= 0.5; }
  return a / n;
}
// periodic worley: returns (F1, F2, cell id)
vec3 pworley(vec2 uv, float P){
  vec2 x = uv * P; vec2 i = floor(x), f = fract(x);
  float F1 = 9.0, F2 = 9.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(y));
    vec2 c = mod(i + g, P);
    vec2 o = h22(c);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; id = h21(c + 7.7); } else if (d < F2) { F2 = d; }
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
`;

const ROCK_FS = /* glsl */ `${LIB}
void main(){
  vec2 uv = vUv;
  // domain warp for natural, non-grid fractures
  vec2 w = vec2(pfbm(uv + 0.13, 4.0, 4), pfbm(uv + 0.71, 4.0, 4)) - 0.5;
  vec2 q = uv + w * 0.06;
  vec3 big = pworley(q, 4.0);
  vec3 small = pworley(q * vec2(1.0, 1.0) + 0.37, 11.0);
  // cracks fade in and out so the network never reads as tiles
  float mB = smoothstep(0.3, 0.56, pfbm(uv + 2.2, 5.0, 3));
  float mS = smoothstep(0.5, 0.72, pfbm(uv + 6.4, 7.0, 3));
  float crackB = (1.0 - smoothstep(0.0, 0.035, big.y - big.x)) * mB;
  float crackS = (1.0 - smoothstep(0.0, 0.025, small.y - small.x)) * mS;
  // horizontal bedding planes (side planes map v to height)
  float bedN = pfbm(uv + 1.1, 6.0, 3);
  float bed = sin((uv.y * 14.0 + bedN * 1.8) * 6.2831853) * 0.5 + 0.5;
  float bedLine = smoothstep(0.86, 0.97, bed) * smoothstep(0.3, 0.6, pfbm(uv + 8.8, 4.0, 2));
  float plate = smoothstep(0.0, 0.3, big.y - big.x) * 0.25 + (big.z - 0.5) * 0.1;
  float bump = pfbm(uv, 6.0, 6);
  float pits = smoothstep(0.62, 0.75, pfbm(uv + 4.2, 24.0, 3));
  float grain = pfbm(uv + 3.3, 64.0, 3);
  float h = plate + bump * 0.55 + grain * 0.1 - crackB * 0.3 - crackS * 0.1 - bedLine * 0.12 - pits * 0.08;
  float cav = clamp(crackB * 0.85 + crackS * 0.4 + bedLine * 0.45 + pits * 0.35 + (1.0 - smoothstep(0.25, 0.55, bump)) * 0.25, 0.0, 1.0);
  float tint = big.z * 0.35 + pfbm(uv + 9.1, 3.0, 3) * 0.65;
  float lichen = smoothstep(0.64, 0.72, pfbm(uv + 5.5, 12.0, 4)) * (1.0 - crackB);
  fragColor = vec4(clamp(h * 0.9 + 0.1, 0.0, 1.0), cav, tint, lichen);
}`;

const MOSS_FS = /* glsl */ `${LIB}
void main(){
  vec2 uv = vUv;
  vec2 w = vec2(pfbm(uv + 0.4, 6.0, 3), pfbm(uv + 0.9, 6.0, 3)) - 0.5;
  vec2 q = uv + w * 0.05;
  vec3 c1 = pworley(q, 9.0);
  vec3 c2 = pworley(q + 0.21, 23.0);
  float clump = 1.0 - smoothstep(0.0, 0.62, c1.x);           // rounded cushions
  float sub = 1.0 - smoothstep(0.0, 0.6, c2.x);
  float fib = pfbm(uv + 1.7, 96.0, 3);                         // fibrous fine detail
  float h = clump * 0.55 + sub * 0.25 + fib * 0.2;
  float cav = clamp((1.0 - clump) * 0.7 + (1.0 - sub) * 0.25, 0.0, 1.0);
  float tint = c1.z * 0.55 + pfbm(uv + 4.4, 4.0, 3) * 0.45;
  float flowers = step(0.985, h21(floor(uv * 180.0))) * smoothstep(0.4, 0.8, clump);
  fragColor = vec4(h, cav, tint, flowers);
}`;

const NORMAL_FS = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tH; uniform vec2 uTexel; uniform float uStrength;
float H(vec2 o){ return texture(tH, fract(vUv + o * uTexel)).r; }
void main(){
  float l = H(vec2(-1, 0)), r = H(vec2(1, 0)), d = H(vec2(0, -1)), u = H(vec2(0, 1));
  vec3 n = normalize(vec3((l - r) * uStrength, (d - u) * uStrength, 1.0));
  // curvature from a wider blur: positive on ridges, used for worn edges
  float c = H(vec2(0)) * 4.0;
  float blur = 0.0;
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; blur += H(vec2(cos(a), sin(a)) * 4.0); }
  float curv = clamp((c / 4.0 - blur / 8.0) * 6.0 + 0.5, 0.0, 1.0);
  fragColor = vec4(n.xy * 0.5 + 0.5, curv, 1.0);
}`;

function target(size) {
  const t = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 8,
  });
  t.texture.wrapS = t.texture.wrapT = THREE.RepeatWrapping;
  return t;
}

export function generateSurfaceTextures(renderer, size = 1024) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const cam = new THREE.Camera();
  const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
  const run = (mat, rt) => { mesh.material = mat; renderer.setRenderTarget(rt); renderer.render(scene, cam); };
  const out = {};
  for (const [name, fs, seed, strength] of [['rock', ROCK_FS, 3.1, 11.0], ['moss', MOSS_FS, 8.7, 5.0]]) {
    const data = target(size), nrm = target(size);
    run(mk(fs, { uSeed: { value: seed } }), data);
    // the normal pass reads the data texture without mipmaps
    run(mk(NORMAL_FS, { tH: { value: data.texture }, uTexel: { value: new THREE.Vector2(1 / size, 1 / size) }, uStrength: { value: strength } }), nrm);
    out[name] = { data: data.texture, normal: nrm.texture };
  }
  renderer.setRenderTarget(null);
  return out;
}
