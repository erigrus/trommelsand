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
//             ?quality=0.5 (fewer terrain vertices / particles, for slow machines)

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const music = new Music(analysis);
const canvas = document.getElementById('c');

let W = +params.get('w') || 1920;
let H = +params.get('h') || 1080;
let quality = +(params.get('quality') ?? 1);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: RENDER, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

const director = new Director({ renderer, music, width: W, height: H, quality });
await director.init();
window.director = director;
window.music = music;
document.getElementById('loading').remove();

const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
window.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

if (RENDER) {
  document.body.classList.add('render');
  // Render one frame and return it as a data URL (JPEG unless png requested).
  window.renderFrame = (frame, type = 'image/jpeg', q = 0.95) => {
    director.render(frame / music.fps);
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
  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  if (params.has('t')) audio.currentTime = +params.get('t');

  const $ = (id) => document.getElementById(id);
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
    timeline.appendChild(d);
  });

  const seek = (t) => { audio.currentTime = Math.max(0, Math.min(music.duration - 0.01, t)); };
  timeline.addEventListener('pointerdown', (e) => {
    const r = timeline.getBoundingClientRect();
    const go = (ev) => seek(((ev.clientX - r.left) / r.width) * music.duration);
    go(e);
    const mv = (ev) => go(ev);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true });
  });
  const toggle = () => (audio.paused ? audio.play() : audio.pause());
  $('play').onclick = toggle;
  let hud = true;
  window.addEventListener('keydown', (e) => {
    const t = audio.currentTime;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        const i = director.shots.indexOf(director.shotAt(t + 0.07));
        const s = director.shots[Math.max(0, Math.min(director.shots.length - 1, i + dir))];
        seek(s.start + 0.07);
      } else {
        const b = music.barAt(t + 0.01).bar;
        seek(music.barTime(Math.max(1, b + dir)));
      }
    } else if (e.key === 'h') { hud = !hud; $('hud').style.display = hud ? '' : 'none'; }
    else if (e.key === 'q') {
      // toggle preview resolution (render size stays 16:9)
      const half = W === 1920;
      W = half ? 960 : 1920; H = half ? 540 : 1080;
      director.setSize(W, H);
    }
  });

  let last = performance.now(), fpsAvg = 25;
  function loop() {
    const t = audio.currentTime;
    director.render(t);
    const now = performance.now();
    fpsAvg = fpsAvg * 0.95 + (1000 / Math.max(1, now - last)) * 0.05;
    last = now;
    const bar = music.barAt(t), beat = music.beatAt(t), shot = director.shotAt(t), sec = music.sectionAt(t);
    $('time').textContent = fmt(t);
    $('barinfo').textContent = `bar ${bar.bar} · beat ${Math.min(4, Math.floor(bar.phase * 4) + 1)} · ${music.bpmAt(t)} BPM`;
    $('beat').style.opacity = String(1 - beat.phase);
    $('play').textContent = audio.paused ? '▶ play' : '❚❚ pause';
    playhead.style.left = (t / music.duration) * 100 + '%';
    if (hud) {
      $('hud').textContent =
        `shot ${shot.id} · ${shot.name}\n` +
        `section S${sec.idx} · ${W}×${H} · ${fpsAvg.toFixed(0)} fps · ${window.glRenderer}\n` +
        `kick ${music.envelope('kick', t, 0.18).toFixed(2)}  snare ${music.envelope('snare', t, 0.25).toFixed(2)}  hat ${music.envelope('hat', t, 0.12).toFixed(2)}  rms ${music.curve('rms', t).toFixed(2)}`;
    }
    requestAnimationFrame(loop);
  }
  loop();
}
