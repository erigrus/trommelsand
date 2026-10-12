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
