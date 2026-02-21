// browse-island.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import Settings from '/js/core/core-settings.js';
import { islandRemove } from '/js/core/core-ui.js';
import { _clearAudioUnified, _renderAudioPill, _updateAudioUnified } from '/js/core/core-audio.js';
import { _annotationsEnabled, _updateAnnotateButtonState, toggleAnnotations, _readPageAloud } from '/js/browse/browse-annotations.js';
import { icon } from '/js/core/icons.js';
import { browseShowAIView } from '/js/browse/browse-menu.js';
import { startRain } from '/js/core/core-sounds.js';
import { _browseApplyAdaptiveColor, _browseSetUrlDisplay, _browseUpdateAdBlockBadge, _browseUpdateAdBlockBtn, _browseUrlHideHistory, _browseUrlKeydown, _saveBrowseVisit, _saveWebSearch, openHelpPage, openSearchHistoryPage } from '/js/browse-urlbar.js';
import { openNetrunPage } from '/js/netrun-page.js';
import { openDocs } from '/js/docs.js';
import { _browseBindFrame } from '/js/browse/browse-downloads.js';
import { _browseCreateFrame, _browseProxyUrl, _browseSetFrameAllow } from '/js/browse/browse-ntp.js';
import { _browseFocusPane, _browseGetSplitPanes, browseUnsplitPane } from '/js/browse/browse-split-panes.js';
import { _browseRenderSplitPillView, _browseRenderTabView } from '/js/browse/browse-captions.js';
import { _browseUpdateNewTabPage, browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { _browseUpdateSaveBtn, _focusBrowseTabBar, _islandSyncBookmark, browseSaveToReadingList } from '/js/browse/browse-features.js';
import { _getActiveTabBar, _islandSyncTabs, _pillSyncTabs, _setPillBrowseMode } from '/js/browse/browse-pill.js';
import { _sendPopupChatMessage } from '/js/panel-chat.js';
import { _showPanel } from '/js/panel.js';
import { browseNewTab, openLocalPdf } from '/js/browse/browse-windows.js';
import { chatViewCleanupMorph, chatViewUnmorph, openChatPage } from '/js/chat-view.js';
import { openDrawPage } from '/js/draw-view.js';
import { renderAIPanelContent } from '/js/browse/browse-ai-pill.js';

// ── Island mode tab renderer ──

export function toggleBrowseTabLayout() {
  const newLayout = Settings.get('browseTabLayout') === 'island' ? 'horizontal' : 'island';
  Settings.set('browseTabLayout', newLayout);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen) {
    if (newLayout === 'island') {
      _setPillBrowseMode(false);
      _applyBrowseTabLayout();
    } else {
      _setPillBrowseMode(true);
    }
  }
}

export function _applyBrowseTabLayout() {
  const tabRow = document.getElementById('browse-tab-row');
  const bar = document.getElementById('browse-bar');
  const pill = document.getElementById('sidebar-nav');
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display === 'flex';
  if (Settings.get('browseTabLayout') === 'island') {
    if (tabRow) tabRow.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (browseOpen) {
      if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
      _pillSyncUrl();
      const pillTabs = document.getElementById('pill-browse-tabs');
      if (pillTabs) pillTabs.innerHTML = '';
      _islandSyncTabs();
      _islandSyncBookmark();
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      _collapseIsland();
      islandRemove('tabs');
      islandRemove('bookmark');
    }
  } else {
    // Restore everything
    _collapseIsland();
    if (bar) bar.style.display = '';
    if (window._pillBrowseMode) {
      if (tabRow) tabRow.style.display = 'none';
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      if (tabRow) tabRow.style.display = '';
    }
    if (window._pillBrowseMode) _pillSyncTabs();
  }
  _browseRenderTabs();
}

/* Move back/reload/fwd into capsule nav-row, hide AI pill */
function _moveElementsIntoIsland() {
  const navRow = document.getElementById('pill-island-nav-row');
  const rightCol = document.getElementById('pill-island-right-col');
  if (navRow) {
    const back = document.getElementById('pill-browse-back');
    const reload = document.getElementById('pill-browse-reload');
    const fwd = document.getElementById('pill-browse-fwd');
    if (back && back.parentElement !== navRow) navRow.appendChild(back);
    if (reload && reload.parentElement !== navRow) navRow.appendChild(reload);
    if (fwd && fwd.parentElement !== navRow) navRow.appendChild(fwd);
  }
  // Hide AI pill when expanded — we render individual action icons instead
  const aiPill = document.getElementById('pill-ai-unified');
  if (aiPill) aiPill.style.display = 'none';
}

/* Restore back/reload/fwd and AI pill to their original positions in the pill bar */
function _restoreElementsFromIsland() {
  const pillBar = document.getElementById('sidebar-nav');
  if (!pillBar) return;
  const navRow = document.getElementById('pill-island-nav-row');
  const rightCol = document.getElementById('pill-island-right-col');
  // Move back/fwd back to pill bar (before pill-browse-url)
  const back = document.getElementById('pill-browse-back');
  const fwd = document.getElementById('pill-browse-fwd');
  const pillUrl = document.getElementById('pill-browse-url');
  if (back && navRow && navRow.contains(back)) {
    if (pillUrl) pillBar.insertBefore(back, pillUrl);
    else pillBar.appendChild(back);
  }
  if (fwd && navRow && navRow.contains(fwd)) {
    if (pillUrl) pillBar.insertBefore(fwd, pillUrl.nextSibling);
    else pillBar.appendChild(fwd);
  }
  // Move reload back into pill-url-wrap (before close-tab-btn)
  const reload = document.getElementById('pill-browse-reload');
  const urlWrap = document.getElementById('pill-url-wrap');
  const closeBtn = document.getElementById('pill-close-tab-btn');
  if (reload && navRow && navRow.contains(reload) && urlWrap) {
    if (closeBtn) urlWrap.insertBefore(reload, closeBtn);
    else urlWrap.appendChild(reload);
  }
  // Show AI pill again
  const aiPill = document.getElementById('pill-ai-unified');
  if (aiPill) aiPill.style.display = '';
  // Clear rendered island content
  const leftCol = document.getElementById('pill-island-left');
  if (leftCol) { leftCol.innerHTML = ''; leftCol.onclick = null; }
  if (rightCol) { rightCol.innerHTML = ''; rightCol.onclick = null; }
}

/* ── Sub-state management ── */
let _islandSubState = 'default'; // 'default' | 'tabs' | 'ai'

function _setIslandSubState(state) {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  wrap.classList.remove('island-tabs-expanded', 'island-ai-expanded');
  if (_islandSubState === state) {
    // Toggle off — return to default
    _islandSubState = 'default';
    return;
  }
  _islandSubState = state;
  if (state === 'tabs') {
    wrap.classList.add('island-tabs-expanded');
    _renderIslandTabsFull();
  } else if (state === 'ai') {
    wrap.classList.add('island-ai-expanded');
    _renderIslandAIFull();
  }
}

