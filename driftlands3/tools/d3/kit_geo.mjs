// One KitBash3D model (as converted by 3d-library/_pipeline/kb3d) to the game's form:
//   <out>/<Model>.glb   three meshes: L0 (near), L1 (middle), L2 (far, vertex colours only), each ONE primitive.
//                       COLOR_0 on L0/L1: R = baked ambient occlusion, G = material id / 255, B = spin group, A = 1
//                       COLOR_0 on L2:    RGB = the material's average colour (sRGB) x occlusion, A = glow
//   <out>/<Model>.sdf   distance to the nearest surface, one byte per voxel (0..dmax)
//   <out>/<Model>.json  bounds, counts, the sdf grid, surface area per material, lamp positions
// node tools/d3/kit_geo.mjs <kit folder> <Model> <out dir> [--cap=450000] [--l1=0.14] [--l2=0.012] [--rays=20]
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [kitDir, model, outDir, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const CAP = +(opt.cap || 450000), R1 = +(opt.l1 || 0.14), R2 = +(opt.l2 || 0.012), RAYS = +(opt.rays || 20);
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const kit = JSON.parse(fs.readFileSync(path.join(kitDir, 'kit.json'), 'utf8'));
const MATS = kit.materials.map((m) => m.name);
const t0 = Date.now(), log = (...a) => console.log(`[${model}]`, ...a, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// ---------------------------------------------------------------- read and merge
const doc = await io.read(path.join(kitDir, 'models', model + '.glb'));
let nV = 0, nI = 0;
const prims = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const M = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const p of mesh.listPrimitives()) { prims.push({ p, M }); nV += p.getAttribute('POSITION').getCount(); nI += p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount(); }
}
let pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), mat = new Uint8Array(nV), idx = new Uint32Array(nI);
{
  let v0 = 0, i0 = 0; const a = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { p, M } of prims) {
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), T = p.getAttribute('TEXCOORD_0'), I = p.getIndices();
    const id = MATS.indexOf(p.getMaterial() ? p.getMaterial().getName() : '');
    if (id < 0) throw new Error('unknown material ' + (p.getMaterial() && p.getMaterial().getName()));
    nm.getNormalMatrix(M);
    const n = P.getCount(), el = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      P.getElement(i, el); a.set(el[0], el[1], el[2]).applyMatrix4(M); pos[(v0 + i) * 3] = a.x; pos[(v0 + i) * 3 + 1] = a.y; pos[(v0 + i) * 3 + 2] = a.z;
      if (N) { N.getElement(i, el); a.set(el[0], el[1], el[2]).applyMatrix3(nm).normalize(); } else a.set(0, 1, 0);
      nrm[(v0 + i) * 3] = a.x; nrm[(v0 + i) * 3 + 1] = a.y; nrm[(v0 + i) * 3 + 2] = a.z;
      if (T) { T.getElement(i, el); uv[(v0 + i) * 2] = el[0]; uv[(v0 + i) * 2 + 1] = el[1]; }
      mat[v0 + i] = id;
    }
    if (I) { const arr = I.getArray(); for (let i = 0; i < arr.length; i++) idx[i0 + i] = arr[i] + v0; i0 += arr.length; }
    else { for (let i = 0; i < n; i++) idx[i0 + i] = v0 + i; i0 += n; }
    v0 += n;
  }
}
log('read', nV, 'verts', nI / 3, 'tris', prims.length, 'prims');

// drop degenerate triangles
{
  let k = 0;
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; if (a === b || b === c || a === c) continue; idx[k++] = a; idx[k++] = b; idx[k++] = c; }
  idx = idx.subarray(0, k);
}

