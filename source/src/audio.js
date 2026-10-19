// Procedural audio: wind, variometer, a generative ambient score, creature calls and impacts.
const CHORDS = [
  [50, 57, 61, 64, 66, 69], // Dmaj9-ish
  [47, 54, 57, 62, 64, 66], // Bm11
  [43, 50, 54, 61, 62, 66], // Gmaj7#11
  [45, 52, 57, 59, 64, 68], // A add9 sus colour
  [52, 59, 62, 66, 69, 71], // Em9
  [43, 50, 55, 59, 62, 69], // G6/9
];
const NIGHT_CHORDS = [
  [45, 52, 55, 60, 62, 67], // Am(add9)
  [41, 48, 52, 57, 60, 64], // Fmaj7
  [43, 50, 53, 58, 60, 65], // Gm9-ish
  [40, 47, 52, 55, 59, 62], // Em7
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.listener = null; }
  setListener(cam) { this.listener = cam; }

  start(enabled = true) {
    this.enabled = enabled;
    if (this.ctx) { this.ctx.resume(); return; }
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = enabled ? 0.9 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    // reverb
    const rev = ctx.createConvolver();
    const len = ctx.sampleRate * 3.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    rev.buffer = ir;
    this.revIn = ctx.createGain(); this.revIn.gain.value = 0.9;
    this.revIn.connect(rev).connect(master);
    // delay
    const dl = ctx.createDelay(2); dl.delayTime.value = 0.43;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2600;
    this.delayIn = ctx.createGain();
    this.delayIn.connect(dl); dl.connect(dlf).connect(fb).connect(dl);
    dlf.connect(this.revIn); dlf.connect(master);
    // music bus
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 9000;
    this.music = ctx.createGain(); this.music.gain.value = 0.0;
    this.music.connect(this.musicLP); this.musicLP.connect(master); this.musicLP.connect(this.revIn);
    this.music.gain.setTargetAtTime(0.55, ctx.currentTime, 4);
    // noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // wind
    const wsrc = ctx.createBufferSource(); wsrc.buffer = nb; wsrc.loop = true;
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    const wsrc2 = ctx.createBufferSource(); wsrc2.buffer = nb; wsrc2.loop = true; wsrc2.playbackRate.value = 0.7;
    this.whistle = ctx.createBiquadFilter(); this.whistle.type = 'bandpass'; this.whistle.Q.value = 9; this.whistle.frequency.value = 1400;
    this.whistleG = ctx.createGain(); this.whistleG.gain.value = 0;
    wsrc.connect(this.windBP).connect(this.windG).connect(master);
    wsrc2.connect(this.whistle).connect(this.whistleG).connect(master);
    wsrc.start(); wsrc2.start();
    // rain hiss for weather fronts
    const rsrc = ctx.createBufferSource(); rsrc.buffer = nb; rsrc.loop = true; rsrc.playbackRate.value = 1.13;
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1800;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 7500;
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
    rsrc.connect(rhp).connect(rlp).connect(this.rainG).connect(master); rsrc.start();
    this.wx = { rain: 0, wind: 0, fog: 0 }; this.nextDrop = 0;
    // variometer
    this.vario = ctx.createOscillator(); this.vario.type = 'sine';
    this.varioG = ctx.createGain(); this.varioG.gain.value = 0;
    this.vario.connect(this.varioG).connect(master); this.vario.start();
    this.nextBeep = 0;
    // study tone
    this.studyO = ctx.createOscillator(); this.studyO.type = 'triangle'; this.studyO.frequency.value = 660;
    this.studyG = ctx.createGain(); this.studyG.gain.value = 0;
    this.studyO.connect(this.studyG); this.studyG.connect(this.revIn); this.studyG.connect(master); this.studyO.start();
    this.studyLevel = 0;
    // pads
    this.chordIdx = 0; this.nextChord = ctx.currentTime + 0.5; this.nextBell = ctx.currentTime + 3;
    this.voices = [];
  }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.2); }
  duck(on) { if (!this.ctx) return; this.music.gain.setTargetAtTime(on ? 0.25 : 0.55, this.ctx.currentTime, 0.4); this.windG.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.2); }

  pan(pos) {
    if (!this.listener || !pos) return { g: 0.6, p: 0 };
    const cam = this.listener;
    const dx = pos.x - cam.position.x, dy = pos.y - cam.position.y, dz = pos.z - cam.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const e = cam.matrixWorld.elements; // right vector = column 0
    const p = (dx * e[0] + dy * e[1] + dz * e[2]) / Math.max(d, 1);
    return { g: 1 / (1 + d / 70), p: Math.max(-1, Math.min(1, p)) };
  }
  out(pos, wet = 0.3) {
    const ctx = this.ctx;
    const { g, p } = this.pan(pos);
    const gain = ctx.createGain(); gain.gain.value = g;
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pn) { pn.pan.value = p; gain.connect(pn); pn.connect(this.master); } else gain.connect(this.master);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; gain.connect(w); w.connect(this.revIn); }
    return gain;
  }

  // ------------------------------------------------------------ music
  playChord() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const v of this.voices) { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 2.5); v.o.forEach((o) => o.stop(t + 10)); }
    this.voices = [];
    const set = this.night > 0.5 ? NIGHT_CHORDS : CHORDS;
    const ch = set[this.chordIdx % set.length];
    ch.forEach((m, i) => {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + i * 120; lp.Q.value = 0.5;
      const os = [];
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator(); o.type = i < 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = mtof(m + (i < 1 ? 0 : 12)); o.detune.value = det + Math.random() * 3;
        o.connect(lp); o.start(t); os.push(o);
      }
      lp.connect(g).connect(this.music);
      g.gain.setTargetAtTime((i < 2 ? 0.05 : 0.026), t, 2.8);
      // slow filter breathing
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.013;
      const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg).connect(lp.frequency); lfo.start(t); os.push(lfo);
      this.voices.push({ g, o: os });
    });
    this.chordIdx = (this.chordIdx + 1 + (Math.random() < 0.3 ? 1 : 0)) % CHORDS.length;
  }
  bell(m, when = 0, vol = 0.07, toDelay = true, pos = null) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    const f = mtof(m);
    car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.8);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + 3.2);
    car.connect(g);
    if (pos) g.connect(this.out(pos, 0.5)); else { g.connect(this.music); if (toDelay) g.connect(this.delayIn); }
    car.start(t); mod.start(t); car.stop(t + 3.4); mod.stop(t + 3.4);
  }

  update(glider, world, lens, dt, timeScale, night = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.night = night;
    // night insects: soft clicking chorus
    if (night > 0.3 && timeScale > 0.05 && Math.random() < dt * 6 * night) this.cricket();
    if (t > this.nextChord) { this.playChord(); this.nextChord = t + 14 + Math.random() * 6; }
    if (t > this.nextBell) {
      const set = this.night > 0.5 ? NIGHT_CHORDS : CHORDS;
      const ch = set[(this.chordIdx + set.length - 1) % set.length];
      const m = ch[2 + Math.floor(Math.random() * 4)] + (this.night > 0.5 ? 12 : 24);
      this.bell(m, 0, 0.035 + Math.random() * 0.02);
      if (Math.random() < 0.4) this.bell(m + (Math.random() < 0.5 ? 7 : 5), 0.43 * 2, 0.025);
      this.nextBell = t + 2.2 + Math.random() * 4.5;
    }
    // wind
    const sp = glider.perched ? 2 : glider.speed;
    const wv = Math.min(1, sp / 70);
    const wx = this.wx, gust = wx.wind * (0.6 + 0.4 * Math.sin(t * 0.9) * Math.sin(t * 2.3 + 1));
    this.windG.gain.setTargetAtTime((0.04 + wv * wv * 0.5 + gust * 0.22) * (timeScale > 0.05 ? 1 : 0.2), t, 0.15);
    this.windBP.frequency.setTargetAtTime(280 + wv * 900 - gust * 120, t, 0.2);
    this.rainG.gain.setTargetAtTime(wx.rain * 0.16 * (timeScale > 0.05 ? 1 : 0.3), t, 0.4);
    if (wx.rain > 0.25 && t > this.nextDrop) { this.noiseHit(0.03, 2600 + Math.random() * 3000, 0.05 * wx.rain, 'bandpass'); this.nextDrop = t + 0.04 + Math.random() * 0.25 / wx.rain; }
    this.whistleG.gain.setTargetAtTime(Math.max(0, wv - 0.5) * 0.25, t, 0.2);
    this.whistle.frequency.setTargetAtTime(1000 + wv * 1600, t, 0.2);
    // lens: dreamy low-pass
    this.musicLP.frequency.setTargetAtTime((9000 - night * 5000) * (1 - lens * 0.85), t, 0.25);
    // variometer
    const climb = glider.perched ? 0 : glider.climb;
    if (climb > 0.6 && timeScale > 0.05) {
      if (t > this.nextBeep) {
        const f = 560 + Math.min(8, climb) * 70;
        const dur = Math.max(0.06, 0.18 - climb * 0.012);
        this.vario.frequency.setValueAtTime(f, t);
        this.varioG.gain.setValueAtTime(0, t);
        this.varioG.gain.linearRampToValueAtTime(0.045, t + 0.01);
        this.varioG.gain.setValueAtTime(0.045, t + dur);
        this.varioG.gain.linearRampToValueAtTime(0, t + dur + 0.02);
        this.nextBeep = t + 1 / (1.6 + climb * 0.75);
      }
    }
    // study tone
    this.studyLevel = Math.max(0, this.studyLevel - dt * 2);
    this.studyG.gain.setTargetAtTime(this.studyLevel * 0.03, t, 0.08);
    // kite chirps when escorting
    if (world.eco) {
      const kites = world.eco.bySpecies.kite;
      for (const k of kites) if (k.tag === 'escort' && Math.random() < dt * 0.25) this.chirp(k.pos);
    }
  }

  cricket() {
    const ctx = this.ctx, t = ctx.currentTime;
    const f = 3800 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain(); g.gain.value = 0.012 + Math.random() * 0.012;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan).connect(this.master); } else g.connect(this.master);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const e = ctx.createGain(); const ts = t + i * 0.055;
      e.gain.setValueAtTime(0, ts); e.gain.linearRampToValueAtTime(1, ts + 0.005); e.gain.exponentialRampToValueAtTime(0.001, ts + 0.04);
      o.connect(e).connect(g); o.start(ts); o.stop(ts + 0.05);
    }
  }
  phase(name) {
    if (!this.ctx) return;
    const motif = { dusk: [74, 71, 67, 64], night: [69, 64, 60, 57], dawn: [62, 66, 69, 74] }[name];
    if (motif) motif.forEach((m, i) => this.bell(m, i * 0.32, 0.045));
    this.nextChord = this.ctx.currentTime + 1.5;
  }
  shutter() {
    if (!this.ctx) return;
    this.noiseHit(0.05, 3200, 0.25, 'highpass');
    setTimeout(() => this.ctx && this.noiseHit(0.08, 1800, 0.18, 'bandpass'), 70);
  }

  // ------------------------------------------------------------ effects
  studyTick(p) { if (!this.ctx) return; this.studyLevel = 1; this.studyO.frequency.setTargetAtTime(mtof(74 + p * 12), this.ctx.currentTime, 0.05); }
  discover() {
    if (!this.ctx) return;
    const ch = CHORDS[(this.chordIdx + CHORDS.length - 1) % CHORDS.length];
    [0, 1, 2, 3, 4, 5].forEach((i) => this.bell(ch[i] + 12 + (i > 3 ? 12 : 0), i * 0.09, 0.06));
  }
  page() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 0.4);
  }
  noiseHit(dur, freq, vol, type = 'lowpass', pos = null, wet = 0.2) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f).connect(g).connect(pos ? this.out(pos, wet) : this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return f;
  }
  thump(freq, vol, dur, pos = null) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(pos ? this.out(pos, 0.15) : this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  bump(s) { if (!this.ctx) return; this.thump(70, 0.5 * s + 0.1, 0.4); this.noiseHit(0.25, 900, 0.2 * s + 0.05); }
  land() { if (!this.ctx) return; this.thump(80, 0.25, 0.3); this.noiseHit(0.5, 1800, 0.08, 'bandpass'); }
  launch() { if (!this.ctx) return; const f = this.noiseHit(0.9, 400, 0.12, 'bandpass'); f.frequency.exponentialRampToValueAtTime(1800, this.ctx.currentTime + 0.8); }
  whoosh() { if (!this.ctx) return; const f = this.noiseHit(1.6, 300, 0.25, 'bandpass'); f.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 1.5); }
  footstep(pos, id) {
    if (!this.ctx || Math.random() < 0.4) return;
    this.thump(id === 'hybrid' || id === 'strider' ? 55 : id === 'wader' ? 70 : 48, id === 'wader' ? 0.12 : 0.22, 0.25, pos);
  }
  polypClose(pos) { if (!this.ctx) return; this.thump(320, 0.2, 0.12, pos); this.noiseHit(0.12, 1400, 0.12, 'bandpass', pos); }
  chirp(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const base = 1800 + Math.random() * 900;
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.08); o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
    o.connect(g).connect(this.out(pos, 0.4)); o.start(t); o.stop(t + 0.25);
  }
  whaleSong(pos, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const { g: dg } = this.pan(pos);
    if (dg < 0.04) return;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = (62 + Math.random() * 10) * pitch;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.7, t + 1.6); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 3.2); o.frequency.linearRampToValueAtTime(f0 * 0.8, t + 5);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.setValueAtTime(320 * pitch, t); f1.frequency.linearRampToValueAtTime(700 * pitch, t + 2.5); f1.frequency.linearRampToValueAtTime(400 * pitch, t + 5); f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 1.0); g.gain.setValueAtTime(0.5, t + 3.6); g.gain.linearRampToValueAtTime(0, t + 5.2);
    const out = this.out(pos, 1.2);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(out);
    o.start(t); o.stop(t + 5.4);
  }
  rumble(dur) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.5, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 4);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 5);
    // ominous low pad
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(26);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.12, t + dur); og.gain.linearRampToValueAtTime(0, t + dur + 3);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + dur + 4);
  }
  crash(dist) {
    if (!this.ctx) return;
    const k = Math.max(0.25, 1.4 - dist / 900);
    this.thump(55, 0.9 * k, 2.2);
    this.noiseHit(3.5, 220, 0.8 * k, 'lowpass');
    this.noiseHit(1.2, 2500, 0.25 * k, 'bandpass');
    for (let i = 0; i < 14; i++) setTimeout(() => this.ctx && this.noiseHit(0.15 + Math.random() * 0.3, 600 + Math.random() * 2400, 0.12 * k, 'bandpass'), 200 + Math.random() * 3800);
    const ch = CHORDS[0];
    [0, 2, 4].forEach((i, n) => this.bell(ch[i] + 12, 1.6 + n * 0.3, 0.05));
  }
}
