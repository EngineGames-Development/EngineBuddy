import { contextBridge, ipcRenderer } from 'electron';
import { createBuddyApi } from './api';

// The renderer's only door into the main process: `window.buddy` (see BuddyApi in shared/ipc.ts).
contextBridge.exposeInMainWorld('buddy', createBuddyApi(ipcRenderer));
