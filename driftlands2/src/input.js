// Controls for the airship. Everything ends up as one aim point on screen: the ship turns toward it and the lances
// fire at it. Mouse moves it directly, keys and sticks push it, and it springs back when let go.
export const DEFAULT_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  fire: ['Space', 'KeyJ'], bell: ['KeyE', 'KeyK'], boost: ['ShiftLeft', 'ShiftRight'], brake: ['ControlLeft', 'KeyC', 'KeyX'], pause: ['Escape', 'KeyP'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.mouse = { x: 0, y: 0, l: false, r: false, moved: 0 };
    this.aim = { x: 0, y: 0 };            // -1..1 across the shorter half of the screen
    this.mode = 'mouse';                   // mouse | keys | pad | touch
    this.invert = false; this.pressed = new Set(); this.padPrev = {};
    this.touch = { stick: null, sx: 0, sy: 0, fire: false, boost: false, bell: false, brake: false };
    const on = (t, e, f, o) => t.addEventListener(e, f, o);
    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.isMove(e.code)) this.mode = 'keys';
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    on(canvas, 'mousemove', (e) => {
      const r = canvas.getBoundingClientRect(), h = Math.min(r.width, r.height) * 0.5;
      this.mouse.x = (e.clientX - r.left - r.width / 2) / h; this.mouse.y = -(e.clientY - r.top - r.height / 2) / h;
      this.mouse.moved = performance.now(); if (this.mode !== 'touch') this.mode = 'mouse';
    });
    on(canvas, 'mousedown', (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) { this.mouse.r = true; this.pressed.add('MouseR'); } });
    on(window, 'mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    // touch: left half is a stick that appears under the thumb; the buttons are real elements wired in the HUD
    const tp = (e) => {
      this.mode = 'touch';
      for (const t of e.changedTouches) {
        if (e.type === 'touchstart' && this.touch.stick === null && t.clientX < window.innerWidth * 0.5) { this.touch.stick = t.identifier; this.touch.ox = t.clientX; this.touch.oy = t.clientY; this.touch.sx = this.touch.sy = 0; }
        else if (t.identifier === this.touch.stick) {
          if (e.type === 'touchmove') { this.touch.sx = Math.max(-1, Math.min(1, (t.clientX - this.touch.ox) / 70)); this.touch.sy = Math.max(-1, Math.min(1, -(t.clientY - this.touch.oy) / 70)); }
          else { this.touch.stick = null; this.touch.sx = this.touch.sy = 0; }
        }
      }
      e.preventDefault();
    };
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) on(canvas, ev, tp, { passive: false });
    this.bind = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  }
  isMove(code) { const b = this.bind || DEFAULT_KEYS; return b.up.includes(code) || b.down.includes(code) || b.left.includes(code) || b.right.includes(code); }
  down(action) { return this.bind[action].some((k) => this.keys.has(k)); }
  hit(action) { return this.bind[action].some((k) => this.pressed.has(k)); }
  rumble(strong, weak, ms) {
    const p = this.pad; if (!p || !p.vibrationActuator) return;
    try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* optional */ }
  }
  read(dt = 1 / 60) {
    const out = { x: 0, y: 0, fire: false, bell: false, boost: false, brake: false, pause: false, aimX: 0, aimY: 0, lookX: 0, lookY: 0, any: false, confirm: false, back: false, navX: 0, navY: 0 };
    // gamepad
    let pad = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    this.pad = pad;
    let px = 0, py = 0;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
      px = dz(pad.axes[0]); py = -dz(pad.axes[1]);
      out.lookX = dz(pad.axes[2]); out.lookY = -dz(pad.axes[3]);
      const b = (i) => pad.buttons[i] && pad.buttons[i].pressed, was = this.padPrev, edge = (i) => { const d = b(i); const r = d && !was[i]; was[i] = d; return r; };
      if (px || py || b(7) || b(0)) this.mode = 'pad';
      out.fire = b(7) || b(5); out.boost = b(0) || b(10); out.brake = b(6) || b(1); out.bell = edge(2) || edge(4);
      out.pause = edge(9); out.confirm = edge(0); out.back = edge(1);
      out.navY = (edge(12) ? 1 : 0) - (edge(13) ? 1 : 0); out.navX = (edge(15) ? 1 : 0) - (edge(14) ? 1 : 0);
    }
    const kx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0), ky = (this.down('up') ? 1 : 0) - (this.down('down') ? 1 : 0);
    const A = this.aim;
    if (this.mode === 'mouse') { A.x = this.mouse.x; A.y = this.mouse.y; }
    else {
      const tx = this.mode === 'pad' ? px : this.mode === 'touch' ? this.touch.sx : kx, ty = this.mode === 'pad' ? py : this.mode === 'touch' ? this.touch.sy : ky;
      const k = Math.min(1, dt * (tx || ty ? 5 : 3.5));
      A.x += (tx * 0.8 - A.x) * k; A.y += (ty * 0.7 - A.y) * k;
    }
    const l = Math.hypot(A.x, A.y); if (l > 0.95) { A.x *= 0.95 / l; A.y *= 0.95 / l; }
    // steering from the aim point, with a dead zone in the middle
    const dzn = 0.07, m = Math.hypot(A.x, A.y), f = m > dzn ? Math.min(1, (m - dzn) / 0.62) / m : 0;
    out.x = A.x * f; out.y = A.y * f * (this.invert ? -1 : 1);
    out.aimX = A.x; out.aimY = A.y;
    out.fire = out.fire || this.down('fire') || this.mouse.l || this.touch.fire;
    out.bell = out.bell || this.hit('bell') || this.pressed.has('MouseR') || this.touch.bell;
    out.boost = out.boost || this.down('boost') || this.touch.boost;
    out.brake = out.brake || this.down('brake') || this.touch.brake;
    out.pause = out.pause || this.hit('pause');
    out.confirm = out.confirm || this.pressed.has('Enter') || this.pressed.has('Space');
    out.any = this.pressed.size > 0 || out.confirm;
    this.touch.bell = false;
    this.pressed.clear();
    return out;
  }
}
