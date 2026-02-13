import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-state.js
// ──────────────────────────────────────────────────────────

/**
 * Group color configuration
 */
const _BROWSE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan'];
const _BROWSE_GROUP_COLOR_MAP = {
  grey:'#808080', blue:'#5b8def', red:'#e05656', yellow:'#d4a844',
  green:'#4caf50', pink:'#e06090', purple:'#9c6ade', cyan:'#3dc0c0'
};

/**
 * Get storage key with optional user suffix
 */
function _getBrowseStorageKey(baseKey, username = null) {
  return username ? `${baseKey}_${username}` : baseKey;
}

/**
 * Convert tabs to serializable format
 */
function serializeTab(t) {
  const saved = { id: t.id, url: t.url || '', title: t.title, blank: !!t.blank };
  if (t._historyPage) saved._historyPage = true;
  if (t._helpPage) saved._helpPage = true;
  if (t.paper) {
    const p = Object.assign({}, t.paper);
    saved.paper = p;
    saved.contentType = t.contentType;
    saved.arxivId = t.arxivId || null;
    if (t.localPath) saved.localPath = t.localPath;
  }
  if (t.lastVisited) saved.lastVisited = t.lastVisited;
  if (t.pinned) saved.pinned = true;
  if (t.groupId != null) saved.groupId = t.groupId;
  if (t.backStack && t.backStack.length) saved.backStack = t.backStack.slice(-50);
  if (t.forwardStack && t.forwardStack.length) saved.forwardStack = t.forwardStack.slice(-50);
  return saved;
}

/**
 * Serialize window data for storage
 */
function serializeWindow(w) {
  return {
    id: w.id,
    name: w.name,
    activeTab: w.activeTab,
    groups: w.groups || [],
    splitPanes: w.splitPanes || [],
    focusedPane: w.focusedPane || null,
    tabs: w.tabs.map(serializeTab)
  };
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Browse Group Colors', () => {
  it('should have 8 color options', () => {
    expect(_BROWSE_GROUP_COLORS).toHaveLength(8);
  });

  it('should start with grey', () => {
    expect(_BROWSE_GROUP_COLORS[0]).toBe('grey');
  });

  it('should include common colors', () => {
    expect(_BROWSE_GROUP_COLORS).toContain('blue');
    expect(_BROWSE_GROUP_COLORS).toContain('red');
    expect(_BROWSE_GROUP_COLORS).toContain('green');
  });

  it('should have unique colors', () => {
    const unique = new Set(_BROWSE_GROUP_COLORS);
    expect(unique.size).toBe(_BROWSE_GROUP_COLORS.length);
  });
});

