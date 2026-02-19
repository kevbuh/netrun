// browse-split-panes.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

// ── Split Pane System ──

export function _browseGetSplitPanes() {
  const win = _getCurrentWindow();
  return win ? (win.splitPanes || []) : [];
}

export function _browseSetSplitPanes(panes) {
  const win = _getCurrentWindow();
  if (win) win.splitPanes = panes;
}

export function _browseGetFocusedPane() {
  const win = _getCurrentWindow();
  return win ? (win.focusedPane || null) : null;
}

export function _browseSetFocusedPane(paneId) {
  const win = _getCurrentWindow();
  if (win) win.focusedPane = paneId;
}

export function _browsePaneForTab(tabId) {
  const panes = _browseGetSplitPanes();
  return panes.find(p => p.tabId === tabId) || null;
}

export function _browseIsSplitMode() {
  return _browseGetSplitPanes().length >= 2;
}

export function browseSplitTab(tabId, position) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;

  let panes = _browseGetSplitPanes();

  // Already in a pane? Just focus it
  const existing = panes.find(p => p.tabId === tabId);
  if (existing) {
    _browseFocusPane(existing.id);
    return;
  }

  if (panes.length === 0) {
    // Enter split mode: create pane for current active tab + pane for tabId
    const activeTab = win.activeTab;
    if (activeTab === tabId) {
      // Splitting the active tab — pick another tab for the second pane, or create a new blank tab
      const otherTab = win.tabs.find(t => t.id !== tabId);
      if (!otherTab) {
        // Only one tab — create a new blank tab for the second pane
        const newId = _browseNextTabId++;
        const newTab = { id: newId, url: '', title: 'New Tab', favicon: '', el: null, blank: true };
        win.tabs.push(newTab);
        panes = [
          { id: _browseNextPaneId++, tabId: tabId, width: 50 },
          { id: _browseNextPaneId++, tabId: newId, width: 50 }
        ];
      } else {
        panes = [
          { id: _browseNextPaneId++, tabId: tabId, width: 50 },
          { id: _browseNextPaneId++, tabId: otherTab.id, width: 50 }
        ];
        _browseEnsureTabFrame(otherTab);
      }
    } else {
      panes = [
        { id: _browseNextPaneId++, tabId: activeTab, width: 50 },
        { id: _browseNextPaneId++, tabId: tabId, width: 50 }
      ];
    }
  } else if (panes.length < 3) {
    // Add a new pane, redistribute evenly
    const newPane = { id: _browseNextPaneId++, tabId: tabId, width: 0 };
    panes.push(newPane);
    const w = Math.floor(100 / panes.length);
    panes.forEach((p, i) => p.width = i === panes.length - 1 ? 100 - w * (panes.length - 1) : w);
  } else {
    // Max 3 panes — replace focused pane's tab
    const focused = panes.find(p => p.id === _browseGetFocusedPane()) || panes[panes.length - 1];
    focused.tabId = tabId;
  }

  _browseSetSplitPanes(panes);
  _browseSetFocusedPane(panes.find(p => p.tabId === tabId)?.id || panes[0].id);
  // Ensure frame exists for the tab
  _browseEnsureTabFrame(tab);
  _browseRebuildSplitLayout();
  _browseRenderTabs();
  _browseSaveTabs();
}

export function _browseEnsureTabFrame(tab) {
  if (tab.el) return;
  const container = document.getElementById('browse-content');
  if (!container) return;
  if (tab.blank) return;
  if (tab._historyPage) {
    const el = document.createElement('div');
    el.id = 'browse-history-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
    return;
  }
  if (tab._helpPage) {
    const el = document.createElement('div');
    el.id = 'browse-help-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);';
    container.appendChild(el);
    tab.el = el;
    _renderHelpPage(el);
    return;
  }
  if (tab.paper && tab.contentType) {
    const el = document.createElement('div');
    el.id = 'browse-paper-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;overflow:hidden;';
    container.appendChild(el);
    tab.el = el;
    return;
  }
  if (!tab.url) return;
  tab.el = _browseCreateFrame(tab.id, tab.url);
  container.appendChild(tab.el);
  _browseBindFrame(tab);
  tab.deferred = false;
}

