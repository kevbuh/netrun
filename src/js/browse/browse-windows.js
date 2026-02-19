// browse-windows.js — Window management
// Depends on: browse-state.js
import Settings from '/js/core/core-settings.js';

// Window management
export function browseCreateWindow(name) {
  const id = _browseNextWindowId++;
  if (!name) {
    const used = new Set(_browseWindows.map(w => w.name).filter(n => /^Window \d+$/.test(n)).map(n => parseInt(n.split(' ')[1])));
    let n = 1; while (used.has(n)) n++;
    name = `Window ${n}`;
  }
  const win = { id, name, tabs: [], activeTab: null, groups: [] };
  _browseWindows.push(win);
  browseSelectWindow(id);
  browseNewTab(); // Create initial tab
  _browseSaveTabs();
  return win;
}

export function browseSelectWindow(id) {
  const win = _browseWindows.find(w => w.id === id);
  if (!win) return;

  // Hide all tabs from other windows
  _browseWindows.forEach(w => {
    w.tabs.forEach(t => { if (t.el) t.el.style.display = 'none'; });
  });

  _browseActiveWindow = id;
  _browseRenderTabs();

  // Show active tab of this window
  if (win.activeTab) {
    const tab = win.tabs.find(t => t.id === win.activeTab);
    if (tab && tab.el) tab.el.style.display = '';
  }
  _browseUpdateNewTabPage(win.tabs.find(t => t.id === win.activeTab));
  _browseSaveTabs();
  _browseCollapseEmptyWindows();
}

export function browseCloseWindow(id) {
  const idx = _browseWindows.findIndex(w => w.id === id);
  if (idx === -1) return;

  const win = _browseWindows[idx];
  // Remove all tab elements
  win.tabs.forEach(t => { if (t.el) t.el.remove(); });
  _browseWindows.splice(idx, 1);
  _browseNextWindowId = _browseWindows.length ? Math.max(..._browseWindows.map(w => w.id)) + 1 : 1;
  // Renumber auto-named windows (Window 1, Window 2, ...) to close gaps
  let n = 1;
  _browseWindows.forEach(w => { if (/^Window \d+$/.test(w.name)) w.name = `Window ${n++}`; });

  if (_browseWindows.length === 0) {
    browseCreateWindow();
  } else if (_browseActiveWindow === id) {
    browseSelectWindow(_browseWindows[Math.min(idx, _browseWindows.length - 1)].id);
  }
  _browseSaveTabs();
}

// Auto-close non-active windows that only contain blank/new-tab pages
export function _browseCollapseEmptyWindows() {
  if (_browseWindows.length <= 1) return;
  const toClose = [];
  for (const w of _browseWindows) {
    if (w.id === _browseActiveWindow) continue;
    if (w.tabs.length === 0 || w.tabs.every(t => t.blank)) {
      toClose.push(w.id);
    }
  }
  for (const id of toClose) {
    browseCloseWindow(id);
  }
}

// Helper: create window without auto-creating a tab (for session restore)
export function _createBrowseWindow(name) {
  const id = _browseNextWindowId++;
  const win = { id, name: name || `Window ${id}`, tabs: [], activeTab: null };
  _browseWindows.push(win);
  return win;
}

// Helper: create a tab in a specific window (for session restore)
// Tabs are created deferred (lazy) — frame is only built when the tab is selected.
export function _browseCreateTabInWindow(windowId, url) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return null;

  const id = _browseNextTabId++;
  const resolved = _browseResolveUrl(url);

  const tab = {
    id,
    url: resolved,
    title: _browseTitleFromUrl(resolved),
    favicon: _browseFaviconUrl(resolved),
    el: null,
    blank: false,
    deferred: true,
    backStack: [],
    forwardStack: []
  };
  win.tabs.push(tab);
  if (resolved) _saveBrowseVisit(resolved, tab.title);

  return tab;
}

// Helper: destroy a tab's DOM elements (for session replace)
export function _destroyTab(tab) {
  if (_ccTabId === tab.id) stopCaptions();
  if (tab.el) tab.el.remove();
  _browseAudioTabs.delete(tab.id);
}

