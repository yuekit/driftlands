import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const root = doc.getRoot();
  console.log(f.split('/').pop(), 'nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'mats', root.listMaterials().map((m) => m.getName()).join(','), 'tex', root.listTextures().length);
  for (const n of root.listNodes()) { const m = n.getMesh(); if (!m) continue; let t = 0, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of m.listPrimitives()) { t += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3; const a = p.getAttribute('POSITION'), lo = a.getMinNormalized([]), hi = a.getMaxNormalized([]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], lo[k]); mx[k] = Math.max(mx[k], hi[k]); } } const s = n.getWorldScale(); console.log('  ', n.getName(), Math.round(t), 'tris size', mx.map((v, k) => ((v - mn[k]) * s[k]).toFixed(1)).join(' x '), 'attrs', m.listPrimitives()[0].listSemantics().join(',')); }
}
