# 00 — Process log

## 2026-10-12 · Analysis and storyboard

- Got the track `03_Trommelsand_final_320MP3.mp3` (320 kbps MP3, 5:21.4). It is kept
  out of git (`audio/` is ignored).
- First pass with a standard beat tracker gave 107.7 BPM, which looked wrong: in the second
  half the beats slid against the onsets. A tempogram per window showed **two
  tempi, 105 and 87.5 BPM (6:5)**, with the switch at 2:50.5 after a two-bar break.
  Rewrote `tools/analyze.py` to build a tempo map first and drive the beat
  tracker with it. The tracked beats now hold within ±15 ms.
- Found the structure: part A is built in clean 16-bar blocks with a 4-bar riff;
  part B uses a 2-bar riff with stop-and-go sections, stabs, a bass drop-out and a
  hard ending at 5:14.6. → [01-analysis](01-analysis.md)
- Concept: *the desert is a drum*. It comes from the sand that carries footsteps in
  *Dune* and from real booming dunes. The mapping from instruments to visuals and a
  20-shot storyboard locked to bars → [02-storyboard](02-storyboard.md)
- Picked the technique: a fully procedural Python renderer (voxel-space dune
  terrain, particles, Chladni plates, silhouettes, post), so no film assets are used.

**Next:** feedback on the storyboard, then build the renderer shot by shot with low-res previews.

## 2026-10-12 · Storyboard feedback, choosing the technology

Feedback: the story works as it is. Band name **FUZZAN**, full **16:9** with no letterbox,
and the MP3 stays out of the repo.

Question raised: Python, p5.js + p5.brush, or three.js?

Benchmark in this container (4 CPU cores, **no GPU**, so headless Chromium falls back to SwiftShader software WebGL):
a three.js test scene at 1920×1080 with a 512×512 displaced dune mesh, a shadow-casting sun,
fog, and 60k sand particles.

| | ms / frame |
|---|---|
| render (forced GPU sync) | ~710 |
| render + JPEG capture | ~880 |
| render + PNG capture | ~1550 |

So the final 8,036 frames are possible here in hours, as resumable chunks. On any machine
with a real GPU the same scene runs in real time.

Options compared:

| | Python / numpy | p5.js + p5.brush | three.js (+ GLSL) |
|---|---|---|---|
| Look | Retro voxel terrain; lighting, fog and shadows all hand-written | Painterly, hand-drawn, like a graphic novel; strong 2D, weak for flights through 3D | Real 3D: lit dunes, shadows, fog, displacement, particles, post-processing (bloom, haze) |
| Fits the storyboard (flights, worm, storm, camera moves) | partly | poorly (mostly 2D) | well |
| Iteration | render, then look | live in the browser | **live in the browser with the song, scrubbable** |
| Offline render here | 0.2–1 s/frame (estimate) | slow (p5.brush draws thousands of strokes per frame) | ~1–3 s/frame for the final scene (estimate from the benchmark) |
| Determinism | easy | per-frame brush randomness "boils" unless seeded per stroke | easy (time comes from the frame number, not the clock) |

## 2026-10-12 · three.js renderer, first pass

Decisions: **three.js**. The MP3 now lives in the repo (`audio/trommelsand.mp3`). Preview and final
render happen on the PC at home (GPU). The cloud container is CPU-only.

Analysis additions:
- `hits.kick / snare / hat`: band-limited onsets from the percussive part. Kicks are gated by
  sub-bass energy, because the low guitar notes in the intro produced 32 false kicks before gating.
- The silent downbeat in the break (bar 74) is now interpolated, so bar numbers stay musical.
  The bar numbers in the docs after the break were off by one in places; corrected.

Renderer (`video/`), built end to end:
- Vite app with a preview player (song, scrub timeline, shot and bar HUD) and a `?render` mode
  driven by Playwright. `render.mjs` writes chunked, resumable mp4s and muxes them with the song.
  `still.mjs` renders PNGs (used to check the look; see the contact sheet in 04-handoff).
- World: an analytic dune heightfield shared by JS and GLSL. Camera-following, lattice-snapped
  terrain grids with per-pixel normals, ripples, a sun self-shadow ray-march and glints. Kick-driven
  ring shockwaves (16 at once), worm mounds, stateless particles (dust, spice, storm), sky with two
  moons, a Chladni plate scene, and primitive walker, stake and worm.
- Post: bloom, ACES, then a grade in display space with heat shimmer, title dissolve, flash/fade,
  vignette and grain. Title "FUZZAN / TROMMELSAND" in Michroma (OFL).
- All 20 shots are blocked in (`src/timeline.js`) with cuts on downbeats, steps on kicks, the stake
  throbbing on beats, a mound that moves only while the bass plays, freeze frames on hard stops, and
  a blackout + giant ring at 4:43.

