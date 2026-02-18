// browse-state.js — Shared state for browse module
// All state variables used across browse modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

// Window & tab state
let _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
let _browseActiveWindow = null;
let _browseNextWindowId = 1;
let _browseNextTabId = 1;
let _browseNextGroupId = 1;

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
  window.electronAPI.adblockSetEnabled(Settings.get('adBlockEnabled') === 'true');
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

// UI state — browseTabLayout is read directly from Settings.get('browseTabLayout')

// NTP uploaded files: { name, content, file }
let _ntpUploadedFiles = [];

// Closed tabs for Cmd+Shift+T reopen
const _BROWSE_CLOSED_TABS_MAX = 50;
let _browseClosedTabs = Settings.getJSON('browseClosedTabs', []);

// Password manager state
let _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
let _pwSaveDismissed = new Map(); // 'origin|username' → true
let _pwLastSubmit = null; // { origin, username, ts } dedup
let _pwPendingPrompt = null; // { tab, data, ts } — survives navigation

// Split pane state
let _browseNextPaneId = 1;

// Return view for "back" button — backed by Settings.get('_browseReturnView')

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
  Settings.setJSON(_getBrowseStorageKey('browseWindows'), {
    windows: data,
    activeWindow: _browseActiveWindow,
    nextWindowId: _browseNextWindowId,
    nextTabId: _browseNextTabId,
    nextGroupId: _browseNextGroupId,
    nextPaneId: _browseNextPaneId
  });
}

