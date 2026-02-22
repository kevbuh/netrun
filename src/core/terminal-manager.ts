/**
 * Terminal Manager — manages PTY sessions via node-pty.
 * Replaces the Python terminal_server.py WebSocket bridge.
 */
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

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

/** Commands allowed inside the sandbox */
const SANDBOX_ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'less', 'grep', 'find', 'wc', 'file', 'stat',
  'date', 'echo', 'pwd', 'sort', 'uniq', 'diff', 'tr', 'cut',
  'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod',
  'python3', 'node', 'opencode',
];

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

  /** Start a sandboxed terminal in an isolated directory with restricted bash. */
  startSandboxed(): string {
    if (!pty) throw new Error('node-pty not available');

    const home = process.env.HOME || '/tmp';
    const netrunDir = path.join(home, '.netrun');
    const sandboxDir = path.join(netrunDir, 'sandbox');
    const binDir = path.join(netrunDir, '.sandbox-bin');

    // Create sandbox directory (fresh each session)
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sandboxDir, { recursive: true });

    // Create restricted PATH directory with symlinks to allowed commands
    if (fs.existsSync(binDir)) {
      fs.rmSync(binDir, { recursive: true, force: true });
    }
    fs.mkdirSync(binDir, { recursive: true });

    for (const cmd of SANDBOX_ALLOWED_COMMANDS) {
      // Find the real path of each command
      const searchPaths = ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.opencode/bin')];
      for (const dir of searchPaths) {
        const fullPath = path.join(dir, cmd);
        if (fs.existsSync(fullPath)) {
          const linkPath = path.join(binDir, cmd);
          try { fs.symlinkSync(fullPath, linkPath); } catch { /* already exists */ }
          break;
        }
      }
    }

    const id = `term-${++this.idCounter}-${Date.now()}`;

    // Minimal safe environment
    const env: Record<string, string> = {
      TERM: 'xterm-256color',
      HOME: sandboxDir,
      PATH: binDir,
      LANG: process.env.LANG || 'en_US.UTF-8',
      USER: process.env.USER || 'sandbox',
    };

    const ptyProcess = pty.spawn('/bin/bash', ['--restricted', '--noprofile', '--norc'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: sandboxDir,
      env,
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