Pitfall: look colours were first fed to the shaders as raw sRGB, which washed everything out.
They are now converted to linear (lift/gain stay in display space).

Verified in the container (SwiftShader): every shot renders without errors (stills), and a 6 s clip
(0:16–0:22, 640×360) rendered in 3 chunks and muxed with exactly 6.00 s of audio. CPU speed is about
0.5 fps at 640×360, so the real renders belong on a GPU.

**Next:** see [04-handoff](04-handoff.md). Set up on the home PC, check GPU speed, then refine the shots
in order, starting with 03 (the shockwave) and 04 (the walker).

## 2026-10-12 · Web preview for the phone

- The preview player now works on phones: touch transport buttons, a resolution menu, lighter
  defaults on touch devices (360p, half geometry), fullscreen, and no redraw while paused.
- The song is fetched completely into memory before playback, so seeking works on hosts without
  HTTP range requests. A local test without range support showed that seeks were otherwise lost.
- `npm run build:web` creates a static build with relative paths (`video/dist/`). It is published as a
  private claude.ai page: https://claude.ai/artifact/ASeqDKiXovyyoWkscGa99o
- The title font falls back to the Google Fonts copy of Michroma if the bundled file is blocked.

## 2026-10-12 · v2: "beautify everything, match the music"

Feedback on the first pass: it looks cheap, and some sections are boring or don't follow the
beat and section changes.

