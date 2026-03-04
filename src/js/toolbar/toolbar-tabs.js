// toolbar-tabs.js — TabStrip, TabItem, GroupChip, drag-to-reorder
import { tabListVersion, notifyTabsChanged, getCurrentTabs, getCurrentGroups, getActiveTabId } from '/js/toolbar/toolbar-state.js';
import { icon } from '/js/core/icons.js';
import { browseSelectTab, browseCloseTab } from '/js/browse/browse-passwords.js';

// ── Tab rendering ──

// Get the active tab bar element
export function _getActiveTabBar() {
  return document.getElementById('browse-tabs');
}

// ── Full tab bar render ──

export function _browseRenderTabs() {
  notifyTabsChanged();
  _islandSyncTabs();
  _pillSyncUrl();
}

// ── Island sync tabs ──

function _islandSyncTabs() {
  const bv = document.getElementById('browse-view');
  if (!bv || bv.style.display !== 'flex') { if (typeof window.islandRemove === 'function') window.islandRemove('tabs'); return; }
  const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const active = tabs.find(function(t) { return t.id === activeTab; });
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
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  tab.pinned = !tab.pinned;
  if (tab.pinned && tab.groupId != null) delete tab.groupId;
  const pinned = win.tabs.filter(function(t) { return t.pinned; });
  const unpinned = win.tabs.filter(function(t) { return !t.pinned; });
  win.tabs = pinned.concat(unpinned);
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseAddTabToNewGroup(tabId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab || tab.pinned) return;
  if (!win.groups) win.groups = [];
  const gid = window._browseNextGroupId++;
  const color = window._BROWSE_GROUP_COLORS[win.groups.length % window._BROWSE_GROUP_COLORS.length];
  win.groups.push({ id: gid, name: 'New group', color: color, collapsed: false });
  tab.groupId = gid;
  _browseRenderTabs();
  window._browseSaveTabs();
  setTimeout(function() {
    const c = document.querySelector('.browse-tab-group-chip[data-group-id="' + gid + '"] .browse-tab-group-name');
    if (c) _browseStartRenameGroup(gid, c);
  }, 50);
}

