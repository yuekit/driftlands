# Driftlands

Ride the warm air between floating islands and record the strange life on each one in your field journal, before the islands collide.

## Play

Open `Driftlands.html` in a recent desktop Chrome, Edge, Safari or Firefox (WebGL 2). It is fully self-contained and runs offline; with a connection it also loads its web fonts. Progress is saved in the browser's local storage.

| Action | Mouse | Keyboard | Touch |
| --- | --- | --- | --- |
| Steer | Move the pointer | A/D bank, W climb, S dive (or arrows) | Drag on the left of the screen |
| Lens (slows time) | Hold right button | Hold Space, Shift or E | Lens button |
| Shutter | Click with the lens up | F with the lens up | Tap |
| Launch after landing | Click | W or Enter | Tap |
| Journal | | J | Journal badge |

Pause menu: invert, ink outlines, sound, time of day (cycle, day, night) and quality (Low, Auto, High). The "Ask the ecologist" notes need the claude.ai artifact runtime; elsewhere the journal shows its built-in notes.

## Build from source

```
cd source
npm install
node build.mjs                 # dist/driftlands.html (claude.ai artifact body, three.js from CDN) + dist/test.html
node build.mjs --standalone    # dist/Driftlands.html (three.js bundled, runs offline)
node build.mjs --dev           # unminified
```

`src/main.js` is the entry. Embedded assets live in `src/assets/` (glider.glb, rocks.glb, flora.glb, parts.glb, skins.jpg, parts_anchors.json).

| Module | Role |
| --- | --- |
| main.js, boot.js, worker.js | Startup, asset loading, island worker |
| islands-sdf.js, mesher.js, noise.js | Island SDFs, surface-nets meshing, baked AO and sun |
| world.js, kit.js, texgen.js | Islands, sky, water, falls, flora, boulders, floating rocks, thermals, GPU textures |
| glider.js, glidermodel.js | Flight model, chase camera, Blender glider, scarf and trails |
| creatures.js, tubes.js, skins.js, parts.js | Species, behaviours, tube bodies, eyes, skins, sculpted parts |
| game.js, input.js, ui.js, audio.js, cycle.js | Game loop, lens and journal, convergence, controls, HUD, sound, day-night |
| glsl.js, shadow.js, post.js, cloudtex.js | Shared lighting, sun shadows, render pipeline, cloud noise |

Debug: `window.__dl` exposes the running game (`sim(seconds)`, `debugCam`, `cycle.setMode('night')`, `applyQuality(0-3)`). `shoot.py` is the headless Playwright screenshot harness used for testing (`python3 shoot.py steps.json [W H]`).

## Blender pipeline

Scripts run headless with Blender's Python module (`bpy`, Blender 5.2) plus numpy, scipy and scikit-image. Paths below are relative to each folder.

- **glider/**: `glider_model.py out.blend` builds the glider; `paint_sail.py` paints the livery; `bake_export.py <blend> <out_dir>` bakes and exports `glider.glb`; `prep_refined.py` cleans a hand-edited file before baking.
- **nature-kit/**: `rock_sdf.py <npz_dir>` sculpts rocks, `rocks_model.py` builds the editable blend, `bake_rocks.py` bakes `rocks.glb`; `flora_model.py` and `bake_flora.py` do the same for `flora.glb`.
- **creatures/**: `heads.py stilt,hybrid,crawler,whale,fin,fluke` sculpts parts, `parts_model.py` builds the editable blend, `bake_parts.py` bakes `parts.glb`; `skins.py` and `pack_skins.py` make the skin strip `skins.jpg`.

Copy the resulting GLB/JPEG files into `source/src/assets/` and rebuild. When editing the .blend files by hand, keep object names (Sail, LampGlass, FloatRock_n, Boulder_n, Parasol_A_..., StiltHead, WhaleHead and so on) so the game can find each part.
