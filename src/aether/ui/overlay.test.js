import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Replicate core State/Effect/isSignal from state.js ──────────
// overlay.js imports these from absolute browser paths which can't
// resolve in Vitest, so we inline the minimal reactive primitives
// needed to test overlay logic.

var _currentEffect = null;
var _batchDepth = 0;
var _pendingEffects = [];

function State(initial) {
  var _val = initial;
  var _subs = new Set();
  return {
    _signal: true,
    get value() {
      if (_currentEffect) _subs.add(_currentEffect);
      return _val;
    },
    set value(v) {
      if (v === _val) return;
      _val = v;
      var toRun = [..._subs];
      toRun.forEach(function(e) { e._run(); });
    },
    peek: function() { return _val; }
  };
}

function Effect(fn) {
  var _disposed = false;
  var eff = {
    _run: function() {
      if (_disposed) return;
      var prev = _currentEffect;
      _currentEffect = eff;
      fn();
      _currentEffect = prev;
    },
    dispose: function() { _disposed = true; }
  };
  eff._run();
  return eff;
}

function isSignal(v) {
  return v != null && v._signal === true;
}

function resolve(v) {
  if (isSignal(v)) return v.value;
  return v;
}

// ── Minimal View class matching overlay.js expectations ─────────

function View(tag) {
  this.el = document.createElement(tag || 'div');
  this._children = [];
  this._onAppearFns = [];
}
View.prototype.build = function() { return this.el; };

// ── Replicate overlay.js helper functions ───────────────────────

function _positionBelow(el, anchor, opts) {
  opts = opts || {};
  var rect = anchor.getBoundingClientRect();
  var gap = opts.gap || 4;
  el.style.position = 'fixed';
  el.style.top = (rect.bottom + gap) + 'px';
  el.style.left = rect.left + 'px';
  requestAnimationFrame(function() {
    var elRect = el.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (elRect.bottom > vh) {
      var above = rect.top - gap - elRect.height;
      if (above >= 0) el.style.top = above + 'px';
    }
    if (elRect.right > vw) {
      el.style.left = Math.max(4, vw - elRect.width - 4) + 'px';
    }
    if (elRect.left < 0) {
      el.style.left = '4px';
    }
  });
}

function _escHandler(dismissFn) {
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); dismissFn(); }
  }
  document.addEventListener('keydown', onKey);
  return function() { document.removeEventListener('keydown', onKey); };
}

// ── Replicate Sheet ─────────────────────────────────────────────

function Sheet(isPresented, contentFn) {
  var backdrop = null;
  var sheetEl = null;
  var _effect = null;
  var _escCleanup = null;

  function _show() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'nr-sheet-backdrop';
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) _dismiss();
    });
    sheetEl = document.createElement('div');
    sheetEl.className = 'nr-sheet';
    var handle = document.createElement('div');
    handle.className = 'nr-sheet-handle';
    sheetEl.appendChild(handle);
    var body = document.createElement('div');
    body.className = 'nr-modal-body';
    var content = contentFn();
    if (content instanceof View) {
      body.appendChild(content.build());
      for (var k = 0; k < content._onAppearFns.length; k++) content._onAppearFns[k]();
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }
    sheetEl.appendChild(body);
    backdrop.appendChild(sheetEl);
    document.body.appendChild(backdrop);
    _escCleanup = _escHandler(_dismiss);
  }

  function _dismiss() {
    if (!backdrop) return;
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    backdrop.remove();
    backdrop = null;
    sheetEl = null;
    if (isSignal(isPresented)) isPresented.value = false;
  }

  if (isSignal(isPresented)) {
    _effect = Effect(function() {
      if (isPresented.value) _show();
      else _dismiss();
    });
  }

  return {
    show: _show,
    dismiss: _dismiss,
    dispose: function() {
      _dismiss();
      if (_effect) { _effect.dispose(); _effect = null; }
    }
  };
}

// ── Replicate Alert ─────────────────────────────────────────────