export function browseUnsplitPane(paneId) {
  const panes = _browseGetSplitPanes();
  const idx = panes.findIndex(p => p.id === paneId);
  if (idx === -1) return;
  panes.splice(idx, 1);

  if (panes.length <= 1) {
    // If 1 or 0 panes left, exit split mode
    const lastTabId = panes.length === 1 ? panes[0].tabId : null;
    _browseSetSplitPanes([]);
    _browseSetFocusedPane(null);
    browseExitSplitMode();
    if (lastTabId) browseSelectTab(lastTabId);
  } else {
    // Redistribute widths
    const w = Math.floor(100 / panes.length);
    panes.forEach((p, i) => p.width = i === panes.length - 1 ? 100 - w * (panes.length - 1) : w);
    _browseSetSplitPanes(panes);
    // Focus another pane if the focused one was removed
    if (_browseGetFocusedPane() === paneId) {
      _browseSetFocusedPane(panes[0].id);
      const win = _getCurrentWindow();
      if (win) win.activeTab = panes[0].tabId;
    }
    _browseRebuildSplitLayout();
  }
  _browseRenderTabs();
  _browseSaveTabs();
}

export function browseExitSplitMode() {
  const container = document.getElementById('browse-content');
  if (!container) return;

  // Remove pane wrappers and dividers
  container.querySelectorAll('.browse-split-pane, .browse-split-divider').forEach(el => {
    // Move children (frames) back to container before removing wrapper
    if (el.classList.contains('browse-split-pane')) {
      while (el.firstChild) {
        if (!el.firstChild.classList?.contains('browse-pane-close')) {
          container.appendChild(el.firstChild);
        } else {
          el.firstChild.remove();
        }
      }
    }
    el.remove();
  });

  // Reset container style
  container.style.display = '';

  _browseSetSplitPanes([]);
  _browseSetFocusedPane(null);

  // Show only the active tab
  const win = _getCurrentWindow();
  if (win) {
    win.tabs.forEach(t => {
      if (t.el) {
        t.el.style.display = t.id === win.activeTab ? '' : 'none';
        // Restore absolute positioning for non-split mode
        if (t.el.tagName === 'IFRAME' || t.el.tagName === 'WEBVIEW') {
          t.el.style.position = 'absolute';
          t.el.style.top = '0';
          t.el.style.left = '0';
          t.el.style.width = '100%';
          t.el.style.height = '100%';
        } else if (t.el.style) {
          t.el.style.position = 'absolute';
          t.el.style.top = '0';
          t.el.style.left = '0';
        }
      }
    });
  }
  _browseSaveTabs();
}

export function _browseRebuildSplitLayout() {
  const container = document.getElementById('browse-content');
  if (!container) return;
  const win = _getCurrentWindow();
  if (!win) return;
  const panes = _browseGetSplitPanes();
  if (panes.length < 2) return;

  // Remove existing pane wrappers and dividers (move frames back first)
  container.querySelectorAll('.browse-split-pane').forEach(wrapper => {
    while (wrapper.firstChild) {
      if (!wrapper.firstChild.classList?.contains('browse-pane-close')) {
        container.appendChild(wrapper.firstChild);
      } else {
        wrapper.firstChild.remove();
      }
    }
    wrapper.remove();
  });
  container.querySelectorAll('.browse-split-divider').forEach(d => d.remove());

  // Set flex display
  container.style.display = 'flex';

  // Hide all tab frames first
  win.tabs.forEach(t => { if (t.el) t.el.style.display = 'none'; });

  const focusedPaneId = _browseGetFocusedPane();

  // Build pane wrappers
  panes.forEach(function(pane, i) {
    var tab = win.tabs.find(function(t) { return t.id === pane.tabId; });
    var wrapper = new View('div');
    wrapper.className('browse-split-pane' + (pane.id === focusedPaneId ? ' focused' : ''));
    wrapper.attr('data-pane', pane.id);
    wrapper.styles({ width: pane.width + '%', height: '100%', position: 'relative', overflow: 'hidden' });

    // Close button
    var closeBtn = Button('\u00d7').className('browse-pane-close');
    closeBtn.el.title = 'Close split pane';
    closeBtn.onTap(function(e) { e.stopPropagation(); browseUnsplitPane(pane.id); });
    wrapper.el.appendChild(closeBtn.el);

    // Move tab's frame into wrapper
    if (tab && tab.el) {
      tab.el.style.display = '';
      tab.el.style.position = 'relative';
      tab.el.style.width = '100%';
      tab.el.style.height = '100%';
      tab.el.style.top = '';
      tab.el.style.left = '';
      wrapper.el.appendChild(tab.el);
    }

    // Click to focus
    wrapper.on('mousedown', function() {
      if (_browseGetFocusedPane() !== pane.id) {
        _browseFocusPane(pane.id);
      }
    });

    container.appendChild(wrapper.el);

    // Insert divider between panes (not after last)
    if (i < panes.length - 1) {
      var divider = document.createElement('div');
      divider.className = 'browse-split-divider';
      divider.dataset.leftPane = pane.id;
      divider.dataset.rightPane = panes[i + 1].id;
      _browseAttachDividerDrag(divider, pane.id, panes[i + 1].id);
      container.appendChild(divider);
    }
  });

  // Update active tab to focused pane's tab
  const focusedPane = panes.find(p => p.id === focusedPaneId);
  if (focusedPane) {
    win.activeTab = focusedPane.tabId;
  }
}

