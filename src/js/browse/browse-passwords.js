// browse-passwords.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Password Manager ──

function _pwCheckAutofill(tab, frame) {
  if (!_browseIsElectron || !window.electronAPI || !window.electronAPI.pwGet) return;
  if (_pwAutofillOffered.has(tab.id)) return;
  _pwAutofillOffered.add(tab.id);
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

function _pwDoAutofill(tab, frame, entryId) {
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

function _pwShowAutofillPicker(tab, frame, entries) {
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.createElement('div');
  bar.className = 'browse-pw-save-bar';
  bar.id = 'browse-pw-bar';
  let pills = entries.map(e =>
    `<button onclick="_pwDoAutofill(_browseTabs.find(t=>t.id===${tab.id}), document.querySelector('#browse-content webview'), '${e.id}'); _pwHideSavePrompt();" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.78rem;cursor:pointer;">${escapeHtml(e.username || 'No username')}</button>`
  ).join('');
  bar.innerHTML = `<span style="font-size:0.8rem;color:var(--text-dim);">Choose account:</span> ${pills}
    <button onclick="_pwHideSavePrompt()" style="margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dimmer);font-size:0.72rem;cursor:pointer;">Dismiss</button>`;
  container.prepend(bar);
}

function _pwShowSavePrompt(tab, data) {
  if (!_browseIsElectron || !window.electronAPI || !window.electronAPI.pwSave) return;
  if (!data.password) return;
  // Dedup rapid submits
  const now = Date.now();
  if (_pwLastSubmit && _pwLastSubmit.origin === data.origin && _pwLastSubmit.username === data.username && now - _pwLastSubmit.ts < 2000) return;
  _pwLastSubmit = { origin: data.origin, username: data.username, ts: now };
  // Check if dismissed
  const key = data.origin + '|' + data.username;
  if (_pwSaveDismissed.has(key)) return;
  _pwHideSavePrompt();
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.createElement('div');
  bar.className = 'browse-pw-save-bar';
  bar.id = 'browse-pw-bar';
  const displayUser = data.username || 'this site';
  bar.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent);flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span style="font-size:0.8rem;color:var(--text-primary);">Save password for <strong>${escapeHtml(displayUser)}</strong>?</span>
    <button id="pw-save-btn" style="padding:3px 12px;border-radius:4px;border:none;background:var(--accent);color:#fff;font-size:0.78rem;cursor:pointer;font-weight:500;">Save</button>
    <button id="pw-never-btn" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dim);font-size:0.78rem;cursor:pointer;">Never</button>
    <button onclick="_pwHideSavePrompt(true)" style="margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dimmer);font-size:0.72rem;cursor:pointer;">&times;</button>
  `;
  container.prepend(bar);
  // Keep password in closure, not DOM
  const password = data.password;
  bar.querySelector('#pw-save-btn').addEventListener('click', () => {
    window.electronAPI.pwSave({ origin: data.origin, username: data.username, password }).catch(() => {});
    _pwHideSavePrompt(true);
  });
  bar.querySelector('#pw-never-btn').addEventListener('click', () => {
    _pwSaveDismissed.set(key, true);
    _pwHideSavePrompt(true);
  });
  // Auto-dismiss after 15s
  const timer = setTimeout(() => _pwHideSavePrompt(true), 15000);
  bar._pwDismissTimer = timer;
}

function _pwHideSavePrompt(clearPending) {
  if (clearPending) _pwPendingPrompt = null;
  const bar = document.getElementById('browse-pw-bar');
  if (bar) {
    if (bar._pwDismissTimer) clearTimeout(bar._pwDismissTimer);
    bar.remove();
  }
}

// Context menu for Browse view (links and images)
let _browseContextMenu = null;
let _browseContextData = null;

function _hideBrowseContextMenu() {
  if (_browseContextMenu) {
    _browseContextMenu.remove();
    _browseContextMenu = null;
  }
  _browseContextData = null;
}

function _showBrowseContextMenu(x, y, data) {
  _hideBrowseContextMenu();
  _browseContextData = data;

  const menu = document.createElement('div');
  menu.className = 'browse-link-menu';

  let html = '';
  const linkUrl = data.linkUrl || '';
  const linkText = data.linkText || '';
  const imgUrl = data.imgUrl || '';

  // Link options
  if (linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-item" data-action="newtab">Open Link in New Tab</div>`;
    html += `<div class="blm-item" data-action="here">Open Link Here</div>`;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="savelink">Save Link As...</div>`;
    html += `<div class="blm-item" data-action="copylink">Copy Link Address</div>`;
    if (linkText) {
      html += `<div class="blm-item" data-action="copytext">Copy Link Text</div>`;
    }
  }

  // Image options
  if (imgUrl) {
    if (linkUrl) html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="openimg">Open Image in New Tab</div>`;
    html += `<div class="blm-item" data-action="saveimg">Save Image As...</div>`;
    html += `<div class="blm-item" data-action="copyimg">Copy Image Address</div>`;
  }

  // Search option
  if (linkText && linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="search">Search Google for "${escapeHtml(truncatedText)}"</div>`;
  }

  menu.innerHTML = html;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  _browseContextMenu = menu;

  // Adjust if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.blm-item');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'newtab') {
      browseNewTab(linkUrl);
    } else if (action === 'here') {
      browseNavigate(linkUrl);
    } else if (action === 'savelink') {
      _browseSaveLink(linkUrl);
    } else if (action === 'copylink') {
      navigator.clipboard.writeText(linkUrl).catch(() => {});
    } else if (action === 'copytext') {
      navigator.clipboard.writeText(linkText).catch(() => {});
    } else if (action === 'search') {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    } else if (action === 'openimg') {
      browseNewTab(imgUrl);
    } else if (action === 'saveimg') {
      _browseSaveImage(imgUrl);
    } else if (action === 'copyimg') {
      navigator.clipboard.writeText(imgUrl).catch(() => {});
    }
    _hideBrowseContextMenu();
  });
}

// Helper to trigger download
function _browseDownloadFile(url, defaultFilename = 'download') {
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

function _browseSaveImage(url) {
  _browseDownloadFile(url, 'image');
}

function _browseSaveLink(url) {
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

function browseSelectTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;

  // Split mode branch: if tab is in a pane, focus it; else replace focused pane
  if (_browseIsSplitMode()) {
    const panes = _browseGetSplitPanes();
    const paneWithTab = panes.find(p => p.tabId === id);
    win.activeTab = id;
    var splitTab = win.tabs.find(t => t.id === id);
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
    _browseSaveTabs();

    // Handle paper tab in split mode
    if (tab && tab.paper) {
      _currentPaperViewPaper = tab.paper;
      if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
        _tryRenderSavedContent(tab.el, tab.paper);
      }
      _browseUpdateBarForTab(tab);
    }
    if (tab && !tab.blank && tab.url && !_restoreAnnotationPill(tab) && !_annotationsEnabled.get(tab.id)) _offerAnnotation(tab);
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
  if (_ccTabId && _ccTabId !== id) stopCaptions();

  // Clear scroll pill when switching tabs
  _browseUpdateScrollPill(-1);

  win.activeTab = id;
  const tab = win.tabs.find(t => t.id === id);
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

  // Load deferred tab if needed (lazy loading for YouTube etc.)
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
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
  }

  // Restore help page tab if needed
  if (tab && tab._helpPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-help-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
    container.appendChild(el);
    tab.el = el;
    _renderHelpPage(el);
  }

  win.tabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab ? (tab._historyPage ? 'netrun://history' : tab._helpPage ? 'netrun://help' : tab.url) : '');
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  _updateAudioIndicator();

  // Paper tab handling
  if (tab && tab.paper) {
    _currentPaperViewPaper = tab.paper;
    if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
      _tryRenderSavedContent(tab.el, tab.paper);
    }
    // Update sidebar via universal panel
    if (tab.arxivId) {
      if (!_panelVisible) {
        _panelVisible = true;
        localStorage.setItem('universalPanelVisible', 'true');
      }
      _invalidatePanelRender('browse');
      showPanelForView('browse');
    } else {
      hidePanel();
    }
    if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(tab.url);
    _browseUpdateBarForTab(tab);
  } else {
    _currentPaperViewPaper = null;
    _browseUpdateBarForTab(tab);
    hidePanel();
    // Update sidebar for the selected tab
    if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
      _initSidebarForUrl(tab.url);
    }
  }
  if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();
  _updateAnnotateButtonState();
  // Restore annotation pill or offer for non-blank tabs
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  if (tab && !tab.blank && tab.url) {
    if (!_restoreAnnotationPill(tab)) {
      if (!_annotationsEnabled.get(tab.id)) _offerAnnotation(tab);
    }
  } else {
    const act = typeof _islandActivities !== 'undefined' ? _islandActivities['annotate'] : null;
    if (act) islandRemove('annotate');
  }
}

function _browseUpdateBarForTab(tab) {
  let citeBtn = document.getElementById('browse-cite-btn');
  let bookmarkBtn = document.getElementById('browse-paper-bookmark-btn');
  if (tab && tab.paper) {
    // Cite button
    if (!citeBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      citeBtn = document.createElement('button');
      citeBtn.id = 'browse-cite-btn';
      citeBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover flex items-center justify-center';
      citeBtn.onclick = function() { if (typeof showCitePopup === 'function') showCitePopup(); };
      citeBtn.title = 'Cite';
      citeBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>';
      if (moreBtn) moreBtn.parentElement.insertBefore(citeBtn, moreBtn);
    }
    citeBtn.style.display = '';
    // Bookmark button
    if (!bookmarkBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      bookmarkBtn = document.createElement('button');
      bookmarkBtn.id = 'browse-paper-bookmark-btn';
      bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center';
      bookmarkBtn.onclick = function() { if (typeof togglePaperViewBookmark === 'function') togglePaperViewBookmark(); };
      bookmarkBtn.title = 'Save';
      if (moreBtn) moreBtn.parentElement.insertBefore(bookmarkBtn, citeBtn);
    }
    const isSaved = typeof isPostSaved === 'function' && isPostSaved(tab.paper.link);
    bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (isSaved ? 'text-accent' : 'text-dimmer hover:text-primary');
    bookmarkBtn.title = isSaved ? 'Saved' : 'Save';
    bookmarkBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    bookmarkBtn.style.display = '';
  } else {
    if (citeBtn) citeBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
  }
}

function _browseUpdateNewTabPage(tab) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  const bar = document.getElementById('browse-bar');
  if (bar) bar.style.display = (tab && tab.blank) || _browseTabLayout === 'island' ? 'none' : '';
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      ntp = document.createElement('div');
      ntp.className = 'browse-ntp';
      ntp.innerHTML = `<input type="file" id="browse-pdf-file-input" multiple style="display:none" onchange="handleNtpFileInput(this)">
        <div class="browse-ntp-inner">
          <div class="browse-ntp-center">
            <div style="text-align:center;margin-bottom:12px;user-select:none;"><div class="browse-ntp-logo"><svg style="height:3rem;display:inline-block;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="var(--text-dimmer)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22a2 2 0 1 1 3.16 2.44"/></svg></div></div>
            <div class="flex items-center justify-center gap-1" style="margin-bottom:12px;">
              <button id="research-tab-search" class="research-tab" onclick="switchResearchTab('search')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                Papers
              </button>
              <button id="research-tab-users" class="research-tab" onclick="switchResearchTab('users')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
                Users
              </button>
              <button id="research-tab-teams" class="research-tab" onclick="switchResearchTab('teams')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>
                Teams
              </button>
              <button id="research-tab-vault" class="research-tab" onclick="switchResearchTab('vault')">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
                Notes
              </button>
            </div>
            <form id="search-form" onsubmit="event.preventDefault(); submitSearch()">
              <div class="ntp-search-box max-w-[680px] mx-auto">
                <div class="ntp-search-row">
                  <svg class="ntp-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                  <input type="text" id="search-query" placeholder="Ask anything..." autocomplete="off" class="ntp-search-input" oninput="onSearchInput(); _browseUrlShowHistory()" onfocus="_browseUrlCancelHide(); this.select(); _browseUrlShowHistory()" onblur="_browseUrlScheduleHide()" onkeydown="_browseUrlKeydown(event)" />
                </div>
                <div id="search-history-dropdown-view" class="ntp-dropdown" style="display:none;"></div>
                <div id="ntp-file-chips" class="ntp-file-chips-container"></div>
                <div class="ntp-search-actions">
                  <button type="button" class="ntp-action-pill" onmousedown="event.preventDefault()" onclick="_browseUrlCancelHide(); document.getElementById('browse-pdf-file-input').click()">+ Add tabs or files</button>
                  <button type="button" class="ntp-action-dots" title="More options">&middot;&middot;&middot;</button>
                  <div style="flex:1"></div>
                  <button type="submit" class="ntp-action-submit" title="Search"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-5 5m5-5l5 5"/></svg></button>
                </div>
              </div>
            </form>
            <div id="research-panel-search" class="research-panel" style="display:none;">
              <div id="search-hints" style="display:none"></div>
            </div>
            <div id="research-panel-users" class="research-panel" style="display:none;">
              <form id="user-search-form" onsubmit="event.preventDefault(); submitUserSearch()">
                <div class="relative max-w-[680px] mx-auto">
                  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dimmer pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
                  <input type="text" id="user-search-query" placeholder="Search users..." autocomplete="off" class="w-full pl-9 pr-4 py-2 rounded-lg border border-border-input bg-card text-primary text-[0.85rem] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all" oninput="clearTimeout(_userSearchDebounce); _userSearchDebounce = setTimeout(submitUserSearch, 300)" />
                </div>
              </form>
              <div id="user-search-results" class="max-w-[680px] mx-auto"></div>
            </div>
            <div id="research-panel-teams" class="research-panel" style="display:none;">
              <div class="flex items-center justify-between mb-5">
                <h2 class="text-[1.1rem] font-semibold text-white_">Teams</h2>
                <button onclick="showCreateTeamPopup('research')" class="text-dimmer hover:text-primary bg-transparent border-none cursor-pointer text-xl leading-none p-0" title="Create team">+</button>
              </div>
              <div id="research-teams-content"></div>
            </div>
            <div id="research-panel-vault" class="research-panel" style="display:none;">
              <div id="ntp-vault-container" class="max-w-[680px] mx-auto"></div>
            </div>
          </div>
          <div id="search-feed-results"></div>
          <div id="search-arxiv-results"></div>
        </div>
        <div class="browse-ntp-version" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:var(--text-dimmest);font-size:11px;font-family:monospace;user-select:none;letter-spacing:0.08em;">netrun</div>`;
      container.appendChild(ntp);
      apiGet('/api/version').then(v => {
        const el = ntp.querySelector('.browse-ntp-version');
        if (el && v.version) el.textContent = 'netrun v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
      }).catch(() => {});
      ntp.addEventListener('dragover', function(e) { e.preventDefault(); ntp.style.outline = '2px dashed var(--accent)'; });
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
    // Clear search input and reset to default state
    const ntpInput = ntp.querySelector('#search-query');
    if (ntpInput) ntpInput.value = '';
    _researchActiveTab = null;
    switchResearchTab(null);
  } else if (ntp) {
    ntp.style.display = 'none';
  }
  if (_browseTabLayout === 'island') _pillSyncUrl();
  const pinchOverlay = container.querySelector('.browse-pinch-overlay');
  if (pinchOverlay) pinchOverlay.style.pointerEvents = (_browseZoomLevel > 1 && tab && !tab.blank) ? 'auto' : 'none';
}

function browseCloseTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;
  const idx = win.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = win.tabs[idx];

  // If tab is in a split pane, remove that pane first
  if (_browseIsSplitMode()) {
    const pane = _browsePaneForTab(id);
    if (pane) browseUnsplitPane(pane.id);
  }

  _browseClosedTabs.push({ url: tab.url || '', title: tab.title, blank: !!tab.blank, paper: tab.paper || null, contentType: tab.contentType || null, arxivId: tab.arxivId || null });
  if (_browseClosedTabs.length > _BROWSE_CLOSED_TABS_MAX) _browseClosedTabs.splice(0, _browseClosedTabs.length - _BROWSE_CLOSED_TABS_MAX);
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  // Stop captions if this is the captured tab
  if (_ccTabId === id) stopCaptions();
  _pwAutofillOffered.delete(id);
  _annotationsEnabled.delete(id);
  if (tab.el) tab.el.remove();
  // Clean up audio tracking
  _browseAudioTabs.delete(id);
  _updateAudioIndicator();
  win.tabs.splice(idx, 1);
  if (!win.tabs.length) {
    if (_browseWindows.length > 1) {
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
  _browseSaveTabs();
}

function browseReopenTab() {
  if (!_browseClosedTabs.length) return;
  const closed = _browseClosedTabs.pop();
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  if (closed.paper && closed.contentType) {
    browseNewPaperTab(closed.url, closed.paper);
  } else {
    browseNewTab(closed.url);
  }
}

function _browseAnimateBounce() {
  const content = document.getElementById('browse-content');
  if (!content) return;
  Motion.sequence([
    { el: content, spring: 'snappy', from: { x: 0, scale: 1 }, to: { x: -60, scale: 0.97 }, duration: 120 },
    { el: content, spring: 'snappy', from: { x: -60, scale: 0.97 }, to: { x: 0, scale: 1 } }
  ]);
}
