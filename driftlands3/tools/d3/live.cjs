// The real page with its own frame loop (no harness): loads the hosted build, casts off, flies for a while on the robot
// pilot, and reports console errors and the frame rate.   node tools/d3/live.cjs [seconds] [chapter]
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const PW = process.env.PLAYWRIGHT || path.join(os.homedir(), 'Documents/GitHub/supercollider/node_modules/playwright');
const { chromium } = require(PW);
const BOT = require('./bot.cjs');
function cached() { const dir = path.join(os.homedir(), 'Library/Caches/ms-playwright'); for (const n of fs.readdirSync(dir).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => b.split('-')[1] - a.split('-')[1])) { const p = path.join(dir, n, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); if (fs.existsSync(p)) return p; } }
const serve = (dir) => new Promise((res) => { const s = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(dir, u === '/' ? 'index.html' : u); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript' }[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, () => res(s)); });
(async () => {
  const SECS = +(process.argv[2] || 20), CH = +(process.argv[3] || 0);
  const server = await serve(path.join(ROOT, 'dist/web'));
  const b = await chromium.launch({ executablePath: cached(), args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 });
  const logs = []; pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400))); pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`.slice(0, 600)));
  const t0 = Date.now();
  await pg.goto(`http://localhost:${server.address().port}/`, { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  console.log('title after', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: '/tmp/d3live-title.png' });
  await pg.evaluate(BOT);
  await pg.evaluate((CH) => { window.__n = 0; const raf = () => { window.__n++; requestAnimationFrame(raf); }; requestAnimationFrame(raf); __dl.begin(CH); setTimeout(() => __installBot(__dl, true), 1500); }, CH);
  await pg.waitForTimeout(3000);
  const n0 = await pg.evaluate('window.__n'), t1 = Date.now();
  await pg.waitForTimeout(SECS * 1000);
  const r = await pg.evaluate(() => ({ n: window.__n, q: __dl.quality.level, scale: __dl.pipe.scale, state: __dl.state, obj: document.getElementById('o-t').textContent, size: [__dl.renderer.domElement.width, __dl.renderer.domElement.height] }));
  console.log('fps', ((r.n - n0) / ((Date.now() - t1) / 1000)).toFixed(1), JSON.stringify(r));
  await pg.screenshot({ path: '/tmp/d3live-play.png' });
  const bad = logs.filter((l) => /error|warn/i.test(l) && !l.includes('GPU stall'));
  console.log(bad.length ? 'console:\n' + bad.slice(0, 12).join('\n') : 'console clean');
  await b.close(); server.close();
})();
