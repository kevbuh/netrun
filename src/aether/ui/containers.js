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

    function _rebuild() {
      var arr = S.isSignal(items) ? items.value : items;
      if (!Array.isArray(arr)) arr = [];

      // Dispose old child effects
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

    if (S.isSignal(items)) {
      _rebuild();
      v._effects.push(S.Effect(function() {
        items.value; // track dependency
        _rebuild();
      }));
    } else {
      _rebuild();
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
