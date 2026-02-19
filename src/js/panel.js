// panel.js — Panel UI builders, positioning, and main entry point
// State, TTS, Chat, and Commands extracted to separate modules
import Settings from '/js/core/core-settings.js';

export function _positionAtCursor(cx, cy, w, h, preferLeft) {
  const bounds = _popupSafeBounds();
  // Try preferred placement first, then flip axes as needed
  let left, top;
  const fitsLeft  = cx - w >= bounds.left;
  const fitsRight = cx + w <= bounds.right;
  const fitsAbove = cy - h >= bounds.top;
  const fitsBelow = cy + h <= bounds.bottom;

  // Horizontal: prefer putting panel on the preferred side of cursor
  if (preferLeft) {
    left = fitsLeft ? cx - w : cx;  // left of cursor, else right
  } else {
    left = fitsRight ? cx : cx - w; // right of cursor, else left
  }
  // Vertical: prefer above cursor, else below
  top = fitsAbove ? cy - h : cy;

  return { left, top };
}

export function _repositionSelectionPopup() {
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) return;
  const rect = popup.getBoundingClientRect();

  // Tab context panel: anchor top-left below the tab
  if (popup._tabContextAnchor) {
    let left = popup._tabContextAnchor.left;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.top = popup._tabContextAnchor.top + 'px';
    popup.style.left = left + 'px';
    return;
  }

  // Aether panel: position relative to stored mouse position
  if (popup._isAetherPanel) {
    const anchorX = popup._aetherAnchorX ?? _lastMouseX;
    const anchorY = popup._aetherAnchorY ?? _lastMouseY;
    const pos = _positionAtCursor(anchorX, anchorY, rect.width, rect.height, false);
    popup.style.top = pos.top + 'px';
    popup.style.left = pos.left + 'px';
    return;
  }

  // Re-anchor relative to stored selection position so popup grows upward
  const bounds = _popupSafeBounds();
  let top;
  if (popup._aboveSelection) {
    top = popup._anchorTop - rect.height - 8;
    if (top < bounds.top) {
      top = popup._anchorBottom + 8;
      popup._aboveSelection = false;
    }
  } else {
    top = popup._anchorBottom + 8;
  }
  if (top + rect.height > bounds.bottom - 8) {
    top = bounds.bottom - rect.height - 8;
  }
  if (top < bounds.top) top = bounds.top;

  let left = popup._anchorLeft || parseFloat(popup.style.left);
  if (left + rect.width > bounds.right - 8) left = bounds.right - rect.width - 8;
  if (left < bounds.left) left = bounds.left;

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

// Text selection → floating popup; drag-to-screenshot when aether panel is open
export let _selPopupDragging = false;

document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) {
    return;
  }
  // In track mode with captureScreen available: start screenshot drag
  if (existing && _aetherTrackMode && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
    e.preventDefault(); // prevent text selection during drag
    e.stopImmediatePropagation(); // prevent other mousedown handlers from running
    _aetherTrackModeVal = false; // bypass setter — keep iframes disabled during drag
    _screenshotCapturing = true; // protect panel from removal throughout entire drag+capture
    _screenshotDragStart = { x: e.clientX, y: e.clientY };
    // Create selection rect + dim overlay elements
    _screenshotDim = document.createElement('div');
    _screenshotDim.className = 'screenshot-dim';
    document.body.appendChild(_screenshotDim);
    _screenshotSelection = document.createElement('div');
    _screenshotSelection.className = 'screenshot-selection';
    document.body.appendChild(_screenshotSelection);
    return;
  }
  // If NOT in track mode and not pinned, remove existing panel
  if (existing && !_aetherTrackMode && !_screenshotCapturing && !_aetherPinned) {
    _aetherBackgroundStreaming = false; islandRemove('aether');
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Skip interactive elements and navigation
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target.isContentEditable) return;
  if (e.target.closest('#sidebar-nav')) return;
  if (e.target.closest('#browse-bar')) return;
  if (e.target.closest('.doc-selection-popup')) return;
  if (e.target.closest('a[href]')) return;
  if (e.target.closest('[onclick]')) return;
  _selPopupDragging = true;
});

document.addEventListener('selectionchange', function() {
  if (!_selPopupDragging) return;
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3 || sel.rangeCount === 0) return;
  // User is actively selecting text — stop tracking, show selection preview
  _aetherTrackMode = false;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing._isAetherPanel) existing.remove();
  const range = sel.getRangeAt(0);
  _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, finalized: false });
});

document.addEventListener('mouseup', async function(e) {
  // Screenshot drag completion
  if (_screenshotDragStart) {
    e.stopImmediatePropagation(); // prevent other mouseup handlers
    // Suppress the click event that follows mouseup
    document.addEventListener('click', function suppress(ce) { ce.stopImmediatePropagation(); }, { once: true, capture: true });
    const startPos = _screenshotDragStart;
    _screenshotDragStart = null;
    const x = Math.min(e.clientX, startPos.x);
    const y = Math.min(e.clientY, startPos.y);
    const w = Math.abs(e.clientX - startPos.x);
    const h = Math.abs(e.clientY - startPos.y);
    // Restore iframe pointer events and remove selection visuals before capture
    _screenshotRestoreIframes();
    if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
    if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
    if (w >= 10 && h >= 10 && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
      // Small delay so overlay removal renders before capture
      await new Promise(r => setTimeout(r, 50));
      try {
        const popup = document.getElementById('doc-chat-ask-float');
        const base64 = window.electronAPI?.captureScreen
          ? await window.electronAPI.captureScreen({ x, y, width: w, height: h })
          : await _browserCaptureRect({ x, y, width: w, height: h });
        if (base64 && popup) {
          _addScreenshotToPanel(popup, base64);
        }
      } catch (err) {
        console.error('Screenshot capture failed:', err);
      }
    }
    _screenshotCapturing = false;
    return;
  }

  if (!_selPopupDragging) return;
  _selPopupDragging = false;

  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text && text.length >= 3 && sel.rangeCount > 0) {
    // Text was selected → finalize selection popup
    _aetherTrackMode = false;
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const inTextLayer = ancestor.closest ? !!ancestor.closest('.textLayer') : !!(ancestor.parentElement && ancestor.parentElement.closest('.textLayer'));
    _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, selectionRange: range.cloneRange(), inTextLayer, finalized: true });
    return;
  }

  // Single click, no selection → dismiss existing panel
  if (_screenshotCapturing) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) return; // click was inside the panel
  if (existing) { existing.remove(); _aetherTrackMode = false; _aetherPinned = false; }
});

// Any left-click dismisses the aether panel (capture phase to bypass stopPropagation)
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  if (_screenshotDragStart || _screenshotCapturing) return;
  const btn = document.getElementById('doc-chat-ask-float');
  if (!btn) return;
  // Clicks inside the panel should not dismiss it
  if (btn.contains(e.target)) return;
  // Pinned panels survive clicks — unless streaming, allow dismiss to island
  if (_aetherPinned && !_popupChatAbort) return;
  _maybeDismissToIsland(btn);
  if (!_aetherBackgroundStreaming && _popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  _aetherPinned = false;
  _savePopupChatToHighlight(btn);
  btn.remove();
  _aetherShowCursor();
}, true);

