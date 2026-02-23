// browse-passwords.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import { apiGet } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { showPanelForView, hidePanel, _invalidatePanelRender } from '/js/core/core-nav.js';
import { islandRemove } from '/js/core/core-ui.js';
import { _updateNowPlayingContext } from '/js/core/core-audio.js';
import { openResearch, wmOpen } from '/js/core/core-views.js';
import { _annotationsEnabled, _showAnnotateOfferPill, _updateAnnotateButtonState } from '/js/browse/browse-annotations.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _pillSyncUrl, browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _browseApplyZoom, browseBack, browseForward } from '/js/toolbar/toolbar-nav.js';
var _browseZoomLevel = window._browseZoomLevel ?? 1.0;
var _browseZoomPanX = window._browseZoomPanX ?? 0;
var _browseZoomPanY = window._browseZoomPanY ?? 0;
var _pillMicClick = function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); };
import { _browseBindFrame } from '/js/browse/browse-frame-bind.js';
import { _browseDownloadIdCounter, _browseDownloads, _browseRenderDownloads, _browseUpdateDownloadBadge, _saveBrowseDownloads } from '/js/browse/browse-download-mgr.js';
import { _checkFocusTimer } from '/js/browse/browse-doom-scroll.js';
import { _browseCloseFindBar, _browseFindBarActive, _browseUpdateSaveBtn } from '/js/browse/browse-features.js';
import { _browseCreateFrame, handleNtpFileInput, handleNtpFileUpload } from '/js/browse/browse-ntp.js';
import { _browseEnsureTabFrame, _browseFocusPane, _browseGetFocusedPane, _browseGetSplitPanes, _browseIsSplitMode, _browsePaneForTab, _browseRebuildSplitLayout, _browseSetSplitPanes, browseUnsplitPane } from '/js/browse/browse-split-panes.js';
import { _browseSetUrlDisplay, _browseUrlCancelHide, _browseUrlKeydown, _browseUrlScheduleHide, _browseUrlShowHistory, _renderHelpPage, _renderWebSearchHistoryPage } from '/js/browse-urlbar.js';
import { _updateAudioIndicator } from '/js/browse/browse-audio.js';
import { _pageInfoRestoreForTab, _pageInfoCleanup } from '/js/browse/browse-pageinfo.js';
import { _currentPaperViewPaper, setCurrentPaperViewPaper } from '/js/views.js';
import { browseCloseWindow, browseNewPaperTab, browseNewTab } from '/js/browse/browse-windows.js';
import { chatViewCleanupMorph, chatViewNewThread, openChatPage } from '/js/chat-view.js';
import { drawViewCleanupMorph } from '/js/draw-view.js';
import { isPostSaved } from '/js/feed.js';
import { _saveTabPanelState, _restoreTabPanelState } from '/js/panel-state.js';
import { onSearchInput, submitSearch } from '/js/search.js';
import { stopCaptions } from '/js/browse/browse-captions.js';
import { _nerdModeOnTabSelect, _nerdModeOnTabClose, _isNerdMode } from '/js/browse/browse-nerd-mode.js';

// ── Password Manager ──

export function _pwCheckAutofill(tab, frame) {
  if (!window._browseIsElectron || !window.electronAPI || !window.electronAPI.pwGet) return;
  if (window._pwAutofillOffered.has(tab.id)) return;
  window._pwAutofillOffered.add(tab.id);
  try {
    const origin = new URL(tab.url).origin;
    window.electronAPI.pwGet(origin).then(entries => {
      if (!entries || !entries.length) return;
      if (entries.length === 1) {
        _pwDoAutofill(tab, frame, entries[0].id);
      } else {
        _pwShowAutofillPicker(tab, frame, entries);
      }
    }).catch(() => {});
  } catch (e) {}
}

