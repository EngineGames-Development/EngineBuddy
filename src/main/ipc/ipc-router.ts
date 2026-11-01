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

export interface WindowCommandHandler {
  (command: WindowCommand, from: BrowserWindow): void;
}

// The trust boundary for renderer → main traffic (SECURITY.md §7). Every message must come from
// the top-level frame of one of our own pages, and must parse against its schema. Anything else
// is dropped and logged (without the payload, which may contain user text).
export function registerIpc(onCommand: CommandHandler, onWindowCommand: WindowCommandHandler): void {
  ipcMain.on(IPC_CHANNELS.command, (event, payload: unknown) => {
    const win = trustedSenderWindow(event, IPC_CHANNELS.command);
    const command = win && parseOrReject(buddyCommandSchema, payload, IPC_CHANNELS.command);
    if (win && command) onCommand(command, win);
  });

  ipcMain.on(IPC_CHANNELS.window, (event, payload: unknown) => {
    const win = trustedSenderWindow(event, IPC_CHANNELS.window);
    const command = win && parseOrReject(windowCommandSchema, payload, IPC_CHANNELS.window);
    if (win && command) onWindowCommand(command, win);
  });
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
