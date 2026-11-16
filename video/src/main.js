import * as THREE from 'three';
import analysis from '@analysis/analysis.json';
import audioUrl from '@audio/trommelsand.mp3?url';
import { Music } from './core/music.js';
import { Director } from './director.js';

// Two modes, same Director:
//   preview (default)  — plays the song, renders whatever audio.currentTime is
//   ?render            — no UI; exposes window.renderFrame(frame) for scripts/render.mjs
//
// URL params: ?render  ?w=1920&h=1080  ?t=<seconds> (start position)
//             ?quality=0.5 (fewer terrain vertices / particles, for phones and slow GPUs)

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
const music = new Music(analysis);
const canvas = document.getElementById('c');
const $ = (id) => document.getElementById(id);

// Preview defaults: 360p on phones, 540p on desktop (the final render is always set explicitly).
const defaultRes = RENDER ? '1920x1080' : MOBILE ? '640x360' : '960x540';
let [W, H] = (params.has('w') ? `${params.get('w')}x${params.get('h')}` : defaultRes).split('x').map(Number);
const quality = +(params.get('quality') ?? (MOBILE && !RENDER ? 0.5 : 1));

let director;
try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, preserveDrawingBuffer: RENDER, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  director = new Director({ renderer, music, width: W, height: H, quality });
  await director.init();
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  window.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
} catch (e) {
  $('loadmsg').textContent = `This browser could not start WebGL 2 (${e.message}). Try Chrome, Safari 15+ or Firefox.`;
  throw e;
}
window.director = director;
window.music = music;

if (RENDER) {
  document.body.classList.add('render');
  // Render one frame and return it as a data URL (JPEG unless png requested).
  // ?mb=N averages N sub-frames per frame (motion blur, 180° shutter)
  const mb = +(params.get('mb') ?? 1);
  window.renderFrame = (frame, type = 'image/jpeg', q = 0.95) => {
    director.renderFrame(frame / music.fps, { samples: mb });
    return canvas.toDataURL(type, q);
  };
  window.__ready = true;
} else {
  startPreview();
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function startPreview() {
  let dirty = true;
  // Load the whole song into memory first: seeking then works on any host,
  // including ones without HTTP range requests. Falls back to streaming.
  const audio = new Audio();
  audio.preload = 'auto';
  const startAt = params.has('t') ? +params.get('t') : 0;
  let triedDirect = false;
  const useDirect = () => { if (triedDirect) return; triedDirect = true; audio.src = audioUrl; };
  audio.addEventListener('error', useDirect);
  audio.addEventListener('loadedmetadata', () => { if (startAt) audio.currentTime = startAt; dirty = true; }, { once: true });
  fetch(audioUrl)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then((blob) => { if (!triedDirect) audio.src = URL.createObjectURL(blob); })
    .catch(useDirect);
  $('loading').hidden = true;

  // ----- timeline strip ---------------------------------------------------
  const timeline = $('timeline'), playhead = $('playhead');
  const hues = [28, 18, 36, 12, 42, 24];
  director.shots.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'shot';
    d.style.left = (s.start / music.duration) * 100 + '%';
    d.style.width = ((s.end - s.start) / music.duration) * 100 + '%';
    d.style.background = `hsl(${hues[i % hues.length]} 35% ${18 + (i % 2) * 6}%)`;
    d.textContent = s.id;
    d.title = `${s.id} · ${s.name}`;
    timeline.insertBefore(d, playhead);
  });

  const seek = (t) => { audio.currentTime = Math.max(0, Math.min(music.duration - 0.01, t)); dirty = true; };
  timeline.addEventListener('pointerdown', (e) => {
    const r = timeline.getBoundingClientRect();
    const go = (ev) => seek(((ev.clientX - r.left) / r.width) * music.duration);
    go(e);
    timeline.setPointerCapture(e.pointerId);
    const mv = (ev) => go(ev);
    timeline.addEventListener('pointermove', mv);
    timeline.addEventListener('pointerup', () => timeline.removeEventListener('pointermove', mv), { once: true });
  });

  // ----- transport ----------------------------------------------------------
  const toggle = () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
  const stepBar = (dir) => seek(music.barTime(Math.max(1, music.barAt(audio.currentTime + 0.01).bar + dir)));
  const stepShot = (dir) => {
    const i = director.shots.indexOf(director.shotAt(audio.currentTime + 0.07));
    seek(director.shots[Math.max(0, Math.min(director.shots.length - 1, i + dir))].start + 0.07);
  };
  $('play').onclick = toggle;
  $('prevBar').onclick = () => stepBar(-1);
  $('nextBar').onclick = () => stepBar(1);
  $('prevShot').onclick = () => stepShot(-1);
  $('nextShot').onclick = () => stepShot(1);

  let hud = !MOBILE;
  const setHud = (v) => { hud = v; $('hud').hidden = !v; };
  setHud(hud);
  $('hudBtn').onclick = () => setHud(!hud);

  const res = $('res');
  res.value = `${W}x${H}`;
  res.onchange = () => { [W, H] = res.value.split('x').map(Number); director.setSize(W, H); dirty = true; };

  const fsBtn = $('fs');
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  fsBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else $('stage').requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) stepShot(dir); else stepBar(dir);
    } else if (e.key === 'h') setHud(!hud);
  });

  // ----- render loop ----------------------------------------------------------
  // While paused, only redraw after a seek or resize (saves the phone's battery).
  let last = performance.now(), fpsAvg = 25, lastT = -1;
  function loop() {
    requestAnimationFrame(loop);
    const t = audio.currentTime;
    if (audio.paused && t === lastT && !dirty) return;
    lastT = t; dirty = false;
    director.render(t);
    const now = performance.now();
    if (!audio.paused) fpsAvg = fpsAvg * 0.9 + (1000 / Math.max(1, now - last)) * 0.1;
    last = now;
    const bar = music.barAt(t), beat = music.beatAt(t), shot = director.shotAt(t), sec = music.sectionAt(t);
    $('time').textContent = fmt(t);
    $('barinfo').textContent = `bar ${bar.bar} · beat ${Math.min(4, Math.floor(bar.phase * 4) + 1)} · ${music.bpmAt(t)} BPM`;
    $('beat').style.opacity = String(1 - beat.phase);
    $('play').textContent = audio.paused ? '▶ Play' : '❚❚ Pause';
    playhead.style.left = (t / music.duration) * 100 + '%';
    if (hud) {
      $('hud').textContent =
        `shot ${shot.id} · ${shot.name}\n` +
        `section S${sec.idx} · ${W}×${H} · ${audio.paused ? '–' : fpsAvg.toFixed(0)} fps · ${window.glRenderer}\n` +
        `kick ${music.envelope('kick', t, 0.18).toFixed(2)}  snare ${music.envelope('snare', t, 0.25).toFixed(2)}  hat ${music.envelope('hat', t, 0.12).toFixed(2)}  rms ${music.curve('rms', t).toFixed(2)}`;
    }
  }
  audio.addEventListener('play', () => (dirty = true));
  audio.addEventListener('pause', () => (dirty = true));
  loop();
}
