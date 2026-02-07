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

// Audio tracking: { tabId: { windowId, muted } }
let _browseAudioTabs = new Map();
let _pillBrowseMode = false;
const _BROWSE_CLOSED_TABS_MAX = 50;
let _browseClosedTabs = JSON.parse(localStorage.getItem('browseClosedTabs') || '[]'); // stack of { url, title } for Cmd+Shift+T reopen

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

function _browseSaveTabs() {
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
      if (t.paper) { saved.paper = t.paper; saved.contentType = t.contentType; saved.arxivId = t.arxivId || null; }
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
            const tab = { id: saved.id, url: '', title: 'New Tab', favicon: '', el: null, blank: true };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // History page tab — restore as special tab (content renders on select)
          if (saved._historyPage) {
            const tab = { id: saved.id, url: 'aether://history', title: 'History', favicon: '', el: null, blank: false, _historyPage: true };
            if (saved.pinned) tab.pinned = true;
            if (saved.groupId != null) tab.groupId = saved.groupId;
            win.tabs.push(tab);
            continue;
          }
          // Help page tab
          if (saved._helpPage) {
            const tab = { id: saved.id, url: 'aether://help', title: 'Help', favicon: '', el: null, blank: false, _helpPage: true };
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
                          paper: saved.paper, contentType: saved.contentType, arxivId: saved.arxivId || null };
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
          const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false, deferred: shouldDefer };
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

    // Fallback to old single-window format
    raw = localStorage.getItem('browseTabs');
    if (raw) {
      const { tabs, activeTab, nextId } = JSON.parse(raw);
      if (!tabs || !tabs.length) return false;
      _browseNextTabId = nextId || 1;
      const container = document.getElementById('browse-content');
      const win = { id: _browseNextWindowId++, name: 'Window 1', tabs: [], activeTab: null };
      for (const saved of tabs) {
        const el = _browseCreateFrame(saved.id, saved.url);
        el.style.display = 'none';
        container.appendChild(el);
        const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false };
        win.tabs.push(tab);
        _browseBindFrame(tab);
      }
      win.activeTab = win.tabs.find(t => t.id === activeTab) ? activeTab : win.tabs[0]?.id;
      _browseWindows.push(win);
      _browseActiveWindow = win.id;
      if (win.activeTab) browseSelectTab(win.activeTab);
      localStorage.removeItem('browseTabs'); // Migrate to new format
      _browseSaveTabs();
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

function browseRenameWindow(id, name) {
  const win = _browseWindows.find(w => w.id === id);
  if (win) {
    win.name = name;
    _browseSaveTabs();
  }
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
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }

  const offset = direction === 'up' ? '30px' : '-30px';
  const offsetIn = direction === 'up' ? '-30px' : '30px';

  content.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
  content.style.transform = `translateY(${offset})`;
  content.style.opacity = '0';

  setTimeout(() => {
    callback();
    content.style.transition = 'none';
    content.style.transform = `translateY(${offsetIn})`;
    content.style.opacity = '0';

    requestAnimationFrame(() => {
      content.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      content.style.transform = 'translateY(0)';
      content.style.opacity = '1';

      setTimeout(() => {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
      }, 200);
    });
  }, 150);
}

let _browseReturnView = null; // set by openPaper/inbox to enable "back to feed/inbox" button

function _browseGoBack() {
  const nav = { feed: goHome, dashboard: openDashboard, search: openSearch, inbox: typeof openInbox === 'function' ? openInbox : null, calendar: typeof openCalendar === 'function' ? openCalendar : null, settings: typeof openSettings === 'function' ? openSettings : null };
  const fn = nav[_browseReturnView];
  _browseReturnView = null;
  if (fn) fn(); else goHome();
}

