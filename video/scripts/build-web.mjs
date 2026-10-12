// Static web build of the preview player (for hosting it as a web page, e.g. on a phone).
//   npm run build:web   ->  dist/  (index.html with relative paths, assets/ with fixed names)
//   dist/page.html is the same page without <html>/<head>/<body> wrappers, for hosts
//   that add their own document skeleton (the claude.ai artifact preview).
//   dist/models/*.json: the downloaded models as glTF JSON, for hosts that don't serve .glb.
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { VIDEO_DIR } from './lib.mjs';

const outDir = path.join(VIDEO_DIR, 'dist');
await build({
  root: VIDEO_DIR,
  configFile: path.join(VIDEO_DIR, 'vite.config.js'),
  base: './',
  logLevel: 'warn',
  build: {
    outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' } },
  },
});

const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.writeFileSync(path.join(outDir, 'page.html'), `${head.trim()}\n${body.trim()}\n`);
// Models: also write each .glb as a self-contained glTF JSON (buffers as data: URIs).
// Some hosts (the claude.ai artifact) serve .json but not .glb; the walker tries both.
const modelDir = path.join(outDir, 'models');
if (fs.existsSync(modelDir)) {
  for (const f of fs.readdirSync(modelDir).filter((n) => n.endsWith('.glb'))) {
    const glb = fs.readFileSync(path.join(modelDir, f));
    let off = 12, json = null, bin = null;
    while (off < glb.length) {
      const len = glb.readUInt32LE(off), type = glb.readUInt32LE(off + 4);
      const chunk = glb.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));   // 'JSON'
      if (type === 0x004e4942) bin = chunk;                                 // 'BIN\0'
      off += 8 + len;
    }
    if (bin) json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
    const out = f.replace(/\.glb$/, '.json');
    fs.writeFileSync(path.join(modelDir, out), JSON.stringify(json));
    console.log(`dist/models/${out}  ${(fs.statSync(path.join(modelDir, out)).size / 1e6).toFixed(2)} MB  (glTF JSON of ${f})`);
  }
}

for (const f of fs.readdirSync(path.join(outDir, 'assets'))) {
  console.log(`dist/assets/${f}  ${(fs.statSync(path.join(outDir, 'assets', f)).size / 1e6).toFixed(2)} MB`);
}
console.log('dist/index.html, dist/page.html');
