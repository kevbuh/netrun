import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import { OllamaProvider } from '../providers/ollama.js';
import * as userQueries from '../db/queries/users.js';

// ── Ollama provider (singleton) ──

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
export const ollamaProvider = new OllamaProvider({ baseURL: OLLAMA_HOST });

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  ?? '856091829253-1n5fu44j867fu88larg1vvnqds4pmkh4.apps.googleusercontent.com';

// ── In-memory fetch cache (TTL-based) ──

const _fetchCache = new Map<string, { data: Buffer; ts: number }>();
const FETCH_CACHE_TTL = 300_000; // 5 min

export async function cachedFetch(url: string, timeoutMs = 15_000): Promise<Buffer> {
  const now = Date.now();
  const cached = _fetchCache.get(url);
  if (cached && now - cached.ts < FETCH_CACHE_TTL) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: controller.signal,
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    _fetchCache.set(url, { data: buf, ts: now });
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// ── Data directories (disk) ──

function _migrateDir(oldPath: string, newPath: string): void {
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try { fs.renameSync(oldPath, newPath); } catch { /* cross-device, leave old */ }
  }
}

const _home = process.env.HOME ?? '/tmp';
_migrateDir(path.join(_home, '.aether_cache'), path.join(_home, '.netrun_cache'));
_migrateDir(path.join(_home, '.aether_data'), path.join(_home, '.netrun_data'));

const CONTENT_CACHE_DIR = path.join(_home, '.netrun_cache', 'content');
fs.mkdirSync(CONTENT_CACHE_DIR, { recursive: true });

export function contentPath(url: string): string {
  const h = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return path.join(CONTENT_CACHE_DIR, h + '.json');
}

// ── Annotation prompt file ──

export const DATA_DIR = path.join(_home, '.netrun_data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const ANNOTATION_PROMPT_FILE = path.join(DATA_DIR, 'annotation_prompt.txt');

// ── Active doc-chat sessions ──

export const activeDocChatSessions = new Map<string, AbortController>();

// ── Experiment filesystem helpers ──

export const VAULT_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '/tmp', 'Desktop', 'netrun');
export const SKIP_DIRS = new Set(['venv', '.kernels', '__pycache__', 'node_modules', '.git']);
export const SKIP_FILES = new Set(['meta.json', '.DS_Store', 'Thumbs.db']);

export function getUserVaultPath(googleId: string): string {
  const custom = userQueries.getUserData(googleId, 'vaultPath');
  if (custom && fs.existsSync(custom)) return custom;
  const defaultPath = path.join(VAULT_DIR, googleId);
  fs.mkdirSync(defaultPath, { recursive: true });
  return defaultPath;
}

export function resolveExpDir(googleId: string, expId: string): string | null {
  const vault = getUserVaultPath(googleId);
  if (expId === '_root') return vault;
  const d = path.join(vault, expId);
  if (!path.resolve(d).startsWith(path.resolve(vault) + path.sep)) return null;
  return d;
}

/** Resolve a user-supplied filename within an experiment dir, returning null if it escapes. */
export function safePath(expDir: string, fname: string): string | null {
  if (!fname) return null;
  const resolved = path.resolve(expDir, fname);
  const base = path.resolve(expDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export function slugify(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/[^\w\s-]/g, '');
  s = s.replace(/[\s_]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'experiment';
}

export function uniqueSlug(vaultPath: string, base: string): string {
  let slug = base;
  let i = 2;
  while (fs.existsSync(path.join(vaultPath, slug))) {
    slug = `${base}-${i}`;
    i++;
  }
  return slug;
}

export const BINARY_MIME: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

/** Active agent sessions, keyed by session ID */
export const activeSessions = new Map<string, AbortController>();

// ── Uploads dir ──

export const uploadsDir = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// ── Helpers ──

export function readAnnotationPrompt(): string | null {
  try {
    if (fs.existsSync(ANNOTATION_PROMPT_FILE)) {
      const text = fs.readFileSync(ANNOTATION_PROMPT_FILE, 'utf-8').trim();
      return text || null;
    }
  } catch {}
  return null;
}

export function parseFrontmatter(content: string): Record<string, any> | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end).trim();
  const result: Record<string, any> = {};
  for (const line of fm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val: any = line.slice(colon + 1).trim();
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (val === 'null') val = null;
    else if (/^\d+$/.test(val)) val = parseInt(val);
    result[key] = val;
  }
  return result;
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

export function rewriteProxyHtml(htmlStr: string, baseUrl: string): string {
  const { URL } = require('url');
  let parsedBase: URL;
  try { parsedBase = new URL(baseUrl); } catch { return htmlStr; }

  function resolveUrl(val: string): string {
    if (!val) return val;
    if (/^(https?:|data:|javascript:|#|mailto:)/i.test(val)) return val;
    try { return new URL(val, baseUrl).href; } catch { return val; }
  }

  let result = htmlStr.replace(/<((?:img|script|link|a|iframe|video|audio|source|form)[^>]*?)>/gi, (match, inner) => {
    let tag = inner as string;
    for (const attr of ['src', 'href', 'action', 'poster']) {
      const re = new RegExp(`(${attr}\\s*=\\s*")([^"]*)(")`, 'i');
      tag = tag.replace(re, (_m: string, pre: string, val: string, post: string) => {
        const resolved = resolveUrl(val);
        return pre + resolved + post;
      });
      const reSingle = new RegExp(`(${attr}\\s*=\\s*')([^']*)(')`, 'i');
      tag = tag.replace(reSingle, (_m: string, pre: string, val: string, post: string) => {
        const resolved = resolveUrl(val);
        return pre + resolved + post;
      });
    }
    return '<' + tag + '>';
  });

  result = result.replace(/<img([^>]*?)>/gi, (_match, attrs) => {
    let tag = attrs as string;
    tag = tag.replace(/src\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m: string, url: string) => {
      if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) return `src="${url}"`;
      return `src="/api/image-proxy?url=${encodeURIComponent(url)}"`;
    });
    tag = tag.replace(/srcset\s*=\s*"([^"]+)"/gi, (_m: string, srcset: string) => {
      const rewritten = srcset.replace(/(\S+)(\s+[^,]*)/g, (_sm: string, surl: string, rest: string) => {
        if (surl.startsWith('http://') || surl.startsWith('https://')) {
          if (surl.startsWith('http://localhost') || surl.startsWith('https://localhost')) return surl + rest;
          return '/api/image-proxy?url=' + encodeURIComponent(surl) + rest;
        }
        return surl + rest;
      });
      return `srcset="${rewritten}"`;
    });
    return '<img' + tag + '>';
  });

  result = result.replace(/<a([^>]*?)>/gi, (_match, attrs) => {
    let tag = attrs as string;
    tag = tag.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (_m: string, href: string) => {
      try {
        const parsedHref = new URL(href);
        if (parsedHref.hostname === parsedBase.hostname) {
          return `href="/api/browse-proxy?url=${encodeURIComponent(href)}"`;
        }
      } catch {}
      return `href="${href}"`;
    });
    return '<a' + tag + '>';
  });

  return result;
}