/* ── Render single tab pill button in expanded left column ── */
function _renderIslandTabPill() {
  const leftCol = document.getElementById('pill-island-left');
  if (!leftCol) return;
  leftCol.innerHTML = '';
  // Hide the collapsed-mode tabs anchor
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = 'none';

  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  const activeTabId = win.activeTab;
  const activeTab = win.tabs.find(function(t) { return t.id === activeTabId; });

  // Favicon
  if (activeTab && activeTab.favicon) {
    const img = document.createElement('img');
    img.src = activeTab.favicon;
    img.style.cssText = 'width:14px;height:14px;border-radius:3px;flex-shrink:0';
    img.onerror = function() { img.style.display = 'none'; };
    leftCol.appendChild(img);
  } else {
    const globe = document.createElement('span');
    globe.innerHTML = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    leftCol.appendChild(globe);
  }
  // Truncated title
  const name = document.createElement('span');
  const title = (activeTab && activeTab.title) ? activeTab.title : 'New Tab';
  name.textContent = title.length > 20 ? title.slice(0, 18) + '\u2026' : title;
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.7rem;color:rgba(255,255,255,0.7);min-width:0';
  leftCol.appendChild(name);
  // Tab count badge
  if (win.tabs.length > 1) {
    const badge = document.createElement('span');
    badge.textContent = String(win.tabs.length);
    badge.style.cssText = 'font-size:0.6rem;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.08);border-radius:6px;padding:1px 5px;flex-shrink:0';
    leftCol.appendChild(badge);
  }
  // Click → toggle tabs sub-state
  leftCol.onclick = function(e) {
    e.stopPropagation();
    _setIslandSubState('tabs');
  };
}

/* ── Render full tab list into tabs-full container ── */
function _renderIslandTabsFull() {
  const container = document.getElementById('pill-island-tabs-full');
  if (!container) return;
  container.innerHTML = '';

  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  const activeTabId = win.activeTab;

  win.tabs.forEach(function(t) {
    const row = document.createElement('div');
    row.className = 'island-tabs-full-item' + (t.id === activeTabId ? ' active' : '');
    // Favicon
    if (t.favicon) {
      const img = document.createElement('img');
      img.src = t.favicon;
      img.onerror = function() { img.style.display = 'none'; };
      row.appendChild(img);
    } else {
      const globe = document.createElement('span');
      globe.innerHTML = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      row.appendChild(globe);
    }
    // Title
    const name = document.createElement('span');
    const title = (t.title || 'New Tab');
    name.textContent = title.length > 32 ? title.slice(0, 30) + '\u2026' : title;
    row.appendChild(name);
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'island-tabs-full-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof browseCloseTab === 'function') browseCloseTab(t.id);
      setTimeout(_renderIslandTabsFull, 50);
    });
    row.appendChild(closeBtn);
    // Click to switch tab and return to default
    row.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof browseSelectTab === 'function') browseSelectTab(t.id);
      _setIslandSubState('default');
      // Re-render the pill with the new active tab
      setTimeout(_renderIslandTabPill, 50);
    });
    container.appendChild(row);
  });
}

/* ── Render full AI panel into ai-full container ── */
function _renderIslandAIFull() {
  const container = document.getElementById('pill-island-ai-full');
  if (!container) return;
  container.innerHTML = '';
  renderAIPanelContent(container, function() {
    // On action, return to default sub-state
    _setIslandSubState('default');
  });
}

/* ── Render AI action icons in expanded right column (visual-only, whole area clickable) ── */
function _renderIslandActions() {
  const rightCol = document.getElementById('pill-island-right-col');
  if (!rightCol) return;
  rightCol.innerHTML = '';

  const iconNames = ['chatBubble', 'annotate', 'speaker', 'eye', 'microphone', 'rain'];

  iconNames.forEach(function(name) {
    const btn = document.createElement('button');
    btn.className = 'island-expanded-action';
    btn.innerHTML = icon(name, { size: 16 });
    btn.style.pointerEvents = 'none'; // Visual only — parent area handles click
    // Check if annotate is active
    if (name === 'annotate') {
      const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
      if (tab && _annotationsEnabled.get(tab.id)) btn.classList.add('active');
    }
    rightCol.appendChild(btn);
  });

  // Whole right-col is clickable → toggle AI sub-state
  rightCol.onclick = function(e) {
    e.stopPropagation();
    _setIslandSubState('ai');
  };
}

/* ── Render utility row (row 3) ── */
function _renderIslandUtilityRow() {
  const row = document.getElementById('pill-island-utility-row');
  if (!row) return;
  row.innerHTML = '';

  const buttons = [
    { iconName: 'plus', label: 'New Tab', handler: function() { _collapseIsland(); browseNewTab(); } },
    { iconName: 'close', label: 'Close', handler: function() { browseCloseTab(_browseActiveTab); setTimeout(function() { _renderIslandTabPill(); }, 50); } },
    { id: 'pill-island-bookmark-btn', iconName: 'bookmark', label: 'Save', handler: function() { browseSaveToReadingList(); _syncUtilityBookmark(); } },
    { iconName: 'moreVertical', label: 'More', handler: function() { /* future: more options menu */ } },
  ];

  buttons.forEach(function(b) {
    const btn = document.createElement('button');
    btn.className = 'island-utility-btn';
    if (b.id) btn.id = b.id;
    btn.innerHTML = icon(b.iconName, { size: 14 }) + '<span>' + b.label + '</span>';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      b.handler();
    });
    row.appendChild(btn);
  });

  // Sync bookmark active state
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

function _islandActionAnchor() {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var rect = wrap.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.bottom + 4 };
}

/* ── Island expand/collapse on click ── */
let _islandExpandedOutsideHandler = null;

export function _expandIsland() {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap || wrap.classList.contains('island-expanded')) return;
  wrap.classList.add('island-expanded');
  // Clear all inline styles on URL input that could fight the expanded CSS grid rules
  const input = document.getElementById('pill-browse-url-input');
  if (input) {
    input.style.width = '';
    input.style.maxWidth = '';
    input.style.opacity = '';
    input.style.display = '';
    input.style.overflow = '';
  }
  _moveElementsIntoIsland();
  _renderIslandTabPill();
  _renderIslandActions();
  _renderIslandUtilityRow();
  _pillSyncUrl();
  // Close on outside click
  _collapseIslandCleanup();
  _islandExpandedOutsideHandler = function(e) {
    if (wrap.contains(e.target)) return;
    _collapseIsland();
  };
  setTimeout(function() {
    document.addEventListener('mousedown', _islandExpandedOutsideHandler, true);
  }, 0);
}

export function _collapseIsland() {
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  wrap.classList.remove('island-expanded', 'island-tabs-expanded', 'island-ai-expanded');
  _islandSubState = 'default';
  _collapseIslandCleanup();
  _restoreElementsFromIsland();
  // Clear sub-state containers
  const tabsFull = document.getElementById('pill-island-tabs-full');
  const aiFull = document.getElementById('pill-island-ai-full');
  const utilityRow = document.getElementById('pill-island-utility-row');
  if (tabsFull) tabsFull.innerHTML = '';
  if (aiFull) aiFull.innerHTML = '';
  if (utilityRow) utilityRow.innerHTML = '';
  // Restore collapsed-mode tabs anchor
  const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = '';
}

function _collapseIslandCleanup() {
  if (_islandExpandedOutsideHandler) {
    document.removeEventListener('mousedown', _islandExpandedOutsideHandler, true);
    _islandExpandedOutsideHandler = null;
  }
}

// Attach click handler to pill-url-wrap for expanding
document.addEventListener('click', function(e) {
  if (Settings.get('browseTabLayout') !== 'island') return;
  const wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  // If already expanded, don't toggle — let the outside-click handler collapse
  if (wrap.classList.contains('island-expanded')) return;
  if (wrap.contains(e.target)) {
    _expandIsland();
  }
});

// Also expand when the URL input receives focus (e.g. keyboard tab)
document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('pill-browse-url-input');
  if (input) input.addEventListener('focus', function() {
    if (Settings.get('browseTabLayout') === 'island') _expandIsland();
  });
});

