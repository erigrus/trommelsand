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