export function _pwDoAutofill(tab, frame, entryId) {
  if (!window.electronAPI || !window.electronAPI.pwFill) return;
  window.electronAPI.pwFill(entryId).then(cred => {
    if (!cred) return;
    const un = cred.username.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const pw = cred.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    frame.executeJavaScript(`
      (function(){
        var pwFields=document.querySelectorAll('input[type="password"]');
        if(!pwFields.length) return;
        var pwField=pwFields[0];
        var form=pwField.closest('form');
        var scope=form||document;
        var candidates=scope.querySelectorAll('input[type="text"],input[type="email"],input:not([type])');
        var unField=null;
        for(var i=candidates.length-1;i>=0;i--){
          var c=candidates[i];
          var n=(c.name||'').toLowerCase()+(c.id||'').toLowerCase()+(c.autocomplete||'').toLowerCase()+(c.placeholder||'').toLowerCase();
          if(n.match(/user|email|login|account|name/)){unField=c;break;}
        }
        if(!unField&&candidates.length) unField=candidates[candidates.length-1];
        function setVal(el,val){
          var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          nativeSetter.call(el,val);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
        }
        if(unField) setVal(unField,'${un}');
        setVal(pwField,'${pw}');
      })();
    `).catch(() => {});
  }).catch(() => {});
}

export function _pwShowAutofillPicker(tab, frame, entries) {
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;

  const pillBtns = entries.map(function(e) {
    const btn = new window.View('button')
      .text(e.username || 'No username')
      .cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.78rem;cursor:pointer;');
    btn.onTap(function() {
      _pwDoAutofill(_browseTabs.find(function(t) { return t.id === tab.id; }), document.querySelector('#browse-content webview'), e.id);
      _pwHideSavePrompt();
    });
    return btn;
  });

  const label = window.Text('Choose account:').font('callout').foreground('tertiary');
  const dismissBtn = new window.View('button')
    .text('Dismiss')
    .cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  dismissBtn.onTap(function() { _pwHideSavePrompt(); });

  const row = window.HStack([label].concat(pillBtns, [dismissBtn])).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  container.prepend(row.el);
}

export function _pwShowSavePrompt(tab, data) {
  if (!window._browseIsElectron || !window.electronAPI || !window.electronAPI.pwSave) return;
  if (!data.password) return;
  // Dedup rapid submits
  const now = Date.now();
  if (window._pwLastSubmit && window._pwLastSubmit.origin === data.origin && window._pwLastSubmit.username === data.username && now - window._pwLastSubmit.ts < 2000) return;
  window._pwLastSubmit = { origin: data.origin, username: data.username, ts: now };
  // Check if dismissed
  const key = data.origin + '|' + data.username;
  if (window._pwSaveDismissed.has(key)) return;
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;

  const displayUser = data.username || 'this site';
  // Keep password in closure, not DOM
  const password = data.password;

  const lockIcon = window.RawHTML(icon('lock', {size: 16, style: 'color:var(--nr-accent);flex-shrink:0;'}));

  const promptText = window.RawHTML('<span style="font-size:0.8rem;color:var(--nr-text-primary);">Save password for <strong>' + escapeHtml(displayUser) + '</strong>?</span>');

  const saveBtn = new window.View('button')
    .text('Save')
    .cssText('padding:3px 12px;border-radius:4px;border:none;background:var(--nr-accent);color:#fff;font-size:0.78rem;cursor:pointer;font-weight:500;');
  saveBtn.onTap(function() {
    window.electronAPI.pwSave({ origin: data.origin, username: data.username, password: password }).catch(function(e) { logger.error('[passwords] Save failed:', e); });
    _pwHideSavePrompt(true);
  });

  const neverBtn = new window.View('button')
    .text('Never')
    .cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.78rem;cursor:pointer;');
  neverBtn.onTap(function() {
    window._pwSaveDismissed.set(key, true);
    _pwHideSavePrompt(true);
  });

  const closeBtn = new window.View('button')
    .text('\u00d7')
    .cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  closeBtn.onTap(function() { _pwHideSavePrompt(true); });

  const row = window.HStack([lockIcon, promptText, saveBtn, neverBtn, closeBtn]).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  container.prepend(row.el);

  // Auto-dismiss after 15s
  const timer = setTimeout(function() { _pwHideSavePrompt(true); }, 15000);
  row.el._pwDismissTimer = timer;
}

export function _pwHideSavePrompt(clearPending) {
  if (clearPending) window._pwPendingPrompt = null;
  const bar = document.getElementById('browse-pw-bar');
  if (bar) {
    if (bar._pwDismissTimer) clearTimeout(bar._pwDismissTimer);
    bar.remove();
  }
}

// Context menu for Browse view (links and images)
var _browseCtxMenu = null;
export let _browseContextData = null;

export function _hideBrowseContextMenu() {
  if (_browseCtxMenu) { _browseCtxMenu.dismiss(); _browseCtxMenu = null; }
  _browseContextData = null;
}

