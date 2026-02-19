// core-layout.js — Bounds, spinners, sidebar nav
// Extracted from core.js

import Settings from '/js/core/core-settings.js';

// ── Content safe bounds for popups ──
// Returns {top, left, right, bottom} — the usable area where popups may appear,
// avoiding the tab row, URL bar, and macOS traffic lights.
export function _invalidateBoundsCache() { _boundsCache = null; }
window.addEventListener('resize', _invalidateBoundsCache);
export function _popupSafeBounds() {
  if (_boundsCache) return _boundsCache;
  const tabRow = document.getElementById('browse-tab-row');
  const bar = document.getElementById('browse-bar');
  const pillBar = document.getElementById('sidebar-nav');
  let left = 0, top = 0;
  if (pillBar && pillBar.offsetParent !== null) {
    top = Math.max(top, pillBar.getBoundingClientRect().bottom + 4);
  }
  if (tabRow && tabRow.offsetParent !== null) {
    top = Math.max(top, tabRow.getBoundingClientRect().bottom);
  }
  if (bar && bar.offsetParent !== null) {
    top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  if (window.electronAPI && window.electronAPI.isElectron) {
    top = Math.max(top, 42);
    if (left < 80 && top <= 42) left = Math.max(left, 80);
  }
  _boundsCache = { top, left, right: window.innerWidth, bottom: window.innerHeight };
  return _boundsCache;
}

// ── Cmd/Ctrl+click → open in new browse tab ──
export function _isNewTabClick(e) { return e && (e.metaKey || e.ctrlKey); }
export function _openInNewTab(url) {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  if (isElectron && typeof openBrowse === 'function') {
    // Open as a new tab in the app's browse tab system
    if (typeof browseNewTab === 'function' && typeof _browseWindows !== 'undefined' && _browseWindows.length) {
      openBrowse(); // navigate to browse view without opening a URL
      browseNewTab(url); // always create a new tab
    } else {
      openBrowse(url);
    }
  } else {
    // Web: open in a real browser tab
    window.open(url, '_blank');
  }
}

// ── Electron detection ──
if (window.electronAPI && window.electronAPI.isElectron) {
  document.body.classList.add('electron-app');
  // Listen for open-in-browse IPC from main process (Cmd+click in webviews, window.open calls)
  if (window.electronAPI.onOpenInBrowse) {
    window.electronAPI.onOpenInBrowse((_event, url) => { _openInNewTab(url); });
  }

  // JS-based window dragging on pill bar — preserves custom cursor
  (function initPillBarDrag() {
    var dragging = false;
    var startScreenX = 0;
    var startScreenY = 0;
    var startWinX = 0;
    var startWinY = 0;

    function isInteractive(el) {
      if (!el) return false;
      // Walk up from target to pill bar — if we hit an interactive element, don't drag
      var node = el;
      var bar = document.getElementById('sidebar-nav');
      while (node && node !== bar) {
        var tag = node.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'SELECT') return true;
        if (node.classList && (
          node.classList.contains('pill-island') ||
          node.classList.contains('browse-tab') ||
          node.classList.contains('sidebar-icon')
        )) return true;
        if (node.getAttribute && node.getAttribute('onclick')) return true;
        node = node.parentElement;
      }
      return false;
    }

    document.addEventListener('mousedown', function(e) {
      var bar = document.getElementById('sidebar-nav');
      if (!bar || !bar.contains(e.target)) return;
      if (isInteractive(e.target)) return;
      if (e.button !== 0) return;

      e.preventDefault();
      dragging = true;
      startScreenX = e.screenX;
      startScreenY = e.screenY;
      electronAPI.windowGetPosition().then(function(pos) {
        startWinX = pos[0];
        startWinY = pos[1];
      });
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var dx = e.screenX - startScreenX;
      var dy = e.screenY - startScreenY;
      electronAPI.windowSetPosition(startWinX + dx, startWinY + dy);
    });

    document.addEventListener('mouseup', function() {
      dragging = false;
    });
  })();
}

