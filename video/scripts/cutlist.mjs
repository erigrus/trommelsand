// Print the cut list exactly as built in src/timeline.js, as a Markdown table.
//   npm run cuts            (paste into docs/02-storyboard.md "Cut list")
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from './lib.mjs';
import { Music } from '../src/core/music.js';
import { buildShots } from '../src/timeline.js';

const analysis = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'analysis', 'analysis.json'), 'utf8'));
const music = new Music(analysis);
const cuts = buildShots(music);
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

console.log('| Cut | Time | Bar | Length | What happens |');
console.log('|---|---|---|---|---|');
for (const c of cuts) {
  const b = music.barAt(c.start + 0.1);
  console.log(`| ${c.id} | ${fmt(Math.max(0, c.start))} | ${b.bar || '–'} | ${(c.end - c.start).toFixed(1)} s | ${c.name} |`);
}
