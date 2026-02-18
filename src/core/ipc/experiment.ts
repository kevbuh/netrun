import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile as execFileCb, spawn as spawnChild } from 'child_process';
import { promisify } from 'util';
import {
  getUserVaultPath, resolveExpDir, safePath, slugify, uniqueSlug,
  parseFrontmatter, stripFrontmatter,
  SKIP_DIRS, SKIP_FILES, BINARY_MIME,
} from './shared.js';

const execFile = promisify(execFileCb);

export function registerExperimentIPC(): void {

  // ── Experiment CRUD ──

  ipcMain.handle('db:exp-list', (_event, googleId: string) => {
    const vault = getUserVaultPath(googleId);
    if (!fs.existsSync(vault)) return [];
    const results: any[] = [];
    for (const name of fs.readdirSync(vault)) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const full = path.join(vault, name);
      if (!fs.statSync(full).isDirectory()) continue;
      const metaPath = path.join(full, 'meta.json');
      let meta: any = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* no meta */ }
      results.push({ id: name, title: meta.title || name, desc: meta.desc || '', created: meta.created || 0 });
    }
    return results;
  });

  ipcMain.handle('db:exp-create', (_event, googleId: string, title: string) => {
    const vault = getUserVaultPath(googleId);
    const slug = uniqueSlug(vault, slugify(title || 'experiment'));
    const expDir = path.join(vault, slug);
    fs.mkdirSync(expDir, { recursive: true });
    const meta = { title: title || slug, desc: '', created: Math.floor(Date.now() / 1000) };
    fs.writeFileSync(path.join(expDir, 'meta.json'), JSON.stringify(meta, null, 2));
    return { id: slug, title: meta.title, desc: '', created: meta.created };
  });

  ipcMain.handle('db:exp-get', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const metaPath = path.join(expDir, 'meta.json');
    let meta: any = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* no meta */ }
    return { id: expId, title: meta.title || expId, desc: meta.desc || '', created: meta.created || 0 };
  });

  ipcMain.handle('db:exp-delete', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    fs.rmSync(expDir, { recursive: true, force: true });
    return { ok: true };
  });

  // ── Experiment files ──

  ipcMain.handle('db:exp-files', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return [];
    const files: any[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_FILES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const relPath = rel ? rel + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(full, relPath);
        } else {
          try {
            const st = fs.statSync(full);
            files.push({ name: relPath, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
          } catch { /* skip */ }
        }
      }
    };
    walk(expDir, '');
    return files;
  });

  ipcMain.handle('db:exp-file-get', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath || !fs.existsSync(fpath)) return { error: 'Not found' };
    const ext = path.extname(fname).toLowerCase();
    if (BINARY_MIME[ext]) {
      const data = fs.readFileSync(fpath).toString('base64');
      return { _proxy: true, data, mime: BINARY_MIME[ext] };
    }
    return { content: fs.readFileSync(fpath, 'utf-8'), name: fname };
  });

  ipcMain.handle('db:exp-file-create', (_event, googleId: string, expId: string, fname: string, content: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!fname || fname.includes('..')) return { error: 'Invalid filename' };
    const fpath = safePath(expDir, fname);
    if (!fpath) return { error: 'Invalid path' };
    fs.mkdirSync(path.dirname(fpath), { recursive: true });
    fs.writeFileSync(fpath, content ?? '');
    return { ok: true, name: fname };
  });

  ipcMain.handle('db:exp-file-update', (_event, googleId: string, expId: string, fname: string, body: { content?: string; rename?: string }) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath || !fs.existsSync(fpath)) return { error: 'Not found' };
    if (body.rename) {
      const newPath = safePath(expDir!, body.rename);
      if (!newPath) return { error: 'Invalid rename path' };
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.renameSync(fpath, newPath);
      return { ok: true, name: body.rename };
    }
    if (body.content !== undefined) {
      fs.writeFileSync(fpath, body.content);
    }
    return { ok: true, name: fname };
  });

  ipcMain.handle('db:exp-file-delete', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath || !fs.existsSync(fpath)) return { error: 'Not found' };
    fs.unlinkSync(fpath);
    return { ok: true };
  });

  ipcMain.handle('db:exp-raw-file', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath || !fs.existsSync(fpath)) return { error: 'Not found' };
    const ext = path.extname(fname).toLowerCase();
    const mime = BINARY_MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(fpath).toString('base64');
    return { _proxy: true, data, mime };
  });

  // ── Folders ──

  ipcMain.handle('db:exp-create-folder', (_event, googleId: string, expId: string, name: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!name || name.includes('..')) return { error: 'Invalid folder name' };
    const folderPath = safePath(expDir, name);
    if (!folderPath) return { error: 'Invalid path' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-delete-folder', (_event, googleId: string, expId: string, folder: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const folderPath = safePath(expDir, folder);
    if (!folderPath || !fs.existsSync(folderPath)) return { error: 'Not found' };
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-rename-folder', (_event, googleId: string, expId: string, oldName: string, newName: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const oldPath = safePath(expDir, oldName);
    const newPath = safePath(expDir, newName);
    if (!oldPath || !newPath || !fs.existsSync(oldPath)) return { error: 'Not found' };
    fs.renameSync(oldPath, newPath);
    return { ok: true };
  });

  ipcMain.handle('db:exp-move-file', (_event, googleId: string, expId: string, oldFilePath: string, newFilePath: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const srcPath = safePath(expDir, oldFilePath);
    const destPath = safePath(expDir, newFilePath);
    if (!srcPath || !destPath || !fs.existsSync(srcPath)) return { error: 'Not found' };
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.renameSync(srcPath, destPath);
    return { ok: true };
  });

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

  ipcMain.handle('db:exp-packages', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      const { stdout: out } = await execFile(pythonPath, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' });
      return JSON.parse(out);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-venv-info', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (!fs.existsSync(venvDir)) return { error: 'No venv' };
    const venvPython = path.join(venvDir, 'bin', 'python3');
    let pythonVersion = '';
    try {
      const { stdout } = await execFile(venvPython, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      pythonVersion = stdout.trim();
    } catch {}
    let packages: any[] = [];
    try {
      const { stdout } = await execFile(venvPython, ['-m', 'pip', 'list', '--format=json'], { timeout: 15_000, encoding: 'utf-8' });
      packages = JSON.parse(stdout);
    } catch {}
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

  ipcMain.handle('db:exp-create-venv', async (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const venvDir = path.join(expDir, 'venv');
    if (fs.existsSync(venvDir)) return { error: 'venv already exists' };
    try {
      await execFile('python3', ['-m', 'venv', venvDir], { timeout: 60_000 });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-install-packages', async (_event, googleId: string, expId: string, packages: string[]) => {
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
      await execFile(pythonPath, ['-m', 'pip', 'install', ...packages], { timeout: 120_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-uninstall-package', async (_event, googleId: string, expId: string, pkg: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir) return { error: 'Not found' };
    const venvPython = path.join(expDir, 'venv', 'bin', 'python3');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';
    try {
      await execFile(pythonPath, ['-m', 'pip', 'uninstall', '-y', pkg], { timeout: 30_000, encoding: 'utf-8' });
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:exp-clone-repo', async (_event, googleId: string, expId: string, url: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!url || !/^https?:\/\/.+/.test(url)) return { error: 'Invalid URL' };
    try {
      await execFile('git', ['clone', '--depth', '1', url], { cwd: expDir, timeout: 60_000, encoding: 'utf-8' });
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

  ipcMain.handle('db:exp-compile-tex', async (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return { error: 'Invalid path' };
    if (!fs.existsSync(fpath)) return { error: 'File not found' };
    const texDir = path.dirname(fpath);
    const baseName = path.basename(fname, '.tex');
    try {
      await execFile('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      try { await execFile('bibtex', [baseName], { cwd: texDir, timeout: 15_000 }); } catch {}
      await execFile('pdflatex', ['-interaction=nonstopmode', '-output-directory=' + texDir, fpath], { cwd: texDir, timeout: 30_000 });
      const pdfPath = path.join(texDir, baseName + '.pdf');
      if (!fs.existsSync(pdfPath)) return { error: 'PDF not generated' };
      const pdfData = fs.readFileSync(pdfPath).toString('base64');
      return { _proxy: true, data: pdfData, mime: 'application/pdf' };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
