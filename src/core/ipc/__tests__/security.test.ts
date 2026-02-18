import { describe, it, expect } from 'vitest';
import * as path from 'path';

/**
 * Tests for path traversal prevention in IPC handlers.
 * Covers the validation logic used by db:read-view and db:local-file.
 */

// ── db:read-view path validation logic ──

describe('db:read-view path validation', () => {
  function validateViewPath(dataDir: string, viewPath: string): { valid: boolean; resolved: string } {
    const resolved = path.resolve(dataDir, viewPath.replace(/^\//, ''));
    const base = path.resolve(dataDir);
    const valid = resolved === base || resolved.startsWith(base + path.sep);
    return { valid, resolved };
  }

  it('allows a normal view path', () => {
    const { valid } = validateViewPath('/data', 'views/index.html');
    expect(valid).toBe(true);
  });

  it('rejects ../ traversal', () => {
    const { valid } = validateViewPath('/data', '../../etc/passwd');
    expect(valid).toBe(false);
  });

  it('rejects leading-slash stripped traversal', () => {
    const { valid } = validateViewPath('/data', '/../../etc/passwd');
    expect(valid).toBe(false);
  });

  it('allows root of dataDir', () => {
    const { valid } = validateViewPath('/data', '.');
    expect(valid).toBe(true);
  });
});

// ── db:local-file blocked directory logic ──

describe('db:local-file blocked directories', () => {
  const BLOCKED_DIRS = ['.ssh', '.gnupg', '.aws', '.config', '.netrc', '.git', '.env'];

  function isBlocked(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const parts = resolved.split(path.sep);
    return parts.some(p => BLOCKED_DIRS.includes(p));
  }

  it('blocks .ssh paths', () => {
    expect(isBlocked('/Users/me/.ssh/id_rsa')).toBe(true);
  });

  it('blocks .gnupg paths', () => {
    expect(isBlocked('/Users/me/.gnupg/private-keys-v1.d/key')).toBe(true);
  });

  it('blocks .aws paths', () => {
    expect(isBlocked('/Users/me/.aws/credentials')).toBe(true);
  });

  it('blocks .config paths', () => {
    expect(isBlocked('/Users/me/.config/secrets.json')).toBe(true);
  });

  it('blocks .git paths', () => {
    expect(isBlocked('/repo/.git/config')).toBe(true);
  });

  it('blocks .env directory paths', () => {
    expect(isBlocked('/project/.env/secrets')).toBe(true);
  });

  it('allows normal file paths', () => {
    expect(isBlocked('/Users/me/Documents/paper.pdf')).toBe(false);
  });

  it('allows paths with dot-prefixed files (not directories)', () => {
    expect(isBlocked('/Users/me/Downloads/.hidden-file.pdf')).toBe(false);
  });
});

// ── db:local-file mime allowlist logic ──

describe('db:local-file mime allowlist', () => {
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

  it('rejects unknown extensions (no octet-stream fallback)', () => {
    expect(mimeMap['.exe']).toBeUndefined();
    expect(mimeMap['.sh']).toBeUndefined();
    expect(mimeMap['.pem']).toBeUndefined();
    expect(mimeMap['.key']).toBeUndefined();
  });

  it('allows known safe extensions', () => {
    expect(mimeMap['.pdf']).toBe('application/pdf');
    expect(mimeMap['.png']).toBe('image/png');
    expect(mimeMap['.html']).toBe('text/html');
  });
});
