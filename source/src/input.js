// Mouse / keyboard / touch / gamepad input → normalized flight controls.
export class Input {
  constructor(el) {
    this.el = el;
    this.aimX = 0; this.aimY = 0; // mouse position from centre, -1..1 (up positive)
    this.keys = new Set();
    this.lensMouse = false; this.lensKey = false; this.lensTouch = false;
    this.launchQueued = false;
    this.mode = 'mouse';
    this.active = false; // mouse inside the window
    this.touchStick = null; this.touchX = 0; this.touchY = 0;
    this.invert = false;
    // gamepad (standard mapping): left stick flies, right stick aims the lens or looks around
    this.pad = null; this.padPrev = []; this.padStick = [0, 0]; this.padLook = [0, 0]; this.padAim = [0, 0];
    this.lensPad = false; this.padEvents = {}; this.padTrig = [0, 0]; this.lastRead = performance.now();
    window.addEventListener('gamepadconnected', () => { this.mode = 'pad'; });
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width, r.height) * 0.5;
      this.aimX = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / s));
      this.aimY = Math.max(-1, Math.min(1, -(e.clientY - r.top - r.height / 2) / s));
      this.mode = 'mouse'; this.active = true;
    };
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') onMove(e); });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      onMove(e);
      if (e.button === 2) this.lensMouse = true;
      if (e.button === 0) this.launchQueued = true;
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 2) this.lensMouse = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mouseleave', () => { this.active = false; });
    window.addEventListener('blur', () => { this.keys.clear(); this.lensMouse = false; this.lensKey = false; });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) this.mode = 'keys';
      if (k === ' ' || k === 'shift' || k === 'e') this.lensKey = true;
      if (k === 'w' || k === 'arrowup' || k === 'enter') this.launchQueued = true;
      if (k === 'f') this.shutterQueued = true;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ' || k === 'shift' || k === 'e') this.lensKey = false;
    });
    // touch: left 2/3 of the screen is a floating stick
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (!this.touchStick) { this.touchStick = { id: t.identifier, x: t.clientX, y: t.clientY }; this.touchX = 0; this.touchY = 0; this.launchQueued = true; }
      }
      this.mode = 'touch';
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (this.touchStick && t.identifier === this.touchStick.id) {
        const s = Math.min(window.innerWidth, window.innerHeight) * 0.22;
        this.touchX = Math.max(-1, Math.min(1, (t.clientX - this.touchStick.x) / s));
        this.touchY = Math.max(-1, Math.min(1, -(t.clientY - this.touchStick.y) / s));
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (this.touchStick && t.identifier === this.touchStick.id) { this.touchStick = null; this.touchX = 0; this.touchY = 0; } };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  get lens() { return this.lensMouse || this.lensKey || this.lensTouch || this.lensPad; }
  pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null;
    for (const g of pads) if (g && g.connected) { p = g; break; }
    this.pad = p;
    if (!p) { this.padEvents = {}; this.lensPad = false; return; }
    const ax = (i) => { const v = p.axes[i] || 0; return Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86; };
    const val = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
    const now = p.buttons.map((b, i) => val(i) > 0.35);
    const prev = this.padPrev;
    const down = (i) => now[i] && !prev[i];
    this.padPrev = now;
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.25 || now.some(Boolean)) this.mode = 'pad';
    this.padStick = [lx, -ly]; this.padLook = [rx, -ry]; this.padTrig = [val(6), val(7)];
    this.lensPad = now[4] || now[6];
    // the right stick moves the lens aim while it is up, and drifts back to centre when it is down
    if (this.lensPad) { this.padAim[0] = Math.max(-1, Math.min(1, this.padAim[0] + rx * dt * 1.4)); this.padAim[1] = Math.max(-1, Math.min(1, this.padAim[1] - ry * dt * 1.1)); }
    else { this.padAim[0] *= Math.exp(-dt * 6); this.padAim[1] *= Math.exp(-dt * 6); }
    if (down(0)) this.launchQueued = true;                 // A: launch, or take the photo with the lens up
    if (down(0) && this.lensPad) this.shutterQueued = true;
    if (down(7) || down(5)) this.shutterQueued = true;     // RT / RB: shutter
    this.padEvents = { a: down(0), b: down(1), x: down(2), y: down(3), back: down(8), start: down(9), up: down(12), down: down(13), left: down(14), right: down(15) };
  }
  // rumble on pads that support it (Chrome, Edge; Safari ignores it)
  rumble(strong, weak = strong, ms = 160) {
    const a = this.pad && this.pad.vibrationActuator;
    if (!a || this.mode !== 'pad') return;
    try { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch { /* unsupported */ }
  }
  read() {
    const t = performance.now(), dt = Math.min(0.1, (t - this.lastRead) / 1000); this.lastRead = t;
    this.pollPad(dt);
    const k = this.keys;
    let roll = 0, pitch = 0;
    const dz = (v, d = 0.07) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    if (this.mode === 'keys') {
      roll = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      pitch = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    } else if (this.mode === 'pad') {
      roll = this.padStick[0]; pitch = this.padStick[1];
    } else if (this.mode === 'touch') {
      roll = dz(this.touchX); pitch = dz(this.touchY);
    } else {
      roll = dz(this.aimX) * 1.15; pitch = dz(this.aimY) * 1.25;
    }
    if (this.invert) pitch = -pitch;
    roll = Math.max(-1, Math.min(1, roll)); pitch = Math.max(-1, Math.min(1, pitch));
    const launch = this.launchQueued; this.launchQueued = false;
    const shutter = !!this.shutterQueued; this.shutterQueued = false;
    // while the lens is up the mouse aims the lens; keys still fly
    const lensAim = this.mode === 'mouse' || this.mode === 'keys';
    return {
      roll, pitch, launch, shutter, lens: this.lens,
      aimX: this.mode === 'touch' ? this.touchX : this.mode === 'pad' ? this.padAim[0] : this.aimX,
      aimY: this.mode === 'touch' ? this.touchY : this.mode === 'pad' ? this.padAim[1] : this.aimY,
      lookX: this.mode === 'pad' && !this.lensPad ? this.padLook[0] : 0, lookY: this.mode === 'pad' && !this.lensPad ? this.padLook[1] : 0,
      lensSteers: !lensAim || this.mode === 'keys' || this.mode === 'pad',
      pad: this.padEvents,
    };
  }
}
