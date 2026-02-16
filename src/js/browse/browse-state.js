// browse-state.js — Shared state for browse module
// All state variables used across browse modules

// Initialize AetherUI globals for reactive state
if (typeof window.AetherUI !== 'undefined') {
  const { State, Computed, Effect, batch } = window.AetherUI;
  window._AetherBrowseState = { State, Computed, Effect, batch };
}

// Window & tab state
let _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
let _browseActiveWindow = null;
let _browseNextWindowId = 1;
let _browseNextTabId = 1;
let _browseNextGroupId = 1;

// ─────────────────────────────────────────────────────────────
// Reactive state layer (Phase 2)
// ─────────────────────────────────────────────────────────────
let $browseWindows = null;
let $browseActiveWindow = null;
let $currentWindow = null;
let $currentTabs = null;
let $activeTab = null;

function _initBrowseReactiveState() {
  if (!window._AetherBrowseState) return;

  const { State, Computed } = window._AetherBrowseState;

  // Initialize reactive signals
  $browseWindows = State(_browseWindows);
  $browseActiveWindow = State(_browseActiveWindow);

  // Computed derived state
  $currentWindow = Computed(() =>
    $browseWindows.value?.find(w => w?.id === $browseActiveWindow.value) || null
  );

  $currentTabs = Computed(() => $currentWindow.value?.tabs || []);

  $activeTab = Computed(() => $currentWindow.value?.activeTab || null);
}

// Initialize on load if AetherUI is available
if (typeof window.AetherUI !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initBrowseReactiveState);
} else if (typeof window.AetherUI !== 'undefined') {
  _initBrowseReactiveState();
}

/**
 * Update browse state reactively
 * Usage: _updateBrowseState(() => { _browseWindows.push(newWindow); });
 */
function _updateBrowseState(fn) {
  if (!window._AetherBrowseState) {
    fn(); // Fallback: no reactivity
    return;
  }

  const { batch } = window._AetherBrowseState;
  batch(() => {
    fn(); // Mutate the legacy state vars
    // Update signals to trigger reactive updates
    if ($browseWindows) $browseWindows.value = [..._browseWindows];
    if ($browseActiveWindow) $browseActiveWindow.value = _browseActiveWindow;
  });
}

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

// UI state
let _browseTabLayout = localStorage.getItem('browseTabLayout') || 'island';

// NTP uploaded files: { name, content, file }
let _ntpUploadedFiles = [];

// Closed tabs for Cmd+Shift+T reopen
const _BROWSE_CLOSED_TABS_MAX = 50;
let _browseClosedTabs = JSON.parse(localStorage.getItem('browseClosedTabs') || '[]');

// Password manager state
let _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
let _pwSaveDismissed = new Map(); // 'origin|username' → true
let _pwLastSubmit = null; // { origin, username, ts } dedup
let _pwPendingPrompt = null; // { tab, data, ts } — survives navigation

// Split pane state
let _browseNextPaneId = 1;

// Return view for "back" button
let _browseReturnView = localStorage.getItem('_browseReturnView') || null;

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
