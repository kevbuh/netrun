// browse-audio.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Audio Tracking ──

export function toggleTabMute(tabId) {
  const audioInfo = _browseAudioTabs.get(tabId);
  if (!audioInfo) return;

  // Find the tab element
  for (const win of _browseWindows) {
    const tab = win.tabs.find(t => t.id === tabId);
    if (tab && tab.el && _browseIsElectron) {
      const newMuted = !audioInfo.muted;
      tab.el.setAudioMuted(newMuted);
      audioInfo.muted = newMuted;
      _browseAudioTabs.set(tabId, audioInfo);
      _browseRenderTabs();
      _updateAudioIndicator();
      return;
    }
  }
}

export function goToAudioTab() {
  // Go to the first tab playing audio
  const entry = _browseAudioTabs.entries().next().value;
  if (!entry) return;

  const [tabId, info] = entry;
  if (info.windowId !== _browseActiveWindow) {
    browseSelectWindow(info.windowId);
  }
  browseSelectTab(tabId);

  // If not in browse view, navigate there
  if (!document.getElementById('browse-view')?.style.display || document.getElementById('browse-view').style.display === 'none') {
    openBrowse();
  }
}

export function _browseUpdateScrollPill(pct) {
  const el = document.getElementById('pill-scroll-pct');
  if (!el) return;
  if (pct <= 0) {
    el.classList.remove('active');
    el.textContent = '';
  } else {
    el.textContent = pct + '%';
    el.classList.add('active');
  }
}

export function _browseUpdateTokenCount(count) {
  const el = document.getElementById('pill-token-count');
  if (!el) return;
  if (count <= 0) {
    el.classList.remove('active');
    el.textContent = '';
  } else {
    var label = count >= 1000 ? Math.round(count / 1000) + 'k' : String(count);
    el.textContent = label + ' tok';
    el.classList.add('active');
  }
}

export function _updateAudioIndicator() {
  // Remove legacy floating indicator if it exists
  const legacy = document.getElementById('audio-indicator');
  if (legacy) legacy.remove();

  // CC button + pill — always update regardless of early returns
  _updateCCButton();

  if (_browseAudioTabs.size === 0) {
    if (typeof _clearAudioUnified === 'function') _clearAudioUnified('tab');
    return;
  }

  // Get info about playing tabs
  const playingTabs = [];
  for (const [tabId, info] of _browseAudioTabs) {
    for (const win of _browseWindows) {
      const tab = win.tabs.find(t => t.id === tabId);
      if (tab) {
        playingTabs.push({ tab, win, muted: info.muted, tabId });
        break;
      }
    }
  }

  const firstTab = playingTabs[0];
  if (!firstTab) {
    if (typeof _clearAudioUnified === 'function') _clearAudioUnified('tab');
    return;
  }

  // Hide if we're already on this tab in the browse view
  const browseView = document.getElementById('browse-view');
  const isOnBrowseView = browseView && browseView.style.display !== 'none';
  const isCurrentTab = isOnBrowseView &&
    firstTab.win.id === _browseActiveWindow &&
    firstTab.tab.id === firstTab.win.activeTab;

  if (isCurrentTab) {
    if (typeof _clearAudioUnified === 'function') _clearAudioUnified('tab');
    return;
  }

  const allMuted = playingTabs.every(p => p.muted);
  const title = firstTab.tab.title.slice(0, 30) || 'Audio';
  if (typeof _updateAudioUnified === 'function') {
    _updateAudioUnified('tab', {
      label: allMuted ? 'Muted' : title,
      detail: (allMuted ? 'Muted — ' : 'Playing — ') + title
    });
  }
}

window.toggleTabMute = toggleTabMute;
window.goToAudioTab = goToAudioTab;
window._browseUpdateScrollPill = _browseUpdateScrollPill;
window._browseUpdateTokenCount = _browseUpdateTokenCount;
window._updateAudioIndicator = _updateAudioIndicator;
