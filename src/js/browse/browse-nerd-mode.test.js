import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable pure functions from browse-nerd-mode.js
// ──────────────────────────────────────────────────────────

function _isPdfTab(tab) {
  if (!tab) return false;
  if (tab.pdfUrl || tab.localPath) return true;
  var url = (tab.url || '').toLowerCase();
  if (url.endsWith('.pdf')) return true;
  if (url.includes('/pdf/') && url.includes('arxiv.org')) return true;
  return false;
}

function _isNerdAutoEligible(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  return lower.endsWith('.pdf') || (lower.includes('/pdf/') && lower.includes('arxiv.org'));
}

function _getPdfUrl(tab) {
  if (tab.localPath) return '/api/local-file?path=' + encodeURIComponent(tab.localPath);
  if (tab.pdfUrl) return tab.pdfUrl;
  return tab.url || '';
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('_isPdfTab', () => {
  it('returns true for .pdf URL', () => {
    expect(_isPdfTab({ url: 'https://example.com/paper.pdf' })).toBe(true);
  });

  it('returns true for arXiv /pdf/ URL', () => {
    expect(_isPdfTab({ url: 'https://arxiv.org/pdf/2301.00001' })).toBe(true);
  });

  it('returns true when tab has pdfUrl', () => {
    expect(_isPdfTab({ url: 'https://example.com', pdfUrl: 'https://example.com/file.pdf' })).toBe(true);
  });

  it('returns true when tab has localPath', () => {
    expect(_isPdfTab({ url: '', localPath: '/Users/test/paper.pdf' })).toBe(true);
  });

  it('returns false for regular URL', () => {
    expect(_isPdfTab({ url: 'https://example.com/article' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(_isPdfTab(null)).toBe(false);
    expect(_isPdfTab(undefined)).toBe(false);
  });

  it('returns false for tab with no url', () => {
    expect(_isPdfTab({})).toBe(false);
  });
});

describe('_isNerdAutoEligible', () => {
  it('returns true for .pdf URL', () => {
    expect(_isNerdAutoEligible('https://example.com/paper.pdf')).toBe(true);
  });

  it('returns true for arXiv PDF URL', () => {
    expect(_isNerdAutoEligible('https://arxiv.org/pdf/2301.00001')).toBe(true);
  });

  it('returns false for regular URL', () => {
    expect(_isNerdAutoEligible('https://example.com/article')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(_isNerdAutoEligible(null)).toBe(false);
    expect(_isNerdAutoEligible(undefined)).toBe(false);
  });

  it('returns false for arXiv non-PDF URL', () => {
    expect(_isNerdAutoEligible('https://arxiv.org/abs/2301.00001')).toBe(false);
  });
});

describe('_getPdfUrl', () => {
  it('returns local file API path for localPath tabs', () => {
    const tab = { localPath: '/Users/test/paper.pdf', url: 'https://example.com' };
    expect(_getPdfUrl(tab)).toBe('/api/local-file?path=%2FUsers%2Ftest%2Fpaper.pdf');
  });

  it('returns pdfUrl when present', () => {
    const tab = { pdfUrl: 'https://cdn.example.com/paper.pdf', url: 'https://example.com' };
    expect(_getPdfUrl(tab)).toBe('https://cdn.example.com/paper.pdf');
  });

  it('prefers localPath over pdfUrl', () => {
    const tab = { localPath: '/test.pdf', pdfUrl: 'https://cdn.example.com/paper.pdf' };
    expect(_getPdfUrl(tab)).toBe('/api/local-file?path=%2Ftest.pdf');
  });

  it('falls back to tab.url', () => {
    const tab = { url: 'https://arxiv.org/pdf/2301.00001' };
    expect(_getPdfUrl(tab)).toBe('https://arxiv.org/pdf/2301.00001');
  });

  it('returns empty string when no url', () => {
    expect(_getPdfUrl({})).toBe('');
  });
});

// ──────────────────────────────────────────────────────────
// Toggle and pill behavior tests (mocked dependencies)
// ──────────────────────────────────────────────────────────

describe('nerd mode toggle behavior', () => {
  let islandUpdateCalls, islandRemoveCalls, nerdModeEnabled, nerdModeSticky;

  function islandUpdate(id, opts) { islandUpdateCalls.push({ id, opts }); }
  function islandRemove(id) { islandRemoveCalls.push(id); }

  beforeEach(() => {
    islandUpdateCalls = [];
    islandRemoveCalls = [];
    nerdModeEnabled = new Map();
    nerdModeSticky = new Set();
  });

  function simulateEnable(tab) {
    if (!_isPdfTab(tab)) return false;
    nerdModeEnabled.set(tab.id, true);
    nerdModeSticky.add(tab.id);
    islandRemove('nerd-offer');
    islandUpdate('nerd', {
      type: 'nerd',
      label: 'PDF view',
      icon: 'glasses-icon',
      action: function() {}
    });
    return true;
  }

  function simulateDisable(tab) {
    nerdModeEnabled.delete(tab.id);
    islandRemove('nerd');
  }

  function simulateTabSelect(tab, allTabs) {
    if (nerdModeEnabled.get(tab.id)) {
      islandUpdate('nerd', {
        type: 'nerd',
        label: 'PDF view',
        icon: 'glasses-icon',
        action: function() {}
      });
    } else {
      islandRemove('nerd');
    }
  }

  function simulateTabClose(tabId) {
    nerdModeSticky.delete(tabId);
    if (nerdModeEnabled.has(tabId)) {
      nerdModeEnabled.delete(tabId);
      islandRemove('nerd');
    }
  }

  it('enable on PDF tab calls islandUpdate with label "PDF view" and action property', () => {
    const tab = { id: 't1', url: 'https://example.com/paper.pdf' };
    simulateEnable(tab);
    expect(islandUpdateCalls).toHaveLength(1);
    expect(islandUpdateCalls[0].id).toBe('nerd');
    expect(islandUpdateCalls[0].opts.label).toBe('PDF view');
    expect(islandUpdateCalls[0].opts).toHaveProperty('action');
    expect(islandUpdateCalls[0].opts).not.toHaveProperty('onTap');
  });

  it('enable on non-PDF tab does not enable', () => {
    const tab = { id: 't1', url: 'https://example.com/article' };
    const result = simulateEnable(tab);
    expect(result).toBe(false);
    expect(islandUpdateCalls).toHaveLength(0);
    expect(nerdModeEnabled.has('t1')).toBe(false);
  });

  it('disable calls islandRemove("nerd")', () => {
    const tab = { id: 't1', url: 'https://example.com/paper.pdf' };
    simulateEnable(tab);
    islandRemoveCalls = [];
    simulateDisable(tab);
    expect(islandRemoveCalls).toContain('nerd');
    expect(nerdModeEnabled.has('t1')).toBe(false);
  });

  it('enable removes nerd-offer pill', () => {
    const tab = { id: 't1', url: 'https://example.com/paper.pdf' };
    simulateEnable(tab);
    expect(islandRemoveCalls).toContain('nerd-offer');
  });

  it('tab select with nerd active shows pill with "PDF view" and action', () => {
    const tab = { id: 't1', url: 'https://example.com/paper.pdf' };
    nerdModeEnabled.set('t1', true);
    simulateTabSelect(tab, [tab]);
    expect(islandUpdateCalls).toHaveLength(1);
    expect(islandUpdateCalls[0].opts.label).toBe('PDF view');
    expect(islandUpdateCalls[0].opts).toHaveProperty('action');
    expect(islandUpdateCalls[0].opts).not.toHaveProperty('onTap');
  });

  it('tab select with nerd inactive removes pill', () => {
    const tab = { id: 't1', url: 'https://example.com/article' };
    simulateTabSelect(tab, [tab]);
    expect(islandRemoveCalls).toContain('nerd');
  });

  it('tab close cleans up nerdModeEnabled and nerdModeSticky', () => {
    nerdModeEnabled.set('t1', true);
    nerdModeSticky.add('t1');
    simulateTabClose('t1');
    expect(nerdModeEnabled.has('t1')).toBe(false);
    expect(nerdModeSticky.has('t1')).toBe(false);
    expect(islandRemoveCalls).toContain('nerd');
  });

  it('tab close for non-nerd tab does not call islandRemove', () => {
    simulateTabClose('t99');
    expect(islandRemoveCalls).toHaveLength(0);
  });
});
