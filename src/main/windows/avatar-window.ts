import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { forwardRendererProblems, loadRenderer } from './renderer-url';

// Step 1: a small transparent, frameless, always-on-top window in the bottom-right corner.
// Click-through on empty pixels, dragging, position memory and scale arrive in Step 3
// (ARCHITECTURE.md §8.1). Until then, keep the window small: its transparent area still
// catches clicks.
const SIZE = { width: 160, height: 160 };
const MARGIN = 24;

export function createAvatarWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();

  const win = new BrowserWindow({
    ...SIZE,
    x: workArea.x + workArea.width - SIZE.width - MARGIN,
    y: workArea.y + workArea.height - SIZE.height - MARGIN,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  // 'floating', not 'screen-saver': stay above normal windows without covering fullscreen apps.
  win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.showInactive());
  forwardRendererProblems(win, 'avatar');
  void loadRenderer(win, 'avatar');
  return win;
}
