import { describe, it, expect, beforeEach } from 'vitest';
import { State, Computed, Effect } from '../../aether/ui/state.js';

// ═══════════════════════════════════════════════════════════════
// Replicate the canGoBack/canGoForward signal chain from
// toolbar-state.js to test the reactive nav button behavior.
// ═══════════════════════════════════════════════════════════════

function makeNavSignals(getCurrentWindow) {
  var tabListVersion = State(0);

  var activeTabData = Computed(function() {
    var _v = tabListVersion.value;
    var win = getCurrentWindow();
    if (!win || !win.tabs) return null;
    var activeId = win.activeTab;
    return win.tabs.find(function(t) { return t.id === activeId; }) || null;
  });

  var canGoBack = Computed(function() {
    var tab = activeTabData.value;
    if (!tab) return false;
    if (tab.backStack && tab.backStack.length > 0) return true;
    if (tab.origin === 'feed') return true;
    return false;
  });

  var canGoForward = Computed(function() {
    var tab = activeTabData.value;
    if (!tab) return false;
    if (tab.forwardStack && tab.forwardStack.length > 0) return true;
    return false;
  });

  function notifyTabsChanged() {
    tabListVersion.value = tabListVersion.value + 1;
  }

  return { tabListVersion, activeTabData, canGoBack, canGoForward, notifyTabsChanged };
}

// ═══════════════════════════════════════════════════════════════
// canGoBack / canGoForward signal logic
// ═══════════════════════════════════════════════════════════════

describe('canGoBack signal', () => {
  it('returns false when no window exists', () => {
    const { canGoBack } = makeNavSignals(() => null);
    expect(canGoBack.value).toBe(false);
  });

  it('returns false when active tab has empty backStack', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: [] }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);
    expect(canGoBack.value).toBe(false);
  });

  it('returns true when active tab has backStack entries', () => {
    const win = { tabs: [{ id: 1, backStack: ['https://a.com'], forwardStack: [] }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);
    expect(canGoBack.value).toBe(true);
  });

  it('returns true when tab origin is feed (even with no backStack)', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: [], origin: 'feed' }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);
    expect(canGoBack.value).toBe(true);
  });

  it('returns false when no backStack property at all', () => {
    const win = { tabs: [{ id: 1 }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);
    expect(canGoBack.value).toBe(false);
  });
});

