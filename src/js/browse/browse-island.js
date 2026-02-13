// browse-island.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Island mode tab renderer ──

function toggleBrowseTabLayout() {
  _browseTabLayout = _browseTabLayout === 'island' ? 'horizontal' : 'island';
  localStorage.setItem('browseTabLayout', _browseTabLayout);
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display !== 'none';
  if (browseOpen) {
    if (_browseTabLayout === 'island') {
      _setPillBrowseMode(false);
      _applyBrowseTabLayout();
    } else {
      _setPillBrowseMode(true);
    }
  }
}

function _applyBrowseTabLayout() {
  const tabRow = document.getElementById('browse-tab-row');
  const bar = document.getElementById('browse-bar');
  const pill = document.getElementById('sidebar-nav');
  const dragPill = document.getElementById('drag-pill');
  const browseView = document.getElementById('browse-view');
  const browseOpen = browseView && browseView.style.display === 'flex';
  if (_browseTabLayout === 'island') {
    if (tabRow) tabRow.style.display = 'none';
    if (bar) bar.style.display = 'none';
    if (browseOpen) {
      if (pill) { pill.classList.add('browse-mode'); pill.classList.add('island-mode'); }
      if (dragPill) dragPill.style.display = 'none';
      _pillSyncUrl();
      const pillTabs = document.getElementById('pill-browse-tabs');
      if (pillTabs) pillTabs.innerHTML = '';
      _islandSyncTabs();
      _islandSyncBookmark();
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      if (dragPill) dragPill.style.display = '';
      islandRemove('tabs');
      islandRemove('bookmark');
    }
  } else {
    // Restore everything
    if (bar) bar.style.display = '';
    if (_pillBrowseMode) {
      if (tabRow) tabRow.style.display = 'none';
    } else {
      if (pill) { pill.classList.remove('browse-mode', 'island-mode', 'ntp-active'); }
      if (tabRow) tabRow.style.display = '';
      if (dragPill) dragPill.style.display = '';
    }
    if (_pillBrowseMode) _pillSyncTabs();
  }
  _browseRenderTabs();
}

/* Sync the pill URL input with the active tab */
function _pillSyncUrl() {
  const input = document.getElementById('pill-browse-url-input');
  if (!input) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isBlankNtp = tab && tab.blank;
  _browseSetUrlDisplay(input, (!isBlankNtp && tab && tab.url) ? tab.url : '');
  // Hide URL input + reload in island mode on new tab page; show nav icons
  if (_browseTabLayout === 'island') {
    input.style.visibility = isBlankNtp ? 'hidden' : '';
    input.style.pointerEvents = isBlankNtp ? 'none' : '';
    const reload = document.getElementById('pill-browse-reload');
    if (reload) reload.style.display = isBlankNtp ? 'none' : '';
    const closeBtn = document.getElementById('pill-close-tab-btn');
    if (closeBtn) closeBtn.style.display = isBlankNtp ? 'none' : '';
    const pill = document.getElementById('sidebar-nav');
    if (pill) pill.classList.toggle('ntp-active', !!isBlankNtp);
  }
  // Safety net: ensure NTP is hidden when a non-blank tab is active in island mode
  if (!isBlankNtp) {
    const ntp = document.getElementById('browse-content')?.querySelector('.browse-ntp');
    if (ntp) ntp.style.display = 'none';
  }
  _updateIslandNavButtons();
}

function _updateIslandNavButtons() {
  try {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    const hasBackHistory = tab && tab.backStack && tab.backStack.length > 0;
    let hasElBack = false, hasElFwd = false;
    try { hasElBack = _browseIsElectron && tab && tab.el && tab.el.canGoBack && tab.el.canGoBack(); } catch(e) {}
    const hasFwdHistory = tab && tab.forwardStack && tab.forwardStack.length > 0;
    try { hasElFwd = _browseIsElectron && tab && tab.el && tab.el.canGoForward && tab.el.canGoForward(); } catch(e) {}
    const showBack = hasBackHistory || hasElBack;
    const showFwd = hasFwdHistory || hasElFwd;
    // Pill bar buttons
    const pillBack = document.getElementById('pill-browse-back');
    const pillFwd = document.getElementById('pill-browse-fwd');
    if (pillBack) pillBack.style.display = showBack ? '' : 'none';
    if (pillFwd) pillFwd.style.display = showFwd ? '' : 'none';
    // Browse bar buttons
    const barBack = document.getElementById('browse-bar-back');
    const barFwd = document.getElementById('browse-bar-fwd');
    if (barBack) barBack.style.display = showBack ? '' : 'none';
    if (barFwd) barFwd.style.display = showFwd ? '' : 'none';
  } catch(e) {}
}

/* ── History dropdown on hover ── */
let _historyDropdownEl = null;
let _historyDropdownHideTimer = 0;

function _showHistoryDropdown(direction, buttonEl) {
  clearTimeout(_historyDropdownHideTimer);
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;
  const stack = direction === 'back' ? (tab.backStack || []) : (tab.forwardStack || []);
  if (!stack.length) return;
  _hideHistoryDropdownNow();
  const dd = document.createElement('div');
  dd.className = 'browse-history-dropdown';
  dd.onmouseenter = () => clearTimeout(_historyDropdownHideTimer);
  dd.onmouseleave = () => _scheduleHideHistoryDropdown();
  // Show most recent first
  const items = stack.slice().reverse().slice(0, 15);
  items.forEach((url, i) => {
    const row = document.createElement('div');
    row.className = 'browse-history-dropdown-item';
    const fav = document.createElement('img');
    fav.src = _browseFaviconUrl(url);
    fav.width = 14; fav.height = 14;
    fav.style.cssText = 'border-radius:2px;flex-shrink:0;';
    fav.onerror = function() { this.style.display = 'none'; };
    const label = document.createElement('span');
    label.textContent = _browseTitleFromUrl(url);
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    row.appendChild(fav);
    row.appendChild(label);
    row.onclick = () => { _historyDropdownNavigate(direction, i + 1); _hideHistoryDropdownNow(); };
    dd.appendChild(row);
  });
  document.body.appendChild(dd);
  _historyDropdownEl = dd;
  // Position below the button
  const rect = buttonEl.getBoundingClientRect();
  dd.style.top = rect.bottom + 4 + 'px';
  dd.style.left = Math.max(4, rect.left - 60) + 'px';
}

function _scheduleHideHistoryDropdown() {
  clearTimeout(_historyDropdownHideTimer);
  _historyDropdownHideTimer = setTimeout(_hideHistoryDropdownNow, 200);
}

function _hideHistoryDropdownNow() {
  clearTimeout(_historyDropdownHideTimer);
  if (_historyDropdownEl) { _historyDropdownEl.remove(); _historyDropdownEl = null; }
}

function _historyDropdownNavigate(direction, steps) {
  for (let i = 0; i < steps; i++) {
    if (direction === 'back') browseBack();
    else browseForward();
  }
}

/* Keydown for pill URL input */
function _pillUrlKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById('pill-browse-url-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    browseNavigate(val);
    input.blur();
  } else if (e.key === 'Escape') {
    e.target.blur();
  }
}

/* Pill mic button — record audio, live transcription in audio pill, final Whisper result */
let _pillMicRecorder = null;
let _pillMicRecognition = null;
let _pillMicTranscript = '';
let _pillMicLiveText = '';

