// Island signed distance functions. Shared by mesher workers and the main thread
// (collision, crawlers walking on rock). Units are metres, local origin = plateau top centre.
import { makeNoise, clamp, smoothstep } from './noise.js';

export const SUN_DIR = (() => { const v = [0.62, 0.30, 0.73]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

const norm = (v) => { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const k0 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  const k1 = Math.sqrt((px / (rx * rx)) ** 2 + (py / (ry * ry)) ** 2 + (pz / (rz * rz)) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function sdCapsule(px, py, pz, a, b, r) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2 + (paz - baz * h) ** 2) - r;
}
// tapered capsule: radius ra at a, rb at b (approximate, conservative)
function sdTaper(px, py, pz, a, b, ra, rb) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return (Math.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2 + (paz - baz * h) ** 2) - (ra + (rb - ra) * h)) * 0.9;
}
function sdRoundCyl(px, py, pz, c, r, h, rd) {
  const dx = Math.sqrt((px - c[0]) ** 2 + (pz - c[2]) ** 2) - (r - rd);
  const dy = Math.abs(py - (c[1] + h * 0.5)) - (h * 0.5 - rd);
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt((Math.max(dx, 0)) ** 2 + (Math.max(dy, 0)) ** 2) - rd;
}

// ---------------------------------------------------------------- island specs
export const ISLANDS = [
  {
    key: 'verdigris', name: 'Verdigris Reach', seed: 1301,
    world: [0, 150, 0],
    radius: 112, thickness: 34, round: 14,
    outline: [[3, 10, 0.7], [5, 6, 2.1], [9, 2.5, 1.0]],
    underDepth: 150, underPow: 0.55, drip: 11,
    disp: 6, strata: 0.9, strataFreq: 0.55,
    palette: 0,
    bounds: { min: [-185, -222, -185], max: [185, 70, 185] },
    features: [
      { t: 'ell', c: [35, 2, -45], r: [30, 18, 24], k: 14 },
      { t: 'ell', c: [-60, 0, -35], r: [24, 11, 30], k: 12 },
      { t: 'torus', c: [12, -8, -8], u: [1, 0, 0.45], R: 40, r: 7.5, k: 9 },
      { t: 'ring', ang: 0.35, at: -10, R: 52, r: 7.5, k: 10 },
      { t: 'taper', a: [-22, -6, 62], b: [-12, 44, 70], ra: 8, rb: 4.5, k: 8 },
      { t: 'ell', c: [-12, 47, 70], r: [13, 8, 13], k: 5 },
      { t: 'taper', a: [30, -90, 10], b: [40, -212, 20], ra: 16, rb: 2, k: 18 },
      { t: 'taper', a: [-40, -78, -30], b: [-54, -196, -42], ra: 13, rb: 2, k: 16 },
      { t: 'taper', a: [12, -70, -62], b: [22, -172, -76], ra: 10, rb: 1.5, k: 14 },
      { t: 'subell', c: [-28, 1.5, 22], r: [32, 7.5, 27], k: 6 },
    ],
    pool: { c: [-28, 0, 22], level: -3.4, r: [30, 25], channelAng: 2.35 },
    falls: [{ ang: 2.35, y: -3.4, width: 9, fromPool: true }, { ang: -1.9, y: -16, width: 6 }],
  },
  {
    key: 'ochre', name: 'Ochre Table', seed: 2209,
    world: [560, 175, -330],
    radius: 98, thickness: 46, round: 6,
    outline: [[4, 7, 1.3], [7, 4, 0.2], [13, 2, 2.0]],
    underDepth: 120, underPow: 0.8, drip: 14,
    disp: 4.5, strata: 1.9, strataFreq: 0.42,
    palette: 1,
    bounds: { min: [-150, -200, -150], max: [222, 72, 150] },
    features: [
      { t: 'rcyl', c: [-30, -2, -20], r: 22, h: 62, rd: 6, k: 6 },
      { t: 'rcyl', c: [25, -2, 38], r: 14, h: 40, rd: 5, k: 5 },
      { t: 'rcyl', c: [-62, -2, 42], r: 9, h: 27, rd: 4, k: 4 },
      { t: 'ell', c: [168, -40, -22], r: [32, 26, 32], k: 0 },
      { t: 'torus', c: [128, -18, -12], u: [1, 0, -0.18], R: 46, r: 7, k: 8 },
      { t: 'taper', a: [0, -60, 0], b: [6, -190, 12], ra: 20, rb: 2, k: 20 },
      { t: 'taper', a: [42, -50, -30], b: [58, -152, -46], ra: 13, rb: 2, k: 14 },
      { t: 'taper', a: [-36, -55, 26], b: [-50, -142, 40], ra: 12, rb: 2, k: 12 },
      { t: 'taper', a: [168, -60, -22], b: [173, -118, -20], ra: 12, rb: 1.5, k: 10 },
    ],
    pool: null,
    falls: [{ ang: -2.5, y: -20, width: 7 }],
  },
  {
    key: 'coral', name: 'Coral Rookery', seed: 3407,
    world: [-260, 135, 760],
    radius: 92, thickness: 30, round: 22,
    outline: [[3, 8, 2.4], [6, 6, 0.4], [11, 2, 1.1]],
    underDepth: 112, underPow: 0.42, drip: 7,
    disp: 5, strata: 0.6, strataFreq: 0.5,
    palette: 2,
    bounds: { min: [-150, -150, -150], max: [150, 112, 150] },
    features: [
      { t: 'taper', a: [-20, -6, -10], b: [-26, 86, -16], ra: 9, rb: 4, k: 10 },
      { t: 'ell', c: [-26, 90, -16], r: [15, 11, 15], k: 6 },
      { t: 'taper', a: [32, -6, 22], b: [40, 60, 30], ra: 7, rb: 3.5, k: 8 },
      { t: 'ell', c: [40, 63, 30], r: [11, 8, 11], k: 5 },
      { t: 'taper', a: [-50, -6, 40], b: [-58, 46, 50], ra: 6, rb: 3, k: 7 },
      { t: 'ell', c: [-58, 49, 50], r: [9, 7, 9], k: 4 },
      { t: 'taper', a: [55, -6, -40], b: [62, 34, -48], ra: 6, rb: 3, k: 6 },
      { t: 'ell', c: [62, 37, -48], r: [8, 6, 8], k: 4 },
      { t: 'taper', a: [8, -6, 60], b: [10, 28, 66], ra: 5, rb: 2.5, k: 5 },
      { t: 'ell', c: [10, 30, 66], r: [7, 5, 7], k: 3 },
      { t: 'torus', c: [-6, -4, -58], u: [1, 0, -0.3], R: 30, r: 6, k: 7 },
      { t: 'subcap', a: [-160, -46, -14], b: [160, -38, 22], r: 17, k: 6 },
      { t: 'subcap', a: [-20, -40, -160], b: [10, -50, 160], r: 13, k: 6 },
    ],
    pool: null,
    falls: [{ ang: 0.9, y: -10, width: 5 }, { ang: -2.2, y: -14, width: 4 }],
  },
];

