# Trommelsand

Music video for **Trommelsand** by **FUZZAN**, an instrumental stoner-rock track (5:21).
The concept: the desert is a drum skin, and every hit of the band shows up in the sand.
The look is loosely inspired by *Dune*. Everything is generated procedurally with three.js and
locked to an analysis of the song.

![v2](docs/img/v2-contact-1.jpg)

| Step | Doc | Status |
|---|---|---|
| 0 | [Process log](docs/00-process.md) | ongoing |
| 1 | [Music analysis](docs/01-analysis.md): tempo map, bars, sections, hits, sync events | done |
| 2 | [Concept & storyboard](docs/02-storyboard.md) | approved |
| 3 | [Renderer](docs/03-renderer.md): three.js app + offline render | v2: 55 cuts, full look pass, motion blur |
| 4 | [Handoff / to-do](docs/04-handoff.md): how to continue locally, status per shot | — |

Working with an AI agent? See [CLAUDE.md](CLAUDE.md).

## Quick start

```bash
cd video
npm install && npx playwright install chromium
npm run dev                      # preview with the song at http://localhost:5173
npm run still -- --shots         # one still per shot -> video/out/stills
npm run render                   # 1920x1080 mp4 with audio -> video/out  (needs ffmpeg)
```

Re-run the analysis (only if `tools/analyze.py` changes):

```bash
pip install -r requirements.txt
python tools/analyze.py audio/trommelsand.mp3
```

## Layout

```
audio/        the song
tools/        analysis script (Python)
analysis/     analysis.json + plots
docs/         process documentation
video/        three.js renderer (Vite) + render scripts
```
