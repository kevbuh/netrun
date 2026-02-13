import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-sessions.js
// ──────────────────────────────────────────────────────────

/**
 * Parse tab sessions from storage
 */
function parseTabSessions(storageValue) {
  try {
    return JSON.parse(storageValue || '[]');
  } catch {
    return [];
  }
}

/**
 * Serialize tab sessions for storage
 */
function serializeTabSessions(sessions) {
  return JSON.stringify(sessions);
}

/**
 * Create session data from tabs
 */
function createSessionData(name, tabs) {
  return {
    name,
    tabs: tabs.map(t => ({ url: t.url, title: t.title })),
    savedAt: Date.now()
  };
}

/**
 * Count tabs in session (handles both old and new formats)
 */
function countSessionTabs(session) {
  if (session.tabs) return session.tabs.length;
  if (session.windows) return session.windows.reduce((n, w) => n + w.tabs.length, 0);
  return 0;
}

/**
 * Count windows in session
 */
function countSessionWindows(session) {
  if (session.windows) return session.windows.length;
  return 1;
}

/**
 * Format session subtitle
 */
function formatSessionSubtitle(session) {
  const count = countSessionTabs(session);
  const winCount = countSessionWindows(session);
  const date = new Date(session.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (winCount > 1) {
    return `${winCount} windows · ${count} tabs · ${date}`;
  }
  return `${count} tab${count !== 1 ? 's' : ''} · ${date}`;
}

/**
 * Filter saveable tabs (not blank, has URL)
 */
function filterSaveableTabs(tabs) {
  return tabs.filter(t => !t.blank && t.url);
}

/**
 * Validate session name
 */
function isValidSessionName(name) {
  return typeof name === 'string' && name.trim().length > 0;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Tab Sessions Parsing', () => {
  it('should parse empty array from empty string', () => {
    expect(parseTabSessions('')).toEqual([]);
  });

  it('should parse empty array from null', () => {
    expect(parseTabSessions(null)).toEqual([]);
  });

  it('should parse valid JSON array', () => {
    const json = JSON.stringify([
      { name: 'Session 1', tabs: [], savedAt: Date.now() }
    ]);
    const result = parseTabSessions(json);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Session 1');
  });

  it('should return empty array for invalid JSON', () => {
    expect(parseTabSessions('{')).toEqual([]);
    expect(parseTabSessions('not json')).toEqual([]);
  });

  it('should handle complex session data', () => {
    const sessions = [
      {
        name: 'Work',
        tabs: [
          { url: 'https://example.com', title: 'Example' }
        ],
        savedAt: 1234567890
      },
      {
        name: 'Research',
        tabs: [
          { url: 'https://arxiv.org/abs/1234', title: 'Paper' }
        ],
        savedAt: 1234567891
      }
    ];
    const json = JSON.stringify(sessions);
    const result = parseTabSessions(json);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Work');
    expect(result[1].tabs[0].url).toBe('https://arxiv.org/abs/1234');
  });
});

describe('Tab Sessions Serialization', () => {
  it('should serialize empty array', () => {
    expect(serializeTabSessions([])).toBe('[]');
  });

  it('should serialize session data', () => {
    const sessions = [
      { name: 'Test', tabs: [], savedAt: 123 }
    ];
    const result = serializeTabSessions(sessions);
    expect(result).toBe(JSON.stringify(sessions));
  });

  it('should round-trip serialize and parse', () => {
    const original = [
      {
        name: 'Session',
        tabs: [{ url: 'https://example.com', title: 'Example' }],
        savedAt: Date.now()
      }
    ];
    const serialized = serializeTabSessions(original);
    const parsed = parseTabSessions(serialized);
    expect(parsed).toEqual(original);
  });
});

describe('Session Data Creation', () => {
  it('should create session with name and tabs', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example', id: 1 },
      { url: 'https://test.com', title: 'Test', id: 2 }
    ];
    const session = createSessionData('My Session', tabs);

    expect(session.name).toBe('My Session');
    expect(session.tabs).toHaveLength(2);
    expect(session.tabs[0]).toEqual({ url: 'https://example.com', title: 'Example' });
    expect(session.savedAt).toBeGreaterThan(0);
  });

  it('should only store url and title', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example', id: 1, pinned: true, groupId: 5 }
    ];
    const session = createSessionData('Test', tabs);

    expect(session.tabs[0]).toEqual({ url: 'https://example.com', title: 'Example' });
    expect(session.tabs[0]).not.toHaveProperty('id');
    expect(session.tabs[0]).not.toHaveProperty('pinned');
  });

  it('should set timestamp', () => {
    const now = Date.now();
    const session = createSessionData('Test', []);

    expect(session.savedAt).toBeGreaterThanOrEqual(now);
    expect(session.savedAt).toBeLessThanOrEqual(Date.now());
  });

  it('should handle empty tabs', () => {
    const session = createSessionData('Empty', []);
    expect(session.tabs).toEqual([]);
  });
});

