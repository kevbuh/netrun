const { app, BrowserWindow, Menu, ipcMain, session, desktopCapturer, safeStorage, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { FilterSet, Engine } = require('adblock-rs');

app.setName('NetRun');

// ── Ad Blocker (adblock-rs / Brave adblock-rust) ──

let _adblockEngine = null;
let _adblockEnabled = true;
const _blockedCounts = {};

const ADBLOCK_ENGINE_PATH = () => path.join(app.getPath('userData'), 'adblock_engine.dat');
const ADBLOCK_META_PATH = () => path.join(app.getPath('userData'), 'adblock_meta.json');
const ADBLOCK_FILTER_LISTS = [
  ['EasyList', 'https://easylist.to/easylist/easylist.txt'],
  ['EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
];

function _mapResourceType(rt) {
  const map = {
    mainFrame: 'document', subFrame: 'subdocument', stylesheet: 'stylesheet',
    script: 'script', image: 'image', font: 'font', object: 'object',
    xhr: 'xmlhttprequest', ping: 'ping', media: 'media',
  };
  return map[rt] || 'other';
}

function _fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _fetchText(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function _downloadAndBuildEngine() {
  const filterSet = new FilterSet();
  let totalRules = 0;
  const listNames = [];

  for (const [name, url] of ADBLOCK_FILTER_LISTS) {
    try {
      const text = await _fetchText(url);
      const rules = text.split('\n').filter(l => l.trim() && !l.startsWith('!'));
      filterSet.addFilters(rules);
      totalRules += rules.length;
      listNames.push(name);
      console.log(`[adblock] Loaded ${name}: ~${rules.length} rules`);
    } catch (e) {
      console.error(`[adblock] Failed to download ${name} (${url}):`, e.message);
    }
  }

  _adblockEngine = new Engine(filterSet);
  try {
    const buf = _adblockEngine.serialize();
    fs.writeFileSync(ADBLOCK_ENGINE_PATH(), Buffer.from(buf));
    console.log('[adblock] Serialized engine to disk');
  } catch (e) {
    console.error('[adblock] Failed to serialize engine:', e.message);
  }

  const meta = { lists: listNames, ruleCount: totalRules, updatedAt: Date.now() };
  try { fs.writeFileSync(ADBLOCK_META_PATH(), JSON.stringify(meta, null, 2)); } catch {}
  return meta;
}

function _getEngineStats() {
  try {
    const data = fs.readFileSync(ADBLOCK_META_PATH(), 'utf8');
    return JSON.parse(data);
  } catch {
    return { lists: [], ruleCount: 0, updatedAt: null };
  }
}

async function initAdblock() {
  const enginePath = ADBLOCK_ENGINE_PATH();
  if (fs.existsSync(enginePath)) {
    try {
      const buf = fs.readFileSync(enginePath);
      _adblockEngine = new Engine(new FilterSet());
      _adblockEngine.deserialize(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      console.log('[adblock] Loaded engine from disk');
      return;
    } catch (e) {
      console.error('[adblock] Failed to deserialize engine:', e.message);
    }
  }
  try {
    await _downloadAndBuildEngine();
  } catch (e) {
    console.error('[adblock] Failed to build engine:', e.message);
  }
}

let pythonProcess = null;
let mainWindow = null;
let serverPort = null;
let _ccTargetWcId = null;

const isDev = !app.isPackaged;

const PREFERRED_PORT = 8000;

// Ensure only one instance of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // Someone tried to run a second instance, focus the first
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function waitForServer(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Server failed to start within timeout'));
      }
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(poll, 200));
      req.setTimeout(1000, () => { req.destroy(); setTimeout(poll, 200); });
    }
    poll();
  });
}

function getDataDir() {
  if (isDev) {
    return path.join(__dirname, '..', 'src');
  }
  return app.getPath('userData');
}

function getStaticDir() {
  if (isDev) {
    return path.join(__dirname, '..', 'src');
  }
  return path.join(process.resourcesPath, 'src');
}

