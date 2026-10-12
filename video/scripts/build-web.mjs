// Static web build of the preview player (for hosting it as a web page, e.g. on a phone).
//   npm run build:web   ->  dist/  (index.html with relative paths, assets/ with fixed names)
//   dist/page.html is the same page without <html>/<head>/<body> wrappers, for hosts
//   that add their own document skeleton (the claude.ai artifact preview).
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
for (const f of fs.readdirSync(path.join(outDir, 'assets'))) {
  console.log(`dist/assets/${f}  ${(fs.statSync(path.join(outDir, 'assets', f)).size / 1e6).toFixed(2)} MB`);
}
console.log('dist/index.html, dist/page.html');
