# CLAUDE.md — working on the Trommelsand video

Music video for **"Trommelsand" by FUZZAN**, an instrumental stoner-rock track
(5:21, 105 → 87.5 BPM). The concept is "the desert is a drum skin": every hit of
the band shows up in the sand. The look is loosely inspired by *Dune*. The picture is
generated procedurally with three.js and locked to a music analysis.

**Read first:** `docs/04-handoff.md` (current status + to-do), then
`docs/02-storyboard.md` (what each shot should be) and `docs/03-renderer.md` (how the code works).

## Repo map

```
audio/trommelsand.mp3        the song (source of truth for timing)
tools/analyze.py             music analysis -> analysis/analysis.json (+ plots)
analysis/analysis.json       tempo map, bars, beats, hits (kick/snare/hat), events, curves @25fps
docs/                        process log, analysis notes, storyboard, renderer guide, handoff
video/                       three.js app (Vite) + render scripts
  src/timeline.js            THE STORYBOARD AS CODE: one entry per shot
  src/look.js                colour script keyframes
  src/director.js            turns time t into a frame (world, uniforms, post)
  src/world/*                terrain (dune heightfield), sky, particles, figures, chladni
  src/post/*                 grade/bloom/grain/titles
  scripts/still.mjs          render PNG stills (use these to look at your work)
  scripts/render.mjs         chunked, resumable mp4 render, muxed with the song
```

## Commands (run in `video/`)

```bash
npm install && npx playwright install chromium   # once
npm run dev                                      # preview with audio: http://localhost:5173 (?t=200 to start at 200 s)
npm run still -- --shots                         # one PNG per shot -> video/out/stills/
npm run still -- --t 17.4,56.3,200.7             # PNGs at specific times
npm run render -- --from 17 --to 40 --w 960 --h 540   # draft clip with audio
npm run render                                   # final 1920x1080, ~8036 frames
```

Analysis (repo root, Python 3.10+): `pip install -r requirements.txt && python tools/analyze.py audio/trommelsand.mp3`.
Only needed if the analysis code changes. Never hand-edit `analysis.json`.

## Hard rules

1. **Every frame is a pure function of music time.** `shot.frame(ctx)` may read only
   `ctx.t`, `ctx.sim`, `ctx.music`, and data precomputed deterministically in `init()`.
   Never use `Math.random()`, `Date`, `performance.now()`, or state carried from the previous frame.
   Use `hash1()` / `rng(seed)` from `src/core/util.js`. This lets the preview seek anywhere and
   lets `render.mjs` render any chunk on its own.
2. **`duneHeight` exists twice** (`src/world/terrain-fn.js`: JS and GLSL). Change both, identically.
3. **Sync comes from `analysis.json`.** Use bars (`music.barTime(n)`, `B(n)` in timeline.js),
   hits (`music.recentHits('kick', t, window)`, `music.envelope(...)`), events (`stops`,
   `bass_out`) and curves (`music.curve('rms', t)`). Don't hard-code times that the analysis provides.
   Bar numbers match `docs/01-analysis.md`.
4. Use `ctx.sim` for anything that should freeze in the break (2:47–2:50.5): grains, rings, wind.
   Use `ctx.t` for camera moves. Hard stops in `events.stops` are freeze frames (director.js).
5. **Look at your work.** After a visual change, render stills (`npm run still -- --t ...`) and
   view the PNGs before you claim it works. With no GPU, add `--swiftshader` (slow but correct).
6. No film footage, logos, character names or likenesses. Generic desert, worm and moons only.
   Title card: "FUZZAN" / "TROMMELSAND".
7. Keep the docs current: add a dated entry to `docs/00-process.md` per session, update the status
   table in `docs/04-handoff.md`, and update `docs/02-storyboard.md` if a shot changes.
8. Delete `video/out/chunks/` before re-rendering after a visual change. Existing chunks are reused.

## Conventions

- Plain ES modules, no TypeScript, no framework. 2-space indent. Match the surrounding comment style.
- Shaders live as template strings next to the class that uses them. Shared uniforms are in `src/world/shared.js` (`U`).
- Colours in `look.js` are sRGB hex. The director converts them to linear (except lift/gain).
- Commit messages: imperative summary line, then the why. Output (`video/out/`) is git-ignored.
