// Headless screenshots through the debug hooks.   node tools/shoot.cjs views.json W H outdir
// A view: { name, time (seconds on the day cycle), p, t, fov (debug camera), pre / js (code run before / after the
// camera is set, with g = the game), ship: { p, yaw, pitch }, sim (seconds of game time to run first), bot (true, or
// "god" for one that cannot be hurt: the robot pilot flies during sim), frames, dt, ui (keep the interface visible) }
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const BOT = require('./bot.cjs');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
const views = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const Q = process.env.Q || 3;
const W = +process.argv[3] || 1920, H = +process.argv[4] || 1080, OUT = process.argv[5] || 'out';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 600)));
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`.slice(0, 900)));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const t0 = Date.now();
  await pg.addInitScript(`window.__Q=${Q}`);
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000 });
  try { await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 }); }
  catch (e) { console.log('never reached the title'); console.log(logs.slice(-25).join('\n')); await pg.screenshot({ path: path.join(OUT, 'fail.png') }); await b.close(); return; }
  console.log('ready', (Date.now() - t0) / 1000);
  await pg.evaluate(BOT);
  await pg.evaluate(() => {
    __dl.adaptQuality = () => {}; __dl.applyQuality(+(window.__Q ?? 3)); __dl._frame = __dl.frame.bind(__dl); __dl.frame = () => {};
    __dl.realRead = __dl.input.read.bind(__dl.input);
    __dl.sim = (sec, st = 0.033) => { for (let t = 0; t < sec; t += st) { __dl.camera.updateMatrixWorld(); __dl.camera.matrixWorldInverse.copy(__dl.camera.matrixWorld).invert(); __dl._frame(st, false); } };
  });
  for (const v of views) {
    const t = Date.now();
    let r;
    try { r = await pg.evaluate(async (v) => {
      const g = __dl;
      document.getElementById('dl-root').classList.toggle('shot', !v.ui);
      for (const id of ['title', 'hud', 'dl-overlay', 'pause', 'end', 'vig']) { const e = document.getElementById(id); if (e) e.style.visibility = v.ui ? '' : 'hidden'; }
      g.debugCam = null; g.input.read = g.realRead;
      if (v.ui) g.ui.showTitle(false);
      if (v.pre) eval(v.pre);
      if (v.bot) __installBot(g, v.bot === 'god');
      if (v.time != null) g.setTime(v.time);
      if (v.ship) { g.ship.place(new g.ship.pos.constructor(...v.ship.p), v.ship.yaw || 0, v.ship.pitch || 0); }
      if (v.p) g.debugCam = { p: v.p, t: v.t, fov: v.fov, rel: v.rel };
      g.sim(v.sim ?? 0.1); g.pipe.adaptReset = true; if (!v.fade) { g.fade = 0; g.fadeGoal = 0; }
      if (v.js) eval(v.js);
      document.getElementById('dl-overlay').style.visibility = v.ui && g.state === 'play' && !g.cine ? '' : 'hidden';
      const n = v.frames || 24;
      for (let i = 0; i < n; i++) { const tf = performance.now(); g._frame(v.dt ?? 0.001, true); g.renderer.getContext().finish(); window.__ft = (performance.now() - tf); if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0)); }
      return 'ok ft=' + Math.round(window.__ft) + 'ms';
    }, v); } catch (e) { r = 'skip: ' + String(e.message).split('\n').slice(0, 3).join(' | '); }
    if (String(r).startsWith('skip')) { console.log('shot', v.name, r); continue; }
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(OUT, v.name + '.png'), timeout: 900000 });
    console.log('shot', v.name, r, (Date.now() - t) / 1000);
  }
  console.log(logs.filter((l) => !l.includes('GPU stall')).slice(-18).join('\n'));
  await b.close();
})();
