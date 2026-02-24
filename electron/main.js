const { app, BrowserWindow, Menu, ipcMain, session, safeStorage, dialog, webContents, net } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Extracted subsystem modules ──
const adblock = require('./adblock');
const ytAdstrip = require('./youtube-adstrip');
const { getYouTubeContentScript } = require('./youtube-content-script');
const privacy = require('./privacy');
const favicon = require('./favicon');
const staticServer = require('./static-server');

app.setName('NetRun');

// ── Core tool system (TypeScript) ──
let _coreInitialized = false;

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

// Suppress benign ERR_ABORTED from webview navigations
process.on('uncaughtException', (err) => {
  if (err && err.code === 'ERR_ABORTED') return;
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  if (reason && (reason.code === 'ERR_ABORTED' || (reason.message && reason.message.includes('ERR_ABORTED')))) return;
  console.error('Unhandled rejection:', reason);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function getDataDir() {
  if (isDev) return path.join(__dirname, '..', 'src');
  return app.getPath('userData');
}

function getStaticDir() {
  if (isDev) return path.join(__dirname, '..', 'src');
  return path.join(process.resourcesPath, 'src');
}

// ── Window state persistence ──
function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf8');
    const state = JSON.parse(data);

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
      return { width: state.width || 1400, height: state.height || 900, x: undefined, y: undefined };
    }

    lastSavedBounds = { ...state };
    return state;
  } catch (_e) {
    return { width: 1400, height: 900, x: undefined, y: undefined };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen()) return;

  try {
    const bounds = mainWindow.getBounds();
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
  await staticServer.killProcessOnPort(PREFERRED_PORT);

  let retries = 0;
  const maxRetries = 30;

  while (retries < maxRetries) {
    try {
      serverPort = await staticServer.startStaticServer(PREFERRED_PORT, getStaticDir(), getDataDir());
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/')) {
      return { action: 'allow' };
    }
    mainWindow.webContents.send('open-in-browse', url);
    return { action: 'deny' };
  });

  // Handle keyboard shortcuts for browse view
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
      } else if (input.key.toLowerCase() === 'r' && input.shift) {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'force-reload');
      } else if (input.key.toLowerCase() === 'r') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'reload');
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
  // WebRTC IP leak prevention — apply to ALL web contents
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');

  if (contents.getType && contents.getType() === 'webview') {
    contents.setMaxListeners(20);
    const ses = contents.session;
    // ── YouTube content script (DOM safety net: skip buttons + popup dismissal) ──
    contents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame || !adblock.isEnabled()) return;
      if (!ytAdstrip.isYouTubeDomain(url)) return;
      contents.executeJavaScript(getYouTubeContentScript()).catch(() => {});
    });

    if (!sessionsWithAdblock.has(ses)) {
      sessionsWithAdblock.add(ses);

      // ── YouTube ad stripping via protocol-level response interception ──
      // Registered once per session, intercepts ALL YouTube API responses and pages
      // before page JS ever sees them. Must be registered before any navigation.
      if (adblock.isEnabled()) {
        ytAdstrip.registerProtocolInterceptor(ses);
      }

      // ── Ad block request interceptor ──
      ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
        const url = details.url;
        const wcId = details.webContentsId;

        // 1. HTTPS-Only + Tracking param strip (privacy module)
        const privacyAction = privacy.handleBeforeRequest(details);
        if (privacyAction) return cb(privacyAction);

        // 2. Ad blocking
        if (!adblock.isEnabled()) return cb({});

        // YouTube ad URL patterns — block universally
        for (let i = 0; i < ytAdstrip.YT_AD_URL_PATTERNS.length; i++) {
          if (url.includes(ytAdstrip.YT_AD_URL_PATTERNS[i])) {
            const counts = adblock.getBlockedCounts();
            counts[wcId] = (counts[wcId] || 0) + 1;
            try { adblock._trackDetail(adblock.getBlockedDetails(), wcId, new URL(url).hostname); } catch {}
            return cb({ cancel: true });
          }
        }

        const engine = adblock.getEngine();
        if (!engine) return cb({});
        const type = adblock._mapResourceType(details.resourceType);
        try {
          const result = engine.check(details.url, details.referrer || details.url, type);
          if (result.matched) {
            const counts = adblock.getBlockedCounts();
            counts[wcId] = (counts[wcId] || 0) + 1;
            try { adblock._trackDetail(adblock.getBlockedDetails(), wcId, new URL(url).hostname); } catch {}
            return cb({ cancel: true });
          }
        } catch {}
        cb({});
      });

      // ── Third-party cookie blocking ──
      ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
        const result = privacy.handleHeadersReceived(details);
        if (result) return cb(result);
        cb({});
      });
    }

    // Intercept Cmd+click / target=_blank in webviews
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
          if (parent) parent.webContents.send('browse-command', 'reopen-tab');
        } else if (key === 't') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'new-tab');
        } else if (key === 'w') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'close-tab');
        } else if (key === 'o') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'open-file');
        } else if (key === 'p') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'print');
        } else if (key === 'r' && input.shift) {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'force-reload');
        } else if (key === 'r') {
          event.preventDefault();
          const parent = contents.getOwnerBrowserWindow();
          if (parent) parent.webContents.send('browse-command', 'reload');
        }
      }
    });

    // Handle downloads from webviews
    const session = contents.session;
    if (!sessionsWithDownloadHandlers.has(session)) {
      sessionsWithDownloadHandlers.add(session);

      session.on('will-download', (event, item, webContents) => {
      try {
        if (!webContents || webContents.isDestroyed()) return;

        const parent = webContents.getOwnerBrowserWindow();
        if (!parent) return;

        const downloadId = Date.now().toString();
        const filename = item.getFilename();
        const totalBytes = item.getTotalBytes();
        const parentId = parent.id;

        const safeSend = (channel, data) => {
          try {
            const win = BrowserWindow.fromId(parentId);
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
              win.webContents.send(channel, data);
            }
          } catch (_e) {}
        };

        safeSend('download-started', {
          id: downloadId,
          filename: filename,
          url: item.getURL(),
          totalBytes: totalBytes
        });

        item.on('updated', (event, state) => {
          if (state === 'progressing') {
            safeSend('download-progress', {
              id: downloadId,
              receivedBytes: item.getReceivedBytes(),
              totalBytes: item.getTotalBytes()
            });
          }
        });

        item.once('done', (event, state) => {
          try {
            const savePath = item.getSavePath();
            safeSend('download-completed', {
              id: downloadId,
              state: state,
              savePath: savePath
            });
          } catch (_e) {}
        });
      } catch (_e) {}
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
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send('browse-command', 'reload');
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send('browse-command', 'force-reload');
          }
        },
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

  // Initialize core tool system
  process.env.ARXIV_DATA_DIR = getDataDir();
  try {
    const { initCore } = require('../dist/main/init.js');
    initCore();
    _coreInitialized = true;
  } catch (err) {
    console.warn('[core] Could not initialize core system (build may be needed):', err.message);
  }

  createMenu();

  // Initialize favicon cache directory
  favicon.init(app.getPath('userData'));

  // ── Ad block IPC handlers ──
  const blockedCounts = adblock.getBlockedCounts();
  const blockedDetails = adblock.getBlockedDetails();
  ipcMain.handle('adblock-get-count', (_, wcId) => blockedCounts[wcId] || 0);
  ipcMain.handle('adblock-reset-count', (_, wcId) => { blockedCounts[wcId] = 0; delete blockedDetails[wcId]; });
  ipcMain.handle('adblock-set-enabled', (_, on) => { adblock.setEnabled(on); });
  ipcMain.handle('adblock-cosmetic', (_, url) => {
    const engine = adblock.getEngine();
    if (!engine) return { selectors: [] };
    try {
      const res = engine.urlCosmeticResources(url);
      return { selectors: res.hiddenClassIdSelectors || [] };
    } catch { return { selectors: [] }; }
  });
  ipcMain.handle('adblock-update', async () => {
    await adblock._downloadAndBuildEngine(app);
    return adblock._getEngineStats(app);
  });
  ipcMain.handle('adblock-stats', () => adblock._getEngineStats(app));

  adblock.initAdblock(app);

  // ── Permission request handler ──
  const _ELECTRON_PERM_MAP = {
    'media': null,
    'geolocation': 'location',
    'notifications': 'notifications',
    'fullscreen': null,
    'pointerLock': null,
    'openExternal': null,
  };
  let _permRequestId = 0;
  const _pendingPermRequests = new Map();

  ipcMain.handle('permission-response', (_, requestId, granted) => {
    const resolve = _pendingPermRequests.get(requestId);
    if (resolve) {
      _pendingPermRequests.delete(requestId);
      resolve(granted);
    }
  });

  session.defaultSession.setPermissionRequestHandler((webContentsObj, permission, callback, details) => {
    if (permission === 'fullscreen' || permission === 'pointerLock') return callback(true);
    if (permission === 'openExternal') return callback(false);

    // Auto-grant media permissions for the app's own renderer
    if (permission === 'media' && mainWindow && !mainWindow.isDestroyed() && webContentsObj === mainWindow.webContents) {
      return callback(true);
    }

    let permKey;
    if (permission === 'media') {
      const types = details?.mediaTypes || [];
      if (types.includes('video')) permKey = 'camera';
      else if (types.includes('audio')) permKey = 'microphone';
      else permKey = 'camera';
    } else {
      permKey = _ELECTRON_PERM_MAP[permission];
    }
    if (!permKey) return callback(false);

    let domain = '';
    try {
      const url = details?.requestingUrl || webContentsObj.getURL();
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {}
    if (!domain) return callback(false);

    if (!mainWindow || mainWindow.isDestroyed()) return callback(false);
    const requestId = ++_permRequestId;
    _pendingPermRequests.set(requestId, (granted) => callback(granted));
    mainWindow.webContents.send('permission-request', { requestId, domain, permKey });

    setTimeout(() => {
      if (_pendingPermRequests.has(requestId)) {
        _pendingPermRequests.delete(requestId);
        callback(false);
      }
    }, 60000);
  });

  session.defaultSession.setPermissionCheckHandler((webContentsObj, permission, _requestingOrigin, details) => {
    if (permission === 'fullscreen' || permission === 'pointerLock') return true;
    if (permission === 'openExternal') return false;

    // Allow media permissions for the app's own renderer (main window)
    if (permission === 'media') {
      if (mainWindow && !mainWindow.isDestroyed() && webContentsObj === mainWindow.webContents) {
        return true;
      }
      const origin = _requestingOrigin || '';
      if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
        return true;
      }
    }

    let permKey;
    if (permission === 'media') {
      const type = details?.mediaType;
      if (type === 'video') permKey = 'camera';
      else if (type === 'audio') permKey = 'microphone';
      else return false;
    } else {
      permKey = _ELECTRON_PERM_MAP[permission];
    }
    if (!permKey) return false;
    return false;
  });

  // ── DoH (encrypted DNS) ──
  privacy.applyDoH(app, true, 'cloudflare');
  ipcMain.handle('doh-set-config', (_, enabled, provider) => privacy.applyDoH(app, !!enabled, provider || 'cloudflare'));

  // ── Tracking Parameter Stripping IPC ──
  ipcMain.handle('tracking-strip-get-count', (_, wcId) => privacy.getStrippedCount(wcId));
  ipcMain.handle('tracking-strip-reset-count', (_, wcId) => { privacy.resetStrippedCount(wcId); });
  ipcMain.handle('tracking-strip-set-enabled', (_, on) => { privacy.setTrackingStripEnabled(on); });

  // ── HTTPS-Only Mode IPC ──
  ipcMain.handle('https-only-get-count', (_, wcId) => privacy.getHttpsUpgradeCount(wcId));
  ipcMain.handle('https-only-reset-count', (_, wcId) => { privacy.resetHttpsUpgradeCount(wcId); });
  ipcMain.handle('https-only-set-enabled', (_, on) => { privacy.setHttpsOnlyEnabled(on); });

  // ── Third-Party Cookie Blocking IPC ──
  ipcMain.handle('cookie-block-get-count', (_, wcId) => privacy.getCookieBlockedCount(wcId));
  ipcMain.handle('cookie-block-reset-count', (_, wcId) => { privacy.resetCookieBlockedCount(wcId); });
  ipcMain.handle('cookie-block-set-enabled', (_, on) => { privacy.setCookieBlockEnabled(on); });

  // ── Privacy details (per-tab breakdown) ──
  ipcMain.handle('privacy-details', (_, wcId) => {
    const privDetails = privacy.getPrivacyDetails(wcId);
    return {
      ads: blockedDetails[wcId] || {},
      trackers: privDetails.trackers,
      cookies: privDetails.cookies,
    };
  });

  // ── Aggregate privacy stats ──
  ipcMain.handle('privacy-stats', () => {
    let ads = 0;
    for (const k in blockedCounts) ads += blockedCounts[k] || 0;
    const privStats = privacy.getPrivacyStats();
    return { ads, stripped: privStats.stripped, upgraded: privStats.upgraded, cookies: privStats.cookies };
  });

  ipcMain.handle('print', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    return new Promise((resolve) => {
      win.webContents.print({ printBackground: true, ...options }, (success) => {
        resolve(success);
      });
    });
  });

  // Window drag
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

  ipcMain.handle('copy-image-to-clipboard', async (_event, url) => {
    try {
      const { clipboard, nativeImage } = require('electron');
      const { net } = require('electron');
      const resp = await net.fetch(url, { bypassCustomProtocolHandlers: false });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const buf = Buffer.from(await resp.arrayBuffer());
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return { error: 'Could not decode image' };
      clipboard.writeImage(img);
      return { ok: true };
    } catch (e) { return { error: e.message || String(e) }; }
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
    } catch (_e) {}
  });

  ipcMain.handle('delete-auth-token', async () => {
    try {
      if (fs.existsSync(secureAuthPath)) fs.unlinkSync(secureAuthPath);
    } catch (_e) {}
  });

  // ── Encrypted API key storage (safeStorage) ──
  const secureApiKeyPath = path.join(app.getPath('userData'), 'api-keys.enc');

  function _getEncryptedApiKey(provider) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(secureApiKeyPath)) return null;
      const encrypted = fs.readFileSync(secureApiKeyPath);
      const json = JSON.parse(safeStorage.decryptString(encrypted));
      return json[provider] || null;
    } catch { return null; }
  }

  function _setEncryptedApiKey(provider, key) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      let json = {};
      if (fs.existsSync(secureApiKeyPath)) {
        try {
          const encrypted = fs.readFileSync(secureApiKeyPath);
          json = JSON.parse(safeStorage.decryptString(encrypted));
        } catch { json = {}; }
      }
      if (key) { json[provider] = key; } else { delete json[provider]; }
      const encrypted = safeStorage.encryptString(JSON.stringify(json));
      fs.writeFileSync(secureApiKeyPath, encrypted);
    } catch {}
  }

  ipcMain.handle('get-api-key-secure', (_, provider) => _getEncryptedApiKey(provider));
  ipcMain.handle('set-api-key-secure', (_, provider, key) => { _setEncryptedApiKey(provider, key); });

  // Migrate plaintext OpenRouter key from DB to encrypted storage on startup
  if (_coreInitialized) {
    try {
      const { getSetting, deleteSetting } = require('../dist/main/db/queries/settings.js');
      const existing = getSetting('openrouterApiKey');
      if (existing && existing.value) {
        const alreadySecure = _getEncryptedApiKey('openrouter');
        if (!alreadySecure) {
          _setEncryptedApiKey('openrouter', existing.value);
        }
        deleteSetting('openrouterApiKey');
      }
      const secureKey = _getEncryptedApiKey('openrouter');
      if (secureKey) {
        const { openrouterProvider } = require('../dist/main/ipc/shared.js');
        openrouterProvider.setApiKey(secureKey);
      }
    } catch (_e) {}
  }

  let _stashedGoogleCookies = null;

  ipcMain.handle('stash-google-cookies', async () => {
    const ses = session.defaultSession;
    _stashedGoogleCookies = await ses.cookies.get({ domain: '.google.com' });
    for (const cookie of _stashedGoogleCookies) {
      const proto = cookie.secure ? 'https' : 'http';
      const url = `${proto}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      await ses.cookies.remove(url, cookie.name);
    }
  });

  ipcMain.handle('restore-google-cookies', async () => {
    if (!_stashedGoogleCookies) return;
    const ses = session.defaultSession;
    for (const cookie of _stashedGoogleCookies) {
      const details = {
        url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || 'unspecified',
      };
      if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      try { await ses.cookies.set(details); } catch (_e) {}
    }
    _stashedGoogleCookies = null;
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
    const { shell } = require('electron');
    const dir = path.join(os.tmpdir(), 'netrun-uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return shell.openPath(filePath);
  });

  ipcMain.handle('show-save-dialog', async (_, options) => {
    const result = await dialog.showSaveDialog(options || {});
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('show-open-dialog-multi', async (_, options) => {
    const opts = { properties: ['openFile', 'multiSelections'], ...(options || {}) };
    const result = await dialog.showOpenDialog(opts);
    if (result.canceled) return [];
    return result.filePaths;
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
  staticServer.stopStaticServer();
  app.quit();
});

app.on('before-quit', () => {
  staticServer.stopStaticServer();
  if (_coreInitialized) {
    try {
      const { contextIntake, closeDb } = require('../dist/main/init.js');
      contextIntake.shutdown();
      closeDb();
    } catch (_e) {}
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
