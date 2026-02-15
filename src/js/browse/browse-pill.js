// browse-pill.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Dynamic Island pill bar — browse mode ──

function _islandSyncTabs() {
  const bv = document.getElementById('browse-view');
  if (!bv || bv.style.display !== 'flex') { islandRemove('tabs'); return; }
  const win = _getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const active = tabs.find(function(t) { return t.id === activeTab; });
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
  if (enabled) {
    if (pill) { pill.classList.add('browse-mode'); pill.classList.remove('island-mode'); }
    if (tabRow) tabRow.style.display = 'none';
    const bar = document.getElementById('browse-bar');
    if (bar) bar.style.display = '';
    // Hide More and sidebar toggle — redundant in horizontal pill mode
    const moreBtn = document.getElementById('browse-more-btn');
    const sidebarToggle = document.getElementById('browse-sidebar-toggle');
    if (moreBtn) moreBtn.style.display = 'none';
    if (sidebarToggle) sidebarToggle.style.display = 'none';
    _pillSyncTabs();
  } else {
    if (pill) { pill.classList.remove('browse-mode'); pill.classList.remove('island-mode'); }
    const pillTabs = document.getElementById('pill-browse-tabs');
    if (pillTabs) pillTabs.innerHTML = '';
    // Restore More and sidebar toggle
    const moreBtn = document.getElementById('browse-more-btn');
    const sidebarToggle = document.getElementById('browse-sidebar-toggle');
    if (moreBtn) moreBtn.style.display = '';
    if (sidebarToggle) sidebarToggle.style.display = '';
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

  // Window list button removed — #pill-window-list-btn in the pill bar handles this

  pillTabs.innerHTML = html;
  _syncWindowListBadge();

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
    _populatePillMenuMoreItems();
    setTimeout(() => document.addEventListener('mousedown', _pillMenuOutsideClick), 0);
  } else {
    document.removeEventListener('mousedown', _pillMenuOutsideClick);
  }
}

