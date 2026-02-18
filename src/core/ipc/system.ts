import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as userQueries from '../db/queries/users.js';
import {
  OLLAMA_HOST, GOOGLE_CLIENT_ID, DATA_DIR,
  contentPath, uploadsDir,
} from './shared.js';

export function registerSystemIPC(): void {
  ipcMain.handle('db:read-view', (_event, viewPath: string) => {
    const dataDir = process.env.ARXIV_DATA_DIR ?? process.cwd();
    const resolved = path.resolve(dataDir, viewPath.replace(/^\//, ''));
    const base = path.resolve(dataDir);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      return { error: 'Invalid view path' };
    }
    try {
      return { html: fs.readFileSync(resolved, 'utf-8') };
    } catch { return { error: 'View not found: ' + viewPath }; }
  });

  ipcMain.handle('db:client-config', () => {
    return { googleClientId: GOOGLE_CLIENT_ID, ollamaHost: OLLAMA_HOST };
  });

  ipcMain.handle('db:version', () => {
    try {
      const rootDir = path.resolve(__dirname, '..', '..', '..');
      const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: rootDir, encoding: 'utf-8', timeout: 5000 }).trim();
      const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf-8', timeout: 5000 }).trim();
      return { version: '0.' + count, sha };
    } catch { return { version: '0.0', sha: '' }; }
  });

  ipcMain.handle('db:reveal-in-finder', (_event, filePath: string) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('db:saved-content-get', (_event, url: string) => {
    if (!url) return { error: 'url required' };
    const p = contentPath(url);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  });

  ipcMain.handle('db:saved-content-set', (_event, url: string, data: { url: string; title: string; text: string; savedAt?: number }) => {
    if (!url) return { error: 'url required' };
    const p = contentPath(url);
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return { ok: true };
  });

  // ── Social uploads ──

  ipcMain.handle('db:upload-profile-picture', (_event, googleId: string, imageData: string) => {
    if (!imageData || !imageData.startsWith('data:image/')) {
      return { error: 'Invalid image data' };
    }
    const [header, b64] = imageData.split(',', 2);
    let ext = 'jpg';
    if (header.includes('png')) ext = 'png';
    else if (header.includes('webp')) ext = 'webp';
    const hash = createHash('sha256').update(googleId).digest('hex').slice(0, 16);
    const fname = `${hash}_pic.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, fname), Buffer.from(b64, 'base64'));
    const pictureUrl = '/uploads/' + fname;
    userQueries.updateUserPicture(googleId, pictureUrl);
    return { ok: true, picture: pictureUrl };
  });

  ipcMain.handle('db:upload-profile-background', (_event, googleId: string, imageData: string) => {
    if (!imageData || !imageData.startsWith('data:image/')) {
      return { error: 'Invalid image data' };
    }
    const [header, b64] = imageData.split(',', 2);
    let ext = 'jpg';
    if (header.includes('png')) ext = 'png';
    else if (header.includes('webp')) ext = 'webp';
    const hash = createHash('sha256').update(googleId).digest('hex').slice(0, 16);
    const fname = `${hash}_bg.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, fname), Buffer.from(b64, 'base64'));
    const bgUrl = '/uploads/' + fname;
    userQueries.updateUserProfileBg(googleId, bgUrl);
    return { ok: true, profile_bg: bgUrl };
  });

  ipcMain.handle('db:settings', () => {
    return { ok: true };
  });

  ipcMain.handle('db:upload-image', (_event, imageB64: string) => {
    if (!imageB64) return { error: 'image required' };
    const filename = randomUUID() + '.png';
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, Buffer.from(imageB64, 'base64'));
    return { url: '/api/images/' + filename };
  });

  ipcMain.handle('db:serve-image', (_event, filename: string) => {
    const safeName = path.basename(filename);
    const filepath = path.join(uploadsDir, safeName);
    if (!fs.existsSync(filepath)) return { error: 'Not found' };
    const data = fs.readFileSync(filepath).toString('base64');
    return { _proxy: true, data, mime: 'image/png' };
  });

  ipcMain.handle('db:saved-posts', (_event, googleId: string, body: { url: string; title?: string; favicon?: string; hostname?: string }) => {
    const url = (body.url ?? '').trim();
    if (!url) return { error: 'url required' };
    const title = body.title ?? url;
    const favicon = body.favicon ?? '';
    const hostname = body.hostname ?? '';
    const allData = userQueries.getAllUserData(googleId);
    let saved: Record<string, any> = {};
    const savedRaw = allData.savedPosts;
    if (savedRaw) {
      const val = savedRaw.value;
      if (typeof val === 'string') {
        try { saved = JSON.parse(val); } catch { saved = {}; }
      } else if (typeof val === 'object' && val !== null) {
        saved = val as Record<string, any>;
      }
    }
    if (url in saved) return { exists: true };
    saved[url] = {
      paper: { title, link: url, favicon, hostname },
      savedAt: Date.now(),
      read: false,
    };
    userQueries.setUserData(googleId, 'savedPosts', JSON.stringify(saved));
    return { ok: true };
  });

  ipcMain.handle('db:custom-feeds', (_event, googleId: string, body: { url: string; name?: string }) => {
    const url = (body.url ?? '').trim();
    const name = (body.name ?? '').trim();
    if (!url) return { error: 'url required' };
    const allData = userQueries.getAllUserData(googleId);
    let feeds: any[] = [];
    const feedsRaw = allData.customFeeds;
    if (feedsRaw) {
      const val = feedsRaw.value;
      if (typeof val === 'string') {
        try { feeds = JSON.parse(val); } catch { feeds = []; }
      } else if (Array.isArray(val)) {
        feeds = val;
      }
    }
    if (!Array.isArray(feeds)) feeds = [];
    if (feeds.some((f: any) => f.url === url)) return { exists: true };
    feeds.push({ url, name: name || url, enabled: true });
    userQueries.setUserData(googleId, 'customFeeds', JSON.stringify(feeds));
    return { ok: true, name: name || url };
  });

  ipcMain.handle('db:local-file', (_event, filePath: string) => {
    if (!filePath) return { error: 'File not found' };
    const resolved = path.resolve(filePath);
    // Block sensitive dotfile directories
    const BLOCKED_DIRS = ['.ssh', '.gnupg', '.aws', '.config', '.netrc', '.git', '.env'];
    const parts = resolved.split(path.sep);
    if (parts.some(p => BLOCKED_DIRS.includes(p))) {
      return { error: 'Access denied' };
    }
    const ext = path.extname(resolved).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html', '.htm': 'text/html',
      '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.xml': 'application/xml',
      '.txt': 'text/plain', '.md': 'text/markdown',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4', '.webm': 'video/webm',
    };
    const mime = mimeMap[ext];
    if (!mime) return { error: 'Unsupported file type' };
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { error: 'File not found' };
    }
    const data = fs.readFileSync(resolved).toString('base64');
    return { _proxy: true, data, mime };
  });

  ipcMain.handle('db:tex-preview', () => {
    return {
      _proxy: true,
      data: Buffer.from(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LaTeX Preview</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:#1a1a1a;font-family:system-ui,sans-serif;color:#aaa}
#pdf-frame{width:100%;height:100%;border:none;display:none}
#placeholder{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px}
#placeholder .spinner{width:24px;height:24px;border:2px solid #444;border-top-color:#b4451a;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body>
<iframe id="pdf-frame"></iframe>
<div id="placeholder"><div class="spinner"></div><span>Waiting for compilation...</span></div>
<script>
const ch = new BroadcastChannel('tex-pdf-preview');
const frame = document.getElementById('pdf-frame');
const ph = document.getElementById('placeholder');
let currentUrl = null;
ch.onmessage = function(e) {
  if (e.data && e.data.type === 'pdf-update') {
    const bytes = new Uint8Array(e.data.pdf);
    const blob = new Blob([bytes], {type:'application/pdf'});
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    frame.src = currentUrl;
    frame.style.display = 'block';
    ph.style.display = 'none';
    document.title = 'LaTeX Preview' + (e.data.fname ? ' - ' + e.data.fname : '');
  }
};
ch.postMessage({type:'preview-ready'});
</script></body></html>`).toString('base64'),
      mime: 'text/html',
    };
  });
}
