import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

/**
 * Manages Python child processes for ML/scientific tasks.
 * Uses stdin/stdout JSON protocol for communication.
 */
export class PythonProcessManager {
  private processes = new Map<string, ChildProcess>();
  private pythonPath: string;

  constructor(pythonPath?: string) {
    this.pythonPath = pythonPath ?? 'python3';
  }

  /**
   * Run a Python script with JSON input and get JSON output.
   * Spawns a one-shot child process.
   */
  async run(scriptPath: string, input: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 200)}`));
        }
      });

      proc.on('error', reject);

      // Send input as JSON to stdin
      proc.stdin!.write(JSON.stringify(input));
      proc.stdin!.end();
    });
  }

  /**
   * Run inline Python code with JSON output.
   */
  async runCode(code: string, args: string[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, ['-c', code, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python error: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          // Return raw string if not JSON
          resolve(stdout.trim());
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Start a long-running Python process (e.g., Jupyter kernel, TTS server).
   */
  startDaemon(name: string, scriptPath: string, args: string[] = []): ChildProcess {
    if (this.processes.has(name)) {
      this.stopDaemon(name);
    }

    const proc = spawn(this.pythonPath, [scriptPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.on('exit', () => {
      this.processes.delete(name);
    });

    this.processes.set(name, proc);
    return proc;
  }

  /** Stop a running daemon process */
  stopDaemon(name: string): void {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.processes.delete(name);
    }
  }

  /** Stop all daemon processes */
  stopAll(): void {
    for (const [name] of this.processes) {
      this.stopDaemon(name);
    }
  }

  /** Check if a daemon is running */
  isRunning(name: string): boolean {
    return this.processes.has(name);
  }
}

/** Singleton process manager */
export const pythonManager = new PythonProcessManager();
