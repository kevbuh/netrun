// browse-state.js — Shared state for browse module
// All state variables used across browse modules

// Window & tab state
const _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
const _browseActiveWindow = null;
const _browseNextWindowId = 1;
const _browseNextTabId = 1;
const _browseNextGroupId = 1;

// Group configuration
const _BROWSE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan'];
const _BROWSE_GROUP_COLOR_MAP = {
  grey:'#808080', blue:'#5b8def', red:'#e05656', yellow:'#d4a844',
  green:'#4caf50', pink:'#e06090', purple:'#9c6ade', cyan:'#3dc0c0'
};

// Platform detection
const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);

// Sync initial adblock state to Electron main process
if (_browseIsElectron && window.electronAPI.adblockSetEnabled) {
  window.electronAPI.adblockSetEnabled(localStorage.getItem('adBlockEnabled') === 'true');
}

// Audio tracking: { tabId: { windowId, muted } }
const _browseAudioTabs = new Map();
const _pillBrowseMode = false;

// Closed captions state
const _ccStream = null;
const _ccSocket = null;
const _ccAudioCtx = null;
const _ccWorkletNode = null;
const _ccActive = false;
const _ccTabId = null;
const _ccCaptionLines = [];
const _ccFadeTimer = null;

// UI state
const _browseTabLayout = localStorage.getItem('browseTabLayout') || 'island';

// NTP uploaded files: { name, content, file }
const _ntpUploadedFiles = [];

// Closed tabs for Cmd+Shift+T reopen
const _BROWSE_CLOSED_TABS_MAX = 50;
const _browseClosedTabs = JSON.parse(localStorage.getItem('browseClosedTabs') || '[]');

// Password manager state
const _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
const _pwSaveDismissed = new Map(); // 'origin|username' → true
const _pwLastSubmit = null; // { origin, username, ts } dedup
const _pwPendingPrompt = null; // { tab, data, ts } — survives navigation

// Split pane state
const _browseNextPaneId = 1;

// Return view for "back" button
let _browseReturnView = localStorage.getItem('_browseReturnView') || null;

// Overview visibility flag
const _browseTabOverviewVisible = false;

// Convenience getters for current window's tabs (backward compatibility)
function _getCurrentWindow() {
  return _browseWindows.find(w => w.id === _browseActiveWindow);
}

Object.defineProperty(window, '_browseTabs', {
  get() { const w = _getCurrentWindow(); return w ? w.tabs : []; },
  set(v) { const w = _getCurrentWindow(); if (w) w.tabs = v; }
});

Object.defineProperty(window, '_browseActiveTab', {
  get() { const w = _getCurrentWindow(); return w ? w.activeTab : null; },
  set(v) { const w = _getCurrentWindow(); if (w) w.activeTab = v; }
});

// Storage key helper (user-specific)
function _getBrowseStorageKey(baseKey) {
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.username) || null;
  return username ? `${baseKey}_${username}` : baseKey;
}

// Persistence helpers
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
      if (t.backStack && t.backStack.length) saved.backStack = t.backStack.slice(-50);
      if (t.forwardStack && t.forwardStack.length) saved.forwardStack = t.forwardStack.slice(-50);
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

function _setBrowseReturnView(view) {
  _browseReturnView = view;
  if (view) localStorage.setItem('_browseReturnView', view);
  else localStorage.removeItem('_browseReturnView');
}
