// Landmarks left by the surveyor who came before: a listening post on every island, and four camps with a cairn
// where a page of the old notebook is waiting. Posts light when their island's life is fully recorded, and all of
// them send up a beam when the survey is complete (the Chord).
import * as THREE from 'three';
import { U, COMMON, srgb } from './glsl.js';
import { markCaster } from './shadow.js';

// ---- small geometry helpers: everything is merged into flat-shaded, vertex-coloured meshes
function part(geo, hex, glow = 0, m = null) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count, c = srgb(hex);
  const col = new Float32Array(n * 3), gl = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.x; col[i * 3 + 1] = c.y; col[i * 3 + 2] = c.z; gl[i] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  g.deleteAttribute('uv');
  return g;
}
function merge(parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), gl = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3); col.set(p.attributes.color.array, o * 3); gl.set(p.attributes.aGlow.array, o);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
const T = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

const VS = /* glsl */ `
attribute vec3 color; attribute float aGlow;
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vCol; varying float vGlow;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vLocal = position; vCol = color; vGlow = aGlow;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vCol; varying float vGlow;
${COMMON}
uniform float uActive;    // 0 = dormant, 1 = singing
uniform float uPulse;     // extra brightness while the Chord sounds
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float grain = vnoise(vLocal * 2.3) * 0.6 + vnoise(vLocal * 9.0) * 0.4;
  vec3 alb = vCol * (0.86 + 0.26 * grain);
  alb *= 1.0 - 0.25 * smoothstep(0.62, 0.9, vnoise(vLocal * vec3(1.3, 0.25, 1.3) + 5.0));   // rain streaks down the stone
  gHatchPos = vLocal; gHatchN = n; gHatch = 0.9;
  vec3 col = litSurfacePBR(alb, n, vWorld, 1.0, 0.92, 0.1, 0.62, vec3(0.04));
  float run = 0.75 + 0.25 * sin(uTime * 2.2 - vLocal.y * 0.9);
  vec3 dormant = vec3(1.0, 0.5, 0.26) * (0.05 + 0.35 * uNight);
  vec3 awake = vec3(0.42, 1.0, 0.84) * (2.6 + 3.0 * uNight + 5.0 * uPulse) * run;
  col += mix(dormant, awake, uActive) * vGlow;
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;
const BEAM_VS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vY;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vY = position.y + 0.5; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const BEAM_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vY;
${COMMON}
uniform float uBeam;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float facing = abs(dot(normalize(vN), V));
  float core = pow(facing, 5.0), halo = pow(facing, 1.6) * 0.22;
  float fade = smoothstep(0.0, 0.012, vY) * (1.0 - smoothstep(0.55, 1.0, vY));
  float flow = 0.8 + 0.2 * sin(vWorld.y * 0.06 - uTime * 5.0);
  vec3 c = vec3(0.42, 1.0, 0.84) * (core * 5.0 + halo) * flow * fade * uBeam;
  vec3 dir; float f = fogAmount(vWorld, dir);
  gl_FragColor = vec4(c * (1.0 - f * 0.75), 1.0);
}`;

