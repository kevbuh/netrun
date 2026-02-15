/**
 * Parakeet Manager — spawns and manages the Python parakeet_service.py subprocess.
 * Provides async methods for speech-to-text transcription using NVIDIA Parakeet TDT.
 */
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class ParakeetManager {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private startPromise: Promise<void> | null = null;

  private getPythonPath(): string {
    const venvPython = path.resolve(__dirname, '..', '..', 'venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) return venvPython;
    return 'python3';
  }

  private getServicePath(): string {
    const devPath = path.resolve(__dirname, '..', '..', 'src', 'parakeet_service.py');
    if (fs.existsSync(devPath)) return devPath;
    return path.resolve(process.resourcesPath ?? __dirname, 'src', 'parakeet_service.py');
  }

  /** Start the service process if not already running */
  async ensureStarted(): Promise<void> {
    if (this.ready && this.proc && !this.proc.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      const pythonPath = this.getPythonPath();
      const servicePath = this.getServicePath();

      if (!fs.existsSync(servicePath)) {
        reject(new Error(`Parakeet service not found: ${servicePath}`));
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
            }
          }
        } catch { /* ignore parse errors */ }
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        console.error(`[parakeet-service] ${data.toString().trim()}`);
      });

      this.proc.on('exit', (code) => {
        console.log(`[parakeet-service] exited with code ${code}`);
        this.ready = false;
        this.proc = null;
        this.startPromise = null;
        for (const [, req] of this.pendingRequests) {
          req.reject(new Error('Parakeet service process exited'));
        }
        this.pendingRequests.clear();
      });

      // Model download on first use can take a while — generous timeout
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error('Parakeet service startup timeout'));
          this.kill();
        }
      }, 120_000);
    });

    return this.startPromise;
  }

  private nextId(): string {
    return `pk-${++this.reqCounter}-${Date.now()}`;
  }

  private send(msg: Record<string, any>): void {
    if (!this.proc || this.proc.killed) throw new Error('Parakeet service not running');
    this.proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  /** Transcribe an audio file. Returns { text, segments? }. */
  async transcribe(audioPath: string): Promise<{ text: string; segments?: Array<{ text: string; start: number; end: number }> }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'transcribe', id, path: audioPath });
    });
  }

  /** Transcribe raw PCM audio (float32, mono). Returns { text }. */
  async transcribePcm(pcmBase64: string, sampleRate: number): Promise<{ text: string }> {
    await this.ensureStarted();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ cmd: 'transcribe_pcm', id, pcm_base64: pcmBase64, sample_rate: sampleRate });
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
export const parakeetManager = new ParakeetManager();