// precompute frames for features
for (const isl of ISLANDS) {
  for (const f of isl.features) {
    if (f.t === 'torus') {
      f.uu = norm(f.u); f.vv = [0, 1, 0]; f.ww = norm(cross(f.uu, f.vv));
    }
    if (f.t === 'ring') {
      // a vertical ring hanging off the rim, in the radial plane at angle `ang`
      const dir = [Math.cos(f.ang), 0, Math.sin(f.ang)];
      const rim = outlineRadius(isl, f.ang);
      f.c = [dir[0] * (rim - 6), f.at, dir[2] * (rim - 6)];
      f.uu = dir; f.vv = [0, 1, 0]; f.ww = norm(cross(dir, [0, 1, 0]));
    }
  }
}

export function outlineRadius(isl, ang) {
  let r = isl.radius;
  for (const o of isl.outline) r += o[1] * Math.sin(ang * o[0] + o[2]);
  return r;
}

const noises = ISLANDS.map((isl) => makeNoise(isl.seed));

export function makeSDF(index) {
  const isl = ISLANDS[index];
  const N = noises[index];
  const { radius, thickness: T, round: RD, underDepth: UD, underPow: UP } = isl;
  const feats = isl.features;
  const maxDisp = isl.disp * 1.15 + isl.drip + isl.strata + 2;

  function base(x, y, z) {
    const rxz = Math.sqrt(x * x + z * z);
    const ang = Math.atan2(z, x);
    let rr = radius;
    for (const o of isl.outline) rr += o[1] * Math.sin(ang * o[0] + o[2]);
    // rounded plateau slab
    const dx = rxz - (rr - RD), dy = Math.abs(y + T * 0.5) - (T * 0.5 - RD);
    const plate = Math.min(Math.max(dx, dy), 0) + Math.sqrt((Math.max(dx, 0)) ** 2 + (Math.max(dy, 0)) ** 2) - RD;
    // tapering underside
    const yy = clamp((y + UD + T * 0.4) / (UD), 0, 1);
    const ru = rr * 0.9 * Math.pow(yy, UP);
    let under = (rxz - ru) * 0.72;
    under = Math.max(under, -(y + UD + T * 0.4));
    under = Math.max(under, y + T * 0.3);
    let d = smin(plate, under, 22);

    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      let fd;
      switch (f.t) {
        case 'ell': fd = sdEllipsoid(x - f.c[0], y - f.c[1], z - f.c[2], f.r[0], f.r[1], f.r[2]); d = smin(d, fd, f.k); break;
        case 'subell': fd = sdEllipsoid(x - f.c[0], y - f.c[1], z - f.c[2], f.r[0], f.r[1], f.r[2]); d = smax(d, -fd, f.k); break;
        case 'subcap': fd = sdCapsule(x, y, z, f.a, f.b, f.r); d = smax(d, -fd, f.k); break;
        case 'taper': fd = sdTaper(x, y, z, f.a, f.b, f.ra, f.rb); d = smin(d, fd, f.k); break;
        case 'rcyl': fd = sdRoundCyl(x, y, z, f.c, f.r, f.h, f.rd); d = smin(d, fd, f.k); break;
        case 'torus': case 'ring': {
          const px = x - f.c[0], py = y - f.c[1], pz = z - f.c[2];
          const qu = px * f.uu[0] + py * f.uu[1] + pz * f.uu[2];
          const qv = px * f.vv[0] + py * f.vv[1] + pz * f.vv[2];
          const qw = px * f.ww[0] + py * f.ww[1] + pz * f.ww[2];
          fd = Math.sqrt((Math.sqrt(qu * qu + qv * qv) - f.R) ** 2 + qw * qw) - f.r;
          d = smin(d, fd, f.k); break;
        }
      }
    }
    return d;
  }

  function sdf(x, y, z) {
    const d0 = base(x, y, z);
    if (d0 > maxDisp + 3) return d0 - maxDisp;
    const rxz = Math.sqrt(x * x + z * z);
    const topMask = smoothstep(-16, -3, y) * smoothstep(radius + 2, radius - 26, rxz);
    const s = 0.017;
    let disp = N.fbm(x * s, y * s, z * s, 4) * isl.disp * (1 - 0.72 * topMask);
    // dripping underside streaks
    const under = smoothstep(-T * 0.3, -T - 20, y);
    if (under > 0) disp += (N.ridged(x * 0.028, y * 0.008, z * 0.028, 3) - 0.45) * isl.drip * 0.7 * under;
    // strata
    const warp = N.noise3(x * 0.012, y * 0.03, z * 0.012) * 4;
    disp += Math.sin(y * isl.strataFreq + warp) * isl.strata * (1 - topMask);
    return d0 - disp * 0.85;
  }

  return { sdf, base, island: isl, maxDisp };
}

export function gradient(sdf, x, y, z, e = 0.5) {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
  const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
  const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l];
}
