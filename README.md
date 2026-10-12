# Trommelsand

Music video for **Trommelsand**, an instrumental stoner-rock track (5:21).
The concept: the desert is a drum skin, and every hit of the band shows up in the sand.
The look is loosely inspired by *Dune*.

This repo records how the video is made: the audio analysis, the storyboard,
and (next) the procedural renderer.

| Step | Doc | Status |
|---|---|---|
| 0 | [Process log](docs/00-process.md) | ongoing |
| 1 | [Music analysis](docs/01-analysis.md): tempo map, bars, sections, sync events | done |
| 2 | [Concept & storyboard](docs/02-storyboard.md) | draft, waiting for feedback |
| 3 | Renderer (`video/`) | not started |

## Layout

```
audio/        the song (not committed; put trommelsand.mp3 here)
tools/        analysis scripts
analysis/     analysis output: analysis.json + plots
docs/         process documentation
video/        renderer (coming)
```

## Reproduce

```bash
pip install -r requirements.txt
cp /path/to/03_Trommelsand_final_320MP3.mp3 audio/trommelsand.mp3
python tools/analyze.py audio/trommelsand.mp3      # ~1 min, writes analysis/
```
