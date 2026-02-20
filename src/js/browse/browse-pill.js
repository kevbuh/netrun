// browse-pill.js — Extracted from browse-tabs.js
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _annotationsEnabled, toggleAnnotations } from '/js/browse/browse-annotations.js';
import { _applyBrowseTabLayout, _browseShowGroupContextMenu, _browseToggleGroupCollapse, _splitPillDragStart, _tabDragStart, browseBack, browseForward, browseReload, toggleBrowseTabLayout } from '/js/browse/browse-island.js';
import { _browseGetSplitPanes } from '/js/browse/browse-split-panes.js';
import { _browseRenderSplitPillView, _browseRenderTabView } from '/js/browse/browse-captions.js';
import { _menuBtn, isPostSaved } from '/js/feed.js';
import { browseCloseWindow, browseCreateWindow, browseSelectWindow } from '/js/browse/browse-windows.js';
import { browsePrintPage, browseShowAIView } from '/js/browse/browse-menu.js';
import { browseSaveToReadingList, browseShare } from '/js/browse/browse-features.js';
import { openSearchHistoryPage, toggleAdBlock } from '/js/browse-urlbar.js';
import { toggleBrowseSidebar } from '/js/views.js';
import { getPillBrowseMode, setPillBrowseMode } from '/js/browse/browse-state.js';
// Depends on: browse-state.js

// ── Dynamic Island pill bar — browse mode ──

export function _islandSyncTabs() {
  const bv = document.getElementById('browse-view');
  if (!bv || bv.style.display !== 'flex') { islandRemove('tabs'); return; }
  const win = window._getCurrentWindow();
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
        hasAudio: window._browseAudioTabs.has(t.id),
        muted: window._browseAudioTabs.get(t.id) && window._browseAudioTabs.get(t.id).muted
      };
    })
  });
}

export function _getActiveTabBar() {
  if (getPillBrowseMode()) return document.getElementById('pill-browse-tabs');
  return document.getElementById('browse-tabs');
}

export function _setPillBrowseMode(enabled) {
  setPillBrowseMode(enabled);
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

export function _pillSyncTabs() {
  const pillTabs = document.getElementById('pill-browse-tabs');
  if (!pillTabs) return;
  const win = window._getCurrentWindow();
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
    views.push(new window.View('div').className('browse-tab-pin-separator'));
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

  AetherUI.mount(window.HStack(views), pillTabs);

  // Attach drag handlers
  pillTabs.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  pillTabs.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });
}

export let _pillMenuLeaveTimer = null;

