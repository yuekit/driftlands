// Driftlands II: the game loop. Owns time, the ship, the fight, the chapter scripts, the cameras and the picture.
import * as THREE from 'three';
import { U } from './glsl.js';
import { DayCycle } from './cycle.js';
import { Weather } from './weather.js';
import { Audio2 } from './audio2.js';
import { Fx } from './fx.js';
import { Combat } from './combat.js';
import { Cable } from './cables.js';
import { CHAPTERS, FREE, Mission } from './mission.js';
import { CITY_POS, CITY_SCALE } from './city.js';
import { CRUISE } from './ship.js';
import { apertureFor } from './post.js';
import { mulberry32 } from './noise.js';
import rawSites from './assets/d2/sites.json';

const SAVE_KEY = 'driftlands2-save-v1', SETTINGS_KEY = 'driftlands2-settings-v1';
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3(), _g = new THREE.Vector3();
const ss = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(o) {
    Object.assign(this, o);
    this.chapters = CHAPTERS;
    this.audio = new Audio2(); this.audio.setListener(this.camera);
    this.settings = Object.assign({ invert: false, style: 'ink', sound: true, quality: 'auto', shake: true, blur: true }, load(SETTINGS_KEY, {}));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && load(SETTINGS_KEY, null) === null) { this.settings.blur = false; this.settings.shake = false; }
    this.save = load(SAVE_KEY, { reached: 0, finished: false });
    this.quality = { dprScale: 1, level: 2, lastChange: 0 };
    this.cycle = new DayCycle(); this.cycle.mode = 'fixed';
    this.tod = { t: 548, goal: 548, rate: 0 };
    this.weather = new Weather(); this.weather.hold();
    this.fx = new Fx();
    this.pipe.fxScene = this.fx.scene;
    this.combat = new Combat(this);
    this.mission = new Mission(this);
    this.state = 'loading'; this.time = 0; this.realTime = 0; this.timers = [];
    this.fade = 1; this.fadeGoal = 0; this.fadeRate = 1;
    this.markers = []; this.dmgDirs = []; this.hitMark = 0; this.killMark = 0; this.hurtT = 0; this.sinceHit = 99;
    this.aim = { x: 0, y: 0, point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), target: null, lead: new THREE.Vector3() };
    this.alarm = 0; this.cine = null; this.docked = false; this.docking = null; this.cp = {};
    this.bolt = { t: 0, next: 4, pts: null, life: 0 };
    this.frameAvg = 16; this.slowT = 0; this.fastT = 0; this.lastHud = 0;
    this.input.invert = this.settings.invert;
    this.col = this.makeCollider();
    this.setupSites();
    this.applyStyle();
    this.applyQuality(this.settings.quality === 'low' ? 0 : this.settings.quality === 'high' ? 3 : 2);
    this._sunBase = new THREE.Vector3();
    if (this.landmarks) { for (const p of this.landmarks.posts) p.target = 1; for (const c of this.landmarks.camps) c.found = true; }
  }
  // ---------------------------------------------------------------- world helpers
  makeCollider() {
    const g = this, city = this.city, isl = this.world.islands, bell = this.bell, sk = this.skerries;
    const sdf = (x, y, z) => {
      let d = 1e9;
      if (x > city.min.x - 150 && x < city.max.x + 150 && z > city.min.z - 150 && z < city.max.z + 150) { d = city.sdf(x, y, z); if (bell) d = Math.min(d, bell.sdf(x, y, z)); }
      else if (sk && sk.spots.length && x > sk.min.x - 150 && x < sk.max.x + 150 && z > sk.min.z - 150 && z < sk.max.z + 150) d = sk.sdf(x, y, z);
      for (const I of isl) {
        const p = I.group.position, r = I.spec.radius + 90, dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz > r * r || Math.abs(y - p.y) > 220) continue;
        d = Math.min(d, I.sdfWorld(x, y, z));
      }
      return d;
    };
    const out = new THREE.Vector3();
    return {
      floor: 36, ceiling: 1500, wind: this.weather ? this.weather.wind : null, city, sdf,
      grad: (x, y, z) => { const e = 3; out.set(sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)); const l = out.length(); return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 1, 0); },
    };
  }
  setupSites() {
    const city = this.city, isl = this.world.islands, I0 = isl[0];
    this.dirCity = new THREE.Vector3(city.centre.x - I0.pos.x, 0, city.centre.z - I0.pos.z).normalize();
    const W = (p) => city.toWorld(p[0], p[1], p[2]);
    const hearts = rawSites.hearts.map((h) => {
      const n = new THREE.Vector3(...h.n).normalize(), pos = W(h.p);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v.set(n.x, 0, n.z).normalize());
      return { pos, n, quat, turrets: h.turrets.map((t) => ({ pos: W(t.p), n: new THREE.Vector3(...t.n) })) };
    });
    this.air = rawSites.air.map(W);
    // grapples on the rim of Verdigris Reach, on the side the city pulls from
    const grapples = [-0.75, 0.05, 0.8].map((a) => {
      const ang = Math.atan2(this.dirCity.z, this.dirCity.x) + a, r = I0.spec.radius * 0.66;
      const x = I0.pos.x + Math.cos(ang) * r, z = I0.pos.z + Math.sin(ang) * r;
      let y = I0.groundAt(x, z); if (isNaN(y)) y = I0.pos.y + 6;
      return { pos: new THREE.Vector3(x, y + 4, z), quat: new THREE.Quaternion().setFromAxisAngle(UP, -ang) };
    });
    // the lamp square, and the pose the ship settles into
    const dockPos = W([-44.5, 2.05, -18.5]);
    this.sites = { hearts, grapples, dock: { pos: dockPos, yaw: Math.PI / 2, approach: { pos: new THREE.Vector3(dockPos.x - 760, dockPos.y + 150, dockPos.z - 60), yaw: Math.PI / 2 } } };
    // cables: Verdigris's three to the first heart; the other islands shared among the rest
    const byHeart = [[], [], [], []], all = [], verd = [];
    const eye = (g) => _v.copy(g.pos).add(_w.set(0, 10.5, 0)).clone();
    grapples.forEach((g) => { const c = new Cable(this.scene, hearts[0].pos, eye(g)); verd.push(c); all.push(c); byHeart[0].push(c); });
    const share = [1, 2, 3, 1, 2, 3, 3];
    isl.slice(1).forEach((I, k) => {
      const d = _v.set(city.centre.x - I.pos.x, 0, city.centre.z - I.pos.z).normalize();
      const end = new THREE.Vector3(I.pos.x + d.x * I.spec.radius * 0.55, I.pos.y - 6, I.pos.z + d.z * I.spec.radius * 0.55);
      const c = new Cable(this.scene, hearts[share[k]].pos, end, { sag: 0.05 }); all.push(c); byHeart[share[k]].push(c);
    });
    this.cables = { all, verd, byHeart };
    // skerries: bare rocks strung across the Reach, clear of the ship's lane and of every cable
    if (this.skerries) {
      const I = I0.pos, C = city.centre, L = Math.hypot(C.x - I.x, C.z - I.z), d = this.dirCity, rnd = mulberry32(4117), spots = [];
      const pts = []; for (const c of all) for (let k = 0; k <= 60; k++) pts.push(c.at(k / 60));
      for (let k = 0; k < 400 && spots.length < 10; k++) {
        const s = L * (0.15 + 0.45 * rnd()), scale = 5.5 + 6 * rnd() * rnd(), r = 8.4 * scale, side = rnd() < 0.5 ? -1 : 1;
        const lat = side * (r + 75 + 460 * rnd() * rnd()), y = 120 + 230 * rnd();
        const pos = new THREE.Vector3(I.x + d.x * s + d.z * lat, y, I.z + d.z * s - d.x * lat), yaw = rnd() * 6.283;
        if (spots.some((o) => Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) < (o.scale + scale) * 8.4 + 120)) continue;
        if (pts.some((p) => Math.hypot(p.x - pos.x, p.z - pos.z) < r + 45 && p.y > y - 40 && p.y < y + 14 * scale + 40)) continue;
        spots.push({ pos, scale, yaw });
      }
      this.skerries.place(spots);
    }
    // lights on the city: beacons on its highest masts and domes, and the lamps of the square
    const seen = [];
    this.beacons = [...city.instancesOf('sphere', true), ...city.instancesOf('exhaus', true)].sort((a, b) => b.y - a.y)
      .filter((p) => { if (seen.some((q) => q.distanceTo(p) < 60)) return false; seen.push(p); return true; }).slice(0, 18).map((p, i) => ({ p: p.clone().add(_v.set(0, 2, 0)), ph: i * 1.9 }));
    this.lamps = city.instancesOf('lamp', true).map((p) => ({ p, light: null }));
    this.islandFree = isl.map(() => 0);
  }
  // an island let go: it rises a little and rides easier
  freeIsland(i, amount, instant = false) { this.islandFree[i] = Math.min(1, instant ? amount : this.islandFree[i] + amount); if (instant) this.world.islands[i].offset.y = this.islandFree[i] * 14; }
  slackHeart(i, instant = false) { for (const c of this.cables.byHeart[i]) { c.slackGoal = 1; c.u.uLive.value = 0; if (instant) c.slack = 1; } }
  nearestTarget() { let d = 1e9; for (const t of this.combat.targets) d = Math.min(d, t.pos.distanceTo(this.ship.pos)); return d; }
  dronesAlive() { return this.combat.drones.filter((d) => d.alive).length; }
  // a patch of open air about so far from the ship, inside the city if there is one near
  airNear(dist) {
    let best = null, bs = 1e9;
    for (const a of this.air) { const s = Math.abs(a.distanceTo(this.ship.pos) - dist); if (s < bs) { bs = s; best = a; } }
    return best ? best.clone() : this.ship.pos.clone().addScaledVector(this.ship.fwd, dist);
  }
  wave(n, centre, spread, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
      _v.set(centre.x + rnd(spread), Math.max(this.col.floor + 40, centre.y + rnd(spread * 0.4)), centre.z + rnd(spread));
      // not inside a wall
      for (let k = 0; k < 6 && this.col.sdf(_v.x, _v.y, _v.z) < 20; k++) _v.addScaledVector(this.col.grad(_v.x, _v.y, _v.z), 25);
      const d = this.combat.spawnDrone(_v, { ...opts, dir: _w.copy(this.ship.pos).sub(_v) });
      if (d) out.push(d);
    }
    return out;
  }
  say(who, text, dur) { this.ui.say(who, text, dur); }
  objective(text, done = 0, total = 0) { const ch = this.mission.chapter; this.ui.objective(ch && ch.numeral ? `Chapter ${ch.numeral} · ${ch.title}` : 'Free flight', text, done, total); }
  get talkDone() { return () => !this.ui.talking; }
  after(t, fn) { this.timers.push({ t, fn }); }
  setTime(t, secs = 0) { this.tod.goal = t; if (secs <= 0) { this.tod.t = t; this.tod.rate = 0; } else { let d = t - this.tod.t; if (d < 0) d += 570; this.tod.rate = d / secs; } }
  storm(on) {
    if (!on) { this.weather.hold(); return; }
    const d = this.dirCity, I = this.world.islands[0].pos;
    // a standing front across the middle of the crossing; it has cleared by the time the city shows
    const L = Math.hypot(this.city.centre.x - I.x, this.city.centre.z - I.z);
    this.weather.start('rain', I.x * d.x + I.z * d.z + L * 0.36, Math.atan2(d.z, d.x));
    const f = this.weather.front; f.speed = 0; f.hw = L * 0.2; f.age = 10;
    this.weather.onArrive = null;
  }
  // ---------------------------------------------------------------- flow
  start() {
    this.state = 'title';
    this.titleScene();
    this.ui.ready(this);
    this.last = performance.now();
    const loop = (now) => { requestAnimationFrame(loop); const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now; this.frame(dt); };
    requestAnimationFrame(loop);
  }
  titleScene() {
    this.resetWorld();
    this.setTime(548);
    const I = this.world.islands[0].pos, d = this.dirCity;
    this.ship.place(new THREE.Vector3(I.x - d.x * 420 - d.z * 260, I.y + 120, I.z - d.z * 420 + d.x * 260), Math.atan2(d.x, d.z) + 0.25);
    this.titleAng = 2.2;
    this.fade = 1; this.fadeTo(0, 2.5);
  }
  resetWorld() {
    this.combat.clear(); this.fx.clear(); this.mission.stop(); this.ui.clearSay();
    this.timers.length = 0; this.markers.length = 0; this.dmgDirs.length = 0;
    for (const c of this.cables.all) c.reset();
    this.islandFree.fill(0); for (const I of this.world.islands) I.offset.set(0, 0, 0);
    this.weather.hold(); this.alarm = 0; this.cine = null; this.docked = false; this.docking = null; this.awaitBell = false; this.bellRung = false; this.freeTime = false; this.dead = 0;
    U.uCityGlow.value = 0.06; U.uCityWave.value.w = -1; U.uCityAlarm.value = 0; U.uBolt.value = 0;
    if (this.bell) { this.bell.goal = 0; this.bell.lit = 0; }
    if (this.landmarks) this.landmarks.chordTarget = 0;
    const s = this.ship; s.hull = s.maxHull; s.energy = 1; s.docked = false; s.speed = CRUISE; s.boost = 0; s.invuln = 2; s.root.visible = true;
    this.pipe.finalMat.uniforms.uFlash.value = 0;
  }
  begin(i) {
    this.audio.start(this.settings.sound);
    this.ui.showTitle(false); this.ui.end(false);
    this.cp = {};
    this.fadeTo(1, 0.5, () => { this.startChapter(i); this.fadeTo(0, 1.6); });
  }
  startChapter(i) {
    this.index = i;
    const ch = i < 0 ? FREE : CHAPTERS[i];
    this.resetWorld();
    this.setTime(ch.time);
    this.mission.start(ch);
    this.state = 'play';
    this.cam.snap(this.ship);
    this.ui.showHUD(true); this.ui.objective(ch.numeral ? `Chapter ${ch.numeral} · ${ch.title}` : 'Free flight', '');
    this.pipe.hasPrev = false; this.pipe.adaptReset = true;
  }
  restart() { this.fadeTo(1, 0.5, () => { this.startChapter(this.index); this.fadeTo(0, 1.4); }); }
  complete() {
    const next = this.index + 1;
    this.save.reached = Math.max(this.save.reached || 0, Math.min(next, CHAPTERS.length - 1)); store(SAVE_KEY, this.save);
    this.cp = {};
    this.fadeTo(1, 1.4, () => { this.startChapter(next); this.fadeTo(0, 1.8); });
  }
  finish() {
    this.save.finished = true; this.save.reached = CHAPTERS.length - 1; store(SAVE_KEY, this.save);
    this.ui.showHUD(false);
    this.ui.end(true, 'The Tall City has stopped hauling. It holds the islands now the way a hand holds a kite string, and it has lit a lamp in every window in case anyone else is still out.',
      'Idris Vane · Keeper of Plates, Meridian Institute',
      'Driftlands II: The Tall City<br>Story, code, lighting and sound by Claude, for Yue-Kit<br>Airship and city built from the Stylized Fantasy Ship and Tall City model kits<br>Islands, creatures and weather carried over from Driftlands',
      [['Fly free', () => this.begin(-1), true], ['Back to the title', () => this.toTitle()]]);
  }
  toTitle() { this.fadeTo(1, 0.6, () => { this.ui.end(false); this.ui.showHUD(false); this.state = 'title'; this.titleScene(); this.ui.showTitle(true); }); }
  fadeTo(v, secs, then) { this.fadeGoal = v; this.fadeRate = 1 / Math.max(secs, 0.01); this.fadeThen = then || null; }
  pause(on) {
    if (on && this.state !== 'play') return;
    if (!on && this.state !== 'paused') { this.ui.pause(false); return; }
    this.state = on ? 'paused' : 'play';
    this.ui.pause(on);
    if (this.audio.ctx) this.audio.duck(on);
  }
  setSetting(k, v) {
    this.settings[k] = v; store(SETTINGS_KEY, this.settings);
    if (k === 'sound') this.audio.setEnabled(v);
    if (k === 'quality') this.applyQuality(v === 'low' ? 0 : v === 'high' ? 3 : 2);
    if (k === 'style') this.applyStyle();
    if (k === 'invert') this.input.invert = v;
  }
  applyStyle() { U.uStyle.value = this.settings.style === 'ink' ? 1 : 0; this.pipe.ink = this.settings.style === 'ink' ? 0.55 : 0.3; }
  applyQuality(level) {
    level = Math.max(0, Math.min(3, level));
    this.quality.level = level;
    const p = [
      { scale: 0.55, steps: 24, cloud: 0.36, ao: 0, shadow: 0 }, { scale: 0.72, steps: 32, cloud: 0.42, ao: 0.6, shadow: 1024 },
      { scale: 0.86, steps: 40, cloud: 0.5, ao: 0.75, shadow: 2048 }, { scale: 1.0, steps: 52, cloud: 0.5, ao: 0.75, shadow: 2048 },
    ][level];
    this.pipe.scale = p.scale; this.pipe.steps = p.steps; this.pipe.cloudScale = p.cloud; this.pipe.ao = p.ao; this.pipe.contact = level > 0 ? 1 : 0;
    this.pipe.cloudMat.uniforms.uShaftSteps.value = level >= 3 ? 20 : 12;
    this.fx.density = [0.5, 0.75, 1, 1.2][level];
    if (this.motes) this.motes.setDensity([0.35, 0.6, 1, 1][level]);
    if (this.mirror) { this.mirror.enabled = level >= 1; this.mirror.scale = [0.3, 0.3, 0.4, 0.5][level]; }
    for (const isl of this.world.islands) isl.groundDensity = [0.45, 0.7, 1, 1][level];
    if (this.shadow) { this.shadow.enabled = p.shadow > 0; if (p.shadow) this.shadow.setSize(p.shadow); }
    this.resize && this.resize();
  }
  adaptQuality(dt) {
    if (this.settings.quality !== 'auto' || this.state !== 'play') return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    if (this.frameAvg > 24) this.slowT += dt; else this.slowT = Math.max(0, this.slowT - dt);
    if (this.frameAvg < 14.5) this.fastT += dt; else this.fastT = 0;
    if (this.realTime - this.quality.lastChange < 6) return;
    if (this.slowT > 3 && this.quality.level > 0) { this.applyQuality(this.quality.level - 1); this.quality.lastChange = this.realTime; this.slowT = 0; }
    else if (this.fastT > 14 && this.quality.level < 2) { this.applyQuality(this.quality.level + 1); this.quality.lastChange = this.realTime; this.fastT = 0; }
  }
  // ---------------------------------------------------------------- landing and the ending
  dock() {
    const s = this.ship;
    s.docked = true;
    this.docking = { t: 0, p0: s.pos.clone(), yaw0: s.yaw, pitch0: s.pitch, sp0: s.speed };
    this.cineAng = Math.atan2(this.camera.position.x - s.pos.x, this.camera.position.z - s.pos.z); this.cineR = 80; this.cineH = 26;
    this.cine = (dt) => this.orbitCam(dt, 0.07);
  }
  orbitCam(dt, rate, lookUp = 12) {
    const s = this.ship, cam = this.camera;
    this.cineAng += dt * rate;
    let r = this.cineR;
    for (; r > 26; r -= 6) { _v.set(s.pos.x + Math.sin(this.cineAng) * r, s.pos.y + this.cineH, s.pos.z + Math.cos(this.cineAng) * r); if (this.col.sdf(_v.x, _v.y, _v.z) > 12) break; }
    _v.set(s.pos.x + Math.sin(this.cineAng) * r, s.pos.y + this.cineH, s.pos.z + Math.cos(this.cineAng) * r);
    cam.position.lerp(_v, 1 - Math.exp(-dt * 1.2));
    cam.up.set(0, 1, 0); cam.lookAt(s.pos.x, s.pos.y + lookUp, s.pos.z);
    cam.fov += (52 - cam.fov) * Math.min(1, dt); cam.updateProjectionMatrix();
  }
  finale() {
    const s = this.ship, C = this.city.centre, fu = this.pipe.finalMat.uniforms, B = this.bell;
    const src = B ? B.base : s.pos;
    this.fin = { t: 0, shot: 0 };
    this.audio.bellRing(true); this.after(1.2, () => this.audio.chord());
    if (B) B.goal = 1;
    U.uCityWave.value.set(src.x, src.y, src.z, 0);
    this.fx.shock(src, 900, 3.5, 0.07);
    this.fx.spawn(3, _v.copy(src).setY(src.y + 20), _w.set(0, 0, 0), 2.4, 20, 700, [1.2, 4, 3.5], 0.9);
    fu.uFlash.value = 0.35; fu.uFlashColor.value.set(0.7, 1, 0.92);
    this.alarm = 0; for (const c of this.cables.all) c.slackGoal = 1;
    if (this.landmarks) this.landmarks.chordTarget = 1;
    this.setTime(400, 20);
    const I = this.world.islands[0].pos, d = this.dirCity;
    const wide = new THREE.Vector3(C.x - d.x * 1350 + d.z * 520, 430, C.z - d.z * 1350 - d.x * 520), home = new THREE.Vector3(I.x - d.x * 330 + d.z * 90, I.y + 110, I.z - d.z * 330 - d.x * 90);
    const mid = B ? B.base.clone().setY(B.base.y + B.height * 0.45) : s.pos.clone();
    const from = s.pos.clone().add(_v.set(-58, 16, 34)), look = new THREE.Vector3();
    this.cine = (dt) => {
      const f = this.fin, cam = this.camera; f.t += dt;
      // the waking light climbs through the city from the foot of the Bell
      U.uCityWave.value.w = f.t * 32;
      if (f.t > 24) U.uCityGlow.value = Math.min(1, U.uCityGlow.value + dt * 0.3);
      const cut = (n, fn) => { if (f.shot < n) { f.shot = n; this.fade = 1; this.fadeTo(0, 1.2); this.pipe.hasPrev = false; fn && fn(); } };
      if (f.t < 10) {
        // in the square: past the ship to the Bell as it fills, the camera rising and drawing back
        const k = ss(f.t / 10);
        cam.position.copy(from).add(_v.set(-26 * k, 38 * k, 10 * k));
        look.copy(s.pos).setY(s.pos.y + 12).lerp(mid, 0.25 + 0.6 * k); look.y += 30 * k;
        cam.up.set(0, 1, 0); cam.lookAt(look); cam.fov = 58 - 6 * k; cam.updateProjectionMatrix();
      } else if (f.t < 26) {
        cut(1);
        const k = (f.t - 10) / 16;
        cam.position.copy(wide).addScaledVector(_v.set(d.z, 0.1, -d.x), k * 240);
        cam.up.set(0, 1, 0); cam.lookAt(C.x, C.y + 60 + k * 50, C.z); cam.fov = 44 - k * 5; cam.updateProjectionMatrix();
      } else {
        cut(2, () => { this.setTime(545, 24); });
        const k = (f.t - 26) / 26;
        cam.position.copy(home).addScaledVector(_v.set(-d.x, 0.1, -d.z), k * 120);
        cam.up.set(0, 1, 0); cam.lookAt(I.x + d.x * 600, I.y + 150 + k * 40, I.z + d.z * 600); cam.fov = 50; cam.updateProjectionMatrix();
      }
    };
  }
  // ---------------------------------------------------------------- frame
  frame(dtReal, render = true) {
    this.realTime += dtReal;
    this.adaptQuality(dtReal);
    const inp = this.input.read(dtReal), fx = this.fx, ship = this.ship, fu = this.pipe.finalMat.uniforms;
    if (inp.pause && (this.state === 'play' || this.state === 'paused')) this.pause(this.state === 'play');
    const playing = this.state === 'play', frozen = this.state === 'paused';
    const slow = this.dead > 0 ? 0.35 : 1;
    const dt = frozen ? 0 : dtReal * slow;
    this.time += dt; U.uTime.value = this.time;
    // fades
    if (this.fade !== this.fadeGoal) { const st = dtReal * this.fadeRate; this.fade = this.fade < this.fadeGoal ? Math.min(this.fadeGoal, this.fade + st) : Math.max(this.fadeGoal, this.fade - st); if (this.fade === this.fadeGoal && this.fadeThen) { const f = this.fadeThen; this.fadeThen = null; f(); } }
    // time of day and weather
    const T = this.tod;
    if (this.freeTime) T.t = (T.t + dt) % 570;
    else if (T.rate > 0) { T.t += T.rate * dt; let rem = T.goal - T.t; if (rem < -285) rem += 570; if (rem <= 0) { T.t = T.goal; T.rate = 0; } if (T.t >= 570) T.t -= 570; }
    this.cycle.t = T.t; this.cycle.apply(); this.night = this.cycle.night;
    this.weather.update(dt, this.camera.position, this.world.thermals);
    this._sunBase.copy(U.uSunColor.value); U.uSunColor.value.multiplyScalar(1 - this.weather.overcast());
    // inside the storm the whole sky closes in: darker, greyer, so the lightning has something to light
    const stormK = this.weather.here.rain;
    if (stormK > 0.01) {
      const k = 1 - 0.55 * stormK;
      for (const n of ['uSkyZen', 'uSkySun', 'uSkyAnti', 'uSkyBelow', 'uAmbHi', 'uAmbLo', 'uCloudHi', 'uCloudLo', 'uHorGlow', 'uBounce']) {
        const v = U[n].value, g = (v.x + v.y + v.z) / 3;
        v.set((v.x + (g * 0.85 - v.x) * 0.5 * stormK) * k, (v.y + (g * 0.95 - v.y) * 0.5 * stormK) * k, (v.z + (g * 1.12 - v.z) * 0.5 * stormK) * k);
      }
    }
    this.lightning(dt);
    fx.bolts.begin(); fx.glows.begin();
    this.cityLights(dt);
    if (this.timers.length && dt > 0) { for (const tm of this.timers) tm.t -= dt; const due = this.timers.filter((tm) => tm.t <= 0); this.timers = this.timers.filter((tm) => tm.t > 0); due.forEach((tm) => tm.fn()); }
    if (playing) this.mission.update(dt);
    this.ui.tick(dtReal);

    // ---- the ship
    const events = [];
    this.firing = false;
    if (this.state === 'title' && !this.debugCam) this.titleFrame(dt);
    else if (this.docking) this.dockFrame(dt);
    else if (playing && !ship.docked && this.dead <= 0) {
      ship.update(dt, inp, this.col, events);
      this.aimFrame(inp);
      if (inp.fire && !this.cine) { this.firing = true; if (this.combat.firePlayer(ship, this.aim, dt)) { this.audio.lance(); this.cam.kick = Math.min(1, this.cam.kick + 0.25); } }
      if (inp.bell && this.combat.bell(ship)) { this.audio.bellRing(); this.cam.shake = Math.max(this.cam.shake, 1.2); this.input.rumble(0.8, 0.5, 300); }
    } else if (playing && ship.docked) {
      ship.animate(dt); ship.speed += (0 - ship.speed) * Math.min(1, dt);
      if (this.awaitBell && inp.bell) { this.awaitBell = false; this.bellRung = true; }
    } else if (dt > 0 && this.dead > 0) { ship.vel.y -= 18 * dt; ship.pos.addScaledVector(ship.vel, dt); ship.roll += dt * 0.5; ship.pitch -= dt * 0.25; ship.orient(); ship.sync(); if (Math.random() < dt * 30) fx.smoke(ship.local(rnd(4), 6 + rnd(6), rnd(12), _v), _w.set(rnd(3), 6, rnd(3)), 12, 3, 0.05, 0.8); }
    for (const e of events) if (e.type === 'crash') { const dmg = e.strength * 14; if (ship.damage(dmg)) { this.onShipHit(dmg, null); fx.sparks(e.pos, 24, null, 30, [4, 2, 0.7]); this.audio.hullHit(e.strength); } }
    ship.lamp += ((this.night > 0.3 || this.weather.here.rain > 0.3 ? 1 : 0.15) - ship.lamp) * Math.min(1, dt);
    // ---- the fight
    if (!frozen) this.combat.update(dt, ship, this.col);
    for (const e of this.combat.events) this.onCombat(e);
    this.combat.events.length = 0;
    this.hitMark = Math.max(0, this.hitMark - dtReal); this.killMark = Math.max(0, this.killMark - dtReal); this.hurtT = Math.max(0, this.hurtT - dtReal * 1.6);
    for (const d of this.dmgDirs) d.t -= dtReal; this.dmgDirs = this.dmgDirs.filter((d) => d.t > 0);
    this.sinceHit += dt;
    if (playing && this.sinceHit > 4.5 && ship.hull > 0 && ship.hull < ship.maxHull) ship.hull = Math.min(ship.maxHull, ship.hull + dt * 6);
    if (playing && ship.hull <= 0 && this.dead <= 0) this.die();
    this.shipFx(dt);

    // ---- world
    this.world.islands.forEach((isl, i) => { const goal = this.islandFree[i] * 14; isl.offset.y += (goal - isl.offset.y) * Math.min(1, dt * 0.4); isl.update(this.time); });
    this.world.thermals.update();
    this.world.rocks.update(this.time);
    if (this.landmarks) this.landmarks.update(this.time, dtReal);
    for (const c of this.cables.all) c.update(dt);
    if (this.bell) this.bell.update(dt);
    for (const t of this.combat.targets) if (t.kind === 'grapple') { const I = this.world.islands[0]; if (t.y0 === undefined) t.y0 = t.pos.y - (I.group.position.y - I.basePos.y); t.pos.y = t.y0 + I.group.position.y - I.basePos.y; t.mesh.position.y = t.pos.y; }
    const al = U.uCityAlarm; al.value += (this.alarm - al.value) * Math.min(1, dt * 0.6);
    const ctx = { time: this.time, glider: { pos: ship.pos, vel: ship.vel, yaw: ship.yaw, perched: false }, camPos: this.camera.position, camera: this.camera, night: this.night || 0, audio: playing ? this.audio : null, weather: this.weather };
    if (dt > 0) this.world.eco.update(dt, ctx);

    // ---- camera
    if (this.debugCam) { const dc = this.debugCam, o = dc.rel ? ship.pos : { x: 0, y: 0, z: 0 }; this.camera.position.set(dc.p[0] + o.x, dc.p[1] + o.y, dc.p[2] + o.z); this.camera.up.set(0, 1, 0); this.camera.lookAt(dc.t[0] + o.x, dc.t[1] + o.y, dc.t[2] + o.z); this.camera.fov = dc.fov || 60; this.camera.updateProjectionMatrix(); }
    else if (this.cine) { if (!frozen) this.cine(dtReal); }
    else if (this.state !== 'title') { this.cam.shakeScale = this.settings.shake ? 1 : 0; if (!frozen) this.cam.update(ship, dtReal, inp, this.col); }
    U.uCamPos.value.copy(this.camera.position);
    // the cloud pass shades and mists around the nearest islands; the city counts as one when it is near
    const cp = this.camera.position, uI = this.pipe.cloudMat.uniforms.uIsl.value;
    const near = this.world.islands.map((I) => ({ p: I.pos, r: I.spec.radius, d: I.pos.distanceToSquared(cp) }));
    near.push({ p: this.cityFoot || (this.cityFoot = new THREE.Vector3(this.city.centre.x, 60, this.city.centre.z)), r: 380, d: this.city.centre.distanceToSquared(cp) * 0.5 });
    near.sort((a, b) => a.d - b.d);
    uI.forEach((v, i) => { const I = near[i]; if (I) v.set(I.p.x, I.p.y, I.p.z, I.r); else v.set(0, -1e5, 0, 1); });
    this.world.eco.draw(ctx);
    fx.update(dt, this.camera, fu);

    // ---- picture
    fu.uLens.value = 0;
    fu.uSpeedFx.value = this.settings.blur ? Math.max(0, Math.min(1, ship.boost * 0.9)) : 0;
    fu.uFade.value = 1 - this.fade;
    fu.uFlash.value = Math.max(0, fu.uFlash.value - dtReal * 1.2);
    fu.uExposure.value = this.cycle.exposure();
    fu.uAutoAmt.value = 0.55 * (1 - 0.8 * this.night);
    fu.uRain.value = this.weather.here.rain; fu.uWet.value = this.weather.wetLens;
    this.pipe.mblur = this.settings.blur ? 0.45 : 0;
    this.grade(fu);
    const D = this.pipe.dof; D.aperture = this.state === 'title' ? apertureFor(44, 4) : 0; D.focusDist = this.state === 'title' ? this.camera.position.distanceTo(ship.pos) : 0;

    if (render) {
      const focus = _v.copy(ship.pos).addScaledVector(ship.fwd, 70);
      const fr = this._frustum || (this._frustum = new THREE.Frustum()), pm = this._pm || (this._pm = new THREE.Matrix4());
      this.camera.updateMatrixWorld();
      fr.setFromProjectionMatrix(pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
      for (const isl of this.world.islands) if (isl.lod) isl.lod(this.camera.position, focus, this.shadow ? this.shadow.extent : 0, fr);
      this.renderer.info.reset();
      if (this.motes) this.motes.update();
      if (this.glow) this.glow.update(this.camera.position, this.world.islands, this.world.eco, this.night || 0);
      if (this.shadow) this.shadow.render(this.scene, this.camera);
      if (this.mirror && this.pipe.targets) this.mirror.render(this.scene, this.camera, this.pipe.targets.W, this.pipe.targets.H);
      this.pipe.dt = dtReal;
      this.pipe.render(this.scene, this.camera);
      if (this.perf) this.perf.update(dtReal);
    }
    U.uSunColor.value.copy(this._sunBase);
    // ---- sound and display
    this.audio.wx = this.weather.here;
    if (this.state !== 'loading') {
      this.audio.update({ perched: false, speed: ship.speed, climb: 0 }, { eco: this.world.eco }, 0, dtReal, frozen ? 0 : 1, this.night);
      this.audio.update2(ship, dtReal, { live: playing && this.dead <= 0, alarm: U.uCityAlarm.value, fight: this.combat.drones.length > 0, night: this.night, lowHull: ship.hull < 35 && ship.hull > 0 });
    }
    if (this.realTime - this.lastHud > 0.05) { this.lastHud = this.realTime; if (playing) this.ui.update(this); }
    this.ui.draw(this);
  }
  aimFrame(inp) {
    const A = this.aim, cam = this.camera;
    A.x = inp.aimX; A.y = inp.aimY;
    const asp = cam.aspect;      // the ring moves within the shorter half of the screen
    _v.set(asp >= 1 ? A.x / asp : A.x, asp >= 1 ? A.y : A.y * asp, 0.5).unproject(cam);
    A.dir.copy(_v).sub(cam.position).normalize();
    A.target = this.combat.pick(cam.position, A.dir, 0.06, 690);
    if (A.target) { this.combat.lead(A.target, this.ship.pos, 540, A.lead); A.point.copy(A.lead); }
    else {
      let t = 520;
      const hit = this.col.city.raycast(cam.position, A.dir, 900, 2);
      if (hit > 80) t = hit;
      A.point.copy(cam.position).addScaledVector(A.dir, t);
    }
  }
  onCombat(e) {
    if (e.type === 'hit') { this.hitMark = 0.18; this.audio.hitTick(); }
    else if (e.type === 'kill') {
      this.hitMark = 0.3; this.killMark = 0.3;
      const big = e.kind === 'heart' || e.kind === 'grapple' || (e.e && e.e.boss);
      this.audio.boom(e.pos, big ? 2 : 1);
      const d = e.pos.distanceTo(this.camera.position);
      this.cam.shake = Math.max(this.cam.shake, (big ? 3 : 1.2) * Math.max(0, 1 - d / (big ? 900 : 350)));
      if (big) { const fu = this.pipe.finalMat.uniforms; fu.uFlash.value = 0.2; fu.uFlashColor.value.set(1, 0.8, 0.6); this.input.rumble(1, 0.7, 500); this.audio.crash(d); }
    } else if (e.type === 'shipHit') { this.onShipHit(e.dmg, e.pos); this.audio.hullHit(0.4); }
    else if (e.type === 'enemyShot') this.audio.enemyShot(e.pos);
  }
  onShipHit(dmg, from) {
    this.sinceHit = 0; this.hurtT = Math.min(1, this.hurtT + 0.35 + dmg * 0.02);
    this.cam.shake = Math.max(this.cam.shake, 0.8 + dmg * 0.06);
    this.input.rumble(0.6, 0.4, 160);
    if (from) { _v.copy(from).sub(this.ship.pos).applyQuaternion(_q.copy(this.camera.quaternion).invert()); this.dmgDirs.push({ a: Math.atan2(-_v.y, _v.x), t: 0.8 }); }
  }
  die() {
    const s = this.ship;
    this.dead = 99; this.cp.deaths = (this.cp.deaths || 0) + 1;
    this.fx.explosion(s.local(0, 14, 0, _v), 3, [1, 0.55, 0.2]); this.audio.boom(s.pos, 2.5); this.audio.sting(false);
    this.cam.shake = 3; this.ui.warn('The Long Gallery is lost', 3);
    this.after(0.6, () => this.fadeTo(1, 1.2, () => { this.startChapter(this.index); this.fadeTo(0, 1.4); }));
  }
  dockFrame(dt) {
    const d = this.docking, s = this.ship, D = this.sites.dock;
    d.t = Math.min(1, d.t + dt / 7.5);
    const k = ss(d.t), k2 = ss(Math.min(1, d.t * 1.5));
    // glide in level, then settle straight down
    _v.copy(D.pos); _v.y += 30 * (1 - ss(Math.max(0, (d.t - 0.55) / 0.45)));
    s.pos.lerpVectors(d.p0, _v, k);
    let dy = D.yaw - d.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    s.yaw = d.yaw0 + dy * k2; s.pitch = d.pitch0 * (1 - k2); s.roll *= 1 - Math.min(1, dt * 2); s.yawRate = 0;
    s.speed = d.sp0 * (1 - k) + 2; s.vel.set(0, 0, 0);
    s.orient(); s.sync(); s.animate(dt);
    if (d.t >= 1) { this.docking = null; this.docked = true; s.speed = 0; }
  }
  titleFrame(dt) {
    const s = this.ship, cam = this.camera;
    s.update(dt, { x: 0.05, y: 0, boost: false, brake: true }, { floor: 36, wind: null }, null);
    this.titleAng += dt * 0.035;
    const r = 78, a = this.titleAng;
    cam.position.set(s.pos.x + Math.sin(a) * r, s.pos.y + 9 + Math.sin(a * 0.7) * 5, s.pos.z + Math.cos(a) * r);
    cam.up.set(0, 1, 0);
    _v.copy(s.pos).addScaledVector(s.right, -18); _v.y += 13;
    cam.lookAt(_v); cam.fov = 44; cam.updateProjectionMatrix();
  }
  // beacons blink on the masts (faster and red when the city is roused, steady and warm once it is at peace);
  // the lamps of the square burn all the time, and light the stones when the ship is near
  cityLights(dt) {
    const fx = this.fx, cp = this.camera.position, alarm = U.uCityAlarm.value, peace = U.uCityGlow.value > 0.5 ? 1 : 0;
    if (cp.distanceTo(this.city.centre) < 5200) for (const b of this.beacons) {
      const k = peace ? 0.8 : Math.max(0, Math.sin(this.time * (1.3 + 2.6 * alarm) + b.ph)) ** 6;
      if (k > 0.02) fx.glow(b.p, 7 + 5 * k, peace ? [2.4 * k, 1.5 * k, 0.6 * k] : [5 * k, (1.3 - alarm) * k, 0.3 * k], 0.0026);
    }
    const B = this.bell;
    if (B) {
      // the Bell: a faint light at its tip always; once rung, a column of light going up from it and a glow down its length
      const k = B.lit;
      fx.glow(B.top, 5 + 30 * k, [0.5 + 5 * k, 1.1 + 11 * k, 1.0 + 9.5 * k], 0.002 + 0.004 * k);
      if (k > 0.03) {
        fx.bolt(_v.copy(B.top).setY(B.top.y + 700), UP, 1400, 5 + 9 * k, [0.9 * k, 2.2 * k, 1.9 * k]);
        fx.bolt(_v.copy(B.top).setY(B.top.y + 300), UP, 600, 1.6, [3 * k, 7 * k, 6 * k]);
        if (!this.bellLight) this.bellLight = fx.light(B.base, [0, 0, 0], 260, Infinity);
        this.bellLight.p.copy(B.base).setY(B.base.y + 40); this.bellLight.col = [5 * k, 12 * k, 10.5 * k];
        if (!fx.lights.includes(this.bellLight)) fx.lights.push(this.bellLight);
      } else if (this.bellLight) { this.bellLight.life = 0; this.bellLight = null; }
    }
    const night = this.night || 0, near = this.ship.pos.distanceTo(this.sites.dock.pos) < 600;
    for (const l of this.lamps) {
      if (cp.distanceTo(l.p) < 1400) fx.glow(l.p, 5, [2.6, 1.6, 0.6], 0.0016);
      if (near) {
        if (!l.light) l.light = fx.light(l.p, [0, 0, 0], 120, Infinity);
        const L = 5 + 9 * night; l.light.col = [L, L * 0.62, L * 0.26];
        if (!fx.lights.includes(l.light)) fx.lights.push(l.light);
      } else if (l.light) { l.light.life = 0; l.light = null; }
    }
  }
  // exhaust, drive flame, hull smoke
  shipFx(dt) {
    const s = this.ship, fx = this.fx;
    if (dt <= 0 || !s.root.visible) return;
    const live = s.speed / 86;
    for (const sx of [-1, 1]) {
      s.local(sx * 3.8, 4.1, -10.6, _v);
      fx.glow(_v, 1.2 + 2.2 * s.boost, [2.2 + 5 * s.boost, 1.0 + 2.2 * s.boost, 0.4 + 0.5 * s.boost]);
      if (s.boost > 0.2 && Math.random() < dt * 60 * s.boost) { _w.copy(s.vel).multiplyScalar(0.25).addScaledVector(s.fwd, -22); _w.x += rnd(3); _w.y += rnd(3); _w.z += rnd(3); fx.spawn(0, _v, _w, 0.35, 2.2, 0.6, [5, 2.2, 0.6], 0.9, 1.5, 0); }
      if (Math.random() < dt * (5 + 14 * live)) { _w.copy(s.vel).multiplyScalar(0.3); _w.y += 1.5; fx.spawn(1, _v, _w, 2.2, 1.6, 7, [0.85, 0.85, 0.9], 0.13, 0.6, -0.5); }
    }
    if (s.lamp > 0.3) for (const [x, y, z] of [[4.2, 6.2, 9.5], [-4.2, 6.2, 9.5], [0, 9.5, -15.5]]) fx.glow(s.local(x, y, z, _v), 1.5, [1.8 * s.lamp, 1.0 * s.lamp, 0.35 * s.lamp], 0.0012);
    const hull = s.hull / s.maxHull;
    if (hull < 0.5 && Math.random() < dt * (4 + 26 * (0.5 - hull))) { s.local(rnd(4), 4 + rnd(3), rnd(11), _v); _w.copy(s.vel).multiplyScalar(0.3); _w.y += 3; fx.smoke(_v, _w, 7, 2.6, 0.05, 0.6); if (hull < 0.25 && Math.random() < 0.3) fx.spawn(0, _v, _w, 0.4, 3, 6, [5, 2, 0.5], 0.9); }
    if (this.shipLight === undefined) this.shipLight = fx.light(s.pos, [0, 0, 0], 70, Infinity);
    this.shipLight.p.copy(s.pos); this.shipLight.p.y += 6; const L = s.lamp * 5 + s.boost * 6; this.shipLight.col = [L, L * 0.6, L * 0.25];
    if (!fx.lights.includes(this.shipLight)) fx.lights.push(this.shipLight);
  }
  lightning(dt) {
    const B = this.bolt, storm = this.weather.here.rain;
    U.uBolt.value = Math.max(0, U.uBolt.value - dt * 3.5);
    if (storm < 0.25 || dt <= 0) { B.life = 0; return; }
    B.next -= dt;
    if (B.next <= 0) {
      B.next = 2.5 + Math.random() * 5; B.life = 0.28; B.flick = 0;
      const cam = this.camera, f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; f.normalize();
      const dist = 350 + Math.random() * 900, a = rnd(0.9);
      const x = cam.position.x + (f.x * Math.cos(a) - f.z * Math.sin(a)) * dist, z = cam.position.z + (f.x * Math.sin(a) + f.z * Math.cos(a)) * dist;
      B.pts = []; let px = x + rnd(120), pz = z + rnd(120);
      for (let y = 560; y > 10; y -= 26 + Math.random() * 22) { px += rnd(26); pz += rnd(26); B.pts.push(new THREE.Vector3(px, y, pz)); }
      this.audio.thunder(Math.min(1, dist / 1300));
      this.fx.light(B.pts[Math.floor(B.pts.length / 2)], [60, 75, 110], 900, 0.3);
    }
    if (B.life > 0) {
      B.life -= dt; B.flick += dt;
      const on = Math.sin(B.flick * 70) > -0.3 ? 1 : 0.25;
      U.uBolt.value = Math.max(U.uBolt.value, on * (B.life / 0.28) * 0.9);
      for (let i = 0; i < B.pts.length - 1; i++) { const a = B.pts[i], b = B.pts[i + 1]; _w.copy(b).sub(a); const len = _w.length(); _x.copy(a).add(b).multiplyScalar(0.5); this.fx.bolt(_x, _w.normalize(), len * 1.25, 1.6, [5 * on, 6 * on, 9 * on]); }
    }
  }
  // grade: each chapter has its own cast, pulled toward the city's rust and teal when among the towers
  grade(fu) {
    const lift = fu.uLift.value, gain = fu.uGain.value, cp = this.camera.position;
    const cityK = Math.max(0, 1 - Math.max(0, Math.hypot(cp.x - this.city.centre.x, cp.z - this.city.centre.z) - 500) / 1200);
    const storm = this.weather.here.rain;
    lift.set(0.004 + 0.012 * cityK, 0.008 - 0.004 * cityK + 0.006 * storm, 0.016 + 0.006 * storm);
    gain.set(1.0 + 0.04 * cityK - 0.05 * storm, 1.0 - 0.01 * cityK, 0.97 - 0.05 * cityK + 0.06 * storm);
  }
}
const _q = new THREE.Quaternion();
