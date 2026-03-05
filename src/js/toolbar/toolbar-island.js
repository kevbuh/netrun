// toolbar-island.js — Island expand/collapse, sub-states, tab pill, actions, utility
import Settings from '/js/core/core-settings.js';
import { islandExpanded, islandSubState, isNtp, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _pillSyncUrl } from '/js/toolbar/toolbar-url.js';
import { _browseRenderTabs, _getActiveTabBar } from '/js/toolbar/toolbar-tabs.js';
import { isEditable } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';
import { toggleCaptions } from '/js/browse/browse-captions.js';

// ── Island pill position sync ──

export function _syncIslandPillPosition() {
  const pill = document.getElementById('sidebar-nav');
  const island = document.getElementById('pill-island');
  const urlWrap = document.getElementById('pill-url-wrap');
  if (!pill || !island || !urlWrap) return;
  const isIsland = pill.classList.contains('island-mode');
  const isNtpActive = pill.classList.contains('ntp-active');
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  const tabsPill = tabsAnchor ? tabsAnchor.querySelector('.pill-island[data-island-id="tabs"]') :
    island.querySelector('.pill-island[data-island-id="tabs"]');
  if (isIsland) {
    if (island.parentElement !== urlWrap) urlWrap.insertBefore(island, urlWrap.firstChild);
    // Keep pill-island-left (tabs anchor container) as first child so tabs render on the left
    const leftCol = document.getElementById('pill-island-left');
    if (leftCol && leftCol.parentElement === urlWrap && urlWrap.firstChild !== leftCol) {
      urlWrap.insertBefore(leftCol, urlWrap.firstChild);
    }
    // NTP: tabs pill inside island (centered capsule); normal: in tabs anchor
    if (isNtpActive && tabsPill && tabsPill.parentElement !== island) island.insertBefore(tabsPill, island.firstChild);
    if (!isNtpActive && tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  } else {
    const navIcons = document.getElementById('pill-nav-icons');
    if (island.parentElement === urlWrap) pill.insertBefore(island, navIcons);
    if (tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  }
}

// ── Layout apply ──

export function _applyBrowseTabLayout() {
  const bar = document.getElementById('browse-bar');
  const pill = document.getElementById('sidebar-nav');
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display === 'flex';
  if (bar) bar.style.display = 'none';
  if (browseOpen) {
    if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
    _pillSyncUrl();
    _syncIslandPillPosition();
    if (typeof window._islandSyncBookmark === 'function') window._islandSyncBookmark();
  } else {
    if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
    _syncIslandPillPosition();
    _collapseIsland();
    if (typeof window.islandRemove === 'function') {
      window.islandRemove('tabs');
      window.islandRemove('bookmark');
    }
  }
  _browseRenderTabs();
}

// ── Expand/collapse (popup mode) ──

let _islandExpandedOutsideHandler = null;
let _islandExpandedBlurHandler = null;
let _islandAnimating = false;
let _islandAnimCancel = null;
export var _urlPopupEl = null;
window._urlPopupEl = null;
let _urlPopupResizeHandler = null;

// ── Helper: snapshot favicon rects from the compact strip ──

function _snapshotStripFavicons(wrap) {
  const result = [];
  const strip = wrap.querySelector('.island-favicon-strip');
  if (!strip) return result;
  const kids = strip.children;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    const tabId = kid.getAttribute('data-island-tab');
    if (!tabId) continue;
    const favEl = kid.tagName === 'IMG' ? kid : (kid.querySelector('img') || kid.querySelector('svg') || kid);
    if (!favEl) continue;
    const r = favEl.getBoundingClientRect();
    if (r.width === 0) continue;
    result.push({ tabId: tabId, rect: r, clone: favEl.cloneNode(true) });
  }
  return result;
}

// ── Helper: snapshot favicon rects from tab items in a container ──

function _snapshotTabFavicons(container, selector, opts) {
  opts = opts || {};
  const onlyVisible = opts.onlyVisible !== false;
  const result = [];
  const items = container.querySelectorAll(selector);
  const containerRect = onlyVisible ? container.getBoundingClientRect() : null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tabId = item.getAttribute('data-island-tab');
    const img = item.querySelector('img') || item.querySelector('svg');
    if (!img) continue;
    const r = img.getBoundingClientRect();
    if (r.width === 0) continue;
    if (containerRect && (r.bottom < containerRect.top || r.top > containerRect.bottom)) continue;
    result.push({ tabId: tabId, rect: r, clone: img.cloneNode(true) });
  }
  return result;
}