export function _togglePillMenu() {
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

export function _populatePillMenuMoreItems() {
  const container = document.getElementById('pill-menu-more-items');
  const pill = document.getElementById('sidebar-nav');
  if (!container || !pill || !pill.classList.contains('browse-mode')) return;

  const tab = (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined')
    ? _browseTabs.find(function(t) { return t.id === _browseActiveTab; }) : null;
  const hasTab = tab && !tab.blank && tab.url;

  // Helper: menu button with SVG icon and label
  function _menuBtn(svgHtml, label, action, opts) {
    opts = opts || {};
    const btn = new window.View('button');
    const icon = window.RawHTML(svgHtml);
    const textEl = window.Text(label).flex(1);
    const row = opts.trailing ? window.HStack([icon, textEl, opts.trailing]) : window.HStack([icon, textEl]);
    row.spacing(2).alignment('center');
    btn.el.appendChild(row.build());
    if (opts.disabled) btn.el.disabled = true;
    if (opts.style) Object.assign(btn.el.style, opts.style);
    btn.onTap(function() { if (action) action(); });
    return btn;
  }

  function _menuDivider() {
    return new window.View('div').styles({height:'1px', background:'var(--aether-border)'}).margin('2px', '0');
  }

  const items = [];

  // Windows section
  if (typeof window._browseWindows !== 'undefined' && window._browseWindows.length > 0) {
    const header = window.Text('Windows').font('caption2').foreground('quaternary')
      .styles({padding:'4px 12px 2px', textTransform:'uppercase', letterSpacing:'0.05em'});
    items.push(header);

    const winSvg = icon('window', {size: 16});
    for (let i = 0; i < window._browseWindows.length; i++) {
      (function(w) {
        const isActiveWin = w.id === window._browseActiveWindow;
        const countText = window.Text(String(w.tabs.length)).styles({marginLeft:'auto'}).font('caption2').foreground('quaternary');

        let trailing = window.HStack([countText]);
        if (!isActiveWin && window._browseWindows.length > 1) {
          const closeSpan = window.Text('\u00d7').styles({marginLeft:'4px'}).opacity('0.4').cursor();
          closeSpan.onTap(function(e) { e.stopPropagation(); browseCloseWindow(w.id); _populatePillMenuMoreItems(); });
          trailing = window.HStack([countText, closeSpan]);
        }
        items.push(_menuBtn(winSvg, w.name, function() { browseSelectWindow(w.id); _closePillMenu(); },
          { style: isActiveWin ? { color: 'var(--nr-accent)', fontWeight: '600' } : {}, trailing: trailing }));
      })(window._browseWindows[i]);
    }
    const newWinSvg = icon('plus', {size: 16});
    items.push(_menuBtn(newWinSvg, 'New Window', function() { browseCreateWindow(); _closePillMenu(); }));
    items.push(_menuDivider());
  }

  // Nav buttons
  items.push(_menuBtn(icon('chevronLeft', {size: 16, strokeWidth: '1.5'}), 'Back', function() { browseBack(); _closePillMenu(); }, { disabled: !hasTab }));
  items.push(_menuBtn(icon('chevronRight', {size: 16, strokeWidth: '1.5'}), 'Forward', function() { browseForward(); _closePillMenu(); }, { disabled: !hasTab }));
  items.push(_menuBtn(icon('reloadFilled', {size: 16}), 'Reload', function() { browseReload(); _closePillMenu(); }, { disabled: !hasTab }));

  items.push(_menuDivider());

  // Bookmark
  const isSaved = hasTab && typeof isPostSaved === 'function' && isPostSaved(tab.url);
  items.push(_menuBtn(icon('bookmark', {size: 16, fill: isSaved ? 'var(--nr-accent)' : 'none', stroke: isSaved ? 'var(--nr-accent)' : 'currentColor'}),
    isSaved ? 'Saved' : 'Save to Reading List', function() { browseSaveToReadingList(); _populatePillMenuMoreItems(); }));

  // Share
  items.push(_menuBtn(icon('share', {size: 16, strokeWidth: '1.5'}),
    'Share', function() { browseShare(); _closePillMenu(); }, { disabled: !hasTab }));

  // Ad Blocker
  const adOn = Settings.get('adBlockEnabled') === 'true';
  const adTrailing = window.Text(adOn ? 'On' : 'Off').font('caption2').styles({marginLeft:'auto'}).foreground('quaternary');
  items.push(_menuBtn(icon('shield', {size: 16, strokeWidth: '1.5'}),
    'Ad Blocker', function() { toggleAdBlock(); _closePillMenu(); }, { style: adOn ? { color: 'var(--nr-accent)' } : {}, trailing: adTrailing }));

  // Annotate
  const annEnabled = tab && typeof _annotationsEnabled !== 'undefined' && _annotationsEnabled.get(tab.id);
  items.push(_menuBtn(icon('annotate', {size: 16}),
    annEnabled ? 'Remove Annotations' : 'Annotate Page', function() { toggleAnnotations(); _closePillMenu(); },
    { disabled: !hasTab, style: annEnabled ? { color: 'var(--nr-accent)' } : {} }));

  // Search History
  items.push(_menuBtn(icon('clock', {size: 16}),
    'Search History', function() { openSearchHistoryPage(); _closePillMenu(); }));

  // Sidebar
  items.push(_menuBtn(icon('sidebarToggle', {size: 16}),
    'Toggle Sidebar', function() { toggleBrowseSidebar(); _closePillMenu(); }));

  items.push(_menuDivider());

  // Print
  items.push(_menuBtn(icon('print', {size: 16, strokeWidth: '1.5'}),
    'Print Page', function() { browsePrintPage(); _closePillMenu(); }, { disabled: !hasTab }));

  // AI View
  items.push(_menuBtn(icon('eye', {size: 16, strokeWidth: '1.5'}),
    'AI View', function() { browseShowAIView(); _closePillMenu(); }, { disabled: !hasTab }));

  // Tab layout toggle
  const isIsland = Settings.get('browseTabLayout') === 'island';
  items.push(_menuBtn(isIsland ? icon('horizontalTabs', {size: 16}) : icon('islandTabs', {size: 16}),
    isIsland ? 'Horizontal Tabs' : 'Island Mode', function() { toggleBrowseTabLayout(); _closePillMenu(); }));

  AetherUI.mount(window.VStack(items), container);
}

export function _openPillMenuHover() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
  const pill = document.getElementById('sidebar-nav');
  if (!pill || pill.classList.contains('menu-expanded')) return;
  pill.classList.add('menu-expanded');
  _populatePillMenuMoreItems();
}

export function _closePillMenuHover() {
  _pillMenuLeaveTimer = setTimeout(() => {
    _closePillMenu();
  }, 200);
}

export function _cancelPillMenuClose() {
  if (_pillMenuLeaveTimer) { clearTimeout(_pillMenuLeaveTimer); _pillMenuLeaveTimer = null; }
}

export function _pillMenuOutsideClick(e) {
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
  document.removeEventListener('mousedown', _pillMenuOutsideClick);
}

// ── Action registry ──
registerActions({
  _togglePillMenu: () => _togglePillMenu(),
  _openPillMenuHover: () => _openPillMenuHover(),
  _closePillMenuHover: () => _closePillMenuHover(),
  _cancelPillMenuClose: () => _cancelPillMenuClose(),
});