function openBrowse(url) {
  const view = document.getElementById('browse-view');
  const alreadyVisible = view && view.style.display === 'flex';

  if (!alreadyVisible) {
    setSidebarLoading('sb-browse');
    hideAllViews();
    view.classList.add('active');
    view.style.display = 'flex';
    view.style.flexDirection = 'column';
    setSidebarActive('sb-browse');
    _setPillBrowseMode(true);

    // Initialize browse sidebar (hidden by default)
    const browseSb = document.getElementById('browse-sidebar');
    if (browseSb) {
      browseSb.innerHTML = _renderSidebarHTML();
      _initSidebar(browseSb);
      browseSb.style.display = 'none';
    }
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
    if (tab && tab.url && !tab.blank) _initSidebarForUrl(tab.url);
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
  // Blank tabs (Cmd+T / button) go to far right; URL tabs go next to current
  if (isBlank) {
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
  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/(abs|pdf)\//.test(url);
  const arxivId = isArxiv ? (paper.arxivId || (url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '') : '';

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-paper-' + id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;overflow:hidden;';
  if (!arxivId) el.style.display = 'none';
  container.appendChild(el);

  const isUpload = paper.source === 'upload';
  const favicon = typeof _browseFaviconUrl === 'function' ? _browseFaviconUrl(url) : '';
  const tab = { id, url, title: paper.title || _browseTitleFromUrl(url), favicon, el, blank: false,
                paper, contentType: (arxivId || isUpload) ? 'pdf' : 'reader', arxivId: arxivId || null };
  if (isUpload && paper.pdfUrl) tab.pdfUrl = paper.pdfUrl;
  const activeIdx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (activeIdx >= 0) win.tabs.splice(activeIdx + 1, 0, tab);
  else win.tabs.push(tab);
  if (url) _saveBrowseVisit(url, tab.title);
  browseSelectTab(id);
  _browseSaveTabs();
  return true;
}

function openLocalPdf(file) {
  const blobUrl = URL.createObjectURL(file);
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const paper = { title: file.name, link: blobUrl, source: 'upload', pdfUrl: blobUrl };
    browseNewPaperTab(blobUrl, paper);
  } else {
    browseNewTab(blobUrl);
    // Update title after tab is created
    const win = _getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(t => t.url === blobUrl);
      if (tab) { tab.title = file.name; _browseRenderTabs(); }
    }
  }
}

function openBrowseWithPaper(url, paper) {
  const view = document.getElementById('browse-view');
  const isAlreadyOpen = view && view.style.display !== 'none' && view.style.display !== '';

  if (!isAlreadyOpen) openBrowse();

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
  // Never proxy blob: or data: URLs
  if (url && (url.startsWith('blob:') || url.startsWith('data:'))) return url;
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
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    tab.blank = false;
    _saveBrowseVisit(e.url, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
  });
  frame.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
  });
  frame.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    // Update the most recent browse history entry with the real title
    if (tab.url) _saveBrowseVisit(tab.url, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
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
    _browseRenderTabs();
    _updateAudioIndicator();
  });
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
      })();
    `).catch(()=>{});

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
    }
  });
}

function _browseBindFrame(tab) {
  if (tab.contentType === 'pdf' || tab.contentType === 'reader') return;
  const el = tab.el;
  if (!el || !_browseIsElectron) return;

  _browseHandleNavigation(tab, el);
  _browseInjectContentScripts(tab, el);
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

function browseSelectTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;

  // Split mode branch: if tab is in a pane, focus it; else replace focused pane
  if (_browseIsSplitMode()) {
    const panes = _browseGetSplitPanes();
    const paneWithTab = panes.find(p => p.tabId === id);
    win.activeTab = id;
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
    if (urlInput) urlInput.value = tab ? (tab.url || '') : '';
    _browseSaveTabs();

    // Handle paper tab in split mode
    if (tab && tab.paper) {
      _currentPaperViewPaper = tab.paper;
      if (tab.contentType === 'pdf' && tab.el && !tab.el.querySelector('.pdf-toolbar')) {
        cleanupPdfViewer();
        const pdfUrl = tab.pdfUrl || ('/api/arxiv-pdf?id=' + encodeURIComponent(tab.arxivId));
        initPdfViewer(tab.el, pdfUrl, tab.arxivId || ('upload-' + tab.id));
      } else if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
        _tryRenderSavedContent(tab.el, tab.paper);
      }
      _browseUpdateBarForTab(tab);
    }
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

  // Clean up PDF viewer when switching away from a PDF tab
  const prevTab = win.tabs.find(t => t.id === win.activeTab);
  if (prevTab && prevTab.contentType === 'pdf' && prevTab.id !== id) {
    cleanupPdfViewer();
  }

  win.activeTab = id;
  const tab = win.tabs.find(t => t.id === id);

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
  if (urlInput) urlInput.value = tab ? (tab._historyPage ? 'aether://history' : tab._helpPage ? 'aether://help' : tab.url) : '';
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  _updateAudioIndicator();

  // Paper tab handling
  if (tab && tab.paper) {
    _currentPaperViewPaper = tab.paper;
    // Render PDF if not yet rendered
    if (tab.contentType === 'pdf' && tab.el && !tab.el.querySelector('.pdf-toolbar')) {
      cleanupPdfViewer();
      const pdfUrl = tab.pdfUrl || ('/api/arxiv-pdf?id=' + encodeURIComponent(tab.arxivId));
      initPdfViewer(tab.el, pdfUrl, tab.arxivId || ('upload-' + tab.id));
    }
    // Render reader/iframe if not yet rendered
    else if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
      _tryRenderSavedContent(tab.el, tab.paper);
    }
    // Update sidebar with paper metadata (only auto-open for arxiv papers)
    const browseSb = document.getElementById('browse-sidebar');
    if (browseSb) {
      browseSb.innerHTML = _renderSidebarHTML(tab.contentType === 'pdf' ? tab.paper : null);
      _initSidebar(browseSb);
      browseSb.style.display = tab.arxivId ? '' : 'none';
    }
    _initSidebarForUrl(tab.url);
    _startScrollTracker(tab.url);
    _browseUpdateBarForTab(tab);
  } else {
    _currentPaperViewPaper = null;
    _browseUpdateBarForTab(tab);
    // Update sidebar for the selected tab
    if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
      _initSidebarForUrl(tab.url);
    }
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
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      ntp = document.createElement('div');
      ntp.className = 'browse-ntp';
      ntp.innerHTML = `<input type="file" id="browse-pdf-file-input" style="display:none">
        <div class="browse-ntp-inner">
          <div class="browse-ntp-center">
            <div class="flex items-center justify-center gap-1 mb-5">
              <button id="research-tab-search" class="research-tab active" onclick="switchResearchTab('search')">
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
            </div>
            <div id="research-panel-search" class="research-panel">
              <form id="search-form" onsubmit="event.preventDefault(); submitSearch()">
                <div class="relative max-w-[680px] mx-auto">
                  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dimmer pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                  <input type="text" id="search-query" placeholder="Search papers..." autocomplete="off" class="w-full pl-9 pr-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.85rem] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all" oninput="onSearchInput()" onfocus="showSearchHistoryView()" onblur="setTimeout(hideSearchHistoryView,150)" onkeydown="_searchHistoryKeydown(event)" />
                  <div id="search-history-dropdown-view" class="hidden absolute left-0 right-0 top-full mt-1 rounded-lg border border-border-input bg-card shadow-lg z-50 overflow-hidden"></div>
                </div>
              </form>
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
        const file = e.dataTransfer.files[0];
        if (file) openLocalPdf(file);
      });
    }
    ntp.style.display = '';
    // Restore active research tab
    switchResearchTab(_researchActiveTab);
  } else if (ntp) {
    ntp.style.display = 'none';
  }
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
  if (tab.contentType === 'pdf') cleanupPdfViewer();
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
  content.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  content.style.transform = 'translateX(-60px) scale(0.97)';
  requestAnimationFrame(() => {
    setTimeout(() => {
      content.style.transform = '';
      setTimeout(() => { content.style.transition = ''; }, 350);
    }, 120);
  });
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
  if (urlInput && tab) {
    urlInput.value = tab._historyPage ? 'aether://history' : tab._helpPage ? 'aether://help' : (tab.url || '');
  }
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