/* Sync the pill URL input with the active tab */
export function _pillSyncUrl() {
  const input = document.getElementById('pill-browse-url-input');
  if (!input) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isBlankNtp = tab && tab.blank;
  _browseSetUrlDisplay(input, (!isBlankNtp && tab && tab.url) ? tab.url : '');
  if (Settings.get('browseTabLayout') === 'island') {
    const pill = document.getElementById('sidebar-nav');
    if (pill) pill.classList.remove('ntp-active');
    // Update title element (visible in expanded mode)
    const titleEl = document.getElementById('pill-island-title');
    if (titleEl) titleEl.textContent = (!isBlankNtp && tab && tab.title) ? tab.title : '';
    // Hide URL input on NTP, show only tabs pill
    // Only set display when NOT expanded — expanded mode uses CSS grid visibility
    const wrap = document.getElementById('pill-url-wrap');
    const isExpanded = wrap && wrap.classList.contains('island-expanded');
    if (!isExpanded) {
      input.style.display = isBlankNtp ? 'none' : '';
    }
    const reload = document.getElementById('pill-browse-reload');
    if (reload) reload.style.display = isBlankNtp ? 'none' : '';
    const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
    if (tabsAnchor) tabsAnchor.classList.toggle('ntp-hide-divider', !!isBlankNtp);
    const newtab = document.getElementById('pill-newtab-btn');
    if (newtab) newtab.style.display = isBlankNtp ? 'none' : '';
  }
  // Safety net: ensure NTP is hidden when a non-blank tab is active in island mode
  // But keep it visible when in chat-mode morph (NTP is the chat container)
  if (!isBlankNtp) {
    const ntp = document.getElementById('browse-content')?.querySelector('.browse-ntp');
    if (ntp && !ntp.classList.contains('chat-mode')) ntp.style.display = 'none';
  }
  _updateIslandNavButtons();
  // Reapply adaptive URL bar color for the active tab
  if (typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
}

export function _updateIslandNavButtons() {
  try {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    const hasBackHistory = tab && tab.backStack && tab.backStack.length > 0;
    let hasElBack = false, hasElFwd = false;
    try { hasElBack = window._browseIsElectron && tab && tab.el && tab.el.canGoBack && tab.el.canGoBack(); } catch(e) {}
    const hasFwdHistory = tab && tab.forwardStack && tab.forwardStack.length > 0;
    try { hasElFwd = window._browseIsElectron && tab && tab.el && tab.el.canGoForward && tab.el.canGoForward(); } catch(e) {}
    const showBack = hasBackHistory || hasElBack;
    const showFwd = hasFwdHistory || hasElFwd;
    const isIsland = Settings.get('browseTabLayout') === 'island';
    // Pill bar buttons
    const pillBack = document.getElementById('pill-browse-back');
    const pillFwd = document.getElementById('pill-browse-fwd');
    if (isIsland) {
      // In island mode: always visible, dim when unavailable
      if (pillBack) { pillBack.style.display = ''; pillBack.classList.toggle('nav-disabled', !showBack); }
      if (pillFwd) { pillFwd.style.display = ''; pillFwd.classList.toggle('nav-disabled', !showFwd); }
    } else {
      if (pillBack) { pillBack.style.display = showBack ? '' : 'none'; pillBack.classList.remove('nav-disabled'); }
      if (pillFwd) { pillFwd.style.display = showFwd ? '' : 'none'; pillFwd.classList.remove('nav-disabled'); }
    }
    // Browse bar buttons
    const barBack = document.getElementById('browse-bar-back');
    const barFwd = document.getElementById('browse-bar-fwd');
    if (barBack) barBack.style.display = showBack ? '' : 'none';
    if (barFwd) barFwd.style.display = showFwd ? '' : 'none';
  } catch(e) {}
}

/* ── History dropdown on hover ── */
export let _historyDropdownEl = null;
export let _historyDropdownHideTimer = 0;

export function _showHistoryDropdown(direction, buttonEl) {
  clearTimeout(_historyDropdownHideTimer);
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;
  const stack = direction === 'back' ? (tab.backStack || []) : (tab.forwardStack || []);
  if (!stack.length) return;
  _hideHistoryDropdownNow();

  // Show most recent first
  const items = stack.slice().reverse().slice(0, 15);
  const rows = items.map(function(url, i) {
    const favImg = window.Image(_browseFaviconUrl(url))
      .frame({ width: 14, height: 14 }).cornerRadius('xs')
      .styles({flexShrink:'0'})
      .on('error', function() { this.style.display = 'none'; });
    const label = window.Text(_browseTitleFromUrl(url)).truncate();
    return window.HStack([favImg, label]).className('browse-history-dropdown-item nr-menu-item')
      .onTap(function() { _historyDropdownNavigate(direction, i + 1); _hideHistoryDropdownNow(); });
  });

  const ddView = window.VStack(rows).className('browse-history-dropdown nr-menu')
    .material('thin')
    .on('mouseenter', function() { clearTimeout(_historyDropdownHideTimer); })
    .on('mouseleave', function() { _scheduleHideHistoryDropdown(); });

  const dd = ddView.build();
  document.body.appendChild(dd);
  _historyDropdownEl = dd;
  // Position below the button
  const rect = buttonEl.getBoundingClientRect();
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = Math.max(4, rect.left - 60) + 'px';
}

export function _scheduleHideHistoryDropdown() {
  clearTimeout(_historyDropdownHideTimer);
  _historyDropdownHideTimer = setTimeout(_hideHistoryDropdownNow, 200);
}

export function _hideHistoryDropdownNow() {
  clearTimeout(_historyDropdownHideTimer);
  if (_historyDropdownEl) { _historyDropdownEl.remove(); _historyDropdownEl = null; }
}

export function _historyDropdownNavigate(direction, steps) {
  for (let i = 0; i < steps; i++) {
    if (direction === 'back') browseBack();
    else browseForward();
  }
}

/* Keydown for pill URL input — delegates to shared dropdown navigation */
export function _pillUrlKeydown(e) {
  // Delegate to the shared keydown handler which handles arrow keys, Enter on dropdown items, Escape
  if (typeof _browseUrlKeydown === 'function') {
    _browseUrlKeydown(e);
    // _browseUrlKeydown handles Enter (navigate/select), ArrowUp/Down, Escape
    // If it handled Enter or arrows, it already took action — don't duplicate
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') return;
    if (e.key === 'Escape') { e.target.blur(); return; }
  }
}

/* Show tabs inside the pill-url-dropdown */
export function _showTabsInPillDropdown() {
  const dd = document.getElementById('pill-url-dropdown');
  const wrap = document.getElementById('pill-url-wrap');
  if (!dd || !wrap) return;

  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;

  const tabs = win.tabs;
  const activeTab = win.activeTab;
  const pinnedItems = tabs.filter(function(t) { return t.pinned; });
  const unpinnedItems = tabs.filter(function(t) { return !t.pinned; }).slice().sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });

  const rowBase = { gap: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--nr-text-primary)', transition: 'background 0.1s' };

  function _ddRow(children, opts) {
    opts = opts || {};
    const row = window.HStack(children).alignment('center');
    Object.assign(row.el.style, rowBase);
    if (opts.bg) row.el.style.background = opts.bg;
    row.onHover(
      function() { row.el.style.background = 'var(--nr-bg-raised)'; },
      function() { row.el.style.background = opts.bg || 'none'; }
    );
    return row;
  }

  const globeSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  const views = [];

  // New tab row
  const newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  views.push(_ddRow([newTabIcon, window.Text('New tab')]).onTap(function() {
    if (typeof browseNewTab === 'function') browseNewTab();
    _browseUrlHideHistory();
  }));

  function renderTabView(t) {
    const isActive = t.id === activeTab;
    const title = (t.title || 'New Tab').length > 40 ? (t.title || 'New Tab').slice(0, 38) + '\u2026' : (t.title || 'New Tab');
    const favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({flexShrink:'0'})
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    const titleView = window.Text(title).flex(1).styles({minWidth:'0'}).truncate();
    var closeBtn = window.Text('\u00d7').foreground('quaternary').styles({fontSize:'1rem', lineHeight:'1', padding:'0 2px'}).opacity(0.5)
      .onHover(function() { closeBtn.el.style.opacity = '1'; }, function() { closeBtn.el.style.opacity = '0.5'; })
      .onTap(function(e) {
        e.stopPropagation();
        if (typeof browseCloseTab === 'function') browseCloseTab(t.id);
        setTimeout(_showTabsInPillDropdown, 50);
      });
    const row = _ddRow([favView, titleView, closeBtn], { bg: isActive ? 'var(--nr-bg-raised)' : '' });
    row.onTap(function() {
      if (typeof browseSelectTab === 'function') browseSelectTab(t.id);
      _browseUrlHideHistory();
    });
    return row;
  }

  if (pinnedItems.length) {
    pinnedItems.forEach(function(t) { views.push(renderTabView(t)); });
    if (unpinnedItems.length) {
      views.push(new window.View('div').styles({height:'1px', background:'var(--aether-border, var(--nr-border-default))', margin:'2px 12px'}));
    }
  }
  unpinnedItems.forEach(function(t) { views.push(renderTabView(t)); });

  AetherUI.mount(window.VStack(views), dd);
  dd.style.display = '';
  dd.classList.remove('hidden');
  wrap.classList.add('pill-dropdown-open');

  // Close when clicking outside or when webview steals focus
  _pillTabsDropdownCleanup();
  function _onOutsideClick(e) {
    if (wrap.contains(e.target) || dd.contains(e.target)) return;
    _browseUrlHideHistory();
    _pillTabsDropdownCleanup();
  }
  function _onBlur() {
    _pillTabsBlurTimer = setTimeout(function() {
      const w = document.getElementById('pill-url-wrap');
      if (w && w.classList.contains('pill-dropdown-open')) {
        _browseUrlHideHistory();
        _pillTabsDropdownCleanup();
      }
    }, 150);
  }
  _pillTabsOutsideHandler = _onOutsideClick;
  _pillTabsBlurHandler = _onBlur;
  setTimeout(function() {
    document.addEventListener('mousedown', _pillTabsOutsideHandler, true);
  }, 0);
  window.addEventListener('blur', _pillTabsBlurHandler);
}