function tryStartPythonServer(port) {
  const dataDir = getDataDir();
  const staticDir = getStaticDir();

  let cmd, args;
  if (isDev) {
    cmd = path.join(__dirname, '..', 'venv', 'bin', 'python3');
    args = [
      path.join(__dirname, '..', 'src', 'app.py'),
      '--port', String(port),
      '--data-dir', dataDir,
      '--static-dir', staticDir,
    ];
  } else {
    cmd = path.join(process.resourcesPath, 'arxiv-server', 'arxiv-server');
    args = [
      '--port', String(port),
      '--data-dir', dataDir,
      '--static-dir', staticDir,
    ];
  }

  return new Promise((resolve, reject) => {
    console.log(`Starting server: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ARXIV_DATA_DIR: dataDir },
    });

    let stderr = '';
    let settled = false;

    proc.stdout.on('data', (data) => {
      console.log(`[server] ${data.toString().trim()}`);
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[server] ${text.trim()}`);
    });

    // If the process exits quickly, it failed to bind
    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Server exited with code ${code}: ${stderr}`));
      }
      console.log(`Python server exited with code ${code}`);
      pythonProcess = null;
    });

    // Give it a moment — if it hasn't crashed, it started successfully
    setTimeout(() => {
      if (!settled) {
        settled = true;
        pythonProcess = proc;
        resolve(port);
      }
    }, 500);
  });
}

function killPython() {
  if (!pythonProcess) return Promise.resolve();
  return new Promise((resolve) => {
    pythonProcess.on('exit', resolve);
    pythonProcess.kill('SIGTERM');
    setTimeout(() => {
      if (pythonProcess) {
        pythonProcess.kill('SIGKILL');
      }
      resolve();
    }, 3000);
  });
}

async function killProcessOnPort(port) {
  return new Promise((resolve) => {
    let cmd;
    if (process.platform === 'darwin' || process.platform === 'linux') {
      cmd = `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`;
    } else {
      // Windows
      cmd = `FOR /F "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a 2>nul || echo.`;
    }
    
    const { exec } = require('child_process');
    exec(cmd, (error) => {
      if (error) {
        // Process might not exist, that's ok
        console.log(`No process found on port ${port} or could not kill it`);
      } else {
        console.log(`Killed process on port ${port}`);
      }
      // Give the OS a moment to release the port
      setTimeout(resolve, 500);
    });
  });
}

// ── Window state persistence ──
function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf8');
    const state = JSON.parse(data);
    console.log('[window-state] Loaded:', state);

    // Validate that window is on screen
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(display => {
      const bounds = display.bounds;
      return state.x >= bounds.x - state.width &&
             state.x <= bounds.x + bounds.width &&
             state.y >= bounds.y &&
             state.y <= bounds.y + bounds.height;
    });

    if (!isVisible) {
      console.log('[window-state] Window off-screen, using defaults');
      return {
        width: state.width || 1400,
        height: state.height || 900,
        x: undefined,
        y: undefined,
      };
    }

    return state;
  } catch (e) {
    console.log('[window-state] No saved state, using defaults');
    return {
      width: 1400,
      height: 900,
      x: undefined,
      y: undefined,
    };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Don't save window state when in fullscreen mode (e.g., fullscreen videos)
  if (mainWindow.isFullScreen()) {
    console.log('[window-state] Skipping save - window is in fullscreen mode');
    return;
  }

  try {
    const bounds = mainWindow.getBounds();
    console.log('[window-state] Saving:', bounds);
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds, null, 2));
  } catch (e) {
    console.error('[window-state] Failed to save:', e);
  }
}

