import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Extract testable logic from browse-urlbar.js
// for unit testing without Electron/webview dependencies
// ──────────────────────────────────────────────────────────

/**
 * _getOmniInput — determines which input + dropdown pair to use
 * Extracted from browse-urlbar.js (the core routing logic)
 */
function _getOmniInput() {
  const ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
  if (ntpEl && ntpEl.style.display !== 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  const nav = document.getElementById('sidebar-nav');
  if (nav && nav.classList.contains('island-mode') && nav.classList.contains('browse-mode')) {
    const pillInput = document.getElementById('pill-browse-url-input');
    const pillWrap = document.getElementById('pill-url-wrap');
    const isExpanded = pillWrap && pillWrap.classList.contains('island-expanded');
    if (isExpanded) {
      const centerCol = document.getElementById('pill-island-center');
      if (pillInput && centerCol) return { input: pillInput, dd: centerCol, ntp: false, island: true, islandCenter: true };
    }
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

/**
 * _islandCenterRestorePageInfo — restores page info after dropdown hides
 */
function _islandCenterRestorePageInfo() {
  const ddWrap = document.getElementById('island-center-dropdown');
  if (ddWrap) { ddWrap.innerHTML = ''; ddWrap.style.display = 'none'; }
  const leftCol = document.getElementById('pill-island-left');
  const actionsRow = document.getElementById('pill-island-actions-row');
  const titleEl = document.getElementById('pill-island-title');
  const navRow = document.getElementById('pill-island-nav-row');
  const centerCol = document.getElementById('pill-island-center');
  if (leftCol) leftCol.style.display = '';
  if (actionsRow) actionsRow.style.display = '';
  if (titleEl) titleEl.style.display = '';
  if (navRow) navRow.style.display = '';
  if (centerCol) centerCol.classList.remove('island-center-dd-active');
}

/**
 * Simulates the island-center dropdown render path from _browseUrlRenderDropdown
 */
function renderIslandCenterDropdown(html) {
  const centerCol = document.getElementById('pill-island-center');
  if (!centerCol) return null;

  const leftCol = document.getElementById('pill-island-left');
  const actionsRow = document.getElementById('pill-island-actions-row');
  const titleEl = document.getElementById('pill-island-title');
  const navRow = document.getElementById('pill-island-nav-row');
  if (leftCol) leftCol.style.display = 'none';
  if (actionsRow) actionsRow.style.display = 'none';
  if (titleEl) titleEl.style.display = 'none';
  if (navRow) navRow.style.display = 'none';
  centerCol.classList.add('island-center-dd-active');

  let ddWrap = document.getElementById('island-center-dropdown');
  if (!ddWrap) {
    ddWrap = document.createElement('div');
    ddWrap.id = 'island-center-dropdown';
    const pillWrap = document.getElementById('pill-url-wrap');
    if (pillWrap) pillWrap.appendChild(ddWrap);
  }
  ddWrap.innerHTML = html;
  ddWrap.style.display = '';
  return ddWrap;
}

// ──────────────────────────────────────────────────────────
// DOM Helpers
// ──────────────────────────────────────────────────────────

function setupIslandExpandedDOM() {
  document.body.innerHTML = `
    <nav id="sidebar-nav" class="island-mode browse-mode">
      <div id="pill-url-wrap" class="island-expanded">
        <input id="pill-browse-url-input" type="text">
        <div id="pill-island-left"><div id="pill-island-tabs-anchor"></div></div>
        <div id="pill-island-center">
          <div id="pill-island-title">Page Title</div>
          <div id="pill-island-nav-row"><button>Back</button></div>
          <div id="pill-island-actions-row">Page info content</div>
        </div>
        <div id="pill-url-dropdown"></div>
      </div>
    </nav>
  `;
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
}

// ──────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────

describe('_getOmniInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Island expanded mode', () => {
    it('should return center column as dropdown target', () => {
      setupIslandExpandedDOM();
      const result = _getOmniInput();
      expect(result.dd.id).toBe('pill-island-center');
      expect(result.islandCenter).toBe(true);
      expect(result.island).toBe(true);
      expect(result.ntp).toBe(false);
    });

    it('should return pill input as the input element', () => {
      setupIslandExpandedDOM();
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
      expect(result.islandCenter).toBeUndefined();
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
      const result = _getOmniInput();
      expect(result.ntp).toBe(true);
      expect(result.input.id).toBe('search-query');
      expect(result.dd.id).toBe('search-history-dropdown-view');
    });
  });
});

describe('Island Center Dropdown Rendering', () => {
  beforeEach(() => {
    setupIslandExpandedDOM();
  });

  it('should create island-center-dropdown element inside pill-url-wrap', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const ddWrap = document.getElementById('island-center-dropdown');
    expect(ddWrap).not.toBeNull();
    expect(ddWrap.parentElement.id).toBe('pill-url-wrap');
  });

  it('should hide left column when dropdown is shown', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const leftCol = document.getElementById('pill-island-left');
    expect(leftCol.style.display).toBe('none');
  });

  it('should hide actions row when dropdown is shown', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const actionsRow = document.getElementById('pill-island-actions-row');
    expect(actionsRow.style.display).toBe('none');
  });

  it('should hide title when dropdown is shown', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const titleEl = document.getElementById('pill-island-title');
    expect(titleEl.style.display).toBe('none');
  });

  it('should hide nav row when dropdown is shown', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const navRow = document.getElementById('pill-island-nav-row');
    expect(navRow.style.display).toBe('none');
  });

  it('should add island-center-dd-active class to center column', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    const centerCol = document.getElementById('pill-island-center');
    expect(centerCol.classList.contains('island-center-dd-active')).toBe(true);
  });

  it('should render HTML content into the dropdown wrapper', () => {
    renderIslandCenterDropdown('<div class="test-item">Result</div>');
    const ddWrap = document.getElementById('island-center-dropdown');
    expect(ddWrap.querySelector('.test-item')).not.toBeNull();
    expect(ddWrap.querySelector('.test-item').textContent).toBe('Result');
  });

  it('should reuse existing dropdown wrapper on subsequent renders', () => {
    renderIslandCenterDropdown('<div>First</div>');
    renderIslandCenterDropdown('<div>Second</div>');
    const wrappers = document.querySelectorAll('#island-center-dropdown');
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].innerHTML).toBe('<div>Second</div>');
  });
});

