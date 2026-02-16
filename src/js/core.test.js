/**
 * Core.js Utility Function Tests
 *
 * Tests for core utilities extracted from core.js following the pattern
 * established in utils.test.js and quality.helpers.test.js.
 *
 * Pattern: Extract pure/testable versions of functions and test them.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Dynamic Island Activity Manager
// ──────────────────────────────────────────────────────────

/**
 * Extracted from core.js islandUpdate/islandRemove
 * Manages live activity pills in the Dynamic Island
 */
function createIslandManager() {
  const activities = {};
  const dismissTimers = {};

  const manager = {
    update(id, data) {
      activities[id] = Object.assign(activities[id] || {}, data, { _ts: Date.now() });
    },

    remove(id) {
      if (dismissTimers[id]) {
        clearTimeout(dismissTimers[id]);
        delete dismissTimers[id];
      }
      delete activities[id];
    },

    getActivities() {
      return activities;
    },

    getSortedIds() {
      // Priority order from core.js _islandRender
      const priority = {
        achievement: 5,
        download: 4,
        cc: 3,
        tts: 3,
        ai: 3,
        rss: 2.6,
        bookmark: 2.55,
        annotate: 2.5,
        audio: 2,
        qf: 2,
        feed: 1,
        context: 0
      };

      return Object.keys(activities).sort((a, b) => {
        const pa = priority[activities[a].type] || 0;
        const pb = priority[activities[b].type] || 0;
        // Sort by priority desc, then by timestamp desc
        if (pb !== pa) return pb - pa;
        return activities[b]._ts - activities[a]._ts;
      });
    },

    setDismissTimer(id, delay, callback) {
      if (dismissTimers[id]) clearTimeout(dismissTimers[id]);
      dismissTimers[id] = setTimeout(() => {
        delete dismissTimers[id];
        if (callback) callback();
      }, delay);
    },

    // Test helper: clear all state
    _reset() {
      for (const id in dismissTimers) {
        clearTimeout(dismissTimers[id]);
      }
      Object.keys(activities).forEach(k => delete activities[k]);
      Object.keys(dismissTimers).forEach(k => delete dismissTimers[k]);
    }
  };

  return manager;
}

// ──────────────────────────────────────────────────────────
// Source Chip Builder
// ──────────────────────────────────────────────────────────

/**
 * Mock feed catalog (subset from core.js FEED_CATALOG)
 */
const MOCK_FEED_CATALOG = [
  { key: 'arxiv', name: 'arXiv', cat: 'Research & Science', special: 'arxiv' },
  { key: 'hn', name: 'Hacker News', cat: 'Tech & News', special: 'hn' },
  { key: 'nature', name: 'Nature', cat: 'Research & Science', url: 'https://www.nature.com/nature.rss' },
  { key: 'verge', name: 'The Verge', cat: 'Tech & News', url: 'https://www.theverge.com/rss/index.xml' },
];

/**
 * Simplified version of getSourceChip from core.js
 * Returns source metadata instead of HTML for easier testing
 */
function buildSourceChip(catalog, sourceKey, arxivId) {
  // Handle arxiv special case
  if (arxivId) {
    const arxivEntry = catalog.find(f => f.key === 'arxiv');
    if (arxivEntry) return { name: 'arXiv', cat: arxivEntry.cat };
  }

  // Handle custom RSS feeds
  if (sourceKey && sourceKey.startsWith('custom:')) {
    return { name: sourceKey.slice(7), cat: 'Custom', isCustom: true };
  }

  // Look up in catalog
  const entry = catalog.find(f => f.key === sourceKey);
  if (!entry) return null;

  return { name: entry.name, cat: entry.cat, special: entry.special };
}

// ──────────────────────────────────────────────────────────
// Window Manager
// ──────────────────────────────────────────────────────────

/**
 * Simplified window manager from core.js wmOpen/_wmActivateWindow
 */
