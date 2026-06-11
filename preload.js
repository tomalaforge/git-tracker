const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setBadgeCount: (count) => ipcRenderer.send('set-badge-count', count),
  saveToken: (token) => ipcRenderer.invoke('save-token', token),
  loadToken: () => ipcRenderer.invoke('load-token'),
  clearToken: () => ipcRenderer.invoke('clear-token'),
  gitPullMaster: () => ipcRenderer.invoke('git-pull-master'),
  downloadCoverageArtifact: (params) => ipcRenderer.invoke('download-coverage-artifact', params),
});
