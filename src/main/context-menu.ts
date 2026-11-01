import { Menu, type BrowserWindow } from 'electron';
import type { Translate } from '../shared/i18n';

export interface ContextMenuActions {
  ask(): void;
  openChat(): void;
  openSettings(): void;
  systemCheck(): void;
  openInVsCode(): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  exit(): void;
}

/**
 * The avatar's right-click menu (docs/PHASE-1.md step 9). Native for Phase 1 (ARCHITECTURE.md D7),
 * and only items that work. Built on every open, so Pause/Resume matches the current state.
 */
export function showContextMenu(win: BrowserWindow, t: Translate, actions: ContextMenuActions): void {
  const paused = actions.isPaused();
  Menu.buildFromTemplate([
    { label: t('menu.ask'), click: () => actions.ask(), enabled: !paused },
    { label: t('menu.chat'), click: () => actions.openChat() },
    { type: 'separator' },
    { label: t('menu.systemCheck'), click: () => actions.systemCheck(), enabled: !paused },
    { label: t('menu.vscode'), click: () => actions.openInVsCode(), enabled: !paused },
    { type: 'separator' },
    { label: t('menu.settings'), click: () => actions.openSettings() },
    { label: paused ? t('menu.resume') : t('menu.pause'), click: () => actions.setPaused(!paused) },
    { label: t('menu.exit'), click: () => actions.exit() },
  ]).popup({ window: win });
}