// Aether panel: tracks cursor + screenshot drag
document.addEventListener('mousemove', function(e) {
  _lastMouseX = e.clientX;
  _lastMouseY = e.clientY;

  // Screenshot drag in progress
  if (_screenshotDragStart && _screenshotSelection && _screenshotDim) {
    const sx = Math.min(e.clientX, _screenshotDragStart.x);
    const sy = Math.min(e.clientY, _screenshotDragStart.y);
    const sw = Math.abs(e.clientX - _screenshotDragStart.x);
    const sh = Math.abs(e.clientY - _screenshotDragStart.y);
    _screenshotSelection.style.display = 'block';
    _screenshotSelection.style.left = sx + 'px';
    _screenshotSelection.style.top = sy + 'px';
    _screenshotSelection.style.width = sw + 'px';
    _screenshotSelection.style.height = sh + 'px';
    const vw = window.innerWidth, vh = window.innerHeight;
    _screenshotDim.style.clipPath = `polygon(0 0,${vw}px 0,${vw}px ${vh}px,0 ${vh}px,0 0,${sx}px ${sy}px,${sx}px ${sy+sh}px,${sx+sw}px ${sy+sh}px,${sx+sw}px ${sy}px,${sx}px ${sy}px)`;
    return;
  }

  // Drag-to-move the aether panel
  if (_aetherDragging) {
    const popup = _aetherDragPopup || document.getElementById('doc-chat-ask-float');
    if (!popup) { _aetherDragging = false; _aetherDragPopup = null; return; }
    const bounds = _popupSafeBounds();
    let left = e.clientX - _aetherDragOffset.x;
    let top = e.clientY - _aetherDragOffset.y;
    if (left < bounds.left) left = bounds.left;
    if (top < bounds.top) top = bounds.top;
    if (left + popup.offsetWidth > bounds.right) left = bounds.right - popup.offsetWidth;
    if (top + popup.offsetHeight > bounds.bottom) top = bounds.bottom - popup.offsetHeight;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = top + popup.offsetHeight;
    return;
  }

  if (!_aetherTrackMode) return;
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) { _aetherTrackMode = false; return; }

  // Snap to sidebar icon if hovering over one
  const hovered = e.target.closest && e.target.closest('.sidebar-icon');
  if (hovered) {
    const rect = hovered.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.bottom + 6;
    popup._aetherAnchorX = cx;
    popup._aetherAnchorY = cy;
    const pw = popup.offsetWidth;
    popup.style.left = Math.max(4, cx - pw / 2) + 'px';
    popup.style.top = cy + 'px';
    // Inject/remove profile items when hovering the profile icon
    const isProfile = hovered.id === 'sb-user-avatar';
    const hasProfileItems = !!popup.querySelector('.aether-profile-items');
    if (isProfile && !hasProfileItems) {
      _injectProfileItems(popup);
    } else if (!isProfile && hasProfileItems) {
      const pi = popup.querySelector('.aether-profile-items');
      if (pi) pi.remove();
    }
    return;
  }
  // Remove profile items when cursor leaves sidebar icons
  const pi = popup.querySelector('.aether-profile-items');
  if (pi) pi.remove();

  popup._aetherAnchorX = e.clientX;
  popup._aetherAnchorY = e.clientY;
  const pos = _positionAtCursor(e.clientX, e.clientY, popup.offsetWidth, popup.offsetHeight, false);
  popup.style.left = pos.left + 'px';
  popup.style.top = pos.top + 'px';
});

// End drag-to-move
document.addEventListener('mouseup', function(e) {
  if (_aetherDragging) {
    _aetherDragging = false;
    const draggedPopup = _aetherDragPopup;
    _aetherDragPopup = null;
    const topBar = draggedPopup ? draggedPopup.querySelector('.aether-top-actions') : document.querySelector('.aether-top-actions');
    if (topBar) topBar.style.cursor = 'grab';
  }
});

// Escape to dismiss from anywhere
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // Cancel screenshot drag if active
    if (_screenshotDragStart || _screenshotCapturing) {
      _screenshotDragStart = null;
      _screenshotCapturing = false;
      _screenshotRestoreIframes();
      if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
      if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
      return;
    }
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) {
      _maybeDismissToIsland(popup);
      if (!_aetherBackgroundStreaming && _popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _aetherTrackMode = false;
      _aetherPinned = false;
      _pendingScreenshots = [];
      _pendingTabContexts = [];
      _pendingFileContexts = [];
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
  }
  // Shift key handler removed - no longer dismisses panel
});

// Enter key with selection adds text to panel input
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    const popup = document.getElementById('doc-chat-ask-float');
    if (!popup) return;
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (!askInput) return;

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    // Only handle if text is selected and it's not inside the input
    if (selectedText && !selection.containsNode(askInput, true)) {
      e.preventDefault();
      e.stopPropagation();
      // Add selected text to input
      const currentVal = askInput.value.trim();
      askInput.value = currentVal ? currentVal + ' ' + selectedText : selectedText;
      askInput.focus();
      // Clear the selection
      if (selection) selection.removeAllRanges();
      return;
    }
  }
});

// "/" key opens aether panel with "/" pre-filled
document.addEventListener('keydown', function(e) {
  // Cmd+I or Ctrl+I toggles aether panel
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
    e.preventDefault();
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { _maybeDismissToIsland(popup); if (!_aetherBackgroundStreaming && _popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; } popup.remove(); _aetherTrackMode = false; _aetherPinned = false; _aetherShowCursor(); _aetherRestoreFocus(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    _showPanel({ anchor: { x: _lastMouseX, y: _lastMouseY } });
    return;
  }
  if (e.key !== '/') return;
  // Skip if typing in an input, textarea, or contentEditable
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  // Skip if aether panel already open
  if (document.getElementById('doc-chat-ask-float')) return;
  e.preventDefault();
  // Open centered horizontally, near top of viewport
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  _showPanel({ anchor: { x, y }, initialValue: '/' });
});

// Right-click anywhere opens aether panel
export function _handleContextMenuChat(e) {
  if (Settings.get('clickAether') === 'off') return;
  // Don't intercept on login or onboarding screens
  const loginGate = document.getElementById('login-gate');
  if (loginGate && loginGate.style.display !== 'none') return;
  const onboard = document.getElementById('onboard-view');
  if (onboard && onboard.style.display !== 'none') return;
  // Skip if right-clicking inside an existing popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup && popup.contains(e.target)) return;
  // Skip if clicking inside the browse URL bar
  if (e.target.id === 'browse-url-input' || e.target.closest('#browse-bar')) return;
  // For inputs/textareas, show panel with paste support instead of native context menu
  const tag = e.target.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
  if (isEditable) {
    e.preventDefault();
    if (popup) { popup.remove(); _aetherTrackMode = false; }
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().trim() || '';
    _showPanel({ anchor: { x: e.clientX, y: e.clientY }, editableTarget: e.target, selectionText: selectedText, finalized: true });
    return;
  }
  // Intercept right-click on browse tabs for tab context menu
  const browseTab = e.target.closest('.browse-tab, .browse-vtab');
  if (browseTab) {
    e.preventDefault();
    _showTabContextMenu(e, browseTab);
    return;
  }
  // Skip browse view chrome — iframe/webview handles its own context menu
  if (e.target.closest('#browse-bar, #browse-tab-row, #browse-vtabs, #universal-panel')) return;
  // In browse content, skip only iframes/webviews (they have injected handlers)
  const browseContent = e.target.closest('#browse-content');
  if (browseContent && (e.target.tagName === 'IFRAME' || e.target.tagName === 'WEBVIEW')) return;
  e.preventDefault();
  // Capture the previously focused editable element before panel steals focus
  const active = document.activeElement;
  const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
  if (popup) { popup.remove(); _aetherTrackMode = false; }
  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, priorEditable, trackCursor: true });
}
document.addEventListener('contextmenu', _handleContextMenuChat);

// Convert a rect from inside an iframe/webview to parent viewport coordinates
export function _iframeRectToParent(r, frame) {
  const f = frame.getBoundingClientRect();
  return { top: r.top + f.top, bottom: r.bottom + f.top, left: r.left + f.left, right: r.right + f.left, width: r.width, height: r.height };
}

// Inject context-menu, text-selection, and keyboard handlers into same-origin iframes
export function _injectIframeChatHandler(iframe) {
  const tryInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || doc._chatHandlerInjected) return;
      doc._chatHandlerInjected = true;

      const isInteractive = (el) => {
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable;
      };

      // Right-click → aether panel
      doc.addEventListener('contextmenu', function(e) {
        if (Settings.get('clickAether') === 'off') return;
        const f = iframe.getBoundingClientRect();
        const tag = e.target.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
        if (isEditable) {
          e.preventDefault();
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          const sel = doc.getSelection();
          const selectedText = sel && sel.toString().trim() || '';
          _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, editableTarget: e.target, selectionText: selectedText, finalized: true });
          return;
        }
        if (isInteractive(e.target)) return;
        e.preventDefault();
        // Capture focused editable inside iframe before panel steals focus
        const active = doc.activeElement;
        const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) { popup.remove(); _aetherTrackMode = false; }
        // Detect link/image targets for context menu
        const linkEl = e.target.closest('a[href]');
        const imgEl = e.target.tagName === 'IMG' ? e.target : e.target.closest('img');
        const contextMenu = (linkEl || imgEl) ? {
          linkUrl: linkEl ? linkEl.href : '',
          linkText: linkEl ? (linkEl.textContent || '').trim() : '',
          imgUrl: imgEl ? imgEl.src : ''
        } : null;
        _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, priorEditable, contextMenu, trackCursor: !contextMenu });
      });

      // Text selection → selection popup
      let dragging = false;
      doc.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing.contains(e.target)) return;
        if (existing && !_aetherTrackMode) {
          _aetherBackgroundStreaming = false; islandRemove('aether');
          if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
          _savePopupChatToHighlight(existing);
          existing.remove();
        }
        if (!isInteractive(e.target)) dragging = true;
      });
      doc.addEventListener('selectionchange', function() {
        if (!dragging) return;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || text.length < 3 || sel.rangeCount === 0) return;
        _aetherTrackMode = false;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing._isAetherPanel) existing.remove();
        _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: false });
      });
      doc.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (text && text.length >= 3 && sel.rangeCount > 0) {
          _aetherTrackMode = false;
          _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: true });
          return;
        }
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing) { existing.remove(); _aetherTrackMode = false; _aetherPinned = false; }
      });

      // Cmd+click → open link in new tab
      doc.addEventListener('click', function(e) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const a = e.target.closest('a');
        if (!a || !a.href) return;
        e.preventDefault();
        e.stopPropagation();
        window.top.open(a.href, '_blank');
      }, true);

      // Keyboard shortcuts
      doc.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar();
        }
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); if (typeof _switchTabLeft === 'function') _switchTabLeft(); }
          if (e.key === 'ArrowRight') { e.preventDefault(); if (typeof _switchTabRight === 'function') _switchTabRight(); }
        }
      });
    } catch (e) {
      // Cross-origin — can't inject (webview uses executeJavaScript path instead)
    }
  };
  iframe.addEventListener('load', tryInject);
  tryInject();
}

