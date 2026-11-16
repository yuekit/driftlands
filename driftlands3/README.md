# Driftlands III: The Long Splice

Three weeks after the Bell, the Tall City's lit windows have fetched something out of the cloud: Halyard, a town of
patched iron houses that has never landed, coming up the wind toward the Weavers' village west of Rootfall with its
engines failing. You fly the Meridian Institute's airship, the Long Gallery, out to meet it.

Driftlands II cut cables. This one ties them.

| Chapter | Where | What happens |
| --- | --- | --- |
| I. The Loom | The Weavers' three tables, morning | Hail the five great houses with the ship's bell |
| II. Halyard | Open cloud, day | Break the three pruning hooks the Tenders have sunk in the town |
| III. The Way In | A storm, toward dusk | Lead the town in; wake stalled houses with the bell; bring down the Shearsman |
| IV. The Long Splice | The lee of the Loom, dusk into night | Carry five lines from the tables to the houses, berth at the Hall, ring her in |

After the ending the world opens for free flight, with both towns lit and moored.

## Controls

| | Mouse and keys | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | Move the ring, or WASD / arrows | Left stick | Drag on the left |
| Chord lances | Hold click or Space | Right trigger | Fire |
| Ship's bell (hails a house, wakes engines, breaks Tenders nearby) | Right click or E | X | Bell |
| Speed | Shift | A | Boost |
| Slow down (and berth) | Ctrl or C | B | Slow |
| Pause, settings, chapters | Esc or P | Start | Pause button |

## Building

The two towns are built from two purchased KitBash3D kits, Gaea and City in the Sky. Their derived files are large
(about 340 MB) and are **not** in this repository: `src/assets/d3/` is ignored. They are made from the converted kits in
the 3D library on the Mac (`3d-library/Kitbash3D/kb3d_gaea/converted`, `kb3d_cityinthesky/converted`):

```
npm install
L=~/Documents/GitHub/supercollider/3d-library/Kitbash3D
node tools/d3/kit_tex.mjs $L/kb3d_gaea/converted tools/d3/.cache/gae            # two maps a material, at source size
node tools/d3/kit_tex.mjs $L/kb3d_cityinthesky/converted tools/d3/.cache/csk
node tools/d3/kit_geo.mjs <kit folder> <Model> tools/d3/.cache/geo/<gae|csk> --mats=tools/d3/.cache/<kit>/mats.json [--cap=N]
node tools/d3/gen_index.mjs                                                     # src/assets/d3/ + src/d3assets.js
node build.mjs --web          # dist/web/, the folder to host (index.html, driftlands3.js, assets/)
node build.mjs --web --dev    # the same, not minified (what the tools below load)
```

`tools/d3/jobs.txt` (one line a model, with this Mac's library paths) is the list the whole batch was run from:
`cat tools/d3/jobs.txt | xargs -P 12 -L 1 node tools/d3/kit_geo.mjs`. The single-file builds of Driftlands II
(`dist/test.html`, `--standalone`) are not practical at this size; use `--web`.

`?q=low` or `?q=high` on the address forces a quality level; `?debug` shows timings.

## What is new in the engine

- **Kits as single draw calls** (`src/kits.js`). Every model is one mesh at three levels of detail. All of a kit's
  materials live in two texture arrays (colour + metalness, normal + roughness + occlusion; the most-seen materials at
  2K, the rest at 1K) and each vertex carries its material's index, so a 400,000 triangle house with fifty materials is
  one draw call, lit by the game's own sun, sky, fog, ink hatching and cascaded shadows. The far level has no textures
  at all: the material's colour and the baked occlusion sit on the vertices.
- **Baked occlusion and collision per model** (`tools/d3/kit_geo.mjs`). Ambient occlusion is ray-cast at every vertex
  once, offline. A one-byte-a-voxel distance field per model serves the ship's collisions, the camera and stray shots,
  and still works while the house is moving.
- **Rotors that turn.** The converter finds everything wearing a propeller material, groups blades into rotors (hub,
  axis, reach) and the vertex shader spins them: faster when a house is being hauled down, stopped when her engines
  fail, idling once she rides on a line.
- **Night.** Rice paper glows, lamplight leaks through woven walls, patched iron walls show a few lit windows, glass
  panes light room by room, and every lamp material and lantern post is a point of light.
- **The Loom** (`src/loom.js`): three new islands (a great table, a pillar, a long table) in the islands' own banded
  stone, houses seated on the turf by the height field and scattered by a packing pass, lantern posts, banners, gates,
  and lantern lines from table to table.
- **Halyard** (`src/halyard.js`): twenty-one houses on stations round the Roundhouse, each bobbing on its own engines,
  tied to its neighbour by line, with skiffs running errands. The whole town has an anchor and a heading and follows
  the ship along a route.
- **Ropes** (`src/ropes.js`): catenaries between moving ends that never draw thinner than a pen line and carry paper
  lanterns. The long splice is five of them, carried across by the ship.
- **The fair**: at the ending both towns let paper lanterns go at once.

## Testing

All of these load `dist/web` (build with `--web --dev` first) in headless Chrome on the machine's own GPU. Playwright is
borrowed from the supercollider checkout (`PLAYWRIGHT=/path/to/node_modules/playwright` to point elsewhere).

- `node tools/d3/play.cjs <chapter 0..3 | -1> [max game seconds] [godmode 0|1]` flies a chapter with the robot pilot and
  no picture, far faster than life, and prints what was said, each objective, and whether it completed.
- `node tools/d3/shoot.cjs tools/d3/views/<file>.json 1600 900 out/` renders named views and prints the median frame
  time, draw calls and triangles for each (`Q=2` for the Auto quality level). `tools/d3/sheet2.mjs` tiles pictures.
- `node tools/d3/live.cjs [seconds] [chapter]` runs the real page with its own frame loop at retina size and reports
  the frame rate and any console errors.

## Assets and licences

Halyard is the City in the Sky kit and the Loom is the Gaea kit (both KitBash3D). The airship is the Stylized Fantasy
Ship, the Tenders the Tall City kit's flying boat, and the Tall City itself still stands on the eastern horizon with its
windows lit; those derived files are under `src/assets/d2/` as in Driftlands II. None of the kits may be redistributed:
the derived files may ship inside the game build and nowhere else.
