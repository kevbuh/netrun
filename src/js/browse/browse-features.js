// browse-features.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Find in page ──

let _browseFindBarActive = false;
let _browseFindRequestId = 0;

function _browseToggleFindBar() {
  if (_browseFindBarActive) {
    // If already open, focus and select the input
    const input = document.getElementById('browse-find-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
  _browseFindBarActive = true;

  const browseView = document.getElementById('browse-view');
  if (!browseView) return;

  // Create the find bar
  const bar = document.createElement('div');
  bar.id = 'browse-find-bar';
  bar.className = 'browse-find-bar';
  bar.innerHTML =
    `<input type="text" id="browse-find-input" class="browse-find-input" placeholder="Find…" autocomplete="off" spellcheck="false">` +
    `<span id="browse-find-count" class="browse-find-count"></span>` +
    `<button class="browse-find-btn" id="browse-find-prev" title="Previous">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-next" title="Next">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-close" title="Close">&times;</button>`;

  // Insert into browse-content so it floats over the page
  const content = document.getElementById('browse-content');
  if (content) {
    content.appendChild(bar);
  } else {
    browseView.appendChild(bar);
  }

  const input = document.getElementById('browse-find-input');
  const countEl = document.getElementById('browse-find-count');

  const doFind = (forward) => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward, findNext: true });
    } else {
      // For same-origin iframes
      try { el.contentWindow.find(q, false, !forward); } catch (e) {}
    }
  };

  const onInput = () => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward: true, findNext: false });
    } else {
      try { el.contentWindow.find(q); } catch (e) {}
    }
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); _browseCloseFindBar(); }
    // Cmd+G / Cmd+Shift+G for next/prev
    if ((e.metaKey || e.ctrlKey) && e.key === 'g') { e.preventDefault(); doFind(!e.shiftKey); }
  });

  document.getElementById('browse-find-next').addEventListener('click', () => doFind(true));
  document.getElementById('browse-find-prev').addEventListener('click', () => doFind(false));
  document.getElementById('browse-find-close').addEventListener('click', _browseCloseFindBar);

  // Listen for found-in-page results (Electron webview)
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el) {
      const handler = (e) => {
        if (e.result && e.result.requestId === _browseFindRequestId) {
          const ct = document.getElementById('browse-find-count');
          if (ct) ct.textContent = e.result.matches > 0
            ? `${e.result.activeMatchOrdinal}/${e.result.matches}`
            : 'No matches';
        }
      };
      el._findHandler = handler;
      el.addEventListener('found-in-page', handler);
    }
  }

  input.focus();
}

function _browseStopFind() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.stopFindInPage) {
    el.stopFindInPage('clearSelection');
  }
}

function _browseCloseFindBar() {
  _browseFindBarActive = false;
  _browseStopFind();
  // Remove found-in-page listener
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el && el._findHandler) {
      el.removeEventListener('found-in-page', el._findHandler);
      delete el._findHandler;
    }
  }
  const bar = document.getElementById('browse-find-bar');
  if (bar) bar.remove();
}

// ── Pinch-to-magnify (Apple-like) — browse iframe only ────────────
// Trackpad pinch over the browse view → temporary magnification of
// the active iframe, centered on cursor. Release → snaps back to 1×.

let _magnifyZoom = 1;
let _magnifyX = 0;
let _magnifyY = 0;
let _magnifyGestureStart = 1;
let _magnifySnapTimer = null;
let _magnifyEl = null;

document.addEventListener('mousemove', function(e) {
  _magnifyX = e.clientX;
  _magnifyY = e.clientY;
}, { passive: true });

function _magnifyTarget() {
  var bv = document.getElementById('browse-view');
  if (!bv || bv.style.display === 'none') return null;
  return _browseActiveEl();
}

function _magnifyApply() {
  var el = _magnifyEl;
  if (!el) return;
  var container = document.getElementById('browse-content');
  if (!container) return;

  if (_magnifyZoom <= 1.005) {
    el.style.transform = '';
    el.style.transformOrigin = '';
    container.style.overflow = '';
    return;
  }
  var rect = container.getBoundingClientRect();
  var fx = _magnifyX - rect.left;
  var fy = _magnifyY - rect.top;
  el.style.transformOrigin = fx + 'px ' + fy + 'px';
  el.style.transform = 'scale(' + _magnifyZoom + ')';
  container.style.overflow = 'hidden';
}

function _magnifySnapBack() {
  clearTimeout(_magnifySnapTimer);
  _magnifyZoom = 1;
  var el = _magnifyEl;
  if (el) {
    Motion.animate(el, {
      spring: 'smooth', duration: 350,
      to: { scale: 1 },
      onFinish: function() {
        el.style.transformOrigin = '';
      }
    });
    var container = document.getElementById('browse-content');
    if (container) container.style.overflow = '';
  }
  _magnifyEl = null;
}

