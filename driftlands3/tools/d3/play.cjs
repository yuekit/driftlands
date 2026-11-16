// A robot pilot that plays a chapter with no picture, to prove the scripts, the fight and the landing all run.
//   node tools/d3/play.cjs <chapter 0..3 | -1> [max game seconds] [godmode 0|1]
// It prints a log of what was said, each objective, warnings, kills, deaths and whether the chapter was completed.
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
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
const CH = +(process.argv[2] ?? 0), MAX = +(process.argv[3] ?? 400), GOD = +(process.argv[4] ?? 0);
(async () => {
  const server = await serve(path.join(ROOT, 'dist/web'));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || cached(), args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 500)));
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`.slice(0, 900)));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await pg.goto(`http://localhost:${server.address().port}/?q=low`, { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  await pg.evaluate(BOT);
  if (process.env.AUDIO) await pg.evaluate('window.__audio = true');
  const out = await pg.evaluate(async ({ CH, MAX, GOD }) => {
    const g = __dl, log = [], T = () => g.time.toFixed(1).padStart(6);
    g.adaptQuality = () => {}; g._frame = g.frame.bind(g); g.frame = () => {};
    const wrap = (o, k, f) => { const old = o[k].bind(o); o[k] = (...a) => { f(...a); return old(...a); }; };
    wrap(g.ui, 'say', (who, text) => log.push(`${T()}  ${who.split(' ')[0]}: ${text}`));
    wrap(g.ui, 'objective', (k, t, d, n) => log.push(`${T()}  OBJECTIVE ${t}${n ? ` ${d}/${n}` : ''}`));
    wrap(g.ui, 'warn', (t) => log.push(`${T()}  WARN ${t}`));
    wrap(g.ui, 'card', (a, h) => log.push(`${T()}  CARD ${a} ${h}`));
    wrap(g.ui, 'hint', (t) => t && log.push(`${T()}  HINT ${t.replace(/<[^>]+>/g, '')}`));
    let completed = false, finished = false, deaths = 0;
    wrap(g, 'complete', () => { completed = true; log.push(`${T()}  COMPLETE`); });
    wrap(g, 'finish', () => { finished = true; log.push(`${T()}  FINISHED`); });
    wrap(g, 'die', () => { deaths++; log.push(`${T()}  DIED at ${g.ship.pos.toArray().map((v) => v.toFixed(0))}`); });
    wrap(g, 'dock', () => log.push(`${T()}  DOCKING from ${g.ship.pos.distanceTo(g.sites.dock.pos).toFixed(0)} m`));
    wrap(g, 'finale', () => log.push(`${T()}  FINALE`));
    const bot = __installBot(g, GOD);
    wrap(g, 'onCombat', (e) => { if (e.type === 'kill') { bot.kills++; log.push(`${T()}  kill ${e.kind}${e.e && e.e.boss ? ' (boss)' : ''}  hull ${g.ship.hull.toFixed(0)}`); } });
    bot.crashDmg = 0; bot.boltDmg = 0;
    wrap(g, 'onShipHit', (dmg, from) => { if (!from) { bot.crashes++; bot.crashDmg += dmg; } else bot.boltDmg += dmg; });
    if (window.__audio) g.audio.start(true); else g.audio.start = () => {};
    g.startChapter(CH); g.fade = 0; g.fadeGoal = 0;
    const t0 = performance.now(), start = g.time; let steps = 0, err = null, lastPos = '';
    try {
      while (g.time - start < MAX && !finished && !(completed && g.index !== CH)) {
        g.camera.updateMatrixWorld(); g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
        g._frame(1 / 30, false); steps++;
        if (steps % 900 === 0) { const s = g.ship; log.push(`${T()}  .. convoy ${(g.convoyK * 100).toFixed(0)}% tied ${g.tied()} failing ${g.failing().length} pos ${s.pos.toArray().map((v) => v.toFixed(0))} hull ${s.hull.toFixed(0)} drones ${g.combat.drones.length} turrets ${g.combat.turrets.length} targets ${g.combat.targets.length} bolts ${g.combat.bolts.length}`); }
        if (steps % 300 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) { err = String(e.stack || e).slice(0, 1200); }
    return { log, err, completed, finished, deaths, bot, steps, secs: (performance.now() - t0) / 1000, gameSecs: g.time - start, index: g.index, state: g.state };
  }, { CH, MAX, GOD });
  console.log(out.log.join('\n'));
  out.bot.crashDmg = Math.round(out.bot.crashDmg); out.bot.minHull = Math.round(out.bot.minHull); out.bot.away = 0;
  console.log('\n== chapter', CH, '| completed', out.completed, '| finished', out.finished, '| deaths', out.deaths, '| game s', out.gameSecs.toFixed(0), '| wall s', out.secs.toFixed(1), '| bot', JSON.stringify(out.bot), '| now', out.index, out.state);
  if (out.err) console.log('ERROR', out.err);
  const bad = logs.filter((l) => /error|warn/i.test(l) && !l.includes('GPU stall'));
  if (bad.length) console.log('console:\n' + bad.slice(-12).join('\n'));
  await b.close(); server.close();
})();
