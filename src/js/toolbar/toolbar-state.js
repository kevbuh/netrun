// toolbar-state.js — Reactive state for the toolbar system
// All signals, stores, and derived state live here. No DOM.
import Settings from '/js/core/core-settings.js';
import { _getCurrentWindow } from '/js/browse/browse-state.js';

// ── Primary signals ──
const browseActive = State(false);
const isNtp = State(false);
const islandExpanded = State(false);
const islandSubState = State('default'); // 'default' | 'tabs' | 'ai'
const tabListVersion = State(0);
const pillMenuOpen = State(false);
const moreMenuOpen = State(false);
const historyDropdown = State(null); // null | { direction, anchor }

// ── Computed signals ──

const activeTabData = Computed(function() {
  // Re-read on tabListVersion bump
  const _v = tabListVersion.value;
  const win = _getCurrentWindow();
  if (!win || !win.tabs) return null;
  const activeId = win.activeTab;
  return win.tabs.find(function(t) { return t.id === activeId; }) || null;
});

const canGoBack = Computed(function() {
  const tab = activeTabData.value;
  if (!tab) return false;
  if (tab.backStack && tab.backStack.length > 0) return true;
  // Show back button when tab came from feed (will close tab + return to feed)
  if (tab.origin === 'feed') return true;
  return false;
});

const canGoForward = Computed(function() {
  const tab = activeTabData.value;
  if (!tab) return false;
  if (tab.forwardStack && tab.forwardStack.length > 0) return true;
  return false;
});

const visibleActivities = Computed(function() {
  if (!window._islandActivities) return [];
  const acts = window._islandActivities.value;
  const result = [];
  for (const id in acts) {
    const a = acts[id];
    if (!a) continue;
    // Filter out ai and insight types — they render in the AI pill
    if (a.type === 'ai' || a.type === 'insight') continue;
    result.push({ id: id, data: a });
  }
  // Sort by priority then timestamp
  const priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, rss: 2.6, bookmark: 2.55, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0, tabs: 10, nowplaying: 9 };
  result.sort(function(a, b) {
    const pa = priority[a.data.type] || 0;
    const pb = priority[b.data.type] || 0;
    return pb - pa || (b.data._ts || 0) - (a.data._ts || 0);
  });
  return result;
});

const aiPillState = Computed(function() {
  const audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  const pulseState = typeof window._getPulseState === 'function' ? window._getPulseState() : {};
  const pageInfoState = typeof window._getPageInfoState === 'function' ? window._getPageInfoState() : {};

  const micRecording = audioState.micRecording;
  const aiActive = _isAIActive();
  const audioPlaying = !!(audioState.tab || audioState.tts);
  const pulseFlashing = pulseState.isFlashing;
  const hasPageInfo = !!(pageInfoState.label || pageInfoState.badges);

  let primary = 'idle';
  if (micRecording) primary = 'mic';
  else if (aiActive) primary = 'ai';
  else if (audioPlaying) primary = 'audio';
  else if (pulseFlashing) primary = 'pulse';
  else if (hasPageInfo) primary = 'pageinfo';

  const secondary = [];
  if (primary !== 'mic' && micRecording) secondary.push('mic');
  if (primary !== 'ai' && aiActive) secondary.push('ai');
  if (primary !== 'audio' && audioPlaying) secondary.push('audio');
  if (primary !== 'pulse' && pulseFlashing) secondary.push('pulse');

  return { primary: primary, secondary: secondary, audioState: audioState, pulseState: pulseState, pageInfoState: pageInfoState };
});

function _isAIActive() {
  if (!window._islandActivities) return false;
  const acts = window._islandActivities.value;
  for (const id in acts) {
    const a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

// ── Tab data helpers ──

function getCurrentTabs() {
  const win = _getCurrentWindow();
  return win ? win.tabs : [];
}

function getCurrentGroups() {
  const win = _getCurrentWindow();
  return win ? (win.groups || []) : [];
}

function getActiveTabId() {
  const win = _getCurrentWindow();
  return win ? win.activeTab : null;
}

// ── Notify helpers ──

function notifyTabsChanged() {
  tabListVersion.value = tabListVersion.value + 1;
}

// ── Exports ──

export {
  // Primary signals
  browseActive,
  isNtp,
  islandExpanded,
  islandSubState,
  tabListVersion,
  pillMenuOpen,
  moreMenuOpen,
  historyDropdown,
  // Computed
  activeTabData,
  canGoBack,
  canGoForward,
  visibleActivities,
  aiPillState,
  // Helpers
  getCurrentTabs,
  getCurrentGroups,
  getActiveTabId,
  notifyTabsChanged,
};