export function _browseFocusPane(paneId) {
  const panes = _browseGetSplitPanes();
  const pane = panes.find(p => p.id === paneId);
  if (!pane) return;

  _browseSetFocusedPane(paneId);
  const win = _getCurrentWindow();
  if (win) win.activeTab = pane.tabId;

  // Update visual focus indicator
  const container = document.getElementById('browse-content');
  if (container) {
    container.querySelectorAll('.browse-split-pane').forEach(el => {
      el.classList.toggle('focused', el.dataset.pane == paneId);
    });
  }

  // Update URL bar
  const tab = win?.tabs.find(t => t.id === pane.tabId);
  const urlInput = document.getElementById('browse-url-input');
  if (tab) _browseSetUrlDisplay(urlInput, tab._historyPage ? 'netrun://history' : tab._helpPage ? 'netrun://help' : (tab.url || ''));
  _browseUpdateSaveBtn();
  _browseRenderTabs();
}

export function _browseAttachDividerDrag(divider, leftPaneId, rightPaneId) {
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const container = document.getElementById('browse-content');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const panes = _browseGetSplitPanes();
    const leftPane = panes.find(p => p.id === leftPaneId);
    const rightPane = panes.find(p => p.id === rightPaneId);
    if (!leftPane || !rightPane) return;

    const startX = e.clientX;
    const startLeftWidth = leftPane.width;
    const startRightWidth = rightPane.width;
    const totalWidth = startLeftWidth + startRightWidth;
    const minWidth = 20;

    divider.classList.add('dragging');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dPct = (dx / containerRect.width) * 100;
      let newLeft = startLeftWidth + dPct;
      let newRight = startRightWidth - dPct;
      if (newLeft < minWidth) { newLeft = minWidth; newRight = totalWidth - minWidth; }
      if (newRight < minWidth) { newRight = minWidth; newLeft = totalWidth - minWidth; }
      leftPane.width = newLeft;
      rightPane.width = newRight;

      // Update DOM widths
      const leftEl = container.querySelector(`.browse-split-pane[data-pane="${leftPaneId}"]`);
      const rightEl = container.querySelector(`.browse-split-pane[data-pane="${rightPaneId}"]`);
      if (leftEl) leftEl.style.width = newLeft + '%';
      if (rightEl) rightEl.style.width = newRight + '%';
    };

    const onUp = () => {
      divider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      _browseSaveTabs();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

window._browseGetSplitPanes = _browseGetSplitPanes;
window._browseSetSplitPanes = _browseSetSplitPanes;
window._browseGetFocusedPane = _browseGetFocusedPane;
window._browseSetFocusedPane = _browseSetFocusedPane;
window._browsePaneForTab = _browsePaneForTab;
window._browseIsSplitMode = _browseIsSplitMode;
window.browseSplitTab = browseSplitTab;
window._browseEnsureTabFrame = _browseEnsureTabFrame;
window.browseUnsplitPane = browseUnsplitPane;
window.browseExitSplitMode = browseExitSplitMode;
window._browseRebuildSplitLayout = _browseRebuildSplitLayout;
window._browseFocusPane = _browseFocusPane;
window._browseAttachDividerDrag = _browseAttachDividerDrag;
