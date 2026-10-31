import type { BuddyApi } from '../shared/ipc';

// Exposed by src/preload/index.ts.
declare global {
  interface Window {
    readonly buddy: BuddyApi;
  }
}
