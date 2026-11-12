// Weather fronts: one band of fog, rain or crosswind at a time sweeps across the archipelago.
// The band is a slab across the map moving along `dir`; everything reads it through weight(),
// and the shaders through U.uFront / U.uFrontK and frontW() in glsl.js.
import * as THREE from 'three';
import { U } from './glsl.js';
import { mulberry32 } from './noise.js';

export const FRONTS = {
  fog: {
    name: 'Fog bank', k: [1, 0, 0.1], hw: 430, speed: 11,
    arrive: 'A fog bank is rolling in from the {from}. Islands inside it vanish from view.',
    inside: 'Inside the fog bank', near: 'Fog bank to the {side}',
  },
  rain: {
    name: 'Rain band', k: [0.32, 1, 0.3], hw: 360, speed: 15,
    arrive: 'A rain band is crossing from the {from}. Thermals die under it, and some creatures come out to meet it.',
    inside: 'Under the rain band', near: 'Rain band to the {side}',
  },
  wind: {
    name: 'Crosswind', k: [0, 0, 1], hw: 540, speed: 20,
    arrive: 'A crosswind front is coming from the {from}. It pushes the glider sideways and tears thermals apart.',
    inside: 'In the crosswind', near: 'Crosswind front to the {side}',
  },
};
// tags creatures show when the front is on them (see SPECIES behaviours)
export const WEATHER_TAGS = { fogcall: 'fog', rain: 'rain', gust: 'wind' };

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const compass = (x, z) => COMPASS[(Math.round(Math.atan2(z, x) / (Math.PI / 4)) + 8) % 8];
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const REACH = 2300;   // the band starts and ends this far from the archipelago's centre

export class Weather {
  constructor(seed = 5) {
    this.rnd = mulberry32(seed);
    this.front = null;
    this.calm = 75;            // seconds until the first front
    this.order = ['fog', 'rain', 'wind'];
    this.n = 0;
    this.here = { fog: 0, rain: 0, wind: 0, w: 0 };
    this.wind = new THREE.Vector3();
    this.wetLens = 0;
    this.onArrive = null;
  }
  // start a front now; type is fog, rain or wind
  start(type, at = -REACH, angle = null) {
    const F = FRONTS[type];
    const a = angle ?? this.rnd() * Math.PI * 2;
    this.front = { type, F, dir: new THREE.Vector2(Math.cos(a), Math.sin(a)), s: at, hw: F.hw, speed: F.speed, age: 0 };
    if (this.onArrive) this.onArrive(type, F.arrive.replace('{from}', compass(-Math.cos(a), -Math.sin(a))));
    return type;
  }
  clear() { this.front = null; this.calm = 90 + this.rnd() * 90; }
  hold() { this.front = null; this.calm = 1e9; this.wetLens = 0; }   // golden views and the benchmark: no weather
  // 0..1 inside the band (same ragged edge as frontW in glsl.js)
  weight(x, z) {
    const f = this.front; if (!f) return 0;
    const c = x * f.dir.x + z * f.dir.y - f.s;
    const along = -x * f.dir.y + z * f.dir.x;
    const hw = f.hw * (1 + 0.18 * Math.sin(along * 0.0041 + 1.3) + 0.1 * Math.sin(along * 0.011));
    return 1 - ss(hw * 0.55, hw, Math.abs(c));
  }
  at(x, z) {
    const f = this.front, w = this.weight(x, z);
    if (!f || w <= 0) return { fog: 0, rain: 0, wind: 0, w: 0 };
    return { fog: f.F.k[0] * w, rain: f.F.k[1] * w, wind: f.F.k[2] * w, w };
  }
  update(dt, cam, thermals) {
    const f = this.front;
    if (!f) {
      this.calm -= dt;
      if (this.calm <= 0) { this.start(this.order[this.n % 3]); this.n++; if (this.n % 3 === 0) this.order.sort(() => this.rnd() - 0.5); }
    } else {
      f.age += dt; f.s += f.speed * dt;
      if (f.s > REACH) this.clear();
    }
    const fr = this.front;
    const amp = fr ? Math.min(1, fr.age / 6) : 0;   // fronts fade in when started mid-map from the debug hook
    U.uFront.value.set(fr ? fr.dir.x : 1, fr ? fr.dir.y : 0, fr ? fr.s : -1e5, fr ? fr.hw : 400);
    U.uFrontK.value.set(fr ? fr.F.k[0] * amp : 0, fr ? fr.F.k[1] * amp : 0, fr ? fr.F.k[2] * amp : 0, 0);
    const h = this.at(cam.x, cam.z);
    h.fog *= amp; h.rain *= amp; h.wind *= amp;
    this.here = h;
    // crosswind blows along the front's direction of travel, in gusts
    const t = U.uTime.value;
    const g = 7 + 5 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 2.0);
    this.wind.set(fr ? fr.dir.x : 0, 0, fr ? fr.dir.y : 0).multiplyScalar(h.wind * g);
    // rain and fog bead on the lens and dry off slowly
    const wetGoal = Math.max(h.rain, h.fog * 0.45);
    this.wetLens += (wetGoal - this.wetLens) * Math.min(1, dt * (wetGoal > this.wetLens ? 0.35 : 0.06));
    if (thermals) thermals.damp((x, z) => { const a = this.at(x, z); return Math.max(0, 1 - (a.rain * 0.8 + a.wind * 0.65 + a.fog * 0.2) * amp); });
  }
  // overcast: how much the sun is dimmed where the camera is
  overcast() { return this.here.rain * 0.55 + this.here.fog * 0.35; }
  // one line for the HUD: what front is on, where
  info(cam) {
    const f = this.front; if (!f) return null;
    if (this.here.w > 0.35) return f.F.inside;
    const c = cam.x * f.dir.x + cam.z * f.dir.y - f.s;
    const dist = Math.abs(c) - f.hw;
    if (dist > 1500) return null;
    const side = c > 0 ? compass(-f.dir.x, -f.dir.y) : compass(f.dir.x, f.dir.y);
    return f.F.near.replace('{side}', side) + (dist > 60 ? ` · ${(Math.max(0.1, dist / 1000)).toFixed(1)} km` : '');
  }
}
