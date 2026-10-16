// Tileable 3D noise for volumetric clouds (Perlin-Worley in R, Worley FBM in G/B, Perlin in A).
import { mulberry32 } from './noise.js';

export function buildCloudTexture(size = 64, seed = 7) {
  const rnd = mulberry32(seed);
  const perm = new Uint16Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256), gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    gx[i] = s * Math.cos(th); gy[i] = s * Math.sin(th); gz[i] = u;
  }
  const hash = (i, j, k) => perm[(perm[(perm[i & 255] + j) & 255] + k) & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function perlin(x, y, z, P) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    let r = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const h = hash(((xi + dx) % P + P) % P, ((yi + dy) % P + P) % P, ((zi + dz) % P + P) % P);
      const d = gx[h] * (xf - dx) + gy[h] * (yf - dy) + gz[h] * (zf - dz);
      r += d * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return r;
  }
  function worley(x, y, z, P) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const cx = xi + a, cy = yi + b, cz = zi + c;
      const h = hash(((cx % P) + P) % P, ((cy % P) + P) % P, ((cz % P) + P) % P);
      const h2 = perm[(h + 71) & 255], h3 = perm[(h + 151) & 255];
      const px = cx + h / 255, py = cy + h2 / 255, pz = cz + h3 / 255;
      const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const wfbm = (x, y, z, f) =>
    (1 - Math.min(1, worley(x * f, y * f, z * f, f))) * 0.625 +
    (1 - Math.min(1, worley(x * f * 2, y * f * 2, z * f * 2, f * 2))) * 0.25 +
    (1 - Math.min(1, worley(x * f * 4, y * f * 4, z * f * 4, f * 4))) * 0.125;

  const data = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / size, y = j / size, z = k / size;
    let pf = 0, amp = 1, norm = 0, f = 4;
    for (let oc = 0; oc < 4; oc++) { pf += perlin(x * f, y * f, z * f, f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    pf = pf / norm * 0.5 + 0.5;
    pf = Math.min(1, Math.max(0, (pf - 0.5) * 1.6 + 0.5));
    const w1 = wfbm(x, y, z, 4);
    const pw = Math.min(1, Math.max(0, (pf - (1 - w1)) / (1 - (1 - w1) + 1e-4)));
    const w2 = wfbm(x, y, z, 8);
    const w3 = wfbm(x, y, z, 16);
    data[o++] = Math.round(pw * 255);
    data[o++] = Math.round(w2 * 255);
    data[o++] = Math.round(w3 * 255);
    data[o++] = Math.round(pf * 255);
  }
  return data;
}
