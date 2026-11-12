// Radial profile of a model (how wide it is at each height), for a cheap collision shape.
//   node tools/assets/profile.mjs model.glb [bins]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]); const bins = +(process.argv[3] || 12);
const pts = [];
for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; const M = n.getWorldMatrix();
  for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); const v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]); } } }
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, H = hi[1] - lo[1];
const prof = Array.from({ length: bins }, () => []);
for (const p of pts) { const b = Math.min(bins - 1, Math.floor((p[1] - lo[1]) / H * bins)); prof[b].push(Math.hypot(p[0] - cx, p[2] - cz)); }
console.log(JSON.stringify({ min: lo.map((v) => +v.toFixed(2)), max: hi.map((v) => +v.toFixed(2)), centre: [+cx.toFixed(2), +cz.toFixed(2)], radius: prof.map((r) => { r.sort((a, b) => a - b); return r.length ? +r[Math.floor(r.length * 0.9)].toFixed(2) : 0; }), count: prof.map((r) => r.length) }));
