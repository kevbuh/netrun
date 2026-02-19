/* AetherUI Overlay — Sheet, Alert, Popover, Menu
   Mounts to document.body. Uses existing .nr-modal-* and .nr-sheet-* CSS. */

'use strict';

import { View } from '/aether/ui/view.js';
import { isSignal, resolve, Effect, State } from '/aether/ui/state.js';

var S = { isSignal, resolve, Effect, State };

function _spaceToken(v) {
  if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
  return v;
}

// ─── Shared: position below anchor with collision detection ──

function _positionBelow(el, anchor, opts) {
  opts = opts || {};
  var rect = anchor.getBoundingClientRect();
  var gap = opts.gap || 4;
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  // Position initially below anchor
  el.style.position = 'fixed';
  el.style.top = (rect.bottom + gap) + 'px';
  el.style.left = rect.left + 'px';

  // After a frame, check for viewport overflow and flip/clamp
  requestAnimationFrame(function() {
    var elRect = el.getBoundingClientRect();

    // Bottom overflow — flip above anchor
    if (elRect.bottom > vh) {
      var above = rect.top - gap - elRect.height;
      if (above >= 0) el.style.top = above + 'px';
    }

    // Right overflow — shift left
    if (elRect.right > vw) {
      el.style.left = Math.max(4, vw - elRect.width - 4) + 'px';
    }

    // Left overflow — clamp
    if (elRect.left < 0) {
      el.style.left = '4px';
    }
  });
}

// ─── Shared: Escape key handler ──────────────────────────────

function _escHandler(dismissFn) {
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); dismissFn(); }
  }
  document.addEventListener('keydown', onKey);
  return function() { document.removeEventListener('keydown', onKey); };
}