export function switchWindowUp() {
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx > 0) {
    _animateWindowSwitch('up', () => {
      browseSelectWindow(_browseWindows[idx - 1].id);
    });
  }
}

export function switchWindowDown() {
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx < _browseWindows.length - 1) {
    _animateWindowSwitch('down', () => {
      browseSelectWindow(_browseWindows[idx + 1].id);
    });
  }
}

export function _animateWindowSwitch(direction, callback) {
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }
  const dist = direction === 'up' ? 30 : -30;
  Motion.swap(content, 'y', callback, { distance: dist });
}


export function _setBrowseReturnView(view) {
  if (view) Settings.set('_browseReturnView', view);
  else Settings.remove('_browseReturnView');
}

export function _browseGoBack() {
  // Try nav history first — it knows the full path
  if (typeof navBack === 'function' && navBack()) {
    _setBrowseReturnView(null);
    return;
  }
  const nav = { feed: goHome, dashboard: openDashboard, search: openSearch, inbox: typeof openInbox === 'function' ? openInbox : null, calendar: typeof openDashboard === 'function' ? openDashboard : null, settings: typeof openSettings === 'function' ? openSettings : null, neuralook: typeof openNeuralook === 'function' ? openNeuralook : null };
  const fn = nav[Settings.get('_browseReturnView')];
  _setBrowseReturnView(null);
  if (fn) fn(); else goHome();
}

export function openBrowse(url) {
  const view = document.getElementById('browse-view');
  const alreadyVisible = view && view.style.display === 'flex';

  if (!alreadyVisible) {
    hideAllViews();
    view.classList.add('active');
    view.style.display = 'flex';
    view.style.flexDirection = 'column';
    setSidebarActive('sb-browse');
    if (Settings.get('browseTabLayout') === 'island') {
      // Island mode: normal sidebar, full browse bar, no pill mode
      _setPillBrowseMode(false);
      _applyBrowseTabLayout();
    } else {
      _setPillBrowseMode(true);
    }

    // Hide panel by default — shown later when a paper tab is selected
    hidePanel();
  }
  window.location.hash = 'browse';

  // Re-apply adaptive background color for the active tab
  if (typeof _browseApplyAdaptiveColor === 'function') {
    const activeTab = _browseTabs && _browseTabs.find(t => t.id === _browseActiveTab);
    if (activeTab) _browseApplyAdaptiveColor(activeTab);
  }

  if (!_browseWindows.length) {
    if (!_browseRestoreTabs()) {
      browseCreateWindow();
    }
  }
  if (url) {
    const resolved = _browseResolveUrl(url);
    // Search all windows for an existing tab with this URL
    let found = null;
    for (const w of _browseWindows) {
      const t = w.tabs.find(t => t.url === resolved);
      if (t) { found = { winId: w.id, tabId: t.id }; break; }
    }
    if (found) {
      if (found.winId !== _browseActiveWindow) browseSelectWindow(found.winId);
      browseSelectTab(found.tabId);
    } else {
      browseNewTab(url);
    }
  } else {
    _browseRenderTabs();
    const win = _getCurrentWindow();
    const tab = win?.tabs.find(t => t.id === win.activeTab);
    if (tab && tab.url && !tab.blank) {
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(tab.url);
      if (typeof _showAnnotateOfferPill === 'function') _showAnnotateOfferPill(tab);
    }
  }
  _browseInstallPinchOverlay();
  _browseInstallKeyGuard();
  // Show/hide return button
  const retBtn = document.getElementById('browse-return-btn');
  if (retBtn) retBtn.style.display = Settings.get('_browseReturnView') ? '' : 'none';
}

