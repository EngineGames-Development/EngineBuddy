import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type BrowserWindow } from 'electron';

export type RendererWindow = 'avatar' | 'confirm';

// In `npm run dev`, electron-vite serves renderers from a local dev server and passes its URL in
// ELECTRON_RENDERER_URL. In a build, renderers are files next to the main bundle.
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const builtRendererDir = join(__dirname, '../renderer');

/** Load a renderer page. `query` passes read-only startup settings to the page. */
export function loadRenderer(
  win: BrowserWindow,
  name: RendererWindow,
  query: Record<string, string> = {},
): Promise<void> {
  return devServerUrl
    ? win.loadURL(`${devServerUrl}/${name}/index.html?${new URLSearchParams(query)}`)
    : win.loadFile(join(builtRendererDir, name, 'index.html'), { query });
}

// Dev only: a renderer's warnings and errors (CSP violations, React errors) are otherwise
// invisible, because the window has no DevTools open. Echo them to the terminal.
export function forwardRendererProblems(win: BrowserWindow, name: RendererWindow): void {
  if (!devServerUrl) return;
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      console.log(`[${name}:${event.level}] ${event.message}`);
    }
  });
}

export function isOwnRendererUrl(url: string): boolean {
  const base = devServerUrl ?? pathToFileURL(builtRendererDir).href;
  return url.startsWith(base);
}
