import { join } from 'node:path';
import { BrowserWindow, screen, type Display, type Rectangle } from 'electron';
import {
  clampInto,
  rescue,
  restoreSpot,
  snapToCorner,
  type DisplayArea,
  type Point,
} from '../../core/window/placement';
import type { WindowCommand } from '../../shared/commands';
import { AVATAR_BOX, AVATAR_OFFSET, SCALE_STEP, WINDOW_BASE, clampScale } from '../../shared/layout';
import type { SettingsStore } from '../settings/settings-store';
import { forwardRendererProblems, loadRenderer } from './renderer-url';

const SNAP_ANIMATION_MS = 140;
const SNAP_FRAME_MS = 16;

/**
 * The avatar window (ARCHITECTURE.md §8.1): transparent, frameless, above normal windows, not in
 * the taskbar or Alt-Tab, click-through except where the renderer says the cursor is over
 * something. Positions are tracked by the avatar's own rectangle (see shared/layout.ts), which is
 * what gets clamped, snapped and saved per display.
 */
export class AvatarWindow {
  readonly win: BrowserWindow;
  private scale: number;
  private snapTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly settings: SettingsStore) {
    this.scale = clampScale(settings.get().scale);
    const displays = screen.getAllDisplays();
    const spot = restoreSpot({
      size: this.avatarSize(),
      displays: displays.map(toArea),
      primaryId: String(screen.getPrimaryDisplay().id),
      lastDisplayId: settings.get().lastDisplayId,
      saved: settings.get().positions,
    });

    this.win = new BrowserWindow({
      ...this.boundsForAvatarAt(spot.topLeft),
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Tool-window style (WS_EX_TOOLWINDOW): keeps it out of Alt-Tab, not just the taskbar.
      type: 'toolbar',
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
    this.win.setAlwaysOnTop(true, 'floating');
    // Start fully click-through; the renderer turns it off while the cursor is over the avatar.
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.once('ready-to-show', () => this.win.showInactive());

    const rescueAvatar = () => this.rescue();
    screen.on('display-removed', rescueAvatar);
    screen.on('display-metrics-changed', rescueAvatar);
    this.win.once('closed', () => {
      screen.off('display-removed', rescueAvatar);
      screen.off('display-metrics-changed', rescueAvatar);
    });

    forwardRendererProblems(this.win, 'avatar');
    void loadRenderer(this.win, 'avatar', {
      bubbleDismissMs: String(settings.get().bubbleDismissSeconds * 1000),
    });
  }

  handle(command: WindowCommand): void {
    switch (command.type) {
      case 'set_click_through':
        // `forward` keeps mouse-move events flowing while ignoring clicks, so the renderer can
        // notice the cursor coming back over the avatar (docs/decisions/001-window-spike.md).
        this.win.setIgnoreMouseEvents(command.enabled, { forward: true });
        break;
      case 'move_by': {
        this.stopSnap();
        const [x = 0, y = 0] = this.win.getPosition();
        this.win.setPosition(x + command.dx, y + command.dy);
        break;
      }
      case 'drag_end':
        this.settle();
        break;
      case 'scale_by':
        this.setScale(this.scale + command.steps * SCALE_STEP);
        break;
    }
  }

  get visible(): boolean {
    return this.win.isVisible();
  }

  setVisible(visible: boolean): void {
    if (visible) this.win.showInactive();
    else this.win.hide();
  }

  /** The avatar's rectangle on screen, in DIPs. */
  avatarRect(): Rectangle {
    const b = this.win.getBounds();
    const size = this.avatarSize();
    return {
      x: Math.round(b.x + AVATAR_OFFSET.x * this.scale),
      y: Math.round(b.y + AVATAR_OFFSET.y * this.scale),
      width: size,
      height: size,
    };
  }

  private avatarSize(): number {
    return Math.round(AVATAR_BOX * this.scale);
  }

  private boundsForAvatarAt(topLeft: Point): Rectangle {
    return {
      x: Math.round(topLeft.x - AVATAR_OFFSET.x * this.scale),
      y: Math.round(topLeft.y - AVATAR_OFFSET.y * this.scale),
      width: Math.round(WINDOW_BASE.width * this.scale),
      height: Math.round(WINDOW_BASE.height * this.scale),
    };
  }

  private moveAvatarTo(topLeft: Point): void {
    this.win.setBounds(this.boundsForAvatarAt(topLeft));
  }

  /** After a drag: snap into a nearby corner, or at least back fully on-screen; then save. */
  private settle(): void {
    const rect = this.avatarRect();
    const display = screen.getDisplayMatching(rect);
    const target = snapToCorner(rect, display.workArea) ?? clampInto(rect, display.workArea);
    this.animateTo(target, () => this.save(display));
  }

  private setScale(next: number): void {
    const scale = clampScale(next);
    if (scale === this.scale) return;
    const before = this.avatarRect();
    const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    this.scale = scale;
    const size = this.avatarSize();
    const display = screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) });
    const topLeft = clampInto(
      { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size },
      display.workArea,
    );
    this.moveAvatarTo(topLeft);
    this.settings.update({ scale });
    this.save(display);
  }

  private rescue(): void {
    if (this.win.isDestroyed()) return;
    const target = rescue(
      this.avatarRect(),
      screen.getAllDisplays().map(toArea),
      String(screen.getPrimaryDisplay().id),
    );
    if (!target) return;
    this.moveAvatarTo(target);
    this.save(screen.getDisplayMatching(target));
  }

  private save(display: Display): void {
    const { x, y } = this.avatarRect();
    const id = String(display.id);
    this.settings.update({
      lastDisplayId: id,
      positions: { ...this.settings.get().positions, [id]: { x, y } },
    });
  }

  private animateTo(target: Point, done: () => void): void {
    this.stopSnap();
    const from = this.avatarRect();
    if (from.x === target.x && from.y === target.y) return done();
    const start = Date.now();
    this.snapTimer = setInterval(() => {
      if (this.win.isDestroyed()) return this.stopSnap();
      const t = Math.min(1, (Date.now() - start) / SNAP_ANIMATION_MS);
      const ease = 1 - (1 - t) ** 3;
      this.moveAvatarTo({ x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease });
      if (t === 1) {
        this.stopSnap();
        done();
      }
    }, SNAP_FRAME_MS);
  }

  private stopSnap(): void {
    clearInterval(this.snapTimer);
    this.snapTimer = undefined;
  }
}

function toArea(d: Display): DisplayArea {
  return { id: String(d.id), workArea: d.workArea };
}
