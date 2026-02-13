import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-ntp.js
// ──────────────────────────────────────────────────────────

/**
 * Quick links configuration for new tab page
 */
const QUICK_LINKS = [
  { icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z', name: 'arXiv', url: 'https://arxiv.org' },
  { icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z', name: 'Papers with Code', url: 'https://paperswithcode.com' },
  { icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z', name: 'Hugging Face', url: 'https://huggingface.co' },
  { icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', name: 'GitHub', url: 'https://github.com' },
  { icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z', name: 'Semantic Scholar', url: 'https://semanticscholar.org' },
  { icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', name: 'Google Scholar', url: 'https://scholar.google.com' },
];

/**
 * Search modes for NTP
 */
const SEARCH_MODES = [
  { id: 'all', label: 'All', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z' },
  { id: 'arxiv', label: 'arXiv', icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
  { id: 'semantic', label: 'Semantic', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z' },
  { id: 'web', label: 'Web', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z' },
];

/**
 * Validate search query
 */
function isValidSearchQuery(query) {
  return typeof query === 'string' && query.trim().length > 0;
}

/**
 * Check if query looks like a URL
 */
function looksLikeUrl(query) {
  if (!query) return false;
  const trimmed = query.trim();
  // Starts with protocol
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  // Contains domain pattern
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmed)) return true;
  // localhost patterns
  if (trimmed.startsWith('localhost:')) return true;
  return false;
}

/**
 * Normalize URL (add protocol if missing)
 */
function normalizeUrl(url) {
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('localhost:')) {
    return 'http://' + trimmed;
  }
  return 'https://' + trimmed;
}

/**
 * Get search mode by ID
 */
function getSearchMode(id) {
  return SEARCH_MODES.find(m => m.id === id) || SEARCH_MODES[0];
}

/**
 * Extract filename from File object or path
 */
function extractFilename(file) {
  if (typeof file === 'object' && file && file.name) {
    return file.name;
  }
  if (typeof file === 'string') {
    return file.split('/').pop();
  }
  return 'unknown';
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
}

/**
 * Check if file is PDF
 */
function isPdfFile(file) {
  if (typeof file === 'object' && file && file.type) {
    return file.type === 'application/pdf';
  }
  if (typeof file === 'string') {
    return file.toLowerCase().endsWith('.pdf');
  }
  return false;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Quick Links', () => {
  it('should have 6 quick links', () => {
    expect(QUICK_LINKS).toHaveLength(6);
  });

  it('should include research-focused sites', () => {
    const names = QUICK_LINKS.map(l => l.name);
    expect(names).toContain('arXiv');
    expect(names).toContain('Papers with Code');
    expect(names).toContain('Semantic Scholar');
    expect(names).toContain('Google Scholar');
  });

  it('should all have required properties', () => {
    QUICK_LINKS.forEach(link => {
      expect(link).toHaveProperty('icon');
      expect(link).toHaveProperty('name');
      expect(link).toHaveProperty('url');
    });
  });

  it('should all have valid URLs', () => {
    QUICK_LINKS.forEach(link => {
      expect(link.url).toMatch(/^https?:\/\//);
    });
  });

  it('should all have unique names', () => {
    const names = QUICK_LINKS.map(l => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should all have unique URLs', () => {
    const urls = QUICK_LINKS.map(l => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('Search Modes', () => {
  it('should have 4 search modes', () => {
    expect(SEARCH_MODES).toHaveLength(4);
  });

  it('should include all, arxiv, semantic, and web', () => {
    const ids = SEARCH_MODES.map(m => m.id);
    expect(ids).toContain('all');
    expect(ids).toContain('arxiv');
    expect(ids).toContain('semantic');
    expect(ids).toContain('web');
  });

  it('should all have required properties', () => {
    SEARCH_MODES.forEach(mode => {
      expect(mode).toHaveProperty('id');
      expect(mode).toHaveProperty('label');
      expect(mode).toHaveProperty('icon');
    });
  });

  it('should have unique IDs', () => {
    const ids = SEARCH_MODES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have "all" as first mode', () => {
    expect(SEARCH_MODES[0].id).toBe('all');
  });
});

describe('Search Query Validation', () => {
  it('should accept non-empty strings', () => {
    expect(isValidSearchQuery('machine learning')).toBe(true);
    expect(isValidSearchQuery('a')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(isValidSearchQuery('')).toBe(false);
  });

  it('should reject whitespace-only', () => {
    expect(isValidSearchQuery('   ')).toBe(false);
    expect(isValidSearchQuery('\t\n')).toBe(false);
  });

  it('should reject non-strings', () => {
    expect(isValidSearchQuery(null)).toBe(false);
    expect(isValidSearchQuery(undefined)).toBe(false);
    expect(isValidSearchQuery(123)).toBe(false);
  });

  it('should trim before checking length', () => {
    expect(isValidSearchQuery('  test  ')).toBe(true);
  });
});

describe('URL Detection', () => {
  it('should detect URLs with protocol', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com')).toBe(true);
  });

  it('should detect URLs without protocol', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('arxiv.org')).toBe(true);
    expect(looksLikeUrl('sub.domain.com')).toBe(true);
  });

  it('should detect localhost', () => {
    expect(looksLikeUrl('localhost:3000')).toBe(true);
    expect(looksLikeUrl('localhost:8080')).toBe(true);
  });

  it('should not detect search queries', () => {
    expect(looksLikeUrl('machine learning')).toBe(false);
    expect(looksLikeUrl('hello world')).toBe(false);
  });

  it('should handle empty/null', () => {
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl(null)).toBe(false);
  });

  it('should trim before checking', () => {
    expect(looksLikeUrl('  https://example.com  ')).toBe(true);
  });
});

describe('URL Normalization', () => {
  it('should preserve URLs with protocol', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('should add https to URLs without protocol', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('arxiv.org')).toBe('https://arxiv.org');
  });

  it('should add http to localhost', () => {
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrl('localhost:8080')).toBe('http://localhost:8080');
  });

  it('should trim whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com');
  });
});

describe('Search Mode Lookup', () => {
  it('should find mode by ID', () => {
    expect(getSearchMode('arxiv').id).toBe('arxiv');
    expect(getSearchMode('semantic').id).toBe('semantic');
    expect(getSearchMode('web').id).toBe('web');
  });

  it('should default to "all" for unknown ID', () => {
    expect(getSearchMode('unknown').id).toBe('all');
    expect(getSearchMode('').id).toBe('all');
  });

  it('should return complete mode object', () => {
    const mode = getSearchMode('arxiv');
    expect(mode).toHaveProperty('id');
    expect(mode).toHaveProperty('label');
    expect(mode).toHaveProperty('icon');
  });
});

describe('Filename Extraction', () => {
  it('should extract from File object', () => {
    const file = { name: 'document.pdf', type: 'application/pdf' };
    expect(extractFilename(file)).toBe('document.pdf');
  });

  it('should extract from path string', () => {
    expect(extractFilename('/path/to/file.pdf')).toBe('file.pdf');
    expect(extractFilename('folder/subfolder/image.png')).toBe('image.png');
  });

  it('should handle filename without path', () => {
    expect(extractFilename('simple.txt')).toBe('simple.txt');
  });

  it('should return "unknown" for invalid input', () => {
    expect(extractFilename(null)).toBe('unknown');
    expect(extractFilename(undefined)).toBe('unknown');
    expect(extractFilename({})).toBe('unknown');
  });
});

describe('File Size Formatting', () => {
  it('should format zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(null)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatFileSize(100)).toBe('100 B');
    expect(formatFileSize(1000)).toBe('1000 B');
  });

  it('should format kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(5120)).toBe('5 KB');
  });

  it('should format megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(5242880)).toBe('5 MB');
  });

  it('should format gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });

  it('should round to 1 decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });
});

describe('PDF File Detection', () => {
  it('should detect PDF from File object type', () => {
    const file = { name: 'doc.pdf', type: 'application/pdf' };
    expect(isPdfFile(file)).toBe(true);
  });

  it('should detect PDF from filename extension', () => {
    expect(isPdfFile('document.pdf')).toBe(true);
    expect(isPdfFile('path/to/file.PDF')).toBe(true);
  });

  it('should be case-insensitive for strings', () => {
    expect(isPdfFile('file.PDF')).toBe(true);
    expect(isPdfFile('file.Pdf')).toBe(true);
  });

  it('should reject non-PDF files', () => {
    expect(isPdfFile('image.png')).toBe(false);
    expect(isPdfFile({ name: 'doc.txt', type: 'text/plain' })).toBe(false);
  });

  it('should handle invalid input', () => {
    expect(isPdfFile(null)).toBe(false);
    expect(isPdfFile(undefined)).toBe(false);
    expect(isPdfFile({})).toBe(false);
  });
});
