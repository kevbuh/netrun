// browse-navigation.js — Navigation event handlers, error pages
// Extracted from browse-downloads.js
import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _annotationsEnabled, _showAnnotateOfferPill, _updateAnnotateButtonState } from '/js/browse/browse-annotations.js';
import { _browseApplyAdaptiveColor, _browseSetUrlDisplay, _browseUpdateAdBlockBadge, _browseUrlDomain, _saveBrowseVisit } from '/js/browse-urlbar.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';
import { _browseCollapseEmptyWindows, browseNewTab } from '/js/browse/browse-windows.js';
import { _isBrowseStackNavigation, _clearBrowseStackNavigation, _browseTitleFromUrl, _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _browseToggleFindBar, _browseUpdateSaveBtn, _swipeCommit } from '/js/browse/browse-features.js';
import { _updateAudioIndicator } from '/js/browse/browse-audio.js';
import { _pageInfoOnPageLoad, _pageInfoCleanup, _pageInfoUpdateScroll, _pageInfoUpdateTokens } from '/js/browse/browse-pageinfo.js';
import { _resetCcPillDismissed, stopCaptions } from '/js/browse/browse-captions.js';
import { _paperOnPageLoad } from '/js/browse/browse-paper.js';
import { _isNerdAutoEligible } from '/js/browse/browse-nerd-mode.js';
import { FEED_CATALOG } from '/js/core/core-views.js';
import { allPapers, loadAllFeeds } from '/js/feed.js';
import { _doomScrollMatch, _checkFocusTimer, _doomScrollBypass, _browseShowBlockedPage } from '/js/browse/browse-doom-scroll.js';
import { _browseInjectRemoveCSS } from '/js/browse/browse-content-scripts.js';

