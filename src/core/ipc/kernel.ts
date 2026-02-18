import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { uploadsDir, BINARY_MIME } from './shared.js';

export function registerKernelIPC(): void {
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
