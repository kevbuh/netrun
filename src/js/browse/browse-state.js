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

// Sync initial privacy/security states to Electron main process
function _syncToMain(method, ...args) {
  if (_browseIsElectron && window.electronAPI[method]) window.electronAPI[method](...args);
}
_syncToMain('adblockSetEnabled', Settings.get('adBlockEnabled') !== 'false');
var _adblockExceptions = Settings.getJSON('adblockSiteExceptions', {});
for (var d in _adblockExceptions) {
  if (_adblockExceptions[d]) _syncToMain('adblockSetSiteException', d, true);
}
_syncToMain('dohSetConfig', Settings.get('dohEnabled') !== 'false', Settings.get('dohProvider') || 'cloudflare');
_syncToMain('trackingStripSetEnabled', Settings.get('trackingStripEnabled') !== 'false');
_syncToMain('httpsOnlySetEnabled', Settings.get('httpsOnlyEnabled') !== 'false');
_syncToMain('cookieBlockSetEnabled', Settings.get('thirdPartyCookiesBlocked') !== 'false');

// ── Permission request handler (Electron → renderer round-trip) ──
// When a webview requests camera/mic/location/notifications, main process sends
// 'permission-request' here. We check stored permissions and either respond
// immediately or show the permission prompt UI and respond when the user decides.
export var _permissionPromptActive = State(false);  // @signal — AetherUI-driven state
window._permissionPromptActive = _permissionPromptActive;

// Store pending permission requests waiting for user decision
export const _pendingPermissionRequests = new Map(); // requestId → { domain, permKey }
window._pendingPermissionRequests = _pendingPermissionRequests;

if (_browseIsElectron && window.electronAPI.onPermissionRequest) {
  window.electronAPI.onPermissionRequest((_event, data) => {
    const { requestId, domain, permKey } = data;
    // Check stored site permissions
    const stored = Settings.getJSON('sitePermissions', {});
    const domainPerms = stored[domain] || {};
    if (domainPerms[permKey] === 'allow') {
      window.electronAPI.permissionResponse(requestId, true);
      return;
    }
    if (domainPerms[permKey] === 'block') {
      window.electronAPI.permissionResponse(requestId, false);
      return;
    }
    // Check session permissions
    if (window._sessionPermissions && window._sessionPermissions[domain] && window._sessionPermissions[domain][permKey] === 'allow') {
      window.electronAPI.permissionResponse(requestId, true);
      return;
    }
    // No stored decision — show the permission prompt UI
    // We hook into the existing prompt by temporarily patching the allow/block callbacks
    if (typeof window._showPermissionPrompt === 'function') {
      // Store the requestId so the prompt callbacks can respond
      _pendingPermissionRequests.set(requestId, { domain, permKey });
      _permissionPromptActive.value = true;
      window._showPermissionPrompt(domain, permKey);
      // Schedule a timeout: if prompt wasn't resolved via allow/block, deny
      // The prompt's Allow/Block buttons will call _resolvePendingPermissionRequest
      setTimeout(() => {
        if (_pendingPermissionRequests.has(requestId)) {
          const req = _pendingPermissionRequests.get(requestId);
          _pendingPermissionRequests.delete(requestId);
          if (_pendingPermissionRequests.size === 0) {
            _permissionPromptActive.value = false;
          }
          // Default deny if still unresolved
          window.electronAPI.permissionResponse(requestId, false);
        }
      }, 60000); // 60-second timeout
    } else {
      // No prompt available — deny by default
      window.electronAPI.permissionResponse(requestId, false);
    }
  });
}

// Helper to resolve pending permission requests
export function _resolvePendingPermissionRequest(domain, permKey, allowed) {
  for (const [requestId, req] of _pendingPermissionRequests.entries()) {
    if (req.domain === domain && req.permKey === permKey) {
      _pendingPermissionRequests.delete(requestId);
      if (_pendingPermissionRequests.size === 0) {
        _permissionPromptActive.value = false;
      }
      if (window.electronAPI && window.electronAPI.permissionResponse) {
        window.electronAPI.permissionResponse(requestId, allowed);
      }
    }
  }
}
window._resolvePendingPermissionRequest = _resolvePendingPermissionRequest;

// Audio tracking: { tabId: { windowId, muted } }
export const _browseAudioTabs = new Map();
window._browseAudioTabs = _browseAudioTabs;

// Closed captions state — _pv = plain var + bridge, _sv = signal + bridge
function _pv(name, initial) {
  let v = initial;
  _bridge(name, () => v, x => { v = x; });
  return { get: () => v, set: x => { v = x; } };
}
function _sv(name, initial) {
  const s = State(initial);
  _bridge(name, () => s.value, x => { s.value = x; });
  return { signal: s, get: () => s.value, set: x => { s.value = x; } };
}

const _ccs = _pv('_ccStream', null);
const _ccsk = _pv('_ccSocket', null);
const _ccac = _pv('_ccAudioCtx', null);
const _ccwn = _pv('_ccWorkletNode', null);
const _cca = _sv('_ccActive', false);
const _ccti = _sv('_ccTabId', null);
export const _ccCaptionLines = [];
const _ccft = _pv('_ccFadeTimer', null);

export function getCcStream() { return _ccs.get(); }
export function setCcStream(v) { _ccs.set(v); }
export function getCcSocket() { return _ccsk.get(); }
export function setCcSocket(v) { _ccsk.set(v); }
export function getCcAudioCtx() { return _ccac.get(); }
export function setCcAudioCtx(v) { _ccac.set(v); }
export function getCcWorkletNode() { return _ccwn.get(); }
export function setCcWorkletNode(v) { _ccwn.set(v); }
export function getCcActive() { return _cca.get(); }
export function setCcActive(v) { _cca.set(v); }
export function getCcTabId() { return _ccti.get(); }
export function setCcTabId(v) { _ccti.set(v); }
export function getCcFadeTimer() { return _ccft.get(); }
export function setCcFadeTimer(v) { _ccft.set(v); }
window._ccCaptionLines = _ccCaptionLines;

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
const _pwls = _pv('_pwLastSubmit', null);    // { origin, username, ts } dedup
const _pwpp = _pv('_pwPendingPrompt', null); // { tab, data, ts } — survives navigation
export const getPwLastSubmit = _pwls.get, setPwLastSubmit = _pwls.set;
export const getPwPendingPrompt = _pwpp.get, setPwPendingPrompt = _pwpp.set;
window._pwAutofillOffered = _pwAutofillOffered;
window._pwSaveDismissed = _pwSaveDismissed;

// Split pane state
const _bnpi = _pv('_browseNextPaneId', 1);
export const getBrowseNextPaneId = _bnpi.get, setBrowseNextPaneId = _bnpi.set;

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
      if (t.origin) saved.origin = t.origin;
      if (t.backStack && t.backStack.length) saved.backStack = t.backStack.slice(-50);
      if (t.forwardStack && t.forwardStack.length) saved.forwardStack = t.forwardStack.slice(-50);
      if (t._aiPanel && t._aiPanel.threadId) saved._aiPanelThreadId = t._aiPanel.threadId;
      if (window._nerdModeEnabled && window._nerdModeEnabled.has(t.id)) saved._nerdMode = true;
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
window._browseSaveTabs = _browseSaveTabs;
window._browseSaveTabsNow = _browseSaveTabsNow;

// Flush pending save on app quit
window.addEventListener('beforeunload', function() { _browseSaveTabsNow(); });
