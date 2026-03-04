import { ipcMain, BrowserWindow } from 'electron';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

let kernelProc: cp.ChildProcess | null = null;
let rl: readline.Interface | null = null;

function getScriptPath(): string {
  const compiled = path.join(__dirname, '..', '..', 'core', 'python', 'notebook-kernel.py');
  if (fs.existsSync(compiled)) return compiled;
  const devPath = path.join(__dirname, '..', '..', '..', 'src', 'core', 'python', 'notebook-kernel.py');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.cwd(), 'src', 'core', 'python', 'notebook-kernel.py');
}

function sendToKernel(cmd: Record<string, unknown>): void {
  if (!kernelProc || !kernelProc.stdin || kernelProc.killed) {
    throw new Error('Kernel process not running');
  }
  kernelProc.stdin.write(JSON.stringify(cmd) + '\n');
}

function ensureProcess(webContents: Electron.WebContents): void {
  if (kernelProc && !kernelProc.killed) return;

  const scriptPath = getScriptPath();
  kernelProc = cp.spawn('python3', [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  kernelProc.stderr!.on('data', (data: Buffer) => {
    console.error('[notebook-kernel]', data.toString().trim());
  });

  kernelProc.on('close', (code) => {
    console.log('[notebook-kernel] process exited with code', code);
    kernelProc = null;
    rl = null;
  });

  kernelProc.on('error', (err) => {
    console.error('[notebook-kernel] spawn error:', err.message);
    kernelProc = null;
    rl = null;
  });

  // Read stdout line by line and forward events to renderer
  rl = readline.createInterface({ input: kernelProc.stdout!, crlfDelay: Infinity });
  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      forwardEvent(event, webContents);
    } catch {
      console.error('[notebook-kernel] invalid JSON:', line.slice(0, 200));
    }
  });
}

function forwardEvent(event: any, webContents: Electron.WebContents): void {
  if (webContents.isDestroyed()) return;

  const sessionId = event.id || '';
  const cellId = event.cell_id || '';

  switch (event.event) {
    case 'kernel_ready':
      // Handled by the IPC return value
      break;
    case 'status':
      webContents.send('notebook:status', { sessionId, state: event.state });
      break;
    case 'stream':
      webContents.send('notebook:output', {
        sessionId, cellId, event: 'stream',
        name: event.name, text: event.text
      });
      break;
    case 'execute_result':
      webContents.send('notebook:output', {
        sessionId, cellId, event: 'execute_result',
        data: event.data, executionCount: event.execution_count
      });
      break;
    case 'display_data':
      webContents.send('notebook:output', {
        sessionId, cellId, event: 'display_data',
        data: event.data
      });
      break;
    case 'error':
      webContents.send('notebook:output', {
        sessionId, cellId, event: 'error',
        ename: event.ename, evalue: event.evalue, traceback: event.traceback
      });
      break;
    case 'execute_complete':
      webContents.send('notebook:execute-complete', {
        sessionId, cellId, executionCount: event.execution_count
      });
      break;
    case 'complete_reply':
      // Handled via pending promise
      break;
  }
}

// Pending completion promises
const pendingCompletions: Map<string, (matches: string[]) => void> = new Map();

export function registerNotebookIPC(): void {

  ipcMain.handle('notebook:start-kernel', async (event, sessionId: string) => {
    try {
      ensureProcess(event.sender);
      sendToKernel({ cmd: 'start', id: sessionId });
      // Wait for kernel_ready event
      return await new Promise<{ ok: boolean }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Kernel start timeout')), 30000);
        const checkLine = (line: string) => {
          try {
            const ev = JSON.parse(line);
            if (ev.event === 'kernel_ready' && ev.id === sessionId) {
              clearTimeout(timeout);
              rl?.removeListener('line', checkLine);
              resolve({ ok: true });
            } else if (ev.event === 'error' && ev.id === sessionId && !ev.cell_id) {
              clearTimeout(timeout);
              rl?.removeListener('line', checkLine);
              reject(new Error(ev.evalue || 'Kernel start failed'));
            }
          } catch { /* ignore parse errors */ }
        };
        rl?.on('line', checkLine);
      });
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('notebook:execute', async (event, sessionId: string, code: string, cellId: string) => {
    try {
      ensureProcess(event.sender);
      sendToKernel({ cmd: 'execute', id: sessionId, code, cell_id: cellId });
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('notebook:interrupt', async (_event, sessionId: string) => {
    try {
      sendToKernel({ cmd: 'interrupt', id: sessionId });
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('notebook:restart', async (event, sessionId: string) => {
    try {
      ensureProcess(event.sender);
      sendToKernel({ cmd: 'restart', id: sessionId });
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('notebook:shutdown', async (_event, sessionId: string) => {
    try {
      sendToKernel({ cmd: 'shutdown', id: sessionId });
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('notebook:complete', async (_event, sessionId: string, code: string, cursor: number) => {
    try {
      sendToKernel({ cmd: 'complete', id: sessionId, code, cursor });
      // Wait for complete_reply
      return await new Promise<{ matches: string[] }>((resolve) => {
        const timeout = setTimeout(() => resolve({ matches: [] }), 5000);
        const checkLine = (line: string) => {
          try {
            const ev = JSON.parse(line);
            if (ev.event === 'complete_reply' && ev.id === sessionId) {
              clearTimeout(timeout);
              rl?.removeListener('line', checkLine);
              resolve({ matches: ev.matches || [] });
            }
          } catch { /* ignore */ }
        };
        rl?.on('line', checkLine);
      });
    } catch (e: any) {
      return { matches: [] };
    }
  });
}

// Cleanup: kill kernel process on app quit
process.on('exit', () => {
  if (kernelProc && !kernelProc.killed) {
    kernelProc.kill();
  }
});