const attrs = (() => { const a = new Float32Array(nV * 5); for (let i = 0; i < nV; i++) { a[i * 5] = nrm[i * 3]; a[i * 5 + 1] = nrm[i * 3 + 1]; a[i * 5 + 2] = nrm[i * 3 + 2]; a[i * 5 + 3] = uv[i * 2]; a[i * 5 + 4] = uv[i * 2 + 1]; } return a; })();
// simplify toward a triangle count: careful first, then permissive, then sloppy (which ignores topology)
function reduce(indices, target, error, allowSloppy = true) {
  const want = Math.floor(target) * 3;
  if (indices.length <= want) return indices;
  let [out] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 0.02, 0.02], null, want, error, ['Prune']);
  if (out.length > want * 1.25) { const [o2] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attrs, 5, [0.2, 0.2, 0.2, 0.005, 0.005], null, want, error * 3, ['Prune', 'Permissive']); if (o2.length < out.length) out = o2; }
  if (allowSloppy && out.length > want * 1.6) { const [o3] = MeshoptSimplifier.simplifySloppy(out, pos, 3, null, want, 0.05); if (o3.length > 0 && o3.length < out.length) out = o3; }
  return out;
}
const L0 = reduce(idx, CAP, 0.002, opt.sloppy0 === '1');
log('L0', L0.length / 3);

// ---------------------------------------------------------------- bounds
const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
for (let i = 0; i < L0.length; i++) for (let k = 0; k < 3; k++) { const v = pos[L0[i] * 3 + k]; if (v < bmin[k]) bmin[k] = v; if (v > bmax[k]) bmax[k] = v; }
const size = bmax.map((v, k) => v - bmin[k]), maxDim = Math.max(...size);

// ---------------------------------------------------------------- baked occlusion (vertices of L0)
const used = new Uint8Array(nV); for (let i = 0; i < L0.length; i++) used[L0[i]] = 1;
const ao = new Float32Array(nV).fill(1);
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(L0), 1));
  const bvh = new MeshBVH(g, { targetLeafSize: 6 });
  const ray = new THREE.Ray(), n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  const far = Math.min(14, Math.max(5, maxDim * 0.16));
  // a fixed set of cosine-weighted directions, turned by a different angle at every vertex
  const dirs = []; for (let i = 0; i < RAYS; i++) { const u = (i + 0.5) / RAYS, r = Math.sqrt(u), ph = i * 2.399963; dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u)]); }
  let count = 0;
  for (let v = 0; v < nV; v++) {
    if (!used[v]) continue; count++;
    n.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    if (Math.abs(n.y) < 0.99) t.set(0, 1, 0).cross(n).normalize(); else t.set(1, 0, 0).cross(n).normalize();
    b.crossVectors(n, t);
    const rot = ((v * 2654435761) >>> 0) / 4294967296 * 6.2832, cr = Math.cos(rot), sr = Math.sin(rot);
    ray.origin.set(pos[v * 3] + n.x * 0.04, pos[v * 3 + 1] + n.y * 0.04, pos[v * 3 + 2] + n.z * 0.04);
    let occ = 0;
    for (let k = 0; k < RAYS; k++) {
      const D = dirs[k], dx = D[0] * cr - D[1] * sr, dy = D[0] * sr + D[1] * cr;
      d.set(t.x * dx + b.x * dy + n.x * D[2], t.y * dx + b.y * dy + n.y * D[2], t.z * dx + b.z * dy + n.z * D[2]);
      ray.direction.copy(d);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far);
      if (h) { const f = h.distance / far; occ += 1 - f * f; }
    }
    ao[v] = 1 - occ / RAYS;
  }
  log('ao', count, 'verts, reach', far.toFixed(1));
}

// ---------------------------------------------------------------- the lower levels
const L1 = reduce(L0, Math.max(6000, (L0.length / 3) * R1), 0.01);
const t2 = Math.min(16000, Math.max(2500, (L0.length / 3) * R2));
let L2 = L1;
if (L1.length > Math.floor(t2) * 3) { const [o] = MeshoptSimplifier.simplifySloppy(L1, pos, 3, null, Math.floor(t2) * 3, 0.1); if (o.length) L2 = o; }
log('L1', L1.length / 3, 'L2', L2.length / 3);

