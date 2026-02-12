// browse-pill.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Dynamic Island pill bar — browse mode ──

function _islandSyncTabs() {
  var bv = document.getElementById('browse-view');
  if (!bv || bv.style.display !== 'flex') { islandRemove('tabs'); return; }
  var win = _getCurrentWindow();
  var tabs = win ? win.tabs : [];
  var activeTab = win ? win.activeTab : null;
  var active = tabs.find(function(t) { return t.id === activeTab; });
  if (!tabs.length) { islandRemove('tabs'); return; }
  islandUpdate('tabs', {
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
        hasAudio: _browseAudioTabs.has(t.id),
        muted: _browseAudioTabs.get(t.id) && _browseAudioTabs.get(t.id).muted
      };
    })
  });
}

function _getActiveTabBar() {
  if (_pillBrowseMode) return document.getElementById('pill-browse-tabs');
  return document.getElementById('browse-tabs');
}

function _setPillBrowseMode(enabled) {
  _pillBrowseMode = enabled;
  const pill = document.getElementById('sidebar-nav');
  const tabRow = document.getElementById('browse-tab-row');
  const dragPill = document.getElementById('drag-pill');
  if (enabled) {
    if (pill) { pill.classList.add('browse-mode'); pill.classList.remove('island-mode'); }
    if (tabRow) tabRow.style.display = 'none';
    if (dragPill) dragPill.style.display = 'none';
    const bar = document.getElementById('browse-bar');
    if (bar) bar.style.display = '';
    _pillSyncTabs();
  } else {
    if (pill) { pill.classList.remove('browse-mode'); pill.classList.remove('island-mode'); }
    if (dragPill) dragPill.style.display = '';
    const pillTabs = document.getElementById('pill-browse-tabs');
    if (pillTabs) pillTabs.innerHTML = '';
    _closePillMenu();
    _applyBrowseTabLayout();
  }
}

function _pillSyncTabs() {
  const pillTabs = document.getElementById('pill-browse-tabs');
  if (!pillTabs) return;
  const win = _getCurrentWindow();
  if (!win) { pillTabs.innerHTML = ''; return; }

  const tabs = win.tabs;
  const activeTab = win.activeTab;
  const groups = win.groups || [];

  let html = '';

  // Split into pinned and unpinned
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  html += pinned.map(t => _browseRenderTabHtml(t, activeTab)).join('');
  if (pinned.length > 0 && unpinned.length > 0) {
    html += '<div class="browse-tab-pin-separator"></div>';
  }

  // Sort unpinned: grouped then ungrouped
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

  const splitPanes = _browseGetSplitPanes();
  const splitTabIds = new Set(splitPanes.map(p => p.tabId));
  let splitPillInserted = false;

  for (const gid of groupOrder) {
    const group = groups.find(g => g.id === gid);
    const gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    const gc = _BROWSE_GROUP_COLOR_MAP[group.color] || group.color;
    html += '<div class="browse-tab-group-chip" style="--group-color:' + gc + '" data-group-id="' + gid + '" onclick="_browseToggleGroupCollapse(' + gid + ')" oncontextmenu="event.preventDefault();_browseShowGroupContextMenu(event,' + gid + ')">' +
      '<span class="browse-tab-group-name">' + escapeHtml(group.name) + '</span>' +
      '<span class="browse-tab-group-count">' + gTabs.length + '</span>' +
    '</div>';
    if (!group.collapsed) {
      for (const t of gTabs) {
        if (splitTabIds.has(t.id)) {
          if (!splitPillInserted) { html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab); splitPillInserted = true; }
        } else {
          html += _browseRenderTabHtml(t, activeTab);
        }
      }
    }
  }
  for (const t of ungrouped) {
    if (splitTabIds.has(t.id)) {
      if (!splitPillInserted) { html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab); splitPillInserted = true; }
    } else {
      html += _browseRenderTabHtml(t, activeTab);
    }
  }

  // Window switcher at the end (next to overview button)
  if (_browseWindows.length > 1) {
    const winIdx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
    html += '<div class="browse-window-switcher" data-window-idx="' + winIdx + '" onclick="toggleBrowseTabOverview()">' +
      '<button class="browse-window-arrow up ' + (winIdx === 0 ? 'disabled' : '') + '" onclick="event.stopPropagation();switchWindowUp()" title="Previous window">' +
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg>' +
      '</button>' +
      '<button class="browse-window-arrow down ' + (winIdx === _browseWindows.length - 1 ? 'disabled' : '') + '" onclick="event.stopPropagation();switchWindowDown()" title="Next window">' +
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg>' +
      '</button>' +
    '</div>';
  }

  pillTabs.innerHTML = html;

  // Attach event listeners
  pillTabs.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  pillTabs.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });
}

let _pillMenuLeaveTimer = null;

function _togglePillMenu() {
  const pill = document.getElementById('sidebar-nav');
  if (!pill) return;
  const opening = !pill.classList.contains('menu-expanded');
  pill.classList.toggle('menu-expanded');
  if (opening) {
    setTimeout(() => document.addEventListener('mousedown', _pillMenuOutsideClick), 0);
  } else {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
  }
}

function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  const pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded')) return;
  pill.classList.add('menu-expanded');
}

function _closePillMenuHover() {
  _pillMenuLeaveTimer = setTimeout(() => {
    _closePillMenu();
  }, 200);
}

function _cancelPillMenuClose() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
}

function _pillMenuOutsideClick(e) {
  const pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('menu-expanded')) {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
    return;
  }
  if (e.target.closest('#pill-menu-btn') || e.target.closest('#pill-nav-icons')) return;
  _closePillMenu();
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

function _closePillMenu() {
  const pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.remove('menu-expanded');
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

