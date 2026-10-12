# 03 — Renderer (three.js)

## Why three.js

See the comparison in [00-process](00-process.md#2026-10-12--storyboard-feedback-choosing-the-technology).
In short, it does real 3D (lit dunes, shadows, fog, particles, bloom), gives a live preview in the
browser with the song, and renders deterministically frame by frame for the final video.

## Data flow

```
audio/trommelsand.mp3 ──► tools/analyze.py ──► analysis/analysis.json
                                                     │   tempo map, bars (+ per-bar energy, hit counts, fills),
                     video/src/core/music.js  ◄──────┘   hits (kick/snare/hat), events, curves @25 fps
                                │
  look.js (colour script) ──►  director.js  ◄── timeline.js (55 cuts) ◄── rig.js (camera + staging helpers)
                                │
           world/*  (terrain, sky, particles, figures, chladni)
                                │
           post/*   (god rays + flare → bloom → tone map → grade, shimmer, storm streaks, titles, grain)
                                │
        preview: canvas in the browser     render: scripts/render.mjs → (motion blur) → ffmpeg → mp4 + audio
```

## One frame: `Director.render(t)`

1. Hard stops: if `t` falls inside `events.stops`, render the stop's first frame instead (freeze frame).
2. Look up the cut whose `[start, end)` contains `t` and sample the colour script (`look.js`).
3. Build a fresh `ctx` with defaults and the envelopes `kickEnv`, `snareEnv`, `hatEnv`.
4. `cut.frame(ctx)` sets the camera and fills `ctx`. The fields are documented at the top of
   `Director.render`: figures, rings, mounds, footprints, particle overrides, sand pours, storm wall,
   ring glow, rays, post (fade, flash, title), shake, punch, focus and exposure.
5. The director turns `ctx` into uniforms:
   - Kick rings come from `music.recentHits('kick')` through `ctx.rings(hit) → [x, z, strength]`,
     with their age measured in sim time.
   - The lens punches in on kicks, and a smooth rumble (rotation, not jitter) follows `ctx.shake`.
   - **Camera guard:** the camera is lifted above the ground as the GPU will draw it (dunes + rings +
     mounds), so no cut can put the lens underground.
6. Render through the post chain.

`Director.renderFrame(t, { samples })` is the motion-blur path used by `render.mjs`. It averages `samples` sub-frames
over a 180° shutter, and sub-frames never cross a cut.

`ctx.sim` is music time with the break slowed down (×0.03 from 2:47.3 to 2:50.5) and the worm's
dive slowed (×0.45, 5:02–5:10). Grains, rings and wind use it; camera moves use `ctx.t`.

## World pieces

| File | What | Notes |
|---|---|---|
| `world/terrain-fn.js` | `duneHeight(x,z)`, `duneEnv(x,z)` in JS + GLSL; ring/mound GLSL | Main transverse ridges ~600 m apart and 55 m high, with a 15 % slip face (~31°, the angle of repose). A 260 m secondary set, a 2.4 km swell, meandering crests. `duneEnv` (0 = flat basin, 1 = dune sea) comes from integer-hash value noise that gives identical bits in JS (`Math.imul`) and GLSL (`uint`). **Keep both versions identical.** |
| `world/terrain.js` | Two camera-following grids (near 640², far 320²), custom shader | Lattice-snapped (no swimming). Per-pixel normals, ripples in two octaves (anti-aliased with `fwidth`), footprints, sun self-shadow ray-march, curvature AO, pale crests, cracked hardpan in basins. Lighting is sun + sky + warm bounce + backlit sheen. Glints, moonlight, glowing ring fronts at night |
| `world/shared.js` | Shared uniforms `U` + GLSL helpers | Sky gradient with sun scattering. Height fog with per-channel extinction. Billowing storm dust. **Storm wall** (`uStormWall`: plane + billowing top) |
| `world/sky.js` | Sky dome (writes alpha 0 for the ray pass) | Limb-darkened sun, high cloud streaks, stars, Milky Way, two haloed moons, storm |
| `world/particles.js` | Stateless point particles, 5 modes | `0` dust (hops at ring fronts), `1` spindrift off crests (crests found by curvature; snare = gusts), `2` lens motes (bokeh), `3` rising spice, `4` sand pouring off a 16-point curve (worm body, crest line, mound). All forward-scatter when backlit. Sub-pixel grains fade out instead of flickering |
| `world/figures.js` | Walker, thumper, worm | Shared rim light (`RIM`) and wind (`WIND`) uniforms. Cloth flutters in the vertex shader. Walker: folded robe, cape, pointed hood, pack, staff, scarf. Thumper: tripod pole with a banded hammer that slams per beat. Worm: overlapping armour rings, sand-dusted vertex colours, 3 tapered petals, 3 rows of teeth. **Lathe axes need `sanitizeNormals`**, because zero normals turned into NaN and blacked out frames |
| `world/chladni.js` | Top-down vibrating plate | Relief-lit sand piles on brushed bronze. Mode per bar or per kick; grains migrate between figures; `uRing` morphs to a drumhead |
| `post/post.js` | Rays → bloom → OutputPass (ACES) → Grade, + motion-blur accumulation | Rays: radial blur of open sky around the sun, anamorphic streak and ghosts when the sun is visible. NaN/Inf clamp before bloom. Grade: contrast, saturation, split toning, lift/gain, chromatic aberration, heat shimmer, storm streaks, title dissolve, flash/fade, vignette, grain |
| `rig.js` | Staging helpers | `aim`, `clear`, `crestX`, `ridgePath` (follows a crest), `findBasin`, `flight` (terrain-following flight with phrase-timed turns), `ahead`, `wormBody` |

## Ring shockwaves

`uRings[16] = (x, z, age, strength)` and `uRingShape = (speed m/s, width m, amplitude m, decay 1/s)`.
Height adds `amp · exp(-d²/w²) · exp(-age·decay) · cos(π d / w)` with `d = |p − c| − speed·age`.
Particles use the envelope without the cosine to jump at the wave front; at night the envelope also
emits light (`uRingGlow`). Pick the shape per shot for its scale: macro `[5, .35, .05, 1.5]`,
walker `[16, 1.3, .3, 1]`, aerial `[110–260, 10–24, 2–3.6, .3–.6]`.
Gate rings by hit time when a cut starts after a burst of kicks, or the stacked waves become a wall
(this happened at the breach).

## Rendering

`scripts/render.mjs` starts Vite, opens `/?render&w=&h=&mb=` in Chromium through Playwright, and
calls `window.renderFrame(i)` for each frame. It pipes JPEG (q 0.95) or PNG frames into ffmpeg
(x264, CRF 14, yuv420p). Each chunk of 250 frames is its own mp4 (`out/chunks/WxH_mbN/`), which
makes the render resumable, and at the end the chunks are concatenated with the matching slice of the MP3 (AAC 320k).

Motion blur is on by default for renders (`--mb 6`, six sub-frames over a 180° shutter), which costs 6× the
render time. `--mb 1` turns it off for drafts. Stills default to `--mb 1`.

Speed: about 4 s per 640×360 frame on the CPU (SwiftShader) in the cloud container, so ~25 s with
motion blur. A GPU is needed for the full render. Check the `renderer:` line the script prints.

Grain plus CRF 14 gives large files. That's fine for a master; use `--crf 18` for smaller drafts.
