// Surface-nets mesher + baked lighting (AO, soft sun shadow) for SDF islands.
import { makeSDF, SUN_DIR, outlineRadius } from './islands-sdf.js';
function gradient(sdf, x, y, z, e) {
  const a = sdf(x + e, y - e, z - e), b = sdf(x - e, y - e, z + e), c = sdf(x - e, y + e, z - e), d = sdf(x + e, y + e, z + e);
  const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l];
}
import { mulberry32, makeNoise } from './noise.js';

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x
  [0, 2], [1, 3], [4, 6], [5, 7], // y
  [0, 4], [1, 5], [2, 6], [3, 7], // z
];

export function surfaceNets(sdf, min, max, cell, progress) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  // coarse pass, then refine only near the surface
  const C = 4, cc = cell * C;
  const mx = Math.ceil((nx - 1) / C) + 1, my = Math.ceil((ny - 1) / C) + 1, mz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(mx * my * mz);
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++)
    coarse[i + mx * (j + my * k)] = sdf(min[0] + i * cc, min[1] + j * cc, min[2] + k * cc);
  const band = cc * 1.25;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * cell;
    const kc = Math.min(Math.floor(k / C), mz - 2), fz = k / C - kc;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * cell;
      const jc = Math.min(Math.floor(j / C), my - 2), fy = j / C - jc;
      let idx = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) {
        const ic = Math.min(Math.floor(i / C), mx - 2), fx = i / C - ic;
        const b = ic + mx * (jc + my * kc);
        const c000 = coarse[b], c100 = coarse[b + 1], c010 = coarse[b + mx], c110 = coarse[b + mx + 1];
        const b2 = b + mx * my;
        const c001 = coarse[b2], c101 = coarse[b2 + 1], c011 = coarse[b2 + mx], c111 = coarse[b2 + mx + 1];
        const v = ((c000 * (1 - fx) + c100 * fx) * (1 - fy) + (c010 * (1 - fx) + c110 * fx) * fy) * (1 - fz) +
          ((c001 * (1 - fx) + c101 * fx) * (1 - fy) + (c011 * (1 - fx) + c111 * fx) * fy) * fz;
        field[idx++] = Math.abs(v) > band ? v : sdf(min[0] + i * cell, y, z);
      }
    }
    if (progress && (k & 7) === 0) progress(k / nz * 0.5);
  }
  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellVert = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const cv = new Float32Array(8);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const ii = i + (c & 1), jj = j + ((c >> 1) & 1), kk = k + ((c >> 2) & 1);
      const v = field[ii + nx * (jj + ny * kk)];
      cv[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1];
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
      const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
      sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t; n++;
    }
    cellVert[i + cnx * (j + cny * k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  const idx = [];
  const cid = (i, j, k) => cellVert[i + cnx * (j + cny * k)];
  for (let k = 1; k < cnz; k++) for (let j = 1; j < cny; j++) for (let i = 1; i < cnx; i++) {
    const v0 = field[i + nx * (j + ny * k)] < 0;
    // edge along x from corner (i,j,k) to (i+1,j,k)
    if (i < cnx) {
      const v1 = field[i + 1 + nx * (j + ny * k)] < 0;
      if (v0 !== v1) {
        const a = cid(i, j - 1, k - 1), b = cid(i, j, k - 1), c = cid(i, j, k), d = cid(i, j - 1, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          if (v0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        }
      }
    }
    if (j < cny) {
      const v1 = field[i + nx * (j + 1 + ny * k)] < 0;
      if (v0 !== v1) {
        const a = cid(i - 1, j, k - 1), b = cid(i, j, k - 1), c = cid(i, j, k), d = cid(i - 1, j, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          if (v0) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
        }
      }
    }
    if (k < cnz) {
      const v1 = field[i + nx * (j + ny * (k + 1))] < 0;
      if (v0 !== v1) {
        const a = cid(i - 1, j - 1, k), b = cid(i, j - 1, k), c = cid(i, j, k), d = cid(i - 1, j, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          if (v0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        }
      }
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function bake(sdf, positions, withLight, progress, rays = true) {
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  const ao = new Float32Array(n);
  const sun = new Float32Array(n);
  const bent = new Float32Array(n * 3);   // average unoccluded direction (bent normal) for sky light
  const bounce = new Float32Array(n);     // light bounced up from sunlit ground below overhangs and arches
  const L = SUN_DIR;
  for (let v = 0; v < n; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    // project onto the surface
    {
      const d = sdf(x, y, z);
      const g = gradient(sdf, x, y, z, 0.4);
      x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    }
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    const g = gradient(sdf, x, y, z, 0.7);
    normals[v * 3] = g[0]; normals[v * 3 + 1] = g[1]; normals[v * 3 + 2] = g[2];
    if (!withLight) { ao[v] = 1; sun[v] = 1; bent[v * 3] = g[0]; bent[v * 3 + 1] = g[1]; bent[v * 3 + 2] = g[2]; continue; }
    // ambient occlusion
    let occ = 0, sca = 1;
    for (let s = 1; s <= 5; s++) {
      const h = 1.2 + s * s * 1.6;
      const d = sdf(x + g[0] * h, y + g[1] * h, z + g[2] * h);
      occ += (h - d) / h * sca; sca *= 0.72;
    }
    ao[v] = Math.max(0, Math.min(1, 1 - occ * 0.42));
    // soft shadow toward sun
    let res = 1, t = 1.2;
    const ox = x + g[0] * 0.8, oy = y + g[1] * 0.8, oz = z + g[2] * 0.8;
    for (let s = 0; s < 36 && t < 420; s++) {
      const d = sdf(ox + L[0] * t, oy + L[1] * t, oz + L[2] * t);
      res = Math.min(res, 9 * d / t);
      if (res < -0.2) break;
      t += Math.max(1.2, Math.min(d * 0.9, 30));
    }
    res = Math.max(0, Math.min(1, res));
    sun[v] = res * res * (3 - 2 * res);
    // six rays around the hemisphere: which ways see sky, and how much sunlit ground they see below
    // (odd vertices reuse their scan-order neighbour's result: they sit one grid cell apart)
    if (!rays) { bent[v * 3] = g[0]; bent[v * 3 + 1] = g[1]; bent[v * 3 + 2] = g[2]; }
    else if (v & 1) { bent[v * 3] = bent[v * 3 - 3]; bent[v * 3 + 1] = bent[v * 3 - 2]; bent[v * 3 + 2] = bent[v * 3 - 1]; bounce[v] = bounce[v - 1]; }
    else {
      let tx = Math.abs(g[1]) < 0.9 ? -g[2] : 0, ty = Math.abs(g[1]) < 0.9 ? 0 : g[2], tz = Math.abs(g[1]) < 0.9 ? g[0] : -g[1];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const bx = g[1] * tz - g[2] * ty, by = g[2] * tx - g[0] * tz, bz = g[0] * ty - g[1] * tx;
      let sx = g[0] * 0.6, sy = g[1] * 0.6, sz = g[2] * 0.6, bnc = 0;
      for (let r = 0; r < 6; r++) {
        const a = r * 1.0472 + (v % 7) * 0.13, ce = 0.64, se = 0.77;
        const dx = g[0] * ce + (tx * Math.cos(a) + bx * Math.sin(a)) * se;
        const dy = g[1] * ce + (ty * Math.cos(a) + by * Math.sin(a)) * se;
        const dz = g[2] * ce + (tz * Math.cos(a) + bz * Math.sin(a)) * se;
        let t = 1.5, hit = false;
        for (let k = 0; k < 5 && t < 48; k++) {
          const d = sdf(ox + dx * t, oy + dy * t, oz + dz * t);
          if (d < 0.35) { hit = true; break; }
          t += Math.max(3.0, d * 1.2);
        }
        if (hit) bnc += Math.max(0, -dy) * (1 - t / 48);
        else { sx += dx; sy += dy; sz += dz; }
      }
      const sl = Math.hypot(sx, sy, sz) || 1;
      bent[v * 3] = sx / sl; bent[v * 3 + 1] = sy / sl; bent[v * 3 + 2] = sz / sl;
      bounce[v] = Math.min(1, bnc / 2.2);
    }
    if (progress && (v & 4095) === 0) progress(0.5 + 0.45 * v / n);
  }
  return { normals, ao, sun, bent, bounce };
}

function heightField(sdf, isl, cell) {
  const { min, max } = isl.bounds;
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const h = new Float32Array(nx * nz);
  const shade = new Float32Array(nx * nz);
  const L = SUN_DIR;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = min[0] + i * cell, z = min[2] + k * cell;
    let y = 26, hit = false;
    for (let s = 0; s < 64; s++) {
      const d = sdf(x, y, z);
      if (d < 0.05) { hit = true; break; }
      y -= Math.max(d, 0.08);
      if (y < -40) break;
    }
    if (!hit) { h[i + nx * k] = NaN; shade[i + nx * k] = 1; continue; }
    h[i + nx * k] = y;
    let res = 1, t = 2;
    for (let s = 0; s < 32 && t < 300; s++) {
      const d = sdf(x + L[0] * t, y + 1 + L[1] * t, z + L[2] * t);
      res = Math.min(res, 8 * d / t);
      t += Math.max(1, Math.min(d, 25));
    }
    shade[i + nx * k] = Math.max(0, Math.min(1, res));
  }
  return { data: h, shade, nx, nz, x0: min[0], z0: min[2], cell };
}

function findFalls(sdf, isl) {
  const out = [];
  for (const f of isl.falls) {
    const dir = [Math.cos(f.ang), 0, Math.sin(f.ang)];
    let lip;
    if (f.fromPool && isl.pool) {
      // walk from pool centre along the channel until we leave the rock top
      const r0 = outlineRadius(isl, f.ang);
      lip = [dir[0] * (r0 + 4), f.y, dir[2] * (r0 + 4)];
    } else {
      let r = 260;
      for (let s = 0; s < 200; s++) {
        const p = [dir[0] * r, f.y, dir[2] * r];
        const d = sdf(p[0], p[1], p[2]);
        if (d < 0.3) break;
        r -= Math.max(d, 0.25);
      }
      lip = [dir[0] * (r + 1.2), f.y, dir[2] * (r + 1.2)];
    }
    // find the outward face normal near the lip
    out.push({ lip, dir, width: f.width, fromPool: !!f.fromPool });
  }
  return out;
}

function candidates(positions, normals, sun, isl, count) {
  const rnd = mulberry32(isl.seed * 7 + 3);
  const n = positions.length / 3;
  const pick = [];
  const N = makeNoise(isl.seed + 99);
  for (let v = 0; v < n; v++) {
    const ny = normals[v * 3 + 1];
    if (ny < 0.72) continue;
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    pick.push(v);
  }
  // shuffle
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pick[i]; pick[i] = pick[j]; pick[j] = t; }
  const m = Math.min(count, pick.length);
  const out = new Float32Array(m * 8);
  for (let i = 0; i < m; i++) {
    const v = pick[i];
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    out[i * 8] = x; out[i * 8 + 1] = y; out[i * 8 + 2] = z;
    out[i * 8 + 3] = normals[v * 3]; out[i * 8 + 4] = normals[v * 3 + 1]; out[i * 8 + 5] = normals[v * 3 + 2];
    out[i * 8 + 6] = N.fbm(x * 0.02, y * 0.02, z * 0.02, 3) * 0.5 + 0.5; // density field
    out[i * 8 + 7] = sun[v];
  }
  return out;
}

export function buildIsland(index, cell, lodCell, progress) {
  const { sdf, island } = makeSDF(index);
  const { min, max } = island.bounds;
  const hi = surfaceNets(sdf, min, max, cell, (p) => progress && progress(p * 0.6));
  const lit = bake(sdf, hi.positions, true, (p) => progress && progress(0.3 + p * 0.6));
  const lo = surfaceNets(sdf, min, max, lodCell);
  const loLit = bake(sdf, lo.positions, true, null, false);
  const hf = heightField(sdf, island, 2.5);
  const falls = findFalls(sdf, island);
  const cand = candidates(hi.positions, lit.normals, lit.sun, island, 14000);
  progress && progress(1);
  return {
    index,
    hi: { positions: hi.positions, indices: hi.indices, normals: lit.normals, ao: lit.ao, sun: lit.sun, bent: lit.bent, bounce: lit.bounce },
    lo: { positions: lo.positions, indices: lo.indices, normals: loLit.normals, ao: loLit.ao, sun: loLit.sun, bent: loLit.bent, bounce: loLit.bounce },
    height: hf, falls, candidates: cand,
  };
}

// small floating rock mesh (unlit bake: rotated instances)
export function buildRocklet(seed, cell) {
  const N = makeNoise(seed);
  const sdf = (x, y, z) => {
    const d = Math.sqrt(x * x + (y / 0.6) * (y / 0.6) + z * z) - 6.5;
    const under = Math.max(Math.sqrt(x * x + z * z) - 6 * Math.pow(Math.max(0, (y + 10) / 10), 0.7), -(y + 10)) * 0.7;
    const k = 3, h = Math.max(k - Math.abs(d - under), 0) / k;
    return Math.min(d, under) - h * h * k * 0.25 - N.fbm(x * 0.12, y * 0.12, z * 0.12, 3) * 2.6;
  };
  const m = surfaceNets(sdf, [-11, -15, -11], [11, 9, 11], 1.0);
  const lit = bake(sdf, m.positions, true);
  return { positions: m.positions, indices: m.indices, normals: lit.normals, ao: lit.ao, sun: lit.sun };
}
