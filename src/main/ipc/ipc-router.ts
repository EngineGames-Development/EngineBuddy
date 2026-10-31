import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import type { z } from 'zod';
import {
  buddyCommandSchema,
  windowCommandSchema,
  type BuddyCommand,
  type WindowCommand,
} from '../../shared/commands';
import { IPC_CHANNELS } from '../../shared/ipc';
import { isOwnRendererUrl } from '../windows/renderer-url';

export interface CommandHandler {
  (command: BuddyCommand, from: BrowserWindow): void;
}

// The trust boundary for renderer → main traffic (SECURITY.md §7). Every message must come from
// the top-level frame of one of our own pages, and must parse against its schema. Anything else
// is dropped and logged (without the payload, which may contain user text).
export function registerIpc(onCommand: CommandHandler): void {
  ipcMain.on(IPC_CHANNELS.command, (event, payload: unknown) => {
    const win = trustedSenderWindow(event, IPC_CHANNELS.command);
    const command = win && parseOrReject(buddyCommandSchema, payload, IPC_CHANNELS.command);
    if (win && command) onCommand(command, win);
  });

  ipcMain.on(IPC_CHANNELS.window, (event, payload: unknown) => {
    const win = trustedSenderWindow(event, IPC_CHANNELS.window);
    const command = win && parseOrReject(windowCommandSchema, payload, IPC_CHANNELS.window);
    if (win && command) applyWindowCommand(win, command);
  });
}

function applyWindowCommand(win: BrowserWindow, command: WindowCommand): void {
  switch (command.type) {
    case 'set_click_through':
      // `forward` keeps mouse-move events flowing while ignoring clicks, so the renderer can
      // notice the cursor coming back over the avatar (docs/decisions/001-window-spike.md).
      win.setIgnoreMouseEvents(command.enabled, { forward: true });
      break;
    case 'move_by': {
      const [x = 0, y = 0] = win.getPosition();
      win.setPosition(x + command.dx, y + command.dy);
      break;
    }
  }
}

function trustedSenderWindow(event: IpcMainEvent, channel: string): BrowserWindow | null {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !isOwnRendererUrl(frame.url)) {
    console.warn(`[ipc] rejected ${channel}: untrusted sender ${frame?.url ?? '(destroyed frame)'}`);
    return null;
  }
  return BrowserWindow.fromWebContents(event.sender);
}

function parseOrReject<T>(schema: z.ZodType<T>, payload: unknown, channel: string): T | null {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  console.warn(`[ipc] rejected ${channel}: ${issues.join('; ')}`);
  return null;
}