function Alert(isPresented, opts) {
  opts = opts || {};
  var backdrop = null;
  var _effect = null;
  var _escCleanup = null;

  function _show() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.className = 'nr-modal-backdrop';
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) _dismiss();
    });
    var modal = document.createElement('div');
    modal.className = 'nr-modal';
    modal.style.maxWidth = '360px';
    if (opts.title) {
      var header = document.createElement('div');
      header.className = 'nr-modal-header';
      var title = document.createElement('span');
      title.className = 'nr-modal-title';
      title.textContent = opts.title;
      header.appendChild(title);
      modal.appendChild(header);
    }
    if (opts.message) {
      var body = document.createElement('div');
      body.className = 'nr-modal-body';
      body.textContent = opts.message;
      body.style.fontSize = '0.875rem';
      modal.appendChild(body);
    }
    var footer = document.createElement('div');
    footer.className = 'nr-modal-footer';
    var actions = opts.actions || [{ label: 'OK' }];
    for (var i = 0; i < actions.length; i++) {
      (function(action) {
        var btn = document.createElement('button');
        btn.className = 'nr-btn ' + (action.style === 'destructive' ? 'nr-btn-danger' :
          action.style === 'cancel' ? 'nr-btn-ghost' : 'nr-btn-primary');
        btn.textContent = action.label;
        btn.addEventListener('click', function() {
          if (action.handler) action.handler();
          _dismiss();
        });
        footer.appendChild(btn);
      })(actions[i]);
    }
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    _escCleanup = _escHandler(_dismiss);
  }

  function _dismiss() {
    if (!backdrop) return;
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    backdrop.remove();
    backdrop = null;
    if (isSignal(isPresented)) isPresented.value = false;
  }

  if (isSignal(isPresented)) {
    _effect = Effect(function() {
      if (isPresented.value) _show();
      else _dismiss();
    });
  }

  return {
    show: _show,
    dismiss: _dismiss,
    dispose: function() {
      _dismiss();
      if (_effect) { _effect.dispose(); _effect = null; }
    }
  };
}

// ── Replicate Popover ───────────────────────────────────────────

function Popover(anchorView, isPresented, contentFn) {
  var popEl = null;
  var _cleanup = null;
  var _effect = null;
  var _escCleanup = null;
  var _timeoutId = null;

  function _show() {
    if (popEl) return;
    popEl = document.createElement('div');
    popEl.className = 'aether-ui-popover';
    var content = contentFn();
    if (content instanceof View) {
      popEl.appendChild(content.build());
      for (var k = 0; k < content._onAppearFns.length; k++) content._onAppearFns[k]();
    } else if (content instanceof HTMLElement) {
      popEl.appendChild(content);
    }
    var anchor = anchorView instanceof View ? anchorView.el : anchorView;
    document.body.appendChild(popEl);
    _positionBelow(popEl, anchor);

    function onDocClick(e) {
      if (!popEl.contains(e.target) && !anchor.contains(e.target)) {
        _dismiss();
      }
    }
    _timeoutId = setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
    _cleanup = function() { document.removeEventListener('click', onDocClick); };
    _escCleanup = _escHandler(_dismiss);
  }

  function _dismiss() {
    if (!popEl) return;
    if (_timeoutId) { clearTimeout(_timeoutId); _timeoutId = null; }
    if (_cleanup) { _cleanup(); _cleanup = null; }
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    popEl.remove();
    popEl = null;
    if (isSignal(isPresented)) isPresented.value = false;
  }

  if (isSignal(isPresented)) {
    _effect = Effect(function() {
      if (isPresented.value) _show();
      else _dismiss();
    });
  }

  return {
    show: _show,
    dismiss: _dismiss,
    dispose: function() {
      _dismiss();
      if (_effect) { _effect.dispose(); _effect = null; }
    }
  };
}

// ── Replicate Menu ──────────────────────────────────────────────

