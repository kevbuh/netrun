/**
 * Kernel Manager — spawns and manages the Python kernel_bridge.py subprocess.
 * Provides async methods for execute, restart, interrupt, kill kernel operations.
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

interface KernelRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class KernelManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private pendingRequests = new Map<string, KernelRequest>();
  private reqCounter = 0;
  private startPromise: Promise<void> | null = null;

  private getPythonPath(): string {
    // Dev: use venv python; Prod: use bundled python
    const venvPython = path.resolve(__dirname, '..', '..', 'venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  private getBridgePath(): string {
    const devPath = path.resolve(__dirname, '..', '..', 'src', 'kernel_bridge.py');
    if (fs.existsSync(devPath)) return devPath;
    // Prod: bundled with resources
    return path.resolve(process.resourcesPath ?? __dirname, 'src', 'kernel_bridge.py');
  }

  /** Start the bridge process if not already running */
  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc && !this.proc.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const pythonPath = this.getPythonPath();
      const bridgePath = this.getBridgePath();

      if (!fs.existsSync(bridgePath)) {
        reject(new Error(`Kernel bridge not found: ${bridgePath}`));
        return;
      }

      this.proc = spawn(pythonPath, [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.rl = readline.createInterface({ input: this.proc.stdout! });

      this.rl.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'ready') {
            this.ready = true;
            resolve();
            return;
          }
          const reqId = msg.id;
          if (reqId && this.pendingRequests.has(reqId)) {
            if (msg.event === 'done') {
              this.pendingRequests.get(reqId)!.resolve(msg.data ?? { ok: true });
              this.pendingRequests.delete(reqId);
            } else if (msg.event === 'error') {
              this.pendingRequests.get(reqId)!.reject(new Error(msg.error));
              this.pendingRequests.delete(reqId);
            } else if (msg.event === 'output') {
              // Streaming output — emit event for IPC forwarding
              this.emit('kernel:output', reqId, msg.data);
            }
          }
        } catch { /* ignore parse errors */ }
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[kernel-bridge] ${data.toString().trim()}`);
      });

      this.proc.on('exit', (code) => {
        console.log(`[kernel-bridge] exited with code ${code}`);
        this.ready = false;
        this.proc = null;
        this.startPromise = null;
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error('Kernel bridge process exited'));
        }
        this.pendingRequests.clear();
      });

      // Timeout for startup
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error('Kernel bridge startup timeout'));
          this.kill();
        }
      }, 30_000);
    });

    return this.startPromise;
  }

  private nextId(): string {
    return `kr-${++this.reqCounter}-${Date.now()}`;
  }

  private send(msg: Record<string, any>): void {
    if (!this.proc || this.proc.killed) throw new Error('Kernel bridge not running');
    this.proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  /** Execute code in a kernel. Returns a promise that resolves when execution completes.
   * Output events are emitted as 'kernel:output' events during execution. */
  async execute(projectDir: string, code: string): Promise<{ ok: true }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'execute', project_dir: projectDir, code, id });
    });
  }

  /** Restart the kernel for a project */
  async restart(projectDir: string): Promise<{ ok: true }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'restart', project_dir: projectDir, id });
    });
  }

  /** Interrupt the running kernel */
  async interrupt(projectDir: string): Promise<{ ok: true }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'interrupt', project_dir: projectDir, id });
    });
  }

  /** Kill the kernel for a project */
  async killKernel(projectDir: string): Promise<{ ok: true }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'kill', project_dir: projectDir, id });
    });
  }

  /** Shutdown the bridge process entirely */
  async shutdown(): Promise<void> {
    if (!this.proc || this.proc.killed) return;
    const id = this.nextId();
    try {
      this.send({ cmd: 'shutdown', id });
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { this.kill(); resolve(); }, 5000);
        this.proc!.on('exit', () => { clearTimeout(timeout); resolve(); });
      });
    } catch {
      this.kill();
    }
  }

  /** Force kill the bridge process */
  kill(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGKILL');
    }
    this.proc = null;
    this.ready = false;
    this.startPromise = null;
  }
}

// Singleton instance
export const kernelManager = new KernelManager();