function _populatePillMenuMoreItems() {
  const container = document.getElementById('pill-menu-more-items');
  const pill = document.getElementById('sidebar-nav');
  if (!container || !pill || !pill.classList.contains('browse-mode')) return;

  const tab = (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined')
    ? _browseTabs.find(function(t) { return t.id === _browseActiveTab; }) : null;
  const hasTab = tab && !tab.blank && tab.url;

  let html = '';

  // Nav buttons
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="browseBack();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg> Back</button>';
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="browseForward();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg> Forward</button>';
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="browseReload();_closePillMenu()"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Reload</button>';

  // Divider
  html += '<div style="height:1px;background:var(--aether-border);margin:2px 0"></div>';

  // Bookmark
  var isSaved = hasTab && typeof isPostSaved === 'function' && isPostSaved(tab.url);
  html += '<button onclick="browseSaveToReadingList();_populatePillMenuMoreItems()"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'var(--nr-accent)' : 'none') + '" stroke="' + (isSaved ? 'var(--nr-accent)' : 'currentColor') + '" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg> ' + (isSaved ? 'Saved' : 'Save to Reading List') + '</button>';

  // Share
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="browseShare();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"/></svg> Share</button>';

  // Ad Blocker
  var adOn = localStorage.getItem('adBlockEnabled') === 'true';
  html += '<button onclick="toggleAdBlock();_closePillMenu()" style="' + (adOn ? 'color:var(--nr-accent)' : '') + '"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg> Ad Blocker <span style="margin-left:auto;font-size:0.7rem;color:var(--aether-text-dimmest)">' + (adOn ? 'On' : 'Off') + '</span></button>';

  // Annotate
  var annEnabled = tab && typeof _annotationsEnabled !== 'undefined' && _annotationsEnabled.get(tab.id);
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="toggleAnnotations();_closePillMenu()" style="' + (annEnabled ? 'color:var(--nr-accent)' : '') + '"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9h8M8 13h6" stroke-linecap="round"/></svg> ' + (annEnabled ? 'Remove Annotations' : 'Annotate Page') + '</button>';

  // Search History
  html += '<button onclick="openSearchHistoryPage();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg> Search History</button>';

  // Sidebar
  html += '<button onclick="toggleBrowseSidebar();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg> Toggle Sidebar</button>';

  // Divider
  html += '<div style="height:1px;background:var(--aether-border);margin:2px 0"></div>';

  // Print
  html += '<button ' + (hasTab ? '' : 'disabled') + ' onclick="browsePrintPage();_closePillMenu()"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg> Print Page</button>';

  // Tab layout toggle
  var isIsland = typeof _browseTabLayout !== 'undefined' && _browseTabLayout === 'island';
  html += '<button onclick="toggleBrowseTabLayout();_closePillMenu()">' + (isIsland
    ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 3h16v5H4V3zM4 3h16v18H4V3z"/></svg> Horizontal Tabs'
    : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v18M4 3h16v18H4V3z"/></svg> Island Mode')
  + '</button>';

  container.innerHTML = html;
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
  if (e.target.closest('#pill-menu-btn') || e.target.closest('#pill-nav-icons') || e.target.closest('#pill-browse-hamburger')) return;
  _closePillMenu();
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

function _closePillMenu() {
  const pill = document.getElementById('sidebar-nav');
  if (pill) pill.classList.remove('menu-expanded');
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

// ── Window list dropdown ──

function _syncWindowListBadge() {
  const badge = document.getElementById('pill-window-list-badge');
  if (badge) badge.textContent = _browseWindows.length;
}

let _windowListOutsideHandler = null;

function toggleWindowListDropdown(btnEl) {
  const dd = document.getElementById('browse-window-list-dd');
  if (!dd) return;
  if (dd.style.display !== 'none') {
    _closeWindowListDropdown();
    return;
  }
  _renderWindowListDropdown();
  dd.style.display = '';
  // Position below the button
  const rect = btnEl.getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.left = Math.max(4, rect.left - 80) + 'px';
  // Ensure it doesn't overflow right edge
  requestAnimationFrame(() => {
    const ddRect = dd.getBoundingClientRect();
    if (ddRect.right > window.innerWidth - 4) {
      dd.style.left = (window.innerWidth - ddRect.width - 4) + 'px';
    }
  });
  // Close on outside click
  _windowListOutsideHandler = function(e) {
    if (dd.contains(e.target) || e.target.closest('.browse-window-list-btn')) return;
    _closeWindowListDropdown();
  };
  setTimeout(() => document.addEventListener('mousedown', _windowListOutsideHandler), 0);
}

function _closeWindowListDropdown() {
  const dd = document.getElementById('browse-window-list-dd');
  if (dd) dd.style.display = 'none';
  if (_windowListOutsideHandler) {
    document.removeEventListener('mousedown', _windowListOutsideHandler);
    _windowListOutsideHandler = null;
  }
}

function _renderWindowListDropdown() {
  const dd = document.getElementById('browse-window-list-dd');
  if (!dd) return;
  let html = '';
  for (const w of _browseWindows) {
    const isActive = w.id === _browseActiveWindow;
    const tabCount = w.tabs.length;
    html += '<div class="browse-window-list-item' + (isActive ? ' active' : '') + '" data-win-id="' + w.id + '" onclick="browseSelectWindow(' + w.id + ');_closeWindowListDropdown()">' +
      '<span class="browse-window-list-name">' + escapeHtml(w.name) + '</span>' +
      '<span class="browse-window-list-count">' + tabCount + ' tab' + (tabCount !== 1 ? 's' : '') + '</span>' +
      '<button class="browse-window-list-close" onclick="event.stopPropagation();browseCloseWindow(' + w.id + ');_renderWindowListDropdown()" title="Close window">&times;</button>' +
    '</div>';
  }
  html += '<div class="browse-window-list-new" onclick="browseCreateWindow();_closeWindowListDropdown()">' +
    '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>' +
    '<span>New Window</span>' +
  '</div>';
  dd.innerHTML = html;
}