// ── Download app banner (web only) ──
export function showDownloadBanner() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  const dismissed = Settings.get('downloadBannerDismissed') === 'true';
  if (!isElectron && !dismissed) {
    const banner = document.getElementById('download-app-banner');
    if (banner) banner.classList.remove('hidden');
  }
}

export function dismissDownloadBanner() {
  Settings.set('downloadBannerDismissed', 'true');
  const banner = document.getElementById('download-app-banner');
  if (banner) {
    Motion.fadeOut(banner, { y: -20, duration: 300, onFinish: function() { banner.classList.add('hidden'); } });
  }
}

// Update Browse button tooltip when not in Electron
function updateBrowseButtonTooltip() {
  const isElectron = window.electronAPI && window.electronAPI.isElectron;
  if (!isElectron) {
    const browseBtn = document.getElementById('sb-browse');
    const tooltip = browseBtn?.querySelector('.sidebar-tooltip');
    if (tooltip) {
      tooltip.textContent = 'Browse (Desktop only)';
    }
  }
}

// Show banner after DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    showDownloadBanner();
    updateBrowseButtonTooltip();
  });
} else {
  showDownloadBanner();
  updateBrowseButtonTooltip();
}

// ── Spinner system ──

export function getSelectedSpinner() {
  return Settings.get('spinner') || 'squareCorners';
}

export function setSelectedSpinner(name) {
  Settings.set('spinner', name);
  restartSpinners();
}

export function loadSpinners() {
  return apiGet('/spinners.json').then(data => {
    _spinnerData = data;
    _spinnerNames = Object.keys(data);
    restartSpinners();
    return data;
  });
}

export function restartSpinners() {
  if (_spinnerInterval) { clearInterval(_spinnerInterval); _spinnerInterval = null; }
  if (!_spinnerData) return;
  const name = getSelectedSpinner();
  const spinner = _spinnerData[name];
  if (!spinner) return;
  const frames = spinner.frames;
  const interval = spinner.interval;
  let i = 0;
  function tick() {
    const els = document.querySelectorAll('.spinner');
    if (!els.length) {
      // No spinners in DOM — stop interval so MutationObserver can restart when new ones appear
      clearInterval(_spinnerInterval);
      _spinnerInterval = null;
      return;
    }
    els.forEach(el => { el.textContent = frames[i]; });
    i = (i + 1) % frames.length;
  }
  tick();
  if (document.querySelectorAll('.spinner').length) {
    _spinnerInterval = setInterval(tick, interval);
  }
}

const _spinnerMO = new MutationObserver(() => {
  const els = document.querySelectorAll('.spinner');
  if (els.length && !_spinnerInterval && _spinnerData) restartSpinners();
});
_spinnerMO.observe(document.documentElement, { childList: true, subtree: true });

loadSpinners();

export function debounce(fn, ms) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Track the last non-paper view for back navigation

// Research view tab state

export function setSidebarActive(id) {
  if (id && _sidebarToView[id]) { Settings.set('_lastActiveView', _sidebarToView[id]); }
  document.querySelectorAll('.sidebar-icon').forEach(b => {
    b.classList.remove('active');
    // Don't remove sb-loading here - let animation finish on its own
  });
  const desktopEl = document.getElementById(id);
  if (desktopEl) desktopEl.classList.add('active');
}

export function setSidebarLoading(id) {
  Motion.retrigger(document.getElementById(id), 'sb-loading', 350);
}

// ── Sidebar Keyboard Navigation ──

function _getSidebarItems() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return [];
  // Get all visible sidebar icons in DOM order
  return Array.from(nav.querySelectorAll('.sidebar-icon')).filter(el => {
    // Filter out hidden elements
    return el.offsetParent !== null;
  });
}

function _focusSidebar() {
  _sidebarFocused = true;
  const nav = document.getElementById('sidebar-nav');
  if (nav) nav.classList.add('sidebar-focused');

  // If no selection, select the currently active item
  if (_sidebarSelectedIndex < 0) {
    const items = _getSidebarItems();
    const activeIdx = items.findIndex(el => el.classList.contains('active'));
    _sidebarSelectedIndex = activeIdx >= 0 ? activeIdx : 0;
  }
  _renderSidebarSelection();
}

