import { join } from 'node:path';
import { BrowserWindow, screen, type WebContents } from 'electron';
import {
  ALLOW_DELAY_MS,
  type ConfirmationPresenter,
  type PendingConfirmation,
} from '../../security/confirmations/confirmation-broker';
import { forwardRendererProblems, loadRenderer } from './renderer-url';

const SIZE = { width: 520, height: 380 };

/**
 * The confirmation window (SECURITY.md §5). A separate window owned by main: the avatar renderer,
 * which shows model output, can't draw into it or answer it. One window per request, created when
 * asked and destroyed after. Closing it without answering counts as "no".
 */
export class ConfirmWindow implements ConfirmationPresenter {
  private win: BrowserWindow | undefined;
  private shownId: string | undefined;

  /** `onClosed(id)` is called when the window closes before an answer arrived. */
  constructor(private readonly onClosed: (id: string) => void) {}

  /** True if this WebContents belongs to the confirmation window showing request `id`. */
  owns(contents: WebContents, id: string): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === contents && this.shownId === id;
  }

  show(pending: PendingConfirmation): void {
    this.hide();
    const { workArea } = screen.getPrimaryDisplay();
    const win = new BrowserWindow({
      ...SIZE,
      x: Math.round(workArea.x + (workArea.width - SIZE.width) / 2),
      y: Math.round(workArea.y + (workArea.height - SIZE.height) / 3),
      title: 'EngineBuddy wants to run something',
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#14111c',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    // Above the avatar (which is 'floating'), so the bubble can never cover it.
    win.setAlwaysOnTop(true, 'pop-up-menu');
    this.win = win;
    this.shownId = pending.id;

    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      const id = this.shownId;
      this.win = undefined;
      this.shownId = undefined;
      if (id) this.onClosed(id);
    });

    forwardRendererProblems(win, 'confirm');
    void loadRenderer(win, 'confirm', {
      pending: JSON.stringify({
        id: pending.id,
        request: pending.request,
        timeoutMs: pending.timeoutMs,
        allowDelayMs: ALLOW_DELAY_MS,
      }),
    });
  }

  hide(): void {
    const win = this.win;
    this.win = undefined;
    this.shownId = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
}