// ── Screenshot drag-to-capture ──
// State for drag-to-screenshot (active when aether panel is open)
export let _screenshotDragStart = null; // {x, y} or null
export let _screenshotSelection = null; // DOM element
export let _screenshotDim = null; // DOM element
export let _screenshotCapturing = false; // true while capture is in progress


// ── Unified Popup Panel ──
// _showPanel(config) replaces both _showAetherPanel and _buildSelectionPopup.
// Config:
//   anchor: { x, y } | { selectionRect: DOMRect } | { tab: HTMLElement }
//   trackCursor: bool         — follow mouse until interaction
//   contextMenu: { items, linkUrl, linkText, imgUrl }
//   selectionText: string     — selected text preview
//   selectionRange: Range     — for highlight creation
//   inTextLayer: bool         — PDF text layer (show highlight dots)
//   initialValue: string      — pre-fill input (e.g. '/')
//   finalized: bool           — false = selection preview only (no buttons/input)
//   editableTarget: HTMLElement — the input/textarea/contentEditable element (for paste)
//   priorEditable: HTMLElement  — editable element that was focused before panel opened

// Focus an element that may be inside an iframe — focuses the iframe first if needed
export function _focusCrossFrame(el) {
  const ownerDoc = el.ownerDocument;
  if (ownerDoc && ownerDoc !== document) {
    const iframes = document.querySelectorAll('iframe, webview');
    for (const f of iframes) {
      try {
        if (f.contentDocument === ownerDoc) { f.focus(); break; }
      } catch (e) { /* cross-origin */ }
    }
  }
  el.focus();
}

// Paste text into an element, handling iframe ownership for execCommand
export function _pasteIntoElement(el, text) {
  _focusCrossFrame(el);
  if (el.isContentEditable) {
    // execCommand must be called on the element's ownerDocument (matters for iframes)
    const ownerDoc = el.ownerDocument || document;
    ownerDoc.execCommand('insertText', false, text);
  } else {
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = el.value || '';
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function _flashCopyBtn(popup) {
  // Find the right copy button: selection copy or chat copy
  const btn = popup.querySelector('.doc-selection-copy-btn')
    || (popup._copyChatBtn && popup._copyChatBtn.style.display !== 'none' ? popup._copyChatBtn : null);
  if (!btn) return;
  btn.textContent = 'Copied';
  btn.classList.remove('doc-copy-flash');
  // Force reflow so animation restarts if already playing
  void btn.offsetWidth;
  btn.classList.add('doc-copy-flash');
  setTimeout(() => {
    if (btn.isConnected) { btn.textContent = 'Copy'; btn.classList.remove('doc-copy-flash'); }
  }, 1200);
}

// ── Helper: inject profile menu items into the aether panel ──
export function _injectProfileItems(popup) {
  if (popup.querySelector('.aether-profile-items')) return;
  const email = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.email) || '';
  const username = (typeof _authUserInfo !== 'undefined' && (_authUserInfo?.username || _authUserInfo?.name)) || '';
  const ctxDiv = document.createElement('div');
  ctxDiv.className = 'doc-aether-context-items aether-profile-items';

  // User info header
  if (username || email) {
    const info = document.createElement('div');
    info.className = 'doc-aether-ctx-item doc-aether-ctx-info';
    info.innerHTML = '<span class="doc-aether-ctx-label">' + escapeHtml(username) + '</span>' +
      (email ? '<span class="doc-aether-ctx-sub">' + escapeHtml(email) + '</span>' : '');
    ctxDiv.appendChild(info);
  }

  const items = [
    { label: 'View Profile', icon: icon('profile', { size: 14 }), fn: () => openUserProfile(username) },
    { label: 'Settings', icon: icon('settings', { size: 14 }), fn: () => openSettings() },
    { label: 'Help', icon: icon('helpCircle', { size: 14 }), fn: () => { openBrowse(); setTimeout(() => openHelpPage(), 50); } },
    { sep: true },
    { label: 'Sign Out', icon: icon('signOut', { size: 14 }), danger: true, fn: () => _doLogout() },
  ];

  for (const entry of items) {
    if (entry.sep) {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
      continue;
    }
    const item = document.createElement('div');
    item.className = 'doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : '');
    item.innerHTML = entry.icon + ' ' + escapeHtml(entry.label);
    item.addEventListener('mousedown', (ev) => ev.stopPropagation());
    item.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _aetherTrackMode = false;
      popup.remove();
      entry.fn();
    });
    ctxDiv.appendChild(item);
  }

  // Insert before the chat input wrap (or at end)
  const inputWrap = popup.querySelector('.doc-ask-inline-wrap');
  if (inputWrap) popup.insertBefore(ctxDiv, inputWrap);
  else popup.appendChild(ctxDiv);
}

// ── Helper: build generic context menu items (tab, custom items) ──
export function _panelBuildContextItems(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!(contextMenu && contextMenu.items)) return;
  const ctxDiv = document.createElement('div');
  ctxDiv.className = 'doc-aether-context-items';
  for (const entry of contextMenu.items) {
    if (entry.sep) {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
      continue;
    }
    const item = document.createElement('div');
    item.className = 'doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : '') + (entry.info ? ' doc-aether-ctx-info' : '');
    if (entry.icon) {
      item.innerHTML = entry.icon + ' ' + escapeHtml(entry.label);
    } else if (entry.subtext) {
      item.innerHTML = '<span class="doc-aether-ctx-label">' + escapeHtml(entry.label) + '</span><span class="doc-aether-ctx-sub">' + escapeHtml(entry.subtext) + '</span>';
    } else if (entry.colorDot) {
      item.innerHTML = '<span class="browse-ctx-color-dot" style="background:' + escapeAttr(entry.colorDot) + '"></span>' + escapeHtml(entry.label);
    } else {
      item.textContent = entry.label;
    }
    if (!entry.info) {
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        entry.fn();
        _aetherTrackMode = false;
        popup.remove();
      });
    }
    ctxDiv.appendChild(item);
  }
  popup.appendChild(ctxDiv);
}

