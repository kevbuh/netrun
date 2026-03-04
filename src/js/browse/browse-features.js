// browse-features.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import Settings from '/js/core/core-settings.js';
import { isEditable } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _browseApplyZoom, browseBack, browseForward, browseZoom } from '/js/toolbar/toolbar-nav.js';
function _browseActiveEl() { const tabs = typeof _browseTabs !== 'undefined' ? _browseTabs : []; const tab = tabs.find(function(t) { return t.id === (typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : -1); }); return tab ? tab.el : null; }
let _browseZoomLevel = window._browseZoomLevel ?? 1.0;
let _browseZoomPanX = window._browseZoomPanX ?? 0;
let _browseZoomPanY = window._browseZoomPanY ?? 0;
import { _getActiveTabBar } from '/js/toolbar/toolbar-tabs.js';
import { _showBookmarkFly, getSavedPosts, isPostSaved, savePosts, updateSavedBadge } from '/js/feed.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
import { petReact } from '/js/pixel-pet.js';
import { switchWindowDown, switchWindowUp } from '/js/browse/browse-windows.js';

// ── Two-finger swipe navigation ──
// Injected script in the webview (browse-downloads.js) accumulates horizontal
// deltaX and sends only __AETHER_SWIPE_COMMIT__ when threshold is crossed.
// This file shows a single clean animation on commit — no jittery progress updates.

export let _swipeIndicator = null;
export let _swipeChevronPill = null;
export let _swipeBusy = false;

export function _swipeCanGo(direction) {
  try {
    const el = typeof _browseActiveEl === 'function' ? _browseActiveEl() : null;
    if (window._browseIsElectron && el) {
      if (direction === 'back' && el.canGoBack) return el.canGoBack();
      if (direction === 'forward' && el.canGoForward) return el.canGoForward();
    }
    const tab = _browseTabs && _browseTabs.find(t => t.id === _browseActiveTab);
    if (!tab) return false;
    if (direction === 'back') return !!(tab.backStack && tab.backStack.length);
    return !!(tab.forwardStack && tab.forwardStack.length);
  } catch { return false; }
}

export function _swipeEnsureIndicator() {
  if (_swipeIndicator) return;
  const pillView = new window.View('div')
    .cssText('width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      'background:var(--nr-accent);border:1px solid var(--nr-accent-hover);' +
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'box-shadow:0 2px 8px var(--nr-shadow-card);' +
      'transform:scale(0.6);transition:transform 0.2s ease-out;')
    .add(window.RawHTML('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--nr-text-inverse)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 3 5 8 10 13"/></svg>'));
  const elView = new window.View('div')
    .cssText('position:absolute;top:0;width:40px;height:100%;z-index:99;pointer-events:none;' +
      'display:flex;align-items:center;justify-content:center;opacity:0;' +
      'transition:opacity 0.2s ease-out;')
    .add(pillView);
  const container = document.getElementById('browse-content');
  if (container) AetherUI.append(elView, container);
  _swipeIndicator = elView.el;
  _swipeChevronPill = pillView.el;
}

export function _swipeCommit(direction) {
  if (_swipeBusy) return;
  if (!_swipeCanGo(direction)) return;
  _swipeBusy = true;
  _swipeEnsureIndicator();

  const isBack = direction === 'back';
  _swipeIndicator.style.left = isBack ? '0' : '';
  _swipeIndicator.style.right = isBack ? '' : '0';
  _swipeChevronPill.querySelector('svg').style.transform = isBack ? '' : 'rotate(180deg)';

  // Snap to visible instantly, then animate scale up
  _swipeIndicator.style.transition = 'none';
  _swipeChevronPill.style.transition = 'none';
  _swipeIndicator.style.opacity = '1';
  _swipeChevronPill.style.transform = 'scale(0.6)';

  // Force reflow then animate
  void _swipeIndicator.offsetWidth;
  _swipeChevronPill.style.transition = 'transform 0.15s ease-out';
  _swipeChevronPill.style.transform = 'scale(1)';

  // Navigate
  setTimeout(() => {
    if (isBack) browseBack();
    else browseForward();
  }, 80);

  // Fade out
  setTimeout(() => {
    _swipeIndicator.style.transition = 'opacity 0.3s ease-out';
    _swipeChevronPill.style.transition = 'transform 0.3s ease-out';
    _swipeIndicator.style.opacity = '0';
    _swipeChevronPill.style.transform = 'scale(0.6)';
  }, 300);

  // Cooldown
  setTimeout(() => { _swipeBusy = false; }, 600);
}

