import { defineConfig } from 'vite';

// The production bundle must be fully self-contained: no CDN, no remote
// fonts, no runtime downloads. `scripts/audit-offline.mjs` enforces this
// after every build.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
