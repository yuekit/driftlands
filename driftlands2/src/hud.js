// Interface: title menu, flight display, subtitles, pause and settings, and the drawn overlay (reticle, brackets, arrows).
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const COL = { chord: '#7fe9d6', sun: '#ffad7a', alarm: '#ff6a4a', bone: '#f2e9dc' };

export class UI {
  constructor() {
    this.root = $('dl-root'); this.ov = $('dl-overlay'); this.ctx = this.ov.getContext('2d');
    this.subQ = []; this.subT = 0; this.hintT = 0; this.cardT = 0; this.warnT = 0;
    this.dpr = 1;
  }
  progress(p, text) { $('load-bar').style.width = Math.round(p * 100) + '%'; if (text) $('load-text').textContent = text; }
  fatal(msg) { const f = $('fatal'); f.hidden = false; f.textContent = msg; }
  // ---------------------------------------------------------------- title
  ready(game) {
    this.g = game;
    $('title').classList.remove('loading');
    this.menu();
    $('pause-btn').addEventListener('click', () => game.pause(true));
    const hold = (id, key) => { const b = $(id); const set = (v) => (e) => { e.preventDefault(); game.input.touch[key] = v; b.classList.toggle('held', v); }; b.addEventListener('touchstart', set(true), { passive: false }); b.addEventListener('touchend', set(false)); b.addEventListener('touchcancel', set(false)); };
    hold('t-fire', 'fire'); hold('t-boost', 'boost');
    $('t-bell').addEventListener('touchstart', (e) => { e.preventDefault(); game.input.touch.bell = true; }, { passive: false });
    window.addEventListener('touchstart', () => this.root.classList.add('touch'), { once: true, passive: true });
    window.addEventListener('mousemove', () => this.root.classList.remove('pad'), { passive: true });
  }
  // ---------------------------------------------------------------- menus by gamepad
  // The mouse, touch and the Tab key already work on the buttons themselves. A gamepad steps through whichever menu is
  // up with the D-pad or the stick, A presses the chosen button, B goes back, and Start takes the main choice.
  nav(inp) {
    const g = this.g;
    if (!g || !(inp.navX || inp.navY || inp.padConfirm || inp.back || inp.padStart)) return;
    const paused = !$('pause').hidden;
    const panel = paused ? $('pause') : !$('end').hidden ? $('end') : g.state === 'title' ? $('t-menu') : null;
    if (!panel) return;
    const list = () => [...panel.querySelectorAll('button:not([disabled])')];
    let items = list(); if (!items.length) return;
    this.root.classList.add('pad');
    let i = items.indexOf(document.activeElement);
    const main = () => Math.max(0, items.findIndex((b) => b.classList.contains('primary')));
    if (inp.back && paused) {
      if (g.state === 'title') this.pause(false); else if (this.tab !== 'pause') this.pause(true, 'pause'); else g.pause(false);
    } else if (inp.padConfirm || (inp.padStart && !paused)) {
      if (i < 0 || inp.padStart) i = main();
      items[i].click();
    } else if (inp.navX || inp.navY) {
      if (i < 0) i = main();
      else if (inp.navY) {
        // up and down go to the nearest button in the next row; a menu that is all one row is stepped along instead
        const r = items.map((b) => b.getBoundingClientRect()), cx = (k) => r[k].left + r[k].width / 2, cy = (k) => r[k].top + r[k].height / 2, dir = -inp.navY;
        let best = -1, bd = 1e9;
        items.forEach((b, k) => { const dy = (cy(k) - cy(i)) * dir; if (dy > 6) { const d = dy * 4 + Math.abs(cx(k) - cx(i)); if (d < bd) { bd = d; best = k; } } });
        i = best >= 0 ? best : items.some((b, k) => Math.abs(cy(k) - cy(i)) > 6) ? i : (i + dir + items.length) % items.length;
      } else i = (i + inp.navX + items.length) % items.length;
      items[i].focus();
      return;
    } else return;
    // the press may have rebuilt the menu or closed it: keep a button chosen if it is still up, let go of it if not
    const still = panel === $('t-menu') ? g.state === 'title' && $('pause').hidden && $('title').style.opacity !== '0' : !panel.hidden;
    if (!still) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (!$('pause').hidden) { const b = $('pause').querySelector('button.primary') || $('pause').querySelector('button:not([disabled])'); if (b) b.focus(); } return; }
    if (!panel.contains(document.activeElement) || document.activeElement.disabled) { items = list(); if (items.length) items[inp.back ? main() : Math.min(Math.max(i, 0), items.length - 1)].focus(); }
  }
  menu() {
    const g = this.g, m = $('t-menu'); m.textContent = '';
    const add = (label, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = label; b.addEventListener('click', fn); m.appendChild(b); return b; };
    const reached = g.save.reached || 0;
    if (reached > 0 && reached < g.chapters.length) add(`Continue · ${g.chapters[reached].title}`, () => g.begin(reached), true);
    add(reached > 0 ? 'New voyage' : 'Cast off', () => g.begin(0), !(reached > 0 && reached < g.chapters.length));
    if (reached > 0) add('Chapters', () => this.pause(true, 'chapters'));
    if (g.save.finished) add('Fly free', () => g.begin(-1));
    add('Settings', () => this.pause(true, 'settings'));
    add('How to fly', () => this.pause(true, 'keys'));
  }
  showTitle(on) { const t = $('title'); t.style.opacity = on ? 1 : 0; t.style.pointerEvents = on ? '' : 'none'; if (!on && t.contains(document.activeElement)) document.activeElement.blur(); if (on) { t.hidden = false; this.menu(); } else setTimeout(() => { if (t.style.opacity === '0') t.hidden = true; }, 950); this.root.classList.toggle('menu', on); }
  showHUD(on) { $('hud').classList.toggle('on', on); }
  // ---------------------------------------------------------------- words on screen
  objective(k, t, done = 0, total = 0) {
    $('o-k').textContent = k; $('o-t').textContent = t;
    const p = $('o-p'); p.textContent = '';
    for (let i = 0; i < total; i++) { const b = document.createElement('b'); if (i < done) b.className = 'on'; p.appendChild(b); }
  }
  say(who, text, dur) { this.subQ.push({ who, text, dur: dur || Math.max(3.2, 1.6 + text.length * 0.058) }); }
  clearSay() { this.subQ.length = 0; this.subT = 0; $('sub').classList.remove('on'); }
  hint(html, dur = 7) { const h = $('hint'); h.innerHTML = html; h.classList.add('on'); this.hintT = dur; }
  card(n, h, s, dur = 5) { $('c-n').textContent = n; $('c-h').textContent = h; $('c-s').textContent = s; $('card').classList.add('on'); this.cardT = dur; }
  warn(text, dur = 2.5) { const w = $('warn'); w.textContent = text; w.classList.add('on'); this.warnT = dur; }
  get talking() { return this.subT > 0 || this.subQ.length > 0; }
  tick(dt) {
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) { $('sub').classList.remove('on'); this.subGap = 0.35; } }
    else if (this.subQ.length) {
      this.subGap = (this.subGap || 0) - dt;
      if (this.subGap <= 0) {
        const s = this.subQ.shift(), el = $('sub');
        $('s-who').textContent = s.who; $('s-line').textContent = s.text;
        el.className = 'on ' + (s.who.startsWith('Wren') ? 'wren' : s.who.startsWith('The') ? 'city' : '');
        // when lines are waiting (the player got ahead of the script) each one is held a shorter time
        this.subT = s.dur * (this.subQ.length >= 3 ? 0.6 : this.subQ.length >= 1 ? 0.82 : 1);
        if (this.g && this.g.audio) this.g.audio.blip(s.who.startsWith('Wren') ? 1 : s.who.startsWith('The') ? 2 : 0);
      }
    }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hint').classList.remove('on'); }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) $('card').classList.remove('on'); }
    if (this.warnT > 0) { this.warnT -= dt; if (this.warnT <= 0) $('warn').classList.remove('on'); }
  }
  // ---------------------------------------------------------------- gauges (20 Hz)
  update(g) {
    const s = g.ship, c = g.combat;
    const hull = s.hull / s.maxHull;
    $('g-hull').classList.toggle('low', hull < 0.35);
    $('g-hull').querySelector('i').style.transform = `scaleX(${hull.toFixed(3)})`;
    $('g-hull-t').textContent = Math.ceil(s.hull);
    $('g-drive').querySelector('i').style.transform = `scaleX(${s.energy.toFixed(3)})`;
    const bell = 1 - c.bellT / c.bellCd;
    $('g-bell').querySelector('i').style.transform = `scaleX(${bell.toFixed(3)})`;
    $('g-bell').classList.toggle('ready', bell >= 1);
    $('g-bell-t').textContent = bell >= 1 ? 'Ready' : Math.ceil(c.bellT) + ' s';
    $('i-speed').textContent = Math.round(s.speed * 1.944);
    const hurt = Math.max(0, g.hurtT || 0);
    $('vig').style.boxShadow = `inset 0 0 ${160 + 80 * (1 - hull)}px ${30 + 50 * hurt}px rgba(255, 70, 40, ${(Math.max(hurt * 0.5, hull < 0.35 ? 0.16 + 0.08 * Math.sin(performance.now() / 180) : 0)).toFixed(3)})`;
  }
  // ---------------------------------------------------------------- drawn overlay
  resize() {
    const w = this.ov.clientWidth, h = this.ov.clientHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    if (this.ov.width !== Math.round(w * d) || this.ov.height !== Math.round(h * d)) { this.ov.width = Math.round(w * d); this.ov.height = Math.round(h * d); }
    this.dpr = d; this.w = w; this.h = h;
  }
  project(p, cam) { _v.copy(p).project(cam); return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, behind: _v.z > 1, on: _v.z <= 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1 }; }
  draw(g) {
    this.resize();
    const c = this.ctx, w = this.w, h = this.h, cam = g.camera;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (g.state !== 'play' || g.cine) return;
    const half = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
    c.lineWidth = 1.5; c.lineCap = 'round';
    const bracket = (x, y, r, col, a = 1) => {
      c.strokeStyle = col; c.globalAlpha = a; const k = r * 0.45;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(x + sx * r, y + sy * (r - k)); c.lineTo(x + sx * r, y + sy * r); c.lineTo(x + sx * (r - k), y + sy * r); }
      c.stroke(); c.globalAlpha = 1;
    };
    const arrow = (p, col, label) => {
      // an arrow on the rim of the screen pointing at something out of view
      let dx = p.x - cx, dy = p.y - cy; if (p.behind) { dx = -dx; dy = -dy; }
      const a = Math.atan2(dy, dx), rx = w / 2 - 34, ry = h / 2 - 34, t = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
      const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t;
      c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = col; c.beginPath(); c.moveTo(11, 0); c.lineTo(-6, -7); c.lineTo(-2, 0); c.lineTo(-6, 7); c.closePath(); c.fill(); c.restore();
      if (label) { c.fillStyle = col; c.font = '500 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText(label, Math.max(40, Math.min(w - 40, x - Math.cos(a) * 26)), Math.max(20, Math.min(h - 12, y - Math.sin(a) * 26 + 4))); }
    };
    const dist = (p) => { const d = p.distanceTo(g.ship.pos); return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'; };
    const pxR = (p, r) => { const d = p.distanceTo(cam.position); return Math.max(9, r / (d * Math.tan(cam.fov * Math.PI / 360)) * h * 0.5); };
    // enemies
    let offN = 0;
    for (const e of g.combat.enemies()) {
      if (!e.alive) continue;
      const p = this.project(e.pos, cam), obj = e.objective;
      if (p.on) {
        const r = pxR(e.pos, e.r) + 4;
        if (obj) {
          c.strokeStyle = COL.sun; c.globalAlpha = 0.95; c.beginPath(); c.moveTo(p.x, p.y - r - 8); c.lineTo(p.x + r + 8, p.y); c.lineTo(p.x, p.y + r + 8); c.lineTo(p.x - r - 8, p.y); c.closePath(); c.stroke(); c.globalAlpha = 1;
          c.fillStyle = 'rgba(18,15,25,0.6)'; c.fillRect(p.x - 26, p.y - r - 22, 52, 4); c.fillStyle = COL.sun; c.fillRect(p.x - 26, p.y - r - 22, 52 * Math.max(0, e.hp / e.maxHp), 4);
          c.font = '500 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText(dist(e.pos), p.x, p.y + r + 26);
        } else bracket(p.x, p.y, r, COL.alarm, e === g.aim.target ? 1 : 0.55);
      } else if (obj) arrow(p, COL.sun, dist(e.pos));
      else if (offN++ < 5 && e.pos.distanceTo(g.ship.pos) < 700) arrow(p, COL.alarm);
    }
    // places to go
    for (const m of g.markers) {
      const p = this.project(m.pos, cam);
      if (p.on) {
        c.strokeStyle = COL.sun; c.fillStyle = COL.sun; c.beginPath(); c.arc(p.x, p.y, 9, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(p.x, p.y, 2.5, 0, Math.PI * 2); c.fill();
        c.font = '500 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillText((m.label ? m.label + ' · ' : '') + dist(m.pos), p.x, p.y + 28);
      } else arrow(p, COL.sun, dist(m.pos));
    }
    // lock and lead
    const A = g.aim;
    if (A.target && A.target.alive) {
      const p = this.project(A.target.pos, cam), r = pxR(A.target.pos, A.target.r) + 9;
      if (p.on) { bracket(p.x, p.y, r, COL.chord, 1); const l = this.project(A.lead, cam); if (l.on) { c.strokeStyle = COL.chord; c.beginPath(); c.moveTo(l.x, l.y - 6); c.lineTo(l.x + 6, l.y); c.lineTo(l.x, l.y + 6); c.lineTo(l.x - 6, l.y); c.closePath(); c.stroke(); } }
    }
    // reticle
    const rx = cx + A.x * half, ry = cy - A.y * half, fire = g.firing ? 1 : 0;
    c.strokeStyle = COL.chord; c.globalAlpha = 0.95;
    c.beginPath(); c.arc(rx, ry, 13 + fire * 2 * Math.sin(performance.now() / 30), 0, Math.PI * 2); c.stroke();
    c.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; c.moveTo(rx + Math.cos(a) * 18, ry + Math.sin(a) * 18); c.lineTo(rx + Math.cos(a) * 25, ry + Math.sin(a) * 25); } c.stroke();
    c.fillStyle = COL.chord; c.beginPath(); c.arc(rx, ry, 1.8, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.25; c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
    // hit confirm
    if (g.hitMark > 0) { c.strokeStyle = COL.bone; c.globalAlpha = Math.min(1, g.hitMark * 5); const s = 9 + (g.killMark > 0 ? 5 : 0); c.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(rx + sx * s * 0.45, ry + sy * s * 0.45); c.lineTo(rx + sx * s, ry + sy * s); } c.stroke(); c.globalAlpha = 1; }
    // where a hit came from
    for (const d of g.dmgDirs) { c.strokeStyle = COL.alarm; c.globalAlpha = Math.min(1, d.t * 1.5); c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, half * 0.42, d.a - 0.22, d.a + 0.22); c.stroke(); c.lineWidth = 1.5; c.globalAlpha = 1; }
  }
  // ---------------------------------------------------------------- pause, settings, chapters
  pause(on, tab = 'pause') {
    const g = this.g, el = $('pause');
    el.hidden = !on; this.root.classList.toggle('menu', on || g.state === 'title'); this.tab = tab;
    if (!on) return;
    const body = $('p-body'); body.textContent = '';
    const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; body.appendChild(d); return d; };
    const btn = (parent, label, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = label; b.addEventListener('click', fn); parent.appendChild(b); return b; };
    const inTitle = g.state === 'title';
    $('pause-h').textContent = tab === 'chapters' ? 'Chapters' : tab === 'keys' ? 'How to fly' : tab === 'settings' && inTitle ? 'Settings' : 'Paused';
    if (tab === 'chapters') {
      const list = document.createElement('div'); list.className = 'chap'; body.appendChild(list);
      g.chapters.forEach((ch, i) => { const b = btn(list, '', () => { this.pause(false); g.begin(i); }); b.innerHTML = `<span>${ch.numeral} · ${ch.title}</span><span class="label">${ch.sub}</span>`; b.disabled = i > (g.save.reached || 0); });
    } else if (tab === 'keys') {
      h(`<div class="keys">
        <kbd>Mouse</kbd><span>Move the ring. The ship turns toward it and the lances fire at it.</span>
        <kbd>W A S D</kbd><span>Steer without the mouse (arrow keys too).</span>
        <kbd>Click</kbd><span>Hold to fire the chord lances. Space works too.</span>
        <kbd>Right click · E</kbd><span>Ring the Bell: a shockwave that breaks Tenders and their bolts nearby.</span>
        <kbd>Shift</kbd><span>Open the drive for speed, while the gauge lasts.</span>
        <kbd>Ctrl · C</kbd><span>Slow down for tight places and for landing.</span>
        <kbd>Esc · P</kbd><span>Pause.</span>
        <kbd>Gamepad</kbd><span>Left stick steers, right trigger fires, A drives, B slows, X rings the Bell, Start pauses. In menus: D-pad or stick, A to choose, B to go back.</span></div>`);
    } else {
      const S = g.settings, opts = document.createElement('div'); opts.className = 'opts'; body.appendChild(opts);
      const seg = (label, key, vals) => { const o = document.createElement('div'); o.className = 'opt'; o.innerHTML = `<span>${label}</span>`; const s = document.createElement('div'); s.className = 'seg'; o.appendChild(s); opts.appendChild(o);
        for (const [v, name] of vals) { const b = btn(s, name, () => { g.setSetting(key, v); this.pause(true, tab); }); b.setAttribute('aria-pressed', String(S[key] === v)); } };
      seg('Picture', 'quality', [['low', 'Low'], ['auto', 'Auto'], ['high', 'High']]);
      seg('Style', 'style', [['ink', 'Ink plate'], ['paint', 'Painted']]);
      seg('Sound', 'sound', [[true, 'On'], [false, 'Off']]);
      seg('Climb with', 'invert', [[false, 'Up'], [true, 'Down']]);
      seg('Motion blur', 'blur', [[true, 'On'], [false, 'Off']]);
      seg('Camera shake', 'shake', [[true, 'On'], [false, 'Off']]);
    }
    const row = document.createElement('div'); row.className = 'rowb'; body.appendChild(row);
    if (inTitle) btn(row, 'Close', () => this.pause(false), 'primary');
    else if (tab !== 'pause') btn(row, 'Back', () => this.pause(true, 'pause'), 'primary');
    if (!inTitle && tab === 'pause') {
      btn(row, 'Resume', () => g.pause(false), 'primary');
      btn(row, 'Restart from checkpoint', () => { g.pause(false); g.restart(); });
      btn(row, 'How to fly', () => this.pause(true, 'keys'));
      btn(row, 'Leave for the title', () => { g.pause(false); g.toTitle(); });
    }
  }
  end(on, quote, by, credits, buttons = []) {
    const el = $('end'); el.hidden = !on; this.root.classList.toggle('menu', on);
    if (!on) { el.classList.remove('on'); return; }
    $('e-q').textContent = quote; $('e-by').textContent = by; $('e-cr').innerHTML = credits;
    const b = $('e-btn'); b.textContent = '';
    for (const [label, fn, primary] of buttons) { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn' + (primary ? ' primary' : ''); x.textContent = label; x.addEventListener('click', fn); b.appendChild(x); }
    requestAnimationFrame(() => el.classList.add('on'));
  }
}