function Menu(anchorView, menuItems) {
  var isOpen = State(false);
  var menuEl = null;
  var _cleanup = null;
  var _escCleanup = null;

  function _show(posX, posY) {
    if (menuEl) return;
    menuEl = document.createElement('div');
    menuEl.className = 'nr-menu aether-ui-menu';
    menuEl.style.minWidth = '160px';

    var items = typeof menuItems === 'function' ? menuItems() : menuItems;
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        if (item.divider) {
          var hr = document.createElement('hr');
          hr.style.border = 'none';
          hr.style.borderTop = '1px solid var(--nr-border-default)';
          menuEl.appendChild(hr);
          return;
        }
        if (item.view) {
          var customView = typeof item.view === 'function' ? item.view() : item.view;
          if (customView instanceof View) {
            menuEl.appendChild(customView.build());
            for (var k = 0; k < customView._onAppearFns.length; k++) customView._onAppearFns[k]();
          } else if (customView instanceof HTMLElement) {
            menuEl.appendChild(customView);
          }
          return;
        }
        var row = document.createElement('div');
        row.className = 'nr-menu-item';
        row.style.color = item.destructive ? '#dc2626' : 'var(--nr-text-primary)';
        if (item.icon) {
          var iconSpan = document.createElement('span');
          iconSpan.className = 'nr-menu-item-icon';
          iconSpan.innerHTML = item.icon;
          row.appendChild(iconSpan);
        }
        var labelSpan = document.createElement('span');
        labelSpan.style.flex = '1';
        labelSpan.textContent = item.label;
        row.appendChild(labelSpan);
        if (item.trailing) {
          var trailingContent = typeof item.trailing === 'function' ? item.trailing() : item.trailing;
          var trailingEl = document.createElement('span');
          trailingEl.className = 'nr-menu-item-trailing';
          if (trailingContent instanceof View) {
            trailingEl.appendChild(trailingContent.build());
          } else if (trailingContent instanceof HTMLElement) {
            trailingEl.appendChild(trailingContent);
          } else if (typeof trailingContent === 'string') {
            trailingEl.textContent = trailingContent;
          }
          row.appendChild(trailingEl);
        }
        row.addEventListener('click', function() {
          _dismiss();
          if (item.handler) item.handler();
        });
        menuEl.appendChild(row);
      })(items[i]);
    }

    document.body.appendChild(menuEl);

    if (posX != null && posY != null) {
      menuEl.style.position = 'fixed';
      menuEl.style.left = posX + 'px';
      menuEl.style.top = posY + 'px';
    } else if (anchorView) {
      var anchorEl = anchorView instanceof View ? anchorView.el : anchorView;
      _positionBelow(menuEl, anchorEl);
    }

    function onDocClick(e) {
      var anchorEl = anchorView ? (anchorView instanceof View ? anchorView.el : anchorView) : null;
      if (!menuEl.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) {
        _dismiss();
      }
    }
    setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
    _cleanup = function() { document.removeEventListener('click', onDocClick); };
    _escCleanup = _escHandler(_dismiss);
    isOpen.value = true;
  }

  function _dismiss() {
    if (!menuEl) return;
    if (_cleanup) { _cleanup(); _cleanup = null; }
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    menuEl.remove();
    menuEl = null;
    isOpen.value = false;
  }

  if (anchorView) {
    var anchor = anchorView instanceof View ? anchorView.el : anchorView;
    anchor.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menuEl) _dismiss();
      else _show();
    });
  }

  return {
    show: function() { _show(); },
    showAt: function(x, y) { _show(x, y); },
    dismiss: _dismiss,
    isOpen: isOpen,
    dispose: function() { _dismiss(); }
  };
}

// ── Helper: dispatch keyboard event ─────────────────────────────

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// ═══════════════════════════════════════════════════════════════
// Sheet
// ═══════════════════════════════════════════════════════════════

