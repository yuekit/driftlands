// Sound for the airship and the fight, on top of the first game's wind, weather and music.
import { Audio } from './audio.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// the lances are tuned: each shot is a note from the Chord
const LANCE = [74, 78, 81, 86, 81, 78, 74, 69];

export class Audio2 extends Audio {
  start(enabled = true) {
    const had = !!this.ctx;
    super.start(enabled);
    if (had || !this.ctx) return;
    const ctx = this.ctx;
    // engines: two detuned saws through a low-pass, plus the beat of the propellers
    this.engG = ctx.createGain(); this.engG.gain.value = 0;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 220;
    this.engO = [0, 1].map((i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; o.detune.value = i ? 9 : -8; o.connect(this.engLP); o.start(); return o; });
    this.engAM = ctx.createGain(); this.engAM.gain.value = 0.7;
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 0.3; this.lfo.connect(lg).connect(this.engAM.gain); this.lfo.start();
    this.engLP.connect(this.engAM).connect(this.engG).connect(this.master);
    // alarm drone for the roused city
    this.alarmG = ctx.createGain(); this.alarmG.gain.value = 0;
    const a1 = ctx.createOscillator(); a1.type = 'triangle'; a1.frequency.value = mtof(41); const a2 = ctx.createOscillator(); a2.type = 'triangle'; a2.frequency.value = mtof(42.1);
    const alp = ctx.createBiquadFilter(); alp.type = 'lowpass'; alp.frequency.value = 500;
    a1.connect(alp); a2.connect(alp); alp.connect(this.alarmG).connect(this.master); this.alarmG.connect(this.revIn); a1.start(); a2.start();
    this.lanceI = 0; this.lastShot = 0;
  }
  // per frame: engines follow speed and drive, music darkens in a fight
  update2(ship, dt, o) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = ship.speed, live = o.live ? 1 : 0;
    this.engG.gain.setTargetAtTime((0.05 + 0.05 * ship.boost + sp / 86 * 0.04) * live, t, 0.2);
    for (const e of this.engO) e.frequency.setTargetAtTime(38 + sp * 0.55 + ship.boost * 16, t, 0.3);
    this.engLP.frequency.setTargetAtTime(160 + sp * 4 + ship.boost * 500, t, 0.25);
    this.lfo.frequency.setTargetAtTime(6 + sp * 0.16, t, 0.3);
    this.alarmG.gain.setTargetAtTime((o.alarm || 0) * 0.05 * live, t, 0.8);
    this.musicLP.frequency.setTargetAtTime(o.fight ? 2600 : 9000 - (o.night || 0) * 4500, t, 1.2);
    if (o.lowHull && live && t > (this.nextWarn || 0)) { this.thump(880, 0.05, 0.12); this.nextWarn = t + 0.9; }
  }
  blip(kind = 0) {
    if (!this.ctx) return;
    if (kind === 1) { this.noiseHit(0.12, 2400, 0.05, 'bandpass'); this.bell(81, 0.05, 0.03, false); }   // the post radio opens with a crackle
    else if (kind === 2) this.bell(57, 0, 0.06);
    else this.bell(88, 0, 0.018, false);
  }
  lance() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const m = LANCE[this.lanceI++ % LANCE.length];
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(mtof(m) * 2, t); o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.07);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.075, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
    o.connect(g).connect(this.master); g.connect(this.delayIn); o.start(t); o.stop(t + 0.25);
    this.noiseHit(0.05, 3200, 0.05, 'highpass');
  }
  enemyShot(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastShot < 0.05) return; this.lastShot = t;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    o.connect(g).connect(this.out(pos, 0.2)); o.start(t); o.stop(t + 0.22);
  }
  hitTick() { if (this.ctx) this.thump(1400, 0.035, 0.05); }
  boom(pos, size = 1) {
    if (!this.ctx) return;
    this.thump(60 + 30 / size, Math.min(1, 0.55 * size), 0.5 + 0.5 * size, pos);
    this.noiseHit(0.5 + 0.9 * size, 500 + 300 / size, Math.min(0.9, 0.5 * size), 'lowpass', pos, 0.5);
    this.noiseHit(0.25, 3000, 0.16 * size, 'bandpass', pos, 0.3);
  }
  hullHit(strength = 0.5) { if (!this.ctx) return; this.thump(90, 0.3 + 0.4 * strength, 0.3); this.noiseHit(0.3, 1300, 0.2 + 0.2 * strength, 'bandpass'); }
  // the Bell: the ship's whole chord at once
  bellRing(big = false) {
    if (!this.ctx) return;
    const notes = big ? [38, 50, 57, 62, 66, 69, 74, 78, 81] : [50, 57, 62, 66, 74];
    notes.forEach((m, i) => this.bell(m + 12, i * (big ? 0.11 : 0.012), big ? 0.11 : 0.085));
    this.thump(55, 0.6, big ? 2.4 : 1.1); this.noiseHit(big ? 2.5 : 0.9, 700, 0.3, 'lowpass');
    const f = this.noiseHit(1.2, 300, 0.14, 'bandpass'); f.frequency.exponentialRampToValueAtTime(4000, this.ctx.currentTime + 1.0);
  }
  thunder(dist = 0.5) {
    if (!this.ctx) return;
    const k = 1 - dist * 0.6;
    setTimeout(() => { if (!this.ctx) return; this.noiseHit(3.2, 160, 0.8 * k, 'lowpass'); this.thump(42, 0.6 * k, 1.8); for (let i = 0; i < 5; i++) setTimeout(() => this.ctx && this.noiseHit(0.5, 300 + Math.random() * 500, 0.2 * k, 'lowpass'), 300 + Math.random() * 1800); }, 150 + dist * 1500);
  }
  sting(up = true) { if (!this.ctx) return; const n = up ? [62, 69, 74, 81] : [62, 61, 57, 50]; n.forEach((m, i) => this.bell(m, i * 0.16, 0.06)); }
}
