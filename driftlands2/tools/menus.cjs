// Works the menus with a made-up gamepad and no picture: the title, settings, starting a voyage, pausing in the
// middle of a line of dialogue (which must wait), backing out and leaving for the title.
//   node tools/menus.cjs
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE_DIR = path.join(ROOT, 'node_modules/three/build');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`.slice(0, 900)));
  await pg.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().split('/').pop().replace('.min.js', '.js')), contentType: 'application/javascript' }));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await pg.goto('file://' + path.join(ROOT, process.env.PAGE || 'dist/test.html'), { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 300000 });
  const out = await pg.evaluate(async () => {
    const g = __dl, log = [];
    g.adaptQuality = () => {}; g._frame = g.frame.bind(g); g.frame = () => {}; g.audio.start = () => {};
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [pad];
    const step = (n = 1) => { for (let i = 0; i < n; i++) { g.camera.updateMatrixWorld(); g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert(); g._frame(1 / 30, false); } };
    const press = (i) => { pad.buttons[i].pressed = true; step(); pad.buttons[i].pressed = false; step(); };
    const flick = (y) => { pad.axes[1] = -y; step(); pad.axes[1] = 0; step(); };
    const foc = () => (document.activeElement && document.activeElement.tagName === 'BUTTON' ? document.activeElement.textContent.trim() : '(none)');
    const P = () => !document.getElementById('pause').hidden;
    const note = (what) => log.push(`${what} | state ${g.state} | panel ${P() ? g.ui.tab : '-'} | focus ${foc()}`);
    step(5); note('start');
    press(13); note('d-pad down');
    press(15); note('d-pad right');
    flick(-1); note('stick down (one row: steps along)');
    press(14); note('d-pad left');
    press(0); note('A on Settings');
    press(12); note('up'); press(12); note('up'); press(15); note('right');
    press(0); note('A on a setting'); log.push('  pressed: ' + [...document.querySelectorAll('#pause [aria-pressed=true]')].map((b) => b.textContent).join(','));
    press(14); press(0); note('left, A (put it back)'); log.push('  pressed: ' + [...document.querySelectorAll('#pause [aria-pressed=true]')].map((b) => b.textContent).join(','));
    press(1); note('B');
    press(9); step(90); note('Start, 3 s');
    g.ui.clearSay(); g.ui.say('Idris Vane', 'First line for the test.', 5); g.ui.say('Wren Halloway', 'Second line for the test.', 5); step(20);
    const t0 = g.ui.subT, q0 = g.ui.subQ.length, time0 = g.time;
    press(9); note('Start in flight');
    step(400);
    log.push(`  paused 13 s: subtitle timer ${t0.toFixed(2)} -> ${g.ui.subT.toFixed(2)}, queued ${q0} -> ${g.ui.subQ.length}, game time moved ${(g.time - time0).toFixed(2)} s, line "${document.getElementById('s-line').textContent}"`);
    press(13); note('d-pad down'); press(15); press(15); note('right x2');
    press(0); note('A on How to fly');
    press(1); note('B (back to pause)');
    press(1); note('B (resume)');
    step(30); log.push(`  resumed 1 s: subtitle timer ${g.ui.subT.toFixed(2)}, queued ${g.ui.subQ.length}`);
    press(9); press(13); press(15); press(15); press(15); note('Start, down, right x3');
    press(0); step(60); note('A, 2 s');
    press(9); step(90); note('Start on the title again, 3 s');
    return log;
  });
  console.log(out.join('\n'));
  const bad = logs.filter((l) => /error|warn/i.test(l) && !l.includes('GPU stall'));
  if (bad.length) console.log('console:\n' + bad.slice(-8).join('\n'));
  await b.close();
})();
