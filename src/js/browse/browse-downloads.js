// browse-downloads.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import Settings from '/js/core/core-settings.js';
if (window.AetherUI) AetherUI.globals();

// ── Doom Scroll Prevention ──
export const _DOOM_SCROLL_DEFAULTS = [
  { domain: 'twitter.com', mode: 'nudge', minutes: 5 },
  { domain: 'x.com', mode: 'nudge', minutes: 5 },
  { domain: 'reddit.com', mode: 'nudge', minutes: 5 },
  { domain: 'tiktok.com', mode: 'block', minutes: 0 },
  { domain: 'instagram.com', mode: 'nudge', minutes: 10 },
  { domain: 'facebook.com', mode: 'nudge', minutes: 10 },
];

export function _getDoomScrollSites() {
  try {
    const saved = Settings.get('doomScrollSites');
    if (saved) return JSON.parse(saved);
  } catch {}
  return _DOOM_SCROLL_DEFAULTS.slice();
}

export function _saveDoomScrollSites(list) {
  Settings.setJSON('doomScrollSites', list);
}

export function _doomScrollMatch(url) {
  if (Settings.get('doomScrollEnabled') === 'false') return null;
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const sites = _getDoomScrollSites();
  for (const site of sites) {
    const d = site.domain.toLowerCase();
    if (hostname === d || hostname.endsWith('.' + d)) return site;
  }
  return null;
}

// ── Focus Timer (pill-bar timer for doom scroll sites) ──
// Per-domain start times survive tab switches and SPA navigations
export const _focusTimerStarts = {}; // { domain: timestamp }
export let _focusTimerInterval = null;
export let _focusTimerDomain = '';
export let _focusTimerWarnMinutes = 0;

// Restore persisted start times from sessionStorage (survives reload)
try {
  const saved = JSON.parse(sessionStorage.getItem('focusTimerStarts') || '{}');
  Object.assign(_focusTimerStarts, saved);
} catch {}

export function _persistFocusTimerStarts() {
  try { sessionStorage.setItem('focusTimerStarts', JSON.stringify(_focusTimerStarts)); } catch {}
}

export function _formatFocusTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

export function _focusTimerElapsed() {
  const start = _focusTimerStarts[_focusTimerDomain];
  return start ? Date.now() - start : 0;
}

export function _startFocusTimer(domain, warnMinutes) {
  // Preserve existing start time for this domain (don't reset on SPA nav or tab switch)
  if (!_focusTimerStarts[domain]) {
    _focusTimerStarts[domain] = Date.now();
    _persistFocusTimerStarts();
  }
  _focusTimerDomain = domain;
  _focusTimerWarnMinutes = warnMinutes || 0;
  if (!_focusTimerInterval) {
    _focusTimerInterval = setInterval(_updateFocusTimerPill, 1000);
  }
  _updateFocusTimerPill();
}

export function _hideFocusTimerPill() {
  if (_focusTimerInterval) { clearInterval(_focusTimerInterval); _focusTimerInterval = null; }
  _focusTimerDomain = '';
  const el = document.getElementById('pill-focus-timer');
  if (el) { el.classList.remove('active', 'warn'); el.textContent = ''; }
}

export function _updateFocusTimerPill() {
  const el = document.getElementById('pill-focus-timer');
  if (!el || !_focusTimerDomain) return;
  const elapsed = _focusTimerElapsed();
  el.textContent = _formatFocusTime(elapsed);
  el.classList.add('active');
  if (_focusTimerWarnMinutes > 0 && elapsed >= _focusTimerWarnMinutes * 60 * 1000) {
    el.classList.add('warn');
  } else {
    el.classList.remove('warn');
  }
}

export function _checkFocusTimer(url) {
  const match = _doomScrollMatch(url);
  if (match && match.mode === 'nudge') {
    _startFocusTimer(match.domain, match.minutes);
  } else {
    _hideFocusTimerPill();
  }
}


// ── Download Manager ──
export const DOWNLOAD_RETENTION_MS = 60 * 60 * 1000; // 1 hour

export let _browseDownloads = []; // { id, filename, url, state: 'progressing'|'completed'|'cancelled', receivedBytes, totalBytes, startTime }
export let _browseDownloadIdCounter = 0;
export let _browseDownloadsLastSeenCount = 0;

export function _loadBrowseDownloads() {
  try {
    const saved = Settings.getJSON('browseDownloads', []);
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    _browseDownloads = saved.filter(d => d.startTime > oneHourAgo);
    // Find max ID
    _browseDownloads.forEach(d => {
      const num = parseInt(d.id.replace('dl-', ''));
      if (num > _browseDownloadIdCounter) _browseDownloadIdCounter = num;
    });
    // Load last seen count
    const lastSeen = parseInt(Settings.get('browseDownloadsLastSeen') || '0');
    _browseDownloadsLastSeenCount = Math.min(lastSeen, _browseDownloads.length);
  } catch (e) {
    _browseDownloads = [];
  }
}

export function _saveBrowseDownloads() {
  try {
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    const toSave = _browseDownloads.filter(d => d.startTime > oneHourAgo);
    Settings.setJSON('browseDownloads', toSave);
    // Save last seen count
    Settings.set('browseDownloadsLastSeen', _browseDownloadsLastSeenCount.toString());
  } catch (e) {}
}

// Initialize downloads on load
_loadBrowseDownloads();
// Update UI after a short delay (DOM may not be ready)
setTimeout(() => {
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
}, 100);

export function _browseUpdateDownloadBadge() {
  const btn = document.getElementById('browse-downloads-btn');
  const badge = document.getElementById('browse-download-badge');
  const ring = document.getElementById('browse-download-progress-ring');

  const count = _browseDownloads.length;
  const newDownloads = count - _browseDownloadsLastSeenCount;

  // Show/hide download button
  if (btn) btn.style.display = count > 0 ? 'block' : 'none';

  // Show badge only for new downloads
  if (badge) {
    if (newDownloads > 0) {
      badge.textContent = newDownloads > 99 ? '99+' : newDownloads;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Show progress ring only for new active downloads
  if (ring) {
    const hasNewActive = newDownloads > 0 && _browseDownloads.some(d => d.state === 'progressing');
    ring.style.display = hasNewActive ? 'block' : 'none';
  }

  // Dynamic Island: show download progress (persists until dismissed)
  if (typeof islandUpdate === 'function') {
    const active = _browseDownloads.filter(d => d.state === 'progressing');
    const completed = _browseDownloads.filter(d => d.state === 'completed');
    const total = _browseDownloads.length;
    if (total > 0) {
      const items = _browseDownloads.map(d => ({
        id: d.id,
        filename: d.filename || 'Download',
        state: d.state,
        pct: d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0,
        size: d.totalBytes > 0 ? _formatBytes(d.totalBytes) : '',
        received: _formatBytes(d.receivedBytes || 0)
      }));
      const dlData = { type: 'download', items: items, dismiss: function() { islandRemove('download'); } };
      if (active.length > 0) {
        const dl = active[0];
        const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
        const name = dl.filename || 'Download';
        dlData.label = active.length > 1 ? active.length + ' downloading' : pct + '%';
        dlData.detail = active.length > 1 ? active.length + ' downloading · ' + completed.length + ' done' : name + ' · ' + pct + '%';
        dlData.progress = pct;
      } else {
        dlData.label = total === 1 ? '1 download' : total + ' downloads';
        dlData.detail = total === 1 ? completed[0].filename : total + ' downloads complete';
      }
      islandUpdate('download', dlData);
    } else {
      islandRemove('download');
    }
  }
}

export function _browseRenderDownloads() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (_browseDownloads.length === 0) {
    AetherUI.mount(
      new View('div').className('browse-downloads-empty')._bindText('No downloads'),
      dropdown
    );
    return;
  }

  var completedSvg = '<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  var fileSvg = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';
  var folderSvg = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>';
  var closeSvg = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var clearBtn = new View('button').className('browse-downloads-clear')._bindText('Clear all')
    .onTap(function(e) { e.stopPropagation(); clearBrowseDownloads(); });
  var header = HStack([
    new View('span').className('browse-downloads-title')._bindText('Downloads'),
    clearBtn
  ]).className('browse-downloads-header');

  var items = [header];
  for (var i = 0; i < _browseDownloads.length; i++) {
    (function(dl) {
      var icon = RawHTML(dl.state === 'completed' ? completedSvg : fileSvg).className('browse-download-item-icon');

      var pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
      var size = dl.totalBytes > 0 ? _formatBytes(dl.totalBytes) : '';
      var status = dl.state === 'completed' ? 'Completed' + (size ? ' \u00b7 ' + size : '')
        : dl.state === 'cancelled' ? 'Cancelled'
        : pct + '% \u00b7 ' + _formatBytes(dl.receivedBytes) + (dl.totalBytes > 0 ? ' / ' + size : '');

      var infoChildren = [
        new View('div').className('browse-download-item-name')._bindText(escapeHtml(dl.filename)),
        new View('div').className('browse-download-item-status')._bindText(status)
      ];
      if (dl.state === 'progressing') {
        var bar = new View('div').className('browse-download-item-progress-bar').styles({ width: pct + '%' });
        infoChildren.push(new View('div').className('browse-download-item-progress')._appendChildren([bar]));
      }
      var info = VStack(infoChildren).className('browse-download-item-info');

      var actionChildren = [];
      if (dl.state === 'completed') {
        actionChildren.push(
          new View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Show in folder')
            .onTap(function(e) { e.stopPropagation(); showDownloadInFolder(dl.id); })
            ._appendChildren([RawHTML(folderSvg)])
        );
      }
      actionChildren.push(
        new View('button').className('nr-btn nr-btn-ghost nr-btn-sm').attr('title', 'Remove')
          .onTap(function(e) { e.stopPropagation(); removeBrowseDownload(dl.id); })
          ._appendChildren([RawHTML(closeSvg)])
      );
      var actions = HStack(actionChildren).className('browse-download-item-actions');

      var row = HStack([icon, info, actions]).className('browse-download-item')
        .onTap(function() { openDownloadFile(dl.id); });
      items.push(row);
    })(_browseDownloads[i]);
  }

  AetherUI.mount(VStack(items), dropdown);
  dropdown.onclick = function(e) { e.stopPropagation(); };
}

export function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function _closeBrowseDownloadsDropdown() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  document.removeEventListener('click', _closeBrowseDownloadsOnClick);
  window.removeEventListener('blur', _closeBrowseDownloadsOnBlur);
}

