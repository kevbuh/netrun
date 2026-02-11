// browse-tabs.js — Browse tab/window management, downloads, navigation
// ── Browse View (multi-window, multi-tab embedded browser) ──

let _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
let _browseActiveWindow = null;
let _browseNextWindowId = 1;
let _browseNextTabId = 1;
let _browseNextGroupId = 1;
const _BROWSE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan'];
const _BROWSE_GROUP_COLOR_MAP = {
  grey:'#808080', blue:'#5b8def', red:'#e05656', yellow:'#d4a844',
  green:'#4caf50', pink:'#e06090', purple:'#9c6ade', cyan:'#3dc0c0'
};
const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);

// Sync initial adblock state to Electron main process
if (_browseIsElectron && window.electronAPI.adblockSetEnabled) {
  window.electronAPI.adblockSetEnabled(localStorage.getItem('adBlockEnabled') === 'true');
}

// Audio tracking: { tabId: { windowId, muted } }
let _browseAudioTabs = new Map();
let _pillBrowseMode = false;

// Closed captions state
let _ccStream = null;
let _ccSocket = null;
let _ccAudioCtx = null;
let _ccWorkletNode = null;
let _ccActive = false;
let _ccTabId = null;
let _ccCaptionLines = [];
let _ccFadeTimer = null;
let _browseTabLayout = localStorage.getItem('browseTabLayout') || 'island';

// NTP uploaded files: { name, content, file }
let _ntpUploadedFiles = [];
const _BROWSE_CLOSED_TABS_MAX = 50;
let _browseClosedTabs = JSON.parse(localStorage.getItem('browseClosedTabs') || '[]'); // stack of { url, title } for Cmd+Shift+T reopen

// ── Password manager state ──
let _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
let _pwSaveDismissed = new Map(); // 'origin|username' → true
let _pwLastSubmit = null; // { origin, username, ts } dedup
let _pwPendingPrompt = null; // { tab, data, ts } — survives navigation

// ── Split pane state ──
let _browseNextPaneId = 1;


// Convenience getters for current window's tabs
function _getCurrentWindow() {
  return _browseWindows.find(w => w.id === _browseActiveWindow);
}
// For backward compatibility
Object.defineProperty(window, '_browseTabs', {
  get() { const w = _getCurrentWindow(); return w ? w.tabs : []; },
  set(v) { const w = _getCurrentWindow(); if (w) w.tabs = v; }
});
Object.defineProperty(window, '_browseActiveTab', {
  get() { const w = _getCurrentWindow(); return w ? w.activeTab : null; },
  set(v) { const w = _getCurrentWindow(); if (w) w.activeTab = v; }
});

function _getBrowseStorageKey(baseKey) {
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.username) || null;
  return username ? `${baseKey}_${username}` : baseKey;
}

let _browseSaveTabsTimer = 0;
function _browseSaveTabs() {
  clearTimeout(_browseSaveTabsTimer);
  _browseSaveTabsTimer = setTimeout(_browseSaveTabsNow, 100);
}
function _browseSaveTabsNow() {
  const data = _browseWindows.map(w => ({
    id: w.id,
    name: w.name,
    activeTab: w.activeTab,
    groups: w.groups || [],
    splitPanes: w.splitPanes || [],
    focusedPane: w.focusedPane || null,
    tabs: w.tabs.map(t => {
      const saved = { id: t.id, url: t.url || '', title: t.title, blank: !!t.blank };
      if (t._historyPage) saved._historyPage = true;
      if (t._helpPage) saved._helpPage = true;
      if (t.paper) {
        const p = Object.assign({}, t.paper);
        saved.paper = p; saved.contentType = t.contentType; saved.arxivId = t.arxivId || null;
        if (t.localPath) saved.localPath = t.localPath;
      }
      if (t.lastVisited) saved.lastVisited = t.lastVisited;
      if (t.pinned) saved.pinned = true;
      if (t.groupId != null) saved.groupId = t.groupId;
      return saved;
    })
  }));
  localStorage.setItem(_getBrowseStorageKey('browseWindows'), JSON.stringify({
    windows: data,
    activeWindow: _browseActiveWindow,
    nextWindowId: _browseNextWindowId,
    nextTabId: _browseNextTabId,
    nextGroupId: _browseNextGroupId,
    nextPaneId: _browseNextPaneId
  }));
}

// Check if URL is a heavy video site that should be lazy-loaded
function _isHeavyVideoSite(url) {
  if (!url) return false;
  const heavyDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'dailymotion.com'];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return heavyDomains.some(d => hostname.includes(d));
  } catch { return false; }
}

function _browseRestoreTabs() {
  try {
    // Try new multi-window format first (user-specific key)
    let raw = localStorage.getItem(_getBrowseStorageKey('browseWindows'));
    if (raw) {
      const { windows, activeWindow, nextWindowId, nextTabId, nextGroupId, nextPaneId } = JSON.parse(raw);
      if (!windows || !windows.length) return false;
      _browseNextWindowId = nextWindowId || 1;
      _browseNextTabId = nextTabId || 1;
      _browseNextGroupId = nextGroupId || 1;
      _browseNextPaneId = nextPaneId || 1;
      const container = document.getElementById('browse-content');

      for (const savedWin of windows) {
        if (!savedWin.tabs.length) continue;
        const win = { id: savedWin.id, name: savedWin.name, tabs: [], activeTab: savedWin.activeTab, groups: savedWin.groups || [], splitPanes: savedWin.splitPanes || [], focusedPane: savedWin.focusedPane || null };
        for (const saved of savedWin.tabs) {
          if (saved.blank) {
            const tab = { id: saved.id, url: '', title: 'New Tab', favicon: '', el: null, blank: true, lastVisited: saved.lastVisited || 0 };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // History page tab — restore as special tab (content renders on select)
          if (saved._historyPage) {
            const tab = { id: saved.id, url: 'aether://history', title: 'History', favicon: '', el: null, blank: false, _historyPage: true, lastVisited: saved.lastVisited || 0 };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Help page tab
          if (saved._helpPage) {
            const tab = { id: saved.id, url: 'aether://help', title: 'Help', favicon: '', el: null, blank: false, _helpPage: true, lastVisited: saved.lastVisited || 0 };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Paper tab — create container div (content renders lazily on select)
          if (saved.paper && saved.contentType) {
            const el = document.createElement('div');
            el.id = 'browse-paper-' + saved.id;
            el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;overflow:hidden;';
            container.appendChild(el);
            const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false,
                          paper: saved.paper, contentType: saved.contentType, arxivId: saved.arxivId || null, lastVisited: saved.lastVisited || 0 };
            if (saved.localPath) { tab.localPath = saved.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(saved.localPath); }
            else if (saved.paper && saved.paper.localPath) { tab.localPath = saved.paper.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(saved.paper.localPath); }
            else if (saved.paper && saved.paper.pdfUrl) { tab.pdfUrl = saved.paper.pdfUrl; }
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Lazy load: don't create frame for heavy video sites in background tabs
          const isActiveTab = saved.id === savedWin.activeTab && savedWin.id === activeWindow;
          const shouldDefer = !isActiveTab && _isHeavyVideoSite(saved.url);

          let el = null;
          if (!shouldDefer) {
            el = _browseCreateFrame(saved.id, saved.url);
            el.style.display = 'none';
            container.appendChild(el);
          }
          const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false, deferred: shouldDefer, lastVisited: saved.lastVisited || 0 };
          if (saved.pinned) tab.pinned = true;
          if (saved.groupId != null) tab.groupId = saved.groupId;
          win.tabs.push(tab);
          if (el) _browseBindFrame(tab);
        }
        _browseWindows.push(win);
      }
      if (!_browseWindows.length) return false;
      _browseActiveWindow = _browseWindows.find(w => w.id === activeWindow) ? activeWindow : _browseWindows[0].id;
      const win = _getCurrentWindow();
      if (win && win.tabs.length) {
        const target = win.tabs.find(t => t.id === win.activeTab) ? win.activeTab : win.tabs[0].id;
        browseSelectTab(target);
        // Restore split layout if saved
        if (win.splitPanes && win.splitPanes.length >= 2) {
          _browseRebuildSplitLayout();
        }
      }
      return true;
    }

    return false;
  } catch { return false; }
}

// Window management
function browseCreateWindow(name) {
  if (_browseTabOverviewVisible) hideBrowseTabOverview();
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

function browseSelectWindow(id) {
  const win = _browseWindows.find(w => w.id === id);
  if (!win) return;

  // Capture preview of outgoing window before switching (for overview cache)
  _browseCaptureWindowPreview(_browseActiveWindow);

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
}

function browseCloseWindow(id) {
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

// Helper: create window without auto-creating a tab (for session restore)
function _createBrowseWindow(name) {
  const id = _browseNextWindowId++;
  const win = { id, name: name || `Window ${id}`, tabs: [], activeTab: null };
  _browseWindows.push(win);
  return win;
}

// Helper: create a tab in a specific window (for session restore)
function _browseCreateTabInWindow(windowId, url) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return null;

  const id = _browseNextTabId++;
  const resolved = _browseResolveUrl(url);

  const container = document.getElementById('browse-content');
  const el = _browseCreateFrame(id, resolved);
  el.style.display = 'none';
  container.appendChild(el);

  const tab = {
    id,
    url: resolved,
    title: _browseTitleFromUrl(resolved),
    favicon: _browseFaviconUrl(resolved),
    el,
    blank: false,
    backStack: [],
    forwardStack: []
  };
  win.tabs.push(tab);
  _browseBindFrame(tab);
  if (resolved) _saveBrowseVisit(resolved, tab.title);

  return tab;
}

// Helper: destroy a tab's DOM elements (for session replace)
function _destroyTab(tab) {
  if (_ccTabId === tab.id) stopCaptions();
  if (tab.el) tab.el.remove();
  _browseAudioTabs.delete(tab.id);
}

function switchWindowUp() {
  if (_browseTabOverviewVisible) hideBrowseTabOverview();
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx > 0) {
    _animateWindowSwitch('up', () => {
      browseSelectWindow(_browseWindows[idx - 1].id);
    });
  }
}

function switchWindowDown() {
  if (_browseTabOverviewVisible) hideBrowseTabOverview();
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx < _browseWindows.length - 1) {
    _animateWindowSwitch('down', () => {
      browseSelectWindow(_browseWindows[idx + 1].id);
    });
  }
}

function _animateWindowSwitch(direction, callback) {
  var content = document.getElementById('browse-content');
  if (!content) { callback(); return; }
  var dist = direction === 'up' ? 30 : -30;
  Motion.swap(content, 'y', callback, { distance: dist });
}

let _browseReturnView = localStorage.getItem('_browseReturnView') || null; // set by openPaper/inbox to enable "back to feed/inbox" button

function _setBrowseReturnView(view) {
  _browseReturnView = view;
  if (view) localStorage.setItem('_browseReturnView', view);
  else localStorage.removeItem('_browseReturnView');
}

function _browseGoBack() {
  // Try nav history first — it knows the full path
  if (typeof navBack === 'function' && navBack()) {
    _setBrowseReturnView(null);
    return;
  }
  const nav = { feed: goHome, dashboard: openDashboard, search: openSearch, inbox: typeof openInbox === 'function' ? openInbox : null, calendar: typeof openDashboard === 'function' ? openDashboard : null, settings: typeof openSettings === 'function' ? openSettings : null, vault: typeof openVault === 'function' ? openVault : null, neuralook: typeof openNeuralook === 'function' ? openNeuralook : null };
  const fn = nav[_browseReturnView];
  _setBrowseReturnView(null);
  if (fn) fn(); else goHome();
}

function openBrowse(url) {
  const view = document.getElementById('browse-view');
  const alreadyVisible = view && view.style.display === 'flex';

  if (!alreadyVisible) {
    hideAllViews();
    view.classList.add('active');
    view.style.display = 'flex';
    view.style.flexDirection = 'column';
    setSidebarActive('sb-browse');
    if (_browseTabLayout === 'island') {
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
      _initSidebarForUrl(tab.url);
      if (!_restoreAnnotationPill(tab)) _offerAnnotation(tab);
    }
  }
  _browseInstallPinchOverlay();
  _browseInstallKeyGuard();
  // Show/hide return button
  const retBtn = document.getElementById('browse-return-btn');
  if (retBtn) retBtn.style.display = _browseReturnView ? '' : 'none';
}

function browseNewTab(url) {
  if (_browseTabOverviewVisible) hideBrowseTabOverview();
  // Intercept aether:// URLs
  const trimUrl = (url || '').trim().toLowerCase();
  if (trimUrl === 'aether://history' || trimUrl === 'aether://history/') {
    openSearchHistoryPage();
    return;
  }
  if (trimUrl === 'aether://help' || trimUrl === 'aether://help/') {
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
  if (_browseTabLayout === 'island') {
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

function browseNewPaperTab(url, paper) {
  const win = _getCurrentWindow();
  if (!win) return false;
  const id = _browseNextTabId++;
  // Open as regular browse tab (iframe)
  browseNewTab(url);
  return true;
}

function openLocalPdf(file) {
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

async function openLocalPdfDialog() {
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

// ── NTP File Upload ──

function handleNtpFileInput(input) {
  if (!input.files) return;
  for (const file of input.files) handleNtpFileUpload(file);
  input.value = '';
}

async function handleNtpFileUpload(file) {
  let localPath = null;
  try { if (typeof electronAPI !== 'undefined' && electronAPI.getPathForFile) localPath = electronAPI.getPathForFile(file); } catch {}
  const entry = { name: file.name, content: '', file, localPath };
  _ntpUploadedFiles.push(entry);
  _renderNtpFileChips();

  // Extract text
  const lower = file.name.toLowerCase();
  const TEXT_EXTS = ['.txt','.md','.csv','.py','.js','.ts','.json','.html','.css','.xml',
    '.yaml','.yml','.toml','.ini','.cfg','.sh','.r','.sql','.java','.c','.cpp',
    '.h','.go','.rs','.rb','.php','.swift','.kt','.lua'];
  const ext = lower.substring(lower.lastIndexOf('.'));
  if (TEXT_EXTS.includes(ext)) {
    try {
      entry.content = await file.text();
    } catch (e) { /* ignore */ }
  } else if (lower.endsWith('.pdf')) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/extract-text', { method: 'POST', body: fd });
      if (resp.ok) {
        const data = await resp.json();
        entry.content = data.text || '';
      }
    } catch (e) { /* ignore */ }
  }
}

function _renderNtpFileChips() {
  const container = document.getElementById('ntp-file-chips');
  if (!container) return;
  if (!_ntpUploadedFiles.length) { container.innerHTML = ''; return; }
  container.innerHTML = _ntpUploadedFiles.map((f, i) => {
    const dotIdx = f.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? f.name.substring(dotIdx + 1).toUpperCase() : 'FILE';
    const baseName = dotIdx >= 0 ? f.name.substring(0, dotIdx) : f.name;
    return `<button class="ntp-file-card" onclick="openNtpFile(${i})" title="${escapeHtml(f.name)}">
      <svg class="ntp-file-card-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
      <div class="ntp-file-card-info">
        <span class="ntp-file-card-name">${escapeHtml(baseName)}</span>
        <span class="ntp-file-card-type">${escapeHtml(ext)}</span>
      </div>
      <span class="ntp-file-card-remove" onclick="event.stopPropagation(); removeNtpFile(${i})">&times;</span>
    </button>`;
  }).join('');
}

function removeNtpFile(idx) {
  const f = _ntpUploadedFiles[idx];
  _ntpUploadedFiles.splice(idx, 1);
  _renderNtpFileChips();
}

function openNtpFile(idx) {
  const f = _ntpUploadedFiles[idx];
  if (!f) return;
  if (f.localPath) {
    const url = 'file://' + f.localPath;
    browseNewTab(url);
    const win = _getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(t => t.url === url);
      if (tab) { tab.title = f.name; _browseRenderTabs(); }
    }
  } else {
    openLocalPdf(f.file);
  }
}

function openBrowseWithPaper(url, paper) {
  const view = document.getElementById('browse-view');
  const isAlreadyOpen = view && view.style.display !== 'none' && view.style.display !== '';

  if (!isAlreadyOpen) openBrowse();

  // Ensure _browseActiveWindow points to a valid window (use last window as fallback)
  if (!_getCurrentWindow() && _browseWindows.length) {
    browseSelectWindow(_browseWindows[_browseWindows.length - 1].id);
  }

  // Exit split mode when opening a paper from feed — want full-screen view
  if (_browseIsSplitMode()) {
    const win = _getCurrentWindow();
    if (win) { win.splitPanes = []; win.focusedPane = null; }
  }

  // Check for existing tab with this URL across all windows
  for (const w of _browseWindows) {
    const t = w.tabs.find(t => t.url === url);
    if (t) {
      if (w.id !== _browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(t.id);
      return;
    }
  }
  const created = browseNewPaperTab(url, paper);
  if (!created) {
    browseNewTab(url);
    return;
  }
  // Close initial blank tab if one was just created by openBrowse
  const win = _getCurrentWindow();
  if (win && win.tabs.length > 1) {
    const blank = win.tabs.find(t => t.blank && t.id !== win.activeTab);
    if (blank) browseCloseTab(blank.id);
  }
}


function _browseProxyUrl(url) {
  // Never proxy data: URLs
  if (url && url.startsWith('data:')) return url;
  // Serve file:// URLs through the local server
  if (url && url.startsWith('file://')) return '/api/local-file?path=' + encodeURIComponent(url.replace(/^file:\/\//, ''));
  // Always proxy in browser mode (not Electron) to enable link context menu and ad blocking
  if (!_browseIsElectron && url) {
    return '/api/browse-proxy?url=' + encodeURIComponent(url);
  }
  return url;
}

// Baseline: every iframe blocks camera, mic, geolocation by default.
// Only _browseSetFrameAllow can selectively open them per user choice.
const _IFRAME_BLOCKED_POLICY = "camera 'none'; microphone 'none'; geolocation 'none'";

function _browseCreateFrame(id, url) {
  const el = document.createElement(_browseIsElectron ? 'webview' : 'iframe');
  el.id = 'browse-frame-' + id;
  el.dataset.originalUrl = url;
  el.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;background:#fff;';
  if (!_browseIsElectron) {
    // Set sandbox + permissions policy BEFORE src so the browser enforces them
    // from the very start of navigation
    el.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
    el.referrerPolicy = 'no-referrer';
    el.allow = _IFRAME_BLOCKED_POLICY;
    _browseSetFrameAllow(el, url);
  }
  // Set src AFTER security attributes are in place
  const proxied = _browseProxyUrl(url);
  el.src = proxied;
  // Fetch blocked count after load
  if (proxied !== url) {
    el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
  }
  // Inject right-click chat handler into iframe
  if (typeof _injectIframeChatHandler === 'function') {
    _injectIframeChatHandler(el);
  }
  return el;
}

function _browseSetFrameAllow(el, url) {
  if (!url) return;
  let domain = '';
  try { domain = new URL(url).hostname.replace('www.', ''); } catch { return; }
  // If permission helpers haven't loaded yet, the baseline blocks everything — safe
  if (typeof _getEffectivePermissions !== 'function') return;
  const perms = _getEffectivePermissions(domain);

  // Build Permissions Policy: only explicitly user-confirmed permissions get opened.
  // Everything else stays blocked via 'none'.
  const policyParts = [];
  const permToAllow = { camera: 'camera', microphone: 'microphone', location: 'geolocation' };
  for (const [key, allowVal] of Object.entries(permToAllow)) {
    if (perms[key] === 'allow') {
      policyParts.push(allowVal);
    } else {
      policyParts.push(allowVal + " 'none'");
    }
  }
  el.allow = policyParts.join('; ');

  // Sandbox: popups allowed by default, blocked only if user chose "block"
  let sandboxFlags = 'allow-scripts allow-same-origin allow-forms';
  if (perms.popups !== 'block') sandboxFlags += ' allow-popups';
  el.sandbox = sandboxFlags;
}

function _browseApplyPermissions() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.url || tab.blank) return;
  if (_browseIsElectron) return;
  // Destroy the old iframe completely and create a fresh one so the browser
  // builds a new browsing context with the updated Permissions-Policy.
  // Just changing the allow attribute + src is not reliably enforced.
  const container = document.getElementById('browse-content');
  if (!container) return;
  if (tab.el) tab.el.remove();
  tab.el = _browseCreateFrame(tab.id, tab.url);
  container.appendChild(tab.el);
  _browseBindFrame(tab);
}

// ── Download Manager ──
const DOWNLOAD_RETENTION_MS = 60 * 60 * 1000; // 1 hour

let _browseDownloads = []; // { id, filename, url, state: 'progressing'|'completed'|'cancelled', receivedBytes, totalBytes, startTime }
let _browseDownloadIdCounter = 0;
let _browseDownloadsLastSeenCount = 0;

function _loadBrowseDownloads() {
  try {
    const saved = JSON.parse(localStorage.getItem('browseDownloads') || '[]');
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    _browseDownloads = saved.filter(d => d.startTime > oneHourAgo);
    // Find max ID
    _browseDownloads.forEach(d => {
      const num = parseInt(d.id.replace('dl-', ''));
      if (num > _browseDownloadIdCounter) _browseDownloadIdCounter = num;
    });
    // Load last seen count
    const lastSeen = parseInt(localStorage.getItem('browseDownloadsLastSeen') || '0');
    _browseDownloadsLastSeenCount = Math.min(lastSeen, _browseDownloads.length);
  } catch (e) {
    _browseDownloads = [];
  }
}

function _saveBrowseDownloads() {
  try {
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    const toSave = _browseDownloads.filter(d => d.startTime > oneHourAgo);
    localStorage.setItem('browseDownloads', JSON.stringify(toSave));
    // Save last seen count
    localStorage.setItem('browseDownloadsLastSeen', _browseDownloadsLastSeenCount.toString());
  } catch (e) {}
}

// Initialize downloads on load
_loadBrowseDownloads();
// Update UI after a short delay (DOM may not be ready)
setTimeout(() => {
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
}, 100);

function _browseUpdateDownloadBadge() {
  const btn = document.getElementById('browse-downloads-btn');
  const badge = document.getElementById('browse-download-badge');
  const ring = document.getElementById('browse-download-progress-ring');

  const count = _browseDownloads.length;
  const newDownloads = count - _browseDownloadsLastSeenCount;

  // Show/hide download button
  if (btn) btn.style.display = count > 0 ? 'block' : 'none';

  // Show badge only for new downloads
  if (badge) {
    if (newDownloads > 0) {
      badge.textContent = newDownloads > 99 ? '99+' : newDownloads;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Show progress ring only for new active downloads
  if (ring) {
    const hasNewActive = newDownloads > 0 && _browseDownloads.some(d => d.state === 'progressing');
    ring.style.display = hasNewActive ? 'block' : 'none';
  }

  // Dynamic Island: show download progress (persists until dismissed)
  if (typeof islandUpdate === 'function') {
    const active = _browseDownloads.filter(d => d.state === 'progressing');
    const completed = _browseDownloads.filter(d => d.state === 'completed');
    const total = _browseDownloads.length;
    if (total > 0) {
      const items = _browseDownloads.map(d => ({
        id: d.id,
        filename: d.filename || 'Download',
        state: d.state,
        pct: d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0,
        size: d.totalBytes > 0 ? _formatBytes(d.totalBytes) : '',
        received: _formatBytes(d.receivedBytes || 0)
      }));
      const dlData = { type: 'download', items: items, dismiss: function() { islandRemove('download'); } };
      if (active.length > 0) {
        const dl = active[0];
        const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
        const name = dl.filename || 'Download';
        dlData.label = active.length > 1 ? active.length + ' downloading' : pct + '%';
        dlData.detail = active.length > 1 ? active.length + ' downloading · ' + completed.length + ' done' : name + ' · ' + pct + '%';
        dlData.progress = pct;
      } else {
        dlData.label = total === 1 ? '1 download' : total + ' downloads';
        dlData.detail = total === 1 ? completed[0].filename : total + ' downloads complete';
      }
      islandUpdate('download', dlData);
    } else {
      islandRemove('download');
    }
  }
}

function _browseRenderDownloads() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (_browseDownloads.length === 0) {
    dropdown.innerHTML = '<div class="browse-downloads-empty">No downloads</div>';
    return;
  }

  let html = `<div class="browse-downloads-header">
    <span class="browse-downloads-title">Downloads</span>
    <button class="browse-downloads-clear" onclick="event.stopPropagation();clearBrowseDownloads()">Clear all</button>
  </div>`;

  for (const dl of _browseDownloads) {
    const icon = dl.state === 'completed'
      ? '<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
      : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';

    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const size = dl.totalBytes > 0 ? _formatBytes(dl.totalBytes) : '';
    const status = dl.state === 'completed' ? 'Completed' + (size ? ' · ' + size : '')
      : dl.state === 'cancelled' ? 'Cancelled'
      : pct + '% · ' + _formatBytes(dl.receivedBytes) + (dl.totalBytes > 0 ? ' / ' + size : '');

    const progressBar = dl.state === 'progressing'
      ? `<div class="browse-download-item-progress"><div class="browse-download-item-progress-bar" style="width:${pct}%"></div></div>`
      : '';

    html += `<div class="browse-download-item" onclick="openDownloadFile('${dl.id}')">
      <div class="browse-download-item-icon">${icon}</div>
      <div class="browse-download-item-info">
        <div class="browse-download-item-name">${escapeHtml(dl.filename)}</div>
        <div class="browse-download-item-status">${status}</div>
        ${progressBar}
      </div>
      <div class="browse-download-item-actions">
        ${dl.state === 'completed' ? `<button class="browse-download-item-btn" onclick="event.stopPropagation();showDownloadInFolder('${dl.id}')" title="Show in folder"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg></button>` : ''}
        <button class="browse-download-item-btn" onclick="event.stopPropagation();removeBrowseDownload('${dl.id}')" title="Remove"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>`;
  }

  dropdown.innerHTML = html;

  // Stop propagation on clicks inside dropdown to prevent closing
  dropdown.onclick = (e) => e.stopPropagation();
}

function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function _closeBrowseDownloadsDropdown() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  document.removeEventListener('click', _closeBrowseDownloadsOnClick);
  window.removeEventListener('blur', _closeBrowseDownloadsOnBlur);
}

function toggleBrowseDownloads(event) {
  if (event) event.stopPropagation();

  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (dropdown.style.display === 'none') {
    _browseRenderDownloads();
    dropdown.style.display = 'block';

    // Mark all downloads as seen
    _browseDownloadsLastSeenCount = _browseDownloads.length;
    _saveBrowseDownloads();

    const badge = document.getElementById('browse-download-badge');
    if (badge) badge.style.display = 'none';

    // Add close listeners
    requestAnimationFrame(() => {
      document.addEventListener('click', _closeBrowseDownloadsOnClick);
    });
    window.addEventListener('blur', _closeBrowseDownloadsOnBlur);
  } else {
    _closeBrowseDownloadsDropdown();
  }
}

function _closeBrowseDownloadsOnClick(e) {
  const btn = document.getElementById('browse-downloads-btn');
  if (btn && !btn.contains(e.target)) {
    _closeBrowseDownloadsDropdown();
  }
}

function _closeBrowseDownloadsOnBlur() {
  _closeBrowseDownloadsDropdown();
}

function clearBrowseDownloads() {
  _browseDownloads = [];
  _browseDownloadsLastSeenCount = 0;
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

function removeBrowseDownload(id) {
  _browseDownloads = _browseDownloads.filter(d => d.id !== id);
  // Adjust seen count if we're below it
  if (_browseDownloads.length < _browseDownloadsLastSeenCount) {
    _browseDownloadsLastSeenCount = _browseDownloads.length;
  }
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

function openDownloadFile(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (dl && dl.state === 'completed' && dl.savePath && window.electronAPI) {
    window.electronAPI.openPath(dl.savePath);
  }
}

function showDownloadInFolder(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (!dl) return;
  if (dl.savePath && window.electronAPI) {
    window.electronAPI.showItemInFolder(dl.savePath);
  } else if (dl.filename) {
    fetch('/api/reveal-in-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: dl.filename })
    }).catch(() => {});
  }
}

// Initialize download event listeners from Electron main process
let _downloadsInitialized = false;

function _initBrowseDownloads() {
  if (!window.electronAPI) return;
  if (_downloadsInitialized) return;
  _downloadsInitialized = true;

  // Listen for download-started event
  if (window.electronAPI.onDownloadStarted) {
    window.electronAPI.onDownloadStarted((event, data) => {
      const dl = {
        id: data.id,
        filename: data.filename || 'download',
        url: data.url || '',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: data.totalBytes || 0,
        startTime: Date.now(),
        savePath: data.savePath || ''
      };
      _browseDownloads.unshift(dl);
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    });
  }

  // Listen for download-progress event
  if (window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.receivedBytes = data.receivedBytes || 0;
        dl.totalBytes = data.totalBytes || dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }

  // Listen for download-completed event
  if (window.electronAPI.onDownloadCompleted) {
    window.electronAPI.onDownloadCompleted((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.state = data.state || 'completed';
        dl.savePath = data.savePath || dl.savePath;
        dl.receivedBytes = dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }
}

// Initialize downloads on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initBrowseDownloads);
} else {
  _initBrowseDownloads();
}

function _browseHandleNavigation(tab, frame) {
  frame.addEventListener('did-navigate', (e) => {
    // Restore original file:// URL when navigating through the local-file proxy
    const navUrl = (e.url.includes('/api/local-file?path=') && frame.dataset.originalUrl)
      ? frame.dataset.originalUrl : e.url;
    tab.url = navUrl;
    tab.title = _browseTitleFromUrl(navUrl);
    tab.favicon = _browseFaviconUrl(navUrl);
    tab.blank = false;
    _pwAutofillOffered.delete(tab.id);
    // Re-show save prompt after navigation if credentials were just captured
    if (_pwPendingPrompt && _pwPendingPrompt.tab.id === tab.id && Date.now() - _pwPendingPrompt.ts < 15000) {
      const pending = _pwPendingPrompt;
      _pwHideSavePrompt();
      setTimeout(() => _pwShowSavePrompt(pending.tab, pending.data), 100);
    } else {
      _pwHideSavePrompt();
    }
    _saveBrowseVisit(navUrl, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      _browseSetUrlDisplay(urlInput, navUrl);
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(navUrl);
    }
    // Clear RSS feeds on navigation
    tab.rssFeeds = null;
    _browseUpdateRssPill(tab);
    // Clear any existing annotation state for this tab on navigation
    _annotationsEnabled.delete(tab.id);
    _updateAnnotateButtonState();
    // Offer to annotate the new page
    if (_browseActiveTab === tab.id) _offerAnnotation(tab);
    // Adblock: reset count for this webview on navigation
    if (window.electronAPI && window.electronAPI.adblockResetCount && typeof frame.getWebContentsId === 'function') {
      try { window.electronAPI.adblockResetCount(frame.getWebContentsId()); } catch {}
    }
    // YouTube: inject ad-block CSS immediately on navigation (before dom-ready / first paint)
    _browseInjectYouTubeCSS(frame, navUrl);
  });
  frame.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const sameOrigin = tab.url && e.url && _browseUrlDomain(tab.url) === _browseUrlDomain(e.url);
    tab.url = e.url;
    // Keep real title for same-origin in-page navigations (hash/pushState)
    if (!sameOrigin || !tab.title || tab.title === _browseTitleFromUrl(tab.url)) {
      tab.title = _browseTitleFromUrl(e.url);
    }
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      _browseSetUrlDisplay(urlInput, e.url);
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
    // YouTube: re-inject ad-block CSS on SPA navigation
    _browseInjectYouTubeCSS(frame, e.url);
  });
  frame.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    // Update the most recent browse history entry with the real title
    if (tab.url) _saveBrowseVisit(tab.url, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
    // Refresh shortened URL display with new title
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput && document.activeElement !== urlInput) _browseSetUrlDisplay(urlInput, tab.url);
    }
  });
  frame.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length) tab.favicon = e.favicons[0];
    _browseRenderTabs();
  });
  frame.addEventListener('new-window', (e) => {
    e.preventDefault();
    browseNewTab(e.url);
  });

  // Audio tracking
  frame.addEventListener('media-started-playing', () => {
    // Find which window this tab belongs to
    const winId = _browseWindows.find(w => w.tabs.some(t => t.id === tab.id))?.id;
    if (winId) {
      _browseAudioTabs.set(tab.id, { windowId: winId, muted: false });
      _browseRenderTabs();
      _updateAudioIndicator();
    }
  });
  frame.addEventListener('media-paused', () => {
    _browseAudioTabs.delete(tab.id);
    _ccPillDismissed = false;
    if (_ccTabId === tab.id) stopCaptions();
    _browseRenderTabs();
    _updateAudioIndicator();
  });

  // ── Error page handling (site not found, 404, etc.) ──
  frame.addEventListener('did-fail-load', (e) => {
    // Ignore aborted loads (user navigated away), subframe errors, and cancelled requests
    if (e.errorCode === -3 || e.errorCode === -27 || !e.isMainFrame) return;
    const failedUrl = e.validatedURL || tab.url || '';
    _browseShowErrorPage(tab, frame, failedUrl, e.errorDescription || 'Site not found', e.errorCode);
  });

  // Detect HTTP error pages (404, 500, etc.) after load finishes
  if (_browseIsElectron) {
    frame.addEventListener('did-finish-load', () => {
      try {
        frame.executeJavaScript(
          `(() => { try { return { status: document.querySelector('title')?.textContent || '', body: document.body?.innerText?.substring(0, 500) || '' }; } catch(e) { return null; } })()`
        ).then(info => {
          if (!info) return;
          const title = (info.status || '').toLowerCase();
          const body = (info.body || '').toLowerCase();
          const is404 = /\b404\b/.test(title) || /\b404\b.*not found/.test(body) || /not found/.test(title);
          const isError = /\b(502|503|504)\b/.test(title) || /\b(bad gateway|service unavailable|gateway timeout)\b/.test(body);
          if (is404 || isError) {
            const code = is404 ? 404 : 0;
            const desc = is404 ? 'Page not found (404)' : 'Server error';
            _browseShowErrorPage(tab, frame, tab.url, desc, code);
          }
        }).catch(() => {});
      } catch {}
    });
  }

}

