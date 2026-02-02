const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');

let pythonProcess = null;
let mainWindow = null;
let serverPort = null;

const isDev = !app.isPackaged;

const PREFERRED_PORT = 8000;

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
    return path.join(__dirname, '..', 'arxiv-filter');
  }
  return app.getPath('userData');
}

function getStaticDir() {
  if (isDev) {
    return path.join(__dirname, '..', 'arxiv-filter');
  }
  return path.join(process.resourcesPath, 'arxiv-filter');
}

function tryStartPythonServer(port) {
  const dataDir = getDataDir();
  const staticDir = getStaticDir();

  let cmd, args;
  if (isDev) {
    cmd = 'python3';
    args = [
      path.join(__dirname, '..', 'arxiv-filter', 'server.py'),
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

async function createWindow() {
  // Try preferred port first (matches Google OAuth authorized origin),
  // fall back to a random port if it's already in use
  try {
    serverPort = await tryStartPythonServer(PREFERRED_PORT);
  } catch (e) {
    console.log(`Port ${PREFERRED_PORT} failed, trying random port...`);
    const randomPort = await findFreePort();
    serverPort = await tryStartPythonServer(randomPort);
  }

  await waitForServer(serverPort);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
