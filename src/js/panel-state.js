// panel-state.js — Shared state for panel system
// All state variables used across panel modules

// ── Chat State ──
let _popupChatMessages = [];
let _popupChatAbort = null;
let _chatStreamStart = 0;
let _aetherBackgroundStreaming = false;
let _chatMemoryRetrieved = false;

// ── Aether Cursor/Focus State ──
let _aetherTrackModeVal = false;
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
let _aetherDragOffset = { x: 0, y: 0 };
let _aetherDragPopup = null;
let _aetherPinned = false;

// ── Context Attachments ──
let _pendingScreenshots = [];
let _pendingTabContexts = []; // {tabId, title, url, content} — browser tabs attached to chat
let _pendingFileContexts = []; // {name, content} — uploaded files attached to chat

// ── TTS State ──
let _ttsAudio = null; // current Kokoro TTS audio element
let _ttsAudioCtx = null;
let _ttsAnalyser = null;
let _ttsRafId = null;
let _ttsQueue = []; // queued audio blobs for chunked playback
let _ttsChunks = []; // text chunks pending TTS
let _ttsChunkIdx = 0; // next chunk to fetch
let _ttsStopped = false; // cancellation flag
let _ttsPaused = false; // pause flag
let _ttsPlayedDurations = []; // durations of already-finished chunks
let _ttsRemainingDurations = []; // estimated durations of queued chunks
let _ttsPlayingChunkIdx = -1; // index of the chunk currently being read aloud
let _ttsTabId = null; // tab ID where TTS was started (persists across tab switches)

// ── Command State (Aether slash commands) ──
let _aetherCmdIdx = -1;
let _aetherTabIdx = -1;
let _aetherTabList = [];
let _aetherTabSwitchMode = false; // true when cycling through tabs with /tabs
let _aetherHistoryIdx = -1;
let _aetherHistoryList = [];
let _aetherModelIdx = -1;
let _aetherModelList = [];
let _aetherAgentIdx = -1;
let _aetherAgentList = [];
let _aetherTabAutoAdding = false;
