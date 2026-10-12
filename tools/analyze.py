#!/usr/bin/env python3
"""Rhythmic and structural analysis of "Trommelsand".

Produces everything the video renderer needs to lock picture to music:

  analysis/analysis.json   tempo map, beat grid, downbeats, phrases, sections,
                           onsets, per-frame control curves at the video fps
  analysis/overview.png    waveform / energy / bands / onsets / tempo / novelty
  analysis/zoom_*.png      close-ups of the transitions
  analysis/selfsim.png     self-similarity matrix used for the sections

Usage:  python tools/analyze.py audio/trommelsand.mp3 [--fps 25]

Approach (see docs/01-analysis.md for the findings):
  1. HPSS -> percussive onset envelope.
  2. Sliding-window comb autocorrelation -> fine local tempo (0.1 BPM),
     octave-folded to 70..140 BPM -> piecewise-constant tempo map.
  3. Dynamic-programming beat tracker driven by that tempo map.
  4. Meter/downbeat: low-band (<150 Hz) accent per beat phase, per tempo region.
  5. Riff period from beat-synchronous chroma/MFCC lag correlation.
  6. Sections: Foote novelty on the beat-synchronous self-similarity matrix,
     boundaries snapped to the nearest downbeat.
"""
import argparse
import json
import os

import librosa
import librosa.display
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy.ndimage
import scipy.signal

SR = 22050
HOP = 512
FR = SR / HOP


def norm(x):
    x = np.asarray(x, dtype=float)
    lo, hi = np.percentile(x, 1), np.percentile(x, 99)
    return np.clip((x - lo) / (hi - lo + 1e-9), 0, 1)


def band_energy(S, freqs, lo, hi):
    idx = (freqs >= lo) & (freqs < hi)
    return np.sqrt(np.mean(S[idx] ** 2, axis=0))


# --------------------------------------------------------------------------
# tempo
# --------------------------------------------------------------------------
def comb_tempo(oe, fr, t0, t1, lo=60.0, hi=200.0):
    """Best tempo in [t0,t1) via comb over the onset autocorrelation."""
    x = oe[int(t0 * fr):int(t1 * fr)]
    x = x - x.mean()
    if len(x) < fr * 4 or not np.any(x):
        return np.nan, 0.0
    ac = np.correlate(x, x, "full")[len(x) - 1:]
    ac /= ac[0] + 1e-9
    lags = np.arange(len(ac)) / fr
    bpms = np.arange(lo, hi, 0.1)
    score = np.array([sum(np.interp(k * 60 / b, lags, ac) for k in range(1, 9)) for b in bpms])
    i = int(np.argmax(score))
    return float(bpms[i]), float(score[i])


def fold(bpm, lo=70, hi=140):
    while bpm > hi:
        bpm /= 2
    while bpm < lo:
        bpm *= 2
    return bpm


def tempo_map(oe_fine, fr_fine, dur, win=16.0, step=2.0):
    """Piecewise-constant tempo regions from sliding comb estimates."""
    centers, raw = [], []
    for c in np.arange(win / 2, dur - win / 2, step):
        b, _ = comb_tempo(oe_fine, fr_fine, c - win / 2, c + win / 2)
        centers.append(c)
        raw.append(fold(b) if np.isfinite(b) else np.nan)
    raw = np.array(raw)
    # median filter, then merge into regions of +-2 BPM
    med = scipy.signal.medfilt(np.nan_to_num(raw, nan=np.nanmedian(raw)), 5)
    regions = []
    for c, b in zip(centers, med):
        if regions and abs(regions[-1]["bpm_list"][-1] - b) < 2.0:
            regions[-1]["bpm_list"].append(b)
            regions[-1]["end"] = c
        else:
            regions.append(dict(start=c, end=c, bpm_list=[b]))
    regions = [r for r in regions if r["end"] - r["start"] >= 8 or len(regions) == 1]
    out = []
    for i, r in enumerate(regions):
        s = 0.0 if i == 0 else (regions[i - 1]["end"] + r["start"]) / 2
        e = dur if i == len(regions) - 1 else None
        out.append(dict(start=s, end=e, bpm=None))
    for i in range(len(out) - 1):
        out[i]["end"] = out[i + 1]["start"]
    # refine each region's tempo on its full extent (more data -> finer)
    for r in out:
        b, _ = comb_tempo(oe_fine, fr_fine, r["start"] + 1, r["end"] - 1)
        r["bpm"] = round(fold(b), 2)
        r["start"], r["end"] = round(r["start"], 2), round(r["end"], 2)
    return out, np.array(centers), raw


