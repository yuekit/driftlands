// Driftlands II build.
//   node build.mjs               dist/test.html (single file, three.js from a CDN; for local testing)
//   node build.mjs --standalone  dist/Driftlands2.html (single file, everything inlined, runs offline)
//   node build.mjs --web         dist/web/ (index.html + driftlands2.js + assets/, for hosting)
//   add --dev to skip minifying
import * as esbuild from 'esbuild';
import fs from 'fs';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const minify = !process.argv.includes('--dev');
const standalone = process.argv.includes('--standalone');
const web = process.argv.includes('--web');
const w = await esbuild.build({ entryPoints: ['src/worker.js'], bundle: true, format: 'iife', minify, write: false, target: 'es2020' });
const workerSrc = w.outputFiles[0].text;
const part = (f) => fs.readFileSync('src/' + f, 'utf8').trimEnd();
const readPage = () => fs.readFileSync('src/page.html', 'utf8').replace('<!-- @mark -->', () => part('mark.html') + '\n  ' + part('wordmark-symbol.html'));
const plugin = {
  name: 'v',
  setup(b) {
    if (!standalone && !web) b.onResolve({ filter: /^three$/ }, () => ({ path: THREE_URL, external: true }));
    b.onResolve({ filter: /^worker-src$/ }, () => ({ path: 'worker-src', namespace: 'v' }));
    b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: workerSrc, loader: 'text' }));
  },
};
const TITLE = 'Driftlands II: The Tall City';
const DESC = 'Driftlands II: The Tall City. Fly the Institute\'s airship across the Reach, cut the floating islands loose from the cables that are hauling them in, and land on the city that has been doing the hauling.';
if (web) {
  fs.rmSync('dist/web', { recursive: true, force: true });
  await esbuild.build({ entryPoints: { driftlands2: 'src/main.js' }, bundle: true, format: 'esm', minify, outdir: 'dist/web', target: 'es2020', plugins: [plugin],
    loader: { '.glb': 'file', '.jpg': 'file', '.webp': 'file', '.bin': 'file' }, assetNames: 'assets/[name]-[hash]', publicPath: '.' });
  const page = readPage();
  const cut = page.indexOf('<div id="dl-root"');
  const head = page.slice(0, cut).replace(/<title>.*?<\/title>/, '');
  const site = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#120f19">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:type" content="website">
<meta property="og:image" content="${site}share.jpg">${site ? `\n<meta property="og:url" content="${site}">\n<link rel="canonical" href="${site}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="modulepreload" href="driftlands2.js">
<style>[hidden]{display:none!important}html,body{margin:0;height:100%;background:#120f19}</style>
${head.trim()}
</head>
<body>
${page.slice(cut).trim()}
<noscript><p style="color:#f2e9dc;font-family:sans-serif;padding:24px">Driftlands II needs JavaScript and WebGL 2.</p></noscript>
<script type="module" src="driftlands2.js"></script>
</body>
</html>
`;
  fs.writeFileSync('dist/web/index.html', doc);
  if (fs.existsSync('web/share.jpg')) fs.copyFileSync('web/share.jpg', 'dist/web/share.jpg');
  const files = fs.readdirSync('dist/web', { recursive: true }).filter((f) => fs.statSync('dist/web/' + f).isFile());
  let total = 0; for (const f of files) total += fs.statSync('dist/web/' + f).size;
  console.log('built web', files.length, 'files,', (total / 1048576).toFixed(1), 'MB in dist/web');
  process.exit(0);
}
const m = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify, write: false, target: 'es2020', plugins: [plugin],
  loader: { '.glb': 'base64', '.bin': 'base64', '.jpg': 'dataurl', '.webp': 'dataurl' } });
const js = m.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readPage();
fs.mkdirSync('dist', { recursive: true });
const wrap = (body) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}html,body{margin:0;height:100%;background:#120f19}</style></head><body>' + body + '\n<script type="module">\n' + js + '\n</script></body></html>';
const out = standalone ? 'dist/Driftlands2.html' : 'dist/test.html';
fs.writeFileSync(out, wrap(page));
console.log('built', out, (fs.statSync(out).size / 1048576).toFixed(1), 'MB');