function _pillMicClick() {
  // Toggle off if already recording
  if (_pillMicRecorder) {
    if (_pillMicRecognition) { try { _pillMicRecognition.stop(); } catch(e) {} }
    _pillMicRecorder.stop();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    _pillMicRecorder = recorder;
    _pillMicTranscript = '';
    _pillMicLiveText = '';

    // Live speech recognition for real-time words in audio pill
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      _pillMicRecognition = recognition;
      recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
          else interim += event.results[i][0].transcript;
        }
        _pillMicTranscript = final;
        _pillMicLiveText = (final + interim).trim();
        _renderAudioPill();
      };
      recognition.onerror = () => {};
      recognition.onend = () => { _pillMicRecognition = null; };
      recognition.start();
    }

    _renderAudioPill();
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      _pillMicRecorder = null;
      if (_pillMicRecognition) { try { _pillMicRecognition.stop(); } catch(e) {} _pillMicRecognition = null; }
      stream.getTracks().forEach(t => t.stop());
      _renderAudioPill();
      const blob = new Blob(chunks, { type: 'audio/webm' });
      _updateAudioUnified('mic', { label: 'Transcribing…' });
      // Use raw fetch for blob upload with custom Content-Type
      fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm', 'Authorization': 'Bearer ' + (localStorage.getItem('authToken') || '') }, body: blob })
        .then(r => r.json())
        .then(data => {
          _clearAudioUnified('mic');
          if (data.text) {
            const pill = document.getElementById('pill-audio-unified');
            const rect = pill ? pill.getBoundingClientRect() : { x: window.innerWidth / 2 - 100, bottom: 60 };
            _showPanel({ anchor: { x: rect.x, y: rect.bottom + 4 }, initialValue: data.text, finalized: true });
            if (localStorage.getItem('voiceAutoSend') === 'on') {
              setTimeout(() => {
                const popup = document.getElementById('doc-chat-ask-float');
                if (popup) _sendPopupChatMessage(popup, '');
              }, 50);
            }
          }
        })
        .catch(() => { _clearAudioUnified('mic'); });
    };
    recorder.start();
  }).catch(() => {});
}

function _browseRenderTabs() {
  const isIsland = _browseTabLayout === 'island';
  const bar = isIsland ? null : document.getElementById('browse-tabs');
  const win = _getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;
  const groups = win ? (win.groups || []) : [];

  // Update window count badge
  _browseUpdateWindowBadge();

  // Always sync the Dynamic Island tabs pill
  _islandSyncTabs();

  // In island mode, only sync island — no DOM tab bar to render
  if (isIsland) {
    _pillSyncUrl();
    return;
  }
  if (!bar) return;

  // Window switcher for horizontal layout (inline in tab bar)
  let windowSelector = '';
  if (_browseWindows.length > 1) {
    const winIdx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
    windowSelector = `<div class="browse-window-switcher" data-window-idx="${winIdx}" onclick="toggleBrowseTabOverview()">
      <button class="browse-window-arrow up ${winIdx === 0 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowUp()" title="Previous window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg>
      </button>
      <button class="browse-window-arrow down ${winIdx === _browseWindows.length - 1 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowDown()" title="Next window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg>
      </button>
    </div>`;
  }

  // Split into pinned (left) and unpinned (right)
  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  const renderTab = _browseRenderTabHtml;
  const pinSepClass = 'browse-tab-pin-separator';
  const groupChipClass = 'browse-tab-group-chip';

  // Build pinned section
  let html = windowSelector;
  html += pinned.map(t => renderTab(t, activeTab)).join('');
  if (pinned.length > 0 && unpinned.length > 0) {
    html += `<div class="${pinSepClass}"></div>`;
  }

  // Sort unpinned: grouped tabs contiguous by group, ungrouped at end
  const groupedIds = new Set(groups.map(g => g.id));
  const groupOrder = groups.map(g => g.id);
  const sortedUnpinned = [];
  // Collect tabs per group (preserve relative order within group)
  const byGroup = new Map();
  const ungrouped = [];
  for (const t of unpinned) {
    if (t.groupId != null && groupedIds.has(t.groupId)) {
      if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
      byGroup.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  }
  // In split mode, collect split tab IDs so we can render the combined pill
  const splitPanes = _browseGetSplitPanes();
  const splitTabIds = new Set(splitPanes.map(p => p.tabId));
  let splitPillInserted = false;

  // Render groups in order, then ungrouped
  for (const gid of groupOrder) {
    const group = groups.find(g => g.id === gid);
    const gTabs = byGroup.get(gid);
    if (!gTabs || !gTabs.length) continue;
    const gc = _BROWSE_GROUP_COLOR_MAP[group.color] || group.color;
    html += `<div class="${groupChipClass}" style="--group-color:${gc}" data-group-id="${gid}" onclick="_browseToggleGroupCollapse(${gid})" oncontextmenu="event.preventDefault();_browseShowGroupContextMenu(event,${gid})">
      <span class="browse-tab-group-name">${escapeHtml(group.name)}</span>
      <span class="browse-tab-group-count">${gTabs.length}</span>
    </div>`;
    if (!group.collapsed) {
      for (const t of gTabs) {
        if (splitTabIds.has(t.id)) {
          if (!splitPillInserted) {
            html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab);
            splitPillInserted = true;
          }
        } else {
          html += renderTab(t, activeTab);
        }
      }
    }
  }
  for (const t of ungrouped) {
    if (splitTabIds.has(t.id)) {
      if (!splitPillInserted) {
        html += _browseRenderSplitPillHtml(splitPanes, tabs, activeTab);
        splitPillInserted = true;
      }
      // Skip individual render — it's in the pill
    } else {
      html += renderTab(t, activeTab);
    }
  }

  bar.innerHTML = html;

  // Update tab count on overview button
  const totalTabs = _browseWindows.reduce((sum, w) => sum + w.tabs.length, 0);
  const countBadge = document.getElementById('browse-tab-overview-btn');
  if (countBadge) countBadge.title = `Show all tabs (${totalTabs} tabs, ${_browseWindows.length} windows)`;

  // Render toolbar sessions dropdown only if overview is visible
  if (_browseTabOverviewVisible) {
    _renderToolbarSessions();
  }

  // Attach tab drag-to-reorder handlers
  bar.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
  });
  // Attach drag handler on the split pill (handles reorder + unsplit + click-to-focus)
  bar.querySelectorAll('.browse-split-pill').forEach(pillEl => {
    pillEl.addEventListener('mousedown', _splitPillDragStart);
  });

  // Mirror tabs into the pill bar if in browse mode (horizontal only)
  if (_pillBrowseMode) _pillSyncTabs();
}

// ── Split pill drag (reorder + unsplit) ──

