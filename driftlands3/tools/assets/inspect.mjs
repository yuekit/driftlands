import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
for (const m of root.listMeshes()) { let tris = 0; for (const p of m.listPrimitives()) tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3; const p0 = m.listPrimitives()[0]; const pos = p0.getAttribute('POSITION'); console.log('mesh', m.getName(), 'prims', m.listPrimitives().length, 'tris', tris, 'min', pos.getMin([]).map((v) => +v.toFixed(1)), 'max', pos.getMax([]).map((v) => +v.toFixed(1)), 'mat', p0.getMaterial()?.getName()); }
for (const t of root.listTextures()) console.log('tex', t.getName(), t.getMimeType(), t.getSize(), Math.round(t.getImage().byteLength / 1024) + 'KB');
for (const n of root.listNodes()) console.log('node', n.getName(), n.getTranslation().map((v) => +v.toFixed(1)), n.getScale().map((v) => +v.toFixed(2)), n.getMesh()?.getName());
