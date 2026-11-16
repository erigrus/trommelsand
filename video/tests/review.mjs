// Browser regressions for the defects found during the video review.
// CHROME_PATH=/usr/bin/chromium npm test -- --swiftshader
import assert from 'node:assert/strict';
import { Music } from '../src/core/music.js';
import { openApp, parseArgs } from '../scripts/lib.mjs';
const sampleMusic = new Music({fps:25,duration:1,curves:{test:[0,1,0]},beats:[],bars:[],sections:[],tempo_regions:[],events:{},hits:{}});
assert.equal(sampleMusic.curve('test', 0.02), 0.5, 'interpolate the first curve interval');
const args = parseArgs();
const app = await openApp({ w: 320, h: 180, quality: 0.5, swiftshader: !!args.swiftshader });
const errors = [];
app.page.on('pageerror', e => errors.push(e.message));
try {
  const result = await app.page.evaluate(async () => {
    const d = window.director, m = window.music;
    const { U } = await import('/src/world/shared.js');
    const { duneHeight } = await import('/src/world/terrain-fn.js');
    const originalWorld = d.applyWorld.bind(d), originalRender = d.post.render.bind(d.post);
    let ctx;
    d.applyWorld = (c, look) => { ctx = c; originalWorld(c, look); };
    // Inspect world state without spending GPU time on each timeline query.
    d.post.render = () => {};
    const moving = [], nonfinite = [];
    let checked = 0, cameraError = 0;
    for (const shot of d.shots) {
      const t = (shot.start + shot.end) / 2;
      d.render(t);
      const h = m.recentHits('kick', t, 3).at(-1);
      const a = h && ctx.rings?.(h);
      const numbers = [...d.camera.position, ...d.camera.quaternion, ...(ctx.walker ? Object.values(ctx.walker).filter(v => typeof v === 'number') : [])];
      if (!numbers.every(Number.isFinite)) nonfinite.push(shot.id);
      cameraError = Math.max(cameraError, U.uCamPos.value.distanceTo(d.camera.position));
      d.render(t + 0.12);
      const b = h && ctx.rings?.(h);
      if (a && b) { checked++; if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) moving.push(shot.id); }
    }
    // At the final dive frame the complete mesh must have gone below the dunes.
    const dive = d.shots.find(s => s.id === '18');
    d.render(dive.end - 0.001);
    const pos = d.worm.mesh.geometry.attributes.position;
    let aboveSand = -Infinity;
    for (let i = 0; i < pos.count; i += 7) aboveSand = Math.max(aboveSand, pos.getY(i) - duneHeight(pos.getX(i), pos.getZ(i)));
    d.post.render = originalRender;
    const freezes = [];
    for (const [a, b] of d.freezes) {
      d.render(a + 0.01); const first = d.renderer.domElement.toDataURL();
      d.render(Math.min(a + 0.08, b - 0.001));
      freezes.push({ t: a, equal: first === d.renderer.domElement.toDataURL() });
    }
    d.render(222.61);
    const pose = d.renderer.domElement.toDataURL();
    d.render(251.39);
    d.render(222.61);
    const seekEqual = pose === d.renderer.domElement.toDataURL();
    const black = [];
    for (const t of [0, 283.3, m.duration - 0.01]) {
      d.render(t);
      const gl = d.renderer.getContext(), pixels = new Uint8Array(320 * 180 * 4);
      gl.readPixels(0, 0, 320, 180, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      black.push({ t, max: pixels.reduce((v, p, i) => i % 4 === 3 ? v : Math.max(v, p), 0) });
    }
    d.applyWorld = originalWorld;
    return { moving, checked, nonfinite, cameraError, aboveSand, freezes, seekEqual, black, rigged: !!d.rigged };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.nonfinite, [], 'all 55 shots have finite transforms');
  assert.ok(result.checked >= 25, 'exercise rings across the timeline');
  assert.deepEqual(result.moving, [], 'impact centers stay fixed as waves expand');
  assert.equal(result.cameraError, 0, 'fog uses the final guarded camera');
  assert.ok(result.aboveSand < 0, 'worm fully submerges before the next cut');
  assert.ok(result.freezes.every(f => f.equal), 'hard stops hold identical pixels');
  assert.ok(result.seekEqual, 'seeking away and back preserves the braced pose');
  assert.ok(result.black.every(f => f.max === 0), 'blackouts and fades are fully black');
  assert.deepEqual(errors, []);
  // The procedural fallback must also remain usable without downloaded assets.
  await app.page.route('**/models/**', route => route.abort());
  await app.page.reload();
  await app.page.waitForFunction(() => window.__ready === true);
  const fallback = await app.page.evaluate(() => {
    const d = window.director;
    for (const t of [28, 222.61, 251.39, 310.4]) d.render(t);
    return !d.rigged && [...d.camera.position].every(Number.isFinite);
  });
  assert.ok(fallback, 'procedural walker renders when both model formats are missing');
  console.log('Video review regressions passed (rigged and fallback walkers).');
} finally {
  await app.close();
}