function _splitPillDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close')) return;
  const pillEl = e.currentTarget;
  e.preventDefault();
  e.stopPropagation();

  // Check if mousedown started on an inner tab (for potential unsplit drag)
  const innerTabEl = e.target.closest('.browse-split-pill-tab');
  const innerPaneId = innerTabEl ? parseInt(innerTabEl.dataset.paneId) : null;

  const startX = e.clientX;
  const startY = e.clientY;
  let mode = null; // null = undecided, 'reorder' = pill drag, 'unsplit' = tear tab out
  let ghost = null;
  let indicator = null;
  let insertBeforeId = null;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!mode) {
      if (dist < TAB_DRAG_THRESHOLD) return;
      // If started on an inner tab and dragged vertically, unsplit that tab
      if (innerTabEl && Math.abs(dy) > Math.abs(dx) && dist > 15) {
        mode = 'unsplit';
        innerTabEl.classList.add('dragging-out');
        ghost = innerTabEl.cloneNode(true);
        ghost.className = 'browse-split-pill-tab browse-split-drag-ghost';
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;background:var(--bg-card);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:4px 8px;white-space:nowrap;font-size:0.75rem;';
        ghost.style.width = innerTabEl.offsetWidth + 'px';
        document.body.appendChild(ghost);
      } else {
        // Horizontal drag = reorder pill
        mode = 'reorder';
        pillEl.style.opacity = '0.4';
        ghost = pillEl.cloneNode(true);
        ghost.style.cssText = 'position:fixed;z-index:10001;pointer-events:none;opacity:0.85;';
        ghost.style.width = pillEl.offsetWidth + 'px';
        ghost.classList.add('browse-tab-dragging');
        document.body.appendChild(ghost);
        indicator = document.createElement('div');
        indicator.className = 'browse-tab-insert-indicator';
        const bar = _getActiveTabBar();
        if (bar) { bar.style.position = 'relative'; bar.appendChild(indicator); }
      }
    }

    if (mode === 'unsplit' && ghost) {
      ghost.style.left = (ev.clientX - innerTabEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - innerTabEl.offsetHeight / 2) + 'px';
      return;
    }

    if (mode === 'reorder' && ghost) {
      ghost.style.left = (ev.clientX - pillEl.offsetWidth / 2) + 'px';
      ghost.style.top = (ev.clientY - pillEl.offsetHeight / 2) + 'px';

      const bar = _getActiveTabBar();
      if (!bar || !indicator) return;
      const barRect = bar.getBoundingClientRect();
      const nonSplitTabs = Array.from(bar.querySelectorAll('.browse-tab:not(.browse-tab-pinned)'));
      insertBeforeId = null;
      let indicatorLeft = null;

      for (const t of nonSplitTabs) {
        const rect = t.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) {
          const tid = parseInt(t.dataset.tabId);
          if (!isNaN(tid)) insertBeforeId = tid;
          indicatorLeft = rect.left - barRect.left - 1;
          break;
        }
      }
      if (indicatorLeft === null && nonSplitTabs.length > 0) {
        const lastRect = nonSplitTabs[nonSplitTabs.length - 1].getBoundingClientRect();
        indicatorLeft = lastRect.right - barRect.left + 1;
      }
      if (indicatorLeft !== null) {
        indicator.style.display = '';
        indicator.style.left = indicatorLeft + 'px';
        indicator.style.top = '4px';
        indicator.style.height = (bar.offsetHeight - 8) + 'px';
      }
    }
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (ghost) {
      if (mode === 'unsplit') {
        Motion.animate(ghost, {
          duration: 150, spring: 'smooth',
          from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.9 },
          onFinish: function() { ghost.remove(); }
        });
      } else {
        ghost.remove();
      }
    }
    if (indicator) indicator.remove();
    pillEl.style.opacity = '';
    if (innerTabEl) innerTabEl.classList.remove('dragging-out');

    if (mode === 'unsplit' && innerPaneId != null) {
      browseUnsplitPane(innerPaneId);
    } else if (mode === 'reorder' && insertBeforeId !== null) {
      const win = _getCurrentWindow();
      if (!win) return;
      const panes = _browseGetSplitPanes();
      const splitTabIds = panes.map(p => p.tabId);
      const splitTabs = splitTabIds.map(id => win.tabs.find(t => t.id === id)).filter(Boolean);
      win.tabs = win.tabs.filter(t => !splitTabIds.includes(t.id));
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      const insertAt = toIdx !== -1 ? toIdx : win.tabs.length;
      win.tabs.splice(insertAt, 0, ...splitTabs);
      _browseRenderTabs();
      _browseSaveTabs();
    } else if (!mode && innerTabEl) {
      // No drag — just a click, focus the pane
      if (innerPaneId != null) _browseFocusPane(innerPaneId);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Tab pin / group helpers ──

function _browseToggleGroupCollapse(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseTogglePin(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  tab.pinned = !tab.pinned;
  // If pinning, remove from group
  if (tab.pinned && tab.groupId != null) {
    delete tab.groupId;
  }
  // Sort: pinned tabs first, preserve relative order otherwise
  const pinned = win.tabs.filter(t => t.pinned);
  const unpinned = win.tabs.filter(t => !t.pinned);
  win.tabs = [...pinned, ...unpinned];
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseAddTabToNewGroup(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  if (!win.groups) win.groups = [];
  const gid = _browseNextGroupId++;
  const color = _BROWSE_GROUP_COLORS[win.groups.length % _BROWSE_GROUP_COLORS.length];
  win.groups.push({ id: gid, name: 'New group', color, collapsed: false });
  tab.groupId = gid;
  _browseRenderTabs();
  _browseSaveTabs();
  // Inline rename the new group chip
  setTimeout(() => {
    const chip = document.querySelector(`.browse-tab-group-chip[data-group-id="${gid}"] .browse-tab-group-name`);
    if (chip) _browseStartRenameGroup(gid, chip);
  }, 50);
}

function browseAddTabToGroup(tabId, groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab || tab.pinned) return;
  tab.groupId = groupId;
  _browseRenderTabs();
  _browseSaveTabs();
}

function browseRemoveTabFromGroup(tabId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;
  delete tab.groupId;
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseUngroupAll(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  win.tabs.forEach(t => { if (t.groupId === groupId) delete t.groupId; });
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseCloseGroup(groupId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.groupId === groupId).map(t => t.id);
  win.groups = (win.groups || []).filter(g => g.id !== groupId);
  // Close all tabs in group (from end to avoid index shifting)
  for (const id of toClose.reverse()) browseCloseTab(id);
}

function _browseChangeGroupColor(groupId, color) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  group.color = color;
  _browseRenderTabs();
  _browseSaveTabs();
}

function _browseStartRenameGroup(groupId, nameEl) {
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'browse-tab-group-rename';
  input.value = group.name;
  input.style.cssText = 'width:60px;font-size:0.65rem;font-weight:600;background:transparent;border:1px solid var(--border-card);border-radius:3px;color:inherit;padding:0 3px;outline:none;';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const finish = () => {
    const val = input.value.trim() || 'New group';
    group.name = val;
    _browseRenderTabs();
    _browseSaveTabs();
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = group.name; input.blur(); }
  });
}

function _browseDismissTabContextMenu() {
  const m = document.querySelector('.browse-ctx-menu');
  if (m) m.remove();
}

function _browseCloseOtherTabs(keepId) {
  const win = _getCurrentWindow();
  if (!win) return;
  const toClose = win.tabs.filter(t => t.id !== keepId && !t.pinned).map(t => t.id);
  for (const id of toClose.reverse()) browseCloseTab(id);
}

