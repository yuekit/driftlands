# Driftlands III: The Long Splice — design and pipeline notes

Written 2026-11-16 by the thread that built it. The game is in `driftlands3/` (a fork of `driftlands2/`, which was a
fork of `source/`). Its README covers controls, building and testing; this file is the why and the gotchas.

## Design

- **Premise.** Three weeks after Driftlands II's Bell. The Tall City's lit windows draw in Halyard, a rust town held
  up by propellers that has never landed (City in the Sky kit), toward the Loom, the Weavers' woven village on three new
  mesa islands west of Rootfall (Gaea kit), where Wren Halloway has lived these ten years. II cut cables, III ties them:
  the ending is five lantern lines carried from the tables to the houses ("a long splice": two ropes married strand for
  strand). Lore hook: two peoples left the Tall City, one by the roots and one by the air.
- **Cast.** Idris Vane (aboard, as in II), Wren Halloway (now "the Loom", no longer "by post"), and Ysolde Kerr, Pilot
  of Halyard. The Tenders return as gardeners nobody told to stop: they prune a rootless town as deadwood.
- **Verbs.** The Long Gallery, lances, boost and brake are unchanged from II. The Bell became the ship's bell and does
  three jobs: hail a great house (chapter I), wake a house whose engines have failed (III, IV), and the old shockwave.
  New: leading a convoy (the town follows while the ship stays ahead of it), and carrying a line (fly close to a gate
  on a table's rim to take it up, fly to the named house to make it fast).
- **Chapters.** I The Loom (hail five houses) · II Halyard (break three hooks, waves of Tenders) · III The Way In
  (storm, convoy, two engine failures, the Shearsman boss) · IV The Long Splice (five lines while unmoored houses start
  to sink, berth at the Hall, ring her in; lanterns, three ending shots). Checkpoints in `g.cp` (hooks, stage, boss
  health, lines) survive a death, as in II.
- **Look.** The engine's ink-plate style (banded light, pen hatching) does the Moebius work. The kits' photographed
  textures are pulled 22% toward each material's flat local colour (`uKitFlat`). The new islands use a pale sandstone
  palette banded rose with jade turf. Scales: Gaea x1.35, City in the Sky x1.6 (the makers were "half again our
  height"), skiffs x2.4.

## World layout (metres)

- Loom table at (-1620, 236, -880) r 232 with an upper terrace; Spindle (-1150, 246, -1330), a pillar 100 m tall;
  Shuttle (-1250, 200, -440), a long table. Rootfall Hollow (-660, 215, -640) carries Wren's house.
- Halyard's route (`Game.setupSites`, `this.route`): from 3,900 m west and 1,900 m north of its mooring, to the mooring
  790 m west of the Loom. Far islands and skerries are kept out of that corridor.
- The Tall City is still at (4105, 250, 565), loaded at low texture size, lit, on the horizon.

## Pipeline (tools/d3)

Input is the kit as converted by `3d-library/_pipeline/kb3d` on the Mac (one GLB a model, meshopt, named materials;
`materials.glb` with 2K WebP maps).

1. `kit_tex.mjs`: per material, `_c` (colour, alpha = metalness 1..255 or cut-out opacity) and `_n` (normal xy,
   roughness, alpha = occlusion) at source size into `tools/d3/.cache/<kit>/`, plus `mats.json` (average colour, kind).
2. `kit_geo.mjs`: per model, merge all primitives into one; L0 capped (300k Gaea, 400k City in the Sky, 800k for the
   airport with sloppy simplification); L1 at 14%; L2 sloppy at about 1%, vertex colours only. Vertex AO by ray casting
   (three-mesh-bvh, 20 rays, about a minute a big model). Distance field by sampling triangles into a grid then an
   exact distance transform. Rotors by propeller material. UVs quantised to 16 bits with the range in the JSON.
   The whole batch is `tools/d3/jobs.txt` through `xargs -P 12`, about six minutes.
3. `gen_index.mjs`: ranks materials by surface area over the models used; the top 8 (Gaea) and 10 (City in the Sky)
   keep 2K, the rest go to 1K; colour maps whose metalness barely varies lose their alpha plane. Writes
   `src/assets/d3/` (ignored by git, about 340 MB) and `src/d3assets.js`.

## Gotchas met

- three's `geometry.applyMatrix4` on quantised (normalised int16) positions clamps to +-1: the models collapsed to a
  two metre cube and only showed as shadows. Positions are rewritten as floats at load (`kits.js`).
- The island height field marched down from y = 26, so anything taller (terrace, pillar) reported 26 and houses were
  buried. New islands set `hTop` in their spec.
- Blades of one propeller do not touch (the hub is another material): shells are grouped into blades, then blades of one
  size standing close together into a rotor; with three or more blades the axis is the normal of the plane of their
  middles, not the direction the blades are thin in (fabric vanes stand on edge).
- `meshopt simplifySloppy` asserts if the target is above the current count (small props).
- Texture arrays are filled with `texSubImage3D` straight from ImageBitmaps and handed to three as a
  `DataArrayTexture` whose `__webglTexture` is preset (version left at 0 so three never uploads it). Sampling picks the
  array per fragment, so it uses `textureGrad` with derivatives taken outside the branch.
- A rope's vertex shader needs `uTime` declared itself (it does not include COMMON).
- Adding islands: tables indexed by island (`FLORA_SPEC`, `KIT_TREES`, `STEM`) take `spec.like`; listening posts skip
  `spec.noPost`; the Tall City's cables only go to the first eight islands.
- The convoy must bring itself in over the last 700 m, or a pilot circling the mooring stalls it at 98%.
- Download size: float UVs and uncapped L0 gave 580 MB; 16-bit UVs, lower caps, fewer 2K materials and dropping
  constant alpha planes brought it to 340 MB.

## Numbers (M4 Pro, headless Chrome on Metal)

- 77 models (44 Gaea, 33 City in the Sky), 112 materials. Loads to the title in about 5 s from localhost.
- 7 to 17 ms a frame at 1728 x 1117 on High in the harness; 54 fps with the real frame loop at retina size on Auto.
- 700 to 900 draw calls, 8 to 15 M triangles a frame including shadow passes.
- The robot pilot finishes the chapters in about 75, 85, 200 and 280 game seconds.

## Kit-bash pass (second half of 2026-11-16)

Yue-Kit's full brief arrived after the first build: do not apply the kits as they come; cut, repurpose, combine and
merge them into a world of its own, and use the other library packs too. What changed:

- **Recipes** (`tools/d3/recipes`, `kit_geo.mjs --recipe=`): parts from either kit or any library GLB, each with scale,
  rotation, position, `centre` / `ground` / `hang` / `middle` (so a recipe needs no knowledge of a model's origin), a
  `clip` box, a material `remap` (names or /regex/ to `gae:X`, `csk:X`, `stone`, `drop`), `socket` (records the part's
  highest point) and `on` (place relative to an earlier socket), plus a `disc` primitive that caps a rock turned over.
  The merged model goes through the same detail levels, occlusion bake (so parts shade each other), distance field and
  rotor detection as a plain kit model.
- **One material numbering** for both kits (Gaea 0..27, City in the Sky 28..112; kit models are offset at load,
  recipe models are written already shared). Material 255 is the game's own banded stone: Tianzi pillars and limestone
  crags are used for their shape only.
- **Per-house colour**: `KitObject.setTint({ wall, roof, cloth, k })` recolours wall, thatch and cloth kinds.
- **New things in the world**: the Great Loom on the Loom's terrace with six warp lines (the splice lines for the Loom
  leave its arm tips: `SPLICE` table `'great'`), nine warp stones with lantern lines to the nearest table, six kite
  houses on loops, crags along the route, and after the splice two stone kites and two spliced houses (`Strays`).
- Gotchas: `THREE.Color(hex)` is already linear (do not convert again); a rock must be `ground`-ed before turning it
  over or it ends point-up; Halyard's forward stations reach 700 m ahead of its hub, so the mooring is 1,080 m west of
  the Loom; hybrids are placed on the flanks of the lines, clear of the houses.
- Numbers now: 90 models, 375 MB of derived assets, 416 MB hosted build. Chapter IV is the heaviest view: about
  18 ms a frame at 2592 x 1676 in the harness, 46 fps with the real loop at retina size.

## Not done yet

- Menus were not re-tested with a gamepad (II's `menus.cjs` was not ported).
- The big eight-vane fabric rotor under the Manor is not detected as a rotor and stands still.
- No new music or voices; sound is II's engine with the bell reused for hails.
- Windows on Halyard are procedural on wall materials only; the Roundhouse is mostly dark forged iron and shows few.