// Chromium net error codes -> user-friendly error info
var _browseErrorMap = {
  // DNS
  '-105': { id: 'NAME_NOT_RESOLVED',   title: 'This site can\u2019t be reached', desc: 'DNS address could not be found for <strong>%DOMAIN%</strong>.', icon: 'dns',    suggestions: ['Check the URL for typos', 'Check your internet connection', 'Try disabling your VPN or proxy'] },
  '-118': { id: 'CONNECTION_TIMED_OUT', title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['Check your internet connection', 'Check any firewall or proxy settings', 'Try again later'] },
  '-137': { id: 'NAME_RESOLUTION_FAILED', title: 'This site can\u2019t be reached', desc: 'DNS resolution failed for <strong>%DOMAIN%</strong>.', icon: 'dns', suggestions: ['Check the URL for typos', 'Try flushing your DNS cache', 'Check your DNS settings'] },
  // Connection
  '-2':   { id: 'FAILED',              title: 'This site can\u2019t be reached', desc: 'An unexpected network error occurred.', icon: 'offline', suggestions: ['Check your internet connection', 'Try again later'] },
  '-6':   { id: 'FILE_NOT_FOUND',      title: 'File not found', desc: 'The requested file was not found.', icon: '404', suggestions: ['Check the file path', 'The file may have been moved or deleted'] },
  '-7':   { id: 'TIMED_OUT',           title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['Check your internet connection', 'The site may be down \u2014 try again later'] },
  '-15':  { id: 'SOCKET_NOT_CONNECTED', title: 'This site can\u2019t be reached', desc: 'The socket is not connected.', icon: 'offline', suggestions: ['Check your internet connection', 'Try reloading the page'] },
  '-21':  { id: 'NETWORK_CHANGED',     title: 'Connection interrupted', desc: 'Your network connection changed while loading.', icon: 'offline', suggestions: ['Check your Wi-Fi or network connection', 'Try reloading the page'] },
  '-100': { id: 'CONNECTION_CLOSED',    title: 'This site can\u2019t be reached', desc: 'The connection to <strong>%DOMAIN%</strong> was unexpectedly closed.', icon: 'offline', suggestions: ['The site may be experiencing issues', 'Try again later'] },
  '-101': { id: 'CONNECTION_RESET',     title: 'This site can\u2019t be reached', desc: 'The connection was reset.', icon: 'offline', suggestions: ['Check your internet connection', 'The site may be blocking your request', 'Try disabling your VPN'] },
  '-102': { id: 'CONNECTION_REFUSED',   title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> refused to connect.', icon: 'refused', suggestions: ['The site may be down for maintenance', 'Check if a firewall is blocking access', 'Try again later'] },
  '-104': { id: 'CONNECTION_FAILED',    title: 'This site can\u2019t be reached', desc: 'Failed to establish a connection to <strong>%DOMAIN%</strong>.', icon: 'offline', suggestions: ['Check your internet connection', 'The site may be temporarily unavailable'] },
  '-106': { id: 'INTERNET_DISCONNECTED', title: 'No internet', desc: 'You\u2019re not connected to the internet.', icon: 'offline', suggestions: ['Check your Wi-Fi or ethernet connection', 'Check your router', 'Try connecting to a different network'] },
  '-109': { id: 'ADDRESS_UNREACHABLE', title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> is unreachable.', icon: 'offline', suggestions: ['Check the URL', 'The server may be on a private network'] },
  '-110': { id: 'SSL_PROTOCOL_ERROR',  title: 'This site can\u2019t provide a secure connection', desc: '<strong>%DOMAIN%</strong> sent an invalid response.', icon: 'ssl', suggestions: ['The site may be using an unsupported protocol', 'Try again later'] },
  '-111': { id: 'DNS_CACHE_MISS',      title: 'This site can\u2019t be reached', desc: 'DNS lookup for <strong>%DOMAIN%</strong> failed.', icon: 'dns', suggestions: ['Try reloading the page', 'Check your DNS settings'] },
  '-112': { id: 'ADDRESS_INVALID',     title: 'This site can\u2019t be reached', desc: 'The server address is invalid.', icon: 'offline', suggestions: ['Check the URL for typos'] },
  // SSL/TLS
  '-200': { id: 'CERT_COMMON_NAME_INVALID', title: 'Your connection is not private', desc: 'The certificate for <strong>%DOMAIN%</strong> doesn\u2019t match the domain.', icon: 'ssl', suggestions: ['The site may be misconfigured', 'Don\u2019t enter any sensitive information', 'You could try the HTTP version'] },
  '-201': { id: 'CERT_DATE_INVALID',   title: 'Your connection is not private', desc: 'The security certificate for <strong>%DOMAIN%</strong> has expired.', icon: 'ssl', suggestions: ['Check that your system clock is correct', 'The site\u2019s certificate may need renewal'] },
  '-202': { id: 'CERT_AUTHORITY_INVALID', title: 'Your connection is not private', desc: 'The certificate authority is not trusted.', icon: 'ssl', suggestions: ['The certificate may be self-signed', 'Don\u2019t enter sensitive information on this site'] },
  '-204': { id: 'CERT_INVALID',        title: 'Your connection is not private', desc: 'The server\u2019s security certificate is not valid.', icon: 'ssl', suggestions: ['Attackers might be trying to steal your information', 'Don\u2019t proceed unless you trust this site'] },
  // HTTP errors
  '403':  { id: 'HTTP_403_FORBIDDEN',  title: 'Access denied', desc: 'You don\u2019t have permission to view this page on <strong>%DOMAIN%</strong>.', icon: '403', suggestions: ['You may need to sign in', 'The site may restrict access to certain regions', 'Contact the site owner if you think this is an error'] },
  '404':  { id: 'HTTP_404_NOT_FOUND',  title: 'Page not found', desc: 'The page you were looking for on <strong>%DOMAIN%</strong> doesn\u2019t exist.', icon: '404', suggestions: ['Check the URL for typos', 'The page may have been moved or deleted', 'Try searching the site directly'] },
  '410':  { id: 'HTTP_410_GONE',       title: 'Page gone', desc: 'This page has been permanently removed.', icon: '404', suggestions: ['The content has been intentionally deleted', 'Try the Wayback Machine for an archived version'] },
  '429':  { id: 'HTTP_429_TOO_MANY',   title: 'Too many requests', desc: 'You\u2019ve been rate limited by <strong>%DOMAIN%</strong>.', icon: 'timeout', suggestions: ['Wait a few minutes before trying again', 'Reduce how frequently you visit this page'] },
  '500':  { id: 'HTTP_500_SERVER',     title: 'Server error', desc: '<strong>%DOMAIN%</strong> encountered an internal error.', icon: 'server', suggestions: ['This is a problem on the site\u2019s end', 'Try again in a few minutes', 'If it persists, contact the site owner'] },
  '502':  { id: 'HTTP_502_BAD_GATEWAY', title: 'Bad gateway', desc: '<strong>%DOMAIN%</strong> received an invalid response from an upstream server.', icon: 'server', suggestions: ['The site may be under heavy load', 'Try again in a few minutes'] },
  '503':  { id: 'HTTP_503_UNAVAILABLE', title: 'Service unavailable', desc: '<strong>%DOMAIN%</strong> is temporarily down for maintenance.', icon: 'server', suggestions: ['The site is likely undergoing maintenance', 'Try again later'] },
  '504':  { id: 'HTTP_504_TIMEOUT',    title: 'Gateway timeout', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['The site may be experiencing heavy traffic', 'Try again in a few minutes'] },
};

function _browseShowErrorPage(tab, frame, failedUrl, errorDesc, errorCode) {
  var isDark = document.documentElement.classList.contains('dark') || localStorage.getItem('theme') === 'dark';
  var cs = getComputedStyle(document.documentElement);
  var v = function(n, fb) { return cs.getPropertyValue(n).trim() || fb; };
  var bgBody    = v('--bg-body',     isDark ? '#0a0a0a' : '#f5f5f5');
  var bgCard    = v('--bg-card',     isDark ? '#151515' : '#fff');
  var bgHover   = v('--bg-hover',    isDark ? '#1e1e1e' : '#f0f0f0');
  var textPri   = v('--text-primary',isDark ? '#e0e0e0' : '#333');
  var textMuted = v('--text-muted',  isDark ? '#777'    : '#666');
  var textDim   = v('--text-dim',    isDark ? '#555'    : '#888');
  var textDimmer= v('--text-dimmer', isDark ? '#444'    : '#999');
  var borderCard= v('--border-card', isDark ? '#222'    : '#e0e0e0');
  var borderSub = v('--border-subtle',isDark ? '#252525': '#e0e0e0');
  var accent    = v('--accent',      '#b4451a');
  var accentHov = v('--accent-hover','#c9562a');

  var safeUrl = (failedUrl || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  var domain = '';
  try { domain = new URL(failedUrl).hostname; } catch(e) { domain = (failedUrl || '').replace(/^https?:\/\//, '').split('/')[0]; }
  var safeDomain = domain.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  var waybackUrl = 'https://web.archive.org/web/*/' + encodeURIComponent(failedUrl || '');
  var searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(domain);
  var googleCacheUrl = 'https://webcache.googleusercontent.com/search?q=cache:' + encodeURIComponent(failedUrl || '');

  // Look up error info
  var errInfo = _browseErrorMap[String(errorCode)];
  if (!errInfo) {
    var isSSL = errorCode <= -200 && errorCode >= -210;
    errInfo = {
      id: 'ERR_' + (errorCode || 'UNKNOWN'),
      title: isSSL ? 'Your connection is not private' : 'This site can\u2019t be reached',
      desc: errorDesc || 'An unexpected error occurred while loading <strong>%DOMAIN%</strong>.',
      icon: isSSL ? 'ssl' : 'offline',
      suggestions: ['Check your internet connection', 'Try again later']
    };
  }
  var desc = errInfo.desc.replace(/%DOMAIN%/g, safeDomain);

  // SVG icons (match app aesthetic, no emoji)
  var icons = {
    'dns':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="30" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="36" r="4" fill="' + textDim + '"/><path d="M36 6v60M6 36h60" stroke="' + textDim + '" stroke-width="1" opacity=".25"/><ellipse cx="36" cy="36" rx="16" ry="30" stroke="' + textDim + '" stroke-width="1.2" fill="none"/><path d="M10 24h52M10 48h52" stroke="' + textDim + '" stroke-width=".8" opacity=".2"/><line x1="10" y1="10" x2="62" y2="62" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'offline': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><path d="M14 50a24 24 0 0144 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".25"/><path d="M22 44a16 16 0 0128 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".4"/><path d="M30 38a8 8 0 0112 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".6"/><circle cx="36" cy="50" r="3" fill="' + textDim + '"/><line x1="12" y1="12" x2="60" y2="60" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'timeout': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="38" r="26" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><path d="M36 20v20l12 7" stroke="' + textDim + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 8h16" stroke="' + textDim + '" stroke-width="1.5" stroke-linecap="round"/></svg>',
    'refused': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="20" y="16" width="32" height="40" rx="4" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><line x1="20" y1="32" x2="52" y2="32" stroke="' + textDim + '" stroke-width="1"/><circle cx="36" cy="44" r="3" fill="' + textDim + '"/><line x1="12" y1="10" x2="60" y2="62" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'ssl':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="22" y="32" width="28" height="24" rx="3" stroke="' + accent + '" stroke-width="1.5" fill="none"/><path d="M28 32v-6a8 8 0 0116 0v6" stroke="' + accent + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="44" r="2.5" fill="' + accent + '"/><line x1="36" y1="47" x2="36" y2="51" stroke="' + accent + '" stroke-width="1.5" stroke-linecap="round"/><path d="M20 16l-4 4M52 16l4 4" stroke="' + accent + '" stroke-width="1.5" stroke-linecap="round" opacity=".6"/></svg>',
    '404':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="28" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><text x="36" y="44" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="600" fill="' + textDim + '">404</text></svg>',
    '403':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="28" stroke="' + accent + '" stroke-width="1.5" fill="none"/><rect x="30" y="22" width="12" height="16" rx="6" stroke="' + accent + '" stroke-width="1.5" fill="none"/><rect x="26" y="36" width="20" height="16" rx="3" stroke="' + accent + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="44" r="2" fill="' + accent + '"/></svg>',
    'server':  '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="16" y="14" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><rect x="16" y="32" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><rect x="16" y="50" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".35"/><circle cx="24" cy="21" r="2" fill="' + textDim + '"/><circle cx="24" cy="39" r="2" fill="' + textDim + '"/><circle cx="24" cy="57" r="2" fill="' + textDim + '" opacity=".35"/><line x1="48" y1="21" x2="42" y2="21" stroke="' + textDim + '" stroke-width="1" stroke-linecap="round" opacity=".4"/><line x1="48" y1="39" x2="42" y2="39" stroke="' + textDim + '" stroke-width="1" stroke-linecap="round" opacity=".4"/></svg>',
  };
  var iconSvg = icons[errInfo.icon] || icons['offline'];

  var suggestionsHtml = errInfo.suggestions.map(function(s) {
    return '<li>' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</li>';
  }).join('');

  var errId = errInfo.id || ('ERR_' + errorCode);

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'background:' + bgBody + ';color:' + textPri + ';display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 24px}' +
    '.ep{max-width:520px;width:100%}' +
    '.ep-top{display:flex;align-items:flex-start;gap:24px;margin-bottom:20px}' +
    '.ep-icon{flex-shrink:0;opacity:.85}' +
    '.ep-text{flex:1;min-width:0}' +
    '.ep-title{font-size:20px;font-weight:600;margin-bottom:6px;line-height:1.3}' +
    '.ep-desc{font-size:13px;color:' + textMuted + ';line-height:1.5;margin-bottom:6px}' +
    '.ep-desc strong{color:' + textPri + ';font-weight:500}' +
    '.ep-id{font-size:11px;color:' + textDimmer + ';font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;margin-bottom:2px}' +
    '.ep-card{background:' + bgCard + ';border:1px solid ' + borderCard + ';border-radius:10px;padding:14px 18px;margin-bottom:16px}' +
    '.ep-card-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:' + textDim + ';margin-bottom:10px}' +
    '.ep-suggestions{list-style:none;padding:0}' +
    '.ep-suggestions li{font-size:13px;color:' + textMuted + ';padding:3px 0 3px 16px;position:relative;line-height:1.5}' +
    '.ep-suggestions li::before{content:"";position:absolute;left:0;top:11px;width:5px;height:5px;border-radius:50%;background:' + borderSub + '}' +
    '.ep-actions{display:flex;gap:8px;flex-wrap:wrap}' +
    'a.ep-btn,button.ep-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid ' + borderCard + ';' +
      'background:' + bgCard + ';color:' + textPri + ';font-size:12.5px;cursor:pointer;text-decoration:none;transition:border-color .15s,color .15s,background .15s;font-family:inherit;line-height:1.4}' +
    'a.ep-btn:hover,button.ep-btn:hover{background:' + bgHover + ';border-color:' + accent + ';color:' + accent + '}' +
    '.ep-btn.primary{background:' + accent + ';color:#fff;border-color:' + accent + '}' +
    '.ep-btn.primary:hover{background:' + accentHov + ';color:#fff}' +
    '.ep-btn svg{width:13px;height:13px;flex-shrink:0}' +
    '.ep-details{margin-top:14px}' +
    '.ep-details summary{font-size:11.5px;color:' + textDim + ';cursor:pointer;user-select:none}' +
    '.ep-details summary:hover{color:' + textMuted + '}' +
    '.ep-details-body{margin-top:8px;font-size:11px;color:' + textDimmer + ';font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;line-height:1.7;word-break:break-all}' +
  '</style></head><body>' +
  '<div class="ep">' +
    '<div class="ep-top">' +
      '<div class="ep-icon">' + iconSvg + '</div>' +
      '<div class="ep-text">' +
        '<div class="ep-title">' + errInfo.title.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>' +
        '<div class="ep-desc">' + desc + '</div>' +
        '<div class="ep-id">' + errId + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ep-card">' +
      '<div class="ep-card-title">Try this</div>' +
      '<ul class="ep-suggestions">' + suggestionsHtml + '</ul>' +
    '</div>' +
    '<div class="ep-actions">' +
      '<button class="ep-btn primary" onclick="location.reload()">' +
        '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0110.89-3.48M14 2v4h-4M14 8a6 6 0 01-10.89 3.48M2 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        'Reload</button>' +
      '<a class="ep-btn" href="' + waybackUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 4v4.5l3 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Wayback Machine</a>' +
      '<a class="ep-btn" href="' + searchUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Search</a>' +
      '<a class="ep-btn" href="' + googleCacheUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Cached</a>' +
    '</div>' +
    '<details class="ep-details">' +
      '<summary>Details</summary>' +
      '<div class="ep-details-body">' +
        errId + (errorCode ? ' (' + errorCode + ')' : '') + '<br>' +
        (errorDesc ? errorDesc.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '<br>' : '') +
        safeUrl +
      '</div>' +
    '</details>' +
  '</div></body></html>';

  if (_browseIsElectron) {
    try { frame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch {}
  } else {
    frame.srcdoc = html;
  }
  tab.title = errInfo.title;
  tab.errorPage = true;
  _browseRenderTabs();
}

var _ytAdBlockCSS =
  '#player-ads,' +
  '.ytp-ad-module,' +
  '.ytp-ad-overlay-container,' +
  '.ytp-ad-overlay-slot,' +
  '.ytp-ad-image-overlay,' +
  'ytd-promoted-sparkles-web-renderer,' +
  'ytd-display-ad-renderer,' +
  'ytd-ad-slot-renderer,' +
  'ytd-in-feed-ad-layout-renderer,' +
  'ytd-banner-promo-renderer,' +
  'ytd-statement-banner-renderer,' +
  '#masthead-ad,' +
  '#feedmodule-ad,' +
  '.ytd-rich-item-renderer[is-ad],' +
  'ytd-promoted-video-renderer,' +
  'tp-yt-paper-dialog.ytd-enforcement-message-view-model,' +
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]' +
  '{display:none!important}' +
  '#movie_player.ad-showing video,#movie_player.ad-interrupting video{opacity:0!important}' +
  '#movie_player.ad-showing .ytp-chrome-bottom{opacity:0!important}' +
  '.ytp-ad-text,.ytp-ad-preview-container,.ytp-ad-badge,.ytp-ad-visit-advertiser-button{display:none!important}';

// Inject YouTube ad-block CSS + early mute (before JS runs, hides from first paint)
function _browseInjectYouTubeCSS(frame, url) {
  if (!url || !url.includes('youtube.com')) return;
  if (localStorage.getItem('adBlockEnabled') !== 'true') return;
  frame.insertCSS(_ytAdBlockCSS).catch(function(){});
  // Mute video elements immediately so ad audio never plays
  frame.executeJavaScript(`(function(){
    if(window.__aetherYtEarlyMute) return;
    window.__aetherYtEarlyMute=true;
    function muteAds(){
      var p=document.getElementById('movie_player');
      var isAd=p&&(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting'));
      document.querySelectorAll('video').forEach(function(v){if(isAd)v.muted=true;});
    }
    // Intercept play() to mute before audio starts
    var origPlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){
      var p=document.getElementById('movie_player');
      if(p&&(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting')))this.muted=true;
      return origPlay.apply(this,arguments);
    };
    // Also watch for video elements being added
    var obs=new MutationObserver(function(){muteAds();});
    obs.observe(document.documentElement,{childList:true,subtree:true});
  })();`).catch(function(){});
}

function _browseInjectYouTubeAdBlock(frame, url) {
  if (!url || !url.includes('youtube.com')) return;
  if (localStorage.getItem('adBlockEnabled') !== 'true') return;
  frame.executeJavaScript(`(function(){
    if(window.__aetherYtAdBlockInjected) return;
    window.__aetherYtAdBlockInjected=true;

    // 1. Skip video ads via polling
    var _wasMuted=false;
    var skipInterval=setInterval(function(){
      var player=document.querySelector('#movie_player');
      if(!player) return;
      var isAd=player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting');
      if(isAd){
        var v=document.querySelector('video');
        if(v){
          if(!_wasMuted) _wasMuted=!v.muted;
          v.muted=true;
          // Try multiple skip strategies
          v.playbackRate=16;
          try{v.currentTime=9999;}catch(e){}
          try{v.currentTime=v.duration||9999;}catch(e){}
        }
        // Click every possible skip button variant
        var btns=document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-ad-skip-button-container button');
        btns.forEach(function(b){b.click();});
        var skipOv=document.querySelector('.ytp-ad-overlay-close-button');
        if(skipOv) skipOv.click();
        // Also try the player API directly
        try{
          var p=document.getElementById('movie_player');
          if(p&&p.skipAd) p.skipAd();
          if(p&&p.cancelPlayback) p.cancelPlayback();
        }catch(e){}
      } else {
        var v2=document.querySelector('video');
        if(v2){
          v2.playbackRate=1;
          if(_wasMuted){v2.muted=false;_wasMuted=false;}
        }
      }
    },300);

    // 3. MutationObserver for enforcement dialogs
    var obs=new MutationObserver(function(muts){
      // Dismiss ad-blocker enforcement popup
      var enforce=document.querySelector('tp-yt-paper-dialog.ytd-enforcement-message-view-model');
      if(enforce){
        enforce.remove();
        var bg=document.querySelector('tp-yt-iron-overlay-backdrop');
        if(bg) bg.remove();
        var v=document.querySelector('video');
        if(v&&v.paused) v.play();
      }
      // Also try the playability error
      var pe=document.querySelector('yt-playability-error-supported-renderers');
      if(pe){
        var dismiss=pe.querySelector('button, .yt-playability-error-supported-renderers__dismiss-button');
        if(dismiss) dismiss.click();
      }
    });
    obs.observe(document.body||document.documentElement,{childList:true,subtree:true});

  })();`).catch(function(){});
}

function _browseInjectContentScripts(tab, frame) {
  // Context menu — always show aether panel (with context items for links/images)
  // Debounce: the injected script also fires __AETHER_CONTEXT__ for the same right-click
  let _ctxMenuHandledAt = 0;
  frame.addEventListener('context-menu', (ev) => {
    ev.preventDefault();
    _ctxMenuHandledAt = Date.now();
    if (typeof _showPanel !== 'function') return;
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { popup.remove(); _aetherTrackMode = false; }
    const ctxData = (ev.linkURL || ev.srcURL) ? {
      linkUrl: ev.linkURL || '', linkText: ev.linkText || '',
      imgUrl: ev.srcURL || '', mediaType: ev.mediaType || ''
    } : null;
    _showPanel({ anchor: { x: ev.x, y: ev.y }, contextMenu: ctxData, trackCursor: !ctxData });
  });

  // Inject right-click handler after page loads
  frame.addEventListener('dom-ready', () => {
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherContextMenuInjected)return;
        window.__aetherContextMenuInjected=true;
        // Override window.open to relay to parent as new tab
        var _origOpen=window.open;
        window.open=function(url){
          if(url&&url.indexOf('javascript:')!==0){
            try{var resolved=new URL(url,location.href).href;console.log('__AETHER_OPEN_TAB__'+resolved);}catch(e){console.log('__AETHER_OPEN_TAB__'+url);}
          }
          return null;
        };
        document.addEventListener('contextmenu',function(e){
          var tag = e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable){
            e.preventDefault();e.stopPropagation();
            window.__aetherLastEditable=e.target;
            console.log('__AETHER_EDITABLE__'+JSON.stringify({x:e.screenX,y:e.screenY}));
            return false;
          }
          var data = {x:e.screenX,y:e.screenY};
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.getAttribute('href');
            if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
              data.linkUrl=h;
              data.linkText=a.textContent.trim().slice(0,100);
            }
          }
          var img=e.target.closest('img');
          if(img && img.src){
            data.imgUrl=img.src;
            data.imgAlt=img.alt||'';
          }
          e.preventDefault();
          e.stopPropagation();
          if(data.linkUrl||data.imgUrl){
            console.log('__AETHER_CONTEXT__'+JSON.stringify(data));
          } else {
            console.log('__AETHER_CHAT__'+JSON.stringify(data));
          }
          return false;
        },true);
        // Text selection inside webview → relay to parent
        var _wvSelDragging=false;
        document.addEventListener('mousedown',function(e){
          if(e.button!==0) return;
          console.log('__AETHER_CLOSE_MENU__'); console.log('__AETHER_DISMISS_CHAT__');
          var tag=e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||tag==='BUTTON') return;
          if(e.target.isContentEditable) return;
          _wvSelDragging=true;
        },true);
        document.addEventListener('selectionchange',function(){
          if(!_wvSelDragging) return;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(!text||text.length<3||sel.rangeCount===0) return;
          var r=sel.getRangeAt(0).getBoundingClientRect();
          console.log('__AETHER_SEL_PREVIEW__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
        });
        document.addEventListener('mouseup',function(e){
          if(!_wvSelDragging) return;
          _wvSelDragging=false;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(text&&text.length>=3&&sel.rangeCount>0){
            var r=sel.getRangeAt(0).getBoundingClientRect();
            console.log('__AETHER_SEL_FINAL__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
          } else {
            console.log('__AETHER_SEL_CLEAR__');
          }
        },true);
        document.addEventListener('keydown',function(e){
          if(e.key==='Escape') console.log('__AETHER_DISMISS_CHAT__');
          if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();console.log('__AETHER_FIND__');}
          if(e.altKey&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){if(e.key==='ArrowLeft'){e.preventDefault();console.log('__AETHER_TAB_LEFT__');}if(e.key==='ArrowRight'){e.preventDefault();console.log('__AETHER_TAB_RIGHT__');}}
        },true);
        // Link hover preview — relay to parent
        var _lastHoveredHref='';
        document.addEventListener('mouseover',function(e){
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.href;
            if(h&&h!=='#'&&h.indexOf('javascript:')!==0&&h!==_lastHoveredHref){
              _lastHoveredHref=h;
              console.log('__AETHER_LINK_HOVER__'+h);
            }
          } else if(_lastHoveredHref){
            _lastHoveredHref='';
            console.log('__AETHER_LINK_LEAVE__');
          }
        },true);
        // Throttled mousemove for aether panel
        var _lastMove=0;
        document.addEventListener('mousemove',function(e){
          var now=Date.now();
          if(now-_lastMove<16) return;
          _lastMove=now;
          console.log('__AETHER_MOUSE__'+e.screenX+','+e.screenY);
        });
        // Relay clicks for neuralook implicit tracking
        document.addEventListener('click',function(e){
          console.log('__NEURALOOK_CLICK__'+e.screenX+','+e.screenY);
          // Intercept target="_blank" links and Cmd/Ctrl+click to open in new tab
          var a=e.target.closest('a[href]');
          if(a){
            var href=a.href;
            if(!href||href.indexOf('javascript:')===0||href.charAt(0)==='#') return;
            if(a.target==='_blank'||e.metaKey||e.ctrlKey){
              e.preventDefault();
              e.stopPropagation();
              console.log('__AETHER_OPEN_TAB__'+href);
            }
          }
        },true);
      })();
    `).catch(()=>{});

    // RSS feed detection
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherRssDetected)return;
        window.__aetherRssDetected=true;
        var links=document.querySelectorAll('link[type="application/rss+xml"],link[type="application/atom+xml"],link[type="application/feed+json"]');
        if(links.length){
          var feeds=[];
          for(var i=0;i<links.length;i++){
            feeds.push({url:links[i].href||links[i].getAttribute('href'),title:links[i].title||''});
          }
          console.log('__AETHER_RSS_FEEDS__'+JSON.stringify(feeds));
        }
      })();
    `).catch(()=>{});

    // Password field detection + form submit interception
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherPwInjected)return;
        window.__aetherPwInjected=true;
        function findPwFields(){return Array.from(document.querySelectorAll('input[type="password"]'));}
        function findUsernameField(pwField){
          var form=pwField.closest('form');
          var scope=form||document;
          var candidates=scope.querySelectorAll('input[type="text"],input[type="email"],input:not([type])');
          for(var i=candidates.length-1;i>=0;i--){
            var c=candidates[i];
            var n=(c.name||'').toLowerCase()+(c.id||'').toLowerCase()+(c.autocomplete||'').toLowerCase()+(c.placeholder||'').toLowerCase();
            if(n.match(/user|email|login|account|name/)) return c;
          }
          return candidates.length?candidates[candidates.length-1]:null;
        }
        function notifyFields(){
          if(findPwFields().length>0) console.log('__AETHER_PW_FIELDS__');
        }
        notifyFields();
        var obs=new MutationObserver(function(){notifyFields();});
        obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
        function captureSubmit(e){
          var pwFields=findPwFields();
          if(!pwFields.length) return;
          var pw=null,un=null;
          for(var i=0;i<pwFields.length;i++){
            if(pwFields[i].value){pw=pwFields[i].value;var uf=findUsernameField(pwFields[i]);if(uf)un=uf.value;break;}
          }
          if(!pw) return;
          console.log('__AETHER_PW_SUBMIT__'+JSON.stringify({origin:location.origin,username:un||'',password:pw}));
        }
        document.addEventListener('submit',function(e){
          if(e.target.querySelector('input[type="password"]')) captureSubmit(e);
        },true);
        document.addEventListener('click',function(e){
          var btn=e.target.closest('button,input[type="submit"],a[role="button"]');
          if(!btn) return;
          var form=btn.closest('form');
          if(form&&form.querySelector('input[type="password"]')) setTimeout(function(){captureSubmit();},100);
        },true);
      })();
    `).catch(()=>{});

    // YouTube ad blocking injection
    _browseInjectYouTubeAdBlock(frame, frame.getURL());
  });

  frame.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) _browseInjectYouTubeAdBlock(frame, e.url);
  });

  // Listen for context menu via console message
  frame.addEventListener('console-message', (e) => {
    if (e.message && e.message.startsWith('__AETHER_LINK_HOVER__')) {
      _showLinkPreview(e.message.slice('__AETHER_LINK_HOVER__'.length));
      return;
    } else if (e.message === '__AETHER_LINK_LEAVE__') {
      _hideLinkPreview();
      return;
    } else if (e.message === '__AETHER_DISMISS_CHAT__') {
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) {
        if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
        _aetherTrackMode = false;
        popup.remove();
      }
    } else if (e.message && e.message.startsWith('__AETHER_MOUSE__')) {
      if (!_aetherTrackMode) return;
      const parts = e.message.slice('__AETHER_MOUSE__'.length).split(',');
      const x = parseInt(parts[0]) - window.screenX;
      const y = parseInt(parts[1]) - window.screenY;
      _lastMouseX = x;
      _lastMouseY = y;
      const popup = document.getElementById('doc-chat-ask-float');
      if (!popup) { _aetherTrackMode = false; return; }
      const preferLeft = (localStorage.getItem('aetherPanelSide') || 'left') === 'left';
      const pos = _positionAtCursor(x, y, popup.offsetWidth, popup.offsetHeight, preferLeft);
      popup.style.left = pos.left + 'px';
      popup.style.top = pos.top + 'px';
    } else if (e.message === '__AETHER_CLOSE_MENU__') {
      _hideBrowseContextMenu();
    } else if (e.message && e.message.startsWith('__AETHER_CONTEXT__')) {
      // Skip if the Electron context-menu event already handled this right-click
      if (Date.now() - _ctxMenuHandledAt < 300) return;
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CONTEXT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, contextMenu: data });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_CHAT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CHAT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: true });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_EDITABLE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_EDITABLE__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: false, webviewEditable: { webview: frame, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } });
        }
      } catch (err) {}
    } else if (e.message === '__AETHER_FIND__') {
      _browseToggleFindBar();
    } else if (e.message === '__AETHER_TAB_LEFT__') {
      _switchTabLeft();
    } else if (e.message === '__AETHER_TAB_RIGHT__') {
      _switchTabRight();
    } else if (e.message && (e.message.startsWith('__AETHER_SEL_PREVIEW__') || e.message.startsWith('__AETHER_SEL_FINAL__'))) {
      try {
        const isFinal = e.message.startsWith('__AETHER_SEL_FINAL__');
        const prefix = isFinal ? '__AETHER_SEL_FINAL__' : '__AETHER_SEL_PREVIEW__';
        const data = JSON.parse(e.message.slice(prefix.length));
        const selectionRect = _iframeRectToParent(data, frame);
        _aetherTrackMode = false;
        if (!isFinal) {
          const existing = document.getElementById('doc-chat-ask-float');
          if (existing && existing._isAetherPanel) existing.remove();
        }
        _showPanel({ anchor: { selectionRect }, selectionText: data.text, finalized: isFinal });
      } catch (err) {}
    } else if (e.message === '__AETHER_SEL_CLEAR__') {
      const existing = document.getElementById('doc-chat-ask-float');
      if (existing) { existing.remove(); _aetherTrackMode = false; }
    } else if (e.message && e.message.startsWith('__AETHER_LINK__')) {
      // Legacy support
      try {
        const data = JSON.parse(e.message.slice('__AETHER_LINK__'.length));
        if (data.href) {
          const x = data.x - window.screenX;
          const y = data.y - window.screenY;
          _showBrowseContextMenu(x, y, { linkUrl: data.href, linkText: data.text || '' });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_OPEN_TAB__')) {
      const url = e.message.slice('__AETHER_OPEN_TAB__'.length);
      if (url) browseNewTab(url);
    } else if (e.message && e.message.startsWith('__NEURALOOK_CLICK__')) {
      if (typeof _nlHandleIframeClick === 'function') {
        const parts = e.message.slice('__NEURALOOK_CLICK__'.length).split(',');
        const x = parseInt(parts[0]) - window.screenX;
        const y = parseInt(parts[1]) - window.screenY;
        _nlHandleIframeClick(x, y);
      }
    } else if (e.message && e.message.startsWith('__AETHER_RSS_FEEDS__')) {
      try {
        const feeds = JSON.parse(e.message.slice('__AETHER_RSS_FEEDS__'.length));
        // Resolve relative URLs against tab.url
        tab.rssFeeds = feeds.map(f => {
          try { return { url: new URL(f.url, tab.url).href, title: f.title }; }
          catch { return f; }
        });
        _browseUpdateRssPill(tab);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_ANN_MOVE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_ANN_MOVE__'.length));
        _showAnnotationTooltip(data, frame);
      } catch (err) {}
    } else if (e.message === '__AETHER_ANN_LEAVE__') {
      _hideAnnotationTooltip();
    } else if (e.message === '__AETHER_PW_FIELDS__') {
      _pwCheckAutofill(tab, frame);
    } else if (e.message && e.message.startsWith('__AETHER_PW_SUBMIT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PW_SUBMIT__'.length));
        _pwPendingPrompt = { tab, data, ts: Date.now() };
        _pwShowSavePrompt(tab, data);
      } catch (err) {}
    }
  });
}

function _browseUpdateRssPill(tab) {
  if (tab.id !== _browseActiveTab || !tab.rssFeeds || !tab.rssFeeds.length) {
    var cur = _islandActivities && _islandActivities['rss'];
    if (!cur || !cur.subscribed) islandRemove('rss');
    return;
  }
  var feed = tab.rssFeeds[0];
  var feedUrl = feed.url;
  // Check if already subscribed (custom feeds or catalog)
  var customFeeds = [];
  try { customFeeds = JSON.parse(localStorage.getItem('customFeeds')) || []; } catch {}
  var isSubscribed = customFeeds.some(function(f) { return f.url === feedUrl; });
  if (!isSubscribed) {
    // Also check FEED_CATALOG urls
    isSubscribed = (typeof FEED_CATALOG !== 'undefined') && FEED_CATALOG.some(function(c) { return c.url === feedUrl; });
  }
  var label = feed.title || (tab.rssFeeds.length > 1 ? tab.rssFeeds.length + ' feeds' : 'RSS Feed');
  if (label.length > 24) label = label.slice(0, 22) + '\u2026';
  islandUpdate('rss', {
    type: 'rss',
    label: isSubscribed ? 'Subscribed' : label,
    detail: isSubscribed ? label : 'Subscribe',
    subscribed: isSubscribed,
    feedUrl: feedUrl,
    feedTitle: feed.title || '',
    action: isSubscribed ? null : function() {
      // Subscribe to feed
      var feeds = [];
      try { feeds = JSON.parse(localStorage.getItem('customFeeds')) || []; } catch {}
      if (feeds.some(function(f) { return f.url === feedUrl; })) return;
      var name = feed.title || feedUrl;
      try { name = name || new URL(feedUrl).hostname.replace(/^www\./, ''); } catch {}
      feeds.push({ url: feedUrl, name: name, enabled: true });
      localStorage.setItem('customFeeds', JSON.stringify(feeds));
      // Refresh pill to show subscribed state
      _browseUpdateRssPill(tab);
      // Reload feeds if available
      if (typeof loadAllFeeds === 'function') { allPapers = []; loadAllFeeds(); }
    }
  });
}

function _browseBindFrame(tab) {
  if (tab.contentType === 'reader') return;
  const el = tab.el;
  if (!el || !_browseIsElectron) return;

  _browseHandleNavigation(tab, el);
  _browseInjectContentScripts(tab, el);

  // Adblock: generic ad placeholder CSS (covers common ad frameworks)
  var _adPlaceholderCSS =
    'ins.adsbygoogle,' +
    'ins.adsbygoogle[data-ad-status],' +
    '[id^="google_ads_"],' +
    '[id^="div-gpt-ad"],' +
    '[data-google-query-id],' +
    'iframe[src*="doubleclick.net"],' +
    'iframe[src*="googlesyndication.com"],' +
    'iframe[id^="google_ads_"],' +
    'iframe[src=""],' +
    '.ad-container,' +
    '.ad-wrapper,' +
    '.ad-slot,' +
    '.ad-banner,' +
    '.adunit,' +
    '#ad-container,' +
    '#ad-wrapper,' +
    '#ad-slot,' +
    '[data-ad-slot],' +
    '[data-ad],' +
    'amp-ad,' +
    'amp-embed[type="ad"],' +
    '.ad-placeholder,' +
    '.ad-loading,' +
    '.sponsored-content' +
    '{display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important}';

  // Adblock: inject cosmetic CSS early + remove elements + update badge
  if (window.electronAPI && window.electronAPI.adblockCosmetic) {
    // Inject generic ad placeholder CSS on every navigation
    const _injectPlaceholderCSS = (url) => {
      if (localStorage.getItem('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      try { el.insertCSS(_adPlaceholderCSS); } catch {}
    };

    // Inject EasyList cosmetic selectors + remove elements from DOM
    const _injectCosmetic = (url) => {
      if (localStorage.getItem('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      window.electronAPI.adblockCosmetic(url).then(res => {
        var extraSel = (res && res.selectors && res.selectors.length) ? res.selectors.join(', ') : '';
        // Hide via CSS (both EasyList selectors and generic placeholders)
        if (extraSel) {
          try { el.insertCSS(extraSel + ' { display: none !important; }'); } catch {}
        }
        // Remove elements from DOM (EasyList + generic ad containers)
        el.executeJavaScript(`(function(){
          if(window.__aetherAdCleanInjected) return;
          window.__aetherAdCleanInjected=true;
          var extra = ${JSON.stringify(extraSel)};
          var generic = 'ins.adsbygoogle, [id^="google_ads_"], [id^="div-gpt-ad"], [data-google-query-id], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[id^="google_ads_"], [data-ad-slot], amp-ad, amp-embed[type="ad"]';
          var sel = extra ? (generic + ', ' + extra) : generic;
          function removeAds(){
            document.querySelectorAll(sel).forEach(function(el){el.remove();});
            // Also remove iframes that failed to load (blocked by network filter)
            document.querySelectorAll('iframe').forEach(function(f){
              try{
                var s=f.src||f.getAttribute('src')||'';
                if(!s||s==='about:blank'||(f.offsetWidth<=1&&f.offsetHeight<=1)) return;
                if(s.includes('ad')||s.includes('sponsor')||s.includes('doubleclick')||s.includes('googlesyndication')) f.remove();
              }catch(e){}
            });
            // Collapse empty ad containers (divs with specific ad classes but no visible content)
            document.querySelectorAll('.ad-container,.ad-wrapper,.ad-slot,.ad-banner,.adunit,.ad-placeholder,#ad-container,#ad-wrapper,#ad-slot').forEach(function(el){
              if(el.children.length===0&&el.textContent.trim()==='') el.remove();
            });
          }
          removeAds();
          var obs=new MutationObserver(function(){removeAds();});
          obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
          setTimeout(function(){obs.disconnect();},30000);
        })();`).catch(() => {});
      }).catch(() => {});
    };
    el.addEventListener('dom-ready', () => {
      _injectPlaceholderCSS(tab.url || '');
      _injectCosmetic(tab.url || '');
    });
    el.addEventListener('did-navigate', (e) => {
      _injectPlaceholderCSS(e.url || '');
      _injectCosmetic(e.url || '');
    });
    el.addEventListener('did-finish-load', () => {
      // Update badge count after requests finish
      setTimeout(() => {
        if (_browseActiveTab === tab.id && typeof _browseUpdateAdBlockBadge === 'function') {
          _browseUpdateAdBlockBadge(tab.url || '');
        }
      }, 500);
    });
  }
}

// ── Password Manager ──

function _pwCheckAutofill(tab, frame) {
  if (!_browseIsElectron || !window.electronAPI || !window.electronAPI.pwGet) return;
  if (_pwAutofillOffered.has(tab.id)) return;
  _pwAutofillOffered.add(tab.id);
  try {
    const origin = new URL(tab.url).origin;
    window.electronAPI.pwGet(origin).then(entries => {
      if (!entries || !entries.length) return;
      if (entries.length === 1) {
        _pwDoAutofill(tab, frame, entries[0].id);
      } else {
        _pwShowAutofillPicker(tab, frame, entries);
      }
    }).catch(() => {});
  } catch (e) {}
}

function _pwDoAutofill(tab, frame, entryId) {
  if (!window.electronAPI || !window.electronAPI.pwFill) return;
  window.electronAPI.pwFill(entryId).then(cred => {
    if (!cred) return;
    const un = cred.username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const pw = cred.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    frame.executeJavaScript(`
      (function(){
        var pwFields=document.querySelectorAll('input[type="password"]');
        if(!pwFields.length) return;
        var pwField=pwFields[0];
        var form=pwField.closest('form');
        var scope=form||document;
        var candidates=scope.querySelectorAll('input[type="text"],input[type="email"],input:not([type])');
        var unField=null;
        for(var i=candidates.length-1;i>=0;i--){
          var c=candidates[i];
          var n=(c.name||'').toLowerCase()+(c.id||'').toLowerCase()+(c.autocomplete||'').toLowerCase()+(c.placeholder||'').toLowerCase();
          if(n.match(/user|email|login|account|name/)){unField=c;break;}
        }
        if(!unField&&candidates.length) unField=candidates[candidates.length-1];
        function setVal(el,val){
          var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          nativeSetter.call(el,val);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
        }
        if(unField) setVal(unField,'${un}');
        setVal(pwField,'${pw}');
      })();
    `).catch(() => {});
  }).catch(() => {});
}

function _pwShowAutofillPicker(tab, frame, entries) {
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.createElement('div');
  bar.className = 'browse-pw-save-bar';
  bar.id = 'browse-pw-bar';
  let pills = entries.map(e =>
    `<button onclick="_pwDoAutofill(_browseTabs.find(t=>t.id===${tab.id}), document.querySelector('#browse-content webview'), '${e.id}'); _pwHideSavePrompt();" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.78rem;cursor:pointer;">${escapeHtml(e.username || 'No username')}</button>`
  ).join('');
  bar.innerHTML = `<span style="font-size:0.8rem;color:var(--text-dim);">Choose account:</span> ${pills}
    <button onclick="_pwHideSavePrompt()" style="margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dimmer);font-size:0.72rem;cursor:pointer;">Dismiss</button>`;
  container.prepend(bar);
}

