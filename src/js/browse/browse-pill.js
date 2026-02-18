// browse-pill.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

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

  const views = [];

  // Split into pinned and unpinned
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  pinned.forEach(t => views.push(_browseRenderTabView(t, activeTab)));
  if (pinned.length > 0 && unpinned.length > 0) {
    views.push(new View('div').className('browse-tab-pin-separator'));
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

    const chip = HStack([
      Text(group.name).className('browse-tab-group-name'),
      Text(String(gTabs.length)).className('browse-tab-group-count')
    ]).className('browse-tab-group-chip')
      .attr('data-group-id', gid)
      .onTap(function() { _browseToggleGroupCollapse(gid); })
      .on('contextmenu', function(e) { e.preventDefault(); _browseShowGroupContextMenu(e, gid); });
    chip.el.style.setProperty('--group-color', gc);
    views.push(chip);

    if (!group.collapsed) {
      for (const t of gTabs) {
        if (splitTabIds.has(t.id)) {
          if (!splitPillInserted) { views.push(_browseRenderSplitPillView(splitPanes, tabs, activeTab)); splitPillInserted = true; }
        } else {
          views.push(_browseRenderTabView(t, activeTab));
        }
      }
    }
  }
  for (const t of ungrouped) {
    if (splitTabIds.has(t.id)) {
      if (!splitPillInserted) { views.push(_browseRenderSplitPillView(splitPanes, tabs, activeTab)); splitPillInserted = true; }
    } else {
      views.push(_browseRenderTabView(t, activeTab));
    }
  }

  AetherUI.mount(HStack(views), pillTabs);

  // Attach drag handlers
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

  // Helper: menu button with SVG icon and label
  function _menuBtn(svgHtml, label, action, opts) {
    opts = opts || {};
    var btn = new View('button');
    var icon = RawHTML(svgHtml);
    var textEl = Text(label).flex(1);
    var row = opts.trailing ? HStack([icon, textEl, opts.trailing]) : HStack([icon, textEl]);
    row.spacing(2).alignment('center');
    btn.el.appendChild(row.build());
    if (opts.disabled) btn.el.disabled = true;
    if (opts.style) Object.assign(btn.el.style, opts.style);
    btn.onTap(function() { if (action) action(); });
    return btn;
  }

  function _menuDivider() {
    return new View('div').style('height', '1px').style('background', 'var(--aether-border)').margin('2px', '0');
  }

  var items = [];

  // Windows section
  if (typeof _browseWindows !== 'undefined' && _browseWindows.length > 0) {
    var header = Text('Windows').font('caption2').foreground('quaternary')
      .style('padding', '4px 12px 2px').style('textTransform', 'uppercase').style('letterSpacing', '0.05em');
    items.push(header);

    var winSvg = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9h18" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    for (var i = 0; i < _browseWindows.length; i++) {
      (function(w) {
        var isActiveWin = w.id === _browseActiveWindow;
        var countText = Text(String(w.tabs.length)).style('marginLeft', 'auto').font('caption2').foreground('quaternary');

        var trailing = HStack([countText]);
        if (!isActiveWin && _browseWindows.length > 1) {
          var closeSpan = Text('\u00d7').style('marginLeft', '4px').opacity('0.4').cursor();
          closeSpan.onTap(function(e) { e.stopPropagation(); browseCloseWindow(w.id); _populatePillMenuMoreItems(); });
          trailing = HStack([countText, closeSpan]);
        }
        items.push(_menuBtn(winSvg, w.name, function() { browseSelectWindow(w.id); _closePillMenu(); },
          { style: isActiveWin ? { color: 'var(--nr-accent)', fontWeight: '600' } : {}, trailing: trailing }));
      })(_browseWindows[i]);
    }
    var newWinSvg = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>';
    items.push(_menuBtn(newWinSvg, 'New Window', function() { browseCreateWindow(); _closePillMenu(); }));
    items.push(_menuDivider());
  }

  // Nav buttons
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>', 'Back', function() { browseBack(); _closePillMenu(); }, { disabled: !hasTab }));
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg>', 'Forward', function() { browseForward(); _closePillMenu(); }, { disabled: !hasTab }));
  items.push(_menuBtn('<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>', 'Reload', function() { browseReload(); _closePillMenu(); }, { disabled: !hasTab }));

  items.push(_menuDivider());

  // Bookmark
  var isSaved = hasTab && typeof isPostSaved === 'function' && isPostSaved(tab.url);
  items.push(_menuBtn('<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'var(--nr-accent)' : 'none') + '" stroke="' + (isSaved ? 'var(--nr-accent)' : 'currentColor') + '" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
    isSaved ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _populatePillMenuMoreItems(); }));

  // Share
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"/></svg>',
    'Share', function() { browseShare(); _closePillMenu(); }, { disabled: !hasTab }));

  // Ad Blocker
  var adOn = Settings.get('adBlockEnabled') === 'true';
  var adTrailing = Text(adOn ? 'On' : 'Off').font('caption2').style('marginLeft', 'auto').foreground('quaternary');
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg>',
    'Ad Blocker', function() { toggleAdBlock(); _closePillMenu(); }, { style: adOn ? { color: 'var(--nr-accent)' } : {}, trailing: adTrailing }));

  // Annotate
  var annEnabled = tab && typeof _annotationsEnabled !== 'undefined' && _annotationsEnabled.get(tab.id);
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9h8M8 13h6" stroke-linecap="round"/></svg>',
    annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { toggleAnnotations(); _closePillMenu(); },
    { disabled: !hasTab, style: annEnabled ? { color: 'var(--nr-accent)' } : {} }));

  // Search History
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>',
    'Search History', function() { openSearchHistoryPage(); _closePillMenu(); }));

  // Sidebar
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'Toggle Sidebar', function() { toggleBrowseSidebar(); _closePillMenu(); }));

  items.push(_menuDivider());

  // Print
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg>',
    'Print Page', function() { browsePrintPage(); _closePillMenu(); }, { disabled: !hasTab }));

  // AI View
  items.push(_menuBtn('<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
    'AI View', function() { browseShowAIView(); _closePillMenu(); }, { disabled: !hasTab }));

  // Tab layout toggle
  var isIsland = typeof _browseTabLayout !== 'undefined' && _browseTabLayout === 'island';
  items.push(_menuBtn(isIsland
    ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 3h16v5H4V3zM4 3h16v18H4V3z"/></svg>'
    : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v18M4 3h16v18H4V3z"/></svg>',
    isIsland ? 'Horizontal Tabs' : 'Island Mode', function() { toggleBrowseTabLayout(); _closePillMenu(); }));

  AetherUI.mount(VStack(items), container);
}

function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  const pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded')) return;
  pill.classList.add('menu-expanded');
  _populatePillMenuMoreItems();
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


