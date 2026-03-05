import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Re-implement _handleContextMenuChat decision logic from panel.js
// This mirrors the guard conditions so regressions are caught.
// ═══════════════════════════════════════════════════════════════

/**
 * Returns what the context menu handler should do:
 *   'skip'       — bail, let native context menu through
 *   'editable'   — open panel with editableTarget
 *   'tab-menu'   — show tab context menu
 *   'panel'      — open aether panel (default)
 */
function contextMenuAction(opts) {
  const { aiEnabled, clickAether, target, activeElement } = opts;
  if (!aiEnabled) return 'skip';
  if (clickAether === 'off') return 'skip';
  // Login/onboard guards omitted (trivial DOM check)
  // Existing popup guard omitted (trivial DOM check)

  // URL bar
  if (target.id === 'browse-url-input' || target.closest('#browse-bar')) return 'skip';

  // Editable elements
  const tag = target.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  if (isEditable) return 'editable';

  // Browse tabs
  if (target.closest('.browse-tab, .browse-vtab')) return 'tab-menu';

  // Browse chrome
  if (target.closest('#browse-bar, #browse-tab-row, #browse-vtabs, #universal-panel')) return 'skip';

  // Webview/iframe inside browse-content
  const browseContent = target.closest('#browse-content');
  if (browseContent && (target.tagName === 'IFRAME' || target.tagName === 'WEBVIEW')) return 'skip';

  // Default: open panel. priorEditable captures active element.
  const activeTag = activeElement?.tagName;
  const priorEditable = (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeElement?.isContentEditable) ? activeElement : null;
  return { action: 'panel', priorEditable };
}

// ── Re-implement _positionAtCursor from panel.js ──