function _pwShowSavePrompt(tab, data) {
  if (!_browseIsElectron || !window.electronAPI || !window.electronAPI.pwSave) return;
  if (!data.password) return;
  // Dedup rapid submits
  const now = Date.now();
  if (_pwLastSubmit && _pwLastSubmit.origin === data.origin && _pwLastSubmit.username === data.username && now - _pwLastSubmit.ts < 2000) return;
  _pwLastSubmit = { origin: data.origin, username: data.username, ts: now };
  // Check if dismissed
  const key = data.origin + '|' + data.username;
  if (_pwSaveDismissed.has(key)) return;
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.createElement('div');
  bar.className = 'browse-pw-save-bar';
  bar.id = 'browse-pw-bar';
  const displayUser = data.username || 'this site';
  bar.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent);flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span style="font-size:0.8rem;color:var(--text-primary);">Save password for <strong>${escapeHtml(displayUser)}</strong>?</span>
    <button id="pw-save-btn" style="padding:3px 12px;border-radius:4px;border:none;background:var(--accent);color:#fff;font-size:0.78rem;cursor:pointer;font-weight:500;">Save</button>
    <button id="pw-never-btn" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dim);font-size:0.78rem;cursor:pointer;">Never</button>
    <button onclick="_pwHideSavePrompt(true)" style="margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dimmer);font-size:0.72rem;cursor:pointer;">&times;</button>
  `;
  container.prepend(bar);
  // Keep password in closure, not DOM
  const password = data.password;
  bar.querySelector('#pw-save-btn').addEventListener('click', () => {
    window.electronAPI.pwSave({ origin: data.origin, username: data.username, password }).catch(() => {});
    _pwHideSavePrompt(true);
  });
  bar.querySelector('#pw-never-btn').addEventListener('click', () => {
    _pwSaveDismissed.set(key, true);
    _pwHideSavePrompt(true);
  });
  // Auto-dismiss after 15s
  const timer = setTimeout(() => _pwHideSavePrompt(true), 15000);
  bar._pwDismissTimer = timer;
}

function _pwHideSavePrompt(clearPending) {
  if (clearPending) _pwPendingPrompt = null;
  const bar = document.getElementById('browse-pw-bar');
  if (bar) {
    if (bar._pwDismissTimer) clearTimeout(bar._pwDismissTimer);
    bar.remove();
  }
}

// Context menu for Browse view (links and images)
let _browseContextMenu = null;
let _browseContextData = null;

function _hideBrowseContextMenu() {
  if (_browseContextMenu) {
    _browseContextMenu.remove();
    _browseContextMenu = null;
  }
  _browseContextData = null;
}

function _showBrowseContextMenu(x, y, data) {
  _hideBrowseContextMenu();
  _browseContextData = data;

  const menu = document.createElement('div');
  menu.className = 'browse-link-menu';

  let html = '';
  const linkUrl = data.linkUrl || '';
  const linkText = data.linkText || '';
  const imgUrl = data.imgUrl || '';

  // Link options
  if (linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-item" data-action="newtab">Open Link in New Tab</div>`;
    html += `<div class="blm-item" data-action="here">Open Link Here</div>`;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="savelink">Save Link As...</div>`;
    html += `<div class="blm-item" data-action="copylink">Copy Link Address</div>`;
    if (linkText) {
      html += `<div class="blm-item" data-action="copytext">Copy Link Text</div>`;
    }
  }

  // Image options
  if (imgUrl) {
    if (linkUrl) html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="openimg">Open Image in New Tab</div>`;
    html += `<div class="blm-item" data-action="saveimg">Save Image As...</div>`;
    html += `<div class="blm-item" data-action="copyimg">Copy Image Address</div>`;
  }

  // Search option
  if (linkText && linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="search">Search Google for "${escapeHtml(truncatedText)}"</div>`;
  }

  menu.innerHTML = html;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  _browseContextMenu = menu;

  // Adjust if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.blm-item');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'newtab') {
      browseNewTab(linkUrl);
    } else if (action === 'here') {
      browseNavigate(linkUrl);
    } else if (action === 'savelink') {
      _browseSaveLink(linkUrl);
    } else if (action === 'copylink') {
      navigator.clipboard.writeText(linkUrl).catch(() => {});
    } else if (action === 'copytext') {
      navigator.clipboard.writeText(linkText).catch(() => {});
    } else if (action === 'search') {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    } else if (action === 'openimg') {
      browseNewTab(imgUrl);
    } else if (action === 'saveimg') {
      _browseSaveImage(imgUrl);
    } else if (action === 'copyimg') {
      navigator.clipboard.writeText(imgUrl).catch(() => {});
    }
    _hideBrowseContextMenu();
  });
}

// Helper to trigger download
function _browseDownloadFile(url, defaultFilename = 'download') {
  const filename = url.split('/').pop().split('?')[0] || defaultFilename;

  if (window.electronAPI && window.electronAPI.downloadURL) {
    // Electron handles download tracking via download-started event
    window.electronAPI.downloadURL(url);
  } else {
    // Browser fallback: create manual download entry
    const dl = {
      id: 'dl-' + (++_browseDownloadIdCounter),
      filename,
      url,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: 0,
      startTime: Date.now(),
      savePath: ''
    };
    _browseDownloads.unshift(dl);
    _browseUpdateDownloadBadge();
    _browseRenderDownloads();
    _saveBrowseDownloads();

    // Trigger download via anchor
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Mark as completed (can't track progress in browser)
    setTimeout(() => {
      dl.state = 'completed';
      dl.receivedBytes = dl.totalBytes = 1;
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    }, 1500);
  }
}

function _browseSaveImage(url) {
  _browseDownloadFile(url, 'image');
}

function _browseSaveLink(url) {
  _browseDownloadFile(url, 'download');
}

// Close menu on click outside or escape
document.addEventListener('mousedown', (e) => {
  if (_browseContextMenu && !_browseContextMenu.contains(e.target)) {
    _hideBrowseContextMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _hideBrowseContextMenu();
});
// Close menu when webview gets focus (user clicked inside it)
window.addEventListener('blur', () => {
  _hideBrowseContextMenu();
});

// Mouse back/forward buttons (macOS — app-command doesn't fire on Mac)
document.addEventListener('mousedown', (e) => {
  if (e.button === 3) { e.preventDefault(); browseBack(); }
  else if (e.button === 4) { e.preventDefault(); browseForward(); }
});

function browseSelectTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;

  // Split mode branch: if tab is in a pane, focus it; else replace focused pane
  if (_browseIsSplitMode()) {
    const panes = _browseGetSplitPanes();
    const paneWithTab = panes.find(p => p.tabId === id);
    win.activeTab = id;
    var splitTab = win.tabs.find(t => t.id === id);
    if (splitTab) splitTab.lastVisited = Date.now();
    if (paneWithTab) {
      _browseFocusPane(paneWithTab.id);
    } else {
      // Replace focused pane's tab with this one
      const focusedId = _browseGetFocusedPane();
      const focusedPane = panes.find(p => p.id === focusedId) || panes[0];
      focusedPane.tabId = id;
      _browseSetSplitPanes(panes);
      const tab = win.tabs.find(t => t.id === id);
      if (tab) _browseEnsureTabFrame(tab);
      _browseRebuildSplitLayout();
      _browseFocusPane(focusedPane.id);
    }
    const tab = win.tabs.find(t => t.id === id);
    _browseRenderTabs();
    _browseUpdateNewTabPage(tab);
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, tab ? (tab.url || '') : '');
    _browseSaveTabs();

    // Handle paper tab in split mode
    if (tab && tab.paper) {
      _currentPaperViewPaper = tab.paper;
      if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
        _tryRenderSavedContent(tab.el, tab.paper);
      }
      _browseUpdateBarForTab(tab);
    }
    if (tab && !tab.blank && tab.url && !_restoreAnnotationPill(tab) && !_annotationsEnabled.get(tab.id)) _offerAnnotation(tab);
    return;
  }

  // Close find bar when switching tabs
  if (_browseFindBarActive) _browseCloseFindBar();
  // Reset zoom when switching tabs
  if (_browseZoomLevel !== 1) {
    _browseZoomLevel = 1;
    _browseZoomPanX = 0;
    _browseZoomPanY = 0;
    _browseApplyZoom();
  }

  // Stop captions when switching away from captured tab
  if (_ccTabId && _ccTabId !== id) stopCaptions();

  win.activeTab = id;
  const tab = win.tabs.find(t => t.id === id);
  if (tab) tab.lastVisited = Date.now();

  // Auto-close blank new tabs when navigating away, keeping only the most recent one
  const blankTabs = win.tabs.filter(t => t.blank && t.id !== id);
  if (blankTabs.length > 1) {
    // Keep only the last blank tab (most recently created), close the rest
    const toClose = blankTabs.slice(0, -1);
    for (const bt of toClose) {
      const bi = win.tabs.indexOf(bt);
      if (bi !== -1) {
        if (bt.el) bt.el.remove();
        win.tabs.splice(bi, 1);
      }
    }
  }

  // Load deferred tab if needed (lazy loading for YouTube etc.)
  if (tab && tab.deferred && !tab.el && tab.url) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, tab.url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
    tab.deferred = false;
  }

  // Restore history page tab if needed
  if (tab && tab._historyPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-history-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
  }

  // Restore help page tab if needed
  if (tab && tab._helpPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-help-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderHelpPage(el);
  }

  win.tabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab ? (tab._historyPage ? 'aether://history' : tab._helpPage ? 'aether://help' : tab.url) : '');
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  _updateAudioIndicator();

  // Paper tab handling
  if (tab && tab.paper) {
    _currentPaperViewPaper = tab.paper;
    if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
      _tryRenderSavedContent(tab.el, tab.paper);
    }
    // Update sidebar via universal panel
    if (tab.arxivId) {
      if (!_panelVisible) {
        _panelVisible = true;
        localStorage.setItem('universalPanelVisible', 'true');
      }
      _invalidatePanelRender('browse');
      showPanelForView('browse');
    } else {
      hidePanel();
    }
    _initSidebarForUrl(tab.url);
    _startScrollTracker(tab.url);
    _browseUpdateBarForTab(tab);
  } else {
    _currentPaperViewPaper = null;
    _browseUpdateBarForTab(tab);
    hidePanel();
    // Update sidebar for the selected tab
    if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
      _initSidebarForUrl(tab.url);
    }
  }
  if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();
  _updateAnnotateButtonState();
  // Restore annotation pill or offer for non-blank tabs
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  if (tab && !tab.blank && tab.url) {
    if (!_restoreAnnotationPill(tab)) {
      if (!_annotationsEnabled.get(tab.id)) _offerAnnotation(tab);
    }
  } else {
    const act = typeof _islandActivities !== 'undefined' ? _islandActivities['annotate'] : null;
    if (act) islandRemove('annotate');
  }
}

function _browseUpdateBarForTab(tab) {
  let citeBtn = document.getElementById('browse-cite-btn');
  let bookmarkBtn = document.getElementById('browse-paper-bookmark-btn');
  if (tab && tab.paper) {
    // Cite button
    if (!citeBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      citeBtn = document.createElement('button');
      citeBtn.id = 'browse-cite-btn';
      citeBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover flex items-center justify-center';
      citeBtn.onclick = function() { if (typeof showCitePopup === 'function') showCitePopup(); };
      citeBtn.title = 'Cite';
      citeBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>';
      if (moreBtn) moreBtn.parentElement.insertBefore(citeBtn, moreBtn);
    }
    citeBtn.style.display = '';
    // Bookmark button
    if (!bookmarkBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      bookmarkBtn = document.createElement('button');
      bookmarkBtn.id = 'browse-paper-bookmark-btn';
      bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center';
      bookmarkBtn.onclick = function() { if (typeof togglePaperViewBookmark === 'function') togglePaperViewBookmark(); };
      bookmarkBtn.title = 'Save';
      if (moreBtn) moreBtn.parentElement.insertBefore(bookmarkBtn, citeBtn);
    }
    const isSaved = typeof isPostSaved === 'function' && isPostSaved(tab.paper.link);
    bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (isSaved ? 'text-accent' : 'text-dimmer hover:text-primary');
    bookmarkBtn.title = isSaved ? 'Saved' : 'Save';
    bookmarkBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    bookmarkBtn.style.display = '';
  } else {
    if (citeBtn) citeBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
  }
}

function _browseUpdateNewTabPage(tab) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.getElementById('browse-bar');
  if (bar) bar.style.display = (tab && tab.blank) || _browseTabLayout === 'island' ? 'none' : '';
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      ntp = document.createElement('div');
      ntp.className = 'browse-ntp';
      ntp.innerHTML = `<input type="file" id="browse-pdf-file-input" multiple style="display:none" onchange="handleNtpFileInput(this)">
        <div class="browse-ntp-inner">
          <div class="browse-ntp-center">
            <div style="text-align:center;margin-bottom:12px;user-select:none;"><div class="browse-ntp-logo"><svg style="height:3rem;display:inline-block;" viewBox="-0.5 -8.5 6.5 9" xmlns="http://www.w3.org/2000/svg"><path fill="var(--text-dimmer)" d="M1.21943 -1.50635C1.44658 -0.3467 2.17584 0.143462 2.97684 0.143462C3.41918 0.143462 4.12453 -0.0119552 4.96139 -0.633624C5.23636 -0.860772 5.24832 -0.872727 5.24832 -0.956413C5.24832 -1.02814 5.10486 -1.2792 4.96139 -1.2792C4.91357 -1.2792 4.88966 -1.2792 4.77011 -1.15965C4.31582 -0.789041 3.63437 -0.286924 3.00075 -0.286924C2.30735 -0.286924 2.28344 -1.25529 2.28344 -1.54222C2.28344 -1.93674 2.33126 -2.21171 2.39103 -2.57036C2.47472 -2.666 2.72578 -2.8812 2.80946 -2.97684C3.44309 -3.59851 5.34396 -5.49938 5.34396 -7.23288C5.34396 -8.14147 4.8538 -8.39253 4.42341 -8.39253C2.58232 -8.39253 1.1477 -4.49514 1.1477 -2.15193C0.944458 -1.9726 0.406476 -1.53026 0.203238 -1.33898C0.0478207 -1.19552 0.0358655 -1.18356 0.0358655 -1.11183C0.0358655 -1.05205 0.179328 -0.789041 0.310834 -0.789041C0.37061 -0.789041 0.394521 -0.789041 0.561893 -0.944458L1.21943 -1.50635ZM2.59427 -3.51482C3.09639 -5.51133 3.15616 -5.73848 3.3594 -6.36015C3.44309 -6.61121 3.88543 -7.96214 4.41146 -7.96214C4.71034 -7.96214 4.80598 -7.72304 4.80598 -7.34047C4.80598 -6.89813 4.67447 -6.08518 3.82565 -4.93748C3.3594 -4.29191 2.73773 -3.64633 2.59427 -3.51482Z"/></svg></div></div>
            <div class="flex items-center justify-center gap-1" style="margin-bottom:12px;">
              <button id="research-tab-search" class="research-tab" onclick="switchResearchTab('search')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                Papers
              </button>
              <button id="research-tab-users" class="research-tab" onclick="switchResearchTab('users')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
                Users
              </button>
              <button id="research-tab-teams" class="research-tab" onclick="switchResearchTab('teams')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>
                Teams
              </button>
              <button id="research-tab-vault" class="research-tab" onclick="switchResearchTab('vault')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
                Notes
              </button>
            </div>
            <form id="search-form" onsubmit="event.preventDefault(); submitSearch()">
              <div class="ntp-search-box max-w-[680px] mx-auto">
                <div class="ntp-search-row">
                  <svg class="ntp-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                  <input type="text" id="search-query" placeholder="Ask anything..." autocomplete="off" class="ntp-search-input" oninput="onSearchInput(); _browseUrlShowHistory()" onfocus="_browseUrlCancelHide(); this.select(); _browseUrlShowHistory()" onblur="_browseUrlScheduleHide()" onkeydown="_browseUrlKeydown(event)" />
                </div>
                <div id="search-history-dropdown-view" class="ntp-dropdown" style="display:none;"></div>
                <div id="ntp-file-chips" class="ntp-file-chips-container"></div>
                <div class="ntp-search-actions">
                  <button type="button" class="ntp-action-pill" onmousedown="event.preventDefault()" onclick="_browseUrlCancelHide(); document.getElementById('browse-pdf-file-input').click()">+ Add tabs or files</button>
                  <button type="button" class="ntp-action-dots" title="More options">&middot;&middot;&middot;</button>
                  <div style="flex:1"></div>
                  <button type="submit" class="ntp-action-submit" title="Search"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-5 5m5-5l5 5"/></svg></button>
                </div>
              </div>
            </form>
            <div id="research-panel-search" class="research-panel" style="display:none;">
              <div id="search-hints" style="display:none"></div>
            </div>
            <div id="research-panel-users" class="research-panel" style="display:none;">
              <form id="user-search-form" onsubmit="event.preventDefault(); submitUserSearch()">
                <div class="relative max-w-[680px] mx-auto">
                  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dimmer pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
                  <input type="text" id="user-search-query" placeholder="Search users..." autocomplete="off" class="w-full pl-9 pr-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.85rem] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all" oninput="clearTimeout(_userSearchDebounce); _userSearchDebounce = setTimeout(submitUserSearch, 300)" />
                </div>
              </form>
              <div id="user-search-results" class="max-w-[680px] mx-auto"></div>
            </div>
            <div id="research-panel-teams" class="research-panel" style="display:none;">
              <div class="flex items-center justify-between mb-5">
                <h2 class="text-[1.1rem] font-semibold text-white_">Teams</h2>
                <button onclick="showCreateTeamPopup('research')" class="text-dimmer hover:text-primary bg-transparent border-none cursor-pointer text-xl leading-none p-0" title="Create team">+</button>
              </div>
              <div id="research-teams-content"></div>
            </div>
            <div id="research-panel-vault" class="research-panel" style="display:none;">
              <div id="ntp-vault-container" class="max-w-[680px] mx-auto"></div>
            </div>
          </div>
          <div id="search-feed-results"></div>
          <div id="search-arxiv-results"></div>
        </div>
        <div class="browse-ntp-version" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:var(--text-dimmest);font-size:11px;font-family:monospace;user-select:none;letter-spacing:0.08em;">aether</div>`;
      container.appendChild(ntp);
      fetch('/api/version').then(r => r.json()).then(v => {
        const el = ntp.querySelector('.browse-ntp-version');
        if (el && v.version) el.textContent = 'aether v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
      }).catch(() => {});
      ntp.addEventListener('dragover', function(e) { e.preventDefault(); ntp.style.outline = '2px dashed var(--accent)'; });
      ntp.addEventListener('dragleave', function() { ntp.style.outline = ''; });
      ntp.addEventListener('drop', function(e) {
        e.preventDefault();
        ntp.style.outline = '';
        const files = e.dataTransfer.files;
        if (files.length) {
          for (const file of files) handleNtpFileUpload(file);
        }
      });
    }
    ntp.style.display = '';
    // Clear search input and reset to default state
    const ntpInput = ntp.querySelector('#search-query');
    if (ntpInput) ntpInput.value = '';
    _researchActiveTab = null;
    switchResearchTab(null);
  } else if (ntp) {
    ntp.style.display = 'none';
  }
  if (_browseTabLayout === 'island') _pillSyncUrl();
  const pinchOverlay = container.querySelector('.browse-pinch-overlay');
  if (pinchOverlay) pinchOverlay.style.pointerEvents = (_browseZoomLevel > 1 && tab && !tab.blank) ? 'auto' : 'none';
}

function browseCloseTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;
  const idx = win.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = win.tabs[idx];

  // If tab is in a split pane, remove that pane first
  if (_browseIsSplitMode()) {
    const pane = _browsePaneForTab(id);
    if (pane) browseUnsplitPane(pane.id);
  }

  _browseClosedTabs.push({ url: tab.url || '', title: tab.title, blank: !!tab.blank, paper: tab.paper || null, contentType: tab.contentType || null, arxivId: tab.arxivId || null });
  if (_browseClosedTabs.length > _BROWSE_CLOSED_TABS_MAX) _browseClosedTabs.splice(0, _browseClosedTabs.length - _BROWSE_CLOSED_TABS_MAX);
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  // Stop captions if this is the captured tab
  if (_ccTabId === id) stopCaptions();
  _pwAutofillOffered.delete(id);
  _annotationsEnabled.delete(id);
  if (tab.el) tab.el.remove();
  // Clean up audio tracking
  _browseAudioTabs.delete(id);
  _updateAudioIndicator();
  win.tabs.splice(idx, 1);
  if (!win.tabs.length) {
    if (_browseWindows.length > 1) {
      browseCloseWindow(win.id);
      _browseAnimateBounce();
    } else {
      browseNewTab();
      _browseAnimateBounce();
    }
    return;
  }
  if (win.activeTab === id) {
    const nextIdx = Math.min(idx, win.tabs.length - 1);
    browseSelectTab(win.tabs[nextIdx].id);
  } else {
    _browseRenderTabs();
  }
  _browseSaveTabs();
}

function browseReopenTab() {
  if (!_browseClosedTabs.length) return;
  const closed = _browseClosedTabs.pop();
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  if (closed.paper && closed.contentType) {
    browseNewPaperTab(closed.url, closed.paper);
  } else {
    browseNewTab(closed.url);
  }
}

function _browseAnimateBounce() {
  const content = document.getElementById('browse-content');
  if (!content) return;
  Motion.sequence([
    { el: content, spring: 'snappy', from: { x: 0, scale: 1 }, to: { x: -60, scale: 0.97 }, duration: 120 },
    { el: content, spring: 'snappy', from: { x: -60, scale: 0.97 }, to: { x: 0, scale: 1 } }
  ]);
}

// ── Split Pane System ──

function _browseGetSplitPanes() {
  const win = _getCurrentWindow();
  return win ? (win.splitPanes || []) : [];
}

function _browseSetSplitPanes(panes) {
  const win = _getCurrentWindow();
  if (win) win.splitPanes = panes;
}

function _browseGetFocusedPane() {
  const win = _getCurrentWindow();
  return win ? (win.focusedPane || null) : null;
}

function _browseSetFocusedPane(paneId) {
  const win = _getCurrentWindow();
  if (win) win.focusedPane = paneId;
}

function _browsePaneForTab(tabId) {
  const panes = _browseGetSplitPanes();
  return panes.find(p => p.tabId === tabId) || null;
}

function _browseIsSplitMode() {
  return _browseGetSplitPanes().length >= 2;
}