export var _pillTabsOutsideHandler = null;
export var _pillTabsBlurHandler = null;
export var _pillTabsBlurTimer = null;

export function _pillTabsDropdownCleanup() {
  if (_pillTabsBlurTimer) { clearTimeout(_pillTabsBlurTimer); _pillTabsBlurTimer = null; }
  if (_pillTabsOutsideHandler) { document.removeEventListener('mousedown', _pillTabsOutsideHandler, true); _pillTabsOutsideHandler = null; }
  if (_pillTabsBlurHandler) { window.removeEventListener('blur', _pillTabsBlurHandler); _pillTabsBlurHandler = null; }
}

/* Pill mic button — record audio, live transcription in audio pill, final Whisper result */
export let _pillMicRecorder = null;
export let _pillMicRecognition = null;
export let _pillMicTranscript = '';
export let _pillMicLiveText = '';

export function _pillMicClick() {
  // Toggle off if already recording
  if (_pillMicRecorder) {
    if (_pillMicRecognition) { try { _pillMicRecognition.stop(); } catch(e) {} }
    _pillMicRecorder.stop();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    _pillMicRecorder = recorder;
    _pillMicTranscript = '';
    _pillMicLiveText = '';

    // Live speech recognition for real-time words in audio pill
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      _pillMicRecognition = recognition;
      recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
          else interim += event.results[i][0].transcript;
        }
        _pillMicTranscript = final;
        _pillMicLiveText = (final + interim).trim();
        _renderAudioPill();
      };
      recognition.onerror = () => {};
      recognition.onend = () => { _pillMicRecognition = null; };
      recognition.start();
    }

    _renderAudioPill();
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      _pillMicRecorder = null;
      if (_pillMicRecognition) { try { _pillMicRecognition.stop(); } catch(e) {} _pillMicRecognition = null; }
      stream.getTracks().forEach(t => t.stop());
      _renderAudioPill();
      const blob = new Blob(chunks, { type: 'audio/webm' });
      _updateAudioUnified('mic', { label: 'Transcribing…' });
      try {
        // Decode webm/opus → PCM float32 via AudioContext, then transcribe via IPC
        const arrayBuf = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const pcmFloat32 = decoded.getChannelData(0);
        audioCtx.close();
        const bytes = new Uint8Array(pcmFloat32.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        const pcmBase64 = btoa(binary);
        const data = await electronAPI.captionsTranscribe(pcmBase64, 16000);
        _clearAudioUnified('mic');
        if (data && data.text) {
          const pill = document.getElementById('pill-ai-unified');
          const rect = pill ? pill.getBoundingClientRect() : { x: window.innerWidth / 2 - 100, bottom: 60 };
          _showPanel({ anchor: { x: rect.x, y: rect.bottom + 4 }, initialValue: data.text, finalized: true });
          if (Settings.get('voiceAutoSend') === 'on') {
            setTimeout(() => {
              const popup = document.getElementById('doc-chat-ask-float');
              if (popup) _sendPopupChatMessage(popup, '');
            }, 50);
          }
        }
      } catch {
        _clearAudioUnified('mic');
      }
    };
    recorder.start();
  }).catch(() => {});
}

export function _browseRenderTabs() {
  const isIsland = Settings.get('browseTabLayout') === 'island';
  const bar = isIsland ? null : document.getElementById('browse-tabs');
  const win = window._getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const groups = win ? (win.groups || []) : [];

  // Sync the Dynamic Island tabs pill only in island mode
  if (isIsland) {
    _islandSyncTabs();
  } else {
    islandRemove('tabs');
  }

  // In island mode, only sync island — no DOM tab bar to render
  if (isIsland) {
    _pillSyncUrl();
    return;
  }
  if (!bar) return;

  const views = [];

  // Split into pinned (left) and unpinned (right)
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  pinned.forEach(t => views.push(_browseRenderTabView(t, activeTab)));
  if (pinned.length > 0 && unpinned.length > 0) {
    views.push(new window.View('div').className('browse-tab-pin-separator'));
  }

  // Sort unpinned: grouped tabs contiguous by group, ungrouped at end
  const groupedIds = new Set(groups.map(g => g.id));
  const groupOrder = groups.map(g => g.id);
  const byGroup = new Map();
  const ungrouped = [];
  for (const t of unpinned) {
    if (t.groupId != null && groupedIds.has(t.groupId)) {
      if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
      byGroup.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  }
  // In split mode, collect split tab IDs so we can render the combined pill
  const splitPanes = _browseGetSplitPanes();
  const splitTabIds = new Set(splitPanes.map(p => p.tabId));
  let splitPillInserted = false;

  // Render groups in order, then ungrouped
  for (const gid of groupOrder) {
    const group = groups.find(g => g.id === gid);
    const gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    const gc = window._BROWSE_GROUP_COLOR_MAP[group.color] || group.color;

    const chip = window.HStack([
      window.Text(group.name).className('browse-tab-group-name'),
      window.Text(String(gTabs.length)).className('browse-tab-group-count')
    ]).className('browse-tab-group-chip')
      .attr('data-group-id', gid)
      .onTap(function() { _browseToggleGroupCollapse(gid); })
      .on('contextmenu', function(e) { e.preventDefault(); _browseShowGroupContextMenu(e, gid); });
    chip.el.style.setProperty('--group-color', gc);
    views.push(chip);

    if (!group.collapsed) {
      for (const t of gTabs) {
        if (splitTabIds.has(t.id)) {
          if (!splitPillInserted) {
            views.push(_browseRenderSplitPillView(splitPanes, tabs, activeTab));
            splitPillInserted = true;
          }
        } else {
          views.push(_browseRenderTabView(t, activeTab));
        }
      }
    }
  }
  for (const t of ungrouped) {
    if (splitTabIds.has(t.id)) {
      if (!splitPillInserted) {
        views.push(_browseRenderSplitPillView(splitPanes, tabs, activeTab));
        splitPillInserted = true;
      }
    } else {
      views.push(_browseRenderTabView(t, activeTab));
    }
  }

  AetherUI.mount(window.HStack(views), bar);

  // Attach tab drag-to-reorder handlers
  bar.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  bar.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });

  // Mirror tabs into the pill bar if in browse mode (horizontal only)
  if (window._pillBrowseMode) _pillSyncTabs();
}

