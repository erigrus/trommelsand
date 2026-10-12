# 03 — Renderer (three.js)

## Why three.js

See the comparison in [00-process](00-process.md#2026-10-12--storyboard-feedback-choosing-the-technology).
In short, it does real 3D (lit dunes, shadows, fog, particles, bloom), gives a live preview in the
browser with the song, and renders deterministically frame by frame for the final video.

## Data flow

```
audio/trommelsand.mp3 ──► tools/analyze.py ──► analysis/analysis.json
                                                     │
                     video/src/core/music.js  ◄──────┘   (curves, bars, hits, events)
                                │
  look.js (colour script) ──►  director.js  ◄── timeline.js (shots = storyboard)
                                │
           world/*  (terrain, sky, particles, figures, chladni)
                                │
           post/*   (bloom → tone map → grade, shimmer, titles, grain)
                                │
        preview: canvas in the browser     render: scripts/render.mjs → ffmpeg → mp4 + audio
```

## One frame: `Director.render(t)`

1. Hard stops: if `t` falls inside `events.stops`, render the stop's first frame instead (freeze frame).
2. Look up the shot whose `[start, end)` contains `t` and sample the colour script (`look.js`).
3. Build a fresh `ctx` with defaults (no rings, no figures, default dust…) and the envelopes
   `kickEnv`, `snareEnv`, `hatEnv`.
4. `shot.frame(ctx)` sets the camera and fills `ctx`: which figures are visible and where, the
   ring source, ring scale, mounds, particle overrides, post overrides (fade, flash, title).
5. The director turns `ctx` into uniforms. Kick rings come from `music.recentHits('kick')`:
   each hit is mapped through `ctx.rings(hit) → [x, z, strength]`, and its age is measured in sim time.
6. Render through the post chain.

`ctx.sim` is music time with the break slowed down (×0.03 from 2:47.3 to 2:50.5). Grains,
rings and wind use it, so they hang in the air while the camera keeps moving.

## World pieces

| File | What | Notes |
|---|---|---|
| `world/terrain-fn.js` | `duneHeight(x,z)` in JS + GLSL; ring, mound and displacement GLSL | Transverse dunes, wind +x, ridges run along z. Asymmetric profile (gentle stoss, steep lee, sharp crest), domain-warped. **Keep the JS and GLSL versions identical.** |
| `world/terrain.js` | Two camera-following grids (near 640², far 320²), custom shader | Grid centres snap to the vertex spacing, so there's no vertex swimming. Per-pixel normals from the analytic height. Wind ripples, self-shadow ray-march toward the sun, glints on hats, height fog |
| `world/sky.js` | Sky dome | Gradient, sun disc + glow, stars, two moons, storm streaks |
| `world/particles.js` | Stateless point particles | Position = f(seed, sim time); camera-following wrap box. Used for dust, spice (additive, rising) and storm |
| `world/figures.js` | Walker, stake, worm | First-pass primitives. The worm is a ringed tube rebuilt per frame from 15 body points |
| `world/chladni.js` | Top-down vibrating plate | Fullscreen shader. Grains collect on nodal lines; mode per bar; `uRing` morphs to a drumhead |
| `post/post.js` | EffectComposer: bloom → OutputPass (ACES + sRGB) → Grade | Grade works in display space: contrast/saturation/lift/gain, heat shimmer, title dissolve, flash/fade, vignette, grain |
| `post/titles.js` | Title texture | Michroma (OFL, via @fontsource), "FUZZAN" over "TROMMELSAND" |

## Ring shockwaves

`uRings[16] = (x, z, age, strength)` and `uRingShape = (speed m/s, width m, amplitude m, decay 1/s)`.
Height adds `amp · exp(-d²/w²) · exp(-age·decay) · cos(π d / w)` with `d = |p − c| − speed·age`.
Particles use the envelope without the cosine to jump at the wave front. Pick the shape per shot
for its scale: macro `[5, .35, .05, 1.5]`, walker `[16, 1.4, .3, 1.1]`, aerial `[110, 10, 2.2, .6]`.

## Rendering

`scripts/render.mjs` starts Vite, opens `/?render&w=&h=` in Chromium through Playwright, and
calls `window.renderFrame(i)` for each frame. It pipes JPEG (q 0.95) or PNG frames into ffmpeg
(x264, CRF 14, yuv420p). Each chunk of 250 frames becomes its own mp4 (`out/chunks/WxH/`), which
makes the render resumable. At the end the chunks are concatenated and muxed with the matching slice of the MP3 (AAC 320k).

Speed: about 0.5 fps at 640×360 on CPU (SwiftShader) in the cloud container. On a GPU the scene
should render many times faster. Check the `renderer:` line the script prints. If it says
SwiftShader on a machine with a GPU, try `--headed`.

Grain plus CRF 14 gives large files. That's fine for a master; use `--crf 18` for smaller drafts.
