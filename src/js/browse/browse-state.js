// browse-state.js — Shared state for browse module
// All state variables used across browse modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI window.State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes
import { State } from '/aether/ui/state.js';
import Settings from '/js/core/core-settings.js';

// ── Helper: bridge a local var to window via getter/setter ──
function _bridge(name, get, set) {
  Object.defineProperty(window, name, { get, set, configurable: true, enumerable: true });
}

// Window & tab state  @signal (_browseActiveWindow drives tab UI)
export const _browseWindows = []; // { id, name, tabs: [], activeTab, groups: [] }
export var _browseActiveWindow = State(null);
let _browseNextWindowId = 1;
let _browseNextTabId = 1;
let _browseNextGroupId = 1;

export function getBrowseActiveWindow() { return _browseActiveWindow.value; }
export function setBrowseActiveWindow(v) { _browseActiveWindow.value = v; }
export function getBrowseNextWindowId() { return _browseNextWindowId; }
export function setBrowseNextWindowId(v) { _browseNextWindowId = v; }
export function getBrowseNextTabId() { return _browseNextTabId; }
export function setBrowseNextTabId(v) { _browseNextTabId = v; }
export function getBrowseNextGroupId() { return _browseNextGroupId; }
export function setBrowseNextGroupId(v) { _browseNextGroupId = v; }

window._browseWindows = _browseWindows;
_bridge('_browseActiveWindow', () => _browseActiveWindow.value, v => { _browseActiveWindow.value = v; });
_bridge('_browseNextWindowId', () => _browseNextWindowId, v => { _browseNextWindowId = v; });
_bridge('_browseNextTabId', () => _browseNextTabId, v => { _browseNextTabId = v; });
_bridge('_browseNextGroupId', () => _browseNextGroupId, v => { _browseNextGroupId = v; });

// Group configuration
export const _BROWSE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan'];
export const _BROWSE_GROUP_COLOR_MAP = {
  grey:'#808080', blue:'#5b8def', red:'#e05656', yellow:'#d4a844',
  green:'#4caf50', pink:'#e06090', purple:'#9c6ade', cyan:'#3dc0c0'
};
window._BROWSE_GROUP_COLORS = _BROWSE_GROUP_COLORS;
window._BROWSE_GROUP_COLOR_MAP = _BROWSE_GROUP_COLOR_MAP;

// Platform detection
export const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);
window._browseIsElectron = _browseIsElectron;

// Sync initial adblock state to Electron main process
if (_browseIsElectron && window.electronAPI.adblockSetEnabled) {
  window.electronAPI.adblockSetEnabled(Settings.get('adBlockEnabled') === 'true');
}

// Sync DoH state to main process
if (_browseIsElectron && window.electronAPI.dohSetConfig) {
  window.electronAPI.dohSetConfig(
    Settings.get('dohEnabled') !== 'false',
    Settings.get('dohProvider') || 'cloudflare'
  );
}

// Sync tracking strip state to main process
if (_browseIsElectron && window.electronAPI.trackingStripSetEnabled) {
  window.electronAPI.trackingStripSetEnabled(Settings.get('trackingStripEnabled') !== 'false');
}

// Sync HTTPS-only state to main process
if (_browseIsElectron && window.electronAPI.httpsOnlySetEnabled) {
  window.electronAPI.httpsOnlySetEnabled(Settings.get('httpsOnlyEnabled') !== 'false');
}

// Sync third-party cookie blocking state to main process
if (_browseIsElectron && window.electronAPI.cookieBlockSetEnabled) {
  window.electronAPI.cookieBlockSetEnabled(Settings.get('thirdPartyCookiesBlocked') !== 'false');
}

// Audio tracking: { tabId: { windowId, muted } }
export const _browseAudioTabs = new Map();
window._browseAudioTabs = _browseAudioTabs;

// Closed captions state
let _ccStream = null;
let _ccSocket = null;
let _ccAudioCtx = null;
let _ccWorkletNode = null;
var _ccActive = State(false);  // @signal — drives caption overlay
var _ccTabId = State(null);    // @signal
export const _ccCaptionLines = [];
let _ccFadeTimer = null;

