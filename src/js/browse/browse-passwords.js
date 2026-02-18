// browse-passwords.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

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

  var pillBtns = entries.map(function(e) {
    var btn = new View('button');
    btn.el.textContent = e.username || 'No username';
    btn.cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.78rem;cursor:pointer;');
    btn.onTap(function() {
      _pwDoAutofill(_browseTabs.find(function(t) { return t.id === tab.id; }), document.querySelector('#browse-content webview'), e.id);
      _pwHideSavePrompt();
    });
    return btn;
  });

  var label = Text('Choose account:').font('callout').foreground('tertiary');
  var dismissBtn = new View('button');
  dismissBtn.el.textContent = 'Dismiss';
  dismissBtn.cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  dismissBtn.onTap(function() { _pwHideSavePrompt(); });

  var row = HStack([label].concat(pillBtns, [dismissBtn])).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  container.prepend(row.build());
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

  const displayUser = data.username || 'this site';
  // Keep password in closure, not DOM
  const password = data.password;

  var lockIcon = RawHTML('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--nr-accent);flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>');

  var promptText = RawHTML('<span style="font-size:0.8rem;color:var(--nr-text-primary);">Save password for <strong>' + escapeHtml(displayUser) + '</strong>?</span>');

  var saveBtn = new View('button');
  saveBtn.el.textContent = 'Save';
  saveBtn.cssText('padding:3px 12px;border-radius:4px;border:none;background:var(--nr-accent);color:#fff;font-size:0.78rem;cursor:pointer;font-weight:500;');
  saveBtn.onTap(function() {
    window.electronAPI.pwSave({ origin: data.origin, username: data.username, password: password }).catch(function() {});
    _pwHideSavePrompt(true);
  });

  var neverBtn = new View('button');
  neverBtn.el.textContent = 'Never';
  neverBtn.cssText('padding:3px 10px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.78rem;cursor:pointer;');
  neverBtn.onTap(function() {
    _pwSaveDismissed.set(key, true);
    _pwHideSavePrompt(true);
  });

  var closeBtn = new View('button');
  closeBtn.el.textContent = '\u00d7';
  closeBtn.cssText('margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-quaternary);font-size:0.72rem;cursor:pointer;');
  closeBtn.onTap(function() { _pwHideSavePrompt(true); });

  var row = HStack([lockIcon, promptText, saveBtn, neverBtn, closeBtn]).spacing(2).alignment('center');
  row.className('browse-pw-save-bar').id('browse-pw-bar');
  var bar = row.build();
  container.prepend(bar);

  // Auto-dismiss after 15s
  var timer = setTimeout(function() { _pwHideSavePrompt(true); }, 15000);
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

  var linkUrl = data.linkUrl || '';
  var linkText = data.linkText || '';
  var imgUrl = data.imgUrl || '';

  function _ctxItem(label, action) {
    return new View('div').className('blm-item')._bindText(label)
      .onTap(function() { action(); _hideBrowseContextMenu(); });
  }
  function _ctxSep() { return new View('div').className('blm-sep'); }

  var items = [];

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
    var truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    items.push(_ctxSep());
    items.push(_ctxItem('Search Google for "' + truncatedText + '"', function() {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    }));
  }

  var menuView = VStack(items).className('browse-link-menu')
    .styles({left: x + 'px', top: y + 'px'});
  var menu = menuView.build();
  document.body.appendChild(menu);
  _browseContextMenu = menu;

  // Adjust if off screen
  var rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
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
    _browseSaveTabs();

    // Handle paper tab in split mode
    if (tab && tab.paper) {
      _currentPaperViewPaper = tab.paper;
      if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
        _tryRenderSavedContent(tab.el, tab.paper);
      }
      _browseUpdateBarForTab(tab);
    }
    // Show annotate offer pill (restores cache or shows clickable "Annotate" pill)
    if (tab && !tab.blank && tab.url && typeof _showAnnotateOfferPill === 'function') _showAnnotateOfferPill(tab);
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

  // Clear scroll pill and token count when switching tabs
  _browseUpdateScrollPill(-1);
  _browseUpdateTokenCount(0);

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
  // Show annotate offer pill (restores cache or shows clickable "Annotate" pill)
  if (tab && !tab.blank && tab.url && typeof _showAnnotateOfferPill === 'function') {
    _showAnnotateOfferPill(tab);
  } else {
    const act = typeof _islandActivities !== 'undefined' ? _islandActivities['insight'] : null;
    if (act) islandRemove('insight');
  }
}

function _browseUpdateBarForTab(tab) {
  let citeBtn = document.getElementById('browse-cite-btn');
  let bookmarkBtn = document.getElementById('browse-paper-bookmark-btn');
  if (tab && tab.paper) {
    // Cite button
    if (!citeBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      var citeBtnView = new View('button').id('browse-cite-btn')
        .className('browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover flex items-center justify-center')
        .attr('title', 'Cite');
      citeBtnView.onTap(function() { if (typeof showCitePopup === 'function') showCitePopup(); });
      citeBtn = citeBtnView.build();
      AetherUI.mount(RawHTML('<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>'), citeBtn);
      if (moreBtn) moreBtn.parentElement.insertBefore(citeBtn, moreBtn);
    }
    citeBtn.style.display = '';
    // Bookmark button
    if (!bookmarkBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      var bookmarkBtnView = new View('button').id('browse-paper-bookmark-btn')
        .className('browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center')
        .attr('title', 'Save');
      bookmarkBtnView.onTap(function() { if (typeof togglePaperViewBookmark === 'function') togglePaperViewBookmark(); });
      bookmarkBtn = bookmarkBtnView.build();
      if (moreBtn) moreBtn.parentElement.insertBefore(bookmarkBtn, citeBtn);
    }
    const isSaved = typeof isPostSaved === 'function' && isPostSaved(tab.paper.link);
    bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (isSaved ? 'text-accent' : 'text-dimmer hover:text-primary');
    bookmarkBtn.title = isSaved ? 'Saved' : 'Save';
    AetherUI.mount(RawHTML('<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>'), bookmarkBtn);
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
      ntp.className = 'browse-ntp nr-living-gradient';
      ntp.innerHTML = `<input type="file" id="browse-pdf-file-input" multiple style="display:none" onchange="handleNtpFileInput(this)">
        <div class="browse-ntp-inner">
          <div class="browse-ntp-center">
            <form id="search-form" onsubmit="event.preventDefault(); submitSearch()">
              <div class="ntp-search-box max-w-[680px] mx-auto">
                <div class="ntp-search-row">
                  <svg class="ntp-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
                  <input type="text" id="search-query" placeholder="Ask anything..." autocomplete="off" class="ntp-search-input" oninput="onSearchInput()" onfocus="_browseUrlCancelHide(); this.select(); _browseUrlShowHistory()" onblur="_browseUrlScheduleHide()" onkeydown="_browseUrlKeydown(event)" />
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
          </div>
        </div>
        <div class="browse-ntp-version" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:var(--nr-text-quaternary);font-size:11px;font-family:monospace;user-select:none;letter-spacing:0.08em;">netrun</div>`;
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
  Settings.setJSON('browseClosedTabs', _browseClosedTabs);
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
  Settings.setJSON('browseClosedTabs', _browseClosedTabs);
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
