// Gathers what kit_geo.mjs and kit_tex.mjs made into src/assets/d3/ and writes src/d3assets.js (the imports) and
// src/assets/d3/kits.json (what the game needs to know about each model and material).
// The materials of a kit are split in two sets by how much surface they cover: set A keeps the full size, set B half.
// node tools/d3/gen_index.mjs [--a-gae=16] [--a-csk=26] [--quality=84]
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const CACHE = 'tools/d3/.cache', OUT = 'src/assets/d3', Q = +(opt.quality || 78);
fs.rmSync(OUT, { recursive: true, force: true });
// Both kits share one numbering of materials (Gaea first, then City in the Sky) so that a bashed model can wear either's.
const NA = +(opt.a || 16);
const index = {}, imports = [], lines = [];
let n = 0;
const imp = (file) => { const v = 'a' + n++; imports.push(`import ${v} from './assets/d3/${file}';`); return v; };
{
  const gm = JSON.parse(fs.readFileSync(`${CACHE}/gae/mats.json`, 'utf8')), cm = JSON.parse(fs.readFileSync(`${CACHE}/csk/mats.json`, 'utf8'));
  const mats = [...gm.map((m) => ({ ...m, kit: 'gae' })), ...cm.map((m) => ({ ...m, kit: 'csk', id: m.id + gm.length }))];
  const models = [];
  for (const [dir, base] of [['gae', 0], ['csk', gm.length], ['mix', 0]]) {
    const geoDir = `${CACHE}/geo/${dir}`; if (!fs.existsSync(geoDir)) continue;
    for (const f of fs.readdirSync(geoDir).filter((f) => f.endsWith('.json'))) models.push({ ...JSON.parse(fs.readFileSync(path.join(geoDir, f), 'utf8')), dir, base });
  }
  // rank the materials by the surface they cover across the models that are used
  const area = {}; for (const m of models) for (const k in m.area) area[k] = (area[k] || 0) + m.area[k];
  const usedMats = mats.filter((m) => area[m.name] > 0).sort((a, b) => area[b.name] - area[a.name]);
  const setA = usedMats.slice(0, NA), setB = usedMats.slice(NA);
  fs.mkdirSync(`${OUT}/tex`, { recursive: true }); fs.mkdirSync(`${OUT}/m`, { recursive: true });
  const jobs = [];
  // a few more kinds than the texture step knows: walls that show lit portholes at night, woven walls that leak lamplight
  const kind = (m) => m.kind || (/^(MetalPanel(?!.*Trim)|MetalPaneledOverlap|WoodPlankPainted|MetalCorrugated|MetalPaint(Sand|White|Gray$))/.test(m.short) ? 'wall' : /^(WallWeave|BambooWall)/.test(m.short) ? 'weave' : '');
  const matOut = mats.map((m) => ({ name: m.kit + ':' + m.short, set: -1, layer: 0, cut: m.cut, kind: kind(m), metal: m.metal, rough: m.rough, avg: m.avg }));
  const texVars = { A: [], B: [] };
  [[setA, 'A', 1], [setB, 'B', 0.5]].forEach(([set, tag, k]) => set.forEach((m, layer) => {
    const o = matOut[m.id]; o.set = tag === 'A' ? 0 : 1; o.layer = layer;
    const size = Math.round(m.size * k);
    for (const ch of ['c', 'n']) {
      const dst = `tex/${m.kit}_${m.short}_${ch}.webp`;
      jobs.push(async () => {
        const src = `${CACHE}/${m.kit}/${m.name}_${ch}.webp`;
        let img = sharp(src).resize(size, size, { kernel: 'lanczos3' });
        if (ch === 'c' && !m.cut) {
          // where the metalness barely varies it is carried as one number and the picture needs no fourth channel
          const st = await sharp(src).extractChannel(3).stats();
          if (st.channels[0].stdev < 9) { img = img.removeAlpha(); o.flat = true; o.metal = +((st.channels[0].mean - 1) / 254).toFixed(3); }
        }
        await img.webp({ quality: ch === 'n' ? Q + 4 : Q, alphaQuality: ch === 'n' ? 72 : 84, effort: 5 }).toFile(`${OUT}/${dst}`);
      });
    }
    texVars[tag].push(`{ c: ${imp(`tex/${m.kit}_${m.short}_c.webp`)}, n: ${imp(`tex/${m.kit}_${m.short}_n.webp`)} }`);
  }));
  const q = jobs.slice(); await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) await q.shift()(); }));
  const modelOut = {}, modelVars = [];
  for (const m of models) {
    let short = m.model.replace(/^KB3D_[A-Z]+_/, '').replace(/_A_light$/, '');
    if (m.dir === 'csk') short = short.replace(/_A$/, '');
    if (modelOut[short]) throw new Error('two models named ' + short);
    fs.copyFileSync(`${CACHE}/geo/${m.dir}/${m.model}.glb`, `${OUT}/m/${short}.glb`);
    fs.copyFileSync(`${CACHE}/geo/${m.dir}/${m.model}.sdf`, `${OUT}/m/${short}.bin`);
    modelOut[short] = { min: m.min, max: m.max, tris: m.tris, sdf: m.sdf, uv: m.uv, lamps: m.lamps, spin: m.spin || [], base: m.global ? 0 : m.base, sockets: m.sockets || {} };
    modelVars.push(`  ${JSON.stringify(short)}: { glb: ${imp(`m/${short}.glb`)}, sdf: ${imp(`m/${short}.bin`)} },`);
  }
  index.d3 = { sizeA: setA.length ? setA[0].size : 0, sizeB: setB.length ? Math.round(setB[0].size / 2) : 0, materials: matOut, models: modelOut };
  lines.push(`export const D3 = {\n  texA: [${texVars.A.join(', ')}],\n  texB: [${texVars.B.join(', ')}],\n  models: {\n${modelVars.join('\n')}\n  },\n};`);
  console.log(models.length, 'models,', setA.length, '+', setB.length, 'materials (', mats.length - usedMats.length, 'unused )');
}
fs.writeFileSync(`${OUT}/kits.json`, JSON.stringify(index));
fs.writeFileSync('src/d3assets.js', `// Generated by tools/d3/gen_index.mjs. Do not edit.\n${imports.join('\n')}\nexport { default as KITS } from './assets/d3/kits.json';\n${lines.join('\n')}\n`);
let total = 0; for (const f of fs.readdirSync(OUT, { recursive: true })) { const s = fs.statSync(path.join(OUT, f)); if (s.isFile()) total += s.size; }
console.log('src/assets/d3:', (total / 1048576).toFixed(1), 'MB');
