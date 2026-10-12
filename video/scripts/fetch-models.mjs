// Download third-party models that are not committed to this repo.
//   npm run models
// They land in video/public/models/ (git-ignored). Without them the video
// still renders: the walker falls back to the procedural figure.
import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_DIR } from './lib.mjs';

const MODELS = [
  {
    file: 'Soldier.glb',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Soldier.glb',
    note: 'Rigged human with Idle/Walk/Run, from mixamo.com via the three.js examples. Mixamo terms: '
      + 'royalty-free use in projects (incl. films/videos); do not redistribute the file itself.',
  },
];

const dir = path.join(VIDEO_DIR, 'public', 'models');
fs.mkdirSync(dir, { recursive: true });
for (const m of MODELS) {
  const out = path.join(dir, m.file);
  if (fs.existsSync(out)) { console.log(`have  ${m.file}`); continue; }
  const res = await fetch(m.url);
  if (!res.ok) { console.error(`FAILED ${m.file}: HTTP ${res.status}`); process.exitCode = 1; continue; }
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`got   ${m.file}  (${m.note})`);
}