async function createWindow() {
  // Must use port 8000 for Google OAuth to work (authorized origin)
  // First, kill any existing process on port 8000
  await killProcessOnPort(PREFERRED_PORT);

  // Keep retrying until port 8000 is available
  let retries = 0;
  const maxRetries = 30;

  while (retries < maxRetries) {
    try {
      serverPort = await tryStartPythonServer(PREFERRED_PORT);
      break;
    } catch (e) {
      retries++;
      if (retries >= maxRetries) {
        console.error(`Failed to start server on port ${PREFERRED_PORT} after ${maxRetries} attempts`);
        throw new Error(`Port ${PREFERRED_PORT} is unavailable. Please close any other instances of the app and try again.`);
      }
      console.log(`Port ${PREFERRED_PORT} in use, waiting... (${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  await waitForServer(serverPort);

  const windowState = loadWindowState();
  console.log('[window-state] Creating window with:', windowState);

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    transparent: true,
    vibrancy: 'under-window',
  });

  mainWindow.loadURL(`http://localhost:${serverPort}/`);

  // Intercept window.open from the main renderer → open in browse tabs instead
  // Allow Google Sign-In popups to open natively (they need a real window)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/')) {
      return { action: 'allow' };
    }
    mainWindow.webContents.send('open-in-browse', url);
    return { action: 'deny' };
  });

  // Handle keyboard shortcuts for browse view (Cmd+T, Cmd+Shift+T, Cmd+W)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.meta || input.control)) {
      if (input.key.toLowerCase() === 't' && input.shift) {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'reopen-tab');
      } else if (input.key.toLowerCase() === 't') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'new-tab');
      } else if (input.key.toLowerCase() === 'w') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'close-tab');
      } else if (input.key.toLowerCase() === 'o') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'open-file');
      } else if (input.key.toLowerCase() === 'p') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'print');
      }
    }
  });

  // Mouse back/forward buttons
  mainWindow.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward') mainWindow.webContents.send('browse-command', 'back');
    else if (cmd === 'browser-forward') mainWindow.webContents.send('browse-command', 'forward');
  });

  // Save window state on resize/move with debouncing
  let saveTimeout;
  const debouncedSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveWindowState(), 500);
  };

  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move', debouncedSave);

  mainWindow.on('close', () => {
    // Save immediately on close (don't debounce)
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Track sessions that already have download handlers to prevent duplicates
const sessionsWithDownloadHandlers = new WeakSet();
const sessionsWithAdblock = new WeakSet();

// Handle keyboard shortcuts in all web contents (including webviews)
app.on('web-contents-created', (event, contents) => {
  // Only handle webviews (they have a different type of webContents)
  if (contents.getType && contents.getType() === 'webview') {
    // ── Ad block request interceptor ──
    const ses = contents.session;
    if (!sessionsWithAdblock.has(ses)) {
      sessionsWithAdblock.add(ses);
      const _ytAdPatterns = ['/api/stats/ads', '/pagead/', '/get_midroll_', 'doubleclick.net/pagead/', 'googlesyndication.com/pagead/'];
      ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
        if (!_adblockEnabled) return cb({});
        // Fast-path: YouTube ad URL patterns
        const url = details.url;
        for (let i = 0; i < _ytAdPatterns.length; i++) {
          if (url.includes(_ytAdPatterns[i])) {
            _blockedCounts[details.webContentsId] = (_blockedCounts[details.webContentsId] || 0) + 1;
            return cb({ cancel: true });
          }
        }
        if (!_adblockEngine) return cb({});
        const type = _mapResourceType(details.resourceType);
        try {
          const result = _adblockEngine.check(details.url, details.referrer || details.url, type);
          if (result.matched) {
            _blockedCounts[details.webContentsId] = (_blockedCounts[details.webContentsId] || 0) + 1;
            return cb({ cancel: true });
          }
        } catch {}
        cb({});
      });
    }
    // Intercept Cmd+click / target=_blank in webviews → open in browse tabs
    contents.setWindowOpenHandler(({ url }) => {
      const parent = contents.getOwnerBrowserWindow();
      if (parent) {
        parent.webContents.send('open-in-browse', url);
      }
      return { action: 'deny' };
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.meta || input.control)) {
        const key = input.key.toLowerCase();
        if (key === 't' && input.shift) {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) {
            parent.webContents.send('browse-command', 'reopen-tab');
          }
        } else if (key === 't') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) {
            parent.webContents.send('browse-command', 'new-tab');
          }
        } else if (key === 'w') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) {
            parent.webContents.send('browse-command', 'close-tab');
          }
        } else if (key === 'o') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) {
            parent.webContents.send('browse-command', 'open-file');
          }
        } else if (key === 'p') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) {
            parent.webContents.send('browse-command', 'print');
          }
        }
      }
    });

    // Handle downloads from webviews - but only attach once per session
    const session = contents.session;
    if (!sessionsWithDownloadHandlers.has(session)) {
      sessionsWithDownloadHandlers.add(session);

      session.on('will-download', (event, item, webContents) => {
      try {
        // Check if webContents is still valid
        if (!webContents || webContents.isDestroyed()) return;
        
        const parent = webContents.getOwnerBrowserWindow();
        if (!parent) return;
        
        const downloadId = Date.now().toString();
        const filename = item.getFilename();
        const totalBytes = item.getTotalBytes();
        
        // Store parent id to safely reference it later
        const parentId = parent.id;
        
        // Helper to safely send message to parent window
        const safeSend = (channel, data) => {
          try {
            const win = BrowserWindow.fromId(parentId);
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
              win.webContents.send(channel, data);
            }
          } catch (e) {
            // Window was destroyed, ignore
          }
        };
        
        // Notify renderer that download started
        safeSend('download-started', {
          id: downloadId,
          filename: filename,
          url: item.getURL(),
          totalBytes: totalBytes
        });
        
        // Track download progress
        item.on('updated', (event, state) => {
          if (state === 'progressing') {
            safeSend('download-progress', {
              id: downloadId,
              receivedBytes: item.getReceivedBytes(),
              totalBytes: item.getTotalBytes()
            });
          }
        });
        
        // Track download completion
        item.once('done', (event, state) => {
          try {
            const savePath = item.getSavePath();
            safeSend('download-completed', {
              id: downloadId,
              state: state,
              savePath: savePath
            });
          } catch (e) {
            // Ignore errors during completion
          }
        });
      } catch (e) {
        // Silently ignore errors from destroyed objects
      }
      });
    }
  }
});