// ── Helper: build a ghost layer + create ghosts, animate from→to ──

// Dynamic Island-style easing: fluid deceleration, no overshoot
const _islandEasing = 'cubic-bezier(0.5, 0.0, 0.0, 1.0)';

function _createGhostAnimation(fromFavicons, toMap, duration, stagger, opts) {
  opts = opts || {};
  const layer = document.createElement('div');
  layer.className = 'island-ghost-layer';
  document.body.appendChild(layer);
  const anims = [];
  const easing = _islandEasing;
  const scalePulse = opts.scalePulse !== false;
  const crossFade = opts.crossFade !== false;

  for (let i = 0; i < fromFavicons.length; i++) {
    const f = fromFavicons[i];
    const ghost = f.clone;
    ghost.style.cssText = 'position:fixed;pointer-events:none;margin:0;padding:0;border:none;' +
      'left:' + f.rect.left + 'px;top:' + f.rect.top + 'px;' +
      'width:' + f.rect.width + 'px;height:' + f.rect.height + 'px;' +
      'border-radius:3px;object-fit:contain;will-change:transform,opacity;';
    layer.appendChild(ghost);

    const target = toMap[f.tabId];
    if (target) {
      const dx = target.left - f.rect.left;
      const dy = target.top - f.rect.top;
      const midScale = scalePulse ? ' scale(1.04)' : ' scale(1)';
      const endOpacity = crossFade ? 0 : 1;
      anims.push(ghost.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: 'translate(' + (dx*0.5) + 'px,' + (dy*0.5) + 'px)' + midScale, opacity: 1, offset: 0.5 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1)', opacity: endOpacity, offset: 1 }
        ],
        { duration: duration, easing: easing, fill: 'forwards', delay: (stagger || 0) * i }
      ));
    } else {
      anims.push(ghost.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: duration * 0.6, easing: easing, fill: 'forwards' }
      ));
    }
  }
  return { layer: layer, anims: anims };
}

// ── Open URL popup (separate dropdown below compact pill) ──

