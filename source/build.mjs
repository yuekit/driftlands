import * as esbuild from 'esbuild';
import fs from 'fs';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const minify = !process.argv.includes('--dev');
const standalone = process.argv.includes('--standalone');
const web = process.argv.includes('--web');                 // hosted build: index.html + driftlands.js + assets/ as separate, cacheable files   // bundle three.js in: runs offline from a local file
const w = await esbuild.build({ entryPoints: ['src/worker.js'], bundle: true, format: 'iife', minify, write: false, target: 'es2020' });
const workerSrc = w.outputFiles[0].text;
const plugin = {
  name: 'v',
  setup(b) {
    if (!standalone && !web) b.onResolve({ filter: /^three$/ }, () => ({ path: THREE_URL, external: true }));
    b.onResolve({ filter: /^worker-src$/ }, () => ({ path: 'worker-src', namespace: 'v' }));
    b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: workerSrc, loader: 'text' }));
  },
};
if (web) {
  fs.rmSync('dist/web', { recursive: true, force: true });
  await esbuild.build({ entryPoints: { driftlands: 'src/main.js' }, bundle: true, format: 'esm', minify, outdir: 'dist/web', target: 'es2020', plugins: [plugin], loader: { '.glb': 'file', '.jpg': 'file' }, assetNames: 'assets/[name]-[hash]', publicPath: '.' });
  const pageW = fs.readFileSync('src/page.html', 'utf8');
  const cut = pageW.indexOf('<div id="dl-root">');
  const head = pageW.slice(0, cut).replace('<title>Driftlands</title>', '');
  const desc = 'Driftlands is a glider game about a naturalist surveying floating islands above a sea of cloud. Ride the warm air, study the strange life on each island, and fill your field journal.';
  const site = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';   // link previews need an absolute image address
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Driftlands</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#120f19">
<meta property="og:title" content="Driftlands">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:image" content="${site}share.jpg">${site ? `\n<meta property="og:url" content="${site}">\n<link rel="canonical" href="${site}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="modulepreload" href="driftlands.js">
<style>[hidden]{display:none!important}html,body{margin:0;height:100%;background:#120f19}</style>
${head.trim()}
</head>
<body>
${pageW.slice(cut).trim()}
<noscript><p style="color:#f2e9dc;font-family:sans-serif;padding:24px">Driftlands needs JavaScript and WebGL 2.</p></noscript>
<script type="module" src="driftlands.js"></script>
</body>
</html>
`;
  fs.writeFileSync('dist/web/index.html', doc);
  if (fs.existsSync('web/share.jpg')) fs.copyFileSync('web/share.jpg', 'dist/web/share.jpg');
  const files = fs.readdirSync('dist/web', { recursive: true }).filter((f) => fs.statSync('dist/web/' + f).isFile());
  let total = 0; for (const f of files) total += fs.statSync('dist/web/' + f).size;
  console.log('built web', files.length, 'files,', (total / 1024).toFixed(1), 'KB in dist/web');
  process.exit(0);
}
const m = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify, write: false, target: 'es2020', plugins: [plugin], loader: { '.glb': 'base64', '.jpg': 'dataurl' } });
let js = m.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
if (standalone) {
  const doc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}html,body{margin:0;height:100%;background:#120f19}</style></head><body>' + page + '\n<script type="module">\n' + js + '\n</script></body></html>';
  fs.writeFileSync('dist/Driftlands.html', doc);
  console.log('built standalone', (fs.statSync('dist/Driftlands.html').size / 1024).toFixed(1), 'KB');
  process.exit(0);
}
fs.writeFileSync('dist/driftlands.html', page + '\n<script type="module">\n' + js + '\n</script>\n');
// local test wrapper with full document
fs.writeFileSync('dist/test.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + page + '\n<script type="module">\n' + js + '\n</script></body></html>');
console.log('built', (fs.statSync('dist/driftlands.html').size / 1024).toFixed(1), 'KB');
