// Performance instruments: per-pass GPU timers (EXT_disjoint_timer_query_webgl2) and an on-screen overlay.
// Toggle the overlay with P (or F3) or the ?perf URL flag.

export class GpuTimer {
  constructor(renderer) {
    const gl = (this.gl = renderer.getContext());
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.enabled = false;
    this.pending = []; this.free = []; this.cur = null;
    this.avg = {}; this.frameTotal = 0;
  }
  get available() { return !!this.ext; }
  begin(name) {
    if (!this.enabled || !this.ext) return;
    if (this.cur) this.end();
    const gl = this.gl, q = this.free.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.cur = { name, q };
  }
  end() {
    if (!this.cur) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.cur); this.cur = null;
  }
  poll() {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        const a = this.avg[p.name];
        this.avg[p.name] = a === undefined ? ms : a * 0.92 + ms * 0.08;
      }
      this.free.push(p.q);
    }
  }
  summary() {
    const out = {}; let total = 0;
    for (const k in this.avg) { out[k] = +this.avg[k].toFixed(2); total += this.avg[k]; }
    out.total = +total.toFixed(2);
    return out;
  }
}

export class PerfOverlay {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      position: 'fixed', left: '8px', top: '8px', margin: 0, padding: '8px 10px', zIndex: 50, pointerEvents: 'none',
      font: '11px/1.35 "IBM Plex Mono", ui-monospace, monospace', color: '#f4efe6', background: 'rgba(18,15,25,0.72)', borderRadius: '6px', whiteSpace: 'pre',
    });
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.t = 0; this.frames = 0; this.acc = 0; this.worst = 0;
    window.addEventListener('keydown', (e) => { if (e.key === 'F3' || (e.code === 'KeyP' && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); this.toggle(); } });
    if (new URLSearchParams(location.search).has('perf')) this.toggle(true);
  }
  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    const timer = this.game.pipe.timer;
    if (timer) timer.enabled = on;
  }
  update(dt) {
    if (this.el.hidden) return;
    this.frames++; this.acc += dt; this.worst = Math.max(this.worst, dt);
    this.t += dt;
    if (this.t < 0.25) return;
    const g = this.game, info = g.renderer.info, timer = g.pipe.timer;
    const lines = [
      `fps ${(this.frames / this.acc).toFixed(0).padStart(4)}   frame ${(1000 * this.acc / this.frames).toFixed(1)} ms  worst ${(this.worst * 1000).toFixed(1)}`,
      `quality ${g.quality.level}  scale ${g.pipe.scale.toFixed(2)}  ${g.pipe.targets ? g.pipe.targets.W + 'x' + g.pipe.targets.H : ''}`,
      `draws ${info.render.calls}  tris ${(info.render.triangles / 1e6).toFixed(2)} M`,
    ];
    if (timer && timer.available) {
      const s = timer.summary();
      lines.push('gpu ms');
      for (const k in s) if (k !== 'total') lines.push(`  ${k.padEnd(10)} ${s[k].toFixed(2).padStart(6)}`);
      lines.push(`  ${'total'.padEnd(10)} ${s.total.toFixed(2).padStart(6)}`);
    } else lines.push('gpu timers unavailable in this browser');
    this.el.textContent = lines.join('\n');
    this.t = 0; this.frames = 0; this.acc = 0; this.worst = 0;
  }
}