function _openUrlPopup(mode) {
  // mode: 'tabs' (default) — show tab list; 'url' — show recent sites
  if (_urlPopupEl) return;
  mode = mode || 'tabs';

  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;

  // Cancel any in-flight animation
  if (_islandAnimCancel) { _islandAnimCancel(); _islandAnimCancel = null; }

  // 0. Clear old island dropdown (focus may have populated it before popup was set)
  const oldDd = wrap.querySelector('#pill-url-dropdown');
  if (oldDd) { oldDd.innerHTML = ''; oldDd.style.display = 'none'; oldDd.classList.add('hidden'); }
  wrap.classList.remove('pill-dropdown-open');

  // 1. Snapshot compact favicon positions + pill width BEFORE hiding tabs pill
  const compactFavicons = _snapshotStripFavicons(wrap);
  const pillRect = wrap.getBoundingClientRect();

  // 1b. Slide tabs pill left via CSS transition + lock pill width
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  const tabsPill = wrap.querySelector('.pill-island[data-island-id="tabs"]');
  wrap.style.width = Math.round(pillRect.width) + 'px';
  wrap.classList.add('pill-popup-open');
  if (tabsPill) {
    // The pill already has CSS transition on max-width, opacity, padding
    tabsPill.style.minWidth = '0';
    tabsPill.style.overflow = 'hidden';
    tabsPill.style.maxWidth = '0px';
    tabsPill.style.opacity = '0';
    tabsPill.style.padding = '0';
    if (tabsAnchor) tabsAnchor.classList.add('pill-anchor-collapsing');
    setTimeout(function() {
      if (tabsAnchor) tabsAnchor.style.display = 'none';
      if (tabsPill) tabsPill.style.display = 'none';
      // Clear inline overrides (element is hidden)
      tabsPill.style.minWidth = '';
      tabsPill.style.overflow = '';
      tabsPill.style.maxWidth = '';
      tabsPill.style.opacity = '';
      tabsPill.style.padding = '';
    }, 400);
  } else if (tabsAnchor) {
    tabsAnchor.style.display = 'none';
  }
  // Let URL input fill the freed space
  const urlWrap = document.getElementById('pill-browse-url');
  if (urlWrap) urlWrap.style.flex = '1 1 auto';
  const urlInput = document.getElementById('pill-browse-url-input');
  if (urlInput) { urlInput.style.maxWidth = 'none'; urlInput.style.flex = '1'; }

  // 3. Create popup element
  const popup = document.createElement('div');
  popup.className = 'pill-url-popup';
  popup.style.left = Math.round(pillRect.left) + 'px';
  popup.style.top = Math.round(pillRect.bottom + 4) + 'px';
  popup.style.width = Math.max(Math.round(pillRect.width), 300) + 'px';
  document.body.appendChild(popup);
  _urlPopupEl = popup;
  window._urlPopupEl = popup;

  // 4. Render tab list inside popup (always created, visibility toggled by mode)
  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'pill-url-popup-tabs';
  tabsContainer.className = 'pill-url-popup-tabs';
  popup.appendChild(tabsContainer);
  _renderPopupTabs(tabsContainer);
  if (mode === 'url') tabsContainer.style.display = 'none';
  popup.dataset.popupMode = mode;

  // 5. Add container for autocomplete/suggestions
  const ddContainer = document.createElement('div');
  ddContainer.id = 'pill-url-popup-dropdown';
  ddContainer.className = 'pill-url-popup-dropdown';
  popup.appendChild(ddContainer);

  // 6. Force layout, snapshot popup tab favicon positions
  void popup.offsetHeight;
  const popupFavicons = _snapshotTabFavicons(popup, '.popup-tab-item[data-island-tab]', { onlyVisible: false });
  const popupMap = {};
  for (let i = 0; i < popupFavicons.length; i++) popupMap[popupFavicons[i].tabId] = popupFavicons[i].rect;

  // 7. FLIP ghost animation: favicons fly from compact strip into popup tab rows
  let cancelled = false;
  const departOrder = compactFavicons.slice().reverse();
  const ghosts = _createGhostAnimation(departOrder, popupMap, 260, 20, { scalePulse: true, crossFade: true });

  // 8. Hide popup tab rows initially, stagger-reveal
  const tabItems = tabsContainer.querySelectorAll('.popup-tab-item');
  for (let i = 0; i < tabItems.length; i++) {
    tabItems[i].style.opacity = '0';
    tabItems[i].style.transform = 'translateY(4px)';
  }
  const fadeTimer = setTimeout(function() {
    if (cancelled) return;
    for (let ri = 0; ri < tabItems.length; ri++) {
      (function(item, idx) {
        setTimeout(function() {
          if (cancelled) return;
          item.style.transition = 'opacity 180ms cubic-bezier(0.4, 0.0, 0.0, 1.0), transform 180ms cubic-bezier(0.4, 0.0, 0.0, 1.0)';
          item.style.opacity = '1';
          item.style.transform = 'translateY(0)';
          setTimeout(function() { item.style.transition = ''; item.style.transform = ''; }, 190);
        }, idx * 22);
      })(tabItems[ri], ri);
    }
  }, 70);

  // 9. Popup slides in
  popup.style.opacity = '0';
  popup.style.transform = 'translateY(-6px)';
  requestAnimationFrame(function() {
    popup.style.transition = 'opacity 200ms ' + _islandEasing + ', transform 200ms ' + _islandEasing;
    popup.style.opacity = '1';
    popup.style.transform = 'translateY(0)';
    setTimeout(function() { popup.style.transition = ''; }, 210);
  });

  _islandAnimCancel = function() {
    cancelled = true;
    clearTimeout(fadeTimer);
    for (let ai = 0; ai < ghosts.anims.length; ai++) try { ghosts.anims[ai].cancel(); } catch(e) {}
    ghosts.layer.remove();
    _islandAnimating = false;
    _islandAnimCancel = null;
  };

  // Cleanup ghosts on finish
  var longestAnim = ghosts.anims.length ? ghosts.anims[ghosts.anims.length - 1] : null;
  if (longestAnim) {
    longestAnim.finished.then(function() {
      if (!cancelled) ghosts.layer.remove();
      _islandAnimating = false;
      _islandAnimCancel = null;
    }).catch(function() { ghosts.layer.remove(); _islandAnimating = false; });
  } else {
    _islandAnimating = false;
    _islandAnimCancel = null;
  }

  // 10. Set state
  islandExpanded.value = true;

  // 11. Show full URL in pill input
  const input = document.getElementById('pill-browse-url-input');
  if (input) {
    if (typeof window._browseUrlOnFocus === 'function') window._browseUrlOnFocus(input);
    requestAnimationFrame(function() {
      input.focus();
      input.select();
    });
  }

  // 12. Trigger history/suggestions
  if (typeof window._browseUrlShowHistory === 'function') {
    setTimeout(function() {
      // In url mode, show unfiltered recents (clear input temporarily)
      if (mode === 'url' && input) {
        var saved = input.value;
        input.value = '';
        window._browseUrlShowHistory();
        input.value = saved;
        input.select();
      } else {
        window._browseUrlShowHistory();
      }
    }, 10);
  }

  // 13. Outside-click handler
  _collapseIslandCleanup();
  _islandExpandedOutsideHandler = function(e) {
    if (wrap.contains(e.target)) return;
    if (popup.contains(e.target)) return;
    if (_islandTabsDropdownEl && _islandTabsDropdownEl.contains(e.target)) return;
    _closeUrlPopup();
  };
  _islandExpandedBlurHandler = function() { _closeUrlPopup(); };
  setTimeout(function() {
    document.addEventListener('mousedown', _islandExpandedOutsideHandler, true);
    window.addEventListener('blur', _islandExpandedBlurHandler);
  }, 0);

  // 14. Window resize: reposition popup
  _urlPopupResizeHandler = function() {
    if (!_urlPopupEl) return;
    const r = wrap.getBoundingClientRect();
    _urlPopupEl.style.left = Math.round(r.left) + 'px';
    _urlPopupEl.style.top = Math.round(r.bottom + 4) + 'px';
    _urlPopupEl.style.width = Math.max(Math.round(r.width), 300) + 'px';
  };
  window.addEventListener('resize', _urlPopupResizeHandler);
}

