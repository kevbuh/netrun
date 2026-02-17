const { app, BrowserWindow, Menu, ipcMain, session, safeStorage, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { FilterSet, Engine } = require('adblock-rs');

app.setName('NetRun');

// ── Core tool system (TypeScript) ──
// Loaded after app is ready in the whenReady() block below.
// The core system provides: tool registry, LLM providers, IPC handlers.
let _coreInitialized = false;

// ── Ad Blocker (adblock-rs / Brave adblock-rust) ──

let _adblockEngine = null;
let _adblockEnabled = true;
const _blockedCounts = {};

const ADBLOCK_ENGINE_PATH = () => path.join(app.getPath('userData'), 'adblock_engine.dat');
const ADBLOCK_META_PATH = () => path.join(app.getPath('userData'), 'adblock_meta.json');
const ADBLOCK_FILTER_LISTS = [
  ['EasyList', 'https://easylist.to/easylist/easylist.txt'],
  ['EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['HideYTShorts', 'https://raw.githubusercontent.com/i5heu/ublock-hide-yt-shorts/master/list.txt'],
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

let mainWindow = null;
let serverPort = null;
let _ccTargetWcId = null;
let lastSavedBounds = null;

const isDev = !app.isPackaged;

const PREFERRED_PORT = 8000;

// Ensure only one instance of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

// Suppress benign ERR_ABORTED from webview navigations (redirects, ad-blocker cancellations, swipe nav)
process.on('uncaughtException', (err) => {
  if (err && err.code === 'ERR_ABORTED') return;
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  if (reason && (reason.code === 'ERR_ABORTED' || (reason.message && reason.message.includes('ERR_ABORTED')))) return;
  console.error('Unhandled rejection:', reason);
});

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

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain',
  '.map': 'application/json', '.webp': 'image/webp',
};

let _staticServer = null;

function startStaticServer(port) {
  const staticDir = getStaticDir();
  const dataDir = getDataDir();
  const uploadsDir = path.join(dataDir, 'uploads');

  return new Promise((resolve, reject) => {
    _staticServer = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);

      // Serve uploaded files
      if (urlPath.startsWith('/uploads/')) {
        const filename = path.basename(urlPath);
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filename).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Static file serving
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(staticDir, urlPath);

      // Security: prevent path traversal
      if (!filePath.startsWith(staticDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        // SPA fallback — serve index.html for unknown paths
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          fs.createReadStream(indexPath).pipe(res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    });

    _staticServer.on('error', (err) => {
      reject(err);
    });

    _staticServer.listen(port, '127.0.0.1', () => {
      console.log(`Static server listening on http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

function stopStaticServer() {
  if (_staticServer) {
    _staticServer.close();
    _staticServer = null;
  }
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
      return {
        width: state.width || 1400,
        height: state.height || 900,
        x: undefined,
        y: undefined,
      };
    }

    // Store loaded bounds to prevent redundant saves
    lastSavedBounds = { ...state };
    return state;
  } catch (_e) {
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
    return;
  }

  try {
    const bounds = mainWindow.getBounds();

    // Skip save if bounds haven't changed
    if (lastSavedBounds &&
        lastSavedBounds.x === bounds.x &&
        lastSavedBounds.y === bounds.y &&
        lastSavedBounds.width === bounds.width &&
        lastSavedBounds.height === bounds.height) {
      return;
    }

    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds, null, 2));
    lastSavedBounds = { ...bounds };
  } catch (e) {
    console.error('[window-state] Failed to save:', e);
  }
}

async function createWindow() {
  // Must use port 8000 for Google OAuth to work (authorized origin)
  // First, kill any existing process on port 8000
  await killProcessOnPort(PREFERRED_PORT);

  // Start the static file server (replaces Flask)
  let retries = 0;
  const maxRetries = 30;

  while (retries < maxRetries) {
    try {
      serverPort = await startStaticServer(PREFERRED_PORT);
      break;
    } catch (_e) {
      retries++;
      if (retries >= maxRetries) {
        console.error(`Failed to start server on port ${PREFERRED_PORT} after ${maxRetries} attempts`);
        throw new Error(`Port ${PREFERRED_PORT} is unavailable. Please close any other instances of the app and try again.`);
      }
      console.log(`Port ${PREFERRED_PORT} in use, waiting... (${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const windowState = loadWindowState();

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

  // Two-finger trackpad swipe (macOS)
  mainWindow.on('swipe', (e, direction) => {
    if (direction === 'right') mainWindow.webContents.send('browse-swipe', 'back');
    else if (direction === 'left') mainWindow.webContents.send('browse-swipe', 'forward');
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
    contents.setMaxListeners(20);
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
          } catch (_e) {
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
          } catch (_e) {
            // Ignore errors during completion
          }
        });
      } catch (_e) {
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

  // Initialize core tool system (tools, providers, IPC handlers)
  // Ensure TypeScript backend uses the correct data dir
  process.env.ARXIV_DATA_DIR = getDataDir();
  try {
    const { initCore } = require('../dist/main/init.js');
    initCore();
    _coreInitialized = true;
  } catch (err) {
    console.warn('[core] Could not initialize core system (build may be needed):', err.message);
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

  // Window drag — JS-based so custom cursor stays visible
  ipcMain.handle('window-get-position', () => {
    if (!mainWindow) return [0, 0];
    return mainWindow.getPosition();
  });
  ipcMain.handle('window-set-position', (_, x, y) => {
    if (!mainWindow) return;
    mainWindow.setPosition(Math.round(x), Math.round(y));
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
    } catch (_e) { return null; }
  });

  ipcMain.handle('agent-exec-js', async (event, webContentsId, code) => {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(webContentsId);
      if (!wc) return { error: 'webview not found' };
      const result = await wc.executeJavaScript(code);
      return { result };
    } catch (e) { return { error: e.message }; }
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
    } catch (_e) {
      return null;
    }
  });

  ipcMain.handle('save-auth-token', async (event, token) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const encrypted = safeStorage.encryptString(token);
      fs.writeFileSync(secureAuthPath, encrypted);
    } catch (_e) { /* no-op */ }
  });

  ipcMain.handle('delete-auth-token', async () => {
    try {
      if (fs.existsSync(secureAuthPath)) fs.unlinkSync(secureAuthPath);
    } catch (_e) { /* no-op */ }
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
  stopStaticServer();
  app.quit();
});

app.on('before-quit', () => {
  stopStaticServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
