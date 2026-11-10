// node ui-shots.cjs outdir : walks the menus and the ending with the DOM visible, and reports console errors
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
const OUT = process.argv[2] || 'out-ui';
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
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await pg.addInitScript('try{localStorage.clear()}catch(e){}');
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  await pg.evaluate((sc) => { __dl.adaptQuality = () => {}; __dl.settings.quality = 'low'; __dl.applyQuality(0); __dl.pipe.scale = sc; __dl.resize(); }, +process.env.SCALE || 0.35);   // a small internal resolution keeps the software renderer responsive
  const shot = async (name, wait = 2500) => { await pg.waitForTimeout(wait); await pg.screenshot({ path: path.join(OUT, name + '.png'), timeout: 300000 }); console.log('shot', name); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, String(e.message).split('\n')[0]); } };
  await step('title', async () => { await shot('01-title', 6000); });
  await step('start', async () => { await pg.click('#t-start'); await pg.waitForFunction('__dl.state==="play"'); await pg.evaluate(() => { __dl.guide.skip(); }); await shot('02-hud', 5000); });
  await step('pause', async () => { await pg.keyboard.press('Escape'); await shot('03-pause'); });
  await step('keys', async () => {
    await pg.click('#p-keys'); await pg.click('#keys-list [data-act="lens"]'); await pg.keyboard.press('q'); await shot('04-keys', 800);
    console.log('bind lens =', await pg.evaluate(() => __dl.input.bind.lens), '| title label =', await pg.evaluate(() => document.getElementById('k-lens').textContent));
    await pg.click('#keys-list [data-act="up"]'); await pg.keyboard.press('Enter');
    console.log('reserved note =', await pg.evaluate(() => document.getElementById('keys-note').textContent));
    await pg.click('#keys-reset'); await pg.click('#keys-done');
    await pg.click('[data-set="text"] [data-v="large"]'); await pg.click('[data-set="fov"] [data-v="wide"]'); await pg.click('[data-set="motion"] [data-v="reduced"]');
    console.log('comfort =', await pg.evaluate(() => JSON.stringify([__dl.chase.fovBias, __dl.chase.shakeScale, __dl.reducedMotion, document.getElementById('dl-root').classList.contains('big-text')])));
    await shot('05-pause-large', 800);
    await pg.click('[data-set="text"] [data-v="normal"]'); await pg.click('[data-set="fov"] [data-v="normal"]'); await pg.click('[data-set="motion"] [data-v="full"]');
    await pg.keyboard.press('Escape');
  });
  await step('journal', async () => {
    await pg.evaluate(() => {
      const g = __dl; const S = g.eco.list.map((c) => c.sp).filter((s, i, a) => a.indexOf(s) === i).slice(0, 6);
      S.forEach((sp, i) => { g.j.recorded[sp.id] = { at: Date.now(), dist: 30, island: 'Verdigris Reach', flight: 0, stars: 1 + (i % 3), grade: { framed: i % 3 > 0, small: i % 3 === 0, behaviour: i % 3 > 1 } }; });
      g.deliver('commission'); g.j.letters.page1 = { at: Date.now() }; g.syncLandmarks(); g.ui.updateJournalBadge(g.j);
    });
    await shot('06-hud-mail', 1500);
    console.log('state before journal =', await pg.evaluate(() => __dl.state + ' mode=' + __dl.input.mode)); if (process.env.TOUCH) await pg.tap('#jbadge'); else await pg.keyboard.press('j'); await shot('07-journal-letters', 1500);
    await pg.click('#jt-plates'); await shot('08-journal-plates', 1200);
    await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowDown'); await shot('09-journal-page', 1200);
    await pg.keyboard.press('ArrowDown'); await shot('10-journal-locked', 800);
    await pg.keyboard.press('j');
    console.log('state after journal =', await pg.evaluate(() => __dl.state), '| unread =', await pg.evaluate(() => __dl.unreadLetters()));
  });
  await step('camp', async () => {
    const r = await pg.evaluate(() => { const g = __dl, c = g.landmarks.camps.find((k) => !k.found); g.glider.place(c.world.clone().add(new THREE_V(0, 14, 0)), 0); return [c.key, g.landmarks.posts.length, g.landmarks.camps.length]; }).catch(async () => pg.evaluate(() => { const g = __dl, c = g.landmarks.camps.find((k) => !k.found); g.glider.pos.copy(c.world); g.glider.pos.y += 14; return [c.key, g.landmarks.posts.length, g.landmarks.camps.length]; }));
    console.log('camp test =', JSON.stringify(r));
    await shot('11-page-found', 6000);
    console.log('letters =', await pg.evaluate(() => Object.keys(__dl.j.letters).join(',')));
  });
  await step('ending', async () => {
    await pg.evaluate(() => __dl.debugEnding());
    await shot('12-ending-letter', 9000);
    await pg.keyboard.press('Enter'); await shot('13-ending-full', 3000);
    await pg.keyboard.press('Enter'); await shot('14-credits', 3000);
    await pg.keyboard.press('Enter'); await shot('15-after', 5000);
    console.log('state after ending =', await pg.evaluate(() => __dl.state + ' ended=' + __dl.j.ended + ' chord=' + __dl.landmarks.chordTarget));
  });
  console.log(logs.length ? logs.slice(-25).join('\n') : 'no console errors or warnings');
  await b.close();
})();