// Chrome/Firefox: trackpad pinch fires wheel with ctrlKey
document.addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  var target = _magnifyTarget();
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  _magnifyEl = target;
  clearTimeout(_magnifySnapTimer);
  target.style.transition = '';
  var delta = -e.deltaY * 0.01;
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyZoom + delta));
  _magnifyApply();
  // No gestureend in Chrome — snap back after inactivity
  _magnifySnapTimer = setTimeout(_magnifySnapBack, 600);
}, { passive: false, capture: true });

// Safari: native gesture events
document.addEventListener('gesturestart', function(e) {
  var target = _magnifyTarget();
  if (!target) return;
  e.preventDefault();
  _magnifyEl = target;
  _magnifyGestureStart = _magnifyZoom || 1;
  clearTimeout(_magnifySnapTimer);
  target.style.transition = '';
}, { passive: false, capture: true });

document.addEventListener('gesturechange', function(e) {
  if (!_magnifyEl) return;
  e.preventDefault();
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyGestureStart * e.scale));
  _magnifyApply();
}, { passive: false, capture: true });

document.addEventListener('gestureend', function(e) {
  if (!_magnifyEl) return;
  e.preventDefault();
  _magnifySnapTimer = setTimeout(_magnifySnapBack, 200);
}, { passive: false, capture: true });

// Escape snaps back from magnify
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _magnifyZoom > 1.01) {
    e.preventDefault();
    _magnifySnapBack();
  }
}, { capture: true });

// Cmd+Plus / Cmd+Minus / Cmd+0 / Cmd+F / Cmd+T / Cmd+W for browse view
document.addEventListener('keydown', function(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); browseZoom(1); }
  else if (e.key === '-') { e.preventDefault(); browseZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); browseZoom(0); }
  else if (e.key === 'f') {
    e.preventDefault();
    const ntp = browseView.querySelector('.browse-ntp');
    if (ntp && ntp.style.display !== 'none') {
      const inp = ntp.querySelector('#search-query');
      if (inp) { inp.focus(); inp.select(); }
    } else { _browseToggleFindBar(); }
  }
});

// Cmd+W / Cmd+T work when the parent document has focus (clicking tab bar, URL bar,
// sidebar, etc.). When a cross-origin iframe has focus, browser security prevents
// intercepting these shortcuts — this is the same limitation every web app faces.
// No-op stubs kept so callers don't break.
let _browseKeyHandler = null;

let _browseTabBarFocused = false;

function _browseInstallKeyGuard() {
  if (_browseKeyHandler) return;
  _browseKeyHandler = (e) => {
    // Only handle if browse view is visible and not typing in an input
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Don't handle if tab overview is open (it has its own handler)
    if (_browseTabOverviewVisible) return;
    // Option+Arrow switches tabs globally (no tab bar focus needed)
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _switchTabLeft(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); _switchTabRight(); return; }
    }
    // Only handle arrow keys if tab bar is focused
    if (!_browseTabBarFocused) return;

    const win = _getCurrentWindow();
    if (!win) return;

    // Arrow keys for navigation when tab bar is focused
    const islandMode = _browseTabLayout === 'island';
    if (islandMode) {
      // Island layout: Up/Down switch tabs, no window switching via arrows
      if (e.key === 'ArrowUp' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabLeft();
      } else if (e.key === 'ArrowDown' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabRight();
      }
    } else {
      if (e.key === 'ArrowUp' && _browseWindows.length > 1) {
        e.preventDefault();
        switchWindowUp();
      } else if (e.key === 'ArrowDown' && _browseWindows.length > 1) {
        e.preventDefault();
        switchWindowDown();
      } else if (e.key === 'ArrowLeft' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabLeft();
      } else if (e.key === 'ArrowRight' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabRight();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _blurBrowseTabBar();
    }
  };
  document.addEventListener('keydown', _browseKeyHandler);

  // Click on content area blurs tab bar
  document.addEventListener('mousedown', (e) => {
    if (!_browseTabBarFocused) return;
    const tabBar = _getActiveTabBar();
    const switcher = e.target.closest('.browse-window-switcher');
    if (tabBar && !tabBar.contains(e.target) && !switcher) {
      _blurBrowseTabBar();
    }
  });
}

function _focusBrowseTabBar() {
  _browseTabBarFocused = true;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.add('tab-bar-focused');
}

function _blurBrowseTabBar() {
  _browseTabBarFocused = false;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.remove('tab-bar-focused');
}

function _switchTabLeft() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx > 0) {
    _animateTabSwitch('left', () => {
      browseSelectTab(win.tabs[idx - 1].id);
    });
  }
}

function _switchTabRight() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx < win.tabs.length - 1) {
    _animateTabSwitch('right', () => {
      browseSelectTab(win.tabs[idx + 1].id);
    });
  }
}