// ── Helper: build link/image context menu + link preview ──
export function _panelBuildLinkContextMenu(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!contextMenu) return;

  // Link preview (async)
  if (contextMenu.linkUrl) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'doc-link-preview';
    apiGet('/api/link-preview?url=' + encodeURIComponent(contextMenu.linkUrl))
      .then(data => {
        if (!popup.isConnected) return;
        if (!data.title && !data.description) return;
        let html = '';
        if (data.image) {
          html += `<img class="doc-link-preview-img" src="${escapeAttr(data.image)}" onerror="this.remove()">`;
        }
        html += '<div class="doc-link-preview-text">';
        html += `<div class="doc-link-preview-site">${escapeHtml(data.site || data.domain || '')}</div>`;
        html += `<div class="doc-link-preview-title">${escapeHtml(data.title)}</div>`;
        if (data.description) {
          html += `<div class="doc-link-preview-desc">${escapeHtml(data.description)}</div>`;
        }
        html += '</div>';
        previewDiv.innerHTML = html;
        previewDiv.style.cursor = 'pointer';
        previewDiv.addEventListener('mousedown', (ev) => ev.stopPropagation());
        previewDiv.addEventListener('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          if (typeof browseNewTab === 'function') browseNewTab(contextMenu.linkUrl);
          else window.open(contextMenu.linkUrl, '_blank');
        });
        popup.insertBefore(previewDiv, popup.firstChild);
        _repositionSelectionPopup();
      })
      .catch(() => {});
  }

  // Context menu items (links, images) — only when no custom items
  if ((contextMenu.linkUrl || contextMenu.imgUrl) && !contextMenu.items) {
    const ctxDiv = document.createElement('div');
    ctxDiv.className = 'doc-aether-context-items';
    const linkUrl = contextMenu.linkUrl || '';
    const linkText = contextMenu.linkText || '';
    const imgUrl = contextMenu.imgUrl || '';

    const addItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        _aetherTrackMode = false;
        popup.remove();
      });
      ctxDiv.appendChild(item);
    };
    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'doc-aether-ctx-sep';
      ctxDiv.appendChild(sep);
    };

    if (linkUrl) {
      addItem('Open Link in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(linkUrl); });
      addItem('Open Link Here', () => { if (typeof browseNavigate === 'function') browseNavigate(linkUrl); });
      addSep();
      addItem('Copy Link Address', () => navigator.clipboard.writeText(linkUrl).catch(() => {}));
      if (linkUrl.startsWith('mailto:')) {
        const email = linkUrl.replace('mailto:', '').split('?')[0];
        addItem('Copy Email Address', () => navigator.clipboard.writeText(email).catch(() => {}));
      }
      if (linkText) addItem('Copy Link Text', () => navigator.clipboard.writeText(linkText).catch(() => {}));
    }
    if (imgUrl) {
      if (linkUrl) addSep();
      addItem('Open Image in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(imgUrl); });
      addItem('Copy Image Address', () => navigator.clipboard.writeText(imgUrl).catch(() => {}));
      addItem('Copy Image', () => {
        // Route through our image proxy so it's always same-origin
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          c.toBlob(b => {
            if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {});
          }, 'image/png');
        };
        img.src = proxyUrl;
      });
      addItem('Save Image As…', () => {
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const a = document.createElement('a');
        a.href = proxyUrl;
        // Extract a filename from the URL, fallback to 'image.png'
        try { a.download = imgUrl.split('/').pop().split('?')[0] || 'image.png'; } catch(_) { a.download = 'image.png'; }
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      // "Add to Assistant" keeps the panel open and adds the image as chat context
      const assistItem = document.createElement('div');
      assistItem.className = 'doc-aether-ctx-item';
      assistItem.textContent = 'Add to Assistant';
      assistItem.addEventListener('mousedown', (ev) => ev.stopPropagation());
      assistItem.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        _aetherTrackMode = false;
        // Remove context menu items but keep the panel
        const ctxItems = popup.querySelector('.doc-aether-context-items');
        if (ctxItems) ctxItems.remove();
        const preview = popup.querySelector('.doc-link-preview');
        if (preview) preview.remove();
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          const base64 = c.toDataURL('image/png').split(',')[1];
          if (base64) _addScreenshotToPanel(popup, base64);
        };
        img.src = proxyUrl;
      });
      ctxDiv.appendChild(assistItem);
    }
    if (linkText && linkUrl) {
      const truncated = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
      addSep();
      addItem('Search Google for "' + truncated + '"', () => {
        if (typeof browseNewTab === 'function') browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
      });
    }

    popup.appendChild(ctxDiv);
  }
}