describe('Session Tab Counting', () => {
  it('should count tabs in simple session', () => {
    const session = {
      name: 'Test',
      tabs: [
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
        { url: 'https://c.com', title: 'C' }
      ],
      savedAt: Date.now()
    };
    expect(countSessionTabs(session)).toBe(3);
  });

  it('should count tabs across multiple windows', () => {
    const session = {
      name: 'Multi-window',
      windows: [
        { tabs: [{ url: 'a' }, { url: 'b' }] },
        { tabs: [{ url: 'c' }, { url: 'd' }, { url: 'e' }] },
        { tabs: [{ url: 'f' }] }
      ],
      savedAt: Date.now()
    };
    expect(countSessionTabs(session)).toBe(6);
  });

  it('should return 0 for empty session', () => {
    expect(countSessionTabs({ name: 'Empty', tabs: [], savedAt: 0 })).toBe(0);
  });

  it('should handle session without tabs or windows', () => {
    expect(countSessionTabs({ name: 'Invalid', savedAt: 0 })).toBe(0);
  });
});

describe('Session Window Counting', () => {
  it('should return 1 for simple session', () => {
    const session = {
      name: 'Simple',
      tabs: [{ url: 'https://example.com' }],
      savedAt: Date.now()
    };
    expect(countSessionWindows(session)).toBe(1);
  });

  it('should count multiple windows', () => {
    const session = {
      name: 'Multi',
      windows: [
        { tabs: [] },
        { tabs: [] },
        { tabs: [] }
      ],
      savedAt: Date.now()
    };
    expect(countSessionWindows(session)).toBe(3);
  });

  it('should handle empty windows array', () => {
    const session = {
      name: 'No Windows',
      windows: [],
      savedAt: Date.now()
    };
    expect(countSessionWindows(session)).toBe(0);
  });
});

describe('Session Subtitle Formatting', () => {
  it('should format single-window session', () => {
    const session = {
      name: 'Test',
      tabs: [{ url: 'a' }, { url: 'b' }, { url: 'c' }],
      savedAt: new Date('2024-01-15').getTime()
    };
    const subtitle = formatSessionSubtitle(session);
    expect(subtitle).toContain('3 tabs');
    expect(subtitle).toContain('Jan');
    expect(subtitle).toContain('15');
  });

  it('should use singular "tab" for one tab', () => {
    const session = {
      name: 'Single',
      tabs: [{ url: 'a' }],
      savedAt: new Date('2024-01-15').getTime()
    };
    const subtitle = formatSessionSubtitle(session);
    expect(subtitle).toContain('1 tab');
    expect(subtitle).not.toContain('1 tabs');
  });

  it('should format multi-window session', () => {
    const session = {
      name: 'Multi',
      windows: [
        { tabs: [{ url: 'a' }, { url: 'b' }] },
        { tabs: [{ url: 'c' }] }
      ],
      savedAt: new Date('2024-02-20').getTime()
    };
    const subtitle = formatSessionSubtitle(session);
    expect(subtitle).toContain('2 windows');
    expect(subtitle).toContain('3 tabs');
    expect(subtitle).toContain('Feb');
    expect(subtitle).toContain('20');
  });

  it('should include date in locale format', () => {
    const session = {
      name: 'Test',
      tabs: [],
      savedAt: new Date('2024-12-25').getTime()
    };
    const subtitle = formatSessionSubtitle(session);
    expect(subtitle).toContain('Dec');
    expect(subtitle).toContain('25');
  });
});

describe('Saveable Tab Filtering', () => {
  it('should filter out blank tabs', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example', blank: false },
      { url: '', title: 'New Tab', blank: true },
      { url: 'https://test.com', title: 'Test', blank: false }
    ];
    const result = filterSaveableTabs(tabs);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('https://example.com');
    expect(result[1].url).toBe('https://test.com');
  });

  it('should filter out tabs without URL', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example' },
      { url: '', title: 'No URL' },
      { url: null, title: 'Null URL' },
      { title: 'Undefined URL' }
    ];
    const result = filterSaveableTabs(tabs);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com');
  });

  it('should return empty array for all blank tabs', () => {
    const tabs = [
      { url: '', title: 'Blank 1', blank: true },
      { url: '', title: 'Blank 2', blank: true }
    ];
    expect(filterSaveableTabs(tabs)).toEqual([]);
  });

  it('should keep tabs with URL even if not blank flag', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example' }
    ];
    const result = filterSaveableTabs(tabs);
    expect(result).toHaveLength(1);
  });

  it('should handle empty array', () => {
    expect(filterSaveableTabs([])).toEqual([]);
  });
});

describe('Session Name Validation', () => {
  it('should accept valid names', () => {
    expect(isValidSessionName('My Session')).toBe(true);
    expect(isValidSessionName('Work 2024')).toBe(true);
    expect(isValidSessionName('a')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(isValidSessionName('')).toBe(false);
  });

  it('should reject whitespace-only', () => {
    expect(isValidSessionName('   ')).toBe(false);
    expect(isValidSessionName('\t\n')).toBe(false);
  });

  it('should reject non-strings', () => {
    expect(isValidSessionName(null)).toBe(false);
    expect(isValidSessionName(undefined)).toBe(false);
    expect(isValidSessionName(123)).toBe(false);
    expect(isValidSessionName({})).toBe(false);
  });

  it('should trim and validate', () => {
    // Note: isValidSessionName doesn't trim, just checks if trim().length > 0
    expect(isValidSessionName('  test  ')).toBe(true);
  });
});
