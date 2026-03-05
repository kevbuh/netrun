import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Tests for island expand click handler and favicon tab
// navigation — ensures clicking favicon icons in the
// collapsed pill navigates to that tab instead of expanding.
// ──────────────────────────────────────────────────────────

/**
 * Replicate the expand-guard logic from toolbar-island.js
 * document-level click handler.
 */
function shouldExpandIsland(e, wrap, pill, popupOpen) {
  if (!wrap) return false;
  if (popupOpen) return false;
  if (pill && pill.classList.contains('ntp-active')) return false;
  if (e.target.closest('[data-island-tab], [data-island-tab-close], [data-island-tab-new]')) return false;
  if (wrap.contains(e.target)) return true;
  return false;
}

function makeDOM() {
  document.body.innerHTML = `
    <div id="pill-url-wrap">
      <div id="pill-island" class="pill-island-container">
        <div class="pill-island" data-island-id="tabs">
          <div class="pill-island-content">
            <span class="island-favicon-strip">
              <img class="island-strip-fav" data-island-tab="1" src="" title="Tab 1">
              <span class="island-strip-fav-wrap" data-island-tab="2">
                <img class="island-strip-fav island-strip-fav-active" data-island-tab="2" src="" title="Tab 2">
                <button class="island-strip-fav-close" data-island-tab-close="2" title="Close tab">&times;</button>
              </span>
              <span class="island-strip-overflow">3 tabs</span>
            </span>
          </div>
        </div>
      </div>
      <div id="pill-island-tabs-anchor"></div>
    </div>
    <div id="sidebar-nav"></div>
  `;
}

// ══════════════════════════════════════════════════════════════
// Expand guard — document-level handler should skip tab clicks
// ══════════════════════════════════════════════════════════════

describe('Island expand guard', () => {
  beforeEach(() => makeDOM());

  it('expands when clicking non-tab content inside pill-url-wrap', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    const overflow = document.querySelector('.island-strip-overflow');
    expect(shouldExpandIsland({ target: overflow }, wrap, pill)).toBe(true);
  });

  it('does NOT expand when clicking a tab favicon', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    const favicon = document.querySelector('[data-island-tab="1"]');
    expect(shouldExpandIsland({ target: favicon }, wrap, pill)).toBe(false);
  });

  it('does NOT expand when clicking a tab close button', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    const closeBtn = document.querySelector('[data-island-tab-close="2"]');
    expect(shouldExpandIsland({ target: closeBtn }, wrap, pill)).toBe(false);
  });

  it('does NOT expand when popup is already open', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    const overflow = document.querySelector('.island-strip-overflow');
    expect(shouldExpandIsland({ target: overflow }, wrap, pill, true)).toBe(false);
  });

  it('does NOT expand when NTP is active', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    pill.classList.add('ntp-active');
    const overflow = document.querySelector('.island-strip-overflow');
    expect(shouldExpandIsland({ target: overflow }, wrap, pill)).toBe(false);
  });

  it('does NOT expand when favicon is in tabs-anchor container', () => {
    const anchor = document.getElementById('pill-island-tabs-anchor');
    const tabsPill = document.querySelector('.pill-island[data-island-id="tabs"]');
    anchor.appendChild(tabsPill);

    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    const favicon = document.querySelector('[data-island-tab="1"]');
    expect(shouldExpandIsland({ target: favicon }, wrap, pill)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// Direct click handlers on favicons — stopPropagation prevents
// expand, browseSelectTab navigates to the tab
// ══════════════════════════════════════════════════════════════

describe('Favicon direct click handlers', () => {
  beforeEach(() => makeDOM());

  it('favicon click calls browseSelectTab and stops propagation', () => {
    const selectTab = vi.fn();
    const stopPropagation = vi.fn();

    // Simulate what the capture-phase handler does with a direct import
    const handler = function(e, browseSelectTab) {
      e.stopPropagation();
      browseSelectTab(1);
    };
    handler({ stopPropagation }, selectTab);

    expect(stopPropagation).toHaveBeenCalled();
    expect(selectTab).toHaveBeenCalledWith(1);
  });

  it('close button click calls browseCloseTab and stops propagation', () => {
    const closeTab = vi.fn();
    const stopPropagation = vi.fn();

    // Simulate what the capture-phase handler does with a direct import
    const handler = function(e, browseCloseTab) {
      e.stopPropagation();
      browseCloseTab(2);
    };
    handler({ stopPropagation }, closeTab);

    expect(stopPropagation).toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalledWith(2);
  });

  it('stopPropagation prevents expand handler from firing', () => {
    const wrap = document.getElementById('pill-url-wrap');
    const pill = document.getElementById('sidebar-nav');
    let expandCalled = false;

    // Simulate full click flow: direct handler stops propagation,
    // so the document expand handler never sees the event
    const favicon = document.querySelector('[data-island-tab="1"]');
    let propagationStopped = false;

    // Direct handler on favicon
    favicon.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Document expand handler (should NOT fire)
    wrap.addEventListener('click', function(e) {
      expandCalled = true;
    });

    favicon.click();
    expect(expandCalled).toBe(false);
  });

  it('clicking overflow text still allows expand', () => {
    const wrap = document.getElementById('pill-url-wrap');
    let expandCalled = false;

    wrap.addEventListener('click', function() {
      expandCalled = true;
    });

    const overflow = document.querySelector('.island-strip-overflow');
    overflow.click();
    expect(expandCalled).toBe(true);
  });
});
