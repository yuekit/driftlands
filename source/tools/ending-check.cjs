// node tools/ending-check.cjs
// A journal with all twenty plates but no ending (closed early, or carried over from an older build) must raise the
// Chord when the flight resumes, and the weather must come back after the ending.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  pg.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await pg.addInitScript('try{localStorage.clear()}catch(e){}');
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  const r = await pg.evaluate(async () => {
    const g = __dl, out = {};
    g.adaptQuality = () => {}; g.applyQuality(0); g.pipe.scale = 0.3; g.resize();
    const frame = g.frame.bind(g); g.frame = () => {};                       // step the game by hand; real time is too slow here
    const run = async (sec) => { for (let t = 0; t < sec; t += 1 / 15) { frame(1 / 15, false); if ((t * 15 | 0) % 20 === 0) await new Promise((r) => setTimeout(r, 0)); } };
    g.guide.skip && g.guide.skip();
    document.getElementById('t-start').click();
    await run(1);
    // a finished survey as an older build would have saved it: every plate, no `ended`
    const se = g.startEnding; g.startEnding = () => {}; g.debugEnding(); g.startEnding = se;   // fills every plate without playing the ending
    for (const k in g.j.recorded) delete g.j.recorded[k].stars;
    delete g.j.ended; out.plates = Object.keys(g.j.recorded).length;
    g.timers = []; g.state = 'title'; g.begin();
    await run(8); out.before = g.state + ' chordOn=' + !!g.chordOn;           // expect: play chordOn=false
    await run(4); out.chord = g.state + ' chordOn=' + !!g.chordOn;            // expect: play chordOn=true
    await run(14); out.ending = g.state + ' ended=' + g.j.ended + ' calm=' + (g.weather.calm > 1e8 ? 'held' : 'running');   // expect: ending ended=true calm=held
    g.ui.endingAdvance(true);
    await run(1); out.after = g.state + ' calm=' + (g.weather.calm > 1e8 ? 'held' : Math.round(g.weather.calm) + 's');      // expect: play calm=90-180s
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log(logs.length ? logs.join('\n') : 'no console errors');
  await b.close();
})();
