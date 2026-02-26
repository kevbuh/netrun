import { ipcMain } from 'electron';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'core', 'python', 'pdf-convert.py');

// In dev mode, script is at src/core/python/pdf-convert.py relative to project root
export function getScriptPath(): string {
  // Try compiled location first, then dev location
  if (fs.existsSync(SCRIPT_PATH)) return SCRIPT_PATH;
  const devPath = path.join(__dirname, '..', '..', '..', 'src', 'core', 'python', 'pdf-convert.py');
  if (fs.existsSync(devPath)) return devPath;
  // Fallback: search from process.cwd()
  const cwdPath = path.join(process.cwd(), 'src', 'core', 'python', 'pdf-convert.py');
  return cwdPath;
}

export function runPdfConvert(args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = getScriptPath();
    const jsonArg = JSON.stringify(args);
    const proc = cp.spawn('python3', [scriptPath, jsonArg], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PDF convert failed: ${stderr || 'exit code ' + code}`));
        return;
      }
      try {
        // PyMuPDF may print warnings to stdout before the JSON (e.g. "Consider using pymupdf_layout...")
        // Find the JSON object in the output
        const jsonStart = stdout.indexOf('{');
        const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        const result = JSON.parse(jsonStr);
        if (!result.ok) {
          reject(new Error(result.error || 'PDF convert failed'));
        } else {
          resolve(result);
        }
      } catch {
        reject(new Error(`Failed to parse output: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });
  });
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), 'netrun-pdf-convert');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function registerPdfConvertIPC(): void {
  // Download a remote PDF URL to a temp file and return the path
  ipcMain.handle('pdf:download-temp', async (_event, url: string) => {
    if (!url) return { error: 'url required' };
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const buf = Buffer.from(await resp.arrayBuffer());
      const tempPath = path.join(tmpDir(), `download_${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, buf);
      return { ok: true, path: tempPath };
    } catch (e: any) { return { error: e.message }; }
  });

  // Parse PDF — extract all text
  ipcMain.handle('pdf:parse', async (_event, inputPath: string) => {
    if (!inputPath) return { error: 'inputPath required' };
    try {
      return await runPdfConvert({ command: 'parse', input: inputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // Extract PDF — text + embedded images
  ipcMain.handle('pdf:extract', async (_event, inputPath: string) => {
    if (!inputPath) return { error: 'inputPath required' };
    try {
      const outDir = path.join(tmpDir(), `extract_${Date.now()}`);
      return await runPdfConvert({ command: 'extract', input: inputPath, output: outDir });
    } catch (e: any) { return { error: e.message }; }
  });

  // Split PDF — extract specific pages
  ipcMain.handle('pdf:split', async (_event, inputPath: string, pages: number[], outputPath: string) => {
    if (!inputPath || !pages?.length || !outputPath) return { error: 'inputPath, pages, and outputPath required' };
    try {
      return await runPdfConvert({ command: 'split', input: inputPath, pages, output: outputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // Merge PDFs
  ipcMain.handle('pdf:merge', async (_event, inputPaths: string[], outputPath: string) => {
    if (!inputPaths?.length || !outputPath) return { error: 'inputPaths and outputPath required' };
    try {
      return await runPdfConvert({ command: 'merge', inputs: inputPaths, output: outputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // Compress PDF
  ipcMain.handle('pdf:compress', async (_event, inputPath: string, outputPath: string) => {
    if (!inputPath || !outputPath) return { error: 'inputPath and outputPath required' };
    try {
      return await runPdfConvert({ command: 'compress', input: inputPath, output: outputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // PDF to PNG
  ipcMain.handle('pdf:to-png', async (_event, inputPath: string, outputDir: string) => {
    if (!inputPath || !outputDir) return { error: 'inputPath and outputDir required' };
    try {
      return await runPdfConvert({ command: 'to-png', input: inputPath, output: outputDir });
    } catch (e: any) { return { error: e.message }; }
  });

  // PDF to JPEG
  ipcMain.handle('pdf:to-jpeg', async (_event, inputPath: string, outputDir: string) => {
    if (!inputPath || !outputDir) return { error: 'inputPath and outputDir required' };
    try {
      return await runPdfConvert({ command: 'to-jpeg', input: inputPath, output: outputDir });
    } catch (e: any) { return { error: e.message }; }
  });

  // Images to PDF (from-png / from-jpeg)
  ipcMain.handle('pdf:from-images', async (_event, inputPaths: string[], outputPath: string) => {
    if (!inputPaths?.length || !outputPath) return { error: 'inputPaths and outputPath required' };
    try {
      return await runPdfConvert({ command: 'from-png', inputs: inputPaths, output: outputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // Markdown to PDF
  ipcMain.handle('pdf:md-to-pdf', async (_event, inputPath: string, outputPath: string) => {
    if (!inputPath || !outputPath) return { error: 'inputPath and outputPath required' };
    try {
      return await runPdfConvert({ command: 'md-to-pdf', input: inputPath, output: outputPath });
    } catch (e: any) { return { error: e.message }; }
  });

  // PDF to Markdown
  ipcMain.handle('pdf:to-md', async (_event, inputPath: string, outputPath?: string) => {
    if (!inputPath) return { error: 'inputPath required' };
    try {
      const args: Record<string, unknown> = { command: 'to-md', input: inputPath };
      if (outputPath) args.output = outputPath;
      return await runPdfConvert(args);
    } catch (e: any) { return { error: e.message }; }
  });
}
