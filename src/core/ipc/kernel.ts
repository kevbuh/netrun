import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { resolveExpDir, uploadsDir, BINARY_MIME } from './shared.js';

export function registerKernelIPC(): void {
  const { kernelManager } = require('../kernel-manager.js') as typeof import('../kernel-manager.js');

  ipcMain.handle('db:kernel-execute', async (event, googleId: string, expId: string, code: string, stream = false) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };

    if (stream) {
      const webContents = event.sender;
      const sessionId = `ke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const onOutput = (reqId: string, data: any) => {
        if (!webContents.isDestroyed()) {
          webContents.send('kernel:output', sessionId, data);
        }
      };

      kernelManager.on('kernel:output', onOutput);

      (async () => {
        try {
          await kernelManager.execute(expDir, code);
          if (!webContents.isDestroyed()) {
            webContents.send('kernel:done', sessionId);
          }
        } catch (err: any) {
          if (!webContents.isDestroyed()) {
            webContents.send('kernel:error', sessionId, err.message ?? String(err));
          }
        } finally {
          kernelManager.removeListener('kernel:output', onOutput);
        }
      })();

      return { _stream: true, sessionId };
    }

    const outputs: any[] = [];
    const onOutput = (_reqId: string, data: any) => { outputs.push(data); };
    kernelManager.on('kernel:output', onOutput);
    try {
      await kernelManager.execute(expDir, code);
      return { outputs };
    } catch (e: any) {
      return { error: e.message ?? String(e) };
    } finally {
      kernelManager.removeListener('kernel:output', onOutput);
    }
  });

  ipcMain.handle('db:kernel-restart', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.restart(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:kernel-interrupt', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.interrupt(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:kernel-kill', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    try {
      await kernelManager.killKernel(expDir);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:serve-upload', (_event, filename: string) => {
    const safeName = path.basename(filename);
    const filepath = path.join(uploadsDir, safeName);
    if (!fs.existsSync(filepath)) return { error: 'Not found' };
    const ext = path.extname(safeName).toLowerCase();
    const mime = BINARY_MIME[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(filepath).toString('base64');
    return { _proxy: true, data, mime };
  });
}
