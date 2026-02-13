import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-passwords.js
// ──────────────────────────────────────────────────────────

/**
 * Generate password storage key from origin and username
 */
function generatePasswordKey(origin, username) {
  return origin + '|' + username;
}

/**
 * Check if password save should be deduplicated
 */
function shouldDeduplicateSave(lastSubmit, currentOrigin, currentUsername, nowMs) {
  if (!lastSubmit) return false;
  if (lastSubmit.origin !== currentOrigin) return false;
  if (lastSubmit.username !== currentUsername) return false;
  const timeDiff = nowMs - lastSubmit.ts;
  return timeDiff < 2000; // Within 2 seconds
}

/**
 * Escape JavaScript string for injection
 */
function escapeJsString(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Parse URL to extract origin
 */
function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return null;
  }
}

/**
 * Validate password data before saving
 */
function validatePasswordData(data) {
  if (!data) return false;
  if (!data.password) return false;
  if (!data.origin) return false;
  return true;
}

/**
 * Generate display text for username
 */
function getDisplayUsername(username) {
  return username || 'this site';
}

/**
 * Check if field name matches username patterns
 */
function isUsernameField(name, id, autocomplete, placeholder) {
  const combined = (
    (name || '').toLowerCase() +
    (id || '').toLowerCase() +
    (autocomplete || '').toLowerCase() +
    (placeholder || '').toLowerCase()
  );
  return /user|email|login|account|name/.test(combined);
}

/**
 * Filter password entries for display
 */
function filterPasswordEntries(entries) {
  if (!entries || !Array.isArray(entries)) return [];
  return entries.filter(e => e && e.id);
}

/**
 * Format password entry for picker
 */
function formatPasswordEntry(entry) {
  return {
    id: entry.id,
    displayText: entry.username || 'No username'
  };
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Password Storage Key Generation', () => {
  it('should combine origin and username', () => {
    expect(generatePasswordKey('https://example.com', 'alice'))
      .toBe('https://example.com|alice');
  });

  it('should handle empty username', () => {
    expect(generatePasswordKey('https://example.com', ''))
      .toBe('https://example.com|');
  });

  it('should preserve special characters', () => {
    expect(generatePasswordKey('https://example.com', 'user@email.com'))
      .toBe('https://example.com|user@email.com');
  });

  it('should create unique keys for different users on same site', () => {
    const key1 = generatePasswordKey('https://example.com', 'alice');
    const key2 = generatePasswordKey('https://example.com', 'bob');
    expect(key1).not.toBe(key2);
  });

  it('should create unique keys for same user on different sites', () => {
    const key1 = generatePasswordKey('https://example.com', 'alice');
    const key2 = generatePasswordKey('https://other.com', 'alice');
    expect(key1).not.toBe(key2);
  });
});

describe('Password Save Deduplication', () => {
  it('should not deduplicate when no last submit', () => {
    expect(shouldDeduplicateSave(null, 'https://example.com', 'alice', Date.now()))
      .toBe(false);
  });

  it('should deduplicate within 2 seconds', () => {
    const now = Date.now();
    const lastSubmit = {
      origin: 'https://example.com',
      username: 'alice',
      ts: now - 1000 // 1 second ago
    };
    expect(shouldDeduplicateSave(lastSubmit, 'https://example.com', 'alice', now))
      .toBe(true);
  });

  it('should not deduplicate after 2 seconds', () => {
    const now = Date.now();
    const lastSubmit = {
      origin: 'https://example.com',
      username: 'alice',
      ts: now - 3000 // 3 seconds ago
    };
    expect(shouldDeduplicateSave(lastSubmit, 'https://example.com', 'alice', now))
      .toBe(false);
  });

  it('should not deduplicate different origin', () => {
    const now = Date.now();
    const lastSubmit = {
      origin: 'https://example.com',
      username: 'alice',
      ts: now - 500
    };
    expect(shouldDeduplicateSave(lastSubmit, 'https://other.com', 'alice', now))
      .toBe(false);
  });

  it('should not deduplicate different username', () => {
    const now = Date.now();
    const lastSubmit = {
      origin: 'https://example.com',
      username: 'alice',
      ts: now - 500
    };
    expect(shouldDeduplicateSave(lastSubmit, 'https://example.com', 'bob', now))
      .toBe(false);
  });

  it('should deduplicate at exactly 2 seconds boundary', () => {
    const now = Date.now();
    const lastSubmit = {
      origin: 'https://example.com',
      username: 'alice',
      ts: now - 1999 // Just under 2 seconds
    };
    expect(shouldDeduplicateSave(lastSubmit, 'https://example.com', 'alice', now))
      .toBe(true);
  });
});

describe('JavaScript String Escaping', () => {
  it('should escape backslashes', () => {
    expect(escapeJsString('C:\\path\\file')).toBe('C:\\\\path\\\\file');
  });

  it('should escape single quotes', () => {
    expect(escapeJsString("it's")).toBe("it\\'s");
  });

  it('should escape both backslashes and quotes', () => {
    expect(escapeJsString("path\\with'quote")).toBe("path\\\\with\\'quote");
  });

  it('should handle empty string', () => {
    expect(escapeJsString('')).toBe('');
  });

  it('should handle string without special chars', () => {
    expect(escapeJsString('simple')).toBe('simple');
  });

  it('should handle password with special characters', () => {
    const password = "p@ss'w\\ord";
    expect(escapeJsString(password)).toBe("p@ss\\'w\\\\ord");
  });
});

