const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  onBrowseCommand: (callback) => ipcRenderer.on('browse-command', callback),
  removeBrowseCommandListener: (callback) => ipcRenderer.removeListener('browse-command', callback),
  onOpenInBrowse: (callback) => ipcRenderer.on('open-in-browse', callback),
  // Download events
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onDownloadCompleted: (callback) => ipcRenderer.on('download-completed', callback),
  removeDownloadListeners: () => {
    ipcRenderer.removeAllListeners('download-started');
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('download-completed');
  },
  // Screen capture
  captureScreen: (rect) => ipcRenderer.invoke('capture-screen', rect),
  // Native print dialog
  print: (options) => ipcRenderer.invoke('print', options),
  // File handling
  openPath: (path) => shell.openPath(path),
  showItemInFolder: (path) => shell.showItemInFolder(path)
});
