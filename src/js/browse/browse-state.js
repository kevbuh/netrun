// browse-state.js — Shared state for browse module
// All state variables used across browse modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes
import Settings from '/js/core/core-settings.js';

// Window & tab state
export const _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
export const _browseActiveWindow = null;
export const _browseNextWindowId = 1;
export const _browseNextTabId = 1;
export const _browseNextGroupId = 1;

// Group configuration
export const _BROWSE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan'];
export const _BROWSE_GROUP_COLOR_MAP = {
  grey:'#808080', blue:'#5b8def', red:'#e05656', yellow:'#d4a844',
  green:'#4caf50', pink:'#e06090', purple:'#9c6ade', cyan:'#3dc0c0'
};

// Platform detection
export const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);

// Sync initial adblock state to Electron main process
if (_browseIsElectron && window.electronAPI.adblockSetEnabled) {
  window.electronAPI.adblockSetEnabled(Settings.get('adBlockEnabled') === 'true');
}

// Audio tracking: { tabId: { windowId, muted } }
export const _browseAudioTabs = new Map();
export const _pillBrowseMode = false;

// Closed captions state
export const _ccStream = null;
export const _ccSocket = null;
export const _ccAudioCtx = null;
export const _ccWorkletNode = null;
export const _ccActive = false;
export const _ccTabId = null;
export const _ccCaptionLines = [];
export const _ccFadeTimer = null;

// UI state — browseTabLayout is read directly from Settings.get('browseTabLayout')

// NTP uploaded files: { name, content, file }
export const _ntpUploadedFiles = [];

// Closed tabs for Cmd+Shift+T reopen
export const _BROWSE_CLOSED_TABS_MAX = 50;
export const _browseClosedTabs = Settings.getJSON('browseClosedTabs', []);

// Password manager state
export const _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
export const _pwSaveDismissed = new Map(); // 'origin|username' → true
export const _pwLastSubmit = null; // { origin, username, ts } dedup
export const _pwPendingPrompt = null; // { tab, data, ts } — survives navigation

// Split pane state
export const _browseNextPaneId = 1;

// Return view for "back" button — backed by Settings.get('_browseReturnView')

// Convenience getters for current window's tabs (backward compatibility)
// NOTE: read window._browseActiveWindow because other modules assign to it via bare name
// (which updates the window property, not this module's local let)
export function _getCurrentWindow() {
  return _browseWindows.find(w => w.id === window._browseActiveWindow);
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
export function _getBrowseStorageKey(baseKey) {
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.username) || null;
  return username ? `${baseKey}_${username}` : baseKey;
}

// Persistence helpers
export let _browseSaveTabsTimer = 0;

export function _browseSaveTabs() {
  clearTimeout(_browseSaveTabsTimer);
  _browseSaveTabsTimer = setTimeout(_browseSaveTabsNow, 100);
}

export function _browseSaveTabsNow() {
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
      if (t._chatPage) { saved._chatPage = true; if (t._chatThreadId) saved._chatThreadId = t._chatThreadId; }
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
    activeWindow: window._browseActiveWindow,
    nextWindowId: window._browseNextWindowId,
    nextTabId: window._browseNextTabId,
    nextGroupId: window._browseNextGroupId,
    nextPaneId: window._browseNextPaneId
  });
}

window._browseWindows = _browseWindows;
window._browseActiveWindow = _browseActiveWindow;
window._browseNextWindowId = _browseNextWindowId;
window._browseNextTabId = _browseNextTabId;
window._browseNextGroupId = _browseNextGroupId;
window._BROWSE_GROUP_COLORS = _BROWSE_GROUP_COLORS;
window._BROWSE_GROUP_COLOR_MAP = _BROWSE_GROUP_COLOR_MAP;
window._browseIsElectron = _browseIsElectron;
window._browseAudioTabs = _browseAudioTabs;
window._pillBrowseMode = _pillBrowseMode;
window._ccStream = _ccStream;
window._ccSocket = _ccSocket;
window._ccAudioCtx = _ccAudioCtx;
window._ccWorkletNode = _ccWorkletNode;
window._ccActive = _ccActive;
window._ccTabId = _ccTabId;
window._ccCaptionLines = _ccCaptionLines;
window._ccFadeTimer = _ccFadeTimer;
window._ntpUploadedFiles = _ntpUploadedFiles;
window._BROWSE_CLOSED_TABS_MAX = _BROWSE_CLOSED_TABS_MAX;
window._browseClosedTabs = _browseClosedTabs;
window._pwAutofillOffered = _pwAutofillOffered;
window._pwSaveDismissed = _pwSaveDismissed;
window._pwLastSubmit = _pwLastSubmit;
window._pwPendingPrompt = _pwPendingPrompt;
window._browseNextPaneId = _browseNextPaneId;
window._getCurrentWindow = _getCurrentWindow;
window._getBrowseStorageKey = _getBrowseStorageKey;
window._browseSaveTabsTimer = _browseSaveTabsTimer;
window._browseSaveTabs = _browseSaveTabs;
window._browseSaveTabsNow = _browseSaveTabsNow;