// ── Split pill drag (reorder + unsplit) ──

export function _splitPillDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close')) return;
  const pillEl = e.currentTarget;
  e.preventDefault();
  e.stopPropagation();

  // Check if mousedown started on an inner tab (for potential unsplit drag)
  const innerTabEl = e.target.closest('.browse-split-pill-tab');
  const innerPaneId = innerTabEl ? parseInt(innerTabEl.dataset.paneId) : null;

  const startX = e.clientX;
  const startY = e.clientY;
  let mode = null; // null = undecided, 'reorder' = pill drag, 'unsplit' = tear tab out
  let ghost = null;
  let indicator = null;
  let insertBeforeId = null;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!mode) {
      if (dist < TAB_DRAG_THRESHOLD) return;
      // If started on an inner tab and dragged vertically, unsplit that tab
      if (innerTabEl && Math.abs(dy) > Math.abs(dx) && dist > 15) {
        mode = 'unsplit';
        innerTabEl.classList.add('dragging-out');
        ghost = innerTabEl.cloneNode(true);
        ghost.className = 'browse-split-pill-tab browse-split-drag-ghost';
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;background:var(--nr-bg-surface);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:4px 8px;white-space:nowrap;font-size:0.75rem;';
        ghost.style.width = innerTabEl.offsetWidth + 'px';
        document.body.appendChild(ghost);
      } else {
        // Horizontal drag = reorder pill
        mode = 'reorder';
        pillEl.style.opacity = '0.4';
        ghost = pillEl.cloneNode(true);
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;';
        ghost.style.width = pillEl.offsetWidth + 'px';
        ghost.classList.add('browse-tab-dragging');
        document.body.appendChild(ghost);
        indicator = document.createElement('div');
        indicator.className = 'browse-tab-insert-indicator';
        const bar = _getActiveTabBar();
        if (bar) { bar.style.position = 'relative'; bar.appendChild(indicator); }
      }
    }

    if (mode === 'unsplit' && ghost) {
      ghost.style.left = (ev.clientX - innerTabEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - innerTabEl.offsetHeight / 2) + 'px';
      return;
    }

    if (mode === 'reorder' && ghost) {
      ghost.style.left = (ev.clientX - pillEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - pillEl.offsetHeight / 2) + 'px';

      const bar = _getActiveTabBar();
      if (!bar || !indicator) return;
      const barRect = bar.getBoundingClientRect();
      const nonSplitTabs = Array.from(bar.querySelectorAll('.browse-tab:not(.browse-tab-pinned)'));
      insertBeforeId = null;
      let indicatorLeft = null;

      for (const t of nonSplitTabs) {
        const rect = t.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) {
          const tid = parseInt(t.dataset.tabId);
          if (!isNaN(tid)) insertBeforeId = tid;
          indicatorLeft = rect.left - barRect.left - 1;
          break;
        }
      }
      if (indicatorLeft === null && nonSplitTabs.length > 0) {
        const lastRect = nonSplitTabs[nonSplitTabs.length - 1].getBoundingClientRect();
        indicatorLeft = lastRect.right - barRect.left + 1;
      }
      if (indicatorLeft !== null) {
        indicator.style.display = '';
        indicator.style.left = indicatorLeft + 'px';
        indicator.style.top = '4px';
        indicator.style.height = (bar.offsetHeight - 8) + 'px';
      }
    }
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (ghost) {
      if (mode === 'unsplit') {
        Motion.animate(ghost, {
          duration: 150, spring: 'smooth',
          from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.9 },
          onFinish: function() { ghost.remove(); }
        });
      } else {
        ghost.remove();
      }
    }
    if (indicator) indicator.remove();
    pillEl.style.opacity = '';
    if (innerTabEl) innerTabEl.classList.remove('dragging-out');

    if (mode === 'unsplit' && innerPaneId != null) {
      browseUnsplitPane(innerPaneId);
    } else if (mode === 'reorder' && insertBeforeId !== null) {
      const win = window._getCurrentWindow();
      if (!win) return;
      const panes = _browseGetSplitPanes();
      const splitTabIds = panes.map(p => p.tabId);
      const splitTabs = splitTabIds.map(id => win.tabs.find(t => t.id === id)).filter(Boolean);
      win.tabs = win.tabs.filter(t => !splitTabIds.includes(t.id));
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      const insertAt = toIdx !== -1 ? toIdx : win.tabs.length;
      win.tabs.splice(insertAt, 0, ...splitTabs);
      _browseRenderTabs();
      window._browseSaveTabs();
    } else if (!mode && innerTabEl) {
      // No drag — just a click, focus the pane
      if (innerPaneId != null) _browseFocusPane(innerPaneId);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Tab pin / group helpers ──

export function _browseToggleGroupCollapse(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseTogglePin(tabId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  // If pinning, remove from group
  if (tab.pinned && tab.groupId != null) {
    delete tab.groupId;
  }
  // Sort: pinned tabs first, preserve relative order otherwise
  const pinned = win.tabs.filter(t => t.pinned);
  const unpinned = win.tabs.filter(t => !t.pinned);
  win.tabs = [...pinned, ...unpinned];
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseAddTabToNewGroup(tabId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  if (!win.groups) win.groups = [];
  const gid = window._browseNextGroupId++;
  const color = window._BROWSE_GROUP_COLORS[win.groups.length % window._BROWSE_GROUP_COLORS.length];
  win.groups.push({ id: gid, name: 'New group', color, collapsed: false });
  tab.groupId = gid;
  _browseRenderTabs();
  window._browseSaveTabs();
  // Inline rename the new group chip
  setTimeout(() => {
    const chip = document.querySelector(`.browse-tab-group-chip[data-group-id="${gid}"] .browse-tab-group-name`);
    if (chip) _browseStartRenameGroup(gid, chip);
  }, 50);
}

export function browseAddTabToGroup(tabId, groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  tab.groupId = groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseRemoveTabFromGroup(tabId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  delete tab.groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseUngroupAll(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(t => { if (t.groupId === groupId) delete t.groupId; });
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseCloseGroup(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.groupId === groupId).map(t => t.id);
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  // Close all tabs in group (from end to avoid index shifting)
  for (const id of toClose.reverse()) browseCloseTab(id);
}

export function _browseChangeGroupColor(groupId, color) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.color = color;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseStartRenameGroup(groupId, nameEl) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'browse-tab-group-rename';
  input.value = group.name;
  input.style.cssText = 'width:60px;font-size:0.65rem;font-weight:600;background:transparent;border:1px solid var(--nr-border-default);border-radius:3px;color:inherit;padding:0 3px;outline:none;';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = () => {
    const val = input.value.trim() || 'New group';
    group.name = val;
    _browseRenderTabs();
    window._browseSaveTabs();
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = group.name; input.blur(); }
  });
}

var _browseGroupMenu = null;

export function _browseDismissTabContextMenu() {
  if (_browseGroupMenu) { _browseGroupMenu.dismiss(); _browseGroupMenu = null; }
}

export function _browseCloseOtherTabs(keepId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.id !== keepId && !t.pinned).map(t => t.id);
  for (const id of toClose.reverse()) browseCloseTab(id);
}

export function _browseShowGroupContextMenu(e, groupId) {
  _browseDismissTabContextMenu();
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;

  _browseGroupMenu = Menu(null, [
    { label: 'Rename', handler: function() {
      setTimeout(function() {
        const c = document.querySelector('.browse-tab-group-chip[data-group-id="' + groupId + '"] .browse-tab-group-name');
        if (c) _browseStartRenameGroup(groupId, c);
      }, 50);
    }},
    { view: function() {
      var dots = window._BROWSE_GROUP_COLORS.map(function(c) {
        var hex = window._BROWSE_GROUP_COLOR_MAP[c];
        var dot = new window.View('span').className('browse-ctx-color-dot' + (c === group.color ? ' browse-ctx-color-selected' : ''));
        dot.el.style.background = hex;
        dot.onTap(function(ev) {
          ev.stopPropagation();
          _browseDismissTabContextMenu();
          _browseChangeGroupColor(groupId, c);
        });
        return dot;
      });
      return window.HStack(dots).className('browse-ctx-colors');
    }},
    { divider: true },
    { label: 'Ungroup all', handler: function() { _browseUngroupAll(groupId); } },
    { label: 'Close group', handler: function() { _browseCloseGroup(groupId); } }
  ]);
  _browseGroupMenu.showAt(e.clientX, e.clientY);
}

// ── Tab hover tooltip ──

export const _tabHoverTimeout = null;
export const _tabHoverDismissTimeout = null;

// ── Tab drag-to-reorder ──

export let _tabDragState = null;
export const TAB_DRAG_THRESHOLD = 5;

export function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  const isVtab = false;
  let tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    // Fallback: parse from onclick
    const onclickAttr = tabEl.getAttribute('onclick') || '';
    const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId, startX: e.clientX, startY: e.clientY, tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false, isIsland: isVtab };
  const origOnclick = tabEl.getAttribute('onclick');
  tabEl.removeAttribute('onclick');
  _tabDragState._origOnclick = origOnclick;
  document.addEventListener('mousemove', _tabDragMove);
  document.addEventListener('mouseup', _tabDragEnd);
}

