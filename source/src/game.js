// Game state: flight loop, lens study, field journal, convergence event, rescue, hints.
import * as THREE from 'three';
import { U } from './glsl.js';
import { SPECIES } from './creatures.js';
import { LETTERS, PAGES, letterById } from './story.js';
import { DEFAULT_KEYS, keyName } from './input.js';
import { Audio } from './audio.js';
import { Debris } from './debris.js';
import { DayCycle } from './cycle.js';
import { apertureFor } from './post.js';
import { GOLDEN, BENCH } from './golden.js';
import { PhotoMode } from './photo.js';
import { Weather, FRONTS } from './weather.js';
import { CONVERGENCES, convergenceReady, convergenceFor } from './convergence.js';
import { Guide } from './guide.js';

const STORE_KEY = 'driftlands-journal-v1';
// what a creature is doing when it is doing nothing in particular: a plate needs more than this for its third star
const IDLE_TAGS = new Set(['rest', 'walk', 'open', 'flock', 'crawl', 'drift', 'circle']);
const SETTINGS_KEY = 'driftlands-settings-v1';
const TAG_TEXT = {
  walk: 'walking on stilt legs', graze: 'lowering its neck to graze', alert: 'raising its head to watch the glider', rest: 'standing still',
  open: 'crown open, core glowing', closing: 'snapping its petals shut as the glider passed',
  flock: 'circling the island with the flock', escort: 'flying in formation beside the glider',
  crawl: 'crawling over bare rock', arch: 'crawling along the top of an arch', inverted: 'clinging upside down beneath the rock',
  drift: 'pulsing slowly upward', flare: 'flaring bright and darting away',
  circle: 'circling high above the island', close: 'passing very close', song: 'singing, its flank lights pulsing in time',
  seam: 'stepping across the seam between the two islands',
  sleep: 'sleeping on its feet, head lowered to the turf',
  'polyp:nightglow': 'open at night, glowing from the core', 'kite:nightglow': 'flying after dark with a glowing ribbon',
  'crawler:nightglow': 'spots glowing as it crawls in the dark', nightrise: 'rising high in a glowing swarm at night',
  nightsong: 'singing at night, flank lights blazing',
  gate: 'threading the stone ring', spire: 'climbing a glass spire', root: 'coiled around a hanging root',
  wade: 'wading through the lake shallows',
  'swift:flock': 'racing laps through the stone ring', 'swift:nightglow': 'tracing the ring after dark, ribbon glowing',
  'ray:circle': 'gliding wide loops around the gate', 'ray:song': 'humming, flank lights pulsing', 'ray:close': 'banking past within a wingspan',
  'glassworm:crawl': 'sliding over the crystal', 'glassworm:nightglow': 'lit from inside like a lamp in glass',
  'moth:flock': 'drifting in a loose cloud between the spires', 'moth:nightglow': 'glowing faintly as it wanders the spires',
  'strider:graze': 'licking minerals from the warm ash', 'strider:walk': 'picking its way across the cinders', 'strider:alert': 'freezing, antennae raised toward the glider',
  'cinderbell:drift': 'riding the warm air above the crater', 'cinderbell:flare': 'flashing like a spark and dropping away', 'cinderbell:nightrise': 'rising out of the crater like embers',
  'wader:graze': 'probing the shallows with its bill', 'wader:walk': 'stepping carefully along the shore', 'wader:alert': 'craning its neck at the glider',
  'lily:open': 'floating open on the still water', 'lily:closing': 'folding shut and dipping under', 'lily:nightglow': 'glowing on the dark lake',
  'veil:open': 'hanging open beneath the roots', 'veil:closing': 'drawing up its fringe as the glider passed', 'veil:nightglow': 'glowing like a lantern under the island',
  'kiln:seam': 'stepping across the seam where fire met glass', 'kiln:rain': 'steaming in the rain as drops hit its warm back',
  'bell:open': 'hanging open where the lake drips through the roots', 'bell:closing': 'snapping shut and spilling water as the glider passed',
  'bell:nightglow': 'glowing under the seam at night', 'bell:rain': 'filling with rain until it overflows',
  'rootwing:seam': 'weaving between the hanging roots beneath the seam', 'rootwing:gust': 'tumbling and recovering on the crosswind',
  'rootwing:nightglow': 'circling under the seam with a glowing ribbon',
  rain: 'out in the rain', fogcall: 'calling through the fog', gust: 'riding the crosswind',
  'stilt:rain': 'shaking rain off its back', 'polyp:rain': 'crown cupped open to catch the rain', 'kite:gust': 'hanging motionless on the crosswind',
  'lantern:fogcall': 'glowing through the fog like a lamp', 'whale:fogcall': 'calling long and low through the fog', 'swift:gust': 'racing the crosswind through the ring',
  'ray:fogcall': 'calling to the others through the fog', 'glassworm:rain': 'rain beading down its glass back', 'moth:fogcall': 'gathering thickly in the fog',
  'strider:gust': 'bracing against the wind, legs splayed', 'cinderbell:rain': 'hissing as the rain hits its glow', 'wader:rain': 'standing hunched in the rain',
  'lily:rain': 'drinking the rain, petals cupped', 'veil:gust': 'streaming sideways in the wind',
  'rootworm:crawl': 'winding down a hanging root', 'rootworm:nightglow': 'spots glowing among the dark roots',
};
export const tagText = (id, t) => TAG_TEXT[id + ':' + t] || TAG_TEXT[t] || t;

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export class Game {
  constructor(o) {
    Object.assign(this, o);
    this.audio = new Audio();
    this.audio.setListener(this.camera);
    this.debris = new Debris(this.scene);
    this.quality = { dprScale: 1, level: 2, lastChange: 0 };
    this.settings = Object.assign({ invert: false, style: 'ink', sound: true, quality: 'auto', time: 'cycle', fov: 'normal', shake: true, motion: 'full', text: 'normal', keys: {} }, load(SETTINGS_KEY, {}));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && !load(SETTINGS_KEY, {}).motion) this.settings.motion = 'reduced';
    this.cycle = new DayCycle();
    this.cycle.setMode(this.settings.time);
    this.night = this.cycle.night;
    this.input.invert = this.settings.invert;
    this.applyStyle(); this.applyComfort();
    this.j = this.freshJournal();
    const saved = load(STORE_KEY, null);
    if (saved && saved.recorded) this.j = Object.assign(this.freshJournal(), saved);
    if (this.j.converged) { this.j.conv = Object.assign({ ochre: true }, this.j.conv); delete this.j.converged; }   // journals saved before v12
    this.state = 'loading';
    this.time = 0; this.realTime = 0;
    this.timeScale = 1;
    this.events = [];
    this.fade = 0; this.rescueT = -1;
    this.lens = 0;
    this.target = null; this.capture = null;
    this.hints = new Set(load('driftlands-hints-v1', []));
    this.hintQueue = [];
    this.frameAvg = 16; this.slowT = 0; this.fastT = 0;
    this.titleAng = 0;
    this.lastHud = 0;
    this.notified = new Set();
    this.timers = [];
    this.computeConvergences();
    for (const cv of this.convs) if (this.j.conv[cv.key]) this.applyConverged(cv);
    this.applyQuality(this.settings.quality === 'low' ? 0 : this.settings.quality === 'high' ? 3 : 2);
    this.photo = new PhotoMode(this);
    this.weather = new Weather();
    this.weather.onArrive = (type, text) => { if (this.state === 'play') { this.ui.toast(text); this.audio.whoosh && this.audio.whoosh(); } };
    this._sunBase = U.uSunColor.value.clone(); this._sunOut = new THREE.Vector3(-1, -1, -1);
    this.guide = new Guide(this);
    this.syncLandmarks(true);
  }
  onGuideDone() { if (!this.weather.front) this.weather.calm = Math.min(this.weather.calm, 45); }

  freshJournal() {
    return { recorded: {}, progress: {}, tags: {}, notes: {}, conv: {}, letters: {}, read: {}, ended: false, started: false, flightTime: 0 };
  }
  persist() { save(STORE_KEY, this.j); }

  computeConvergences() {
    const isl = (k) => this.world.islands.find((I) => I.spec.key === k);
    this.convs = CONVERGENCES.map((c) => {
      const I0 = isl(c.a), I1 = isl(c.b);
      const dir = new THREE.Vector3().subVectors(I1.basePos, I0.basePos).setY(0).normalize();
      const final = I0.basePos.clone().addScaledVector(dir, I0.spec.radius + I1.spec.radius - 10);
      final.y = I0.basePos.y + 3;
      return { ...c, I0, I1, dir, final: final.sub(I1.basePos), seamLocal: dir.clone().multiplyScalar(I0.spec.radius - 22), phase: 'none', t: 0, quake: 0 };
    });
  }
  applyConverged(cv) {
    cv.phase = 'done'; cv.quake = 0;
    cv.I1.offset.copy(cv.final);
    cv.I1.update(0);
    this.world.thermals.update();
    this.eco.spawnHybrid(cv.hybrid, cv.I0, cv.I1, cv.seamLocal);
  }
  convergedCount() { return this.convs.filter((c) => c.phase === 'done').length; }
  // start the next convergence whose islands are ready; one at a time
  checkConvergences(delay = 8) {
    if (this.convs.some((c) => c.phase === 'drifting' || c.phase === 'queued' || c.quake > 0)) return;
    const cv = this.convs.find((c) => c.phase === 'none' && convergenceReady(c, this.world.islands, this.j.recorded));
    if (!cv) return;
    cv.phase = 'queued';
    this.after(delay, () => this.beginConvergence(cv));
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.state = 'title';
    const I0 = this.world.islands[0];
    this.glider.place(new THREE.Vector3(I0.pos.x + 120, I0.pos.y + 70, I0.pos.z - 60), -2.2);
    this.chase.snap(this.glider);
    this.ui.ready(this);
    this.ui.updateJournalBadge(this.j);
    this.last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) try { hot.snapshot(() => ({ journal: this.j })); } catch { /* optional */ }
  }

  begin() {
    // called from the title screen's start button (a user gesture → audio may start)
    this.audio.start(this.settings.sound);
    this.state = 'play';
    this.j.started = true;
    this.persist();
    this.ui.showHUD(true);
    this.glider.speed = 26;
    const I0 = this.world.islands[0];
    this.glider.yaw = Math.atan2(I0.pos.x - this.glider.pos.x, I0.pos.z - this.glider.pos.z);
    this.glider.roll = 0;
    if (!this.guide.active) { this.hint('steer'); this.after(14, () => this.hint('thermal')); }
    this.checkConvergences(12);
    this.after(this.guide.active ? 40 : 9, () => this.checkStory());
  }
  newJournal() {
    this.j = this.freshJournal();
    this.persist();
    for (const cv of this.convs) { cv.I0.offset.set(0, 0, 0); cv.I1.offset.set(0, 0, 0); cv.phase = 'none'; cv.t = 0; cv.quake = 0; }
    this.eco.removeHybrids();
    this.guide.reset(); this.ui.goal(null);
    this.timers = [];
    this.syncLandmarks(true);
    this.ui.updateJournalBadge(this.j);
  }

  // render style: 'ink' = the drawn plate look (banded light, pen hatching, ink line), 'painted' = the softer v13 look
  applyStyle() {
    const ink = this.settings.style !== 'painted';
    U.uStyle.value = ink ? 1 : 0;
    this.pipe.ink = ink ? 1 : 0.55;
  }
  // comfort settings: field of view, camera shake, reduced motion, text size, key bindings
  applyComfort() {
    const st = this.settings, reduced = st.motion === 'reduced';
    this.chase.fovBias = st.fov === 'narrow' ? -8 : st.fov === 'wide' ? 10 : 0;
    this.chase.shakeScale = st.shake && !reduced ? 1 : 0;
    this.chase.speedFov = reduced ? 0.25 : 1;
    this.reducedMotion = reduced;
    document.getElementById('dl-root').classList.toggle('big-text', st.text === 'large');
    Object.assign(this.input.bind, DEFAULT_KEYS, st.keys || {});
  }
  rebind(action, key) {
    const err = this.input.setKey(action, key);
    if (err) return err;
    this.settings.keys = { ...this.input.bind }; save(SETTINGS_KEY, this.settings);
    return null;
  }
  resetKeys() { this.settings.keys = {}; Object.assign(this.input.bind, DEFAULT_KEYS); save(SETTINGS_KEY, this.settings); }
  key(action) { return keyName(this.input.bind[action]); }

  // ---------------------------------------------------------------- story: letters, listening posts, the Chord
  islandDone(idx) { const sp = SPECIES.filter((s) => s.island === idx); return sp.length > 0 && sp.every((s) => this.j.recorded[s.id]); }
  syncLandmarks(instant = false) {
    const L = this.landmarks; if (!L) return;
    for (const p of L.posts) { p.target = this.islandDone(p.idx) ? 1 : 0; if (instant) p.active = p.target; }
    for (const pg of PAGES) L.setFound(pg.camp, !!this.j.letters[pg.id]);
    L.chordTarget = this.j.ended ? 0.3 : 0; if (instant) L.chord = L.chordTarget;
  }
  unreadLetters() { return LETTERS.filter((l) => this.j.letters[l.id] && !this.j.read[l.id]).length; }
  deliver(id, quiet = false) {
    if (this.j.letters[id]) return false;
    this.j.letters[id] = { at: Date.now(), flight: Math.round(this.j.flightTime) };
    this.persist();
    this.ui.updateJournalBadge(this.j);
    if (!quiet) { this.audio.page(); this.ui.toast(`A letter from the Institute. ${this.input.mode === 'pad' ? 'Press Y' : this.input.mode === 'touch' ? 'Tap the journal' : 'Press ' + this.key('journal')} to read it.`); }
    return true;
  }
  // letters from the Institute arrive when their condition is met (the last one arrives with the ending)
  checkStory() {
    for (const l of LETTERS) if (l.kind === 'letter' && l.id !== 'chord' && !this.j.letters[l.id] && l.when(this.j)) { this.deliver(l.id); return; }
  }
  updateCamps() {
    const L = this.landmarks; if (!L) return;
    const g = this.glider.pos;
    for (const c of L.camps) {
      if (c.found) continue;
      const d = g.distanceTo(c.world);
      if (d < 150 && !this.guide.active) this.hint('cairn');
      if (d < 24) {
        const pg = PAGES.find((x) => x.camp === c.key);
        if (!pg || this.j.letters[pg.id]) continue;
        this.j.letters[pg.id] = { at: Date.now(), flight: Math.round(this.j.flightTime) };
        this.persist(); L.setFound(c.key, true);
        this.audio.page(); this.audio.discover();
        this.input.rumble(0.1, 0.4, 200);
        this.ui.found(pg, this.key('journal'));
        this.ui.updateJournalBadge(this.j);
      }
    }
  }
  // every post sings at once: beams, a held chord, then the closing letter and the credits
  beginChord() {
    if (this.j.ended || this.chordOn || this.state !== 'play') { if (this.state !== 'play' && !this.j.ended) this.after(3, () => this.beginChord()); return; }
    this.chordOn = true;
    this.landmarks && (this.landmarks.chordTarget = 1);
    this.audio.chord && this.audio.chord();
    const fu = this.pipe.finalMat.uniforms; fu.uFlash.value = this.reducedMotion ? 0.08 : 0.3; fu.uFlashColor.value.set(0.6, 1, 0.88);
    this.input.rumble(0.4, 0.8, 1200);
    this.ui.event('The Chord', 'Every listening post is singing at once. Hold your course and look around.', 'Survey complete', 11000);
    this.after(13, () => this.startEnding());
  }
  startEnding(replay = false) {
    if (this.state === 'journal') this.openJournal(false);
    if (this.state === 'paused') this.pause(false);
    if (this.state === 'photo') this.photo.exit();
    this.state = 'ending'; this.endT = 0; this.endReplay = replay;
    this.landmarks && (this.landmarks.chordTarget = 1);
    this.weather.hold();
    this.ui.showHUD(false);
    this.deliver('chord', true); this.j.read.chord = true;
    this.j.ended = true; this.persist();
    this.ui.showEnding(letterById('chord'));
  }
  finishEnding() {
    if (this.state !== 'ending') return;
    this.chordOn = false;
    this.state = 'play';
    this.landmarks && (this.landmarks.chordTarget = 0.3);
    const I0 = this.world.islands[0];
    const p = new THREE.Vector3(I0.pos.x + 150, I0.pos.y + 95, I0.pos.z - 70);
    this.glider.place(p, Math.atan2(I0.pos.x - p.x, I0.pos.z - p.z)); this.glider.speed = 26;
    this.chase.snap(this.glider);
    this.ui.showHUD(true);
    this.ui.updateJournalBadge(this.j);
    if (!this.endReplay) this.after(4, () => this.ui.toast('The survey is complete. The air is still warm: fly on for as long as you like.'));
  }
  endingFrame(dt) {
    this.endT += dt;
    // the glider circles its home thermal while the camera takes a long, slow arc around the whole archipelago
    this.circleGlider(dt);
    let cx = 0, cy = 0, cz = 0; const n = this.world.islands.length;
    for (const I of this.world.islands) { cx += I.pos.x / n; cy += I.pos.y / n; cz += I.pos.z / n; }
    const a = 2.4 + this.endT * 0.022, r = 1380 - Math.min(380, this.endT * 5), h = 400 + Math.sin(this.endT * 0.05) * 40;
    const cam = this.camera;
    cam.position.set(cx + Math.cos(a) * r, h, cz + Math.sin(a) * r);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, cy + 150, cz);
    cam.fov = 48; cam.updateProjectionMatrix();
    this.chase.pos.copy(cam.position);
  }

  setSetting(k, v) {
    if (k === 'time') this.cycle.setMode(v);
    this.settings[k] = v; save(SETTINGS_KEY, this.settings);
    if (k === 'invert') this.input.invert = v;
    if (k === 'style') this.applyStyle();
    if (k === 'fov' || k === 'shake' || k === 'motion' || k === 'text') this.applyComfort();
    if (k === 'sound') this.audio.setEnabled(v);
    if (k === 'quality') { this.quality.lastChange = 0; this.applyQuality(v === 'low' ? 0 : v === 'high' ? 3 : 2); }
  }
  // glider downwash for the grass: the live position plus three fading points left behind it
  updateWake(dt) {
    const P = U.uPush.value, g = this.debugPush ? { pos: new THREE.Vector3(...this.debugPush), speed: 15 } : this.glider;
    const str = g.perched ? 0.5 : Math.min(1, g.speed / 14);
    this.wakeT = (this.wakeT || 0) + dt;
    if (this.wakeT > 0.18) {
      this.wakeT = 0;
      for (let i = 3; i > 1; i--) P[i].copy(P[i - 1]);
      P[1].set(g.pos.x, g.pos.y, g.pos.z, str);
    }
    for (let i = 1; i < 4; i++) P[i].w *= Math.exp(-dt * 2.2);
    P[0].set(g.pos.x, g.pos.y, g.pos.z, str);
  }
  applyQuality(level) {
    level = Math.max(0, Math.min(3, level));
    this.quality.level = level;
    const presets = [
      { scale: 0.55, steps: 24, cloud: 0.36, ao: 0, shadow: 0 },
      { scale: 0.72, steps: 32, cloud: 0.42, ao: 0.6, shadow: 1024 },
      { scale: 0.86, steps: 40, cloud: 0.5, ao: 0.75, shadow: 2048 },
      { scale: 1.0, steps: 52, cloud: 0.5, ao: 0.75, shadow: 2048 },
    ];
    const p = presets[level];
    this.pipe.scale = p.scale; this.pipe.steps = p.steps; this.pipe.cloudScale = p.cloud; this.pipe.ao = p.ao; this.pipe.contact = level > 0 ? 1 : 0;
    this.pipe.cloudMat.uniforms.uShaftSteps.value = level >= 3 ? 20 : 12;
    if (this.motes) this.motes.setDensity([0.35, 0.6, 1, 1][level]);
    if (this.mirror) { this.mirror.enabled = level >= 1; this.mirror.scale = [0.3, 0.3, 0.4, 0.5][level]; }
    for (const isl of this.world.islands) isl.groundDensity = [0.45, 0.7, 1, 1][level];
    if (this.shadow) { this.shadow.enabled = p.shadow > 0; if (p.shadow) this.shadow.setSize(p.shadow); }
    this.resize && this.resize();
  }

  pause(on) {
    if (this.state === 'title' || this.state === 'loading') return;
    if (on && this.state === 'play') { this.state = 'paused'; this.ui.showPause(true); this.audio.duck(true); }
    else if (!on && this.state === 'paused') { this.state = 'play'; this.ui.showPause(false); this.audio.duck(false); }
  }
  openJournal(on) {
    if (this.state === 'title' || this.state === 'loading') return;
    if (on) { this.prevState = this.state === 'journal' ? 'play' : this.state; this.state = 'journal'; this.ui.openJournal(this.j, SPECIES, tagText); this.audio.duck(true); this.audio.page(); }
    else if (this.state === 'journal') { this.state = 'play'; this.ui.closeJournal(); this.audio.duck(false); }
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  // ---------------------------------------------------------------- gamepad menus
  padNav(pe) {
    if (!pe) return;
    const st = this.state;
    if (st === 'title') { if (pe.a || pe.start) this.ui.startGame(); return; }
    if (st === 'play') {
      if (pe.start) this.pause(true);
      else if (pe.y || pe.back) this.openJournal(true);
      else if (pe.x) this.photo.enter();
    } else if (st === 'paused') {
      if (pe.start || pe.b || pe.a) this.pause(false);
    } else if (st === 'journal') {
      if (pe.y || pe.b || pe.back || pe.start) this.openJournal(false);
      else if (pe.up || pe.down) this.ui.step(pe.down ? 1 : -1);
      else if (pe.left || pe.right) this.ui.setTab(this.ui.jtab === 'plates' ? 'letters' : 'plates');
    } else if (st === 'ending') {
      if (pe.a || pe.start) this.ui.endingAdvance(false); else if (pe.b) this.ui.endingAdvance(true);
    } else if (st === 'photo') {
      if (pe.b || pe.start) this.photo.exit();
      else if (pe.a) this.photo.save();
      else if (pe.y) this.photo.cycleGrade && this.photo.cycleGrade();
    }
  }

  // ---------------------------------------------------------------- hints
  hint(id) {
    if (this.hints.has(id)) return;
    this.hints.add(id);
    save('driftlands-hints-v1', [...this.hints]);
    const mode = this.input.mode;
    const T = {
      steer: mode === 'pad' ? 'The left stick steers. Push it down to dive and gain speed, up to climb.' : mode === 'touch' ? 'Drag anywhere to steer. Drag down to dive and gain speed, up to climb.' : mode === 'keys' ? `${this.key('left')} and ${this.key('right')} bank, ${this.key('up')} climbs, ${this.key('down')} dives. Dive to gain speed, climb to trade it for height.` : 'Move the mouse to steer. Point below the centre to dive and gain speed, above it to climb.',
      thermal: 'Rising spores mark warm air. Circle inside a column to climb.',
      lens: mode === 'pad' ? 'Hold LT to raise your lens. Keep a creature inside the circle; the right stick aims it.' : mode === 'touch' ? 'Hold the lens button to study a creature. Keep it inside the circle.' : `Hold the right mouse button or ${this.key('lens')} to raise your lens. Keep a creature inside the circle to study it.`,
      lensuse: mode === 'pad' ? 'Time slows while the lens is up. Aim with the right stick, press A or RT for a photo.' : 'Time slows while the lens is up. Move the mouse to look around.',
      journal: mode === 'pad' ? 'Press Y to open your field journal.' : mode === 'touch' ? 'Tap the journal to read your notes.' : `Press ${this.key('journal')} to open your field journal.`,
      land: mode === 'pad' ? 'You landed. Press A to launch again.' : mode === 'touch' ? 'You landed. Tap to launch again.' : `You landed. Click or press ${this.key('up')} to launch again.`,
      stall: 'Too slow. Let the nose drop to pick up speed.',
      ridge: 'Wind hitting a cliff is pushed upward. Fly along the windward face of an island to climb without a thermal.',
      cairn: 'Something pale is fluttering beside the listening post. Fly close to pick it up.',
      night: 'At night some species sleep, glow or swarm. Open the journal to see which behaviours you still need.',
    };
    if (T[id]) this.ui.hint(T[id]);
  }

  // ---------------------------------------------------------------- debug: golden views and benchmark
  goldenView(i) {
    const v = typeof i === 'number' ? GOLDEN[i] : GOLDEN.find((g) => g.name === i);
    if (!v) return GOLDEN.map((g) => g.name);
    this.cycle.mode = 'hold'; this.cycle.t = v.time; this.cycle.apply();
    this.weather.hold();
    if (v.weather) { const w = v.weather; this.weather.start(w.type, w.s, w.angle); this.weather.front.age = 10; this.weather.update(0, new THREE.Vector3(...v.p), null); this.weather.wetLens = Math.max(this.weather.here.rain, this.weather.here.fog * 0.45); }
    if (v.creature) {
      const c = this.eco.bySpecies[v.creature][0];
      this.sim(0.2);
      const p = c.pos, y = (c.bodyY ?? c.pos.y) + 4;
      this.debugCam = { p: [p.x + v.off[0], y + v.off[1], p.z + v.off[2]], t: [p.x, y, p.z], fov: v.fov };
    } else this.debugCam = { p: v.p, t: v.t, fov: v.fov };
    this.sim(0.1);
    this.pipe.adaptReset = true;
    return v.name;
  }
  // scripted flight through BENCH at a fixed speed; logs frame-time stats to the console when done
  bench(speed = 45) {
    const pts = BENCH.map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const len = curve.getLength();
    this.cycle.mode = 'hold'; this.cycle.t = 120; this.cycle.apply();
    this.weather.hold();
    this.benchState = { curve, len, t0: performance.now(), d: 0, speed, times: [] };
    this.debugCam = { p: [0, 0, 0], t: [0, 0, 0], fov: 62 };
  }
  benchStep(dt) {
    const B = this.benchState;
    B.d += dt * B.speed; B.times.push(dt * 1000);
    const u = (B.d / B.len) % 1, p = B.curve.getPointAt(u), q = B.curve.getPointAt((u + 0.01) % 1);
    this.debugCam.p = [p.x, p.y, p.z]; this.debugCam.t = [q.x, q.y - 4, q.z];
    if (B.d >= B.len) {
      const s = B.times.slice(5).sort((a, b) => a - b);
      const avg = s.reduce((a, b) => a + b, 0) / s.length, p99 = s[Math.floor(s.length * 0.99)];
      const res = { frames: s.length, avgMs: +avg.toFixed(2), p99Ms: +p99.toFixed(2), fps: +(1000 / avg).toFixed(1), quality: this.quality.level, gpu: this.pipe.timer ? this.pipe.timer.summary() : null };
      console.log('BENCH', JSON.stringify(res));
      this.benchResult = res; this.benchState = null; this.debugCam = null;
      if (this.suite) this.suiteNext(res);
    }
  }
  // B key: fly the benchmark once per configuration, each new effect switched off in turn, and show the table
  benchSuite() {
    if (this.suite) return;
    const p = this.pipe, cu = p.cloudMat.uniforms;
    const saved = { cycle: this.cycle.mode, high: p.highClouds, shaft: cu.uShaft.value, mirror: this.mirror && this.mirror.enabled, motes: this.motes && this.motes.points.visible, shadow: this.shadow && this.shadow.enabled };
    const reset = () => { p.highClouds = saved.high; cu.uShaft.value = saved.shaft; if (this.mirror) this.mirror.enabled = saved.mirror; if (this.motes) this.motes.points.visible = saved.motes; if (this.shadow) this.shadow.enabled = saved.shadow; };
    this.suite = { reset, saved, i: -1, rows: [], configs: [
      ['everything on', () => {}],
      ['no high clouds', () => { p.highClouds = false; }],
      ['no light shafts', () => { cu.uShaft.value = 0; }],
      ['no reflection', () => { if (this.mirror) this.mirror.enabled = false; }],
      ['no particles', () => { if (this.motes) this.motes.points.visible = false; }],
      ['no sun shadows', () => { if (this.shadow) this.shadow.enabled = false; }],
    ] };
    if (this.perf) this.perf.toggle(true);
    this.suiteNext(null);
  }
  suiteNext(res) {
    const S = this.suite;
    if (res) S.rows.push([S.configs[S.i][0], res.fps, res.p99Ms]);
    S.reset();
    S.i++;
    if (S.i >= S.configs.length) {
      const base = S.rows[0][1];
      const lines = ['benchmark (quality ' + this.quality.level + ')', ...S.rows.map(([n, f, p]) => `  ${n.padEnd(16)} ${f.toFixed(1).padStart(5)} fps  ${n === 'everything on' ? '      ' : ((f - base >= 0 ? '+' : '') + (f - base).toFixed(1)).padStart(6)}  1% low ${(1000 / p).toFixed(0)} fps`)];
      this.suiteText = lines.join('\n');
      console.log(this.suiteText);
      this.suite = null; this.cycle.mode = S.saved.cycle;
      return;
    }
    S.configs[S.i][1]();
    this.suiteText = `benchmark ${S.i + 1}/${S.configs.length}: ${S.configs[S.i][0]}...`;
    this.bench(160);
  }

  // ---------------------------------------------------------------- per frame
  sim(seconds, step = 0.033) { for (let t = 0; t < seconds; t += step) this.frame(step, false); }

  frame(dtReal, render = true) {
    this.realTime += dtReal;
    if (this.benchState) this.benchStep(dtReal); else this.adaptQuality(dtReal);
    const playing = this.state === 'play';
    const inp = this.input.read();
    this.padNav(inp.pad);
    if (this.state === 'title' && !this.debugCam) this.titleFrame(dtReal);
    if (this.state === 'ending' && !this.debugCam) this.endingFrame(dtReal);

    // lens
    const lensWanted = playing && inp.lens && this.rescueT < 0;
    this.lens += ((lensWanted ? 1 : 0) - this.lens) * Math.min(1, dtReal * 6);
    this.chase.lens = this.lens;
    const frozen = this.state === 'journal' || this.state === 'paused' || this.state === 'photo';
    const targetScale = frozen ? 0 : 1 - this.lens * 0.62;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dtReal * 5);
    if (frozen) this.timeScale = 0;
    const dt = dtReal * this.timeScale;
    this.time += dt;
    U.uTime.value = this.time;
    if (this.state === 'play' || this.state === 'title' || this.state === 'ending') this.cycle.update(this.state === 'play' ? dt : 0);
    const prevPhase = this.phaseName;
    this.phaseName = this.cycle.phase;
    this.night = this.cycle.night;
    if (prevPhase && prevPhase !== this.phaseName && this.state === 'play') this.onPhase(this.phaseName);
    this.glider.setNight && this.glider.setNight(this.night);

    // flight
    if (playing) {
      let ctl = inp;
      if (this.lens > 0.3 && this.input.mode !== 'keys' && this.input.mode !== 'pad') {
        // the mouse aims the lens: hold the attitude the glider had
        ctl = { ...inp, roll: this.heldRoll ?? inp.roll, pitch: this.heldPitch ?? 0 };
      } else { this.heldRoll = inp.roll; this.heldPitch = inp.pitch; }
      if (this.lens > 0.3) ctl = { ...ctl, launch: false };
      if (this.rescueT >= 0) ctl = { ...ctl, roll: 0, pitch: 0, launch: false };
      this.events.length = 0;
      this.world.gust = this.weather.here.wind; this.world.ridgeK = 1 + 1.2 * this.weather.here.wind;
      const liftBefore = this.glider.thermal || 0;
      this.glider.update(dt, ctl, this.world, this.events);
      this.bumpCd = Math.max(0, (this.bumpCd || 0) - dt);
      if (dt > 0 && this.bumpCd <= 0 && ((this.glider.thermal || 0) - liftBefore) / dt > 4) { this.chase.bump(-0.06); this.bumpCd = 2.5; }   // punching into a thermal
      if ((this.glider.ridge || 0) > 1.3) { this.ridgeT = (this.ridgeT || 0) + dt; if (this.ridgeT > 1.5) this.hint('ridge'); } else this.ridgeT = 0;
      if (!this.glider.perched) this.glider.pos.addScaledVector(this.weather.wind, dt);   // crosswind drift
      this.j.flightTime += dt;
      for (const e of this.events) this.onEvent(e);
      if (this.glider.stall > 0.6) this.hint('stall');
      this.checkRescue(dtReal);
      this.updateCamps();
    } else if (this.state !== 'title') {
      // frozen
    }
    // world
    if (this.timers.length && dt > 0) { for (const tm of this.timers) tm.t -= dt; const due = this.timers.filter((tm) => tm.t <= 0); this.timers = this.timers.filter((tm) => tm.t > 0); due.forEach((tm) => tm.fn()); }
    for (const isl of this.world.islands) isl.update(this.time);
    for (const cv of this.convs) this.updateConvergence(cv, dt);
    this.world.thermals.update();
    this.weather.update(this.state === 'play' || this.state === 'title' || this.debugCam ? dt : 0, this.camera.position, this.world.thermals);
    // overcast under fog and rain: dim the sun (the cycle rewrites uSunColor when it runs; keep its value as the base)
    if (!U.uSunColor.value.equals(this._sunOut)) this._sunBase.copy(U.uSunColor.value);
    this._sunOut.copy(this._sunBase).multiplyScalar(1 - this.weather.overcast());
    U.uSunColor.value.copy(this._sunOut);
    this.audio.wx = this.weather.here;
    this.world.rocks.update(this.time);
    if (this.landmarks) this.landmarks.update(this.time, dtReal);
    // the cloud pass shades and mists only around the islands nearest the camera
    const cp = this.camera.position, uI = this.pipe.cloudMat.uniforms.uIsl.value;
    const near = this.world.islands.slice().sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
    uI.forEach((v, i) => { const I = near[i]; if (I) v.set(I.pos.x, I.pos.y, I.pos.z, I.spec.radius); else v.set(0, -1e5, 0, 1); });
    const ctx = { time: this.time, glider: this.glider, camPos: this.camera.position, camera: this.camera, night: this.night || 0, audio: this.state === 'play' ? this.audio : null, weather: this.weather };
    if (dt > 0) this.eco.update(dt, ctx);
    this.debris.update(dt);
    // camera
    if (this.debugCam) { const dc = this.debugCam, o = dc.rel ? this.glider.pos : { x: 0, y: 0, z: 0 }; this.camera.position.set(dc.p[0] + o.x, dc.p[1] + o.y, dc.p[2] + o.z); this.camera.lookAt(dc.t[0] + o.x, dc.t[1] + o.y, dc.t[2] + o.z); this.camera.fov = this.debugCam.fov || 60; this.camera.updateProjectionMatrix(); }
    else if (this.state === 'photo') this.photo.update(dtReal);
    else if (this.state !== 'title' && this.state !== 'ending') this.chase.update(this.glider, dtReal, inp);
    if (this.glider.impact > 0.2) this.chase.shake = Math.max(this.chase.shake, this.glider.impact * 0.8);
    U.uCamPos.value.copy(this.camera.position);
    this.updateWake(dt);
    this.eco.draw(ctx);

    // lens study
    this.lensSubject = 0;
    if (playing) this.study(dtReal, inp);
    else this.ui.lens(0, null);
    if (this.state !== 'photo') {
      // the lens focuses on the creature being studied, otherwise on whatever is in the middle of the view
      const D = this.pipe.dof;
      D.aperture = this.lens > 0.02 ? this.lens * this.lens * apertureFor(this.camera.fov, 2) : 0;
      D.focusDist = this.lensSubject; D.focusUV.set(0.5, 0.5); D.speed = 6;
    }

    this.guide.update(dtReal);
    // a new pilot's first front waits until the guide is done
    if (this.guide.active && !this.weather.front) this.weather.calm = Math.max(this.weather.calm, 60);

    // post uniforms
    const fu = this.pipe.finalMat.uniforms;
    fu.uLens.value = this.lens;
    fu.uSpeedFx.value = this.reducedMotion || this.state === 'ending' ? 0 : Math.max(0, Math.min(1, (this.glider.speed - 32) / 30)) * (1 - this.lens);
    fu.uFade.value = 1 - this.fade;
    fu.uFlash.value = Math.max(0, fu.uFlash.value - dtReal * 1.5);
    fu.uExposure.value = this.cycle.exposure();
    fu.uAutoAmt.value = 0.55 * (1 - 0.8 * this.night);
    fu.uRain.value = this.weather.here.rain;
    fu.uWet.value = this.state === 'photo' ? 0 : this.weather.wetLens;
    this.grade(fu);
    this.photo.applyGrade(fu);
    

    if (!render) return;
    const focus = this.glider.pos.clone().addScaledVector(this.glider.fwd, 70);
    if (this.debugCam) focus.set(...this.debugCam.t);
    const fr = this._frustum || (this._frustum = new THREE.Frustum()), pm = this._pm || (this._pm = new THREE.Matrix4());
    this.camera.updateMatrixWorld();
    fr.setFromProjectionMatrix(pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const isl of this.world.islands) if (isl.lod) isl.lod(this.camera.position, focus, this.shadow ? this.shadow.extent : 0, fr);
    this.renderer.info.reset();
    if (this.pipe.timer && this.pipe.timer.enabled) this.pipe.timer.begin('shadow');
    if (this.motes) this.motes.update();
    if (this.glow) this.glow.update(this.camera.position, this.world.islands, this.eco, this.night || 0);
    if (this.shadow) this.shadow.render(this.scene, this.camera);
    if (this.mirror && this.pipe.targets) {
      if (this.pipe.timer && this.pipe.timer.enabled) this.pipe.timer.begin('mirror');
      this.mirror.render(this.scene, this.camera, this.pipe.targets.W, this.pipe.targets.H);
    }
    this.pipe.dt = dtReal;
    this.pipe.render(this.scene, this.camera);
    if (this.capture) this.doCapture();
    this.photo.finishSave();
    if (this.perf) this.perf.update(dtReal);

    // audio + HUD
    if (this.state === 'play' || this.state === 'paused' || this.state === 'journal' || this.state === 'photo' || this.state === 'ending') this.audio.update(this.glider, this.world, this.lens, dtReal, this.timeScale, this.night);
    if (this.realTime - this.lastHud > 0.05) { this.lastHud = this.realTime; this.updateHUD(); }
  }

  // per-island grade: lift (shadow tint) and gain (highlight tint), blended by how close the camera is to each island
  grade(fu) {
    const G = [
      { lift: [0.0, 0.012, 0.016], gain: [0.99, 1.02, 0.98] },   // Verdigris: teal shadows, fresh greens
      { lift: [0.016, 0.0, 0.022], gain: [1.03, 0.99, 0.92] },   // Ochre: violet shadows, warm but tamed highlights
      { lift: [0.02, 0.0, 0.014], gain: [1.02, 0.97, 1.0] },     // Coral: rose shadows
      { lift: [0.012, 0.006, 0.018], gain: [1.03, 1.0, 0.95] },  // Windgate: lilac shadows, gold light
      { lift: [0.0, 0.01, 0.022], gain: [0.97, 1.0, 1.04] },     // Glasswing: cool and clear
      { lift: [0.022, 0.004, 0.0], gain: [1.04, 0.97, 0.92] },   // Ember: smoky warmth
      { lift: [0.004, 0.014, 0.01], gain: [0.98, 1.02, 0.99] },  // Mire: damp greens
      { lift: [0.01, 0.012, 0.004], gain: [1.02, 1.01, 0.95] },  // Rootfall: mossy, warm
    ];
    const lift = fu.uLift.value.set(0, 0, 0), gain = fu.uGain.value.set(0, 0, 0);
    let wsum = 0;
    const cam = this.camera.position;
    this.world.islands.forEach((I, i) => {
      const g = G[i] || G[0];
      const d = Math.hypot(cam.x - I.pos.x, cam.z - I.pos.z);
      const w = Math.max(0, 1 - Math.max(0, d - I.spec.radius) / 360);
      lift.x += g.lift[0] * w; lift.y += g.lift[1] * w; lift.z += g.lift[2] * w;
      gain.x += g.gain[0] * w; gain.y += g.gain[1] * w; gain.z += g.gain[2] * w;
      wsum += w;
    });
    const open = Math.max(0, 1 - wsum), total = wsum + open;
    gain.addScalar(open).divideScalar(total);
    lift.divideScalar(total);
  }

  titleFrame(dt) {
    // glider circles a thermal while the camera drifts around it
    const p = this.circleGlider(dt);
    const I0 = this.world.islands[0];
    const camA = this.realTime * 0.035 + 2.2;
    const cam = this.camera;
    cam.position.set(p.x + Math.cos(camA) * 34, p.y + 7, p.z + Math.sin(camA) * 34);
    const look = p.clone().lerp(I0.pos.clone().add(new THREE.Vector3(0, 10, 0)), 0.35);
    cam.lookAt(look);
    cam.fov = 58; cam.updateProjectionMatrix();
    this.chase.pos.copy(cam.position); this.chase.look.copy(look);
  }
  circleGlider(dt) {
    const th = this.world.thermals.list[0];
    this.titleAng += dt * 0.11;
    const a = this.titleAng;
    const p = new THREE.Vector3(th.x + Math.cos(a) * 46, 236 + Math.sin(a * 0.7) * 4, th.z + Math.sin(a) * 46);
    this.glider.pos.copy(p);
    this.glider.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    this.glider.roll = 0.38; this.glider.pitch = 0.02; this.glider.speed = 22;
    this.glider.fwd.set(Math.sin(this.glider.yaw), 0, Math.cos(this.glider.yaw));
    this.glider.vel.copy(this.glider.fwd).multiplyScalar(5);
    this.glider.update(0, { roll: 0.38, pitch: 0, launch: false }, this.world, []);
    this.glider.root.rotation.z = 0.38;
    return p;
  }

  onEvent(e) {
    if (e.type === 'bump') { this.input.rumble(e.strength, e.strength * 0.6, 120 + e.strength * 200); this.audio.bump(e.strength); this.pipe.finalMat.uniforms.uFlash.value = Math.max(this.pipe.finalMat.uniforms.uFlash.value, e.strength * 0.12); this.pipe.finalMat.uniforms.uFlashColor.value.set(1, 0.9, 0.8); }
    if (e.type === 'land') { this.guide.onLand(); this.input.rumble(0.25, 0.4, 140); this.audio.land(); this.hint('land'); this.chase.bump(0.12); }
    if (e.type === 'launch') this.audio.launch();
  }

  checkRescue(dt) {
    const g = this.glider;
    if (this.rescueT < 0 && g.pos.y < 2) { this.rescueT = 0; this.audio.whoosh(); }
    if (this.rescueT >= 0) {
      this.rescueT += dt;
      this.fade = Math.min(1, this.rescueT / 0.9);
      if (this.rescueT > 1.0 && !this.rescued) {
        this.rescued = true;
        // nearest thermal, high up, facing the nearest island
        let best = null, bd = Infinity;
        for (const t of this.world.thermals.list) { const d = (t.x - g.pos.x) ** 2 + (t.z - g.pos.z) ** 2; if (d < bd) { bd = d; best = t; } }
        let isl = this.world.islands[0], id = Infinity;
        for (const I of this.world.islands) { const d = I.pos.distanceToSquared(new THREE.Vector3(best.x, I.pos.y, best.z)); if (d < id) { id = d; isl = I; } }
        const p = new THREE.Vector3(best.x, 250, best.z);
        g.place(p, Math.atan2(isl.pos.x - p.x, isl.pos.z - p.z));
        this.chase.snap(g);
        this.ui.toast('The cloud sea lifted you back into the light.');
      }
      if (this.rescueT > 1.4) this.fade = Math.max(0, 1 - (this.rescueT - 1.4) / 1.0);
      if (this.rescueT > 2.4) { this.rescueT = -1; this.rescued = false; this.fade = 0; }
    }
  }

  // ---------------------------------------------------------------- study
  study(dt, inp) {
    const cam = this.camera;
    const aspect = cam.aspect;
    const v = new THREE.Vector3();
    let best = null, bestR = 1e9, nearUnrecorded = false;
    for (const c of this.eco.list) {
      const d = cam.position.distanceTo(c.center);
      const range = 45 + c.radius * 13;
      if (d > range) continue;
      if (!this.j.recorded[c.sp.id]) nearUnrecorded = true;
      if (this.lens < 0.6) continue;
      v.copy(c.center).project(cam);
      if (v.z > 1) continue;
      const r = Math.hypot(v.x * 0.5 * aspect, v.y * 0.5);
      const angR = Math.min(0.18, (c.radius / d) * 0.9 / Math.tan(cam.fov * Math.PI / 360) * 0.5);
      if (r - angR < 0.3 && r < bestR) { bestR = r; best = { c, d, range, x: v.x, y: v.y }; }
    }
    this.nearUnrecorded = nearUnrecorded;
    if (nearUnrecorded && this.lens < 0.1 && !this.guide.active) this.hint('lens');
    if (this.lens > 0.6) this.hint('lensuse');
    this.shutterCool = Math.max(0, (this.shutterCool || 0) - dt);
    if ((inp.launch || inp.shutter) && this.lens > 0.6 && this.shutterCool <= 0) this.shutter(best);
    if (best) {
      this.lensSubject = best.d;
      const sp = best.c.sp;
      const already = !!this.j.recorded[sp.id];
      if (!already) {
        const rate = (1 / 2.6) * Math.max(0.55, Math.min(1.35, 1.5 - best.d / best.range));
        const prev = this.j.progress[sp.id] || 0;
        this.j.progress[sp.id] = Math.min(1, prev + dt * rate);
        const tags = this.j.tags[sp.id] || (this.j.tags[sp.id] = []);
        if (best.c.tag && !tags.includes(best.c.tag)) tags.push(best.c.tag);
        this.audio.studyTick(this.j.progress[sp.id]);
        if (this.j.progress[sp.id] >= 1) this.record(sp, best);
      } else {
        const tags = this.j.tags[sp.id] || (this.j.tags[sp.id] = []);
        if (best.c.tag && !tags.includes(best.c.tag)) { tags.push(best.c.tag); this.persist(); this.ui.toast(`New behaviour noted: ${sp.common}, ${tagText(sp.id, best.c.tag)}.`); this.audio.studyTick(1); }
      }
      this.ui.lens(this.lens, { name: already ? sp.common : 'Unknown species', latin: already ? sp.latin : null, progress: already ? 1 : this.j.progress[sp.id], dist: best.d, x: best.x, y: best.y, recorded: already });
    } else this.ui.lens(this.lens, null);
  }

  shutter(best) {
    this.shutterCool = 0.7;
    const fu = this.pipe.finalMat.uniforms;
    fu.uFlash.value = 0.5; fu.uFlashColor.value.set(1, 1, 1);
    this.audio.shutter();
    this.ui.shutter();
    if (!best) return;
    const sp = best.c.sp;
    if (this.j.recorded[sp.id]) {
      // a retake replaces the plate only when it grades at least as well as the one in the journal
      const g = this.gradePlate(best), rec = this.j.recorded[sp.id], old = rec.stars || 1;
      if (g.stars >= old) {
        rec.stars = g.stars; rec.grade = g.grade;
        this.capture = { id: sp.id, x: best.x, y: best.y, r: best.c.radius / best.d };
        this.ui.toast(g.stars > old ? `A better plate of the ${sp.common}: ${g.stars} of 3 stars.` : `New field plate for the ${sp.common}.`);
        if (g.stars > old) this.audio.studyTick(1);
        this.persist();
      } else this.ui.toast(`The plate in your journal is better. ${g.grade.framed ? 'Catch it doing something.' : g.grade.small ? 'Get closer.' : g.grade.big ? 'Back off a little.' : 'Bring it to the middle of the lens.'}`);
    } else {
      this.j.progress[sp.id] = Math.min(1, (this.j.progress[sp.id] || 0) + 0.3);
      if (this.j.progress[sp.id] >= 1) this.record(sp, best);
    }
  }

  // one to three stars for a plate: one for the record, one for framing (size and centring), one for behaviour
  gradePlate(best) {
    const cam = this.camera;
    const frac = (best.c.radius / best.d) / Math.tan(cam.fov * Math.PI / 360);   // subject radius over half the frame height
    const off = Math.hypot(best.x * cam.aspect, best.y);
    const small = frac < 0.11, big = frac > 0.95;
    const framed = !small && !big && off < 0.45;
    const behaviour = !!best.c.tag && !IDLE_TAGS.has(best.c.tag);
    return { stars: 1 + (framed ? 1 : 0) + (behaviour ? 1 : 0), grade: { framed, small, big, behaviour } };
  }
  record(sp, best) {
    const g = this.gradePlate(best);
    this.j.recorded[sp.id] = { at: Date.now(), dist: Math.round(best.d), island: sp.island >= 0 ? this.world.islands[sp.island].name : 'the seam', flight: Math.round(this.j.flightTime), stars: g.stars, grade: g.grade };
    this.capture = { id: sp.id, x: best.x, y: best.y, r: best.c.radius / best.d };
    this.persist();
    this.audio.discover();
    this.input.rumble(0.1, 0.5, 220);
    const n = Object.keys(this.j.recorded).length;
    this.ui.recorded(sp, n, SPECIES.length, g.stars);
    this.ui.updateJournalBadge(this.j);
    this.after(3.5, () => this.hint('journal'));
    this.checkConvergences(8);
    this.syncLandmarks();
    if (sp.island >= 0 && this.islandDone(sp.island) && n < SPECIES.length) this.after(5, () => { this.ui.toast(`The listening post on ${this.world.islands[sp.island].name} has begun to sing.`); this.audio.postWake && this.audio.postWake(); });
    this.after(16, () => this.checkStory());
    if (n === SPECIES.length) this.after(7, () => this.beginChord());
  }

  doCapture() {
    const c = this.capture; this.capture = null;
    const src = this.renderer.domElement;
    const W = src.width, H = src.height;
    const cx = (c.x * 0.5 + 0.5) * W, cy = (1 - (c.y * 0.5 + 0.5)) * H;
    const size = H * 0.56;
    const out = document.createElement('canvas');
    out.width = 480; out.height = 360;
    const g = out.getContext('2d');
    const sw = size * 4 / 3, sh = size;
    try {
      g.drawImage(src, Math.max(0, Math.min(W - sw, cx - sw / 2)), Math.max(0, Math.min(H - sh, cy - sh / 2)), sw, sh, 0, 0, 480, 360);
      this.j.recorded[c.id].img = out.toDataURL('image/jpeg', 0.78);
      this.persist();
      this.ui.updateJournalBadge(this.j);
    } catch { /* capture unavailable */ }
  }

  // ---------------------------------------------------------------- convergence
  beginConvergence(cv) {
    if (cv.phase === 'drifting' || cv.phase === 'done') return;
    cv.phase = 'drifting'; cv.t = 0;
    this.ui.event('Convergence', cv.begin);
    this.audio.rumble(cv.dur);
  }
  updateConvergence(cv, dt) {
    if (cv.phase === 'done' && cv.quake > 0) {
      cv.quake -= dt;
      const k = Math.max(0, cv.quake / 5);
      const w = Math.sin(cv.quake * 9) * k * k * 4;
      cv.I1.offset.copy(cv.final).addScaledVector(cv.dir, -w);
      cv.I0.offset.copy(cv.dir).multiplyScalar(w * 0.35);
      cv.I0.offset.y = -Math.abs(w) * 0.3;
      if (cv.quake <= 0) { cv.I0.offset.set(0, 0, 0); cv.I1.offset.copy(cv.final); this.after(20, () => this.checkConvergences(30)); }
      return;
    }
    if (cv.phase !== 'drifting') return;
    cv.t += dt;
    const u = Math.min(1, cv.t / cv.dur);
    const e = u < 0.15 ? (u * u) / 0.3 : 0.075 + (u - 0.15) * (0.925 / 0.85);
    cv.I1.offset.copy(cv.final).multiplyScalar(e);
    if (u >= 1) {
      cv.phase = 'done'; cv.quake = 5;
      this.j.conv[cv.key] = true; this.persist();
      const I0 = cv.I0;
      const seam = I0.pos.clone().add(cv.seamLocal.clone().multiplyScalar((I0.spec.radius + 8) / (I0.spec.radius - 22)));
      const dist = this.camera.position.distanceTo(seam);
      this.chase.shake = Math.max(this.chase.shake, Math.max(0.4, 3.2 - dist / 300));
      this.pipe.finalMat.uniforms.uFlash.value = 0.25; this.pipe.finalMat.uniforms.uFlashColor.value.set(1, 0.85, 0.7);
      this.audio.crash(dist);
      this.input.rumble(Math.max(0.3, 1 - dist / 900), 0.6, 900);
      this.debris.burst(seam, cv.dir, 1);
      this.after(3.5, () => {
        this.eco.spawnHybrid(cv.hybrid, cv.I0, cv.I1, cv.seamLocal);
        this.ui.event(cv.met[0], cv.met[1]);
        this.ui.updateJournalBadge(this.j);
        if (cv.key === 'ochre') this.after(14, () => this.ui.toast('Islands whose life is fully recorded lean toward each other. Finish the survey of two neighbours to bring them together.'));
        this.after(26, () => this.checkStory());
      });
    }
  }
  // debug: record everything and play the ending
  debugEnding() {
    for (const cv of this.convs) if (cv.phase !== 'done') { this.j.conv[cv.key] = true; this.applyConverged(cv); }
    for (const sp of SPECIES) if (!this.j.recorded[sp.id]) this.j.recorded[sp.id] = { at: Date.now(), dist: 30, island: sp.island >= 0 ? this.world.islands[sp.island].name : 'the seam', flight: 0, stars: 2 };
    this.j.ended = false; this.syncLandmarks(); this.ui.updateJournalBadge(this.j);
    this.startEnding(true);
  }
  // debug: finish a convergence instantly
  converge(key) { const cv = this.convs.find((c) => c.key === key); if (cv && cv.phase !== 'done') { this.j.conv[key] = true; this.applyConverged(cv); } return this.convs.map((c) => c.key + ':' + c.phase); }

  // ---------------------------------------------------------------- HUD
  onPhase(name) {
    const T = {
      dusk: ['Dusk', 'The sun is sinking. Some creatures behave differently after dark.'],
      night: ['Night', 'The islands glow. Look for behaviours you can only see now.'],
      dawn: ['Dawn', 'The sun is coming back up in the same place it set.'],
    };
    if (T[name]) this.ui.toast(T[name][1]);
    if (name === 'night') this.hint('night');
    this.audio.phase && this.audio.phase(name);
  }

  updateHUD() {
    const g = this.glider, cam = this.camera;
    const labels = [];
    const v = new THREE.Vector3();
    for (const isl of this.world.islands) {
      v.copy(isl.pos).add(new THREE.Vector3(0, 75, 0));
      const d = cam.position.distanceTo(isl.pos);
      const pending = SPECIES.filter((s) => s.island === isl.index && !this.j.recorded[s.id]).length
        + this.convs.filter((c) => c.I0 === isl && this.eco.spawned_(c.hybrid) && !this.j.recorded[c.hybrid]).length;
      v.project(cam);
      const on = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      const rel = isl.pos.clone().sub(cam.position).applyQuaternion(cam.quaternion.clone().invert());
      const bearing = Math.atan2(rel.x, -rel.z);
      labels.push({ name: isl.name, d, x: v.x, y: v.y, on, behind: v.z > 1, pending, bearing });
    }
    this.ui.hud({
      alt: g.pos.y - U.uCloudTop.value, climb: g.climb, speed: g.speed * 3.6, perched: g.perched, labels, mode: this.input.mode,
      recorded: Object.keys(this.j.recorded).length, total: SPECIES.length, playing: this.state === 'play', lens: this.lens,
      phase: this.cycle.info(), timeMode: this.cycle.mode, weather: this.weather.info(this.camera.position),
      aimX: this.input.aimX, aimY: this.input.aimY, stall: g.stall, goal: this.goalView(),
    });
  }

  goalView() {
    const v = this.state === 'play' ? this.guide.view() : null;
    if (!v) return null;
    if (v.at) {
      const p = v.at.clone(), d = this.camera.position.distanceTo(v.at);
      p.project(this.camera);
      const rel = v.at.clone().sub(this.camera.position).applyQuaternion(this.camera.quaternion.clone().invert());
      v.mark = { x: p.x, y: p.y, on: p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.92, d, bearing: Math.atan2(rel.x, -rel.z) };
    }
    return v;
  }

  // ---------------------------------------------------------------- adaptive quality
  adaptQuality(dt) {
    if (this.settings.quality !== 'auto' || this.state === 'loading') return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    this.quality.lastChange += dt;
    if (this.quality.lastChange < 2.5) return;
    if (this.frameAvg > 24 && this.quality.level > 0) { this.applyQuality(this.quality.level - 1); this.quality.lastChange = 0; }
    else if (this.frameAvg < 13.5 && this.quality.level < 3 && this.quality.lastChange > 6) { this.applyQuality(this.quality.level + 1); this.quality.lastChange = 0; }
  }
}
