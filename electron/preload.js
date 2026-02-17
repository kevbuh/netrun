const { contextBridge, ipcRenderer, shell, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onBrowseCommand: (callback) => ipcRenderer.on('browse-command', callback),
  removeBrowseCommandListener: (callback) => ipcRenderer.removeListener('browse-command', callback),
  onBrowseSwipe: (callback) => ipcRenderer.on('browse-swipe', callback),
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
  // Agent browser automation
  agentExecJs: (wcId, code) => ipcRenderer.invoke('agent-exec-js', wcId, code),
  // Closed captions
  startCC: (wcId) => ipcRenderer.invoke('start-cc', wcId),
  stopCC: () => ipcRenderer.invoke('stop-cc'),
  // Force cursor refresh
  nudgeCursor: () => ipcRenderer.invoke('nudge-cursor'),
  // Window drag (JS-based, so custom cursor stays visible)
  windowGetPosition: () => ipcRenderer.invoke('window-get-position'),
  windowSetPosition: (x, y) => ipcRenderer.invoke('window-set-position', x, y),
  // Native print dialog
  print: (options) => ipcRenderer.invoke('print', options),
  // Secure auth token (macOS Keychain via safeStorage)
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveAuthToken: (token) => ipcRenderer.invoke('save-auth-token', token),
  deleteAuthToken: () => ipcRenderer.invoke('delete-auth-token'),
  clearGoogleCookies: () => ipcRenderer.invoke('clear-google-cookies'),
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
  saveAndOpenTemp: (name, buffer) => ipcRenderer.invoke('save-and-open-temp', name, buffer),
  // Ad blocker (adblock-rs in main process)
  adblockGetCount: (wcId) => ipcRenderer.invoke('adblock-get-count', wcId),
  adblockResetCount: (wcId) => ipcRenderer.invoke('adblock-reset-count', wcId),
  adblockSetEnabled: (on) => ipcRenderer.invoke('adblock-set-enabled', on),
  adblockCosmetic: (url) => ipcRenderer.invoke('adblock-cosmetic', url),
  adblockUpdate: () => ipcRenderer.invoke('adblock-update'),
  adblockStats: () => ipcRenderer.invoke('adblock-stats'),

  // ── Terminal (node-pty via IPC) ──
  terminalStart: (cwd) => ipcRenderer.invoke('terminal:start', cwd),
  terminalInput: (sessionId, data) => ipcRenderer.invoke('terminal:input', sessionId, data),
  terminalResize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  terminalKill: (sessionId) => ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal:output', callback),
  onTerminalExit: (callback) => ipcRenderer.on('terminal:exit', callback),
  removeTerminalListeners: (sessionId) => {
    // Note: removes ALL listeners; fine since each terminal re-registers on connect
    ipcRenderer.removeAllListeners('terminal:output');
    ipcRenderer.removeAllListeners('terminal:exit');
  },

  // ── Captions (Parakeet TDT via IPC) ──
  captionsTranscribe: (pcmBase64, sampleRate) => ipcRenderer.invoke('captions:transcribe', pcmBase64, sampleRate),

  // ── Core tool system (TypeScript backend) ──
  coreAvailable: true,
  toolExecute: (name, input, context) => ipcRenderer.invoke('tools:execute', name, input, context),
  toolList: () => ipcRenderer.invoke('tools:list'),
  toolDefinitions: (access) => ipcRenderer.invoke('tools:definitions', access),

  // ── Provider system ──
  providerList: () => ipcRenderer.invoke('providers:list'),
  providerModels: (providerName) => ipcRenderer.invoke('providers:models', providerName),

  // ── Agent system ──
  agentStart: (options) => ipcRenderer.invoke('agent:start', options),
  agentCancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId),
  agentSessions: () => ipcRenderer.invoke('agent:sessions'),
  onAgentEvent: (callback) => ipcRenderer.on('agent:event', callback),
  removeAgentEventListener: (callback) => ipcRenderer.removeListener('agent:event', callback),
  agentActionResult: (requestId, result) => ipcRenderer.invoke('agent:action-result', requestId, result),

  // ── Doc-chat / Vault-chat streaming events ──
  onDocChatEvent: (callback) => ipcRenderer.on('doc-chat:event', callback),
  removeDocChatEventListener: (callback) => ipcRenderer.removeListener('doc-chat:event', callback),
  onVaultChatEvent: (callback) => ipcRenderer.on('vault-chat:event', callback),
  removeVaultChatEventListener: (callback) => ipcRenderer.removeListener('vault-chat:event', callback),

  // ── Insight (unified ambient + annotations) ──
  insightPageLoaded: (data) => ipcRenderer.invoke('insight:page-loaded', data),
  insightAnalyze: (data) => ipcRenderer.invoke('insight:analyze', data),
  insightSetEnabled: (enabled) => ipcRenderer.invoke('insight:set-enabled', enabled),
  onInsightResult: (cb) => ipcRenderer.on('insight:result', cb),
  removeInsightResultListener: (cb) => ipcRenderer.removeListener('insight:result', cb),
  onInsightPartial: (cb) => ipcRenderer.on('insight:partial', cb),
  removeInsightPartialListener: (cb) => ipcRenderer.removeListener('insight:partial', cb),

  // ── DB query shortcuts (direct IPC, no Flask) ──
  dbQuery: (channel, ...args) => ipcRenderer.invoke('db:' + channel, ...args),
});
