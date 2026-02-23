// toolbar-island.js — Island expand/collapse, sub-states, tab pill, actions, utility
import Settings from '/js/core/core-settings.js';
import { islandExpanded, islandSubState, isNtp, notifyTabsChanged } from '/js/toolbar/toolbar-state.js';
import { _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _pillSyncUrl } from '/js/toolbar/toolbar-url.js';
import { _browseRenderTabs, _getActiveTabBar } from '/js/toolbar/toolbar-tabs.js';
import { icon } from '/js/core/icons.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';

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

// ── Layout apply ──

export function _applyBrowseTabLayout() {
  var bar = document.getElementById('browse-bar');
  var pill = document.getElementById('sidebar-nav');
  var browseView = document.getElementById('browse-view');
  var browseOpen = browseView && browseView.style.display === 'flex';
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
  _pillSyncUrl();
  _collapseIslandCleanup();
  _islandExpandedOutsideHandler = function(e) {
    if (wrap.contains(e.target)) return;
    if (_islandTabsDropdownEl && _islandTabsDropdownEl.contains(e.target)) return;
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
  var actionsRow = document.getElementById('pill-island-actions-row');
  if (aiFull) aiFull.innerHTML = '';
  if (utilityRow) utilityRow.innerHTML = '';
  if (actionsRow) actionsRow.remove();
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
  var aiPill = document.getElementById('pill-ai-unified');
  if (aiPill) aiPill.style.display = 'none';
}

function _restoreElementsFromIsland() {
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

  var globeSvg = '<svg style="width:16px;height:16px;opacity:0.4;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var plusSvg = '<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';

  var rows = win.tabs.map(function(t) {
    var isActive = t.id === activeTabId;
    var favHtml = t.favicon
      ? '<img class="island-vtab-item" src="' + t.favicon.replace(/"/g, '&quot;') + '" style="width:16px;height:16px;border-radius:3px;flex-shrink:0;object-fit:contain" onerror="this.style.display=\'none\'">'
      : globeSvg;
    var title = t.title || 'New Tab';
    var truncTitle = title.length > 20 ? title.slice(0, 18) + '\u2026' : title;
    var favView = t.favicon
      ? window.Image(t.favicon).frame({ width: 16, height: 16 }).cornerRadius('xs').styles({ flexShrink: '0' })
          .on('error', function() { this.style.display = 'none'; })
      : window.RawHTML(globeSvg);
    var nameView = window.Text(truncTitle).className('island-vtab-item-title');
    var closeBtn = window.Text('\u00d7').className('island-vtab-item-close').attr('title', 'Close tab')
      .onTap(function(e) {
        e.stopPropagation();
        browseCloseTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
    return window.HStack([favView, nameView, closeBtn])
      .className('island-vtab-item' + (isActive ? ' active' : ''))
      .onTap(function(e) {
        e.stopPropagation();
        browseSelectTab(t.id);
        setTimeout(_renderIslandTabPill, 50);
      });
  });

  // Divider + New tab row
  rows.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 10px' }));
  rows.push(window.HStack([window.RawHTML(plusSvg), window.Text('New tab')])
    .className('island-vtab-new')
    .onTap(function(e) {
      e.stopPropagation();
      _collapseIsland();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  AetherUI.mount(window.VStack(rows), leftCol);
  leftCol.onclick = null;
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
  var newTabIcon = window.RawHTML('<svg style="width:14px;height:14px;flex-shrink:0;opacity:0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>');
  rows.push(new window.View('div').styles({ height: '1px', background: 'var(--nr-border-default)', margin: '2px 10px' }));
  rows.push(window.HStack([newTabIcon, window.Text('New tab')])
    .className('island-tabs-full-item')
    .onTap(function() {
      _closeIslandTabsDropdown();
      _collapseIsland();
      if (typeof window.browseNewTab === 'function') window.browseNewTab();
    }));

  var wrapRect = wrap.getBoundingClientRect();
  var panel = window.VStack(rows)
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
  var dd = panel.el;
  document.body.appendChild(dd);
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
  var centerCol = document.getElementById('pill-island-center');
  if (!centerCol) return;
  // Remove any previous actions/pageinfo content
  var actionsId = 'pill-island-actions-row';
  var existing = document.getElementById(actionsId);
  if (existing) existing.remove();

  var V = window.View, T = window.Text, H = window.HStack, VS = window.VStack;
  var rows = [];

  // ── Page info section ──
  var pageInfo = typeof window._getPageInfoState === 'function' ? window._getPageInfoState() : {};
  var meta = pageInfo.meta || {};
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  var activeTab = win ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;

  // Title
  var title = (activeTab && activeTab.title) ? activeTab.title : '';
  if (title) {
    rows.push(T(title).styles({ fontSize: '0.82rem', fontWeight: '600', color: 'var(--nr-text-primary)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }));
  }

  // URL / domain
  var url = (activeTab && activeTab.url) ? activeTab.url : '';
  if (url && url !== 'about:blank') {
    var domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}
    if (domain) {
      rows.push(T(domain).styles({ fontSize: '0.7rem', color: 'var(--nr-text-tertiary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }));
    }
  }

  // Meta info pills
  var pills = [];
  if (meta.author) pills.push(meta.author);
  if (pageInfo.label) pills.push(pageInfo.label);
  if (meta.wordCount > 0) {
    var mins = Math.max(1, Math.round(meta.wordCount / 238));
    pills.push(mins + ' min read');
  }
  if (pageInfo.badges) pills.push(pageInfo.badges);
  if (meta.location) pills.push(meta.location);

  if (pills.length) {
    var pillViews = pills.map(function(p) {
      return T(p).styles({ fontSize: '0.65rem', color: 'var(--nr-text-tertiary)',
        background: 'var(--nr-bg-raised)', borderRadius: '6px', padding: '2px 6px',
        whiteSpace: 'nowrap' });
    });
    rows.push(H(pillViews).styles({ gap: '4px', flexWrap: 'wrap', marginTop: '4px' }));
  }

  // Description
  if (meta.description) {
    var desc = meta.description.length > 100 ? meta.description.slice(0, 98) + '\u2026' : meta.description;
    rows.push(T(desc).styles({ fontSize: '0.68rem', color: 'var(--nr-text-quaternary)',
      lineHeight: '1.35', marginTop: '4px', display: '-webkit-box',
      WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }));
  }


  var container = VS(rows).styles({ gap: '2px', alignItems: 'flex-start', padding: '0 4px' });
  container.id(actionsId);
  centerCol.appendChild(container.el);
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
    _expandIsland();
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
  _togglePillMenu: function() { _togglePillMenu(); },
  _openPillMenuHover: function() { _openPillMenuHover(); },
  _closePillMenuHover: function() { _closePillMenuHover(); },
  _cancelPillMenuClose: function() { _cancelPillMenuClose(); },
});
