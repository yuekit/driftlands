// The Floating Island pack's islet, for the skerries of the Reach: keeps the detailed mesh, brings its textures down
// to 1K WebP and packs it.   node tools/assets/islet.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !/high/i.test(n.getName())) n.dispose();
const m = doc.getRoot().listMaterials()[0];
console.log('material slots:', { base: m.getBaseColorTexture()?.getName(), normal: m.getNormalTexture()?.getName(), mr: m.getMetallicRoughnessTexture()?.getName(), occ: m.getOcclusionTexture()?.getName(), ext: m.listExtensions().map((e) => e.extensionName) });
await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 86 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