// ── Close URL popup ──

function _closeUrlPopup() {
  if (!_urlPopupEl) return;
  const popup = _urlPopupEl;
  const wrap = document.getElementById('pill-url-wrap');

  // Cancel any in-flight animation
  if (_islandAnimCancel) { _islandAnimCancel(); _islandAnimCancel = null; }

  // 1. Snapshot popup tab favicon positions BEFORE removing popup
  const popupFavicons = _snapshotTabFavicons(popup, '.popup-tab-item[data-island-tab]', { onlyVisible: true });

  // 2. Restore tabs anchor + pill to natural state for snapshotting
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  const tabsPill = tabsAnchor ? tabsAnchor.querySelector('.pill-island[data-island-id="tabs"]') : null;
  if (tabsAnchor) {
    tabsAnchor.style.display = '';
    tabsAnchor.classList.remove('pill-anchor-collapsing');
  }
  if (tabsPill) {
    tabsPill.style.display = '';
    tabsPill.style.minWidth = '';
    tabsPill.style.overflow = '';
    tabsPill.style.maxWidth = '';
    tabsPill.style.opacity = '';
    tabsPill.style.padding = '';
  }
  // Reset pill width/flex so layout reflows to compact state
  if (wrap) { wrap.style.width = ''; wrap.classList.remove('pill-popup-open'); }
  const urlWrap = document.getElementById('pill-browse-url');
  if (urlWrap) urlWrap.style.flex = '';
  const urlInput = document.getElementById('pill-browse-url-input');
  if (urlInput) { urlInput.style.maxWidth = ''; urlInput.style.flex = ''; }

  // 3. Snapshot compact favicon positions (everything at natural size)
  void (wrap || document.body).offsetHeight;
  const compactFavicons = wrap ? _snapshotStripFavicons(wrap) : [];
  const compactMap = {};
  for (let i = 0; i < compactFavicons.length; i++) compactMap[compactFavicons[i].tabId] = compactFavicons[i].rect;

  // 3b. Slide tabs pill back in via CSS transition
  if (tabsPill) {
    tabsPill.style.minWidth = '0';
    tabsPill.style.overflow = 'hidden';
    tabsPill.style.maxWidth = '0px';
    tabsPill.style.opacity = '0';
    tabsPill.style.padding = '0';
    void tabsPill.offsetWidth; // register collapsed state
    tabsPill.style.maxWidth = '';
    tabsPill.style.opacity = '';
    tabsPill.style.padding = '';
    setTimeout(function() {
      if (tabsPill) { tabsPill.style.minWidth = ''; tabsPill.style.overflow = ''; }
    }, 400);
  }

  // 4. Reverse FLIP ghost animation: favicons fly from popup to compact strip
  const departOrder = popupFavicons.slice().reverse();
  const ghostCount = departOrder.length;
  const ghostDuration = 200 + ghostCount * 10;
  const ghostStagger = 10 + ghostCount * 2;
  const ghosts = _createGhostAnimation(departOrder, compactMap, ghostDuration, ghostStagger, { scalePulse: true, crossFade: true });

  // 5. Animate popup out
  popup.style.transition = 'opacity 120ms ' + _islandEasing + ', transform 120ms ' + _islandEasing;
  popup.style.opacity = '0';
  popup.style.transform = 'translateY(-4px)';

  var totalTime = Math.max(120, ghostDuration + ghostStagger * Math.max(0, ghostCount - 1));
  setTimeout(function() {
    ghosts.layer.remove();
    popup.remove();
  }, totalTime);

  // 6. Clean up state
  _urlPopupEl = null;
  window._urlPopupEl = null;
  islandExpanded.value = false;
  if (wrap) wrap.classList.remove('pill-dropdown-open');
  _collapseIslandCleanup();

  // 5. Restore shortened URL
  _pillSyncUrl();

  // 6. Hide history dropdown
  if (typeof window._browseUrlHideHistory === 'function') window._browseUrlHideHistory();

  // 7. Remove resize handler
  if (_urlPopupResizeHandler) {
    window.removeEventListener('resize', _urlPopupResizeHandler);
    _urlPopupResizeHandler = null;
  }
}

