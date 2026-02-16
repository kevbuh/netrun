/* AetherUI Overlay — Sheet, Alert, Popover, Menu
   Mounts to document.body. Uses existing .nr-modal-* and .nr-sheet-* CSS. */

(function() {
  'use strict';

  var View = window._AetherUIView;
  var S = window._AetherUIState;

  function _spaceToken(v) {
    if (typeof v === 'number') return 'var(--nr-space-' + v + ')';
    return v;
  }

  // ─── Sheet (bottom drawer) ────────────────────────────────

  function Sheet(isPresented, contentFn) {
    var backdrop = null;
    var sheetEl = null;

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
      S.Effect(function() {
        if (isPresented.value) _show();
        else _dismiss();
      });
    }

    return { show: _show, dismiss: _dismiss };
  }

  // ─── Alert ────────────────────────────────────────────────

  function Alert(isPresented, opts) {
    opts = opts || {};
    var backdrop = null;

    function _show() {
      if (backdrop) return;

      backdrop = document.createElement('div');
      backdrop.className = 'nr-modal-backdrop';

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
      backdrop.remove();
      backdrop = null;
      if (S.isSignal(isPresented)) isPresented.value = false;
    }

    if (S.isSignal(isPresented)) {
      S.Effect(function() {
        if (isPresented.value) _show();
        else _dismiss();
      });
    }

    return { show: _show, dismiss: _dismiss };
  }

  // ─── Popover ──────────────────────────────────────────────

  function Popover(anchorView, isPresented, contentFn) {
    var popEl = null;
    var _cleanup = null;

    function _show() {
      if (popEl) return;

      popEl = document.createElement('div');
      popEl.className = 'aether-ui-popover';
      popEl.style.position = 'absolute';
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

      // Position below anchor
      var anchor = anchorView instanceof View ? anchorView.el : anchorView;
      var rect = anchor.getBoundingClientRect();
      popEl.style.top = (rect.bottom + 4) + 'px';
      popEl.style.left = rect.left + 'px';

      document.body.appendChild(popEl);

      // Click outside to dismiss
      function onDocClick(e) {
        if (!popEl.contains(e.target) && !anchor.contains(e.target)) {
          _dismiss();
        }
      }
      setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
      _cleanup = function() { document.removeEventListener('click', onDocClick); };

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
      popEl.remove();
      popEl = null;
      if (S.isSignal(isPresented)) isPresented.value = false;
    }

    if (S.isSignal(isPresented)) {
      S.Effect(function() {
        if (isPresented.value) _show();
        else _dismiss();
      });
    }

    return { show: _show, dismiss: _dismiss };
  }

  // ─── Menu ─────────────────────────────────────────────────

  function Menu(anchorView, menuItems) {
    var isOpen = S.State(false);
    var menuEl = null;
    var _cleanup = null;

    function _show() {
      if (menuEl) return;

      menuEl = document.createElement('div');
      menuEl.className = 'nr-menu aether-ui-menu';
      menuEl.style.position = 'absolute';
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
      var rect = anchor.getBoundingClientRect();
      menuEl.style.top = (rect.bottom + 4) + 'px';
      menuEl.style.left = rect.left + 'px';
      document.body.appendChild(menuEl);

      function onDocClick(e) {
        if (!menuEl.contains(e.target) && !anchor.contains(e.target)) {
          _dismiss();
        }
      }
      setTimeout(function() { document.addEventListener('click', onDocClick); }, 0);
      _cleanup = function() { document.removeEventListener('click', onDocClick); };

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
      menuEl.remove();
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

    return { show: _show, dismiss: _dismiss, isOpen: isOpen };
  }

  // ─── Export ───────────────────────────────────────────────

  window._AetherUIOverlay = {
    Sheet: Sheet,
    Alert: Alert,
    Popover: Popover,
    Menu: Menu
  };

})();