export function _showBrowseContextMenu(x, y, data) {
  _hideBrowseContextMenu();
  _browseContextData = data;

  const linkUrl = data.linkUrl || '';
  const linkText = data.linkText || '';
  const imgUrl = data.imgUrl || '';

  const items = [];

  // Link options
  if (linkUrl) {
    items.push({ label: 'Open Link in New Tab', handler: function() { browseNewTab(linkUrl); } });
    items.push({ label: 'Open Link Here', handler: function() { browseNavigate(linkUrl); } });
    items.push({ divider: true });
    items.push({ label: 'Save Link As...', handler: function() { _browseSaveLink(linkUrl); } });
    items.push({ label: 'Copy Link Address', handler: function() { navigator.clipboard.writeText(linkUrl).then(function() { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(function() {}); } });
    if (linkText) {
      items.push({ label: 'Copy Link Text', handler: function() { navigator.clipboard.writeText(linkText).then(function() { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(function() {}); } });
    }
  }

  // Image options
  if (imgUrl) {
    if (linkUrl) items.push({ divider: true });
    items.push({ label: 'Open Image in New Tab', handler: function() { browseNewTab(imgUrl); } });
    items.push({ label: 'Save Image As...', handler: function() { _browseSaveImage(imgUrl); } });
    items.push({ label: 'Copy Image Address', handler: function() { navigator.clipboard.writeText(imgUrl).then(function() { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(function() {}); } });
  }

  // Search option
  if (linkText && linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    items.push({ divider: true });
    items.push({ label: 'Search Google for "' + truncatedText + '"', handler: function() {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    }});
  }

  _browseCtxMenu = Menu(null, items);
  _browseCtxMenu.showAt(x, y);
}

// Helper to trigger download
export function _browseDownloadFile(url, defaultFilename = 'download') {
  const filename = url.split('/').pop().split('?')[0] || defaultFilename;

  if (window.electronAPI && window.electronAPI.downloadURL) {
    // Electron handles download tracking via download-started event
    window.electronAPI.downloadURL(url);
  } else {
    // Browser fallback: create manual download entry
    const dl = {
      id: 'dl-' + (++_browseDownloadIdCounter),
      filename,
      url,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: 0,
      startTime: Date.now(),
      savePath: ''
    };
    _browseDownloads.unshift(dl);
    _browseUpdateDownloadBadge();
    _browseRenderDownloads();
    _saveBrowseDownloads();

    // Trigger download via anchor
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Mark as completed (can't track progress in browser)
    setTimeout(() => {
      dl.state = 'completed';
      dl.receivedBytes = dl.totalBytes = 1;
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    }, 1500);
  }
}

export function _browseSaveImage(url) {
  _browseDownloadFile(url, 'image');
}

export function _browseSaveLink(url) {
  _browseDownloadFile(url, 'download');
}

// Close menu when webview gets focus (user clicked inside it)
window.addEventListener('blur', () => {
  _hideBrowseContextMenu();
});

// Mouse back/forward buttons (macOS — app-command doesn't fire on Mac)
document.addEventListener('mousedown', (e) => {
  if (e.button === 3) { e.preventDefault(); browseBack(); }
  else if (e.button === 4) { e.preventDefault(); browseForward(); }
});

export function browseSelectTab(id) {
  const win = window._getCurrentWindow();
  if (!win) return;

  // Split mode branch: if tab is in a pane, focus it; else replace focused pane
  if (_browseIsSplitMode()) {
    const panes = _browseGetSplitPanes();
    const paneWithTab = panes.find(p => p.tabId === id);
    // Per-tab AI: save outgoing tab's panel state
    const splitPrevTab = win.tabs.find(t => t.id === win.activeTab);
    if (splitPrevTab && splitPrevTab.id !== id) _saveTabPanelState(splitPrevTab);
    win.activeTab = id;
    const splitTab = win.tabs.find(t => t.id === id);
    if (splitTab) splitTab.lastVisited = Date.now();
    if (paneWithTab) {
      _browseFocusPane(paneWithTab.id);
    } else {
      // Replace focused pane's tab with this one
      const focusedId = _browseGetFocusedPane();
      const focusedPane = panes.find(p => p.id === focusedId) || panes[0];
      focusedPane.tabId = id;
      _browseSetSplitPanes(panes);
      const tab = win.tabs.find(t => t.id === id);
      if (tab) _browseEnsureTabFrame(tab);
      _browseRebuildSplitLayout();
      _browseFocusPane(focusedPane.id);
    }
    const tab = win.tabs.find(t => t.id === id);
    _browseRenderTabs();
    _browseUpdateNewTabPage(tab);
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, tab ? (tab.url || '') : '');
    window._browseSaveTabs();

    // Handle paper tab in split mode
    if (tab && tab.paper) {
      setCurrentPaperViewPaper(tab.paper);
      if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
        _tryRenderSavedContent(tab.el, tab.paper);
      }
      _browseUpdateBarForTab(tab);
    }
    // Show annotate offer pill (restores cache or shows clickable "Annotate" pill)
    if (tab && !tab.blank && tab.url && typeof _showAnnotateOfferPill === 'function') _showAnnotateOfferPill(tab);
    if (tab && !tab.blank && tab.url) _pageInfoRestoreForTab(tab);
    // Per-tab AI: restore incoming tab's panel state
    if (splitPrevTab && splitPrevTab.id !== id) {
      const existing = document.getElementById('doc-chat-ask-float');
      if (existing) existing.remove();
      _restoreTabPanelState(tab);
    }
    return;
  }

  // Close find bar when switching tabs
  if (_browseFindBarActive) _browseCloseFindBar();
  // Reset zoom when switching tabs
  if (_browseZoomLevel !== 1) {
    _browseZoomLevel = 1;
    _browseZoomPanX = 0;
    _browseZoomPanY = 0;
    _browseApplyZoom();
  }

  // Stop captions when switching away from captured tab
  if (window._ccTabId && window._ccTabId !== id) stopCaptions();

  // Clear pageinfo pill when switching tabs (will restore from cache for new tab)
  _pageInfoCleanup();

  // Per-tab AI: save outgoing tab's panel state and dismiss panel DOM
  const prevTab = win.tabs.find(t => t.id === win.activeTab);
  if (prevTab && prevTab.id !== id) {
    _saveTabPanelState(prevTab);
    const existingPanel = document.getElementById('doc-chat-ask-float');
    if (existingPanel) existingPanel.remove();
  }

  // Clean up chat morph DOM if switching away from a chat tab (keep tab flags for restore)
  if (prevTab && prevTab._chatPage && prevTab.id !== id) {
    const ntpMorphed = document.getElementById('browse-content')?.querySelector('.browse-ntp.chat-mode');
    if (ntpMorphed && typeof chatViewCleanupMorph === 'function') chatViewCleanupMorph();
  }
  // Clean up draw morph DOM if switching away from a draw tab
  if (prevTab && prevTab._drawPage && prevTab.id !== id) {
    const ntpMorphed = document.getElementById('browse-content')?.querySelector('.browse-ntp.draw-mode');
    if (ntpMorphed && typeof drawViewCleanupMorph === 'function') drawViewCleanupMorph();
  }

  win.activeTab = id;
  const tab = win.tabs.find(t => t.id === id);
  // Focus timer: start/stop based on new tab's URL
  if (typeof _checkFocusTimer === 'function') _checkFocusTimer(tab ? (tab.url || '') : '');
  if (tab) tab.lastVisited = Date.now();

  // Auto-close blank new tabs when navigating away, keeping only the most recent one
  const blankTabs = win.tabs.filter(t => t.blank && t.id !== id);
  if (blankTabs.length > 1) {
    // Keep only the last blank tab (most recently created), close the rest
    const toClose = blankTabs.slice(0, -1);
    for (const bt of toClose) {
      const bi = win.tabs.indexOf(bt);
      if (bi !== -1) {
        if (bt.el) bt.el.remove();
        win.tabs.splice(bi, 1);
      }
    }
  }

  // Load deferred tab if needed (lazy loading — tabs only load when selected)
  if (tab && tab.deferred && !tab.el && tab.url) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, tab.url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
    tab.deferred = false;
  }

  // Restore history page tab if needed
  if (tab && tab._historyPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const pageView = new window.View('div').id('browse-history-' + tab.id)
      .cssText('width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;');
    container.appendChild(pageView.el);
    tab.el = pageView.el;
    _renderWebSearchHistoryPage(pageView.el);
  }

  // Restore help page tab if needed
  if (tab && tab._helpPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const pageView = new window.View('div').id('browse-help-' + tab.id)
      .cssText('width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;');
    container.appendChild(pageView.el);
    tab.el = pageView.el;
    _renderHelpPage(pageView.el);
  }

  // Restore netrun hub page tab if needed
  if (tab && tab._netrunPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const pageView = new window.View('div').id('browse-netrun-' + tab.id)
      .className('nr-hub-scroll')
      .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;');
    container.appendChild(pageView.el);
    tab.el = pageView.el;
    if (typeof window._renderNetrunPage === 'function') window._renderNetrunPage(pageView.el);
  }

  // Restore bookmarks page tab if needed
  if (tab && tab._bookmarksPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const pageView = new window.View('div').id('browse-bookmarks-' + tab.id)
      .className('nr-bm-layout')
      .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;');
    container.appendChild(pageView.el);
    tab.el = pageView.el;
    if (typeof window.openBookmarks === 'function') window.openBookmarks();
  }

  win.tabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab ? (tab._historyPage ? 'netrun://history' : tab._helpPage ? 'netrun://help' : tab._netrunPage ? 'netrun://' : tab._bookmarksPage ? 'netrun://bookmarks' : tab._terminalPage ? 'terminal://' : tab.url) : '');
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  window._browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  _updateAudioIndicator();

  // Restore chat morph if switching back to a chat tab
  if (tab && tab._chatPage && tab._chatThreadId) {
    if (typeof openChatPage === 'function') openChatPage(tab._chatThreadId);
  }

  // Paper tab handling
  if (tab && tab.paper) {
    setCurrentPaperViewPaper(tab.paper);
    if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
      _tryRenderSavedContent(tab.el, tab.paper);
    }
    // Update sidebar via universal panel
    if (tab.arxivId) {
      if (!_panelVisible) {
        _panelVisible = true;
        Settings.set('universalPanelVisible', 'true');
      }
      _invalidatePanelRender('browse');
      showPanelForView('browse');
    } else {
      hidePanel();
    }
    if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(tab.url);
    _browseUpdateBarForTab(tab);
  } else {
    setCurrentPaperViewPaper(null);
    _browseUpdateBarForTab(tab);
    hidePanel();
    // Update sidebar for the selected tab
    if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
      _initSidebarForUrl(tab.url);
    }
  }
  if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();
  _updateAnnotateButtonState();
  // Show annotate offer pill (restores cache or shows clickable "Annotate" pill)
  if (tab && !tab.blank && tab.url && typeof _showAnnotateOfferPill === 'function') {
    _showAnnotateOfferPill(tab);
  } else {
    const act = typeof window._islandActivities !== 'undefined' ? window._islandActivities['insight'] : null;
    if (act) islandRemove('insight');
  }
  // Restore page info pill from cache for the selected tab
  if (tab && !tab.blank && tab.url) _pageInfoRestoreForTab(tab);

  // Per-tab AI: restore incoming tab's panel state
  if (prevTab && prevTab.id !== id) _restoreTabPanelState(tab);

  // Nerd mode: sync viewer/panel visibility when switching tabs
  _nerdModeOnTabSelect(tab);
}

export function _browseUpdateBarForTab(tab) {
  let citeBtn = document.getElementById('browse-cite-btn');
  let bookmarkBtn = document.getElementById('browse-paper-bookmark-btn');
  if (tab && tab.paper) {
    // Cite button
    if (!citeBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      const citeBtnView = new window.View('button').id('browse-cite-btn')
        .className('browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover flex items-center justify-center')
        .attr('title', 'Cite');
      citeBtnView.onTap(function() { if (typeof showCitePopup === 'function') showCitePopup(); });
      citeBtnView.add(window.RawHTML(icon('at', {size: 16})));
      citeBtn = citeBtnView.el;
      if (moreBtn) moreBtn.parentElement.insertBefore(citeBtn, moreBtn);
    }
    citeBtn.style.display = '';
    // Bookmark button
    if (!bookmarkBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      const bookmarkBtnView = new window.View('button').id('browse-paper-bookmark-btn')
        .className('browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center')
        .attr('title', 'Save');
      bookmarkBtnView.onTap(function() { if (typeof togglePaperViewBookmark === 'function') togglePaperViewBookmark(); });
      bookmarkBtn = bookmarkBtnView.el;
      if (moreBtn) moreBtn.parentElement.insertBefore(bookmarkBtn, citeBtn);
    }
    const isSaved = typeof isPostSaved === 'function' && isPostSaved(tab.paper.link);
    bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (isSaved ? 'text-accent' : 'text-dimmer hover:text-primary');
    bookmarkBtn.title = isSaved ? 'Saved' : 'Save';
    AetherUI.mount(window.RawHTML(icon('bookmark', {size: 16, fill: isSaved ? 'currentColor' : 'none', strokeWidth: '1.5'})), bookmarkBtn);
    bookmarkBtn.style.display = '';
  } else {
    if (citeBtn) citeBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
  }
}

export function _browseUpdateNewTabPage(tab) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.getElementById('browse-bar');
  if (bar) bar.style.display = 'none';
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      const ntpView = new window.View('div').className('browse-ntp nr-living-gradient');
      ntp = ntpView.el;

      // File input (low-level — kept as plain input for .click() / .files API)
      const fileInput = new window.View('input').attr('type', 'file').attr('id', 'browse-pdf-file-input')
        .attr('multiple', '')
        .cssText('display:none;');
      fileInput.on('change', function() { handleNtpFileInput(fileInput.el); });
      ntpView.add(fileInput);

      // SVGs
      const submitSvg = icon('arrowUp', {strokeWidth: '2.5'});
      const plusSvg = icon('plus', {});
      const micSvg = icon('microphone', {});

      // + button (dropdown menu)
      const addBtn = new window.View('button').className('ntp-add-btn').attr('type', 'button').attr('title', 'More options')
        .add(window.RawHTML(plusSvg));
      addBtn.on('mousedown', function(e) { e.preventDefault(); _browseUrlCancelHide(); });
      Menu(addBtn, function() {
        return [
          { icon: icon('attachment', {strokeWidth: '1.5'}), label: 'Add files', handler: function() { fileInput.el.click(); } },
          { divider: true },
          { icon: icon('chatDots', {strokeWidth: '1.5'}), label: 'Chat', handler: function() {
            var input = document.getElementById('search-query');
            var text = input ? input.value.trim() : '';
            if (text && typeof chatViewNewThread === 'function') chatViewNewThread(text);
            else if (typeof openChatPage === 'function') openChatPage();
          }},
          { icon: icon('documentSearch', {strokeWidth: '1.5'}), label: 'Research', handler: function() {
            if (typeof openResearch === 'function') openResearch();
          }},
          { icon: icon('terminal', {strokeWidth: '1.5'}), label: 'Terminal', handler: function() {
            if (typeof wmOpen === 'function') wmOpen('terminal');
          }}
        ];
      });

      // Mic button
      const micBtn = new window.View('button').className('ntp-mic-btn').attr('type', 'button').attr('title', 'Voice input')
        .add(window.RawHTML(micSvg));
      micBtn.on('mousedown', function(e) { e.preventDefault(); });
      micBtn.onTap(function() { if (typeof _pillMicClick === 'function') _pillMicClick(); });

      // Submit button
      const submitBtn = new window.View('button').className('ntp-action-submit').attr('title', 'Search').attr('type', 'submit')
        .add(window.RawHTML(submitSvg));

      // Chat history button
      const chatHistBtn = new window.View('button').className('ntp-chat-history-btn').attr('type', 'button').attr('title', 'All chats')
        .add(window.RawHTML(icon('chatHistory', { size: 18 })));
      chatHistBtn.on('mousedown', function(e) { e.preventDefault(); });
      chatHistBtn.onTap(function() {
        if (typeof openChatPage === 'function') openChatPage();
      });

      // AI mode chip for NTP
      const _ntpAiCloud = State(Settings.get('aiProvider') === 'openrouter');
      const _cloudSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5h4.5l-3.5 2.5 1.5 4.5-4-3-4 3 1.5-4.5-3.5-2.5h4.5z"/></svg>';
      const _localSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
      const ntpAiChip = new window.View('button').attr('type', 'button').attr('title', 'Toggle Local/Cloud AI');
      Effect(function() {
        var cloud = _ntpAiCloud.value;
        ntpAiChip.className('ai-mode-chip' + (cloud ? ' ai-mode-cloud' : ''));
        AetherUI.mount(
          window.HStack([window.RawHTML(cloud ? _cloudSvg : _localSvg), window.Text(cloud ? 'Cloud' : 'Local')]),
          ntpAiChip.el
        );
      });
      ntpAiChip.on('mousedown', function(e) { e.preventDefault(); });
      ntpAiChip.onTap(function() {
        var cur = Settings.get('aiProvider') || 'ollama';
        var next = cur === 'openrouter' ? 'ollama' : 'openrouter';
        Settings.set('aiProvider', next);
        if (window.electronAPI && window.electronAPI.providerSetDefault) window.electronAPI.providerSetDefault(next);
        window.dispatchEvent(new CustomEvent('aimode-changed', { detail: { provider: next } }));
      });
      window.addEventListener('aimode-changed', function() {
        _ntpAiCloud.value = Settings.get('aiProvider') === 'openrouter';
      });

      // Single-row search bar: [+] [input] [ai-mode] [chat-history] [mic] [send]
      // searchInput is a plain DOM element (needs value/focus/select APIs), wrap inline
      const searchInputView = new window.View('input').attr('type', 'text').attr('id', 'search-query')
        .attr('placeholder', 'Ask anything...').attr('autocomplete', 'off')
        .className('ntp-search-input');
      const searchInput = searchInputView.el;
      searchInput.oninput = function() { onSearchInput(); };
      searchInput.onfocus = function() { _browseUrlCancelHide(); searchInput.select(); _browseUrlShowHistory(); };
      searchInput.onblur = function() { _browseUrlScheduleHide(); };
      searchInput.onkeydown = function(ev) { _browseUrlKeydown(ev); };
      searchInputView.on('paste', function(ev) {
        if (!ev.clipboardData) return;
        var imageFile = null;
        // Check clipboardData.items for image types
        var items = ev.clipboardData.items;
        if (items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
              imageFile = items[i].getAsFile();
              break;
            }
          }
        }
        // Fallback: check clipboardData.files
        if (!imageFile && ev.clipboardData.files) {
          for (var j = 0; j < ev.clipboardData.files.length; j++) {
            if (ev.clipboardData.files[j].type.startsWith('image/')) {
              imageFile = ev.clipboardData.files[j];
              break;
            }
          }
        }
        if (!imageFile) return;
        ev.preventDefault();
        // Read image as base64, then add to chat
        var reader = new FileReader();
        reader.onload = function() {
          var base64 = reader.result.split(',')[1];
          if (!base64) return;
          var ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
          if (!ntpEl) return;
          var addImage = function() {
            import('/js/panel-chat.js').then(function(mod) {
              mod._addScreenshotToPanel(ntpEl, base64);
            });
          };
          if (ntpEl.classList.contains('chat-mode')) {
            // Already in chat mode — add image directly
            addImage();
          } else {
            // Morph NTP into chat mode, then add image
            chatViewNewThread().then(function() {
              // Morph is complete, add the image
              addImage();
            });
          }
        };
        reader.readAsDataURL(imageFile);
      });

      const searchRow = new window.View('div').className('ntp-search-row')
        .add(addBtn)
        .add(searchInputView)
        .add(ntpAiChip)
        .add(chatHistBtn)
        .add(micBtn)
        .add(submitBtn);

      const histDropdown = new window.View('div').attr('id', 'search-history-dropdown-view').className('ntp-dropdown');
      histDropdown.styles({ display: 'none' });

      const fileChips = new window.View('div').attr('id', 'ntp-file-chips').className('ntp-file-chips-container');

      const searchBox = new window.View('div').className('ntp-search-box max-w-[680px] mx-auto')
        .add(searchRow);

      const form = new window.View('form').attr('id', 'search-form')
        .add(searchBox)
        .add(histDropdown)
        .add(fileChips);
      form.on('submit', function(e) { e.preventDefault(); submitSearch(); });

      const center = new window.View('div').className('browse-ntp-center')
        .add(form);

      const inner = new window.View('div').className('browse-ntp-inner')
        .add(center);
      ntpView.add(inner);

      const versionEl = window.Text('netrun').className('browse-ntp-version');
      versionEl.cssText('position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:var(--nr-text-quaternary);font-size:11px;font-family:monospace;user-select:none;letter-spacing:0.08em;cursor:pointer;transition:color 0.15s;');
      versionEl.attr('title', 'netrun://');
      versionEl.on('mouseenter', function() { versionEl.el.style.color = 'var(--nr-text-secondary)'; });
      versionEl.on('mouseleave', function() { versionEl.el.style.color = ''; });
      versionEl.onTap(function() { browseNavigate('netrun://'); });
      ntpView.add(versionEl);
      container.appendChild(ntp);
      apiGet('/api/version').then(v => {
        const el = ntp.querySelector('.browse-ntp-version');
        if (el && v.version) el.textContent = 'netrun v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
      }).catch(() => {});
      ntpView.on('dragover', function(e) { e.preventDefault(); ntp.style.outline = '2px dashed var(--nr-accent)'; });
      ntpView.on('dragleave', function() { ntp.style.outline = ''; });
      ntpView.on('drop', function(e) {
        e.preventDefault();
        ntp.style.outline = '';
        const files = e.dataTransfer.files;
        if (files.length) {
          for (const file of files) handleNtpFileUpload(file);
        }
      });
    }
    ntp.style.display = '';
    // Clear search input, focus it, and enable focus-on-type
    const ntpInput = ntp.querySelector('#search-query');
    if (ntpInput) {
      ntpInput.value = '';
      requestAnimationFrame(() => ntpInput.focus());
      if (!ntp._focusOnType) {
        ntp._focusOnType = true;
        ntp.addEventListener('keydown', (e) => {
          if (e.target === ntpInput || e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key.length === 1) ntpInput.focus();
        });
      }
    }
  } else if (ntp) {
    // Keep NTP visible when in chat-mode or draw-mode morph
    if (!ntp.classList.contains('chat-mode') && !ntp.classList.contains('draw-mode')) ntp.style.display = 'none';
  }
  _pillSyncUrl();
  const pinchOverlay = container.querySelector('.browse-pinch-overlay');
  if (pinchOverlay) pinchOverlay.style.pointerEvents = (_browseZoomLevel > 1 && tab && !tab.blank) ? 'auto' : 'none';
}

