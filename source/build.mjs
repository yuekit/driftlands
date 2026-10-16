import * as esbuild from 'esbuild';
import fs from 'fs';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const minify = !process.argv.includes('--dev');
const standalone = process.argv.includes('--standalone');   // bundle three.js in: runs offline from a local file
const w = await esbuild.build({ entryPoints: ['src/worker.js'], bundle: true, format: 'iife', minify, write: false, target: 'es2020' });
const workerSrc = w.outputFiles[0].text;
const plugin = {
  name: 'v',
  setup(b) {
    if (!standalone) b.onResolve({ filter: /^three$/ }, () => ({ path: THREE_URL, external: true }));
    b.onResolve({ filter: /^worker-src$/ }, () => ({ path: 'worker-src', namespace: 'v' }));
    b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: workerSrc, loader: 'text' }));
  },
};
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
