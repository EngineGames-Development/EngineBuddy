const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', {
  send: (msg) => ipcRenderer.send('spike', msg),
  onEvent: (fn) => ipcRenderer.on('spike-event', (_e, ev) => fn(ev)),
});
