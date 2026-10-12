# 02 — Concept & storyboard

## Idea

**Trommelsand** means "drum sand". In the desert of the film the sand carries
every footstep a long way. That is why people walk without rhythm and why a
thumper can call something from far off. Real deserts also have *booming dunes*:
sand that hums and roars when it slides.

In the video **the desert is a drum skin and the band is playing it**.
Each kick, snare and cymbal leaves a visible trace in the sand. A lone walker
crosses the dunes, and every step booms. The drumming wakes something
underneath. The tempo change at 2:50 is where the desert starts answering back.

The look borrows from the films' desert: huge empty dunes, ochre and burnt
orange, a pale washed-out sky, heat haze, a giant worm, a sandstorm, two moons
and blue glowing spice dust. Everything is generated procedurally: no film
footage, logos, characters or names.

### Visual rules

| Music (from `analysis.json`) | Picture |
|---|---|
| **Kick / low-end hit** (`sub` transients) | A ring shockwave runs through the sand from the impact point and grains jump as if on a drum skin. 2–4 px camera jolt. |
| **Downbeat** | Cuts land here. Chladni patterns change mode here. |
| **Snare / mid transients** | Plumes of sand blow off the dune crests. |
| **Cymbals / hats** (`high`) | Glints on grains, heat shimmer, flickering haze |
| **Guitar body** (`mid`, `lowmid`) | Wind strength: streamers of sand, density of the haze |
| **Overall loudness** (`rms_slow`) | Exposure and grade intensity |
| **Brightness** (`centroid`) | Colour temperature: dark riffs go umber/rust, bright riffs go bleached |
| **Hard stops** (`events.stops`) | Freeze frame or a blackout of the same length |
| **Bass out** (`events.bass_out`) | The ground goes still and the worm hides |
| **Tempo** | Part A: camera phrases of 4 bars (9.14 s). Part B: 2 bars (5.49 s), which matches the shorter riff. |

### Colour script

```
0:00 ░ pre-dawn indigo ─▶ 0:17 ▓ sunrise gold ─▶ 1:51 █ white noon ─▶ 2:27 ▒ dust-dimmed
2:50 ▓ late-afternoon orange ─▶ 3:20 █ burning orange ─▶ 3:56 ▒ rust storm ─▶ 4:17 ░ night, two moons, blue spice
5:02 ▒ dawn bleeding into night ─▶ 5:14 ░ pale dawn, still
```

Format: 1920×1080 at 25 fps, full 16:9 frame (no letterbox), with film grain and a light vignette.

---

## Shot list

Times are m:ss.s, bars as in [01-analysis](01-analysis.md).

### Part A — 105 BPM — *"The walk"*

**01 · 0:00.0 – 0:01.5 · before bar 1**
Black. Wind noise. A thin line of light appears on the horizon.

**02 · 0:01.5 – 0:17.4 · bars 1–7 · Intro, solo guitar**
Pre-dawn. Slow, low push across still dunes in cold indigo. Each guitar note
lifts a thin veil of grains off the crest in front of the camera; the grains drift and settle.
The cymbal swell from ~0:07 brightens the sky toward the horizon. The title
**FUZZAN — TROMMELSAND** forms out of drifting sand during bars 4–6, and on bar 7 the
wind blows it away.
*Sync: mid-band onsets → grain veils; `high` → sky brightness.*

**03 · 0:17.4 · bar 8 downbeat · BAND ENTRY**
The sun's rim breaks the horizon on the downbeat. One giant ring shockwave
rolls out across the whole dune field and the sand leaps up as one. Heavy camera jolt.

**04 · 0:17.4 – 0:38.0 · bars 8–16 · A1 "First steps"**
A lone cloaked walker on a dune ridge, in silhouette against the low gold sun.
Their **footsteps are the kick drum**: each step booms out as a ring ripple with a puff of dust.
Cuts every 2 bars between
(a) a wide tracking shot of the walker on the ridge,
(b) a macro of a boot sinking in with ripples spreading,
(c) top-down: a line of footprints, each ring timed to a kick.

**05 · 0:38.0 – 1:14.6 · bars 17–32 · A2 "The drum field"** (brightest block)
Fast aerial flight over an endless sea of dunes. The camera banks to a new heading every 4 bars (bars 17, 21, 25, 29).
Cymbals make the crests glitter; snares throw plumes of sand off the ridges.
At bar 25 (0:56.3) the flight crosses a huge lee face and a sand avalanche
pours down it in steps, one per beat.

**06 · 1:14.6 – 1:51.2 · bars 33–48 · A3 "Singing dunes"** (darker variation)
Straight down from above: the desert floor works as a Chladni plate. Grains gather
on the nodal lines into geometric figures. The figure changes on every downbeat,
and kick strength controls how sharp it gets. Every 4 bars it intercuts with a low
angle on a vibrating slip face. Where the cymbals pull back (~1:30–1:40) haze veils the sun
and the image flattens.

**07 · 1:51.2 – 2:27.7 · bars 49–64 · A4 "Noon"** (loudest block of part A)
Harsh white noon with heat shimmer on the horizon that scales with loudness.
The walker crosses a flat basin of hard drum-sand; every footstep rings out wider than before.
At bar 57 (2:09.5) they drive a metal stake into the sand, and from then on the stake
**throbs on every beat** and sends out concentric rings. In the last 4 bars the cuts come on every downbeat.