function browseSplitTab(tabId, position) {
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

function _browseEnsureTabFrame(tab) {
  if (tab.el) return;
  const container = document.getElementById('browse-content');
  if (!container) return;
  if (tab.blank) return;
  if (tab._historyPage) {
    const el = document.createElement('div');
    el.id = 'browse-history-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
    return;
  }
  if (tab._helpPage) {
    const el = document.createElement('div');
    el.id = 'browse-help-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);';
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
  if (tab.deferred || !tab.url) return;
  tab.el = _browseCreateFrame(tab.id, tab.url);
  container.appendChild(tab.el);
  _browseBindFrame(tab);
}

function browseUnsplitPane(paneId) {
  let panes = _browseGetSplitPanes();
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

function browseExitSplitMode() {
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

function _browseRebuildSplitLayout() {
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
  panes.forEach((pane, i) => {
    const tab = win.tabs.find(t => t.id === pane.tabId);
    const wrapper = document.createElement('div');
    wrapper.className = 'browse-split-pane' + (pane.id === focusedPaneId ? ' focused' : '');
    wrapper.dataset.pane = pane.id;
    wrapper.style.width = pane.width + '%';
    wrapper.style.height = '100%';
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'hidden';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'browse-pane-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close split pane';
    closeBtn.onclick = (e) => { e.stopPropagation(); browseUnsplitPane(pane.id); };
    wrapper.appendChild(closeBtn);

    // Move tab's frame into wrapper
    if (tab && tab.el) {
      tab.el.style.display = '';
      tab.el.style.position = 'relative';
      tab.el.style.width = '100%';
      tab.el.style.height = '100%';
      tab.el.style.top = '';
      tab.el.style.left = '';
      wrapper.appendChild(tab.el);
    }

    // Click to focus
    wrapper.addEventListener('mousedown', () => {
      if (_browseGetFocusedPane() !== pane.id) {
        _browseFocusPane(pane.id);
      }
    });

    container.appendChild(wrapper);

    // Insert divider between panes (not after last)
    if (i < panes.length - 1) {
      const divider = document.createElement('div');
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

function _browseFocusPane(paneId) {
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
  if (tab) _browseSetUrlDisplay(urlInput, tab._historyPage ? 'aether://history' : tab._helpPage ? 'aether://help' : (tab.url || ''));
  _browseUpdateSaveBtn();
  _browseRenderTabs();
}

function _browseAttachDividerDrag(divider, leftPaneId, rightPaneId) {
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

// ── Audio Tracking ──

function toggleTabMute(tabId) {
  const audioInfo = _browseAudioTabs.get(tabId);
  if (!audioInfo) return;

  // Find the tab element
  for (const win of _browseWindows) {
    const tab = win.tabs.find(t => t.id === tabId);
    if (tab && tab.el && _browseIsElectron) {
      const newMuted = !audioInfo.muted;
      tab.el.setAudioMuted(newMuted);
      audioInfo.muted = newMuted;
      _browseAudioTabs.set(tabId, audioInfo);
      _browseRenderTabs();
      _updateAudioIndicator();
      return;
    }
  }
}

function goToAudioTab() {
  // Go to the first tab playing audio
  const entry = _browseAudioTabs.entries().next().value;
  if (!entry) return;

  const [tabId, info] = entry;
  if (info.windowId !== _browseActiveWindow) {
    browseSelectWindow(info.windowId);
  }
  browseSelectTab(tabId);

  // If not in browse view, navigate there
  if (!document.getElementById('browse-view')?.style.display || document.getElementById('browse-view').style.display === 'none') {
    openBrowse();
  }
}

function _updateAudioIndicator() {
  // Remove legacy floating indicator if it exists
  const legacy = document.getElementById('audio-indicator');
  if (legacy) legacy.remove();

  // CC button + pill — always update regardless of early returns
  _updateCCButton();

  if (_browseAudioTabs.size === 0) {
    if (typeof islandRemove === 'function') islandRemove('audio');
    return;
  }

  // Get info about playing tabs
  const playingTabs = [];
  for (const [tabId, info] of _browseAudioTabs) {
    for (const win of _browseWindows) {
      const tab = win.tabs.find(t => t.id === tabId);
      if (tab) {
        playingTabs.push({ tab, win, muted: info.muted, tabId });
        break;
      }
    }
  }

  const firstTab = playingTabs[0];
  if (!firstTab) {
    if (typeof islandRemove === 'function') islandRemove('audio');
    return;
  }

  // Hide if we're already on this tab in the browse view
  const browseView = document.getElementById('browse-view');
  const isOnBrowseView = browseView && browseView.style.display !== 'none';
  const isCurrentTab = isOnBrowseView &&
    firstTab.win.id === _browseActiveWindow &&
    firstTab.tab.id === firstTab.win.activeTab;

  if (isCurrentTab) {
    if (typeof islandRemove === 'function') islandRemove('audio');
    return;
  }

  const allMuted = playingTabs.every(p => p.muted);
  const title = firstTab.tab.title.slice(0, 30) || 'Audio';
  if (typeof islandUpdate === 'function') {
    islandUpdate('audio', {
      type: 'audio',
      label: allMuted ? 'Muted' : title,
      detail: (allMuted ? 'Muted — ' : 'Playing — ') + title,
      action: goToAudioTab
    });
  }
}

// ── Closed Captions ──

let _ccPillDismissed = false;

function _updateCCButton() {
  const hasAudio = _browseIsElectron && _browseAudioTabs.size > 0;
  const browseView = document.getElementById('browse-view');
  const isOnBrowse = browseView && browseView.style.display !== 'none';

  // Toolbar CC button — show when on browse view and audio playing
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) {
    ccBtn.style.display = (hasAudio && isOnBrowse) ? '' : 'none';
    ccBtn.style.color = _ccActive ? 'var(--accent)' : '';
  }

  // Dynamic Island: show CC suggestion when audio detected on active tab
  if (typeof islandUpdate === 'function') {
    if (hasAudio && isOnBrowse && !_ccActive && !_ccPillDismissed) {
      const win = _getCurrentWindow();
      const activeHasAudio = win && _browseAudioTabs.has(win.activeTab);
      if (activeHasAudio) {
        islandUpdate('cc', { type: 'cc', label: 'CC available', detail: 'Click to enable captions', action: toggleCaptions });
      } else {
        islandRemove('cc');
      }
    } else if (!_ccActive) {
      islandRemove('cc');
    }
  }
}

async function toggleCaptions() {
  if (_ccActive) {
    stopCaptions();
    return;
  }

  if (!_browseIsElectron || !window.electronAPI) return;

  // Find the active tab's webview
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab || !tab.el) return;
  if (typeof tab.el.getWebContentsId !== 'function') return;

  let wcId;
  try { wcId = tab.el.getWebContentsId(); } catch { return; }
  if (!wcId) return;
  _ccTabId = tab.id;
  _ccActive = true;
  _ccCaptionLines = [];

  // Update island and highlight CC button
  if (typeof islandUpdate === 'function') islandUpdate('cc', { type: 'cc', label: 'CC Live', detail: 'Listening…', action: stopCaptions });
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.style.color = 'var(--accent)';

  try {
    // Tell main process to route this webview's audio
    await electronAPI.startCC(wcId);

    // Request display media (audio from the target webview)
    const rawStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true
    });

    // Build an audio-only stream for the recorder, then kill video tracks
    const audioTracks = rawStream.getAudioTracks();
    if (!audioTracks.length) { rawStream.getTracks().forEach(t => t.stop()); throw new Error('No audio track'); }
    _ccStream = new MediaStream(audioTracks);
    rawStream.getVideoTracks().forEach(t => t.stop());

    // Open WebSocket to Flask captions endpoint
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _ccSocket = new WebSocket(`${wsProto}//${location.host}/ws/captions`);
    _ccSocket.binaryType = 'arraybuffer';

    _ccSocket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.text) _showCaption(msg.text);
      } catch {}
    };
    _ccSocket.onclose = () => { if (_ccActive) stopCaptions(); };
    _ccSocket.onerror = () => { if (_ccActive) stopCaptions(); };

    // Wait for socket to open, then send format handshake
    await new Promise((resolve, reject) => {
      _ccSocket.onopen = resolve;
      setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
    });

    // Tell the server we're sending raw float32 PCM at 16kHz
    _ccSocket.send(JSON.stringify({ format: 'f32pcm', rate: 16000 }));

    // Start AudioWorklet pipeline (raw PCM, no MediaRecorder/ffmpeg)
    await _ccStartAudioWorklet();
  } catch (err) {
    console.warn('CC start failed:', err);
    stopCaptions();
  }
}

async function _ccStartAudioWorklet() {
  if (!_ccActive || !_ccStream) return;

  // Create AudioContext at 16kHz — Chrome auto-resamples the input stream
  _ccAudioCtx = new AudioContext({ sampleRate: 16000 });

  // Inline AudioWorklet processor (no separate file, fits no-build-step architecture)
  const processorCode = `
    class CCProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buf = new Float32Array(24000); // 1.5s at 16kHz
        this._pos = 0;
      }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        for (let i = 0; i < ch.length; i++) {
          this._buf[this._pos++] = ch[i];
          if (this._pos >= 24000) {
            this.port.postMessage(this._buf.buffer.slice(0));
            this._pos = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('cc-processor', CCProcessor);
  `;
  const blob = new Blob([processorCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await _ccAudioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  _ccWorkletNode = new AudioWorkletNode(_ccAudioCtx, 'cc-processor');
  _ccWorkletNode.port.onmessage = (e) => {
    if (_ccSocket && _ccSocket.readyState === WebSocket.OPEN) {
      _ccSocket.send(e.data); // raw Float32Array ArrayBuffer
    }
  };

  const source = _ccAudioCtx.createMediaStreamSource(_ccStream);
  source.connect(_ccWorkletNode);
  // Don't connect to destination — we don't want to play back the audio
}

function stopCaptions() {
  if (!_ccActive && !_ccStream && !_ccSocket && !_ccWorkletNode) return;
  _ccActive = false;

  if (_ccWorkletNode) {
    try { _ccWorkletNode.disconnect(); } catch {}
    _ccWorkletNode = null;
  }
  if (_ccAudioCtx) {
    try { _ccAudioCtx.close(); } catch {}
    _ccAudioCtx = null;
  }
  if (_ccStream) {
    _ccStream.getTracks().forEach(t => t.stop());
    _ccStream = null;
  }
  if (_ccSocket) {
    try { _ccSocket.close(); } catch {}
    _ccSocket = null;
  }
  if (_browseIsElectron && window.electronAPI) {
    electronAPI.stopCC();
  }

  // Remove overlay
  const overlay = document.getElementById('browse-cc-overlay');
  if (overlay) overlay.remove();
  if (_ccFadeTimer) { clearTimeout(_ccFadeTimer); _ccFadeTimer = null; }
  _ccCaptionLines = [];
  _ccTabId = null;

  // Reset CC button and island
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.style.color = '';
  if (typeof islandRemove === 'function') islandRemove('cc');
}

function _showCaption(text) {
  _ccCaptionLines.push(text);
  if (_ccCaptionLines.length > 3) _ccCaptionLines.shift();

  const container = document.getElementById('browse-content');
  if (!container) return;

  let overlay = document.getElementById('browse-cc-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'browse-cc-overlay';
    container.appendChild(overlay);
  }

  overlay.textContent = _ccCaptionLines.join(' ');
  overlay.classList.remove('fade-out');

  // Update island with latest caption snippet
  if (typeof islandUpdate === 'function') {
    const snippet = text.length > 30 ? text.slice(0, 30) + '…' : text;
    islandUpdate('cc', { type: 'cc', label: 'CC Live', detail: snippet, action: stopCaptions });
  }

  // Reset fade timer
  if (_ccFadeTimer) clearTimeout(_ccFadeTimer);
  _ccFadeTimer = setTimeout(() => {
    if (overlay) overlay.classList.add('fade-out');
  }, 8000);
}

function _browseRenderTabHtml(t, activeTab) {
  const active = t.id === activeTab;
  const hasAudio = _browseAudioTabs.has(t.id);
  const audioInfo = _browseAudioTabs.get(t.id);
  const isMuted = audioInfo?.muted;
  const title = escapeHtml(t.title);
  const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : t.blank ? _ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"') : '';
  const audioIcon = hasAudio ? `<button class="browse-tab-audio ${isMuted ? 'muted' : ''}" onclick="event.stopPropagation();toggleTabMute(${t.id})" title="${isMuted ? 'Unmute' : 'Mute'}">
    ${isMuted ? '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' : '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>'}</button>` : '';
  const isPinned = !!t.pinned;
  const groupColor = t.groupId != null ? _browseGetGroupColor(t.groupId) : null;
  const groupStyle = groupColor ? ` style="--group-color:${groupColor}"` : '';
  const classes = ['browse-tab', active ? 'active' : '', hasAudio ? 'has-audio' : '', isPinned ? 'browse-tab-pinned' : '', groupColor ? 'browse-tab-grouped' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" data-tab-id="${t.id}"${groupStyle} onclick="_focusBrowseTabBar();browseSelectTab(${t.id})">
    ${fav}${audioIcon}<span class="browse-tab-title">${title}</span>
    <button class="browse-tab-close" onclick="event.stopPropagation();browseCloseTab(${t.id})" title="Close tab">&times;</button>
  </div>`;
}

function _browseRenderSplitPillHtml(panes, tabs, activeTab) {
  const focusedPaneId = _browseGetFocusedPane();
  let inner = '';
  panes.forEach((pane, i) => {
    const t = tabs.find(tab => tab.id === pane.tabId);
    if (!t) return;
    const focused = pane.id === focusedPaneId;
    const title = escapeHtml(t.title);
    const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : t.blank ? _ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"') : '';
    inner += `<div class="browse-split-pill-tab${focused ? ' focused' : ''}" data-tab-id="${t.id}" data-pane-id="${pane.id}" onclick="event.stopPropagation();_browseFocusPane(${pane.id})">
      ${fav}<span class="browse-tab-title">${title}</span>
      <button class="browse-tab-close" onclick="event.stopPropagation();browseUnsplitPane(${pane.id})" title="Close split pane">&times;</button>
    </div>`;
    if (i < panes.length - 1) inner += '<div class="browse-split-pill-sep"></div>';
  });
  return `<div class="browse-split-pill active" data-split-pill="1">${inner}</div>`;
}

function _browseGetGroupColor(groupId) {
  const win = _getCurrentWindow();
  if (!win) return null;
  const group = (win.groups || []).find(g => g.id === groupId);
  return group ? (_BROWSE_GROUP_COLOR_MAP[group.color] || group.color) : null;
}

// ── Island mode tab renderer ──

function toggleBrowseTabLayout() {
  _browseTabLayout = _browseTabLayout === 'island' ? 'horizontal' : 'island';
  localStorage.setItem('browseTabLayout', _browseTabLayout);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen) {
    if (_browseTabLayout === 'island') {
      _setPillBrowseMode(false);
      _applyBrowseTabLayout();
    } else {
      _setPillBrowseMode(true);
    }
  }
}

function _applyBrowseTabLayout() {
  const tabRow = document.getElementById('browse-tab-row');
  const bar = document.getElementById('browse-bar');
  const pill = document.getElementById('sidebar-nav');
  const dragPill = document.getElementById('drag-pill');
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display === 'flex';
  if (_browseTabLayout === 'island') {
    if (tabRow) tabRow.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (browseOpen) {
      if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
      if (dragPill) dragPill.style.display = 'none';
      _pillSyncUrl();
      const pillTabs = document.getElementById('pill-browse-tabs');
      if (pillTabs) pillTabs.innerHTML = '';
      _islandSyncTabs();
      _islandSyncBookmark();
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      if (dragPill) dragPill.style.display = '';
      islandRemove('tabs');
      islandRemove('bookmark');
    }
  } else {
    // Restore everything
    if (bar) bar.style.display = '';
    if (_pillBrowseMode) {
      if (tabRow) tabRow.style.display = 'none';
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      if (tabRow) tabRow.style.display = '';
      if (dragPill) dragPill.style.display = '';
    }
    if (_pillBrowseMode) _pillSyncTabs();
  }
  _browseRenderTabs();
}

/* Sync the pill URL input with the active tab */
function _pillSyncUrl() {
  const input = document.getElementById('pill-browse-url-input');
  if (!input) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isBlankNtp = tab && tab.blank;
  _browseSetUrlDisplay(input, (!isBlankNtp && tab && tab.url) ? tab.url : '');
  // Hide URL input + reload in island mode on new tab page; show nav icons
  if (_browseTabLayout === 'island') {
    input.style.visibility = isBlankNtp ? 'hidden' : '';
    input.style.pointerEvents = isBlankNtp ? 'none' : '';
    const reload = document.getElementById('pill-browse-reload');
    if (reload) reload.style.display = isBlankNtp ? 'none' : '';
    const pill = document.getElementById('sidebar-nav');
    if (pill) pill.classList.toggle('ntp-active', !!isBlankNtp);
  }
  // Safety net: ensure NTP is hidden when a non-blank tab is active in island mode
  if (!isBlankNtp) {
    const ntp = document.getElementById('browse-content')?.querySelector('.browse-ntp');
    if (ntp) ntp.style.display = 'none';
  }
  _updateIslandNavButtons();
}

function _updateIslandNavButtons() {
  try {
    const backBtn = document.getElementById('pill-browse-back');
    const fwdBtn = document.getElementById('pill-browse-fwd');
    if (!backBtn && !fwdBtn) return;
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    const hasBackHistory = tab && tab.backStack && tab.backStack.length > 0;
    let hasElBack = false, hasElFwd = false;
    try { hasElBack = _browseIsElectron && tab && tab.el && tab.el.canGoBack && tab.el.canGoBack(); } catch(e) {}
    const hasFwdHistory = tab && tab.forwardStack && tab.forwardStack.length > 0;
    try { hasElFwd = _browseIsElectron && tab && tab.el && tab.el.canGoForward && tab.el.canGoForward(); } catch(e) {}
    if (backBtn) {
      const hasNavBack = typeof _navHistory !== 'undefined' && _navHistory.length > 1;
      const hasPageBack = hasBackHistory || hasElBack;
      backBtn.style.display = '';
    }
    if (fwdBtn) {
      const hasNavFwd = typeof _navForward !== 'undefined' && _navForward.length > 0;
      fwdBtn.style.display = (hasFwdHistory || hasElFwd || hasNavFwd) ? '' : 'none';
    }
  } catch(e) {}
}

/* Keydown for pill URL input */
function _pillUrlKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById('pill-browse-url-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const mainInput = document.getElementById('browse-url-input');
    if (mainInput) {
      mainInput.value = val;
      _browseUrlKeydown({ key: 'Enter', preventDefault() {} });
    }
    input.blur();
  } else if (e.key === 'Escape') {
    e.target.blur();
  }
}

/* Pill mic button — record audio, transcribe, open panel with result */
let _pillMicRecorder = null;
function _pillMicClick() {
  const micBtn = document.getElementById('pill-mic-btn');
  if (!micBtn) return;
  if (_pillMicRecorder) {
    _pillMicRecorder.stop();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    _pillMicRecorder = recorder;
    micBtn.classList.add('pill-mic-active');
    islandUpdate('pill-mic', { type: 'ai', label: 'Listening…' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      _pillMicRecorder = null;
      micBtn.classList.remove('pill-mic-active');
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      islandUpdate('pill-mic', { type: 'ai', label: 'Transcribing…' });
      fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm', 'Authorization': 'Bearer ' + (localStorage.getItem('authToken') || '') }, body: blob })
        .then(r => r.json())
        .then(data => {
          islandRemove('pill-mic');
          if (data.text) {
            const rect = micBtn.getBoundingClientRect();
            _showPanel({ anchor: { x: rect.x, y: rect.bottom + 4 }, initialValue: data.text, finalized: true });
            if (localStorage.getItem('voiceAutoSend') === 'on') {
              setTimeout(() => {
                const popup = document.getElementById('doc-chat-ask-float');
                if (popup) _sendPopupChatMessage(popup, '');
              }, 50);
            }
          }
        })
        .catch(() => { islandRemove('pill-mic'); });
    };
    recorder.start();
  }).catch(() => {});
}

function _browseRenderTabs() {
  const isIsland = _browseTabLayout === 'island';
  const bar = isIsland ? null : document.getElementById('browse-tabs');
  const win = _getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const groups = win ? (win.groups || []) : [];

  // Always sync the Dynamic Island tabs pill
  _islandSyncTabs();

  // In island mode, only sync island — no DOM tab bar to render
  if (isIsland) {
    _pillSyncUrl();
    return;
  }
  if (!bar) return;

  // Window switcher for horizontal layout (inline in tab bar)
  let windowSelector = '';
  if (_browseWindows.length > 1) {
    const winIdx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
    windowSelector = `<div class="browse-window-switcher" data-window-idx="${winIdx}" onclick="toggleBrowseTabOverview()">
      <button class="browse-window-arrow up ${winIdx === 0 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowUp()" title="Previous window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg>
      </button>
      <button class="browse-window-arrow down ${winIdx === _browseWindows.length - 1 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowDown()" title="Next window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg>
      </button>
    </div>`;
  }

  // Split into pinned (left) and unpinned (right)
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  const renderTab = _browseRenderTabHtml;
  const pinSepClass = 'browse-tab-pin-separator';
  const groupChipClass = 'browse-tab-group-chip';

  // Build pinned section
  let html = windowSelector;
  html += pinned.map(t => renderTab(t, activeTab)).join('');
  if (pinned.length > 0 && unpinned.length > 0) {
    html += `<div class="${pinSepClass}"></div>`;
  }

  // Sort unpinned: grouped tabs contiguous by group, ungrouped at end
  const groupedIds = new Set(groups.map(g => g.id));
  const groupOrder = groups.map(g => g.id);
  const sortedUnpinned = [];
  // Collect tabs per group (preserve relative order within group)
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
  // In split mode, collect split tab IDs so we can render the combined pill
  const splitPanes = _browseGetSplitPanes();
  const splitTabIds = new Set(splitPanes.map(p => p.tabId));
  let splitPillInserted = false;

  // Render groups in order, then ungrouped
  for (const gid of groupOrder) {
    const group = groups.find(g => g.id === gid);
    const gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    const gc = _BROWSE_GROUP_COLOR_MAP[group.color] || group.color;
    html += `<div class="${groupChipClass}" style="--group-color:${gc}" data-group-id="${gid}" onclick="_browseToggleGroupCollapse(${gid})" oncontextmenu="event.preventDefault();_browseShowGroupContextMenu(event,${gid})">
      <span class="browse-tab-group-name">${escapeHtml(group.name)}</span>
      <span class="browse-tab-group-count">${gTabs.length}</span>
    </div>`;
    if (!group.collapsed) {
      for (const t of gTabs) {
        if (splitTabIds.has(t.id)) {
          if (!splitPillInserted) {
            html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab);
            splitPillInserted = true;
          }
        } else {
          html += renderTab(t, activeTab);
        }
      }
    }
  }
  for (const t of ungrouped) {
    if (splitTabIds.has(t.id)) {
      if (!splitPillInserted) {
        html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab);
        splitPillInserted = true;
      }
      // Skip individual render — it's in the pill
    } else {
      html += renderTab(t, activeTab);
    }
  }

  bar.innerHTML = html;

  // Update tab count on overview button
  const totalTabs = _browseWindows.reduce((sum, w) => sum + w.tabs.length, 0);
  const countBadge = document.getElementById('browse-tab-overview-btn');
  if (countBadge) countBadge.title = `Show all tabs (${totalTabs} tabs, ${_browseWindows.length} windows)`;

  // Render toolbar sessions dropdown only if overview is visible
  if (_browseTabOverviewVisible) {
    _renderToolbarSessions();
  }

  // Attach tab drag-to-reorder handlers
  bar.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  // Attach drag handler on the split pill (handles reorder + unsplit + click-to-focus)
  bar.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });

  // Mirror tabs into the pill bar if in browse mode (horizontal only)
  if (_pillBrowseMode) _pillSyncTabs();
}

// ── Split pill drag (reorder + unsplit) ──

function _splitPillDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close')) return;
  const pillEl = e.currentTarget;
  e.preventDefault();
  e.stopPropagation();

  // Check if mousedown started on an inner tab (for potential unsplit drag)
  const innerTabEl = e.target.closest('.browse-split-pill-tab');
  const innerPaneId = innerTabEl ? parseInt(innerTabEl.dataset.paneId) : null;

  const startX = e.clientX;
  const startY = e.clientY;
  let mode = null; // null = undecided, 'reorder' = pill drag, 'unsplit' = tear tab out
  let ghost = null;
  let indicator = null;
  let insertBeforeId = null;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!mode) {
      if (dist < TAB_DRAG_THRESHOLD) return;
      // If started on an inner tab and dragged vertically, unsplit that tab
      if (innerTabEl && Math.abs(dy) > Math.abs(dx) && dist > 15) {
        mode = 'unsplit';
        innerTabEl.classList.add('dragging-out');
        ghost = innerTabEl.cloneNode(true);
        ghost.className = 'browse-split-pill-tab browse-split-drag-ghost';
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;background:var(--bg-card);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:4px 8px;white-space:nowrap;font-size:0.75rem;';
        ghost.style.width = innerTabEl.offsetWidth + 'px';
        document.body.appendChild(ghost);
      } else {
        // Horizontal drag = reorder pill
        mode = 'reorder';
        pillEl.style.opacity = '0.4';
        ghost = pillEl.cloneNode(true);
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;';
        ghost.style.width = pillEl.offsetWidth + 'px';
        ghost.classList.add('browse-tab-dragging');
        document.body.appendChild(ghost);
        indicator = document.createElement('div');
        indicator.className = 'browse-tab-insert-indicator';
        const bar = _getActiveTabBar();
        if (bar) { bar.style.position = 'relative'; bar.appendChild(indicator); }
      }
    }

    if (mode === 'unsplit' && ghost) {
      ghost.style.left = (ev.clientX - innerTabEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - innerTabEl.offsetHeight / 2) + 'px';
      return;
    }

    if (mode === 'reorder' && ghost) {
      ghost.style.left = (ev.clientX - pillEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - pillEl.offsetHeight / 2) + 'px';

      const bar = _getActiveTabBar();
      if (!bar || !indicator) return;
      const barRect = bar.getBoundingClientRect();
      const nonSplitTabs = Array.from(bar.querySelectorAll('.browse-tab:not(.browse-tab-pinned)'));
      insertBeforeId = null;
      let indicatorLeft = null;

      for (const t of nonSplitTabs) {
        const rect = t.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) {
          const tid = parseInt(t.dataset.tabId);
          if (!isNaN(tid)) insertBeforeId = tid;
          indicatorLeft = rect.left - barRect.left - 1;
          break;
        }
      }
      if (indicatorLeft === null && nonSplitTabs.length > 0) {
        const lastRect = nonSplitTabs[nonSplitTabs.length - 1].getBoundingClientRect();
        indicatorLeft = lastRect.right - barRect.left + 1;
      }
      if (indicatorLeft !== null) {
        indicator.style.display = '';
        indicator.style.left = indicatorLeft + 'px';
        indicator.style.top = '4px';
        indicator.style.height = (bar.offsetHeight - 8) + 'px';
      }
    }
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (ghost) {
      if (mode === 'unsplit') {
        Motion.animate(ghost, {
          duration: 150, spring: 'smooth',
          from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.9 },
          onFinish: function() { ghost.remove(); }
        });
      } else {
        ghost.remove();
      }
    }
    if (indicator) indicator.remove();
    pillEl.style.opacity = '';
    if (innerTabEl) innerTabEl.classList.remove('dragging-out');

    if (mode === 'unsplit' && innerPaneId != null) {
      browseUnsplitPane(innerPaneId);
    } else if (mode === 'reorder' && insertBeforeId !== null) {
      const win = _getCurrentWindow();
      if (!win) return;
      const panes = _browseGetSplitPanes();
      const splitTabIds = panes.map(p => p.tabId);
      const splitTabs = splitTabIds.map(id => win.tabs.find(t => t.id === id)).filter(Boolean);
      win.tabs = win.tabs.filter(t => !splitTabIds.includes(t.id));
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      const insertAt = toIdx !== -1 ? toIdx : win.tabs.length;
      win.tabs.splice(insertAt, 0, ...splitTabs);
      _browseRenderTabs();
      _browseSaveTabs();
    } else if (!mode && innerTabEl) {
      // No drag — just a click, focus the pane
      if (innerPaneId != null) _browseFocusPane(innerPaneId);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Tab pin / group helpers ──

function _browseToggleGroupCollapse(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseTogglePin(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  // If pinning, remove from group
  if (tab.pinned && tab.groupId != null) {
    delete tab.groupId;
  }
  // Sort: pinned tabs first, preserve relative order otherwise
  const pinned = win.tabs.filter(t => t.pinned);
  const unpinned = win.tabs.filter(t => !t.pinned);
  win.tabs = [...pinned, ...unpinned];
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseAddTabToNewGroup(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  if (!win.groups) win.groups = [];
  const gid = _browseNextGroupId++;
  const color = _BROWSE_GROUP_COLORS[win.groups.length % _BROWSE_GROUP_COLORS.length];
  win.groups.push({ id: gid, name: 'New group', color, collapsed: false });
  tab.groupId = gid;
  _browseRenderTabs();
  _browseSaveTabs();
  // Inline rename the new group chip
  setTimeout(() => {
    const chip = document.querySelector(`.browse-tab-group-chip[data-group-id="${gid}"] .browse-tab-group-name`);
    if (chip) _browseStartRenameGroup(gid, chip);
  }, 50);
}

function browseAddTabToGroup(tabId, groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  tab.groupId = groupId;
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseRemoveTabFromGroup(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  delete tab.groupId;
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseUngroupAll(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(t => { if (t.groupId === groupId) delete t.groupId; });
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseCloseGroup(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.groupId === groupId).map(t => t.id);
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  // Close all tabs in group (from end to avoid index shifting)
  for (const id of toClose.reverse()) browseCloseTab(id);
}

function _browseChangeGroupColor(groupId, color) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.color = color;
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseStartRenameGroup(groupId, nameEl) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'browse-tab-group-rename';
  input.value = group.name;
  input.style.cssText = 'width:60px;font-size:0.65rem;font-weight:600;background:transparent;border:1px solid var(--border-card);border-radius:3px;color:inherit;padding:0 3px;outline:none;';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = () => {
    const val = input.value.trim() || 'New group';
    group.name = val;
    _browseRenderTabs();
    _browseSaveTabs();
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = group.name; input.blur(); }
  });
}

function _browseDismissTabContextMenu() {
  const m = document.querySelector('.browse-ctx-menu');
  if (m) m.remove();
}

function _browseCloseOtherTabs(keepId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.id !== keepId && !t.pinned).map(t => t.id);
  for (const id of toClose.reverse()) browseCloseTab(id);
}

function _browseShowGroupContextMenu(e, groupId) {
  _browseDismissTabContextMenu();
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;

  const colorDots = _BROWSE_GROUP_COLORS.map(c => {
    const hex = _BROWSE_GROUP_COLOR_MAP[c];
    const sel = c === group.color ? ' browse-ctx-color-selected' : '';
    return `<span class="browse-ctx-color-dot${sel}" style="background:${hex}" onclick="event.stopPropagation();_browseDismissTabContextMenu();_browseChangeGroupColor(${groupId},'${c}')"></span>`;
  }).join('');

  const items = [
    `<div class="browse-ctx-item" onclick="event.stopPropagation();_browseDismissTabContextMenu();setTimeout(()=>{const c=document.querySelector('.browse-tab-group-chip[data-group-id=\\'${groupId}\\'] .browse-tab-group-name');if(c)_browseStartRenameGroup(${groupId},c);},50)">Rename</div>`,
    `<div class="browse-ctx-colors">${colorDots}</div>`,
    '<div class="browse-ctx-sep"></div>',
    `<div class="browse-ctx-item" onclick="_browseDismissTabContextMenu();_browseUngroupAll(${groupId})">Ungroup all</div>`,
    `<div class="browse-ctx-item" onclick="_browseDismissTabContextMenu();_browseCloseGroup(${groupId})">Close group</div>`
  ];

  const menu = document.createElement('div');
  menu.className = 'browse-ctx-menu';
  menu.innerHTML = items.join('');
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10002;`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', _browseDismissTabContextMenu, { once: true });
  }, 0);
}

// ── Tab hover tooltip ──

let _tabHoverTimeout = null;
let _tabHoverDismissTimeout = null;


// ── Tab drag-to-reorder ──

let _tabDragState = null;
const TAB_DRAG_THRESHOLD = 5;

function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  const isVtab = false;
  let tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    // Fallback: parse from onclick
    const onclickAttr = tabEl.getAttribute('onclick') || '';
    const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId, startX: e.clientX, startY: e.clientY, tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false, isIsland: isVtab };
  const origOnclick = tabEl.getAttribute('onclick');
  tabEl.removeAttribute('onclick');
  _tabDragState._origOnclick = origOnclick;
  document.addEventListener('mousemove', _tabDragMove);
  document.addEventListener('mouseup', _tabDragEnd);
}

function _tabDragMove(e) {
  if (!_tabDragState) return;
  const dx = e.clientX - _tabDragState.startX;
  const dy = e.clientY - _tabDragState.startY;
  if (!_tabDragState.hasMoved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;

  const isVert = _tabDragState.isIsland;
  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    // Prevent the onclick from firing
    _tabDragState.tabEl.style.pointerEvents = 'none';
    // Create ghost
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += isVert ? ' browse-vtab-dragging' : ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
    // Create insertion indicator
    const indicator = document.createElement('div');
    indicator.className = isVert ? 'browse-vtab-insert-indicator' : 'browse-tab-insert-indicator';
    const bar = _getActiveTabBar();
    if (bar) {
      bar.style.position = 'relative';
      bar.appendChild(indicator);
    }
    _tabDragState.indicator = indicator;
  }

  // Move ghost with cursor
  _tabDragState.ghostEl.style.left = (e.clientX - _tabDragState.tabEl.offsetWidth / 2) + 'px';
  _tabDragState.ghostEl.style.top = (e.clientY - _tabDragState.tabEl.offsetHeight / 2) + 'px';

  // Find nearest insertion point
  if (isVert) {
    _tabDragUpdatePosition(e.clientY);
  } else {
    _tabDragUpdatePosition(e.clientX);
  }
}

function _tabDragUpdatePosition(clientPos) {
  if (!_tabDragState || !_tabDragState.indicator) return;
  const bar = _getActiveTabBar();
  if (!bar) return;
  const isVert = _tabDragState.isIsland;
  const win = _getCurrentWindow();
  const dragTab = win ? win.tabs.find(t => t.id === _tabDragState.tabId) : null;
  const isDragPinned = dragTab && dragTab.pinned;

  // Only allow dragging among same region (pinned <-> pinned, unpinned <-> unpinned)
  const tabClass = isVert ? '.browse-vtab' : '.browse-tab';
  const pinnedClass = isVert ? 'browse-vtab-pinned' : 'browse-tab-pinned';
  const allTabEls = Array.from(bar.querySelectorAll(tabClass));
  const tabs = allTabEls.filter(t => {
    const isPinned = t.classList.contains(pinnedClass);
    return isDragPinned ? isPinned : !isPinned;
  });

  let insertBeforeId = null;
  const barRect = bar.getBoundingClientRect();

  if (isVert) {
    // Vertical mode: use Y axis
    let indicatorTop = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
        if (!isNaN(tid)) insertBeforeId = tid;
        indicatorTop = rect.top - barRect.top - 1;
        break;
      }
    }
    if (indicatorTop === null && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorTop = lastRect.bottom - barRect.top + 1;
    }
    _tabDragState.insertBeforeId = insertBeforeId;
    if (indicatorTop !== null) {
      _tabDragState.indicator.style.display = '';
      _tabDragState.indicator.style.top = indicatorTop + 'px';
      _tabDragState.indicator.style.left = '4px';
      _tabDragState.indicator.style.right = '4px';
      _tabDragState.indicator.style.height = '2px';
      _tabDragState.indicator.style.width = '';
    }
  } else {
    // Horizontal mode: use X axis
    let indicatorLeft = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
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
}