// Listen for native three-finger swipe events from main process (fallback)
if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onBrowseSwipe) {
  window.electronAPI.onBrowseSwipe((_event, direction) => {
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    _swipeCommit(direction);
  });
}

// ── Find in page ──

export let _browseFindBarActive = false;
export let _browseFindRequestId = 0;

export function _browseToggleFindBar() {
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
  const findInput = new window.View('input').id('browse-find-input').className('browse-find-input')
    .attr('type', 'text').attr('placeholder', 'Find\u2026').attr('autocomplete', 'off').attr('spellcheck', false);

  const countSpan = new window.View('span').id('browse-find-count').className('browse-find-count');

  const prevBtn = new window.View('button').className('browse-find-btn').id('browse-find-prev').attr('title', 'Previous')
    .add(window.RawHTML(icon('chevronUp', {size: 12, strokeWidth: '2.5'})));

  const nextBtn = new window.View('button').className('browse-find-btn').id('browse-find-next').attr('title', 'Next')
    .add(window.RawHTML(icon('chevronDown', {size: 12, strokeWidth: '2.5'})));

  const closeBtn = new window.View('button').className('browse-find-btn').id('browse-find-close').attr('title', 'Close')
    .text('\u00d7');

  const barView = window.HStack([findInput, countSpan, prevBtn, nextBtn, closeBtn])
    .id('browse-find-bar').className('browse-find-bar');

  // Insert into browse-content so it floats over the page
  const content = document.getElementById('browse-content');
  AetherUI.append(barView, content || browseView);

  const input = document.getElementById('browse-find-input');
  const countEl = document.getElementById('browse-find-count');

  const doFind = (forward) => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (window._browseIsElectron && el.findInPage) {
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
    if (window._browseIsElectron && el.findInPage) {
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
  if (window._browseIsElectron) {
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

export function _browseStopFind() {
  const el = _browseActiveEl();
  if (!el) return;
  if (window._browseIsElectron && el.stopFindInPage) {
    el.stopFindInPage('clearSelection');
  }
}

export function _browseCloseFindBar() {
  _browseFindBarActive = false;
  _browseStopFind();
  // Remove found-in-page listener
  if (window._browseIsElectron) {
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

export let _magnifyZoom = 1;
export let _magnifyX = 0;
export let _magnifyY = 0;
export let _magnifyGestureStart = 1;
export let _magnifySnapTimer = null;
export let _magnifyEl = null;

document.addEventListener('mousemove', function(e) {
  _magnifyX = e.clientX;
  _magnifyY = e.clientY;
}, { passive: true });

export function _magnifyTarget() {
  const bv = document.getElementById('browse-view');
  if (!bv || bv.style.display === 'none') return null;
  // Don't intercept pinch when nerd mode PDF viewer is active — it has its own zoom
  const pdfContainer = bv.querySelector('.pdf-pages-container');
  if (pdfContainer && pdfContainer.offsetParent !== null) return null;
  return _browseActiveEl();
}

export function _magnifyApply() {
  const el = _magnifyEl;
  if (!el) return;
  const container = document.getElementById('browse-content');
  if (!container) return;

  if (_magnifyZoom <= 1.005) {
    el.style.transform = '';
    el.style.transformOrigin = '';
    container.style.overflow = '';
    return;
  }
  const rect = container.getBoundingClientRect();
  const fx = _magnifyX - rect.left;
  const fy = _magnifyY - rect.top;
  el.style.transformOrigin = fx + 'px ' + fy + 'px';
  el.style.transform = 'scale(' + _magnifyZoom + ')';
  container.style.overflow = 'hidden';
}

export function _magnifySnapBack() {
  clearTimeout(_magnifySnapTimer);
  _magnifyZoom = 1;
  const el = _magnifyEl;
  if (el) {
    Motion.animate(el, {
      spring: 'smooth', duration: 350,
      to: { scale: 1 },
      onFinish: function() {
        el.style.transformOrigin = '';
      }
    });
    const container = document.getElementById('browse-content');
    if (container) container.style.overflow = '';
  }
  _magnifyEl = null;
}

// Chrome/Firefox: trackpad pinch fires wheel with ctrlKey
document.addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  const target = _magnifyTarget();
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  _magnifyEl = target;
  clearTimeout(_magnifySnapTimer);
  target.style.transition = '';
  const delta = -e.deltaY * 0.01;
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyZoom + delta));
  _magnifyApply();
  // No gestureend in Chrome — snap back after inactivity
  _magnifySnapTimer = setTimeout(_magnifySnapBack, 600);
}, { passive: false, capture: true });

// Safari: native gesture events
document.addEventListener('gesturestart', function(e) {
  const target = _magnifyTarget();
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

// Magnify from webview — called when pinch events relay from inside an iframe/webview
// Chrome-style: persistent magnification centered on cursor, no snap-back
// clientX/clientY are already translated to parent document coordinates by the caller

function _magnifyCancelAnimation(el) {
  if (el && el.getAnimations) {
    el.getAnimations().forEach(function(a) { a.cancel(); });
  }
}

export function _magnifyFromWebview(el, deltaY, clientX, clientY) {
  _magnifyCancelAnimation(el);
  _magnifyEl = el;
  _magnifyX = clientX;
  _magnifyY = clientY;
  clearTimeout(_magnifySnapTimer);
  const delta = -deltaY * 0.01;
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyZoom + delta));
  _magnifyApply();
}

export function _magnifyFromWebviewGestureStart(el, clientX, clientY) {
  _magnifyCancelAnimation(el);
  _magnifyEl = el;
  _magnifyX = clientX;
  _magnifyY = clientY;
  _magnifyGestureStart = _magnifyZoom || 1;
  clearTimeout(_magnifySnapTimer);
}

export function _magnifyFromWebviewGestureChange(el, scale) {
  if (!_magnifyEl) return;
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyGestureStart * scale));
  _magnifyApply();
}

