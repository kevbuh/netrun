import { describe, it, expect, vi, beforeEach } from 'vitest';
import { State, Effect, isSignal, resolve } from './state.js';

// ── Minimal View replica ─────────────────────────────────────
function View(tag) {
  this.el = document.createElement(tag || 'div');
  this._effects = [];
  this._children = [];
  this._viewType = null;
  this._onAppearFns = [];
  this._onDisappearFn = null;
  this._listeners = [];
}
View.prototype.build = function() { return this.el; };
View.prototype.dispose = function() {
  if (this._onDisappearFn) this._onDisappearFn();
  for (var i = 0; i < this._children.length; i++) {
    if (this._children[i].dispose) this._children[i].dispose();
  }
  this._children.length = 0;
  for (var j = 0; j < this._effects.length; j++) {
    if (this._effects[j].dispose) this._effects[j].dispose();
  }
  this._effects.length = 0;
};
View.prototype.className = function(c) { this.el.className = c; return this; };
View.prototype._appendChildren = function(children) {
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child == null) continue;
    if (child instanceof View) {
      this.el.appendChild(child.build());
      this._children.push(child);
    } else if (child instanceof HTMLElement) {
      this.el.appendChild(child);
    }
  }
};

var S = { isSignal, resolve, Effect };
function _spaceToken(n) { return 'var(--nr-space-' + n + ')'; }

// ── ForEach replica ──────────────────────────────────────
function ForEach(items, keyFnOrRenderFn, renderFn) {
  var v = new View('div');
  var keyFn = renderFn ? keyFnOrRenderFn : null;
  var render = renderFn || keyFnOrRenderFn;
  var _childViews = [];
  var _keyedMap = {};

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
        for (var k = 0; k < child._onAppearFns.length; k++) child._onAppearFns[k]();
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
    for (var i = 0; i < arr.length; i++) {
      var key = '' + keyFn(arr[i], i);
      newKeys.push(key);
      newMap[key] = arr[i];
    }
    for (var key2 in _keyedMap) {
      if (!newMap.hasOwnProperty(key2)) {
        var entry = _keyedMap[key2];
        if (entry.view && entry.view.dispose) entry.view.dispose();
        if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        delete _keyedMap[key2];
      }
    }
    for (var j = 0; j < newKeys.length; j++) {
      var k = newKeys[j];
      if (!_keyedMap[k]) {
        var child = render(newMap[k], j);
        if (child == null) continue;
        if (child instanceof View) {
          var builtEl = child.build();
          _keyedMap[k] = { view: child, el: builtEl };
          for (var m = 0; m < child._onAppearFns.length; m++) child._onAppearFns[m]();
        } else if (child instanceof HTMLElement) {
          _keyedMap[k] = { view: null, el: child };
        }
      }
    }
    var cursor = v.el.firstChild;
    for (var n = 0; n < newKeys.length; n++) {
      var e = _keyedMap[newKeys[n]];
      if (!e) continue;
      if (e.el !== cursor) {
        v.el.insertBefore(e.el, cursor);
      } else {
        cursor = cursor.nextSibling;
      }
    }
    _childViews.length = 0;
    for (var p = 0; p < newKeys.length; p++) {
      var en = _keyedMap[newKeys[p]];
      if (en && en.view) _childViews.push(en.view);
    }
  }

  var _doUpdate = keyFn ? _reconcile : _rebuildFull;
  if (S.isSignal(items)) {
    _doUpdate();
    v._effects.push(S.Effect(function() { items.value; _doUpdate(); }));
  } else {
    _doUpdate();
  }

  v._viewType = 'ForEach';
  v.spacing = function(s) {
    v.el.style.display = 'flex';
    v.el.style.flexDirection = 'column';
    v.el.style.gap = _spaceToken(s);
    return v;
  };
  return v;
}