export function browseAddTabToGroup(tabId, groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab || tab.pinned) return;
  tab.groupId = groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function browseRemoveTabFromGroup(tabId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === tabId; });
  if (!tab) return;
  delete tab.groupId;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseToggleGroupCollapse(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  group.collapsed = !group.collapsed;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseChangeGroupColor(groupId, color) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  group.color = color;
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseUngroupAll(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(function(t) { if (t.groupId === groupId) delete t.groupId; });
  win.groups = (win.groups || []).filter(function(g) { return g.id !== groupId; });
  _browseRenderTabs();
  window._browseSaveTabs();
}

export function _browseCloseGroup(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(function(t) { return t.groupId === groupId; }).map(function(t) { return t.id; });
  win.groups = (win.groups || []).filter(function(g) { return g.id !== groupId; });
  for (let i = toClose.length - 1; i >= 0; i--) {
    browseCloseTab(toClose[i]);
  }
}

export function _browseStartRenameGroup(groupId, nameEl) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;
  const inputView = new window.View('input').className('browse-tab-group-rename')
    .padding('0', '3px').cornerRadius('xs')
    .attr('type', 'text')
    .styles({ width: '60px', fontSize: '0.65rem', fontWeight: '600', background: 'transparent', border: '1px solid var(--nr-border-default)', color: 'inherit', outline: 'none' });
  inputView.el.value = group.name;
  const input = inputView.el;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = function() {
    const val = input.value.trim() || 'New group';
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
  const win = window._getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(function(t) { return t.id !== keepId && !t.pinned; }).map(function(t) { return t.id; });
  for (let i = toClose.length - 1; i >= 0; i--) {
    browseCloseTab(toClose[i]);
  }
}

// ── Group context menu ──

let _browseGroupMenu = null;

export function _browseDismissTabContextMenu() {
  if (_browseGroupMenu) { _browseGroupMenu.dismiss(); _browseGroupMenu = null; }
}

export function _browseShowGroupContextMenu(e, groupId) {
  _browseDismissTabContextMenu();
  const win = window._getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(function(g) { return g.id === groupId; });
  if (!group) return;

  _browseGroupMenu = Menu(null, [
    { label: 'Rename', handler: function() {
      setTimeout(function() {
        const c = document.querySelector('.browse-tab-group-chip[data-group-id="' + groupId + '"] .browse-tab-group-name');
        if (c) _browseStartRenameGroup(groupId, c);
      }, 50);
    }},
    { view: function() {
      const dots = window._BROWSE_GROUP_COLORS.map(function(c) {
        const hex = window._BROWSE_GROUP_COLOR_MAP[c];
        const dot = new window.View('span').className('browse-ctx-color-dot' + (c === group.color ? ' browse-ctx-color-selected' : ''));
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

let _tabDragState = null;
const TAB_DRAG_THRESHOLD = 5;

export function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  let tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    const onclickAttr = tabEl.getAttribute('onclick') || '';
    const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId: tabId, startX: e.clientX, startY: e.clientY, tabEl: tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false, isIsland: false };
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

  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    _tabDragState.tabEl.style.pointerEvents = 'none';
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add('browse-tab-drag-source');
    const indicator = document.createElement('div');
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
  const win = window._getCurrentWindow();
  const dragTab = win ? win.tabs.find(function(t) { return t.id === _tabDragState.tabId; }) : null;
  const isDragPinned = dragTab && dragTab.pinned;
  const allTabEls = Array.from(bar.querySelectorAll('.browse-tab'));
  const tabs = allTabEls.filter(function(t) {
    const isPinned = t.classList.contains('browse-tab-pinned');
    return isDragPinned ? isPinned : !isPinned;
  });
  const barRect = bar.getBoundingClientRect();
  let insertBeforeId = null;
  let indicatorLeft = null;
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i].getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (e.clientX < mid) {
      const tid = parseInt(tabs[i].dataset.tabId);
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

export function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const tabId = _tabDragState.tabId;
  const hasMoved = _tabDragState.hasMoved;
  const insertBeforeId = _tabDragState.insertBeforeId;
  const ghostEl = _tabDragState.ghostEl;
  const indicator = _tabDragState.indicator;
  const tabEl = _tabDragState.tabEl;
  const origOnclick = _tabDragState._origOnclick;
  _tabDragState = null;

  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove('browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (origOnclick) tabEl.setAttribute('onclick', origOnclick);

  if (hasMoved) {
    const win = window._getCurrentWindow();
    if (!win) return;
    const fromIdx = win.tabs.findIndex(function(t) { return t.id === tabId; });
    if (fromIdx === -1) return;
    const movedTab = win.tabs.splice(fromIdx, 1)[0];
    if (insertBeforeId !== null) {
      const toIdx = win.tabs.findIndex(function(t) { return t.id === insertBeforeId; });
      if (toIdx !== -1) win.tabs.splice(toIdx, 0, movedTab);
      else win.tabs.push(movedTab);
    } else {
      win.tabs.push(movedTab);
    }
    if (!movedTab.pinned) {
      const newIdx = win.tabs.indexOf(movedTab);
      const prev = newIdx > 0 ? win.tabs[newIdx - 1] : null;
      const next = newIdx < win.tabs.length - 1 ? win.tabs[newIdx + 1] : null;
      if (prev && next && !prev.pinned && !next.pinned && prev.groupId != null && prev.groupId === next.groupId) {
        movedTab.groupId = prev.groupId;
      }
    }
    _browseRenderTabs();
    window._browseSaveTabs();
  } else {
    if (typeof window._focusBrowseTabBar === 'function') window._focusBrowseTabBar();
    browseSelectTab(tabId);
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