function createMenu() {
  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('browse-command', 'open-file');
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Option+I' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '..', 'build-resources', 'icon.png');
    const { nativeImage } = require('electron');
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
  createMenu();

  // ── Ad block IPC handlers ──
  ipcMain.handle('adblock-get-count', (_, wcId) => _blockedCounts[wcId] || 0);
  ipcMain.handle('adblock-reset-count', (_, wcId) => { _blockedCounts[wcId] = 0; });
  ipcMain.handle('adblock-set-enabled', (_, on) => { _adblockEnabled = !!on; });
  ipcMain.handle('adblock-cosmetic', (_, url) => {
    if (!_adblockEngine) return { selectors: [] };
    try {
      const res = _adblockEngine.urlCosmeticResources(url);
      return { selectors: res.hiddenClassIdSelectors || [] };
    } catch { return { selectors: [] }; }
  });
  ipcMain.handle('adblock-update', async () => {
    await _downloadAndBuildEngine();
    return _getEngineStats();
  });
  ipcMain.handle('adblock-stats', () => _getEngineStats());

  initAdblock();

  ipcMain.handle('print', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    return new Promise((resolve) => {
      win.webContents.print({ printBackground: true, ...options }, (success) => {
        resolve(success);
      });
    });
  });

  ipcMain.handle('nudge-cursor', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const pos = require('electron').screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = pos.x - bounds.x;
    const y = pos.y - bounds.y;
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  });

  // Closed captions — route webview audio to getDisplayMedia
  ipcMain.handle('start-cc', async (event, wcId) => {
    _ccTargetWcId = wcId;
    return true;
  });

  ipcMain.handle('stop-cc', async () => {
    _ccTargetWcId = null;
    return true;
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (_ccTargetWcId && mainWindow) {
      const { webContents } = require('electron');
      const targetWc = webContents.fromId(_ccTargetWcId);
      if (targetWc) {
        callback({
          video: mainWindow.webContents.mainFrame,
          audio: targetWc.mainFrame,
          enableLocalEcho: true
        });
        return;
      }
    }
    callback(null);
  });

  ipcMain.handle('capture-screen', async (event, rect) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height)
    });
    return image.toPNG().toString('base64');
  });

  ipcMain.handle('capture-webview', async (event, webContentsId) => {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(webContentsId);
      if (!wc) return null;
      const image = await wc.capturePage();
      if (image.isEmpty()) return null;
      return image.toPNG().toString('base64');
    } catch (e) { return null; }
  });

  // Secure auth token via macOS Keychain (safeStorage)
  const fs = require('fs');
  const secureAuthPath = path.join(app.getPath('userData'), 'secure-auth.enc');

  ipcMain.handle('get-auth-token', async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(secureAuthPath)) return null;
      const encrypted = fs.readFileSync(secureAuthPath);
      return safeStorage.decryptString(encrypted);
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle('save-auth-token', async (event, token) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const encrypted = safeStorage.encryptString(token);
      fs.writeFileSync(secureAuthPath, encrypted);
    } catch (e) { /* no-op */ }
  });

  ipcMain.handle('delete-auth-token', async () => {
    try {
      if (fs.existsSync(secureAuthPath)) fs.unlinkSync(secureAuthPath);
    } catch (e) { /* no-op */ }
  });

  // ── Password Manager (encrypted via safeStorage) ──
  const { createPasswordStore } = require('./password-store');
  const pwStore = createPasswordStore({
    fs,
    safeStorage,
    filePath: path.join(app.getPath('userData'), 'passwords.enc'),
    crypto: require('crypto')
  });
  ipcMain.handle('save-and-open-temp', async (_, name, buffer) => {
    const os = require('os');
    const fs = require('fs');
    const { shell } = require('electron');
    const dir = path.join(os.tmpdir(), 'netrun-uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return shell.openPath(filePath);
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('pw-get', (_, origin) => pwStore.get(origin));
  ipcMain.handle('pw-fill', (_, id) => pwStore.fill(id));
  ipcMain.handle('pw-save', (_, data) => pwStore.save(data));
  ipcMain.handle('pw-delete', (_, id) => pwStore.remove(id));
  ipcMain.handle('pw-list', () => pwStore.list());

  createWindow();
});

app.on('window-all-closed', async () => {
  await killPython();
  app.quit();
});

app.on('before-quit', () => {
  killPython();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