export function toggleBrowseDownloads(event) {
  if (event) event.stopPropagation();

  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (dropdown.style.display === 'none') {
    _browseRenderDownloads();
    dropdown.style.display = 'block';

    // Mark all downloads as seen
    _browseDownloadsLastSeenCount = _browseDownloads.length;
    _saveBrowseDownloads();

    const badge = document.getElementById('browse-download-badge');
    if (badge) badge.style.display = 'none';

    // Add close listeners
    requestAnimationFrame(() => {
      document.addEventListener('click', _closeBrowseDownloadsOnClick);
    });
    window.addEventListener('blur', _closeBrowseDownloadsOnBlur);
  } else {
    _closeBrowseDownloadsDropdown();
  }
}

export function _closeBrowseDownloadsOnClick(e) {
  const btn = document.getElementById('browse-downloads-btn');
  if (btn && !btn.contains(e.target)) {
    _closeBrowseDownloadsDropdown();
  }
}

export function _closeBrowseDownloadsOnBlur() {
  _closeBrowseDownloadsDropdown();
}

export function clearBrowseDownloads() {
  _browseDownloads = [];
  _browseDownloadsLastSeenCount = 0;
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

export function removeBrowseDownload(id) {
  _browseDownloads = _browseDownloads.filter(d => d.id !== id);
  // Adjust seen count if we're below it
  if (_browseDownloads.length < _browseDownloadsLastSeenCount) {
    _browseDownloadsLastSeenCount = _browseDownloads.length;
  }
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

export function openDownloadFile(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (dl && dl.state === 'completed' && dl.savePath && window.electronAPI) {
    window.electronAPI.openPath(dl.savePath);
  }
}

export function showDownloadInFolder(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (!dl) return;
  if (dl.savePath && window.electronAPI) {
    window.electronAPI.showItemInFolder(dl.savePath);
  } else if (dl.filename) {
    apiPost('/api/reveal-in-finder', { filename: dl.filename }).catch(() => {});
  }
}

// Initialize download event listeners from Electron main process
export let _downloadsInitialized = false;

export function _initBrowseDownloads() {
  if (!window.electronAPI) return;
  if (_downloadsInitialized) return;
  _downloadsInitialized = true;

  // Listen for download-started event
  if (window.electronAPI.onDownloadStarted) {
    window.electronAPI.onDownloadStarted((event, data) => {
      const dl = {
        id: data.id,
        filename: data.filename || 'download',
        url: data.url || '',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: data.totalBytes || 0,
        startTime: Date.now(),
        savePath: data.savePath || ''
      };
      _browseDownloads.unshift(dl);
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    });
  }

  // Listen for download-progress event
  if (window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.receivedBytes = data.receivedBytes || 0;
        dl.totalBytes = data.totalBytes || dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }

  // Listen for download-completed event
  if (window.electronAPI.onDownloadCompleted) {
    window.electronAPI.onDownloadCompleted((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.state = data.state || 'completed';
        dl.savePath = data.savePath || dl.savePath;
        dl.receivedBytes = dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }
}

// Initialize downloads on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { _initBrowseDownloads(); });
} else {
  _initBrowseDownloads();
}

export function _browseHandleNavigation(tab, frame) {
  frame.addEventListener('did-navigate', (e) => {
    // Restore original file:// URL when navigating through the local-file proxy
    const navUrl = (e.url.includes('/api/local-file?path=') && frame.dataset.originalUrl)
      ? frame.dataset.originalUrl : e.url;
    // Doom scroll: block mode — intercept before anything else (unless bypassed)
    const _dsMatch = _doomScrollMatch(navUrl);
    if (_dsMatch && _dsMatch.mode === 'block' && !_doomScrollBypass.has(_dsMatch.domain)) {
      _browseShowBlockedPage(tab, frame, navUrl, _dsMatch.domain);
      return;
    }
    // Track history stacks for back/forward dropdown
    const _prevUrl = tab.url;
    if (_prevUrl && _prevUrl !== navUrl && _prevUrl !== 'about:blank') {
      if (!tab.backStack) tab.backStack = [];
      if (!tab.forwardStack) tab.forwardStack = [];
      const dir = typeof _browseNavDirection !== 'undefined' ? _browseNavDirection : null;
      if (dir === 'back') {
        tab.forwardStack.push(_prevUrl);
        // backStack already popped by webview.goBack()
      } else if (dir === 'forward') {
        tab.backStack.push(_prevUrl);
        // forwardStack already popped by webview.goForward()
      } else {
        tab.backStack.push(_prevUrl);
        tab.forwardStack.length = 0;
      }
    }
    if (typeof _browseNavDirection !== 'undefined') _browseNavDirection = null;

    tab.url = navUrl;
    tab.title = _browseTitleFromUrl(navUrl);
    tab.favicon = _browseFaviconUrl(navUrl);
    tab.blank = false;
    _pwAutofillOffered.delete(tab.id);
    // Re-show save prompt after navigation if credentials were just captured
    if (_pwPendingPrompt && _pwPendingPrompt.tab.id === tab.id && Date.now() - _pwPendingPrompt.ts < 15000) {
      const pending = _pwPendingPrompt;
      _pwHideSavePrompt();
      setTimeout(() => _pwShowSavePrompt(pending.tab, pending.data), 100);
    } else {
      _pwHideSavePrompt();
    }
    _saveBrowseVisit(navUrl, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
    _browseCollapseEmptyWindows();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      _browseSetUrlDisplay(urlInput, navUrl);
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(navUrl);
    }
    // Clear RSS feeds and scroll pill on navigation
    tab.rssFeeds = null;
    _browseUpdateRssPill(tab);
    if (tab.id === _browseActiveTab) { _browseUpdateScrollPill(-1); _browseUpdateTokenCount(0); }
    // Focus timer: start/stop based on current site
    if (tab.id === _browseActiveTab) _checkFocusTimer(navUrl);
    // Clear any existing annotation state for this tab on navigation
    _annotationsEnabled.delete(tab.id);
    _updateAnnotateButtonState();
    // Show annotate offer pill for the new page (user clicks to annotate)
    if (_browseActiveTab === tab.id && typeof _showAnnotateOfferPill === 'function') _showAnnotateOfferPill(tab);
    // Academic paper: re-inject on navigation
    if (typeof _paperOnPageLoad === 'function') _paperOnPageLoad(tab, frame);
    // Adblock: reset count for this webview on navigation
    if (window.electronAPI && window.electronAPI.adblockResetCount && typeof frame.getWebContentsId === 'function') {
      try { window.electronAPI.adblockResetCount(frame.getWebContentsId()); } catch {}
    }
    // YouTube: inject ad-block CSS immediately on navigation (before dom-ready / first paint)
    _browseInjectYouTubeCSS(frame, navUrl);
    // Reset insight pill to offer state on navigation (don't remove it)
    if (typeof _showAnnotateOfferPill === 'function' && tab.id === _browseActiveTab) _showAnnotateOfferPill(tab);
    // Update nav buttons so back/forward reflect history stacks
    if (typeof _updateIslandNavButtons === 'function') _updateIslandNavButtons();
    // Clear adaptive color on navigation (will re-extract on did-finish-load)
    tab.themeColor = null;
    if (_browseActiveTab === tab.id && typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
  });
  frame.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const sameOrigin = tab.url && e.url && _browseUrlDomain(tab.url) === _browseUrlDomain(e.url);
    // Track history for in-page (SPA) navigations
    const _prevUrl = tab.url;
    if (_prevUrl && _prevUrl !== e.url && _prevUrl !== 'about:blank') {
      if (!tab.backStack) tab.backStack = [];
      if (!tab.forwardStack) tab.forwardStack = [];
      const dir = typeof _browseNavDirection !== 'undefined' ? _browseNavDirection : null;
      if (dir === 'back') {
        tab.forwardStack.push(_prevUrl);
      } else if (dir === 'forward') {
        tab.backStack.push(_prevUrl);
      } else {
        tab.backStack.push(_prevUrl);
        tab.forwardStack.length = 0;
      }
    }
    if (typeof _browseNavDirection !== 'undefined') _browseNavDirection = null;

    tab.url = e.url;
    // Keep real title for same-origin in-page navigations (hash/pushState)
    if (!sameOrigin || !tab.title || tab.title === _browseTitleFromUrl(tab.url)) {
      tab.title = _browseTitleFromUrl(e.url);
    }
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      _browseSetUrlDisplay(urlInput, e.url);
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
    // YouTube: re-inject ad-block CSS on SPA navigation
    _browseInjectYouTubeCSS(frame, e.url);
    // Focus timer: check on SPA navigation (don't reset for same domain)
    if (tab.id === _browseActiveTab) _checkFocusTimer(e.url);
    // Update nav buttons so back/forward reflect history stacks
    if (typeof _updateIslandNavButtons === 'function') _updateIslandNavButtons();
  });
  frame.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    // Update the most recent browse history entry with the real title
    if (tab.url) _saveBrowseVisit(tab.url, tab.title);
    _browseRenderTabs();
    _browseSaveTabs();
    // Refresh shortened URL display with new title
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput && document.activeElement !== urlInput) _browseSetUrlDisplay(urlInput, tab.url);
    }
  });
  frame.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length) tab.favicon = e.favicons[0];
    _browseRenderTabs();
  });
  frame.addEventListener('new-window', (e) => {
    e.preventDefault();
    browseNewTab(e.url);
  });

  // Audio tracking
  frame.addEventListener('media-started-playing', () => {
    // Find which window this tab belongs to
    const winId = _browseWindows.find(w => w.tabs.some(t => t.id === tab.id))?.id;
    if (winId) {
      _browseAudioTabs.set(tab.id, { windowId: winId, muted: false });
      _browseRenderTabs();
      _updateAudioIndicator();
    }
  });
  frame.addEventListener('media-paused', () => {
    _browseAudioTabs.delete(tab.id);
    _ccPillDismissed = false;
    if (_ccTabId === tab.id) stopCaptions();
    _browseRenderTabs();
    _updateAudioIndicator();
  });

  // ── Error page handling (site not found, 404, etc.) ──
  frame.addEventListener('did-fail-load', (e) => {
    // Ignore aborted loads (user navigated away), subframe errors, and cancelled requests
    if (e.errorCode === -3 || e.errorCode === -27 || !e.isMainFrame) return;
    const failedUrl = e.validatedURL || tab.url || '';
    _browseShowErrorPage(tab, frame, failedUrl, e.errorDescription || 'Site not found', e.errorCode);
  });

  // Detect HTTP error pages (404, 500, etc.) after load finishes
  if (_browseIsElectron) {
    frame.addEventListener('did-finish-load', () => {
      try {
        frame.executeJavaScript(
          `(() => { try { return { status: document.querySelector('title')?.textContent || '', body: document.body?.innerText?.substring(0, 500) || '' }; } catch(e) { return null; } })()`
        ).then(info => {
          if (!info) return;
          const title = (info.status || '').toLowerCase();
          const body = (info.body || '').toLowerCase();
          const is404 = /\b404\b/.test(title) || /\b404\b.*not found/.test(body) || /not found/.test(title);
          const isError = /\b(502|503|504)\b/.test(title) || /\b(bad gateway|service unavailable|gateway timeout)\b/.test(body);
          if (is404 || isError) {
            const code = is404 ? 404 : 0;
            const desc = is404 ? 'Page not found (404)' : 'Server error';
            _browseShowErrorPage(tab, frame, tab.url, desc, code);
          }
        }).catch(() => {});
      } catch {}
      // Show annotate offer pill (user clicks to trigger annotation)
      if (typeof _showAnnotateOfferPill === 'function' && tab.id === _browseActiveTab) {
        _showAnnotateOfferPill(tab);
      }
      // Academic paper detection & metadata extraction
      if (typeof _paperOnPageLoad === 'function') {
        _paperOnPageLoad(tab, frame);
      }
      // Extract page color for adaptive URL bar (theme-color meta > body bg > html bg)
      try {
        frame.executeJavaScript(
          `(() => {
            try {
              const meta = document.querySelector('meta[name="theme-color"]');
              if (meta && meta.content) return meta.content;
              const bodyBg = getComputedStyle(document.body).backgroundColor;
              if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') return bodyBg;
              const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
              if (htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent') return htmlBg;
              return null;
            } catch(e) { return null; }
          })()`
        ).then(color => {
          if (color) tab.themeColor = color;
          if (_browseActiveTab === tab.id && typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
        }).catch(() => {});
      } catch {}
    });
  }

}

