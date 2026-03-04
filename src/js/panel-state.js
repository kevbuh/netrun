// panel-state.js — Shared state for panel system
// All state variables used across panel modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI window.State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

// ── Helper: bridge a local var to window via getter/setter ──
import { State } from '/aether/ui/state.js';
import ChatEngine from '/js/chat-engine.js';
function _bridge(name, get, set) {
  Object.defineProperty(window, name, { get, set, configurable: true, enumerable: true });
}
// Shorthand: plain var + bridge + getter/setter
function _pv(name, initial) {
  let v = initial;
  _bridge(name, () => v, x => { v = x; });
  return { get: () => v, set: x => { v = x; } };
}
// Shorthand: signal var + bridge + getter/setter
function _sv(name, initial) {
  const s = State(initial);
  _bridge(name, () => s.value, x => { s.value = x; });
  return { signal: s, get: () => s.value, set: x => { s.value = x; } };
}

// ── Chat State ──
export const _popupChatMessages = [];
const _pca = _pv('_popupChatAbort', null);
const _css = _pv('_chatStreamStart', 0);
const _abs = _sv('_aetherBackgroundStreaming', false);
const _cmr = _sv('_chatMemoryRetrieved', false);
const _pti = _sv('_panelThreadId', null);
const _pse = _sv('_panelSession', null);

export function getPopupChatAbort() { return _pca.get(); }
export function setPopupChatAbort(v) { _pca.set(v); }
export function getChatStreamStart() { return _css.get(); }
export function setChatStreamStart(v) { _css.set(v); }
export function getAetherBackgroundStreaming() { return _abs.get(); }
export function setAetherBackgroundStreaming(v) { _abs.set(v); }
export function getChatMemoryRetrieved() { return _cmr.get(); }
export function setChatMemoryRetrieved(v) { _cmr.set(v); }
export function getPanelThreadId() { return _pti.get(); }
export function setPanelThreadId(v) { _pti.set(v); }
export function getPanelSession() { return _pse.get(); }
export function setPanelSession(v) { _pse.set(v); }
export var _aetherBackgroundStreaming = _abs.signal;
export var _chatMemoryRetrieved = _cmr.signal;
export var _panelThreadId = _pti.signal;
export var _panelSession = _pse.signal;

window._popupChatMessages = _popupChatMessages;

// ── Aether Cursor/Focus State ──
export let _aetherTrackModeVal = false;
Object.defineProperty(window, '_aetherTrackMode', {
  get() { return _aetherTrackModeVal; },
  set(v) {
    const was = _aetherTrackModeVal;
    _aetherTrackModeVal = v;
    if (v && !was) {
      // Entering track mode: disable iframe pointer events so clicks reach parent
      document.querySelectorAll('iframe, webview').forEach(f => {
        f.dataset.peTrack = f.style.pointerEvents || '';
        f.style.pointerEvents = 'none';
      });
    } else if (!v && was) {
      // Leaving track mode: restore iframe pointer events
      document.querySelectorAll('iframe, webview').forEach(f => {
        if ('peTrack' in f.dataset) {
          f.style.pointerEvents = f.dataset.peTrack;
          delete f.dataset.peTrack;
        }
      });
    }
  }
});

const _lmx = _pv('_lastMouseX', 0);
const _lmy = _pv('_lastMouseY', 0);
const _apf = _pv('_aetherPrevFocus', null);
const _adr = _pv('_aetherDragging', false);
export const _aetherDragOffset = { x: 0, y: 0 };
const _adp = _pv('_aetherDragPopup', null);
const _api = _sv('_aetherPinned', false);