export function _tabDragMove(e) {
  if (!_tabDragState) return;
  const dx = e.clientX - _tabDragState.startX;
  const dy = e.clientY - _tabDragState.startY;
  if (!_tabDragState.hasMoved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;

  const isVert = _tabDragState.isIsland;
  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    // Prevent the onclick from firing
    _tabDragState.tabEl.style.pointerEvents = 'none';
    // Create ghost
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += isVert ? ' browse-vtab-dragging' : ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
    // Create insertion indicator
    const indicator = document.createElement('div');
    indicator.className = isVert ? 'browse-vtab-insert-indicator' : 'browse-tab-insert-indicator';
    const bar = _getActiveTabBar();
    if (bar) {
      bar.style.position = 'relative';
      bar.appendChild(indicator);
    }
    _tabDragState.indicator = indicator;
  }

  // Move ghost with cursor
  _tabDragState.ghostEl.style.left = (e.clientX - _tabDragState.tabEl.offsetWidth / 2) + 'px';
  _tabDragState.ghostEl.style.top = (e.clientY - _tabDragState.tabEl.offsetHeight / 2) + 'px';

  // Find nearest insertion point
  if (isVert) {
    _tabDragUpdatePosition(e.clientY);
  } else {
    _tabDragUpdatePosition(e.clientX);
  }
}

export function _tabDragUpdatePosition(clientPos) {
  if (!_tabDragState || !_tabDragState.indicator) return;
  const bar = _getActiveTabBar();
  if (!bar) return;
  const isVert = _tabDragState.isIsland;
  const win = window._getCurrentWindow();
  const dragTab = win ? win.tabs.find(t => t.id === _tabDragState.tabId) : null;
  const isDragPinned = dragTab && dragTab.pinned;

  // Only allow dragging among same region (pinned <-> pinned, unpinned <-> unpinned)
  const tabClass = isVert ? '.browse-vtab' : '.browse-tab';
  const pinnedClass = isVert ? 'browse-vtab-pinned' : 'browse-tab-pinned';
  const allTabEls = Array.from(bar.querySelectorAll(tabClass));
  const tabs = allTabEls.filter(t => {
    const isPinned = t.classList.contains(pinnedClass);
    return isDragPinned ? isPinned : !isPinned;
  });

  let insertBeforeId = null;
  const barRect = bar.getBoundingClientRect();

  if (isVert) {
    // Vertical mode: use Y axis
    let indicatorTop = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
        if (!isNaN(tid)) insertBeforeId = tid;
        indicatorTop = rect.top - barRect.top - 1;
        break;
      }
    }
    if (indicatorTop === null && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorTop = lastRect.bottom - barRect.top + 1;
    }
    _tabDragState.insertBeforeId = insertBeforeId;
    if (indicatorTop !== null) {
      _tabDragState.indicator.style.display = '';
      _tabDragState.indicator.style.top = indicatorTop + 'px';
      _tabDragState.indicator.style.left = '4px';
      _tabDragState.indicator.style.right = '4px';
      _tabDragState.indicator.style.height = '2px';
      _tabDragState.indicator.style.width = '';
    }
  } else {
    // Horizontal mode: use X axis
    let indicatorLeft = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
        if (!isNaN(tid)) insertBeforeId = tid;
        indicatorLeft = rect.left - barRect.left - 1;
        break;
      }
    }
    if (indicatorLeft === null && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorLeft = lastRect.right - barRect.left + 1;
    }
    _tabDragState.insertBeforeId = insertBeforeId;
    if (indicatorLeft !== null) {
      _tabDragState.indicator.style.display = '';
      _tabDragState.indicator.style.left = indicatorLeft + 'px';
      _tabDragState.indicator.style.top = '4px';
      _tabDragState.indicator.style.height = (bar.offsetHeight - 8) + 'px';
    }
  }
}

export function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const { tabId, hasMoved, insertBeforeId, ghostEl, indicator, tabEl, _origOnclick, isIsland: isVert } = _tabDragState;
  _tabDragState = null;

  // Clean up visual elements
  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (_origOnclick) tabEl.setAttribute('onclick', _origOnclick);

  if (hasMoved) {
    const win = window._getCurrentWindow();
    if (!win) return;
    const fromIdx = win.tabs.findIndex(t => t.id === tabId);
    if (fromIdx === -1) return;
    const [movedTab] = win.tabs.splice(fromIdx, 1);
    if (insertBeforeId !== null) {
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      if (toIdx !== -1) {
        win.tabs.splice(toIdx, 0, movedTab);
      } else {
        win.tabs.push(movedTab);
      }
    } else {
      win.tabs.push(movedTab);
    }
    // Update group membership based on neighbors (for unpinned tabs)
    if (!movedTab.pinned) {
      const newIdx = win.tabs.indexOf(movedTab);
      const prev = newIdx > 0 ? win.tabs[newIdx - 1] : null;
      const next = newIdx < win.tabs.length - 1 ? win.tabs[newIdx + 1] : null;
      // If dropped between two tabs of the same group, join that group
      if (prev && next && !prev.pinned && !next.pinned && prev.groupId != null && prev.groupId === next.groupId) {
        movedTab.groupId = prev.groupId;
      }
    }
    _browseRenderTabs();
    window._browseSaveTabs();
  } else {
    // No drag movement — treat as a normal click to select tab
    _focusBrowseTabBar();
    browseSelectTab(tabId);
  }
}