function _animateTabSwitch(direction, callback) {
  var content = document.getElementById('browse-content');
  if (!content) { callback(); return; }
  var dist = direction === 'left' ? 30 : -30;
  Motion.swap(content, 'x', callback, { distance: dist, outOpacity: 0.5 });
}

function _browseRemoveKeyGuard() {
  if (_browseKeyHandler) {
    document.removeEventListener('keydown', _browseKeyHandler);
    _browseKeyHandler = null;
  }
}

// Transparent overlay to capture pinch gestures over iframes
function _browseInstallPinchOverlay() {
  const container = document.getElementById('browse-content');
  if (!container || container.querySelector('.browse-pinch-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'browse-pinch-overlay';
  // Default pointer-events:none so clicks pass through to webview natively.
  // Only activate (pointer-events:auto) when zoomed in for pan scrolling.
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;';
  container.appendChild(overlay);

  function _pinchOverlaySync() {
    overlay.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
  }

  // Chrome: pinch fires wheel with ctrlKey
  overlay.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + delta));
      const rect = container.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      _browseApplyZoom(fx, fy);
      _pinchOverlaySync();
    } else if (_browseZoomLevel > 1) {
      // When zoomed in, two-finger scroll pans the magnified view
      e.preventDefault();
      _browseZoomPanX += e.deltaX || 0;
      _browseZoomPanY += e.deltaY || 0;
      const maxPanX = container.clientWidth * (_browseZoomLevel - 1);
      const maxPanY = container.clientHeight * (_browseZoomLevel - 1);
      _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
      _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));
      _browseApplyZoom();
    }
  }, { passive: false });

  // Safari: gesturestart/gesturechange/gestureend for trackpad pinch
  let overlayGestureStartZoom = 1;
  overlay.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    overlayGestureStartZoom = _browseZoomLevel;
  }, { passive: false });
  overlay.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    _browseZoomLevel = Math.min(5.0, Math.max(1.0, overlayGestureStartZoom * e.scale));
    const rect = container.getBoundingClientRect();
    const fx = rect.width / 2;
    const fy = rect.height / 2;
    _browseApplyZoom(fx, fy);
    _pinchOverlaySync();
  }, { passive: false });
  overlay.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });

  // When zoomed in, mousedown on overlay should pass through for clicks then restore
  overlay.addEventListener('mousedown', function() {
    overlay.style.pointerEvents = 'none';
    function _restore() {
      document.removeEventListener('mouseup', _restore);
      setTimeout(function() { _pinchOverlaySync(); }, 50);
    }
    document.addEventListener('mouseup', _restore);
  });

  // Also intercept ctrl+wheel on webview frames directly for initial zoom-in
  container.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + delta));
    const rect = container.getBoundingClientRect();
    _browseApplyZoom(e.clientX - rect.left, e.clientY - rect.top);
    _pinchOverlaySync();
  }, { passive: false, capture: true });
}

function browseSaveToReadingList() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  const wasAdding = !getSavedPosts()[tab.url];
  const paper = { title: tab.title, link: tab.url, source: 'browse', description: '', authors: '', date: '' };
  const saved = getSavedPosts();
  if (saved[tab.url]) {
    delete saved[tab.url];
  } else {
    saved[tab.url] = { paper, savedAt: Date.now(), read: false };
    if (typeof petReact === 'function') petReact('happy');
  }
  savePosts(saved);
  updateSavedBadge();
  _browseUpdateSaveBtn();
  if (wasAdding) {
    const btn = document.getElementById('browse-save-btn');
    if (btn && typeof _showBookmarkFly === 'function') {
      const r = btn.getBoundingClientRect();
      _showBookmarkFly({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
  }
}

function browseShare() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  if (navigator.share) {
    navigator.share({ title: tab.title, url: tab.url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(tab.url).then(() => {
      const btn = document.querySelector('#browse-bar button[onclick="browseShare()"]');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
        btn.classList.add('text-primary');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('text-primary'); }, 1500);
      }
    });
  }
}

function _browseUpdateSaveBtn() {
  const btn = document.getElementById('browse-save-btn');
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const saved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  if (btn) {
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', saved ? 'var(--accent)' : 'none');
      svg.setAttribute('stroke', saved ? 'var(--accent)' : 'currentColor');
    }
  }
  _islandSyncBookmark();
}

function _islandSyncBookmark() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen && tab && !tab.blank && tab.url && isPostSaved(tab.url)) {
    var title = (tab.title || '').length > 40 ? tab.title.slice(0, 38) + '\u2026' : (tab.title || 'Saved');
    islandUpdate('bookmark', { type: 'bookmark', label: 'Saved', detail: title, action: function() { browseSaveToReadingList(); } });
  } else {
    islandRemove('bookmark');
  }
}