// ── Helper: build editable field actions (Cut/Copy/Paste for native + webview + prior editable) ──
export function _panelBuildEditableActions(popup, config, capturedText, hasContext) {
  const editableTarget = config.editableTarget || null;
  const webviewEditable = config.webviewEditable || null;

  // Native editable field actions (Cut, Copy, Paste)
  if (editableTarget) {
    const editCtx = document.createElement('div');
    editCtx.className = 'doc-aether-context-items';
    const addEditItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        popup.remove();
      });
      editCtx.appendChild(item);
    };
    if (capturedText) {
      addEditItem('Cut', () => {
        navigator.clipboard.writeText(capturedText).catch(() => {});
        _focusCrossFrame(editableTarget);
        if (editableTarget.isContentEditable) {
          (editableTarget.ownerDocument || document).execCommand('delete');
        } else {
          const start = editableTarget.selectionStart;
          const end = editableTarget.selectionEnd;
          const val = editableTarget.value;
          editableTarget.value = val.slice(0, start) + val.slice(end);
          editableTarget.selectionStart = editableTarget.selectionEnd = start;
          editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      addEditItem('Copy', () => {
        navigator.clipboard.writeText(capturedText).catch(() => {});
      });
    }
    addEditItem('Paste', () => {
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        _pasteIntoElement(editableTarget, text);
      }).catch(() => {});
    });
    popup.appendChild(editCtx);
  }

  // Webview editable field (cross-origin) — Cut/Copy/Paste via webview API
  if (webviewEditable) {
    const wvCtx = document.createElement('div');
    wvCtx.className = 'doc-aether-context-items';
    const wv = webviewEditable.webview;
    const flags = webviewEditable.editFlags || {};
    const addWvItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-aether-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
      item.addEventListener('mouseup', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
      });
      wvCtx.appendChild(item);
    };
    const wvExec = (js) => { popup.remove(); wv.focus(); setTimeout(() => wv.executeJavaScript(js).catch(() => {}), 50); };
    if (flags.canCut) addWvItem('Cut', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(!el) return; el.focus();
        var text=document.getSelection().toString();
        if(text) navigator.clipboard.writeText(text).catch(function(){});
        if(el.isContentEditable) document.execCommand('delete');
        else if(el.selectionStart!==undefined){ var s=el.selectionStart,e=el.selectionEnd,v=el.value;
          el.value=v.slice(0,s)+v.slice(e); el.selectionStart=el.selectionEnd=s;
          el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
    });
    if (flags.canCopy) addWvItem('Copy', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus();
        navigator.clipboard.writeText(document.getSelection().toString()).catch(function(){}); })()`);
    });
    if (flags.canPaste) addWvItem('Paste', () => {
      // Read clipboard BEFORE removing popup (document must be focused for clipboard API)
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        popup.remove();
        wv.focus();
        setTimeout(() => {
          wv.executeJavaScript(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus(); })()`)
            .then(() => wv.insertText(text))
            .catch(() => {});
        }, 50);
      }).catch(() => {});
    });
    if (flags.canSelectAll) addWvItem('Select All', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el){el.focus();el.select();}else document.execCommand('selectAll'); })()`);
    });
    if (wvCtx.children.length) popup.appendChild(wvCtx);
  }

  // Paste into nearby editable or chat input (only when near an editable field)
  if (!editableTarget && !hasContext && !capturedText && !webviewEditable && config.priorEditable) {
    const priorEditable = config.priorEditable;
    const pasteCtx = document.createElement('div');
    pasteCtx.className = 'doc-aether-context-items';
    const pasteItem = document.createElement('div');
    pasteItem.className = 'doc-aether-ctx-item';
    pasteItem.textContent = 'Paste text';
    pasteItem.addEventListener('mousedown', (ev) => ev.stopPropagation());
    pasteItem.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        if (priorEditable && priorEditable.isConnected) {
          _pasteIntoElement(priorEditable, text);
          popup.remove();
        } else {
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = text; input.focus(); }
        }
      }).catch(() => {});
    });
    pasteCtx.appendChild(pasteItem);
    popup.appendChild(pasteCtx);
  }
}

// ── Helper: build selection UI (Copy button + highlight dots) ──
export function _panelBuildSelectionUI(popup, config) {
  const capturedText = config.selectionText || '';
  const selectionRange = config.selectionRange || null;
  const inTextLayer = !!config.inTextLayer;
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false;

  if (!(finalized && capturedText && !editableTarget)) return;

  const btnRow = document.createElement('div');
  btnRow.className = 'doc-selection-popup-btns';

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'doc-selection-copy-btn';
  copyBtn.title = 'Copy';
  copyBtn.innerHTML = icon('copy', { size: 14 });
  copyBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  copyBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    navigator.clipboard.writeText(capturedText).then(() => {
      copyBtn.innerHTML = icon('check', { size: 14 });
      setTimeout(() => { if (copyBtn.isConnected) copyBtn.innerHTML = icon('copy', { size: 14 }); }, 1200);
    }).catch(() => {});
  });
  btnRow.appendChild(copyBtn);

  // Read Aloud button — uses existing Kokoro TTS system
  const readBtn = document.createElement('button');
  readBtn.className = 'doc-selection-copy-btn';
  readBtn.title = 'Read aloud';
  readBtn.innerHTML = icon('speaker', { size: 14 });
  readBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  readBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // If TTS is already active, toggle pause/stop
    if (_ttsAudio || _ttsPaused || _ttsChunks.length > 0) {
      _ttsStopAll();
      readBtn.innerHTML = icon('speaker', { size: 14 });
      readBtn.title = 'Read aloud';
      return;
    }
    if (!capturedText || capturedText.length < 2) return;
    readBtn.innerHTML = icon('pauseRect', { size: 14 });
    readBtn.title = 'Stop';
    _ttsStopped = false;
    _ttsPaused = false;
    _ttsChunks = _ttsChunkText(capturedText);
    _ttsChunkIdx = 0;
    _ttsPlayedDurations = [];
    _ttsRemainingDurations = [];
    _ttsQueue = [];
    _ttsFetchAndQueue();
    // Reset button when TTS finishes naturally
    const checkDone = setInterval(() => {
      if (!_ttsAudio && !_ttsPaused && _ttsChunks.length === 0) {
        clearInterval(checkDone);
        if (readBtn.isConnected) {
          readBtn.innerHTML = icon('speaker', { size: 14 });
          readBtn.title = 'Read aloud';
        }
      }
    }, 500);
  });
  btnRow.appendChild(readBtn);

  // "Read from here" button — reads from selection to end of page
  if (typeof _getCurrentWindow === 'function' && typeof _extractTextFromFrame === 'function') {
    const fromHereBtn = document.createElement('button');
    fromHereBtn.className = 'doc-selection-copy-btn';
    fromHereBtn.innerHTML = icon('play', { size: 14 });
    fromHereBtn.title = 'Read from this point to the end of the page';
    fromHereBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    fromHereBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      // If TTS is already active, stop it
      if (_ttsAudio || _ttsPaused || _ttsChunks.length > 0) {
        _ttsStopAll();
        fromHereBtn.innerHTML = icon('play', { size: 14 });
        fromHereBtn.title = 'Read from this point to the end of the page';
        readBtn.innerHTML = icon('speaker', { size: 14 });
        readBtn.title = 'Read aloud';
        return;
      }
      const win = _getCurrentWindow();
      if (!win) return;
      const tab = win.tabs.find(t => t.id === win.activeTab);
      if (!tab) return;
      fromHereBtn.innerHTML = icon('pauseRect', { size: 14 });
      fromHereBtn.title = 'Stop';
      const fullText = await _extractTextFromFrame(tab);
      if (!fullText || fullText.length < 10) {
        fromHereBtn.innerHTML = icon('play', { size: 14 });
        fromHereBtn.title = 'Read from this point to the end of the page';
        return;
      }
      // Find selection in full text and read from there
      const needle = capturedText.trim().replace(/\s+/g, ' ');
      const haystack = fullText.replace(/\s+/g, ' ');
      const idx = haystack.indexOf(needle);
      const textFromHere = idx >= 0 ? haystack.slice(idx) : needle + '\n' + haystack;
      _ttsTabId = tab.id;
      _ttsStopped = false;
      _ttsPaused = false;
      _ttsChunks = _ttsChunkText(textFromHere);
      _ttsChunkIdx = 0;
      _ttsPlayedDurations = [];
      _ttsRemainingDurations = [];
      _ttsQueue = [];
      _ttsUpdateBtnIcon();
      _ttsFetchAndQueue();
      const checkDone2 = setInterval(() => {
        if (!_ttsAudio && !_ttsPaused && _ttsChunks.length === 0) {
          clearInterval(checkDone2);
          if (fromHereBtn.isConnected) {
            fromHereBtn.innerHTML = icon('play', { size: 14 });
            fromHereBtn.title = 'Read from this point to the end of the page';
          }
        }
      }, 500);
    });
    btnRow.appendChild(fromHereBtn);
  }

  // Annotate "+" button — mark selected text as a specific annotation type
  const annotateBtn = document.createElement('button');
  annotateBtn.className = 'doc-selection-copy-btn';
  annotateBtn.title = 'Mark as annotation';
  annotateBtn.innerHTML = icon('plus', { size: 14 });
  annotateBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  annotateBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // Toggle dropdown
    let dropdown = btnRow.querySelector('.ann-type-dropdown');
    if (dropdown) { dropdown.remove(); return; }
    dropdown = document.createElement('div');
    dropdown.className = 'ann-type-dropdown';
    dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--aether-dropdown-bg, #1a1a2e);border:1px solid var(--aether-border, rgba(255,255,255,0.1));border-radius:8px;padding:4px;margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;z-index:10;';
    const types = [
      { key: 'ALPHA', name: 'Alpha', color: '#4caf50' },
      { key: 'CONTRADICTION', name: 'Contradiction', color: '#ef5350' },
      { key: 'AD', name: 'Ad', color: '#ff9800' },
    ];
    // Add custom categories
    if (typeof _customAnnotationCategories !== 'undefined') {
      for (const cc of _customAnnotationCategories) {
        types.push({ key: cc.key, name: cc.name, color: cc.color });
      }
    }
    for (const t of types) {
      const chip = document.createElement('button');
      chip.style.cssText = 'background:none;border:1px solid ' + t.color + '40;border-radius:4px;cursor:pointer;padding:2px 8px;font-size:11px;color:' + t.color + ';display:flex;align-items:center;gap:4px;white-space:nowrap;';
      chip.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + t.color + '"></span>' + escapeHtml(t.name);
      chip.addEventListener('mousedown', (mev) => { mev.stopPropagation(); mev.preventDefault(); });
      chip.addEventListener('click', (cev) => {
        cev.stopPropagation(); cev.preventDefault();
        let feedbackUrl = '';
        let feedbackTitle = '';
        if (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
          const fTab = _browseTabs.find(tb => tb.id === _browseActiveTab);
          if (fTab) { feedbackUrl = fTab.url || ''; feedbackTitle = fTab.title || ''; }
        }
        apiPost('/api/annotation-feedback', { quote: capturedText, annType: t.key, rating: 'good', url: feedbackUrl, pageTitle: feedbackTitle }).catch(() => {});
        // Inject highlight on the page
        if (typeof injectSingleAnnotation === 'function' && typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
          const hlTab = _browseTabs.find(tb => tb.id === _browseActiveTab);
          if (hlTab) injectSingleAnnotation(hlTab, { type: t.key, quote: capturedText });
        }
        dropdown.remove();
        annotateBtn.innerHTML = icon('check', { size: 14, stroke: t.color });
        annotateBtn.disabled = true;
      });
      dropdown.appendChild(chip);
    }
    btnRow.style.position = 'relative';
    btnRow.appendChild(dropdown);
  });
  btnRow.appendChild(annotateBtn);

  // Clear button — positioned on far right
  const clearBtnIcon = document.createElement('button');
  clearBtnIcon.className = 'doc-selection-copy-btn';
  clearBtnIcon.title = 'Clear conversation';
  clearBtnIcon.style.marginLeft = 'auto';
  clearBtnIcon.innerHTML = icon('close', { size: 14 });
  clearBtnIcon.addEventListener('mousedown', (ev) => ev.stopPropagation());
  clearBtnIcon.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _saveChatMemory();
    _popupChatMessages = [];
    _chatMemoryRetrieved = false;
    _chatStreamStart = 0;
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    const cm = popup.querySelector('.doc-popup-chat-messages');
    if (cm) cm.innerHTML = '';
    const ca = popup.querySelector('.doc-popup-chat-area');
    if (ca) ca.classList.remove('visible');
    popup.classList.remove('has-chat');
    const statsSpan = popup.querySelector('.doc-chat-stats');
    if (statsSpan) statsSpan.textContent = '';
    _repositionSelectionPopup();
  });
  btnRow.appendChild(clearBtnIcon);

  popup.appendChild(btnRow);

  // Author / Wikipedia preview (async)
  if (_isAuthorEligible(capturedText)) {
    const authorDiv = document.createElement('div');
    authorDiv.className = 'doc-wiki-preview';
    authorDiv.style.display = 'none';
    popup.appendChild(authorDiv);
    _fetchAuthorPreview(capturedText, authorDiv);
  } else if (_isAetherEligible(capturedText)) {
    const wikiDiv = document.createElement('div');
    wikiDiv.className = 'doc-wiki-preview';
    wikiDiv.style.display = 'none';
    popup.appendChild(wikiDiv);
    _fetchWikipediaPreview(capturedText, wikiDiv);
  }

}

// ── Helper: build top actions bar (model label, clear, redo, copy, pin, sidebar, drag) ──
export function _panelBuildTopBar(popup) {
  const topBar = document.createElement('div');
  topBar.className = 'doc-popup-chat-actions aether-top-actions';
  topBar.style.cursor = 'grab';

  // Spacer (model label moved to button row)
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  topBar.appendChild(spacer);

  // Stats — inline in the top bar after model label
  const statsSpan = document.createElement('span');
  statsSpan.className = 'doc-chat-stats';
  topBar.insertBefore(statsSpan, spacer.nextSibling);

  // Redo button — resend last user message
  const redoBtn = document.createElement('button');
  redoBtn.className = 'aether-topbar-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.style.display = 'none';
  redoBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  redoBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // Find last user message
    let lastUserIdx = -1;
    for (let i = _popupChatMessages.length - 1; i >= 0; i--) {
      if (_popupChatMessages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    // Remove the last user message and everything after it
    const lastUserMsg = _popupChatMessages[lastUserIdx];
    _popupChatMessages = _popupChatMessages.slice(0, lastUserIdx);
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    // Re-insert user message and re-send
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) input.value = lastUserMsg._display || lastUserMsg.content;
    _sendPopupChatMessage(popup, popup._capturedText || '');
  });
  topBar.appendChild(redoBtn);
  popup._redoBtn = redoBtn;

  // Copy chat button — copy last AI response
  const copyChatBtn = document.createElement('button');
  copyChatBtn.className = 'aether-topbar-btn';
  copyChatBtn.style.display = 'none';
  copyChatBtn.textContent = 'Copy';
  copyChatBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  copyChatBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    // Find last assistant message
    let lastAi = '';
    for (let i = _popupChatMessages.length - 1; i >= 0; i--) {
      if (_popupChatMessages[i].role === 'assistant' && !_popupChatMessages[i]._thinking) {
        lastAi = _popupChatMessages[i].content; break;
      }
    }
    if (!lastAi) return;
    navigator.clipboard.writeText(lastAi).then(() => {
      copyChatBtn.textContent = 'Copied';
      setTimeout(() => { if (copyChatBtn.isConnected) copyChatBtn.textContent = 'Copy'; }, 1200);
    }).catch(() => {});
  });
  topBar.appendChild(copyChatBtn);
  popup._copyChatBtn = copyChatBtn;

  // "Open in tab" button — opens the panel conversation in a dedicated chat tab
  const openInTabBtn = document.createElement('button');
  openInTabBtn.className = 'aether-topbar-btn';
  openInTabBtn.style.display = 'none';
  openInTabBtn.textContent = 'Open in tab';
  openInTabBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openInTabBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (_panelThreadId && typeof openChatPage === 'function') {
      openChatPage(_panelThreadId);
      popup.remove();
      _aetherTrackMode = false;
      _aetherPinned = false;
    }
  });
  topBar.appendChild(openInTabBtn);
  popup._openInTabBtn = openInTabBtn;

  // Right-side icon group (aligns with mic + send below)
  const topRightGroup = document.createElement('span');
  topRightGroup.className = 'aether-topbar-right';

  topBar.appendChild(topRightGroup);

  // Drag to move
  topBar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) return;
    ev.stopPropagation();
    ev.preventDefault();
    _aetherDragging = true;
    _aetherDragPopup = popup;
    _aetherTrackMode = false;
    topBar.style.cursor = 'grabbing';
    const r = popup.getBoundingClientRect();
    _aetherDragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });

  popup.appendChild(topBar);
}

// ── Helper: build chat input area (textarea, model selector, send button, mic, dropdowns) ──
export function _panelBuildChatInput(popup, config) {
  const contextMenu = config.contextMenu || null;
  const capturedText = config.selectionText || '';
  const finalized = config.finalized !== false;
  if (!finalized) return;

  // Chat area (messages container)
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area';
  chatArea.style.borderTop = 'none';
  if (capturedText) {
    const chatContext = document.createElement('div');
    chatContext.className = 'doc-popup-chat-context';
    const contextTrunc = capturedText.length > 120 ? capturedText.slice(0, 120) + '…' : capturedText;
    chatContext.textContent = contextTrunc;
    chatArea.appendChild(chatContext);
  }
  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);
  popup.appendChild(chatArea);

  // Context box (appears above chat, like Cursor)
  if (capturedText) {
    const contextBox = document.createElement('div');
    contextBox.className = 'aether-context-box';

    const contextIcon = document.createElement('div');
    contextIcon.className = 'aether-context-icon';
    contextIcon.innerHTML = icon('chatContext', { size: 11 });

    const closeIcon = document.createElement('div');
    closeIcon.className = 'aether-context-close-icon';
    closeIcon.innerHTML = icon('close', { size: 11 });

    const contextContent = document.createElement('div');
    contextContent.className = 'aether-context-content';

    const contextLabel = document.createElement('span');
    contextLabel.className = 'aether-context-label';
    contextLabel.textContent = 'CONTEXT';

    const contextText = document.createElement('span');
    contextText.className = 'aether-context-text';
    contextText.textContent = ' ' + capturedText;

    contextContent.appendChild(contextLabel);
    contextContent.appendChild(contextText);

    contextBox.appendChild(contextIcon);
    contextBox.appendChild(closeIcon);
    contextBox.appendChild(contextContent);

    contextBox.addEventListener('mouseenter', () => {
      contextBox.classList.add('hover');
    });

    contextBox.addEventListener('mouseleave', () => {
      contextBox.classList.remove('hover');
    });

    contextBox.addEventListener('click', (ev) => {
      ev.stopPropagation();
      contextBox.remove();
      popup._capturedText = '';
    });

    popup.appendChild(contextBox);
  }

  // Screenshot / attachment strip (for screenshots/files, not text context)
  const attachStrip = document.createElement('div');
  attachStrip.className = 'doc-screenshot-attachments';
  popup.appendChild(attachStrip);

  // Ask input + send button
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  if (!capturedText) {
    askWrap.style.borderTop = 'none';
    askWrap.style.marginTop = '0';
    askWrap.style.paddingTop = '0';
  }
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask anything…';
  askInput.className = 'doc-ask-inline-input';

  const sendBtn = document.createElement('button');
  sendBtn.className = 'aether-input-btn doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; _renderPopupChat(popup, true); return; }
    _sendPopupChatMessage(popup, capturedText);
  });
  askInput.addEventListener('keydown', (ev) => {
    // Let Cmd+I bubble up to document handler for toggle
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'i') return;
    ev.stopPropagation();
    const val = askInput.value;
    const isCmd = val.startsWith('/');
    const dropdown = popup.querySelector('.aether-cmd-dropdown');
    const modelDropdown = popup.querySelector('.aether-model-dropdown');

    // Arrow keys navigate model dropdown
    if (modelDropdown && _aetherModelList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherModelIdx = Math.min(_aetherModelIdx + 1, _aetherModelList.length - 1);
      else _aetherModelIdx = Math.max(_aetherModelIdx - 1, 0);
      _aetherRenderModelDropdown(popup);
      const sel = modelDropdown.querySelector('.aether-note-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (modelDropdown && _aetherModelList.length && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectModel(popup);
      return;
    }
    if (modelDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideModelDropdown(popup);
      return;
    }

    // Arrow keys navigate tab dropdown
    const tabDropdown = popup.querySelector('.aether-tab-dropdown');
    if (tabDropdown && _aetherTabList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherTabIdx = Math.min(_aetherTabIdx + 1, _aetherTabList.length - 1);
      else _aetherTabIdx = Math.max(_aetherTabIdx - 1, 0);
      const items = tabDropdown.querySelectorAll('.aether-tab-item');
      items.forEach((el, i) => el.classList.toggle('selected', i === _aetherTabIdx));
      const sel = items[_aetherTabIdx];
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (tabDropdown && _aetherTabList.length && ev.key === 'Enter') {
      ev.preventDefault();
      if (_aetherTabSwitchMode) _aetherSwitchToTab(popup);
      else _aetherSelectTab(popup);
      return;
    }
    if (tabDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideTabDropdown(popup);
      return;
    }

    // Arrow keys navigate history dropdown
    const histDropdown = popup.querySelector('.aether-history-dropdown');
    if (histDropdown && _aetherHistoryList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') _aetherHistoryIdx = Math.min(_aetherHistoryIdx + 1, _aetherHistoryList.length - 1);
      else _aetherHistoryIdx = Math.max(_aetherHistoryIdx - 1, -1);
      const items = histDropdown.querySelectorAll('.aether-note-item');
      items.forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === _aetherHistoryIdx));
      const sel = histDropdown.querySelector(`.aether-note-item[data-idx="${_aetherHistoryIdx}"]`);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (histDropdown && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectHistory(popup);
      return;
    }
    if (histDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideHistoryDropdown(popup);
      return;
    }

    // Arrow keys navigate command autocomplete
    if (isCmd && dropdown && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      const items = dropdown.querySelectorAll('.aether-cmd-item');
      if (ev.key === 'ArrowDown') _aetherCmdIdx = Math.min(_aetherCmdIdx + 1, items.length - 1);
      else _aetherCmdIdx = Math.max(_aetherCmdIdx - 1, 0);
      _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      const dd = popup.querySelector('.aether-cmd-dropdown');
      const sel = dd && dd.querySelector('.aether-cmd-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (isCmd && dropdown && ev.key === 'Tab') {
      ev.preventDefault();
      const matches = _aetherFilterCommands(val.slice(1).trim());
      if (matches[_aetherCmdIdx]) askInput.value = '/' + matches[_aetherCmdIdx].name;
      _aetherRenderCmdDropdown(popup, matches[_aetherCmdIdx]?.name || '');
      return;
    }

    if (ev.key === 'Enter' && ev.shiftKey) {
      ev.preventDefault();
      _aetherHideCmdDropdown(popup);
      _doAetherWebSearch(popup);
    } else if (ev.key === 'Enter') {
      // Check if user has text selected in the panel (not in the input)
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';
      if (selectedText && !selection.containsNode(askInput, true)) {
        ev.preventDefault();
        // Add selected text to input
        const currentVal = askInput.value.trim();
        askInput.value = currentVal ? currentVal + ' ' + selectedText : selectedText;
        askInput.focus();
        // Clear the selection
        if (selection) selection.removeAllRanges();
        return;
      }

      ev.preventDefault();
      if (isCmd && dropdown) {
        const matches = _aetherFilterCommands(val.slice(1).trim());
        const cmd = matches[_aetherCmdIdx] || matches[0];
        if (cmd) {
          if (cmd.hasArgs) {
            askInput.value = '/' + cmd.name + ' ';
            _aetherHideCmdDropdown(popup);
          } else if (cmd._special) {
            _aetherHideCmdDropdown(popup);
            if (cmd.name === 'capture') _doAetherCapture(popup);
            else if (cmd.name === 'model') _doAetherModel(popup);
            else if (cmd.name === 'links') _doAetherLinks(popup);
            else if (cmd.name === 'tab') _doAetherTab(popup);
            else if (cmd.name === 'tabs') _doAetherTabs(popup);
            else if (cmd.name === 'notes') _doAetherNotesBrowse(popup);
            else if (cmd.name === 'history') _doAetherHistory(popup);
            else if (cmd.name === 'help') _doAetherHelp(popup);
          } else {
            _aetherHideCmdDropdown(popup);
            cmd.fn();
            _aetherTrackMode = false;
            popup.remove();
          }
          return;
        }
      }
      if (isCmd && val.trim().length > 1) {
        _aetherExecCommand(popup, val);
      } else if (!isCmd) {
        _aetherHideCmdDropdown(popup);
        _sendPopupChatMessage(popup, capturedText);
      }
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (modelDropdown) { _aetherHideModelDropdown(popup); return; }
      if (dropdown) { _aetherHideCmdDropdown(popup); return; }
      _aetherTrackMode = false;
      _aetherPinned = false;
      _maybeDismissToIsland(popup);
      if (!_aetherBackgroundStreaming && _popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _pendingScreenshots = [];
      _pendingTabContexts = [];
      _pendingFileContexts = [];
      _savePopupChatToHighlight(popup);
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
    // Shift key handler removed - no longer dismisses panel
  });
  askInput.addEventListener('input', () => {
    const val = askInput.value;
    if (val.startsWith('/')) {
      const histMatch = val.match(/^\/history(\s+(.*))?$/i);
      if (histMatch && histMatch[1] !== undefined) {
        _aetherHideCmdDropdown(popup);
        _aetherHistoryIdx = -1;
        _aetherRenderHistoryDropdown(popup, (histMatch[2] || '').trim());
      } else {
        _aetherHideHistoryDropdown(popup);
        _aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      }
    } else {
      _aetherHideCmdDropdown(popup);
      _aetherHideHistoryDropdown(popup);
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
  // Mic button for voice input (MediaRecorder + Parakeet TDT via IPC)
  const micBtn = document.createElement('button');
  micBtn.className = 'aether-input-btn doc-ask-mic-btn';
  micBtn.innerHTML = icon('microphone', { size: 14 });
  micBtn.title = 'Voice input';
  let micRecorder = null;
  micBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  micBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (micRecorder) {
      micRecorder.stop();
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      micRecorder = recorder;
      micBtn.classList.add('doc-ask-mic-active');
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        micRecorder = null;
        micBtn.classList.remove('doc-ask-mic-active');
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const prevPlaceholder = askInput.placeholder;
        askInput.placeholder = 'Transcribing…';
        islandUpdate('ai-transcribe', { type: 'ai', label: 'parakeet', detail: 'Transcribing · parakeet' });
        try {
          // Decode webm/opus → PCM float32 via AudioContext
          const arrayBuf = await blob.arrayBuffer();
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          const pcmFloat32 = decoded.getChannelData(0);
          audioCtx.close();
          // Convert float32 bytes → base64 for IPC (chunked to avoid call stack overflow)
          const bytes = new Uint8Array(pcmFloat32.buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          }
          const pcmBase64 = btoa(binary);
          const data = await electronAPI.captionsTranscribe(pcmBase64, 16000);
          islandRemove('ai-transcribe');
          askInput.placeholder = prevPlaceholder;
          if (data && data.text) {
            askInput.value = askInput.value + (askInput.value ? ' ' : '') + data.text;
            askInput.focus();
            if (Settings.get('voiceAutoSend') === 'on') {
              setTimeout(() => _sendPopupChatMessage(popup, capturedText), 50);
            }
          }
        } catch {
          islandRemove('ai-transcribe');
          askInput.placeholder = prevPlaceholder;
        }
      };
      recorder.start();
    }).catch(() => {});
  });

  askWrap.appendChild(askInput);
  popup.appendChild(askWrap);

  // Second row: model label + buttons
  const buttonRow = document.createElement('div');
  buttonRow.className = 'aether-button-row';

  // Agent chip — clickable to switch agents
  const agentChip = document.createElement('span');
  agentChip.className = 'aether-agent-chip';
  agentChip.title = 'Switch agent';
  const agentNames = { 'research-assistant': 'Research Assistant', 'chat': 'Chat', 'browser': 'Browser' };
  const currentAgentId = Settings.get('chatAgent') || 'research-assistant';
  const agentLabel = document.createElement('span');
  agentLabel.className = 'aether-agent-chip-label';
  agentLabel.textContent = agentNames[currentAgentId] || currentAgentId;
  agentChip.appendChild(agentLabel);
  agentChip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _doAetherAgent(popup);
  });
  buttonRow.appendChild(agentChip);

  // Model label (secondary info beside agent chip)
  const modelLabel = document.createElement('span');
  modelLabel.className = 'aether-model-label';
  const cm = Settings.get('chatModel') || 'qwen2.5:3b';
  modelLabel.textContent = cm;
  modelLabel.title = 'Current model';
  buttonRow.appendChild(modelLabel);

  // Spacer to push buttons right
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  buttonRow.appendChild(spacer);

  // Mic and Send buttons
  buttonRow.appendChild(micBtn);
  buttonRow.appendChild(sendBtn);

  popup.appendChild(buttonRow);

}

// ── Helper: install Cmd+C copy key handler ──
export function _panelBuildCopyKeyHandler(popup) {
  function _onCopyKey(e) {
    if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
    if (!popup.isConnected) { document.removeEventListener('keydown', _onCopyKey, true); return; }
    // Only act when the input is empty (user hasn't typed anything)
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input && input.value) return;
    // Copy the captured selection text if available
    const text = popup._capturedText;
    if (text) {
      e.preventDefault();
      navigator.clipboard.writeText(text).catch(() => {});
    }
    _flashCopyBtn(popup);
  }
  document.addEventListener('keydown', _onCopyKey, true);
}

// ── Helper: position panel and auto-focus input ──
export function _panelPositionAndFocus(popup, config) {
  const anchor = config.anchor || {};
  const finalized = config.finalized !== false;
  const initialValue = config.initialValue || '';
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isTabAnchor) {
    // Tab context: position below the tab element
    const tabEl = anchor.tab;
    const tabRect = tabEl.getBoundingClientRect();
    popup.classList.add('tab-context-panel');
    popup.style.maxWidth = '';
    popup._tabContextAnchor = { left: tabRect.left, top: tabRect.bottom, tabWidth: tabRect.width };
    let left = tabRect.left;
    const rect = popup.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.left = left + 'px';
    popup.style.top = tabRect.bottom + 'px';
    popup.style.visibility = '';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = tabRect.bottom + rect.height;
    // Keep panel open while mouse is inside (matches hover tooltip behavior)
    popup.addEventListener('mouseenter', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') clearTimeout(_tabHoverDismissTimeout); });
    popup.addEventListener('mouseleave', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') { clearTimeout(_tabHoverDismissTimeout); _tabHoverDismissTimeout = setTimeout(() => { if (popup.isConnected) popup.remove(); }, 150); } });
  } else if (isSelectionAnchor) {
    // Selection: above or below selection rect
    const selRect = anchor.selectionRect;
    popup._anchorTop = selRect.top;
    popup._anchorBottom = selRect.bottom;
    popup._anchorLeft = selRect.left;
    const popupRect = popup.getBoundingClientRect();
    let top = selRect.top - popupRect.height - 8;
    const fitsAbove = top >= 4;
    if (!fitsAbove) top = selRect.bottom + 8;
    popup._aboveSelection = fitsAbove;
    let left = selRect.left;
    if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
    if (left < 4) left = 4;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.visibility = '';
  } else {
    // Cursor anchor: position so the input caret is at the click point
    const x = anchor.x || 0;
    const y = anchor.y || 0;
    popup._aetherAnchorX = x;
    popup._aetherAnchorY = y;
    const rect = popup.getBoundingClientRect();
    const askInput = popup.querySelector('.doc-ask-inline-input');
    let inputOffsetX = 0, inputOffsetY = 0;
    if (askInput) {
      const inputRect = askInput.getBoundingClientRect();
      // Offset from panel left to input's text start (left edge + padding)
      const inputPadLeft = parseFloat(getComputedStyle(askInput).paddingLeft) || 0;
      inputOffsetX = (inputRect.left - rect.left) + inputPadLeft;
      // Offset from panel top to input's vertical center
      inputOffsetY = (inputRect.top - rect.top) + inputRect.height / 2;
    }
    const _initLeft = false;
    // Desired panel position: input caret at (x, y)
    let left = x - inputOffsetX;
    let top = y - inputOffsetY;
    // Clamp to viewport
    const bounds = _popupSafeBounds();
    if (left + rect.width > bounds.right) left = bounds.right - rect.width;
    if (left < bounds.left) left = bounds.left;
    if (top + rect.height > bounds.bottom) top = bounds.bottom - rect.height;
    if (top < bounds.top) top = bounds.top;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.visibility = '';
  }

  // Auto-focus input
  if (finalized) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      if (isSelectionAnchor) {
        setTimeout(() => askInput.focus(), 10);
      } else {
        askInput.focus();
      }
    }
    _updateContextBar(popup);
  }

  // Pre-fill input and trigger command dropdown if initialValue provided
  if (finalized && initialValue) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      askInput.value = initialValue;
      if (initialValue.startsWith('/')) {
        _aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, initialValue.slice(1).trim());
      }
      // Reposition after dropdown renders
      if (isCursorAnchor) {
        const ax = anchor.x || 0, ay = anchor.y || 0;
        requestAnimationFrame(() => {
          const r2 = popup.getBoundingClientRect();
          let t2 = ay - r2.height;
          if (t2 < 0) t2 = 0;
          popup.style.top = t2 + 'px';
        });
      }
    }
  }
}

export function _showPanel(config) {
  if (!_authReady) return;
  config = config || {};
  const anchor = config.anchor || {};
  const contextMenu = config.contextMenu || null;
  const selectionText = config.selectionText || '';
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false; // default true

  // Save the currently focused element so Escape can restore it
  const ae = document.activeElement;
  if (ae && ae !== document.body && !ae.closest('#doc-chat-ask-float')) {
    _aetherPrevFocus = { el: ae, selStart: ae.selectionStart, selEnd: ae.selectionEnd };
  }

  // Remove any existing active panel
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) {
    _aetherBackgroundStreaming = false; islandRemove('aether');
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    if (!selectionText) _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Remove any open note editor or help panel
  const existingEditor = document.getElementById('aether-note-editor');
  if (existingEditor) existingEditor.remove();
  const existingHelp = document.getElementById('aether-help-panel');
  if (existingHelp) existingHelp.remove();

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  const _origRemove = popup.remove.bind(popup);
  popup.remove = function() { _origRemove(); };

  // Determine anchor mode
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isCursorAnchor) popup._isAetherPanel = true;
  if (!finalized) popup.style.visibility = 'hidden';

  const hasContext = contextMenu && (contextMenu.linkUrl || contextMenu.imgUrl || contextMenu.items);
  _aetherPinned = false;
  if (isCursorAnchor) {
    _aetherTrackMode = config.trackCursor !== undefined ? config.trackCursor : false;
  } else {
    _aetherTrackMode = false;
  }

  const capturedText = selectionText;
  popup._capturedText = capturedText || '';

  // Reset shared state for new panel (unless preview)
  if (finalized) {
    _saveChatMemory();
    _popupChatMessages = [];
    _chatMemoryRetrieved = false;
    _pendingScreenshots = [];
    _pendingTabContexts = [];
    _pendingFileContexts = [];
    _aetherDragging = false;
    _aetherDragPopup = null;
    _aetherBackgroundStreaming = false; islandRemove('aether');
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    // Reset engine session for new panel
    _panelSession = null;
    _panelThreadId = null;
  }

  // ── Build panel sections via helpers ──
  _panelBuildContextItems(popup, config);
  _panelBuildLinkContextMenu(popup, config);
  _panelBuildEditableActions(popup, config, capturedText, hasContext);
  _panelBuildSelectionUI(popup, config);
  if (finalized) _panelBuildTopBar(popup);
  _panelBuildChatInput(popup, config);

  // Show "Save chat" button if in PDF text layer
  if (popup._inTextLayer && popup._saveChatBtn) {
    popup._saveChatBtn.style.display = '';
  }

  popup.addEventListener('mousedown', (ev) => {
    // Don't stop propagation — let clicks dismiss the panel
  });

  document.body.appendChild(popup);

  // Hide cursor while panel is open
  if (isCursorAnchor && finalized && _aetherTrackMode) {
    _aetherHideCursorOverlay();
  }

  // ── Cmd+C handler + positioning ──
  _panelBuildCopyKeyHandler(popup);
  _panelPositionAndFocus(popup, config);

  return popup;
}


export function openPaper(index, e) {
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  if (_isNewTabClick(e)) { _openInNewTab(paper.link); return; }
  markPostAsRead(paper.link);
  _setBrowseReturnView(Settings.get('_lastActiveView') || 'feed');
  openBrowseWithPaper(paper.link, paper);
}

export function openPaperByUrl(url, e) {
  if (_isNewTabClick(e)) { _openInNewTab(url); return; }
  _setBrowseReturnView(Settings.get('_lastActiveView') || 'feed');
  const paper = (typeof searchResultsCache !== 'undefined' && searchResultsCache || []).find(r => r && r.link === url)
    || (typeof getSavedPosts === 'function' && getSavedPosts()[url]?.paper)
    || (typeof allPapers !== 'undefined' && allPapers.find(p => p.link === url))
    || { title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' };
  openBrowseWithPaper(url, paper);
}

// ── Window assignments for global access ──
window._positionAtCursor = _positionAtCursor;
window._repositionSelectionPopup = _repositionSelectionPopup;
window._selPopupDragging = _selPopupDragging;
window._handleContextMenuChat = _handleContextMenuChat;
window._iframeRectToParent = _iframeRectToParent;
window._injectIframeChatHandler = _injectIframeChatHandler;
window._screenshotDragStart = _screenshotDragStart;
window._screenshotSelection = _screenshotSelection;
window._screenshotDim = _screenshotDim;
window._screenshotCapturing = _screenshotCapturing;
window._focusCrossFrame = _focusCrossFrame;
window._pasteIntoElement = _pasteIntoElement;
window._flashCopyBtn = _flashCopyBtn;
window._injectProfileItems = _injectProfileItems;
window._panelBuildContextItems = _panelBuildContextItems;
window._panelBuildLinkContextMenu = _panelBuildLinkContextMenu;
window._panelBuildEditableActions = _panelBuildEditableActions;
window._panelBuildSelectionUI = _panelBuildSelectionUI;
window._panelBuildTopBar = _panelBuildTopBar;
window._panelBuildChatInput = _panelBuildChatInput;
window._panelBuildCopyKeyHandler = _panelBuildCopyKeyHandler;
window._panelPositionAndFocus = _panelPositionAndFocus;
window._showPanel = _showPanel;
window.openPaper = openPaper;
window.openPaperByUrl = openPaperByUrl;
