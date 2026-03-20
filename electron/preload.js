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
  copyImageToClipboard: (url) => ipcRenderer.invoke('copy-image-to-clipboard', url),
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  onVoiceHold: (callback) => ipcRenderer.on('voice-hold', callback),
  // Agent browser automation
  agentExecJs: (wcId, code) => ipcRenderer.invoke('agent-exec-js', wcId, code),
  // Closed captions
  startCC: (wcId) => ipcRenderer.invoke('start-cc', wcId),
  stopCC: () => ipcRenderer.invoke('stop-cc'),
  // Force cursor refresh
  nudgeCursor: () => ipcRenderer.invoke('nudge-cursor'),
  cursorSetNativeHiding: (enabled) => ipcRenderer.invoke('cursor:set-native-hiding', enabled),
  // Window drag (JS-based, so custom cursor stays visible)
  windowGetPosition: () => ipcRenderer.invoke('window-get-position'),
  windowSetPosition: (x, y) => ipcRenderer.invoke('window-set-position', x, y),
  // Native print dialog
  print: (options) => ipcRenderer.invoke('print', options),
  // Secure auth token (macOS Keychain via safeStorage)
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  saveAuthToken: (token) => ipcRenderer.invoke('save-auth-token', token),
  deleteAuthToken: () => ipcRenderer.invoke('delete-auth-token'),
  stashGoogleCookies: () => ipcRenderer.invoke('stash-google-cookies'),
  restoreGoogleCookies: () => ipcRenderer.invoke('restore-google-cookies'),
  // Password manager
  pwGet: (origin) => ipcRenderer.invoke('pw-get', origin),
  pwFill: (id) => ipcRenderer.invoke('pw-fill', id),
  pwSave: (data) => ipcRenderer.invoke('pw-save', data),
  pwDelete: (id) => ipcRenderer.invoke('pw-delete', id),
  pwList: () => ipcRenderer.invoke('pw-list'),
  // File handling
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialogMulti: (options) => ipcRenderer.invoke('show-open-dialog-multi', options),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readDir: (dirPath) => ipcRenderer.invoke('system:read-dir', dirPath),
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
  adblockSetSiteException: (domain, disabled) => ipcRenderer.invoke('adblock-set-site-exception', domain, disabled),
  adblockGetSiteExceptions: () => ipcRenderer.invoke('adblock-get-site-exceptions'),
  onAdblockBlocked: (cb) => ipcRenderer.on('adblock-blocked', (_, wcId, count) => cb(wcId, count)),
  // IP geolocation
  ipGeo: (hostname) => ipcRenderer.invoke('db:ip-geo', hostname),
  // DNS-over-HTTPS
  dohSetConfig: (enabled, provider) => ipcRenderer.invoke('doh-set-config', enabled, provider),
  // Tracking Parameter Stripping
  trackingStripGetCount: (wcId) => ipcRenderer.invoke('tracking-strip-get-count', wcId),
  trackingStripResetCount: (wcId) => ipcRenderer.invoke('tracking-strip-reset-count', wcId),
  trackingStripSetEnabled: (on) => ipcRenderer.invoke('tracking-strip-set-enabled', on),
  // HTTPS-Only Mode
  httpsOnlyGetCount: (wcId) => ipcRenderer.invoke('https-only-get-count', wcId),
  httpsOnlyResetCount: (wcId) => ipcRenderer.invoke('https-only-reset-count', wcId),
  httpsOnlySetEnabled: (on) => ipcRenderer.invoke('https-only-set-enabled', on),
  // Third-Party Cookie Blocking
  cookieBlockGetCount: (wcId) => ipcRenderer.invoke('cookie-block-get-count', wcId),
  cookieBlockResetCount: (wcId) => ipcRenderer.invoke('cookie-block-reset-count', wcId),
  cookieBlockSetEnabled: (on) => ipcRenderer.invoke('cookie-block-set-enabled', on),
  // Privacy details (per-tab breakdown)
  privacyDetails: (wcId) => ipcRenderer.invoke('privacy-details', wcId),
  // Aggregate privacy stats
  privacyStats: () => ipcRenderer.invoke('privacy-stats'),
  // Permission request from webview (main → renderer)
  onPermissionRequest: (callback) => ipcRenderer.on('permission-request', callback),
  permissionResponse: (requestId, granted) => ipcRenderer.invoke('permission-response', requestId, granted),

  // ── Terminal (node-pty via IPC) ──
  terminalStart: (cwdOrOpts) => ipcRenderer.invoke('terminal:start', cwdOrOpts),
  terminalInput: (sessionId, data) => ipcRenderer.invoke('terminal:input', sessionId, data),
  terminalResize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  terminalKill: (sessionId) => ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal:output', callback),
  onTerminalExit: (callback) => ipcRenderer.on('terminal:exit', callback),
  removeTerminalListeners: (_sessionId) => {
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
  providerSetDefault: (name) => ipcRenderer.invoke('providers:set-default', name),
  providerGetDefault: () => ipcRenderer.invoke('providers:get-default'),
  providerSetApiKey: (provider, key) => {
    // Store encrypted + set in-memory provider
    ipcRenderer.invoke('set-api-key-secure', provider, key || '');
    return ipcRenderer.invoke('providers:set-api-key', provider, key);
  },
  providerGetApiKey: (provider) => ipcRenderer.invoke('providers:get-api-key', provider),

  // ── Agent system ──
  agentStart: (options) => ipcRenderer.invoke('agent:start', options),
  agentCancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId),
  agentSessions: () => ipcRenderer.invoke('agent:sessions'),
  agentList: () => ipcRenderer.invoke('agent:list'),
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
  insightStop: (tabId) => ipcRenderer.invoke('insight:stop', tabId),
  insightSetEnabled: (enabled) => ipcRenderer.invoke('insight:set-enabled', enabled),
  onInsightResult: (cb) => ipcRenderer.on('insight:result', cb),
  removeInsightResultListener: (cb) => ipcRenderer.removeListener('insight:result', cb),
  onInsightPartial: (cb) => ipcRenderer.on('insight:partial', cb),
  removeInsightPartialListener: (cb) => ipcRenderer.removeListener('insight:partial', cb),

  // ── LLM activity ──
  onLLMActivity: (cb) => ipcRenderer.on('llm:activity', cb),

  // ── PDF convert ──
  pdfDownloadTemp: (url) => ipcRenderer.invoke('pdf:download-temp', url),
  pdfParse: (inputPath) => ipcRenderer.invoke('pdf:parse', inputPath),
  pdfExtract: (inputPath) => ipcRenderer.invoke('pdf:extract', inputPath),
  pdfSplit: (inputPath, pages, outputPath) => ipcRenderer.invoke('pdf:split', inputPath, pages, outputPath),
  pdfMerge: (inputPaths, outputPath) => ipcRenderer.invoke('pdf:merge', inputPaths, outputPath),
  pdfCompress: (inputPath, outputPath) => ipcRenderer.invoke('pdf:compress', inputPath, outputPath),
  pdfToPng: (inputPath, outputDir) => ipcRenderer.invoke('pdf:to-png', inputPath, outputDir),
  pdfToJpeg: (inputPath, outputDir) => ipcRenderer.invoke('pdf:to-jpeg', inputPath, outputDir),
  pdfFromImages: (inputPaths, outputPath) => ipcRenderer.invoke('pdf:from-images', inputPaths, outputPath),
  pdfMdToPdf: (inputPath, outputPath) => ipcRenderer.invoke('pdf:md-to-pdf', inputPath, outputPath),
  pdfToMd: (inputPath, outputPath) => ipcRenderer.invoke('pdf:to-md', inputPath, outputPath),

  // ── Notebook kernel ──
  notebookSave: (filePath, json) => ipcRenderer.invoke('notebook:save', filePath, json),
  notebookStartKernel: (sessionId) => ipcRenderer.invoke('notebook:start-kernel', sessionId),
  notebookExecute: (sessionId, code, cellId) => ipcRenderer.invoke('notebook:execute', sessionId, code, cellId),
  notebookInterrupt: (sessionId) => ipcRenderer.invoke('notebook:interrupt', sessionId),
  notebookRestart: (sessionId) => ipcRenderer.invoke('notebook:restart', sessionId),
  notebookShutdown: (sessionId) => ipcRenderer.invoke('notebook:shutdown', sessionId),
  notebookComplete: (sessionId, code, cursor) => ipcRenderer.invoke('notebook:complete', sessionId, code, cursor),
  onNotebookOutput: (callback) => ipcRenderer.on('notebook:output', callback),
  onNotebookStatus: (callback) => ipcRenderer.on('notebook:status', callback),
  onNotebookExecuteComplete: (callback) => ipcRenderer.on('notebook:execute-complete', callback),
  removeNotebookListeners: () => {
    ipcRenderer.removeAllListeners('notebook:output');
    ipcRenderer.removeAllListeners('notebook:status');
    ipcRenderer.removeAllListeners('notebook:execute-complete');
  },

  // ── Implementation sessions ──
  implCreate: (opts) => ipcRenderer.invoke('impl:create', opts),
  implList: (opts) => ipcRenderer.invoke('impl:list', opts),
  implGet: (id) => ipcRenderer.invoke('impl:get', id),
  implDelete: (id, deleteFiles) => ipcRenderer.invoke('impl:delete', id, deleteFiles),
  implRename: (id, name) => ipcRenderer.invoke('impl:rename', id, name),
  implWatchStart: (sessionId, folderPath) => ipcRenderer.invoke('impl:watch-start', sessionId, folderPath),
  implWatchStop: (sessionId) => ipcRenderer.invoke('impl:watch-stop', sessionId),
  implReadTree: (folderPath) => ipcRenderer.invoke('impl:read-tree', folderPath),
  implReadFile: (folderPath, relativePath) => ipcRenderer.invoke('impl:read-file', folderPath, relativePath),
  implWriteFile: (folderPath, relativePath, content) => ipcRenderer.invoke('impl:write-file', folderPath, relativePath, content),
  implChooseDir: () => ipcRenderer.invoke('impl:choose-dir'),
  implLinkPaper: (sessionId, paperUrl, paperTitle) => ipcRenderer.invoke('impl:link-paper', sessionId, paperUrl, paperTitle),
  implUnlinkPaper: (sessionId, paperUrl) => ipcRenderer.invoke('impl:unlink-paper', sessionId, paperUrl),
  implPapers: (sessionId) => ipcRenderer.invoke('impl:papers', sessionId),
  onImplFileChanged: (callback) => ipcRenderer.on('impl:file-changed', callback),
  removeImplFileListeners: () => ipcRenderer.removeAllListeners('impl:file-changed'),

  // ── DB query shortcuts (direct IPC, no Flask) ──
  dbQuery: (channel, ...args) => ipcRenderer.invoke('db:' + channel, ...args),
});
