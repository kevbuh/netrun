// toolbar-island.js — Island expand/collapse, sub-states, tab pill, actions, utility
import Settings from '/js/core/core-settings.js';
import { islandExpanded, islandSubState, isNtp, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _pillSyncUrl } from '/js/toolbar/toolbar-url.js';
import { _browseRenderTabs, _getActiveTabBar, _pillSyncTabs } from '/js/toolbar/toolbar-tabs.js';
import { icon } from '/js/core/icons.js';

// ── Island pill position sync ──

export function _syncIslandPillPosition() {
  var pill = document.getElementById('sidebar-nav');
  var island = document.getElementById('pill-island');
  var urlWrap = document.getElementById('pill-url-wrap');
  if (!pill || !island || !urlWrap) return;
  var isIsland = pill.classList.contains('island-mode');
  var isNtpActive = pill.classList.contains('ntp-active');
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  var tabsPill = tabsAnchor ? tabsAnchor.querySelector('.pill-island[data-island-id="tabs"]') :
    island.querySelector('.pill-island[data-island-id="tabs"]');
  if (isIsland) {
    if (island.parentElement !== urlWrap) urlWrap.insertBefore(island, urlWrap.firstChild);
    if (isNtpActive && tabsPill && tabsPill.parentElement !== island) island.insertBefore(tabsPill, island.firstChild);
    if (!isNtpActive && tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  } else {
    var navIcons = document.getElementById('pill-nav-icons');
    if (island.parentElement === urlWrap) pill.insertBefore(island, navIcons);
    if (tabsPill && tabsAnchor && tabsPill.parentElement !== tabsAnchor) tabsAnchor.insertBefore(tabsPill, tabsAnchor.firstChild);
  }
}

// ── Layout toggle ──

export function toggleBrowseTabLayout() {
  var newLayout = Settings.get('browseTabLayout') === 'island' ? 'horizontal' : 'island';
  Settings.set('browseTabLayout', newLayout);
  var browseView = document.getElementById('browse-view');
  var browseOpen = browseView && browseView.style.display !== 'none';
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
  var tabRow = document.getElementById('browse-tab-row');
  var bar = document.getElementById('browse-bar');
  var pill = document.getElementById('sidebar-nav');
  var browseView = document.getElementById('browse-view');
  var browseOpen = browseView && browseView.style.display === 'flex';
  if (Settings.get('browseTabLayout') === 'island') {
    if (tabRow) tabRow.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (browseOpen) {
      if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
      _pillSyncUrl();
      _syncIslandPillPosition();
      var pillTabs = document.getElementById('pill-browse-tabs');
      if (pillTabs) pillTabs.innerHTML = '';
      if (typeof window._islandSyncTabs === 'function') window._islandSyncTabs();
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
  } else {
    _collapseIsland();
    _syncIslandPillPosition();
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

// ── Pill browse mode ──

export function _setPillBrowseMode(enabled) {
  if (typeof window.setPillBrowseMode === 'function') window.setPillBrowseMode(enabled);
  else window._pillBrowseMode = enabled;
  var pill = document.getElementById('sidebar-nav');
  var tabRow = document.getElementById('browse-tab-row');
  if (enabled) {
    if (pill) { pill.classList.add('browse-mode'); pill.classList.remove('island-mode'); }
    if (tabRow) tabRow.style.display = 'none';
    var bar = document.getElementById('browse-bar');
    if (bar) bar.style.display = '';
    var hideIds = ['browse-more-btn', 'browse-sidebar-toggle',
      'browse-adblock-btn', 'browse-doh-btn', 'browse-downloads-btn', 'browse-save-btn',
      'browse-share-btn', 'browse-annotate-btn', 'browse-search-history-btn', 'browse-cc-btn'];
    hideIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    _pillSyncTabs();
  } else {
    if (pill) { pill.classList.remove('browse-mode'); pill.classList.remove('island-mode'); }
    var pillTabs = document.getElementById('pill-browse-tabs');
    if (pillTabs) pillTabs.innerHTML = '';
    var restoreIds = ['browse-more-btn', 'browse-sidebar-toggle',
      'browse-adblock-btn', 'browse-doh-btn', 'browse-downloads-btn', 'browse-save-btn',
      'browse-share-btn', 'browse-annotate-btn', 'browse-search-history-btn', 'browse-cc-btn'];
    restoreIds.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = ''; });
    _closePillMenu();
    _applyBrowseTabLayout();
  }
}

// ── Expand/collapse ──

var _islandExpandedOutsideHandler = null;
var _islandExpandedBlurHandler = null;

export function _expandIsland() {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap || wrap.classList.contains('island-expanded')) return;
  wrap.classList.add('island-expanded');
  islandExpanded.value = true;
  var input = document.getElementById('pill-browse-url-input');
  if (input) { input.style.width = ''; input.style.maxWidth = ''; input.style.opacity = ''; input.style.display = ''; input.style.overflow = ''; }
  _moveElementsIntoIsland();
  _renderIslandTabPill();
  _renderIslandActions();
  _renderIslandUtilityRow();
  _pillSyncUrl();
  _collapseIslandCleanup();
  _islandExpandedOutsideHandler = function(e) {
    if (wrap.contains(e.target)) return;
    _collapseIsland();
  };
  _islandExpandedBlurHandler = function() { _collapseIsland(); };
  setTimeout(function() {
    document.addEventListener('mousedown', _islandExpandedOutsideHandler, true);
    window.addEventListener('blur', _islandExpandedBlurHandler);
  }, 0);
}

export function _collapseIsland() {
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  wrap.classList.remove('island-expanded', 'island-ai-expanded');
  islandExpanded.value = false;
  islandSubState.value = 'default';
  _closeIslandTabsDropdown();
  _collapseIslandCleanup();
  _restoreElementsFromIsland();
  var aiFull = document.getElementById('pill-island-ai-full');
  var utilityRow = document.getElementById('pill-island-utility-row');
  if (aiFull) aiFull.innerHTML = '';
  if (utilityRow) utilityRow.innerHTML = '';
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = '';
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

function _moveElementsIntoIsland() {
  var navRow = document.getElementById('pill-island-nav-row');
  if (navRow) {
    var back = document.getElementById('pill-browse-back');
    var reload = document.getElementById('pill-browse-reload');
    var fwd = document.getElementById('pill-browse-fwd');
    if (back && back.parentElement !== navRow) navRow.appendChild(back);
    if (reload && reload.parentElement !== navRow) navRow.appendChild(reload);
    if (fwd && fwd.parentElement !== navRow) navRow.appendChild(fwd);
  }
  var aiPill = document.getElementById('pill-ai-unified');
  if (aiPill) aiPill.style.display = 'none';
}

function _restoreElementsFromIsland() {
  var pillBar = document.getElementById('sidebar-nav');
  if (!pillBar) return;
  var navRow = document.getElementById('pill-island-nav-row');
  var back = document.getElementById('pill-browse-back');
  var fwd = document.getElementById('pill-browse-fwd');
  var pillUrl = document.getElementById('pill-browse-url');
  if (back && navRow && navRow.contains(back)) {
    if (pillUrl) pillBar.insertBefore(back, pillUrl);
    else pillBar.appendChild(back);
  }
  if (fwd && navRow && navRow.contains(fwd)) {
    if (pillUrl) pillBar.insertBefore(fwd, pillUrl.nextSibling);
    else pillBar.appendChild(fwd);
  }
  var reload = document.getElementById('pill-browse-reload');
  var urlWrap = document.getElementById('pill-url-wrap');
  var closeBtn = document.getElementById('pill-close-tab-btn');
  if (reload && navRow && navRow.contains(reload) && urlWrap) {
    if (closeBtn) urlWrap.insertBefore(reload, closeBtn);
    else urlWrap.appendChild(reload);
  }
  var aiPill = document.getElementById('pill-ai-unified');
  if (aiPill) aiPill.style.display = '';
  var leftCol = document.getElementById('pill-island-left');
  if (leftCol) { leftCol.innerHTML = ''; leftCol.onclick = null; }
  var rightCol = document.getElementById('pill-island-right-col');
  if (rightCol) { rightCol.innerHTML = ''; rightCol.onclick = null; }
}

// ── Sub-state management ──

function _setIslandSubState(state) {
  var wrap = document.getElementById('pill-url-wrap');
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
  var leftCol = document.getElementById('pill-island-left');
  if (!leftCol) return;
  var tabsAnchor = document.getElementById('pill-island-tabs-anchor');
  if (tabsAnchor) tabsAnchor.style.display = 'none';

  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) { leftCol.innerHTML = ''; return; }
  var activeTabId = win.activeTab;
  var activeTab = win.tabs.find(function(t) { return t.id === activeTabId; });

  var globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var favView;
  if (activeTab && activeTab.favicon) {
    favView = window.Image(activeTab.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
      .on('error', function() { this.style.display = 'none'; });
  } else {
    favView = window.RawHTML(globeSvg);
  }
  var title = (activeTab && activeTab.title) ? activeTab.title : 'New Tab';
  var nameView = window.Text(title.length > 20 ? title.slice(0, 18) + '\u2026' : title)
    .truncate().styles({ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', minWidth: '0' });
  var children = [favView, nameView];
  if (win.tabs.length > 1) {
    children.push(window.Text(String(win.tabs.length)).styles({ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', padding: '1px 5px', flexShrink: '0' }));
  }
  AetherUI.mount(window.HStack(children), leftCol);
  leftCol.onclick = function(e) {
    e.stopPropagation();
    _toggleIslandTabsDropdown();
  };
}

// ── Tabs dropdown (below capsule) ──

var _islandTabsDropdownEl = null;
var _islandTabsOutsideHandler = null;

function _toggleIslandTabsDropdown() {
  if (_islandTabsDropdownEl) {
    _closeIslandTabsDropdown();
    return;
  }
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs || !win.tabs.length) return;
  var activeTabId = win.activeTab;
  var globeSvg = '<svg style="width:14px;height:14px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  var rows = win.tabs.map(function(t) {
    var favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    var title = (t.title || 'New Tab');
    var nameView = window.Text(title.length > 32 ? title.slice(0, 30) + '\u2026' : title)
      .flex(1).styles({ minWidth: '0' }).truncate();
    var closeBtn = window.Text('\u00d7').className('island-tabs-full-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        if (typeof window.browseCloseTab === 'function') window.browseCloseTab(t.id);
        setTimeout(function() { _closeIslandTabsDropdown(); _toggleIslandTabsDropdown(); }, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-tabs-full-item' + (t.id === activeTabId ? ' active' : ''))
      .onTap(function(e) {
        e.stopPropagation();
        if (typeof window.browseSelectTab === 'function') window.browseSelectTab(t.id);
        _closeIslandTabsDropdown();
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  // New tab row
  var newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  rows.push(new window.View('div').styles({ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '2px 10px' }));
  rows.push(window.HStack([newTabIcon, window.Text('New tab')])
    .className('island-tabs-full-item')
    .onTap(function() {
      _closeIslandTabsDropdown();
      _collapseIsland();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  var wrapRect = wrap.getBoundingClientRect();
  var dd = document.createElement('div');
  dd.className = 'island-tabs-dropdown';
  dd.style.cssText = 'position:fixed;z-index:10001;';
  dd.style.left = Math.round(wrapRect.left) + 'px';
  dd.style.top = Math.round(wrapRect.bottom + 4) + 'px';
  dd.style.minWidth = Math.round(wrapRect.width) + 'px';
  document.body.appendChild(dd);
  AetherUI.mount(window.VStack(rows), dd);
  _islandTabsDropdownEl = dd;

  setTimeout(function() {
    _islandTabsOutsideHandler = function(e) {
      if (dd.contains(e.target)) return;
      var leftCol = document.getElementById('pill-island-left');
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
  var container = document.getElementById('pill-island-ai-full');
  if (!container) return;
  container.innerHTML = '';
  if (typeof window.renderAIPanelContent === 'function') {
    window.renderAIPanelContent(container, function() { _setIslandSubState('default'); });
  }
}

// ── Render action icons ──

function _renderIslandActions() {
  var rightCol = document.getElementById('pill-island-right-col');
  if (!rightCol) return;
  var iconNames = ['chatBubble', 'annotate', 'speaker', 'eye', 'microphone', 'rain'];
  var btns = iconNames.map(function(name) {
    var btn = new window.View('button').className('island-expanded-action').html(icon(name, { size: 16 }))
      .styles({ pointerEvents: 'none' });
    if (name === 'annotate') {
      var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
      if (tab && typeof window._annotationsEnabled !== 'undefined' && window._annotationsEnabled.get(tab.id)) btn.className('active');
    }
    return btn;
  });
  AetherUI.mount(window.HStack(btns), rightCol);
  rightCol.onclick = function(e) { e.stopPropagation(); _setIslandSubState('ai'); };
}

// ── Render utility row ──

function _renderIslandUtilityRow() {
  var row = document.getElementById('pill-island-utility-row');
  if (!row) return;
  var buttons = [
    { iconName: 'plus', label: 'New Tab', handler: function() { _collapseIsland(); if (typeof window.browseNewTab === 'function') window.browseNewTab(); } },
    { iconName: 'close', label: 'Close', handler: function() { if (typeof window.browseCloseTab === 'function') window.browseCloseTab(_browseActiveTab); setTimeout(_renderIslandTabPill, 50); } },
    { id: 'pill-island-bookmark-btn', iconName: 'bookmark', label: 'Save', handler: function() { if (typeof window.browseSaveToReadingList === 'function') window.browseSaveToReadingList(); _syncUtilityBookmark(); } },
  ];
  var btnViews = buttons.map(function(b) {
    var view = new window.View('button').className('island-utility-btn')
      .add(window.RawHTML(icon(b.iconName, { size: 14 })), window.Text(b.label))
      .onTap(function(e) { e.stopPropagation(); b.handler(); });
    if (b.id) view.el.id = b.id;
    return view;
  });
  AetherUI.mount(window.HStack(btnViews), row);
  _syncUtilityBookmark();
}

function _syncUtilityBookmark() {
  var btn = document.getElementById('pill-island-bookmark-btn');
  if (!btn) return;
  var tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
  if (tab && !tab.blank && tab.url && typeof window.isPostSaved === 'function' && window.isPostSaved(tab.url)) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

// ── Pill menu toggle ──

var _pillMenuLeaveTimer = null;

export function _togglePillMenu() {
  var pill = document.getElementById('sidebar-nav');
  if (!pill) return;
  // In browse mode, delegate to the more menu dropdown instead of expanding the pill
  if (pill.classList.contains('browse-mode')) {
    if (typeof window.toggleBrowseMoreMenu === 'function') window.toggleBrowseMoreMenu();
    return;
  }
  var opening = !pill.classList.contains('menu-expanded');
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
  var pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('menu-expanded')) {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
    return;
  }
  if (e.target.closest('#pill-menu-btn') || e.target.closest('#pill-nav-icons') || e.target.closest('#pill-browse-hamburger')) return;
  _closePillMenu();
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _closePillMenu() {
  var pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.remove('menu-expanded');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

export function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  var pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded') || pill.classList.contains('browse-mode')) return;
  pill.classList.add('menu-expanded');
}

export function _closePillMenuHover() {
  _pillMenuLeaveTimer = setTimeout(function() { _closePillMenu(); }, 200);
}

export function _cancelPillMenuClose() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
}

// ── Click handler for capsule expand ──

document.addEventListener('click', function(e) {
  if (Settings.get('browseTabLayout') !== 'island') return;
  var wrap = document.getElementById('pill-url-wrap');
  if (!wrap) return;
  if (wrap.classList.contains('island-expanded')) return;
  var pill = document.getElementById('sidebar-nav');
  if (pill && pill.classList.contains('ntp-active')) return;
  if (wrap.contains(e.target)) _expandIsland();
});

document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('pill-browse-url-input');
  if (input) input.addEventListener('focus', function() {
    if (Settings.get('browseTabLayout') === 'island') _expandIsland();
  });
});

// Auto-focus NTP search input when typing
document.addEventListener('keydown', function(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return;
  var browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  var ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  var active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  var input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

// ── Action registry ──
registerActions({
  toggleBrowseTabLayout: function() { toggleBrowseTabLayout(); },
  _togglePillMenu: function() { _togglePillMenu(); },
  _openPillMenuHover: function() { _openPillMenuHover(); },
  _closePillMenuHover: function() { _closePillMenuHover(); },
  _cancelPillMenuClose: function() { _cancelPillMenuClose(); },
});