function _browseShowGroupContextMenu(e, groupId) {
  _browseDismissTabContextMenu();
  const win = _getCurrentWindow();
  if (!win) return;
  const group = (win.groups || []).find(g => g.id === groupId);
  if (!group) return;

  const colorDots = _BROWSE_GROUP_COLORS.map(c => {
    const hex = _BROWSE_GROUP_COLOR_MAP[c];
    const sel = c === group.color ? ' browse-ctx-color-selected' : '';
    return `<span class="browse-ctx-color-dot${sel}" style="background:${hex}" onclick="event.stopPropagation();_browseDismissTabContextMenu();_browseChangeGroupColor(${groupId},'${c}')"></span>`;
  }).join('');

  const items = [
    `<div class="browse-ctx-item" onclick="event.stopPropagation();_browseDismissTabContextMenu();setTimeout(()=>{const c=document.querySelector('.browse-tab-group-chip[data-group-id=\\'${groupId}\\'] .browse-tab-group-name');if(c)_browseStartRenameGroup(${groupId},c);},50)">Rename</div>`,
    `<div class="browse-ctx-colors">${colorDots}</div>`,
    '<div class="browse-ctx-sep"></div>',
    `<div class="browse-ctx-item" onclick="_browseDismissTabContextMenu();_browseUngroupAll(${groupId})">Ungroup all</div>`,
    `<div class="browse-ctx-item" onclick="_browseDismissTabContextMenu();_browseCloseGroup(${groupId})">Close group</div>`
  ];

  const menu = document.createElement('div');
  menu.className = 'browse-ctx-menu';
  menu.innerHTML = items.join('');
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10002;`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', _browseDismissTabContextMenu, { once: true });
  }, 0);
}

// ── Tab hover tooltip ──

const _tabHoverTimeout = null;
const _tabHoverDismissTimeout = null;


// ── Tab drag-to-reorder ──

let _tabDragState = null;
const TAB_DRAG_THRESHOLD = 5;

function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  const isVtab = false;
  let tabId = parseInt(tabEl.dataset.tabId);
  if (isNaN(tabId)) {
    // Fallback: parse from onclick
    const onclickAttr = tabEl.getAttribute('onclick') || '';
    const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
    if (!idMatch) return;
    tabId = parseInt(idMatch[1]);
  }
  e.preventDefault();
  _tabDragState = { tabId, startX: e.clientX, startY: e.clientY, tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false, isIsland: isVtab };
  const origOnclick = tabEl.getAttribute('onclick');
  tabEl.removeAttribute('onclick');
  _tabDragState._origOnclick = origOnclick;
  document.addEventListener('mousemove', _tabDragMove);
  document.addEventListener('mouseup', _tabDragEnd);
}

function _tabDragMove(e) {
  if (!_tabDragState) return;
  const dx = e.clientX - _tabDragState.startX;
  const dy = e.clientY - _tabDragState.startY;
  if (!_tabDragState.hasMoved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;

  const isVert = _tabDragState.isIsland;
  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    // Prevent the onclick from firing
    _tabDragState.tabEl.style.pointerEvents = 'none';
    // Create ghost
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += isVert ? ' browse-vtab-dragging' : ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
    // Create insertion indicator
    const indicator = document.createElement('div');
    indicator.className = isVert ? 'browse-vtab-insert-indicator' : 'browse-tab-insert-indicator';
    const bar = _getActiveTabBar();
    if (bar) {
      bar.style.position = 'relative';
      bar.appendChild(indicator);
    }
    _tabDragState.indicator = indicator;
  }

  // Move ghost with cursor
  _tabDragState.ghostEl.style.left = (e.clientX - _tabDragState.tabEl.offsetWidth / 2) + 'px';
  _tabDragState.ghostEl.style.top = (e.clientY - _tabDragState.tabEl.offsetHeight / 2) + 'px';

  // Find nearest insertion point
  if (isVert) {
    _tabDragUpdatePosition(e.clientY);
  } else {
    _tabDragUpdatePosition(e.clientX);
  }
}

function _tabDragUpdatePosition(clientPos) {
  if (!_tabDragState || !_tabDragState.indicator) return;
  const bar = _getActiveTabBar();
  if (!bar) return;
  const isVert = _tabDragState.isIsland;
  const win = _getCurrentWindow();
  const dragTab = win ? win.tabs.find(t => t.id === _tabDragState.tabId) : null;
  const isDragPinned = dragTab && dragTab.pinned;

  // Only allow dragging among same region (pinned <-> pinned, unpinned <-> unpinned)
  const tabClass = isVert ? '.browse-vtab' : '.browse-tab';
  const pinnedClass = isVert ? 'browse-vtab-pinned' : 'browse-tab-pinned';
  const allTabEls = Array.from(bar.querySelectorAll(tabClass));
  const tabs = allTabEls.filter(t => {
    const isPinned = t.classList.contains(pinnedClass);
    return isDragPinned ? isPinned : !isPinned;
  });

  let insertBeforeId = null;
  const barRect = bar.getBoundingClientRect();

  if (isVert) {
    // Vertical mode: use Y axis
    let indicatorTop = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
        if (!isNaN(tid)) insertBeforeId = tid;
        indicatorTop = rect.top - barRect.top - 1;
        break;
      }
    }
    if (indicatorTop === null && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorTop = lastRect.bottom - barRect.top + 1;
    }
    _tabDragState.insertBeforeId = insertBeforeId;
    if (indicatorTop !== null) {
      _tabDragState.indicator.style.display = '';
      _tabDragState.indicator.style.top = indicatorTop + 'px';
      _tabDragState.indicator.style.left = '4px';
      _tabDragState.indicator.style.right = '4px';
      _tabDragState.indicator.style.height = '2px';
      _tabDragState.indicator.style.width = '';
    }
  } else {
    // Horizontal mode: use X axis
    let indicatorLeft = null;
    for (const t of tabs) {
      const rect = t.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientPos < mid) {
        const tid = parseInt(t.dataset.tabId);
        if (!isNaN(tid)) insertBeforeId = tid;
        indicatorLeft = rect.left - barRect.left - 1;
        break;
      }
    }
    if (indicatorLeft === null && tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      indicatorLeft = lastRect.right - barRect.left + 1;
    }
    _tabDragState.insertBeforeId = insertBeforeId;
    if (indicatorLeft !== null) {
      _tabDragState.indicator.style.display = '';
      _tabDragState.indicator.style.left = indicatorLeft + 'px';
      _tabDragState.indicator.style.top = '4px';
      _tabDragState.indicator.style.height = (bar.offsetHeight - 8) + 'px';
    }
  }
}

function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const { tabId, hasMoved, insertBeforeId, ghostEl, indicator, tabEl, _origOnclick, isIsland: isVert } = _tabDragState;
  _tabDragState = null;

  // Clean up visual elements
  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove(isVert ? 'browse-vtab-drag-source' : 'browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (_origOnclick) tabEl.setAttribute('onclick', _origOnclick);

  if (hasMoved) {
    const win = _getCurrentWindow();
    if (!win) return;
    const fromIdx = win.tabs.findIndex(t => t.id === tabId);
    if (fromIdx === -1) return;
    const [movedTab] = win.tabs.splice(fromIdx, 1);
    if (insertBeforeId !== null) {
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      if (toIdx !== -1) {
        win.tabs.splice(toIdx, 0, movedTab);
      } else {
        win.tabs.push(movedTab);
      }
    } else {
      win.tabs.push(movedTab);
    }
    // Update group membership based on neighbors (for unpinned tabs)
    if (!movedTab.pinned) {
      const newIdx = win.tabs.indexOf(movedTab);
      const prev = newIdx > 0 ? win.tabs[newIdx - 1] : null;
      const next = newIdx < win.tabs.length - 1 ? win.tabs[newIdx + 1] : null;
      // If dropped between two tabs of the same group, join that group
      if (prev && next && !prev.pinned && !next.pinned && prev.groupId != null && prev.groupId === next.groupId) {
        movedTab.groupId = prev.groupId;
      }
    }
    _browseRenderTabs();
    _browseSaveTabs();
  } else {
    // No drag movement — treat as a normal click to select tab
    _focusBrowseTabBar();
    browseSelectTab(tabId);
  }
}

// ── Window Overview ──

let _overviewSelectedIdx = 0;       // selected browse window index
let _overviewKeyHandler = null;
let _overviewBrowseWinIdx = 0;      // selected window in expanded tab view
let _overviewBrowseTabIdx = -1;     // -1 = window card level, >=0 = tab within window
let _overviewTabsExpanded = false;   // true when showing tab list inside a window card
let _overviewWasBrowseMode = false;  // pill bar was in browse-mode before overview opened
let _overviewCaptureTimer = null;
const _overviewCapturing = false;
const _browseWindowPreviews = {};     // { windowId: 'data:image/png;base64,...' }

// Capture each browse window's active tab as a screenshot and apply to card previews.
// Uses Electron's webContents.capturePage() via IPC — works regardless of view visibility
// or stacking context. Captured images are cached in _browseWindowPreviews.
function _overviewEmbedFrames() {
  if (!window.electronAPI?.captureWebview) return;
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  const cards = overlay.querySelectorAll('.wov-card:not(.wov-card-new)');

  for (let i = 0; i < _browseWindows.length && i < cards.length; i++) {
    (function(idx) {
      const bw = _browseWindows[idx];
      if (!bw) return;
      const activeTab = bw.tabs.find(function(t) { return t.id === bw.activeTab; });
      if (!activeTab || !activeTab.el) return;

      const frame = activeTab.el;
      // Get webContentsId from the webview element
      const wcId = typeof frame.getWebContentsId === 'function' ? frame.getWebContentsId() : null;
      if (!wcId) return;

      // Apply cached preview immediately if available
      const cached = _browseWindowPreviews[bw.id];
      const card = cards[idx];
      if (card && cached) {
        const prev = card.querySelector('.wov-card-preview');
        if (prev) {
          prev.style.backgroundImage = 'url(' + cached + ')';
          prev.classList.remove('wov-card-preview-empty');
          prev.innerHTML = '';
        }
      }

      // Capture fresh screenshot (async, updates when ready)
      window.electronAPI.captureWebview(wcId).then(function(base64) {
        if (!base64 || !_browseTabOverviewVisible) return;
        const dataUrl = 'data:image/png;base64,' + base64;
        _browseWindowPreviews[bw.id] = dataUrl;
        // Update the card preview if still visible
        const curOverlay = document.getElementById('browse-tab-overview');
        if (!curOverlay) return;
        const curCards = curOverlay.querySelectorAll('.wov-card:not(.wov-card-new)');
        const curCard = curCards[idx];
        if (!curCard) return;
        const prev = curCard.querySelector('.wov-card-preview');
        if (prev) {
          prev.style.backgroundImage = 'url(' + dataUrl + ')';
          prev.classList.remove('wov-card-preview-empty');
          prev.innerHTML = '';
        }
      }).catch(function() {});
    })(i);
  }
}

// Capture a window's active tab preview into the cache (fire-and-forget)
function _browseCaptureWindowPreview(windowId) {
  if (!window.electronAPI?.captureWebview) return;
  const bw = _browseWindows.find(function(w) { return w.id === windowId; });
  if (!bw) return;
  const activeTab = bw.tabs.find(function(t) { return t.id === bw.activeTab; });
  if (!activeTab || !activeTab.el) return;
  const frame = activeTab.el;
  let wcId = null;
  try { wcId = typeof frame.getWebContentsId === 'function' ? frame.getWebContentsId() : null; } catch(e) { return; }
  if (!wcId) return;
  window.electronAPI.captureWebview(wcId).then(function(base64) {
    if (base64) _browseWindowPreviews[windowId] = 'data:image/png;base64,' + base64;
  }).catch(function() {});
}


// SVG icons for app window cards
const _wovAppIcons = {
  dashboard: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>',
  feed: '<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><circle cx="6.18" cy="17.82" r="2.18"/><path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/></svg>',
  research: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/></svg>',
  vault: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><path d="m7.9 7.9 2.7 2.7"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/><path d="m13.4 10.6 2.7-2.7"/><circle cx="7.5" cy="16.5" r=".5" fill="currentColor"/><path d="m7.9 16.1 2.7-2.7"/><circle cx="16.5" cy="16.5" r=".5" fill="currentColor"/><path d="m13.4 13.4 2.7 2.7"/><circle cx="12" cy="12" r="2"/></svg>',
  browse: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"/></svg>',
  inbox: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  terminal: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3M5.25 20.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>',
  neuralook: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  dev: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"/></svg>',
  vibe: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/></svg>',
  settings: '<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/></svg>',
  calendar: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>',
};

function toggleBrowseTabOverview() {
  _browseTabOverviewVisible ? hideBrowseTabOverview() : showBrowseTabOverview();
}

// Lightweight restore: read browse windows from localStorage without creating DOM/iframes.
// Used by the overview so browse tabs are visible even if Browse hasn't been opened yet.
function _browseRestoreTabsLite() {
  if (_browseWindows.length) { _browseUpdateWindowBadge(); return; }
  try {
    const raw = localStorage.getItem(_getBrowseStorageKey('browseWindows'));
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data.windows || !data.windows.length) return;
    _browseNextWindowId = data.nextWindowId || 1;
    _browseNextTabId = data.nextTabId || 1;
    _browseNextGroupId = data.nextGroupId || 1;
    _browseNextPaneId = data.nextPaneId || 1;
    for (let i = 0; i < data.windows.length; i++) {
      const sw = data.windows[i];
      if (!sw.tabs.length) continue;
      const win = { id: sw.id, name: sw.name, tabs: [], activeTab: sw.activeTab, groups: sw.groups || [], splitPanes: sw.splitPanes || [], focusedPane: sw.focusedPane || null };
      for (let j = 0; j < sw.tabs.length; j++) {
        const st = sw.tabs[j];
        const tab = { id: st.id, url: st.url || '', title: st.title || 'New Tab', favicon: st.url ? _browseFaviconUrl(st.url) : '', el: null, blank: !!st.blank, lastVisited: st.lastVisited || 0 };
        if (st.pinned) tab.pinned = true;
        if (st.groupId != null) tab.groupId = st.groupId;
        if (st.paper) {
          tab.paper = st.paper; tab.contentType = st.contentType;
          if (st.localPath) { tab.localPath = st.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(st.localPath); }
          else if (st.paper.localPath) { tab.localPath = st.paper.localPath; tab.pdfUrl = '/api/local-file?path=' + encodeURIComponent(st.paper.localPath); }
          else if (st.paper.pdfUrl) { tab.pdfUrl = st.paper.pdfUrl; }
        }
        if (st._historyPage) { tab.url = 'netrun://history'; tab.title = 'History'; tab._historyPage = true; }
        if (st._helpPage) { tab.url = 'netrun://help'; tab.title = 'Help'; tab._helpPage = true; }
        win.tabs.push(tab);
      }
      _browseWindows.push(win);
    }
    if (_browseWindows.length) {
      _browseActiveWindow = _browseWindows.find(function(w) { return w.id === data.activeWindow; }) ? data.activeWindow : _browseWindows[0].id;
    }
    _browseUpdateWindowBadge();
  } catch (e) { /* ignore */ }
}

function showBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _wmCapturePreview();
  // Ensure browse windows are loaded even if Browse view hasn't been opened
  if (!_browseWindows.length) _browseRestoreTabsLite();
  // Exit browse-mode on the pill bar so app nav icons are visible
  const pill = document.getElementById('sidebar-nav');
  if (pill && pill.classList.contains('browse-mode')) {
    pill.classList.remove('browse-mode');
    _overviewWasBrowseMode = true;
  } else {
    _overviewWasBrowseMode = false;
  }
  _browseTabOverviewVisible = true;
  _overviewTabsExpanded = false;
  _overviewBrowseTabIdx = -1;
  // Select the active browse window
  const activeIdx = Math.max(0, _browseWindows.findIndex(function(bw) { return bw.id === _browseActiveWindow; }));
  _overviewSelectedIdx = activeIdx;
  _overviewBrowseWinIdx = activeIdx;
  overlay.style.display = 'flex'; // display before render so embed can measure dimensions
  _renderWindowOverview();
  // Instantly scroll to the active card before the fade-in
  const activeCard = overlay.querySelector('.wov-card.wov-selected') || overlay.querySelector('.wov-card.wov-active');
  if (activeCard) activeCard.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  _installOverviewKeyHandler();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });
}


function hideBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _browseTabOverviewVisible = false;
  _overviewTabsExpanded = false;
  if (_overviewCaptureTimer) { clearTimeout(_overviewCaptureTimer); _overviewCaptureTimer = null; }
  _removeOverviewKeyHandler();
  // Restore browse pill bar state if we were in browse-mode
  if (_overviewWasBrowseMode) {
    _overviewWasBrowseMode = false;
    // Defer so any pending view switch (wmOpen to non-browse) can settle first
    requestAnimationFrame(function() {
      const browseView = document.getElementById('browse-view');
      if (browseView && browseView.style.display === 'flex') {
        _applyBrowseTabLayout();
      }
    });
  }
  overlay.classList.remove('visible');
  overlay.style.opacity = '';
  setTimeout(() => { if (!_browseTabOverviewVisible) overlay.style.display = 'none'; }, 180);
}

function _installOverviewKeyHandler() {
  if (_overviewKeyHandler) return;
  _overviewKeyHandler = (e) => {
    if (!_browseTabOverviewVisible) return;
    const total = _browseWindows.length;
    // Total cards = windows + 1 (the "+ New Window" card)
    const totalCards = total + 1;

    if (_overviewTabsExpanded) {
      // ── Tab drill-down within a window card ──
      const curWin = _browseWindows[_overviewBrowseWinIdx];
      const tabCount = curWin ? curWin.tabs.length : 0;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_overviewBrowseTabIdx > 0) {
          _overviewBrowseTabIdx--;
        } else if (_overviewBrowseTabIdx === 0) {
          // Collapse back to window card level
          _overviewTabsExpanded = false;
          _overviewBrowseTabIdx = -1;
        }
        _renderWindowOverview();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_overviewBrowseTabIdx < tabCount - 1) {
          _overviewBrowseTabIdx++;
        }
        _renderWindowOverview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Collapse and move to previous window
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        if (_overviewSelectedIdx > 0) _overviewSelectedIdx--;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _renderWindowOverview();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        // Collapse and move to next window
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        if (_overviewSelectedIdx < total - 1) _overviewSelectedIdx++;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _renderWindowOverview();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (curWin) {
          if (_overviewBrowseTabIdx >= 0) {
            const tab = curWin.tabs[_overviewBrowseTabIdx];
            if (tab) { browseSelectWindow(curWin.id); browseSelectTab(tab.id); }
          } else {
            browseSelectWindow(curWin.id);
          }
          wmOpen('browse');
          hideBrowseTabOverview();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        _overviewTabsExpanded = false;
        _overviewBrowseTabIdx = -1;
        _renderWindowOverview();
      }
      return;
    }

    // ── Window card level (horizontal row) ──
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (_overviewSelectedIdx > 0) {
        _overviewSelectedIdx--;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
      }
      _updateOverviewHighlight();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (_overviewSelectedIdx < totalCards - 1) {
        _overviewSelectedIdx++;
        _overviewBrowseWinIdx = Math.min(_overviewSelectedIdx, total - 1);
      }
      _updateOverviewHighlight();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Expand tab list for the selected window
      if (_overviewSelectedIdx < total) {
        _overviewTabsExpanded = true;
        _overviewBrowseWinIdx = _overviewSelectedIdx;
        _overviewBrowseTabIdx = 0;
        _renderWindowOverview();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_overviewSelectedIdx >= total) {
        // "+ New Window" card
        wmOpen('browse');
        browseCreateWindow();
        hideBrowseTabOverview();
      } else {
        const bw = _browseWindows[_overviewSelectedIdx];
        if (bw) {
          browseSelectWindow(bw.id);
          wmOpen('browse');
          hideBrowseTabOverview();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideBrowseTabOverview();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && _overviewSelectedIdx < total && total > 1) {
      e.preventDefault();
      const delWin = _browseWindows[_overviewSelectedIdx];
      if (delWin) browseCloseWindow(delWin.id);
      if (_overviewSelectedIdx >= _browseWindows.length) _overviewSelectedIdx = _browseWindows.length - 1;
      _overviewBrowseWinIdx = _overviewSelectedIdx;
      _renderWindowOverview();
    }
  };
  document.addEventListener('keydown', _overviewKeyHandler);
}

function _removeOverviewKeyHandler() {
  if (_overviewKeyHandler) {
    document.removeEventListener('keydown', _overviewKeyHandler);
    _overviewKeyHandler = null;
  }
}

function _updateOverviewHighlight() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  overlay.querySelectorAll('.wov-card').forEach((card, i) => {
    card.classList.toggle('wov-selected', i === _overviewSelectedIdx);
  });
  const sel = overlay.querySelector('.wov-card.wov-selected');
  if (sel) sel.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  _overviewEmbedFrames();
}

function _renderWindowOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  overlay.classList.remove('wov-browse-grid-mode');

  const browseIcon = _wovAppIcons.browse || '';
  let html = '<div class="wov-cards-strip">';

  for (let i = 0; i < _browseWindows.length; i++) {
    const bw = _browseWindows[i];
    const isActive = bw.id === _browseActiveWindow;
    const isSelected = i === _overviewSelectedIdx;
    const isExpanded = _overviewTabsExpanded && i === _overviewBrowseWinIdx;
    const preview = _browseWindowPreviews[bw.id];

    html += '<div class="wov-card' + (isActive ? ' wov-active' : '') + (isSelected ? ' wov-selected' : '') + (isExpanded ? ' wov-expanded' : '') + '" data-idx="' + i + '">';

    // Preview area
    if (preview) {
      html += '<div class="wov-card-preview" style="background-image:url(' + preview + ')">';
    } else {
      html += '<div class="wov-card-preview wov-card-preview-empty">';
      html += '<div class="wov-card-empty-icon">' + browseIcon + '</div>';
    }
    html += '</div>';

    // Bottom bar: window name + tab count + active dot
    html += '<div class="wov-card-bar">'
      + '<div class="wov-card-icon">' + browseIcon + '</div>'
      + '<span class="wov-card-name">' + escapeHtml(bw.name) + '</span>'
      + '<span class="wov-win-count">' + bw.tabs.length + '</span>'
      + (isActive ? '<span class="wov-active-dot"></span>' : '');
    // Close button (only if >1 window)
    if (_browseWindows.length > 1) {
      html += '<button class="wov-card-close" data-win-id="' + bw.id + '">&times;</button>';
    }
    html += '</div>';

    // Favicon strip (show top favicons as secondary info)
    let favHtml = '';
    let shownFavs = 0;
    for (let fi = 0; fi < bw.tabs.length && shownFavs < 6; fi++) {
      const ft = bw.tabs[fi];
      if (ft.favicon) {
        favHtml += '<img src="' + escapeHtml(ft.favicon) + '" class="wov-card-fav" onerror="this.style.display=\'none\'">';
        shownFavs++;
      }
    }
    if (favHtml) {
      html += '<div class="wov-card-favstrip">' + favHtml + '</div>';
    }

    // Expanded tab list (inline under card when drilled down)
    if (isExpanded) {
      html += '<div class="wov-card-tabs">';
      for (let ti = 0; ti < bw.tabs.length; ti++) {
        const tab = bw.tabs[ti];
        const tabSelected = ti === _overviewBrowseTabIdx;
        const tabIsActive = tab.id === bw.activeTab;
        const fav = tab.favicon
          ? '<img src="' + escapeHtml(tab.favicon) + '" class="wov-bt-fav" onerror="this.style.display=\'none\'">'
          : tab.blank ? _ELL_SVG.replace('class="ell-favicon"', 'class="wov-bt-fav ell-favicon"') : '<span class="wov-bt-dot"></span>';
        html += '<div class="wov-bt' + (tabSelected ? ' wov-selected' : '') + (tabIsActive ? ' wov-bt-active' : '') + '" data-tab-idx="' + ti + '" data-win-id="' + bw.id + '">'
          + fav
          + '<span class="wov-bt-title">' + escapeHtml(tab.title || 'New Tab') + '</span>'
          + '</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // close card
  }

  // "+ New Window" card
  const isNewSelected = _overviewSelectedIdx === _browseWindows.length;
  html += '<div class="wov-card wov-card-new' + (isNewSelected ? ' wov-selected' : '') + '" data-idx="' + _browseWindows.length + '">';
  html += '<div class="wov-card-preview wov-card-preview-empty">';
  html += '<div class="wov-card-new-icon">+</div>';
  html += '</div>';
  html += '<div class="wov-card-bar"><span class="wov-card-name">New Window</span></div>';
  html += '</div>';

  html += '</div>'; // close strip

  overlay.innerHTML = html;

  // Wire up click handlers on window cards
  overlay.querySelectorAll('.wov-card').forEach(function(card) {
    const idx = parseInt(card.dataset.idx);
    if (isNaN(idx)) return;
    card.addEventListener('click', function(e) {
      if (e.target.closest('.wov-card-close') || e.target.closest('.wov-bt')) return;
      if (idx >= _browseWindows.length) {
        // New window card
        wmOpen('browse');
        browseCreateWindow();
        hideBrowseTabOverview();
      } else {
        _overviewClickBrowseWin(_browseWindows[idx].id);
      }
    });
  });

  // Wire up close buttons
  overlay.querySelectorAll('.wov-card-close').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const winId = parseInt(btn.dataset.winId);
      if (!isNaN(winId)) _overviewCloseBrowseWin(winId);
    });
  });

  // Wire up tab clicks in expanded view
  overlay.querySelectorAll('.wov-bt').forEach(function(tabEl) {
    tabEl.addEventListener('click', function(e) {
      e.stopPropagation();
      const winId = parseInt(tabEl.dataset.winId);
      const tabIdx = parseInt(tabEl.dataset.tabIdx);
      const bw = _browseWindows.find(function(w) { return w.id === winId; });
      if (bw && bw.tabs[tabIdx]) {
        _overviewClickBrowseTab(bw.id, bw.tabs[tabIdx].id);
      }
    });
  });

  // Wire up horizontal wheel scroll
  const strip = overlay.querySelector('.wov-cards-strip');
  if (strip && !strip._wheelBound) {
    strip._wheelBound = true;
    strip.addEventListener('wheel', function(e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  // Wire up background click to dismiss
  overlay.addEventListener('mousedown', function(e) {
    if (e.target === overlay) hideBrowseTabOverview();
  });

  // Scroll selected into view
  const selTab = overlay.querySelector('.wov-bt.wov-selected');
  if (selTab) {
    selTab.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  } else {
    const sel = overlay.querySelector('.wov-card.wov-selected') || overlay.querySelector('.wov-card.wov-active');
    if (sel) sel.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
  }

  // Embed live iframe/webview previews into each card
  _overviewEmbedFrames();
}

function _overviewClickBrowseWin(windowId) {
  browseSelectWindow(windowId);
  wmOpen('browse');
  hideBrowseTabOverview();
}

function _overviewClickBrowseTab(windowId, tabId) {
  browseSelectWindow(windowId);
  browseSelectTab(tabId);
  wmOpen('browse');
  hideBrowseTabOverview();
}

function _overviewCloseBrowseWin(windowId) {
  browseCloseWindow(windowId);
  if (_browseWindows.length === 0) {
    hideBrowseTabOverview();
    return;
  }
  if (_overviewSelectedIdx >= _browseWindows.length) _overviewSelectedIdx = _browseWindows.length - 1;
  _overviewBrowseWinIdx = _overviewSelectedIdx;
  _overviewBrowseTabIdx = -1;
  _overviewTabsExpanded = false;
  _renderWindowOverview();
}

// Keyboard shortcut for window overview (Cmd+Shift+\)
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? e.metaKey : e.ctrlKey;
  if (cmdKey && e.shiftKey && e.key === '\\') {
    e.preventDefault();
    toggleBrowseTabOverview();
  }
  if (e.key === 'Escape' && _browseTabOverviewVisible) {
    e.preventDefault();
    hideBrowseTabOverview();
  }
});

// Auto-focus NTP search input when user starts typing on a blank new-tab page
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length !== 1) return; // only printable characters
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  const ntp = browseView.querySelector('.browse-ntp');
  if (!ntp || ntp.style.display === 'none') return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  const input = ntp.querySelector('#search-query');
  if (input) input.focus();
});

function _browseTitleFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
    if (u.protocol === 'file:') return u.pathname.split('/').pop() || 'Local File';
    return u.hostname.replace(/^www\./, '');
  } catch { return url; }
}

function _browseFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

function browseNavigate(input) {
  // Handle slash commands
  const cmd = (input || '').trim().toLowerCase();
  if (cmd === '/history' || cmd === 'netrun://history' || cmd === 'netrun://history/') {
    openSearchHistoryPage();
    return;
  }
  if (cmd === '/help' || cmd === 'netrun://help' || cmd === 'netrun://help/') {
    openHelpPage();
    return;
  }
  if (cmd === '/upload') {
    const fi = document.getElementById('browse-pdf-file-input');
    if (fi) { fi.click(); return; }
    const tmp = document.createElement('input');
    tmp.type = 'file'; tmp.style.display = 'none';
    tmp.onchange = function() { if (tmp.files[0]) openLocalPdf(tmp.files[0]); tmp.remove(); };
    document.body.appendChild(tmp); tmp.click();
    return;
  }
  const url = _browseResolveUrl(input);
  // Track web searches (when input resolved to a Google search, not a direct URL)
  const trimmed = (input || '').trim();
  if (trimmed && url.startsWith('https://www.google.com/search?q=')) {
    _saveWebSearch(trimmed);
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) { browseNewTab(url); return; }
  // Tear down special pages if this tab was showing one
  if (tab._historyPage || tab._helpPage) {
    if (tab.el) tab.el.remove();
    tab.el = null;
    delete tab._historyPage;
    delete tab._helpPage;
  }
  // Push current URL onto back stack for navigation history
  // Skip hash routes (app views like #feed, #settings) and blank/empty URLs
  if (tab.url && !tab.blank && !/^#/.test(tab.url) && !/^about:/.test(tab.url)) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    if (tab.backStack.length > 50) tab.backStack = tab.backStack.slice(-50);
    tab.forwardStack = [];
  }
  // Clear annotations on navigation
  if (_annotationsEnabled.get(tab.id)) {
    _annotationsEnabled.set(tab.id, false);
    _updateAnnotateButtonState();
  }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  _saveBrowseVisit(url, tab.title);
  if (!tab.el) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
  } else {
    _browseSetFrameAllow(tab.el, url);
    const proxied = _browseProxyUrl(url);
    tab.el.dataset.originalUrl = url;
    tab.el.src = proxied;
    if (proxied !== url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
    }
  }
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, url);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateAdBlockBtn();
  _browseUpdateNewTabPage(tab);
  _updateIslandNavButtons();
  // Update sidebar for the navigated URL
  if (typeof _initSidebarForUrl === 'function') {
    _initSidebarForUrl(url);
  }
}

function _browseResolveUrl(input) {
  input = (input || '').trim();
  if (!input) return 'https://www.google.com';
  // Collapse internal whitespace/newlines from multi-line pastes (e.g. URLs copied across line breaks)
  if (/^(https?|file|blob|data|aether):\/\//i.test(input)) return input.replace(/\s+/g, '');
  // Resolve relative paths against the current tab's URL
  if (/^\//.test(input)) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab && tab.url) {
      try { return new URL(input, tab.url).href; } catch {}
    }
  }
  // Detect domain-like input (e.g. "google.com") but not file extensions like "llama.cpp"
  const collapsed = input.replace(/\s+/g, '');
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(collapsed) && !/\.(cpp|py|js|ts|rs|go|rb|java|cs|swift|kt|c|h|hpp|md|txt|json|xml|yaml|yml|toml|csv|sql|sh|bat|exe|dll|so|o|a|wasm|log|cfg|ini|conf|env|lock|gitignore)$/i.test(collapsed)) return 'https://' + collapsed;
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function _browseActiveEl() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  return tab ? tab.el : null;
}

// Hide/restore active webview so DOM popups can render on top (Electron GPU compositing fix)

function browseBack() {
  const el = _browseActiveEl();
  if (_browseIsElectron && el && el.canGoBack && el.canGoBack()) { el.goBack(); return; }
  // Use our own history stack for non-Electron (cross-origin iframes block history.back())
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.backStack && tab.backStack.length) {
    if (!tab.forwardStack) tab.forwardStack = [];
    tab.forwardStack.push(tab.url);
    const prevUrl = tab.backStack.pop();
    tab.url = prevUrl;
    tab.title = _browseTitleFromUrl(prevUrl);
    tab.favicon = _browseFaviconUrl(prevUrl);
    if (el) {
      _browseSetFrameAllow(el, prevUrl);
      const proxied = _browseProxyUrl(prevUrl);
      el.dataset.originalUrl = prevUrl;
      el.src = proxied;
    }
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, prevUrl);
    _browseRenderTabs();
    _browseUpdateSaveBtn();
    _browseSaveTabs();
    _updateIslandNavButtons();
    return;
  }
  // No in-tab history and no Electron back — do nothing.
  // The "Back to Feed" button (#browse-return-btn) handles app-level nav.
}

function browseForward() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoForward && el.canGoForward()) { el.goForward(); return; }
  // Use our own history stack for non-Electron
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.forwardStack || !tab.forwardStack.length) return;
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url);
  const nextUrl = tab.forwardStack.pop();
  tab.url = nextUrl;
  tab.title = _browseTitleFromUrl(nextUrl);
  tab.favicon = _browseFaviconUrl(nextUrl);
  _browseSetFrameAllow(el, nextUrl);
  const proxied = _browseProxyUrl(nextUrl);
  el.dataset.originalUrl = nextUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, nextUrl);
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _updateIslandNavButtons();
}

function browseReload() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.reload) { el.reload(); return; }
  if (!_browseIsElectron) { try { el.contentWindow.location.reload(); } catch(e) {} }
}

let _browseZoomLevel = 1.0;
let _browseZoomPanX = 0;
let _browseZoomPanY = 0;
let _browseZoomHideTimer = null;
function _browseShowZoomControls() {
  const controls = document.getElementById('browse-zoom-controls');
  if (!controls) return;
  controls.style.display = 'flex';
  clearTimeout(_browseZoomHideTimer);
  _browseZoomHideTimer = setTimeout(() => { controls.style.display = 'none'; }, 1500);
}
function browseZoom(dir) {
  if (dir === 0) { _browseZoomLevel = 1.0; _browseZoomPanX = 0; _browseZoomPanY = 0; }
  else _browseZoomLevel = Math.min(5.0, Math.max(1.0, _browseZoomLevel + dir * 0.1));
  _browseApplyZoom();
  // Sync pinch overlay: active only when zoomed in (for pan scrolling)
  const po = document.querySelector('.browse-pinch-overlay');
  if (po) po.style.pointerEvents = _browseZoomLevel > 1 ? 'auto' : 'none';
}
// focalX/focalY are cursor coords relative to the browse-content container viewport
function _browseApplyZoom(focalX, focalY) {
  const el = _browseActiveEl();
  const container = document.getElementById('browse-content');
  if (el && container) {
    if (_browseIsElectron && el.setZoomFactor) {
      el.setZoomFactor(_browseZoomLevel);
    } else {
      const oldZoom = parseFloat(el.dataset.zoom || '1');
      const newZoom = _browseZoomLevel;
      el.dataset.zoom = newZoom;

      // Optical zoom via CSS transform only — no layout change.
      // iframe stays 100% width/height, we scale and translate it.
      el.style.width = '100%';
      el.style.height = '100%';

      // Remove any leftover spacer from old approach
      const spacer = container.querySelector('.browse-zoom-spacer');
      if (spacer) spacer.remove();

      if (newZoom <= 1) {
        _browseZoomPanX = 0;
        _browseZoomPanY = 0;
        el.style.transform = 'none';
        el.style.transformOrigin = '';
      } else {
        // Focal-point zoom: keep content under cursor stationary
        if (focalX !== undefined && focalY !== undefined && oldZoom !== newZoom) {
          // Content coord under cursor: (panX + focalX) / oldZoom
          const contentX = (_browseZoomPanX + focalX) / oldZoom;
          const contentY = (_browseZoomPanY + focalY) / oldZoom;
          // New pan so same content coord stays under cursor
          _browseZoomPanX = contentX * newZoom - focalX;
          _browseZoomPanY = contentY * newZoom - focalY;
        }
        // Clamp pan to valid range
        const maxPanX = container.clientWidth * (newZoom - 1);
        const maxPanY = container.clientHeight * (newZoom - 1);
        _browseZoomPanX = Math.max(0, Math.min(maxPanX, _browseZoomPanX));
        _browseZoomPanY = Math.max(0, Math.min(maxPanY, _browseZoomPanY));

        el.style.transformOrigin = '0 0';
        el.style.transform = `scale(${newZoom}) translate(${-_browseZoomPanX / newZoom}px, ${-_browseZoomPanY / newZoom}px)`;
      }
    }
  }
  const label = document.getElementById('browse-zoom-level');
  if (label) label.textContent = Math.round(_browseZoomLevel * 100) + '%';
  _browseShowZoomControls();
}
