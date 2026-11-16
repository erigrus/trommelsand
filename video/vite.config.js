import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The repo root holds the song (audio/) and the analysis (analysis/), the
// video app imports both directly so there is a single source of truth.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  server: { port: 5173, fs: { allow: [repoRoot] } },
  build: { target: 'es2022' }, // top-level await in main.js
  resolve: {
    alias: {
      '@analysis': repoRoot + 'analysis',
      '@audio': repoRoot + 'audio',
    },
  },
});