function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const { tabId, hasMoved, insertBeforeId, ghostEl, indicator, tabEl, _origOnclick, isIsland: isVert } = _tabDragState;
  _tabDragState = null;

  // Clean up visual elements
  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (_origOnclick) tabEl.setAttribute('onclick', _origOnclick);

  if (hasMoved) {
    const win = _getCurrentWindow();
    if (!win) return;
    const fromIdx = win.tabs.findIndex(t => t.id === tabId);
    if (fromIdx === -1) return;
    const [movedTab] = win.tabs.splice(fromIdx, 1);
    if (insertBeforeId !== null) {
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      if (toIdx !== -1) {
        win.tabs.splice(toIdx, 0, movedTab);
      } else {
        win.tabs.push(movedTab);
      }
    } else {
      win.tabs.push(movedTab);
    }
    // Update group membership based on neighbors (for unpinned tabs)
    if (!movedTab.pinned) {
      const newIdx = win.tabs.indexOf(movedTab);
      const prev = newIdx > 0 ? win.tabs[newIdx - 1] : null;
      const next = newIdx < win.tabs.length - 1 ? win.tabs[newIdx + 1] : null;
      // If dropped between two tabs of the same group, join that group
      if (prev && next && !prev.pinned && !next.pinned && prev.groupId != null && prev.groupId === next.groupId) {
        movedTab.groupId = prev.groupId;
      }
    }
    _browseRenderTabs();
    _browseSaveTabs();
  } else {
    // No drag movement — treat as a normal click to select tab
    _focusBrowseTabBar();
    browseSelectTab(tabId);
  }
}

// ── Window Overview ──

let _browseTabOverviewVisible = false;
let _overviewSelectedIdx = 0;       // selected browse window index
let _overviewKeyHandler = null;
let _overviewBrowseWinIdx = 0;      // selected window in expanded tab view
let _overviewBrowseTabIdx = -1;     // -1 = window card level, >=0 = tab within window
let _overviewTabsExpanded = false;   // true when showing tab list inside a window card
let _overviewWasBrowseMode = false;  // pill bar was in browse-mode before overview opened
let _overviewCaptureTimer = null;
let _overviewCapturing = false;
let _browseWindowPreviews = {};     // { windowId: 'data:image/png;base64,...' }

// Capture each browse window's active tab as a screenshot and apply to card previews.
// Uses Electron's webContents.capturePage() via IPC — works regardless of view visibility
// or stacking context. Captured images are cached in _browseWindowPreviews.
function _overviewEmbedFrames() {
  if (!window.electronAPI?.captureWebview) return;
  var overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  var cards = overlay.querySelectorAll('.wov-card:not(.wov-card-new)');

  for (var i = 0; i < _browseWindows.length && i < cards.length; i++) {
    (function(idx) {
      var bw = _browseWindows[idx];
      if (!bw) return;
      var activeTab = bw.tabs.find(function(t) { return t.id === bw.activeTab; });
      if (!activeTab || !activeTab.el) return;

      var frame = activeTab.el;
      // Get webContentsId from the webview element
      var wcId = typeof frame.getWebContentsId === 'function' ? frame.getWebContentsId() : null;
      if (!wcId) return;

      // Apply cached preview immediately if available
      var cached = _browseWindowPreviews[bw.id];
      var card = cards[idx];
      if (card && cached) {
        var prev = card.querySelector('.wov-card-preview');
        if (prev) {
          prev.style.backgroundImage = 'url(' + cached + ')';
          prev.classList.remove('wov-card-preview-empty');
          prev.innerHTML = '';
        }
      }

      // Capture fresh screenshot (async, updates when ready)
      window.electronAPI.captureWebview(wcId).then(function(base64) {
        if (!base64 || !_browseTabOverviewVisible) return;
        var dataUrl = 'data:image/png;base64,' + base64;
        _browseWindowPreviews[bw.id] = dataUrl;
        // Update the card preview if still visible
        var curOverlay = document.getElementById('browse-tab-overview');
        if (!curOverlay) return;
        var curCards = curOverlay.querySelectorAll('.wov-card:not(.wov-card-new)');
        var curCard = curCards[idx];
        if (!curCard) return;
        var prev = curCard.querySelector('.wov-card-preview');
        if (prev) {
          prev.style.backgroundImage = 'url(' + dataUrl + ')';
          prev.classList.remove('wov-card-preview-empty');
          prev.innerHTML = '';
        }
      }).catch(function() {});
    })(i);
  }
}

// Capture a window's active tab preview into the cache (fire-and-forget)
function _browseCaptureWindowPreview(windowId) {
  if (!window.electronAPI?.captureWebview) return;
  var bw = _browseWindows.find(function(w) { return w.id === windowId; });
  if (!bw) return;
  var activeTab = bw.tabs.find(function(t) { return t.id === bw.activeTab; });
  if (!activeTab || !activeTab.el) return;
  var frame = activeTab.el;
  var wcId = typeof frame.getWebContentsId === 'function' ? frame.getWebContentsId() : null;
  if (!wcId) return;
  window.electronAPI.captureWebview(wcId).then(function(base64) {
    if (base64) _browseWindowPreviews[windowId] = 'data:image/png;base64,' + base64;
  }).catch(function() {});
}


// SVG icons for app window cards
const _wovAppIcons = {
  dashboard: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>',
  feed: '<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><circle cx="6.18" cy="17.82" r="2.18"/><path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/></svg>',
  research: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/></svg>',
  vault: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><path d="m7.9 7.9 2.7 2.7"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/><path d="m13.4 10.6 2.7-2.7"/><circle cx="7.5" cy="16.5" r=".5" fill="currentColor"/><path d="m7.9 16.1 2.7-2.7"/><circle cx="16.5" cy="16.5" r=".5" fill="currentColor"/><path d="m13.4 13.4 2.7 2.7"/><circle cx="12" cy="12" r="2"/></svg>',
  browse: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"/></svg>',
  inbox: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  terminal: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3M5.25 20.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>',
  neuralook: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  dev: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"/></svg>',
  vibe: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/></svg>',
  settings: '<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>',
  calendar: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>',
};

function toggleBrowseTabOverview() {
  _browseTabOverviewVisible ? hideBrowseTabOverview() : showBrowseTabOverview();
}

// Lightweight restore: read browse windows from localStorage without creating DOM/iframes.
// Used by the overview so browse tabs are visible even if Browse hasn't been opened yet.
function _browseRestoreTabsLite() {
  try {
    var raw = localStorage.getItem(_getBrowseStorageKey('browseWindows'));
    if (!raw) return;
    var data = JSON.parse(raw);
    if (!data.windows || !data.windows.length) return;
    _browseNextWindowId = data.nextWindowId || 1;
    _browseNextTabId = data.nextTabId || 1;
    _browseNextGroupId = data.nextGroupId || 1;
    _browseNextPaneId = data.nextPaneId || 1;
    for (var i = 0; i < data.windows.length; i++) {
      var sw = data.windows[i];
      if (!sw.tabs.length) continue;
      var win = { id: sw.id, name: sw.name, tabs: [], activeTab: sw.activeTab, groups: sw.groups || [], splitPanes: sw.splitPanes || [], focusedPane: sw.focusedPane || null };
      for (var j = 0; j < sw.tabs.length; j++) {
        var st = sw.tabs[j];
        var tab = { id: st.id, url: st.url || '', title: st.title || 'New Tab', favicon: st.url ? _browseFaviconUrl(st.url) : '', el: null, blank: !!st.blank, lastVisited: st.lastVisited || 0 };
        if (st.pinned) tab.pinned = true;
        if (st.groupId != null) tab.groupId = st.groupId;
        if (st.paper) {
          tab.paper = st.paper; tab.contentType = st.contentType;
          if (st.localPath) { tab.localPath = st.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(st.localPath); }
          else if (st.paper.localPath) { tab.localPath = st.paper.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(st.paper.localPath); }
          else if (st.paper.pdfUrl) { tab.pdfUrl = st.paper.pdfUrl; }
        }
        if (st._historyPage) { tab.url = 'aether://history'; tab.title = 'History'; tab._historyPage = true; }
        if (st._helpPage) { tab.url = 'aether://help'; tab.title = 'Help'; tab._helpPage = true; }
        win.tabs.push(tab);
      }
      _browseWindows.push(win);
    }
    if (_browseWindows.length) {
      _browseActiveWindow = _browseWindows.find(function(w) { return w.id === data.activeWindow; }) ? data.activeWindow : _browseWindows[0].id;
    }
  } catch (e) { /* ignore */ }
}

function showBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _wmCapturePreview();
  // Ensure browse windows are loaded even if Browse view hasn't been opened
  if (!_browseWindows.length) _browseRestoreTabsLite();
  // Exit browse-mode on the pill bar so app nav icons are visible
  var pill = document.getElementById('sidebar-nav');
  if (pill && pill.classList.contains('browse-mode')) {
    pill.classList.remove('browse-mode');
    _overviewWasBrowseMode = true;
  } else {
    _overviewWasBrowseMode = false;
  }
  _browseTabOverviewVisible = true;
  _overviewTabsExpanded = false;
  _overviewBrowseTabIdx = -1;
  // Select the active browse window
  var activeIdx = Math.max(0, _browseWindows.findIndex(function(bw) { return bw.id === _browseActiveWindow; }));
  _overviewSelectedIdx = activeIdx;
  _overviewBrowseWinIdx = activeIdx;
  overlay.style.display = 'flex'; // display before render so embed can measure dimensions
  _renderWindowOverview();
  // Instantly scroll to the active card before the fade-in
  var activeCard = overlay.querySelector('.wov-card.wov-selected') || overlay.querySelector('.wov-card.wov-active');
  if (activeCard) activeCard.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  _installOverviewKeyHandler();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });
}


function hideBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _browseTabOverviewVisible = false;
  _overviewTabsExpanded = false;
  if (_overviewCaptureTimer) { clearTimeout(_overviewCaptureTimer); _overviewCaptureTimer = null; }
  _removeOverviewKeyHandler();
  // Restore browse pill bar state if we were in browse-mode
  if (_overviewWasBrowseMode) {
    _overviewWasBrowseMode = false;
    // Defer so any pending view switch (wmOpen to non-browse) can settle first
    requestAnimationFrame(function() {
      var browseView = document.getElementById('browse-view');
      if (browseView && browseView.style.display === 'flex') {
        _applyBrowseTabLayout();
      }
    });
  }
  overlay.classList.remove('visible');
  overlay.style.opacity = '';
  setTimeout(() => { if (!_browseTabOverviewVisible) overlay.style.display = 'none'; }, 180);
}

function _installOverviewKeyHandler() {
  if (_overviewKeyHandler) return;
  _overviewKeyHandler = (e) => {
    if (!_browseTabOverviewVisible) return;
    var total = _browseWindows.length;
    // Total cards = windows + 1 (the "+ New Window" card)
    var totalCards = total + 1;

    if (_overviewTabsExpanded) {
      // ── Tab drill-down within a window card ──
      var curWin = _browseWindows[_overviewBrowseWinIdx];
      var tabCount = curWin ? curWin.tabs.length : 0;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_overviewBrowseTabIdx > 0) {
          _overviewBrowseTabIdx--;
        } else if (_overviewBrowseTabIdx === 0) {
          // Collapse back to window card level
          _overviewTabsExpanded = false;
          _overviewBrowseTabIdx = -1;
        }
        _renderWindowOverview();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_overviewBrowseTabIdx < tabCount - 1) {
          _overviewBrowseTabIdx++;
        }
        _renderWindowOverview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Collapse and move to previous window
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        if (_overviewSelectedIdx > 0) _overviewSelectedIdx--;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _renderWindowOverview();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        // Collapse and move to next window
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        if (_overviewSelectedIdx < total - 1) _overviewSelectedIdx++;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _renderWindowOverview();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (curWin) {
          if (_overviewBrowseTabIdx >= 0) {
            var tab = curWin.tabs[_overviewBrowseTabIdx];
            if (tab) { browseSelectWindow(curWin.id); browseSelectTab(tab.id); }
          } else {
            browseSelectWindow(curWin.id);
          }
          wmOpen('browse');
          hideBrowseTabOverview();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        _renderWindowOverview();
      }
      return;
    }

    // ── Window card level (horizontal row) ──
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (_overviewSelectedIdx > 0) {
        _overviewSelectedIdx--;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
      }
      _updateOverviewHighlight();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (_overviewSelectedIdx < totalCards - 1) {
        _overviewSelectedIdx++;
        _overviewBrowseWinIdx = Math.min(_overviewSelectedIdx, total - 1);
      }
      _updateOverviewHighlight();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Expand tab list for the selected window
      if (_overviewSelectedIdx < total) {
        _overviewTabsExpanded = true;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _overviewBrowseTabIdx = 0;
        _renderWindowOverview();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_overviewSelectedIdx >= total) {
        // "+ New Window" card
        wmOpen('browse');
        browseCreateWindow();
        hideBrowseTabOverview();
      } else {
        var bw = _browseWindows[_overviewSelectedIdx];
        if (bw) {
          browseSelectWindow(bw.id);
          wmOpen('browse');
          hideBrowseTabOverview();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideBrowseTabOverview();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && _overviewSelectedIdx < total && total > 1) {
      e.preventDefault();
      var delWin = _browseWindows[_overviewSelectedIdx];
      if (delWin) browseCloseWindow(delWin.id);
      if (_overviewSelectedIdx >= _browseWindows.length) _overviewSelectedIdx = _browseWindows.length - 1;
      _overviewBrowseWinIdx = _overviewSelectedIdx;
      _renderWindowOverview();
    }
  };
  document.addEventListener('keydown', _overviewKeyHandler);
}

function _removeOverviewKeyHandler() {
  if (_overviewKeyHandler) {
    document.removeEventListener('keydown', _overviewKeyHandler);
    _overviewKeyHandler = null;
  }
}

function _updateOverviewHighlight() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  overlay.querySelectorAll('.wov-card').forEach((card, i) => {
    card.classList.toggle('wov-selected', i === _overviewSelectedIdx);
  });
  const sel = overlay.querySelector('.wov-card.wov-selected');
  if (sel) sel.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  _overviewEmbedFrames();
}

function _renderWindowOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  overlay.classList.remove('wov-browse-grid-mode');

  var browseIcon = _wovAppIcons.browse || '';
  var html = '<div class="wov-cards-strip">';

  for (var i = 0; i < _browseWindows.length; i++) {
    var bw = _browseWindows[i];
    var isActive = bw.id === _browseActiveWindow;
    var isSelected = i === _overviewSelectedIdx;
    var isExpanded = _overviewTabsExpanded && i === _overviewBrowseWinIdx;
    var preview = _browseWindowPreviews[bw.id];

    html += '<div class="wov-card' + (isActive ? ' wov-active' : '') + (isSelected ? ' wov-selected' : '') + (isExpanded ? ' wov-expanded' : '') + '" data-idx="' + i + '">';

    // Preview area
    if (preview) {
      html += '<div class="wov-card-preview" style="background-image:url(' + preview + ')">';
    } else {
      html += '<div class="wov-card-preview wov-card-preview-empty">';
      html += '<div class="wov-card-empty-icon">' + browseIcon + '</div>';
    }
    html += '</div>';

    // Bottom bar: window name + tab count + active dot
    html += '<div class="wov-card-bar">'
      + '<div class="wov-card-icon">' + browseIcon + '</div>'
      + '<span class="wov-card-name">' + escapeHtml(bw.name) + '</span>'
      + '<span class="wov-win-count">' + bw.tabs.length + '</span>'
      + (isActive ? '<span class="wov-active-dot"></span>' : '');
    // Close button (only if >1 window)
    if (_browseWindows.length > 1) {
      html += '<button class="wov-card-close" data-win-id="' + bw.id + '">&times;</button>';
    }
    html += '</div>';

    // Favicon strip (show top favicons as secondary info)
    var favHtml = '';
    var shownFavs = 0;
    for (var fi = 0; fi < bw.tabs.length && shownFavs < 6; fi++) {
      var ft = bw.tabs[fi];
      if (ft.favicon) {
        favHtml += '<img src="' + escapeHtml(ft.favicon) + '" class="wov-card-fav" onerror="this.style.display=\'none\'">';
        shownFavs++;
      }
    }
    if (favHtml) {
      html += '<div class="wov-card-favstrip">' + favHtml + '</div>';
    }

    // Expanded tab list (inline under card when drilled down)
    if (isExpanded) {
      html += '<div class="wov-card-tabs">';
      for (var ti = 0; ti < bw.tabs.length; ti++) {
        var tab = bw.tabs[ti];
        var tabSelected = ti === _overviewBrowseTabIdx;
        var tabIsActive = tab.id === bw.activeTab;
        var fav = tab.favicon
          ? '<img src="' + escapeHtml(tab.favicon) + '" class="wov-bt-fav" onerror="this.style.display=\'none\'">'
          : tab.blank ? _ELL_SVG.replace('class="ell-favicon"', 'class="wov-bt-fav ell-favicon"') : '<span class="wov-bt-dot"></span>';
        html += '<div class="wov-bt' + (tabSelected ? ' wov-selected' : '') + (tabIsActive ? ' wov-bt-active' : '') + '" data-tab-idx="' + ti + '" data-win-id="' + bw.id + '">'
          + fav
          + '<span class="wov-bt-title">' + escapeHtml(tab.title || 'New Tab') + '</span>'
          + '</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // close card
  }

  // "+ New Window" card
  var isNewSelected = _overviewSelectedIdx === _browseWindows.length;
  html += '<div class="wov-card wov-card-new' + (isNewSelected ? ' wov-selected' : '') + '" data-idx="' + _browseWindows.length + '">';
  html += '<div class="wov-card-preview wov-card-preview-empty">';
  html += '<div class="wov-card-new-icon">+</div>';
  html += '</div>';
  html += '<div class="wov-card-bar"><span class="wov-card-name">New Window</span></div>';
  html += '</div>';

  html += '</div>'; // close strip

  overlay.innerHTML = html;

  // Wire up click handlers on window cards
  overlay.querySelectorAll('.wov-card').forEach(function(card) {
    var idx = parseInt(card.dataset.idx);
    if (isNaN(idx)) return;
    card.addEventListener('click', function(e) {
      if (e.target.closest('.wov-card-close') || e.target.closest('.wov-bt')) return;
      if (idx >= _browseWindows.length) {
        // New window card
        wmOpen('browse');
        browseCreateWindow();
        hideBrowseTabOverview();
      } else {
        _overviewClickBrowseWin(_browseWindows[idx].id);
      }
    });
  });

  // Wire up close buttons
  overlay.querySelectorAll('.wov-card-close').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var winId = parseInt(btn.dataset.winId);
      if (!isNaN(winId)) _overviewCloseBrowseWin(winId);
    });
  });

  // Wire up tab clicks in expanded view
  overlay.querySelectorAll('.wov-bt').forEach(function(tabEl) {
    tabEl.addEventListener('click', function(e) {
      e.stopPropagation();
      var winId = parseInt(tabEl.dataset.winId);
      var tabIdx = parseInt(tabEl.dataset.tabIdx);
      var bw = _browseWindows.find(function(w) { return w.id === winId; });
      if (bw && bw.tabs[tabIdx]) {
        _overviewClickBrowseTab(bw.id, bw.tabs[tabIdx].id);
      }
    });
  });

  // Wire up horizontal wheel scroll
  var strip = overlay.querySelector('.wov-cards-strip');
  if (strip && !strip._wheelBound) {
    strip._wheelBound = true;
    strip.addEventListener('wheel', function(e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  // Wire up background click to dismiss
  overlay.addEventListener('mousedown', function(e) {
    if (e.target === overlay) hideBrowseTabOverview();
  });

  // Scroll selected into view
  var selTab = overlay.querySelector('.wov-bt.wov-selected');
  if (selTab) {
    selTab.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  } else {
    var sel = overlay.querySelector('.wov-card.wov-selected') || overlay.querySelector('.wov-card.wov-active');
    if (sel) sel.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  }

  // Embed live iframe/webview previews into each card
  _overviewEmbedFrames();
}

function _overviewClickBrowseWin(windowId) {
  browseSelectWindow(windowId);
  wmOpen('browse');
  hideBrowseTabOverview();
}

function _overviewClickBrowseTab(windowId, tabId) {
  browseSelectWindow(windowId);
  browseSelectTab(tabId);
  wmOpen('browse');
  hideBrowseTabOverview();
}

function _overviewCloseBrowseWin(windowId) {
  browseCloseWindow(windowId);
  if (_browseWindows.length === 0) {
    hideBrowseTabOverview();
    return;
  }
  if (_overviewSelectedIdx >= _browseWindows.length) _overviewSelectedIdx = _browseWindows.length - 1;
  _overviewBrowseWinIdx = _overviewSelectedIdx;
  _overviewBrowseTabIdx = -1;
  _overviewTabsExpanded = false;
  _renderWindowOverview();
}

// Keyboard shortcut for window overview (Cmd+Shift+\)
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? e.metaKey : e.ctrlKey;
  if (cmdKey && e.shiftKey && e.key === '\\') {
    e.preventDefault();
    toggleBrowseTabOverview();
  }
  if (e.key === 'Escape' && _browseTabOverviewVisible) {
    e.preventDefault();
    hideBrowseTabOverview();
  }
});

// Auto-focus NTP search input when user starts typing on a blank new-tab page
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return; // only printable characters
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  const ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

function _browseTitleFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'Local File';
    return u.hostname.replace(/^www\./, '');
  } catch { return url; }
}

function _browseFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

function browseNavigate(input) {
  // Handle slash commands
  const cmd = (input || '').trim().toLowerCase();
  if (cmd === '/history' || cmd === 'aether://history' || cmd === 'aether://history/') {
    openSearchHistoryPage();
    return;
  }
  if (cmd === '/help' || cmd === 'aether://help' || cmd === 'aether://help/') {
    openHelpPage();
    return;
  }
  if (cmd === '/upload') {
    const fi = document.getElementById('browse-pdf-file-input');
    if (fi) { fi.click(); return; }
    const tmp = document.createElement('input');
    tmp.type = 'file'; tmp.style.display = 'none';
    tmp.onchange = function() { if (tmp.files[0]) openLocalPdf(tmp.files[0]); tmp.remove(); };
    document.body.appendChild(tmp); tmp.click();
    return;
  }
  const url = _browseResolveUrl(input);
  // Track web searches (when input resolved to a Google search, not a direct URL)
  const trimmed = (input || '').trim();
  if (trimmed && url.startsWith('https://www.google.com/search?q=')) {
    _saveWebSearch(trimmed);
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) { browseNewTab(url); return; }
  // Tear down special pages if this tab was showing one
  if (tab._historyPage || tab._helpPage) {
    if (tab.el) tab.el.remove();
    tab.el = null;
    delete tab._historyPage;
    delete tab._helpPage;
  }
  // Push current URL onto back stack for navigation history
  if (tab.url && !tab.blank) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    tab.forwardStack = [];
  }
  // Clear annotations on navigation
  if (_annotationsEnabled.get(tab.id)) {
    _annotationsEnabled.set(tab.id, false);
    _updateAnnotateButtonState();
  }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  _saveBrowseVisit(url, tab.title);
  if (!tab.el) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
  } else {
    _browseSetFrameAllow(tab.el, url);
    const proxied = _browseProxyUrl(url);
    tab.el.dataset.originalUrl = url;
    tab.el.src = proxied;
    if (proxied !== url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
    }
  }
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, url);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateAdBlockBtn();
  _browseUpdateNewTabPage(tab);
  // Update sidebar for the navigated URL
  if (typeof _initSidebarForUrl === 'function') {
    _initSidebarForUrl(url);
  }
}

function _browseResolveUrl(input) {
  input = (input || '').trim();
  if (!input) return 'https://www.google.com';
  // Collapse internal whitespace/newlines from multi-line pastes (e.g. URLs copied across line breaks)
  if (/^(https?|file|blob|data|aether):\/\//i.test(input)) return input.replace(/\s+/g, '');
  // Resolve relative paths against the current tab's URL
  if (/^\//.test(input)) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab && tab.url) {
      try { return new URL(input, tab.url).href; } catch {}
    }
  }
  // Detect domain-like input (e.g. "google.com") but not file extensions like "llama.cpp"
  const collapsed = input.replace(/\s+/g, '');
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(collapsed) && !/\.(cpp|py|js|ts|rs|go|rb|java|cs|swift|kt|c|h|hpp|md|txt|json|xml|yaml|yml|toml|csv|sql|sh|bat|exe|dll|so|o|a|wasm|log|cfg|ini|conf|env|lock|gitignore)$/i.test(collapsed)) return 'https://' + collapsed;
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function _browseActiveEl() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  return tab ? tab.el : null;
}

// Hide/restore active webview so DOM popups can render on top (Electron GPU compositing fix)

