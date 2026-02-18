/* AetherUI Containers — List, ForEach, Group, Section
   Reactive list rendering with fine-grained DOM updates. */

(function() {
  'use strict';

  var View = window._AetherUIView;
  var S = window._AetherUIState;

  function _spaceToken(v) {
    if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
    return v;
  }

  // ─── ForEach — reactive list rendering ────────────────────

  function ForEach(items, keyFnOrRenderFn, renderFn) {
    var v = new View('div');
    var keyFn = renderFn ? keyFnOrRenderFn : null;
    var render = renderFn || keyFnOrRenderFn;
    var _childViews = [];
    var _keyedMap = {}; // key → { view, el }

    function _rebuildFull() {
      var arr = S.isSignal(items) ? items.value : items;
      if (!Array.isArray(arr)) arr = [];

      for (var i = 0; i < _childViews.length; i++) {
        if (_childViews[i].dispose) _childViews[i].dispose();
      }
      _childViews.length = 0;
      v.el.innerHTML = '';

      for (var j = 0; j < arr.length; j++) {
        var child = render(arr[j], j);
        if (child == null) continue;
        if (child instanceof View) {
          v.el.appendChild(child.build());
          if (child._onAppearFn) child._onAppearFn();
          _childViews.push(child);
        } else if (child instanceof HTMLElement) {
          v.el.appendChild(child);
        }
      }
    }

    function _reconcile() {
      var arr = S.isSignal(items) ? items.value : items;
      if (!Array.isArray(arr)) arr = [];

      var newKeys = [];
      var newMap = {};
      var i, key, entry, child;

      // Build new key list
      for (i = 0; i < arr.length; i++) {
        key = '' + keyFn(arr[i], i);
        newKeys.push(key);
        newMap[key] = arr[i];
      }

      // Remove entries whose keys are gone
      for (key in _keyedMap) {
        if (!newMap.hasOwnProperty(key)) {
          entry = _keyedMap[key];
          if (entry.view.dispose) entry.view.dispose();
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
          delete _keyedMap[key];
        }
      }

      // Create new entries for added keys
      for (i = 0; i < newKeys.length; i++) {
        key = newKeys[i];
        if (!_keyedMap[key]) {
          child = render(newMap[key], i);
          if (child == null) continue;
          if (child instanceof View) {
            _keyedMap[key] = { view: child, el: child.build() };
            if (child._onAppearFn) child._onAppearFn();
          } else if (child instanceof HTMLElement) {
            _keyedMap[key] = { view: null, el: child };
          }
        }
      }

      // Reorder DOM via cursor walk
      var cursor = v.el.firstChild;
      for (i = 0; i < newKeys.length; i++) {
        entry = _keyedMap[newKeys[i]];
        if (!entry) continue;
        if (entry.el !== cursor) {
          v.el.insertBefore(entry.el, cursor);
        } else {
          cursor = cursor.nextSibling;
        }
      }

      // Update _childViews
      _childViews.length = 0;
      for (i = 0; i < newKeys.length; i++) {
        entry = _keyedMap[newKeys[i]];
        if (entry && entry.view) _childViews.push(entry.view);
      }
    }

    var _doUpdate = keyFn ? _reconcile : _rebuildFull;

    if (S.isSignal(items)) {
      _doUpdate();
      v._effects.push(S.Effect(function() {
        items.value; // track dependency
        _doUpdate();
      }));
    } else {
      _doUpdate();
    }

    v.spacing = function(s) {
      v.el.style.display = 'flex';
      v.el.style.flexDirection = 'column';
      v.el.style.gap = _spaceToken(s);
      return v;
    };

    return v;
  }

  // ─── List — styled ForEach with dividers ──────────────────

  function List(items, keyFnOrRenderFn, renderFn) {
    var forEach = ForEach(items, keyFnOrRenderFn, renderFn);
    forEach.el.style.display = 'flex';
    forEach.el.style.flexDirection = 'column';
    forEach.className('aether-ui-list');

    forEach.dividers = function() {
      forEach.el.classList.add('aether-ui-list-dividers');
      return forEach;
    };

    forEach.inset = function() {
      forEach.el.style.padding = _spaceToken(3) + ' ' + _spaceToken(4);
      return forEach;
    };

    return forEach;
  }

  // ─── Group — no-op wrapper for logical grouping ───────────

  function Group() {
    var children = Array.prototype.slice.call(arguments);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];
    var v = new View('div');
    v.el.style.display = 'contents';
    v._appendChildren(children);
    return v;
  }

  // ─── Section — header + content group ─────────────────────

  function Section(header) {
    var children = Array.prototype.slice.call(arguments, 1);
    if (children.length === 1 && Array.isArray(children[0])) children = children[0];

    var v = new View('div');
    v.el.className = 'aether-ui-section';

    // Header
    if (header) {
      var h = document.createElement('div');
      h.className = 'aether-ui-section-header';
      if (typeof header === 'string') {
        h.textContent = header;
      } else if (header instanceof View) {
        h.appendChild(header.build());
        v._children.push(header);
      }
      v.el.appendChild(h);
    }

    // Content wrapper
    var content = document.createElement('div');
    content.className = 'aether-ui-section-content';
    v.el.appendChild(content);

    // Append children to content wrapper
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child == null) continue;
      if (child instanceof View) {
        content.appendChild(child.build());
        v._children.push(child);
        if (child._onAppearFn) child._onAppearFn();
      } else if (child instanceof HTMLElement) {
        content.appendChild(child);
      }
    }

    v.spacing = function(s) {
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.gap = _spaceToken(s);
      return v;
    };

    return v;
  }

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIContainers = {
    ForEach: ForEach,
    List: List,
    Group: Group,
    Section: Section
  };

})();
