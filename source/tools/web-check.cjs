// node tools/web-check.cjs [outdir]
// Serves dist/web over HTTP the way a static host would, loads it, and reports every request and any console error.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'dist', 'web');
const OUT = process.argv[2] || 'out';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream' };
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { seen.push('404 ' + rel); res.writeHead(404); res.end(); return; }
    seen.push('200 ' + rel + ' ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const logs = [];
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));
  pg.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
  await pg.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await pg.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ body: '', contentType: 'font/woff2' }));
  const t0 = Date.now();
  await pg.goto(url, { timeout: 120000 });
  await pg.waitForFunction('window.__dl && window.__dl.state==="title"', null, { timeout: 400000 });
  console.log('title after', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('ask-the-ecologist available =', await pg.evaluate(() => !!(window.claude && window.claude.use)));
  await pg.waitForTimeout(4000);
  await pg.screenshot({ path: path.join(OUT, 'web-title.png'), timeout: 300000 });
  console.log(seen.join('\n'));
  console.log(logs.length ? logs.join('\n') : 'no console errors or warnings');
  await b.close(); srv.close();
})();