// ── Render tab list inside popup ──

function _renderPopupTabs(container) {
  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  const activeTabId = win.activeTab;

  // Sort tabs by recency
  const sortedTabs = win.tabs.filter(function(t) { return !t.blank; }).slice();
  sortedTabs.sort(function(a, b) { return (b.lastVisited || 0) - (a.lastVisited || 0); });

  const globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const plusSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';

  const rows = sortedTabs.map(function(t) {
    const isActive = t.id === activeTabId;
    const title = t.title || 'New Tab';
    const favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    const nameView = window.Text(title).className('popup-tab-title');
    const closeBtn = window.Text('\u00d7').className('popup-tab-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(function() { _renderPopupTabs(container); }, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('popup-tab-item' + (isActive ? ' active' : ''))
      .attr('data-island-tab', t.id)
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        _closeUrlPopup();
      });
  });

  // New tab row
  rows.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 10px' }));
  rows.push(window.HStack([window.RawHTML(plusSvg), window.Text('New tab')])
    .className('popup-tab-item')
    .onTap(function() {
      _closeUrlPopup();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  AetherUI.mount(window.VStack(rows), container);
}

export function _expandIsland(mode) {
  _openUrlPopup(mode || 'url');
}

export function _collapseIsland() {
  _closeUrlPopup();
}

function _collapseIslandCleanup() {
  if (_islandExpandedOutsideHandler) {
    document.removeEventListener('mousedown', _islandExpandedOutsideHandler, true);
    _islandExpandedOutsideHandler = null;
  }
  if (_islandExpandedBlurHandler) {
    window.removeEventListener('blur', _islandExpandedBlurHandler);
    _islandExpandedBlurHandler = null;
  }
}

// ── Sub-state management ──

function _setIslandSubState(state) {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  wrap.classList.remove('island-ai-expanded');
  if (islandSubState.value === state) {
    islandSubState.value = 'default';
    return;
  }
  islandSubState.value = state;
  if (state === 'ai') {
    wrap.classList.add('island-ai-expanded');
    _renderIslandAIFull();
  }
}

// ── Render island tab pill (expanded left column) ──

function _renderIslandTabPill() {
  const leftCol = document.getElementById('pill-island-left');
  if (!leftCol) return;
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = 'none';

  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) { AetherUI.mount(new View('div'), leftCol); return; }
  const activeTabId = win.activeTab;

  // Sort tabs by recency (most recently visited first) — matches compact favicon strip order
  const sortedTabs = win.tabs.filter(function(t) { return !t.blank; }).slice();
  sortedTabs.sort(function(a, b) { return (b.lastVisited || 0) - (a.lastVisited || 0); });

  const globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const plusSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';

  const rows = sortedTabs.map(function(t) {
    const isActive = t.id === activeTabId;
    const title = t.title || 'New Tab';
    const truncTitle = title;
    const favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    const nameView = window.Text(truncTitle).className('island-vtab-item-title');
    const closeBtn = window.Text('\u00d7').className('island-vtab-item-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-vtab-item' + (isActive ? ' active' : ''))
      .attr('data-island-tab', t.id)
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  AetherUI.mount(window.VStack(rows), leftCol);
  leftCol.onclick = null;
}

// ── Tabs dropdown (below capsule) ──

var _islandTabsDropdownEl = null;
let _islandTabsOutsideHandler = null;

function _toggleIslandTabsDropdown() {
  if (_islandTabsDropdownEl) {
    _closeIslandTabsDropdown();
    return;
  }
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  const activeTabId = win.activeTab;
  const globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  const rows = win.tabs.map(function(t) {
    const favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    const title = (t.title || 'New Tab');
    const nameView = window.Text(title.length > 32 ? title.slice(0, 30) + '\u2026' : title)
      .flex(1).styles({ minWidth: '0' }).truncate();
    const closeBtn = window.Text('\u00d7').className('island-tabs-full-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(function() { _closeIslandTabsDropdown(); _toggleIslandTabsDropdown(); }, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-tabs-full-item' + (t.id === activeTabId ? ' active' : ''))
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        _closeIslandTabsDropdown();
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  // New tab row
  const newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  rows.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 10px' }));
  rows.push(window.HStack([newTabIcon, window.Text('New tab')])
    .className('island-tabs-full-item')
    .onTap(function() {
      _closeIslandTabsDropdown();
      _collapseIsland();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  const wrapRect = wrap.getBoundingClientRect();
  const panel = window.VStack(rows)
    .position('fixed')
    .background('overlay')
    .cornerRadius('lg')
    .shadow('popup')
    .border('border-default')
    .colorScheme('dark')
    .frame({ maxHeight: 320, minWidth: Math.round(wrapRect.width) })
    .overflow('auto')
    .zIndex('modal')
    .padding('6px', '0')
    .styles({
      left: Math.round(wrapRect.left) + 'px',
      top: Math.round(wrapRect.bottom + 4) + 'px'
    });
  const dd = panel.el;
  document.body.appendChild(dd);
  _islandTabsDropdownEl = dd;

  setTimeout(function() {
    _islandTabsOutsideHandler = function(e) {
      if (dd.contains(e.target)) return;
      const leftCol = document.getElementById('pill-island-left');
      if (leftCol && leftCol.contains(e.target)) return;
      _closeIslandTabsDropdown();
    };
    document.addEventListener('mousedown', _islandTabsOutsideHandler, true);
  }, 0);
}

function _closeIslandTabsDropdown() {
  if (_islandTabsDropdownEl) {
    _islandTabsDropdownEl.remove();
    _islandTabsDropdownEl = null;
  }
  if (_islandTabsOutsideHandler) {
    document.removeEventListener('mousedown', _islandTabsOutsideHandler, true);
    _islandTabsOutsideHandler = null;
  }
}

// ── Render AI panel ──

function _renderIslandAIFull() {
  const container = document.getElementById('pill-island-ai-full');
  if (!container) return;
  AetherUI.mount(new View('div'), container);
  if (typeof window.renderAIPanelContent === 'function') {
    window.renderAIPanelContent(container, function() { _setIslandSubState('default'); });
  }
}


// ── Render action icons ──

export function _renderIslandActions() {
  const centerCol = document.getElementById('pill-island-center');
  if (!centerCol) return;
  // Remove any previous actions/pageinfo content
  const actionsId = 'pill-island-actions-row';
  const existing = document.getElementById(actionsId);
  if (existing) existing.remove();

  const V = window.View, T = window.Text, H = window.HStack, VS = window.VStack;

  // ── CC Live mode: center column becomes sole column with captions ──
  const wrap = document.getElementById('pill-url-wrap');
  if (window._ccActive) {
    if (wrap) { wrap.classList.add('island-cc-live');  }

    const ccAct = window._islandActivities ? window._islandActivities.value.cc : null;
    const lines = (ccAct && ccAct.lines) ? ccAct.lines : [];
    const visibleCount = 6;
    const start = Math.max(0, lines.length - visibleCount);
    const visible = lines.slice(start);

    const ccRows = [];
    // Header
    const stopBtn = T('Stop').styles({ fontSize: '0.7rem', cursor: 'pointer', color: '#ef4444' })
      .onTap(function() { toggleCaptions(); });
    ccRows.push(H([
      H([
        new V('span').frame({ width: 6, height: 6 }).cornerRadius('full')
          .styles({ background: 'var(--nr-accent)', boxShadow: '0 0 6px var(--nr-accent)' }),
        T('CC Live').styles({ fontSize: '0.65rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.3px' }).opacity(0.5)
      ]).spacing(1),
      stopBtn
    ]).styles({ justifyContent: 'space-between', width: '100%' }));

    // Lines
    const linesView = VS([]).className('ai-unified-cc-lines');
    for (let ci = 0; ci < visible.length; ci++) {
      const fromEnd = visible.length - 1 - ci;
      const op = fromEnd === 0 ? '1' : fromEnd === 1 ? '0.7' : fromEnd === 2 ? '0.45' : '0.25';
      linesView.add(T(visible[ci]).className('ai-unified-cc-line').opacity(op));
    }
    if (visible.length === 0) {
      linesView.add(T('Waiting for audio\u2026').className('ai-unified-cc-line').opacity(0.3));
    }
    ccRows.push(linesView);

    const ccContainer = VS(ccRows).className('ai-unified-cc-tray').styles({ gap: '6px', alignItems: 'stretch', padding: '0 4px' });
    ccContainer.id(actionsId);
    AetherUI.append(ccContainer, centerCol);
    return;
  }
  // ── Mic Live mode: center column becomes sole column with transcript ──
  if (window._pillMicRecorder) {
    if (wrap) { wrap.classList.add('island-cc-live');  }

    const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
    const micLines = (micAct && micAct.lines) ? micAct.lines : [];
    const micVisibleCount = 6;
    const micStart = Math.max(0, micLines.length - micVisibleCount);
    const micVisible = micLines.slice(micStart);

    const micRows = [];
    // Header
    const micStopBtn = T('Stop').styles({ fontSize: '0.7rem', cursor: 'pointer', color: '#ef4444' })
      .onTap(function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); });
    micRows.push(H([
      H([
        new V('span').frame({ width: 6, height: 6 }).cornerRadius('full')
          .styles({ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }),
        T('Listening\u2026').styles({ fontSize: '0.65rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.3px' }).opacity(0.5)
      ]).spacing(1),
      micStopBtn
    ]).styles({ justifyContent: 'space-between', width: '100%' }));

    // Lines
    const micLinesView = VS([]).className('ai-unified-cc-lines');
    for (let mi = 0; mi < micVisible.length; mi++) {
      const micFromEnd = micVisible.length - 1 - mi;
      const micOp = micFromEnd === 0 ? '1' : micFromEnd === 1 ? '0.7' : micFromEnd === 2 ? '0.45' : '0.25';
      micLinesView.add(T(micVisible[mi]).className('ai-unified-cc-line').opacity(micOp));
    }
    if (micVisible.length === 0) {
      micLinesView.add(T('Waiting for audio\u2026').className('ai-unified-cc-line').opacity(0.3));
    }
    micRows.push(micLinesView);

    const micContainer = VS(micRows).className('ai-unified-cc-tray').styles({ gap: '6px', alignItems: 'stretch', padding: '0 4px' });
    micContainer.id(actionsId);
    AetherUI.append(micContainer, centerCol);
    return;
  }
  // Not in CC/mic mode — remove layout class
  if (wrap) { wrap.classList.remove('island-cc-live'); }
}

// ── Render utility row ──

function _renderIslandUtilityRow() {
  const row = document.getElementById('pill-island-utility-row');
  if (!row) return;
  const buttons = [
    { iconName: 'plus', label: 'New Tab', handler: function() { _collapseIsland(); if (typeof window.browseNewTab === 'function') window.browseNewTab(); } },
    { iconName: 'close', label: 'Close', handler: function() { browseCloseTab(_browseActiveTab); setTimeout(_renderIslandTabPill, 50); } },
    { id: 'pill-island-bookmark-btn', iconName: 'bookmark', label: 'Save', handler: function() { if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList(); _syncUtilityBookmark(); } },
  ];
  const btnViews = buttons.map(function(b) {
    const view = new window.View('button').className('island-utility-btn')
      .add(window.RawHTML(icon(b.iconName, { size: 14 })), window.Text(b.label))
      .onTap(function(e) { e.stopPropagation(); b.handler(); });
    if (b.id) view.el.id = b.id;
    return view;
  });
  AetherUI.mount(window.HStack(btnViews), row);
  _syncUtilityBookmark();
}

function _syncUtilityBookmark() {
  const btn = document.getElementById('pill-island-bookmark-btn');
  if (!btn) return;
  const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (tab && !tab.blank && tab.url && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url)) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

// ── Pill menu toggle ──

let _pillMenuLeaveTimer = null;

export function _togglePillMenu() {
  const pill = document.getElementById('sidebar-nav');
  if (!pill) return;
  // In browse mode, delegate to the more menu dropdown instead of expanding the pill
  if (pill.classList.contains('browse-mode')) {
    if (typeof window.toggleBrowseMoreMenu === 'function') window.toggleBrowseMoreMenu();
    return;
  }
  const opening = !pill.classList.contains('menu-expanded');
  pill.classList.toggle('menu-expanded');
  if (opening) {
    document.body.classList.add('island-dropdown-guard');
    setTimeout(function() { document.addEventListener('mousedown', _pillMenuOutsideClick); }, 0);
  } else {
    document.body.classList.remove('island-dropdown-guard');
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
  }
}

function _pillMenuOutsideClick(e) {
  const pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('menu-expanded')) {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
    return;
  }
  if (e.target.closest('#pill-menu-btn') || e.target.closest('#pill-nav-icons') || e.target.closest('#pill-browse-hamburger')) return;
  _closePillMenu();
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _closePillMenu() {
  const pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.remove('menu-expanded');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  const pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded') || pill.classList.contains('browse-mode')) return;
  pill.classList.add('menu-expanded');
}

export function _closePillMenuHover() {
  _pillMenuLeaveTimer = setTimeout(function() { _closePillMenu(); }, 200);
}

export function _cancelPillMenuClose() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
}

// ── Favicon click → navigate to tab (capture phase, fires before expand) ──

// ── Click handler for capsule → open popup or handle favicon clicks ──

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  if (_urlPopupEl) return;
  // Don't expand when clicking satellite pills — they have their own tray handlers
  if (e.target.closest('.pill-satellite-container')) return;
  if (!wrap.contains(e.target)) return;
  // Close button on compact favicon — close tab, don't open popup
  if (e.target.closest('[data-island-tab-close]')) {
    e.stopPropagation();
    const closeId = +e.target.closest('[data-island-tab-close]').getAttribute('data-island-tab-close');
    browseCloseTab(closeId);
    return;
  }
  // Clicking tabs pill or favicon → show tabs; clicking URL area → show recent sites
  const isTabsPill = !!e.target.closest('.pill-island[data-island-id="tabs"], #pill-island-tabs-anchor, [data-island-tab]');
  _openUrlPopup(isTabsPill ? 'tabs' : 'url');
});

document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('pill-browse-url-input');
  if (input) input.addEventListener('focus', function() {
    _openUrlPopup('url');
  });
});

// Auto-focus NTP search input when typing
document.addEventListener('keydown', function(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  const ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  const active = document.activeElement;
  if (isEditable(active)) return;
  const input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

// ── Action registry ──
registerActions({
  _togglePillMenu: function() { _togglePillMenu(); },
  _openPillMenuHover: function() { _openPillMenuHover(); },
  _closePillMenuHover: function() { _closePillMenuHover(); },
  _cancelPillMenuClose: function() { _cancelPillMenuClose(); },
});
