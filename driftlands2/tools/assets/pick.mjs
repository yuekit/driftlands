// Keeps the named meshes of a GLB and drops the rest, then packs it with meshopt.
//   node tools/assets/pick.mjs in.glb out.glb name [name ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const [src, dst, ...keep] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !keep.includes(n.getName())) n.dispose();
await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
console.log('kept', doc.getRoot().listNodes().map((n) => n.getName()).join(', '));
