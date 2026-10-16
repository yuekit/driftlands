import * as THREE from 'three';
import { U } from './glsl.js';
import { generateWorld } from './boot.js';
import { Pipeline } from './post.js';
import { makeSky, Island, Rocklets, RockletsKit, distantIslands, Thermals, setSurfaceTextures } from './world.js';
import { loadKit } from './kit.js';
import { loadSkins } from './skins.js';
import { loadParts } from './parts.js';
import { generateSurfaceTextures } from './texgen.js';
import { Glider, ChaseCam } from './glider.js';
import { Ecosystem, SPECIES } from './creatures.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { SunShadow, markCaster } from './shadow.js';
import { UI } from './ui.js';
import { loadGliderModel } from './glidermodel.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

async function main() {
  const canvas = document.getElementById('dl-canvas');
  const ui = new UI();
  window.__dlUI = ui;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
  } catch (e) {
    ui && ui.fatal('This browser could not start WebGL 2, which Driftlands needs. Try a recent Chrome, Edge, Safari or Firefox.');
    return;
  }
  renderer.setPixelRatio(1);
  renderer.autoClear = true;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const kitP = (params.has('nokit') ? Promise.resolve(null) : loadKit()).catch((e) => { console.warn('Nature kit unavailable, using the built-in flora', e); return null; });
  const skinP = loadSkins();
  const partsP = loadParts();
  const data = await generateWorld((p) => ui && ui.progress(p));
  await skinP;
  const kit = await kitP;

  const noise = new THREE.Data3DTexture(data.clouds.data, 64, 64, 64);
  noise.format = THREE.RGBAFormat; noise.type = THREE.UnsignedByteType;
  noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
  noise.minFilter = THREE.LinearFilter; noise.magFilter = THREE.LinearFilter;
  noise.unpackAlignment = 1; noise.needsUpdate = true;

  setSurfaceTextures(generateSurfaceTextures(renderer, 1024));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 20000);
  scene.add(makeSky());
  const islands = data.islands.map((d, i) => new Island(i, d, scene, kit));
  const rocks = kit ? new RockletsKit(scene, kit, islands) : new Rocklets(scene, data.clouds.rocks, islands);
  distantIslands(scene, islands);
  const thermals = new Thermals(scene, islands);
  const glider = new Glider(scene);
  const chase = new ChaseCam(camera);
  const eco = new Ecosystem(scene, islands, data.islands);
  eco.setParts(await partsP);
  if (eco.D.parts) for (const k in eco.D.parts) markCaster(eco.D.parts[k].mesh);
  if (eco.D.pPetal) markCaster(eco.D.pPetal.mesh);
  const world = { islands, rocks, thermals, eco };
  const pipe = new Pipeline(renderer, noise);
  const shadow = new SunShadow(renderer, 2048, 170);
  markCaster(glider.root); markCaster(glider.scarfMesh);
  for (const m of [eco.D.pEll.mesh, eco.D.pLimb.mesh, eco.D.pFin.mesh, eco.D.tubes.mesh]) markCaster(m);
  for (const isl of islands) {
    if (isl.flora.userData.casters) isl.flora.userData.casters.forEach(markCaster);
    else { const f = isl.flora.children; if (f[1]) markCaster(f[1]); if (f[2]) markCaster(f[2]); }
  }
  if (kit) for (const m of rocks.meshes) markCaster(m);
  const input = new Input(canvas);

  const game = new Game({ renderer, scene, camera, pipe, shadow, world, glider, chase, eco, input, ui, canvas, debug: DEBUG });
  window.__dl = game;
  loadGliderModel().then((m) => { glider.useModel(m); renderer.compile(scene, camera); }).catch((e) => console.warn('Glider model unavailable, using the built-in one', e));

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * game.quality.dprScale;
    renderer.setSize(Math.round(w * dpr * pipe.scale), Math.round(h * dpr * pipe.scale), false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    pipe.resize(w, h, dpr);
  }
  game.resize = resize;
  window.addEventListener('resize', resize);
  resize();
  // compile shaders before first visible frame
  renderer.compile(scene, camera);
  game.start();
}

main().catch((e) => { console.error(e); window.__dlUI && window.__dlUI.fatal('Something went wrong while raising the islands: ' + (e && e.message ? e.message : e)); });
