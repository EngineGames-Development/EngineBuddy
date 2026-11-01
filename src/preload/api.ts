import type { BuddyEvent } from '../shared/events';
import { IPC_CHANNELS, type BuddyApi } from '../shared/ipc';

/** The slice of Electron's ipcRenderer the API needs. Injected so the API can be unit-tested. */
export interface RendererIpc {
  send(channel: string, payload: unknown): void;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
}

// No validation here: main is the trust boundary and validates everything it receives.
// This layer only maps typed method calls onto the three channels.
export function createBuddyApi(ipc: RendererIpc): BuddyApi {
  return Object.freeze({
    onEvent(listener: (event: BuddyEvent) => void) {
      const handler = (_event: unknown, payload: unknown) => listener(payload as BuddyEvent);
      ipc.on(IPC_CHANNELS.event, handler);
      return () => ipc.removeListener(IPC_CHANNELS.event, handler);
    },
    send(command) {
      ipc.send(IPC_CHANNELS.command, command);
    },
    window: Object.freeze({
      setClickThrough(enabled: boolean) {
        ipc.send(IPC_CHANNELS.window, { type: 'set_click_through', enabled });
      },
      moveBy(dx: number, dy: number) {
        ipc.send(IPC_CHANNELS.window, { type: 'move_by', dx, dy });
      },
      dragEnd() {
        ipc.send(IPC_CHANNELS.window, { type: 'drag_end' });
      },
      scaleBy(steps: number) {
        ipc.send(IPC_CHANNELS.window, { type: 'scale_by', steps });
      },
    }),
  } satisfies BuddyApi);
}