export function browseNewTab(url) {
  // Intercept netrun:// URLs
  const trimUrl = (url || '').trim().toLowerCase();
  if (trimUrl === 'netrun://history' || trimUrl === 'netrun://history/') {
    openSearchHistoryPage();
    return;
  }
  if (trimUrl === 'netrun://help' || trimUrl === 'netrun://help/') {
    openHelpPage();
    return;
  }
  const win = _getCurrentWindow();
  if (!win) return;

  const id = _browseNextTabId++;
  const isBlank = !url;
  const resolved = isBlank ? '' : _browseResolveUrl(url);

  let el = null;
  if (!isBlank) {
    const container = document.getElementById('browse-content');
    el = _browseCreateFrame(id, resolved);
    el.style.display = 'none';
    container.appendChild(el);
  }

  const tab = { id, url: resolved, title: isBlank ? 'New Tab' : _browseTitleFromUrl(resolved), favicon: isBlank ? '' : _browseFaviconUrl(resolved), el, blank: isBlank, backStack: [], forwardStack: [] };
  // Island mode: new tabs at top; horizontal: insert after active
  if (Settings.get('browseTabLayout') === 'island') {
    const firstUnpinned = win.tabs.findIndex(t => !t.pinned);
    if (firstUnpinned >= 0) win.tabs.splice(firstUnpinned, 0, tab);
    else win.tabs.push(tab);
  } else if (isBlank) {
    win.tabs.push(tab);
  } else {
    const activeIdx = win.tabs.findIndex(t => t.id === win.activeTab);
    if (activeIdx >= 0) win.tabs.splice(activeIdx + 1, 0, tab);
    else win.tabs.push(tab);
  }
  if (el) _browseBindFrame(tab);
  if (!isBlank && resolved) _saveBrowseVisit(resolved, tab.title);

  browseSelectTab(id);
  _browseSaveTabs();
  if (isBlank) {
    setTimeout(() => {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) { urlInput.focus(); urlInput.select(); }
    }, 50);
  }
}

export function browseNewPaperTab(url, paper) {
  const win = _getCurrentWindow();
  if (!win) return false;
  const id = _browseNextTabId++;
  // Open as regular browse tab (iframe)
  browseNewTab(url);
  return true;
}

export function openLocalPdf(file) {
  let localPath = null;
  try { if (typeof electronAPI !== 'undefined' && electronAPI.getPathForFile) localPath = electronAPI.getPathForFile(file); } catch {}
  const url = localPath ? 'file://' + localPath : URL.createObjectURL(file);

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfUrl = localPath ? '/api/local-file?path=' + encodeURIComponent(localPath) : url;
    const paper = { title: file.name, link: url, source: 'upload', pdfUrl };
    if (localPath) paper.localPath = localPath;
    browseNewPaperTab(url, paper);
  } else {
    browseNewTab(url);
    const win = _getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(t => t.url === url);
      if (tab) { tab.title = file.name; _browseRenderTabs(); }
    }
  }
}

export async function openLocalPdfDialog() {
  if (typeof electronAPI === 'undefined' || !electronAPI.openFileDialog) return;
  const paths = await electronAPI.openFileDialog();
  for (const filePath of paths) {
    const name = filePath.split('/').pop();
    const pdfUrl = '/api/local-file?path=' + encodeURIComponent(filePath);
    const url = 'file://' + filePath;
    const paper = { title: name, link: url, source: 'upload', pdfUrl, localPath: filePath };
    browseNewPaperTab(url, paper);
  }
}

window.browseCreateWindow = browseCreateWindow;
window.browseSelectWindow = browseSelectWindow;
window.browseCloseWindow = browseCloseWindow;
window._browseCollapseEmptyWindows = _browseCollapseEmptyWindows;
window._createBrowseWindow = _createBrowseWindow;
window._browseCreateTabInWindow = _browseCreateTabInWindow;
window._destroyTab = _destroyTab;
window.switchWindowUp = switchWindowUp;
window.switchWindowDown = switchWindowDown;
window._animateWindowSwitch = _animateWindowSwitch;
window._setBrowseReturnView = _setBrowseReturnView;
window._browseGoBack = _browseGoBack;
window.openBrowse = openBrowse;
window.browseNewTab = browseNewTab;
window.browseNewPaperTab = browseNewPaperTab;
window.openLocalPdf = openLocalPdf;
window.openLocalPdfDialog = openLocalPdfDialog;