export function getLastMouseX() { return _lmx.get(); }
export function setLastMouseX(v) { _lmx.set(v); }
export function getLastMouseY() { return _lmy.get(); }
export function setLastMouseY(v) { _lmy.set(v); }
export function getAetherPrevFocus() { return _apf.get(); }
export function setAetherPrevFocus(v) { _apf.set(v); }
export function getAetherDragging() { return _adr.get(); }
export function setAetherDragging(v) { _adr.set(v); }
export function getAetherDragPopup() { return _adp.get(); }
export function setAetherDragPopup(v) { _adp.set(v); }
export function getAetherPinned() { return _api.get(); }
export function setAetherPinned(v) { _api.set(v); }
export var _aetherPinned = _api.signal;

window._aetherDragOffset = _aetherDragOffset;
_bridge('_aetherTrackModeVal', () => _aetherTrackModeVal, v => { _aetherTrackModeVal = v; });

// ── Context Attachments ──
export const _pendingScreenshots = [];
export const _pendingTabContexts = []; // {tabId, title, url, content} — browser tabs attached to chat
export const _pendingFileContexts = []; // {name, content} — uploaded files attached to chat
export const _pendingElementContexts = []; // {html, tagName, selector, url} — picked elements attached to chat
window._pendingScreenshots = _pendingScreenshots;
window._pendingTabContexts = _pendingTabContexts;
window._pendingFileContexts = _pendingFileContexts;
window._pendingElementContexts = _pendingElementContexts;

// ── TTS State ──
const _ta = _pv('_ttsAudio', null);
const _tc = _pv('_ttsAudioCtx', null);
const _tn = _pv('_ttsAnalyser', null);
const _tr = _pv('_ttsRafId', null);
export const _ttsQueue = [];
export const _ttsChunks = [];
const _ti = _pv('_ttsChunkIdx', 0);
const _ts = _sv('_ttsStopped', false);
const _tp = _sv('_ttsPaused', false);
export const _ttsPlayedDurations = [];
export const _ttsRemainingDurations = [];
const _tpi = _sv('_ttsPlayingChunkIdx', -1);
const _ttid = _pv('_ttsTabId', null);

export function getTtsAudio() { return _ta.get(); }
export function setTtsAudio(v) { _ta.set(v); }
export function getTtsAudioCtx() { return _tc.get(); }
export function setTtsAudioCtx(v) { _tc.set(v); }
export function getTtsAnalyser() { return _tn.get(); }
export function setTtsAnalyser(v) { _tn.set(v); }
export function getTtsRafId() { return _tr.get(); }
export function setTtsRafId(v) { _tr.set(v); }
export function getTtsChunkIdx() { return _ti.get(); }
export function setTtsChunkIdx(v) { _ti.set(v); }
export function getTtsStopped() { return _ts.get(); }
export function setTtsStopped(v) { _ts.set(v); }
export function getTtsPaused() { return _tp.get(); }
export function setTtsPaused(v) { _tp.set(v); }
export function getTtsPlayingChunkIdx() { return _tpi.get(); }
export function setTtsPlayingChunkIdx(v) { _tpi.set(v); }
export function getTtsTabId() { return _ttid.get(); }
export function setTtsTabId(v) { _ttid.set(v); }

window._ttsQueue = _ttsQueue;
window._ttsChunks = _ttsChunks;
window._ttsPlayedDurations = _ttsPlayedDurations;
window._ttsRemainingDurations = _ttsRemainingDurations;

// ── Command State (Aether slash commands) ──
const _aci = _pv('_aetherCmdIdx', -1);
const _ati = _pv('_aetherTabIdx', -1);
export const _aetherTabList = [];
const _atsm = _pv('_aetherTabSwitchMode', false);
const _ahi = _pv('_aetherHistoryIdx', -1);
export const _aetherHistoryList = [];
const _ami = _pv('_aetherModelIdx', -1);
export const _aetherModelList = [];
const _aai = _pv('_aetherAgentIdx', -1);
export const _aetherAgentList = [];
const _ataa = _pv('_aetherTabAutoAdding', false);

