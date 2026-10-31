import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// The HTML files carry the strict production CSP. Only `npm run dev` loosens it: React Fast
// Refresh injects an inline script, and hot reload talks to the dev server over a websocket.
function devCsp(): Plugin {
  return {
    name: 'enginebuddy-dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("default-src 'self';", "default-src 'self'; connect-src 'self' ws://localhost:*;"),
  };
}

// Three builds: main process, preload script, renderer windows.
// Each renderer window is its own HTML entry under src/renderer/<window>/index.html.
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), devCsp()],
    build: {
      rollupOptions: {
        input: { avatar: resolve(__dirname, 'src/renderer/avatar/index.html') },
      },
    },
  },
});
