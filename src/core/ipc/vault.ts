import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as userQueries from '../db/queries/users.js';
import {
  VAULT_DIR, SKIP_DIRS, SKIP_FILES, BINARY_MIME,
  getUserVaultPath, resolveExpDir, safePath, slugify, uniqueSlug,
} from './shared.js';

export function registerVaultIPC(): void {
  ipcMain.handle('db:exp-list', (_event, googleId: string) => {
    const vault = getUserVaultPath(googleId);
    if (!fs.existsSync(vault)) return [];
    const experiments: any[] = [];
    for (const name of fs.readdirSync(vault).sort()) {
      const full = path.join(vault, name);
      if (!fs.statSync(full).isDirectory() || name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      let maxTs = 0;
      const walk = (dir: string) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(fullPath); }
            else { try { const mt = fs.statSync(fullPath).mtimeMs / 1000; if (mt > maxTs) maxTs = mt; } catch {} }
          }
        } catch {}
      };
      walk(full);
      experiments.push({ id: name, title: name, desc: '', lastUpdated: maxTs, runCount: 0, runs: [] });
    }
    experiments.sort((a, b) => b.lastUpdated - a.lastUpdated);
    return experiments;
  });

  ipcMain.handle('db:exp-get', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return null;
    const title = expId === '_root' ? 'Vault' : expId;
    return { id: expId, title, desc: '', runs: [] };
  });

  ipcMain.handle('db:exp-create', (_event, googleId: string, title: string) => {
    const vault = getUserVaultPath(googleId);
    const slug = uniqueSlug(vault, slugify(title));
    fs.mkdirSync(path.join(vault, slug), { recursive: true });
    return { id: slug, title: slug, desc: '', runs: [] };
  });

  ipcMain.handle('db:exp-delete', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    fs.rmSync(expDir, { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-files', (_event, googleId: string, expId: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const files: string[] = [];
    const dirsWithFiles = new Set<string>();
    const allDirs = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(expDir, fullPath);
        if (entry.isDirectory()) {
          const top = rel.split(path.sep)[0];
          allDirs.add(top);
          walk(fullPath);
        } else if (!SKIP_FILES.has(entry.name) && !entry.name.startsWith('.')) {
          files.push(rel);
          const parts = rel.split(path.sep);
          if (parts.length > 1) dirsWithFiles.add(parts[0]);
        }
      }
    };
    walk(expDir);
    for (const d of fs.readdirSync(expDir)) {
      if (!SKIP_DIRS.has(d) && fs.statSync(path.join(expDir, d)).isDirectory()) allDirs.add(d);
    }
    files.sort();
    const emptyDirs = [...allDirs].filter(d => !dirsWithFiles.has(d)).sort();
    return { files, emptyDirs };
  });

  ipcMain.handle('db:exp-file-get', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return { error: 'Invalid path' };
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return { error: 'Not found' };
    const ext = path.extname(fname).toLowerCase();
    if (ext in BINARY_MIME) {
      const data = fs.readFileSync(fpath).toString('base64');
      const mime = BINARY_MIME[ext];
      return { name: fname, content: `data:${mime};base64,${data}`, binary: true, mime };
    }
    try {
      const content = fs.readFileSync(fpath, 'utf-8');
      return { name: fname, content };
    } catch {
      const data = fs.readFileSync(fpath).toString('base64');
      return { name: fname, content: `data:application/octet-stream;base64,${data}`, binary: true, mime: 'application/octet-stream' };
    }
  });

  ipcMain.handle('db:exp-file-create', (_event, googleId: string, expId: string, name: string, content?: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const ALLOWED = ['.md', '.ipynb', '.py', '.tex', '.png', '.svg', '.mermaid', '.draw', '.slides'];
    if (!name || !ALLOWED.some(e => name.endsWith(e))) return { error: `Name must end with ${ALLOWED.join(', ')}` };
    const fpath = safePath(expDir, name);
    if (!fpath) return { error: 'Invalid path' };
    if (fs.existsSync(fpath)) return { error: 'File already exists' };
    if (name.endsWith('.png') || name.endsWith('.svg')) {
      if (content) {
        const b64 = content.includes(',') ? content.split(',')[1] : content;
        fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
      } else {
        fs.writeFileSync(fpath, '');
      }
    } else if (content != null) {
      fs.writeFileSync(fpath, content);
    } else if (name.endsWith('.ipynb')) {
      fs.writeFileSync(fpath, JSON.stringify({ cells: [{ cell_type: 'code', source: '', outputs: [] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 2));
    } else if (name.endsWith('.draw')) {
      fs.writeFileSync(fpath, JSON.stringify({ version: 1, objects: [] }));
    } else if (name.endsWith('.slides')) {
      fs.writeFileSync(fpath, JSON.stringify({ version: 1, slides: [{ id: 'slide-1', objects: [], background: null }] }));
    } else {
      fs.writeFileSync(fpath, '');
    }
    return { name };
  });

  ipcMain.handle('db:exp-file-update', (_event, googleId: string, expId: string, fname: string, body: { content?: string; rename?: string }) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return { error: 'Invalid path' };
    if (body.rename) {
      if (!fs.existsSync(fpath)) return { error: 'Not found' };
      const newPath = expDir ? safePath(expDir, body.rename) : null;
      if (!newPath) return { error: 'Invalid path' };
      if (fs.existsSync(newPath)) return { error: 'File already exists' };
      fs.renameSync(fpath, newPath);
      return { ok: true, name: body.rename };
    }
    const parentDir = path.dirname(fpath);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(fpath, body.content ?? '');
    return { ok: true };
  });

  ipcMain.handle('db:exp-file-delete', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return { error: 'Invalid path' };
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return { error: 'Not found' };
    fs.unlinkSync(fpath);
    return { ok: true };
  });

  ipcMain.handle('db:exp-create-folder', (_event, googleId: string, expId: string, name: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const folderPath = safePath(expDir, name);
    if (!folderPath) return { error: 'Invalid folder name' };
    if (fs.existsSync(folderPath)) return { error: 'Folder already exists' };
    fs.mkdirSync(folderPath);
    return { ok: true, name };
  });

  ipcMain.handle('db:exp-delete-folder', (_event, googleId: string, expId: string, folder: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    if (!folder || folder.includes('..') || folder.includes('/')) return { error: 'Invalid folder name' };
    const folderPath = path.join(expDir, folder);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return { error: 'Folder not found' };
    fs.rmSync(folderPath, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('db:exp-rename-folder', (_event, googleId: string, expId: string, oldName: string, newName: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const oldFolderPath = safePath(expDir, oldName);
    const newFolderPath = safePath(expDir, newName);
    if (!oldFolderPath || !newFolderPath) return { error: 'Invalid folder name' };
    if (!fs.existsSync(oldFolderPath) || !fs.statSync(oldFolderPath).isDirectory()) return { error: 'Folder not found' };
    if (fs.existsSync(newFolderPath)) return { error: 'A folder with that name already exists' };
    fs.renameSync(oldFolderPath, newFolderPath);
    return { ok: true, name: newName };
  });

  ipcMain.handle('db:exp-move-file', (_event, googleId: string, expId: string, oldPath: string, newFilePath: string) => {
    const expDir = resolveExpDir(googleId, expId);
    if (!expDir || !fs.existsSync(expDir)) return { error: 'Not found' };
    const src = safePath(expDir, oldPath);
    const dst = safePath(expDir, newFilePath);
    if (!src || !dst) return { error: 'Invalid path' };
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return { error: 'Source file not found' };
    if (fs.existsSync(dst)) return { error: 'Destination already exists' };
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { ok: true, name: newFilePath };
  });

  ipcMain.handle('db:exp-raw-file', (_event, googleId: string, expId: string, fname: string) => {
    const expDir = resolveExpDir(googleId, expId);
    const fpath = expDir ? safePath(expDir, fname) : null;
    if (!fpath) return null;
    if (!fs.existsSync(fpath) || !fs.statSync(fpath).isFile()) return null;
    const ext = path.extname(fname).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(fpath).toString('base64');
    return { data, mime, size: Buffer.byteLength(data, 'base64') };
  });

  // ── Vault path/tree ──

  ipcMain.handle('db:vault-path-get', (_event, googleId: string) => {
    const customPath = userQueries.getUserData(googleId, 'vaultPath');
    const defaultPath = path.join(VAULT_DIR, googleId);
    return {
      path: customPath || defaultPath,
      isCustom: !!customPath,
      default: defaultPath,
    };
  });

  ipcMain.handle('db:vault-path-set', (_event, googleId: string, newPath: string | null) => {
    if (!newPath) {
      userQueries.setUserData(googleId, 'vaultPath', '');
      return { ok: true, message: 'Vault path reset to default', path: getUserVaultPath(googleId) };
    }
    const expanded = newPath.replace(/^~/, process.env.HOME ?? '/tmp');
    if (!fs.existsSync(expanded)) {
      try {
        fs.mkdirSync(expanded, { recursive: true });
      } catch (e: any) {
        return { error: `Cannot create directory: ${e.message}` };
      }
    }
    if (!fs.statSync(expanded).isDirectory()) {
      return { error: 'Path is not a directory' };
    }
    const testFile = path.join(expanded, '.vault_test');
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (e: any) {
      return { error: `Directory is not writable: ${e.message}` };
    }
    userQueries.setUserData(googleId, 'vaultPath', expanded);
    return { ok: true, message: `Vault path set to ${expanded}`, path: expanded };
  });

  ipcMain.handle('db:vault-tree', (_event, googleId: string) => {
    const userVault = getUserVaultPath(googleId);
    const walkDir = (dirpath: string, rel = ''): any[] => {
      const items: any[] = [];
      let entries: string[];
      try { entries = fs.readdirSync(dirpath).sort(); } catch { return items; }
      for (const name of entries) {
        if (name.startsWith('.')) continue;
        const full = path.join(dirpath, name);
        const relPath = rel ? path.join(rel, name) : name;
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue;
            const children = walkDir(full, relPath);
            items.push({ name, path: relPath, type: 'dir', children });
          } else if (stat.isFile()) {
            if (SKIP_FILES.has(name)) continue;
            items.push({ name, path: relPath, type: 'file', mtime: stat.mtimeMs / 1000 });
          }
        } catch { /* skip unreadable entries */ }
      }
      return items;
    };
    return walkDir(userVault);
  });
}
