# Driftlands II: The Tall City

A year after the Chord, something tall has risen out of the cloud sea and begun reeling the islands in by cable.
You fly the Meridian Institute's airship, the Long Gallery, to find out what it wants.

Driftlands II runs on the Driftlands engine (three.js, WebGL2, hand-written shaders) and lives in the same world:
the islands, creatures, weather, clouds and day cycle are carried over from the first game. What is new is everything
you do in it. The first game was a quiet survey flight; this one is an airship action game in four chapters.

| Chapter | Where | What happens |
| --- | --- | --- |
| I. Moorings | Verdigris Reach, dawn | Break the three grapples the city has sunk into the island |
| II. The Reach | Open cloud, a storm | Follow the cables through lightning and waves of Tenders |
| III. The Tall City | Among the towers, dusk | Break four winch hearts, then bring down the Harbourmaster |
| IV. The Square | The lamp square, nightfall | Land the ship, ring the Bell, and watch the city wake |

After the ending the world opens for free flight.

## Controls

| | Mouse and keys | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | Move the ring, or WASD / arrows | Left stick | Drag on the left |
| Chord lances | Hold click or Space | Right trigger | Fire |
| The Bell (shockwave) | Right click or E | X | Bell |
| Speed | Shift | A | Boost |
| Slow down (and land) | Ctrl or C | B | Slow |
| Pause, settings, chapters | Esc or P | Start | Pause button |

## Building

```
npm install
node build.mjs               # dist/test.html (three.js from a CDN, assets inlined)
node build.mjs --standalone  # dist/Driftlands2.html, one self-contained file
node build.mjs --web         # dist/web/, a folder for hosting (index.html, driftlands2.js, assets/)
```

Add `--dev` to skip minifying. `?q=low` or `?q=high` on the address forces a quality level; `?debug` shows timings.

## What is new in the engine

- **Instanced kit city.** The Tall City is 57 parts placed 1,975 times, drawn as one instanced mesh per part with full
  PBR texture sets, weathered procedurally (soot streaks, dust on ledges) and lit by the game's own sun, sky and fog.
- **Baked light volume.** A 179 x 226 x 135 voxel volume holds sky visibility from above and below, sun visibility and
  the distance to the nearest wall. The shaders use it for ambient occlusion and far shadows between towers; the game
  uses the same distance field for collisions, camera clearance, line of sight and stray shots.
- **Procedural windows** that light floor by floor, turn red while the city is hostile, and wake in a wave at the end.
- **Effects layer** drawn after anti-aliasing with its own depth test: lance bolts, explosions, sparks, smoke, glows.
- **Lightning** that lights the clouds, the rain and every surface; **shockwave** screen distortion for the Bell;
  depth-and-velocity **motion blur**; eight **dynamic point lights** shared by every lit material.
- **The Long Gallery.** The pack's flat swatch texture is turned into timber, iron, brass, rope and canvas in the
  shader, with a weave you can see up close and light glowing through the sails and envelope.
- **Machines drawn in code.** The grapples, winch hearts (three gimbal rings round a plasma core), turrets and the
  Harbourmaster's slung core are built from primitives and shaded as plated, riveted, rusting iron. The cables are
  stranded steel with light pulsing along them while they haul.
- **The Bell** is a white enamel spire whose dark glass fills with light from the foot upward when it is rung, and
  **the skerries** are bare rocks strung across the Reach, wearing the same moss, rain and fog as the islands.

## Assets and licences

The airship and the city are built from two purchased model kits, the Stylized Fantasy Ship and the Tall City
(the Tenders are the city kit's flying boat). The Bell is one tower from the Utopian Sci Fi kit and the skerries are
the islet from the Floating Island kit. The kits themselves are **not** in this repository. Only the derived,
web-optimised files the game ships (meshopt GLB, WebP textures, the baked light volume) are committed, under
`src/assets/d2/`. Those files are still covered by the kits' licences: they may ship inside the game, but they are not
free to reuse. Keep that in mind before making the repository public.

The conversion scripts are in `tools/assets/convert/` (Blender Python) and `tools/assets/` (packing):

| Script | Does |
| --- | --- |
| `ship_build.py` | Fantasy Ship FBX to a jointed GLB with baked ambient occlusion and part classes |
| `tall_build.py`, `tall_lib.py` | Tall City level to unique parts plus an instance table |
| `tall_tex.py` | City texture sets to WebP (albedo + metalness, normal + roughness, emission) |
| `tall_volume.py` | Voxelises the city and bakes the light and distance volume |
| `tall_sites.py` | Finds open sites for the winch hearts, turret seats and open-air spawn points |
| `tall_boat.py` | The city's flying boat, for the Tenders |
| `pack.mjs`, `pack_simplify.mjs`, `gen_index.mjs` | Meshopt packing and the texture index |
| `pick.mjs`, `islet.mjs` | The Bell's spire and the skerry islet, cut out of their kits and packed |
| `inspect.mjs`, `inspect_mats.mjs`, `profile.mjs` | Look inside a GLB: meshes, materials, and its outline for a collision shape |

Islands, plants, creatures, rocks and the survey posts come from Driftlands (see the repository's main README).

## Testing

`node tools/play.cjs <chapter 0..3> [max game seconds] [godmode 0|1]` flies a chapter with a robot pilot and no
picture, about ten times faster than life. It prints everything that was said, every objective, kill and death, and
whether the chapter was completed, so a change to the scripts or the balance can be checked in seconds. Set `AUDIO=1`
to run the sound engine as well. The pilot itself is in `tools/bot.cjs`.

`node tools/shoot.cjs views.json 1280 720 out/` renders named views in headless Chromium (software WebGL, so it is
slow). A view can set the time of day, place the ship, place a debug camera, start a chapter, hand the helm to the
robot pilot and run game code first. `window.__dl` is the game: `__dl.startChapter(2)`, `__dl.sim(5)` and so on.

Both need `node build.mjs --dev` first; they load `dist/test.html`.
