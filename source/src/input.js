// Mouse / keyboard / touch input → normalized flight controls.
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
  get lens() { return this.lensMouse || this.lensKey || this.lensTouch; }
  read() {
    const k = this.keys;
    let roll = 0, pitch = 0;
    const dz = (v, d = 0.07) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    if (this.mode === 'keys') {
      roll = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      pitch = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
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
      aimX: this.mode === 'touch' ? this.touchX : this.aimX,
      aimY: this.mode === 'touch' ? this.touchY : this.aimY,
      lensSteers: !lensAim || this.mode === 'keys',
    };
  }
}
