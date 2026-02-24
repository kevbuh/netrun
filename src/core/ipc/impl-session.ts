import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { prepare } from '../db/connection.js';
import { DATA_DIR } from './shared.js';

const IMPL_DIR = path.join(DATA_DIR, 'implementations');

// Active fs watchers: sessionId → FSWatcher
const watchers = new Map<string, fs.FSWatcher>();

function generateId(): string {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function ensureImplDir(): void {
  fs.mkdirSync(IMPL_DIR, { recursive: true });
}

/** Validate that a resolved path is within the session folder (prevent path traversal) */
function validatePath(sessionFolder: string, filePath: string): string {
  const resolved = path.resolve(sessionFolder, filePath);
  if (!resolved.startsWith(path.resolve(sessionFolder) + path.sep) && resolved !== path.resolve(sessionFolder)) {
    throw new Error('Path outside session folder');
  }
  return resolved;
}

/** Recursive directory listing, depth-limited, skipping common junk */
function readTree(dir: string, depth: number, maxDepth: number): any[] {
  if (depth > maxDepth) return [];
  const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.next', 'dist', '.DS_Store']);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  const result: any[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, type: 'dir', children: readTree(fullPath, depth + 1, maxDepth) });
    } else {
      result.push({ name: entry.name, type: 'file' });
    }
  }
  // Sort: dirs first, then alphabetical
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function buildClaudeMd(opts: {
  paperTitle?: string; paperUrl?: string; paperAbstract?: string;
  authors?: string[]; year?: number | string; venue?: string;
  references?: Array<{ title: string; authors?: Array<{ name: string }>; year?: number; citationCount?: number }>;
  highlights?: Array<{ text: string; pageNum?: number; note?: string }>;
}): string {
  const lines: string[] = [];

  lines.push('# ' + (opts.paperTitle || 'Paper Implementation'));
  lines.push('');

  // Metadata
  if (opts.paperUrl) lines.push('**Paper:** ' + opts.paperUrl);
  if (opts.authors && opts.authors.length) lines.push('**Authors:** ' + opts.authors.join(', '));
  const meta: string[] = [];
  if (opts.year) meta.push(String(opts.year));
  if (opts.venue) meta.push(opts.venue);
  if (meta.length) lines.push('**Published:** ' + meta.join(', '));
  if (opts.paperUrl || (opts.authors && opts.authors.length) || meta.length) lines.push('');

  // Abstract
  if (opts.paperAbstract) {
    lines.push('## Abstract');
    lines.push('');
    lines.push(opts.paperAbstract);
    lines.push('');
  }

  // Key References (top 10 by citation count)
  if (opts.references && opts.references.length) {
    const sorted = [...opts.references]
      .filter(r => r.title)
      .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
      .slice(0, 10);
    if (sorted.length) {
      lines.push('## Key References');
      lines.push('');
      for (const ref of sorted) {
        const refMeta: string[] = [];
        if (ref.authors && ref.authors.length) {
          refMeta.push(ref.authors.slice(0, 3).map(a => a.name).join(', ') + (ref.authors.length > 3 ? ' et al.' : ''));
        }
        if (ref.year) refMeta.push(String(ref.year));
        if (ref.citationCount != null) refMeta.push(ref.citationCount + ' citations');
        lines.push('- **' + ref.title + '**' + (refMeta.length ? ' — ' + refMeta.join(', ') : ''));
      }
      lines.push('');
    }
  }

  // Implementation Guidance (highlights)
  if (opts.highlights && opts.highlights.length) {
    lines.push('## Implementation Guidance');
    lines.push('');
    lines.push('User-highlighted passages from the paper:');
    lines.push('');
    for (const hl of opts.highlights) {
      const page = hl.pageNum ? ' (p. ' + hl.pageNum + ')' : '';
      lines.push('> ' + hl.text + page);
      if (hl.note) lines.push('> **Note:** ' + hl.note);
      lines.push('');
    }
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('Full paper text is available in `paper.md` for reference.');
  lines.push('');

  return lines.join('\n');
}

export function registerImplSessionIPC(): void {
  ensureImplDir();

  // ── Create session ──
  ipcMain.handle('impl:create', (_event, opts: {
    paperUrl?: string; paperTitle?: string; paperAbstract?: string;
    agentType?: string; folderPath?: string;
    authors?: string[]; year?: number | string; venue?: string;
    references?: Array<{ title: string; authors?: Array<{ name: string }>; year?: number; citationCount?: number }>;
    highlights?: Array<{ text: string; pageNum?: number; note?: string }>;
    fullText?: string;
  }) => {
    try {
      const id = generateId();
      const now = Date.now() / 1000;
      const agentType = opts.agentType || 'claude';
      const folderName = (opts.paperTitle || 'paper').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) + '_' + id.slice(0, 8);
      const folderPath = opts.folderPath || path.join(IMPL_DIR, folderName);

      fs.mkdirSync(folderPath, { recursive: true });

      // Write CLAUDE.md with rich paper context
      const claudeMd = buildClaudeMd(opts);
      fs.writeFileSync(path.join(folderPath, 'CLAUDE.md'), claudeMd, 'utf-8');

      // Write paper.md with full extracted text
      if (opts.fullText) {
        const paperMd = '# ' + (opts.paperTitle || 'Paper') + '\n\n' + opts.fullText;
        fs.writeFileSync(path.join(folderPath, 'paper.md'), paperMd, 'utf-8');
      }

      prepare(`INSERT INTO impl_sessions (id, paper_url, paper_title, paper_abstract, folder_path, agent_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, opts.paperUrl || '', opts.paperTitle || '', opts.paperAbstract || '', folderPath, agentType, now, now
      );

      return { id, folderPath };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── List sessions ──
  ipcMain.handle('impl:list', (_event, opts?: { paperUrl?: string }) => {
    try {
      if (opts?.paperUrl) {
        return prepare(`SELECT * FROM impl_sessions WHERE paper_url = ? ORDER BY updated_at DESC`).all(opts.paperUrl);
      }
      return prepare(`SELECT * FROM impl_sessions ORDER BY updated_at DESC`).all();
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Get session ──
  ipcMain.handle('impl:get', (_event, id: string) => {
    try {
      return prepare(`SELECT * FROM impl_sessions WHERE id = ?`).get(id);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Delete session ──
  ipcMain.handle('impl:delete', (_event, id: string, deleteFiles?: boolean) => {
    try {
      const session = prepare(`SELECT folder_path FROM impl_sessions WHERE id = ?`).get(id) as any;
      prepare(`DELETE FROM impl_sessions WHERE id = ?`).run(id);
      if (deleteFiles && session?.folder_path && fs.existsSync(session.folder_path)) {
        fs.rmSync(session.folder_path, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Watch session folder for file changes ──
  ipcMain.handle('impl:watch-start', (event, sessionId: string, folderPath: string) => {
    try {
      // Stop existing watcher for this session
      if (watchers.has(sessionId)) {
        watchers.get(sessionId)!.close();
        watchers.delete(sessionId);
      }
      const webContents = event.sender;
      const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (!webContents.isDestroyed()) {
          webContents.send('impl:file-changed', sessionId, eventType, filename);
        }
      });
      watchers.set(sessionId, watcher);
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Stop watching ──
  ipcMain.handle('impl:watch-stop', (_event, sessionId: string) => {
    const watcher = watchers.get(sessionId);
    if (watcher) {
      watcher.close();
      watchers.delete(sessionId);
    }
    return { ok: true };
  });

  // ── Read directory tree ──
  ipcMain.handle('impl:read-tree', (_event, folderPath: string) => {
    try {
      return readTree(folderPath, 0, 3);
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Read file content (path-validated) ──
  ipcMain.handle('impl:read-file', (_event, folderPath: string, relativePath: string) => {
    try {
      const fullPath = validatePath(folderPath, relativePath);
      const stat = fs.statSync(fullPath);
      if (stat.size > 512 * 1024) return { error: 'File too large (>512KB)' };
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { content, size: stat.size };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  // ── Choose directory dialog ──
  ipcMain.handle('impl:choose-dir', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose implementation folder',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // ── Write file (path-validated) ──
  ipcMain.handle('impl:write-file', (_event, folderPath: string, relativePath: string, content: string) => {
    try {
      const fullPath = validatePath(folderPath, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      return { ok: true };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });
}
