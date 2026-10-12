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
