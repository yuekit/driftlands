// Photo mode: time stops, the camera leaves the glider, and the panel exposes the lens (focal length,
// aperture, focus), exposure, white balance, time of day, grade presets and a crop frame. Saves a PNG.
import * as THREE from 'three';
import { apertureFor } from './post.js';
import { CYCLE_LENGTH } from './cycle.js';

const $ = (id) => document.getElementById(id);
const STOPS = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
const FRAMES = [['free', 0], ['3:2', 1.5], ['16:9', 16 / 9], ['2.39', 2.39], ['4:5', 0.8], ['1:1', 1]];
const F_MIN = 14, F_MAX = 300;
const fovOf = (mm) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
const mmOf = (fov) => 12 / Math.tan((fov * Math.PI) / 360);

// sat multiplies the game's base saturation; lift adds to the island grade; the rest replace the defaults
export const GRADES = {
  natural: { label: 'Natural' },
  golden: { label: 'Golden', wb: [1.1, 1.0, 0.86], sat: 1.08, contrast: 0.55, lift: [0.016, 0.006, -0.004], hi: [1.05, 1.0, 0.9], shadow: [-0.004, -0.002, 0.012], vig: 0.34 },
  film: { label: 'Faded film', sat: 0.8, contrast: 0.4, black: 0.055, shadow: [-0.012, 0.006, 0.02], hi: [1.04, 1.0, 0.92], grain: 0.055, vig: 0.3 },
  nocturne: { label: 'Nocturne', wb: [0.86, 0.96, 1.14], sat: 0.92, contrast: 0.56, shadow: [-0.012, 0.0, 0.035], hi: [0.98, 1.0, 1.04], vig: 0.34 },
  vivid: { label: 'Vivid', sat: 1.3, contrast: 0.68, vig: 0.3 },
  silver: { label: 'Silver', mono: 1, monoMix: [0.42, 0.48, 0.1], contrast: 0.78, grain: 0.05, vig: 0.42, black: 0.02, shadow: [0, 0, 0], hi: [1, 1, 1] },
};
const DEF = { wb: [1, 1, 1], sat: 1, contrast: 0.5, lift: [0, 0, 0], hi: [1.03, 1, 0.95], shadow: [-0.009, 0, 0.0252], vig: 0.28, grain: 0.028, black: 0, mono: 0, monoMix: [0.2126, 0.7152, 0.0722] };

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.fov = 50;
    this.fIdx = 3; this.ev = 0; this.warmth = 0; this.grade = 'natural'; this.frameIdx = 0; this.showGlider = true;
    this.focusMode = 'point'; this.focusDist = 20; this.focusUV = new THREE.Vector2(0.5, 0.5); this.readT = 0;
    this.panelHidden = false; this.saveQueued = false;
    this.drag = null;
    this.bind();
  }

  // ---------------------------------------------------------------- UI
  bind() {
    const root = $('photo');
    if (!root) return;
    this.el = root;
    const range = (id, fn) => { const r = $(id); r.addEventListener('input', () => { fn(+r.value); this.sync(); }); return r; };
    range('ph-fov', (v) => { this.fov = fovOf(F_MIN * Math.pow(F_MAX / F_MIN, v)); });
    range('ph-ap', (v) => { this.fIdx = v; });
    range('ph-focus', (v) => { this.focusMode = 'manual'; this.focusDist = 0.8 * Math.pow(2500, v); });
    range('ph-ev', (v) => { this.ev = v; });
    range('ph-wb', (v) => { this.warmth = v; });
    range('ph-roll', (v) => { this.roll = (v * Math.PI) / 180; });
    range('ph-time', (v) => { const c = this.game.cycle; c.t = v * CYCLE_LENGTH; c.apply(); this.game.pipe.adaptReset = true; });
    const grades = $('ph-grade');
    grades.innerHTML = Object.entries(GRADES).map(([k, g]) => `<button type="button" data-g="${k}">${g.label}</button>`).join('');
    grades.querySelectorAll('button').forEach((b) => (b.onclick = () => { this.grade = b.dataset.g; this.sync(); }));
    const frames = $('ph-frame');
    frames.innerHTML = FRAMES.map(([n], i) => `<button type="button" data-i="${i}">${n === 'free' ? 'Full' : n}</button>`).join('');
    frames.querySelectorAll('button').forEach((b) => (b.onclick = () => { this.frameIdx = +b.dataset.i; this.sync(); }));
    $('ph-glider').querySelectorAll('button').forEach((b) => (b.onclick = () => { this.showGlider = b.dataset.v === 'true'; this.sync(); }));
    $('ph-autofocus').onclick = () => { this.focusMode = 'point'; this.focusUV.set(0.5, 0.5); this.sync(); };
    $('ph-save').onclick = () => this.save();
    $('ph-exit').onclick = () => this.exit();
    $('ph-show').onclick = () => this.togglePanel(false);

    const cv = this.game.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!this.on || !d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0042 * (this.fov / 60);
      this.yaw -= dx * k; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * k));
    });
    const up = (e) => {
      const d = this.drag;
      if (!this.on || !d || d.id !== e.pointerId) return;
      this.drag = null;
      if (d.moved < 5) {
        // a click focuses on what is under it
        const r = cv.getBoundingClientRect();
        this.focusMode = 'point';
        this.focusUV.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
        this.sync();
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (!this.on) return;
      e.preventDefault();
      this.fov = fovOf(Math.max(F_MIN, Math.min(F_MAX, mmOf(this.fov) * Math.exp(-e.deltaY * 0.0012))));
      this.sync();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === this.game.input.bind.photo && !e.repeat) {
        if (this.on) this.exit(); else if (this.game.state === 'play' || this.game.state === 'paused') this.enter();
        return;
      }
      if (!this.on) return;
      if (e.target && e.target.tagName === 'INPUT' && k !== 'escape' && k !== 'enter') return;
      if (k === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); this.exit(); }
      else if (k === 'h' && !e.repeat) this.togglePanel();
      else if (k === 'enter' && !e.repeat) { e.preventDefault(); this.save(); }
    }, true);
  }
  togglePanel(hide = !this.panelHidden) {
    this.panelHidden = hide;
    this.el.classList.toggle('bare', hide);
  }
  sync() {
    if (!this.el) return;
    const mm = mmOf(this.fov);
    $('ph-fov').value = Math.log(mm / F_MIN) / Math.log(F_MAX / F_MIN);
    $('ph-fov-v').textContent = `${Math.round(mm)} mm`;
    $('ph-ap').value = this.fIdx;
    $('ph-ap-v').textContent = `f/${STOPS[this.fIdx]}`;
    const fd = this.focusDist;
    $('ph-focus').value = Math.log(Math.max(0.8, fd) / 0.8) / Math.log(2500);
    $('ph-focus-v').textContent = `${this.focusMode === 'point' ? 'Auto · ' : ''}${fd < 10 ? fd.toFixed(1) : Math.round(fd)} m`;
    $('ph-autofocus').hidden = this.focusMode === 'point';
    $('ph-ev').value = this.ev;
    $('ph-ev-v').textContent = `${this.ev > 0 ? '+' : this.ev < 0 ? '−' : ''}${Math.abs(this.ev).toFixed(1)} EV`;
    $('ph-wb').value = this.warmth;
    $('ph-wb-v').textContent = Math.abs(this.warmth) < 0.05 ? 'Neutral' : this.warmth > 0 ? 'Warmer' : 'Cooler';
    $('ph-roll').value = (this.roll * 180) / Math.PI;
    $('ph-roll-v').textContent = `${Math.round((this.roll * 180) / Math.PI)}°`;
    const c = this.game.cycle;
    $('ph-time').value = c.t / CYCLE_LENGTH;
    $('ph-time-v').textContent = c.phase[0].toUpperCase() + c.phase.slice(1);
    $('ph-grade').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === this.grade)));
    $('ph-frame').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === this.frameIdx)));
    $('ph-glider').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === 'true') === this.showGlider)));
    const mark = $('ph-mark');
    mark.style.left = `${this.focusUV.x * 100}%`; mark.style.top = `${(1 - this.focusUV.y) * 100}%`;
    mark.classList.toggle('on', this.focusMode === 'point');
  }

  // ---------------------------------------------------------------- lifecycle
  enter() {
    const g = this.game;
    if (this.on) return;
    if (g.state === 'paused') g.pause(false);
    if (g.state !== 'play') return;
    this.on = true;
    g.state = 'photo';
    const cam = g.camera;
    this.pos.copy(cam.position); this.vel.set(0, 0, 0);
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.yaw = Math.atan2(d.x, d.z); this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    this.roll = 0; this.fov = cam.fov;
    this.anchor = g.glider.pos.clone();
    this.savedT = g.cycle.t;
    this.focusMode = 'point'; this.focusUV.set(0.5, 0.5);
    g.pipe.dof.snap = true;
    g.ui.showHUD(false); g.ui.lens(0, null);
    g.audio.duck(true);
    this.el.hidden = false; this.togglePanel(false);
    requestAnimationFrame(() => { if (this.on) this.el.classList.add('on'); });
    this.sync();
  }
  exit() {
    const g = this.game;
    if (!this.on) return;
    this.on = false;
    g.state = 'play';
    g.cycle.t = this.savedT; g.cycle.apply(); g.pipe.adaptReset = true;
    g.ui.showHUD(true);
    g.audio.duck(false);
    this.el.classList.remove('on'); this.el.hidden = true;
    this.vel.set(0, 0, 0);
    g.pipe.dof.aperture = 0;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game, k = g.input.keys, cam = g.camera;
    const fwd = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    const ax = (a, b) => (typing ? 0 : (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0));
    const want = new THREE.Vector3()
      .addScaledVector(fwd, ax('w', 's') || ax('arrowup', 'arrowdown'))
      .addScaledVector(right, ax('d', 'a') || ax('arrowright', 'arrowleft'))
      .addScaledVector(new THREE.Vector3(0, 1, 0), ax('e', 'q'));
    const inp = g.input;
    if (inp.mode === 'pad') {
      // gamepad: left stick moves, right stick looks, triggers sink and rise, held RB moves fast
      want.addScaledVector(fwd, inp.padStick[1]).addScaledVector(right, inp.padStick[0]).addScaledVector(new THREE.Vector3(0, 1, 0), inp.padTrig[1] - inp.padTrig[0]);
      this.yaw -= inp.padLook[0] * dt * 1.6;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + inp.padLook[1] * dt * 1.2));
    }
    if (want.lengthSq() > 1) want.normalize();
    const speed = k.has('shift') || (inp.pad && inp.padPrev[5]) ? 40 : 9;
    this.vel.lerp(want.multiplyScalar(speed), 1 - Math.exp(-dt * 6));
    this.pos.addScaledVector(this.vel, dt);
    // stay within reach of the glider and above the cloud sea floor
    const off = this.pos.clone().sub(this.anchor);
    const R = 420;
    if (off.length() > R) this.pos.copy(this.anchor).addScaledVector(off.normalize(), R);
    this.pos.y = Math.max(8, this.pos.y);

    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.pos.clone().add(fwd));
    cam.rotateZ(-this.roll);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    g.glider.root.visible = this.showGlider; g.glider.scarfMesh.visible = this.showGlider;

    // lens
    const D = g.pipe.dof;
    D.aperture = apertureFor(this.fov, STOPS[this.fIdx], 6);
    D.speed = 10;
    if (this.focusMode === 'manual') D.focusDist = this.focusDist;
    else { D.focusDist = 0; D.focusUV.copy(this.focusUV); }
    this.readT -= dt;
    if (this.focusMode === 'point' && this.readT <= 0) {
      this.readT = 0.2;
      const f = g.pipe.readFocus();
      if (f > 0 && Math.abs(f - this.focusDist) > 0.05) { this.focusDist = Math.min(2000, f); this.sync(); }
    }
  }
  // grading on top of the island grade; natural when photo mode is off
  applyGrade(fu) {
    const G = { ...DEF, ...(this.on ? GRADES[this.grade] : {}) };
    const w = this.on ? this.warmth : 0;
    fu.uWB.value.set(G.wb[0] * (1 + 0.12 * w), G.wb[1], G.wb[2] * (1 - 0.14 * w));
    fu.uSat.value = 1.36 * G.sat;
    fu.uContrast.value = G.contrast;
    fu.uLift.value.x += G.lift[0]; fu.uLift.value.y += G.lift[1]; fu.uLift.value.z += G.lift[2];
    fu.uHiTint.value.set(...G.hi); fu.uShadowTint.value.set(...G.shadow);
    fu.uVig.value = G.vig; fu.uGrain.value = G.grain; fu.uBlack.value = G.black;
    fu.uMono.value = G.mono; fu.uMonoMix.value.set(...G.monoMix);
    fu.uAR.value = this.on && !this.saveQueued ? FRAMES[this.frameIdx][1] : 0;
    if (this.on) fu.uExposure.value *= Math.pow(2, this.ev);
  }

  // ---------------------------------------------------------------- save
  save() {
    if (!this.on) return;
    this.saveQueued = true;
    this.el.classList.add('flash');
    setTimeout(() => this.el.classList.remove('flash'), 350);
  }
  // called right after the frame is drawn, while the drawing buffer is still valid
  finishSave() {
    if (!this.saveQueued) return;
    this.saveQueued = false;
    const src = this.game.renderer.domElement;
    const W = src.width, H = src.height, ar = FRAMES[this.frameIdx][1];
    let w = W, h = H;
    if (ar > 0) { if (W / H > ar) w = Math.round(H * ar); else h = Math.round(W / ar); }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(src, (W - w) / 2, (H - h) / 2, w, h, 0, 0, w, h);
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `driftlands-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    const done = (url, revoke) => {
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 4000);
      const btn = $('ph-save'); btn.textContent = 'Saved'; clearTimeout(this.savedT2); this.savedT2 = setTimeout(() => { btn.textContent = 'Save photo'; }, 1600);
    };
    try {
      out.toBlob((b) => { if (b) done(URL.createObjectURL(b), true); else done(out.toDataURL('image/png'), false); }, 'image/png');
    } catch { try { done(out.toDataURL('image/png'), false); } catch { $('ph-save').textContent = 'Could not save'; } }
  }
}
