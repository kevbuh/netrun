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
  captureWebview: (webContentsId) => ipcRenderer.invoke('capture-webview', webContentsId),
  // Closed captions
  startCC: (wcId) => ipcRenderer.invoke('start-cc', wcId),
  stopCC: () => ipcRenderer.invoke('stop-cc'),
  // Force cursor refresh
  nudgeCursor: () => ipcRenderer.invoke('nudge-cursor'),
  // Native print dialog
  print: (options) => ipcRenderer.invoke('print', options),
  // Secure auth token (macOS Keychain via safeStorage)
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveAuthToken: (token) => ipcRenderer.invoke('save-auth-token', token),
  deleteAuthToken: () => ipcRenderer.invoke('delete-auth-token'),
  // Password manager
  pwGet: (origin) => ipcRenderer.invoke('pw-get', origin),
  pwFill: (id) => ipcRenderer.invoke('pw-fill', id),
  pwSave: (data) => ipcRenderer.invoke('pw-save', data),
  pwDelete: (id) => ipcRenderer.invoke('pw-delete', id),
  pwList: () => ipcRenderer.invoke('pw-list'),
  // File handling
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openPath: (path) => shell.openPath(path),
  showItemInFolder: (path) => shell.showItemInFolder(path),
  saveAndOpenTemp: (name, buffer) => ipcRenderer.invoke('save-and-open-temp', name, buffer)
});
