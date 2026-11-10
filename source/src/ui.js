// DOM overlay: title, HUD, lens, journal, pause, ecologist notes.
import { oklchCss, NIGHT_TAGS, SPECIES } from './creatures.js';
import { WEATHER_TAGS } from './weather.js';
import { CONVERGENCES, convergenceFor } from './convergence.js';
import { ISLANDS } from './islands-sdf.js';
import { LETTERS, CREDITS } from './story.js';
import { KEY_ACTIONS, keyName } from './input.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.5l-5.1 2.9 1.1-5.8-4.3-4 5.8-.7z"/></svg>';
export const starsHtml = (n) => `<span class="stars" role="img" aria-label="${n} of 3 stars">${[1, 2, 3].map((i) => (i <= n ? STAR : STAR.replace('<svg', '<svg class="off"'))).join('')}</span>`;
const PLAN_TEXT = { walker: 'Walker on long jointed legs', sessile: 'Rooted, plant-like animal', flyer: 'Flapping glider', crawler: 'Many-legged surface crawler', drifter: 'Jet-pulsing air medusa', leviathan: 'Giant undulating flier' };

export class UI {
  constructor() {
    this.game = null;
    this.sel = 0;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) document.getElementById('dl-root').classList.add('touch');
    // lens ticks
    const ticks = $('ticks');
    let s = '';
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, l = i % 6 === 0 ? 7 : 3;
      s += `<line x1="${(Math.cos(a) * 99).toFixed(2)}" y1="${(Math.sin(a) * 99).toFixed(2)}" x2="${(Math.cos(a) * (99 - l)).toFixed(2)}" y2="${(Math.sin(a) * (99 - l)).toFixed(2)}"/>`;
    }
    ticks.innerHTML = s;
    this.labelEls = [];
    this.sampleP = null;
    try { if (window.claude && window.claude.use) this.sampleP = window.claude.use('sample').catch(() => null); } catch { this.sampleP = null; }
  }

  progress(p) {
    $('t-bar').style.width = `${Math.round(p * 100)}%`;
    $('t-load-text').textContent = p < 0.98 ? `Raising the islands · ${Math.round(p * 100)}%` : 'Seeding life';
  }
  fatal(msg) { const f = $('fatal'); f.textContent = msg; f.classList.add('on'); }

  ready(game) {
    this.game = game;
    $('t-load').hidden = true;
    $('t-actions').hidden = false;
    const n = Object.keys(game.j.recorded).length;
    if (game.j.started && n > 0) { $('t-start').textContent = game.j.ended ? 'Continue · survey complete' : `Continue journal · ${n} of ${SPECIES.length}`; $('t-new').hidden = false; }
    $('t-start').focus({ preventScroll: true });
    $('t-start').onclick = () => this.startGame();
    $('t-new').onclick = () => { game.newJournal(); $('t-start').textContent = 'Begin flight'; $('t-new').hidden = true; };
    $('jbadge').onclick = () => game.openJournal(true);
    $('goal-skip').onclick = () => game.guide.skip();
    $('j-close').onclick = () => game.openJournal(false);
    $('p-resume').onclick = () => game.pause(false);
    $('p-journal').onclick = () => { game.pause(false); game.openJournal(true); };
    $('p-photo').onclick = () => game.photo.enter();
    this.bindNew();
    this.jtab = 'plates'; this.lsel = 0;
    $('jt-plates').onclick = () => this.setTab('plates');
    $('jt-letters').onclick = () => this.setTab('letters');
    $('p-keys').onclick = () => this.showKeys(true);
    $('keys-done').onclick = () => this.showKeys(false);
    $('keys-reset').onclick = () => { game.resetKeys(); this.renderKeys(); this.keyLabels(); $('keys-note').textContent = 'Keys reset.'; };
    $('p-ending').onclick = () => game.startEnding(true);
    $('e-next').onclick = () => this.endingAdvance(false);
    $('e-fly').onclick = () => this.endingAdvance(false);
    this.keyLabels();
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.set;
      seg.querySelectorAll('button').forEach((b) => b.onclick = () => {
        let v = b.dataset.v; if (v === 'true') v = true; else if (v === 'false') v = false;
        game.setSetting(key, v); this.syncSettings();
      });
    });
    this.syncSettings();
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (game.state === 'title' && (k === 'enter')) { this.startGame(); return; }
      if (game.state === 'ending') { if (k === 'enter' || k === ' ' || k === 'escape') { e.preventDefault(); this.endingAdvance(k === 'escape'); } return; }
      if (k === game.input.bind.journal || k === 'tab') { e.preventDefault(); if (game.state === 'journal') game.openJournal(false); else if (game.state === 'play') game.openJournal(true); }
      if (k === 'escape') { if (game.state === 'journal') game.openJournal(false); else if (game.state === 'play') game.pause(true); else if (game.state === 'paused') game.pause(false); }
      if (game.state === 'journal' && (k === 'arrowdown' || k === 'arrowup')) { e.preventDefault(); this.step(k === 'arrowdown' ? 1 : -1); }
      if (game.state === 'journal' && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); this.setTab(this.jtab === 'plates' ? 'letters' : 'plates'); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'play') game.pause(true); });
    // touch lens button
    const lb = $('lens-btn');
    const on = (e) => { e.preventDefault(); e.stopPropagation(); game.input.lensTouch = true; lb.classList.add('on'); };
    const off = (e) => { e.preventDefault(); game.input.lensTouch = false; lb.classList.remove('on'); };
    lb.addEventListener('touchstart', on, { passive: false }); lb.addEventListener('touchend', off); lb.addEventListener('touchcancel', off);
    if (this.isTouch) { $('jkey').hidden = true; }
    $('pause-btn').onclick = () => game.pause(true);
  }
  bindNew() {
    const wrap = $('p-newwrap');
    $('p-new').onclick = () => {
      wrap.innerHTML = '<span>Erase every entry and start over?</span><button class="btn small" type="button" id="p-new-yes">Erase and restart</button><button class="linkish" type="button" id="p-new-no">Keep my journal</button>';
      $('p-new-yes').onclick = () => { this.game.newJournal(); this.restoreNew(); this.toast('A fresh journal. The islands are back where they started.'); this.game.pause(false); };
      $('p-new-no').onclick = () => this.restoreNew();
    };
  }
  restoreNew() { $('p-newwrap').innerHTML = '<button class="linkish" type="button" id="p-new">Start a new journal</button>'; this.bindNew(); }
  syncSettings() {
    const s = this.game.settings;
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.set;
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(String(s[key]) === b.dataset.v)));
    });
  }
  startGame() {
    if (!this.game || this.game.state !== 'title') return;
    $('title').classList.add('out');
    setTimeout(() => { $('title').hidden = true; }, 900);
    this.game.begin();
    $('dl-canvas').focus && $('dl-canvas').focus();
  }
  showHUD(on) { $('hud').classList.toggle('on', on); }

  // ---------------------------------------------------------------- transient messages
  hint(text) {
    const h = $('hint');
    this.hintQ = this.hintQ || [];
    this.hintQ.push(text);
    if (this.hintBusy) return;
    const next = () => {
      const t = this.hintQ.shift();
      if (!t) { this.hintBusy = false; return; }
      this.hintBusy = true;
      h.textContent = t; h.classList.add('on');
      setTimeout(() => { h.classList.remove('on'); setTimeout(next, 700); }, 6200);
    };
    next();
  }
  toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 4200);
  }
  event(head, body, kicker = 'The islands are moving', ms = 7000) {
    $('event-k').textContent = kicker;
    $('event-h').textContent = head; $('event-b').textContent = body;
    const e = $('event'); e.classList.add('on');
    clearTimeout(this.eventT); this.eventT = setTimeout(() => e.classList.remove('on'), ms);
  }
  // a page of the old notebook, picked up at a cairn
  found(pg, key) {
    this.event(pg.title, `${pg.from}. ${this.game.input.mode === 'pad' ? 'Press Y' : this.game.input.mode === 'touch' ? 'Tap the journal' : 'Press ' + key} to read it.`, 'A page under the cairn', 8000);
    this.jtabNext = 'letters'; this.lsel = LETTERS.indexOf(pg);
  }
  // key names on the title screen and in the panels follow the bindings
  keyLabels() {
    const g = this.game, k = (a) => g.key(a);
    $('k-fly').textContent = `${k('up')} ${k('left')} ${k('down')} ${k('right')}`;
    $('k-lens').textContent = k('lens'); $('k-shutter').textContent = `Click · ${k('shutter')}`;
    $('k-journal').textContent = k('journal'); $('k-photo').textContent = k('photo');
    $('jkey').textContent = k('journal'); $('j-close-k').textContent = k('journal');
    $('ph-leave').textContent = `${k('photo')} to leave`;
  }
  showKeys(on) {
    $('p-opts').hidden = on; $('p-keys-panel').hidden = !on;
    this.game.input.rebind = null;
    if (on) { this.renderKeys(); $('keys-note').textContent = 'Choose an action, then press the key you want for it.'; }
    else $('p-keys').focus({ preventScroll: true });
  }
  renderKeys() {
    const g = this.game;
    $('keys-list').innerHTML = KEY_ACTIONS.map(([a, label]) => `<span>${label}</span><button class="key" type="button" data-act="${a}">${esc(g.key(a))}</button>`).join('');
    $('keys-list').querySelectorAll('button.key').forEach((b) => b.onclick = () => {
      this.renderKeys();
      const nb = $('keys-list').querySelector(`[data-act="${b.dataset.act}"]`);
      nb.classList.add('wait'); nb.textContent = 'Press a key'; nb.focus({ preventScroll: true });
      $('keys-note').textContent = 'Waiting for a key. Escape cancels.';
      g.input.rebind = (key) => {
        if (key === 'escape') { this.renderKeys(); $('keys-note').textContent = 'Cancelled.'; return; }
        const err = g.rebind(b.dataset.act, key);
        this.renderKeys(); this.keyLabels();
        $('keys-note').textContent = err || `${KEY_ACTIONS.find((x) => x[0] === b.dataset.act)[1]} is now ${keyName(key)}.`;
      };
    });
  }
  recorded(sp, n, total, stars = 1) {
    $('rec-lat').textContent = sp.latin; $('rec-com').innerHTML = `${esc(sp.common)} · ${n} of ${total} · <span style="color:var(--sun)">${starsHtml(stars)}</span>`;
    const r = $('record'); r.classList.add('on');
    clearTimeout(this.recT); this.recT = setTimeout(() => r.classList.remove('on'), 3600);
    this.newPip = sp.id;
  }
  updateJournalBadge(j) {
    const ids = SPECIES.map((s) => s.id);
    $('pips').innerHTML = ids.map((id) => `<i class="${j.recorded[id] ? (this.newPip === id ? 'new' : 'on') : ''}"></i>`).join('');
    const unread = LETTERS.filter((l) => j.letters && j.letters[l.id] && !(j.read && j.read[l.id]));
    $('jmail').classList.toggle('on', unread.length > 0);
    if (unread.length) $('jmail-t').textContent = unread.length > 1 ? `${unread.length} unread` : unread[0].kind === 'page' ? 'New page' : 'New letter';
  }

  // ---------------------------------------------------------------- per-frame HUD
  clock(ph, mode) {
    const NAMES = { day: 'Golden hour', dusk: 'Dusk', night: 'Night', dawn: 'Dawn' };
    const NEXT = { day: 'Dusk', dusk: 'Night', night: 'Dawn', dawn: 'Golden hour' };
    const LEN = { day: 300, dusk: 55, night: 160, dawn: 55 };
    $('clock-ph').textContent = NAMES[ph.name];
    const m = Math.ceil(ph.left / 60);
    $('clock-nx').textContent = mode !== 'cycle' ? 'Held in settings' : ph.left > 60 ? `${NEXT[ph.name]} in ${m} min` : `${NEXT[ph.name]} soon`;
    const f = mode !== 'cycle' ? 1 : 1 - ph.left / LEN[ph.name];
    const a = f * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * 11.5, y = Math.sin(a) * 11.5;
    $('clock-arc').setAttribute('d', f > 0.999 ? 'M0 -11.5 A11.5 11.5 0 1 1 -0.01 -11.5' : `M0 -11.5 A11.5 11.5 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
    const night = ph.name === 'night';
    const c = night ? '#9fb8ff' : ph.name === 'day' ? '#ffad7a' : '#ff8a6a';
    $('clock-arc').setAttribute('stroke', c);
    const dot = $('clock-dot'); dot.setAttribute('fill', c); dot.setAttribute('r', night ? 2.6 : 3.4);
  }

  hud(h) {
    this.goal(h.goal);
    if (h.phase) this.clock(h.phase, h.timeMode);
    if (h.weather !== this.wxText) { this.wxText = h.weather; const w = $('wx'); if (h.weather) w.textContent = h.weather; w.hidden = !h.weather; }
    $('i-alt').textContent = Math.round(h.alt);
    const v = $('i-vario');
    v.textContent = (h.climb >= 0 ? '+' : '') + h.climb.toFixed(1);
    v.className = 'v ' + (h.climb > 0.5 ? 'up' : 'down');
    $('i-speed').textContent = Math.round(h.perched ? 0 : h.speed);
    $('i-speed').className = 'v' + (h.stall > 0.3 ? ' stall' : '');
    // cursor + tether
    const W = window.innerWidth, H = window.innerHeight, S = Math.min(W, H) * 0.5;
    const showCur = h.mode === 'mouse' && h.lens < 0.3 && h.playing && !h.perched;
    const cx = W / 2 + h.aimX * S, cy = H / 2 - h.aimY * S;
    const cur = $('cursor'), tet = $('tether'), ret = $('reticle');
    cur.style.opacity = showCur ? 1 : 0; tet.style.opacity = showCur ? 1 : 0; ret.style.opacity = h.lens < 0.3 && h.playing ? 1 : 0;
    cur.style.transform = `translate(${cx}px, ${cy}px)`;
    const dx = cx - W / 2, dy = cy - H / 2, len = Math.hypot(dx, dy);
    tet.style.width = `${Math.max(0, len - 10)}px`;
    tet.style.transform = `translate(${W / 2}px, ${H / 2}px) rotate(${Math.atan2(dy, dx)}rad) translateX(10px)`;
    // island labels
    const box = $('labels');
    while (this.labelEls.length < h.labels.length * 2) { const d = document.createElement('div'); box.appendChild(d); this.labelEls.push(d); }
    const placed = [];
    h.labels.forEach((l, i) => {
      const el = this.labelEls[i * 2], edge = this.labelEls[i * 2 + 1];
      const km = l.d > 999 ? `${(l.d / 1000).toFixed(1)} km` : `${Math.round(l.d / 10) * 10} m`;
      const pend = l.pending > 0 ? ` · <b>${l.pending} unrecorded</b>` : '';
      if (l.on && l.d > 330 && h.lens < 0.3) {
        const lx = (l.x * 0.5 + 0.5) * W, ly = (0.5 - l.y * 0.5) * H;
        el.className = 'isl'; el.style.opacity = ly < 124 && (lx < 340 || lx > W - 240) ? 0 : 1;   // keep clear of the journal badge and the clock
        el.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`;
        const html = `<span class="n">${esc(l.name)}</span><span class="d">${km}${pend}</span>`;
        if (el._h !== html) { el.innerHTML = html; el._h = html; }
      } else el.style.opacity = 0;
      if (!l.on && l.pending > 0 && l.d > 420 && h.lens < 0.3 && h.playing) {
        // place on an ellipse around the screen edge by bearing
        const ang = l.bearing;
        const rx = W / 2 - 90, ry = H / 2 - 70;
        let px = W / 2 + Math.sin(ang) * rx, py = H / 2 - Math.cos(ang) * ry;
        px = Math.max(90, Math.min(W - 90, px)); py = Math.max(80, Math.min(H - 110, py));
        for (const o of placed) if (Math.abs(o[0] - px) < 170 && Math.abs(o[1] - py) < 30) py += py > H / 2 ? -34 : 34;
        placed.push([px, py]);
        edge.className = 'edge'; edge.style.opacity = 1;
        edge.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
        const html = `<svg viewBox="-5 -5 10 10" style="transform: rotate(${ang - Math.PI / 2}rad)"><path d="M-3 -4 L4 0 L-3 4 Z" fill="currentColor"/></svg><span>${esc(l.name)} · ${km}</span>`;
        if (edge._h !== html) { edge.innerHTML = html; edge._h = html; }
      } else { edge.style.opacity = 0; }
    });
  }
  // first-flight goal panel and its world marker
  goal(v) {
    const el = $('goal'), mk = $('goalmark');
    if (!el) return;
    if (!v) { el.classList.remove('on'); mk.style.opacity = 0; this.goalKey = null; return; }
    const key = v.n + v.text;
    if (key !== this.goalKey) {
      this.goalKey = key;
      $('goal-k').textContent = `First flight · ${v.n} of ${v.of}`;
      $('goal-t').textContent = v.text;
      el.classList.add('on'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    }
    const m = v.mark;
    if (!m) { mk.style.opacity = 0; return; }
    const W = window.innerWidth, H = window.innerHeight;
    const km = m.d > 999 ? `${(m.d / 1000).toFixed(1)} km` : `${Math.round(m.d / 10) * 10} m`;
    let px, py, html;
    if (m.on) {
      px = (m.x * 0.5 + 0.5) * W; py = (0.5 - m.y * 0.5) * H;
      html = `<svg viewBox="-6 -6 12 12"><path d="M0 -5 L5 0 L0 5 L-5 0 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle r="1.4" fill="currentColor"/></svg><span>${v.label ? esc(v.label) + ' · ' : ''}${km}</span>`;
    } else {
      const rx = W / 2 - 80, ry = H / 2 - 80;
      px = W / 2 + Math.sin(m.bearing) * rx; py = H / 2 - Math.cos(m.bearing) * ry;
      html = `<svg viewBox="-5 -5 10 10" style="transform: rotate(${(m.bearing - Math.PI / 2).toFixed(3)}rad)"><path d="M-3 -4 L4 0 L-3 4 Z" fill="currentColor"/></svg><span>${v.label ? esc(v.label) + ' · ' : ''}${km}</span>`;
    }
    mk.style.opacity = 1;
    mk.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
    if (mk._h !== html) { mk.innerHTML = html; mk._h = html; }
  }
  lens(amount, t) {
    const L = $('lens');
    L.style.opacity = amount > 0.05 ? Math.min(1, amount * 1.4) : 0;
    const mark = $('lens-mark');
    if (!t || amount < 0.5) {
      $('lens-name').textContent = 'Scanning';
      $('lens-meta').textContent = 'Keep a creature inside the circle';
      $('lens-prog').style.strokeDashoffset = 590.6;
      mark.style.opacity = 0;
      return;
    }
    $('lens-name').textContent = t.recorded ? t.latin : t.name;
    $('lens-meta').textContent = t.recorded ? `${t.name} · ${Math.round(t.dist)} m · recorded` : `${Math.round(t.dist)} m · studying ${Math.round(t.progress * 100)}%`;
    $('lens-prog').style.strokeDashoffset = 590.6 * (1 - t.progress);
    $('lens-prog').style.stroke = t.recorded ? '#8fd6bf' : '#ffad7a';
    mark.style.opacity = 1;
    mark.style.transform = `translate(${(t.x * 0.5 + 0.5) * window.innerWidth}px, ${(0.5 - t.y * 0.5) * window.innerHeight}px)`;
  }

  shutter() {
    const L = $('lens');
    L.classList.remove('snap'); void L.offsetWidth; L.classList.add('snap');
  }

  showPause(on) {
    const p = $('pause');
    this.pauseOn = on;
    if (on) { p.hidden = false; requestAnimationFrame(() => { if (this.pauseOn) p.classList.add('on'); }); this.syncSettings(); $('p-opts').hidden = false; $('p-keys-panel').hidden = true; $('p-ending').hidden = !this.game.j.ended; $('p-resume').focus({ preventScroll: true }); }
    else this.game.input.rebind = null;
    if (!on) { p.classList.remove('on'); setTimeout(() => { if (!p.classList.contains('on')) p.hidden = true; }, 350); }
  }

  // ---------------------------------------------------------------- journal
  openJournal(j, species, tagText) {
    this.j = j; this.species = species; this.tagText = tagText;
    const p = $('journal');
    p.hidden = false; requestAnimationFrame(() => p.classList.add('on'));
    const n = Object.keys(j.recorded).length;
    const mins = Math.floor(j.flightTime / 60);
    let bSeen = 0, bAll = 0;
    for (const sp of species) for (const b of sp.behaviours) { bAll++; if ((j.tags[sp.id] || []).includes(b) && j.recorded[sp.id]) bSeen++; }
    const nConv = CONVERGENCES.filter((c) => j.conv && j.conv[c.key]).length;
    const stars = Object.values(j.recorded).reduce((a, r) => a + (r.stars || 1), 0);
    $('j-sub').textContent = `${n} of ${species.length} species · ${stars} of ${species.length * 3} stars · ${bSeen} of ${bAll} behaviours · ${nConv} of ${CONVERGENCES.length} convergences · ${mins} min in the air`;
    // select the newest or first unrecorded
    if (this.newPip) { this.sel = species.findIndex((s) => s.id === this.newPip); this.jtabNext = 'plates'; }
    this.newPip = null;
    // open on the letters when one is waiting
    const unread = LETTERS.findIndex((l) => j.letters[l.id] && !j.read[l.id]);
    if (!this.jtabNext && unread >= 0) { this.jtabNext = 'letters'; this.lsel = unread; }
    this.setTab(this.jtabNext || this.jtab);
    this.jtabNext = null;
  }
  setTab(tab) {
    this.jtab = tab;
    $('jt-plates').setAttribute('aria-selected', String(tab === 'plates'));
    $('jt-letters').setAttribute('aria-selected', String(tab === 'letters'));
    $('j-detail').classList.toggle('letter', tab === 'letters');
    $('j-detail').scrollTop = 0;
    this.renderList();
    if (tab === 'plates') this.select(this.sel); else this.selectLetter(this.lsel);
    this.updateJournalBadge(this.j);
    $('jt-dot').hidden = !LETTERS.some((l) => this.j.letters[l.id] && !this.j.read[l.id]);
  }
  step(d) {
    if (this.jtab === 'plates') this.select((this.sel + d + SPECIES.length) % SPECIES.length);
    else this.selectLetter((this.lsel + d + LETTERS.length) % LETTERS.length);
  }
  renderLetters() {
    const j = this.j;
    $('j-list').innerHTML = LETTERS.map((l, i) => {
      const got = j.letters[l.id];
      const sub = got ? l.from : l.kind === 'page' ? `A cairn on ${campName(l.camp)}` : 'Not yet received';
      return `<button class="j-item letter ${got ? (j.read[l.id] ? '' : 'unread') : 'unk'}" role="tab" type="button" data-i="${i}" aria-selected="${i === this.lsel}">
        <span class="no">${l.kind === 'page' ? 'pg' : 'no'}</span>
        <span class="nm"><b>${got ? esc(l.title) : l.kind === 'page' ? 'A missing page' : 'A letter to come'}</b><i>${esc(sub)}</i></span>
        <span class="st ${got ? 'on' : ''}"></span>
      </button>`;
    }).join('');
    $('j-list').querySelectorAll('.j-item').forEach((b) => b.onclick = () => this.selectLetter(+b.dataset.i));
  }
  selectLetter(i) {
    this.lsel = i;
    const l = LETTERS[i], j = this.j, got = j.letters[l.id], d = $('j-detail');
    if (got && !j.read[l.id]) { j.read[l.id] = true; this.game.persist(); this.renderLetters(); this.updateJournalBadge(j); $('jt-dot').hidden = !LETTERS.some((x) => j.letters[x.id] && !j.read[x.id]); }
    document.querySelectorAll('.j-item').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.i === i)));
    if (!got) {
      d.innerHTML = `<div class="d-text" style="max-width:52ch;margin:0 auto"><span class="label">${l.kind === 'page' ? 'Notebook page' : 'Letter'} · not yet in your journal</span>
        <p class="hintline">${l.kind === 'page' ? `The surveyor before you left a camp beside the listening post on ${esc(campName(l.camp))}. Look for a cairn and a scrap of sail, and fly close.` : 'The Institute writes when there is news. Keep recording.'}</p></div>`;
      return;
    }
    d.innerHTML = `<article class="paper ${l.kind === 'page' ? 'page' : ''}">
      ${l.kind === 'letter' ? '<svg class="seal" aria-hidden="true"><use href="#dl-mark"/></svg>' : ''}
      <div class="from"><span>${esc(l.from)}</span></div>
      <h3>${esc(l.title)}</h3>
      ${l.body.map((t) => `<p>${esc(t)}</p>`).join('')}
      <p class="sign">${esc(l.sign)}</p>
    </article>`;
    d.scrollTop = 0;
  }

  // ---------------------------------------------------------------- ending
  showEnding(letter) {
    const el = $('ending');
    el.hidden = false; el.classList.remove('credits');
    $('e-from').textContent = letter.from; $('e-h').textContent = letter.title;
    const paras = [...letter.body, letter.sign];
    $('e-body').innerHTML = paras.map((t, i) => `<p class="${i === paras.length - 1 ? 'sign' : ''}">${esc(t)}</p>`).join('');
    $('e-next').hidden = true;
    const j = this.game.j, stars = Object.values(j.recorded).reduce((a, r) => a + (r.stars || 1), 0);
    $('e-tally').textContent = `${Object.keys(j.recorded).length} species · ${stars} stars · ${Math.max(1, Math.round(j.flightTime / 60))} minutes in the air`;
    $('e-cred').innerHTML = CREDITS.slice(1).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    requestAnimationFrame(() => el.classList.add('on'));
    clearInterval(this.endI);
    let i = 0;
    const ps = [...$('e-body').children];
    const reveal = () => { if (i < ps.length) ps[i++].classList.add('on'); if (i >= ps.length) { clearInterval(this.endI); $('e-next').hidden = false; $('e-next').focus({ preventScroll: true }); } };
    setTimeout(reveal, 1800);
    this.endI = setInterval(reveal, 5200);
    this.endReveal = () => { ps.forEach((p) => p.classList.add('on')); i = ps.length; clearInterval(this.endI); $('e-next').hidden = false; $('e-next').focus({ preventScroll: true }); };
  }
  // Enter or Space: show the whole letter, then the credits, then fly on. Escape skips straight out.
  endingAdvance(skip) {
    const el = $('ending'), now = performance.now();
    if (now - (this.endAdvT || 0) < 450) return;      // one key press, one step (a key that moves focus onto a button would otherwise also click it)
    this.endAdvT = now;
    if (skip) { this.hideEnding(); return; }
    if (el.classList.contains('credits')) this.hideEnding();
    else if ($('e-next').hidden) this.endReveal && this.endReveal();
    else this.showCredits();
  }
  showCredits() { $('ending').classList.add('credits'); $('e-fly').focus({ preventScroll: true }); }
  hideEnding() {
    const el = $('ending');
    clearInterval(this.endI);
    el.classList.remove('on');
    setTimeout(() => { if (!el.classList.contains('on')) { el.hidden = true; el.classList.remove('credits'); } }, 1700);
    this.game.finishEnding();
  }
  closeJournal() { const p = $('journal'); p.classList.remove('on'); setTimeout(() => { if (!p.classList.contains('on')) p.hidden = true; }, 350); }
  renderList() {
    if (this.jtab === 'letters') { this.renderLetters(); return; }
    const j = this.j;
    $('j-list').innerHTML = this.species.map((s, i) => {
      const rec = j.recorded[s.id];
      const prog = j.progress[s.id] || 0;
      const no = String(i + 1).padStart(2, '0');
      return `<button class="j-item ${rec ? '' : 'unk'}" role="tab" type="button" data-i="${i}" id="ji-${i}" aria-selected="${i === this.sel}">
        <span class="no">${no}</span>
        <span class="nm"><b>${rec ? esc(s.common) : 'Unrecorded'}</b><i>${rec ? esc(s.latin) : (prog > 0 ? `study ${Math.round(prog * 100)}% complete` : (s.island >= 0 ? islandName(s.island) : 'Where islands meet'))}</i></span>
        <span class="rt">${rec ? starsHtml(rec.stars || 1) : ''}<span class="st ${rec ? 'on' : prog > 0 ? 'part' : ''}"></span></span>
      </button>`;
    }).join('');
    $('j-list').querySelectorAll('.j-item').forEach((b) => b.onclick = () => this.select(+b.dataset.i));
  }
  select(i) {
    this.sel = i;
    document.querySelectorAll('.j-item').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.i === i)));
    const s = this.species[i], j = this.j, rec = j.recorded[s.id];
    const d = $('j-detail');
    if (!rec) {
      const prog = j.progress[s.id] || 0;
      d.innerHTML = `<div class="plate"><span class="q">?</span><span class="cap">Plate ${String(i + 1).padStart(2, '0')} · not yet observed</span></div>
        <div class="d-text"><span class="label">Field hint</span><p class="hintline">${esc(s.hint)}</p>
        <dl class="meta"><dt>Where</dt><dd>${s.island >= 0 ? islandName(s.island) : 'Wherever two islands meet'}</dd><dt>Study</dt><dd>${prog > 0 ? `${Math.round(prog * 100)}% complete. Find it again and keep it in your lens.` : 'Not started'}</dd></dl></div>`;
      return;
    }
    const g = s.genome;
    const seenTags = j.tags[s.id] || [];
    const tags = s.behaviours.filter((t) => seenTags.includes(t)).map((t) => this.tagText(s.id, t));
    const checklist = s.behaviours.map((t) => {
      const seen = seenTags.includes(t);
      return `<li class="${seen ? 'on' : ''}"><i></i><span>${seen ? esc(this.tagText(s.id, t)) : 'Not yet observed' + (NIGHT_TAGS.has(t) ? ' · try after dark' : WEATHER_TAGS[t] ? ` · try ${({ fog: 'in a fog bank', rain: 'under a rain band', wind: 'in a crosswind' })[WEATHER_TAGS[t]]}` : '')}</span></li>`;
    }).join('');
    const genes = [];
    if (g.legs) genes.push(`${g.legs} legs`);
    if (g.segs) genes.push(`${g.segs} segments`);
    if (g.petals) genes.push(`${g.petals} petals`);
    if (g.tentacles) genes.push(`${g.tentacles} tentacles`);
    if (g.span) genes.push(`wing ${g.span * 2} m`);
    genes.push(['plain', 'banded', 'spotted', 'countershaded'][g.pattern] + ' skin');
    if (g.glow > 0.3) genes.push('bioluminescent');
    const sw = (c) => `<i class="swatch" style="background:${oklchCss(c)}"></i>`;
    const notes = j.notes[s.id];
    d.innerHTML = `<div class="plate">${rec.img ? `<img alt="Field plate of the ${esc(s.common)}" src="${rec.img}">` : '<span class="q">·</span>'}<span class="cap">Plate ${String(i + 1).padStart(2, '0')} · ${esc(rec.island)}</span><span class="grade">${starsHtml(rec.stars || 1)}</span></div>
      <div class="d-text">
        <span class="label">${esc(PLAN_TEXT[s.plan])}</span>
        <p class="lat">${esc(s.latin)}</p>
        <p class="com">${esc(s.common)}</p>
        <dl class="meta">
          <dt>Size</dt><dd>${esc(s.size)}</dd>
          <dt>Found</dt><dd>${esc(rec.island)}, studied from ${rec.dist} m</dd>
          <dt>Plate</dt><dd>${starsHtml(rec.stars || 1)} ${esc(plateNote(rec))}</dd>
          <dt>Seen</dt><dd><ul class="beh">${checklist}</ul></dd>
          <dt>Genome</dt><dd><div class="gen">${genes.map((x) => `<span>${esc(x)}</span>`).join('')}<span>${sw(g.colA)}${sw(g.colB)}colours</span></div></dd>
          ${s.hybrid ? `<dt>Lineage</dt><dd>Crossover of the ${esc(lineage(s))}, after the collision</dd>` : ''}
        </dl>
      </div>
      <div class="notes" id="notes">
        <span class="who">Ecologist's notes</span>
        ${notes ? `<p>${esc(notes)}</p>` : `<p id="notes-text" style="color: var(--bone-dim)">${esc(templateNote(s, rec, tags))}</p>`}
        <div class="row-actions" id="notes-actions"></div>
      </div>`;
    this.setupAsk(s, rec, tags, !!notes);
  }
  async setupAsk(s, rec, tags, have) {
    const box = $('notes-actions');
    if (!box || !this.sampleP) return;
    const sample = await this.sampleP;
    if (!sample || this.species[this.sel] !== s) return;
    box.innerHTML = `<button class="btn small" type="button" id="ask">${have ? 'Rewrite with new observations' : 'Ask the ecologist to write notes'}</button>`;
    $('ask').onclick = async () => {
      const btn = $('ask'); btn.disabled = true; btn.textContent = 'Writing…';
      let p = $('notes-text');
      if (!p) { p = document.createElement('p'); p.id = 'notes-text'; $('notes').insertBefore(p, box); const old = $('notes').querySelector('p:not(#notes-text)'); old && old.remove(); }
      p.style.color = 'var(--bone-dim)'; p.textContent = 'Thinking…';
      try {
        const { text } = await sample(this.prompt(s, rec, tags), { modelTier: 'quick', cache: false, onText: ({ text }) => { if ($('notes-text') === p) { p.textContent = text; p.style.color = ''; } } });
        this.j.notes[s.id] = text.trim();
        this.game.persist();
        if ($('notes-text') === p) { p.textContent = text.trim(); p.style.color = ''; }
        btn.disabled = false; btn.textContent = 'Rewrite with new observations';
      } catch (e) {
        if (e && e.code === 'not_granted') { box.innerHTML = ''; p.textContent = templateNote(s, rec, tags); return; }
        p.textContent = (e && e.text) || templateNote(s, rec, tags);
        box.innerHTML = `<span class="err">${e && e.code === 'rate_limited' ? 'The ecologist is busy. Try again in a minute.' : 'The ecologist could not write notes just now.'}</span>`;
      }
    };
  }
  prompt(s, rec, tags) {
    const others = this.species.filter((o) => this.j.recorded[o.id] && o.id !== s.id).map((o) => `${o.common} (${PLAN_TEXT[o.plan].toLowerCase()}, ${o.island >= 0 ? islandName(o.island) : 'the seam'})`);
    const g = { ...s.genome }; delete g.colA; delete g.colB; delete g.count;
    return `You are the expedition ecologist on a survey of floating sky-islands above a sea of cloud. Write the "Ecologist's notes" for one specimen in the naturalist's field journal.

Rules: use only the facts below. You may add one clearly hedged hypothesis about its niche, diet or relationship to the other recorded species. Write one paragraph of 70 to 110 words in plain, precise, warm modern English, in the spirit of a good field notebook. No headings, lists, markdown or quotation marks. Do not repeat the Latin name. Do not invent measurements.

Specimen: ${s.common} (${s.latin})
Body plan: ${PLAN_TEXT[s.plan]}
Size: ${s.size}
Found: ${rec.island}; studied through the lens from ${rec.dist} m away
Behaviours observed: ${tags.length ? tags.join('; ') : 'none beyond its appearance'}
Genome parameters: ${JSON.stringify(g)}
${s.hybrid ? `History: this species ${convergenceFor(s.id).history}. Its genome is a crossover of the ${lineage(s)}.\n` : ''}Other species already recorded: ${others.length ? others.join('; ') : 'none yet'}

Write only the paragraph.`;
  }
}

