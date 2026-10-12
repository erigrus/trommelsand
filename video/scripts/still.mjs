// Render single frames to PNG — for checking a look without playing the song.
//
//   npm run still -- --t 17.5,60,201            specific times (seconds)
//   npm run still -- --shots                    middle of every shot
//   npm run still -- --shots --at 0.1           10 % into every shot
//   options: --w 960 --h 540 --quality 1 --out out/stills --swiftshader --headed
import fs from 'node:fs';
import path from 'node:path';
import { openApp, parseArgs, VIDEO_DIR } from './lib.mjs';

const a = parseArgs();
const w = +(a.w ?? 960), h = +(a.h ?? 540);
const out = path.resolve(VIDEO_DIR, a.out ?? 'out/stills');
fs.mkdirSync(out, { recursive: true });

const app = await openApp({ w, h, quality: +(a.quality ?? 1), swiftshader: !!a.swiftshader, headed: !!a.headed });
console.log(`renderer: ${app.gl}`);

let jobs = [];
if (a.t) jobs = String(a.t).split(',').map((t) => ({ t: +t, name: `t${(+t).toFixed(2).padStart(7, '0')}` }));
if (a.shots) {
  const at = +(a.at ?? 0.5);
  jobs.push(...app.meta.shots.map((s) => ({ t: s.start + (s.end - s.start) * at, name: `shot${s.id}` })));
}
if (!jobs.length) jobs = [{ t: 20, name: 't0020.00' }];

for (const j of jobs) {
  const f = Math.round(j.t * app.meta.fps);
  const t0 = Date.now();
  const buf = await app.frame(f, 'png');
  const file = path.join(out, `${j.name}.png`);
  fs.writeFileSync(file, buf);
  console.log(`${file}  (t=${j.t.toFixed(2)} s, frame ${f}, ${Date.now() - t0} ms)`);
}
await app.close();
