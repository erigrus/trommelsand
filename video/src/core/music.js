// Read-only access to analysis/analysis.json. Every query is a pure function of
// music time t (seconds), which keeps rendering deterministic and seekable.

function upperBound(arr, x, key = (v) => v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= x) lo = mid + 1; else hi = mid;
  }
  return lo; // first index with key > x
}

export class Music {
  constructor(a) {
    this.a = a;
    this.fps = a.fps;
    this.duration = a.duration;
    this.frames = Math.ceil(a.duration * a.fps);
    this.curves = a.curves;
    this.beats = a.beats;
    this.bars = a.bars.map((b) => b.t); // bars[0] = bar 1
    this.sections = a.sections;
    this.tempo = a.tempo_regions;
    this.events = a.events;
    this.hits = a.hits; // { kick: [[t, w], ...], snare, hat }
  }

  /** Normalised (0..1) control curve, linearly interpolated. */
  curve(name, t) {
    const c = this.curves[name];
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i <= 0) return c[0];
    if (i >= c.length - 1) return c[c.length - 1];
    const f = x - i;
    return c[i] * (1 - f) + c[i + 1] * f;
  }

  bpmAt(t) {
    for (const r of this.tempo) if (t >= r.start && t < r.end) return r.bpm;
    return this.tempo[this.tempo.length - 1].bpm;
  }

  /** Start time of a 1-based bar number (extrapolates past both ends). */
  barTime(n) {
    const b = this.bars;
    if (n >= 1 && n <= b.length) return b[n - 1];
    if (n < 1) return b[0] + (n - 1) * (b[1] - b[0]);
    return b[b.length - 1] + (n - b.length) * (b[b.length - 1] - b[b.length - 2]);
  }

  /** { bar (1-based, 0 before bar 1), phase 0..1 within the bar, len } */
  barAt(t) {
    const i = upperBound(this.bars, t) - 1;
    if (i < 0) return { bar: 0, phase: 0, len: this.bars[1] - this.bars[0] };
    const t0 = this.bars[i];
    const t1 = i + 1 < this.bars.length ? this.bars[i + 1] : t0 + 4 * 60 / this.bpmAt(t0);
    return { bar: i + 1, phase: Math.min(1, (t - t0) / (t1 - t0)), len: t1 - t0, start: t0 };
  }

  /** { index (0-based beat), phase 0..1, period } */
  beatAt(t) {
    const i = upperBound(this.beats, t) - 1;
    const period = 60 / this.bpmAt(t);
    if (i < 0) return { index: -1, phase: 0, period };
    const t0 = this.beats[i];
    const t1 = i + 1 < this.beats.length ? this.beats[i + 1] : t0 + period;
    return { index: i, phase: Math.min(1, (t - t0) / (t1 - t0)), period: t1 - t0, start: t0 };
  }

  /** Number of hits of `kind` at or before t. */
  hitCount(kind, t) {
    return upperBound(this.hits[kind], t, (h) => h[0]);
  }

  /** Hits with t - window < time <= t, oldest first: [{ i, t, w, age }] */
  recentHits(kind, t, window) {
    const h = this.hits[kind];
    const end = upperBound(h, t, (x) => x[0]);
    const out = [];
    for (let i = end - 1; i >= 0 && t - h[i][0] < window; i--) out.push({ i, t: h[i][0], w: h[i][1], age: t - h[i][0] });
    return out.reverse();
  }

  /** Sum of exponentially decaying impulses — a smooth "how hard was it just hit". */
  envelope(kind, t, decay = 0.25) {
    let s = 0;
    for (const h of this.recentHits(kind, t, decay * 5)) s += h.w * Math.exp(-h.age / decay);
    return Math.min(1.5, s);
  }

  inEvent(kind, t) {
    return this.events[kind].some(([a, b]) => t >= a && t < b);
  }

  sectionAt(t) {
    return this.sections.find((s) => t >= s.start && t < s.end) || this.sections[this.sections.length - 1];
  }
}