// ── List replica ─────────────────────────────────────────
function List(items, keyFnOrRenderFn, renderFn) {
  var forEach = ForEach(items, keyFnOrRenderFn, renderFn);
  forEach._viewType = 'List';
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

// ── Group replica ────────────────────────────────────────
function Group() {
  var children = Array.prototype.slice.call(arguments);
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  var v = new View('div');
  v._viewType = 'Group';
  v.el.style.display = 'contents';
  v._appendChildren(children);
  return v;
}

// ── Section replica ──────────────────────────────────────
function Section(header) {
  var children = Array.prototype.slice.call(arguments, 1);
  if (children.length === 1 && Array.isArray(children[0])) children = children[0];
  var v = new View('div');
  v._viewType = 'Section';
  v.el.className = 'aether-ui-section';
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
  var content = document.createElement('div');
  content.className = 'aether-ui-section-content';
  v.el.appendChild(content);
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child == null) continue;
    if (child instanceof View) {
      content.appendChild(child.build());
      v._children.push(child);
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

// ── Show replica ─────────────────────────────────────────
function Show(condition, thenFn, elseFn) {
  var v = new View('div');
  v._viewType = 'Show';
  v.el.style.display = 'contents';
  var _current = null;
  function _removeOld(old) {
    if (old.dispose) old.dispose();
    if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
    var idx = v._children.indexOf(old);
    if (idx > -1) v._children.splice(idx, 1);
  }
  function _mountChild(child) {
    if (child instanceof View) {
      v.el.appendChild(child.build());
      v._children.push(child);
      for (var k = 0; k < child._onAppearFns.length; k++) child._onAppearFns[k]();
      _current = child;
    }
  }
  function _update() {
    var val = S.isSignal(condition) ? condition.value : condition;
    if (_current) { _removeOld(_current); _current = null; }
    var factory = val ? thenFn : elseFn;
    if (factory) {
      var child = factory();
      if (child) _mountChild(child);
    }
  }
  _update();
  if (S.isSignal(condition)) {
    v._effects.push(S.Effect(function() { condition.value; _update(); }));
  }
  return v;
}

// ── Switch replica ───────────────────────────────────────
function Switch(signal, cases) {
  var v = new View('div');
  v._viewType = 'Switch';
  v.el.style.display = 'contents';
  var _current = null;
  var _currentKey = undefined;
  function _removeOld(old) {
    if (old.dispose) old.dispose();
    if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
    var idx = v._children.indexOf(old);
    if (idx > -1) v._children.splice(idx, 1);
  }
  function _mountChild(child) {
    if (child instanceof View) {
      v.el.appendChild(child.build());
      v._children.push(child);
      _current = child;
    }
  }
  function _update() {
    var val = S.isSignal(signal) ? signal.value : signal;
    if (val === _currentKey && _current) return;
    _currentKey = val;
    if (_current) { _removeOld(_current); _current = null; }
    var factory = cases[val] || cases.default;
    if (factory) { var child = factory(); if (child) _mountChild(child); }
  }
  _update();
  if (S.isSignal(signal)) {
    v._effects.push(S.Effect(function() { signal.value; _update(); }));
  }
  return v;
}

// ── EmptyState replica ───────────────────────────────────
function EmptyState(opts) {
  opts = opts || {};
  var v = new View('div');
  v._viewType = 'EmptyState';
  if (opts.title) {
    var titleEl = document.createElement('div');
    titleEl.textContent = opts.title;
    v.el.appendChild(titleEl);
  }
  if (opts.message) {
    var msgEl = document.createElement('div');
    msgEl.textContent = opts.message;
    v.el.appendChild(msgEl);
  }
  if (opts.action) {
    var btn = document.createElement('button');
    btn.className = 'nr-btn nr-btn-secondary nr-btn-sm';
    btn.textContent = opts.action.label || 'Action';
    if (opts.action.handler) btn.addEventListener('click', opts.action.handler);
    v.el.appendChild(btn);
  }
  return v;
}

// ── Helpers ──────────────────────────────────────────────
function renderItem(item) {
  var v = new View('div');
  v.el.textContent = typeof item === 'string' ? item : item.label;
  return v;
}

function renderRaw(item) {
  var el = document.createElement('span');
  el.textContent = typeof item === 'string' ? item : item.label;
  return el;
}

// ═════════════════════════════════════════════════════════
// ForEach tests
// ═════════════════════════════════════════════════════════

describe('ForEach', () => {
  it('renders static array', () => {
    var fe = ForEach(['A', 'B', 'C'], renderItem);
    expect(fe.el.children.length).toBe(3);
    expect(fe.el.children[0].textContent).toBe('A');
    expect(fe.el.children[2].textContent).toBe('C');
  });

  it('sets _viewType to ForEach', () => {
    expect(ForEach([], renderItem)._viewType).toBe('ForEach');
  });

  it('handles empty array', () => {
    var fe = ForEach([], renderItem);
    expect(fe.el.children.length).toBe(0);
  });

  it('handles non-array gracefully', () => {
    var fe = ForEach(null, renderItem);
    expect(fe.el.children.length).toBe(0);
  });

  it('skips null renderFn returns', () => {
    var fe = ForEach(['A', 'B'], function() { return null; });
    expect(fe.el.children.length).toBe(0);
  });

  it('renders HTMLElement children', () => {
    var fe = ForEach(['A', 'B'], renderRaw);
    expect(fe.el.children.length).toBe(2);
    expect(fe.el.children[0].tagName).toBe('SPAN');
  });

  it('passes index to renderFn', () => {
    var indices = [];
    ForEach(['A', 'B', 'C'], function(item, i) { indices.push(i); return renderItem(item); });
    expect(indices).toEqual([0, 1, 2]);
  });

  it('calls onAppear for View children', () => {
    var appeared = [];
    ForEach(['X', 'Y'], function(item) {
      var v = new View('div');
      v._onAppearFns.push(function() { appeared.push(item); });
      return v;
    });
    expect(appeared).toEqual(['X', 'Y']);
  });

  // Reactive
  it('re-renders when signal changes (no keyFn)', () => {
    var sig = State(['A', 'B']);
    var fe = ForEach(sig, renderItem);
    expect(fe.el.children.length).toBe(2);
    sig.value = ['A', 'B', 'C', 'D'];
    expect(fe.el.children.length).toBe(4);
  });

  it('removes children when signal shrinks', () => {
    var sig = State(['A', 'B', 'C']);
    var fe = ForEach(sig, renderItem);
    sig.value = ['A'];
    expect(fe.el.children.length).toBe(1);
  });

  it('handles signal to empty', () => {
    var sig = State(['A', 'B']);
    var fe = ForEach(sig, renderItem);
    sig.value = [];
    expect(fe.el.children.length).toBe(0);
  });

  it('disposes old children on rebuild', () => {
    var disposed = [];
    var sig = State(['A', 'B']);
    ForEach(sig, function(item) {
      var v = new View('div');
      v.el.textContent = item;
      var orig = v.dispose.bind(v);
      v.dispose = function() { disposed.push(item); orig(); };
      return v;
    });
    sig.value = ['C'];
    expect(disposed).toContain('A');
    expect(disposed).toContain('B');
  });

  // With keyFn (reconciliation)
  it('uses keyFn for reconciliation', () => {
    var items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    var sig = State(items);
    var fe = ForEach(sig, function(i) { return i.id; }, renderItem);
    expect(fe.el.children.length).toBe(2);
  });

  it('adds new keyed items', () => {
    var sig = State([{ id: 'a', label: 'A' }]);
    var fe = ForEach(sig, function(i) { return i.id; }, renderItem);
    sig.value = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    expect(fe.el.children.length).toBe(2);
  });

  it('removes keyed items', () => {
    var sig = State([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    var fe = ForEach(sig, function(i) { return i.id; }, renderItem);
    sig.value = [{ id: 'b', label: 'B' }];
    expect(fe.el.children.length).toBe(1);
    expect(fe.el.children[0].textContent).toBe('B');
  });

  it('reorders keyed items', () => {
    var sig = State([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
    var fe = ForEach(sig, function(i) { return i.id; }, renderItem);
    sig.value = [{ id: 'c', label: 'C' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    expect(fe.el.children[0].textContent).toBe('C');
    expect(fe.el.children[1].textContent).toBe('A');
    expect(fe.el.children[2].textContent).toBe('B');
  });

  it('reuses existing DOM for same key', () => {
    var renderCount = 0;
    var sig = State([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    ForEach(sig, function(i) { return i.id; }, function(item) {
      renderCount++;
      return renderItem(item);
    });
    var afterInit = renderCount;
    sig.value = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    // Only 1 new render for 'c'
    expect(renderCount - afterInit).toBe(1);
  });

  // spacing
  it('spacing modifier sets flex layout', () => {
    var fe = ForEach([], renderItem);
    var result = fe.spacing(4);
    expect(result).toBe(fe);
    expect(fe.el.style.display).toBe('flex');
    expect(fe.el.style.flexDirection).toBe('column');
    expect(fe.el.style.gap).toBe('var(--nr-space-4)');
  });

  it('registers Effect for signal items', () => {
    var sig = State(['A']);
    var fe = ForEach(sig, renderItem);
    expect(fe._effects.length).toBeGreaterThanOrEqual(1);
  });

  it('no Effect for plain array', () => {
    var fe = ForEach(['A'], renderItem);
    expect(fe._effects.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// List tests
// ═════════════════════════════════════════════════════════

describe('List', () => {
  it('sets _viewType to List', () => {
    expect(List([], renderItem)._viewType).toBe('List');
  });

  it('has flex column layout', () => {
    var l = List([], renderItem);
    expect(l.el.style.display).toBe('flex');
    expect(l.el.style.flexDirection).toBe('column');
  });

  it('has aether-ui-list class', () => {
    expect(List([], renderItem).el.className).toBe('aether-ui-list');
  });

  it('renders items like ForEach', () => {
    var l = List(['X', 'Y'], renderItem);
    expect(l.el.children.length).toBe(2);
  });

  it('dividers() adds class and returns self', () => {
    var l = List([], renderItem);
    expect(l.dividers()).toBe(l);
    expect(l.el.classList.contains('aether-ui-list-dividers')).toBe(true);
  });

  it('inset() adds padding and returns self', () => {
    var l = List([], renderItem);
    expect(l.inset()).toBe(l);
    expect(l.el.style.padding).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════
// Group tests
// ═════════════════════════════════════════════════════════

describe('Group', () => {
  it('sets _viewType to Group', () => {
    expect(Group()._viewType).toBe('Group');
  });

  it('has display contents', () => {
    expect(Group().el.style.display).toBe('contents');
  });

  it('appends View children', () => {
    var a = new View('div');
    a.el.textContent = 'A';
    var b = new View('div');
    b.el.textContent = 'B';
    var g = Group(a, b);
    expect(g.el.children.length).toBe(2);
  });

  it('handles array of children', () => {
    var a = new View('div');
    var b = new View('div');
    var g = Group([a, b]);
    expect(g.el.children.length).toBe(2);
  });

  it('skips null children', () => {
    var a = new View('div');
    var g = Group(a, null, new View('span'));
    expect(g.el.children.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════
// Section tests
// ═════════════════════════════════════════════════════════

describe('Section', () => {
  it('sets _viewType to Section', () => {
    expect(Section('Title')._viewType).toBe('Section');
  });

  it('has section class', () => {
    expect(Section('Title').el.className).toBe('aether-ui-section');
  });

  it('renders string header', () => {
    var s = Section('My Section');
    var header = s.el.querySelector('.aether-ui-section-header');
    expect(header).toBeTruthy();
    expect(header.textContent).toBe('My Section');
  });

  it('renders View header', () => {
    var hView = new View('span');
    hView.el.textContent = 'Custom';
    var s = Section(hView);
    var header = s.el.querySelector('.aether-ui-section-header');
    expect(header.querySelector('span').textContent).toBe('Custom');
  });

  it('has content wrapper', () => {
    var s = Section('Title');
    expect(s.el.querySelector('.aether-ui-section-content')).toBeTruthy();
  });

  it('appends children to content wrapper', () => {
    var child = new View('div');
    child.el.textContent = 'Child';
    var s = Section('Title', child);
    var content = s.el.querySelector('.aether-ui-section-content');
    expect(content.children.length).toBe(1);
    expect(content.children[0].textContent).toBe('Child');
  });

  it('handles array of children', () => {
    var a = new View('div');
    var b = new View('div');
    var s = Section('Title', [a, b]);
    var content = s.el.querySelector('.aether-ui-section-content');
    expect(content.children.length).toBe(2);
  });

  it('spacing returns self', () => {
    var s = Section('Title');
    expect(s.spacing(4)).toBe(s);
  });

  it('handles null header', () => {
    var s = Section(null, new View('div'));
    expect(s.el.querySelector('.aether-ui-section-header')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════
// Show tests
// ═════════════════════════════════════════════════════════

describe('Show', () => {
  it('sets _viewType to Show', () => {
    expect(Show(true, function() { return new View('div'); })._viewType).toBe('Show');
  });

  it('renders thenFn when condition is true', () => {
    var s = Show(true, function() { var v = new View('div'); v.el.textContent = 'YES'; return v; });
    expect(s.el.textContent).toBe('YES');
  });

  it('renders elseFn when condition is false', () => {
    var s = Show(false,
      function() { var v = new View('div'); v.el.textContent = 'YES'; return v; },
      function() { var v = new View('div'); v.el.textContent = 'NO'; return v; }
    );
    expect(s.el.textContent).toBe('NO');
  });

  it('renders nothing when false and no elseFn', () => {
    var s = Show(false, function() { return new View('div'); });
    expect(s.el.children.length).toBe(0);
  });

  it('reactively switches on signal change', () => {
    var sig = State(true);
    var s = Show(sig,
      function() { var v = new View('div'); v.el.textContent = 'ON'; return v; },
      function() { var v = new View('div'); v.el.textContent = 'OFF'; return v; }
    );
    expect(s.el.textContent).toBe('ON');
    sig.value = false;
    expect(s.el.textContent).toBe('OFF');
    sig.value = true;
    expect(s.el.textContent).toBe('ON');
  });

  it('disposes old child on switch', () => {
    var disposed = [];
    var sig = State(true);
    Show(sig, function() {
      var v = new View('div');
      var orig = v.dispose.bind(v);
      v.dispose = function() { disposed.push('then'); orig(); };
      return v;
    });
    sig.value = false;
    expect(disposed).toContain('then');
  });

  it('has display contents', () => {
    expect(Show(true, function() { return new View('div'); }).el.style.display).toBe('contents');
  });
});

// ═════════════════════════════════════════════════════════
// Switch tests
// ═════════════════════════════════════════════════════════

describe('Switch', () => {
  var cases = {
    a: function() { var v = new View('div'); v.el.textContent = 'A'; return v; },
    b: function() { var v = new View('div'); v.el.textContent = 'B'; return v; },
    default: function() { var v = new View('div'); v.el.textContent = 'DEFAULT'; return v; },
  };

  it('sets _viewType to Switch', () => {
    expect(Switch('a', cases)._viewType).toBe('Switch');
  });

  it('renders matching case', () => {
    expect(Switch('a', cases).el.textContent).toBe('A');
    expect(Switch('b', cases).el.textContent).toBe('B');
  });

  it('uses default case when no match', () => {
    expect(Switch('unknown', cases).el.textContent).toBe('DEFAULT');
  });

  it('reactively switches on signal change', () => {
    var sig = State('a');
    var sw = Switch(sig, cases);
    expect(sw.el.textContent).toBe('A');
    sig.value = 'b';
    expect(sw.el.textContent).toBe('B');
    sig.value = 'z';
    expect(sw.el.textContent).toBe('DEFAULT');
  });

  it('skips update for same key', () => {
    var count = 0;
    var sig = State('a');
    Switch(sig, {
      a: function() { count++; var v = new View('div'); return v; },
    });
    var after = count;
    sig.value = 'a';
    expect(count).toBe(after); // no re-render
  });

  it('disposes old child on switch', () => {
    var disposed = [];
    var sig = State('a');
    Switch(sig, {
      a: function() {
        var v = new View('div');
        var orig = v.dispose.bind(v);
        v.dispose = function() { disposed.push('a'); orig(); };
        return v;
      },
      b: function() { return new View('div'); },
    });
    sig.value = 'b';
    expect(disposed).toContain('a');
  });

  it('renders nothing when no match and no default', () => {
    var sw = Switch('z', { a: function() { return new View('div'); } });
    expect(sw.el.children.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════
// EmptyState tests
// ═════════════════════════════════════════════════════════

describe('EmptyState', () => {
  it('sets _viewType', () => {
    expect(EmptyState()._viewType).toBe('EmptyState');
  });

  it('renders title', () => {
    var es = EmptyState({ title: 'Nothing here' });
    expect(es.el.textContent).toContain('Nothing here');
  });

  it('renders message', () => {
    var es = EmptyState({ message: 'Try adding something' });
    expect(es.el.textContent).toContain('Try adding something');
  });

  it('renders action button', () => {
    var clicked = false;
    var es = EmptyState({ action: { label: 'Add', handler: function() { clicked = true; } } });
    var btn = es.el.querySelector('button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Add');
    btn.click();
    expect(clicked).toBe(true);
  });

  it('handles no options', () => {
    var es = EmptyState();
    expect(es.el.children.length).toBe(0);
  });
});
