// First flight: a short guided sequence of goals for a new journal, each with an optional world marker.
// Later goals unlock as earlier ones finish; returning players skip it.
import * as THREE from 'three';

const STEPS = [
  {
    id: 'steer', text: 'Bank left and right to get a feel for the glider',
    start: (G) => { G.game.hint('steer'); G.data.l = 0; G.data.r = 0; },
    update: (G, dt) => { const r = G.game.glider.roll; if (r > 0.35) G.data.r += dt; if (r < -0.35) G.data.l += dt; return G.data.l > 0.6 && G.data.r > 0.6; },
  },
  {
    id: 'thermal', label: 'Thermal', text: 'Fly into the marked column of spores and circle to climb',
    start: (G) => {
      G.game.hint('thermal');
      const g = G.game.glider.pos;
      let best = null, bd = Infinity;
      for (const t of G.game.world.thermals.list) { const d = (t.x - g.x) ** 2 + (t.z - g.z) ** 2; if (d < bd) { bd = d; best = t; } }
      G.data.th = best; G.data.climb = 0;
    },
    marker: (G) => { const t = G.data.th; return t && new THREE.Vector3(t.x, G.game.glider.pos.y, t.z); },
    update: (G, dt) => { const g = G.game.glider; if ((g.thermal || 0) > 1 && g.climb > 0) G.data.climb += g.climb * dt; return G.data.climb > 25; },
  },
  {
    id: 'find', label: 'Stiltwalkers', text: 'Glide to Verdigris Reach and find a stiltwalker',
    marker: (G) => { const s = G.game.eco.bySpecies.stilt; return s && s[0] && s[0].pos.clone().add(new THREE.Vector3(0, 10, 0)); },
    update: (G) => !!G.game.nearUnrecorded || Object.keys(G.game.j.recorded).length > 0,
  },
  {
    id: 'lens', text: 'Raise your lens and keep a creature in the circle until it fills',
    start: (G) => G.game.hint('lens'),
    update: (G) => Object.keys(G.game.j.recorded).length > 0,
  },
  {
    id: 'journal', text: 'Open your field journal to read about it',
    start: (G) => G.game.hint('journal'),
    update: (G) => G.game.state === 'journal',
  },
  {
    id: 'land', label: 'Verdigris Reach', text: 'Land gently on flat ground to rest, then launch again',
    start: (G) => { G.data.landed = false; const isl = G.game.world.islands[0]; G.data.spot = isl; },
    marker: (G) => G.data.spot && G.data.spot.pos.clone().add(new THREE.Vector3(0, 6, 0)),
    update: (G) => G.data.landed && !G.game.glider.perched,
  },
  {
    id: 'four', text: 'Record four species. Watch what the currents do next',
    update: (G) => Object.keys(G.game.j.recorded).length >= 4,
  },
];

export class Guide {
  constructor(game) {
    this.game = game;
    this.data = {};
    this.step = game.j.guide ?? (Object.keys(game.j.recorded).length > 0 ? STEPS.length : 0);
    this.started = -1;
  }
  get active() { return this.step < STEPS.length; }
  get total() { return STEPS.length; }
  reset() { this.step = 0; this.started = -1; this.data = {}; this.save(); }
  skip() { this.step = STEPS.length; this.save(); this.game.ui.goal(null); }
  save() { this.game.j.guide = this.step; this.game.persist(); }
  onLand() { this.data.landed = true; }
  update(dt) {
    if (!this.active || this.game.state === 'title') return;
    const S = STEPS[this.step];
    if (this.started !== this.step) { this.started = this.step; this.data = {}; S.start && S.start(this); }
    if (S.update(this, dt)) {
      this.step++; this.save();
      if (this.game.audio.bell && this.game.audio.ctx) this.game.audio.bell(79, 0, 0.05);
      if (!this.active) {
        this.game.ui.goal(null);
        this.game.ui.toast('First flight complete. The archipelago is yours.');
        this.game.onGuideDone && this.game.onGuideDone();
      }
    }
  }
  // what the HUD shows: the goal text and the marker's world position, if any
  view() {
    if (!this.active) return null;
    const S = STEPS[this.step];
    return { n: this.step + 1, of: STEPS.length, text: S.text, label: S.label, at: S.marker ? S.marker(this) : null };
  }
}