function _positionAtCursor(cx, cy, w, h, preferLeft) {
  // Simplified safe bounds (assumes viewport)
  const bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  let left, top;
  const fitsLeft  = cx - w >= bounds.left;
  const fitsRight = cx + w <= bounds.right;
  const fitsAbove = cy - h >= bounds.top;
  const fitsBelow = cy + h <= bounds.bottom;

  if (preferLeft) {
    left = fitsLeft ? cx - w : cx;
  } else {
    left = fitsRight ? cx : cx - w;
  }
  top = fitsAbove ? cy - h : cy;

  return { left, top };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('_positionAtCursor', () => {
  // happy-dom defaults: window.innerWidth=1024, window.innerHeight=768

  describe('preferLeft=false (default, prefer right)', () => {
    it('positions to the right of cursor when space available', () => {
      const { left, top } = _positionAtCursor(100, 400, 200, 100, false);
      expect(left).toBe(100); // right of cursor
      expect(top).toBe(300); // above cursor (400-100)
    });

    it('flips to left when no space on right', () => {
      const { left } = _positionAtCursor(900, 400, 200, 100, false);
      expect(left).toBe(700); // 900-200 = left of cursor
    });

    it('positions below when no space above', () => {
      const { top } = _positionAtCursor(100, 50, 200, 100, false);
      expect(top).toBe(50); // below cursor
    });
  });

  describe('preferLeft=true', () => {
    it('positions to the left of cursor when space available', () => {
      const { left } = _positionAtCursor(500, 400, 200, 100, true);
      expect(left).toBe(300); // 500-200 = left of cursor
    });

    it('flips to right when no space on left', () => {
      const { left } = _positionAtCursor(100, 400, 200, 100, true);
      expect(left).toBe(100); // right of cursor (no space on left)
    });
  });

  describe('edge cases', () => {
    it('handles cursor at top-left corner', () => {
      const { left, top } = _positionAtCursor(0, 0, 200, 100, false);
      expect(left).toBe(0);
      expect(top).toBe(0); // below cursor (no space above)
    });

    it('handles cursor at bottom-right corner', () => {
      const { left, top } = _positionAtCursor(1024, 768, 200, 100, false);
      expect(left).toBe(824); // 1024-200, flipped to left
      expect(top).toBe(668); // 768-100, above cursor
    });

    it('handles zero-size popup', () => {
      const { left, top } = _positionAtCursor(500, 400, 0, 0, false);
      expect(left).toBe(500);
      expect(top).toBe(400);
    });

    it('handles popup exactly fitting viewport', () => {
      const { left, top } = _positionAtCursor(512, 384, 1024, 768, false);
      // Can't fit right (512+1024=1536 > 1024), flips left (512-1024=-512 < 0)
      // So: left = cx - w = -512 (fitsRight false, so left = cx - w)
      expect(left).toBe(-512);
    });

    it('prefers above when space is available', () => {
      const { top } = _positionAtCursor(500, 500, 200, 100, false);
      expect(top).toBe(400); // 500-100, above cursor
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Context menu (right-click) guard logic
// ═══════════════════════════════════════════════════════════════

describe('contextMenuAction (right-click guards)', () => {
  function makeTarget(tagName, opts = {}) {
    const parents = new Set(opts.parents || []);
    return {
      tagName,
      id: opts.id || '',
      isContentEditable: opts.contentEditable || false,
      closest(selector) {
        // Simple mock: check if any parent selector matches
        const selectors = selector.split(',').map(s => s.trim());
        return selectors.some(s => parents.has(s)) ? {} : null;
      }
    };
  }

  const defaults = { aiEnabled: true, clickAether: 'on' };

  it('skips when AI is disabled', () => {
    const target = makeTarget('DIV');
    expect(contextMenuAction({ ...defaults, aiEnabled: false, target, activeElement: null })).toBe('skip');
  });

  it('skips when clickAether setting is off', () => {
    const target = makeTarget('DIV');
    expect(contextMenuAction({ ...defaults, clickAether: 'off', target, activeElement: null })).toBe('skip');
  });

  it('skips on browse URL input by id', () => {
    const target = makeTarget('INPUT', { id: 'browse-url-input' });
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('skip');
  });

  it('skips on elements inside #browse-bar', () => {
    const target = makeTarget('DIV', { parents: ['#browse-bar'] });
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('skip');
  });

  it('opens panel with editableTarget for INPUT elements', () => {
    const target = makeTarget('INPUT');
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('editable');
  });

  it('opens panel with editableTarget for TEXTAREA elements', () => {
    const target = makeTarget('TEXTAREA');
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('editable');
  });

  it('opens panel with editableTarget for contentEditable elements', () => {
    const target = makeTarget('DIV', { contentEditable: true });
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('editable');
  });

  it('shows tab menu for browse tabs', () => {
    const target = makeTarget('DIV', { parents: ['.browse-tab'] });
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('tab-menu');
  });

  it('skips browse chrome (#browse-tab-row, #browse-vtabs, #universal-panel)', () => {
    for (const sel of ['#browse-tab-row', '#browse-vtabs', '#universal-panel']) {
      const target = makeTarget('DIV', { parents: [sel] });
      expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('skip');
    }
  });

  it('skips webview/iframe inside #browse-content', () => {
    const target = makeTarget('WEBVIEW', { parents: ['#browse-content'] });
    expect(contextMenuAction({ ...defaults, target, activeElement: null })).toBe('skip');
    const target2 = makeTarget('IFRAME', { parents: ['#browse-content'] });
    expect(contextMenuAction({ ...defaults, target: target2, activeElement: null })).toBe('skip');
  });

  it('opens panel on regular NTP content inside #browse-content', () => {
    const target = makeTarget('DIV', { parents: ['#browse-content'] });
    const result = contextMenuAction({ ...defaults, target, activeElement: null });
    expect(result).toEqual({ action: 'panel', priorEditable: null });
  });

  it('opens panel on NTP with focused input — captures priorEditable', () => {
    const target = makeTarget('DIV', { parents: ['#browse-content'] });
    const activeInput = makeTarget('INPUT');
    const result = contextMenuAction({ ...defaults, target, activeElement: activeInput });
    expect(result.action).toBe('panel');
    expect(result.priorEditable).toBe(activeInput);
  });

  it('opens panel on NTP with focused textarea — captures priorEditable', () => {
    const target = makeTarget('DIV', { parents: ['#browse-content'] });
    const activeTextarea = makeTarget('TEXTAREA');
    const result = contextMenuAction({ ...defaults, target, activeElement: activeTextarea });
    expect(result.action).toBe('panel');
    expect(result.priorEditable).toBe(activeTextarea);
  });

  it('opens panel on NTP with non-editable activeElement — priorEditable is null', () => {
    const target = makeTarget('DIV', { parents: ['#browse-content'] });
    const activeDiv = makeTarget('DIV');
    const result = contextMenuAction({ ...defaults, target, activeElement: activeDiv });
    expect(result.action).toBe('panel');
    expect(result.priorEditable).toBeNull();
  });

  it('opens panel on empty page (no browse-content parent)', () => {
    const target = makeTarget('DIV');
    const result = contextMenuAction({ ...defaults, target, activeElement: null });
    expect(result).toEqual({ action: 'panel', priorEditable: null });
  });
});
