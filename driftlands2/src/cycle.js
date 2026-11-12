// Day–night cycle. In the Driftlands the sun never crosses the sky: it sinks and rises in the same place,
// and the moon takes its seat at night. Lighting direction stays put; colour, intensity and sky change.
import * as THREE from 'three';
import { U } from './glsl.js';
import { SUN_DIR } from './islands-sdf.js';

const v3 = (r, g, b) => new THREE.Vector3(r, g, b);
// palettes: zenith, sun-side horizon, anti-sun horizon, below-horizon, ambient low, ambient high, bounce, cloud amb lo, cloud amb hi, sun colour
const PAL = {
  day: {
    zen: v3(0.05, 0.14, 0.40), sun: v3(0.90, 0.46, 0.30), anti: v3(0.34, 0.36, 0.70), below: v3(0.66, 0.48, 0.56),
    ambLo: v3(0.18, 0.17, 0.32), ambHi: v3(0.24, 0.34, 0.62), bounce: v3(0.55, 0.34, 0.36),
    cLo: v3(0.16, 0.11, 0.22), cHi: v3(0.42, 0.44, 0.74), light: v3(1.0, 0.70, 0.46).multiplyScalar(3.2), glow: v3(1.0, 0.48, 0.30),
  },
  dusk: {
    zen: v3(0.025, 0.045, 0.17), sun: v3(1.0, 0.30, 0.12), anti: v3(0.22, 0.16, 0.40), below: v3(0.42, 0.20, 0.30),
    ambLo: v3(0.12, 0.08, 0.20), ambHi: v3(0.16, 0.16, 0.38), bounce: v3(0.50, 0.22, 0.24),
    cLo: v3(0.12, 0.05, 0.12), cHi: v3(0.34, 0.24, 0.48), light: v3(1.0, 0.42, 0.20).multiplyScalar(1.6), glow: v3(1.0, 0.32, 0.12),
  },
  night: {
    zen: v3(0.004, 0.008, 0.030), sun: v3(0.040, 0.050, 0.120), anti: v3(0.025, 0.035, 0.095), below: v3(0.03, 0.035, 0.08),
    ambLo: v3(0.035, 0.04, 0.09), ambHi: v3(0.05, 0.08, 0.18), bounce: v3(0.06, 0.05, 0.10),
    cLo: v3(0.015, 0.018, 0.045), cHi: v3(0.05, 0.07, 0.15), light: v3(0.45, 0.58, 0.95).multiplyScalar(0.42), glow: v3(0.25, 0.35, 0.7),
  },
  dawn: {
    zen: v3(0.04, 0.07, 0.24), sun: v3(1.0, 0.45, 0.42), anti: v3(0.30, 0.28, 0.55), below: v3(0.50, 0.32, 0.45),
    ambLo: v3(0.14, 0.11, 0.24), ambHi: v3(0.20, 0.22, 0.46), bounce: v3(0.50, 0.28, 0.34),
    cLo: v3(0.14, 0.08, 0.18), cHi: v3(0.40, 0.32, 0.58), light: v3(1.0, 0.55, 0.45).multiplyScalar(1.9), glow: v3(1.0, 0.45, 0.42),
  },
};
const KEYS = ['zen', 'sun', 'anti', 'below', 'ambLo', 'ambHi', 'bounce', 'cLo', 'cHi', 'light', 'glow'];

// uniforms (shared by reference with every material that spreads U)
const UNI = { zen: 'uSkyZen', sun: 'uSkySun', anti: 'uSkyAnti', below: 'uSkyBelow', ambLo: 'uAmbLo', ambHi: 'uAmbHi', bounce: 'uBounce', cLo: 'uCloudLo', cHi: 'uCloudHi', glow: 'uHorGlow' };
for (const k of Object.keys(UNI)) U[UNI[k]] = { value: PAL.day[k].clone() };
U.uSunDisc = { value: new THREE.Vector3(...SUN_DIR) };
U.uMoon = { value: 0 };
U.uSunVis = { value: 1 };

// phase lengths in seconds
const SEG = [['day', 300], ['dusk', 55], ['night', 160], ['dawn', 55]];
export const CYCLE_LENGTH = SEG.reduce((a, s) => a + s[1], 0);
const TOTAL = CYCLE_LENGTH;
const ss = (x) => x * x * (3 - 2 * x);

export class DayCycle {
  constructor() {
    this.t = 30; // seconds into the cycle
    this.mode = 'cycle';
    this.night = 0;
    this.phase = 'day';
    this.lastPhase = 'day';
    this.base = new THREE.Vector3(...SUN_DIR);
    this.apply();
  }
  setMode(m) {
    this.mode = m;
    if (m === 'day') this.t = 30;
    if (m === 'night') this.t = 300 + 55 + 40;
    this.apply();
  }
  // remaining seconds until the next phase
  info() {
    let acc = 0;
    for (const [name, len] of SEG) { if (this.t < acc + len) return { name, left: acc + len - this.t }; acc += len; }
    return { name: 'day', left: 0 };
  }
  update(dt) {
    if (this.mode === 'cycle') this.t = (this.t + dt) % TOTAL;
    this.apply();
  }
  apply() {
    // blend weights between neighbouring palettes
    let acc = 0, idx = 0, f = 0;
    for (let i = 0; i < SEG.length; i++) { if (this.t < acc + SEG[i][1]) { idx = i; f = (this.t - acc) / SEG[i][1]; break; } acc += SEG[i][1]; }
    const name = SEG[idx][0];
    this.phase = name;
    // from-palette and to-palette for this segment
    let A, B, k;
    if (name === 'day') { A = PAL.day; B = PAL.day; k = 0; }
    else if (name === 'night') { A = PAL.night; B = PAL.night; k = 0; }
    else if (name === 'dusk') { if (f < 0.5) { A = PAL.day; B = PAL.dusk; k = ss(f * 2); } else { A = PAL.dusk; B = PAL.night; k = ss((f - 0.5) * 2); } }
    else { if (f < 0.5) { A = PAL.night; B = PAL.dawn; k = ss(f * 2); } else { A = PAL.dawn; B = PAL.day; k = ss((f - 0.5) * 2); } }
    for (const key of KEYS) {
      const out = key === 'light' ? U.uSunColor.value : U[UNI[key]].value;
      out.copy(A[key]).lerp(B[key], k);
    }
    // night amount, sun disc elevation, moon
    let night = 0, elev = 0; // elev: 0 = normal, 1 = fully set
    if (name === 'night') { night = 1; elev = 1; }
    else if (name === 'dusk') { night = ss(Math.max(0, (f - 0.45) / 0.55)); elev = ss(Math.min(1, f / 0.6)); }
    else if (name === 'dawn') { night = 1 - ss(Math.min(1, f / 0.55)); elev = 1 - ss(Math.max(0, (f - 0.35) / 0.65)); }
    this.night = night;
    U.uNight.value = night;
    // the sun disc sinks below the horizon along its own azimuth
    const az = Math.atan2(this.base.z, this.base.x), el0 = Math.asin(this.base.y);
    const el = el0 + (-0.14 - el0) * elev;
    U.uSunDisc.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    U.uSunVis.value = 1 - ss(Math.min(1, elev * 1.25));
    U.uMoon.value = night;
  }
  exposure() { return 0.92 + this.night * 0.55; }
}