export function getCcStream() { return _ccStream; }
export function setCcStream(v) { _ccStream = v; }
export function getCcSocket() { return _ccSocket; }
export function setCcSocket(v) { _ccSocket = v; }
export function getCcAudioCtx() { return _ccAudioCtx; }
export function setCcAudioCtx(v) { _ccAudioCtx = v; }
export function getCcWorkletNode() { return _ccWorkletNode; }
export function setCcWorkletNode(v) { _ccWorkletNode = v; }
export function getCcActive() { return _ccActive.value; }
export function setCcActive(v) { _ccActive.value = v; }
export function getCcTabId() { return _ccTabId.value; }
export function setCcTabId(v) { _ccTabId.value = v; }
export function getCcFadeTimer() { return _ccFadeTimer; }
export function setCcFadeTimer(v) { _ccFadeTimer = v; }

_bridge('_ccStream', () => _ccStream, v => { _ccStream = v; });
_bridge('_ccSocket', () => _ccSocket, v => { _ccSocket = v; });
_bridge('_ccAudioCtx', () => _ccAudioCtx, v => { _ccAudioCtx = v; });
_bridge('_ccWorkletNode', () => _ccWorkletNode, v => { _ccWorkletNode = v; });
_bridge('_ccActive', () => _ccActive.value, v => { _ccActive.value = v; });
_bridge('_ccTabId', () => _ccTabId.value, v => { _ccTabId.value = v; });
window._ccCaptionLines = _ccCaptionLines;
_bridge('_ccFadeTimer', () => _ccFadeTimer, v => { _ccFadeTimer = v; });

// NTP uploaded files: { name, content, file }
export const _ntpUploadedFiles = [];
window._ntpUploadedFiles = _ntpUploadedFiles;

// Closed tabs for Cmd+Shift+T reopen
export const _BROWSE_CLOSED_TABS_MAX = 50;
export const _browseClosedTabs = Settings.getJSON('browseClosedTabs', []);
window._BROWSE_CLOSED_TABS_MAX = _BROWSE_CLOSED_TABS_MAX;
window._browseClosedTabs = _browseClosedTabs;

// Password manager state
export const _pwAutofillOffered = new Set(); // tab ids that have been offered autofill
export const _pwSaveDismissed = new Map(); // 'origin|username' → true
let _pwLastSubmit = null; // { origin, username, ts } dedup
let _pwPendingPrompt = null; // { tab, data, ts } — survives navigation
export function getPwLastSubmit() { return _pwLastSubmit; }
export function setPwLastSubmit(v) { _pwLastSubmit = v; }
export function getPwPendingPrompt() { return _pwPendingPrompt; }
export function setPwPendingPrompt(v) { _pwPendingPrompt = v; }
window._pwAutofillOffered = _pwAutofillOffered;
window._pwSaveDismissed = _pwSaveDismissed;
_bridge('_pwLastSubmit', () => _pwLastSubmit, v => { _pwLastSubmit = v; });
_bridge('_pwPendingPrompt', () => _pwPendingPrompt, v => { _pwPendingPrompt = v; });

// Split pane state
let _browseNextPaneId = 1;
export function getBrowseNextPaneId() { return _browseNextPaneId; }
export function setBrowseNextPaneId(v) { _browseNextPaneId = v; }
_bridge('_browseNextPaneId', () => _browseNextPaneId, v => { _browseNextPaneId = v; });

// Return view for "back" button — backed by Settings.get('_browseReturnView')

// Convenience getters for current window's tabs (backward compatibility)
// NOTE: read _browseActiveWindow via the local var (getter/setter bridge keeps it in sync)
export function _getCurrentWindow() {
  return _browseWindows.find(w => w.id === _browseActiveWindow.value);
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
      if (t._netrunPage) saved._netrunPage = true;
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
      if (t._aiPanel && t._aiPanel.threadId) saved._aiPanelThreadId = t._aiPanel.threadId;
      return saved;
    })
  }));
  Settings.setJSON(_getBrowseStorageKey('browseWindows'), {
    windows: data,
    activeWindow: _browseActiveWindow.value,
    nextWindowId: _browseNextWindowId,
    nextTabId: _browseNextTabId,
    nextGroupId: _browseNextGroupId,
    nextPaneId: _browseNextPaneId
  });
}

window._getCurrentWindow = _getCurrentWindow;
window._getBrowseStorageKey = _getBrowseStorageKey;
_bridge('_browseSaveTabsTimer', () => _browseSaveTabsTimer, v => { _browseSaveTabsTimer = v; });
window._browseSaveTabs = _browseSaveTabs;
window._browseSaveTabsNow = _browseSaveTabsNow;