// Auto-focus NTP search input when user starts typing on a blank new-tab page
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return; // only printable characters
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  const ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

export function _browseTitleFromUrl(url) {
  if (url === 'ntp://' || url === 'ntp://newtab') return 'New Tab';
  if (url === 'chat://') return 'Chats';
  if (url === 'netrun://' || url === 'netrun:///') return 'Netrun';
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'Local File';
    return u.hostname.replace(/^www\./, '');
  } catch { return url; }
}

export function _browseFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

export function browseNavigate(input) {
  // Handle slash commands
  const cmd = (input || '').trim().toLowerCase();
  if (cmd === '/history' || cmd === 'netrun://history' || cmd === 'netrun://history/') {
    openSearchHistoryPage();
    return;
  }
  if (cmd === '/help' || cmd === 'netrun://help' || cmd === 'netrun://help/' || cmd === 'netrun://' || cmd === 'netrun:///') {
    openNetrunPage();
    return;
  }
  if (cmd === '/docs' || cmd === 'netrun://docs' || cmd === 'netrun://docs/') {
    openDocs();
    return;
  }
  if (cmd === '/upload') {
    const fi = document.getElementById('browse-pdf-file-input');
    if (fi) { fi.click(); return; }
    const tmp = document.createElement('input');
    tmp.type = 'file'; tmp.style.display = 'none';
    tmp.onchange = function() { if (tmp.files[0]) openLocalPdf(tmp.files[0]); tmp.remove(); };
    document.body.appendChild(tmp); tmp.click();
    return;
  }
  // Intercept chat:// URLs — open as a browse special page
  if (/^chat:\/\//i.test(cmd)) {
    const threadId = cmd.replace(/^chat:\/\//i, '').replace(/\/$/, '');
    if (typeof openChatPage === 'function') openChatPage(threadId || null);
    return;
  }
  // Intercept draw:// URLs — open drawing whiteboard
  if (/^draw:\/\//i.test(cmd)) {
    const drawId = cmd.replace(/^draw:\/\//i, '').replace(/\/$/, '');
    if (typeof openDrawPage === 'function') openDrawPage(drawId || undefined);
    return;
  }
  const url = _browseResolveUrl(input);
  // Track web searches (when input resolved to a Google search, not a direct URL)
  const trimmed = (input || '').trim();
  if (trimmed && url.startsWith('https://www.google.com/search?q=')) {
    _saveWebSearch(trimmed);
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) { browseNewTab(url); return; }
  // Tear down special pages if this tab was showing one
  if (tab._historyPage || tab._helpPage || tab._netrunPage || tab._chatPage) {
    // Clean up NTP morph if in chat-mode (DOM only; tab state handled below)
    if (tab._chatPage && typeof chatViewCleanupMorph === 'function') {
      const ntpMorphed = document.getElementById('browse-content')?.querySelector('.browse-ntp.chat-mode');
      if (ntpMorphed) chatViewCleanupMorph();
    }
    if (tab.el) tab.el.remove();
    tab.el = null;
    delete tab._historyPage;
    delete tab._helpPage;
    delete tab._netrunPage;
    delete tab._chatPage;
    delete tab._chatThreadId;
  }
  // Push current URL onto back stack for navigation history
  // Skip hash routes (app views like #feed, #settings) and blank/empty URLs
  if (tab.url && !tab.blank && !/^#/.test(tab.url) && !/^about:/.test(tab.url)) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    if (tab.backStack.length > 50) tab.backStack = tab.backStack.slice(-50);
    tab.forwardStack = [];
  }
  // Clear annotations on navigation
  if (_annotationsEnabled.get(tab.id)) {
    _annotationsEnabled.set(tab.id, false);
    _updateAnnotateButtonState();
  }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  _saveBrowseVisit(url, tab.title);
  if (!tab.el) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
  } else {
    _browseSetFrameAllow(tab.el, url);
    const proxied = _browseProxyUrl(url);
    tab.el.dataset.originalUrl = url;
    tab.el.src = proxied;
    if (proxied !== url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
    }
  }
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, url);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  window._browseSaveTabs();
  _browseUpdateAdBlockBtn();
  _browseUpdateNewTabPage(tab);
  _updateIslandNavButtons();
  // Update sidebar for the navigated URL
  if (typeof _initSidebarForUrl === 'function') {
    _initSidebarForUrl(url);
  }
}

window.browseNavigate = browseNavigate;

export const _BANGS = {
  g:        'https://www.google.com/search?q=%s',
  ddg:      'https://duckduckgo.com/?q=%s',
  b:        'https://www.bing.com/search?q=%s',
  yt:       'https://www.youtube.com/results?search_query=%s',
  w:        'https://en.wikipedia.org/wiki/Special:Search?search=%s',
  r:        'https://www.reddit.com/search/?q=%s',
  gh:       'https://github.com/search?q=%s',
  so:       'https://stackoverflow.com/search?q=%s',
  npm:      'https://www.npmjs.com/search?q=%s',
  mdn:      'https://developer.mozilla.org/en-US/search?q=%s',
  tw:       'https://x.com/search?q=%s',
  twitch:   'https://www.twitch.tv/search?term=%s',
  am:       'https://www.amazon.com/s?k=%s',
  maps:     'https://www.google.com/maps/search/%s',
  img:      'https://www.google.com/search?tbm=isch&q=%s',
  imdb:     'https://www.imdb.com/find/?q=%s',
  sp:       'https://open.spotify.com/search/%s',
  arxiv:    'https://arxiv.org/search/?query=%s',
  py:       'https://pypi.org/search/?q=%s',
  crates:   'https://crates.io/search?q=%s',
  hn:       'https://hn.algolia.com/?q=%s',
  wa:       'https://www.wolframalpha.com/input?i=%s',
  nix:      'https://search.nixos.org/packages?query=%s',
};

export function _browseResolveUrl(input) {
  input = (input || '').trim();
  if (!input) return 'https://www.google.com';
  // Collapse internal whitespace/newlines from multi-line pastes (e.g. URLs copied across line breaks)
  if (/^(https?|file|blob|data|aether|chat):\/\//i.test(input)) return input.replace(/\s+/g, '');
  // Resolve relative paths against the current tab's URL
  if (/^\//.test(input)) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab && tab.url) {
      try { return new URL(input, tab.url).href; } catch {}
    }
  }
  // Check for bang syntax: "!g query" or "query !g"
  const bangPrefix = input.match(/^!(\S+)\s+(.+)/);
  const bangSuffix = input.match(/^(.+)\s+!(\S+)$/);
  if (bangPrefix || bangSuffix) {
    const bang = (bangPrefix ? bangPrefix[1] : bangSuffix[2]).toLowerCase();
    const query = (bangPrefix ? bangPrefix[2] : bangSuffix[1]).trim();
    const template = _BANGS[bang];
    if (template) return template.replace('%s', encodeURIComponent(query));
  }
  // Detect domain-like input (e.g. "google.com") but not file extensions like "llama.cpp"
  const collapsed = input.replace(/\s+/g, '');
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(collapsed) && !/\.(cpp|py|js|ts|rs|go|rb|java|cs|swift|kt|c|h|hpp|md|txt|json|xml|yaml|yml|toml|csv|sql|sh|bat|exe|dll|so|o|a|wasm|log|cfg|ini|conf|env|lock|gitignore)$/i.test(collapsed)) return 'https://' + collapsed;
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