function browseBack() {
  const el = _browseActiveEl();
  if (_browseIsElectron && el && el.canGoBack && el.canGoBack()) { el.goBack(); return; }
  // Use our own history stack for non-Electron (cross-origin iframes block history.back())
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.backStack && tab.backStack.length) {
    if (!tab.forwardStack) tab.forwardStack = [];
    tab.forwardStack.push(tab.url);
    const prevUrl = tab.backStack.pop();
    tab.url = prevUrl;
    tab.title = _browseTitleFromUrl(prevUrl);
    tab.favicon = _browseFaviconUrl(prevUrl);
    if (el) {
      _browseSetFrameAllow(el, prevUrl);
      const proxied = _browseProxyUrl(prevUrl);
      el.dataset.originalUrl = prevUrl;
      el.src = proxied;
    }
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, prevUrl);
    _browseRenderTabs();
    _browseUpdateSaveBtn();
    _browseSaveTabs();
    return;
  }
  // No in-tab history — fall back to returning to the previous view (feed, inbox, etc.)
  if (_browseReturnView) { _browseGoBack(); return; }
  // Last resort: nav history, then always go home
  if (typeof navBack === 'function' && navBack()) return;
  goHome();
}

function browseForward() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoForward && el.canGoForward()) { el.goForward(); return; }
  // Use our own history stack for non-Electron
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.forwardStack || !tab.forwardStack.length) return;
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url);
  const nextUrl = tab.forwardStack.pop();
  tab.url = nextUrl;
  tab.title = _browseTitleFromUrl(nextUrl);
  tab.favicon = _browseFaviconUrl(nextUrl);
  _browseSetFrameAllow(el, nextUrl);
  const proxied = _browseProxyUrl(nextUrl);
  el.dataset.originalUrl = nextUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, nextUrl);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
}

function browseReload() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.reload) { el.reload(); return; }
  if (!_browseIsElectron) { try { el.contentWindow.location.reload(); } catch(e) {} }
}

let _browseZoomLevel = 1.0;
let _browseZoomPanX = 0;
let _browseZoomPanY = 0;
let _browseZoomHideTimer = null;
function _browseShowZoomControls() {
  const controls = document.getElementById('browse-zoom-controls');
  if (!controls) return;
  controls.style.display = 'flex';
  clearTimeout(_browseZoomHideTimer);
  _browseZoomHideTimer = setTimeout(() => { controls.style.display = 'none'; }, 1500);
}
function browseZoom(dir) {
  if (dir === 0) { _browseZoomLevel = 1.0; _browseZoomPanX = 0; _browseZoomPanY = 0; }
  else _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + dir * 0.1));
  _browseApplyZoom();
  // Sync pinch overlay: active only when zoomed in (for pan scrolling)
  const po = document.querySelector('.browse-pinch-overlay');
  if (po) po.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
}
// focalX/focalY are cursor coords relative to the browse-content container viewport
function _browseApplyZoom(focalX, focalY) {
  const el = _browseActiveEl();
  const container = document.getElementById('browse-content');
  if (el && container) {
    if (_browseIsElectron && el.setZoomFactor) {
      el.setZoomFactor(_browseZoomLevel);
    } else {
      const oldZoom = parseFloat(el.dataset.zoom || '1');
      const newZoom = _browseZoomLevel;
      el.dataset.zoom = newZoom;

      // Optical zoom via CSS transform only — no layout change.
      // iframe stays 100% width/height, we scale and translate it.
      el.style.width = '100%';
      el.style.height = '100%';

      // Remove any leftover spacer from old approach
      const spacer = container.querySelector('.browse-zoom-spacer');
      if (spacer) spacer.remove();

      if (newZoom <= 1) {
        _browseZoomPanX = 0;
        _browseZoomPanY = 0;
        el.style.transform = 'none';
        el.style.transformOrigin = '';
      } else {
        // Focal-point zoom: keep content under cursor stationary
        if (focalX !== undefined && focalY !== undefined && oldZoom !== newZoom) {
          // Content coord under cursor: (panX + focalX) / oldZoom
          const contentX = (_browseZoomPanX + focalX) / oldZoom;
          const contentY = (_browseZoomPanY + focalY) / oldZoom;
          // New pan so same content coord stays under cursor
          _browseZoomPanX = contentX * newZoom - focalX;
          _browseZoomPanY = contentY * newZoom - focalY;
        }
        // Clamp pan to valid range
        const maxPanX = container.clientWidth * (newZoom - 1);
        const maxPanY = container.clientHeight * (newZoom - 1);
        _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
        _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));

        el.style.transformOrigin = '0 0';
        el.style.transform = `scale(${newZoom}) translate(${-_browseZoomPanX / newZoom}px, ${-_browseZoomPanY / newZoom}px)`;
      }
    }
  }
  const label = document.getElementById('browse-zoom-level');
  if (label) label.textContent = Math.round(_browseZoomLevel * 100) + '%';
  _browseShowZoomControls();
}

// ── Find in page ──

let _browseFindBarActive = false;
let _browseFindRequestId = 0;

function _browseToggleFindBar() {
  if (_browseFindBarActive) {
    // If already open, focus and select the input
    const input = document.getElementById('browse-find-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
  _browseFindBarActive = true;

  const browseView = document.getElementById('browse-view');
  if (!browseView) return;

  // Create the find bar
  const bar = document.createElement('div');
  bar.id = 'browse-find-bar';
  bar.className = 'browse-find-bar';
  bar.innerHTML =
    `<input type="text" id="browse-find-input" class="browse-find-input" placeholder="Find…" autocomplete="off" spellcheck="false">` +
    `<span id="browse-find-count" class="browse-find-count"></span>` +
    `<button class="browse-find-btn" id="browse-find-prev" title="Previous">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-next" title="Next">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-close" title="Close">&times;</button>`;

  // Insert into browse-content so it floats over the page
  const content = document.getElementById('browse-content');
  if (content) {
    content.appendChild(bar);
  } else {
    browseView.appendChild(bar);
  }

  const input = document.getElementById('browse-find-input');
  const countEl = document.getElementById('browse-find-count');

  const doFind = (forward) => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward, findNext: true });
    } else {
      // For same-origin iframes
      try { el.contentWindow.find(q, false, !forward); } catch (e) {}
    }
  };

  const onInput = () => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward: true, findNext: false });
    } else {
      try { el.contentWindow.find(q); } catch (e) {}
    }
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); _browseCloseFindBar(); }
    // Cmd+G / Cmd+Shift+G for next/prev
    if ((e.metaKey || e.ctrlKey) && e.key === 'g') { e.preventDefault(); doFind(!e.shiftKey); }
  });

  document.getElementById('browse-find-next').addEventListener('click', () => doFind(true));
  document.getElementById('browse-find-prev').addEventListener('click', () => doFind(false));
  document.getElementById('browse-find-close').addEventListener('click', _browseCloseFindBar);

  // Listen for found-in-page results (Electron webview)
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el) {
      const handler = (e) => {
        if (e.result && e.result.requestId === _browseFindRequestId) {
          const ct = document.getElementById('browse-find-count');
          if (ct) ct.textContent = e.result.matches > 0
            ? `${e.result.activeMatchOrdinal}/${e.result.matches}`
            : 'No matches';
        }
      };
      el._findHandler = handler;
      el.addEventListener('found-in-page', handler);
    }
  }

  input.focus();
}

function _browseStopFind() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.stopFindInPage) {
    el.stopFindInPage('clearSelection');
  }
}

function _browseCloseFindBar() {
  _browseFindBarActive = false;
  _browseStopFind();
  // Remove found-in-page listener
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el && el._findHandler) {
      el.removeEventListener('found-in-page', el._findHandler);
      delete el._findHandler;
    }
  }
  const bar = document.getElementById('browse-find-bar');
  if (bar) bar.remove();
}

// ── Pinch-to-magnify (Apple-like) — browse iframe only ────────────
// Trackpad pinch over the browse view → temporary magnification of
// the active iframe, centered on cursor. Release → snaps back to 1×.

let _magnifyZoom = 1;
let _magnifyX = 0;
let _magnifyY = 0;
let _magnifyGestureStart = 1;
let _magnifySnapTimer = null;
let _magnifyEl = null;

document.addEventListener('mousemove', function(e) {
  _magnifyX = e.clientX;
  _magnifyY = e.clientY;
}, { passive: true });

function _magnifyTarget() {
  var bv = document.getElementById('browse-view');
  if (!bv || bv.style.display === 'none') return null;
  return _browseActiveEl();
}

function _magnifyApply() {
  var el = _magnifyEl;
  if (!el) return;
  var container = document.getElementById('browse-content');
  if (!container) return;

  if (_magnifyZoom <= 1.005) {
    el.style.transform = '';
    el.style.transformOrigin = '';
    container.style.overflow = '';
    return;
  }
  var rect = container.getBoundingClientRect();
  var fx = _magnifyX - rect.left;
  var fy = _magnifyY - rect.top;
  el.style.transformOrigin = fx + 'px ' + fy + 'px';
  el.style.transform = 'scale(' + _magnifyZoom + ')';
  container.style.overflow = 'hidden';
}

function _magnifySnapBack() {
  clearTimeout(_magnifySnapTimer);
  _magnifyZoom = 1;
  var el = _magnifyEl;
  if (el) {
    Motion.animate(el, {
      spring: 'smooth', duration: 350,
      to: { scale: 1 },
      onFinish: function() {
        el.style.transformOrigin = '';
      }
    });
    var container = document.getElementById('browse-content');
    if (container) container.style.overflow = '';
  }
  _magnifyEl = null;
}

// Chrome/Firefox: trackpad pinch fires wheel with ctrlKey
document.addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  var target = _magnifyTarget();
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  _magnifyEl = target;
  clearTimeout(_magnifySnapTimer);
  target.style.transition = '';
  var delta = -e.deltaY * 0.01;
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyZoom + delta));
  _magnifyApply();
  // No gestureend in Chrome — snap back after inactivity
  _magnifySnapTimer = setTimeout(_magnifySnapBack, 600);
}, { passive: false, capture: true });

// Safari: native gesture events
document.addEventListener('gesturestart', function(e) {
  var target = _magnifyTarget();
  if (!target) return;
  e.preventDefault();
  _magnifyEl = target;
  _magnifyGestureStart = _magnifyZoom || 1;
  clearTimeout(_magnifySnapTimer);
  target.style.transition = '';
}, { passive: false, capture: true });

document.addEventListener('gesturechange', function(e) {
  if (!_magnifyEl) return;
  e.preventDefault();
  _magnifyZoom = Math.min(5, Math.max(1, _magnifyGestureStart * e.scale));
  _magnifyApply();
}, { passive: false, capture: true });

document.addEventListener('gestureend', function(e) {
  if (!_magnifyEl) return;
  e.preventDefault();
  _magnifySnapTimer = setTimeout(_magnifySnapBack, 200);
}, { passive: false, capture: true });

// Escape snaps back from magnify
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _magnifyZoom > 1.01) {
    e.preventDefault();
    _magnifySnapBack();
  }
}, { capture: true });

// Cmd+Plus / Cmd+Minus / Cmd+0 / Cmd+F / Cmd+T / Cmd+W for browse view
document.addEventListener('keydown', function(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); browseZoom(1); }
  else if (e.key === '-') { e.preventDefault(); browseZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); browseZoom(0); }
  else if (e.key === 'f') {
    e.preventDefault();
    const ntp = browseView.querySelector('.browse-ntp');
    if (ntp && ntp.style.display !== 'none') {
      const inp = ntp.querySelector('#search-query');
      if (inp) { inp.focus(); inp.select(); }
    } else { _browseToggleFindBar(); }
  }
});

// Cmd+W / Cmd+T work when the parent document has focus (clicking tab bar, URL bar,
// sidebar, etc.). When a cross-origin iframe has focus, browser security prevents
// intercepting these shortcuts — this is the same limitation every web app faces.
// No-op stubs kept so callers don't break.
let _browseKeyHandler = null;

let _browseTabBarFocused = false;

function _browseInstallKeyGuard() {
  if (_browseKeyHandler) return;
  _browseKeyHandler = (e) => {
    // Only handle if browse view is visible and not typing in an input
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Don't handle if tab overview is open (it has its own handler)
    if (_browseTabOverviewVisible) return;
    // Option+Arrow switches tabs globally (no tab bar focus needed)
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _switchTabLeft(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); _switchTabRight(); return; }
    }
    // Only handle arrow keys if tab bar is focused
    if (!_browseTabBarFocused) return;

    const win = _getCurrentWindow();
    if (!win) return;

    // Arrow keys for navigation when tab bar is focused
    const islandMode = _browseTabLayout === 'island';
    if (islandMode) {
      // Island layout: Up/Down switch tabs, no window switching via arrows
      if (e.key === 'ArrowUp' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabLeft();
      } else if (e.key === 'ArrowDown' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabRight();
      }
    } else {
      if (e.key === 'ArrowUp' && _browseWindows.length > 1) {
        e.preventDefault();
        switchWindowUp();
      } else if (e.key === 'ArrowDown' && _browseWindows.length > 1) {
        e.preventDefault();
        switchWindowDown();
      } else if (e.key === 'ArrowLeft' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabLeft();
      } else if (e.key === 'ArrowRight' && win.tabs.length > 1) {
        e.preventDefault();
        _switchTabRight();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _blurBrowseTabBar();
    }
  };
  document.addEventListener('keydown', _browseKeyHandler);

  // Click on content area blurs tab bar
  document.addEventListener('mousedown', (e) => {
    if (!_browseTabBarFocused) return;
    const tabBar = _getActiveTabBar();
    const switcher = e.target.closest('.browse-window-switcher');
    if (tabBar && !tabBar.contains(e.target) && !switcher) {
      _blurBrowseTabBar();
    }
  });
}

function _focusBrowseTabBar() {
  _browseTabBarFocused = true;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.add('tab-bar-focused');
}

function _blurBrowseTabBar() {
  _browseTabBarFocused = false;
  const tabBar = _getActiveTabBar();
  if (tabBar) tabBar.classList.remove('tab-bar-focused');
}

function _switchTabLeft() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx > 0) {
    _animateTabSwitch('left', () => {
      browseSelectTab(win.tabs[idx - 1].id);
    });
  }
}

function _switchTabRight() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx < win.tabs.length - 1) {
    _animateTabSwitch('right', () => {
      browseSelectTab(win.tabs[idx + 1].id);
    });
  }
}

function _animateTabSwitch(direction, callback) {
  var content = document.getElementById('browse-content');
  if (!content) { callback(); return; }
  var dist = direction === 'left' ? 30 : -30;
  Motion.swap(content, 'x', callback, { distance: dist, outOpacity: 0.5 });
}

function _browseRemoveKeyGuard() {
  if (_browseKeyHandler) {
    document.removeEventListener('keydown', _browseKeyHandler);
    _browseKeyHandler = null;
  }
}

// Transparent overlay to capture pinch gestures over iframes
function _browseInstallPinchOverlay() {
  const container = document.getElementById('browse-content');
  if (!container || container.querySelector('.browse-pinch-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'browse-pinch-overlay';
  // Default pointer-events:none so clicks pass through to webview natively.
  // Only activate (pointer-events:auto) when zoomed in for pan scrolling.
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;';
  container.appendChild(overlay);

  function _pinchOverlaySync() {
    overlay.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
  }

  // Chrome: pinch fires wheel with ctrlKey
  overlay.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + delta));
      const rect = container.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      _browseApplyZoom(fx, fy);
      _pinchOverlaySync();
    } else if (_browseZoomLevel > 1) {
      // When zoomed in, two-finger scroll pans the magnified view
      e.preventDefault();
      _browseZoomPanX += e.deltaX || 0;
      _browseZoomPanY += e.deltaY || 0;
      const maxPanX = container.clientWidth * (_browseZoomLevel - 1);
      const maxPanY = container.clientHeight * (_browseZoomLevel - 1);
      _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
      _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));
      _browseApplyZoom();
    }
  }, { passive: false });

  // Safari: gesturestart/gesturechange/gestureend for trackpad pinch
  let overlayGestureStartZoom = 1;
  overlay.addEventListener('gesturestart', function(e) {
    e.preventDefault();
    overlayGestureStartZoom = _browseZoomLevel;
  }, { passive: false });
  overlay.addEventListener('gesturechange', function(e) {
    e.preventDefault();
    _browseZoomLevel = Math.min(5.0, Math.max(1.0, overlayGestureStartZoom * e.scale));
    const rect = container.getBoundingClientRect();
    const fx = rect.width / 2;
    const fy = rect.height / 2;
    _browseApplyZoom(fx, fy);
    _pinchOverlaySync();
  }, { passive: false });
  overlay.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });

  // When zoomed in, mousedown on overlay should pass through for clicks then restore
  overlay.addEventListener('mousedown', function() {
    overlay.style.pointerEvents = 'none';
    function _restore() {
      document.removeEventListener('mouseup', _restore);
      setTimeout(function() { _pinchOverlaySync(); }, 50);
    }
    document.addEventListener('mouseup', _restore);
  });

  // Also intercept ctrl+wheel on webview frames directly for initial zoom-in
  container.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + delta));
    const rect = container.getBoundingClientRect();
    _browseApplyZoom(e.clientX - rect.left, e.clientY - rect.top);
    _pinchOverlaySync();
  }, { passive: false, capture: true });
}

function browseSaveToReadingList() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  const wasAdding = !getSavedPosts()[tab.url];
  const paper = { title: tab.title, link: tab.url, source: 'browse', description: '', authors: '', date: '' };
  const saved = getSavedPosts();
  if (saved[tab.url]) {
    delete saved[tab.url];
  } else {
    saved[tab.url] = { paper, savedAt: Date.now(), read: false };
    if (typeof petReact === 'function') petReact('happy');
  }
  savePosts(saved);
  updateSavedBadge();
  _browseUpdateSaveBtn();
  if (wasAdding) {
    const btn = document.getElementById('browse-save-btn');
    if (btn && typeof _showBookmarkFly === 'function') {
      const r = btn.getBoundingClientRect();
      _showBookmarkFly({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
  }
}

function browseShare() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  if (navigator.share) {
    navigator.share({ title: tab.title, url: tab.url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(tab.url).then(() => {
      const btn = document.querySelector('#browse-bar button[onclick="browseShare()"]');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
        btn.classList.add('text-primary');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('text-primary'); }, 1500);
      }
    });
  }
}

function _browseUpdateSaveBtn() {
  const btn = document.getElementById('browse-save-btn');
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const saved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  if (btn) {
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', saved ? 'var(--accent)' : 'none');
      svg.setAttribute('stroke', saved ? 'var(--accent)' : 'currentColor');
    }
  }
  _islandSyncBookmark();
}

function _islandSyncBookmark() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen && tab && !tab.blank && tab.url && isPostSaved(tab.url)) {
    var title = (tab.title || '').length > 40 ? tab.title.slice(0, 38) + '\u2026' : (tab.title || 'Saved');
    islandUpdate('bookmark', { type: 'bookmark', label: 'Saved', detail: title, action: function() { browseSaveToReadingList(); } });
  } else {
    islandRemove('bookmark');
  }
}

// ── Tab Sessions (save/restore named tab groups) ──

function _getTabSessions() {
  try { return JSON.parse(localStorage.getItem(_getBrowseStorageKey('browseTabSessions')) || '[]'); } catch { return []; }
}

function _saveTabSessions(sessions) {
  localStorage.setItem(_getBrowseStorageKey('browseTabSessions'), JSON.stringify(sessions));
}

function toggleTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
  _renderTabStateDropdown();
  dd.style.display = '';
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.focus();
  }, 50);
  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleTabStateDropdown"]')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

function _renderTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  const sessions = _getTabSessions();
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  const canSave = openTabs.length > 0;

  let html = `<div style="position:absolute;right:0;top:calc(100% + 4px);min-width:260px;max-height:360px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">`;

  // Save current tabs section
  html += `<div style="padding:6px 12px;border-bottom:1px solid var(--border-subtle);">
    <div id="tab-session-save-row" style="display:flex;align-items:center;gap:4px;">
      <input id="tab-session-name-input" type="text" placeholder="Session name…" style="flex:1;min-width:0;padding:5px 8px;border:1px solid var(--border-input);background:var(--bg-input);color:var(--text-primary);font-size:0.78rem;border-radius:6px;outline:none;" onkeydown="if(event.key==='Enter')confirmSaveTabSession()" ${canSave ? '' : 'disabled'}>
      <button onclick="confirmSaveTabSession()" style="padding:5px 10px;border:none;background:${canSave ? 'var(--accent)' : 'var(--bg-hover)'};color:${canSave ? '#fff' : 'var(--text-dimmest)'};font-size:0.78rem;border-radius:6px;cursor:${canSave ? 'pointer' : 'default'};white-space:nowrap;" ${canSave ? '' : 'disabled'}>Save ${openTabs.length} tab${openTabs.length !== 1 ? 's' : ''}</button>
    </div>
  </div>`;

  if (!sessions.length) {
    html += `<div style="padding:12px;font-size:0.75rem;color:var(--text-dimmest);text-align:center">No saved sessions</div>`;
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
      const winCount = s.windows ? s.windows.length : 1;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const subtitle = winCount > 1 ? `${winCount} windows · ${count} tabs · ${date}` : `${count} tab${count !== 1 ? 's' : ''} · ${date}`;
      html += `<div class="tab-session-row" style="display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
        <button onclick="loadTabSession(${i})" style="flex:1;min-width:0;text-align:left;border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;gap:1px;">
          <span style="font-size:0.8rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escapeHtml(s.name)}</span>
          <span style="font-size:0.68rem;color:var(--text-dimmer)">${subtitle}</span>
        </button>
        <button onclick="event.stopPropagation();deleteTabSession(${i})" style="border:none;background:none;color:var(--text-dimmest);cursor:pointer;padding:2px;font-size:0.9rem;line-height:1;flex-shrink:0;" title="Delete session" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-dimmest)'">&times;</button>
      </div>`;
    }
  }

  html += '</div>';
  dd.innerHTML = html;
}

function confirmSaveTabSession() {
  const input = document.getElementById('tab-session-name-input');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  if (!openTabs.length) return;
  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    tabs: openTabs.map(t => ({ url: t.url, title: t.title })),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  // Focus the new input after re-render
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.value = '';
  }, 0);
}

function loadTabSession(index) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;
  // Close dropdown
  const dd = document.getElementById('tab-state-dropdown');
  if (dd) dd.style.display = 'none';

  // Handle multi-window sessions
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
    }
  } else {
    // Legacy single-window sessions
    for (const saved of session.tabs) {
      browseNewTab(saved.url);
    }
  }
  _browseRenderTabs();
}

function deleteTabSession(index) {
  const sessions = _getTabSessions();
  sessions.splice(index, 1);
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  _renderToolbarSessions();
  // Also update overview if visible
  if (_browseTabOverviewVisible) _renderBrowseTabOverview();
}

// Save all windows as a session (for tab overview)
function saveAllWindowsAsSession(name) {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    windows: _browseWindows.map(w => ({
      name: w.name,
      tabs: w.tabs.filter(t => !t.blank && t.url).map(t => ({ url: t.url, title: t.title }))
    })).filter(w => w.tabs.length > 0),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
}

// Toggle sessions dropdown
function _toggleSessionsDropdown() {
  const menu = document.querySelector('.browse-sessions-menu');
  const toggle = document.querySelector('.browse-sessions-toggle');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (toggle) toggle.classList.toggle('open', !isOpen);

  if (!isOpen) {
    // Close on click outside
    setTimeout(() => {
      const handler = (e) => {
        if (!e.target.closest('.browse-sessions-dropdown')) {
          menu.style.display = 'none';
          if (toggle) toggle.classList.remove('open');
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }, 0);
  }
}

// Render sessions dropdown in toolbar
function _renderToolbarSessions() {
  const container = document.getElementById('browse-toolbar-sessions');
  if (!container) return;

  const sessions = _getTabSessions();
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  const canSave = totalTabs > 0;

  container.innerHTML = `
    <button class="browse-sessions-toggle" onclick="_toggleSessionsDropdown()">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
      <svg class="w-3 h-3 chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
    </button>
    <div class="browse-sessions-menu" style="display:none;">
      <div class="browse-sessions-menu-header">
        <button class="browse-save-session-btn" onclick="_promptSaveSessionFromOverview()" ${canSave ? '' : 'disabled'}>
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Save current
        </button>
      </div>
      <div class="browse-sessions-list">
        ${sessions.length === 0 ? '<div class="browse-sessions-empty">No saved sessions</div>' : sessions.map((s, i) => {
          const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
          const winCount = s.windows ? s.windows.length : 1;
          const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const subtitle = winCount > 1 ? `${winCount} win · ${count} tabs` : `${count} tab${count !== 1 ? 's' : ''}`;
          return `
            <div class="browse-session-item">
              <button class="browse-session-info" onclick="_loadSessionFromOverview(${i})" title="Replace current tabs">
                <span class="browse-session-name">${escapeHtml(s.name)}</span>
                <span class="browse-session-meta">${subtitle} · ${date}</span>
              </button>
              <button class="browse-session-add" onclick="_loadSessionFromOverview(${i}, true)" title="Add to existing">+</button>
              <button class="browse-session-delete" onclick="deleteTabSession(${i})" title="Delete">&times;</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Prompt to save session from overview - show inline input in sessions menu
function _promptSaveSessionFromOverview() {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessionsList = document.querySelector('.browse-sessions-list');
  if (!sessionsList) return;

  // Check if input already exists
  if (sessionsList.querySelector('.browse-session-input-row')) return;

  // Create input row at top
  const inputRow = document.createElement('div');
  inputRow.className = 'browse-session-input-row';
  inputRow.innerHTML = `
    <input type="text" placeholder="Session name..." autofocus>
    <button class="save-confirm">Save</button>
    <button class="save-cancel">&times;</button>
  `;
  sessionsList.insertBefore(inputRow, sessionsList.firstChild);

  const input = inputRow.querySelector('input');
  const confirmBtn = inputRow.querySelector('.save-confirm');
  const cancelBtn = inputRow.querySelector('.save-cancel');

  input.focus();

  const doSave = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    saveAllWindowsAsSession(name);
    _renderToolbarSessions();
    _renderBrowseTabOverview();
  };

  const doCancel = () => inputRow.remove();

  confirmBtn.onclick = (e) => { e.stopPropagation(); doSave(); };
  cancelBtn.onclick = (e) => { e.stopPropagation(); doCancel(); };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  };
}

// Save a single window as a session - show inline input
// Load session from overview (replaces current windows)
function _loadSessionFromOverview(index, addToExisting = false) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;

  if (!addToExisting) {
    // Close all existing windows/tabs first
    while (_browseWindows.length > 0) {
      const win = _browseWindows[0];
      while (win.tabs.length > 0) {
        _destroyTab(win.tabs[0]);
        win.tabs.shift();
      }
      _browseWindows.shift();
    }
  }

  // Load the session
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
      if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
    }
  } else if (session.tabs) {
    // Legacy format - create one window
    const newWin = _createBrowseWindow('Window 1');
    for (const t of session.tabs) {
      _browseCreateTabInWindow(newWin.id, t.url);
    }
    if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
  }

  // Activate the first window
  if (_browseWindows.length) {
    _browseActiveWindow = _browseWindows[0].id;
    const win = _browseWindows[0];
    if (win.activeTab) browseSelectTab(win.activeTab);
  }

  _browseSaveTabs();
  _browseRenderTabs();
  _renderBrowseTabOverview();
}

