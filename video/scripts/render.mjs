// Offline render: frame-exact, chunked, resumable, muxed with the song.
//
//   npm run render                               whole video, 1920x1080
//   npm run render -- --from 17 --to 40          a range in seconds (preview)
//   npm run render -- --w 960 --h 540            half resolution draft
//   options: --chunk 250 (frames per chunk)  --crf 14  --format jpeg|png
//            --quality 1  --swiftshader  --headed  --out out
//
// Chunks land in out/chunks/<w>x<h>/ as finished mp4s. Re-running skips chunks
// that already exist, so an interrupted render resumes where it stopped.
// Delete out/chunks/ after changing the look, or the old chunks are reused!
// Needs ffmpeg on PATH (or set FFMPEG=/path/to/ffmpeg).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openApp, parseArgs, VIDEO_DIR, REPO_DIR } from './lib.mjs';

const a = parseArgs();
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const w = +(a.w ?? 1920), h = +(a.h ?? 1080);
const chunk = +(a.chunk ?? 250);
const crf = String(a.crf ?? 14);
const format = a.format === 'png' ? 'png' : 'jpeg';
const outDir = path.resolve(VIDEO_DIR, a.out ?? 'out');
const chunkDir = path.join(outDir, 'chunks', `${w}x${h}`);
fs.mkdirSync(chunkDir, { recursive: true });

function run(args, stdin = false) {
  const p = spawn(FFMPEG, args, { stdio: [stdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => p.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg failed (${code}):\n${err.slice(-2000)}`)))));
  return { p, done };
}

const app = await openApp({ w, h, quality: +(a.quality ?? 1), swiftshader: !!a.swiftshader, headed: !!a.headed });
const { fps, duration, frames } = app.meta;
console.log(`renderer: ${app.gl}`);
if (/swiftshader/i.test(app.gl) && !a.swiftshader) console.warn('WARNING: rendering on the CPU (SwiftShader). Try --headed for GPU.');

const from = +(a.from ?? 0), to = Math.min(+(a.to ?? duration), duration);
const f0 = Math.round(from * fps), f1 = Math.min(frames, Math.round(to * fps));
const chunks = [];
for (let k = Math.floor(f0 / chunk); k * chunk < f1; k++) {
  const s = Math.max(f0, k * chunk), e = Math.min(f1, (k + 1) * chunk);
  chunks.push({ s, e, file: path.join(chunkDir, `${String(s).padStart(5, '0')}-${String(e).padStart(5, '0')}.mp4`) });
}

const tStart = Date.now();
let done = 0;
const total = f1 - f0;
for (const c of chunks) {
  if (fs.existsSync(c.file)) { done += c.e - c.s; console.log(`skip  ${path.basename(c.file)} (exists)`); continue; }
  const tmp = c.file.replace(/\.mp4$/, '.part.mp4');
  const ff = run(['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', format === 'png' ? 'png' : 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(fps), tmp], true);
  for (let f = c.s; f < c.e; f++) {
    const buf = await app.frame(f, format);
    if (!ff.p.stdin.write(buf)) await new Promise((r) => ff.p.stdin.once('drain', r));
    done++;
    if (done % 25 === 0) {
      const el = (Date.now() - tStart) / 1000, rate = done / el;
      process.stdout.write(`\r${done}/${total} frames  ${rate.toFixed(2)} fps  eta ${((total - done) / rate / 60).toFixed(1)} min   `);
    }
  }
  ff.p.stdin.end();
  await ff.done;
  fs.renameSync(tmp, c.file);
  console.log(`\nwrote ${path.basename(c.file)}`);
}
await app.close();

// concat + mux the matching slice of the song
const list = path.join(chunkDir, 'list.txt');
fs.writeFileSync(list, chunks.map((c) => `file '${c.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
const full = f0 === 0 && f1 === frames;
const name = full ? `trommelsand_${w}x${h}.mp4` : `trommelsand_${w}x${h}_${from.toFixed(1)}-${to.toFixed(1)}.mp4`;
const outFile = path.join(outDir, name);
await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-ss', String(f0 / fps), '-t', String((f1 - f0) / fps), '-i', path.join(REPO_DIR, 'audio', 'trommelsand.mp3'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', outFile]).done;
console.log(`\ndone: ${outFile}  (${((Date.now() - tStart) / 60000).toFixed(1)} min)`);
