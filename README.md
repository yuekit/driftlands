# Driftlands

Ride the warm air between floating islands and record the strange life on each one in your field journal, before the islands collide.

The archipelago has eight islands: Verdigris Reach, the Ochre Table and the Coral Rookery in the middle, and five outer islands, each with its own life: Windgate (a stone ring that swifts and sky rays fly through), the Glasswing Spires (glass centipedes and spire moths), the Ember Caldera (ash striders and cinderbells over a warm crater), Mirewater Shoal (waders and floating lilies on a still lake) and Rootfall Hollow (veil blooms and root worms beneath a curtain of hanging roots). The journal holds twenty species, four of which only appear after a convergence.

**Convergences.** When every species on two neighbouring islands is recorded, a current carries one island into the other: the Ochre Table into Verdigris Reach (this first one comes early, after any four records), the Ember Caldera into the Glasswing Spires, Mirewater Shoal into Rootfall Hollow, and Windgate into Rootfall Hollow. Each fused seam breeds a hybrid: the Seam strider, the Kilnback strider, the Rootwater bell and the Rootwing.

**The survey.** A surveyor came before you and left a listening post on every island. A post lights when every species native to its island is in your journal. Four islands (Verdigris Reach, Windgate, Mirewater Shoal and the Ember Caldera) also hold a camp beside the post: a cairn, a scrap of sail and a page of the old notebook, picked up by flying close. Letters from the Institute arrive as the journal fills. The journal's Letters tab keeps all eight. When the twentieth species is recorded every post sings at once (the Chord), the closing letter and credits play, and free flight carries on afterwards.

**Plates.** Every record is graded one to three stars: one for the record, one for framing (the animal a good size and near the middle of the lens) and one for catching a behaviour. Pressing the shutter on a recorded species retakes its plate and keeps the better one.

**Weather.** Fronts sweep across the archipelago one at a time: fog banks that hide islands, rain bands that kill thermals and bead the lens, and crosswinds that push the glider sideways and lean the thermal columns over. The pill under the clock says where the current front is. Some behaviours can only be seen in a particular front; the journal says which.

**Title screen.** The game opens on the Floating D: a striped island in the shape of the letter, with a grass top, mushrooms and hanging roots, over a lavender-to-peach sky and a white cloud sea. It is also the loading screen: the island rises out of the clouds as the world is built, the mushrooms pop and the roots drip when everything is ready, then the wordmark and the menu settle (Begin a new journal, Continue when a journal exists, Settings). Any key or click skips the reveal. The menu works with the mouse, arrow keys or W and S with Enter, touch, and a gamepad's D-pad with A. Beginning a flight lets the cloud sea swell over the plate before it clears onto the world. With reduced motion requested by the system the screen appears finished and still.

**The sequel.** `driftlands2/` holds Driftlands II: The Tall City, an airship action game on the same engine, set a year after the Chord. It has its own README, build and test tools, and leaves this game untouched.

## Play

Open `Driftlands.html` in a recent desktop Chrome, Edge, Safari or Firefox (WebGL 2). It is fully self-contained and runs offline; with a connection it also loads its web fonts. Progress is saved in the browser's local storage.

| Action | Mouse | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- | --- |
| Steer | Move the pointer | A/D bank, W climb, S dive (or arrows) | Drag on the left of the screen | Left stick (right stick swings the camera) |
| Lens (slows time) | Hold right button | Hold Space or Shift | Lens button | Hold LT or LB; right stick aims |
| Shutter | Click with the lens up | F with the lens up | Tap | A or RT with the lens up |
| Launch after landing | Click | W or Enter | Tap | A |
| Journal | | J | Journal badge | Y or View; D-pad picks an entry, B closes |
| Photo mode | Drag to look, scroll to zoom, click to focus | O (or the pause menu); WASD move, Q/E down and up, H hides the panel, Enter saves | Pause menu, drag to look | X; sticks move and look, triggers sink and rise, A saves, B leaves |

Start pauses on a gamepad (Chrome, Edge, Firefox and Safari; rumble where the browser supports it).

