// A converted KitBash3D kit's materials.glb to the game's two maps per material, at the size they came in:
//   <cache>/<Mat>_c.webp   RGB colour, A = metalness (1..255) or, for cut-out materials, opacity
//   <cache>/<Mat>_n.webp   RG normal, B roughness, A occlusion (1..255)
//   <cache>/<Mat>_e.webp   emission, where the material has any
//   <cache>/mats.json      one entry per material, in kit.json's order (that order is the material id in the models)
// node tools/d3/kit_tex.mjs <kit folder> <cache dir>
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [kitDir, cache] = process.argv.slice(2);
const kit = JSON.parse(fs.readFileSync(path.join(kitDir, 'kit.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(kitDir, 'materials.glb'));
const byName = Object.fromEntries(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
fs.mkdirSync(cache, { recursive: true });
const raw = async (tex, size) => (tex ? sharp(tex.getImage()).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer() : null);
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const kindOf = (n) => (/RicePaper/.test(n) ? 'paper' : /Glass/.test(n) ? 'glass' : /Water/.test(n) ? 'water' : /Lamps/.test(n) ? 'lamp' : /Plants/.test(n) ? 'leaf' : /Thatch/.test(n) ? 'thatch' : /Fabric|Flag|Curtain|Carpet|Tents|Net\b|Scraps/.test(n) ? 'cloth' : /Decal/.test(n) ? 'decal' : '');
const out = [];
let done = 0;
const work = kit.materials.map((km, id) => async () => {
  const m = byName[km.name]; if (!m) throw new Error('no material ' + km.name);
  const bt = m.getBaseColorTexture(), size = bt ? bt.getSize()[0] : 1024, px = size * size;
  const cut = m.getAlphaMode() !== 'OPAQUE';
  const [b, orm, nt, et] = await Promise.all([raw(bt, size), raw(m.getMetallicRoughnessTexture() || m.getOcclusionTexture(), size), raw(m.getNormalTexture(), size), raw(m.getEmissiveTexture(), size)]);
  const bf = m.getBaseColorFactor(), mf = m.getMetallicFactor(), rf = m.getRoughnessFactor();
  const C = Buffer.alloc(px * 4), N = Buffer.alloc(px * 4);
  let ar = 0, ag = 0, ab = 0, aw = 0, am = 0, arr = 0;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const r = b ? b[o] : 255 * bf[0], g = b ? b[o + 1] : 255 * bf[1], bl = b ? b[o + 2] : 255 * bf[2], a = b ? b[o + 3] : 255;
    const occ = orm ? orm[o] : 255, rough = (orm ? orm[o + 1] : 255) * rf, metal = (orm ? orm[o + 2] : 255) * mf;
    C[o] = r; C[o + 1] = g; C[o + 2] = bl; C[o + 3] = cut ? a : Math.max(1, Math.round(metal));
    N[o] = nt ? nt[o] : 128; N[o + 1] = nt ? nt[o + 1] : 128; N[o + 2] = Math.round(rough); N[o + 3] = Math.max(1, occ);
    const w = cut ? a / 255 : 1;
    ar += lin(r) * w; ag += lin(g) * w; ab += lin(bl) * w; aw += w; am += metal * w; arr += rough * w;
  }
  aw = Math.max(aw, 1e-6);
  await sharp(C, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 90, alphaQuality: 92, effort: 4 }).toFile(path.join(cache, km.name + '_c.webp'));
  await sharp(N, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 92, alphaQuality: 90, effort: 4 }).toFile(path.join(cache, km.name + '_n.webp'));
  let emis = 0;
  if (et) {
    let s = 0; for (let i = 0; i < px; i++) s += Math.max(et[i * 4], et[i * 4 + 1], et[i * 4 + 2]);
    emis = s / px / 255;
    await sharp(et, { raw: { width: size, height: size, channels: 4 } }).removeAlpha().webp({ quality: 88 }).toFile(path.join(cache, km.name + '_e.webp'));
  }
  const ef = m.getEmissiveFactor();
  out[id] = { id, name: km.name, short: km.name.replace(/^KB3D_[A-Z]+_/, ''), size, cut, kind: kindOf(km.name), avg: [ar / aw, ag / aw, ab / aw].map((x) => +x.toFixed(4)), metal: +(am / aw / 255).toFixed(3), rough: +(arr / aw / 255).toFixed(3), emis: +emis.toFixed(4), emisFactor: ef, kb3d: m.getExtras().kb3d || null };
  console.log(`${++done}/${kit.materials.length}`, km.name, size, cut ? 'cut' : '', out[id].kind, 'avg', out[id].avg.join(','), 'metal', out[id].metal, 'rough', out[id].rough, emis ? 'emis ' + emis.toFixed(3) : '');
});
// a few at a time
const q = work.slice(); await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) await q.shift()(); }));
fs.writeFileSync(path.join(cache, 'mats.json'), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'materials to', cache);
