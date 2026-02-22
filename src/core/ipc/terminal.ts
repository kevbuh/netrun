import { ipcMain } from 'electron';

export function registerTerminalIPC(): void {
  const { terminalManager } = require('../terminal-manager.js') as typeof import('../terminal-manager.js');
  const { transcribeChunk } = require('../captions-manager.js') as typeof import('../captions-manager.js');

  ipcMain.handle('terminal:start', (event, cwdOrOpts?: string | { cwd?: string; sandboxed?: boolean }) => {
    try {
      let sessionId: string;
      if (typeof cwdOrOpts === 'object' && cwdOrOpts?.sandboxed) {
        sessionId = terminalManager.startSandboxed();
      } else {
        const cwd = typeof cwdOrOpts === 'string' ? cwdOrOpts : cwdOrOpts?.cwd;
        sessionId = terminalManager.start(cwd);
      }
      const webContents = event.sender;

      const onOutput = (id: string, data: string) => {
        if (id === sessionId && !webContents.isDestroyed()) {
          webContents.send('terminal:output', sessionId, data);
        }
      };
      const onExit = (id: string, exitCode: number) => {
        if (id === sessionId && !webContents.isDestroyed()) {
          webContents.send('terminal:exit', sessionId, exitCode);
        }
        terminalManager.removeListener('terminal:output', onOutput);
        terminalManager.removeListener('terminal:exit', onExit);
      };

      terminalManager.on('terminal:output', onOutput);
      terminalManager.on('terminal:exit', onExit);

      return { sessionId };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('terminal:input', (_event, sessionId: string, data: string) => {
    terminalManager.write(sessionId, data);
  });

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_event, sessionId: string) => {
    terminalManager.kill(sessionId);
  });

  ipcMain.handle('captions:transcribe', async (_event, pcmBase64: string, sampleRate: number) => {
    try {
      const pcmBuffer = Buffer.from(pcmBase64, 'base64');
      const text = await transcribeChunk(pcmBuffer, sampleRate);
      if (text) return { text };
      return { text: null };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
