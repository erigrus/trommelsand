// Shared plumbing for still.mjs / render.mjs: start Vite, open the app in
// Chromium in ?render mode, pull frames out as image buffers.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const VIDEO_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_DIR = path.resolve(VIDEO_DIR, '..');

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = v;
  }
  return out;
}

/**
 * opts: { w, h, quality, swiftshader, headed }
 * GPU: by default Chromium is asked to use the real GPU. Check the printed
 * renderer string. "SwiftShader" means CPU rendering (slow but correct).
 * On Linux without a display, use --headed under xvfb-run or accept SwiftShader.
 */
export async function openApp({ w = 1920, h = 1080, quality = 1, swiftshader = false, headed = false, mb = 1 } = {}) {
  const server = await createServer({
    root: VIDEO_DIR,
    configFile: path.join(VIDEO_DIR, 'vite.config.js'),
    logLevel: 'error',
    server: { port: 5199, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];

  const args = swiftshader
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROME_PATH || undefined,
    args,
  });
  const page = await browser.newPage({ viewport: { width: Math.min(w, 1920), height: Math.min(h, 1080) } });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[page ${m.type()}]`, m.text()); });
  await page.goto(`${url}?render&w=${w}&h=${h}&quality=${quality}&mb=${mb}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
  const gl = await page.evaluate(() => window.glRenderer);
  const meta = await page.evaluate(() => ({
    fps: window.music.fps,
    duration: window.music.duration,
    frames: window.music.frames,
    shots: window.director.shots.map((s) => ({ id: s.id, name: s.name, start: s.start, end: s.end })),
  }));

  return {
    page, gl, meta,
    async frame(i, type = 'jpeg', quality = 0.95) {
      const url = await page.evaluate(([f, t, q]) => window.renderFrame(f, t, q), [i, `image/${type}`, quality]);
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