**08 · 2:27.7 – 2:46.0 · bars 65–72 · A5 "Something listens"** (dark riff)
The colour drains and dust dims the sun. Wide, still shot: far out on the dunes a
long mound of sand starts to move and swells with the riff. The walker stands
still, side-on, watching.

**09 · 2:46.0 – 2:50.5 · bars 73–74 · BREAK**
Drums and bass stop. **Everything freezes in mid-air**: the dust plumes hang and the
grains float, while the guitar rings on. A slow push in to the walker's hooded silhouette
and suspended grains drift past the lens. Total hush.

### Part B — 87.5 BPM — *"The answer"*

**10 · 2:50.5 – 2:58.7 · bars 75–77 · B1 new riff, no bass**
On the downbeat of bar 75 the hanging grains drop all at once. Time-lapse: the sun
races down to late afternoon and the shadows stretch long. Fine ripples skitter across the sand
in time with the double-time (175 BPM) hats.

**11 · 2:58.7 – 3:12.5 · bars 78–81 · B2 "Approach"** (stop-and-go)
The ground heaves only while the bass plays (3:00.7, 3:06.8, 3:10.8): the mound
surges toward the walker in jumps. In the gaps it freezes, and the walker freezes too. They are
**walking without rhythm**. Cuts alternate between mound, feet and the walker's back.

**12 · 3:12.5 – 3:20.7 · bars 82–84 · B3 build**
The mound speeds up and the dunes ahead buckle in waves. The camera pulls back fast and low
in front of the advancing ridge.

**13 · 3:20.7 · bar 85 downbeat · BREACH**
A giant worm bursts out of the dune against the sun with a fountain of sand.
The ring mouth fills the frame.

**14 · 3:20.7 – 3:56.4 · bars 85–97 · B4 "Riding the drum"** (energy peak)
The walker rides on the worm's back across the erg. A fast chase shot cuts every
2 bars between side tracking, front, and an aerial with the worm's wake behind.
Spray density follows loudness, each snare flexes a worm segment, and kicks
send rings out from the wake. The micro-stop at 3:34.5 is a 0.2 s freeze frame.

**15 · 3:56.4 – 4:15.6 · bars 98–104 · B5 "Storm"** (heavy, half-time)
A wall of storm swallows the frame: rust-brown, low visibility, sand streaming
sideways. The hard stabs at 4:00.9, 4:01.6 and 4:11.9 become static-electric
lightning flashes that light up the worm's outline in the storm for a moment.

**16 · 4:15.6 – 4:20.9 · bars 105–106 · Eye of the storm** (bass out 4:17.6–4:20.9)
Sudden calm, with storm walls circling. The sky opens to night and **two moons**.
The ground is completely still.

**17 · 4:20.9 – 5:02.2 · bars 107–121 · B6 "Night drum"** (climax)
Moonlit dunes in silver-blue. Glowing **blue spice motes** rise from the sand on
every kick. The whole sea of dunes pulses like a drum skin as rings of light and sand
spread out from the worm's path. The aerial flight returns at speed (mirroring shot 05) and
banks every 2 bars. The stop at 4:43.2 is a 0.4 s blackout that comes back with the
biggest ring of the video.

**18 · 5:02.2 – 5:10.4 · bars 122–124 · B7 sustained chords**
Dawn bleeds into the night sky. In slow motion the worm dives back into the sand and
throws up a huge curtain of sand.

**19 · 5:10.4 – 5:14.6 · bars 125–126 · final hits**
Top-down Chladni plate again (mirroring shot 06). Each final hit snaps the pattern
sharper, ending in one clean ring-shaped figure, like the head of a drum.

**20 · 5:14.6 – 5:21.4 · ring-out**
Silence in the sand. The last grains settle. Pale dawn in a wide shot with the lone figure
small on the ridge. **FUZZAN · TROMMELSAND** fades in, then everything fades to black by 5:21.4.

---

## Timeline at a glance

```
bar   1      8        17              33              49              65    73 75  78   82 85             98     105 107                 122 125
      |intro |  A1    |      A2       |      A3       |      A4       | A5  |br|B1 | B2 |B3| B4            | B5    |eye| B6               |B7 |end|
time 0:00  0:17    0:38            1:15            1:51            2:28  2:46 2:50 2:59 3:12 3:21         3:56   4:16 4:21              5:02 5:10 5:15
shot  02    03-04    05               06              07              08    09 10  11  12 13-14           15     16  17                  18  19   20
light indigo gold    bright gold      hazy gold       white noon      dusty  hush late-afternoon orange   rust   night · two moons · blue  dawn
```

## Technical approach (next step)

All rendering is procedural Python. Picture is locked to `analysis/analysis.json`.

| Module | Job |
|---|---|
| `video/timeline.py` | This storyboard as data: shots, times, camera paths, colour keys |
| `video/terrain.py` | Dune heightfield (wind-aligned ridged noise and ripples), shockwave rings as damped radial waves, worm mound. "Voxel-space" column renderer (numba) for low flights and wide shots |
| `video/sky.py` | Gradient sky, sun, haze, two moons, storm wall |
| `video/particles.py` | Grains, plumes, spice motes, frozen grains in the break |
| `video/chladni.py` | Top-down Chladni-plate shots |
| `video/figures.py` | Walker, stake and worm silhouettes |
| `video/post.py` | Grade, heat shimmer, bloom, grain, vignette, titles |
| `video/render.py` | Parallel frame rendering piped to ffmpeg (H.264 + the original audio); `--preview` mode at 480p |

Workflow: build the shots one by one, render a low-res preview per section for review,
then do the final 1080p render.