def refine_change(oe, fr, beats_t, regions, search=12.0):
    """Move each tempo change to the beat where the IBI actually switches."""
    if len(regions) < 2:
        return regions
    for i in range(1, len(regions)):
        a, b = regions[i - 1]["bpm"], regions[i]["bpm"]
        c = regions[i]["start"]
        cand = beats_t[(beats_t > c - search) & (beats_t < c + search)]
        best, best_err = c, np.inf
        for t in cand:
            ib_before = np.diff(beats_t[(beats_t > t - 8) & (beats_t <= t)])
            ib_after = np.diff(beats_t[(beats_t >= t) & (beats_t < t + 8)])
            if len(ib_before) < 2 or len(ib_after) < 2:
                continue
            err = np.mean(np.abs(ib_before - 60 / a)) + np.mean(np.abs(ib_after - 60 / b))
            if err < best_err:
                best, best_err = t, err
        regions[i - 1]["end"] = regions[i]["start"] = round(float(best), 3)
    return regions


def downbeats_for(beats_t, low_onset_at_beats, regions, meter=4):
    down, info = [], []
    for r in regions:
        m = (beats_t >= r["start"]) & (beats_t < r["end"])
        idx = np.where(m)[0]
        if len(idx) < meter * 2:
            continue
        s = low_onset_at_beats[idx]
        scores = [s[p::meter].mean() / (s.mean() + 1e-9) for p in range(meter)]
        phase = int(np.argmax(scores))
        down.extend(beats_t[idx[phase::meter]].tolist())
        info.append(dict(start=r["start"], phase=phase, scores=[round(float(x), 2) for x in scores]))
    return np.array(down), info


def riff_period(F_sync, max_lag=32):
    X = F_sync - F_sync.mean(1, keepdims=True)
    X /= np.linalg.norm(X, axis=0, keepdims=True) + 1e-9
    prof = [float(np.mean(np.sum(X[:, :-k] * X[:, k:], 0))) for k in range(1, max_lag + 1)]
    return int(np.argmax(prof) + 1), prof