export function _browseActiveEl() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  return tab ? tab.el : null;
}

// Direction flag read by did-navigate handler to distinguish back/forward from normal nav
export let _browseNavDirection = null;
export function _clearBrowseNavDirection() { _browseNavDirection = null; }

// Hide/restore active webview so DOM popups can render on top (Electron GPU compositing fix)

export function browseBack() {
  // Intercept back nav when in Nerd Mode — disable Nerd Mode instead
  const tab0Nerd = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab0Nerd && typeof window._isNerdMode === 'function' && window._isNerdMode(tab0Nerd.id)) {
    if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab0Nerd);
    return;
  }
  // Intercept back nav when in chat mode — return to NTP
  const tab0 = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab0 && tab0._chatPage) {
    // Morphed NTP chat — un-morph
    const ntp = document.getElementById('browse-content')?.querySelector('.browse-ntp.chat-mode');
    if (ntp && typeof chatViewUnmorph === 'function') {
      chatViewUnmorph();
      return;
    }
    // Chat list page — tear down and restore NTP
    if (tab0.el) { tab0.el.remove(); tab0.el = null; }
    delete tab0._chatPage;
    delete tab0._chatThreadId;
    tab0.url = 'ntp://';
    tab0.title = 'New Tab';
    tab0.favicon = '';
    tab0.blank = true;
    tab0.backStack = [];
    tab0.forwardStack = [];
    _browseUpdateNewTabPage(tab0);
    _browseRenderTabs();
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, 'ntp://');
    return;
  }
  const el = _browseActiveEl();
  if (window._browseIsElectron && el && el.canGoBack && el.canGoBack()) { _browseNavDirection = 'back'; el.goBack(); return; }
  // Use our own history stack for non-Electron (cross-origin iframes block history.back())
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.backStack && tab.backStack.length) {
    if (!tab.forwardStack) tab.forwardStack = [];
    tab.forwardStack.push(tab.url);
    const prevUrl = tab.backStack.pop();
    tab.url = prevUrl;
    tab.title = _browseTitleFromUrl(prevUrl);
    tab.favicon = _browseFaviconUrl(prevUrl);
    if (el) {
      _browseSetFrameAllow(el, prevUrl);
      const proxied = _browseProxyUrl(prevUrl);
      el.dataset.originalUrl = prevUrl;
      el.src = proxied;
    }
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, prevUrl);
    _browseRenderTabs();
    _browseUpdateSaveBtn();
    window._browseSaveTabs();
    _updateIslandNavButtons();
    return;
  }
  // No in-tab history and no Electron back — do nothing.
  // The "Back to Feed" button (#browse-return-btn) handles app-level nav.
}

export function browseForward() {
  const el = _browseActiveEl();
  if (!el) return;
  if (window._browseIsElectron && el.canGoForward && el.canGoForward()) { _browseNavDirection = 'forward'; el.goForward(); return; }
  // Use our own history stack for non-Electron
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.forwardStack || !tab.forwardStack.length) return;
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url);
  const nextUrl = tab.forwardStack.pop();
  tab.url = nextUrl;
  tab.title = _browseTitleFromUrl(nextUrl);
  tab.favicon = _browseFaviconUrl(nextUrl);
  _browseSetFrameAllow(el, nextUrl);
  const proxied = _browseProxyUrl(nextUrl);
  el.dataset.originalUrl = nextUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, nextUrl);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  window._browseSaveTabs();
  _updateIslandNavButtons();
}

export function browseReload() {
  const el = _browseActiveEl();
  if (!el) return;
  if (window._browseIsElectron && el.reload) { el.reload(); return; }
  if (!window._browseIsElectron) { try { el.contentWindow.location.reload(); } catch(e) {} }
}

export let _browseZoomLevel = 1.0;
export let _browseZoomPanX = 0;
export let _browseZoomPanY = 0;
export let _browseZoomHideTimer = null;
export function _browseShowZoomControls() {
  const controls = document.getElementById('browse-zoom-controls');
  if (!controls) return;
  controls.style.display = 'flex';
  clearTimeout(_browseZoomHideTimer);
  _browseZoomHideTimer = setTimeout(() => { controls.style.display = 'none'; }, 1500);
}
export function browseZoom(dir) {
  if (dir === 0) { _browseZoomLevel = 1.0; _browseZoomPanX = 0; _browseZoomPanY = 0; }
  else _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + dir * 0.1));
  _browseApplyZoom();
  // Sync pinch overlay: active only when zoomed in (for pan scrolling)
  const po = document.querySelector('.browse-pinch-overlay');
  if (po) po.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
}
// focalX/focalY are cursor coords relative to the browse-content container viewport
export function _browseApplyZoom(focalX, focalY) {
  const el = _browseActiveEl();
  const container = document.getElementById('browse-content');
  if (el && container) {
    if (window._browseIsElectron && el.setZoomFactor) {
      el.setZoomFactor(_browseZoomLevel);
    } else {
      const oldZoom = parseFloat(el.dataset.zoom || '1');
      const newZoom = _browseZoomLevel;
      el.dataset.zoom = newZoom;

      // Optical zoom via CSS transform only — no layout change.
      // iframe stays 100% width/height, we scale and translate it.
      el.style.width = '100%';
      el.style.height = '100%';

      // Remove any leftover spacer from old approach
      const spacer = container.querySelector('.browse-zoom-spacer');
      if (spacer) spacer.remove();

      if (newZoom <= 1) {
        _browseZoomPanX = 0;
        _browseZoomPanY = 0;
        el.style.transform = 'none';
        el.style.transformOrigin = '';
      } else {
        // Focal-point zoom: keep content under cursor stationary
        if (focalX !== undefined && focalY !== undefined && oldZoom !== newZoom) {
          // Content coord under cursor: (panX + focalX) / oldZoom
          const contentX = (_browseZoomPanX + focalX) / oldZoom;
          const contentY = (_browseZoomPanY + focalY) / oldZoom;
          // New pan so same content coord stays under cursor
          _browseZoomPanX = contentX * newZoom - focalX;
          _browseZoomPanY = contentY * newZoom - focalY;
        }
        // Clamp pan to valid range
        const maxPanX = container.clientWidth * (newZoom - 1);
        const maxPanY = container.clientHeight * (newZoom - 1);
        _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
        _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));

        el.style.transformOrigin = '0 0';
        el.style.transform = `scale(${newZoom}) translate(${-_browseZoomPanX / newZoom}px, ${-_browseZoomPanY / newZoom}px)`;
      }
    }
  }
  const label = document.getElementById('browse-zoom-level');
  if (label) label.textContent = Math.round(_browseZoomLevel * 100) + '%';
  _browseShowZoomControls();
}

// ── Action registry ──
registerActions({
  toggleBrowseTabLayout: () => toggleBrowseTabLayout(),
  browseBack: () => browseBack(),
  browseForward: () => browseForward(),
  browseReload: () => browseReload(),
  browseZoom: (_e, arg) => browseZoom(Number(arg)),
  showHistoryDropdown: (_e, arg, el) => _showHistoryDropdown(arg, el),
  scheduleHideHistoryDropdown: () => _scheduleHideHistoryDropdown(),
});

