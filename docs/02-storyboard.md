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
| **Kick / low-end hit** (`hits.kick`) | A ring shockwave runs through the sand from the impact point (footstep, thumper, mound, worm wake) and grains jump at its front. The lens punches in by 3 %. In walking shots, **each kick is one step**. |
| **Downbeat** | Cuts land here, 0.06 s early so the first kick lands on the new picture. The Chladni figure changes here. |
| **Riff / phrase** (`bars[].kicks`, `.fill`) | Part A changes picture every 2 or 4 bars, following the 2-bar riff and 8-bar phrases. Fills (bars 24, 32, 48, 56, 64, 98) lead into a new setup. |
| **Snare / mid hits** (`hits.snare`) | Gusts: spindrift streams harder off every crest in view |
| **Cymbals / hats** (`hits.hat`, `high`) | Glints on the sand, faster ripples in the 175 BPM part |
| **Every beat** | From bar 57 the thumper slams on each beat and every slam sends out a ring. In 05c, sand pours over the crest on each beat. |
| **Guitar body** (`mid`) | Wind strength: how much sand blows off the crests, how hard the cloak flutters |
| **Hard stops** (`events.stops`) | Freeze frame. In the storm they are lightning; at 4:43 a blackout, followed by the biggest ring. |
| **Bass out** (`events.bass_out`) | The mound freezes and the walker moves instead (2:58–3:12). At 4:17.6 the storm stops dead, which opens the night. |
| **Section edges** | 0:17.4 sunrise + giant ring · 1:30.6 (bar 40) the haze clears and every crest streams · 2:09.5 thumper · 2:50.5 grains drop · 3:20.7 breach · 3:56.4 storm wall hits · 4:17.6 calm · 4:43.2 blackout |

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

**11 · 2:58.7 – 3:12.5 · bars 78–82 · B2 "Approach"** (stop-and-go)
The ground heaves only while the bass plays (3:00.7, 3:06.8, 3:10.8): the mound
surges toward the walker in jumps. In the gaps it freezes, and the walker freezes too. They are
**walking without rhythm**. Cuts alternate between mound, feet and the walker's back.

**12 · 3:12.5 – 3:20.7 · bars 83–85 · B3 build**
The mound speeds up and the dunes ahead buckle in waves. The camera pulls back fast and low
in front of the advancing ridge.

**13 · 3:20.7 · bar 86 downbeat · BREACH**
A giant worm bursts out of the dune against the sun with a fountain of sand.
The ring mouth fills the frame.

**14 · 3:20.7 – 3:56.4 · bars 86–98 · B4 "Riding the drum"** (energy peak)
The walker rides on the worm's back across the erg. A fast chase shot cuts every
2 bars between side tracking, front, and an aerial with the worm's wake behind.
Spray density follows loudness, each snare flexes a worm segment, and kicks
send rings out from the wake. The micro-stop at 3:34.5 is a 0.2 s freeze frame.

**15 · 3:56.4 – 4:15.6 · bars 99–105 · B5 "Storm"** (heavy, half-time)
A wall of storm swallows the frame: rust-brown, low visibility, sand streaming
sideways. The hard stabs at 4:00.9, 4:01.6 and 4:11.9 become static-electric
lightning flashes that light up the worm's outline in the storm for a moment.

**16 · 4:15.6 – 4:20.9 · bars 106–107 · Eye of the storm** (bass out 4:17.6–4:20.9)
Sudden calm, with storm walls circling. The sky opens to night and **two moons**.
The ground is completely still.

**17 · 4:20.9 – 5:02.2 · bars 108–122 · B6 "Night drum"** (climax)
Moonlit dunes in silver-blue. Glowing **blue spice motes** rise from the sand on
every kick. The whole sea of dunes pulses like a drum skin as rings of light and sand
spread out from the worm's path. The aerial flight returns at speed (mirroring shot 05) and
banks every 2 bars. The stop at 4:43.2 is a 0.4 s blackout that comes back with the
biggest ring of the video.

**18 · 5:02.2 – 5:10.4 · bars 123–125 · B7 sustained chords**
Dawn bleeds into the night sky. In slow motion the worm dives back into the sand and
throws up a huge curtain of sand.