// ---------------------------------------------------------------- area per material, lamps
const area = new Float64Array(MATS.length);
const lampCells = new Map();
const EMIS = new Set(kit.materials.map((m, i) => (m.emissive && /Lamp|Light|Lantern|Bulb/i.test(m.name) ? i : -1)).filter((i) => i >= 0));
{
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < L0.length; i += 3) {
    const a = L0[i], b = L0[i + 1], c = L0[i + 2];
    A.fromArray(pos, a * 3); B.fromArray(pos, b * 3); C.fromArray(pos, c * 3);
    const ar = B.sub(A).cross(C.sub(A)).length() * 0.5;
    area[mat[a]] += ar;
    if (EMIS.has(mat[a])) {
      C.fromArray(pos, c * 3); B.fromArray(pos, b * 3);
      const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3, cz = (A.z + B.z + C.z) / 3;
      const key = Math.round(cx / 1.6) + ',' + Math.round(cy / 1.6) + ',' + Math.round(cz / 1.6);
      const e = lampCells.get(key) || [0, 0, 0, 0]; e[0] += cx * ar; e[1] += cy * ar; e[2] += cz * ar; e[3] += ar; lampCells.set(key, e);
    }
  }
}
let lamps = [...lampCells.values()].filter((e) => e[3] > 0.02).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]]);
// merge neighbours
{ const out = []; for (const l of lamps.sort((a, b) => b[3] - a[3])) { const o = out.find((q) => Math.hypot(q[0] - l[0], q[1] - l[1], q[2] - l[2]) < 1.8); if (o) { const w = o[3] + l[3]; for (let k = 0; k < 3; k++) o[k] = (o[k] * o[3] + l[k] * l[3]) / w; o[3] = w; } else out.push(l.slice()); } lamps = out.map((l) => l.map((x) => +x.toFixed(2))); }

// ---------------------------------------------------------------- distance field
const voxel = Math.max(1.0, +(maxDim / 80).toFixed(2)), PAD = 8, dmax = PAD * voxel;
const dims = size.map((s) => Math.ceil(s / voxel) + PAD * 2), origin = bmin.map((v) => v - PAD * voxel);
const [nx, ny, nz] = dims, NVOX = nx * ny * nz;
const f = new Float32Array(NVOX).fill(1e12);
{
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  const step = voxel * 0.5;
  for (let i = 0; i < L0.length; i += 3) {
    A.fromArray(pos, L0[i] * 3); B.fromArray(pos, L0[i + 1] * 3); C.fromArray(pos, L0[i + 2] * 3);
    const e1 = A.distanceTo(B), e2 = A.distanceTo(C), n1 = Math.max(1, Math.ceil(e1 / step)), n2 = Math.max(1, Math.ceil(e2 / step));
    for (let a = 0; a <= n1; a++) for (let b = 0; b <= n2; b++) {
      let u = a / n1, v = b / n2; if (u + v > 1) { u = 1 - u; v = 1 - v; }
      P.copy(A).addScaledVector(B.clone().sub(A), u).addScaledVector(C.clone().sub(A), v);
      const x = Math.floor((P.x - origin[0]) / voxel), y = Math.floor((P.y - origin[1]) / voxel), z = Math.floor((P.z - origin[2]) / voxel);
      if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) f[x + nx * (y + ny * z)] = 0;
    }
  }
  // exact squared distance transform, one axis at a time (Felzenszwalb and Huttenlocher)
  const edt = (n, get, set) => {
    const v = new Int32Array(n), zz = new Float64Array(n + 1), g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = get(i);
    let k = 0; v[0] = 0; zz[0] = -1e20; zz[1] = 1e20;
    for (let q = 1; q < n; q++) {
      let s;
      do { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); } while (s <= zz[k] && --k >= 0);
      k++; v[k] = q; zz[k] = s; zz[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; const p = v[k]; set(q, (q - p) * (q - p) + g[p]); }
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { const o = nx * (y + ny * z); edt(nx, (i) => f[o + i], (i, d) => { f[o + i] = d; }); }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { const o = x + nx * ny * z; edt(ny, (i) => f[o + i * nx], (i, d) => { f[o + i * nx] = d; }); }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const o = x + nx * y; edt(nz, (i) => f[o + i * nx * ny], (i, d) => { f[o + i * nx * ny] = d; }); }
}
const sdf = new Uint8Array(NVOX);
for (let i = 0; i < NVOX; i++) sdf[i] = Math.min(255, Math.round(Math.sqrt(f[i]) / PAD * 255));
log('sdf', dims.join('x'), 'voxel', voxel);

