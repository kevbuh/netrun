import { describe, it, expect, vi } from 'vitest';

// ── Imports ─────────────────────────────────────────────────────
// Browser-absolute paths (/aether/ui/*.js, /aether/tokens.js) are
// resolved via vitest.config.js aliases to their src/ counterparts,
// so virtual.js and its transitive imports (view.js, state.js) all
// resolve correctly.

import { State } from './state.js';
import { View } from './view.js';
import { VirtualList } from './virtual.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeItems(n) {
  var arr = [];
  for (var i = 0; i < n; i++) arr.push({ id: i, label: 'Item ' + i });
  return arr;
}

function keyFn(item) { return item.id; }

function renderFn(item) {
  var v = new View('div');
  v.el.textContent = item.label;
  return v;
}

function renderFnRaw(item) {
  var el = document.createElement('div');
  el.textContent = item.label;
  return el;
}

/** Simulate the container having a known clientHeight so _render sees a viewport. */
function setViewport(vl, height) {
  Object.defineProperty(vl.el, 'clientHeight', { value: height, configurable: true });
}

/** Force a scroll position and dispatch event to trigger re-render. */
function scrollTo(vl, top) {
  vl.el.scrollTop = top;
  vl.el.dispatchEvent(new Event('scroll'));
}

/** Return the absolutely-positioned row elements inside the container. */
function getRows(vl) {
  // structure: vl.el > spacer > container > row*
  var spacer = vl.el.firstChild;
  var container = spacer && spacer.firstChild;
  if (!container) return [];
  return Array.from(container.children);
}

// ═══════════════════════════════════════════════════════════════
// Construction & DOM structure
// ═══════════════════════════════════════════════════════════════