function toggleAllAudio() {
  // Check if all are muted
  const allMuted = [..._browseAudioTabs.values()].every(info => info.muted);
  const newMuted = !allMuted;

  for (const [tabId, info] of _browseAudioTabs) {
    for (const win of _browseWindows) {
      const tab = win.tabs.find(t => t.id === tabId);
      if (tab && tab.el && _browseIsElectron) {
        tab.el.setAudioMuted(newMuted);
        info.muted = newMuted;
        _browseAudioTabs.set(tabId, info);
      }
    }
  }
  _browseRenderTabs();
  _updateAudioIndicator();
}

function _updateAudioIndicator() {
  let indicator = document.getElementById('audio-indicator');

  if (_browseAudioTabs.size === 0) {
    if (indicator) indicator.style.display = 'none';
    return;
  }

  // Create indicator if it doesn't exist
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'audio-indicator';
    indicator.className = 'audio-indicator';
    document.body.appendChild(indicator);
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
    indicator.style.display = 'none';
    return;
  }

  // Hide if we're already on this tab in the browse view
  const browseView = document.getElementById('browse-view');
  const isOnBrowseView = browseView && browseView.style.display !== 'none';
  const isCurrentTab = isOnBrowseView &&
    firstTab.win.id === _browseActiveWindow &&
    firstTab.tab.id === firstTab.win.activeTab;

  if (isCurrentTab) {
    indicator.style.display = 'none';
    return;
  }

  const allMuted = playingTabs.every(p => p.muted);

  indicator.innerHTML = `
    <button class="audio-indicator-icon" onclick="toggleAllAudio()" title="${allMuted ? 'Unmute audio' : 'Mute audio'}">
      <svg class="w-4 h-4 ${allMuted ? '' : 'audio-playing'}" fill="currentColor" viewBox="0 0 24 24">
        ${allMuted
          ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
          : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'}
      </svg>
    </button>
    <button class="audio-indicator-title-btn" onclick="goToAudioTab()" title="Go to tab">
      ${escapeHtml(firstTab.tab.title.slice(0, 25) || 'Audio')}
    </button>
  `;

  indicator.style.display = 'flex';
}