**19 · 5:10.4 – 5:14.6 · bars 126–127 · final hits**
Top-down Chladni plate again (mirroring shot 06). Each final hit snaps the pattern
sharper, ending in one clean ring-shaped figure, like the head of a drum.

**20 · 5:14.6 – 5:21.4 · ring-out**
Silence in the sand. The last grains settle. Pale dawn in a wide shot with the lone figure
small on the ridge. **FUZZAN · TROMMELSAND** fades in, then everything fades to black by 5:21.4.

---

## Timeline at a glance

```
bar   1      8        17              33              49              65    73 75  78   83 86             99     106 108                 123 126
      |intro |  A1    |      A2       |      A3       |      A4       | A5  |br|B1 | B2 |B3| B4            | B5    |eye| B6               |B7 |end|
time 0:00  0:17    0:38            1:15            1:51            2:28  2:46 2:50 2:59 3:12 3:21         3:56   4:16 4:21              5:02 5:10 5:15
shot  02    03-04    05               06              07              08    09 10  11  12 13-14           15     16  17                  18  19   20
light indigo gold    bright gold      hazy gold       white noon      dusty  hush late-afternoon orange   rust   night · two moons · blue  dawn
```

## Cut list (as built)

55 cuts. Generated from `video/src/timeline.js` with `npm run cuts`; rerun it after changing cuts.