// Chromium net error codes -> user-friendly error info
export var _browseErrorMap = {
  // DNS
  '-105': { id: 'NAME_NOT_RESOLVED',   title: 'This site can\u2019t be reached', desc: 'DNS address could not be found for <strong>%DOMAIN%</strong>.', icon: 'dns',    suggestions: ['Check the URL for typos', 'Check your internet connection', 'Try disabling your VPN or proxy'] },
  '-118': { id: 'CONNECTION_TIMED_OUT', title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['Check your internet connection', 'Check any firewall or proxy settings', 'Try again later'] },
  '-137': { id: 'NAME_RESOLUTION_FAILED', title: 'This site can\u2019t be reached', desc: 'DNS resolution failed for <strong>%DOMAIN%</strong>.', icon: 'dns', suggestions: ['Check the URL for typos', 'Try flushing your DNS cache', 'Check your DNS settings'] },
  // Connection
  '-2':   { id: 'FAILED',              title: 'This site can\u2019t be reached', desc: 'An unexpected network error occurred.', icon: 'offline', suggestions: ['Check your internet connection', 'Try again later'] },
  '-6':   { id: 'FILE_NOT_FOUND',      title: 'File not found', desc: 'The requested file was not found.', icon: '404', suggestions: ['Check the file path', 'The file may have been moved or deleted'] },
  '-7':   { id: 'TIMED_OUT',           title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['Check your internet connection', 'The site may be down \u2014 try again later'] },
  '-15':  { id: 'SOCKET_NOT_CONNECTED', title: 'This site can\u2019t be reached', desc: 'The socket is not connected.', icon: 'offline', suggestions: ['Check your internet connection', 'Try reloading the page'] },
  '-21':  { id: 'NETWORK_CHANGED',     title: 'Connection interrupted', desc: 'Your network connection changed while loading.', icon: 'offline', suggestions: ['Check your Wi-Fi or network connection', 'Try reloading the page'] },
  '-100': { id: 'CONNECTION_CLOSED',    title: 'This site can\u2019t be reached', desc: 'The connection to <strong>%DOMAIN%</strong> was unexpectedly closed.', icon: 'offline', suggestions: ['The site may be experiencing issues', 'Try again later'] },
  '-101': { id: 'CONNECTION_RESET',     title: 'This site can\u2019t be reached', desc: 'The connection was reset.', icon: 'offline', suggestions: ['Check your internet connection', 'The site may be blocking your request', 'Try disabling your VPN'] },
  '-102': { id: 'CONNECTION_REFUSED',   title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> refused to connect.', icon: 'refused', suggestions: ['The site may be down for maintenance', 'Check if a firewall is blocking access', 'Try again later'] },
  '-104': { id: 'CONNECTION_FAILED',    title: 'This site can\u2019t be reached', desc: 'Failed to establish a connection to <strong>%DOMAIN%</strong>.', icon: 'offline', suggestions: ['Check your internet connection', 'The site may be temporarily unavailable'] },
  '-106': { id: 'INTERNET_DISCONNECTED', title: 'No internet', desc: 'You\u2019re not connected to the internet.', icon: 'offline', suggestions: ['Check your Wi-Fi or ethernet connection', 'Check your router', 'Try connecting to a different network'] },
  '-109': { id: 'ADDRESS_UNREACHABLE', title: 'This site can\u2019t be reached', desc: '<strong>%DOMAIN%</strong> is unreachable.', icon: 'offline', suggestions: ['Check the URL', 'The server may be on a private network'] },
  '-110': { id: 'SSL_PROTOCOL_ERROR',  title: 'This site can\u2019t provide a secure connection', desc: '<strong>%DOMAIN%</strong> sent an invalid response.', icon: 'ssl', suggestions: ['The site may be using an unsupported protocol', 'Try again later'] },
  '-111': { id: 'DNS_CACHE_MISS',      title: 'This site can\u2019t be reached', desc: 'DNS lookup for <strong>%DOMAIN%</strong> failed.', icon: 'dns', suggestions: ['Try reloading the page', 'Check your DNS settings'] },
  '-112': { id: 'ADDRESS_INVALID',     title: 'This site can\u2019t be reached', desc: 'The server address is invalid.', icon: 'offline', suggestions: ['Check the URL for typos'] },
  // SSL/TLS
  '-200': { id: 'CERT_COMMON_NAME_INVALID', title: 'Your connection is not private', desc: 'The certificate for <strong>%DOMAIN%</strong> doesn\u2019t match the domain.', icon: 'ssl', suggestions: ['The site may be misconfigured', 'Don\u2019t enter any sensitive information', 'You could try the HTTP version'] },
  '-201': { id: 'CERT_DATE_INVALID',   title: 'Your connection is not private', desc: 'The security certificate for <strong>%DOMAIN%</strong> has expired.', icon: 'ssl', suggestions: ['Check that your system clock is correct', 'The site\u2019s certificate may need renewal'] },
  '-202': { id: 'CERT_AUTHORITY_INVALID', title: 'Your connection is not private', desc: 'The certificate authority is not trusted.', icon: 'ssl', suggestions: ['The certificate may be self-signed', 'Don\u2019t enter sensitive information on this site'] },
  '-204': { id: 'CERT_INVALID',        title: 'Your connection is not private', desc: 'The server\u2019s security certificate is not valid.', icon: 'ssl', suggestions: ['Attackers might be trying to steal your information', 'Don\u2019t proceed unless you trust this site'] },
  // HTTP errors
  '403':  { id: 'HTTP_403_FORBIDDEN',  title: 'Access denied', desc: 'You don\u2019t have permission to view this page on <strong>%DOMAIN%</strong>.', icon: '403', suggestions: ['You may need to sign in', 'The site may restrict access to certain regions', 'Contact the site owner if you think this is an error'] },
  '404':  { id: 'HTTP_404_NOT_FOUND',  title: 'Page not found', desc: 'The page you were looking for on <strong>%DOMAIN%</strong> doesn\u2019t exist.', icon: '404', suggestions: ['Check the URL for typos', 'The page may have been moved or deleted', 'Try searching the site directly'] },
  '410':  { id: 'HTTP_410_GONE',       title: 'Page gone', desc: 'This page has been permanently removed.', icon: '404', suggestions: ['The content has been intentionally deleted', 'Try the Wayback Machine for an archived version'] },
  '429':  { id: 'HTTP_429_TOO_MANY',   title: 'Too many requests', desc: 'You\u2019ve been rate limited by <strong>%DOMAIN%</strong>.', icon: 'timeout', suggestions: ['Wait a few minutes before trying again', 'Reduce how frequently you visit this page'] },
  '500':  { id: 'HTTP_500_SERVER',     title: 'Server error', desc: '<strong>%DOMAIN%</strong> encountered an internal error.', icon: 'server', suggestions: ['This is a problem on the site\u2019s end', 'Try again in a few minutes', 'If it persists, contact the site owner'] },
  '502':  { id: 'HTTP_502_BAD_GATEWAY', title: 'Bad gateway', desc: '<strong>%DOMAIN%</strong> received an invalid response from an upstream server.', icon: 'server', suggestions: ['The site may be under heavy load', 'Try again in a few minutes'] },
  '503':  { id: 'HTTP_503_UNAVAILABLE', title: 'Service unavailable', desc: '<strong>%DOMAIN%</strong> is temporarily down for maintenance.', icon: 'server', suggestions: ['The site is likely undergoing maintenance', 'Try again later'] },
  '504':  { id: 'HTTP_504_TIMEOUT',    title: 'Gateway timeout', desc: '<strong>%DOMAIN%</strong> took too long to respond.', icon: 'timeout', suggestions: ['The site may be experiencing heavy traffic', 'Try again in a few minutes'] },
};

export function _browseShowErrorPage(tab, frame, failedUrl, errorDesc, errorCode) {
  const isDark = document.documentElement.classList.contains('dark') || Settings.get('theme') === 'dark';
  const cs = getComputedStyle(document.documentElement);
  const v = function(n, fb) { return cs.getPropertyValue(n).trim() || fb; };
  const bgBody    = v('--bg-body',     isDark ? '#0a0a0a' : '#f5f5f5');
  const bgCard    = v('--bg-card',     isDark ? '#151515' : '#fff');
  const bgHover   = v('--bg-hover',    isDark ? '#1e1e1e' : '#f0f0f0');
  const textPri   = v('--text-primary',isDark ? '#e0e0e0' : '#333');
  const textMuted = v('--text-muted',  isDark ? '#777'    : '#666');
  const textDim   = v('--text-dim',    isDark ? '#555'    : '#888');
  const textDimmer= v('--text-dimmer', isDark ? '#444'    : '#999');
  const borderCard= v('--border-card', isDark ? '#222'    : '#e0e0e0');
  const borderSub = v('--border-subtle',isDark ? '#252525': '#e0e0e0');
  const accent    = v('--accent',      '#b4451a');
  const accentHov = v('--accent-hover','#c9562a');

  const safeUrl = (failedUrl || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  let domain = '';
  try { domain = new URL(failedUrl).hostname; } catch(e) { domain = (failedUrl || '').replace(/^https?:\/\//, '').split('/')[0]; }
  const safeDomain = domain.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const waybackUrl = 'https://web.archive.org/web/*/' + encodeURIComponent(failedUrl || '');
  const searchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(domain);
  const googleCacheUrl = 'https://webcache.googleusercontent.com/search?q=cache:' + encodeURIComponent(failedUrl || '');

  // Look up error info
  let errInfo = _browseErrorMap[String(errorCode)];
  if (!errInfo) {
    const isSSL = errorCode <= -200 && errorCode >= -210;
    errInfo = {
      id: 'ERR_' + (errorCode || 'UNKNOWN'),
      title: isSSL ? 'Your connection is not private' : 'This site can\u2019t be reached',
      desc: errorDesc || 'An unexpected error occurred while loading <strong>%DOMAIN%</strong>.',
      icon: isSSL ? 'ssl' : 'offline',
      suggestions: ['Check your internet connection', 'Try again later']
    };
  }
  const desc = errInfo.desc.replace(/%DOMAIN%/g, safeDomain);

  // SVG icons (match app aesthetic, no emoji)
  const icons = {
    'dns':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="30" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="36" r="4" fill="' + textDim + '"/><path d="M36 6v60M6 36h60" stroke="' + textDim + '" stroke-width="1" opacity=".25"/><ellipse cx="36" cy="36" rx="16" ry="30" stroke="' + textDim + '" stroke-width="1.2" fill="none"/><path d="M10 24h52M10 48h52" stroke="' + textDim + '" stroke-width=".8" opacity=".2"/><line x1="10" y1="10" x2="62" y2="62" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'offline': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><path d="M14 50a24 24 0 0144 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".25"/><path d="M22 44a16 16 0 0128 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".4"/><path d="M30 38a8 8 0 0112 0" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".6"/><circle cx="36" cy="50" r="3" fill="' + textDim + '"/><line x1="12" y1="12" x2="60" y2="60" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'timeout': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="38" r="26" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><path d="M36 20v20l12 7" stroke="' + textDim + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 8h16" stroke="' + textDim + '" stroke-width="1.5" stroke-linecap="round"/></svg>',
    'refused': '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="20" y="16" width="32" height="40" rx="4" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><line x1="20" y1="32" x2="52" y2="32" stroke="' + textDim + '" stroke-width="1"/><circle cx="36" cy="44" r="3" fill="' + textDim + '"/><line x1="12" y1="10" x2="60" y2="62" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/></svg>',
    'ssl':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="22" y="32" width="28" height="24" rx="3" stroke="' + accent + '" stroke-width="1.5" fill="none"/><path d="M28 32v-6a8 8 0 0116 0v6" stroke="' + accent + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="44" r="2.5" fill="' + accent + '"/><line x1="36" y1="47" x2="36" y2="51" stroke="' + accent + '" stroke-width="1.5" stroke-linecap="round"/><path d="M20 16l-4 4M52 16l4 4" stroke="' + accent + '" stroke-width="1.5" stroke-linecap="round" opacity=".6"/></svg>',
    '404':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="28" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><text x="36" y="44" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="600" fill="' + textDim + '">404</text></svg>',
    '403':     '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><circle cx="36" cy="36" r="28" stroke="' + accent + '" stroke-width="1.5" fill="none"/><rect x="30" y="22" width="12" height="16" rx="6" stroke="' + accent + '" stroke-width="1.5" fill="none"/><rect x="26" y="36" width="20" height="16" rx="3" stroke="' + accent + '" stroke-width="1.5" fill="none"/><circle cx="36" cy="44" r="2" fill="' + accent + '"/></svg>',
    'server':  '<svg width="72" height="72" viewBox="0 0 72 72" fill="none"><rect x="16" y="14" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><rect x="16" y="32" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none"/><rect x="16" y="50" width="40" height="14" rx="3" stroke="' + textDim + '" stroke-width="1.5" fill="none" opacity=".35"/><circle cx="24" cy="21" r="2" fill="' + textDim + '"/><circle cx="24" cy="39" r="2" fill="' + textDim + '"/><circle cx="24" cy="57" r="2" fill="' + textDim + '" opacity=".35"/><line x1="48" y1="21" x2="42" y2="21" stroke="' + textDim + '" stroke-width="1" stroke-linecap="round" opacity=".4"/><line x1="48" y1="39" x2="42" y2="39" stroke="' + textDim + '" stroke-width="1" stroke-linecap="round" opacity=".4"/></svg>',
  };
  const iconSvg = icons[errInfo.icon] || icons['offline'];

  const suggestionsHtml = errInfo.suggestions.map(function(s) {
    return '<li>' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</li>';
  }).join('');

  const errId = errInfo.id || ('ERR_' + errorCode);

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'background:' + bgBody + ';color:' + textPri + ';display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 24px}' +
    '.ep{max-width:520px;width:100%}' +
    '.ep-top{display:flex;align-items:flex-start;gap:24px;margin-bottom:20px}' +
    '.ep-icon{flex-shrink:0;opacity:.85}' +
    '.ep-text{flex:1;min-width:0}' +
    '.ep-title{font-size:20px;font-weight:600;margin-bottom:6px;line-height:1.3}' +
    '.ep-desc{font-size:13px;color:' + textMuted + ';line-height:1.5;margin-bottom:6px}' +
    '.ep-desc strong{color:' + textPri + ';font-weight:500}' +
    '.ep-id{font-size:11px;color:' + textDimmer + ';font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;margin-bottom:2px}' +
    '.ep-card{background:' + bgCard + ';border:1px solid ' + borderCard + ';border-radius:10px;padding:14px 18px;margin-bottom:16px}' +
    '.ep-card-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:' + textDim + ';margin-bottom:10px}' +
    '.ep-suggestions{list-style:none;padding:0}' +
    '.ep-suggestions li{font-size:13px;color:' + textMuted + ';padding:3px 0 3px 16px;position:relative;line-height:1.5}' +
    '.ep-suggestions li::before{content:"";position:absolute;left:0;top:11px;width:5px;height:5px;border-radius:50%;background:' + borderSub + '}' +
    '.ep-actions{display:flex;gap:8px;flex-wrap:wrap}' +
    'a.ep-btn,button.ep-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid ' + borderCard + ';' +
      'background:' + bgCard + ';color:' + textPri + ';font-size:12.5px;cursor:pointer;text-decoration:none;transition:border-color .15s,color .15s,background .15s;font-family:inherit;line-height:1.4}' +
    'a.ep-btn:hover,button.ep-btn:hover{background:' + bgHover + ';border-color:' + accent + ';color:' + accent + '}' +
    '.ep-btn.primary{background:' + accent + ';color:#fff;border-color:' + accent + '}' +
    '.ep-btn.primary:hover{background:' + accentHov + ';color:#fff}' +
    '.ep-btn svg{width:13px;height:13px;flex-shrink:0}' +
    '.ep-details{margin-top:14px}' +
    '.ep-details summary{font-size:11.5px;color:' + textDim + ';cursor:pointer;user-select:none}' +
    '.ep-details summary:hover{color:' + textMuted + '}' +
    '.ep-details-body{margin-top:8px;font-size:11px;color:' + textDimmer + ';font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;line-height:1.7;word-break:break-all}' +
  '</style></head><body>' +
  '<div class="ep">' +
    '<div class="ep-top">' +
      '<div class="ep-icon">' + iconSvg + '</div>' +
      '<div class="ep-text">' +
        '<div class="ep-title">' + errInfo.title.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>' +
        '<div class="ep-desc">' + desc + '</div>' +
        '<div class="ep-id">' + errId + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ep-card">' +
      '<div class="ep-card-title">Try this</div>' +
      '<ul class="ep-suggestions">' + suggestionsHtml + '</ul>' +
    '</div>' +
    '<div class="ep-actions">' +
      '<button class="ep-btn primary" onclick="location.reload()">' +
        '<svg viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0110.89-3.48M14 2v4h-4M14 8a6 6 0 01-10.89 3.48M2 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        'Reload</button>' +
      '<a class="ep-btn" href="' + waybackUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 4v4.5l3 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Wayback Machine</a>' +
      '<a class="ep-btn" href="' + searchUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Search</a>' +
      '<a class="ep-btn" href="' + googleCacheUrl + '">' +
        '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
        'Cached</a>' +
    '</div>' +
    '<details class="ep-details">' +
      '<summary>Details</summary>' +
      '<div class="ep-details-body">' +
        errId + (errorCode ? ' (' + errorCode + ')' : '') + '<br>' +
        (errorDesc ? errorDesc.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '<br>' : '') +
        safeUrl +
      '</div>' +
    '</details>' +
  '</div></body></html>';

  if (_browseIsElectron) {
    try { frame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch {}
  } else {
    frame.srcdoc = html;
  }
  tab.title = errInfo.title;
  tab.errorPage = true;
  _browseRenderTabs();
}

export var _ytAdBlockCSS =
  '#player-ads,' +
  '.ytp-ad-module,' +
  '.ytp-ad-overlay-container,' +
  '.ytp-ad-overlay-slot,' +
  '.ytp-ad-image-overlay,' +
  'ytd-promoted-sparkles-web-renderer,' +
  'ytd-display-ad-renderer,' +
  'ytd-ad-slot-renderer,' +
  'ytd-in-feed-ad-layout-renderer,' +
  'ytd-banner-promo-renderer,' +
  'ytd-statement-banner-renderer,' +
  '#masthead-ad,' +
  '#feedmodule-ad,' +
  '.ytd-rich-item-renderer[is-ad],' +
  'ytd-promoted-video-renderer,' +
  'tp-yt-paper-dialog.ytd-enforcement-message-view-model,' +
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]' +
  '{display:none!important}' +
  '#movie_player.ad-showing video,#movie_player.ad-interrupting video{opacity:0!important}' +
  '#movie_player.ad-showing .ytp-chrome-bottom{opacity:0!important}' +
  '.ytp-ad-text,.ytp-ad-preview-container,.ytp-ad-badge,.ytp-ad-visit-advertiser-button{display:none!important}';

// Inject YouTube ad-block CSS + early mute (before JS runs, hides from first paint)
export function _browseInjectYouTubeCSS(frame, url) {
  if (!url || !url.includes('youtube.com')) return;
  if (Settings.get('adBlockEnabled') !== 'true') return;
  frame.insertCSS(_ytAdBlockCSS).catch(function(){});
  // Mute video elements immediately so ad audio never plays
  frame.executeJavaScript(`(function(){
    if(window.__aetherYtEarlyMute) return;
    window.__aetherYtEarlyMute=true;
    function muteAds(){
      var p=document.getElementById('movie_player');
      var isAd=p&&(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting'));
      document.querySelectorAll('video').forEach(function(v){if(isAd)v.muted=true;});
    }
    // Intercept play() to mute before audio starts
    var origPlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){
      var p=document.getElementById('movie_player');
      if(p&&(p.classList.contains('ad-showing')||p.classList.contains('ad-interrupting')))this.muted=true;
      return origPlay.apply(this,arguments);
    };
    // Also watch for video elements being added
    var obs=new MutationObserver(function(){muteAds();});
    obs.observe(document.documentElement,{childList:true,subtree:true});
  })();`).catch(function(){});
}

export function _browseInjectYouTubeAdBlock(frame, url) {
  if (!url || !url.includes('youtube.com')) return;
  if (Settings.get('adBlockEnabled') !== 'true') return;
  frame.executeJavaScript(`(function(){
    if(window.__aetherYtAdBlockInjected) return;
    window.__aetherYtAdBlockInjected=true;

    // 1. Skip video ads via polling
    var _wasMuted=false;
    var skipInterval=setInterval(function(){
      var player=document.querySelector('#movie_player');
      if(!player) return;
      var isAd=player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting');
      if(isAd){
        var v=document.querySelector('video');
        if(v){
          if(!_wasMuted) _wasMuted=!v.muted;
          v.muted=true;
          // Try multiple skip strategies
          v.playbackRate=16;
          try{v.currentTime=9999;}catch(e){}
          try{v.currentTime=v.duration||9999;}catch(e){}
        }
        // Click every possible skip button variant
        var btns=document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-ad-skip-button-container button');
        btns.forEach(function(b){b.click();});
        var skipOv=document.querySelector('.ytp-ad-overlay-close-button');
        if(skipOv) skipOv.click();
        // Also try the player API directly
        try{
          var p=document.getElementById('movie_player');
          if(p&&p.skipAd) p.skipAd();
          if(p&&p.cancelPlayback) p.cancelPlayback();
        }catch(e){}
      } else {
        var v2=document.querySelector('video');
        if(v2){
          v2.playbackRate=1;
          if(_wasMuted){v2.muted=false;_wasMuted=false;}
        }
      }
    },300);

    // 3. MutationObserver for enforcement dialogs
    var obs=new MutationObserver(function(muts){
      // Dismiss ad-blocker enforcement popup
      var enforce=document.querySelector('tp-yt-paper-dialog.ytd-enforcement-message-view-model');
      if(enforce){
        enforce.remove();
        var bg=document.querySelector('tp-yt-iron-overlay-backdrop');
        if(bg) bg.remove();
        var v=document.querySelector('video');
        if(v&&v.paused) v.play();
      }
      // Also try the playability error
      var pe=document.querySelector('yt-playability-error-supported-renderers');
      if(pe){
        var dismiss=pe.querySelector('button, .yt-playability-error-supported-renderers__dismiss-button');
        if(dismiss) dismiss.click();
      }
    });
    obs.observe(document.body||document.documentElement,{childList:true,subtree:true});

  })();`).catch(function(){});
}

export function _browseInjectContentScripts(tab, frame) {
  // Context menu — always show aether panel (with context items for links/images)
  // Debounce: the injected script also fires __AETHER_CONTEXT__ for the same right-click
  let _ctxMenuHandledAt = 0;
  frame.addEventListener('context-menu', (ev) => {
    ev.preventDefault();
    _ctxMenuHandledAt = Date.now();
    if (typeof _showPanel !== 'function') return;
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { popup.remove(); _aetherTrackMode = false; }
    const ctxData = (ev.linkURL || ev.srcURL) ? {
      linkUrl: ev.linkURL || '', linkText: ev.linkText || '',
      imgUrl: ev.srcURL || '', mediaType: ev.mediaType || ''
    } : null;
    _showPanel({ anchor: { x: ev.x, y: ev.y }, contextMenu: ctxData, trackCursor: !ctxData });
  });

  // Inject right-click handler after page loads
  frame.addEventListener('dom-ready', () => {
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherContextMenuInjected)return;
        window.__aetherContextMenuInjected=true;
        // Override window.open to relay to parent as new tab
        var _origOpen=window.open;
        window.open=function(url){
          if(url&&url.indexOf('javascript:')!==0){
            try{var resolved=new URL(url,location.href).href;console.log('__AETHER_OPEN_TAB__'+resolved);}catch(e){console.log('__AETHER_OPEN_TAB__'+url);}
          }
          return null;
        };
        document.addEventListener('contextmenu',function(e){
          var tag = e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable){
            e.preventDefault();e.stopPropagation();
            window.__aetherLastEditable=e.target;
            console.log('__AETHER_EDITABLE__'+JSON.stringify({x:e.screenX,y:e.screenY}));
            return false;
          }
          var data = {x:e.screenX,y:e.screenY};
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.getAttribute('href');
            if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
              data.linkUrl=h;
              data.linkText=a.textContent.trim().slice(0,100);
            }
          }
          var img=e.target.closest('img');
          if(img && img.src){
            data.imgUrl=img.src;
            data.imgAlt=img.alt||'';
          }
          e.preventDefault();
          e.stopPropagation();
          if(data.linkUrl||data.imgUrl){
            console.log('__AETHER_CONTEXT__'+JSON.stringify(data));
          } else {
            console.log('__AETHER_CHAT__'+JSON.stringify(data));
          }
          return false;
        },true);
        // Text selection inside webview → relay to parent
        var _wvSelDragging=false;
        document.addEventListener('mousedown',function(e){
          if(e.button!==0) return;
          console.log('__AETHER_CLOSE_MENU__'); console.log('__AETHER_DISMISS_CHAT__');
          var tag=e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||tag==='BUTTON') return;
          if(e.target.isContentEditable) return;
          _wvSelDragging=true;
        },true);
        document.addEventListener('selectionchange',function(){
          if(!_wvSelDragging) return;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(!text||text.length<3||sel.rangeCount===0) return;
          var r=sel.getRangeAt(0).getBoundingClientRect();
          console.log('__AETHER_SEL_PREVIEW__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
        });
        document.addEventListener('mouseup',function(e){
          if(!_wvSelDragging) return;
          _wvSelDragging=false;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(text&&text.length>=3&&sel.rangeCount>0){
            var r=sel.getRangeAt(0).getBoundingClientRect();
            console.log('__AETHER_SEL_FINAL__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
          } else {
            console.log('__AETHER_SEL_CLEAR__');
          }
        },true);
        document.addEventListener('keydown',function(e){
          if(e.key==='Escape') console.log('__AETHER_DISMISS_CHAT__');
          if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();console.log('__AETHER_FIND__');}
          if(e.altKey&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){if(e.key==='ArrowLeft'){e.preventDefault();console.log('__AETHER_TAB_LEFT__');}if(e.key==='ArrowRight'){e.preventDefault();console.log('__AETHER_TAB_RIGHT__');}}
        },true);
        // Link hover preview — relay to parent
        var _lastHoveredHref='';
        document.addEventListener('mouseover',function(e){
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.href;
            if(h&&h!=='#'&&h.indexOf('javascript:')!==0&&h!==_lastHoveredHref){
              _lastHoveredHref=h;
              console.log('__AETHER_LINK_HOVER__'+h);
            }
          } else if(_lastHoveredHref){
            _lastHoveredHref='';
            console.log('__AETHER_LINK_LEAVE__');
          }
        },true);
        // Throttled mousemove for aether panel
        var _lastMove=0;
        document.addEventListener('mousemove',function(e){
          var now=Date.now();
          if(now-_lastMove<16) return;
          _lastMove=now;
          console.log('__AETHER_MOUSE__'+e.screenX+','+e.screenY);
        });
        // Relay clicks for neuralook implicit tracking
        document.addEventListener('click',function(e){
          console.log('__NEURALOOK_CLICK__'+e.screenX+','+e.screenY);
          // Intercept target="_blank" links and Cmd/Ctrl+click to open in new tab
          var a=e.target.closest('a[href]');
          if(a){
            var href=a.href;
            if(!href||href.indexOf('javascript:')===0||href.charAt(0)==='#') return;
            if(a.target==='_blank'||e.metaKey||e.ctrlKey){
              e.preventDefault();
              e.stopPropagation();
              console.log('__AETHER_OPEN_TAB__'+href);
            }
          }
        },true);
      })();
    `).catch(()=>{});

    // RSS feed detection
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherRssDetected)return;
        window.__aetherRssDetected=true;
        var links=document.querySelectorAll('link[type="application/rss+xml"],link[type="application/atom+xml"],link[type="application/feed+json"]');
        if(links.length){
          var feeds=[];
          for(var i=0;i<links.length;i++){
            feeds.push({url:links[i].href||links[i].getAttribute('href'),title:links[i].title||''});
          }
          console.log('__AETHER_RSS_FEEDS__'+JSON.stringify(feeds));
        }
      })();
    `).catch(()=>{});

    // Scroll percentage tracking — relay to parent for pill island
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherScrollInjected)return;
        window.__aetherScrollInjected=true;
        var _lastPct=-1;
        function reportScroll(){
          var h=document.documentElement.scrollHeight-window.innerHeight;
          var pct=h>0?Math.round((window.scrollY/h)*100):0;
          if(pct<0)pct=0;if(pct>100)pct=100;
          if(pct!==_lastPct){_lastPct=pct;console.log('__AETHER_SCROLL__'+pct);}
        }
        document.addEventListener('scroll',reportScroll,{passive:true});
        window.addEventListener('resize',reportScroll,{passive:true});
        setTimeout(reportScroll,500);
      })();
    `).catch(()=>{});

    // Token count estimation — report DOM text size as approximate token count
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherTokenInjected)return;
        window.__aetherTokenInjected=true;
        function reportTokens(){
          var text=document.body?document.body.innerText:'';
          var tokens=Math.round(text.length/4);
          console.log('__AETHER_TOKENS__'+tokens);
        }
        setTimeout(reportTokens,1500);
        var _mo=new MutationObserver(function(){clearTimeout(_mo._t);_mo._t=setTimeout(reportTokens,2000);});
        if(document.body)_mo.observe(document.body,{childList:true,subtree:true});
        else document.addEventListener('DOMContentLoaded',function(){_mo.observe(document.body,{childList:true,subtree:true});});
      })();
    `).catch(()=>{});

    // Two-finger horizontal swipe detection — relay to parent for back/forward nav
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherSwipeInjected)return;
        window.__aetherSwipeInjected=true;
        var accum=0,dir=null,decay=null,cooldown=0;
        var THRESHOLD=80;
        function reset(){accum=0;dir=null;clearTimeout(decay);}
        document.addEventListener('wheel',function(e){
          if(e.ctrlKey||Date.now()<cooldown)return;
          var dx=e.deltaX,dy=e.deltaY;
          if(Math.abs(dx)<2||Math.abs(dy)>Math.abs(dx)*1.2){
            if(dir){clearTimeout(decay);decay=setTimeout(reset,200);}
            return;
          }
          var d=dx<0?'back':'forward';
          if(dir&&dir!==d)reset();
          dir=d;accum+=Math.abs(dx);
          clearTimeout(decay);
          if(accum>=THRESHOLD){
            console.log('__AETHER_SWIPE__'+d);
            reset();cooldown=Date.now()+500;
          }else{
            decay=setTimeout(reset,300);
          }
        },{passive:true});
      })();
    `).catch(()=>{});

    // Password field detection + form submit interception
    frame.executeJavaScript(`
      (function(){
        if(window.__aetherPwInjected)return;
        window.__aetherPwInjected=true;
        function findPwFields(){return Array.from(document.querySelectorAll('input[type="password"]'));}
        function findUsernameField(pwField){
          var form=pwField.closest('form');
          var scope=form||document;
          var candidates=scope.querySelectorAll('input[type="text"],input[type="email"],input:not([type])');
          for(var i=candidates.length-1;i>=0;i--){
            var c=candidates[i];
            var n=(c.name||'').toLowerCase()+(c.id||'').toLowerCase()+(c.autocomplete||'').toLowerCase()+(c.placeholder||'').toLowerCase();
            if(n.match(/user|email|login|account|name/)) return c;
          }
          return candidates.length?candidates[candidates.length-1]:null;
        }
        function notifyFields(){
          if(findPwFields().length>0) console.log('__AETHER_PW_FIELDS__');
        }
        notifyFields();
        var obs=new MutationObserver(function(){notifyFields();});
        obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
        function captureSubmit(e){
          var pwFields=findPwFields();
          if(!pwFields.length) return;
          var pw=null,un=null;
          for(var i=0;i<pwFields.length;i++){
            if(pwFields[i].value){pw=pwFields[i].value;var uf=findUsernameField(pwFields[i]);if(uf)un=uf.value;break;}
          }
          if(!pw) return;
          console.log('__AETHER_PW_SUBMIT__'+JSON.stringify({origin:location.origin,username:un||'',password:pw}));
        }
        document.addEventListener('submit',function(e){
          if(e.target.querySelector('input[type="password"]')) captureSubmit(e);
        },true);
        document.addEventListener('click',function(e){
          var btn=e.target.closest('button,input[type="submit"],a[role="button"]');
          if(!btn) return;
          var form=btn.closest('form');
          if(form&&form.querySelector('input[type="password"]')) setTimeout(function(){captureSubmit();},100);
        },true);
      })();
    `).catch(()=>{});

    // YouTube ad blocking injection
    _browseInjectYouTubeAdBlock(frame, frame.getURL());
  });

  frame.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) _browseInjectYouTubeAdBlock(frame, e.url);
  });

  // Listen for context menu via console message
  frame.addEventListener('console-message', (e) => {
    if (e.message === '__AETHER_CLOSE_TAB__') {
      if (typeof browseCloseTab === 'function') browseCloseTab(tab.id);
      return;
    } else if (e.message && e.message.startsWith('__AETHER_BYPASS_BLOCK__')) {
      const bypassUrl = e.message.slice('__AETHER_BYPASS_BLOCK__'.length);
      try {
        const host = new URL(bypassUrl).hostname.toLowerCase();
        // Add all matching domains to bypass set
        const sites = _getDoomScrollSites();
        for (const s of sites) {
          if (host === s.domain || host.endsWith('.' + s.domain)) _doomScrollBypass.add(s.domain);
        }
      } catch {}
      frame.loadURL(bypassUrl);
      return;
    } else if (e.message === '__AETHER_DOOM_SNOOZE__') {
      // "5 more minutes" — reset the persisted start time so pill restarts from 0
      if (_focusTimerDomain && _focusTimerStarts[_focusTimerDomain]) {
        _focusTimerStarts[_focusTimerDomain] = Date.now();
        _persistFocusTimerStarts();
        _updateFocusTimerPill();
      }
      return;
    } else if (e.message && e.message.startsWith('__AETHER_LINK_HOVER__')) {
      _showLinkPreview(e.message.slice('__AETHER_LINK_HOVER__'.length));
      return;
    } else if (e.message === '__AETHER_LINK_LEAVE__') {
      _hideLinkPreview();
      return;
    } else if (e.message === '__AETHER_DISMISS_CHAT__') {
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) {
        if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
        _aetherTrackMode = false;
        popup.remove();
      }
    } else if (e.message && e.message.startsWith('__AETHER_MOUSE__')) {
      if (!_aetherTrackMode) return;
      const parts = e.message.slice('__AETHER_MOUSE__'.length).split(',');
      const x = parseInt(parts[0]) - window.screenX;
      const y = parseInt(parts[1]) - window.screenY;
      _lastMouseX = x;
      _lastMouseY = y;
      const popup = document.getElementById('doc-chat-ask-float');
      if (!popup) { _aetherTrackMode = false; return; }
      const pos = _positionAtCursor(x, y, popup.offsetWidth, popup.offsetHeight, false);
      popup.style.left = pos.left + 'px';
      popup.style.top = pos.top + 'px';
    } else if (e.message === '__AETHER_CLOSE_MENU__') {
      _hideBrowseContextMenu();
    } else if (e.message && e.message.startsWith('__AETHER_CONTEXT__')) {
      // Skip if the Electron context-menu event already handled this right-click
      if (Date.now() - _ctxMenuHandledAt < 300) return;
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CONTEXT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, contextMenu: data });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_CHAT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_CHAT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: true });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_EDITABLE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_EDITABLE__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _aetherTrackMode = false; }
          _showPanel({ anchor: { x, y }, trackCursor: false, webviewEditable: { webview: frame, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } });
        }
      } catch (err) {}
    } else if (e.message === '__AETHER_FIND__') {
      _browseToggleFindBar();
    } else if (e.message === '__AETHER_TAB_LEFT__') {
      _switchTabLeft();
    } else if (e.message === '__AETHER_TAB_RIGHT__') {
      _switchTabRight();
    } else if (e.message && (e.message.startsWith('__AETHER_SEL_PREVIEW__') || e.message.startsWith('__AETHER_SEL_FINAL__'))) {
      try {
        const isFinal = e.message.startsWith('__AETHER_SEL_FINAL__');
        const prefix = isFinal ? '__AETHER_SEL_FINAL__' : '__AETHER_SEL_PREVIEW__';
        const data = JSON.parse(e.message.slice(prefix.length));
        const selectionRect = _iframeRectToParent(data, frame);
        _aetherTrackMode = false;
        if (!isFinal) {
          const existing = document.getElementById('doc-chat-ask-float');
          if (existing && existing._isAetherPanel) existing.remove();
        }
        _showPanel({ anchor: { selectionRect }, selectionText: data.text, finalized: isFinal });
      } catch (err) {}
    } else if (e.message === '__AETHER_SEL_CLEAR__') {
      const existing = document.getElementById('doc-chat-ask-float');
      if (existing) { existing.remove(); _aetherTrackMode = false; }
    } else if (e.message && e.message.startsWith('__AETHER_LINK__')) {
      // Legacy support
      try {
        const data = JSON.parse(e.message.slice('__AETHER_LINK__'.length));
        if (data.href) {
          const x = data.x - window.screenX;
          const y = data.y - window.screenY;
          _showBrowseContextMenu(x, y, { linkUrl: data.href, linkText: data.text || '' });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_OPEN_TAB__')) {
      const url = e.message.slice('__AETHER_OPEN_TAB__'.length);
      if (url) browseNewTab(url);
    } else if (e.message && e.message.startsWith('__AETHER_SCROLL__')) {
      if (tab.id === _browseActiveTab) {
        _browseUpdateScrollPill(parseInt(e.message.slice('__AETHER_SCROLL__'.length)));
      }
    } else if (e.message && e.message.startsWith('__AETHER_TOKENS__')) {
      if (tab.id === _browseActiveTab) {
        _browseUpdateTokenCount(parseInt(e.message.slice('__AETHER_TOKENS__'.length)));
      }
    } else if (e.message && e.message.startsWith('__AETHER_SWIPE__')) {
      if (tab.id === _browseActiveTab && typeof _swipeCommit === 'function') {
        _swipeCommit(e.message.slice('__AETHER_SWIPE__'.length));
      }
    } else if (e.message && e.message.startsWith('__NEURALOOK_CLICK__')) {
      if (typeof _nlHandleIframeClick === 'function') {
        const parts = e.message.slice('__NEURALOOK_CLICK__'.length).split(',');
        const x = parseInt(parts[0]) - window.screenX;
        const y = parseInt(parts[1]) - window.screenY;
        _nlHandleIframeClick(x, y);
      }
    } else if (e.message && e.message.startsWith('__AETHER_RSS_FEEDS__')) {
      try {
        const feeds = JSON.parse(e.message.slice('__AETHER_RSS_FEEDS__'.length));
        // Resolve relative URLs against tab.url
        tab.rssFeeds = feeds.map(f => {
          try { return { url: new URL(f.url, tab.url).href, title: f.title }; }
          catch { return f; }
        });
        _browseUpdateRssPill(tab);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_ANN_CLICK__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_ANN_CLICK__'.length));
        _showAnnotationTooltip(data, frame, true);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_ANN_MOVE__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_ANN_MOVE__'.length));
        _showAnnotationTooltip(data, frame);
      } catch (err) {}
    } else if (e.message === '__AETHER_ANN_DISMISS__') {
      _hideAnnotationTooltip(true);
    } else if (e.message === '__AETHER_ANN_LEAVE__') {
      _hideAnnotationTooltip();
    } else if (e.message === '__AETHER_PW_FIELDS__') {
      _pwCheckAutofill(tab, frame);
    } else if (e.message && e.message.startsWith('__AETHER_PW_SUBMIT__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PW_SUBMIT__'.length));
        _pwPendingPrompt = { tab, data, ts: Date.now() };
        _pwShowSavePrompt(tab, data);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_PAPER_META__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_PAPER_META__'.length));
        if (typeof _paperHandleMeta === 'function') _paperHandleMeta(tab, data);
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__AETHER_REF_HOVER__')) {
      try {
        const data = JSON.parse(e.message.slice('__AETHER_REF_HOVER__'.length));
        if (typeof _paperShowRefTooltip === 'function') _paperShowRefTooltip(data, frame);
      } catch (err) {}
    } else if (e.message === '__AETHER_REF_LEAVE__') {
      if (typeof _paperHideRefTooltip === 'function') _paperHideRefTooltip();
    }
  });
}

export function _browseUpdateRssPill(tab) {
  if (tab.id !== _browseActiveTab || !tab.rssFeeds || !tab.rssFeeds.length) {
    const cur = _islandActivities && _islandActivities['rss'];
    if (!cur || !cur.subscribed) islandRemove('rss');
    return;
  }
  const feed = tab.rssFeeds[0];
  const feedUrl = feed.url;
  // Check if already subscribed (custom feeds or catalog)
  let customFeeds = [];
  try { customFeeds = Settings.getJSON('customFeeds', []); } catch {}
  let isSubscribed = customFeeds.some(function(f) { return f.url === feedUrl; });
  if (!isSubscribed) {
    // Also check FEED_CATALOG urls
    isSubscribed = (typeof FEED_CATALOG !== 'undefined') && FEED_CATALOG.some(function(c) { return c.url === feedUrl; });
  }
  let label = feed.title || (tab.rssFeeds.length > 1 ? tab.rssFeeds.length + ' feeds' : 'RSS Feed');
  if (label.length > 24) label = label.slice(0, 22) + '\u2026';
  islandUpdate('rss', {
    type: 'rss',
    label: isSubscribed ? 'Subscribed' : label,
    detail: isSubscribed ? label : 'Subscribe',
    subscribed: isSubscribed,
    feedUrl: feedUrl,
    feedTitle: feed.title || '',
    action: isSubscribed ? function() {
      // Unsubscribe from feed
      let feeds = [];
      try { feeds = Settings.getJSON('customFeeds', []); } catch {}
      feeds = feeds.filter(function(f) { return f.url !== feedUrl; });
      Settings.setJSON('customFeeds', feeds);
      // Refresh pill to show unsubscribed state
      _browseUpdateRssPill(tab);
      // Reload feeds if available
      if (typeof loadAllFeeds === 'function') { allPapers = []; loadAllFeeds(); }
    } : function() {
      // Subscribe to feed
      let feeds = [];
      try { feeds = Settings.getJSON('customFeeds', []); } catch {}
      if (feeds.some(function(f) { return f.url === feedUrl; })) return;
      let name = feed.title || feedUrl;
      try { name = name || new URL(feedUrl).hostname.replace(/^www\./, ''); } catch {}
      feeds.push({ url: feedUrl, name: name, enabled: true });
      Settings.setJSON('customFeeds', feeds);
      // Refresh pill to show subscribed state
      _browseUpdateRssPill(tab);
      // Reload feeds if available
      if (typeof loadAllFeeds === 'function') { allPapers = []; loadAllFeeds(); }
    }
  });
}

// Temporary bypass list for "allow once" on blocked sites (cleared on app restart)
export const _doomScrollBypass = new Set();

export function _browseShowBlockedPage(tab, frame, url, domain) {
  const isDark = document.documentElement.classList.contains('dark') || Settings.get('theme') === 'dark';
  const bg = isDark ? '#0a0a0a' : '#f5f5f5';
  const card = isDark ? '#151515' : '#fff';
  const text = isDark ? '#e0e0e0' : '#333';
  const dim = isDark ? '#777' : '#666';
  const dimmer = isDark ? '#555' : '#999';
  const border = isDark ? '#222' : '#e0e0e0';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const safeUrl = url.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:${bg};color:${text};display:flex;align-items:center;justify-content:center;min-height:100vh}
    .c{text-align:center;max-width:400px;padding:40px}
    .icon{font-size:48px;margin-bottom:20px;opacity:.6}
    h1{font-size:18px;font-weight:600;margin-bottom:8px}
    p{font-size:13px;color:${dim};margin-bottom:24px;line-height:1.5}
    .domain{color:${text};font-weight:500}
    .actions{display:flex;gap:8px;justify-content:center;margin-bottom:16px}
    button{padding:8px 20px;border-radius:8px;border:1px solid ${border};background:${card};color:${text};font-size:13px;cursor:pointer;font-family:inherit;transition:border-color .15s}
    button:hover{border-color:${accent};color:${accent}}
    .bypass{font-size:11px;color:${dimmer};cursor:pointer;background:none;border:none;padding:4px 8px}
    .bypass:hover{color:${dim}}
    .bypass.waiting{pointer-events:none}
  </style></head><body><div class="c">
    <div class="icon">\u26D4</div>
    <h1>Site blocked</h1>
    <p><span class="domain">${domain}</span> is blocked by Focus Mode to help you stay on track.</p>
    <div class="actions"><button onclick="history.back()">Go back</button></div>
    <button class="bypass" id="__bypass" onclick="__doBypass()">Continue anyway</button>
    <script>
      var _countdown=3,_started=false;
      var btn=document.getElementById('__bypass');
      function __doBypass(){
        if(!_started){_started=true;btn.classList.add('waiting');tick();return;}
        console.log('__AETHER_BYPASS_BLOCK__${safeUrl}');
      }
      function tick(){
        if(_countdown>0){btn.textContent='Continue anyway ('+_countdown+'s)';_countdown--;setTimeout(tick,1000);}
        else{btn.textContent='Continue anyway';btn.classList.remove('waiting');}
      }
    </script>
  </div></body></html>`;
  try { frame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch {}
  tab.title = 'Blocked \u2014 ' + domain;
  tab.blank = false;
  _browseRenderTabs();
}