export function _magnifyFromWebviewGestureEnd() {
  // No snap-back — zoom persists like Chrome
}

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
export let _browseKeyHandler = null;

export let _browseTabBarFocused = false;

export function _browseInstallKeyGuard() {
  if (_browseKeyHandler) return;
  _browseKeyHandler = (e) => {
    // Only handle if browse view is visible and not typing in an input
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    if (isEditable(e.target)) return;
    // Option+Arrow switches tabs globally (no tab bar focus needed)
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _switchTabLeft(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); _switchTabRight(); return; }
    }
    // Only handle arrow keys if tab bar is focused
    if (!_browseTabBarFocused) return;

    const win = window._getCurrentWindow();
    if (!win) return;

    // Arrow keys for navigation when tab bar is focused
    // Up/Down switch tabs, no window switching via arrows
    if (e.key === 'ArrowUp' && win.tabs.length > 1) {
      e.preventDefault();
      _switchTabLeft();
    } else if (e.key === 'ArrowDown' && win.tabs.length > 1) {
      e.preventDefault();
      _switchTabRight();
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

export function _focusBrowseTabBar() {
  _browseTabBarFocused = true;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.add('tab-bar-focused');
}

export function _blurBrowseTabBar() {
  _browseTabBarFocused = false;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.remove('tab-bar-focused');
}

export function _switchTabLeft() {
  const win = window._getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx > 0) {
    _animateTabSwitch('left', () => {
      browseSelectTab(win.tabs[idx - 1].id);
    });
  }
}

export function _switchTabRight() {
  const win = window._getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx < win.tabs.length - 1) {
    _animateTabSwitch('right', () => {
      browseSelectTab(win.tabs[idx + 1].id);
    });
  }
}

export function _animateTabSwitch(direction, callback) {
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }
  const dist = direction === 'left' ? 30 : -30;
  Motion.swap(content, 'x', callback, { distance: dist, outOpacity: 0.5 });
}

