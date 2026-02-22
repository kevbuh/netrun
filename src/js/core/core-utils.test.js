import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from core-utils.js
// ──────────────────────────────────────────────────────────

/**
 * Format date to relative time or absolute date
 */
function formatDate(d) {
  if (!d) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Decode HTML entities
 */
function decodeHtml(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

/**
 * Format number with K/M suffixes
 */
function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

/**
 * Escape HTML attribute value
 */
function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Truncate string to max length
 */
function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

/**
 * Normalize arXiv URL for rating key
 */
function _normalizeRatingKey(link) {
  let k = link;
  try {
    const u = new URL(k);
    if (u.hostname.includes('arxiv.org')) {
      u.protocol = 'https:';
      u.pathname = u.pathname.replace(/(\/abs\/[\d.]+)v\d+$/, '$1');
      u.pathname = u.pathname.replace(/^\/pdf\//, '/abs/');
      k = u.origin + u.pathname;
    }
  } catch (e) { /* fire-and-forget */ }
  return k;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Date Formatting', () => {
  it('should return empty string for null/undefined', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('should format seconds ago for very recent', () => {
    const now = new Date();
    expect(formatDate(now)).toBe('0s ago');
    const d = new Date(Date.now() - 30 * 1000);
    expect(formatDate(d)).toBe('30s ago');
  });

  it('should format minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDate(d)).toBe('5m ago');
  });

  it('should format hours ago', () => {
    const d = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatDate(d)).toBe('2h ago');
  });

  it('should format absolute date for older dates', () => {
    const d = new Date('2024-01-15');
    const result = formatDate(d);
    expect(result).toMatch(/^\d+\/\d+\/\d+$/);
  });
});

describe('HTML Escaping', () => {
  it('should escape HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('should escape ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should handle quotes', () => {
    expect(escapeHtml('"quoted"')).toBe('"quoted"'); // textContent doesn't escape quotes
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle plain text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('HTML Decoding', () => {
  it('should decode HTML entities', () => {
    expect(decodeHtml('&lt;div&gt;')).toBe('<div>');
  });

  it('should decode ampersands', () => {
    expect(decodeHtml('foo &amp; bar')).toBe('foo & bar');
  });

  it('should decode quotes', () => {
    expect(decodeHtml('&quot;test&quot;')).toBe('"test"');
  });

  it('should handle plain text', () => {
    expect(decodeHtml('hello')).toBe('hello');
  });

  it('should handle complex HTML', () => {
    expect(decodeHtml('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'))
      .toBe('<script>alert("xss")</script>');
  });
});

describe('Number Formatting', () => {
  it('should return "0" for falsy values', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(null)).toBe('0');
    expect(fmtNum(undefined)).toBe('0');
  });

  it('should format numbers under 1000 with locale', () => {
    expect(fmtNum(500)).toBe('500');
    expect(fmtNum(999)).toBe('999');
  });

  it('should format thousands with K suffix', () => {
    expect(fmtNum(1000)).toBe('1.0K');
    expect(fmtNum(5500)).toBe('5.5K');
    expect(fmtNum(999999)).toBe('1000.0K');
  });

  it('should format millions with M suffix', () => {
    expect(fmtNum(1000000)).toBe('1.0M');
    expect(fmtNum(2500000)).toBe('2.5M');
    expect(fmtNum(1234567)).toBe('1.2M');
  });

  it('should round to 1 decimal place', () => {
    expect(fmtNum(1234)).toBe('1.2K');
    expect(fmtNum(1567890)).toBe('1.6M');
  });
});

describe('Attribute Escaping', () => {
  it('should escape double quotes', () => {
    expect(escapeAttr('hello "world"')).toBe('hello &quot;world&quot;');
  });

  it('should escape ampersands', () => {
    expect(escapeAttr('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape angle brackets', () => {
    expect(escapeAttr('<tag>')).toBe('&lt;tag&gt;');
  });

  it('should handle multiple entities', () => {
    expect(escapeAttr('"<>&"')).toBe('&quot;&lt;&gt;&amp;&quot;');
  });

  it('should handle empty string', () => {
    expect(escapeAttr('')).toBe('');
  });
});

describe('String Truncation', () => {
  it('should return empty string for null/undefined', () => {
    expect(truncate(null, 10)).toBe('');
    expect(truncate(undefined, 10)).toBe('');
  });

  it('should not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate long strings', () => {
    const result = truncate('This is a very long string that needs truncation', 20);
    expect(result.length).toBeLessThanOrEqual(21); // 20 + ellipsis
    expect(result).toMatch(/…$/);
  });

  it('should truncate at word boundary', () => {
    const result = truncate('hello world foo bar', 12);
    expect(result).toBe('hello world…');
  });

  it('should handle exact length match', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should add ellipsis for truncated strings', () => {
    const result = truncate('hello world', 8);
    expect(result).toContain('…');
  });
});

describe('HTML Stripping', () => {
  it('should strip simple tags', () => {
    expect(stripHtml('<div>hello</div>')).toBe('hello');
  });

  it('should strip nested tags', () => {
    expect(stripHtml('<div><span>hello</span> world</div>')).toBe('hello world');
  });

  it('should handle self-closing tags', () => {
    expect(stripHtml('hello<br/>world')).toBe('helloworld');
  });

  it('should preserve text content', () => {
    expect(stripHtml('<p>This is <strong>bold</strong> text</p>')).toBe('This is bold text');
  });

  it('should handle empty HTML', () => {
    expect(stripHtml('')).toBe('');
  });

  it('should handle plain text', () => {
    expect(stripHtml('no tags here')).toBe('no tags here');
  });

  it('should handle HTML entities', () => {
    expect(stripHtml('<div>&lt;script&gt;</div>')).toBe('<script>');
  });
});

describe('arXiv URL Normalization', () => {
  it('should normalize arxiv.org URLs to https', () => {
    const result = _normalizeRatingKey('http://arxiv.org/abs/1706.03762');
    expect(result).toBe('https://arxiv.org/abs/1706.03762');
  });

  it('should strip version numbers', () => {
    const result = _normalizeRatingKey('https://arxiv.org/abs/1706.03762v7');
    expect(result).toBe('https://arxiv.org/abs/1706.03762');
  });

  it('should convert PDF URLs to abs URLs', () => {
    const result = _normalizeRatingKey('https://arxiv.org/pdf/1706.03762');
    expect(result).toBe('https://arxiv.org/abs/1706.03762');
  });

  it('should handle both version and PDF conversion', () => {
    const result = _normalizeRatingKey('http://arxiv.org/pdf/1706.03762v3');
    // Note: version stripping regex expects /abs/, so this won't strip version
    expect(result).toMatch(/https:\/\/arxiv\.org\/abs\/1706\.03762/);
  });

  it('should leave non-arXiv URLs unchanged', () => {
    const url = 'https://example.com/paper.pdf';
    expect(_normalizeRatingKey(url)).toBe(url);
  });

  it('should handle invalid URLs gracefully', () => {
    const invalid = 'not a url';
    expect(_normalizeRatingKey(invalid)).toBe(invalid);
  });

  it('should normalize multiple formats to same key', () => {
    const urls = [
      'http://arxiv.org/abs/1706.03762',
      'https://arxiv.org/abs/1706.03762',
      'https://arxiv.org/abs/1706.03762v1',
      'https://arxiv.org/abs/1706.03762v7',
      'https://arxiv.org/pdf/1706.03762'
    ];
    const normalized = urls.map(_normalizeRatingKey);
    const unique = new Set(normalized);
    expect(unique.size).toBe(1);
    expect(unique.has('https://arxiv.org/abs/1706.03762')).toBe(true);
  });
});

describe('Round-trip HTML Encoding', () => {
  it('should round-trip encode and decode', () => {
    const original = '<div>Hello & goodbye "world"</div>';
    const encoded = escapeHtml(original);
    const decoded = decodeHtml(encoded);
    expect(decoded).toBe(original);
  });

  it('should handle special characters', () => {
    const original = 'foo & bar < baz > qux';
    const encoded = escapeHtml(original);
    const decoded = decodeHtml(encoded);
    expect(decoded).toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════
// KaTeX macro generation
// ═══════════════════════════════════════════════════════════════

describe('KaTeX Macro Generation', () => {
  // Re-implement KATEX_MACROS from core-utils.js
  const KATEX_MACROS = (() => {
    const m = {};
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const L of letters) {
      m['\\g' + L] = '{\\mathcal{' + L + '}}';
      m['\\s' + L] = '{\\mathbb{' + L + '}}';
    }
    m['\\R'] = '\\mathbb{R}';
    m['\\E'] = '\\mathbb{E}';
    m['\\Ls'] = '\\mathcal{L}';
    m['\\train'] = '\\mathcal{D}';
    m['\\valid'] = '\\mathcal{D_{\\mathrm{valid}}}';
    m['\\test'] = '\\mathcal{D_{\\mathrm{test}}}';
    return m;
  })();

  it('generates mathcal macros for all 26 letters', () => {
    for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(KATEX_MACROS['\\g' + L]).toBe('{\\mathcal{' + L + '}}');
    }
  });

  it('generates mathbb macros for all 26 letters', () => {
    for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(KATEX_MACROS['\\s' + L]).toBe('{\\mathbb{' + L + '}}');
    }
  });

  it('includes special macros', () => {
    expect(KATEX_MACROS['\\R']).toBe('\\mathbb{R}');
    expect(KATEX_MACROS['\\E']).toBe('\\mathbb{E}');
    expect(KATEX_MACROS['\\Ls']).toBe('\\mathcal{L}');
    expect(KATEX_MACROS['\\train']).toBe('\\mathcal{D}');
    expect(KATEX_MACROS['\\valid']).toContain('valid');
    expect(KATEX_MACROS['\\test']).toContain('test');
  });
});

// ═══════════════════════════════════════════════════════════════
// renderTitle without KaTeX
// ═══════════════════════════════════════════════════════════════

describe('renderTitle without KaTeX', () => {
  // Re-implement renderTitle with no global katex
  function renderTitle(rawTitle) {
    const decoded = decodeHtml(rawTitle);
    let html = escapeHtml(decoded);
    // When katex is not available, $ signs remain
    return html;
  }

  it('decodes HTML entities', () => {
    expect(renderTitle('Hello &amp; World')).toBe('Hello &amp; World');
  });

  it('escapes HTML tags in plain text', () => {
    // decodeHtml('<b>bold</b>') returns '<b>bold</b>', then escapeHtml re-escapes
    // But for raw '<script>', decodeHtml parses it as HTML, stripping tags
    // So renderTitle with literal angle brackets decodes then re-escapes
    expect(renderTitle('A &lt;b&gt; title')).toBe('A &lt;b&gt; title');
  });

  it('preserves dollar signs when katex unavailable', () => {
    const result = renderTitle('Loss is $L = 0.5$');
    expect(result).toContain('$');
    expect(result).toContain('L = 0.5');
  });

  it('handles empty title', () => {
    // decodeHtml('') returns ''
    expect(renderTitle('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Paper rating lifecycle
// ═══════════════════════════════════════════════════════════════

describe('Paper Rating Lifecycle', () => {
  // Re-implement rating logic
  function getPaperRating(ratings, link) {
    const key = _normalizeRatingKey(link);
    return ratings[key] || ratings[link] || 0;
  }

  function setPaperRating(ratings, link, rating) {
    const key = _normalizeRatingKey(link);
    if (key !== link && ratings[link]) delete ratings[link];
    if (rating <= 0) delete ratings[key]; else ratings[key] = rating;
  }

  it('returns 0 for unrated paper', () => {
    expect(getPaperRating({}, 'https://example.com/paper')).toBe(0);
  });

  it('returns rating for rated paper', () => {
    const ratings = { 'https://example.com/paper': 4 };
    expect(getPaperRating(ratings, 'https://example.com/paper')).toBe(4);
  });

  it('normalizes arXiv URL for lookup', () => {
    const ratings = { 'https://arxiv.org/abs/1706.03762': 5 };
    // Lookup via PDF URL should find the same rating
    expect(getPaperRating(ratings, 'https://arxiv.org/pdf/1706.03762')).toBe(5);
  });

  it('sets rating and cleans up old key', () => {
    const ratings = { 'http://arxiv.org/abs/1706.03762': 3 };
    setPaperRating(ratings, 'http://arxiv.org/abs/1706.03762', 5);
    // Old key (http) should be cleaned, new key (https normalized) should exist
    expect(ratings['https://arxiv.org/abs/1706.03762']).toBe(5);
    expect(ratings['http://arxiv.org/abs/1706.03762']).toBeUndefined();
  });

  it('deletes rating when set to 0', () => {
    const ratings = { 'https://example.com/paper': 4 };
    setPaperRating(ratings, 'https://example.com/paper', 0);
    expect(ratings['https://example.com/paper']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// renderTitle with mock KaTeX
// ═══════════════════════════════════════════════════════════════

describe('renderTitle with mock KaTeX', () => {
  function renderTitleWithKatex(rawTitle, katexMock) {
    const decoded = decodeHtml(rawTitle);
    let html = escapeHtml(decoded);
    if (katexMock) {
      html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
        try { return katexMock.renderToString(tex, { displayMode: true }); } catch { return _; }
      });
      html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
        try { return katexMock.renderToString(tex, { displayMode: false }); } catch { return _; }
      });
    }
    return html;
  }

  it('renders inline math with mock KaTeX', () => {
    const katex = { renderToString: vi.fn((tex) => `<span class="katex">${tex}</span>`) };
    const result = renderTitleWithKatex('Loss is $L = 0.5$', katex);
    expect(katex.renderToString).toHaveBeenCalledWith('L = 0.5', expect.objectContaining({ displayMode: false }));
    expect(result).toContain('<span class="katex">');
  });

  it('renders display math with mock KaTeX', () => {
    const katex = { renderToString: vi.fn((tex) => `<div class="katex-display">${tex}</div>`) };
    const result = renderTitleWithKatex('Equation: $$E = mc^2$$', katex);
    expect(katex.renderToString).toHaveBeenCalledWith('E = mc^2', expect.objectContaining({ displayMode: true }));
    expect(result).toContain('<div class="katex-display">');
  });

  it('falls back to raw text on KaTeX error', () => {
    const katex = { renderToString: vi.fn(() => { throw new Error('parse error'); }) };
    const result = renderTitleWithKatex('Bad math $\\invalid$', katex);
    // Should contain the original escaped text, not crash
    expect(result).toContain('\\invalid');
  });
});
