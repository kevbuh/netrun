import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  getUserVaultPath, resolveExpDir, safePath, slugify, uniqueSlug,
  parseFrontmatter, stripFrontmatter,
} from './shared.js';

export function registerExperimentIPC(): void {
  const { execFileSync, spawn: spawnChild } = require('child_process') as typeof import('child_process');

  // ── Marimo start/stop ──

  const _marimoServers = new Map<string, { proc: any; port: number; pyPath: string; notePath: string }>();

  ipcMain.handle('db:marimo-start', (_event, googleId: string, noteId: string) => {
    if (!noteId) return { error: 'note_id required' };
    if (_marimoServers.has(noteId)) return { port: _marimoServers.get(noteId)!.port };
    const userVault = getUserVaultPath(googleId);
    let notePath = '';
    let noteContent = '';
    let noteType = '';
    for (const fname of fs.readdirSync(userVault).filter((f: string) => f.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(path.join(userVault, fname), 'utf-8');
        const fm = parseFrontmatter(content);
        if (fm?.id === noteId) {
          notePath = path.join(userVault, fname);
          noteContent = stripFrontmatter(content);
          noteType = fm.type ?? '';
          break;
        }
      } catch { /* skip */ }
    }
    if (!notePath || noteType !== 'marimo') return { error: 'Marimo note not found' };

    const pyPath = path.join(userVault, `.marimo_${noteId}.py`);
    fs.writeFileSync(pyPath, noteContent);

    const net = require('net');
    const srv = net.createServer();
    srv.listen(0);
    const port = srv.address().port;
    srv.close();

    try {
      const proc = spawnChild('marimo', ['edit', pyPath, '--headless', '--no-token', '-p', String(port)], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      _marimoServers.set(noteId, { proc, port, pyPath, notePath });
      return { port };
    } catch {
      try { fs.unlinkSync(pyPath); } catch {}
      return { error: 'marimo is not installed. Run: pip install marimo' };
    }
  });

  ipcMain.handle('db:marimo-stop', (_event, googleId: string, noteId: string) => {
    if (!noteId || !_marimoServers.has(noteId)) return { error: 'No marimo server running for this note' };
    const info = _marimoServers.get(noteId)!;
    _marimoServers.delete(noteId);
    let updatedContent = '';
    try { updatedContent = fs.readFileSync(info.pyPath, 'utf-8'); } catch {}
    try { info.proc.kill('SIGTERM'); } catch {}
    try { fs.unlinkSync(info.pyPath); } catch {}
    const userVault = getUserVaultPath(googleId);
    for (const fname of fs.readdirSync(userVault).filter((f: string) => f.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(path.join(userVault, fname), 'utf-8');
        const fm = parseFrontmatter(content);
        if (fm?.id === noteId) {
          const fmEnd = content.indexOf('---', 3);
          if (fmEnd !== -1) {
            const headerPart = content.slice(0, fmEnd + 3);
            const newHeader = headerPart.replace(/updated:.*/, `updated: ${Math.floor(Date.now() / 1000)}`);
            fs.writeFileSync(path.join(userVault, fname), newHeader + '\n' + updatedContent);
          }
          break;
        }
      } catch {}
    }
    return { ok: true, content: updatedContent };
  });

  // ── Experiments (non-kernel) ──

  ipcMain.handle('db:exp-packages', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      const out = execFileSync(pythonPath, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' });
      return JSON.parse(out);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-venv-info', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (!fs.existsSync(venvDir)) return { error: 'No venv' };
    const venvPython = path.join(venvDir, 'bin', 'python3');
    let pythonVersion = '';
    try { pythonVersion = execFileSync(venvPython, ['--version'], { timeout: 5000, encoding: 'utf-8' }).trim(); } catch {}
    let packages: any[] = [];
    try { packages = JSON.parse(execFileSync(venvPython, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' })); } catch {}
    let sizeBytes = 0;
    const walkVenv = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walkVenv(full);
          else try { sizeBytes += fs.statSync(full).size; } catch {}
        }
      } catch {}
    };
    walkVenv(venvDir);
    return { python_version: pythonVersion, packages, size_mb: Math.round(sizeBytes / (1024 * 1024) * 10) / 10, package_count: packages.length };
  });

  ipcMain.handle('db:venvs', (_event, googleId: string) => {
    const vault = getUserVaultPath(googleId);
    if (!fs.existsSync(vault)) return [];
    const results: any[] = [];
    for (const name of fs.readdirSync(vault)) {
      const full = path.join(vault, name);
      if (!fs.statSync(full).isDirectory()) continue;
      if (fs.existsSync(path.join(full, 'venv', 'bin', 'python3'))) {
        results.push({ id: name, title: name });
      }
    }
    return results;
  });

  ipcMain.handle('db:exp-upload', (_event, googleId: string, expId: string, files: Array<{ name: string; data: string }>) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const uploaded: string[] = [];
    for (const file of files) {
      if (!file.name || file.name.includes('..')) continue;
      const fpath = path.join(expDir, file.name);
      fs.mkdirSync(path.dirname(fpath), { recursive: true });
      fs.writeFileSync(fpath, Buffer.from(file.data, 'base64'));
      uploaded.push(file.name);
    }
    return { ok: true, uploaded };
  });

  ipcMain.handle('db:exp-create-venv', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (fs.existsSync(venvDir)) return { error: 'venv already exists' };
    try {
      execFileSync('python3', ['-m', 'venv', venvDir], { timeout: 60_000 });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-install-packages', (_event, googleId: string, expId: string, packages: string[]) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    if (!packages?.length) return { error: 'No packages specified' };
    const validPkg = /^[a-zA-Z0-9._-]+([<>=!]+[a-zA-Z0-9._-]*)?$/;
    for (const pkg of packages) {
      if (!validPkg.test(pkg)) return { error: `Invalid package name: ${pkg}` };
    }
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      execFileSync(pythonPath, ['-m', 'pip', 'install', ...packages], { timeout: 120_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-uninstall-package', (_event, googleId: string, expId: string, pkg: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      execFileSync(pythonPath, ['-m', 'pip', 'uninstall', '-y', pkg], { timeout: 30_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-clone-repo', (_event, googleId: string, expId: string, url: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!url || !/^https?:\/\/.+/.test(url)) return { error: 'Invalid URL' };
    try {
      execFileSync('git', ['clone', '--depth', '1', url], { cwd: expDir, timeout: 60_000, encoding: 'utf-8' });
      const repoName = url.split('/').pop()?.replace('.git', '') ?? '';
      const gitDir = path.join(expDir, repoName, '.git');
      if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-delete-venv', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (!fs.existsSync(venvDir)) return { error: 'No venv found' };
    fs.rmSync(venvDir, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-update', (_event, googleId: string, expId: string, body: { title?: string; pythonPath?: string }) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (body.title && body.title !== expId) {
      const vault = getUserVaultPath(googleId);
      const newSlug = uniqueSlug(vault, slugify(body.title));
      const newDir = path.join(vault, newSlug);
      fs.renameSync(expDir, newDir);
      return { ok: true, id: newSlug, title: newSlug };
    }
    return { ok: true, id: expId };
  });

  ipcMain.handle('db:exp-compile-tex', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return { error: 'Invalid path' };
    if (!fs.existsSync(fpath)) return { error: 'File not found' };
    const texDir = path.dirname(fpath);
    const baseName = path.basename(fname, '.tex');
    try {
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      try { execFileSync('bibtex', [baseName], { cwd: texDir, timeout: 15_000 }); } catch {}
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      const pdfPath = path.join(texDir, baseName + '.pdf');
      if (!fs.existsSync(pdfPath)) return { error: 'PDF not generated' };
      const pdfData = fs.readFileSync(pdfPath).toString('base64');
      return { _proxy: true, data: pdfData, mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