describe('canGoForward signal', () => {
  it('returns false when no window exists', () => {
    const { canGoForward } = makeNavSignals(() => null);
    expect(canGoForward.value).toBe(false);
  });

  it('returns false when active tab has empty forwardStack', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: [] }], activeTab: 1 };
    const { canGoForward } = makeNavSignals(() => win);
    expect(canGoForward.value).toBe(false);
  });

  it('returns true when active tab has forwardStack entries', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: ['https://b.com'] }], activeTab: 1 };
    const { canGoForward } = makeNavSignals(() => win);
    expect(canGoForward.value).toBe(true);
  });

  it('returns false when no forwardStack property at all', () => {
    const win = { tabs: [{ id: 1 }], activeTab: 1 };
    const { canGoForward } = makeNavSignals(() => win);
    expect(canGoForward.value).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// notifyTabsChanged triggers re-evaluation
// ═══════════════════════════════════════════════════════════════

describe('notifyTabsChanged re-evaluation', () => {
  it('canGoBack updates after notifyTabsChanged when backStack is added', () => {
    const tab = { id: 1, backStack: [], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoBack, notifyTabsChanged } = makeNavSignals(() => win);

    expect(canGoBack.value).toBe(false);

    tab.backStack.push('https://a.com');
    // Signal has NOT re-evaluated yet — still stale
    expect(canGoBack.value).toBe(false);

    notifyTabsChanged();
    expect(canGoBack.value).toBe(true);
  });

  it('canGoForward updates after notifyTabsChanged when forwardStack is added', () => {
    const tab = { id: 1, backStack: [], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoForward, notifyTabsChanged } = makeNavSignals(() => win);

    expect(canGoForward.value).toBe(false);

    tab.forwardStack.push('https://b.com');
    notifyTabsChanged();
    expect(canGoForward.value).toBe(true);
  });

  it('signals update when switching active tab', () => {
    const tab1 = { id: 1, backStack: ['https://a.com'], forwardStack: [] };
    const tab2 = { id: 2, backStack: [], forwardStack: [] };
    const win = { tabs: [tab1, tab2], activeTab: 1 };
    const { canGoBack, notifyTabsChanged } = makeNavSignals(() => win);

    expect(canGoBack.value).toBe(true);

    win.activeTab = 2;
    notifyTabsChanged();
    expect(canGoBack.value).toBe(false);
  });

  it('signals update after full back/forward cycle', () => {
    const tab = { id: 1, backStack: ['https://a.com'], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoBack, canGoForward, notifyTabsChanged } = makeNavSignals(() => win);

    expect(canGoBack.value).toBe(true);
    expect(canGoForward.value).toBe(false);

    // Simulate browseBack: pop from backStack, push to forwardStack
    tab.forwardStack.push(tab.backStack.pop());
    notifyTabsChanged();
    expect(canGoBack.value).toBe(false);
    expect(canGoForward.value).toBe(true);

    // Simulate browseForward: pop from forwardStack, push to backStack
    tab.backStack.push(tab.forwardStack.pop());
    notifyTabsChanged();
    expect(canGoBack.value).toBe(true);
    expect(canGoForward.value).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Effect-driven display binding (the actual regression target)
// ═══════════════════════════════════════════════════════════════

describe('nav button display binding via Effect', () => {
  it('sets display:none when canGoBack is false', () => {
    const win = { tabs: [{ id: 1, backStack: [], forwardStack: [] }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);

    const el = { style: { display: '' } };
    Effect(function() { el.style.display = canGoBack.value ? 'flex' : 'none'; });

    expect(el.style.display).toBe('none');
  });

  it('sets display:flex when canGoBack is true', () => {
    const win = { tabs: [{ id: 1, backStack: ['https://a.com'], forwardStack: [] }], activeTab: 1 };
    const { canGoBack } = makeNavSignals(() => win);

    const el = { style: { display: '' } };
    Effect(function() { el.style.display = canGoBack.value ? 'flex' : 'none'; });

    expect(el.style.display).toBe('flex');
  });

  it('must use display:flex not empty string to override CSS cascade', () => {
    // This is the specific regression: display:'' falls back to CSS
    // .pill-island-nav { display: none } which hides the button.
    // display:'flex' is an explicit inline style that always wins.
    const tab = { id: 1, backStack: [], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoBack, notifyTabsChanged } = makeNavSignals(() => win);

    const el = { style: { display: '' } };
    Effect(function() { el.style.display = canGoBack.value ? 'flex' : 'none'; });

    expect(el.style.display).toBe('none');

    tab.backStack.push('https://a.com');
    notifyTabsChanged();

    // MUST be 'flex', NOT '' (empty string)
    expect(el.style.display).toBe('flex');
  });

  it('Effect fires reactively when notifyTabsChanged is called', () => {
    const tab = { id: 1, backStack: [], forwardStack: [] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoBack, canGoForward, notifyTabsChanged } = makeNavSignals(() => win);

    const backEl = { style: { display: '' } };
    const fwdEl = { style: { display: '' } };
    Effect(function() { backEl.style.display = canGoBack.value ? 'flex' : 'none'; });
    Effect(function() { fwdEl.style.display = canGoForward.value ? 'flex' : 'none'; });

    // Initial: both hidden
    expect(backEl.style.display).toBe('none');
    expect(fwdEl.style.display).toBe('none');

    // Navigate to a page — back becomes available
    tab.backStack.push('https://a.com');
    notifyTabsChanged();
    expect(backEl.style.display).toBe('flex');
    expect(fwdEl.style.display).toBe('none');

    // Go back — forward becomes available, back goes away
    tab.forwardStack.push(tab.backStack.pop());
    notifyTabsChanged();
    expect(backEl.style.display).toBe('none');
    expect(fwdEl.style.display).toBe('flex');
  });

  it('both buttons show when in middle of navigation stack', () => {
    const tab = { id: 1, backStack: ['https://a.com'], forwardStack: ['https://c.com'] };
    const win = { tabs: [tab], activeTab: 1 };
    const { canGoBack, canGoForward } = makeNavSignals(() => win);

    const backEl = { style: { display: '' } };
    const fwdEl = { style: { display: '' } };
    Effect(function() { backEl.style.display = canGoBack.value ? 'flex' : 'none'; });
    Effect(function() { fwdEl.style.display = canGoForward.value ? 'flex' : 'none'; });

    expect(backEl.style.display).toBe('flex');
    expect(fwdEl.style.display).toBe('flex');
  });
});
