import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import * as userQueries from '../db/queries/users.js';

// ── Browser definitions ──

interface BrowserDef {
  id: string;
  name: string;
  format: 'chromium' | 'firefox' | 'safari';
  path: string; // relative to home, may contain glob-like *
}

const BROWSERS: BrowserDef[] = [
  { id: 'chrome', name: 'Chrome', format: 'chromium', path: 'Library/Application Support/Google/Chrome/Default/Bookmarks' },
  { id: 'edge', name: 'Edge', format: 'chromium', path: 'Library/Application Support/Microsoft Edge/Default/Bookmarks' },
  { id: 'brave', name: 'Brave', format: 'chromium', path: 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks' },
  { id: 'arc', name: 'Arc', format: 'chromium', path: 'Library/Application Support/Arc/User Data/Default/Bookmarks' },
  { id: 'firefox', name: 'Firefox', format: 'firefox', path: 'Library/Application Support/Firefox/Profiles' },
  { id: 'safari', name: 'Safari', format: 'safari', path: 'Library/Safari/Bookmarks.plist' },
];

interface ParsedBookmark {
  url: string;
  title: string;
  dateAdded: number; // unix ms
}

// ── Helpers ──

function resolveHome(rel: string): string {
  return path.join(os.homedir(), rel);
}

function hostnameFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function faviconUrl(url: string): string {
  const h = hostnameFromUrl(url);
  return h ? `https://www.google.com/s2/favicons?domain=${h}&sz=32` : '';
}

// ── Parsers ──

function parseChromium(filePath: string): ParsedBookmark[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const results: ParsedBookmark[] = [];
  // Chrome epoch: microseconds since 1601-01-01
  const CHROME_EPOCH_OFFSET = 11644473600000000n;

  function walk(node: any): void {
    if (!node) return;
    if (node.type === 'url' && node.url) {
      let dateAdded = Date.now();
      if (node.date_added) {
        try {
          const micro = BigInt(node.date_added);
          dateAdded = Number((micro - CHROME_EPOCH_OFFSET) / 1000n);
        } catch { /* use Date.now() */ }
      }
      results.push({ url: node.url, title: node.name || node.url, dateAdded });
    }
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  if (data.roots) {
    for (const key of ['bookmark_bar', 'other', 'synced']) {
      if (data.roots[key]) walk(data.roots[key]);
    }
  }
  return results;
}

function parseFirefox(profilesDir: string): ParsedBookmark[] {
  // Find first profile directory containing places.sqlite
  let placesPath = '';
  try {
    const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(profilesDir, entry.name, 'places.sqlite');
      if (fs.existsSync(candidate)) {
        placesPath = candidate;
        break;
      }
    }
  } catch { /* profiles dir doesn't exist or not readable */ }

  if (!placesPath) return [];

  // Copy to temp dir to avoid locking issues
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ff-'));
  const tmpDb = path.join(tmpDir, 'places.sqlite');
  try {
    fs.copyFileSync(placesPath, tmpDb);
    // Also copy WAL/SHM if present
    const walPath = placesPath + '-wal';
    const shmPath = placesPath + '-shm';
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, tmpDb + '-wal');
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, tmpDb + '-shm');

    const db = new Database(tmpDb, { readonly: true });
    const rows = db.prepare(`
      SELECT b.title, p.url, b.dateAdded FROM moz_bookmarks b
      JOIN moz_places p ON b.fk = p.id
      WHERE b.type = 1 AND p.url NOT LIKE 'place:%'
    `).all() as Array<{ title: string | null; url: string; dateAdded: number }>;
    db.close();

    return rows.map(r => ({
      url: r.url,
      title: r.title || r.url,
      dateAdded: r.dateAdded ? Math.floor(r.dateAdded / 1000) : Date.now(), // microseconds → ms
    }));
  } catch {
    return [];
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort cleanup */ }
  }
}