function postGeometry() {
  const stone = '#e6d8c0', stoneDark = '#b9a48f', copper = '#b9673f', verd = '#5fa89a';
  const P = [];
  const hex = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 6);
  P.push(part(hex(3.3, 3.6, 0.7), stoneDark, 0, T(0, 0.35, 0)));
  P.push(part(hex(2.5, 2.7, 0.6), stone, 0, T(0, 1.0, 0, 0, Math.PI / 6)));
  P.push(part(hex(1.75, 1.9, 0.5), stoneDark, 0, T(0, 1.55, 0)));
  // the shaft: a four-sided needle, slightly waisted
  const shaft = new THREE.CylinderGeometry(0.5, 1.2, 15, 4, 6);
  const sp = shaft.attributes.position;
  for (let i = 0; i < sp.count; i++) { const y = sp.getY(i) / 15 + 0.5; const k = 1 - 0.16 * Math.sin(y * Math.PI); sp.setX(i, sp.getX(i) * k); sp.setZ(i, sp.getZ(i) * k); }
  P.push(part(shaft, stone, 0, T(0, 9.3, 0, 0, Math.PI / 4)));
  // a glowing seam inlaid down each face, and copper collars
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    P.push(part(new THREE.BoxGeometry(0.16, 11.5, 0.08), '#c8fff0', 1, T(Math.sin(a) * 0.62, 9.6, Math.cos(a) * 0.62, -0.047 * Math.cos(a) * 0 , a, 0)));
  }
  for (const [y, r] of [[4.6, 1.02], [9.4, 0.78], [14.2, 0.62]]) P.push(part(new THREE.CylinderGeometry(r, r * 1.04, 0.42, 4), y === 9.4 ? verd : copper, 0, T(0, y, 0, 0, Math.PI / 4)));
  // the fork at the top that holds the crystal
  for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.16, 2.6, 0.5), copper, 0, T(s * 0.72, 17.6, 0, 0, 0, s * -0.16)));
  P.push(part(new THREE.CylinderGeometry(0.62, 0.5, 0.5, 4), copper, 0, T(0, 16.9, 0, 0, Math.PI / 4)));
  // listening horns: three shallow cones facing out
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.5;
    P.push(part(new THREE.ConeGeometry(0.75, 1.3, 10, 1, true), verd, 0, T(Math.sin(a) * 1.5, 12.3, Math.cos(a) * 1.5, Math.PI / 2 + 0.25, a, 0, 1, 1, 1)));
  }
  return merge(P);
}
function cairnGeometry(seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const P = [];
  let y = 0;
  const cols = ['#bfae98', '#a8937e', '#d2c3ab', '#9c8a78', '#c9b8a0'];
  for (let i = 0; i < 6; i++) {
    const r = 1.25 - i * 0.17, h = 0.42 + rnd() * 0.16;
    P.push(part(new THREE.IcosahedronGeometry(1, 0), cols[i % cols.length], 0, T((rnd() - 0.5) * 0.25, y + h * r * 0.9, (rnd() - 0.5) * 0.25, rnd() * 3, rnd() * 3, rnd() * 3, r, r * h * 1.4, r * (0.85 + rnd() * 0.3))));
    y += h * r * 1.75;
  }
  // a few stones that slid off
  for (let i = 0; i < 5; i++) { const a = rnd() * 6.28, d = 1.8 + rnd() * 1.6, r = 0.3 + rnd() * 0.35; P.push(part(new THREE.IcosahedronGeometry(1, 0), cols[(i + 2) % cols.length], 0, T(Math.cos(a) * d, r * 0.4, Math.sin(a) * d, rnd() * 3, rnd() * 3, 0, r, r * 0.6, r))); }
  // the marker pole with what is left of a glider's sail, and the satchel
  P.push(part(new THREE.CylinderGeometry(0.06, 0.09, 6.2, 5), '#6b5444', 0, T(2.3, 3.0, 0.4, 0.05, 0, -0.09)));
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, -1.7, 0, 2.3, -0.5, 0.25, 0, 0, 0, 2.3, -0.5, 0.25, 0, -1.7, 0]), 3));
  P.push(part(sail, '#ee8c7e', 0, T(2.05, 5.9, 0.4)));
  P.push(part(new THREE.BoxGeometry(0.9, 0.55, 0.6), '#7a5a44', 0, T(-1.5, 0.3, 1.2, 0, 0.6, 0.08)));
  P.push(part(new THREE.BoxGeometry(0.96, 0.12, 0.66), '#b9673f', 0, T(-1.5, 0.6, 1.2, 0, 0.6, 0.08)));
  return merge(P);
}

// the flattest high ground on an island, away from the rim and the water (island-local coordinates)
function findSite(isl) {
  const h = isl.height, R = isl.spec.radius || 150, pool = isl.spec.pool;
  let best = null, bs = -1e9;
  const step = Math.max(1, Math.round(3 / h.cell)), w = Math.max(1, Math.round(4 / h.cell));
  for (let k = w; k < h.nz - w; k += step) for (let i = w; i < h.nx - w; i += step) {
    const y = h.data[i + h.nx * k];
    if (isNaN(y)) continue;
    const x = h.x0 + i * h.cell, z = h.z0 + k * h.cell, d = Math.hypot(x, z);
    if (d > R * 0.62) continue;
    if (pool && Math.hypot((x - pool.c[0]) / (pool.r[0] + 14), (z - pool.c[2]) / (pool.r[1] + 14)) < 1) continue;
    let slope = 0, bad = false;
    for (const [di, dk] of [[w, 0], [-w, 0], [0, w], [0, -w], [w, w], [-w, -w], [w, -w], [-w, w]]) {
      const yy = h.data[i + di + h.nx * (k + dk)];
      if (isNaN(yy)) { bad = true; break; }
      slope = Math.max(slope, Math.abs(yy - y));
    }
    if (bad || slope > 1.6) continue;
    const score = y * 0.6 - slope * 9 - d * 0.035 + (h.shade ? h.shade[i + h.nx * k] * 6 : 0);
    if (score > bs) { bs = score; best = { x, y, z, i, k }; }
  }
  return best;
}

export const CAMP_ISLANDS = ['verdigris', 'windgate', 'mire', 'ember'];