// ── Browse More Menu (three dots) ──

function toggleBrowseMoreMenu() {
  const dd = document.getElementById('browse-more-menu');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const hasTab = tab && !tab.blank && tab.url;
  const isIsland = _browseTabLayout === 'island';

  // Build overflow rows for buttons hidden in the bar
  let overflowRows = '';
  const btnStyle = `width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;`;
  const navBtnStyle = `width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;`;

  // In island mode, all bar buttons are hidden — add nav + toolbar buttons to menu
  if (isIsland) {
    overflowRows += `<button onclick="browseBack();document.getElementById('browse-more-menu').style.display='none';" style="${navBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg> Back</button>`;
    overflowRows += `<button onclick="browseForward();document.getElementById('browse-more-menu').style.display='none';" style="${navBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg> Forward</button>`;
    overflowRows += `<button onclick="browseReload();document.getElementById('browse-more-menu').style.display='none';" style="${navBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Reload</button>`;
    const isSaved = hasTab && isPostSaved(tab.url);
    overflowRows += `<button onclick="browseSaveToReadingList();_refreshOverflowBookmark(this);" style="${btnStyle}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'var(--accent)' : 'none'}" stroke="${isSaved ? 'var(--accent)' : 'currentColor'}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg> ${isSaved ? 'Saved' : 'Save to Reading List'}</button>`;
    overflowRows += `<button onclick="browseShare();document.getElementById('browse-more-menu').style.display='none';" style="${navBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"/></svg> Share</button>`;
    const _adOn = localStorage.getItem('adBlockEnabled') === 'true';
    overflowRows += `<button onclick="toggleAdBlock();document.getElementById('browse-more-menu').style.display='none';" style="${btnStyle}${_adOn ? 'color:var(--accent);' : ''}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/></svg> Ad Blocker <span style="margin-left:auto;font-size:0.7rem;color:var(--text-dimmest)">${_adOn ? 'On' : 'Off'}</span></button>`;
    const _annEnabled = tab && _annotationsEnabled.get(tab.id);
    overflowRows += `<button onclick="toggleAnnotations();document.getElementById('browse-more-menu').style.display='none';" style="${btnStyle}${_annEnabled ? 'color:var(--accent);' : ''}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9h8M8 13h6" stroke-linecap="round"/></svg> ${_annEnabled ? 'Remove Annotations' : 'Annotate Page'}</button>`;
    overflowRows += `<button onclick="openSearchHistoryPage();document.getElementById('browse-more-menu').style.display='none';" style="${btnStyle}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg> Search History</button>`;
    overflowRows += `<button onclick="toggleBrowseSidebar();document.getElementById('browse-more-menu').style.display='none';" style="${btnStyle}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg> Toggle Sidebar</button>`;
  } else {
  const overflowIds = typeof getBarOverflowIds === 'function' ? getBarOverflowIds() : [];
  overflowIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = el.title || id;
    const svgEl = el.querySelector('svg');
    let icon = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';

    // Bookmark button: toggle in-place instead of removing from overflow
    if (id === 'browse-save-btn') {
      const isSaved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
      icon = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'var(--accent)' : 'none'}" stroke="${isSaved ? 'var(--accent)' : 'currentColor'}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`;
      overflowRows += `<button data-overflow-id="${id}" onclick="browseSaveToReadingList();_refreshOverflowBookmark(this);" style="${btnStyle}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">${icon} ${isSaved ? 'Saved' : 'Save to Reading List'}</button>`;
    } else {
      // Click executes the button's action; long-press drag restores to bar
      const onclick = el.getAttribute('onclick') || '';
      overflowRows += `<button data-overflow-id="${id}" onclick="document.getElementById('browse-more-menu').style.display='none';${onclick.replace(/"/g, '&quot;')}" style="${btnStyle}" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">${icon} ${label}</button>`;
    }
  });
  }

  const fixedBtnStyle = `width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;`;
  const fixedItems = `
    <div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>
    <button onclick="_togglePermissionsInMenu(event)" style="${fixedBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>
      Site Permissions
      <svg id="browse-menu-perms-arrow" class="w-3 h-3" style="margin-left:auto;color:var(--text-dimmest);transition:transform .15s;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7"/></svg>
    </button>
    <div id="browse-menu-perms-panel" style="display:none;border-top:1px solid var(--border-subtle);"></div>
    <button onclick="browsePrintPage();document.getElementById('browse-more-menu').style.display='none';" style="${fixedBtnStyle}" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg>
      Print page
    </button>
    <button onclick="toggleBrowseTabLayout();document.getElementById('browse-more-menu').style.display='none';" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      ${_browseTabLayout === 'island'
        ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 3h16v5H4V3zM4 3h16v18H4V3z"/></svg> Horizontal Tabs'
        : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v18M4 3h16v18H4V3z"/></svg> Island Mode'}
    </button>
    <button onclick="location.hash='#settings';document.getElementById('browse-more-menu').style.display='none';" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
      Settings
    </button>`;

  const anchorBtn = (isIsland
    ? (document.getElementById('pill-browse-more') || document.getElementById('pill-browse-hamburger'))
    : document.getElementById('browse-more-btn')) || document.getElementById('browse-more-btn');
  const btnRect = anchorBtn.getBoundingClientRect();
  const menuPos = isIsland
    ? `right:${Math.round(window.innerWidth - btnRect.right)}px;top:${Math.round(btnRect.bottom + 4)}px`
    : `left:${Math.round(btnRect.left)}px;top:${Math.round(btnRect.bottom + 4)}px`;
  dd.innerHTML = `<div style="position:fixed;${menuPos};min-width:180px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">
    ${overflowRows}${fixedItems}
  </div>`;
  dd.style.display = '';

  // Set up long-press drag on overflow items to drag back to bar
  _setupOverflowDrag(dd);

  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]') && !e.target.closest('#pill-browse-more')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

function _togglePermissionsInMenu(e) {
  e.stopPropagation();
  const panel = document.getElementById('browse-menu-perms-panel');
  const arrow = document.getElementById('browse-menu-perms-arrow');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  if (!open) _renderSitePermissionsDropdown(panel);
}

// Refresh bookmark button appearance in the overflow menu after toggling
function _refreshOverflowBookmark(btn) {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isSaved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', isSaved ? 'var(--accent)' : 'none');
    svg.setAttribute('stroke', isSaved ? 'var(--accent)' : 'currentColor');
  }
  // Update the label text
  const textNode = Array.from(btn.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
  if (textNode) textNode.textContent = ' ' + (isSaved ? 'Saved' : 'Save to Reading List');
}

// Long-press on overflow menu items to drag them back to the browse bar
function _setupOverflowDrag(dd) {
  let holdTimer = null;
  let dragGhost = null;
  let dragId = null;
  let dragBtn = null;

  function onPointerDown(e) {
    const btn = e.target.closest('[data-overflow-id]');
    if (!btn) return;
    const id = btn.dataset.overflowId;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      dragId = id;
      dragBtn = btn;
      // Prevent the click from firing
      btn.style.opacity = '0.4';
      // Create floating ghost
      dragGhost = btn.cloneNode(true);
      dragGhost.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;padding:6px 12px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);font-size:0.78rem;display:flex;align-items:center;gap:8px;opacity:0.9;color:var(--text-primary);white-space:nowrap;';
      dragGhost.style.left = (e.clientX - 40) + 'px';
      dragGhost.style.top = (e.clientY - 14) + 'px';
      document.body.appendChild(dragGhost);
      // Suppress click after drag
      btn.addEventListener('click', suppressClick, { capture: true, once: true });
    }, 400);
  }

  function suppressClick(e) { e.stopPropagation(); e.preventDefault(); }

  function onPointerMove(e) {
    if (holdTimer && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (!dragGhost) return;
    dragGhost.style.left = (e.clientX - 40) + 'px';
    dragGhost.style.top = (e.clientY - 14) + 'px';
    // Highlight browse bar when hovering over it
    const bar = document.getElementById('browse-bar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        bar.style.outline = '2px solid var(--accent)';
        bar.style.outlineOffset = '-2px';
      } else {
        bar.style.outline = '';
        bar.style.outlineOffset = '';
      }
    }
  }

  function onPointerUp(e) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; return; }
    if (!dragGhost || !dragId) return;
    const bar = document.getElementById('browse-bar');
    let dropped = false;
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        dropped = true;
      }
      bar.style.outline = '';
      bar.style.outlineOffset = '';
    }
    dragGhost.remove();
    dragGhost = null;
    if (dragBtn) dragBtn.style.opacity = '';
    if (dropped) {
      removeFromBarOverflow(dragId);
      // Close the menu
      dd.style.display = 'none';
    }
    dragId = null;
    dragBtn = null;
  }

  dd.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  // Clean up when menu hides
  const obs = new MutationObserver(() => {
    if (dd.style.display === 'none') {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
      obs.disconnect();
    }
  });
  obs.observe(dd, { attributes: true, attributeFilter: ['style'] });
}

function browsePrintPage() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);

  const el = _browseActiveEl();
  if (!el) return;

  if (_browseIsElectron && el.printToPDF) {
    const title = 'Print — ' + ((tab && tab.title) || 'Page');
    el.printToPDF({ printBackground: true }).then(buf => {
      const blob = new Blob([buf], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      browseNewTab(blobUrl);
    }).catch(() => { el.print(); });
  } else {
    try { el.contentWindow.print(); } catch (e) {
      // Cross-origin iframe — open in new tab so user can print from there
      if (tab && tab.url) window.open(tab.url, '_blank');
    }
  }
}

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


// ── Live Annotations ──

const _annotationsEnabled = new Map(); // tabId → bool
const _annotationsCache = new Map();   // url → { annotations, ts }

// Restore annotation cache from localStorage on load
try {
  const _savedAnnCache = JSON.parse(localStorage.getItem('annotationsCache') || '{}');
  const _annNow = Date.now();
  for (const [url, entry] of Object.entries(_savedAnnCache)) {
    if (_annNow - entry.ts < 300000) _annotationsCache.set(url, entry);
  }
} catch {}

function _persistAnnotationsCache() {
  const obj = {};
  const now = Date.now();
  for (const [url, entry] of _annotationsCache) {
    if (now - entry.ts < 300000) obj[url] = entry;
  }
  localStorage.setItem('annotationsCache', JSON.stringify(obj));
}
let _annotationOfferTimer = null;
let _annotationAbort = null; // AbortController for in-flight annotation

function _offerAnnotation(tab) {
  // Clear any previous offer timer
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  // Don't offer if already annotating or on blank/internal pages
  if (!tab || tab.blank) return;
  const url = tab.url || '';
  if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;
  // Don't offer if annotations already enabled for this tab
  if (_annotationsEnabled.get(tab.id)) return;
  // If we have a cached result for this URL, restore it directly
  if (_restoreAnnotationPill(tab)) return;
  // Remove any existing annotate pill
  if (typeof islandRemove === 'function') islandRemove('annotate');
  // Auto-annotate: skip the offer and annotate immediately
  if (localStorage.getItem('autoAnnotate') === 'on') {
    _annotationOfferTimer = setTimeout(() => {
      if (_browseActiveTab !== tab.id) return;
      if (_annotationsEnabled.get(tab.id)) return;
      toggleAnnotations();
    }, 1500);
    return;
  }
  // Show offer after a short delay (let page settle)
  _annotationOfferTimer = setTimeout(() => {
    // Re-check tab is still active
    if (_browseActiveTab !== tab.id) return;
    if (_annotationsEnabled.get(tab.id)) return;
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', {
        type: 'annotate',
        label: 'Annotate',
        detail: 'Annotate this page',
        loading: false,
        offer: true,
        action: () => {
          toggleAnnotations();
        }
      });
    }
    // Compact offer to icon-only after 15s
    _annotationOfferTimer = setTimeout(() => {
      var pill = document.querySelector('.pill-island[data-island-id="annotate"]');
      if (pill) pill.classList.add('island-compact');
    }, 15000);
  }, 1500);
}

function _restoreAnnotationPill(tab) {
  if (!tab || !tab.url) return false;
  const cached = _annotationsCache.get(tab.url);
  if (!cached || Date.now() - cached.ts > 300000) return false;
  const annotations = cached.annotations || [];
  if (!annotations.length) return false;
  const typeCounts = {};
  for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
  const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'KEY_FINDING';
  // Auto-enable and inject cached annotations into the page
  _annotationsEnabled.set(tab.id, true);
  injectAnnotations(tab, annotations);
  _updateAnnotateButtonState();
  if (typeof islandUpdate === 'function') {
    islandUpdate('annotate', {
      type: 'annotate',
      label: `${annotations.length} annotations`,
      detail: `${annotations.length} annotations on this page`,
      items: annotations,
      modeType,
      loading: false,
      offer: false
    });
  }
  return true;
}

function toggleAnnotations() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank) return;
  // Clear any pending offer timer
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  const enabled = !_annotationsEnabled.get(tab.id);
  _annotationsEnabled.set(tab.id, enabled);
  _updateAnnotateButtonState();
  if (enabled) {
    annotateCurrentPage(tab);
  } else {
    clearAnnotations(tab);
  }
}

async function annotateCurrentPage(tab) {
  if (!tab || !tab.el) return;
  const url = tab.url || '';

  // Check cache (5 min)
  const cached = _annotationsCache.get(url);
  if (cached && Date.now() - cached.ts < 300000) {
    injectAnnotations(tab, cached.annotations);
    _restoreAnnotationPill(tab);
    return;
  }

  // Abort any previous in-flight annotation
  if (_annotationAbort) { _annotationAbort.abort(); _annotationAbort = null; }
  const abortCtrl = new AbortController();
  _annotationAbort = abortCtrl;

  // Show island with yellow dot; delay before showing cancel button
  if (typeof islandUpdate === 'function') {
    const dismissFn = () => {
      abortCtrl.abort();
      _annotationsEnabled.delete(tab.id);
      _updateAnnotateButtonState();
      islandRemove('annotate');
    };
    islandUpdate('annotate', {
      type: 'annotate', label: 'Annotating…', loading: true, offer: false, action: null,
      showCancel: false, dismiss: dismissFn
    });
    setTimeout(() => {
      const act = typeof _islandActivities !== 'undefined' ? _islandActivities['annotate'] : null;
      if (act && act.loading) {
        islandUpdate('annotate', Object.assign({}, act, { showCancel: true }));
      }
    }, 1500);
  }

  try {
    // Extract text directly from the webview/iframe (already loaded)
    const pageText = await _extractTextFromFrame(tab);
    if (abortCtrl.signal.aborted) return;
    if (!pageText) {
      if (typeof islandUpdate === 'function') {
        islandUpdate('annotate', { type: 'annotate', label: 'No text found', loading: false, done: true });
      }
      return;
    }

    // Call annotate API (current tab only — no cross-tab context)
    const model = localStorage.getItem('summaryModel') || '';
    const resp = await fetch('/api/annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, text: pageText, otherTabs: [], model }),
      signal: abortCtrl.signal
    });
    const data = await resp.json();
    if (abortCtrl.signal.aborted) return;
    const annotations = data.annotations || [];

    // Cache
    _annotationsCache.set(url, { annotations, ts: Date.now() });
    _persistAnnotationsCache();

    // Only inject if still enabled
    if (_annotationsEnabled.get(tab.id)) {
      injectAnnotations(tab, annotations);
    }

    // Keep pill persistent with annotation items (clickable list)
    // Icon color = mode (most frequent type)
    const typeCounts = {};
    for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
    const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'KEY_FINDING';
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', {
        type: 'annotate',
        label: `${annotations.length} annotations`,
        detail: `${annotations.length} annotations on this page`,
        items: annotations,
        modeType,
        loading: false
      });
    }
  } catch (err) {
    if (abortCtrl.signal.aborted) return; // cancelled by user
    console.error('[annotate] Error:', err);
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', { type: 'annotate', label: 'Failed', loading: false, done: true });
    }
  }
}

async function _extractTextFromFrame(tab) {
  if (!tab || !tab.el) return '';
  const frame = tab.el;
  const script = `(function() {
    const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
    const block = new Set(['DIV','P','BR','H1','H2','H3','H4','H5','H6','LI','TR','BLOCKQUOTE','PRE','SECTION','ARTICLE','HEADER','FOOTER','ASIDE','DT','DD','FIGCAPTION','HR','BIG','DETAILS','SUMMARY','NAV','MAIN','TABLE','THEAD','TBODY','TFOOT','OL','UL']);
    function getText(el) {
      if (skip.has(el.tagName)) return '';
      if (el.tagName === 'BR') return '\\n';
      let t = '';
      for (const c of el.childNodes) {
        if (c.nodeType === 3) t += c.textContent;
        else if (c.nodeType === 1) {
          var inner = getText(c);
          if (block.has(c.tagName) && inner.trim()) t += '\\n' + inner + '\\n';
          else t += inner;
        }
      }
      return t;
    }
    return getText(document.body || document.documentElement).replace(/[^\\S\\n]+/g, ' ').replace(/\\n\\s*\\n/g, '\\n\\n').trim();
  })()`;
  try {
    if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
      return await frame.executeJavaScript(script);
    } else if (frame.tagName === 'IFRAME') {
      return frame.contentDocument.body.innerText || '';
    }
  } catch { /* cross-origin */ }
  return '';
}


async function _readPageAloud() {
  // Pause/resume if already playing
  if (_ttsAudio || _ttsPaused) {
    _ttsPauseResume();
    return;
  }
  // Stop if queued but not playing (shouldn't normally happen)
  if (_ttsChunks.length > 0) {
    _ttsStopAll();
    return;
  }
  var win = _getCurrentWindow();
  if (!win) return;
  var tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  if (!tab) return;
  var btn = document.getElementById('pill-readaloud-btn');
  if (btn) btn.classList.add('pill-readaloud-active');
  _ttsTabId = tab.id;
  islandUpdate('tts', { type: 'tts', label: 'Extracting\u2026', detail: 'Extracting page text', action: _ttsIslandAction });
  var text = await _extractTextFromFrame(tab);
  if (!text || text.length < 10) {
    islandUpdate('tts', { type: 'tts', label: 'No text', detail: 'No readable text found', done: true });
    if (btn) btn.classList.remove('pill-readaloud-active');
    _ttsTabId = null;
    return;
  }
  // Chunk text and queue for playback
  _ttsStopped = false;
  _ttsPaused = false;
  _ttsChunks = _ttsChunkText(text);
  _ttsChunkIdx = 0;
  _ttsUpdateBtnIcon();
  _ttsQueue = [];
  _ttsFetchAndQueue();
}

function _showAnnotationTooltip(data, frame) {
  let tip = document.getElementById('aether-annotation-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'aether-annotation-tooltip';
    tip.className = 'doc-selection-popup aether-ann-tooltip';
    document.body.appendChild(tip);
  }
  const labelEl = '<div class="aether-ann-label" style="color:' + (data.labelColor || '#4caf50') + '">' + (data.label || data.type) + '</div>';
  const explEl = '<div class="aether-ann-explanation">' + data.explanation + '</div>';
  const conflictEl = data.conflictsWith ? '<div class="aether-ann-conflict">Conflicts with: ' + data.conflictsWith + '</div>' : '';
  tip.innerHTML = labelEl + explEl + conflictEl;
  tip.style.opacity = '1';
  const fRect = frame.getBoundingClientRect();
  const cx = data.x + fRect.left;
  const cy = data.y + fRect.top;
  const tipW = tip.offsetWidth || 320;
  const tipH = tip.offsetHeight || 60;
  const left = Math.min(cx + 12, window.innerWidth - tipW - 8);
  let top = cy - tipH - 12;
  if (top < 4) top = cy + 20;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function _hideAnnotationTooltip() {
  const tip = document.getElementById('aether-annotation-tooltip');
  if (tip) tip.style.opacity = '0';
}

function injectAnnotations(tab, annotations) {
  if (!tab || !tab.el || !annotations.length) return;
  const frame = tab.el;

  const colorMap = {
    KEY_FINDING: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50', label: 'Key Finding', labelColor: '#4caf50' },
    CONTRADICTION: { bg: 'rgba(239, 83, 80, 0.25)', border: '#ef5350', label: 'Contradiction', labelColor: '#ef5350' },
    VERIFY: { bg: 'rgba(255, 193, 7, 0.25)', border: '#ffc107', label: 'Verify', labelColor: '#ffc107' }
  };

  const annotationsJSON = JSON.stringify(annotations).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const colorMapJSON = JSON.stringify(colorMap).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const script = `
    (function() {
      if (window.__aetherAnnotationsActive) return;
      window.__aetherAnnotationsActive = true;
      const annotations = JSON.parse('${annotationsJSON}');
      const colorMap = JSON.parse('${colorMapJSON}');

      var _hoveredAnn = null;
      function showTooltip(mark, ann) {
        var c = colorMap[ann.type] || colorMap.KEY_FINDING;
        _hoveredAnn = { type: ann.type, label: c.label, labelColor: c.labelColor, explanation: ann.explanation, conflictsWith: ann.conflictsWith || '' };
      }

      function hideTooltip() {
        _hoveredAnn = null;
        console.log('__AETHER_ANN_LEAVE__');
      }

      document.addEventListener('mousemove', function(e) {
        if (!_hoveredAnn) return;
        console.log('__AETHER_ANN_MOVE__' + JSON.stringify({ x: e.clientX, y: e.clientY, type: _hoveredAnn.type, label: _hoveredAnn.label, labelColor: _hoveredAnn.labelColor, explanation: _hoveredAnn.explanation, conflictsWith: _hoveredAnn.conflictsWith }));
      });

      // Build concatenated text from all text nodes with position mapping
      const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
      function collectTextNodes(el) {
        const result = [];
        if (skip.has(el.tagName)) return result;
        for (const child of el.childNodes) {
          if (child.nodeType === 3) result.push(child);
          else if (child.nodeType === 1) result.push(...collectTextNodes(child));
        }
        return result;
      }
      const textNodes = collectTextNodes(document.body);
      let fullText = '';
      const nodeMap = []; // { node, start, end }
      for (const node of textNodes) {
        const start = fullText.length;
        fullText += node.textContent;
        nodeMap.push({ node, start, end: fullText.length });
      }
      const fullLower = fullText.toLowerCase();

      for (const ann of annotations) {
        const quote = ann.quote;
        if (!quote) continue;
        const quoteLower = quote.toLowerCase();
        const matchIdx = fullLower.indexOf(quoteLower);
        if (matchIdx === -1) continue;
        const matchEnd = matchIdx + quote.length;
        const c = colorMap[ann.type] || colorMap.KEY_FINDING;

        // Find all text nodes that overlap with this match range
        const affectedNodes = [];
        for (const nm of nodeMap) {
          if (nm.end <= matchIdx || nm.start >= matchEnd) continue;
          affectedNodes.push(nm);
        }
        if (!affectedNodes.length) continue;

        // Single-node match (most common)
        if (affectedNodes.length === 1) {
          const nm = affectedNodes[0];
          const node = nm.node;
          if (!node.parentNode) continue;
          if (node.parentNode.closest && node.parentNode.closest('.aether-annotation')) continue;
          const localIdx = matchIdx - nm.start;
          const nodeText = node.textContent;
          const before = nodeText.substring(0, localIdx);
          const matchText = nodeText.substring(localIdx, localIdx + quote.length);
          const after = nodeText.substring(localIdx + quote.length);

          const mark = document.createElement('mark');
          mark.className = 'aether-annotation';
          mark.style.cssText = 'background:' + c.bg + ';border-bottom:2px solid ' + c.border + ';padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;';
          mark.textContent = matchText;
          mark.addEventListener('mouseover', function() { showTooltip(mark, ann); });
          mark.addEventListener('mouseout', hideTooltip);

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
          // Update nodeMap for subsequent annotations
          const nmIdx = nodeMap.indexOf(nm);
          if (nmIdx !== -1) nodeMap.splice(nmIdx, 1);
          continue;
        }

        // Cross-node match: wrap the matching portion of each node in a mark
        let isFirst = true;
        let wrapMark = null;
        for (const nm of affectedNodes) {
          const node = nm.node;
          if (!node.parentNode) continue;
          const overlapStart = Math.max(matchIdx, nm.start) - nm.start;
          const overlapEnd = Math.min(matchEnd, nm.end) - nm.start;
          const nodeText = node.textContent;
          const before = nodeText.substring(0, overlapStart);
          const matchText = nodeText.substring(overlapStart, overlapEnd);
          const after = nodeText.substring(overlapEnd);

          const mark = document.createElement('mark');
          mark.className = 'aether-annotation';
          mark.style.cssText = 'background:' + c.bg + ';border-bottom:2px solid ' + c.border + ';padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;';
          mark.textContent = matchText;
          if (isFirst) { wrapMark = mark; isFirst = false; }
          mark.addEventListener('mouseover', function() { showTooltip(wrapMark || mark, ann); });
          mark.addEventListener('mouseout', hideTooltip);

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
          const nmIdx = nodeMap.indexOf(nm);
          if (nmIdx !== -1) nodeMap.splice(nmIdx, 1);
        }
      }
    })();
  `;

  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try {
      frame.contentWindow.eval(script);
    } catch { /* cross-origin */ }
  }
}

function clearAnnotations(tab) {
  if (!tab || !tab.el) return;
  if (typeof islandRemove === 'function') islandRemove('annotate');
  const hostTooltip = document.getElementById('aether-annotation-tooltip');
  if (hostTooltip) hostTooltip.remove();
  const frame = tab.el;
  const script = `
    (function() {
      window.__aetherAnnotationsActive = false;
      document.querySelectorAll('mark.aether-annotation').forEach(function(mark) {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
      });
      document.body.normalize();
    })();
  `;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try {
      frame.contentWindow.eval(script);
    } catch { /* cross-origin */ }
  }
}

function scrollToAnnotation(idx) {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.el) return;
  const frame = tab.el;
  const script = `(function() {
    var marks = document.querySelectorAll('mark.aether-annotation');
    var mark = marks[${idx}];
    if (!mark) return;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash effect
    var orig = mark.style.outline;
    mark.style.outline = '2px solid #fff';
    mark.style.outlineOffset = '2px';
    setTimeout(function() { mark.style.outline = orig; mark.style.outlineOffset = ''; }, 1500);
  })()`;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try { frame.contentWindow.eval(script); } catch {}
  }
}

function _updateAnnotateButtonState() {
  const btn = document.getElementById('browse-annotate-btn');
  if (!btn) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const enabled = tab && _annotationsEnabled.get(tab.id);
  btn.classList.toggle('text-accent', !!enabled);
  btn.classList.toggle('text-dimmer', !enabled);
}

