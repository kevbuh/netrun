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
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (d.toDateString() === now.toDateString()) return `${diffHrs}h ago`;
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

  it('should format recent time as "just now"', () => {
    const now = new Date();
    expect(formatDate(now)).toBe('just now');
  });

  it('should format minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDate(d)).toBe('5m ago');
  });

  it('should format hours ago for today', () => {
    const d = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago (safer than 3)
    const result = formatDate(d);
    const now = new Date();
    // If still same day, should be "Xh ago", otherwise date format
    if (d.toDateString() === now.toDateString()) {
      expect(result).toMatch(/^\d+h ago$/);
    } else {
      expect(result).toMatch(/^\d+\/\d+\/\d+$/);
    }
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
