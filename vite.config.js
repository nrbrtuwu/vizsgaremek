import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import slides from './plugins/slides-plugin.js';

const root = import.meta.dirname;

// Slides reference images as /assets/name.svg. The dev server serves that
// folder as is; for `npm run build` it is copied next to the bundle.
function copyAssets() {
  return {
    name: 'fogya-copy-assets',
    apply: 'build',
    closeBundle() {
      const from = resolve(root, 'assets');
      if (existsSync(from)) cpSync(from, resolve(root, 'dist/assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [slides(), copyAssets()],
  publicDir: false,
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    assetsDir: '_bundle',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        editor: resolve(root, 'editor/index.html'),
      },
    },
  },
});
