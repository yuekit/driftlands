// Headless screenshots through the debug hooks, from the hosted build.   node build.mjs --web --dev && node tools/d3/shoot.cjs views.json W H outdir
// A view: { name, time (seconds on the day cycle), p, t, fov (debug camera), pre / js (code run before / after the
// camera is set, with g = the game), ship: { p, yaw, pitch }, sim (seconds of game time to run first), bot (true, or
// "god" for one that cannot be hurt: the robot pilot flies during sim), frames, dt, ui (keep the interface visible) }
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
// Playwright is borrowed from wherever it is installed (PLAYWRIGHT=/path/to/node_modules/playwright), and the browser is
// the newest Chrome for Testing it has already downloaded, run on the machine's own GPU.
const PW = process.env.PLAYWRIGHT || [path.join(os.homedir(), 'Documents/GitHub/supercollider/node_modules/playwright'), 'playwright'].find((p) => { try { require.resolve(p); return true; } catch { return false; } });
const { chromium } = require(PW);
const BOT = require('./bot.cjs');
function cached() {
  const dir = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (!fs.existsSync(dir)) return undefined;
  for (const n of fs.readdirSync(dir).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => b.split('-')[1] - a.split('-')[1])) { const p = path.join(dir, n, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); if (fs.existsSync(p)) return p; }
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.json': 'application/json' };
const serve = (dir) => new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, () => res(s)); });
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
const views = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const Q = process.env.Q || 3;
const W = +process.argv[3] || 1920, H = +process.argv[4] || 1080, OUT = process.argv[5] || 'out';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const server = await serve(path.join(ROOT, 'dist/web'));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || cached(), args: process.env.SOFT ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio'] });
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 2400)));
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`.slice(0, 900)));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const t0 = Date.now();
  await pg.addInitScript(`window.__Q=${Q}`);
  await pg.goto(`http://localhost:${server.address().port}/?q=${Q >= 3 ? 'high' : Q <= 0 ? 'low' : 'mid'}${process.env.PARAMS ? '&' + process.env.PARAMS : ''}`, { timeout: 120000 });
  try { await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 }); }
  catch (e) { console.log('never reached the title'); console.log(logs.slice(-25).join('\n')); await pg.screenshot({ path: path.join(OUT, 'fail.png') }); await b.close(); server.close(); return; }
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
      for (let i = 0; i < n; i++) { const tf = performance.now(); g._frame(v.dt ?? 0.001, true); g.renderer.getContext().finish(); window.__ft = (performance.now() - tf); (window.__fts = i ? window.__fts : []).push(window.__ft); if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0)); }
      const half = window.__fts.slice(Math.floor(window.__fts.length / 2)).sort((a, b) => a - b); const R = g.renderer.info.render; return 'ok ft=' + half[Math.floor(half.length / 2)].toFixed(1) + 'ms (median of ' + half.length + ') calls ' + R.calls + ' tris ' + (R.triangles / 1e6).toFixed(2) + 'M';
    }, v); } catch (e) { r = 'skip: ' + String(e.message).split('\n').slice(0, 3).join(' | '); }
    if (String(r).startsWith('skip')) { console.log('shot', v.name, r); continue; }
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(OUT, v.name + '.png'), timeout: 900000 });
    console.log('shot', v.name, r, (Date.now() - t) / 1000);
  }
  const errs = logs.filter((l) => /Shader Error|ERROR:|pageerror|\[error\]/.test(l));
  console.log(errs.slice(0, 6).map((l) => l.slice(0, 1800)).join('\n'));
  console.log(logs.filter((l) => !l.includes('GPU stall') && !l.includes('useProgram')).slice(-10).join('\n'));
  await b.close(); server.close();
})();
