import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { Translate } from '../shared/i18n';

export interface TrayActions {
  isVisible(): boolean;
  setVisible(visible: boolean): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  openChat(): void;
  openSettings(): void;
  exit(): void;
}

/**
 * The tray icon (ARCHITECTURE.md §8.2): Show/Hide, Chat, Settings, Pause, Exit. Left-click toggles visibility.
 * The menu is rebuilt on every open, so its labels always match the current state.
 */
export function createTray(t: Translate, actions: TrayActions): Tray {
  const tray = new Tray(drawIcon());
  tray.setToolTip('EngineBuddy');

  const menu = () =>
    Menu.buildFromTemplate([
      {
        label: actions.isVisible() ? t('menu.hide') : t('menu.show'),
        click: () => actions.setVisible(!actions.isVisible()),
      },
      { label: t('menu.chat'), click: () => actions.openChat() },
      { label: t('menu.settings'), click: () => actions.openSettings() },
      {
        label: t('menu.pause'),
        type: 'checkbox',
        checked: actions.isPaused(),
        click: (item) => actions.setPaused(item.checked),
      },
      { type: 'separator' },
      { label: t('menu.exit'), click: () => actions.exit() },
    ]);

  tray.on('click', () => actions.setVisible(!actions.isVisible()));
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
  return tray;
}

/**
 * A 32×32 icon drawn in code (a small version of the avatar: dark rounded square, violet rim,
 * two eyes), so there is no binary asset to keep in sync with the character.
 */
function drawIcon(): NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4); // BGRA
  const put = (x: number, y: number, [r, g, b]: readonly number[], a: number) => {
    const i = (y * size + x) * 4;
    buf[i] = b ?? 0;
    buf[i + 1] = g ?? 0;
    buf[i + 2] = r ?? 0;
    buf[i + 3] = a;
  };
  const body = [22, 19, 31];
  const rim = [167, 139, 250];
  const eye = [196, 181, 253];
  const radius = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance outside the rounded rectangle [2, 29]², for a soft 1 px edge.
      const dx = Math.max(2 + radius - x, x - (29 - radius), 0);
      const dy = Math.max(2 + radius - y, y - (29 - radius), 0);
      const d = Math.hypot(dx, dy) - radius;
      if (d > 1) continue;
      const alpha = Math.round(255 * Math.min(1, 1 - d));
      const isEye = ((x >= 10 && x <= 12) || (x >= 19 && x <= 21)) && y >= 11 && y <= 18;
      put(x, y, d > -1.5 ? rim : isEye ? eye : body, alpha);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