function createWindowManager() {
  const viewMeta = {
    dashboard:  { label: 'Home',      sidebarId: 'sb-dashboard' },
    feed:       { label: 'Feed',      sidebarId: 'sb-home' },
    vault:      { label: 'Vault',     sidebarId: 'sb-vault' },
    browse:     { label: 'Browse',    sidebarId: 'sb-browse' },
    inbox:      { label: 'Inbox',     sidebarId: 'sb-inbox' },
    settings:   { label: 'Settings',  sidebarId: 'sb-settings' },
  };

  const defaultOrder = ['dashboard', 'feed', 'vault', 'browse', 'inbox', 'settings'];
  let windows = defaultOrder.map(key => ({
    key,
    label: viewMeta[key].label,
    sidebarId: viewMeta[key].sidebarId,
  }));

  let focusIndex = 0;
  let mode = 'fullscreen'; // 'tiling' | 'fullscreen'

  const manager = {
    open(key) {
      const meta = viewMeta[key];
      if (!meta) return false;

      const existIdx = windows.findIndex(w => w.key === key);

      if (existIdx >= 0) {
        // Existing window - focus it
        focusIndex = existIdx;
      } else {
        // New window - add and focus
        windows.push({ key, label: meta.label, sidebarId: meta.sidebarId });
        focusIndex = windows.length - 1;
      }

      mode = 'fullscreen';
      return true;
    },

    close(index) {
      if (index < 0 || index >= windows.length) return false;
      windows.splice(index, 1);
      if (focusIndex >= windows.length) focusIndex = windows.length - 1;
      if (focusIndex < 0) focusIndex = 0;
      return true;
    },

    getWindows() {
      return [...windows];
    },

    getFocusIndex() {
      return focusIndex;
    },

    getMode() {
      return mode;
    },

    setMode(newMode) {
      if (newMode === 'tiling' || newMode === 'fullscreen') {
        mode = newMode;
        return true;
      }
      return false;
    },

    getCurrentWindow() {
      return windows[focusIndex] || null;
    },

    // Test helper
    _reset() {
      windows = defaultOrder.map(key => ({
        key,
        label: viewMeta[key].label,
        sidebarId: viewMeta[key].sidebarId,
      }));
      focusIndex = 0;
      mode = 'fullscreen';
    }
  };

  return manager;
}

// ──────────────────────────────────────────────────────────
// Route Parser
// ──────────────────────────────────────────────────────────

/**
 * Extract route information from hash (simplified from core.js routeFromHash)
 */