describe('Origin Extraction', () => {
  it('should extract origin from HTTPS URL', () => {
    expect(extractOrigin('https://example.com/path'))
      .toBe('https://example.com');
  });

  it('should extract origin from HTTP URL', () => {
    expect(extractOrigin('http://example.com/path'))
      .toBe('http://example.com');
  });

  it('should include port in origin', () => {
    expect(extractOrigin('https://example.com:8080/path'))
      .toBe('https://example.com:8080');
  });

  it('should return null for invalid URL', () => {
    expect(extractOrigin('not a url')).toBeNull();
  });

  it('should handle subdomain', () => {
    expect(extractOrigin('https://sub.example.com/path'))
      .toBe('https://sub.example.com');
  });

  it('should strip path and query', () => {
    expect(extractOrigin('https://example.com/path?query=1'))
      .toBe('https://example.com');
  });

  it('should handle localhost', () => {
    expect(extractOrigin('http://localhost:3000/app'))
      .toBe('http://localhost:3000');
  });
});

describe('Password Data Validation', () => {
  it('should validate complete data', () => {
    expect(validatePasswordData({
      origin: 'https://example.com',
      username: 'alice',
      password: 'secret'
    })).toBe(true);
  });

  it('should reject missing password', () => {
    expect(validatePasswordData({
      origin: 'https://example.com',
      username: 'alice'
    })).toBe(false);
  });

  it('should reject empty password', () => {
    expect(validatePasswordData({
      origin: 'https://example.com',
      username: 'alice',
      password: ''
    })).toBe(false);
  });

  it('should reject missing origin', () => {
    expect(validatePasswordData({
      username: 'alice',
      password: 'secret'
    })).toBe(false);
  });

  it('should reject null data', () => {
    expect(validatePasswordData(null)).toBe(false);
  });

  it('should reject undefined data', () => {
    expect(validatePasswordData(undefined)).toBe(false);
  });

  it('should allow missing username', () => {
    expect(validatePasswordData({
      origin: 'https://example.com',
      password: 'secret'
    })).toBe(true);
  });
});

describe('Display Username Generation', () => {
  it('should return username when present', () => {
    expect(getDisplayUsername('alice')).toBe('alice');
  });

  it('should return "this site" for empty username', () => {
    expect(getDisplayUsername('')).toBe('this site');
  });

  it('should return "this site" for null', () => {
    expect(getDisplayUsername(null)).toBe('this site');
  });

  it('should return "this site" for undefined', () => {
    expect(getDisplayUsername(undefined)).toBe('this site');
  });

  it('should preserve special characters in username', () => {
    expect(getDisplayUsername('user@email.com')).toBe('user@email.com');
  });
});

describe('Username Field Detection', () => {
  it('should detect "username" in name', () => {
    expect(isUsernameField('username', '', '', '')).toBe(true);
  });

  it('should detect "email" in id', () => {
    expect(isUsernameField('', 'email', '', '')).toBe(true);
  });

  it('should detect "login" in autocomplete', () => {
    expect(isUsernameField('', '', 'login', '')).toBe(true);
  });

  it('should detect "account" in placeholder', () => {
    expect(isUsernameField('', '', '', 'account')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(isUsernameField('USERNAME', '', '', '')).toBe(true);
    expect(isUsernameField('', 'Email', '', '')).toBe(true);
  });

  it('should detect partial matches', () => {
    expect(isUsernameField('user_name', '', '', '')).toBe(true);
    expect(isUsernameField('', 'email-field', '', '')).toBe(true);
  });

  it('should reject non-username fields', () => {
    expect(isUsernameField('age', 'number', '', 'Enter age')).toBe(false);
  });

  it('should handle empty inputs', () => {
    expect(isUsernameField('', '', '', '')).toBe(false);
  });

  it('should handle null inputs', () => {
    expect(isUsernameField(null, null, null, null)).toBe(false);
  });
});

describe('Password Entry Filtering', () => {
  it('should filter valid entries', () => {
    const entries = [
      { id: '1', username: 'alice' },
      { id: '2', username: 'bob' }
    ];
    expect(filterPasswordEntries(entries)).toHaveLength(2);
  });

  it('should remove entries without id', () => {
    const entries = [
      { id: '1', username: 'alice' },
      { username: 'bob' },
      { id: '3', username: 'charlie' }
    ];
    const filtered = filterPasswordEntries(entries);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe('1');
    expect(filtered[1].id).toBe('3');
  });

  it('should handle empty array', () => {
    expect(filterPasswordEntries([])).toEqual([]);
  });

  it('should handle null', () => {
    expect(filterPasswordEntries(null)).toEqual([]);
  });

  it('should handle undefined', () => {
    expect(filterPasswordEntries(undefined)).toEqual([]);
  });

  it('should remove null entries', () => {
    const entries = [
      { id: '1', username: 'alice' },
      null,
      { id: '2', username: 'bob' }
    ];
    const filtered = filterPasswordEntries(entries);
    expect(filtered).toHaveLength(2);
  });
});

describe('Password Entry Formatting', () => {
  it('should format entry with username', () => {
    const entry = { id: '123', username: 'alice' };
    const formatted = formatPasswordEntry(entry);
    expect(formatted).toEqual({
      id: '123',
      displayText: 'alice'
    });
  });

  it('should format entry without username', () => {
    const entry = { id: '123' };
    const formatted = formatPasswordEntry(entry);
    expect(formatted).toEqual({
      id: '123',
      displayText: 'No username'
    });
  });

  it('should format entry with empty username', () => {
    const entry = { id: '123', username: '' };
    const formatted = formatPasswordEntry(entry);
    expect(formatted).toEqual({
      id: '123',
      displayText: 'No username'
    });
  });

  it('should preserve id', () => {
    const entry = { id: 'abc-def-ghi', username: 'test' };
    const formatted = formatPasswordEntry(entry);
    expect(formatted.id).toBe('abc-def-ghi');
  });
});