export class Landmarks {
  constructor(scene, islands) {
    this.posts = []; this.camps = [];
    const postGeo = postGeometry();
    const ringGeo = [part(new THREE.TorusGeometry(2.5, 0.06, 5, 56), '#d8fff4', 0.8), part(new THREE.TorusGeometry(3.5, 0.045, 5, 64), '#d8fff4', 0.6)].map((g) => merge([g]));
    const crystalGeo = merge([part(new THREE.OctahedronGeometry(0.8, 0), '#c8fff0', 1, T(0, 0, 0, 0, 0, 0, 0.72, 1.25, 0.72))]);
    const pageGeo = merge([part(new THREE.OctahedronGeometry(0.42, 0), '#fff1d6', 1, T(0, 0, 0, 0, 0, 0, 0.8, 1.2, 0.2))]);
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
    const mk = () => {
      const u = { ...U, uActive: { value: 0 }, uPulse: { value: 0 } };
      return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: u, side: THREE.DoubleSide });
    };
    islands.forEach((isl, idx) => {
      const site = findSite(isl);
      if (!site) return;
      const mat = mk();
      const g = new THREE.Group();
      g.position.set(site.x, site.y - 0.25, site.z);
      g.rotation.y = idx * 1.3;
      const body = new THREE.Mesh(postGeo, mat);
      const crystal = new THREE.Mesh(crystalGeo, mat); crystal.position.y = 18.3;
      const r1 = new THREE.Mesh(ringGeo[0], mat), r2 = new THREE.Mesh(ringGeo[1], mat);
      r1.position.y = r2.position.y = 18.3;
      const beamMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: { ...U, uBeam: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.scale.set(1.5, 1500, 1.5); beam.position.y = 18.3 + 750; beam.renderOrder = 4; beam.visible = false; beam.frustumCulled = false;
      g.add(body, crystal, r1, r2, beam);
      isl.group.add(g);
      markCaster(body);
      const post = { isl, idx, g, mat, crystal, r1, r2, beam, beamMat, active: 0, target: 0, local: new THREE.Vector3(site.x, site.y, site.z) };
      this.posts.push(post);
      if (CAMP_ISLANDS.includes(isl.spec.key)) {
        // the camp sits a few metres from the post, on the flattest side
        let cb = null, cs = 1e9;
        for (let a = 0; a < 8; a++) {
          const x = site.x + Math.cos(a * 0.785) * 10, z = site.z + Math.sin(a * 0.785) * 10;
          const y = isl.groundAt(x + isl.pos.x, z + isl.pos.z) - isl.pos.y;
          if (isNaN(y)) continue;
          const s = Math.abs(y - site.y);
          if (s < cs) { cs = s; cb = { x, y, z }; }
        }
        if (cb) {
          const cg = new THREE.Group(); cg.position.set(cb.x, cb.y - 0.15, cb.z); cg.rotation.y = idx * 2.1;
          const cm = mk();
          const cairn = new THREE.Mesh(cairnGeometry(idx + 1), cm);
          const page = new THREE.Mesh(pageGeo, cm); page.position.set(0, 5.2, 0);
          const glintMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: { ...U, uBeam: { value: 0.16 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
          const glint = new THREE.Mesh(beamGeo, glintMat); glint.scale.set(0.35, 60, 0.35); glint.position.y = 5.2 + 30; glint.renderOrder = 4;
          cg.add(cairn, page, glint);
          isl.group.add(cg);
          markCaster(cairn);
          cm.uniforms.uActive.value = 0.0;
          this.camps.push({ isl, key: isl.spec.key, g: cg, mat: cm, page, glint, found: false, local: new THREE.Vector3(cb.x, cb.y + 2, cb.z), world: new THREE.Vector3() });
        }
      }
    });
    this.chord = 0; this.chordTarget = 0;
  }
  post(idx) { return this.posts.find((p) => p.idx === idx); }
  // world position of a post's crystal
  postWorld(p, out = new THREE.Vector3()) { return out.copy(p.local).add(p.isl.pos).setY(p.local.y + p.isl.pos.y + 18.3); }
  setFound(key, found) { const c = this.camps.find((k) => k.key === key); if (c) { c.found = found; c.page.visible = !found; c.glint.visible = !found; } }
  update(time, dt) {
    this.chord += (this.chordTarget - this.chord) * Math.min(1, dt * 0.5);
    for (const p of this.posts) {
      p.active += (p.target - p.active) * Math.min(1, dt * 0.8);
      p.mat.uniforms.uActive.value = p.active;
      p.mat.uniforms.uPulse.value = this.chord;
      const sp = 0.15 + p.active * 0.55 + this.chord * 0.6;
      p.crystal.rotation.y = time * sp * 1.4 + p.idx;
      p.crystal.position.y = 18.3 + Math.sin(time * 0.8 + p.idx) * 0.18 * (0.3 + p.active);
      p.r1.rotation.set(1.15 + Math.sin(time * 0.31 + p.idx) * 0.25, time * sp, 0.3);
      p.r2.rotation.set(1.75, -time * sp * 0.7, 0.9 + Math.cos(time * 0.23 + p.idx) * 0.25);
      p.beam.visible = this.chord > 0.01;
      p.beamMat.uniforms.uBeam.value = this.chord * (0.75 + 0.25 * Math.sin(time * 1.7 + p.idx * 1.9));
    }
    for (const c of this.camps) {
      c.world.copy(c.local).add(c.isl.pos);
      if (!c.found) { c.page.rotation.y = time * 1.2; c.page.position.y = 5.2 + Math.sin(time * 1.4) * 0.25; c.mat.uniforms.uActive.value = 1; }
      else c.mat.uniforms.uActive.value = 0;
    }
  }
}