New journals start with a short guided first flight: banking, climbing in a thermal, finding and recording a stiltwalker, the journal and landing, with a marker on screen for each goal. It can be skipped from its panel; existing journals skip it. Besides thermals, wind meeting the windward cliffs of an island rises: flying along those faces climbs without a thermal.

Pause menu: pitch (normal or inverted), field of view, camera shake, motion effects (Reduced turns off shake, speed blur and most of the speed zoom; it starts on when the system asks for reduced motion), render style, quality (Low, Auto, High), time of day (cycle, day, night), text size, sound, and a keyboard panel where every key can be changed. The key names in this table are the defaults.

**Render style.** Ink plate (the default) draws the world like a coloured pen drawing: light falls in three flat tones, shade is hatched with pen lines that keep a constant size on screen, silhouettes and creases carry an ink line, the clouds are lit in flat tones and the air is clearer. Painted is the softer look of earlier versions. The "Ask the ecologist" notes need the claude.ai artifact runtime; elsewhere the journal shows its built-in notes.

## Build from source

```
cd source
npm install
node build.mjs                 # dist/driftlands.html (claude.ai artifact body, three.js from CDN) + dist/test.html
node build.mjs --standalone    # dist/Driftlands.html (three.js bundled, runs offline)
node build.mjs --web           # dist/web/: index.html, driftlands.js and assets/ as separate files, for hosting
node build.mjs --dev           # unminified
```

**Hosting.** Upload the contents of `dist/web/` to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3) at a domain root or in a subfolder; all paths are relative. Model and texture files carry a content hash in their names, so they can be cached for a long time, while `index.html` and `driftlands.js` should be served with a short cache. `source/web/share.jpg` (1200 by 630) is the picture link previews show; build with `SITE_URL=https://your.domain/ node build.mjs --web` once the address is known, because previews need the image address in full. The page loads its typefaces from Google Fonts and falls back to system fonts without them.

`src/main.js` is the entry. Embedded assets live in `src/assets/` (glider.glb, rocks.glb, flora.glb, parts.glb, skins.jpg, parts_anchors.json).

| Module | Role |
| --- | --- |
| input.js | Mouse, keyboard, touch and gamepad input, rumble |
| main.js, boot.js, worker.js | Startup, asset loading, island worker |
| islands-sdf.js, mesher.js, noise.js | The eight island SDFs, surface-nets meshing, baked AO and sun |
| world.js, kit.js, texgen.js | Islands, sky, water, falls, flora, boulders, floating rocks, thermals, GPU textures |
| glider.js, glidermodel.js | Flight model, chase camera, Blender glider, scarf and trails |
| creatures.js, tubes.js, skins.js, parts.js | Seventeen species on six body plans (walker, sessile, flyer, crawler, drifter, leviathan), behaviours, tube bodies, eyes, skins, sculpted parts |
| game.js, input.js, ui.js, audio.js, cycle.js | Game loop, lens and journal, convergence, controls, HUD, sound, day-night |
| glsl.js, shadow.js, post.js | Shared lighting (GGX specular, sky environment, aerial perspective, cloud shadows, thin-tissue transmission, plant push), cascaded soft shadows, render pipeline (ink plate style: banded light, pen hatching, depth-curvature ink line; two cloud layers, volumetric sun shafts, AgX, auto-exposure, contact shadows, TAA, lens depth of field, grading) |
| cloudgen.js | Tileable 3D cloud noise generated on the GPU at startup |
| water.js | Pool and channel water: planar mirror reflection, caustics, foam |
| glow.js | Night light pooled around glowing caps and creatures |
| particles.js | Stateless GPU particles: pollen, night spores, waterfall spray |
| weather.js | Weather fronts: fog, rain and crosswind bands, their effect on thermals, the glider, creatures, sound and the lens |
| guide.js | The guided first flight: goals, their markers and completion checks |
| convergence.js | The four convergences, what triggers each, and their hybrids |
| photo.js | Photo mode: free camera with time stopped, focal length, aperture and focus, exposure, white balance, time of day, grade presets, crop frames, PNG export |
| velocity.js | Motion vectors for creatures and the glider, used by TAA |
| landmarks.js | Listening posts, the old surveyor's camps and the beams of the Chord, built from code |
| story.js | The eight letters and notebook pages, and the credits |
| title.js, title.css, title.html, mark.html, wordmark-symbol.html | The title, loading and intro screen: the reveal, the menu and the handover to flight; the Floating D mark and the DRIFTLANDS wordmark as vector symbols. `title.html` and `wordmark-symbol.html` are written by `node tools/gen-title.cjs` (the island drawing and the wordmark outlines, traced from Young Serif, SIL Open Font License); `build.mjs` folds all of them into `page.html` |
| assetbuf.js | Loads a model from base64 (single-file builds) or a URL (hosted build) |
| perf.js, golden.js | GPU timers and overlay; golden views and benchmark path |

