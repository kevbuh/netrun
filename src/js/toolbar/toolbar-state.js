// toolbar-state.js — Reactive state for the toolbar system
// All signals, stores, and derived state live here. No DOM.
import Settings from '/js/core/core-settings.js';

// ── Primary signals ──
var browseActive = State(false);
var isNtp = State(false);
var islandExpanded = State(false);
var islandSubState = State('default'); // 'default' | 'tabs' | 'ai'
var tabListVersion = State(0);
var pillMenuOpen = State(false);
var moreMenuOpen = State(false);
var historyDropdown = State(null); // null | { direction, anchor }

// ── Computed signals ──

var activeTabData = Computed(function() {
  // Re-read on tabListVersion bump
  var _v = tabListVersion.value;
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  if (!win || !win.tabs) return null;
  var activeId = win.activeTab;
  return win.tabs.find(function(t) { return t.id === activeId; }) || null;
});

var canGoBack = Computed(function() {
  var tab = activeTabData.value;
  if (!tab) return false;
  if (tab.backStack && tab.backStack.length > 0) return true;
  try {
    if (window._browseIsElectron && tab.el && tab.el.canGoBack && tab.el.canGoBack()) return true;
  } catch(e) {}
  return false;
});

var canGoForward = Computed(function() {
  var tab = activeTabData.value;
  if (!tab) return false;
  if (tab.forwardStack && tab.forwardStack.length > 0) return true;
  try {
    if (window._browseIsElectron && tab.el && tab.el.canGoForward && tab.el.canGoForward()) return true;
  } catch(e) {}
  return false;
});

var visibleActivities = Computed(function() {
  if (!window._islandActivities) return [];
  var acts = window._islandActivities.value;
  var result = [];
  for (var id in acts) {
    var a = acts[id];
    if (!a) continue;
    // Filter out ai and insight types — they render in the AI pill
    if (a.type === 'ai' || a.type === 'insight') continue;
    result.push({ id: id, data: a });
  }
  // Sort by priority then timestamp
  var priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, rss: 2.6, bookmark: 2.55, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0, tabs: 10, nowplaying: 9 };
  result.sort(function(a, b) {
    var pa = priority[a.data.type] || 0;
    var pb = priority[b.data.type] || 0;
    return pb - pa || (b.data._ts || 0) - (a.data._ts || 0);
  });
  return result;
});

var aiPillState = Computed(function() {
  var audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  var pulseState = typeof window._getPulseState === 'function' ? window._getPulseState() : {};
  var pageInfoState = typeof window._getPageInfoState === 'function' ? window._getPageInfoState() : {};

  var micRecording = audioState.micRecording;
  var aiActive = _isAIActive();
  var audioPlaying = !!(audioState.tab || audioState.tts);
  var pulseFlashing = pulseState.isFlashing;
  var hasPageInfo = !!(pageInfoState.label || pageInfoState.badges);

  var primary = 'idle';
  if (micRecording) primary = 'mic';
  else if (aiActive) primary = 'ai';
  else if (audioPlaying) primary = 'audio';
  else if (pulseFlashing) primary = 'pulse';
  else if (hasPageInfo) primary = 'pageinfo';

  var secondary = [];
  if (primary !== 'mic' && micRecording) secondary.push('mic');
  if (primary !== 'ai' && aiActive) secondary.push('ai');
  if (primary !== 'audio' && audioPlaying) secondary.push('audio');
  if (primary !== 'pulse' && pulseFlashing) secondary.push('pulse');

  return { primary: primary, secondary: secondary, audioState: audioState, pulseState: pulseState, pageInfoState: pageInfoState };
});

function _isAIActive() {
  if (!window._islandActivities) return false;
  var acts = window._islandActivities.value;
  for (var id in acts) {
    var a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

// ── Tab data helpers ──

function getCurrentTabs() {
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  return win ? win.tabs : [];
}

function getCurrentGroups() {
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
  return win ? (win.groups || []) : [];
}

function getActiveTabId() {
  var win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
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
