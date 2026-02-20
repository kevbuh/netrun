// panel-state.js — Shared state for panel system
// All state variables used across panel modules
//
// State variable conventions:
//   @settings — backed by Settings.get/set; no local var needed
//   @signal   — AetherUI State() reactive signal; access via .value
//   @runtime  — ephemeral in-memory state; plain var, not persisted
//   @const    — set once at init, never changes

// ── Chat State ──  @runtime
export const _popupChatMessages = [];
export const _popupChatAbort = null;
export const _chatStreamStart = 0;
export const _aetherBackgroundStreaming = false;
export const _chatMemoryRetrieved = false;
export const _panelThreadId = null; // thread ID for the current panel chat session
export const _panelSession = null; // ChatEngine session for the current panel

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

export const _lastMouseX = 0;
export const _lastMouseY = 0;
export const _aetherPrevFocus = null; // { el, selStart, selEnd } — restore on Escape
export const _aetherDragging = false;
export const _aetherDragOffset = { x: 0, y: 0 };
export const _aetherDragPopup = null;
export const _aetherPinned = false;

// ── Context Attachments ──
export const _pendingScreenshots = [];
export const _pendingTabContexts = []; // {tabId, title, url, content} — browser tabs attached to chat
export const _pendingFileContexts = []; // {name, content} — uploaded files attached to chat

// ── TTS State ──
export const _ttsAudio = null; // current Kokoro TTS audio element
export const _ttsAudioCtx = null;
export const _ttsAnalyser = null;
export const _ttsRafId = null;
export const _ttsQueue = []; // queued audio blobs for chunked playback
export const _ttsChunks = []; // text chunks pending TTS
export const _ttsChunkIdx = 0; // next chunk to fetch
export const _ttsStopped = false; // cancellation flag
export const _ttsPaused = false; // pause flag
export const _ttsPlayedDurations = []; // durations of already-finished chunks
export const _ttsRemainingDurations = []; // estimated durations of queued chunks
export const _ttsPlayingChunkIdx = -1; // index of the chunk currently being read aloud
export const _ttsTabId = null; // tab ID where TTS was started (persists across tab switches)

// ── Command State (Aether slash commands) ──
export const _aetherCmdIdx = -1;
export const _aetherTabIdx = -1;
export const _aetherTabList = [];
export const _aetherTabSwitchMode = false; // true when cycling through tabs with /tabs
export const _aetherHistoryIdx = -1;
export const _aetherHistoryList = [];
export const _aetherModelIdx = -1;
export const _aetherModelList = [];
export const _aetherAgentIdx = -1;
export const _aetherAgentList = [];
export const _aetherTabAutoAdding = false;

// ── Window assignments for global access ──
window._popupChatMessages = _popupChatMessages;
window._popupChatAbort = _popupChatAbort;
window._chatStreamStart = _chatStreamStart;
window._aetherBackgroundStreaming = _aetherBackgroundStreaming;
window._chatMemoryRetrieved = _chatMemoryRetrieved;
window._panelThreadId = _panelThreadId;
window._panelSession = _panelSession;
window._aetherTrackModeVal = _aetherTrackModeVal;
window._lastMouseX = _lastMouseX;
window._lastMouseY = _lastMouseY;
window._aetherPrevFocus = _aetherPrevFocus;
window._aetherDragging = _aetherDragging;
window._aetherDragOffset = _aetherDragOffset;
window._aetherDragPopup = _aetherDragPopup;
window._aetherPinned = _aetherPinned;
window._pendingScreenshots = _pendingScreenshots;
window._pendingTabContexts = _pendingTabContexts;
window._pendingFileContexts = _pendingFileContexts;
window._ttsAudio = _ttsAudio;
window._ttsAudioCtx = _ttsAudioCtx;
window._ttsAnalyser = _ttsAnalyser;
window._ttsRafId = _ttsRafId;
window._ttsQueue = _ttsQueue;
window._ttsChunks = _ttsChunks;
window._ttsChunkIdx = _ttsChunkIdx;
window._ttsStopped = _ttsStopped;
window._ttsPaused = _ttsPaused;
window._ttsPlayedDurations = _ttsPlayedDurations;
window._ttsRemainingDurations = _ttsRemainingDurations;
window._ttsPlayingChunkIdx = _ttsPlayingChunkIdx;
window._ttsTabId = _ttsTabId;
window._aetherCmdIdx = _aetherCmdIdx;
window._aetherTabIdx = _aetherTabIdx;
window._aetherTabList = _aetherTabList;
window._aetherTabSwitchMode = _aetherTabSwitchMode;
window._aetherHistoryIdx = _aetherHistoryIdx;
window._aetherHistoryList = _aetherHistoryList;
window._aetherModelIdx = _aetherModelIdx;
window._aetherModelList = _aetherModelList;
window._aetherAgentIdx = _aetherAgentIdx;
window._aetherAgentList = _aetherAgentList;
window._aetherTabAutoAdding = _aetherTabAutoAdding;