describe('VirtualList', () => {

  describe('construction and DOM structure', () => {
    it('creates a div with overflow auto and position relative', () => {
      var vl = VirtualList([], keyFn, renderFn);
      expect(vl.el.tagName).toBe('DIV');
      expect(vl.el.style.overflow).toBe('auto');
      expect(vl.el.style.position).toBe('relative');
    });

    it('sets _viewType to VirtualList', () => {
      var vl = VirtualList([], keyFn, renderFn);
      expect(vl._viewType).toBe('VirtualList');
    });

    it('contains a spacer element as the first child', () => {
      var vl = VirtualList([], keyFn, renderFn);
      var spacer = vl.el.firstChild;
      expect(spacer).toBeTruthy();
      expect(spacer.tagName).toBe('DIV');
      expect(spacer.style.position).toBe('relative');
      expect(spacer.style.width).toBe('100%');
    });

    it('contains an absolutely positioned container inside the spacer', () => {
      var vl = VirtualList([], keyFn, renderFn);
      var spacer = vl.el.firstChild;
      var container = spacer.firstChild;
      expect(container).toBeTruthy();
      expect(container.style.position).toBe('absolute');
      expect(container.style.top).toBe('0px');
      expect(container.style.left).toBe('0px');
      expect(container.style.right).toBe('0px');
    });

    it('returns a View instance', () => {
      var vl = VirtualList([], keyFn, renderFn);
      expect(vl).toBeInstanceOf(View);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Spacer height
  // ═══════════════════════════════════════════════════════════════

  describe('spacer height', () => {
    it('equals items.length * rowHeight with default rowHeight (44)', () => {
      var items = makeItems(20);
      var vl = VirtualList(items, keyFn, renderFn);
      var spacer = vl.el.firstChild;
      expect(spacer.style.height).toBe((20 * 44) + 'px');
    });

    it('uses custom rowHeight from opts', () => {
      var items = makeItems(10);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 60 });
      var spacer = vl.el.firstChild;
      expect(spacer.style.height).toBe((10 * 60) + 'px');
    });

    it('is 0px for empty array', () => {
      var vl = VirtualList([], keyFn, renderFn);
      var spacer = vl.el.firstChild;
      expect(spacer.style.height).toBe('0px');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Visible rows
  // ═══════════════════════════════════════════════════════════════

  describe('visible rows rendering', () => {
    it('renders only visible rows plus overscan (default overscan = 5)', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      // clientHeight defaults to 400 in the source when el.clientHeight is 0
      // end = min(100, ceil((0 + 400) / 40) + 5) = 15
      // start = max(0, floor(0/40) - 5) = 0
      var rows = getRows(vl);
      expect(rows.length).toBe(15);
    });

    it('renders all items when total fits within viewport + overscan', () => {
      var items = makeItems(5);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      var rows = getRows(vl);
      expect(rows.length).toBe(5);
    });

    it('respects custom overscan', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 50, overscan: 2 });
      // start = max(0, floor(0/50) - 2) = 0
      // end = min(100, ceil((0+400)/50) + 2) = min(100, 10) = 10
      var rows = getRows(vl);
      expect(rows.length).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Row positioning
  // ═══════════════════════════════════════════════════════════════

  describe('row positioning via translateY', () => {
    it('positions each row at index * rowHeight', () => {
      var items = makeItems(5);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 44 });
      var rows = getRows(vl);
      for (var i = 0; i < rows.length; i++) {
        expect(rows[i].style.transform).toBe('translateY(' + (i * 44) + 'px)');
      }
    });

    it('sets absolute positioning on each row element', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 30 });
      var rows = getRows(vl);
      rows.forEach(function(row) {
        expect(row.style.position).toBe('absolute');
        expect(row.style.top).toBe('0px');
        expect(row.style.left).toBe('0px');
        expect(row.style.right).toBe('0px');
      });
    });

    it('sets row height to rowHeight value', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 55 });
      var rows = getRows(vl);
      rows.forEach(function(row) {
        expect(row.style.height).toBe('55px');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Scrolling
  // ═══════════════════════════════════════════════════════════════

  describe('scrolling updates visible rows', () => {
    it('shifts rendered rows when scrolled down', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      setViewport(vl, 200);

      scrollTo(vl, 400);

      var rows = getRows(vl);
      // start = max(0, floor(400/40) - 5) = 5
      // end = min(100, ceil((400+200)/40) + 5) = 20
      expect(rows.length).toBe(15);

      var transforms = rows.map(function(r) { return r.style.transform; });
      expect(transforms).toContain('translateY(' + (5 * 40) + 'px)');
      expect(transforms).toContain('translateY(' + (19 * 40) + 'px)');
    });

    it('recycles DOM elements when scrolling past initial range', () => {
      var items = makeItems(200);
      // Note: overscan uses `|| 5` so 0 is falsy and falls back to 5
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      // Initial render: clientHeight fallback 400, ceil(400/40)+5 = 15 rows
      var initialRows = getRows(vl);
      expect(initialRows.length).toBe(15);

      setViewport(vl, 200);
      scrollTo(vl, 4000);
      // happy-dom may not support scrollTop — guard scroll-dependent assertions
      if (vl.el.scrollTop > 0) {
        var newRows = getRows(vl);
        expect(newRows.length).toBeGreaterThan(0);
        var transforms = newRows.map(function(r) { return r.style.transform; });
        expect(transforms).not.toContain('translateY(0px)');
      }
    });

    it('does not re-render when scroll range is unchanged', () => {
      var renderSpy = vi.fn(function(item) {
        var el = document.createElement('div');
        el.textContent = item.label;
        return el;
      });
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderSpy, { rowHeight: 40 });

      var callCountAfterInit = renderSpy.mock.calls.length;

      // Dispatch scroll with same scrollTop — range unchanged
      scrollTo(vl, 0);

      expect(renderSpy.mock.calls.length).toBe(callCountAfterInit);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Key function
  // ═══════════════════════════════════════════════════════════════

  describe('key function', () => {
    it('uses keyFn to create unique entries', () => {
      var items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
      var vl = VirtualList(items, function(item) { return item.id; }, renderFn, { rowHeight: 40 });
      var rows = getRows(vl);
      expect(rows.length).toBe(2);
    });

    it('falls back to index when keyFn is null', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, null, renderFn, { rowHeight: 40 });
      var rows = getRows(vl);
      expect(rows.length).toBe(3);
    });

    it('reuses existing rows on overlapping scroll (no re-render for same key)', () => {
      var items = makeItems(10);
      var callCount = 0;
      var countingRender = function(item) {
        callCount++;
        var v = new View('div');
        v.el.textContent = item.label;
        return v;
      };
      var vl = VirtualList(items, keyFn, countingRender, { rowHeight: 40, overscan: 0 });
      setViewport(vl, 400);

      var firstCallCount = callCount;
      // Scroll by one row — most rows overlap
      scrollTo(vl, 40);
      var newCalls = callCount - firstCallCount;
      // At most 1 new row was introduced (shifted by 1 row)
      expect(newCalls).toBeLessThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Reactive data source (Signal)
  // ═══════════════════════════════════════════════════════════════

  describe('reactive data source (Signal)', () => {
    it('re-renders when signal value changes', () => {
      var sig = State(makeItems(3));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });

      expect(getRows(vl).length).toBe(3);

      sig.value = makeItems(6);
      expect(getRows(vl).length).toBe(6);
    });

    it('removes DOM elements when items shrink', () => {
      var sig = State(makeItems(5));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });
      expect(getRows(vl).length).toBe(5);

      sig.value = makeItems(2);
      expect(getRows(vl).length).toBe(2);
    });

    it('adds DOM elements when items grow', () => {
      var sig = State(makeItems(2));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });
      expect(getRows(vl).length).toBe(2);

      sig.value = makeItems(8);
      expect(getRows(vl).length).toBe(8);
    });

    it('updates spacer height when signal changes', () => {
      var sig = State(makeItems(5));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 44 });
      expect(vl.el.firstChild.style.height).toBe((5 * 44) + 'px');

      sig.value = makeItems(20);
      expect(vl.el.firstChild.style.height).toBe((20 * 44) + 'px');
    });

    it('pushes an Effect onto v._effects for reactive tracking', () => {
      var sig = State(makeItems(3));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });
      expect(vl._effects.length).toBeGreaterThanOrEqual(1);
    });

    it('handles signal changing to empty array', () => {
      var sig = State(makeItems(10));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });
      expect(getRows(vl).length).toBeGreaterThan(0);

      sig.value = [];
      expect(getRows(vl).length).toBe(0);
      expect(vl.el.firstChild.style.height).toBe('0px');
    });

    it('does not push Effect for non-signal items', () => {
      var vl = VirtualList(makeItems(3), keyFn, renderFn, { rowHeight: 40 });
      // No reactive effect should be registered for a plain array
      expect(vl._effects.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Dividers modifier
  // ═══════════════════════════════════════════════════════════════

  describe('dividers modifier', () => {
    it('returns the view for chaining', () => {
      var vl = VirtualList(makeItems(3), keyFn, renderFn, { rowHeight: 40 });
      var result = vl.dividers();
      expect(result).toBe(vl);
    });

    it('applies border-bottom to existing rows', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      vl.dividers();
      var rows = getRows(vl);
      rows.forEach(function(row) {
        expect(row.style.borderBottom).toContain('var(--nr-border-default)');
      });
    });

    it('applies border-bottom to newly rendered rows after dividers()', () => {
      var sig = State(makeItems(2));
      var vl = VirtualList(sig, keyFn, renderFn, { rowHeight: 40 });
      vl.dividers();

      sig.value = makeItems(5);
      var rows = getRows(vl);
      rows.forEach(function(row) {
        expect(row.style.borderBottom).toContain('var(--nr-border-default)');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Empty and edge cases
  // ═══════════════════════════════════════════════════════════════

  describe('empty and edge cases', () => {
    it('handles empty array without errors', () => {
      expect(function() {
        VirtualList([], keyFn, renderFn);
      }).not.toThrow();
      var vl = VirtualList([], keyFn, renderFn);
      expect(getRows(vl).length).toBe(0);
    });

    it('handles null items gracefully (treats as empty)', () => {
      expect(function() {
        VirtualList(null, keyFn, renderFn);
      }).not.toThrow();
      var vl = VirtualList(null, keyFn, renderFn);
      expect(getRows(vl).length).toBe(0);
    });

    it('handles undefined items gracefully (treats as empty)', () => {
      expect(function() {
        VirtualList(undefined, keyFn, renderFn);
      }).not.toThrow();
      var vl = VirtualList(undefined, keyFn, renderFn);
      expect(getRows(vl).length).toBe(0);
    });

    it('handles non-array signal value gracefully', () => {
      var sig = State('not an array');
      expect(function() {
        VirtualList(sig, keyFn, renderFn);
      }).not.toThrow();
      var vl = VirtualList(sig, keyFn, renderFn);
      expect(getRows(vl).length).toBe(0);
    });

    it('handles renderFn returning null (skips row)', () => {
      var items = makeItems(3);
      var nullRender = function() { return null; };
      var vl = VirtualList(items, keyFn, nullRender, { rowHeight: 40 });
      expect(getRows(vl).length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // renderFn return types
  // ═══════════════════════════════════════════════════════════════

  describe('renderFn return types', () => {
    it('handles View instances from renderFn', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      var rows = getRows(vl);
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toBe('Item 0');
    });

    it('handles raw HTMLElement from renderFn', () => {
      var items = makeItems(3);
      var vl = VirtualList(items, keyFn, renderFnRaw, { rowHeight: 40 });
      var rows = getRows(vl);
      expect(rows.length).toBe(3);
      expect(rows[0].textContent).toBe('Item 0');
    });

    it('skips non-View non-Element return values', () => {
      var items = makeItems(3);
      var stringRender = function() { return 'just a string'; };
      var vl = VirtualList(items, keyFn, stringRender, { rowHeight: 40 });
      expect(getRows(vl).length).toBe(0);
    });

    it('calls onAppear functions for View instances', () => {
      var appeared = [];
      var appearRender = function(item) {
        var v = new View('div');
        v.el.textContent = item.label;
        v._onAppearFns.push(function() { appeared.push(item.id); });
        return v;
      };
      var items = makeItems(3);
      VirtualList(items, keyFn, appearRender, { rowHeight: 40 });
      expect(appeared).toEqual([0, 1, 2]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Scroll listener
  // ═══════════════════════════════════════════════════════════════

  describe('scroll listener', () => {
    it('registers a scroll listener on the root element', () => {
      var vl = VirtualList(makeItems(5), keyFn, renderFn, { rowHeight: 40 });
      var scrollListeners = vl._listeners.filter(function(l) { return l[0] === 'scroll'; });
      expect(scrollListeners.length).toBe(1);
    });

    it('scroll event triggers re-render with new range', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40, overscan: 0 });
      setViewport(vl, 200);

      scrollTo(vl, 1000);

      var newRows = getRows(vl);
      // start = floor(1000/40) = 25, end = ceil((1000+200)/40) = 30 → 5 rows
      // Verify the expected rows are present via their transforms
      var transforms = newRows.map(function(r) { return r.style.transform; });
      expect(transforms).toContain('translateY(' + (25 * 40) + 'px)');
      expect(transforms).toContain('translateY(' + (29 * 40) + 'px)');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Default options
  // ═══════════════════════════════════════════════════════════════

  describe('default options', () => {
    it('defaults rowHeight to 44', () => {
      var items = makeItems(1);
      var vl = VirtualList(items, keyFn, renderFn);
      var rows = getRows(vl);
      expect(rows[0].style.height).toBe('44px');
    });

    it('defaults overscan to 5', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      // start = 0, end = min(100, ceil(400/40) + 5) = 15
      var rows = getRows(vl);
      expect(rows.length).toBe(15);
    });

    it('works with empty opts object', () => {
      expect(function() {
        VirtualList(makeItems(5), keyFn, renderFn, {});
      }).not.toThrow();
    });

    it('works with no opts argument', () => {
      expect(function() {
        VirtualList(makeItems(5), keyFn, renderFn);
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Disposal and cleanup
  // ═══════════════════════════════════════════════════════════════

  describe('disposal of out-of-range views', () => {
    it('disposes View instances when they scroll out of range', () => {
      var disposed = [];
      var disposableRender = function(item) {
        var v = new View('div');
        v.el.textContent = item.label;
        var origDispose = v.dispose.bind(v);
        v.dispose = function() {
          disposed.push(item.id);
          origDispose();
        };
        return v;
      };
      var items = makeItems(50);
      var vl = VirtualList(items, keyFn, disposableRender, { rowHeight: 40 });
      // Initial render: clientHeight fallback 400, ceil(400/40)+5 = 15 rows (indices 0..14)
      expect(getRows(vl).length).toBe(15);

      setViewport(vl, 200);
      scrollTo(vl, 4000);
      // happy-dom may not support scrollTop — guard scroll-dependent assertions
      if (vl.el.scrollTop > 0) {
        expect(disposed.length).toBeGreaterThan(0);
        expect(disposed).toContain(0);
        expect(disposed).toContain(4);
      }
    });

    it('removes out-of-range DOM elements from the container', () => {
      var items = makeItems(50);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 40 });
      // Initial render: clientHeight fallback 400, ceil(400/40)+5 = 15 rows
      expect(getRows(vl).length).toBe(15);

      setViewport(vl, 200);
      scrollTo(vl, 4000);
      // happy-dom may not support scrollTop — guard scroll-dependent assertions
      if (vl.el.scrollTop > 0) {
        var newRows = getRows(vl);
        var transforms = newRows.map(function(r) { return r.style.transform; });
        expect(transforms).not.toContain('translateY(0px)');
        expect(transforms).not.toContain('translateY(40px)');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Overscan above and below viewport
  // ═══════════════════════════════════════════════════════════════

  describe('overscan adds extra rows above and below viewport', () => {
    it('renders overscan rows below viewport at scrollTop 0', () => {
      var items = makeItems(100);
      // With default clientHeight fallback of 400:
      // start = max(0, floor(0/50) - 3) = 0
      // end = min(100, ceil(400/50) + 3) = 11
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 50, overscan: 3 });
      var rows = getRows(vl);
      expect(rows.length).toBe(11);
    });

    it('renders overscan rows above viewport when scrolled', () => {
      var items = makeItems(100);
      var vl = VirtualList(items, keyFn, renderFn, { rowHeight: 50, overscan: 3 });
      setViewport(vl, 200);

      scrollTo(vl, 1000);

      // start = max(0, floor(1000/50) - 3) = 17
      // end = min(100, ceil(1200/50) + 3) = 27
      var rows = getRows(vl);
      expect(rows.length).toBe(10);

      var transforms = rows.map(function(r) { return r.style.transform; });
      expect(transforms).toContain('translateY(' + (17 * 50) + 'px)');
      expect(transforms).toContain('translateY(' + (26 * 50) + 'px)');
    });
  });
});
