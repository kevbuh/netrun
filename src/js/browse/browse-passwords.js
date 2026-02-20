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
import { _browseApplyZoom, _browseRenderTabs, _browseZoomLevel, _browseZoomPanX, _browseZoomPanY, _pillMicClick, _pillSyncUrl, browseBack, browseForward, browseNavigate } from '/js/browse/browse-island.js';
import { _browseBindFrame, _browseDownloadIdCounter, _browseDownloads, _browseRenderDownloads, _browseUpdateDownloadBadge, _checkFocusTimer, _saveBrowseDownloads } from '/js/browse/browse-downloads.js';
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
import { onSearchInput, submitSearch } from '/js/search.js';
import { stopCaptions } from '/js/browse/browse-captions.js';

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
    const btn = new window.View('button');
    btn.el.textContent = e.username || 'No username';
    btn.cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.78rem;cursor:pointer;');
    btn.onTap(function() {
      _pwDoAutofill(_browseTabs.find(function(t) { return t.id === tab.id; }), document.querySelector('#browse-content webview'), e.id);
      _pwHideSavePrompt();
    });
    return btn;
  });

  const label = window.Text('Choose account:').font('callout').foreground('tertiary');
  const dismissBtn = new window.View('button');
  dismissBtn.el.textContent = 'Dismiss';
  dismissBtn.cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  dismissBtn.onTap(function() { _pwHideSavePrompt(); });

  const row = window.HStack([label].concat(pillBtns, [dismissBtn])).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  container.prepend(row.build());
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

  const saveBtn = new window.View('button');
  saveBtn.el.textContent = 'Save';
  saveBtn.cssText('padding:3px 12px;border-radius:4px;border:none;background:var(--nr-accent);color:#fff;font-size:0.78rem;cursor:pointer;font-weight:500;');
  saveBtn.onTap(function() {
    window.electronAPI.pwSave({ origin: data.origin, username: data.username, password: password }).catch(function(e) { logger.error('[passwords] Save failed:', e); });
    _pwHideSavePrompt(true);
  });

  const neverBtn = new window.View('button');
  neverBtn.el.textContent = 'Never';
  neverBtn.cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.78rem;cursor:pointer;');
  neverBtn.onTap(function() {
    window._pwSaveDismissed.set(key, true);
    _pwHideSavePrompt(true);
  });

  const closeBtn = new window.View('button');
  closeBtn.el.textContent = '\u00d7';
  closeBtn.cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  closeBtn.onTap(function() { _pwHideSavePrompt(true); });

  const row = window.HStack([lockIcon, promptText, saveBtn, neverBtn, closeBtn]).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  const bar = row.build();
  container.prepend(bar);

  // Auto-dismiss after 15s
  const timer = setTimeout(function() { _pwHideSavePrompt(true); }, 15000);
  bar._pwDismissTimer = timer;
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
export let _browseContextMenu = null;
export let _browseContextData = null;

export function _hideBrowseContextMenu() {
  if (_browseContextMenu) {
    _browseContextMenu.remove();
    _browseContextMenu = null;
  }
  _browseContextData = null;
}