// the direction a cloud of points is thinnest in: the eigenvector of its covariance with the smallest eigenvalue (Jacobi)
function thinAxis(S) {
  S = S.map((r) => r.slice());
  const Vv = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(S[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * S[p][q], S[q][q] - S[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const a = S[k][p], b = S[k][q]; S[k][p] = cs * a - sn * b; S[k][q] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = S[p][k], b = S[q][k]; S[p][k] = cs * a - sn * b; S[q][k] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = Vv[k][p], b = Vv[k][q]; Vv[k][p] = cs * a - sn * b; Vv[k][q] = sn * a + cs * b; }
  }
  const ev = [S[0][0], S[1][1], S[2][2]], lo = ev.indexOf(Math.min(...ev));
  return [Vv[0][lo], Vv[1][lo], Vv[2][lo]];
}
// ---------------------------------------------------------------- rotors
// Everything wearing a propeller material is gathered into rotors: connected shells, shells that touch joined into one
// rotor, and for each rotor a hub point and an axis (the direction it is thinnest in). The game spins them in the vertex shader.
const spinOf = new Uint8Array(nV), spin = [];
{
  const PROP = new Set(MATS.map((n, i) => (/Propellers/.test(n) ? i : -1)).filter((i) => i >= 0));
  const parent = new Map(), find = (a) => { let r = a; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(a) !== r) { const n = parent.get(a); parent.set(a, r); a = n; } return r; };
  const key = (v) => Math.round(pos[v * 3] * 100) + ',' + Math.round(pos[v * 3 + 1] * 100) + ',' + Math.round(pos[v * 3 + 2] * 100);
  const tris = [];
  for (let i = 0; i < L0.length; i += 3) {
    if (!PROP.has(mat[L0[i]])) continue;
    const k = [key(L0[i]), key(L0[i + 1]), key(L0[i + 2])];
    for (const q of k) if (!parent.has(q)) parent.set(q, q);
    parent.set(find(k[1]), find(k[0])); parent.set(find(k[2]), find(k[0]));
    tris.push(i);
  }
  if (tris.length) {
    const shells = new Map();
    for (const i of tris) {
      const r = find(key(L0[i])); let sh = shells.get(r);
      if (!sh) shells.set(r, sh = { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
      sh.tris.push(i);
      for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) { const v = pos[L0[i + c] * 3 + k]; if (v < sh.min[k]) sh.min[k] = v; if (v > sh.max[k]) sh.max[k] = v; }
    }
    const list = [...shells.values()], gp = list.map((_, i) => i), gf = (a) => { while (gp[a] !== a) a = gp[a] = gp[gp[a]]; return a; };
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = list[a], B = list[b]; let touch = true;
      for (let k = 0; k < 3; k++) { const pad = 0.12 + 0.04 * Math.max(A.max[k] - A.min[k], B.max[k] - B.min[k]); if (A.min[k] - pad > B.max[k] || B.min[k] - pad > A.max[k]) { touch = false; break; } }
      if (touch) gp[gf(a)] = gf(b);
    }
    const groups = new Map();
    list.forEach((sh, i) => { const r = gf(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(sh); });
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), blades = [];
    for (const g of groups.values()) {
      // area-weighted centroid and covariance of the rotor's surface
      let w = 0; const c = [0, 0, 0], T = g.flatMap((sh) => sh.tris);
      const samples = [];
      for (const i of T) {
        A.fromArray(pos, L0[i] * 3); B.fromArray(pos, L0[i + 1] * 3); C.fromArray(pos, L0[i + 2] * 3);
        const ar = B.clone().sub(A).cross(C.clone().sub(A)).length() * 0.5 + 1e-9, m = [(A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3];
        samples.push([m, ar]); w += ar; for (let k = 0; k < 3; k++) c[k] += m[k] * ar;
      }
      for (let k = 0; k < 3; k++) c[k] /= w;
      const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const [m, ar] of samples) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += (m[a] - c[a]) * (m[b] - c[b]) * ar / w;
      const ax = thinAxis(S);
      let rad = 0, thick = 0;
      for (const i of T) for (let cc = 0; cc < 3; cc++) {
        const v = L0[i + cc], d = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]], along = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
        rad = Math.max(rad, Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - along * along))); thick = Math.max(thick, Math.abs(along));
      }
      if (rad < 0.3 || T.length < 4) continue;
      blades.push({ c, ax, rad, thick, T });
    }
    // blades do not touch each other (the hub between them is another material): blades of one size standing close
    // together are one rotor, turning about the middle of them
    const bp = blades.map((_, i) => i), bf = (a) => { while (bp[a] !== a) a = bp[a] = bp[bp[a]]; return a; };
    for (let a = 0; a < blades.length; a++) for (let b = a + 1; b < blades.length; b++) {
      const A2 = blades[a], B2 = blades[b], m = Math.max(A2.rad, B2.rad);
      if (Math.abs(A2.rad - B2.rad) < 0.12 * m && Math.hypot(A2.c[0] - B2.c[0], A2.c[1] - B2.c[1], A2.c[2] - B2.c[2]) < 2.9 * m) bp[bf(a)] = bf(b);
    }
    const rotors = new Map();
    blades.forEach((bl, i) => { const r = bf(i); if (!rotors.has(r)) rotors.set(r, []); rotors.get(r).push(bl); });
    for (const g of rotors.values()) {
      if (spin.length >= 250) break;
      let c, ax;
      if (g.length === 1) {
        // a rotor in one piece: wider than it is deep
        if (g[0].thick > g[0].rad * 0.6 || g[0].rad < 0.6) continue;
        c = g[0].c; ax = g[0].ax;
      } else {
        c = [0, 0, 0]; ax = [0, 0, 0];
        for (const bl of g) { const sgn = bl.ax[0] * g[0].ax[0] + bl.ax[1] * g[0].ax[1] + bl.ax[2] * g[0].ax[2] < 0 ? -1 : 1; for (let k = 0; k < 3; k++) { c[k] += bl.c[k] / g.length; ax[k] += bl.ax[k] * sgn; } }
        if (g.length >= 3) {
          // three blades or more: the axis is square to the plane their middles lie in (whichever way the blades themselves face)
          const S2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
          for (const bl of g) for (let a2 = 0; a2 < 3; a2++) for (let b2 = 0; b2 < 3; b2++) S2[a2][b2] += (bl.c[a2] - c[a2]) * (bl.c[b2] - c[b2]);
          ax = thinAxis(S2);
        } else {
          // two blades: square to the line between them, leaning the way the blades are thin
          const ln = [g[1].c[0] - g[0].c[0], g[1].c[1] - g[0].c[1], g[1].c[2] - g[0].c[2]], ll = Math.hypot(...ln) || 1, dt = (ax[0] * ln[0] + ax[1] * ln[1] + ax[2] * ln[2]) / (ll * ll);
          ax = ax.map((x, k) => x - ln[k] * dt);
          const l = Math.hypot(...ax); if (l < 0.3) continue;
          ax = ax.map((x) => x / l);
        }
        // the blades must stand round the axis at one distance, or this is not a rotor
        const ds = g.map((bl) => { const d = [bl.c[0] - c[0], bl.c[1] - c[1], bl.c[2] - c[2]], al = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; return [Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - al * al)), Math.abs(al)]; });
        const mean = ds.reduce((a2, d) => a2 + d[0], 0) / ds.length;
        if (ds.some((d) => Math.abs(d[0] - mean) > 0.25 * mean + 0.2 || d[1] > 0.35 * mean + 0.3)) continue;
      }
      let rad = 0;
      for (const bl of g) for (const i of bl.T) for (let cc = 0; cc < 3; cc++) {
        const v = L0[i + cc], d = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]], al = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
        rad = Math.max(rad, Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - al * al)));
      }
      spin.push([...c, ...ax, rad].map((x) => +x.toFixed(4)));
      for (const bl of g) for (const i of bl.T) for (let cc = 0; cc < 3; cc++) spinOf[L0[i + cc]] = spin.length;
    }
    log('rotors', spin.length, 'from', list.length, 'shells');
  }
}