function _browseRenderTabHtml(t, activeTab) {
  const active = t.id === activeTab;
  const hasAudio = _browseAudioTabs.has(t.id);
  const audioInfo = _browseAudioTabs.get(t.id);
  const isMuted = audioInfo?.muted;
  const title = escapeHtml(t.title);
  const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : '';
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
    const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : '';
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

function _browseRenderTabs() {
  const bar = document.getElementById('browse-tabs');
  if (!bar) return;
  const win = _getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const groups = win ? (win.groups || []) : [];

  // Window switcher (if multiple windows)
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

  // Build pinned section
  let html = windowSelector;
  html += pinned.map(t => _browseRenderTabHtml(t, activeTab)).join('');
  if (pinned.length > 0 && unpinned.length > 0) {
    html += '<div class="browse-tab-pin-separator"></div>';
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
    html += `<div class="browse-tab-group-chip" style="--group-color:${gc}" data-group-id="${gid}" onclick="_browseToggleGroupCollapse(${gid})" oncontextmenu="event.preventDefault();_browseShowGroupContextMenu(event,${gid})">
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
          html += _browseRenderTabHtml(t, activeTab);
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
      html += _browseRenderTabHtml(t, activeTab);
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

  // Attach tab drag-to-reorder handlers + hover tooltips
  bar.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
    tabEl.addEventListener('mouseenter', _browseTabHoverIn);
    tabEl.addEventListener('mouseleave', _browseTabHoverOut);
  });
  // Attach hover tooltips to split pill inner tabs
  bar.querySelectorAll('.browse-split-pill-tab').forEach(tabEl => {
    tabEl.addEventListener('mouseenter', _browseTabHoverIn);
    tabEl.addEventListener('mouseleave', _browseTabHoverOut);
  });
  // Attach drag handler on the split pill (handles reorder + unsplit + click-to-focus)
  bar.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });

  // Mirror tabs into the pill bar if in browse mode
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
        ghost.style.transition = 'opacity 0.15s, transform 0.15s';
        ghost.style.opacity = '0';
        ghost.style.transform = 'scale(0.9)';
        setTimeout(() => ghost.remove(), 150);
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

function _browseTabHoverIn(e) {
  const tabEl = e.currentTarget;
  clearTimeout(_tabHoverTimeout);
  clearTimeout(_tabHoverDismissTimeout);
  if (document.getElementById('doc-chat-ask-float')) return;
  _tabHoverTimeout = setTimeout(() => _showTabTooltip(tabEl), 400);
}

function _browseTabHoverOut(e) {
  clearTimeout(_tabHoverTimeout);
  const panel = document.getElementById('doc-chat-ask-float');
  if (e && e.relatedTarget && panel && panel.contains(e.relatedTarget)) return;
  clearTimeout(_tabHoverDismissTimeout);
  _tabHoverDismissTimeout = setTimeout(() => {
    const p = document.getElementById('doc-chat-ask-float');
    if (p && p.classList.contains('tab-context-panel')) p.remove();
  }, 150);
}

function _showTabTooltip(tabEl) {
  if (typeof _showTabContextMenu === 'function') {
    _showTabContextMenu(null, tabEl);
  }
}

// ── Tab drag-to-reorder ──

let _tabDragState = null;
const TAB_DRAG_THRESHOLD = 5;

function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  let tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    // Fallback: parse from onclick
    const onclickAttr = tabEl.getAttribute('onclick') || '';
    const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId, startX: e.clientX, startY: e.clientY, tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false };
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

  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    // Prevent the onclick from firing
    _tabDragState.tabEl.style.pointerEvents = 'none';
    // Create ghost
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add('browse-tab-drag-source');
    // Create insertion indicator
    const indicator = document.createElement('div');
    indicator.className = 'browse-tab-insert-indicator';
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
  _tabDragUpdatePosition(e.clientX);
}

function _tabDragUpdatePosition(clientX) {
  if (!_tabDragState || !_tabDragState.indicator) return;
  const bar = _getActiveTabBar();
  if (!bar) return;
  const win = _getCurrentWindow();
  const dragTab = win ? win.tabs.find(t => t.id === _tabDragState.tabId) : null;
  const isDragPinned = dragTab && dragTab.pinned;

  // Only allow dragging among same region (pinned <-> pinned, unpinned <-> unpinned)
  const allTabEls = Array.from(bar.querySelectorAll('.browse-tab'));
  const tabs = allTabEls.filter(t => {
    const isPinned = t.classList.contains('browse-tab-pinned');
    return isDragPinned ? isPinned : !isPinned;
  });

  let insertBeforeId = null;
  let indicatorLeft = null;
  const barRect = bar.getBoundingClientRect();

  for (const t of tabs) {
    const rect = t.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) {
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

function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const { tabId, hasMoved, insertBeforeId, ghostEl, indicator, tabEl, _origOnclick } = _tabDragState;
  _tabDragState = null;

  // Clean up visual elements
  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove('browse-tab-drag-source');
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
let _overviewSelectedIdx = 0;
let _overviewKeyHandler = null;
let _overviewBrowseExpanded = false;
let _overviewBrowseWinIdx = 0;  // selected window in expanded view
let _overviewBrowseTabIdx = -1; // -1 = window row selected, >=0 = tab within window

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
        var tab = { id: st.id, url: st.url || '', title: st.title || 'New Tab', favicon: st.url ? _browseFaviconUrl(st.url) : '', el: null, blank: !!st.blank };
        if (st.pinned) tab.pinned = true;
        if (st.groupId != null) tab.groupId = st.groupId;
        if (st.paper) { tab.paper = st.paper; tab.contentType = st.contentType; }
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
  // Ensure browse windows are loaded even if Browse view hasn't been opened
  if (!_browseWindows.length) _browseRestoreTabsLite();
  // Capture a fresh snapshot of the current view before showing the overview
  var curKey = _wmWindows[_wmFocusIndex] && _wmWindows[_wmFocusIndex].key;
  if (curKey) _wmCaptureSnapshot(curKey);
  _browseTabOverviewVisible = true;
  _overviewBrowseExpanded = false;
  _overviewSelectedIdx = Math.max(0, Math.min(_wmFocusIndex, _wmWindows.length - 1));
  _renderWindowOverview();
  overlay.style.display = 'flex';
  _installOverviewKeyHandler();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });
}

function hideBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _browseTabOverviewVisible = false;
  _overviewBrowseExpanded = false;
  _removeOverviewKeyHandler();
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.style.display = 'none'; }, 180);
}

function _installOverviewKeyHandler() {
  if (_overviewKeyHandler) return;
  _overviewKeyHandler = (e) => {
    if (!_browseTabOverviewVisible) return;

    if (_overviewBrowseExpanded) {
      // ── Browse detail mode ──
      var winCount = _browseWindows.length;
      var curWin = _browseWindows[_overviewBrowseWinIdx];
      var tabCount = curWin ? curWin.tabs.length : 0;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_overviewBrowseTabIdx >= 0) {
          _overviewBrowseTabIdx--;
        } else {
          // Already at window header — collapse back to app strip
          _overviewBrowseExpanded = false;
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
        if (_overviewBrowseWinIdx > 0) {
          _overviewBrowseWinIdx--;
          _overviewBrowseTabIdx = -1;
          _renderWindowOverview();
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (_overviewBrowseWinIdx < winCount - 1) {
          _overviewBrowseWinIdx++;
          _overviewBrowseTabIdx = -1;
          _renderWindowOverview();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (curWin) {
          if (_overviewBrowseTabIdx >= 0) {
            var tab = curWin.tabs[_overviewBrowseTabIdx];
            if (tab) { browseSelectWindow(curWin.id); browseSelectTab(tab.id); }
          } else {
            browseSelectWindow(curWin.id);
          }
          hideBrowseTabOverview();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _overviewBrowseExpanded = false;
        _renderWindowOverview();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && _overviewBrowseTabIdx === -1 && winCount > 1) {
        e.preventDefault();
        if (curWin) browseCloseWindow(curWin.id);
        if (_overviewBrowseWinIdx >= _browseWindows.length) _overviewBrowseWinIdx = _browseWindows.length - 1;
        _renderWindowOverview();
      }
      return;
    }

    // ── Top-level app strip mode ──
    var total = _wmWindows.length;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (_overviewSelectedIdx > 0) _overviewSelectedIdx--;
      _updateOverviewHighlight();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (_overviewSelectedIdx < total - 1) _overviewSelectedIdx++;
      _updateOverviewHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var w = _wmWindows[_overviewSelectedIdx];
      if (!w) return;
      wmOpen(w.key);
      hideBrowseTabOverview();
    } else if (e.key === 'ArrowDown') {
      // If on browse, expand
      var wDown = _wmWindows[_overviewSelectedIdx];
      if (wDown && wDown.key === 'browse') {
        e.preventDefault();
        _overviewBrowseExpanded = true;
        _overviewBrowseWinIdx = Math.max(0, _browseWindows.findIndex(function(bw) { return bw.id === _browseActiveWindow; }));
        _overviewBrowseTabIdx = -1;
        _renderWindowOverview();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideBrowseTabOverview();
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
  if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function _renderWindowOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;

  // App strip cards
  var appHtml = '';
  for (var i = 0; i < _wmWindows.length; i++) {
    var w = _wmWindows[i];
    var isActive = i === _wmFocusIndex;
    var isSelected = !_overviewBrowseExpanded && i === _overviewSelectedIdx;
    var isBrowseOpen = _overviewBrowseExpanded && w.key === 'browse';
    var icon = _wovAppIcons[w.key] || '';
    var snap = _wmSnapshots[w.key];
    appHtml += '<div class="wov-card wov-card-app ' + (isActive ? 'wov-active ' : '') + (isSelected ? 'wov-selected ' : '') + (isBrowseOpen ? 'wov-expanded ' : '') + '"'
      + ' onclick="_overviewClickApp(\'' + w.key + '\')">';
    if (snap) {
      appHtml += '<div class="wov-card-preview" style="background-image:url(' + snap + ')"></div>';
    } else {
      appHtml += '<div class="wov-card-preview wov-card-preview-empty">' + icon + '</div>';
    }
    appHtml += '<div class="wov-card-info">'
      + '<div class="wov-card-icon">' + icon + '</div>'
      + '<span class="wov-card-name">' + escapeHtml(w.label) + '</span>'
      + '</div></div>';
  }

  // Browse window cards (when expanded) — each window is its own card
  var detailHtml = '';
  if (_overviewBrowseExpanded) {
    detailHtml = '<div class="wov-browse-row">';
    for (var wi = 0; wi < _browseWindows.length; wi++) {
      var bw = _browseWindows[wi];
      var bwActive = bw.id === _browseActiveWindow;
      var isCurWin = wi === _overviewBrowseWinIdx;

      detailHtml += '<div class="wov-win-card ' + (bwActive ? 'wov-win-active ' : '') + (isCurWin ? 'wov-win-focus ' : '') + '">';

      // Window header
      detailHtml += '<div class="wov-win-header ' + (isCurWin && _overviewBrowseTabIdx === -1 ? 'wov-selected ' : '') + '"'
        + ' onclick="_overviewClickBrowseWin(' + bw.id + ')">'
        + '<span class="wov-win-name">' + escapeHtml(bw.name) + '</span>'
        + '<span class="wov-win-count">' + bw.tabs.length + '</span>'
        + (_browseWindows.length > 1 ? '<button class="wov-win-close" onclick="event.stopPropagation();_overviewCloseBrowseWin(' + bw.id + ')">&times;</button>' : '')
        + '</div>';

      // Tabs
      for (var ti = 0; ti < bw.tabs.length; ti++) {
        var tab = bw.tabs[ti];
        var tabSelected = isCurWin && ti === _overviewBrowseTabIdx;
        var tabIsActive = bwActive && tab.id === bw.activeTab;
        var fav = tab.favicon
          ? '<img src="' + escapeHtml(tab.favicon) + '" class="wov-bt-fav" onerror="this.style.display=\'none\'">'
          : '<span class="wov-bt-dot"></span>';
        detailHtml += '<div class="wov-bt ' + (tabSelected ? 'wov-selected ' : '') + (tabIsActive ? 'wov-bt-active ' : '') + '"'
          + ' onclick="_overviewClickBrowseTab(' + bw.id + ',' + tab.id + ')">'
          + fav
          + '<span class="wov-bt-title">' + escapeHtml(tab.title || 'New Tab') + '</span>'
          + '</div>';
      }

      detailHtml += '</div>';
    }
    detailHtml += '</div>';
  }

  overlay.innerHTML = appHtml + detailHtml;

  // Scroll selected item into view in expanded mode
  if (_overviewBrowseExpanded) {
    var sel = overlay.querySelector('.wov-selected');
    if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

function _overviewClickApp(key) {
  if (key === 'browse') {
    _overviewBrowseExpanded = !_overviewBrowseExpanded;
    if (_overviewBrowseExpanded) {
      _overviewBrowseWinIdx = Math.max(0, _browseWindows.findIndex(function(bw) { return bw.id === _browseActiveWindow; }));
      _overviewBrowseTabIdx = -1;
    }
    // Update selected index to browse
    for (var i = 0; i < _wmWindows.length; i++) {
      if (_wmWindows[i].key === 'browse') { _overviewSelectedIdx = i; break; }
    }
    _renderWindowOverview();
    return;
  }
  wmOpen(key);
  hideBrowseTabOverview();
}

function _overviewClickBrowseWin(windowId) {
  browseSelectWindow(windowId);
  hideBrowseTabOverview();
}

function _overviewClickBrowseTab(windowId, tabId) {
  browseSelectWindow(windowId);
  browseSelectTab(tabId);
  hideBrowseTabOverview();
}

function _overviewCloseBrowseWin(windowId) {
  browseCloseWindow(windowId);
  if (_browseWindows.length === 0) {
    _overviewBrowseExpanded = false;
    _renderWindowOverview();
    return;
  }
  if (_overviewBrowseWinIdx >= _browseWindows.length) _overviewBrowseWinIdx = _browseWindows.length - 1;
  _overviewBrowseTabIdx = -1;
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

function _browseTitleFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
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
  // arXiv URL → open as paper tab
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  if (arxivMatch) {
    browseNewPaperTab(url, { title: 'arXiv: ' + arxivMatch[1], link: url, source: 'arxiv', arxivId: arxivMatch[1], description: '', authors: '', categories: [] });
    return;
  }
  // Local/blob PDF → open in PDF viewer
  if (/\.pdf$/i.test(url) && /^(file|blob):/.test(url)) {
    const name = url.split('/').pop().replace(/\.pdf$/i, '') || 'Local PDF';
    const pdfUrl = url.startsWith('file://') ? '/api/local-file?path=' + encodeURIComponent(url.replace(/^file:\/\//, '')) : url;
    const paper = { title: decodeURIComponent(name), link: url, source: 'upload', pdfUrl };
    browseNewPaperTab(url, paper);
    return;
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
  if (urlInput) urlInput.value = url;
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
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(input.replace(/\s+/g, ''))) return 'https://' + input.replace(/\s+/g, '');
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function _browseActiveEl() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  return tab ? tab.el : null;
}

// Hide/restore active webview so DOM popups can render on top (Electron GPU compositing fix)
function _browseHideActiveWebview() {
  const el = _browseActiveEl();
  if (el && el.tagName === 'WEBVIEW') el.style.visibility = 'hidden';
}
function _browseRestoreActiveWebview() {
  const el = _browseActiveEl();
  if (el && el.tagName === 'WEBVIEW') el.style.visibility = '';
}

function browseBack() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoBack && el.canGoBack()) { el.goBack(); return; }
  // Use our own history stack for non-Electron (cross-origin iframes block history.back())
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.backStack || !tab.backStack.length) return;
  if (!tab.forwardStack) tab.forwardStack = [];
  tab.forwardStack.push(tab.url);
  const prevUrl = tab.backStack.pop();
  tab.url = prevUrl;
  tab.title = _browseTitleFromUrl(prevUrl);
  tab.favicon = _browseFaviconUrl(prevUrl);
  _browseSetFrameAllow(el, prevUrl);
  const proxied = _browseProxyUrl(prevUrl);
  el.dataset.originalUrl = prevUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = prevUrl;
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
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
  if (urlInput) urlInput.value = nextUrl;
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
    el.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = '';
    var container = document.getElementById('browse-content');
    if (container) container.style.overflow = '';
    setTimeout(function() {
      el.style.transition = '';
      el.style.transformOrigin = '';
    }, 360);
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
  else if (e.key === 'f') { e.preventDefault(); _browseToggleFindBar(); }
  else if (e.key === ']') { e.preventDefault(); if (typeof toggleBrowseSidebar === 'function') toggleBrowseSidebar(); }
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
    } else if (e.key === 'Escape') {
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
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }

  const offset = direction === 'left' ? '30px' : '-30px';
  const offsetIn = direction === 'left' ? '-30px' : '30px';

  content.style.transition = 'transform 0.12s ease-out, opacity 0.12s ease-out';
  content.style.transform = `translateX(${offset})`;
  content.style.opacity = '0.5';

  setTimeout(() => {
    callback();
    content.style.transition = 'none';
    content.style.transform = `translateX(${offsetIn})`;

    requestAnimationFrame(() => {
      content.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
      content.style.transform = 'translateX(0)';
      content.style.opacity = '1';

      setTimeout(() => {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
      }, 150);
    });
  }, 120);
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
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:auto;';
  container.appendChild(overlay);

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
    } else {
      // Normal scroll: let it pass through to the iframe
      overlay.style.pointerEvents = 'none';
      setTimeout(function() { overlay.style.pointerEvents = 'auto'; }, 60);
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
  }, { passive: false });
  overlay.addEventListener('gestureend', function(e) {
    e.preventDefault();
  }, { passive: false });

  // Forward clicks/mousedown to elements underneath
  function _pinchPassthrough(e) {
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';
    if (el && el !== overlay) {
      if (e.type === 'click') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent(e.type, e));
      }
    }
  }
  overlay.addEventListener('mousedown', _pinchPassthrough);
  overlay.addEventListener('click', _pinchPassthrough);
  overlay.addEventListener('dblclick', _pinchPassthrough);
  // After mousedown, keep overlay transparent so drag/select works in iframe
  overlay.addEventListener('mousedown', function() {
    overlay.style.pointerEvents = 'none';
    function _restore() { overlay.style.pointerEvents = 'auto'; document.removeEventListener('mouseup', _restore); }
    document.addEventListener('mouseup', _restore);
  });
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
    if (btn && typeof _showBookmarkToast === 'function') {
      const r = btn.getBoundingClientRect();
      _showBookmarkToast({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
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
  if (!btn) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const saved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', saved ? 'var(--accent)' : 'none');
    svg.setAttribute('stroke', saved ? 'var(--accent)' : 'currentColor');
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
function _saveWindowAsSession(windowId) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return;

  const tabs = win.tabs.filter(t => !t.blank && t.url);
  if (!tabs.length) return;

  // Find the window section and show inline input
  const section = document.querySelector(`.browse-window-section[onclick*="${windowId}"]`);
  if (!section) return;

  const header = section.querySelector('.browse-window-header');
  if (!header) return;

  // Create input row
  const inputRow = document.createElement('div');
  inputRow.className = 'browse-window-save-input';
  inputRow.innerHTML = `
    <input type="text" placeholder="Session name..." value="${escapeHtml(win.name)}" autofocus>
    <button class="save-confirm">Save</button>
    <button class="save-cancel">&times;</button>
  `;
  header.after(inputRow);

  const input = inputRow.querySelector('input');
  const confirmBtn = inputRow.querySelector('.save-confirm');
  const cancelBtn = inputRow.querySelector('.save-cancel');

  input.focus();
  input.select();

  const doSave = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const sessions = _getTabSessions();
    sessions.unshift({
      name,
      tabs: tabs.map(t => ({ url: t.url, title: t.title })),
      savedAt: Date.now()
    });
    _saveTabSessions(sessions);
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
  input.onclick = (e) => e.stopPropagation();
}

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

  // Build overflow rows for buttons hidden in the bar
  let overflowRows = '';
  const overflowIds = typeof getBarOverflowIds === 'function' ? getBarOverflowIds() : [];
  overflowIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = el.title || id;
    const svgEl = el.querySelector('svg');
    let icon = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';
    const btnStyle = `width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;`;

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
    <button onclick="location.hash='#settings';document.getElementById('browse-more-menu').style.display='none';" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
      Settings
    </button>`;

  const btnRect = document.getElementById('browse-more-btn').getBoundingClientRect();
  dd.innerHTML = `<div style="position:fixed;right:${Math.round(window.innerWidth - btnRect.right)}px;top:${Math.round(btnRect.bottom + 4)}px;min-width:180px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">
    ${overflowRows}${fixedItems}
  </div>`;
  dd.style.display = '';

  // Set up long-press drag on overflow items to drag back to bar
  _setupOverflowDrag(dd);

  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]')) {
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

  // PDF tabs — use print preview directly
  if (tab && tab.contentType === 'pdf' && typeof showPrintPreview === 'function' && _pdfDoc) {
    showPrintPreview();
    return;
  }

  const el = _browseActiveEl();
  if (!el) return;

  if (_browseIsElectron && el.printToPDF) {
    const title = 'Print — ' + ((tab && tab.title) || 'Page');
    el.printToPDF({ printBackground: true }).then(buf => {
      const blob = new Blob([buf], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const paper = { title, link: blobUrl, source: 'upload', pdfUrl: blobUrl };
      browseNewPaperTab(blobUrl, paper);
      // After the PDF tab loads, show print preview
      setTimeout(() => { if (typeof showPrintPreview === 'function' && _pdfDoc) showPrintPreview(); }, 1500);
    }).catch(() => { el.print(); });
  } else {
    try { el.contentWindow.print(); } catch (e) {
      // Cross-origin iframe — open in new tab so user can print from there
      if (tab && tab.url) window.open(tab.url, '_blank');
    }
  }
}

function browseEnableNoteMode() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;

  // Already a paper tab — just show sidebar
  if (tab.contentType) {
    togglePaperSidebar();
    return;
  }

  // Convert current iframe tab into a paper tab with reader view
  const isArxiv = /arxiv\.org\/(abs|pdf)\//.test(tab.url);
  const arxivId = isArxiv ? (tab.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '' : '';
  tab.paper = {
    title: tab.title || _browseTitleFromUrl(tab.url),
    link: tab.url,
    description: '',
    authors: '',
    categories: [],
    source: isArxiv ? 'arxiv' : 'browse',
    arxivId: arxivId
  };
  tab.contentType = arxivId ? 'pdf' : 'reader';
  tab.arxivId = arxivId || null;

  // Replace iframe with a container div
  if (tab.el) tab.el.remove();
  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-paper-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow:hidden;';
  container.appendChild(el);
  tab.el = el;

  // Re-select to trigger paper rendering
  browseSelectTab(tab.id);
  _browseSaveTabs();
}

// ── Dynamic Island pill bar — browse mode ──

function _getActiveTabBar() {
  return _pillBrowseMode
    ? document.getElementById('pill-browse-tabs')
    : document.getElementById('browse-tabs');
}

function _setPillBrowseMode(enabled) {
  _pillBrowseMode = enabled;
  const pill = document.getElementById('sidebar-nav');
  const tabRow = document.getElementById('browse-tab-row');
  const dragPill = document.getElementById('drag-pill');
  if (enabled) {
    if (pill) pill.classList.add('browse-mode');
    if (tabRow) tabRow.style.display = 'none';
    if (dragPill) dragPill.style.display = 'none';
    _pillSyncTabs();
  } else {
    if (pill) pill.classList.remove('browse-mode');
    if (tabRow) tabRow.style.display = '';
    if (dragPill) dragPill.style.display = '';
    const pillTabs = document.getElementById('pill-browse-tabs');
    if (pillTabs) pillTabs.innerHTML = '';
    _closePillMenu();
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
    tabEl.addEventListener('mouseenter', _browseTabHoverIn);
    tabEl.addEventListener('mouseleave', _browseTabHoverOut);
  });
  pillTabs.querySelectorAll('.browse-split-pill-tab').forEach(tabEl => {
    tabEl.addEventListener('mouseenter', _browseTabHoverIn);
    tabEl.addEventListener('mouseleave', _browseTabHoverOut);
  });
  pillTabs.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });
}

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

