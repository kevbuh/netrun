// toolbar-tabs.js — TabStrip, TabItem, GroupChip, drag-to-reorder
import { tabListVersion, notifyTabsChanged, getCurrentTabs, getCurrentGroups, getActiveTabId } from '/js/toolbar/toolbar-state.js';
import { icon } from '/js/core/icons.js';

// ── Tab rendering (shared between horizontal pill bar and browse bar) ──

// Get the active tab bar element
export function _getActiveTabBar() {
  if (window._pillBrowseMode) return document.getElementById('pill-browse-tabs');
  return document.getElementById('browse-tabs');
}

// ── Tab strip render (horizontal mode) ──

export function _pillSyncTabs() {
  var pillTabs = document.getElementById('pill-browse-tabs');
  if (!pillTabs) return;
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win) { pillTabs.innerHTML = ''; return; }

  var tabs = win.tabs;
  var activeTab = win.activeTab;
  var groups = win.groups || [];
  var views = [];

  var pinned = tabs.filter(function(t) { return t.pinned; });
  var unpinned = tabs.filter(function(t) { return !t.pinned; });

  pinned.forEach(function(t) { views.push(_browseRenderTabView(t, activeTab)); });
  if (pinned.length > 0 && unpinned.length > 0) {
    views.push(new window.View('div').className('browse-tab-pin-separator'));
  }

  var groupedIds = new Set(groups.map(function(g) { return g.id; }));
  var groupOrder = groups.map(function(g) { return g.id; });
  var byGroup = new Map();
  var ungrouped = [];
  for (var i = 0; i < unpinned.length; i++) {
    var t = unpinned[i];
    if (t.groupId != null && groupedIds.has(t.groupId)) {
      if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
      byGroup.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  }

  var splitPanes = typeof window._browseGetSplitPanes === 'function' ? window._browseGetSplitPanes() : [];
  var splitTabIds = new Set(splitPanes.map(function(p) { return p.tabId; }));
  var splitPillInserted = false;

  for (var gi = 0; gi < groupOrder.length; gi++) {
    var gid = groupOrder[gi];
    var group = groups.find(function(g) { return g.id === gid; });
    var gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    var gc = window._BROWSE_GROUP_COLOR_MAP[group.color] || group.color;

    var chip = window.HStack([
      window.Text(group.name).className('browse-tab-group-name'),
      window.Text(String(gTabs.length)).className('browse-tab-group-count')
    ]).className('browse-tab-group-chip')
      .attr('data-group-id', gid)
      .onTap(function() { _browseToggleGroupCollapse(this._gid); }.bind({ _gid: gid }))
      .on('contextmenu', function(e) { e.preventDefault(); _browseShowGroupContextMenu(e, this._gid); }.bind({ _gid: gid }));
    chip.el.style.setProperty('--group-color', gc);
    views.push(chip);

    if (!group.collapsed) {
      for (var ti = 0; ti < gTabs.length; ti++) {
        if (splitTabIds.has(gTabs[ti].id)) {
          if (!splitPillInserted && typeof window._browseRenderSplitPillView === 'function') {
            views.push(window._browseRenderSplitPillView(splitPanes, tabs, activeTab));
            splitPillInserted = true;
          }
        } else {
          views.push(_browseRenderTabView(gTabs[ti], activeTab));
        }
      }
    }
  }
  for (var ui = 0; ui < ungrouped.length; ui++) {
    if (splitTabIds.has(ungrouped[ui].id)) {
      if (!splitPillInserted && typeof window._browseRenderSplitPillView === 'function') {
        views.push(window._browseRenderSplitPillView(splitPanes, tabs, activeTab));
        splitPillInserted = true;
      }
    } else {
      views.push(_browseRenderTabView(ungrouped[ui], activeTab));
    }
  }

  AetherUI.mount(window.HStack(views), pillTabs);

  pillTabs.querySelectorAll('.browse-tab').forEach(function(tabEl) {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  pillTabs.querySelectorAll('.browse-split-pill').forEach(function(pillEl) {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });
}

// ── Full tab bar render (browse bar or pill) ──

export function _browseRenderTabs() {
  var isIsland = Settings.get('browseTabLayout') === 'island';
  var bar = isIsland ? null : document.getElementById('browse-tabs');
  var win = window._getCurrentWindow();
  var tabs = win ? win.tabs : [];
  var activeTab = win ? win.activeTab : null;
  var groups = win ? (win.groups || []) : [];

  if (isIsland) {
    _islandSyncTabs();
    _pillSyncUrl();
    return;
  }
  if (!bar) return;

  var views = [];
  var pinned = tabs.filter(function(t) { return t.pinned; });
  var unpinned = tabs.filter(function(t) { return !t.pinned; });

  pinned.forEach(function(t) { views.push(_browseRenderTabView(t, activeTab)); });
  if (pinned.length > 0 && unpinned.length > 0) {
    views.push(new window.View('div').className('browse-tab-pin-separator'));
  }

  var groupedIds = new Set(groups.map(function(g) { return g.id; }));
  var groupOrder = groups.map(function(g) { return g.id; });
  var byGroup = new Map();
  var ungrouped = [];
  for (var i = 0; i < unpinned.length; i++) {
    var t = unpinned[i];
    if (t.groupId != null && groupedIds.has(t.groupId)) {
      if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
      byGroup.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  }

  var splitPanes = typeof window._browseGetSplitPanes === 'function' ? window._browseGetSplitPanes() : [];
  var splitTabIds = new Set(splitPanes.map(function(p) { return p.tabId; }));
  var splitPillInserted = false;

  for (var gi = 0; gi < groupOrder.length; gi++) {
    var gid = groupOrder[gi];
    var group = groups.find(function(g) { return g.id === gid; });
    var gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    var gc = window._BROWSE_GROUP_COLOR_MAP[group.color] || group.color;
    var chip = window.HStack([
      window.Text(group.name).className('browse-tab-group-name'),
      window.Text(String(gTabs.length)).className('browse-tab-group-count')
    ]).className('browse-tab-group-chip')
      .attr('data-group-id', gid)
      .onTap(function() { _browseToggleGroupCollapse(this._gid); }.bind({ _gid: gid }))
      .on('contextmenu', function(e) { e.preventDefault(); _browseShowGroupContextMenu(e, this._gid); }.bind({ _gid: gid }));
    chip.el.style.setProperty('--group-color', gc);
    views.push(chip);
    if (!group.collapsed) {
      for (var ti = 0; ti < gTabs.length; ti++) {
        if (splitTabIds.has(gTabs[ti].id)) {
          if (!splitPillInserted && typeof window._browseRenderSplitPillView === 'function') {
            views.push(window._browseRenderSplitPillView(splitPanes, tabs, activeTab));
            splitPillInserted = true;
          }
        } else {
          views.push(_browseRenderTabView(gTabs[ti], activeTab));
        }
      }
    }
  }
  for (var ui = 0; ui < ungrouped.length; ui++) {
    if (splitTabIds.has(ungrouped[ui].id)) {
      if (!splitPillInserted && typeof window._browseRenderSplitPillView === 'function') {
        views.push(window._browseRenderSplitPillView(splitPanes, tabs, activeTab));
        splitPillInserted = true;
      }
    } else {
      views.push(_browseRenderTabView(ungrouped[ui], activeTab));
    }
  }

  AetherUI.mount(window.HStack(views), bar);

  bar.querySelectorAll('.browse-tab').forEach(function(tabEl) {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  bar.querySelectorAll('.browse-split-pill').forEach(function(pillEl) {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });

  if (window._pillBrowseMode) _pillSyncTabs();
}

// ── _browseRenderTabView — delegate to browse-captions.js ──
// This is imported from the existing codebase
function _browseRenderTabView(t, activeTab) {
  if (typeof window._browseRenderTabView === 'function') return window._browseRenderTabView(t, activeTab);
  // Fallback minimal rendering
  var title = (t.title || 'New Tab');
  if (title.length > 25) title = title.slice(0, 23) + '\u2026';
  var isActive = t.id === activeTab;
  var tab = window.HStack([
    window.Text(title).truncate()
  ]).className('browse-tab' + (isActive ? ' active' : '') + (t.pinned ? ' browse-tab-pinned' : ''))
    .attr('data-tab-id', t.id)
    .onTap(function() { if (typeof window.browseSelectTab === 'function') window.browseSelectTab(t.id); });
  return tab;
}

// ── Island sync tabs ──

function _islandSyncTabs() {
  var bv = document.getElementById('browse-view');
  if (!bv || bv.style.display !== 'flex') { if (typeof window.islandRemove === 'function') window.islandRemove('tabs'); return; }
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  var tabs = win ? win.tabs : [];
  var activeTab = win ? win.activeTab : null;
  var active = tabs.find(function(t) { return t.id === activeTab; });
  if (!tabs.length) { if (typeof window.islandRemove === 'function') window.islandRemove('tabs'); return; }
  if (typeof window.islandUpdate === 'function') {
    window.islandUpdate('tabs', {
      type: 'tabs',
      label: tabs.length + ' tab' + (tabs.length !== 1 ? 's' : ''),
      detail: active ? active.title : 'Browse',
      favicon: active ? active.favicon : null,
      items: tabs.map(function(t) {
        return {
          id: t.id, title: t.title || 'New Tab',
          favicon: t.favicon, blank: !!t.blank, active: t.id === activeTab,
          pinned: t.pinned, groupId: t.groupId,
          lastVisited: t.lastVisited || 0,
          hasAudio: window._browseAudioTabs.has(t.id),
          muted: window._browseAudioTabs.get(t.id) && window._browseAudioTabs.get(t.id).muted
        };
      })
    });
  }
}

function _pillSyncUrl() {
  if (typeof window._pillSyncUrl === 'function') window._pillSyncUrl();
}

// ── Tab pin/group helpers ──

export function browseTogglePin(tabId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  tab.pinned = !tab.pinned;
  if (tab.pinned && tab.groupId != null) delete tab.groupId;
  var pinned = win.tabs.filter(function(t) { return t.pinned; });
  var unpinned = win.tabs.filter(function(t) { return !t.pinned; });
  win.tabs = pinned.concat(unpinned);
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseAddTabToNewGroup(tabId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab || tab.pinned) return;
  if (!win.groups) win.groups = [];
  var gid = window._browseNextGroupId++;
  var color = window._BROWSE_GROUP_COLORS[win.groups.length % window._BROWSE_GROUP_COLORS.length];
  win.groups.push({ id: gid, name: 'New group', color: color, collapsed: false });
  tab.groupId = gid;
  _browseRenderTabs();
  window._browseSaveTabs();
  setTimeout(function() {
    var c = document.querySelector('.browse-tab-group-chip[data-group-id="' + gid + '"] .browse-tab-group-name');
    if (c) _browseStartRenameGroup(gid, c);
  }, 50);
}

export function browseAddTabToGroup(tabId, groupId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab || tab.pinned) return;
  tab.groupId = groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseRemoveTabFromGroup(tabId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  delete tab.groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseToggleGroupCollapse(groupId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  group.collapsed = !group.collapsed;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseChangeGroupColor(groupId, color) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  group.color = color;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseUngroupAll(groupId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(function(t) { if (t.groupId === groupId) delete t.groupId; });
  win.groups = (win.groups || []).filter(function(g) { return g.id !== groupId; });
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseCloseGroup(groupId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var toClose = win.tabs.filter(function(t) { return t.groupId === groupId; }).map(function(t) { return t.id; });
  win.groups = (win.groups || []).filter(function(g) { return g.id !== groupId; });
  for (var i = toClose.length - 1; i >= 0; i--) {
    if (typeof window.browseCloseTab === 'function') window.browseCloseTab(toClose[i]);
  }
}

export function _browseStartRenameGroup(groupId, nameEl) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  var inputView = new window.View('input').className('browse-tab-group-rename')
    .cssText('width:60px;font-size:0.65rem;font-weight:600;background:transparent;border:1px solid var(--nr-border-default);border-radius:3px;color:inherit;padding:0 3px;outline:none;');
  inputView.el.type = 'text';
  inputView.el.value = group.name;
  var input = inputView.build();
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  var finish = function() {
    var val = input.value.trim() || 'New group';
    group.name = val;
    _browseRenderTabs();
    window._browseSaveTabs();
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = group.name; input.blur(); }
  });
}

export function _browseCloseOtherTabs(keepId) {
  var win = window._getCurrentWindow();
  if (!win) return;
  var toClose = win.tabs.filter(function(t) { return t.id !== keepId && !t.pinned; }).map(function(t) { return t.id; });
  for (var i = toClose.length - 1; i >= 0; i--) {
    if (typeof window.browseCloseTab === 'function') window.browseCloseTab(toClose[i]);
  }
}

// ── Group context menu ──

var _browseGroupMenu = null;

export function _browseDismissTabContextMenu() {
  if (_browseGroupMenu) { _browseGroupMenu.dismiss(); _browseGroupMenu = null; }
}

export function _browseShowGroupContextMenu(e, groupId) {
  _browseDismissTabContextMenu();
  var win = window._getCurrentWindow();
  if (!win) return;
  var group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;

  _browseGroupMenu = Menu(null, [
    { label: 'Rename', handler: function() {
      setTimeout(function() {
        var c = document.querySelector('.browse-tab-group-chip[data-group-id="' + groupId + '"] .browse-tab-group-name');
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

// ── Drag-to-reorder ──

var _tabDragState = null;
var TAB_DRAG_THRESHOLD = 5;

export function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  var tabEl = e.currentTarget;
  var tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    var onclickAttr = tabEl.getAttribute('onclick') || '';
    var idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId: tabId, startX: e.clientX, startY: e.clientY, tabEl: tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false, isIsland: false };
  var origOnclick = tabEl.getAttribute('onclick');
  tabEl.removeAttribute('onclick');
  _tabDragState._origOnclick = origOnclick;
  document.addEventListener('mousemove', _tabDragMove);
  document.addEventListener('mouseup', _tabDragEnd);
}

export function _tabDragMove(e) {
  if (!_tabDragState) return;
  var dx = e.clientX - _tabDragState.startX;
  var dy = e.clientY - _tabDragState.startY;
  if (!_tabDragState.hasMoved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;

  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    _tabDragState.tabEl.style.pointerEvents = 'none';
    var ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add('browse-tab-drag-source');
    var indicator = document.createElement('div');
    indicator.className = 'browse-tab-insert-indicator';
    var bar = _getActiveTabBar();
    if (bar) { bar.style.position = 'relative'; bar.appendChild(indicator); }
    _tabDragState.indicator = indicator;
  }

  _tabDragState.ghostEl.style.left = (e.clientX - _tabDragState.tabEl.offsetWidth / 2) + 'px';
  _tabDragState.ghostEl.style.top = (e.clientY - _tabDragState.tabEl.offsetHeight / 2) + 'px';

  // Find insertion point
  var bar = _getActiveTabBar();
  if (!bar || !_tabDragState.indicator) return;
  var win = window._getCurrentWindow();
  var dragTab = win ? win.tabs.find(function(t) { return t.id === _tabDragState.tabId; }) : null;
  var isDragPinned = dragTab && dragTab.pinned;
  var allTabEls = Array.from(bar.querySelectorAll('.browse-tab'));
  var tabs = allTabEls.filter(function(t) {
    var isPinned = t.classList.contains('browse-tab-pinned');
    return isDragPinned ? isPinned : !isPinned;
  });
  var barRect = bar.getBoundingClientRect();
  var insertBeforeId = null;
  var indicatorLeft = null;
  for (var i = 0; i < tabs.length; i++) {
    var rect = tabs[i].getBoundingClientRect();
    var mid = rect.left + rect.width / 2;
    if (e.clientX < mid) {
      var tid = parseInt(tabs[i].dataset.tabId);
      if (!isNaN(tid)) insertBeforeId = tid;
      indicatorLeft = rect.left - barRect.left - 1;
      break;
    }
  }
  if (indicatorLeft === null && tabs.length > 0) {
    var lastRect = tabs[tabs.length - 1].getBoundingClientRect();
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

export function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  var tabId = _tabDragState.tabId;
  var hasMoved = _tabDragState.hasMoved;
  var insertBeforeId = _tabDragState.insertBeforeId;
  var ghostEl = _tabDragState.ghostEl;
  var indicator = _tabDragState.indicator;
  var tabEl = _tabDragState.tabEl;
  var origOnclick = _tabDragState._origOnclick;
  _tabDragState = null;

  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove('browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (origOnclick) tabEl.setAttribute('onclick', origOnclick);

  if (hasMoved) {
    var win = window._getCurrentWindow();
    if (!win) return;
    var fromIdx = win.tabs.findIndex(function(t) { return t.id === tabId; });
    if (fromIdx === -1) return;
    var movedTab = win.tabs.splice(fromIdx, 1)[0];
    if (insertBeforeId !== null) {
      var toIdx = win.tabs.findIndex(function(t) { return t.id === insertBeforeId; });
      if (toIdx !== -1) win.tabs.splice(toIdx, 0, movedTab);
      else win.tabs.push(movedTab);
    } else {
      win.tabs.push(movedTab);
    }
    if (!movedTab.pinned) {
      var newIdx = win.tabs.indexOf(movedTab);
      var prev = newIdx > 0 ? win.tabs[newIdx - 1] : null;
      var next = newIdx < win.tabs.length - 1 ? win.tabs[newIdx + 1] : null;
      if (prev && next && !prev.pinned && !next.pinned && prev.groupId != null && prev.groupId === next.groupId) {
        movedTab.groupId = prev.groupId;
      }
    }
    _browseRenderTabs();
    window._browseSaveTabs();
  } else {
    if (typeof window._focusBrowseTabBar === 'function') window._focusBrowseTabBar();
    if (typeof window.browseSelectTab === 'function') window.browseSelectTab(tabId);
  }
}

// ── Split pill drag (stub — delegates to existing) ──

export function _splitPillDragStart(e) {
  // Delegate to existing implementation if available
  if (typeof window._splitPillDragStart === 'function') {
    window._splitPillDragStart(e);
  }
}

// Import Settings for layout check
import Settings from '/js/core/core-settings.js';
