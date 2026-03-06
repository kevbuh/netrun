import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State, Computed, Effect } from '../../aether/ui/state.js';

// ═══════════════════════════════════════════════════════════════
// Replicate toolbar-state.js logic inline so we can test it
// without browser path imports (same pattern as toolbar-nav.test).
// ═══════════════════════════════════════════════════════════════

// ── Primary signals factory ──

function makePrimarySignals() {
  return {
    browseActive: State(false),
    isNtp: State(false),
    islandExpanded: State(false),
    islandSubState: State('default'),
    tabListVersion: State(0),
    pillMenuOpen: State(false),
    moreMenuOpen: State(false),
    historyDropdown: State(null),
  };
}

// ── Computed signals factory ──

function makeActiveTabData(getCurrentWindow, tabListVersion) {
  return Computed(function() {
    var _v = tabListVersion.value;
    var win = getCurrentWindow();
    if (!win || !win.tabs) return null;
    var activeId = win.activeTab;
    return win.tabs.find(function(t) { return t.id === activeId; }) || null;
  });
}

function makeCanGoBack(activeTabData) {
  return Computed(function() {
    var tab = activeTabData.value;
    if (!tab) return false;
    if (tab.backStack && tab.backStack.length > 0) return true;
    if (tab.origin === 'feed') return true;
    return false;
  });
}

function makeCanGoForward(activeTabData) {
  return Computed(function() {
    var tab = activeTabData.value;
    if (!tab) return false;
    if (tab.forwardStack && tab.forwardStack.length > 0) return true;
    return false;
  });
}

function makeVisibleActivities(islandActivities) {
  return Computed(function() {
    if (!islandActivities) return [];
    var acts = islandActivities.value;
    var result = [];
    for (var id in acts) {
      var a = acts[id];
      if (!a) continue;
      if (a.type === 'ai' || a.type === 'insight') continue;
      result.push({ id: id, data: a });
    }
    var priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, rss: 2.6, bookmark: 2.55, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0, tabs: 10, nowplaying: 9 };
    result.sort(function(a, b) {
      var pa = priority[a.data.type] || 0;
      var pb = priority[b.data.type] || 0;
      return pb - pa || (b.data._ts || 0) - (a.data._ts || 0);
    });
    return result;
  });
}