function parseSafari(plistPath: string): ParsedBookmark[] {
  let json: string;
  try {
    json = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch (e: any) {
    if (e.message?.includes('Operation not permitted') || e.status === 1) {
      throw new Error('Safari bookmarks require Full Disk Access. Go to System Settings > Privacy & Security > Full Disk Access and enable it for Netrun.');
    }
    throw e;
  }

  const data = JSON.parse(json);
  const results: ParsedBookmark[] = [];

  function walk(node: any): void {
    if (!node) return;
    // Skip the Reading List folder
    if (node.Title === 'com.apple.ReadingList') return;
    if (node.WebBookmarkType === 'WebBookmarkTypeLeaf' && node.URLString) {
      const title = node.URIDictionary?.title || node.URLString;
      results.push({ url: node.URLString, title, dateAdded: Date.now() });
    }
    if (node.Children && Array.isArray(node.Children)) {
      for (const child of node.Children) walk(child);
    }
  }

  walk(data);
  return results;
}

function parseBookmarks(browser: BrowserDef): ParsedBookmark[] {
  const fullPath = resolveHome(browser.path);
  switch (browser.format) {
    case 'chromium': return parseChromium(fullPath);
    case 'firefox': return parseFirefox(fullPath);
    case 'safari': return parseSafari(fullPath);
    default: return [];
  }
}

function detectBrowser(browser: BrowserDef): boolean {
  const fullPath = resolveHome(browser.path);
  if (browser.format === 'firefox') {
    // Check if any profile dir contains places.sqlite
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      return entries.some(e => e.isDirectory() && fs.existsSync(path.join(fullPath, e.name, 'places.sqlite')));
    } catch { return false; }
  }
  return fs.existsSync(fullPath);
}

// ── Saved posts helpers (mirrors system.ts pattern) ──

function getSavedPosts(googleId: string): Record<string, any> {
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
  return saved;
}

// ── IPC Registration ──

export function registerBookmarkImportIPC(): void {

  // Detect installed browsers
  ipcMain.handle('db:bookmark-detect', () => {
    const detected = BROWSERS
      .filter(b => detectBrowser(b))
      .map(b => ({ id: b.id, name: b.name, format: b.format }));
    return { browsers: detected };
  });

  // Preview bookmarks (count + list)
  ipcMain.handle('db:bookmark-parse', (_event, browserId: string) => {
    const browser = BROWSERS.find(b => b.id === browserId);
    if (!browser) return { error: 'Unknown browser', bookmarks: [], count: 0 };
    try {
      const bookmarks = parseBookmarks(browser);
      return { bookmarks, count: bookmarks.length };
    } catch (e: any) {
      return { error: e.message || 'Parse failed', bookmarks: [], count: 0 };
    }
  });

  // Import bookmarks into savedPosts
  // selectedUrls: optional array of URLs to import (if omitted, imports all)
  ipcMain.handle('db:bookmark-import', (_event, browserId: string, googleId: string, selectedUrls?: string[]) => {
    const browser = BROWSERS.find(b => b.id === browserId);
    if (!browser) return { ok: false, error: 'Unknown browser', imported: 0, skipped: 0, total: 0 };
    if (!googleId) return { ok: false, error: 'Not signed in', imported: 0, skipped: 0, total: 0 };

    let bookmarks: ParsedBookmark[];
    try {
      bookmarks = parseBookmarks(browser);
    } catch (e: any) {
      return { ok: false, error: e.message || 'Parse failed', imported: 0, skipped: 0, total: 0 };
    }

    // Filter to selected URLs if provided
    if (selectedUrls && Array.isArray(selectedUrls)) {
      const urlSet = new Set(selectedUrls);
      bookmarks = bookmarks.filter(bm => urlSet.has(bm.url));
    }

    const saved = getSavedPosts(googleId);
    let imported = 0;
    let skipped = 0;

    for (const bm of bookmarks) {
      if (bm.url in saved) {
        skipped++;
        continue;
      }
      const hostname = hostnameFromUrl(bm.url);
      saved[bm.url] = {
        paper: { title: bm.title, link: bm.url, favicon: faviconUrl(bm.url), hostname },
        savedAt: bm.dateAdded,
        read: false,
      };
      imported++;
    }

    userQueries.setUserData(googleId, 'savedPosts', JSON.stringify(saved));
    return { ok: true, imported, skipped, total: bookmarks.length };
  });
}
