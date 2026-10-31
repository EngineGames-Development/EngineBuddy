import { contextBridge } from 'electron';

// The renderer's only door into the main process. It's empty on purpose: the typed
// `window.buddy` API (events in, a few commands out) is defined in Phase 1 Step 2.
contextBridge.exposeInMainWorld('buddy', Object.freeze({}));
