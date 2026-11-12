// Batched, smooth, tapered tubes: one dynamic mesh that every creature body is sculpted into each frame.
// Centrelines are Catmull-Rom smoothed, framed by parallel transport, and shaded with genome patterns.
import * as THREE from 'three';
import { U, COMMON } from './glsl.js';
import { SKIN_GLSL } from './skins.js';

const T_VS = /* glsl */ `
attribute vec4 aLocal;   // cos, sin, arc length (m), u (0..1)
attribute vec3 aColA; attribute vec3 aColB; attribute vec4 aParams; attribute float aBoost; attribute vec3 aTan; attribute vec4 aSkin;
varying vec3 vWorld; varying vec3 vNormal; varying vec4 vLocal; varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying float vBoost; varying vec3 vTan; varying vec4 vSkin;
void main(){
  vLocal = aLocal; vColA = aColA; vColB = aColB; vParams = aParams; vBoost = aBoost; vTan = aTan; vSkin = aSkin;
  vWorld = position; vNormal = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const T_FS = /* glsl */ `
uniform float uGlass;
varying vec3 vWorld; varying vec3 vNormal; varying vec4 vLocal; varying vec3 vColA; varying vec3 vColB; varying vec4 vParams; varying float vBoost; varying vec3 vTan; varying vec4 vSkin;
${COMMON}
${SKIN_GLSL}
void main(){
  vec3 n = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (uGlass > 0.5 && !gl_FrontFacing) n = -n;
  int mode = int(vParams.x + 0.5);
  float ps = vParams.y;
  float c = vLocal.x, s = vLocal.y, arc = vLocal.z, u = vLocal.w;
  float ang = atan(s, c);
  float pat = 0.0;
  if (mode == 1) {                       // bands that wrap the body
    float b = fract(arc * ps * 0.32 + 0.15 * sin(ang * 2.0));
    pat = smoothstep(0.38, 0.46, b) * (1.0 - smoothstep(0.86, 0.94, b));
  } else if (mode == 2) {                // irregular spots, larger on the back
    float sp = vnoise(vec3(ang * 1.6, arc * ps * 0.55, 3.0)) * 0.7 + vnoise(vec3(ang * 4.0, arc * ps * 1.4, 9.0)) * 0.3;
    pat = smoothstep(0.58, 0.64, sp + c * 0.08);
  } else if (mode == 3) {                // countershading: pale belly
    pat = smoothstep(0.15, 0.85, -c);
  } else if (mode == 4) {                // stripes running along the body
    pat = smoothstep(0.55, 0.7, abs(sin(ang * 3.0)));
  } else if (mode == 5) {                // gradient toward the end (bells, ribbons)
    pat = smoothstep(0.25, 0.95, u);
  }
  vec3 alb = mix(vColA, vColB, pat);
  float glowMask = 0.35 + 0.65 * pat;
  float occ = 0.85 + 0.15 * (c * 0.5 + 0.5);
  float skinAmt = 0.0;
  if (uSkinOn > 0.5 && vSkin.w > 0.0) {
    // wrap the skin: u around (integer tiles, seamless), v along the arc. Gradients come from whichever
    // angle parameterisation is continuous here, so the wrap seam keeps its sharp mip level.
    float u1 = ang / 6.2831853, u2 = fract(u1);
    vec2 uvA = vec2(u1 * vSkin.y, arc * vSkin.z), uvB = vec2(u2 * vSkin.y, arc * vSkin.z);
    vec2 ax = dFdx(uvA), bx = dFdx(uvB), ay = dFdy(uvA), by = dFdy(uvB);
    vec2 gx = vec2(abs(ax.x) < abs(bx.x) ? ax.x : bx.x, ax.y), gy = vec2(abs(ay.x) < abs(by.x) ? ay.x : by.x, ay.y);
    float dist = length(uCamPos - vWorld);
    skinAmt = vSkin.w * (1.0 - smoothstep(120.0, 420.0, dist));
    Skin sk = skinSample(uvA, vSkin.x, gx, gy);
    vec3 Tu = normalize(cross(vTan, n)), Tv = normalize(cross(n, Tu));
    n = normalize(n + (Tu * sk.dn.x + Tv * sk.dn.y) * skinAmt);
    alb = mix(alb, mix(alb, vColB * 1.1, 0.75), sk.m1 * skinAmt * 0.8);
    alb *= mix(1.0, sk.tone * 1.18, skinAmt);
    occ *= mix(1.0, 0.75 + 0.25 * sk.tone, skinAmt);
    glowMask = mix(glowMask, 0.15 + 1.4 * sk.m2 + 0.35 * pat, skinAmt * step(0.01, vParams.z));
  } else {
    alb *= 0.92 + 0.08 * vnoise(vec3(ang * 6.0, arc * 2.5, 0.0));
  }
  vec3 col = litSurface(alb, n, vWorld, vParams.w, occ, 0.4);
  if (skinAmt > 0.0) col += skinSpec(n, vWorld, vSkin.x, skinAmt, vParams.w);
  // subsurface: back-lit thin parts and soft edges
  float fres = 1.0 - abs(dot(n, V));
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += alb * uSunColor * back * 0.35 * fres;
  float glow = vParams.z * glowMask * (1.0 + vBoost) * (1.0 + uNight * 2.2);
  col += vColB * glow * (1.6 + fres * 1.6);
  float alpha = 1.0;
  if (uGlass > 0.5) {
    // jelly: clear in the middle, denser at grazing angles and along the canals, glowing parts stay solid
    float edge = pow(1.0 - abs(dot(n, V)), 1.6);
    alpha = clamp(mix(0.42, 0.95, edge) + glow * 0.2 + skinAmt * 0.08, 0.0, 0.97);
    col += vColA * uSunColor * 0.08 * (1.0 - edge);
  }
  col = applyFog(col, vWorld);
  gl_FragColor = vec4(col, alpha);
}`;

const SEG = 12; // radial segments
const RV = SEG + 1;
const COS = new Float32Array(RV), SIN = new Float32Array(RV), TH = new Float32Array(RV);
for (let k = 0; k <= SEG; k++) { TH[k] = (k / SEG) * Math.PI * 2; COS[k] = Math.cos(TH[k]); SIN[k] = Math.sin(TH[k]); }
const hyp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export class TubeBatch {
  constructor(scene, maxVerts = 110000, maxIdx = 600000, glass = false) {
    this.maxV = maxVerts; this.maxI = maxIdx;
    const g = new THREE.BufferGeometry();
    const mk = (n, k) => new THREE.BufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(maxVerts, 3); this.aNor = mk(maxVerts, 3); this.aLoc = mk(maxVerts, 4);
    this.aA = mk(maxVerts, 3); this.aB = mk(maxVerts, 3); this.aP = mk(maxVerts, 4); this.aBo = mk(maxVerts, 1); this.aT = mk(maxVerts, 3); this.aS = mk(maxVerts, 4);
    g.setAttribute('position', this.aPos); g.setAttribute('normal', this.aNor); g.setAttribute('aLocal', this.aLoc);
    g.setAttribute('aColA', this.aA); g.setAttribute('aColB', this.aB); g.setAttribute('aParams', this.aP); g.setAttribute('aBoost', this.aBo); g.setAttribute('aTan', this.aT); g.setAttribute('aSkin', this.aS);
    this.idx = new THREE.BufferAttribute(new Uint32Array(maxIdx), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.idx);
    // last frame's positions, matched per tube by key, for motion vectors
    this.aPrev = mk(maxVerts, 3); g.setAttribute('aPrev', this.aPrev);
    this.prevPos = new Float32Array(maxVerts * 3); this.map = new Map(); this.prevMap = new Map(); this.key = null;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: T_VS, fragmentShader: T_FS, uniforms: { ...U, uGlass: { value: glass ? 1 : 0 } },
      transparent: glass, depthWrite: true, side: glass ? THREE.DoubleSide : THREE.FrontSide }));
    if (glass) this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.nv = 0; this.ni = 0;
    // scratch
    this.P = new Float32Array(256 * 3); this.R = new Float32Array(256); this.F = new Float32Array(256 * 9); this.S = new Float32Array(256);
    this.frames = [];
  }
  begin() {
    this.prevPos.set(this.aPos.array.subarray(0, this.nv * 3));
    const t = this.prevMap; this.prevMap = this.map; this.map = t; this.map.clear();
    this.nv = 0; this.ni = 0;
  }
  end() {
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.ni);
    for (const a of [this.aPos, this.aPrev, this.aNor, this.aLoc, this.aA, this.aB, this.aP, this.aBo, this.aT, this.aS]) { a.needsUpdate = true; a.updateRanges && (a.clearUpdateRanges(), a.addUpdateRange(0, this.nv * a.itemSize)); }
    this.idx.needsUpdate = true;
    this.idx.clearUpdateRanges && (this.idx.clearUpdateRanges(), this.idx.addUpdateRange(0, this.ni));
  }

  /**
   * pts: Vector3[] centreline control points (>= 2)
   * radii: number[] per control point
   * o: { rings, sp, sun, boost, glow, pattern, up: Vector3 hint, squash, lobes: {k, amp, from, to, phase}, keepFrames }
   */
  add(pts, radii, o) {
    const n = pts.length;
    if (n < 2) return null;
    const rings = Math.max(3, Math.min(250, o.rings || 16));
    const nvNeed = rings * RV, niNeed = (rings - 1) * SEG * 6;
    if (this.nv + nvNeed > this.maxV || this.ni + niNeed > this.maxI) return null;
    const P = this.P, R = this.R, S = this.S;
    // Catmull-Rom resample
    for (let i = 0; i < rings; i++) {
      const f = (i / (rings - 1)) * (n - 1);
      const k = Math.min(n - 2, Math.floor(f)), t = f - k;
      const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(n - 1, k + 2)];
      const t2 = t * t, t3 = t2 * t;
      const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, c = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
      P[i * 3] = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
      P[i * 3 + 1] = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
      P[i * 3 + 2] = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
      // radius: smooth (cosine) interpolation between control radii
      const r0 = radii[k], r1 = radii[k + 1];
      const ts = 0.5 - 0.5 * Math.cos(Math.PI * t);
      R[i] = r0 + (r1 - r0) * ts;
      S[i] = i === 0 ? 0 : S[i - 1] + hyp(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
    }
    // parallel transport frames: T, N (up-ish), B
    const F = this.F;
    let nx = 0, ny = 1, nz = 0;
    if (o.up) { nx = o.up.x; ny = o.up.y; nz = o.up.z; }
    for (let i = 0; i < rings; i++) {
      const ia = Math.max(0, i - 1), ib = Math.min(rings - 1, i + 1);
      let tx = P[ib * 3] - P[ia * 3], ty = P[ib * 3 + 1] - P[ia * 3 + 1], tz = P[ib * 3 + 2] - P[ia * 3 + 2];
      let tl = hyp(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // project previous normal onto plane
      let d = nx * tx + ny * ty + nz * tz;
      let mx = nx - tx * d, my = ny - ty * d, mz = nz - tz * d;
      let ml = hyp(mx, my, mz);
      if (ml < 1e-3) { // degenerate: pick any perpendicular
        if (Math.abs(tx) < 0.9) { mx = 0; my = -tz; mz = ty; } else { mx = tz; my = 0; mz = -tx; }
        ml = hyp(mx, my, mz);
      }
      nx = mx / ml; ny = my / ml; nz = mz / ml;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      F[i * 9] = tx; F[i * 9 + 1] = ty; F[i * 9 + 2] = tz;
      F[i * 9 + 3] = nx; F[i * 9 + 4] = ny; F[i * 9 + 5] = nz;
      F[i * 9 + 6] = bx; F[i * 9 + 7] = by; F[i * 9 + 8] = bz;
    }
    // write vertices
    const sq = o.squash ?? 1;
    const lob = o.lobes;
    const sp = o.sp, gA = sp.colA, gB = sp.colB, gen = sp.genome;
    const pat = o.pattern ?? sp.patOverride ?? gen.pattern, ps = gen.pscale, glow = o.glow ?? gen.glow, sun = o.sun ?? 1, boost = o.boost ?? 0;
    const pos = this.aPos.array, nor = this.aNor.array, loc = this.aLoc.array, ca = this.aA.array, cb = this.aB.array, pa = this.aP.array, bo = this.aBo.array;
    const v0 = this.nv;
    const total = S[rings - 1] || 1;
    // skin: [layer, tile size (m), amount]; integer tiles around the mean circumference
    const sk = o.skin !== undefined ? o.skin : sp.skin;
    let sl = 0, st = 0, sv = 0, sa = 0;
    if (sk) {
      let rs = 0; for (let i = 0; i < rings; i++) rs += R[i];
      const circ = 2 * Math.PI * (rs / rings) * (0.5 + 0.5 * sq);
      st = Math.max(1, Math.round(circ / sk[1])); sv = st / Math.max(1e-3, circ); sl = sk[0]; sa = sk[2] ?? 1;
    }
    const tan = this.aT.array, ska = this.aS.array;
    for (let i = 0; i < rings; i++) {
      const u = i / (rings - 1);
      const ia = Math.max(0, i - 1), ib = Math.min(rings - 1, i + 1);
      const ds = (S[ib] - S[ia]) || 1;
      const drds = (R[ib] - R[ia]) / ds;
      const tx = F[i * 9], ty = F[i * 9 + 1], tz = F[i * 9 + 2];
      const Nx = F[i * 9 + 3], Ny = F[i * 9 + 4], Nz = F[i * 9 + 5];
      const Bx = F[i * 9 + 6], By = F[i * 9 + 7], Bz = F[i * 9 + 8];
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      let lw = 0;
      if (lob && u >= lob.from && u <= lob.to) lw = Math.sin(Math.PI * (u - lob.from) / (lob.to - lob.from));
      for (let k = 0; k <= SEG; k++) {
        const c = COS[k], s = SIN[k];
        let r = R[i];
        if (lw > 0) r *= 1 + lob.amp * lw * Math.cos(lob.k * TH[k] + (lob.phase || 0));
        const ox = Nx * c * sq + Bx * s, oy = Ny * c * sq + By * s, oz = Nz * c * sq + Bz * s;
        const v = this.nv++;
        pos[v * 3] = px + ox * r; pos[v * 3 + 1] = py + oy * r; pos[v * 3 + 2] = pz + oz * r;
        // normal: radial (corrected for squash) minus slope along the tangent
        let ex = Nx * c / sq + Bx * s, ey = Ny * c / sq + By * s, ez = Nz * c / sq + Bz * s;
        const el = hyp(ex, ey, ez); ex /= el; ey /= el; ez /= el;
        let qx = ex - tx * drds, qy = ey - ty * drds, qz = ez - tz * drds;
        const ql = hyp(qx, qy, qz) || 1;
        nor[v * 3] = qx / ql; nor[v * 3 + 1] = qy / ql; nor[v * 3 + 2] = qz / ql;
        loc[v * 4] = c; loc[v * 4 + 1] = s; loc[v * 4 + 2] = S[i]; loc[v * 4 + 3] = u;
        ca[v * 3] = gA.x; ca[v * 3 + 1] = gA.y; ca[v * 3 + 2] = gA.z;
        cb[v * 3] = gB.x; cb[v * 3 + 1] = gB.y; cb[v * 3 + 2] = gB.z;
        pa[v * 4] = pat; pa[v * 4 + 1] = ps; pa[v * 4 + 2] = glow; pa[v * 4 + 3] = sun;
        bo[v] = boost;
        tan[v * 3] = tx; tan[v * 3 + 1] = ty; tan[v * 3 + 2] = tz;
        ska[v * 4] = sl; ska[v * 4 + 1] = st; ska[v * 4 + 2] = sv; ska[v * 4 + 3] = sa;
      }
    }
    const key = this.key, pm = key == null ? undefined : this.prevMap.get(key);
    if (pm && pm.n === nvNeed) this.aPrev.array.set(this.prevPos.subarray(pm.s * 3, (pm.s + nvNeed) * 3), v0 * 3);
    else this.aPrev.array.set(pos.subarray(v0 * 3, (v0 + nvNeed) * 3), v0 * 3);
    if (key != null) this.map.set(key, { s: v0, n: nvNeed });
    const ix = this.idx.array;
    for (let i = 0; i < rings - 1; i++) for (let k = 0; k < SEG; k++) {
      const a = v0 + i * RV + k, b = a + 1, c = a + RV, d = c + 1;
      ix[this.ni++] = a; ix[this.ni++] = b; ix[this.ni++] = c;
      ix[this.ni++] = b; ix[this.ni++] = d; ix[this.ni++] = c;
    }
    if (o.keepFrames) {
      const fr = [];
      for (let i = 0; i < rings; i++) fr.push({
        p: new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), r: R[i],
        fw: new THREE.Vector3(F[i * 9], F[i * 9 + 1], F[i * 9 + 2]),
        up: new THREE.Vector3(F[i * 9 + 3], F[i * 9 + 4], F[i * 9 + 5]),
        side: new THREE.Vector3(F[i * 9 + 6], F[i * 9 + 7], F[i * 9 + 8]),
      });
      return fr;
    }
    return total;
  }
}
