import { join } from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { forwardRendererProblems, loadRenderer, type RendererWindow } from './renderer-url';

export interface PanelOptions {
  name: Extract<RendererWindow, 'chat' | 'settings'>;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** Called each time the page has loaded, to send it its current state. */
  onLoad?: () => void;
}

/**
 * An ordinary app window (chat, settings): framed, resizable, in the taskbar. Created on first
 * open, and hidden instead of closed, so reopening is instant and keeps its scroll position.
 */
export class PanelWindow {
  private win: BrowserWindow | undefined;
  private quitting = false;

  constructor(private readonly opts: PanelOptions) {}

  get window(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined;
  }

  /** True if `contents` is this panel's page. */
  owns(contents: WebContents): boolean {
    return this.window?.webContents === contents;
  }

  open(): BrowserWindow {
    const existing = this.window;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return existing;
    }
    const { name, title, width, height, minWidth, minHeight } = this.opts;
    const win = new BrowserWindow({
      width,
      height,
      minWidth,
      minHeight,
      title,
      backgroundColor: '#14111c',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: true,
      },
    });
    this.win = win;
    win.once('ready-to-show', () => win.show());
    win.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      win.hide();
    });
    // Don't rely only on the page asking: push the state once it's loaded, too.
    if (this.opts.onLoad) win.webContents.on('did-finish-load', this.opts.onLoad);
    forwardRendererProblems(win, name);
    void loadRenderer(win, name);
    return win;
  }

  send(channel: string, payload: unknown): void {
    this.window?.webContents.send(channel, payload);
  }

  /** Let the window really close (app quit). */
  destroy(): void {
    this.quitting = true;
    this.window?.destroy();
  }
}