export function _injectDoomScrollNudge(tab, el, config) {
  const domain = config.domain;
  // Compute delay from persisted start time so nudge survives reload/SPA nav
  const startTime = _focusTimerStarts[domain] || Date.now();
  const elapsedMs = Date.now() - startTime;
  const thresholdMs = (config.minutes || 5) * 60 * 1000;
  const remainingMs = Math.max(0, thresholdMs - elapsedMs);
  // Read theme colors from parent frame (webview content can't access parent CSS vars)
  const isDark = document.documentElement.classList.contains('dark') || Settings.get('theme') === 'dark';
  const cardBg = isDark ? '#181818' : '#fff';
  const cardBorder = isDark ? '#333' : '#ddd';
  const cardText = isDark ? '#e0e0e0' : '#333';
  const cardDim = isDark ? '#999' : '#666';
  const btnBorder = isDark ? '#444' : '#ccc';
  const btnText = isDark ? '#ccc' : '#555';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';

  el.executeJavaScript(`(function(){
    if(window.__aetherDoomScrollInjected) return;
    window.__aetherDoomScrollInjected=true;
    var domain=${JSON.stringify(domain)};
    var remainingMs=${remainingMs};
    var thresholdMin=${config.minutes || 5};
    function showOverlay(elapsedMin){
      if(document.getElementById('__aether-doom-overlay')) return;
      var ov=document.createElement('div');
      ov.id='__aether-doom-overlay';
      ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      var card=document.createElement('div');
      card.style.cssText='background:${cardBg};border:1px solid ${cardBorder};border-radius:16px;padding:32px 40px;text-align:center;max-width:380px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:${cardText};';
      card.innerHTML='<div style="font-size:36px;margin-bottom:16px;opacity:.7">\\u23F1</div>'
        +'<div style="font-size:16px;font-weight:600;margin-bottom:8px">Time check</div>'
        +'<div style="font-size:13px;color:${cardDim};margin-bottom:24px;line-height:1.5">You\\u2019ve been on <strong style="color:${cardText}">'+domain+'</strong> for <strong style="color:${cardText}">'+elapsedMin+'</strong> minutes.</div>'
        +'<div style="display:flex;gap:10px;justify-content:center">'
        +'<button id="__aether-ds-close" style="padding:8px 18px;border-radius:8px;background:${accent};color:#fff;border:none;font-size:13px;cursor:pointer;font-family:inherit">Close tab</button>'
        +'<button id="__aether-ds-more" style="padding:8px 18px;border-radius:8px;background:transparent;color:${btnText};border:1px solid ${btnBorder};font-size:13px;cursor:pointer;font-family:inherit">5 more minutes</button>'
        +'</div>';
      ov.appendChild(card);
      document.body.appendChild(ov);
      document.getElementById('__aether-ds-close').onclick=function(){console.log('__AETHER_CLOSE_TAB__');};
      document.getElementById('__aether-ds-more').onclick=function(){
        ov.remove();
        window.__aetherDoomScrollInjected=false;
        console.log('__AETHER_DOOM_SNOOZE__');
        setTimeout(function(){
          if(!window.__aetherDoomScrollInjected){
            window.__aetherDoomScrollInjected=true;
            showOverlay(elapsedMin+5);
          }
        },5*60*1000);
      };
    }
    if(remainingMs<=0){showOverlay(thresholdMin);}
    else{setTimeout(function(){showOverlay(thresholdMin);},remainingMs);}
  })();`).catch(() => {});
}