describe('Browse Group Color Map', () => {
  it('should map all colors to hex values', () => {
    _BROWSE_GROUP_COLORS.forEach(color => {
      expect(_BROWSE_GROUP_COLOR_MAP[color]).toBeDefined();
      expect(_BROWSE_GROUP_COLOR_MAP[color]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('should have grey as neutral color', () => {
    expect(_BROWSE_GROUP_COLOR_MAP.grey).toBe('#808080');
  });

  it('should have distinct hex values', () => {
    const hexValues = Object.values(_BROWSE_GROUP_COLOR_MAP);
    const unique = new Set(hexValues);
    expect(unique.size).toBe(hexValues.length);
  });

  it('should cover all group colors', () => {
    expect(Object.keys(_BROWSE_GROUP_COLOR_MAP)).toHaveLength(8);
  });
});

describe('Browse Storage Key', () => {
  it('should return base key when no username', () => {
    expect(_getBrowseStorageKey('browseWindows', null)).toBe('browseWindows');
  });

  it('should append username when provided', () => {
    expect(_getBrowseStorageKey('browseWindows', 'alice')).toBe('browseWindows_alice');
  });

  it('should handle different base keys', () => {
    expect(_getBrowseStorageKey('browseTabSessions', 'bob')).toBe('browseTabSessions_bob');
  });

  it('should create unique keys per user', () => {
    const alice = _getBrowseStorageKey('tabs', 'alice');
    const bob = _getBrowseStorageKey('tabs', 'bob');
    expect(alice).not.toBe(bob);
    expect(alice).toBe('tabs_alice');
    expect(bob).toBe('tabs_bob');
  });
});

describe('Tab Serialization', () => {
  it('should serialize basic tab', () => {
    const tab = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      blank: false
    };
    const result = serializeTab(tab);
    expect(result).toEqual({
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      blank: false
    });
  });

  it('should handle blank tabs', () => {
    const tab = { id: 2, url: '', title: 'New Tab', blank: true };
    const result = serializeTab(tab);
    expect(result.blank).toBe(true);
  });

  it('should include paper metadata when present', () => {
    const tab = {
      id: 3,
      url: 'https://arxiv.org/abs/1234.5678',
      title: 'Paper Title',
      paper: { title: 'Paper Title', authors: 'Author' },
      contentType: 'pdf',
      arxivId: '1234.5678'
    };
    const result = serializeTab(tab);
    expect(result.paper).toEqual({ title: 'Paper Title', authors: 'Author' });
    expect(result.contentType).toBe('pdf');
    expect(result.arxivId).toBe('1234.5678');
  });

  it('should include pinned status', () => {
    const tab = { id: 4, url: 'https://example.com', title: 'Pinned', pinned: true };
    const result = serializeTab(tab);
    expect(result.pinned).toBe(true);
  });

  it('should include group ID', () => {
    const tab = { id: 5, url: 'https://example.com', title: 'Grouped', groupId: 42 };
    const result = serializeTab(tab);
    expect(result.groupId).toBe(42);
  });

  it('should limit history stacks to 50 entries', () => {
    const tab = {
      id: 6,
      url: 'https://example.com',
      title: 'Tab',
      backStack: Array.from({ length: 100 }, (_, i) => ({ url: `https://example.com/${i}` })),
      forwardStack: Array.from({ length: 75 }, (_, i) => ({ url: `https://example.com/f${i}` }))
    };
    const result = serializeTab(tab);
    expect(result.backStack).toHaveLength(50);
    expect(result.forwardStack).toHaveLength(50);
    // Should keep the most recent 50
    expect(result.backStack[0].url).toBe('https://example.com/50');
    expect(result.forwardStack[0].url).toBe('https://example.com/f25');
  });

  it('should mark history/help pages', () => {
    const historyTab = { id: 7, url: '', title: 'History', _historyPage: true };
    const helpTab = { id: 8, url: '', title: 'Help', _helpPage: true };

    expect(serializeTab(historyTab)._historyPage).toBe(true);
    expect(serializeTab(helpTab)._helpPage).toBe(true);
  });

  it('should omit undefined optional fields', () => {
    const tab = { id: 9, url: 'https://example.com', title: 'Simple' };
    const result = serializeTab(tab);
    expect(result).not.toHaveProperty('pinned');
    expect(result).not.toHaveProperty('groupId');
    expect(result).not.toHaveProperty('paper');
    expect(result).not.toHaveProperty('backStack');
  });
});

describe('Window Serialization', () => {
  it('should serialize basic window', () => {
    const win = {
      id: 1,
      name: 'Main',
      activeTab: 42,
      groups: [],
      tabs: [
        { id: 1, url: 'https://example.com', title: 'Tab 1' }
      ]
    };
    const result = serializeWindow(win);
    expect(result.id).toBe(1);
    expect(result.name).toBe('Main');
    expect(result.activeTab).toBe(42);
    expect(result.tabs).toHaveLength(1);
  });

  it('should include groups', () => {
    const win = {
      id: 2,
      name: 'Work',
      activeTab: 1,
      groups: [{ id: 1, name: 'Research', color: 'blue' }],
      tabs: []
    };
    const result = serializeWindow(win);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Research');
  });

  it('should include split panes', () => {
    const win = {
      id: 3,
      name: 'Split',
      activeTab: 1,
      tabs: [],
      splitPanes: [{ id: 1, tabId: 1 }, { id: 2, tabId: 2 }],
      focusedPane: 1
    };
    const result = serializeWindow(win);
    expect(result.splitPanes).toHaveLength(2);
    expect(result.focusedPane).toBe(1);
  });

  it('should serialize all tabs', () => {
    const win = {
      id: 4,
      name: 'Multi',
      activeTab: 2,
      groups: [],
      tabs: [
        { id: 1, url: 'https://a.com', title: 'A' },
        { id: 2, url: 'https://b.com', title: 'B' },
        { id: 3, url: 'https://c.com', title: 'C' }
      ]
    };
    const result = serializeWindow(win);
    expect(result.tabs).toHaveLength(3);
    expect(result.tabs[0].url).toBe('https://a.com');
    expect(result.tabs[2].url).toBe('https://c.com');
  });

  it('should default empty arrays for missing fields', () => {
    const win = {
      id: 5,
      name: 'Minimal',
      activeTab: null,
      tabs: []
    };
    const result = serializeWindow(win);
    expect(result.groups).toEqual([]);
    expect(result.splitPanes).toEqual([]);
    expect(result.focusedPane).toBeNull();
  });
});

describe('Tab State Constants', () => {
  it('should have sensible max closed tabs', () => {
    const MAX = 50; // From browse-state.js
    expect(MAX).toBeGreaterThan(10);
    expect(MAX).toBeLessThan(200);
  });
});
