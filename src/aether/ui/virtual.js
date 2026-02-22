/* AetherUI VirtualList — virtualized scrolling for large lists
   Renders only visible rows + overscan, recycling DOM elements. */

'use strict';

import { View } from '/aether/ui/view.js';
import { isSignal, resolve, Effect } from '/aether/ui/state.js';

var S = { isSignal, resolve, Effect };

// ─── VirtualList ─────────────────────────────────────────

function VirtualList(items, keyFn, renderFn, opts) {
  opts = opts || {};
  var rowHeight = opts.rowHeight || 44;
  var overscan = opts.overscan || 5;

  var v = new View('div');
  v._viewType = 'VirtualList';
  v.el.style.overflow = 'auto';
  v.el.style.position = 'relative';
  var _showDividers = false;

  // Spacer element to set scroll height
  var spacer = document.createElement('div');
  spacer.style.position = 'relative';
  spacer.style.width = '100%';
  v.el.appendChild(spacer);

  // Container for visible rows
  var container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '0';
  container.style.right = '0';
  spacer.appendChild(container);

  var _pool = []; // recycled DOM elements
  var _activeViews = {}; // key → { view, el, index }
  var _lastStart = -1;
  var _lastEnd = -1;

  function _getItems() {
    var arr = S.isSignal(items) ? items.value : items;
    return Array.isArray(arr) ? arr : [];
  }

  function _render() {
    var arr = _getItems();
    var totalHeight = arr.length * rowHeight;
    spacer.style.height = totalHeight + 'px';

    var scrollTop = v.el.scrollTop;
    var viewHeight = v.el.clientHeight || 400;

    var start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    var end = Math.min(arr.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + overscan);

    // Skip if range unchanged
    if (start === _lastStart && end === _lastEnd) return;
    _lastStart = start;
    _lastEnd = end;

    // Build set of visible keys
    var visibleKeys = {};
    for (var i = start; i < end; i++) {
      var key = keyFn ? '' + keyFn(arr[i], i) : '' + i;
      visibleKeys[key] = { item: arr[i], index: i };
    }

    // Remove out-of-range entries
    for (var k in _activeViews) {
      if (!visibleKeys[k]) {
        var entry = _activeViews[k];
        if (entry.view && entry.view.dispose) entry.view.dispose();
        if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        _pool.push(entry.el);
        delete _activeViews[k];
      }
    }

    // Add or update visible entries
    for (var key2 in visibleKeys) {
      var info = visibleKeys[key2];
      if (_activeViews[key2]) {
        // Reposition existing
        _activeViews[key2].el.style.transform = 'translateY(' + (info.index * rowHeight) + 'px)';
        _activeViews[key2].index = info.index;
      } else {
        // Create new row
        var child = renderFn(info.item, info.index);
        if (child == null) continue;

        var el;
        if (child instanceof View) {
          el = child.build();
          for (var j = 0; j < child._onAppearFns.length; j++) child._onAppearFns[j]();
        } else if (child instanceof HTMLElement) {
          el = child;
        } else {
          continue;
        }

        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = rowHeight + 'px';
        el.style.transform = 'translateY(' + (info.index * rowHeight) + 'px)';

        if (_showDividers) {
          el.style.borderBottom = '1px solid var(--nr-border-default)';
        }

        container.appendChild(el);
        _activeViews[key2] = { view: child instanceof View ? child : null, el: el, index: info.index };
      }
    }
  }

  // Initial render
  _render();

  // Scroll listener
  var _scrollHandler = function() { _render(); };
  v.el.addEventListener('scroll', _scrollHandler, { passive: true });
  v._listeners.push(['scroll', _scrollHandler]);

  // Reactive data source
  if (S.isSignal(items)) {
    v._effects.push(S.Effect(function() {
      items.value; // track
      _lastStart = -1;
      _lastEnd = -1;
      _render();
    }));
  }

  v.dividers = function() {
    _showDividers = true;
    // Apply to existing
    for (var k in _activeViews) {
      _activeViews[k].el.style.borderBottom = '1px solid var(--nr-border-default)';
    }
    return v;
  };

  return v;
}

// ─── Export ───────────────────────────────────────────────

window._AetherUIVirtual = {
  VirtualList: VirtualList
};

export { VirtualList };