export function browseCloseTab(id) {
  const win = window._getCurrentWindow();
  if (!win) return;
  const idx = win.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = win.tabs[idx];

  // If tab is in a split pane, remove that pane first
  if (_browseIsSplitMode()) {
    const pane = _browsePaneForTab(id);
    if (pane) browseUnsplitPane(pane.id);
  }

  window._browseClosedTabs.push({ url: tab.url || '', title: tab.title, blank: !!tab.blank, paper: tab.paper || null, contentType: tab.contentType || null, arxivId: tab.arxivId || null });
  if (window._browseClosedTabs.length > window._BROWSE_CLOSED_TABS_MAX) window._browseClosedTabs.splice(0, window._browseClosedTabs.length - window._BROWSE_CLOSED_TABS_MAX);
  Settings.setJSON('browseClosedTabs', window._browseClosedTabs);
  // Stop captions if this is the captured tab
  if (window._ccTabId === id) stopCaptions();
  window._pwAutofillOffered.delete(id);
  _annotationsEnabled.delete(id);
  // Clean up nerd mode state and viewer
  _nerdModeOnTabClose(id);
  if (tab._nerdViewerEl) { tab._nerdViewerEl.remove(); tab._nerdViewerEl = null; }
  if (tab.el) tab.el.remove();
  if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('var(--nr-text-tertiary)');
  // Clean up audio tracking
  window._browseAudioTabs.delete(id);
  _updateAudioIndicator();
  win.tabs.splice(idx, 1);
  if (!win.tabs.length) {
    if (window._browseWindows.length > 1) {
      browseCloseWindow(win.id);
      _browseAnimateBounce();
    } else {
      browseNewTab();
      _browseAnimateBounce();
    }
    return;
  }
  if (win.activeTab === id) {
    const nextIdx = Math.min(idx, win.tabs.length - 1);
    browseSelectTab(win.tabs[nextIdx].id);
  } else {
    _browseRenderTabs();
  }
  window._browseSaveTabs();
}

export function browseReopenTab() {
  if (!window._browseClosedTabs.length) return;
  const closed = window._browseClosedTabs.pop();
  Settings.setJSON('browseClosedTabs', window._browseClosedTabs);
  if (closed.paper && closed.contentType) {
    browseNewPaperTab(closed.url, closed.paper);
  } else {
    browseNewTab(closed.url);
  }
}

export function _browseAnimateBounce() {
  const content = document.getElementById('browse-content');
  if (!content) return;
  Motion.sequence([
    { el: content, spring: 'snappy', from: { x: 0, scale: 1 }, to: { x: -60, scale: 0.97 }, duration: 120 },
    { el: content, spring: 'snappy', from: { x: -60, scale: 0.97 }, to: { x: 0, scale: 1 } }
  ]);
}