function _isAIActive(islandActivities) {
  if (!islandActivities) return false;
  var acts = islandActivities.value;
  for (var id in acts) {
    var a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

function makeAiPillState(islandActivities, getAudioState, getPulseState, getPageInfoState) {
  return Computed(function() {
    var audioState = typeof getAudioState === 'function' ? getAudioState() : {};
    var pulseState = typeof getPulseState === 'function' ? getPulseState() : {};
    var pageInfoState = typeof getPageInfoState === 'function' ? getPageInfoState() : {};

    var micRecording = audioState.micRecording;
    var aiActive = _isAIActive(islandActivities);
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
}

// ── Tab data helpers ──

function getCurrentTabs(getCurrentWindow) {
  var win = getCurrentWindow();
  return win ? win.tabs : [];
}

function getCurrentGroups(getCurrentWindow) {
  var win = getCurrentWindow();
  return win ? (win.groups || []) : [];
}

function getActiveTabId(getCurrentWindow) {
  var win = getCurrentWindow();
  return win ? win.activeTab : null;
}

function notifyTabsChanged(tabListVersion) {
  tabListVersion.value = tabListVersion.value + 1;
}


// ═══════════════════════════════════════════════════════════════
// Primary signals
// ═══════════════════════════════════════════════════════════════

describe('Primary signals — default values', () => {
  it('browseActive defaults to false', () => {
    const s = makePrimarySignals();
    expect(s.browseActive.value).toBe(false);
  });

  it('isNtp defaults to false', () => {
    const s = makePrimarySignals();
    expect(s.isNtp.value).toBe(false);
  });

  it('islandExpanded defaults to false', () => {
    const s = makePrimarySignals();
    expect(s.islandExpanded.value).toBe(false);
  });

  it('islandSubState defaults to "default"', () => {
    const s = makePrimarySignals();
    expect(s.islandSubState.value).toBe('default');
  });

  it('tabListVersion defaults to 0', () => {
    const s = makePrimarySignals();
    expect(s.tabListVersion.value).toBe(0);
  });

  it('pillMenuOpen defaults to false', () => {
    const s = makePrimarySignals();
    expect(s.pillMenuOpen.value).toBe(false);
  });

  it('moreMenuOpen defaults to false', () => {
    const s = makePrimarySignals();
    expect(s.moreMenuOpen.value).toBe(false);
  });

  it('historyDropdown defaults to null', () => {
    const s = makePrimarySignals();
    expect(s.historyDropdown.value).toBe(null);
  });

  it('signals are writable', () => {
    const s = makePrimarySignals();
    s.browseActive.value = true;
    s.isNtp.value = true;
    s.islandExpanded.value = true;
    s.islandSubState.value = 'tabs';
    s.historyDropdown.value = { direction: 'back', anchor: {} };
    expect(s.browseActive.value).toBe(true);
    expect(s.isNtp.value).toBe(true);
    expect(s.islandExpanded.value).toBe(true);
    expect(s.islandSubState.value).toBe('tabs');
    expect(s.historyDropdown.value).toEqual({ direction: 'back', anchor: {} });
  });
});


// ═══════════════════════════════════════════════════════════════
// activeTabData
// ═══════════════════════════════════════════════════════════════

describe('activeTabData', () => {
  it('returns null when no window exists', () => {
    const tlv = State(0);
    const atd = makeActiveTabData(() => null, tlv);
    expect(atd.value).toBe(null);
  });

  it('returns null when window has no tabs', () => {
    const tlv = State(0);
    const atd = makeActiveTabData(() => ({ activeTab: 1 }), tlv);
    expect(atd.value).toBe(null);
  });

  it('returns the active tab object', () => {
    const tab = { id: 42, url: 'https://example.com' };
    const win = { tabs: [tab], activeTab: 42 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    expect(atd.value).toBe(tab);
  });

  it('returns null when activeTab id does not match any tab', () => {
    const win = { tabs: [{ id: 1 }], activeTab: 999 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    expect(atd.value).toBe(null);
  });

  it('re-evaluates when tabListVersion is bumped', () => {
    const win = { tabs: [{ id: 1 }, { id: 2 }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    expect(atd.value).toEqual({ id: 1 });

    win.activeTab = 2;
    // Still stale before bump
    expect(atd.value).toEqual({ id: 1 });

    tlv.value = tlv.value + 1;
    expect(atd.value).toEqual({ id: 2 });
  });
});


// ═══════════════════════════════════════════════════════════════
// canGoBack
// ═══════════════════════════════════════════════════════════════

describe('canGoBack', () => {
  it('returns false when no tab', () => {
    const tlv = State(0);
    const atd = makeActiveTabData(() => null, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(false);
  });

  it('returns false when backStack is empty', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: [] }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(false);
  });

  it('returns true when backStack has entries', () => {
    const win = { tabs: [{ id: 1, backStack: ['https://a.com'] }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(true);
  });

  it('returns true when tab origin is feed even with empty backStack', () => {
    const win = { tabs: [{ id: 1, backStack: [], origin: 'feed' }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(true);
  });

  it('returns true when tab origin is feed and backStack is undefined', () => {
    const win = { tabs: [{ id: 1, origin: 'feed' }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(true);
  });

  it('returns false when backStack is undefined and no feed origin', () => {
    const win = { tabs: [{ id: 1 }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);
    expect(cgb.value).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════
// canGoForward
// ═══════════════════════════════════════════════════════════════

describe('canGoForward', () => {
  it('returns false when no tab', () => {
    const tlv = State(0);
    const atd = makeActiveTabData(() => null, tlv);
    const cgf = makeCanGoForward(atd);
    expect(cgf.value).toBe(false);
  });

  it('returns false when forwardStack is empty', () => {
    const win = { tabs: [{ id: 1, forwardStack: [] }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgf = makeCanGoForward(atd);
    expect(cgf.value).toBe(false);
  });

  it('returns true when forwardStack has entries', () => {
    const win = { tabs: [{ id: 1, forwardStack: ['https://b.com'] }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgf = makeCanGoForward(atd);
    expect(cgf.value).toBe(true);
  });

  it('returns false when forwardStack is undefined', () => {
    const win = { tabs: [{ id: 1 }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgf = makeCanGoForward(atd);
    expect(cgf.value).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════
// visibleActivities
// ═══════════════════════════════════════════════════════════════

describe('visibleActivities', () => {
  it('returns empty array when islandActivities is null', () => {
    const va = makeVisibleActivities(null);
    expect(va.value).toEqual([]);
  });

  it('filters out ai type', () => {
    const acts = State({ a1: { type: 'ai', label: 'AI' }, a2: { type: 'download', label: 'DL' } });
    const va = makeVisibleActivities(acts);
    expect(va.value.length).toBe(1);
    expect(va.value[0].data.type).toBe('download');
  });

  it('filters out insight type', () => {
    const acts = State({ i1: { type: 'insight', label: 'Insight' }, d1: { type: 'feed', label: 'Feed' } });
    const va = makeVisibleActivities(acts);
    expect(va.value.length).toBe(1);
    expect(va.value[0].data.type).toBe('feed');
  });

  it('skips null entries in the activity map', () => {
    const acts = State({ a: null, b: { type: 'download' } });
    const va = makeVisibleActivities(acts);
    expect(va.value.length).toBe(1);
    expect(va.value[0].id).toBe('b');
  });

  it('sorts by priority descending (tabs > nowplaying > download > feed)', () => {
    const acts = State({
      f: { type: 'feed', _ts: 1 },
      d: { type: 'download', _ts: 2 },
      t: { type: 'tabs', _ts: 3 },
      n: { type: 'nowplaying', _ts: 4 },
    });
    const va = makeVisibleActivities(acts);
    const types = va.value.map(function(a) { return a.data.type; });
    expect(types).toEqual(['tabs', 'nowplaying', 'download', 'feed']);
  });

  it('sorts by timestamp descending when priorities are equal', () => {
    const acts = State({
      a: { type: 'audio', _ts: 100 },
      b: { type: 'audio', _ts: 300 },
      c: { type: 'audio', _ts: 200 },
    });
    const va = makeVisibleActivities(acts);
    const ids = va.value.map(function(a) { return a.id; });
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('treats missing _ts as 0 for sort', () => {
    const acts = State({
      a: { type: 'feed' },
      b: { type: 'feed', _ts: 10 },
    });
    const va = makeVisibleActivities(acts);
    expect(va.value[0].id).toBe('b');
    expect(va.value[1].id).toBe('a');
  });

  it('treats unknown type as priority 0', () => {
    const acts = State({
      a: { type: 'unknown-thing', _ts: 1 },
      b: { type: 'download', _ts: 1 },
    });
    const va = makeVisibleActivities(acts);
    expect(va.value[0].data.type).toBe('download');
    expect(va.value[1].data.type).toBe('unknown-thing');
  });

  it('returns empty array when all activities are ai or insight', () => {
    const acts = State({
      a: { type: 'ai' },
      b: { type: 'insight' },
    });
    const va = makeVisibleActivities(acts);
    expect(va.value).toEqual([]);
  });

  it('preserves the activity id in the result', () => {
    const acts = State({ myKey: { type: 'bookmark', label: 'saved' } });
    const va = makeVisibleActivities(acts);
    expect(va.value[0].id).toBe('myKey');
    expect(va.value[0].data).toEqual({ type: 'bookmark', label: 'saved' });
  });

  it('handles empty activities map', () => {
    const acts = State({});
    const va = makeVisibleActivities(acts);
    expect(va.value).toEqual([]);
  });
});


// ═══════════════════════════════════════════════════════════════
// _isAIActive helper
// ═══════════════════════════════════════════════════════════════

describe('_isAIActive', () => {
  it('returns false when islandActivities is null', () => {
    expect(_isAIActive(null)).toBe(false);
  });

  it('returns true when an ai activity exists', () => {
    const acts = State({ a: { type: 'ai' } });
    expect(_isAIActive(acts)).toBe(true);
  });

  it('returns true when an insight activity is loading', () => {
    const acts = State({ i: { type: 'insight', loading: true } });
    expect(_isAIActive(acts)).toBe(true);
  });

  it('returns false when insight is present but not loading', () => {
    const acts = State({ i: { type: 'insight', loading: false } });
    expect(_isAIActive(acts)).toBe(false);
  });

  it('returns false when only non-ai activities exist', () => {
    const acts = State({ d: { type: 'download' }, f: { type: 'feed' } });
    expect(_isAIActive(acts)).toBe(false);
  });

  it('returns false when activities map is empty', () => {
    const acts = State({});
    expect(_isAIActive(acts)).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════
// aiPillState — priority logic
// ═══════════════════════════════════════════════════════════════

describe('aiPillState', () => {
  it('returns idle when nothing is active', () => {
    const aps = makeAiPillState(null, () => ({}), () => ({}), () => ({}));
    expect(aps.value.primary).toBe('idle');
    expect(aps.value.secondary).toEqual([]);
  });

  it('mic has highest priority', () => {
    const aiActs = State({ a: { type: 'ai' } });
    const aps = makeAiPillState(
      aiActs,
      () => ({ micRecording: true, tab: true, tts: false }),
      () => ({ isFlashing: true }),
      () => ({ label: 'Page', badges: ['badge'] }),
    );
    expect(aps.value.primary).toBe('mic');
  });

  it('ai is primary when mic is not recording', () => {
    const aiActs = State({ a: { type: 'ai' } });
    const aps = makeAiPillState(
      aiActs,
      () => ({ micRecording: false, tab: true }),
      () => ({ isFlashing: true }),
      () => ({ label: 'info' }),
    );
    expect(aps.value.primary).toBe('ai');
  });

  it('audio is primary when no mic and no ai', () => {
    const aps = makeAiPillState(
      null,
      () => ({ micRecording: false, tab: true }),
      () => ({ isFlashing: true }),
      () => ({ label: 'info' }),
    );
    expect(aps.value.primary).toBe('audio');
  });

  it('audio is primary when tts is active', () => {
    const aps = makeAiPillState(
      null,
      () => ({ tts: true }),
      () => ({}),
      () => ({}),
    );
    expect(aps.value.primary).toBe('audio');
  });

  it('pulse is primary when no mic, ai, or audio', () => {
    const aps = makeAiPillState(
      null,
      () => ({}),
      () => ({ isFlashing: true }),
      () => ({ label: 'info' }),
    );
    expect(aps.value.primary).toBe('pulse');
  });

  it('pageinfo is primary when only page info is present', () => {
    const aps = makeAiPillState(
      null,
      () => ({}),
      () => ({}),
      () => ({ label: '3 min read' }),
    );
    expect(aps.value.primary).toBe('pageinfo');
  });

  it('pageinfo is primary when badges are present without label', () => {
    const aps = makeAiPillState(
      null,
      () => ({}),
      () => ({}),
      () => ({ badges: ['new'] }),
    );
    expect(aps.value.primary).toBe('pageinfo');
  });

  it('secondary includes all non-primary active states', () => {
    // mic is primary; ai, audio, and pulse are secondary
    const aiActs = State({ a: { type: 'ai' } });
    const aps = makeAiPillState(
      aiActs,
      () => ({ micRecording: true, tab: true }),
      () => ({ isFlashing: true }),
      () => ({}),
    );
    expect(aps.value.primary).toBe('mic');
    expect(aps.value.secondary).toContain('ai');
    expect(aps.value.secondary).toContain('audio');
    expect(aps.value.secondary).toContain('pulse');
    expect(aps.value.secondary).not.toContain('mic');
  });

  it('secondary is empty when only primary state is active', () => {
    const aps = makeAiPillState(
      null,
      () => ({ micRecording: true }),
      () => ({}),
      () => ({}),
    );
    expect(aps.value.primary).toBe('mic');
    expect(aps.value.secondary).toEqual([]);
  });

  it('passes through audioState, pulseState, pageInfoState in result', () => {
    const audio = { micRecording: false, tab: false };
    const pulse = { isFlashing: false };
    const pageInfo = { label: 'test' };
    const aps = makeAiPillState(
      null,
      () => audio,
      () => pulse,
      () => pageInfo,
    );
    expect(aps.value.audioState).toEqual(audio);
    expect(aps.value.pulseState).toEqual(pulse);
    expect(aps.value.pageInfoState).toEqual(pageInfo);
  });

  it('handles non-function state getters gracefully', () => {
    const aps = makeAiPillState(null, null, null, null);
    expect(aps.value.primary).toBe('idle');
    expect(aps.value.audioState).toEqual({});
    expect(aps.value.pulseState).toEqual({});
    expect(aps.value.pageInfoState).toEqual({});
  });
});


// ═══════════════════════════════════════════════════════════════
// Tab data helpers
// ═══════════════════════════════════════════════════════════════

describe('getCurrentTabs', () => {
  it('returns tabs when window exists', () => {
    const tabs = [{ id: 1 }, { id: 2 }];
    expect(getCurrentTabs(() => ({ tabs }))).toBe(tabs);
  });

  it('returns empty array when window is null', () => {
    expect(getCurrentTabs(() => null)).toEqual([]);
  });
});

describe('getCurrentGroups', () => {
  it('returns groups when present', () => {
    const groups = [{ id: 'g1', tabs: [1, 2] }];
    expect(getCurrentGroups(() => ({ groups }))).toBe(groups);
  });

  it('returns empty array when groups is undefined', () => {
    expect(getCurrentGroups(() => ({}))).toEqual([]);
  });

  it('returns empty array when window is null', () => {
    expect(getCurrentGroups(() => null)).toEqual([]);
  });
});

describe('getActiveTabId', () => {
  it('returns activeTab id when window exists', () => {
    expect(getActiveTabId(() => ({ activeTab: 7 }))).toBe(7);
  });

  it('returns null when window is null', () => {
    expect(getActiveTabId(() => null)).toBe(null);
  });
});


// ═══════════════════════════════════════════════════════════════
// notifyTabsChanged
// ═══════════════════════════════════════════════════════════════

describe('notifyTabsChanged', () => {
  it('increments tabListVersion by 1', () => {
    const tlv = State(0);
    notifyTabsChanged(tlv);
    expect(tlv.value).toBe(1);
  });

  it('increments monotonically on repeated calls', () => {
    const tlv = State(0);
    notifyTabsChanged(tlv);
    notifyTabsChanged(tlv);
    notifyTabsChanged(tlv);
    expect(tlv.value).toBe(3);
  });

  it('triggers dependent Computed re-evaluation', () => {
    const tab = { id: 1, backStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);

    expect(cgb.value).toBe(false);

    tab.backStack.push('https://a.com');
    notifyTabsChanged(tlv);
    expect(cgb.value).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════
// Reactive chain — Effect integration
// ═══════════════════════════════════════════════════════════════

describe('Reactive chain with Effects', () => {
  it('Effect fires when activeTabData changes via tabListVersion', () => {
    const win = { tabs: [{ id: 1, url: 'a' }, { id: 2, url: 'b' }], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);

    const log = [];
    Effect(function() {
      const tab = atd.value;
      log.push(tab ? tab.url : null);
    });

    expect(log).toEqual(['a']);

    win.activeTab = 2;
    notifyTabsChanged(tlv);
    expect(log).toEqual(['a', 'b']);
  });

  it('full signal chain: tabListVersion -> activeTabData -> canGoBack -> Effect', () => {
    const tab = { id: 1, backStack: [], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const tlv = State(0);
    const atd = makeActiveTabData(() => win, tlv);
    const cgb = makeCanGoBack(atd);

    const display = { value: '' };
    Effect(function() {
      display.value = cgb.value ? 'flex' : 'none';
    });

    expect(display.value).toBe('none');

    tab.backStack.push('https://x.com');
    notifyTabsChanged(tlv);
    expect(display.value).toBe('flex');

    tab.backStack.length = 0;
    notifyTabsChanged(tlv);
    expect(display.value).toBe('none');
  });
});