Debug: press P or F3 (or add `?perf`) for the performance overlay: frame time, draw calls, triangles and per-pass GPU timings (`EXT_disjoint_timer_query_webgl2`, Chrome and Edge). `__dl.bench()` flies a fixed loop around the three islands and logs average and 99th-percentile frame times as `BENCH {...}`; run it on real hardware after each change. `__dl.goldenView(i)` jumps to one of the twenty-one golden views in `src/golden.js`, the fixed cameras and times of day used to judge lighting changes; `python3 tools/shoot.py tools/golden.json` renders all twenty-one headless and `tools/sheet.py` makes a side-by-side contact sheet.

`window.__dl` also exposes the running game (`sim(seconds)`, `debugCam`, `weather.start('fog' | 'rain' | 'wind', position)`, `converge('ochre' | 'kiln' | 'rootwater' | 'gale')`, `cycle.setMode('night')`, `applyQuality(0-3)`). `tools/shoot.py` is the headless Playwright screenshot harness (`python3 tools/shoot.py steps.json [W H] [query] [outdir]`). `tools/title-shots.cjs` walks the title screen from loading to the first frames of flight (`SAVED=1` for a returning player, `TOUCH=1 W=844 H=390` for a phone). `tools/shoot.cjs` is the same harness for Node (`NODE_PATH=$(npm root -g) node tools/shoot.cjs tools/golden-views.json 1920 1080 out`), and `tools/ui-shots.cjs` walks the title, pause menu, key rebinding, journal, a camp pickup and the ending with the interface visible and reports console errors. Set `TOUCH=1 W=844 H=390` for a phone-sized touch run. `tools/web-check.cjs` serves `dist/web/` over HTTP, loads it and lists every request and console error. `tools/ending-check.cjs` resumes a finished journal that never saw its ending and checks that the Chord rises and the weather returns afterwards. `__dl.debugEnding()` records everything and plays the ending.

## Blender pipeline

Scripts run headless with Blender's Python module (`bpy`, Blender 5.2) plus numpy, scipy and scikit-image. Paths below are relative to each folder.

- **glider/**: `glider_model.py out.blend` builds the glider; `paint_sail.py` paints the livery; `bake_export.py <blend> <out_dir>` bakes and exports `glider.glb`; `prep_refined.py` cleans a hand-edited file before baking.
- **nature-kit/**: `rock_sdf.py <npz_dir>` sculpts rocks, `rocks_model.py` builds the editable blend, `bake_rocks.py` bakes `rocks.glb`; `flora_model.py` and `bake_flora.py` do the same for `flora.glb`.
- **creatures/**: `heads.py stilt,hybrid,crawler,whale,fin,fluke` sculpts parts, `parts_model.py` builds the editable blend, `bake_parts.py` bakes `parts.glb`; `skins.py` and `pack_skins.py` make the skin strip `skins.jpg`.

Copy the resulting GLB/JPEG files into `source/src/assets/` and rebuild. When editing the .blend files by hand, keep object names (Sail, LampGlass, FloatRock_n, Boulder_n, Parasol_A_..., StiltHead, WhaleHead and so on) so the game can find each part.
