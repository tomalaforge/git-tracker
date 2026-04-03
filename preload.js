const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setBadgeCount: (count) => ipcRenderer.send('set-badge-count', count),
});
