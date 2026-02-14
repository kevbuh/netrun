/**
 * Neuralook Manager — spawns and manages the Python neuralook_service.py subprocess.
 * Provides async methods for train, predict, reset-hidden, auto-refine operations.
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

interface NeuralookRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class NeuralookManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private pendingRequests = new Map<string, NeuralookRequest>();
  private reqCounter = 0;
  private startPromise: Promise<void> | null = null;

  private getPythonPath(): string {
    const venvPython = path.resolve(__dirname, '..', '..', 'venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  private getServicePath(): string {
    const devPath = path.resolve(__dirname, '..', '..', 'src', 'neuralook_service.py');
    if (fs.existsSync(devPath)) return devPath;
    return path.resolve(process.resourcesPath ?? __dirname, 'src', 'neuralook_service.py');
  }

  /** Start the service process if not already running */
  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc && !this.proc.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const pythonPath = this.getPythonPath();
      const servicePath = this.getServicePath();

      if (!fs.existsSync(servicePath)) {
        reject(new Error(`Neuralook service not found: ${servicePath}`));
        return;
      }

      this.proc = spawn(pythonPath, [servicePath], {
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
            } else if (msg.event === 'progress') {
              // Streaming training progress — emit event for IPC forwarding
              this.emit('neuralook:progress', reqId, msg.data);
            }
          }
        } catch { /* ignore parse errors */ }
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[neuralook-service] ${data.toString().trim()}`);
      });

      this.proc.on('exit', (code) => {
        console.log(`[neuralook-service] exited with code ${code}`);
        this.ready = false;
        this.proc = null;
        this.startPromise = null;
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error('Neuralook service process exited'));
        }
        this.pendingRequests.clear();
      });

      // Timeout for startup
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error('Neuralook service startup timeout'));
          this.kill();
        }
      }, 30_000);
    });

    return this.startPromise;
  }

  private nextId(): string {
    return `nl-${++this.reqCounter}-${Date.now()}`;
  }

  private send(msg: Record<string, any>): void {
    if (!this.proc || this.proc.killed) throw new Error('Neuralook service not running');
    this.proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  /** Train the gaze model. Returns training results. Progress events emitted as 'neuralook:progress'. */
  async train(body: Record<string, any>): Promise<any> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'train', id, ...body });
    });
  }

  /** Predict gaze point */
  async predict(body: Record<string, any>): Promise<any> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'predict', id, ...body });
    });
  }

  /** Reset hidden state for a method */
  async resetHidden(method: string): Promise<any> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'reset-hidden', id, method });
    });
  }

  /** Auto-refine with implicit samples */
  async autoRefine(body: Record<string, any>): Promise<any> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'auto-refine', id, ...body });
    });
  }

  /** Shutdown the service process */
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

  /** Force kill the service process */
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
export const neuralookManager = new NeuralookManager();
