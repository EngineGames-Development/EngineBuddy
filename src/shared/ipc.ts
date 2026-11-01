// The IPC contract between main and renderers. This file has no runtime dependencies on purpose:
// the preload imports it, and the preload should stay tiny (no zod, no app logic).
import type { BuddyCommand } from './commands';
import type { BuddyEvent } from './events';

export const IPC_CHANNELS = {
  /** main → renderer: every BuddyEvent, broadcast to all windows. */
  event: 'buddy:event',
  /** renderer → main: a BuddyCommand (validated in main). */
  command: 'buddy:command',
  /** renderer → main: a WindowCommand for the sender's own window (validated in main). */
  window: 'buddy:window',
  /** main → one renderer: a UiRequest for that window only (e.g. open the bubble). */
  ui: 'buddy:ui',
  /** confirm window → main: your answer. Main accepts it only from the confirmation window. */
  confirm: 'buddy:confirm',
} as const;

/**
 * Requests from main to one window's UI. Unlike BuddyEvents these aren't facts for everyone;
 * they ask a specific window to do something (the context menu's "Ask EngineBuddy").
 */
export type UiRequest = { type: 'open_bubble' };

/**
 * Everything a renderer can do, exposed as `window.buddy` by the preload. Nothing else crosses
 * the boundary: no generic invoke, no channel names, no Node APIs.
 */
export interface BuddyApi {
  /** Subscribe to BuddyEvents. Returns an unsubscribe function. */
  onEvent(listener: (event: BuddyEvent) => void): () => void;
  /** Subscribe to UiRequests for this window. Returns an unsubscribe function. */
  onUi(listener: (request: UiRequest) => void): () => void;
  /** Ask main to do something (send a message, cancel the turn, ...). Fire-and-forget. */
  send(command: BuddyCommand): void;
  /** Control the window this renderer lives in. */
  window: {
    setClickThrough(enabled: boolean): void;
    moveBy(dx: number, dy: number): void;
    dragEnd(): void;
    scaleBy(steps: number): void;
    /** Right-click on the avatar: main shows the context menu. */
    openContextMenu(): void;
  };
  /** Only works from the confirmation window; main ignores it from anywhere else. */
  confirm: {
    answer(id: string, allowed: boolean): void;
  };
}
