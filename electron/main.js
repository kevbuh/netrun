const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');

app.setName('Aether');

let pythonProcess = null;
let mainWindow = null;
let serverPort = null;

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

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
    cmd = 'python3';
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

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
      } else if (input.key.toLowerCase() === 'p') {
        event.preventDefault();
        mainWindow.webContents.send('browse-command', 'print');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Track sessions that already have download handlers to prevent duplicates
const sessionsWithDownloadHandlers = new WeakSet();

// Handle keyboard shortcuts in all web contents (including webviews)
app.on('web-contents-created', (event, contents) => {
  // Only handle webviews (they have a different type of webContents)
  if (contents.getType && contents.getType() === 'webview') {
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

  ipcMain.handle('capture-screen', async (event, rect) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height)
    });
    return image.toPNG().toString('base64');
  });

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
