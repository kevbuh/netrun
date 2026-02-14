/**
 * Terminal Manager — manages PTY sessions via node-pty.
 * Replaces the Python terminal_server.py WebSocket bridge.
 */
import { EventEmitter } from 'events';

// node-pty is a native module — require at runtime
let pty: any;
try {
  pty = require('node-pty');
} catch {
  console.warn('[terminal-manager] node-pty not available');
}

interface TerminalSession {
  id: string;
  ptyProcess: any;
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();
  private idCounter = 0;

  /** Start a new terminal session. Returns the session ID. */
  start(cwd?: string): string {
    if (!pty) throw new Error('node-pty not available');

    const id = `term-${++this.idCounter}-${Date.now()}`;
    const shell = process.env.SHELL || '/bin/zsh';

    const ptyProcess = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.env.HOME || '/',
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const session: TerminalSession = { id, ptyProcess };
    this.sessions.set(id, session);

    ptyProcess.onData((data: string) => {
      this.emit('terminal:output', id, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.emit('terminal:exit', id, exitCode);
      this.sessions.delete(id);
    });

    return id;
  }

  /** Send input data to a terminal session */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.ptyProcess.write(data);
  }

  /** Resize a terminal session */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try { session.ptyProcess.resize(cols, rows); } catch { /* ignore */ }
  }

  /** Kill a terminal session */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try { session.ptyProcess.kill(); } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  /** Kill all sessions (for app shutdown) */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

// Singleton instance
export const terminalManager = new TerminalManager();