export function getAetherCmdIdx() { return _aci.get(); }
export function setAetherCmdIdx(v) { _aci.set(v); }
export function getAetherTabIdx() { return _ati.get(); }
export function setAetherTabIdx(v) { _ati.set(v); }
export function getAetherTabSwitchMode() { return _atsm.get(); }
export function setAetherTabSwitchMode(v) { _atsm.set(v); }
export function getAetherHistoryIdx() { return _ahi.get(); }
export function setAetherHistoryIdx(v) { _ahi.set(v); }
export function getAetherModelIdx() { return _ami.get(); }
export function setAetherModelIdx(v) { _ami.set(v); }
export function getAetherAgentIdx() { return _aai.get(); }
export function setAetherAgentIdx(v) { _aai.set(v); }
export function getAetherTabAutoAdding() { return _ataa.get(); }
export function setAetherTabAutoAdding(v) { _ataa.set(v); }

window._aetherTabList = _aetherTabList;
window._aetherHistoryList = _aetherHistoryList;
window._aetherModelList = _aetherModelList;
window._aetherAgentList = _aetherAgentList;

// ── Per-Tab AI Panel State ──

// Get the currently active browse tab object
export function _getActiveBrowseTab() {
  if (typeof window._getCurrentWindow !== 'function') return null;
  const win = window._getCurrentWindow();
  if (!win) return null;
  return win.tabs.find(t => t.id === win.activeTab) || null;
}

// Snapshot global panel state onto tab._aiPanel
// NOTE: must read arrays via window._ because _showPanel replaces them with new arrays
export function _saveTabPanelState(tab) {
  if (!tab) return;
  const msgs = window._popupChatMessages || [];
  const hasState = window._panelSession || msgs.length > 0 || window._panelThreadId;
  if (!hasState) { tab._aiPanel = null; return; }
  tab._aiPanel = {
    threadId: window._panelThreadId,
    messages: msgs.slice(),
    session: window._panelSession,
    pendingScreenshots: (window._pendingScreenshots || []).slice(),
    pendingTabContexts: (window._pendingTabContexts || []).slice(),
    pendingFileContexts: (window._pendingFileContexts || []).slice(),
    backgroundStreaming: window._aetherBackgroundStreaming,
    pinned: window._aetherPinned,
    hasChat: msgs.length > 0
  };
}

// Restore tab._aiPanel back into globals
// NOTE: must assign arrays via window._ to replace the current reference
export function _restoreTabPanelState(tab) {
  if (!tab || !tab._aiPanel) {
    // Clear globals to fresh state
    window._popupChatMessages = [];
    window._panelSession = null;
    window._panelThreadId = null;
    window._aetherBackgroundStreaming = false;
    window._aetherPinned = false;
    window._pendingScreenshots = [];
    window._pendingTabContexts = [];
    window._pendingFileContexts = [];
    return;
  }
  const s = tab._aiPanel;
  window._popupChatMessages = s.messages.slice();
  window._panelSession = s.session;
  window._panelThreadId = s.threadId;
  window._aetherBackgroundStreaming = s.backgroundStreaming;
  window._aetherPinned = s.pinned;
  window._pendingScreenshots = s.pendingScreenshots.slice();
  window._pendingTabContexts = s.pendingTabContexts.slice();
  window._pendingFileContexts = s.pendingFileContexts.slice();

  // If threadId exists but session was lost (app restart), lazily reload
  if (s.threadId && !s.session) {
    ChatEngine.loadSession(s.threadId).then(session => {
      if (session && tab._aiPanel && tab._aiPanel.threadId === s.threadId) {
        tab._aiPanel.session = session;
        tab._aiPanel.messages = session.messages;
        // If this tab is still active, sync globals
        const active = _getActiveBrowseTab();
        if (active && active.id === tab.id) {
          window._panelSession = session;
          window._popupChatMessages = session.messages;
        }
      }
    }).catch(() => {});
  }
}

window._getActiveBrowseTab = _getActiveBrowseTab;
window._saveTabPanelState = _saveTabPanelState;
window._restoreTabPanelState = _restoreTabPanelState;