// ---------------------------------------------------------------- write
const matInfo = opt.mats ? JSON.parse(fs.readFileSync(opt.mats, 'utf8')) : null;
const avg = kit.materials.map((m, i) => (matInfo && matInfo[i] ? matInfo[i].avg : [0.5, 0.5, 0.5]));
const glowOf = (name) => (/RicePaper/.test(name) ? 1 : /Glass|Lamps/.test(name) ? 0.8 : 0);
const out = new Document(); const buf = out.createBuffer();
const scene = out.createScene();
function addLevel(name, indices, far) {
  const [remapped, count] = MeshoptSimplifier.compactMesh(new Uint32Array(indices));
  // compactMesh rewrites the indices and tells, for each old vertex, its new place through the order of first use
  const map = new Int32Array(nV).fill(-1); let next = 0; const order = new Uint32Array(count);
  const ind = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) { const v = indices[i]; if (map[v] < 0) { map[v] = next; order[next++] = v; } ind[i] = map[v]; }
  const P = new Float32Array(next * 3), N = new Float32Array(next * 3), T = new Uint16Array(next * 2), Cc = new Uint8Array(next * 4);
  for (let i = 0; i < next; i++) {
    const v = order[i];
    P.set(pos.subarray(v * 3, v * 3 + 3), i * 3); N.set(nrm.subarray(v * 3, v * 3 + 3), i * 3); T[i * 2] = Math.round((uv[v * 2] - uvMin[0]) / uvRange[0] * 65535); T[i * 2 + 1] = Math.round((uv[v * 2 + 1] - uvMin[1]) / uvRange[1] * 65535);
    const o = Math.max(0, Math.min(1, ao[v]));
    if (far) { const c = avg[mat[v]]; const s = (x) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, x * 1.35 * (0.55 + 0.45 * o))), 1 / 2.2)); Cc[i * 4] = s(c[0]); Cc[i * 4 + 1] = s(c[1]); Cc[i * 4 + 2] = s(c[2]); Cc[i * 4 + 3] = Math.round(255 * glowOf(MATS[mat[v]])); }
    else { Cc[i * 4] = Math.round(o * 255); Cc[i * 4 + 1] = mat[v]; Cc[i * 4 + 2] = spinOf[v]; Cc[i * 4 + 3] = 255; }
  }
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
    .setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
    .setAttribute('COLOR_0', out.createAccessor().setType('VEC4').setArray(Cc).setNormalized(true).setBuffer(buf))
    .setIndices(out.createAccessor().setType('SCALAR').setArray(ind).setBuffer(buf));
  if (!far) prim.setAttribute('TEXCOORD_0', out.createAccessor().setType('VEC2').setArray(T).setNormalized(true).setBuffer(buf));
  scene.addChild(out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim)));
  return [next, indices.length / 3];
}
const uvMin = [1e9, 1e9], uvMax = [-1e9, -1e9];
for (let i = 0; i < L0.length; i++) for (let k = 0; k < 2; k++) { const v = uv[L0[i] * 2 + k]; if (v < uvMin[k]) uvMin[k] = v; if (v > uvMax[k]) uvMax[k] = v; }
const uvRange = [Math.max(1e-6, uvMax[0] - uvMin[0]), Math.max(1e-6, uvMax[1] - uvMin[1])];
log('uv range', uvMin.map((x) => x.toFixed(1)).join(','), '..', uvMax.map((x) => x.toFixed(1)).join(','));
const counts = [addLevel('L0', L0, false), addLevel('L1', L1, false), addLevel('L2', L2, true)];
await out.transform(reorder({ encoder: MeshoptEncoder, level: 'medium' }), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 16, quantizeNormal: 8 }));
out.createExtension(KHRMeshQuantization).setRequired(true);
out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
fs.mkdirSync(outDir, { recursive: true });
await io.write(path.join(outDir, model + '.glb'), out);
fs.writeFileSync(path.join(outDir, model + '.sdf'), sdf);
const r3 = (a) => a.map((x) => +x.toFixed(3));
fs.writeFileSync(path.join(outDir, model + '.json'), JSON.stringify({
  model, min: r3(bmin), max: r3(bmax), tris: counts.map((c) => c[1]), verts: counts.map((c) => c[0]),
  sdf: { dims, voxel, origin: r3(origin), dmax }, uv: [...uvMin, ...uvRange].map((x) => +x.toFixed(5)),
  area: Object.fromEntries([...area].map((a, i) => [MATS[i], +a.toFixed(1)]).filter((e) => e[1] > 0)), lamps, spin,
}));
log('wrote', (fs.statSync(path.join(outDir, model + '.glb')).size / 1048576).toFixed(2), 'MB');