function parseRoute(hash) {
  if (!hash) return { view: null, params: {} };

  // Remove leading #
  const route = hash.startsWith('#') ? hash.slice(1) : hash;

  // Empty or just feed
  if (!route || route === 'feed') return { view: 'feed', params: {} };

  // Simple views (no params)
  const simpleViews = ['research', 'browse', 'settings', 'vault', 'inbox', 'calendar', 'dev', 'graph'];
  if (simpleViews.includes(route)) return { view: route, params: {} };

  // Special redirects
  if (route === 'experiments') return { view: 'vault', params: {}, redirect: true };
  if (route === 'quality') return { view: 'settings', params: { section: 'feed', tab: 'quality' }, redirect: true };
  if (route === 'algorithm') return { view: 'settings', params: { section: 'feed', tab: 'algorithm' }, redirect: true };

  // Parameterized routes
  if (route.startsWith('blog/')) {
    const parts = route.slice(5).split('/');
    return { view: 'blog', params: { postId: parts[0] } };
  }

  if (route.startsWith('profile/')) {
    const username = route.slice(8);
    return { view: 'profile', params: { username } };
  }

  if (route.startsWith('experiment/')) {
    const id = route.slice(11);
    return { view: 'experiment', params: { id } };
  }

  if (route.startsWith('author/')) {
    const id = route.slice(7);
    return { view: 'author', params: { id } };
  }

  if (route.startsWith('view/') || route.startsWith('paper/')) {
    const url = decodeURIComponent(route.slice(route.indexOf('/') + 1));
    return { view: 'paper', params: { url } };
  }

  // Unknown route
  return { view: 'unknown', params: { raw: route } };
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('Dynamic Island Activity Manager', () => {
  let manager;

  beforeEach(() => {
    manager = createIslandManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager._reset();
    vi.useRealTimers();
  });

  describe('update', () => {
    it('should add new activity', () => {
      manager.update('test1', { type: 'ai', label: 'Processing' });

      const activities = manager.getActivities();
      expect(activities.test1).toBeDefined();
      expect(activities.test1.type).toBe('ai');
      expect(activities.test1.label).toBe('Processing');
      expect(activities.test1._ts).toBeDefined();
    });

    it('should merge updates to existing activity', () => {
      manager.update('test1', { type: 'download', label: 'Downloading', progress: 0 });
      manager.update('test1', { progress: 50 });

      const activities = manager.getActivities();
      expect(activities.test1.type).toBe('download');
      expect(activities.test1.label).toBe('Downloading');
      expect(activities.test1.progress).toBe(50);
    });

    it('should update timestamp on each update', () => {
      const time1 = Date.now();
      manager.update('test1', { type: 'ai', label: 'Start' });

      vi.advanceTimersByTime(1000);

      const time2 = Date.now();
      manager.update('test1', { label: 'Updated' });

      const activities = manager.getActivities();
      expect(activities.test1._ts).toBeGreaterThanOrEqual(time2);
      expect(activities.test1._ts).toBeGreaterThan(time1);
    });
  });

  describe('remove', () => {
    it('should remove activity', () => {
      manager.update('test1', { type: 'ai', label: 'Test' });
      manager.remove('test1');

      const activities = manager.getActivities();
      expect(activities.test1).toBeUndefined();
    });

    it('should clear dismiss timer on remove', () => {
      const callback = vi.fn();
      manager.update('test1', { type: 'ai', label: 'Test' });
      manager.setDismissTimer('test1', 2500, callback);

      manager.remove('test1');
      vi.advanceTimersByTime(3000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle removing non-existent activity', () => {
      expect(() => manager.remove('nonexistent')).not.toThrow();
    });
  });

  describe('getSortedIds', () => {
    it('should sort by priority descending', () => {
      manager.update('feed1', { type: 'feed', label: 'Feed Update' });
      manager.update('download1', { type: 'download', label: 'Downloading' });
      manager.update('achievement1', { type: 'achievement', label: 'Unlocked!' });
      manager.update('ai1', { type: 'ai', label: 'Processing' });

      const sorted = manager.getSortedIds();

      // achievement (5) > download (4) > ai (3) > feed (1)
      expect(sorted[0]).toBe('achievement1');
      expect(sorted[1]).toBe('download1');
      expect(sorted[2]).toBe('ai1');
      expect(sorted[3]).toBe('feed1');
    });

    it('should sort by timestamp when priorities are equal', () => {
      manager.update('ai1', { type: 'ai', label: 'First' });
      vi.advanceTimersByTime(100);
      manager.update('ai2', { type: 'ai', label: 'Second' });
      vi.advanceTimersByTime(100);
      manager.update('ai3', { type: 'ai', label: 'Third' });

      const sorted = manager.getSortedIds();

      // Most recent first
      expect(sorted[0]).toBe('ai3');
      expect(sorted[1]).toBe('ai2');
      expect(sorted[2]).toBe('ai1');
    });

    it('should handle bookmark pill priority (2.55)', () => {
      manager.update('bookmark1', { type: 'bookmark' });
      manager.update('annotate1', { type: 'annotate' });
      manager.update('rss1', { type: 'rss' });

      const sorted = manager.getSortedIds();

      // rss (2.6) > bookmark (2.55) > annotate (2.5)
      expect(sorted[0]).toBe('rss1');
      expect(sorted[1]).toBe('bookmark1');
      expect(sorted[2]).toBe('annotate1');
    });

    it('should return empty array when no activities', () => {
      const sorted = manager.getSortedIds();
      expect(sorted).toEqual([]);
    });
  });

  describe('setDismissTimer', () => {
    it('should execute callback after delay', () => {
      const callback = vi.fn();
      manager.update('test1', { type: 'bookmark' });
      manager.setDismissTimer('test1', 2500, callback);

      vi.advanceTimersByTime(2499);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should replace existing timer', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.update('test1', { type: 'bookmark' });
      manager.setDismissTimer('test1', 1000, callback1);
      manager.setDismissTimer('test1', 2000, callback2);

      vi.advanceTimersByTime(1500);
      expect(callback1).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world scenario: Bookmark notification', () => {
    it('should handle bookmark pill lifecycle', () => {
      // User saves a paper
      manager.update('bookmark', {
        type: 'bookmark',
        label: 'Saved',
        detail: 'Attention Is All You Need'
      });

      expect(manager.getSortedIds()).toContain('bookmark');

      // Auto-dismiss after 2.5s
      const dismiss = vi.fn(() => manager.remove('bookmark'));
      manager.setDismissTimer('bookmark', 2500, dismiss);

      vi.advanceTimersByTime(2500);
      expect(dismiss).toHaveBeenCalled();
      expect(manager.getActivities().bookmark).toBeUndefined();
    });
  });

  describe('Real-world scenario: Download progress', () => {
    it('should track download progress', () => {
      manager.update('download', {
        type: 'download',
        label: 'paper.pdf',
        progress: 0
      });

      // Simulate progress updates
      manager.update('download', { progress: 25 });
      expect(manager.getActivities().download.progress).toBe(25);

      manager.update('download', { progress: 50 });
      expect(manager.getActivities().download.progress).toBe(50);

      manager.update('download', { progress: 100, done: true });
      expect(manager.getActivities().download.done).toBe(true);
      expect(manager.getActivities().download.progress).toBe(100);
    });
  });
});

describe('Source Chip Builder', () => {
  describe('buildSourceChip', () => {
    it('should return source info for known sources', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'arxiv');
      expect(chip).toEqual({ name: 'arXiv', cat: 'Research & Science', special: 'arxiv' });
    });

    it('should return null for unknown sources', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'unknown-source');
      expect(chip).toBeNull();
    });

    it('should handle arxiv ID override', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'other', '2301.12345');
      expect(chip).toEqual({ name: 'arXiv', cat: 'Research & Science' });
    });

    it('should handle custom RSS feeds', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'custom:My Blog');
      expect(chip).toEqual({ name: 'My Blog', cat: 'Custom', isCustom: true });
    });

    it('should preserve special flag', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'hn');
      expect(chip.special).toBe('hn');
    });

    it('should handle sources without special flag', () => {
      const chip = buildSourceChip(MOCK_FEED_CATALOG, 'nature');
      expect(chip.special).toBeUndefined();
    });
  });

  describe('Real-world scenario: Feed card rendering', () => {
    it('should provide data for rendering feed cards from different sources', () => {
      const sources = ['arxiv', 'hn', 'nature', 'custom:Personal Blog'];
      const chips = sources.map(src => buildSourceChip(MOCK_FEED_CATALOG, src));

      expect(chips).toHaveLength(4);
      expect(chips[0].name).toBe('arXiv');
      expect(chips[1].name).toBe('Hacker News');
      expect(chips[2].name).toBe('Nature');
      expect(chips[3].name).toBe('Personal Blog');
      expect(chips[3].isCustom).toBe(true);
    });
  });
});