const lineage = (s) => s.hybrid.map((id) => SPECIES.find((o) => o.id === id).common.toLowerCase()).join(' and the ');
const campName = (key) => { const I = ISLANDS.find((x) => x.key === key); return I ? I.name : 'an island'; };
// what the plate's grade is made of, and what would raise it
function plateNote(rec) {
  const g = rec.grade || {};
  if ((rec.stars || 1) >= 3) return 'Well framed, and caught in the act.';
  const tips = [];
  if (!g.framed) tips.push(g.small ? 'get closer so it fills more of the lens' : g.big ? 'back off so the whole animal fits' : 'bring it to the middle of the lens');
  if (!g.behaviour) tips.push('catch it doing something');
  return tips.length ? `For a better plate, ${tips.join(' and ')}, then press the shutter again.` : '';
}
function islandName(i) { return ISLANDS[i] ? ISLANDS[i].name : 'the open air'; }

function templateNote(s, rec, tags) {
  const seen = tags.length ? ` Observed ${tags.slice(0, 3).join(', then ')}.` : '';
  const base = {
    stilt: 'A herd animal of the open plateau. It walks on four very long legs and swings a long neck down to the turf to graze, lifting it high when anything flies over.',
    polyp: 'A rooted animal that looks like a flower. The crown of petals stays open in calm air and shuts within a second when something passes close.',
    kite: 'A flocking flier with a long trailing ribbon. The flock circles its island in loose rings and is quick to investigate a glider.',
    crawler: 'A many-legged animal that walks on bare rock in any orientation, including the undersides of arches.',
    drifter: 'A floating bell that rises in slow pulses and trails fine tentacles. It brightens when disturbed.',
    lantern: 'A floating bell that rises in slow pulses and trails fine tentacles. It brightens when disturbed.',
    whale: 'The largest animal on the survey. It circles high above its island on a fixed route, and its flank lights pulse while it calls.',
    hybrid: 'A walker that appeared after the collision. It carries the segmented body of the arch centipede on the long legs of the stiltwalker.',
    swift: 'A small, fast flier that lives on laps of the stone ring. The flock passes through the hoop again and again, as if the ring were the point.',
    ray: 'A sky ray far smaller than the whale, flying wide loops that thread the gate. Its flank lights pulse when it hums.',
    glassworm: 'A centipede so clear the light passes through it. It climbs the crystal spires and is easiest to see by the glow inside it at night.',
    moth: 'A loose cloud of pale fliers that wander between the spires rather than circling the island.',
    strider: 'A six-legged walker of the warm ash. The herd grazes minerals from the cinders and freezes, antennae raised, when anything flies over.',
    cinderbell: 'A small floating bell that rides the warm air over the crater. Its core glows like an ember.',
    wader: 'A pale walker on very thin legs that feeds in the lake shallows, probing the water with its bill.',
    lily: 'A flower-like animal that floats on the still lake, rooted in the silt below. It folds shut and dips when something passes.',
    veil: 'A bloom that grows upside down from the underside of the island and hangs open in the shade of the roots.',
    rootworm: 'A golden centipede that lives on the hanging roots, far below the plateau.',
    kiln: 'A walker that appeared after the caldera met the spires. It has the strider\'s six legs and a segmented back with a glassy sheen.',
    bell: 'A hanging bloom that appeared where the lake drains into the roots. It crosses the floating lily with the veil bloom and glows strongly at night.',
    rootwing: 'A flier that appeared after the ring met the roots. It flies tight circles beneath the seam, weaving between the hanging roots.',
  }[s.id] || '';
  return `${base}${seen} Notes written from ${rec.dist} m.`;
}