# --------------------------------------------------------------------------
# structure
# --------------------------------------------------------------------------
def foote_novelty(rec, kernel=16):
    n = rec.shape[0]
    g = scipy.signal.windows.gaussian(2 * kernel, kernel / 2)
    C = np.outer(g, g) * np.kron([[1, -1], [-1, 1]], np.ones((kernel, kernel)))
    P = np.pad(rec, kernel, mode="constant")
    return np.maximum([np.sum(P[i:i + 2 * kernel, i:i + 2 * kernel] * C) for i in range(n)], 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--out", default="analysis")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    y, sr = librosa.load(a.audio, sr=SR, mono=True)
    dur = len(y) / sr
    y_harm, y_perc = librosa.effects.hpss(y)

    # ---- tempo map (fine hop for sub-BPM resolution) ---------------------
    hop_f = 128
    oe_fine = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=hop_f)
    regions, tm_c, tm_raw = tempo_map(oe_fine, sr / hop_f, dur)

    # ---- beats -----------------------------------------------------------
    oe = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=HOP, aggregate=np.median)
    t_frames = librosa.frames_to_time(np.arange(len(oe)), sr=sr, hop_length=HOP)

    def track(regs):
        bpm_curve = np.full(len(oe), regs[0]["bpm"])
        for r in regs:
            bpm_curve[(t_frames >= r["start"]) & (t_frames < r["end"])] = r["bpm"]
        _, bf = librosa.beat.beat_track(onset_envelope=oe, sr=sr, hop_length=HOP,
                                        bpm=bpm_curve, tightness=400, trim=False)
        return bf

    beats = track(regions)
    beat_t = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    regions = refine_change(oe, FR, beat_t, regions)
    beats = track(regions)
    beat_t = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    # drop beats tracked into the silent tail
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    alive = rms[beats] > 0.15 * np.median(rms)
    beats, beat_t = beats[alive], beat_t[alive]

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    low_onset = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[freqs < 150]), sr=sr, hop_length=HOP)
    down_t, down_info = downbeats_for(beat_t, low_onset[beats], regions)

    onsets = librosa.onset.onset_detect(onset_envelope=oe, sr=sr, hop_length=HOP)
    onset_t = librosa.frames_to_time(onsets, sr=sr, hop_length=HOP)
    onset_w = oe[onsets] / (oe.max() + 1e-9)

    # ---- control curves --------------------------------------------------
    sub = band_energy(S, freqs, 20, 90)        # kick / bass weight
    lowmid = band_energy(S, freqs, 90, 400)    # fuzz body
    mid = band_energy(S, freqs, 400, 2500)     # guitar riff
    high = band_energy(S, freqs, 2500, 11000)  # cymbals
    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    flat = librosa.feature.spectral_flatness(S=S)[0]
    n = min(len(rms), len(t_frames))

    # ---- riff period + structure ----------------------------------------
    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP)
    F = np.vstack([chroma, librosa.util.normalize(mfcc, axis=1),
                   librosa.util.normalize(rms[None, :chroma.shape[1]], axis=1) * 2])
    F_sync = librosa.util.sync(F, beats, aggregate=np.median)[:, 1:]  # drop pre-first-beat segment
    rp = {}
    for r in regions:
        m = (beat_t >= r["start"]) & (beat_t < r["end"])
        if m.sum() > 40:
            p, prof = riff_period(F_sync[:, m[: F_sync.shape[1]]])
            rp[str(r["start"])] = dict(period_beats=p, lag_profile=[round(v, 3) for v in prof])

    rec = librosa.segment.recurrence_matrix(F_sync, mode="affinity", sym=True, width=3)
    nov = foote_novelty(rec, kernel=16)
    nov_n = nov / (nov.max() + 1e-9)
    peaks, _ = scipy.signal.find_peaks(nov_n, height=0.15, distance=12)
    bounds = sorted({0.0, *[float(beat_t[p]) for p in peaks if 0 < p < len(beat_t)]})
    # snap to downbeats
    snapped = [0.0]
    for b in bounds[1:]:
        d = down_t[np.argmin(np.abs(down_t - b))]
        if d - snapped[-1] > 3:
            snapped.append(float(d))
    last_beat = float(beat_t[-1]) + 60 / regions[-1]["bpm"]
    if dur - last_beat > 2:
        snapped.append(last_beat)
    snapped.append(dur)

    sections = []
    for i in range(len(snapped) - 1):
        t0, t1 = snapped[i], snapped[i + 1]
        m = (t_frames[:n] >= t0) & (t_frames[:n] < t1)
        nb = int(np.sum((beat_t >= t0) & (beat_t < t1)))
        bpm = next((r["bpm"] for r in regions if r["start"] <= t0 + 0.5 < r["end"]), regions[-1]["bpm"])
        sections.append(dict(
            idx=i, start=round(t0, 3), end=round(t1, 3), dur=round(t1 - t0, 2), bpm=bpm,
            beats=nb, bars=round(nb / 4, 2),
            rms=round(float(rms[:n][m].mean()), 4),
            sub=round(float(sub[:n][m].mean()), 2), lowmid=round(float(lowmid[:n][m].mean()), 2),
            mid=round(float(mid[:n][m].mean()), 2), high=round(float(high[:n][m].mean()), 2),
            centroid=round(float(centroid[:n][m].mean())),
            onsets_per_s=round(float(np.sum((onset_t >= t0) & (onset_t < t1)) / max(t1 - t0, 1e-3)), 2),
            novelty=round(float(nov_n[np.argmin(np.abs(beat_t - t0))]), 2) if i else 1.0,
        ))

    # ---- resample to video fps -----------------------------------------
    nv = int(np.ceil(dur * a.fps))
    tv = np.arange(nv) / a.fps

    def at_fps(curve, smooth=0.0):
        c = np.interp(tv, t_frames[: len(curve)], curve[: len(t_frames)])
        if smooth:
            c = scipy.ndimage.gaussian_filter1d(c, smooth)
        return norm(c)

    curves = dict(
        rms=at_fps(rms, 1), rms_slow=at_fps(rms, a.fps * 2),
        sub=at_fps(sub, 0.5), lowmid=at_fps(lowmid, 1), mid=at_fps(mid, 1), high=at_fps(high, 0.5),
        onset=at_fps(oe), centroid=at_fps(centroid, 2), flatness=at_fps(flat, 2),
    )

    # ---- events: hard stops and bass drop-outs (key sync points) ---------
    def runs(mask, min_len):
        res, i = [], 0
        while i < len(mask):
            if mask[i]:
                j = i
                while j < len(mask) and mask[j]:
                    j += 1
                if j - i >= min_len:
                    res.append([round(i / a.fps, 2), round(j / a.fps, 2)])
                i = j
            else:
                i += 1
        return res

    events = dict(
        stops=runs((curves["rms"] < 0.22) & (curves["rms_slow"] > 0.4), 3),
        bass_out=runs(scipy.ndimage.gaussian_filter1d(curves["sub"], 3) < 0.12, int(0.5 * a.fps)),
    )
    bars = [dict(bar=i + 1, t=round(float(t), 3)) for i, t in enumerate(down_t)]

    out = dict(
        file=os.path.basename(a.audio), duration=round(dur, 3), fps=a.fps,
        tempo_regions=regions, downbeat_info=down_info, riff=rp,
        beats=[round(float(t), 3) for t in beat_t],
        downbeats=[round(float(t), 3) for t in down_t],
        bars=bars, events=events,
        onsets=[[round(float(t), 3), round(float(w), 3)] for t, w in zip(onset_t, onset_w)],
        sections=sections,
        curves={k: [round(float(v), 3) for v in c] for k, c in curves.items()},
    )
    with open(os.path.join(a.out, "analysis.json"), "w") as f:
        json.dump(out, f)

    # ---- plots -----------------------------------------------------------
    def overview(path, xlim=None, width=22):
        fig, ax = plt.subplots(6, 1, figsize=(width, 16), sharex=True)
        ax[0].plot(np.arange(len(y))[::20] / sr, y[::20], lw=0.3, color="#8a5a2b")
        ax[0].set_ylabel("wave")
        ax[1].plot(t_frames[:n], norm(rms[:n]), color="#c2793a", lw=0.6, label="rms")
        ax[1].plot(tv, curves["rms_slow"], color="k", lw=2, label="rms (2 s)")
        ax[1].legend(loc="lower right"); ax[1].set_ylabel("energy")
        for name, c, col in [("sub", sub, "#5b2c06"), ("lowmid", lowmid, "#b5651d"),
                             ("mid", mid, "#e1a95f"), ("high", high, "#6ca0dc")]:
            ax[2].plot(t_frames[:n], scipy.ndimage.gaussian_filter1d(norm(c[:n]), 10), label=name, color=col)
        ax[2].legend(loc="lower right"); ax[2].set_ylabel("bands")
        ax[3].plot(t_frames, oe / oe.max(), lw=0.4, color="#444")
        ax[3].vlines(beat_t, 0, 0.15, color="#2a6f4a", lw=0.5)
        ax[3].vlines(down_t, 0, 1, color="r", lw=0.6, alpha=0.5)
        ax[3].set_ylabel("onsets\nbeats / downbeats")
        ax[4].plot(tm_c, tm_raw, ".", color="#2a6f4a", label="window estimate (folded)")
        ax[4].step(beat_t[1:], 60 / np.diff(beat_t), where="pre", color="#999", lw=0.6, label="tracked IBI")
        for r in regions:
            ax[4].hlines(r["bpm"], r["start"], r["end"], color="k", lw=2)
            ax[4].text(r["start"] + 1, r["bpm"] + 3, f"{r['bpm']} BPM", fontsize=10)
        ax[4].set_ylim(60, 140); ax[4].set_ylabel("BPM"); ax[4].legend(loc="lower right")
        ax[5].plot(np.r_[beat_t][: len(nov_n)], nov_n, color="#7a3b8f")
        ax[5].set_ylabel("novelty")
        for a_ in ax:
            for s in sections[1:]:
                a_.axvline(s["start"], color="k", lw=1.2, alpha=0.5)
        top = ax[0].get_ylim()[1] * 0.85
        for s in sections:
            if xlim is None or xlim[0] <= s["start"] < xlim[1]:
                ax[0].text(s["start"] + 0.3, top, f"S{s['idx']}", fontsize=11, weight="bold")
        if xlim:
            ax[-1].set_xlim(*xlim)
        ax[-1].set_xlabel("seconds")
        ax[-1].xaxis.set_major_locator(matplotlib.ticker.MultipleLocator(15 if xlim is None else 2))
        fig.suptitle("Trommelsand — " + ", ".join(f"{r['bpm']} BPM" for r in regions) + f", {dur:.1f} s",
                     fontsize=16)
        fig.tight_layout()
        fig.savefig(os.path.join(a.out, path), dpi=70)
        plt.close(fig)

    overview("overview.png")
    for z in [(0, 30), (140, 200), (230, 270), (290, dur)]:
        overview(f"zoom_{int(z[0]):03d}-{int(z[1]):03d}.png", z, width=18)

    fig, axs = plt.subplots(figsize=(10, 10))
    librosa.display.specshow(rec, ax=axs, cmap="magma")
    axs.set_title("beat-synchronous self-similarity")
    fig.savefig(os.path.join(a.out, "selfsim.png"), dpi=70)

    # ---- report ---------------------------------------------------------
    print(f"duration {dur:.2f}s, {len(beat_t)} beats, {len(down_t)} downbeats")
    for r in regions:
        print(f"tempo {r['start']:7.2f}-{r['end']:7.2f}: {r['bpm']} BPM")
    print("downbeat phases", down_info)
    for k, v in rp.items():
        print(f"riff period (region @{k}s): {v['period_beats']} beats")
    print("events", events)
    print("\nsections:")
    for s in sections:
        print(f"  S{s['idx']:>2} {s['start']:7.2f}-{s['end']:7.2f} ({s['dur']:6.2f}s, {s['bars']:5.2f} bars @{s['bpm']})"
              f" rms={s['rms']:.3f} sub={s['sub']:5.2f} mid={s['mid']:.2f} high={s['high']:.2f}"
              f" cent={s['centroid']} ons/s={s['onsets_per_s']} nov={s['novelty']}")


if __name__ == "__main__":
    main()
