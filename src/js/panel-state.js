// panel-state.js — Shared state for panel system
// All state variables used across panel modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI window.State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

// ── Helper: bridge a local var to window via getter/setter ──
import ChatEngine from '/js/chat-engine.js';
function _bridge(name, get, set) {
  Object.defineProperty(window, name, { get, set, configurable: true, enumerable: true });
}

// ── Chat State ──  @runtime
export const _popupChatMessages = [];
let _popupChatAbort = null;
let _chatStreamStart = 0;
let _aetherBackgroundStreaming = false;
let _chatMemoryRetrieved = false;
let _panelThreadId = null; // thread ID for the current panel chat session
let _panelSession = null; // ChatEngine session for the current panel

export function getPopupChatAbort() { return _popupChatAbort; }
export function setPopupChatAbort(v) { _popupChatAbort = v; }
export function getChatStreamStart() { return _chatStreamStart; }
export function setChatStreamStart(v) { _chatStreamStart = v; }
export function getAetherBackgroundStreaming() { return _aetherBackgroundStreaming; }
export function setAetherBackgroundStreaming(v) { _aetherBackgroundStreaming = v; }
export function getChatMemoryRetrieved() { return _chatMemoryRetrieved; }
export function setChatMemoryRetrieved(v) { _chatMemoryRetrieved = v; }
export function getPanelThreadId() { return _panelThreadId; }
export function setPanelThreadId(v) { _panelThreadId = v; }
export function getPanelSession() { return _panelSession; }
export function setPanelSession(v) { _panelSession = v; }

window._popupChatMessages = _popupChatMessages;
_bridge('_popupChatAbort', () => _popupChatAbort, v => { _popupChatAbort = v; });
_bridge('_chatStreamStart', () => _chatStreamStart, v => { _chatStreamStart = v; });
_bridge('_aetherBackgroundStreaming', () => _aetherBackgroundStreaming, v => { _aetherBackgroundStreaming = v; });
_bridge('_chatMemoryRetrieved', () => _chatMemoryRetrieved, v => { _chatMemoryRetrieved = v; });
_bridge('_panelThreadId', () => _panelThreadId, v => { _panelThreadId = v; });
_bridge('_panelSession', () => _panelSession, v => { _panelSession = v; });

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

let _lastMouseX = 0;
let _lastMouseY = 0;
let _aetherPrevFocus = null; // { el, selStart, selEnd } — restore on Escape
let _aetherDragging = false;
export const _aetherDragOffset = { x: 0, y: 0 };
let _aetherDragPopup = null;
let _aetherPinned = false;

export function getLastMouseX() { return _lastMouseX; }
export function setLastMouseX(v) { _lastMouseX = v; }
export function getLastMouseY() { return _lastMouseY; }
export function setLastMouseY(v) { _lastMouseY = v; }
export function getAetherPrevFocus() { return _aetherPrevFocus; }
export function setAetherPrevFocus(v) { _aetherPrevFocus = v; }
export function getAetherDragging() { return _aetherDragging; }
export function setAetherDragging(v) { _aetherDragging = v; }
export function getAetherDragPopup() { return _aetherDragPopup; }
export function setAetherDragPopup(v) { _aetherDragPopup = v; }
export function getAetherPinned() { return _aetherPinned; }
export function setAetherPinned(v) { _aetherPinned = v; }

_bridge('_lastMouseX', () => _lastMouseX, v => { _lastMouseX = v; });
_bridge('_lastMouseY', () => _lastMouseY, v => { _lastMouseY = v; });
_bridge('_aetherPrevFocus', () => _aetherPrevFocus, v => { _aetherPrevFocus = v; });
_bridge('_aetherDragging', () => _aetherDragging, v => { _aetherDragging = v; });
window._aetherDragOffset = _aetherDragOffset;
_bridge('_aetherDragPopup', () => _aetherDragPopup, v => { _aetherDragPopup = v; });
_bridge('_aetherPinned', () => _aetherPinned, v => { _aetherPinned = v; });
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
let _ttsAudio = null; // current Kokoro TTS audio element
let _ttsAudioCtx = null;
let _ttsAnalyser = null;
let _ttsRafId = null;
export const _ttsQueue = []; // queued audio blobs for chunked playback
export const _ttsChunks = []; // text chunks pending TTS
let _ttsChunkIdx = 0; // next chunk to fetch
let _ttsStopped = false; // cancellation flag
let _ttsPaused = false; // pause flag
export const _ttsPlayedDurations = []; // durations of already-finished chunks
export const _ttsRemainingDurations = []; // estimated durations of queued chunks
let _ttsPlayingChunkIdx = -1; // index of the chunk currently being read aloud
let _ttsTabId = null; // tab ID where TTS was started (persists across tab switches)