**Music, bar by bar.** Added per-bar features to the analysis (energy, brightness, kick/snare/hat
counts, fills). They show the 2-bar riff accent, the 8-bar fills, the cymbal drop in bars 34–39 with
the return on bar 40, the bar-by-bar bass in 78–82, and the held chord in 125
(→ [01-analysis](01-analysis.md#bar-level-structure-used-for-cutting)).

**Why it looked flat:** the main dunes were 2.5 km apart, which makes slopes of ~3 %. They are now
~600 m apart and 55 m high, with a 31° slip face, a secondary ridge set, meandering crests and flat
basins in between.

**Look:** rebuilt the sand lighting (sun + sky + warm bounce, backlit sheen, curvature AO, pale crests,
cracked hardpan), atmosphere (per-channel extinction, sun scattering, billowing storm dust, a storm wall),
sky (limb-darkened sun, dawn cloud streaks, Milky Way, haloed moons), a pass for light rays and
an anamorphic sun flare, and a split-tone grade with heat shimmer, storm streaks and chromatic aberration.

**Figures:** a folded robe with cape, pointed hood, pack, staff and fluttering scarf, with rim light when backlit;
a tripod thumper whose hammer slams per beat; a worm with overlapping armour rings, sand-dusted top,
three tapered petals and three rows of teeth, pouring sand.

**Particles:** soft forward-scattering grains, spindrift streaming off real crests (gusting on snares),
lens motes, spice, and sand pouring along any curve (worm, crest line, mound).

**Timeline:** 20 shots became 55 cuts, every one pinned to a bar
(→ [cut list](02-storyboard.md#cut-list-as-built)). Kicks always do something visible (ring, hop, lens
punch); section edges each get a moment; the calm starts on the exact bass drop-out at 4:17.6.

**Motion blur** for renders: 6 sub-frames over a 180° shutter, never across a cut.

Bugs found by looking:
- Zero normals on lathe axes became NaN, which bloomed into a black frame. Fixed with normal
  sanitising, plus a NaN clamp before bloom.
- A camera ended up under a basin that isn't quite flat. The director now guards camera height
  against dunes, rings and mounds.
- At the breach, rings from every recent kick stacked into a wall of sand. Rings are now gated by hit time.
- Ripples, glints and grain albedo aliased into speckle at grazing angles. They are faded out with `fwidth`.
- The motion-blur accumulator was wiped by `autoClear`, leaving 1/6 brightness.
- The banding seen on early contact sheets came from the sheet tool (PNG → YUV), not the render.

Not done here: watching it in real time with the song, and checking GPU speed. Both happen at home.

## 2026-10-12 · v3: real figure, a story for part A, no more patterns

Feedback on v2: the cloth flutter moved the whole walker, not just the robe. The walker and worm
still looked cheap ("can we use free existing models?"). Part A had little story. The geometric
plate patterns felt out of place. When the camera followed the walker, it copied every step.

**Walker → a rigged, animated model.** The free model that fits, can be fetched from inside the
container and is licensed for this kind of use is the *Soldier* from the three.js examples: a Mixamo
character with a skeleton and idle/walk/run clips. Mixamo characters and animations are free to use in
projects, including commercial ones, but the files may not be redistributed on their own. The repo
therefore doesn't contain the file: `npm run models` downloads it into `video/public/models/`
(git-ignored), and without it the director falls back to the old procedural walker.
- The armour is hidden above the knees (per-vertex `discard`). Robe, cape, hood, sleeves, scarf and
  sash are generated in the model's bind space and **skinned to the same skeleton**, so the cloth
  moves with the legs, hips and arms.
- Only the robe hem, the cape edge and the scarf flutter (per-vertex `aFlutter`); the rest of the body
  holds still. Woven cloth texture with stripes and a frayed hem. A dark void under the hood instead of a face.
- The walk clip is sampled at an absolute time from the step count, so frames stay a pure function of
  music time. The staff is placed in the right hand each frame. The thumper pack rides on his back
  until he drives it into the ground.
- The fallback walker had the same bug (the hood and sleeve used the hem-flutter material, and
  their mesh origin is near the top, so the whole shape shook); fixed too.

**Worm.** No free sandworm model fits without copying a film design, so it stays procedural but gained
a lot of detail: a generated skin (plate lips, seam grooves, irregular wrinkles, pits, cracks, sand in
the seams) as colour and bump maps, 260×48 segments, five rows of teeth down a dark-red throat with
flesh rings, textured petals.

**Story for part A.** The figure is now set up in the intro and the whole of part A is his walk toward
something:
- 02c/02d: he waits on a crest against the dawn with the thumper on his back while the title forms.
- 03 (bar 8): his **first step** on the band entry sends the giant ring across the desert.
- 04: the walk along the crest. 05b–05c: along a ridge, then down a slip face.
- 05d (bar 29): from above, a **giant worm skeleton** lies half-buried in the dunes ahead.
- 06 (A3, the darker block): he walks *through* it, under the ribs, sand pouring through the
  vertebrae on the beat, beneath the ring of teeth; bar 40 (cymbals back) tears the sand off the
  bones and reveals the whole skeleton; then out through the jaws.

This also prepares part B: the thing he's calling with the thumper is the living version of that skeleton.

**Patterns removed.** The Chladni plate (`chladni.js`) is gone. A3 is the skeleton set piece, and the
final hits (cut 19) are in-world: from above, each hit throws a giant ring out of the worm's dive site.

**Camera vs. steps.** The walker's progress was a step function (one jump per kick), and cameras aimed
straight at him. Now his progress is an integer per kick, linear in between and smoothed over 0.7 s,
so the body moves continuously while each kick still lands as a footfall. Cameras aim at a
separate lagging anchor (`follow()`), averaged over the last 1.6 s, which glides instead of stepping.
Checked on frame strips (24.0 s, 122.0 s).

Second round, after looking at stills of every cut:
- **The walker floated on sharp crests.** The terrain mesh has 2.5 m cells, so it cuts the top off
  a knife-edge crest by up to half a metre, while the figure stood on the exact `duneHeight`. Figures now
  stand on `Terrain.drawnHeight()`, the height of the triangle the GPU actually draws there.
- **Figures were too dark in shade.** The hemisphere fill was weak next to the terrain's own lighting,
  so every unlit side went black. The fill is now 2× stronger, with more bounce from the sand. Robes are
  sun-bleached instead of dark brown, and backlit cloth glows in its own colour instead of white.
- **The carried thumper read as a box above his head.** It is now slung diagonally across his back (hammer at
  the hip, pole tip above the right shoulder), with a sack and bedroll.
- **The skeleton looked like a slinky:** perfectly regular hoops. Now spacing, lean, height, wobble and
  thickness vary per rib, some are snapped or missing, ribs are flat bone (not pipes), loose fragments lie
  in the sand, and sand is drifted against the rib roots (terrain mounds, blown away from bar 40 on).
  The jaw ring is warped, with uneven, broken and missing teeth.
- **The worm still looked like a corrugated pipe.** Plates are now uneven in length, lip height and depth,
  lumpy around the body, armoured on the back and softer on the belly, with dust patches and a tint per plate.
  The mouth has three rows of hooked teeth spiralling down a ridged, fleshy throat, and the petals are skin
  outside, wet flesh lined with hooks inside.
- **The walker vanished in the skeleton's trough (06d, 06f).** Debugging (hide the terrain → he's there;
  GLSL and JS heights identical) showed the coarse far grid. It is drawn everywhere, only 2 m lower, and its
  44 m triangles span a narrow trough several metres above the real floor, so they covered him. The far grid
  now discards fragments wherever the fine grid exists. This could have hidden figures in any deep trough before.
- 06f's exit path started 37 m inside the skeleton, so he never actually walked out of the jaws; it now starts at the
  head end. `sightline()` (rig.js) lifts a low camera just enough to keep a figure in view over humps.
- 08a: the walker and thumper were cut off by the frame edge; reframed over his shoulder toward the mound.