// Re-export _browseRenderTabs for consumers that imported it from browse-downloads
export { _browseRenderTabs };

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
    const _isStackNav = typeof _isBrowseStackNavigation === 'function' && _isBrowseStackNavigation();
    if (_isStackNav) {
      // Stack navigation from browseBack()/browseForward() — they already manipulated the stacks
      _clearBrowseStackNavigation();
    } else if (_prevUrl && _prevUrl !== navUrl && _prevUrl !== 'about:blank') {
      if (!tab.backStack) tab.backStack = [];
      if (!tab.forwardStack) tab.forwardStack = [];
      // Skip NTP URLs in history — NTP should never appear in back/forward stacks
      const _isNtp = _prevUrl === 'ntp://' || _prevUrl === 'ntp://newtab';
      if (!_isNtp) {
        tab.backStack.push(_prevUrl);
      }
      tab.forwardStack.length = 0;
    }

    // If navigating to NTP, clear both stacks — NTP always starts fresh
    if (navUrl === 'ntp://' || navUrl === 'ntp://newtab') {
      tab.backStack = [];
      tab.forwardStack = [];
    }

    tab.url = navUrl;
    tab.title = _browseTitleFromUrl(navUrl);
    tab.favicon = _browseFaviconUrl(navUrl);
    tab.blank = false;
    window._pwAutofillOffered.delete(tab.id);
    // Re-show save prompt after navigation if credentials were just captured
    if (window._pwPendingPrompt && window._pwPendingPrompt.tab.id === tab.id && Date.now() - window._pwPendingPrompt.ts < 15000) {
      const pending = window._pwPendingPrompt;
      if (typeof window._pwHideSavePrompt === 'function') window._pwHideSavePrompt();
      setTimeout(() => { if (typeof window._pwShowSavePrompt === 'function') window._pwShowSavePrompt(pending.tab, pending.data); }, 100);
    } else {
      if (typeof window._pwHideSavePrompt === 'function') window._pwHideSavePrompt();
    }
    _saveBrowseVisit(navUrl, tab.title);
    _browseRenderTabs();
    window._browseSaveTabs();
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
    if (tab.id === _browseActiveTab) { _pageInfoCleanup(); }
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
      try {
        const _wcId = frame.getWebContentsId();
        window.electronAPI.adblockResetCount(_wcId);
        if (window.electronAPI.trackingStripResetCount) window.electronAPI.trackingStripResetCount(_wcId);
        if (window.electronAPI.httpsOnlyResetCount) window.electronAPI.httpsOnlyResetCount(_wcId);
        if (window.electronAPI.cookieBlockResetCount) window.electronAPI.cookieBlockResetCount(_wcId);
      } catch {}
    }
    // Auto remove CSS if enabled
    _browseInjectRemoveCSS(frame);
    // Reset insight pill to offer state on navigation (don't remove it)
    if (typeof _showAnnotateOfferPill === 'function' && tab.id === _browseActiveTab) _showAnnotateOfferPill(tab);
    // Nerd Mode: auto-enable for PDF URLs, auto-re-enable if tab had it on
    if (_isNerdAutoEligible(navUrl, tab)) {
      // Extract localPath/pdfUrl from /api/local-file URLs so nerd mode can load the PDF
      if (!tab.pdfUrl && navUrl.includes('/api/local-file')) {
        try {
          var u = new URL(navUrl, 'http://localhost');
          var fp = u.searchParams.get('path');
          if (fp) { tab.localPath = fp; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(fp); }
        } catch (e) {}
      }
      if (typeof window._isNerdMode === 'function' && window._isNerdMode(tab.id)) {
        // Already in nerd mode — will re-init via viewer
      } else if (window._nerdModeSticky && window._nerdModeSticky.has(tab.id)) {
        // Tab previously had nerd mode — re-enable automatically
        setTimeout(function() { if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab); }, 300);
      } else {
        // Fresh PDF navigation — auto-enable nerd mode
        setTimeout(function() { if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab); }, 300);
      }
    }
    // Update nav buttons so back/forward reflect history stacks
    if (typeof window._updateIslandNavButtons === 'function') window._updateIslandNavButtons();
    // Clear adaptive color on navigation (will re-extract on did-finish-load)
    tab.themeColor = null;
    if (_browseActiveTab === tab.id && !_nerdModeEnabled.get(tab.id) && typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
  });
  frame.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const sameOrigin = tab.url && e.url && _browseUrlDomain(tab.url) === _browseUrlDomain(e.url);
    // Track history for in-page (SPA) navigations
    const _prevUrl = tab.url;
    const _isStackNav = typeof _isBrowseStackNavigation === 'function' && _isBrowseStackNavigation();
    if (_isStackNav) {
      _clearBrowseStackNavigation();
    } else if (_prevUrl && _prevUrl !== e.url && _prevUrl !== 'about:blank') {
      if (!tab.backStack) tab.backStack = [];
      if (!tab.forwardStack) tab.forwardStack = [];
      const _isNtp = _prevUrl === 'ntp://' || _prevUrl === 'ntp://newtab';
      if (!_isNtp) {
        tab.backStack.push(_prevUrl);
      }
      tab.forwardStack.length = 0;
    }

    tab.url = e.url;
    // Keep real title for same-origin in-page navigations (hash/pushState)
    if (!sameOrigin || !tab.title || tab.title === _browseTitleFromUrl(tab.url)) {
      tab.title = _browseTitleFromUrl(e.url);
    }
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    window._browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      _browseSetUrlDisplay(urlInput, e.url);
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
    // Focus timer: check on SPA navigation (don't reset for same domain)
    if (tab.id === _browseActiveTab) _checkFocusTimer(e.url);
    // Update nav buttons so back/forward reflect history stacks
    if (typeof window._updateIslandNavButtons === 'function') window._updateIslandNavButtons();
  });
  frame.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    // Update the most recent browse history entry with the real title
    if (tab.url) _saveBrowseVisit(tab.url, tab.title);
    _browseRenderTabs();
    window._browseSaveTabs();
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
    const winId = window._browseWindows.find(w => w.tabs.some(t => t.id === tab.id))?.id;
    if (winId) {
      window._browseAudioTabs.set(tab.id, { windowId: winId, muted: false });
      _browseRenderTabs();
      _updateAudioIndicator();
    }
  });
  frame.addEventListener('media-paused', () => {
    window._browseAudioTabs.delete(tab.id);
    _resetCcPillDismissed();
    if (window._ccTabId === tab.id) stopCaptions();
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
  if (window._browseIsElectron) {
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
      // Page info pill (metadata, scroll %, tokens)
      if (tab.id === _browseActiveTab) {
        _pageInfoOnPageLoad(tab, frame);
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
          if (_browseActiveTab === tab.id && !_nerdModeEnabled.get(tab.id) && typeof _browseApplyAdaptiveColor === 'function') _browseApplyAdaptiveColor(tab);
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
  const cs = getComputedStyle(document.documentElement);
  const v = function(n, fb) { return cs.getPropertyValue(n).trim() || fb; };
  const bgBody    = v('--nr-bg-body',          '#0a0a0a');
  const bgCard    = v('--nr-bg-surface',        '#151515');
  const bgHover   = v('--nr-bg-raised',         '#1e1e1e');
  const textPri   = v('--nr-text-primary',      '#e0e0e0');
  const textMuted = v('--nr-text-secondary',    '#888');
  const textDim   = v('--nr-text-tertiary',     '#666');
  const textDimmer= v('--nr-text-quaternary',   '#555');
  const borderCard= v('--nr-border-default',    '#222');
  const borderSub = v('--nr-border-subtle',     '#252525');
  const accent    = v('--nr-accent',            '#b4451a');
  const accentHov = v('--nr-accent-hover',      '#c9562a');

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

  if (window._browseIsElectron) {
    try { frame.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); } catch {}
  } else {
    frame.srcdoc = html;
  }
  tab.title = errInfo.title;
  tab.errorPage = true;
  _browseRenderTabs();
}

// ── RSS Feed pill ──
export function _browseUpdateRssPill(tab) {
  if (tab.id !== _browseActiveTab || !tab.rssFeeds || !tab.rssFeeds.length) {
    const cur = window._islandActivities && window._islandActivities['rss'];
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
      _browseUpdateRssPill(tab);
      if (typeof loadAllFeeds === 'function') { allPapers.length = 0; loadAllFeeds(); }
    } : function() {
      // Subscribe to feed
      let feeds = [];
      try { feeds = Settings.getJSON('customFeeds', []); } catch {}
      if (feeds.some(function(f) { return f.url === feedUrl; })) return;
      let name = feed.title || feedUrl;
      try { name = name || new URL(feedUrl).hostname.replace(/^www\./, ''); } catch {}
      feeds.push({ url: feedUrl, name: name, enabled: true });
      Settings.setJSON('customFeeds', feeds);
      _browseUpdateRssPill(tab);
      if (typeof loadAllFeeds === 'function') { allPapers.length = 0; loadAllFeeds(); }
    }
  });
}

// Expose on window so browse-content-scripts.js can call it without circular dep
window._browseUpdateRssPill = _browseUpdateRssPill;