function _blurSidebar() {
  _sidebarFocused = false;
  _sidebarSelectedIndex = -1;
  const nav = document.getElementById('sidebar-nav');
  if (nav) nav.classList.remove('sidebar-focused');
  _getSidebarItems().forEach(el => el.classList.remove('sidebar-kbd-selected'));
}

function _renderSidebarSelection() {
  const items = _getSidebarItems();
  items.forEach(el => el.classList.remove('sidebar-kbd-selected'));
  // Scroll into view if needed
  if (_sidebarSelectedIndex >= 0 && items[_sidebarSelectedIndex]) {
    items[_sidebarSelectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function _sidebarNavigate(direction) {
  const items = _getSidebarItems();
  if (!items.length) return;

  _sidebarSelectedIndex += direction;
  if (_sidebarSelectedIndex < 0) _sidebarSelectedIndex = items.length - 1;
  if (_sidebarSelectedIndex >= items.length) _sidebarSelectedIndex = 0;
  _renderSidebarSelection();
  // Immediately open the selected view
  if (items[_sidebarSelectedIndex]) {
    _sidebarNavClicking = true;
    items[_sidebarSelectedIndex].click();
    _sidebarNavClicking = false;
  }
}

function _sidebarActivateSelected() {
  const items = _getSidebarItems();
  if (_sidebarSelectedIndex >= 0 && items[_sidebarSelectedIndex]) {
    items[_sidebarSelectedIndex].click();
  }
}

// Install global keyboard handler for sidebar navigation
(function initSidebarKeyNav() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    // Press [ to focus sidebar
    if (e.key === '[' && !_sidebarFocused) {
      e.preventDefault();
      _focusSidebar();
      return;
    }

    if (!_sidebarFocused) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      _sidebarNavigate(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      _sidebarNavigate(1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _sidebarActivateSelected();
      _blurSidebar();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _blurSidebar();
    }
  });

  // Click outside sidebar blurs it
  document.addEventListener('mousedown', (e) => {
    if (!_sidebarFocused) return;
    const nav = document.getElementById('sidebar-nav');
    if (nav && !nav.contains(e.target)) {
      _blurSidebar();
    }
  });
})();

// Hook into sidebar icon clicks to enable keyboard navigation
function _installSidebarClickFocus() {
  document.querySelectorAll('.sidebar-icon').forEach(el => {
    el.addEventListener('click', () => {
      if (_sidebarNavClicking) return;
      const items = _getSidebarItems();
      const idx = items.indexOf(el);
      if (idx >= 0) {
        _sidebarSelectedIndex = idx;
        _focusSidebar();
      }
    });
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _installSidebarClickFocus);
} else {
  _installSidebarClickFocus();
}

// ── Performance Optimizations ──

// Lazy load images using IntersectionObserver

export function initLazyImageLoading() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: load all images immediately on older browsers
    return;
  }

  _lazyImageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  }, {
    rootMargin: '50px' // Start loading 50px before image enters viewport
  });
}

export function observeLazyImages() {
  if (!_lazyImageObserver) return;

  document.querySelectorAll('img[data-src]').forEach(img => {
    _lazyImageObserver.observe(img);
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLazyImageLoading();
    observeLazyImages();
  });
} else {
  initLazyImageLoading();
  observeLazyImages();
}

// ── Backward compatibility: expose on window ──
window._invalidateBoundsCache = _invalidateBoundsCache;
window._popupSafeBounds = _popupSafeBounds;
window._isNewTabClick = _isNewTabClick;
window._openInNewTab = _openInNewTab;
window.showDownloadBanner = showDownloadBanner;
window.dismissDownloadBanner = dismissDownloadBanner;
window.getSelectedSpinner = getSelectedSpinner;
window.setSelectedSpinner = setSelectedSpinner;
window.loadSpinners = loadSpinners;
window.restartSpinners = restartSpinners;
window.debounce = debounce;
window.setSidebarActive = setSidebarActive;
window.setSidebarLoading = setSidebarLoading;
window.initLazyImageLoading = initLazyImageLoading;
window.observeLazyImages = observeLazyImages;

// ── View management ──