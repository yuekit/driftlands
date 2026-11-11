// Title, loading and intro screen. The loading bar is the island itself: it rises out of the cloud sea as the world
// is built (b2), grows its mushrooms and roots when the world is ready (b3), then the wordmark and menu settle (b4).
// Starting a flight lets the cloud sea swell over the plate before the layer clears to show the world.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TitleScreen {
  constructor({ touch = false } = {}) {
    this.el = $('title');
    this.menu = $('t-menu');
    this.touch = touch;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.items = []; this.sel = 0;
    this.shown = 0; this.riseAt = 0; this.settledAt = 0;
    this.isReady = false; this.settled = false; this.leaving = false; this.gone = false;
    this.timers = [];
    this.setMode(touch ? 'touch' : 'keys');
    this.measure();
    this._resize = () => this.measure();
    window.addEventListener('resize', this._resize);
    // the layers lean a little with the pointer
    this.par = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
    this._move = (e) => {
      if (this.gone || this.reduced || e.pointerType === 'touch') return;
      const r = this.el.getBoundingClientRect();
      this.par.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      this.par.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (!this.par.raf) this.par.raf = requestAnimationFrame(() => this.lean());
    };
    window.addEventListener('pointermove', this._move, { passive: true });
    this._key = (e) => this.onKey(e);
    window.addEventListener('keydown', this._key);
    this._skip = () => this.skip();
    this.el.addEventListener('pointerdown', this._skip);
  }

  // where the island sits while it is the only thing on the plate: centred and large
  measure() {
    if (this.gone) return;
    const isle = this.el.querySelector('.ts-isle');
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!isle || !W || !H || !isle.offsetHeight) return;
    let x = 0, y = 0;
    for (let n = isle; n && n !== this.el; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    const h = Math.min(H * 0.52, W * 1.16);
    const s = h / isle.offsetHeight;
    this.el.style.setProperty('--hs', s.toFixed(4));
    this.el.style.setProperty('--hx', `${(W / 2 - (x + isle.offsetWidth / 2)).toFixed(1)}px`);
    this.el.style.setProperty('--hy', `${(H * 0.44 - h / 2 - y).toFixed(1)}px`);
  }
  lean() {
    const p = this.par;
    p.x += (p.tx - p.x) * 0.07; p.y += (p.ty - p.y) * 0.07;
    this.el.style.setProperty('--px', p.x.toFixed(4)); this.el.style.setProperty('--py', p.y.toFixed(4));
    p.raf = !this.gone && Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.002 ? requestAnimationFrame(() => this.lean()) : 0;
  }
  setMode(mode) {
    const m = mode === 'pad' ? 'pad' : mode === 'touch' ? 'touch' : 'keys';
    if (m !== this.mode) { this.mode = m; this.el.dataset.mode = m; }
  }
  after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  // ---------------------------------------------------------------- loading
  progress(p) {
    $('t-load-text').textContent = p < 0.98 ? `Raising the islands · ${Math.round(p * 100)}%` : 'Seeding life';
    // the island shows most of itself while the world is meshed and keeps the last stretch for when everything is ready
    const r = 0.86 * p;
    if (r - this.shown < 0.07 && p < 1) return;
    this.rise(r);
  }
  rise(r) {
    this.shown = r;
    this.el.classList.add('b2');
    this.el.style.setProperty('--rise', r.toFixed(3));
    this.riseAt = performance.now();
  }

  // ---------------------------------------------------------------- ready: the reveal, then the menu
  // opts: { saved: null | { n, total, ended }, onBegin(fresh), onSettings(), onGesture() }
  ready(opts) {
    this.opts = opts;
    this.isReady = true;
    this.measure();
    this.mainMenu();
    const wait = this.reduced ? 0 : Math.max(0, 900 - (performance.now() - this.riseAt));
    this.rise(1);
    this.after(wait + (this.reduced ? 0 : 750), () => this.el.classList.add('b3'));
    this.after(wait + (this.reduced ? 0 : 1900), () => this.settle());
  }
  settle() {
    if (this.settled) return;
    this.settled = true; this.settledAt = performance.now();
    this.el.classList.add('b2', 'b3', 'b4');
    $('t-foot').removeAttribute('aria-hidden');
    this.focusSel();
  }
  skip() {
    if (!this.isReady || this.settled || this.leaving) return false;
    this.timers.forEach(clearTimeout); this.timers = [];
    this.el.classList.add('ts-skip');
    this.settle();
    setTimeout(() => this.el.classList.remove('ts-skip'), 400);
    return true;
  }

  // ---------------------------------------------------------------- menu
  mainMenu() {
    const s = this.opts.saved;
    const items = [];
    if (s) {
      items.push({ id: 't-start', label: 'Continue', note: s.ended ? 'Survey complete' : `${s.n} of ${s.total} plates`, act: () => this.begin(false) });
      items.push({ id: 't-new', label: 'Begin a new journal', act: () => this.askNew() });
    } else items.push({ id: 't-start', label: 'Begin a new journal', act: () => this.begin(false) });
    items.push({ id: 't-settings', label: 'Settings', act: () => this.opts.onSettings && this.opts.onSettings() });
    this.setItems(items, 0);
  }
  askNew() {
    const s = this.opts.saved;
    this.setItems([
      { id: 't-erase', label: 'Erase and begin', act: () => this.begin(true) },
      { id: 't-keep', label: 'Keep my journal', act: () => { this.mainMenu(); this.select(1); this.focusSel(); } },
    ], 1, `A new journal erases the old one${s && s.n ? ` and its ${s.n} ${s.n === 1 ? 'plate' : 'plates'}` : ''}. The islands drift back to where they started.`);
    this.back = () => { this.mainMenu(); this.select(1); this.focusSel(); };
    this.focusSel();
  }
  setItems(items, sel, ask) {
    this.items = items; this.back = null;
    this.menu.innerHTML = (ask ? `<p class="ts-ask" id="t-ask">${esc(ask)}</p>` : '') + items.map((it) => `<button class="ts-item" type="button" id="${it.id}"${ask ? ' aria-describedby="t-ask"' : ''}><span class="ts-lbl">${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</span></button>`).join('');
    items.forEach((it, i) => {
      const b = $(it.id);
      // a click that only skipped the reveal must not also press whatever button appeared under it
      b.onclick = () => { if (this.leaving || !this.settled || performance.now() - this.settledAt < 450) return; this.select(i); it.act(); };
      b.onpointerenter = (e) => { if (e.pointerType !== 'touch') this.select(i); };
      b.onfocus = () => this.select(i);
    });
    this.select(sel);
  }
  select(i) {
    this.sel = (i + this.items.length) % this.items.length;
    this.items.forEach((it, k) => $(it.id).classList.toggle('sel', k === this.sel));
  }
  focusSel() { const it = this.items[this.sel]; if (it && this.settled && !this.paused) $(it.id).focus({ preventScroll: true }); }
  move(d) { if (this.leaving || this.paused) return; if (this.skip()) return; this.select(this.sel + d); this.focusSel(); }
  activate() { if (this.leaving || this.paused || !this.isReady) return; if (this.skip()) return; const it = this.items[this.sel]; if (it) it.act(); }
  cancel() { if (this.leaving || this.paused) return; if (this.back) this.back(); }
  // a panel (settings) is open over the title: the menu stops listening until it closes
  pause(on) { this.paused = on; if (!on) this.focusSel(); }

  onKey(e) {
    if (this.gone || this.leaving || this.paused || !this.isReady || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (!this.settled) { if (k !== 'tab' && k !== 'shift') { e.preventDefault(); this.skip(); } return; }
    if (k === 'arrowdown' || k === 's') { e.preventDefault(); this.move(1); }
    else if (k === 'arrowup' || k === 'w') { e.preventDefault(); this.move(-1); }
    else if (k === 'escape') this.cancel();
    else if ((k === 'enter' || k === ' ') && !(document.activeElement && document.activeElement.classList.contains('ts-item'))) { e.preventDefault(); this.activate(); }
  }

  // ---------------------------------------------------------------- leaving
  begin(fresh) {
    if (this.leaving || !this.isReady) return;
    this.leaving = true;
    this.timers.forEach(clearTimeout); this.timers = [];
    const o = this.opts;
    if (o.onGesture) o.onGesture();   // sound has to start inside the click or key press
    this.el.classList.add('b2', 'b3', 'b4', 'is-leaving');
    const cover = this.reduced ? 0 : 1000;
    setTimeout(() => {
      o.onBegin(fresh);
      this.el.classList.add('is-gone');
      setTimeout(() => this.dispose(), 1600);
    }, cover);
  }
  dispose() {
    this.gone = true;
    this.el.hidden = true;
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('keydown', this._key);
  }
}