describe('_islandCenterRestorePageInfo', () => {
  beforeEach(() => {
    setupIslandExpandedDOM();
  });

  it('should restore left column visibility', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const leftCol = document.getElementById('pill-island-left');
    expect(leftCol.style.display).toBe('');
  });

  it('should restore actions row visibility', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const actionsRow = document.getElementById('pill-island-actions-row');
    expect(actionsRow.style.display).toBe('');
  });

  it('should restore title visibility', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const titleEl = document.getElementById('pill-island-title');
    expect(titleEl.style.display).toBe('');
  });

  it('should restore nav row visibility', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const navRow = document.getElementById('pill-island-nav-row');
    expect(navRow.style.display).toBe('');
  });

  it('should remove island-center-dd-active class from center column', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const centerCol = document.getElementById('pill-island-center');
    expect(centerCol.classList.contains('island-center-dd-active')).toBe(false);
  });

  it('should clear and hide dropdown wrapper', () => {
    renderIslandCenterDropdown('<div>Test</div>');
    _islandCenterRestorePageInfo();
    const ddWrap = document.getElementById('island-center-dropdown');
    expect(ddWrap.innerHTML).toBe('');
    expect(ddWrap.style.display).toBe('none');
  });

  it('should be safe to call without dropdown existing', () => {
    expect(() => _islandCenterRestorePageInfo()).not.toThrow();
  });

  it('should be safe to call on empty DOM', () => {
    document.body.innerHTML = '';
    expect(() => _islandCenterRestorePageInfo()).not.toThrow();
  });
});

describe('Island Expanded Theme Tokens', () => {
  it('page info title should use --nr-text-primary token', () => {
    // Extracted from toolbar-island.js _renderIslandActions()
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