| Cut | Time | Bar | Length | What happens |
|---|---|---|---|---|
| 02a | 0:00.0 | – | 5.9 s | Blue hour: crane up over a crest, guitar notes lift grains |
| 02b | 0:05.9 | 3 | 4.6 s | Macro along a knife-edge crest, sand streaming off it |
| 02c | 0:10.5 | 5 | 4.6 s | Endless dunes, the title forms, a figure on the far ridge |
| 02d | 0:15.1 | 7 | 2.3 s | Accelerating into the dawn, the title blows away |
| 03 | 0:17.4 | 8 | 4.6 s | Sunrise on the downbeat, one giant shockwave |
| 04a | 0:22.0 | 10 | 4.6 s | Walker in silhouette on the crest, each step booms |
| 04b | 0:26.5 | 12 | 4.6 s | Low behind the walker: the footprint trail leads away from us |
| 04c | 0:31.1 | 14 | 4.6 s | Drone descends over the crest, a trail of rings |
| 04d | 0:35.7 | 16 | 2.3 s | Front, low, the sun behind the hood |
| 05a | 0:38.0 | 17 | 9.2 s | Low flight into the sun, rings drop ahead |
| 05b | 0:47.1 | 21 | 9.1 s | Long ridge from the side, the tiny walker, each step a pulse |
| 05c | 0:56.2 | 25 | 9.1 s | Under a slip face: sand pours over the crest on every beat |
| 05d | 1:05.4 | 29 | 9.1 s | Top-down over the dune sea, kicks fall like rain |
| 06a | 1:14.5 | 33 | 6.8 s | The desert floor as a drum skin (cymbals out) |
| 06b | 1:21.3 | 36 | 2.3 s | A slip face vibrating, grains dance |
| 06c | 1:23.6 | 37 | 4.6 s | Close on the plate: grains migrate to the new figure |
| 06d | 1:28.2 | 39 | 2.3 s | The walker waits in the haze |
| 06e | 1:30.5 | 40 | 9.1 s | Bar 40: the haze clears, every crest streams |
| 06f | 1:39.7 | 44 | 9.1 s | The plate answers every kick |
| 06g | 1:48.8 | 48 | 2.3 s | Fill: dive onto a crest |
| 07a | 1:51.1 | 49 | 9.1 s | Heat: across the basin on a long lens, rings run over the hardpan |
| 07b | 2:00.2 | 53 | 9.2 s | Tracking the walker, who stops on the fill |
| 07c | 2:09.4 | 57 | 9.1 s | Bar 57: the thumper goes in and slams every beat |
| 07d | 2:18.5 | 61 | 9.1 s | One bar each: rings from above, the hammer, the basin, the grains |
| 08a | 2:27.7 | 65 | 9.1 s | Colour drains; far away a mound moves |
| 08b | 2:36.8 | 69 | 9.2 s | The mound on a long lens, sand sliding off it |
| 09 | 2:46.0 | 73 | 4.5 s | Break: the drums stop, the grains hang in the air |
| 10 | 2:50.4 | 75 | 8.2 s | Grains drop on the downbeat; time-lapse to late afternoon |
| 11a | 2:58.7 | 78 | 2.8 s | Walker listening, very still |
| 11b | 3:01.4 | 79 | 2.7 s | Bass in: the mound surges toward us |
| 11c | 3:04.1 | 80 | 2.8 s | Bass out: the walker moves off-rhythm |
| 11d | 3:06.9 | 81 | 2.7 s | From above: the mound and its wake close in |
| 11e | 3:09.6 | 82 | 2.8 s | The walker braces |
| 12 | 3:12.4 | 83 | 8.2 s | B3: the mound accelerates, the ground heaves |
| 13 | 3:20.6 | 86 | 2.8 s | Breach: the worm bursts out of the ground, mouth toward us |
| 14a | 3:23.4 | 87 | 5.5 s | Side tracking: the walker rides the worm into the sun |
| 14b | 3:28.9 | 89 | 5.5 s | Head-on and low: the worm ploughs toward us |
| 14c | 3:34.4 | 91 | 5.5 s | From above: the wake and its rings |
| 14d | 3:39.9 | 93 | 5.5 s | Close on the rider, cloak whipping |
| 14e | 3:45.3 | 95 | 5.5 s | Long lens: a speck on the worm against the sun |
| 14f | 3:50.8 | 97 | 5.5 s | Low fast chase; a storm wall rises ahead |
| 15a | 3:56.3 | 99 | 2.7 s | Bar 99: the wall hits |
| 15b | 3:59.1 | 100 | 5.5 s | Inside the storm: lightning on the stabs |
| 15c | 4:04.5 | 102 | 2.8 s | Bar 102: the worm rears up in a flash |
| 15d | 4:07.3 | 103 | 8.2 s | The rider braced against the sand |
| 16a | 4:15.5 | 106 | 2.1 s | Bar 106: still in the storm |
| 16b | 4:17.6 | 106 | 3.4 s | Bass out: sudden calm, the sky opens to two moons |
| 17a | 4:21.0 | 108 | 11.0 s | Moonlit flight: every kick a ring of light |
| 17b | 4:32.0 | 112 | 11.0 s | The walker on a crest under the moons; the worm circles below |
| 17c | 4:42.9 | 116 | 2.7 s | Stop: blackout, then the biggest ring of all |
| 17d | 4:45.7 | 117 | 8.2 s | High above: the whole dune sea pulses with light |
| 17e | 4:53.9 | 120 | 8.2 s | Climax: flying toward the moons |
| 18 | 5:02.1 | 123 | 8.2 s | Dawn bleeds in; the worm dives in slow motion |
| 19 | 5:10.3 | 126 | 4.3 s | Final hits: the plate snaps into a drumhead |
| 20 | 5:14.6 | 127 | 6.8 s | Ring-out: dawn, a lone figure, the title, fade |

### Changes from the first storyboard

- Shot 04: the boot macro became a low shot behind the walker, with the footprint trail
  leading away from the camera. The figure doesn't hold up at macro distance.
- Shot 05 (bar 25): the avalanche is sand pouring over a crest line on every beat.
- Shot 06: bar 40 has its own moment, where the haze clears and every crest streams. Bars 44–48 change the
  plate figure on every kick instead of every bar.
- Shot 07: the noon walk is on a cracked hardpan basin, where the rings read best. The thumper is a
  tripod-anchored pole with a hammer head.
- Shots 11/12: the mound gets a dust plume. It only moves while the bass plays (as planned).
- Shot 14f/15a: a visible storm wall rises ahead during the bar-98 fill and hits on the bar-99 downbeat.
- Shot 16b: the calm starts exactly where the bass drops out (4:17.6), not on the next bar.

![cuts 02a-10](img/v2-contact-1.jpg)
![cuts 11a-20](img/v2-contact-2.jpg)

## Technical approach

Built with three.js and custom GLSL. The shots in this document live as code in
`video/src/timeline.js`, and the colour script lives in `video/src/look.js`.
See [03-renderer](03-renderer.md) for how it works and [04-handoff](04-handoff.md) for the status of each shot.