export function getTtsAudio() { return _ttsAudio; }
export function setTtsAudio(v) { _ttsAudio = v; }
export function getTtsAudioCtx() { return _ttsAudioCtx; }
export function setTtsAudioCtx(v) { _ttsAudioCtx = v; }
export function getTtsAnalyser() { return _ttsAnalyser; }
export function setTtsAnalyser(v) { _ttsAnalyser = v; }
export function getTtsRafId() { return _ttsRafId; }
export function setTtsRafId(v) { _ttsRafId = v; }
export function getTtsChunkIdx() { return _ttsChunkIdx; }
export function setTtsChunkIdx(v) { _ttsChunkIdx = v; }
export function getTtsStopped() { return _ttsStopped; }
export function setTtsStopped(v) { _ttsStopped = v; }
export function getTtsPaused() { return _ttsPaused; }
export function setTtsPaused(v) { _ttsPaused = v; }
export function getTtsPlayingChunkIdx() { return _ttsPlayingChunkIdx; }
export function setTtsPlayingChunkIdx(v) { _ttsPlayingChunkIdx = v; }
export function getTtsTabId() { return _ttsTabId; }
export function setTtsTabId(v) { _ttsTabId = v; }

_bridge('_ttsAudio', () => _ttsAudio, v => { _ttsAudio = v; });
_bridge('_ttsAudioCtx', () => _ttsAudioCtx, v => { _ttsAudioCtx = v; });
_bridge('_ttsAnalyser', () => _ttsAnalyser, v => { _ttsAnalyser = v; });
_bridge('_ttsRafId', () => _ttsRafId, v => { _ttsRafId = v; });
window._ttsQueue = _ttsQueue;
window._ttsChunks = _ttsChunks;
_bridge('_ttsChunkIdx', () => _ttsChunkIdx, v => { _ttsChunkIdx = v; });
_bridge('_ttsStopped', () => _ttsStopped, v => { _ttsStopped = v; });
_bridge('_ttsPaused', () => _ttsPaused, v => { _ttsPaused = v; });
window._ttsPlayedDurations = _ttsPlayedDurations;
window._ttsRemainingDurations = _ttsRemainingDurations;
_bridge('_ttsPlayingChunkIdx', () => _ttsPlayingChunkIdx, v => { _ttsPlayingChunkIdx = v; });
_bridge('_ttsTabId', () => _ttsTabId, v => { _ttsTabId = v; });

// ── Command window.State(Aether slash commands) ──
let _aetherCmdIdx = -1;
let _aetherTabIdx = -1;
export const _aetherTabList = [];
let _aetherTabSwitchMode = false; // true when cycling through tabs with /tabs
let _aetherHistoryIdx = -1;
export const _aetherHistoryList = [];
let _aetherModelIdx = -1;
export const _aetherModelList = [];
let _aetherAgentIdx = -1;
export const _aetherAgentList = [];
let _aetherTabAutoAdding = false;

export function getAetherCmdIdx() { return _aetherCmdIdx; }
export function setAetherCmdIdx(v) { _aetherCmdIdx = v; }
export function getAetherTabIdx() { return _aetherTabIdx; }
export function setAetherTabIdx(v) { _aetherTabIdx = v; }
export function getAetherTabSwitchMode() { return _aetherTabSwitchMode; }
export function setAetherTabSwitchMode(v) { _aetherTabSwitchMode = v; }
export function getAetherHistoryIdx() { return _aetherHistoryIdx; }
export function setAetherHistoryIdx(v) { _aetherHistoryIdx = v; }
export function getAetherModelIdx() { return _aetherModelIdx; }
export function setAetherModelIdx(v) { _aetherModelIdx = v; }
export function getAetherAgentIdx() { return _aetherAgentIdx; }
export function setAetherAgentIdx(v) { _aetherAgentIdx = v; }
export function getAetherTabAutoAdding() { return _aetherTabAutoAdding; }
export function setAetherTabAutoAdding(v) { _aetherTabAutoAdding = v; }

_bridge('_aetherCmdIdx', () => _aetherCmdIdx, v => { _aetherCmdIdx = v; });
_bridge('_aetherTabIdx', () => _aetherTabIdx, v => { _aetherTabIdx = v; });
window._aetherTabList = _aetherTabList;
_bridge('_aetherTabSwitchMode', () => _aetherTabSwitchMode, v => { _aetherTabSwitchMode = v; });
_bridge('_aetherHistoryIdx', () => _aetherHistoryIdx, v => { _aetherHistoryIdx = v; });
window._aetherHistoryList = _aetherHistoryList;
_bridge('_aetherModelIdx', () => _aetherModelIdx, v => { _aetherModelIdx = v; });
window._aetherModelList = _aetherModelList;
_bridge('_aetherAgentIdx', () => _aetherAgentIdx, v => { _aetherAgentIdx = v; });
window._aetherAgentList = _aetherAgentList;
_bridge('_aetherTabAutoAdding', () => _aetherTabAutoAdding, v => { _aetherTabAutoAdding = v; });

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