// ─── Sheet (bottom drawer) ────────────────────────────────

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

    // Handle
    var handle = document.createElement('div');
    handle.className = 'nr-sheet-handle';
    sheetEl.appendChild(handle);

    // Content
    var body = document.createElement('div');
    body.className = 'nr-modal-body';
    var content = contentFn();
    if (content instanceof View) {
      body.appendChild(content.build());
      if (content._onAppearFn) content._onAppearFn();
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }
    sheetEl.appendChild(body);
    backdrop.appendChild(sheetEl);
    document.body.appendChild(backdrop);

    _escCleanup = _escHandler(_dismiss);

    // Animate in
    if (window.Motion) {
      window.Motion.animate(sheetEl, {
        spring: 'smooth',
        from: { y: 300, opacity: 0 },
        to: { y: 0, opacity: 1 }
      });
    }
  }

  function _dismiss() {
    if (!backdrop) return;
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    var bd = backdrop;
    if (window.Motion) {
      window.Motion.animate(sheetEl, {
        spring: 'smooth',
        from: { y: 0, opacity: 1 },
        to: { y: 300, opacity: 0 },
        onFinish: function() { bd.remove(); }
      });
    } else {
      bd.remove();
    }
    backdrop = null;
    sheetEl = null;
    if (S.isSignal(isPresented)) isPresented.value = false;
  }

  if (S.isSignal(isPresented)) {
    _effect = S.Effect(function() {
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

// ─── Alert ────────────────────────────────────────────────

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

    // Header
    if (opts.title) {
      var header = document.createElement('div');
      header.className = 'nr-modal-header';
      var title = document.createElement('span');
      title.className = 'nr-modal-title';
      title.textContent = opts.title;
      header.appendChild(title);
      modal.appendChild(header);
    }

    // Body
    if (opts.message) {
      var body = document.createElement('div');
      body.className = 'nr-modal-body';
      body.textContent = opts.message;
      body.style.fontSize = '0.875rem';
      body.style.color = 'var(--nr-text-secondary)';
      modal.appendChild(body);
    }

    // Footer with buttons
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

    if (window.Motion) {
      window.Motion.animate(modal, {
        spring: 'snappy',
        from: { scale: 0.9, opacity: 0 },
        to: { scale: 1, opacity: 1 }
      });
    }
  }

  function _dismiss() {
    if (!backdrop) return;
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    var bd = backdrop;
    var modal = bd.querySelector('.nr-modal');
    if (window.Motion && modal) {
      window.Motion.animate(modal, {
        spring: 'snappy',
        from: { scale: 1, opacity: 1 },
        to: { scale: 0.9, opacity: 0 },
        onFinish: function() { bd.remove(); }
      });
    } else {
      bd.remove();
    }
    backdrop = null;
    if (S.isSignal(isPresented)) isPresented.value = false;
  }

  if (S.isSignal(isPresented)) {
    _effect = S.Effect(function() {
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

// ─── Popover ──────────────────────────────────────────────

function Popover(anchorView, isPresented, contentFn) {
  var popEl = null;
  var _cleanup = null;
  var _effect = null;
  var _escCleanup = null;

  function _show() {
    if (popEl) return;

    popEl = document.createElement('div');
    popEl.className = 'aether-ui-popover';
    popEl.style.zIndex = 'var(--nr-z-overlay, 1000)';
    popEl.style.background = 'var(--nr-bg-overlay)';
    popEl.style.border = '1px solid var(--nr-border-subtle)';
    popEl.style.borderRadius = 'var(--nr-radius-lg)';
    popEl.style.boxShadow = '0 8px 32px var(--nr-shadow-popup)';
    popEl.style.padding = 'var(--nr-space-3)';

    var content = contentFn();
    if (content instanceof View) {
      popEl.appendChild(content.build());
      if (content._onAppearFn) content._onAppearFn();
    } else if (content instanceof HTMLElement) {
      popEl.appendChild(content);
    }

    var anchor = anchorView instanceof View ? anchorView.el : anchorView;
    document.body.appendChild(popEl);
    _positionBelow(popEl, anchor);

    // Click outside to dismiss
    function onDocClick(e) {
      if (!popEl.contains(e.target) && !anchor.contains(e.target)) {
        _dismiss();
      }
    }
    setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
    _cleanup = function() { document.removeEventListener('click', onDocClick); };

    _escCleanup = _escHandler(_dismiss);

    if (window.Motion) {
      window.Motion.animate(popEl, {
        spring: 'snappy',
        from: { y: -4, opacity: 0 },
        to: { y: 0, opacity: 1 }
      });
    }
  }

  function _dismiss() {
    if (!popEl) return;
    if (_cleanup) { _cleanup(); _cleanup = null; }
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    var el = popEl;
    if (window.Motion) {
      window.Motion.animate(el, {
        spring: 'snappy',
        from: { opacity: 1, y: 0 },
        to: { opacity: 0, y: -4 },
        onFinish: function() { el.remove(); }
      });
    } else {
      el.remove();
    }
    popEl = null;
    if (S.isSignal(isPresented)) isPresented.value = false;
  }

  if (S.isSignal(isPresented)) {
    _effect = S.Effect(function() {
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

// ─── Menu ─────────────────────────────────────────────────

function Menu(anchorView, menuItems) {
  var isOpen = S.State(false);
  var menuEl = null;
  var _cleanup = null;
  var _escCleanup = null;

  function _show() {
    if (menuEl) return;

    menuEl = document.createElement('div');
    menuEl.className = 'nr-menu aether-ui-menu';
    menuEl.style.zIndex = 'var(--nr-z-overlay, 1000)';
    menuEl.style.minWidth = '160px';

    var items = typeof menuItems === 'function' ? menuItems() : menuItems;
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        if (item.divider) {
          var hr = document.createElement('hr');
          hr.style.border = 'none';
          hr.style.borderTop = '1px solid var(--nr-border-default)';
          hr.style.margin = 'var(--nr-space-1) 0';
          menuEl.appendChild(hr);
          return;
        }
        var row = document.createElement('div');
        row.className = 'nr-menu-item';
        row.style.padding = 'var(--nr-space-2) var(--nr-space-3)';
        row.style.cursor = 'pointer';
        row.style.fontSize = '0.875rem';
        row.style.color = item.destructive ? '#dc2626' : 'var(--nr-text-primary)';
        row.style.borderRadius = 'var(--nr-radius-sm)';
        row.textContent = item.label;
        row.addEventListener('mouseenter', function() {
          row.style.background = 'var(--nr-bg-raised)';
        });
        row.addEventListener('mouseleave', function() {
          row.style.background = '';
        });
        row.addEventListener('click', function() {
          _dismiss();
          if (item.handler) item.handler();
        });
        menuEl.appendChild(row);
      })(items[i]);
    }

    var anchor = anchorView instanceof View ? anchorView.el : anchorView;
    document.body.appendChild(menuEl);
    _positionBelow(menuEl, anchor);

    function onDocClick(e) {
      if (!menuEl.contains(e.target) && !anchor.contains(e.target)) {
        _dismiss();
      }
    }
    setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
    _cleanup = function() { document.removeEventListener('click', onDocClick); };

    _escCleanup = _escHandler(_dismiss);

    if (window.Motion) {
      window.Motion.animate(menuEl, {
        spring: 'snappy',
        from: { y: -4, opacity: 0 },
        to: { y: 0, opacity: 1 }
      });
    }
  }

  function _dismiss() {
    if (!menuEl) return;
    if (_cleanup) { _cleanup(); _cleanup = null; }
    if (_escCleanup) { _escCleanup(); _escCleanup = null; }
    var el = menuEl;
    if (window.Motion) {
      window.Motion.animate(el, {
        spring: 'snappy',
        from: { opacity: 1, y: 0 },
        to: { opacity: 0, y: -4 },
        onFinish: function() { el.remove(); }
      });
    } else {
      el.remove();
    }
    menuEl = null;
    isOpen.value = false;
  }

  // Wire anchor click to toggle
  var anchor = anchorView instanceof View ? anchorView.el : anchorView;
  anchor.addEventListener('click', function(e) {
    e.stopPropagation();
    if (menuEl) _dismiss();
    else _show();
  });

  return {
    show: _show,
    dismiss: _dismiss,
    isOpen: isOpen,
    dispose: function() {
      _dismiss();
    }
  };
}

// ─── Export ───────────────────────────────────────────────

window._AetherUIOverlay = {
  Sheet: Sheet,
  Alert: Alert,
  Popover: Popover,
  Menu: Menu
};

export { Sheet, Alert, Popover, Menu };
