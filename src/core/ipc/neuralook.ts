import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './shared.js';

export function registerNeuralookIPC(): void {
  ipcMain.handle('db:neuralook-save-calibration', (_event, body: Record<string, any>) => {
    try {
      const calibPath = path.join(DATA_DIR, 'neuralook_calibration.json');
      fs.writeFileSync(calibPath, JSON.stringify(body, null, 2));
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-implicit-samples', (_event, method: string, body?: Record<string, any>) => {
    const implPath = path.join(DATA_DIR, 'neuralook_implicit.json');
    if (!body) {
      try {
        if (!fs.existsSync(implPath)) return [];
        return JSON.parse(fs.readFileSync(implPath, 'utf-8'));
      } catch { return []; }
    }
    try {
      let existing: any[] = [];
      if (fs.existsSync(implPath)) {
        try { existing = JSON.parse(fs.readFileSync(implPath, 'utf-8')); } catch {}
      }
      const newSamples = body.samples ?? [];
      existing.push(...newSamples);
      fs.writeFileSync(implPath, JSON.stringify(existing));
      return { ok: true, count: existing.length };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-refine-history', (_event) => {
    try {
      const histPath = path.join(DATA_DIR, 'neuralook_refine_history.json');
      if (!fs.existsSync(histPath)) return [];
      return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
    } catch { return []; }
  });

  // Python subprocess endpoints (via neuralook-manager)

  const { neuralookManager } = require('../neuralook-manager.js') as typeof import('../neuralook-manager.js');

  ipcMain.handle('db:neuralook-train', async (event, body: Record<string, any>, stream = false) => {
    try {
      if (stream) {
        const webContents = event.sender;
        const sessionId = `nl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const onProgress = (_reqId: string, data: any) => {
          if (!webContents.isDestroyed()) {
            webContents.send('neuralook:progress', sessionId, data);
          }
        };

        neuralookManager.on('neuralook:progress', onProgress);

        (async () => {
          try {
            const result = await neuralookManager.train(body);
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:done', sessionId, result);
            }
          } catch (err: any) {
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:error', sessionId, err.message ?? String(err));
            }
          } finally {
            neuralookManager.removeListener('neuralook:progress', onProgress);
          }
        })();

        return { _stream: true, sessionId };
      }

      return await neuralookManager.train(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-predict', async (_event, body: Record<string, any>) => {
    try {
      return await neuralookManager.predict(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-reset-hidden', async (_event, method: string) => {
    try {
      return await neuralookManager.resetHidden(method);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:neuralook-auto-refine', async (event, body: Record<string, any>, stream = false) => {
    try {
      if (stream) {
        const webContents = event.sender;
        const sessionId = `nlr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const onProgress = (_reqId: string, data: any) => {
          if (!webContents.isDestroyed()) {
            webContents.send('neuralook:progress', sessionId, data);
          }
        };

        neuralookManager.on('neuralook:progress', onProgress);

        (async () => {
          try {
            const result = await neuralookManager.autoRefine(body);
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:done', sessionId, result);
            }
          } catch (err: any) {
            if (!webContents.isDestroyed()) {
              webContents.send('neuralook:error', sessionId, err.message ?? String(err));
            }
          } finally {
            neuralookManager.removeListener('neuralook:progress', onProgress);
          }
        })();

        return { _stream: true, sessionId };
      }

      return await neuralookManager.autoRefine(body);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