describe('Sheet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows when signal becomes true', () => {
    var shown = State(false);
    Sheet(shown, () => document.createElement('p'));
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
    shown.value = true;
    expect(document.querySelector('.nr-sheet-backdrop')).not.toBeNull();
  });

  it('hides when signal becomes false', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    expect(document.querySelector('.nr-sheet-backdrop')).not.toBeNull();
    shown.value = false;
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
  });

  it('creates backdrop with correct class', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    var bd = document.querySelector('.nr-sheet-backdrop');
    expect(bd).not.toBeNull();
    expect(bd.className).toBe('nr-sheet-backdrop');
  });

  it('creates sheet element with handle', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    var sheet = document.querySelector('.nr-sheet');
    expect(sheet).not.toBeNull();
    var handle = sheet.querySelector('.nr-sheet-handle');
    expect(handle).not.toBeNull();
  });

  it('renders HTMLElement content inside modal body', () => {
    var shown = State(true);
    Sheet(shown, () => {
      var p = document.createElement('p');
      p.textContent = 'Hello Sheet';
      return p;
    });
    var body = document.querySelector('.nr-modal-body');
    expect(body).not.toBeNull();
    expect(body.querySelector('p').textContent).toBe('Hello Sheet');
  });

  it('renders View content and calls onAppear callbacks', () => {
    var appeared = false;
    var shown = State(true);
    Sheet(shown, () => {
      var v = new View('section');
      v.el.textContent = 'View content';
      v._onAppearFns.push(() => { appeared = true; });
      return v;
    });
    var body = document.querySelector('.nr-modal-body');
    expect(body.querySelector('section').textContent).toBe('View content');
    expect(appeared).toBe(true);
  });

  it('dismisses on backdrop click', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    var bd = document.querySelector('.nr-sheet-backdrop');
    // Simulate click where target is the backdrop itself
    var evt = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: bd });
    bd.dispatchEvent(evt);
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('does not dismiss when clicking inside sheet content', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    var sheet = document.querySelector('.nr-sheet');
    // Click on the sheet element — target is sheet, not backdrop, so handler skips
    var evt = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: sheet });
    document.querySelector('.nr-sheet-backdrop').dispatchEvent(evt);
    expect(document.querySelector('.nr-sheet-backdrop')).not.toBeNull();
  });

  it('dismisses on Escape key', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    expect(document.querySelector('.nr-sheet-backdrop')).not.toBeNull();
    pressEscape();
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('show() is idempotent when already shown', () => {
    var shown = State(false);
    var sheet = Sheet(shown, () => document.createElement('p'));
    sheet.show();
    sheet.show(); // second call is no-op
    expect(document.querySelectorAll('.nr-sheet-backdrop').length).toBe(1);
  });

  it('dismiss() is safe when already hidden', () => {
    var shown = State(false);
    var sheet = Sheet(shown, () => document.createElement('p'));
    sheet.dismiss();
    sheet.dismiss(); // should not throw
  });

  it('dispose() dismisses and stops the reactive effect', () => {
    var shown = State(true);
    var sheet = Sheet(shown, () => document.createElement('p'));
    expect(document.querySelector('.nr-sheet-backdrop')).not.toBeNull();
    sheet.dispose();
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
    // After dispose, toggling the signal should not re-show
    shown.value = true;
    expect(document.querySelector('.nr-sheet-backdrop')).toBeNull();
  });

  it('sets isPresented signal to false on dismiss', () => {
    var shown = State(true);
    Sheet(shown, () => document.createElement('p'));
    expect(shown.peek()).toBe(true);
    pressEscape();
    expect(shown.peek()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Alert
// ═══════════════════════════════════════════════════════════════

describe('Alert', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows when signal becomes true', () => {
    var shown = State(false);
    Alert(shown, { title: 'Test' });
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
    shown.value = true;
    expect(document.querySelector('.nr-modal-backdrop')).not.toBeNull();
  });

  it('renders title in modal header', () => {
    var shown = State(true);
    Alert(shown, { title: 'Warning' });
    var title = document.querySelector('.nr-modal-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('Warning');
  });

  it('renders message in modal body', () => {
    var shown = State(true);
    Alert(shown, { title: 'T', message: 'Something happened' });
    var body = document.querySelector('.nr-modal-body');
    expect(body).not.toBeNull();
    expect(body.textContent).toBe('Something happened');
  });

  it('omits header when no title provided', () => {
    var shown = State(true);
    Alert(shown, { message: 'No title' });
    expect(document.querySelector('.nr-modal-header')).toBeNull();
  });

  it('omits body when no message provided', () => {
    var shown = State(true);
    Alert(shown, { title: 'Title only' });
    expect(document.querySelector('.nr-modal-body')).toBeNull();
  });

  it('renders default OK button when no actions specified', () => {
    var shown = State(true);
    Alert(shown, { title: 'Test' });
    var buttons = document.querySelectorAll('.nr-modal-footer button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('OK');
    expect(buttons[0].className).toContain('nr-btn-primary');
  });

  it('renders cancel-style button with ghost class', () => {
    var shown = State(true);
    Alert(shown, {
      title: 'Confirm',
      actions: [{ label: 'Cancel', style: 'cancel' }]
    });
    var btn = document.querySelector('.nr-modal-footer button');
    expect(btn.textContent).toBe('Cancel');
    expect(btn.className).toContain('nr-btn-ghost');
  });

  it('renders destructive-style button with danger class', () => {
    var shown = State(true);
    Alert(shown, {
      title: 'Delete',
      actions: [{ label: 'Delete', style: 'destructive' }]
    });
    var btn = document.querySelector('.nr-modal-footer button');
    expect(btn.textContent).toBe('Delete');
    expect(btn.className).toContain('nr-btn-danger');
  });

  it('renders multiple action buttons in order', () => {
    var shown = State(true);
    Alert(shown, {
      title: 'Multi',
      actions: [
        { label: 'Cancel', style: 'cancel' },
        { label: 'Save' },
        { label: 'Delete', style: 'destructive' }
      ]
    });
    var buttons = document.querySelectorAll('.nr-modal-footer button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toBe('Cancel');
    expect(buttons[1].textContent).toBe('Save');
    expect(buttons[2].textContent).toBe('Delete');
  });

  it('calls action handler and dismisses on button click', () => {
    var shown = State(true);
    var handlerCalled = false;
    Alert(shown, {
      title: 'Test',
      actions: [{ label: 'OK', handler: () => { handlerCalled = true; } }]
    });
    var btn = document.querySelector('.nr-modal-footer button');
    btn.click();
    expect(handlerCalled).toBe(true);
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('dismisses without error when action has no handler', () => {
    var shown = State(true);
    Alert(shown, {
      title: 'Test',
      actions: [{ label: 'OK' }]
    });
    var btn = document.querySelector('.nr-modal-footer button');
    btn.click();
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
  });

  it('dismisses on backdrop click', () => {
    var shown = State(true);
    Alert(shown, { title: 'Test' });
    var bd = document.querySelector('.nr-modal-backdrop');
    var evt = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: bd });
    bd.dispatchEvent(evt);
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('dismisses on Escape key', () => {
    var shown = State(true);
    Alert(shown, { title: 'Test' });
    pressEscape();
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('dispose() cleans up and stops the reactive effect', () => {
    var shown = State(true);
    var alert = Alert(shown, { title: 'Test' });
    expect(document.querySelector('.nr-modal-backdrop')).not.toBeNull();
    alert.dispose();
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
    shown.value = true;
    expect(document.querySelector('.nr-modal-backdrop')).toBeNull();
  });

  it('modal element has max-width of 360px', () => {
    var shown = State(true);
    Alert(shown, { title: 'Test' });
    var modal = document.querySelector('.nr-modal');
    expect(modal.style.maxWidth).toBe('360px');
  });
});

// ═══════════════════════════════════════════════════════════════
// Popover
// ═══════════════════════════════════════════════════════════════

describe('Popover', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows when signal becomes true', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(false);
    Popover(anchor, shown, () => {
      var d = document.createElement('div');
      d.className = 'pop-content';
      return d;
    });
    expect(document.querySelector('.aether-ui-popover')).toBeNull();
    shown.value = true;
    expect(document.querySelector('.aether-ui-popover')).not.toBeNull();
  });

  it('hides when signal becomes false', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(true);
    Popover(anchor, shown, () => document.createElement('div'));
    expect(document.querySelector('.aether-ui-popover')).not.toBeNull();
    shown.value = false;
    expect(document.querySelector('.aether-ui-popover')).toBeNull();
  });

  it('renders HTMLElement content', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(true);
    Popover(anchor, shown, () => {
      var d = document.createElement('span');
      d.textContent = 'Popover text';
      return d;
    });
    var pop = document.querySelector('.aether-ui-popover');
    expect(pop.querySelector('span').textContent).toBe('Popover text');
  });

  it('renders View content and calls onAppear', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var appeared = false;
    var shown = State(true);
    Popover(anchor, shown, () => {
      var v = new View('div');
      v.el.textContent = 'View pop';
      v._onAppearFns.push(() => { appeared = true; });
      return v;
    });
    expect(appeared).toBe(true);
  });

  it('dismisses on Escape key', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(true);
    Popover(anchor, shown, () => document.createElement('div'));
    expect(document.querySelector('.aether-ui-popover')).not.toBeNull();
    pressEscape();
    expect(document.querySelector('.aether-ui-popover')).toBeNull();
    expect(shown.peek()).toBe(false);
  });

  it('accepts a View as anchor', () => {
    var anchorView = new View('button');
    document.body.appendChild(anchorView.el);
    var shown = State(true);
    Popover(anchorView, shown, () => document.createElement('div'));
    expect(document.querySelector('.aether-ui-popover')).not.toBeNull();
  });

  it('dispose() cleans up and stops the reactive effect', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(true);
    var pop = Popover(anchor, shown, () => document.createElement('div'));
    expect(document.querySelector('.aether-ui-popover')).not.toBeNull();
    pop.dispose();
    expect(document.querySelector('.aether-ui-popover')).toBeNull();
    shown.value = true;
    expect(document.querySelector('.aether-ui-popover')).toBeNull();
  });

  it('show() is idempotent when already visible', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(false);
    var pop = Popover(anchor, shown, () => document.createElement('div'));
    pop.show();
    pop.show();
    expect(document.querySelectorAll('.aether-ui-popover').length).toBe(1);
  });

  it('sets isPresented signal to false on dismiss', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    var shown = State(true);
    Popover(anchor, shown, () => document.createElement('div'));
    expect(shown.peek()).toBe(true);
    pressEscape();
    expect(shown.peek()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Menu
// ═══════════════════════════════════════════════════════════════

describe('Menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders menu items with correct labels', () => {
    var menu = Menu(null, [
      { label: 'Cut' },
      { label: 'Copy' },
      { label: 'Paste' }
    ]);
    menu.show();
    var items = document.querySelectorAll('.nr-menu-item');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Cut');
    expect(items[1].textContent).toBe('Copy');
    expect(items[2].textContent).toBe('Paste');
  });

  it('renders dividers as hr elements', () => {
    var menu = Menu(null, [
      { label: 'A' },
      { divider: true },
      { label: 'B' }
    ]);
    menu.show();
    var hrs = document.querySelectorAll('.aether-ui-menu hr');
    expect(hrs.length).toBe(1);
    var items = document.querySelectorAll('.nr-menu-item');
    expect(items.length).toBe(2);
  });

  it('calls handler on item click and auto-dismisses', () => {
    var clicked = false;
    var menu = Menu(null, [
      { label: 'Action', handler: () => { clicked = true; } }
    ]);
    menu.show();
    var item = document.querySelector('.nr-menu-item');
    item.click();
    expect(clicked).toBe(true);
    expect(document.querySelector('.aether-ui-menu')).toBeNull();
  });

  it('renders icon items with icon span', () => {
    var menu = Menu(null, [
      { icon: '<svg>icon</svg>', label: 'With Icon' }
    ]);
    menu.show();
    var iconSpan = document.querySelector('.nr-menu-item-icon');
    expect(iconSpan).not.toBeNull();
    expect(iconSpan.innerHTML).toBe('<svg>icon</svg>');
  });

  it('renders trailing string content', () => {
    var menu = Menu(null, [
      { label: 'Shortcut', trailing: 'Cmd+C' }
    ]);
    menu.show();
    var trailing = document.querySelector('.nr-menu-item-trailing');
    expect(trailing).not.toBeNull();
    expect(trailing.textContent).toBe('Cmd+C');
  });

  it('renders trailing HTMLElement content', () => {
    var badge = document.createElement('span');
    badge.textContent = '3';
    var menu = Menu(null, [
      { label: 'Notifications', trailing: badge }
    ]);
    menu.show();
    var trailing = document.querySelector('.nr-menu-item-trailing');
    expect(trailing.querySelector('span').textContent).toBe('3');
  });

  it('renders trailing as function returning string', () => {
    var menu = Menu(null, [
      { label: 'Item', trailing: () => 'fn-trailing' }
    ]);
    menu.show();
    var trailing = document.querySelector('.nr-menu-item-trailing');
    expect(trailing.textContent).toBe('fn-trailing');
  });

  it('renders custom view rows from HTMLElement', () => {
    var menu = Menu(null, [
      { view: () => {
        var d = document.createElement('div');
        d.className = 'custom-row';
        d.textContent = 'Custom';
        return d;
      }}
    ]);
    menu.show();
    expect(document.querySelector('.custom-row')).not.toBeNull();
    expect(document.querySelector('.custom-row').textContent).toBe('Custom');
    expect(document.querySelectorAll('.nr-menu-item').length).toBe(0);
  });

  it('renders custom View rows and calls onAppear', () => {
    var appeared = false;
    var menu = Menu(null, [
      { view: () => {
        var v = new View('div');
        v.el.className = 'custom-view-row';
        v._onAppearFns.push(() => { appeared = true; });
        return v;
      }}
    ]);
    menu.show();
    expect(document.querySelector('.custom-view-row')).not.toBeNull();
    expect(appeared).toBe(true);
  });

  it('applies red color to destructive items', () => {
    var menu = Menu(null, [
      { label: 'Delete', destructive: true }
    ]);
    menu.show();
    var item = document.querySelector('.nr-menu-item');
    expect(item.style.color).toBe('#dc2626');
  });

  it('showAt() positions menu at fixed coordinates', () => {
    var menu = Menu(null, [{ label: 'Context' }]);
    menu.showAt(100, 200);
    var el = document.querySelector('.aether-ui-menu');
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('200px');
  });

  it('anchor-toggle: click opens then click again closes', () => {
    var anchor = document.createElement('button');
    document.body.appendChild(anchor);
    Menu(anchor, [{ label: 'Item' }]);

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.aether-ui-menu')).not.toBeNull();

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.aether-ui-menu')).toBeNull();
  });

  it('dismisses on Escape key', () => {
    var menu = Menu(null, [{ label: 'Item' }]);
    menu.show();
    expect(document.querySelector('.aether-ui-menu')).not.toBeNull();
    pressEscape();
    expect(document.querySelector('.aether-ui-menu')).toBeNull();
  });

  it('isOpen signal reflects menu visibility', () => {
    var menu = Menu(null, [{ label: 'Item' }]);
    expect(menu.isOpen.peek()).toBe(false);
    menu.show();
    expect(menu.isOpen.peek()).toBe(true);
    menu.dismiss();
    expect(menu.isOpen.peek()).toBe(false);
  });

  it('show() is idempotent when already open', () => {
    var menu = Menu(null, [{ label: 'Item' }]);
    menu.show();
    menu.show();
    expect(document.querySelectorAll('.aether-ui-menu').length).toBe(1);
  });

  it('dismiss() is safe when already closed', () => {
    var menu = Menu(null, [{ label: 'Item' }]);
    menu.dismiss();
    menu.dismiss(); // should not throw
  });

  it('dispose() dismisses the menu', () => {
    var menu = Menu(null, [{ label: 'Item' }]);
    menu.show();
    expect(document.querySelector('.aether-ui-menu')).not.toBeNull();
    menu.dispose();
    expect(document.querySelector('.aether-ui-menu')).toBeNull();
  });

  it('supports menuItems as a function (lazy evaluation)', () => {
    var callCount = 0;
    var menu = Menu(null, () => {
      callCount++;
      return [{ label: 'Dynamic' }];
    });
    expect(callCount).toBe(0);
    menu.show();
    expect(callCount).toBe(1);
    var items = document.querySelectorAll('.nr-menu-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('Dynamic');
  });

  it('accepts View as anchor for toggle behavior', () => {
    var anchorView = new View('button');
    anchorView.el.textContent = 'Anchor';
    document.body.appendChild(anchorView.el);
    Menu(anchorView, [{ label: 'Via View' }]);
    anchorView.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.aether-ui-menu')).not.toBeNull();
  });

  it('menu element has both nr-menu and aether-ui-menu classes', () => {
    var menu = Menu(null, [{ label: 'X' }]);
    menu.show();
    var el = document.querySelector('.nr-menu.aether-ui-menu');
    expect(el).not.toBeNull();
  });

  it('menu has minWidth of 160px', () => {
    var menu = Menu(null, [{ label: 'X' }]);
    menu.show();
    var el = document.querySelector('.aether-ui-menu');
    expect(el.style.minWidth).toBe('160px');
  });
});

// ═══════════════════════════════════════════════════════════════
// _escHandler (shared utility)
// ═══════════════════════════════════════════════════════════════

describe('_escHandler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('calls dismiss function on Escape key', () => {
    var dismissed = false;
    var cleanup = _escHandler(() => { dismissed = true; });
    pressEscape();
    expect(dismissed).toBe(true);
    cleanup();
  });

  it('does not fire after cleanup is called', () => {
    var count = 0;
    var cleanup = _escHandler(() => { count++; });
    cleanup();
    pressEscape();
    expect(count).toBe(0);
  });

  it('ignores non-Escape keys', () => {
    var dismissed = false;
    var cleanup = _escHandler(() => { dismissed = true; });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(dismissed).toBe(false);
    cleanup();
  });
});