export function _browseRemoveKeyGuard() {
  if (_browseKeyHandler) {
    document.removeEventListener('keydown', _browseKeyHandler);
    _browseKeyHandler = null;
  }
}

// Transparent overlay to capture pinch gestures over iframes
export function _browseInstallPinchOverlay() {
  const container = document.getElementById('browse-content');
  if (!container || container.querySelector('.browse-pinch-overlay')) return;
  const overlayView = new window.View('div').className('browse-pinch-overlay')
    // Default pointer-events:none so clicks pass through to webview natively.
    // Only activate (pointer-events:auto) when zoomed in for pan scrolling.
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;');
  AetherUI.append(overlayView, container);
  const overlay = overlayView.el;

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

export function browseSaveToReadingList() {
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
    if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-accent)');
    // Async: capture screenshot + fetch metadata for the bookmark thumbnail
    _enrichBookmarkAsync(tab.url, tab.el);
  }
}

async function _enrichBookmarkAsync(url, webviewEl) {
  try {
    // 1. Fetch og:image and metadata via link-preview
    const meta = await window.electronAPI.dbQuery('link-preview', url).catch(() => null);
    if (meta && (meta.title || meta.image || meta.description)) {
      const saved = getSavedPosts();
      if (!saved[url]) return;
      const paper = saved[url].paper || {};
      if (meta.title && !paper.title) paper.title = meta.title;
      if (meta.description && !paper.description) paper.description = meta.description;
      if (meta.hostname) paper.hostname = meta.hostname;
      if (meta.image) {
        paper.image = meta.image;
        saved[url].thumbnail = meta.image;
      }
      saved[url].paper = paper;
      savePosts(saved);
    }

    // 2. If still no thumbnail, capture a webview screenshot as fallback
    const savedAfter = getSavedPosts();
    if (!savedAfter[url] || savedAfter[url].thumbnail) return;
    const wc = webviewEl && webviewEl.getWebContentsId ? webviewEl.getWebContentsId() : null;
    if (!wc) return;
    const base64 = await window.electronAPI.captureWebview(wc);
    if (base64 && base64.length > 100) {
      const saved2 = getSavedPosts();
      if (!saved2[url]) return;
      saved2[url].thumbnail = 'data:image/png;base64,' + base64;
      if (saved2[url].paper) saved2[url].paper.image = saved2[url].thumbnail;
      savePosts(saved2);
    }
  } catch {}
}

export function browseShare() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  if (navigator.share) {
    navigator.share({ title: tab.title, url: tab.url }).then(() => {
      if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-accent)');
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(tab.url).then(() => {
      if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      const btn = document.querySelector('#browse-bar button[onclick="browseShare()"]');
      if (btn) {
        const origChildren = Array.from(btn.childNodes).map(n => n.cloneNode(true));
        AetherUI.mount(window.RawHTML(icon('check', {size: 20, strokeWidth: '1.5'})), btn);
        btn.classList.add('text-primary');
        setTimeout(function() { btn.replaceChildren(...origChildren); btn.classList.remove('text-primary'); }, 1500);
      }
    });
  }
}

export function _browseUpdateSaveBtn() {
  const btn = document.getElementById('browse-save-btn');
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const saved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  if (btn) {
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', saved ? 'var(--nr-accent)' : 'none');
      svg.setAttribute('stroke', saved ? 'var(--nr-accent)' : 'currentColor');
    }
  }
  _islandSyncBookmark();
}

export function _islandSyncBookmark() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen && tab && !tab.blank && tab.url && isPostSaved(tab.url)) {
    const title = (tab.title || '').length > 40 ? tab.title.slice(0, 38) + '\u2026' : (tab.title || 'Saved');
    islandUpdate('bookmark', { type: 'bookmark', label: 'Saved', detail: title, action: function() { browseSaveToReadingList(); } });
  } else {
    islandRemove('bookmark');
  }
}

// ── Action registry ──
registerActions({
  browseSaveToReadingList: () => browseSaveToReadingList(),
  browseShare: () => browseShare(),
});

