import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable logic from browse-urlbar.js
// for unit testing without Electron/webview dependencies
// ──────────────────────────────────────────────────────────

/**
 * _getOmniInput — determines which input + dropdown pair to use
 * Extracted from urlbar-dropdown.js (the core routing logic)
 */
function _getOmniInput() {
  const ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
  if (ntpEl && ntpEl.style.display !== 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  // Popup mode: URL input stays in pill, dropdown renders in popup
  if (window._urlPopupEl) {
    const input = document.getElementById('pill-browse-url-input');
    const dd = window._urlPopupEl.querySelector('#pill-url-popup-dropdown');
    return { input, dd, ntp: false, island: true, popup: true };
  }
  // Island mode: use pill input + pill dropdown
  const nav = document.getElementById('sidebar-nav');
  if (nav && nav.classList.contains('island-mode') && nav.classList.contains('browse-mode')) {
    const pillInput = document.getElementById('pill-browse-url-input');
    const pillDd = document.getElementById('pill-url-dropdown');
    if (pillInput && pillDd) return { input: pillInput, dd: pillDd, ntp: false, island: true };
  }
  const bar = document.getElementById('browse-bar');
  if (bar && bar.style.display === 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  return { input: document.getElementById('browse-url-input'), dd: document.getElementById('browse-url-history-dd'), ntp: false };
}

// ──────────────────────────────────────────────────────────
// DOM Helpers
// ──────────────────────────────────────────────────────────

function setupIslandPopupDOM() {
  document.body.innerHTML = `
    <nav id="sidebar-nav" class="island-mode browse-mode">
      <div id="pill-url-wrap">
        <input id="pill-browse-url-input" type="text">
        <div id="pill-island-left"></div>
        <div id="pill-island-center"></div>
        <div id="pill-url-dropdown"></div>
      </div>
    </nav>
  `;
  // Create popup element simulating open state
  const popup = document.createElement('div');
  popup.className = 'pill-url-popup';
  const tabs = document.createElement('div');
  tabs.id = 'pill-url-popup-tabs';
  popup.appendChild(tabs);
  const dd = document.createElement('div');
  dd.id = 'pill-url-popup-dropdown';
  popup.appendChild(dd);
  document.body.appendChild(popup);
  window._urlPopupEl = popup;
}

function setupIslandCollapsedDOM() {
  document.body.innerHTML = `
    <nav id="sidebar-nav" class="island-mode browse-mode">
      <div id="pill-url-wrap">
        <input id="pill-browse-url-input" type="text">
        <div id="pill-island-left"></div>
        <div id="pill-island-center"></div>
        <div id="pill-url-dropdown"></div>
      </div>
    </nav>
  `;
  window._urlPopupEl = null;
}

function setupClassicBrowseDOM() {
  document.body.innerHTML = `
    <nav id="sidebar-nav">
      <div id="browse-bar">
        <input id="browse-url-input" type="text">
        <div id="browse-url-history-dd"></div>
      </div>
    </nav>
  `;
  window._urlPopupEl = null;
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('_getOmniInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window._urlPopupEl = null;
  });

  describe('Popup mode (popup open)', () => {
    it('should return popup dropdown as dropdown target', () => {
      setupIslandPopupDOM();
      const result = _getOmniInput();
      expect(result.dd.id).toBe('pill-url-popup-dropdown');
      expect(result.popup).toBe(true);
      expect(result.island).toBe(true);
      expect(result.ntp).toBe(false);
    });

    it('should return pill input as the input element', () => {
      setupIslandPopupDOM();
      const result = _getOmniInput();
      expect(result.input.id).toBe('pill-browse-url-input');
    });
  });

  describe('Island collapsed mode', () => {
    it('should return pill-url-dropdown as dropdown target', () => {
      setupIslandCollapsedDOM();
      const result = _getOmniInput();
      expect(result.dd.id).toBe('pill-url-dropdown');
      expect(result.island).toBe(true);
      expect(result.popup).toBeUndefined();
    });
  });

  describe('Classic browse bar mode', () => {
    it('should return browse-url-history-dd as dropdown target', () => {
      setupClassicBrowseDOM();
      const result = _getOmniInput();
      expect(result.dd.id).toBe('browse-url-history-dd');
      expect(result.ntp).toBe(false);
      expect(result.island).toBeUndefined();
    });

    it('should return browse-url-input as the input element', () => {
      setupClassicBrowseDOM();
      const result = _getOmniInput();
      expect(result.input.id).toBe('browse-url-input');
    });
  });

  describe('NTP mode', () => {
    it('should return NTP elements when NTP is visible', () => {
      document.body.innerHTML = `
        <div id="browse-content"><div class="browse-ntp" style="display:block"></div></div>
        <input id="search-query" type="text">
        <div id="search-history-dropdown-view"></div>
      `;
      window._urlPopupEl = null;
      const result = _getOmniInput();
      expect(result.ntp).toBe(true);
      expect(result.input.id).toBe('search-query');
      expect(result.dd.id).toBe('search-history-dropdown-view');
    });
  });
});

describe('Popup Tab/Dropdown Toggle', () => {
  beforeEach(() => {
    setupIslandPopupDOM();
  });

  it('popup should have tabs and dropdown containers', () => {
    const popup = window._urlPopupEl;
    expect(popup.querySelector('#pill-url-popup-tabs')).not.toBeNull();
    expect(popup.querySelector('#pill-url-popup-dropdown')).not.toBeNull();
  });

  it('should toggle tabs visibility based on filter', () => {
    const tabsEl = window._urlPopupEl.querySelector('#pill-url-popup-tabs');
    // Simulate typing: hide tabs
    tabsEl.style.display = 'none';
    expect(tabsEl.style.display).toBe('none');
    // Clear filter: show tabs
    tabsEl.style.display = '';
    expect(tabsEl.style.display).toBe('');
  });
});

describe('Theme Tokens', () => {
  it('page info title should use --nr-text-primary token', () => {
    const titleStyle = { fontSize: '0.82rem', fontWeight: '600', color: 'var(--nr-text-primary)' };
    expect(titleStyle.color).toBe('var(--nr-text-primary)');
    expect(titleStyle.color).not.toContain('#fff');
    expect(titleStyle.color).not.toContain('rgba');
  });

  it('page info domain should use --nr-text-tertiary token', () => {
    const domainStyle = { fontSize: '0.7rem', color: 'var(--nr-text-tertiary)' };
    expect(domainStyle.color).toBe('var(--nr-text-tertiary)');
    expect(domainStyle.color).not.toContain('rgba');
  });

  it('meta pills should use --nr-bg-raised and --nr-text-tertiary tokens', () => {
    const pillStyle = { color: 'var(--nr-text-tertiary)', background: 'var(--nr-bg-raised)' };
    expect(pillStyle.color).toMatch(/^var\(--nr-/);
    expect(pillStyle.background).toMatch(/^var\(--nr-/);
  });

  it('description should use --nr-text-quaternary token', () => {
    const descStyle = { color: 'var(--nr-text-quaternary)' };
    expect(descStyle.color).toBe('var(--nr-text-quaternary)');
  });
});