export function _showBrowseContextMenu(x, y, data) {
  _hideBrowseContextMenu();
  _browseContextData = data;

  const linkUrl = data.linkUrl || '';
  const linkText = data.linkText || '';
  const imgUrl = data.imgUrl || '';

  function _ctxItem(label, action) {
    return new window.View('div').className('blm-item')._bindText(label)
      .onTap(function() { action(); _hideBrowseContextMenu(); });
  }
  function _ctxSep() { return new window.View('div').className('blm-sep'); }

  const items = [];

  // Link options
  if (linkUrl) {
    items.push(_ctxItem('Open Link in New Tab', function() { browseNewTab(linkUrl); }));
    items.push(_ctxItem('Open Link Here', function() { browseNavigate(linkUrl); }));
    items.push(_ctxSep());
    items.push(_ctxItem('Save Link As...', function() { _browseSaveLink(linkUrl); }));
    items.push(_ctxItem('Copy Link Address', function() { navigator.clipboard.writeText(linkUrl).catch(function() {}); }));
    if (linkText) {
      items.push(_ctxItem('Copy Link Text', function() { navigator.clipboard.writeText(linkText).catch(function() {}); }));
    }
  }

  // Image options
  if (imgUrl) {
    if (linkUrl) items.push(_ctxSep());
    items.push(_ctxItem('Open Image in New Tab', function() { browseNewTab(imgUrl); }));
    items.push(_ctxItem('Save Image As...', function() { _browseSaveImage(imgUrl); }));
    items.push(_ctxItem('Copy Image Address', function() { navigator.clipboard.writeText(imgUrl).catch(function() {}); }));
  }

  // Search option
  if (linkText && linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    items.push(_ctxSep());
    items.push(_ctxItem('Search Google for "' + truncatedText + '"', function() {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    }));
  }

  const menuView = window.VStack(items).className('browse-link-menu')
    .styles({left: x + 'px', top: y + 'px'});
  const menu = menuView.build();
  document.body.appendChild(menu);
  _browseContextMenu = menu;

  // Adjust if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
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

// Close menu on click outside or escape
document.addEventListener('mousedown', (e) => {
  if (_browseContextMenu && !_browseContextMenu.contains(e.target)) {
    _hideBrowseContextMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _hideBrowseContextMenu();
});
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

  // Clean up chat morph DOM if switching away from a chat tab (keep tab flags for restore)
  const prevTab = win.tabs.find(t => t.id === win.activeTab);
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
    const el = document.createElement('div');
    el.id = 'browse-history-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
  }

  // Restore help page tab if needed
  if (tab && tab._helpPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-help-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderHelpPage(el);
  }

  // Restore netrun hub page tab if needed
  if (tab && tab._netrunPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-netrun-' + tab.id;
    el.className = 'nr-hub-scroll';
    el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;';
    container.appendChild(el);
    tab.el = el;
    if (typeof window._renderNetrunPage === 'function') window._renderNetrunPage(el);
  }

  win.tabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab ? (tab._historyPage ? 'netrun://history' : tab._helpPage ? 'netrun://help' : tab._netrunPage ? 'netrun://' : tab.url) : '');
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
      citeBtn = citeBtnView.build();
      AetherUI.mount(window.RawHTML(icon('at', {size: 16})), citeBtn);
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
      bookmarkBtn = bookmarkBtnView.build();
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
  if (bar) bar.style.display = (tab && tab.blank) || Settings.get('browseTabLayout') === 'island' ? 'none' : '';
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      const ntpView = new window.View('div').className('browse-ntp nr-living-gradient');
      ntp = ntpView.el;

      // File input (low-level)
      const fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.id = 'browse-pdf-file-input'; fileInput.multiple = true;
      fileInput.style.display = 'none';
      fileInput.onchange = function() { handleNtpFileInput(fileInput); };
      ntp.appendChild(fileInput);

      // SVGs
      const submitSvg = icon('arrowUp', {strokeWidth: '2.5'});
      const plusSvg = icon('plus', {});
      const micSvg = icon('microphone', {});

      // Search input (low-level form element)
      const searchInput = document.createElement('input');
      searchInput.type = 'text'; searchInput.id = 'search-query';
      searchInput.placeholder = 'Ask anything...'; searchInput.autocomplete = 'off';
      searchInput.className = 'ntp-search-input';
      searchInput.oninput = function() { onSearchInput(); };
      searchInput.onfocus = function() { _browseUrlCancelHide(); searchInput.select(); _browseUrlShowHistory(); };
      searchInput.onblur = function() { _browseUrlScheduleHide(); };
      searchInput.onkeydown = function(ev) { _browseUrlKeydown(ev); };

      // + button (dropdown menu)
      const addBtn = new window.View('button').className('ntp-add-btn').attr('type', 'button').attr('title', 'More options');
      addBtn.el.innerHTML = plusSvg;
      addBtn.on('mousedown', function(e) { e.preventDefault(); });
      addBtn.onTap(function() {
        _browseUrlCancelHide();
        // Dismiss existing menu if any
        const existing = document.querySelector('.ntp-plus-menu');
        if (existing) { existing.remove(); return; }

        const icons = {
          file: icon('attachment', {strokeWidth: '1.5'}),
          chat: icon('chatDots', {strokeWidth: '1.5'}),
          research: icon('documentSearch', {strokeWidth: '1.5'}),
          terminal: icon('terminal', {strokeWidth: '1.5'}),
        };

        function _menuRow(iconHtml, label, action) {
          const iconView = window.RawHTML(iconHtml);
          iconView.el.style.cssText = 'width:20px;height:20px;flex-shrink:0;color:var(--nr-text-secondary);';
          const row = window.HStack([iconView, window.Text(label)]).alignment('center').gap(3)
            .className('ntp-plus-menu-item');
          row.onTap(function() {
            const m = document.querySelector('.ntp-plus-menu');
            if (m) m.remove();
            action();
          });
          return row;
        }

        const rows = [
          _menuRow(icons.file, 'Add files', function() { fileInput.click(); }),
          new window.View('div').className('ntp-plus-menu-divider'),
          _menuRow(icons.chat, 'Chat', function() {
            const input = document.getElementById('search-query');
            const text = input ? input.value.trim() : '';
            if (text && typeof chatViewNewThread === 'function') chatViewNewThread(text);
            else if (typeof openChatPage === 'function') openChatPage();
          }),
          _menuRow(icons.research, 'Research', function() {
            if (typeof openResearch === 'function') openResearch();
          }),
          _menuRow(icons.terminal, 'Terminal', function() {
            if (typeof wmOpen === 'function') wmOpen('terminal');
          }),
        ];

        const menuView = window.VStack(rows).className('ntp-plus-menu nr-menu').material('thin');
        const menu = menuView.build();
        document.body.appendChild(menu);

        // Position above the + button
        const rect = addBtn.el.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        menu.style.zIndex = '10001';

        // Close on outside click
        setTimeout(function() {
          document.addEventListener('mousedown', function _dismiss(e) {
            if (menu.contains(e.target) || addBtn.el.contains(e.target)) return;
            menu.remove();
            document.removeEventListener('mousedown', _dismiss, true);
          }, true);
        }, 0);
      });

      // Mic button
      const micBtn = new window.View('button').className('ntp-mic-btn').attr('type', 'button').attr('title', 'Voice input');
      micBtn.el.innerHTML = micSvg;
      micBtn.on('mousedown', function(e) { e.preventDefault(); });
      micBtn.onTap(function() { if (typeof _pillMicClick === 'function') _pillMicClick(); });

      // Submit button
      const submitBtn = new window.View('button').className('ntp-action-submit').attr('title', 'Search').attr('type', 'submit');
      submitBtn.el.innerHTML = submitSvg;

      // Chat history button
      const chatHistBtn = new window.View('button').className('ntp-chat-history-btn').attr('type', 'button').attr('title', 'All chats');
      chatHistBtn.el.innerHTML = icon('chatHistory', { size: 18 });
      chatHistBtn.on('mousedown', function(e) { e.preventDefault(); });
      chatHistBtn.onTap(function() {
        if (typeof openChatPage === 'function') openChatPage();
      });

      // Single-row search bar: [+] [input] [chat-history] [mic] [send]
      const searchRow = new window.View('div').className('ntp-search-row');
      searchRow.el.appendChild(addBtn.el);
      searchRow.el.appendChild(searchInput);
      searchRow.el.appendChild(chatHistBtn.el);
      searchRow.el.appendChild(micBtn.el);
      searchRow.el.appendChild(submitBtn.el);

      const histDropdown = new window.View('div').attr('id', 'search-history-dropdown-view').className('ntp-dropdown');
      histDropdown.styles({ display: 'none' });

      const fileChips = new window.View('div').attr('id', 'ntp-file-chips').className('ntp-file-chips-container');

      const searchBox = new window.View('div').className('ntp-search-box max-w-[680px] mx-auto');
      searchBox.el.appendChild(searchRow.el);

      const form = new window.View('form').attr('id', 'search-form');
      form.on('submit', function(e) { e.preventDefault(); submitSearch(); });
      form.el.appendChild(searchBox.el);
      form.el.appendChild(histDropdown.el);
      form.el.appendChild(fileChips.el);

      const center = new window.View('div').className('browse-ntp-center');
      center.el.appendChild(form.el);

      const inner = new window.View('div').className('browse-ntp-inner');
      inner.el.appendChild(center.el);
      ntp.appendChild(inner.el);

      const versionEl = window.Text('netrun').className('browse-ntp-version');
      versionEl.cssText('position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:var(--nr-text-quaternary);font-size:11px;font-family:monospace;user-select:none;letter-spacing:0.08em;');
      ntp.appendChild(versionEl.el);
      container.appendChild(ntp);
      apiGet('/api/version').then(v => {
        const el = ntp.querySelector('.browse-ntp-version');
        if (el && v.version) el.textContent = 'netrun v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
      }).catch(() => {});
      ntp.addEventListener('dragover', function(e) { e.preventDefault(); ntp.style.outline = '2px dashed var(--nr-accent)'; });
      ntp.addEventListener('dragleave', function() { ntp.style.outline = ''; });
      ntp.addEventListener('drop', function(e) {
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
  if (Settings.get('browseTabLayout') === 'island') _pillSyncUrl();
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
  if (tab.el) tab.el.remove();
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

