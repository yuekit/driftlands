import * as THREE from 'three';
import { U } from './glsl.js';
import { generateWorld } from './boot.js';
import { generateCloudNoise } from './cloudgen.js';
import { Mirror } from './water.js';
import { GlowMap } from './glow.js';
import { Motes } from './particles.js';
import { Pipeline } from './post.js';
import { makeSky, Island, Rocklets, RockletsKit, distantIslands, Thermals, setSurfaceTextures, setMirror } from './world.js';
import { loadKit } from './kit.js';
import { loadSkins } from './skins.js';
import { loadParts } from './parts.js';
import { generateSurfaceTextures } from './texgen.js';
import { Ecosystem } from './creatures.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { SunShadow, markCaster } from './shadow.js';
import { UI } from './hud.js';
import { GpuTimer, PerfOverlay } from './perf.js';
import { VelocityPass } from './velocity.js';
import { Landmarks } from './landmarks.js';
import { City } from './city.js';
import { loadShip, Airship, ShipCam } from './ship.js';
import { BellSpire } from './bell.js';
import { Skerries } from './skerries.js';
import { Kit } from './kits.js';
import { Loom, LOOM_MODELS } from './loom.js';
import { Halyard, HALYARD_MODELS } from './halyard.js';

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
    ui.fatal('This browser could not start WebGL 2, which Driftlands needs. Try a recent Chrome, Edge, Safari or Firefox.');
    return;
  }
  renderer.setPixelRatio(1);
  renderer.info.autoReset = false;
  renderer.autoClear = true;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const q = params.get('q'), quality = q === 'low' ? 0 : q === 'high' ? 3 : 2;

  const kitP = (params.has('nokit') ? Promise.resolve(null) : loadKit()).catch((e) => { console.warn('Nature kit unavailable, using the built-in flora', e); return null; });
  const skinP = loadSkins();
  const partsP = loadParts();
  // the city and the ship load while the islands are being raised
  let pw = 0, pc = 0, pg = 0, ph = 0;
  const report = () => ui.progress(pw * 0.4 + pc * 0.1 + pg * 0.2 + ph * 0.3, pw < 1 ? 'Raising the islands' : pg < 1 ? 'Weaving the Loom' : ph < 1 ? 'Rigging Halyard' : 'Lighting the lamps');
  const city = new City();
  const cityP = city.load(renderer, (p) => { pc = p; report(); }, Math.min(quality, 1));
  // the two kits load one after the other so their pictures are not all being decoded at once
  const gae = new Kit('gae'), csk = new Kit('csk');
  const kitsP = gae.load(renderer, quality, LOOM_MODELS, (p) => { pg = p; report(); }).then(() => csk.load(renderer, quality, HALYARD_MODELS, (p) => { ph = p; report(); }));
  const shipP = loadShip(renderer);
  const data = await generateWorld((p) => { pw = p; report(); });
  await skinP;
  const kit = await kitP;

  const noise = generateCloudNoise(renderer);
  setSurfaceTextures(generateSurfaceTextures(renderer, 1024));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 20000);
  scene.add(makeSky());
  const mirror = new Mirror(renderer);
  setMirror(mirror);
  const islands = data.islands.map((d, i) => new Island(i, d, scene, kit));
  const rocks = kit ? new RockletsKit(scene, kit, islands) : new Rocklets(scene, data.clouds.rocks, islands);
  await cityP;
  scene.add(city.group);
  // the Bell stands at the back of the lamp square, where the roofs open to the sky
  const bell = await new BellSpire().load(scene, city.toWorld(-25.5, 1.0, -17.5), 300, 26);
  const skerries = await new Skerries().load(scene);
  await kitsP;
  const loom = new Loom(scene, gae, islands);
  const halyard = new Halyard(scene, csk);
  {
    // the same corridor the game leads Halyard in by (see Game.setupSites)
    const LT = islands.find((I) => I.spec.key === 'loom').basePos, mx = LT.x - 790, mz = LT.z + 130, keep = [city.centre];
    for (let k = 0; k <= 6; k++) keep.push({ x: mx - 3900 * (k / 6) - 300, z: mz - 1900 * (k / 6) - 100, r: 1900 });
    distantIslands(scene, islands, keep);
  }
  const thermals = new Thermals(scene, islands);
  const model = await shipP;
  const ship = new Airship(scene, model);
  const cam = new ShipCam(camera);
  const eco = new Ecosystem(scene, islands, data.islands);
  eco.setParts(await partsP);
  if (eco.D.parts) for (const k in eco.D.parts) markCaster(eco.D.parts[k].mesh);
  if (eco.D.pPetal) markCaster(eco.D.pPetal.mesh);
  const landmarks = new Landmarks(scene, islands);
  const world = { islands, rocks, thermals, eco };
  const pipe = new Pipeline(renderer, noise);
  const shadow = new SunShadow(renderer, 2048);
  const vel = new VelocityPass();
  pipe.vel = vel;
  for (const m of [eco.D.tubes.mesh, eco.D.glass.mesh]) vel.register(m, 'tube');
  for (const m of [eco.D.pEll.mesh, eco.D.pLimb.mesh, eco.D.pFin.mesh]) vel.register(m, 'inst');
  if (eco.D.parts) for (const k in eco.D.parts) vel.register(eco.D.parts[k].mesh, 'inst');
  if (eco.D.pPetal) vel.register(eco.D.pPetal.mesh, 'inst');
  vel.register(ship.root, 'rigid');
  for (const m of [eco.D.pEll.mesh, eco.D.pLimb.mesh, eco.D.pFin.mesh, eco.D.tubes.mesh]) markCaster(m);
  for (const isl of islands) {
    if (isl.flora.userData.casters) isl.flora.userData.casters.forEach(markCaster);
    else { const f = isl.flora.children; if (f[1]) markCaster(f[1]); if (f[2]) markCaster(f[2]); }
  }
  if (kit) for (const m of rocks.meshes) markCaster(m);
  const input = new Input(canvas);

  const game = new Game({ renderer, scene, camera, pipe, shadow, world, ship, cam, city, bell, skerries, loom, halyard, input, ui, canvas, landmarks, debug: DEBUG, mirror, glow: new GlowMap(renderer), motes: new Motes(scene, islands) });
  await game.combat.load(renderer, quality);
  game.applyQuality(game.quality.level);
  window.__dl = game; window.__U = U; window.__THREE = THREE;
  pipe.timer = new GpuTimer(renderer);
  game.perf = new PerfOverlay(game);

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
  renderer.compile(scene, camera);
  game.start();
}

main().catch((e) => { console.error(e); window.__dlUI && window.__dlUI.fatal('Something went wrong while raising the islands: ' + (e && e.message ? e.message : e)); });
