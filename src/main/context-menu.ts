import { Menu, type BrowserWindow } from 'electron';

export interface ContextMenuActions {
  ask(): void;
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
export function showContextMenu(win: BrowserWindow, actions: ContextMenuActions): void {
  const paused = actions.isPaused();
  Menu.buildFromTemplate([
    { label: 'Ask EngineBuddy', click: () => actions.ask(), enabled: !paused },
    { type: 'separator' },
    { label: 'System check', click: () => actions.systemCheck(), enabled: !paused },
    { label: 'Open in VS Code…', click: () => actions.openInVsCode(), enabled: !paused },
    { type: 'separator' },
    { label: paused ? 'Resume' : 'Pause', click: () => actions.setPaused(!paused) },
    { label: 'Exit', click: () => actions.exit() },
  ]).popup({ window: win });
}
