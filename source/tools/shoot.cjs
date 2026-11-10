// node shoot.cjs views.json W H outdir
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
const views = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const Q = process.env.Q || 3;
const W = +process.argv[3] || 1920, H = +process.argv[4] || 1080, OUT = process.argv[5] || 'out';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const t0 = Date.now();
  await pg.addInitScript(`window.__Q=${Q}`);
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  console.log('ready', (Date.now() - t0) / 1000);
  await pg.evaluate(() => {
    for (const e of document.querySelectorAll('body *')) if (e.id !== 'dl-canvas' && !e.contains(document.getElementById('dl-canvas'))) e.style.visibility = 'hidden';
    __dl.adaptQuality = () => {}; __dl.applyQuality(+(window.__Q ?? 3)); __dl._frame = __dl.frame.bind(__dl); __dl.frame = () => {};
  });
  for (const v of views) {
    const t = Date.now();
    let r;
    try { r = await pg.evaluate(async (v) => {
      const g = __dl; g.sim = (sec, st = 0.033) => { for (let t = 0; t < sec; t += st) g._frame(st, false); };
      if (v.pre) eval(v.pre);
      if (v.golden != null) g.goldenView(v.golden);
      else {
        g.cycle.mode = 'hold'; g.cycle.t = v.time; g.cycle.apply(); g.weather.hold();
        if (v.creature) {
          const c = (g.eco.bySpecies[v.creature] || [])[v.idx || 0]; if (!c) return 'skip: no ' + v.creature;
          g.sim = (sec, st = 0.033) => { for (let t = 0; t < sec; t += st) g._frame(st, false); }; g.sim(0.2);
          const p = c.pos || c.center, y = (c.bodyY ?? p.y) + (v.dy ?? 4);
          g.debugCam = { p: [p.x + v.off[0], y + v.off[1], p.z + v.off[2]], t: [p.x + (v.toff ? v.toff[0] : 0), y + (v.toff ? v.toff[1] : 0), p.z + (v.toff ? v.toff[2] : 0)], fov: v.fov };
        } else g.debugCam = { p: v.p, t: v.t, fov: v.fov };
        g.sim(0.1); g.pipe.adaptReset = true;
      }
      if (v.js) eval(v.js);
      const n = v.frames || 36;
      for (let i = 0; i < n; i++) { const tf = performance.now(); g._frame(v.dt ?? 0.001, true); g.renderer && g.renderer.getContext && g.renderer.getContext().finish(); window.__ft = (performance.now() - tf); if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0)); }
      return 'ok ft=' + Math.round(window.__ft) + 'ms';
    }, v); } catch (e) { r = 'skip: ' + String(e.message).split('\n')[0]; }
    if (String(r).startsWith('skip')) { console.log('shot', v.name, r); continue; }
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(OUT, v.name + '.png'), timeout: 900000 });
    console.log('shot', v.name, r, (Date.now() - t) / 1000);
  }
  console.log(logs.slice(-15).join('\n'));
  await b.close();
})();
