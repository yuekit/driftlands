import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
for (const m of root.listMaterials()) console.log('mat', m.getName(), m.getBaseColorFactor().map((v) => +v.toFixed(2)), 'metal', m.getMetallicFactor(), 'rough', m.getRoughnessFactor(), 'emis', m.getEmissiveFactor(), 'tex', !!m.getBaseColorTexture());
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) console.log(m.getName(), p.listSemantics().join(','), p.getMaterial().getName(), p.getMaterial().getBaseColorFactor().map((v) => +v.toFixed(2)), (p.getIndices()?.getCount() || 0) / 3);
