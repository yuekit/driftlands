import { buildIsland, buildRocklet } from './mesher.js';
import { buildCloudTexture } from './cloudtex.js';
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'island') {
    const r = buildIsland(m.index, m.cell, m.lodCell, (p) => self.postMessage({ type: 'progress', id: m.id, p }));
    const tr = [];
    for (const k of ['hi', 'lo']) for (const a of Object.values(r[k])) tr.push(a.buffer);
    tr.push(r.height.data.buffer, r.height.shade.buffer, r.candidates.buffer);
    self.postMessage({ type: 'done', id: m.id, result: r }, tr);
  } else if (m.type === 'clouds') {
    const data = buildCloudTexture(m.size, 11);
    const rocks = [buildRocklet(91, 1.0), buildRocklet(57, 1.0)];
    self.postMessage({ type: 'done', id: m.id, result: { data, rocks } }, [data.buffer]);
  }
};