export function _browseBindFrame(tab) {
  if (tab.contentType === 'reader') return;
  const el = tab.el;
  if (!el || !_browseIsElectron) return;

  _browseHandleNavigation(tab, el);
  _browseInjectContentScripts(tab, el);

  // Adblock: generic ad placeholder CSS (covers common ad frameworks)
  const _adPlaceholderCSS =
    'ins.adsbygoogle,' +
    'ins.adsbygoogle[data-ad-status],' +
    '[id^="google_ads_"],' +
    '[id^="div-gpt-ad"],' +
    '[data-google-query-id],' +
    'iframe[src*="doubleclick.net"],' +
    'iframe[src*="googlesyndication.com"],' +
    'iframe[id^="google_ads_"],' +
    'iframe[src=""],' +
    '.ad-container,' +
    '.ad-wrapper,' +
    '.ad-slot,' +
    '.ad-banner,' +
    '.adunit,' +
    '#ad-container,' +
    '#ad-wrapper,' +
    '#ad-slot,' +
    '[data-ad-slot],' +
    '[data-ad],' +
    'amp-ad,' +
    'amp-embed[type="ad"],' +
    '.ad-placeholder,' +
    '.ad-loading,' +
    '.sponsored-content' +
    '{display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important}';

  // Adblock: inject cosmetic CSS early + remove elements + update badge
  if (window.electronAPI && window.electronAPI.adblockCosmetic) {
    // Inject generic ad placeholder CSS on every navigation
    const _injectPlaceholderCSS = (url) => {
      if (Settings.get('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      try { el.insertCSS(_adPlaceholderCSS); } catch {}
    };

    // Inject EasyList cosmetic selectors + remove elements from DOM
    const _injectCosmetic = (url) => {
      if (Settings.get('adBlockEnabled') !== 'true') return;
      if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
      window.electronAPI.adblockCosmetic(url).then(res => {
        const extraSel = (res && res.selectors && res.selectors.length) ? res.selectors.join(', ') : '';
        // Hide via CSS (both EasyList selectors and generic placeholders)
        if (extraSel) {
          try { el.insertCSS(extraSel + ' { display: none !important; }'); } catch {}
        }
        // Remove elements from DOM (EasyList + generic ad containers)
        el.executeJavaScript(`(function(){
          if(window.__aetherAdCleanInjected) return;
          window.__aetherAdCleanInjected=true;
          var extra = ${JSON.stringify(extraSel)};
          var generic = 'ins.adsbygoogle, [id^="google_ads_"], [id^="div-gpt-ad"], [data-google-query-id], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[id^="google_ads_"], [data-ad-slot], amp-ad, amp-embed[type="ad"]';
          var sel = extra ? (generic + ', ' + extra) : generic;
          function removeAds(){
            try{document.querySelectorAll(sel).forEach(function(el){el.remove();});}catch(e){}
            // Also remove iframes that failed to load (blocked by network filter)
            document.querySelectorAll('iframe').forEach(function(f){
              try{
                var s=f.src||f.getAttribute('src')||'';
                if(!s||s==='about:blank'||(f.offsetWidth<=1&&f.offsetHeight<=1)) return;
                if(s.includes('ad')||s.includes('sponsor')||s.includes('doubleclick')||s.includes('googlesyndication')) f.remove();
              }catch(e){}
            });
            // Collapse empty ad containers (divs with specific ad classes but no visible content)
            document.querySelectorAll('.ad-container,.ad-wrapper,.ad-slot,.ad-banner,.adunit,.ad-placeholder,#ad-container,#ad-wrapper,#ad-slot').forEach(function(el){
              if(el.children.length===0&&el.textContent.trim()==='') el.remove();
            });
          }
          removeAds();
          var obs=new MutationObserver(function(){removeAds();});
          obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
          setTimeout(function(){obs.disconnect();},30000);
        })();`).catch(() => {});
      }).catch(() => {});
    };

    // JS-based YouTube Shorts hiding (implements uBlock :has-text / :matches-path rules)
    const _hideYTShorts = (url) => {
      if (Settings.get('hideYTShorts') !== 'true') return;
      if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) return;
      el.executeJavaScript(`(function(){
        if(window.__ytShortsHideInjected) return;
        window.__ytShortsHideInjected=true;
        var isHistory = location.pathname.startsWith('/feed/history');
        function hideShorts(){
          // Sidebar: hide Shorts button (desktop + tablet mini-guide)
          document.querySelectorAll('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer').forEach(function(el){
            var txt = el.textContent.trim();
            if(/^Shorts$/i.test(txt)) el.style.display='none';
          });
          // Shorts tab on channel pages
          document.querySelectorAll('yt-tab-shape').forEach(function(el){
            if(/^Shorts$/i.test(el.textContent.trim())) el.style.display='none';
          });
          // Shorts sections (not on history page)
          if(!isHistory){
            document.querySelectorAll('ytd-rich-section-renderer, ytd-reel-shelf-renderer').forEach(function(el){
              var title = el.querySelector('#title');
              if(title && /(^| )Shorts( |$)/i.test(title.textContent)) el.style.display='none';
            });
          }
          // Short remixes in descriptions/suggestions
          document.querySelectorAll('ytd-reel-shelf-renderer').forEach(function(el){
            var title = el.querySelector('#title');
            if(title && /(^| )Shorts.?Remix/i.test(title.textContent)) el.style.display='none';
          });
          // Mobile: bottom nav Shorts button
          document.querySelectorAll('ytm-pivot-bar-item-renderer').forEach(function(el){
            if(el.querySelector('.pivot-shorts')) el.style.display='none';
          });
          // Mobile: Shorts chip on homepage
          document.querySelectorAll('ytm-chip-cloud-chip-renderer').forEach(function(el){
            if(/^Shorts$/i.test(el.textContent.trim())) el.style.display='none';
          });
          // Mobile: shorts sections (not on history)
          if(!isHistory){
            document.querySelectorAll('ytm-rich-section-renderer, ytm-reel-shelf-renderer').forEach(function(el){
              var str = el.querySelector('.yt-core-attributed-string');
              if(str && /(^| )Shorts( |$)/i.test(str.textContent)) el.style.display='none';
            });
          }
          // Mobile: shorts remixes
          document.querySelectorAll('ytm-reel-shelf-renderer').forEach(function(el){
            var str = el.querySelector('.reel-shelf-title-wrapper .yt-core-attributed-string');
            if(str && /(^| )Shorts.?Remix/i.test(str.textContent)) el.style.display='none';
          });
        }
        hideShorts();
        var obs=new MutationObserver(function(){hideShorts();});
        obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
        setTimeout(function(){obs.disconnect();},60000);
      })();`).catch(() => {});
    };

    // Doom scroll nudge injection
    const _injectDoomNudge = (url) => {
      const match = _doomScrollMatch(url);
      if (match && match.mode === 'nudge') _injectDoomScrollNudge(tab, el, match);
    };

    el.addEventListener('dom-ready', () => {
      _injectPlaceholderCSS(tab.url || '');
      _injectCosmetic(tab.url || '');
      _hideYTShorts(tab.url || '');
      _injectDoomNudge(tab.url || '');
    });
    el.addEventListener('did-navigate', (e) => {
      _injectPlaceholderCSS(e.url || '');
      _injectCosmetic(e.url || '');
      _hideYTShorts(e.url || '');
      _injectDoomNudge(e.url || '');
    });
    el.addEventListener('did-finish-load', () => {
      // Update badge count after requests finish
      setTimeout(() => {
        if (_browseActiveTab === tab.id && typeof _browseUpdateAdBlockBadge === 'function') {
          _browseUpdateAdBlockBadge(tab.url || '');
        }
      }, 500);
    });
  }
}

window._DOOM_SCROLL_DEFAULTS = _DOOM_SCROLL_DEFAULTS;
window._getDoomScrollSites = _getDoomScrollSites;
window._saveDoomScrollSites = _saveDoomScrollSites;
window._doomScrollMatch = _doomScrollMatch;
window._focusTimerStarts = _focusTimerStarts;
window._focusTimerInterval = _focusTimerInterval;
window._focusTimerDomain = _focusTimerDomain;
window._focusTimerWarnMinutes = _focusTimerWarnMinutes;
window._persistFocusTimerStarts = _persistFocusTimerStarts;
window._formatFocusTime = _formatFocusTime;
window._focusTimerElapsed = _focusTimerElapsed;
window._startFocusTimer = _startFocusTimer;
window._hideFocusTimerPill = _hideFocusTimerPill;
window._updateFocusTimerPill = _updateFocusTimerPill;
window._checkFocusTimer = _checkFocusTimer;
window.DOWNLOAD_RETENTION_MS = DOWNLOAD_RETENTION_MS;
window._browseDownloads = _browseDownloads;
window._browseDownloadIdCounter = _browseDownloadIdCounter;
window._browseDownloadsLastSeenCount = _browseDownloadsLastSeenCount;
window._loadBrowseDownloads = _loadBrowseDownloads;
window._saveBrowseDownloads = _saveBrowseDownloads;
window._browseUpdateDownloadBadge = _browseUpdateDownloadBadge;
window._browseRenderDownloads = _browseRenderDownloads;
window._formatBytes = _formatBytes;
window._closeBrowseDownloadsDropdown = _closeBrowseDownloadsDropdown;
window.toggleBrowseDownloads = toggleBrowseDownloads;
window._closeBrowseDownloadsOnClick = _closeBrowseDownloadsOnClick;
window._closeBrowseDownloadsOnBlur = _closeBrowseDownloadsOnBlur;
window.clearBrowseDownloads = clearBrowseDownloads;
window.removeBrowseDownload = removeBrowseDownload;
window.openDownloadFile = openDownloadFile;
window.showDownloadInFolder = showDownloadInFolder;
window._downloadsInitialized = _downloadsInitialized;
window._initBrowseDownloads = _initBrowseDownloads;
window._browseHandleNavigation = _browseHandleNavigation;
window._browseErrorMap = _browseErrorMap;
window._browseShowErrorPage = _browseShowErrorPage;
window._ytAdBlockCSS = _ytAdBlockCSS;
window._browseInjectYouTubeCSS = _browseInjectYouTubeCSS;
window._browseInjectYouTubeAdBlock = _browseInjectYouTubeAdBlock;
window._browseInjectContentScripts = _browseInjectContentScripts;
window._browseUpdateRssPill = _browseUpdateRssPill;
window._doomScrollBypass = _doomScrollBypass;
window._browseShowBlockedPage = _browseShowBlockedPage;
window._injectDoomScrollNudge = _injectDoomScrollNudge;
window._browseBindFrame = _browseBindFrame;