describe('Window Manager', () => {
  let wm;

  beforeEach(() => {
    wm = createWindowManager();
  });

  afterEach(() => {
    wm._reset();
  });

  describe('open', () => {
    it('should focus existing window', () => {
      // Default windows: dashboard, feed, vault, browse, inbox, settings
      const initialCount = wm.getWindows().length;

      wm.open('vault'); // Index 2
      expect(wm.getFocusIndex()).toBe(2);
      expect(wm.getWindows()).toHaveLength(initialCount);
    });

    it('should add and focus new window', () => {
      // Close all default windows except first
      const windows = wm.getWindows();
      for (let i = windows.length - 1; i >= 1; i--) {
        wm.close(i);
      }

      expect(wm.getWindows()).toHaveLength(1);

      wm.open('browse');
      expect(wm.getWindows()).toHaveLength(2);
      expect(wm.getFocusIndex()).toBe(1);
      expect(wm.getCurrentWindow().key).toBe('browse');
    });

    it('should set mode to fullscreen on open', () => {
      wm.setMode('tiling');
      wm.open('vault');
      expect(wm.getMode()).toBe('fullscreen');
    });

    it('should return false for invalid view key', () => {
      const result = wm.open('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should remove window at index', () => {
      const initialCount = wm.getWindows().length;
      wm.close(2); // Close vault
      expect(wm.getWindows()).toHaveLength(initialCount - 1);
      expect(wm.getWindows().find(w => w.key === 'vault')).toBeUndefined();
    });

    it('should adjust focus index if closing focused window', () => {
      wm.open('settings'); // Focus last window (index 5)
      const focusedIdx = wm.getFocusIndex();
      wm.close(focusedIdx);

      // Should focus previous window
      expect(wm.getFocusIndex()).toBeLessThan(focusedIdx);
    });

    it('should return false for invalid index', () => {
      expect(wm.close(-1)).toBe(false);
      expect(wm.close(999)).toBe(false);
    });
  });

  describe('getCurrentWindow', () => {
    it('should return focused window', () => {
      wm.open('browse');
      const current = wm.getCurrentWindow();
      expect(current.key).toBe('browse');
      expect(current.label).toBe('Browse');
    });

    it('should return null when no windows', () => {
      // Close all windows
      const windows = wm.getWindows();
      for (let i = windows.length - 1; i >= 0; i--) {
        wm.close(i);
      }
      expect(wm.getCurrentWindow()).toBeNull();
    });
  });

  describe('setMode', () => {
    it('should switch to tiling mode', () => {
      wm.setMode('tiling');
      expect(wm.getMode()).toBe('tiling');
    });

    it('should switch to fullscreen mode', () => {
      wm.setMode('tiling');
      wm.setMode('fullscreen');
      expect(wm.getMode()).toBe('fullscreen');
    });

    it('should reject invalid modes', () => {
      const result = wm.setMode('invalid');
      expect(result).toBe(false);
      expect(wm.getMode()).toBe('fullscreen'); // Should remain unchanged
    });
  });

  describe('Real-world scenario: View switching', () => {
    it('should handle typical navigation flow', () => {
      // Start on feed (default focus is index 0 = dashboard, but let's open feed)
      wm.open('feed');
      expect(wm.getCurrentWindow().key).toBe('feed');

      // User opens research (browse)
      wm.open('browse');
      expect(wm.getCurrentWindow().key).toBe('browse');
      expect(wm.getMode()).toBe('fullscreen');

      // User switches to vault
      wm.open('vault');
      expect(wm.getCurrentWindow().key).toBe('vault');

      // User returns to browse
      wm.open('browse');
      expect(wm.getCurrentWindow().key).toBe('browse');

      // All views should still be in window list
      const windows = wm.getWindows();
      expect(windows.find(w => w.key === 'feed')).toBeDefined();
      expect(windows.find(w => w.key === 'browse')).toBeDefined();
      expect(windows.find(w => w.key === 'vault')).toBeDefined();
    });
  });
});

describe('Route Parser', () => {
  describe('Simple routes', () => {
    it('should parse feed route', () => {
      expect(parseRoute('#feed')).toEqual({ view: 'feed', params: {} });
      expect(parseRoute('feed')).toEqual({ view: 'feed', params: {} });
      expect(parseRoute('#')).toEqual({ view: 'feed', params: {} });
      expect(parseRoute('')).toEqual({ view: null, params: {} });
    });

    it('should parse simple view routes', () => {
      expect(parseRoute('#browse')).toEqual({ view: 'browse', params: {} });
      expect(parseRoute('#vault')).toEqual({ view: 'vault', params: {} });
      expect(parseRoute('#settings')).toEqual({ view: 'settings', params: {} });
      expect(parseRoute('#inbox')).toEqual({ view: 'inbox', params: {} });
      expect(parseRoute('#calendar')).toEqual({ view: 'calendar', params: {} });
    });
  });

  describe('Redirect routes', () => {
    it('should parse experiments redirect to vault', () => {
      const result = parseRoute('#experiments');
      expect(result.view).toBe('vault');
      expect(result.redirect).toBe(true);
    });

    it('should parse quality redirect to settings', () => {
      const result = parseRoute('#quality');
      expect(result.view).toBe('settings');
      expect(result.params).toEqual({ section: 'feed', tab: 'quality' });
      expect(result.redirect).toBe(true);
    });

    it('should parse algorithm redirect to settings', () => {
      const result = parseRoute('#algorithm');
      expect(result.view).toBe('settings');
      expect(result.params).toEqual({ section: 'feed', tab: 'algorithm' });
      expect(result.redirect).toBe(true);
    });
  });

  describe('Parameterized routes', () => {
    it('should parse blog route with post ID', () => {
      const result = parseRoute('#blog/123');
      expect(result.view).toBe('blog');
      expect(result.params).toEqual({ postId: '123' });
    });

    it('should parse profile route with username', () => {
      const result = parseRoute('#profile/johndoe');
      expect(result.view).toBe('profile');
      expect(result.params).toEqual({ username: 'johndoe' });
    });

    it('should parse experiment route with ID', () => {
      const result = parseRoute('#experiment/my-experiment');
      expect(result.view).toBe('experiment');
      expect(result.params).toEqual({ id: 'my-experiment' });
    });

    it('should parse author route with ID', () => {
      const result = parseRoute('#author/789');
      expect(result.view).toBe('author');
      expect(result.params).toEqual({ id: '789' });
    });
  });

  describe('Paper routes', () => {
    it('should parse view/ route', () => {
      const url = 'https://arxiv.org/abs/2301.12345';
      const result = parseRoute('#view/' + encodeURIComponent(url));
      expect(result.view).toBe('paper');
      expect(result.params.url).toBe(url);
    });

    it('should parse paper/ route', () => {
      const url = 'https://arxiv.org/abs/2301.12345';
      const result = parseRoute('#paper/' + encodeURIComponent(url));
      expect(result.view).toBe('paper');
      expect(result.params.url).toBe(url);
    });

    it('should decode URL in paper route', () => {
      const url = 'https://example.com/paper?id=123&section=intro';
      const result = parseRoute('#view/' + encodeURIComponent(url));
      expect(result.params.url).toBe(url);
    });
  });

  describe('Unknown routes', () => {
    it('should handle unknown routes', () => {
      const result = parseRoute('#unknown-route');
      expect(result.view).toBe('unknown');
      expect(result.params).toEqual({ raw: 'unknown-route' });
    });
  });

  describe('Real-world scenario: Hash navigation', () => {
    it('should parse typical navigation flow', () => {
      const routes = [
        '#feed',
        '#browse',
        '#vault',
        '#experiment/my-project',
        '#profile/alice',
        '#settings',
        '#quality',
      ];

      const results = routes.map(parseRoute);

      expect(results[0].view).toBe('feed');
      expect(results[1].view).toBe('browse');
      expect(results[2].view).toBe('vault');
      expect(results[3].view).toBe('experiment');
      expect(results[3].params.id).toBe('my-project');
      expect(results[4].view).toBe('profile');
      expect(results[4].params.username).toBe('alice');
      expect(results[5].view).toBe('settings');
      expect(results[6].view).toBe('settings'); // Redirect
      expect(results[6].params.tab).toBe('quality');
    });
  });

  describe('Edge cases', () => {
    it('should handle hash without #', () => {
      expect(parseRoute('browse')).toEqual({ view: 'browse', params: {} });
    });

    it('should handle null/undefined', () => {
      expect(parseRoute(null)).toEqual({ view: null, params: {} });
      expect(parseRoute(undefined)).toEqual({ view: null, params: {} });
    });

    it('should handle route with special characters', () => {
      const username = 'user@example.com';
      const result = parseRoute('#profile/' + username);
      expect(result.params.username).toBe(username);
    });

    it('should handle empty experiment ID', () => {
      const result = parseRoute('#experiment/');
      expect(result.view).toBe('experiment');
      expect(result.params.id).toBe('');
    });
  });
});

describe('Integration: Window Manager + Route Parser', () => {
  it('should handle route-driven window management', () => {
    const wm = createWindowManager();

    const routes = [
      '#feed',
      '#browse',
      '#vault',
      '#settings',
    ];

    routes.forEach(hash => {
      const route = parseRoute(hash);
      if (route.view && route.view !== 'unknown') {
        wm.open(route.view);
      }
    });

    // Should have focused settings (last route)
    expect(wm.getCurrentWindow().key).toBe('settings');

    // All views should be in windows
    const windows = wm.getWindows();
    expect(windows.find(w => w.key === 'feed')).toBeDefined();
    expect(windows.find(w => w.key === 'browse')).toBeDefined();
    expect(windows.find(w => w.key === 'vault')).toBeDefined();
    expect(windows.find(w => w.key === 'settings')).toBeDefined();
  });
});
