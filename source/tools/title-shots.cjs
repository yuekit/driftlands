// node tools/title-shots.cjs outdir : the title screen from loading to the first frames of flight, with the DOM visible.
// W, H, TOUCH=1 and SAVED=1 (a journal with seven plates) change the run; reports console errors.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
const OUT = process.argv[2] || 'out-title';
const W = +process.env.W || 1280, H = +process.env.H || 720;
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: !!process.env.TOUCH, isMobile: !!process.env.TOUCH });
  const pg = await ctx.newPage();
  const logs = [];
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  if (!process.env.FONTS) await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  const saved = process.env.SAVED ? JSON.stringify({ recorded: Object.fromEntries(['stilt', 'polyp', 'kite', 'crawler', 'lantern', 'whale', 'swift'].map((k) => [k, { at: 1, dist: 30, island: 'Verdigris Reach', flight: 0, stars: 2 }])), progress: {}, tags: {}, notes: {}, conv: {}, letters: {}, read: {}, ended: false, started: true, flightTime: 60, guide: { done: true } }) : null;
  await pg.addInitScript(`try{localStorage.clear();${saved ? `localStorage.setItem(${JSON.stringify(process.env.STORE || 'driftlands-journal-v1')},${JSON.stringify(saved)})` : ''}}catch(e){}`);
  const shot = async (name) => { await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 300000 }); console.log('shot', name); };
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000, waitUntil: 'commit' });
  await pg.waitForSelector('#title'); await pg.waitForTimeout(400); await shot('01-cloud-sea');
  await pg.waitForFunction('document.getElementById("title").classList.contains("b2")', null, { timeout: 300000 }); await pg.waitForTimeout(1200); await shot('02-rising');
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  await pg.evaluate((sc) => { __dl.adaptQuality = () => {}; __dl.settings.quality = 'low'; __dl.applyQuality(0); __dl.pipe.scale = sc; __dl.resize(); }, +process.env.SCALE || 0.35);
  await pg.waitForFunction('document.getElementById("title").classList.contains("b3")', null, { timeout: 60000 }); await pg.waitForTimeout(900); await shot('03-mushrooms-roots');
  await pg.waitForFunction('document.getElementById("title").classList.contains("b4")', null, { timeout: 60000 }); await pg.waitForTimeout(3200); await shot('04-title');
  console.log('menu =', await pg.evaluate(() => [...document.querySelectorAll('.ts-item')].map((b) => b.id + ':' + b.textContent + (b.classList.contains('sel') ? '*' : '')).join(' | ')), '| focus =', await pg.evaluate(() => document.activeElement && document.activeElement.id));
  await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(400);
  console.log('after down: sel =', await pg.evaluate(() => document.querySelector('.ts-item.sel').id));
  if (process.env.SAVED) {
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(500); await shot('05-confirm-new');
    console.log('confirm =', await pg.evaluate(() => [...document.querySelectorAll('.ts-item')].map((b) => b.id + (b.classList.contains('sel') ? '*' : '')).join(' | ')));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    console.log('after escape =', await pg.evaluate(() => [...document.querySelectorAll('.ts-item')].map((b) => b.id + (b.classList.contains('sel') ? '*' : '')).join(' | ')));
  }
  if (process.env.TOUCH) await pg.tap('#t-settings'); else await pg.click('#t-settings');
  await pg.waitForTimeout(900); await shot('06-settings');
  console.log('settings: state =', await pg.evaluate(() => __dl.state), '| heading =', await pg.evaluate(() => document.getElementById('pause-h').textContent), '| visible buttons =', await pg.evaluate(() => [...document.querySelectorAll('#pause .row-actions button, #p-newwrap button, #p-ending')].filter((b) => b.offsetParent).map((b) => b.textContent).join(',')));
  await pg.click('[data-set="sound"] [data-v="false"]'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(600);
  console.log('settings closed: pause hidden =', await pg.evaluate(() => document.getElementById('pause').hidden), '| sound =', await pg.evaluate(() => __dl.settings.sound), '| focus =', await pg.evaluate(() => document.activeElement && document.activeElement.id));
  await pg.evaluate(() => __dl.setSetting('sound', true));
  if (process.env.TOUCH) await pg.tap('#t-start'); else await pg.click('#t-start');
  await pg.waitForTimeout(550); await shot('07-clouds-swell');
  await pg.waitForFunction('__dl.state==="play"', null, { timeout: 20000 }); await pg.waitForTimeout(700); await shot('08-clearing');
  await pg.waitForTimeout(4000); await shot('09-flight');
  console.log('title hidden =', await pg.evaluate(() => document.getElementById('title').hidden), '| hud on =', await pg.evaluate(() => document.getElementById('hud').classList.contains('on')));
  console.log(logs.length ? logs.join('\n') : 'no console errors or warnings');
  await b.close();
})();
