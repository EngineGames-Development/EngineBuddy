import { BrowserWindow } from 'electron';
import type { BuddyEvent } from '../../shared/events';
import { IPC_CHANNELS } from '../../shared/ipc';

/** Send a BuddyEvent to every open window. The EventBus calls this for each event it emits. */
export function broadcastEvent(event: BuddyEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.event, event);
  }
}
