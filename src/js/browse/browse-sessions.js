// browse-sessions.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Tab Sessions (save/restore named tab groups) ──

function _getTabSessions() {
  try { return JSON.parse(localStorage.getItem(_getBrowseStorageKey('browseTabSessions')) || '[]'); } catch { return []; }
}

function _saveTabSessions(sessions) {
  localStorage.setItem(_getBrowseStorageKey('browseTabSessions'), JSON.stringify(sessions));
}

function toggleTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
  _renderTabStateDropdown();
  dd.style.display = '';
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.focus();
  }, 50);
  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleTabStateDropdown"]')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

function _renderTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  const sessions = _getTabSessions();
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  const canSave = openTabs.length > 0;

  let html = `<div style="position:absolute;right:0;top:calc(100% + 4px);min-width:260px;max-height:360px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">`;

  // Save current tabs section
  html += `<div style="padding:6px 12px;border-bottom:1px solid var(--border-subtle);">
    <div id="tab-session-save-row" style="display:flex;align-items:center;gap:4px;">
      <input id="tab-session-name-input" type="text" placeholder="Session name…" style="flex:1;min-width:0;padding:5px 8px;border:1px solid var(--border-input);background:var(--bg-input);color:var(--text-primary);font-size:0.78rem;border-radius:6px;outline:none;" onkeydown="if(event.key==='Enter')confirmSaveTabSession()" ${canSave ? '' : 'disabled'}>
      <button onclick="confirmSaveTabSession()" style="padding:5px 10px;border:none;background:${canSave ? 'var(--accent)' : 'var(--bg-hover)'};color:${canSave ? '#fff' : 'var(--text-dimmest)'};font-size:0.78rem;border-radius:6px;cursor:${canSave ? 'pointer' : 'default'};white-space:nowrap;" ${canSave ? '' : 'disabled'}>Save ${openTabs.length} tab${openTabs.length !== 1 ? 's' : ''}</button>
    </div>
  </div>`;

  if (!sessions.length) {
    html += `<div style="padding:12px;font-size:0.75rem;color:var(--text-dimmest);text-align:center">No saved sessions</div>`;
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
      const winCount = s.windows ? s.windows.length : 1;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const subtitle = winCount > 1 ? `${winCount} windows · ${count} tabs · ${date}` : `${count} tab${count !== 1 ? 's' : ''} · ${date}`;
      html += `<div class="tab-session-row" style="display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='var(--aether-hover)'" onmouseleave="this.style.background='none'">
        <button onclick="loadTabSession(${i})" style="flex:1;min-width:0;text-align:left;border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;gap:1px;">
          <span style="font-size:0.8rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escapeHtml(s.name)}</span>
          <span style="font-size:0.68rem;color:var(--text-dimmer)">${subtitle}</span>
        </button>
        <button onclick="event.stopPropagation();deleteTabSession(${i})" style="border:none;background:none;color:var(--text-dimmest);cursor:pointer;padding:2px;font-size:0.9rem;line-height:1;flex-shrink:0;" title="Delete session" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-dimmest)'">&times;</button>
      </div>`;
    }
  }

  html += '</div>';
  dd.innerHTML = html;
}

function confirmSaveTabSession() {
  const input = document.getElementById('tab-session-name-input');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  if (!openTabs.length) return;
  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    tabs: openTabs.map(t => ({ url: t.url, title: t.title })),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  // Focus the new input after re-render
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.value = '';
  }, 0);
}

function loadTabSession(index) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;
  // Close dropdown
  const dd = document.getElementById('tab-state-dropdown');
  if (dd) dd.style.display = 'none';

  // Handle multi-window sessions
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
    }
  } else {
    // Legacy single-window sessions
    for (const saved of session.tabs) {
      browseNewTab(saved.url);
    }
  }
  _browseRenderTabs();
}

function deleteTabSession(index) {
  const sessions = _getTabSessions();
  sessions.splice(index, 1);
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  _renderToolbarSessions();
}

// Save all windows as a session (for tab overview)
function saveAllWindowsAsSession(name) {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    windows: _browseWindows.map(w => ({
      name: w.name,
      tabs: w.tabs.filter(t => !t.blank && t.url).map(t => ({ url: t.url, title: t.title }))
    })).filter(w => w.tabs.length > 0),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
}

// Toggle sessions dropdown
function _toggleSessionsDropdown() {
  const menu = document.querySelector('.browse-sessions-menu');
  const toggle = document.querySelector('.browse-sessions-toggle');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (toggle) toggle.classList.toggle('open', !isOpen);

  if (!isOpen) {
    // Close on click outside
    setTimeout(() => {
      const handler = (e) => {
        if (!e.target.closest('.browse-sessions-dropdown')) {
          menu.style.display = 'none';
          if (toggle) toggle.classList.remove('open');
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }, 0);
  }
}

// Render sessions dropdown in toolbar
function _renderToolbarSessions() {
  const container = document.getElementById('browse-toolbar-sessions');
  if (!container) return;

  const sessions = _getTabSessions();
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  const canSave = totalTabs > 0;

  container.innerHTML = `
    <button class="browse-sessions-toggle" onclick="_toggleSessionsDropdown()">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
      <svg class="w-3 h-3 chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
    </button>
    <div class="browse-sessions-menu" style="display:none;">
      <div class="browse-sessions-menu-header">
        <button class="browse-save-session-btn" onclick="_promptSaveSessionFromOverview()" ${canSave ? '' : 'disabled'}>
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Save current
        </button>
      </div>
      <div class="browse-sessions-list">
        ${sessions.length === 0 ? '<div class="browse-sessions-empty">No saved sessions</div>' : sessions.map((s, i) => {
          const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
          const winCount = s.windows ? s.windows.length : 1;
          const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const subtitle = winCount > 1 ? `${winCount} win · ${count} tabs` : `${count} tab${count !== 1 ? 's' : ''}`;
          return `
            <div class="browse-session-item">
              <button class="browse-session-info" onclick="_loadSessionFromOverview(${i})" title="Replace current tabs">
                <span class="browse-session-name">${escapeHtml(s.name)}</span>
                <span class="browse-session-meta">${subtitle} · ${date}</span>
              </button>
              <button class="browse-session-add" onclick="_loadSessionFromOverview(${i}, true)" title="Add to existing">+</button>
              <button class="browse-session-delete" onclick="deleteTabSession(${i})" title="Delete">&times;</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Prompt to save session from overview - show inline input in sessions menu
function _promptSaveSessionFromOverview() {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessionsList = document.querySelector('.browse-sessions-list');
  if (!sessionsList) return;

  // Check if input already exists
  if (sessionsList.querySelector('.browse-session-input-row')) return;

  // Create input row at top
  const inputRow = document.createElement('div');
  inputRow.className = 'browse-session-input-row';
  inputRow.innerHTML = `
    <input type="text" placeholder="Session name..." autofocus>
    <button class="save-confirm">Save</button>
    <button class="save-cancel">&times;</button>
  `;
  sessionsList.insertBefore(inputRow, sessionsList.firstChild);

  const input = inputRow.querySelector('input');
  const confirmBtn = inputRow.querySelector('.save-confirm');
  const cancelBtn = inputRow.querySelector('.save-cancel');

  input.focus();

  const doSave = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    saveAllWindowsAsSession(name);
    _renderToolbarSessions();
  };

  const doCancel = () => inputRow.remove();

  confirmBtn.onclick = (e) => { e.stopPropagation(); doSave(); };
  cancelBtn.onclick = (e) => { e.stopPropagation(); doCancel(); };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  };
}

// Save a single window as a session - show inline input
// Load session from overview (replaces current windows)
function _loadSessionFromOverview(index, addToExisting = false) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;

  if (!addToExisting) {
    // Close all existing windows/tabs first
    while (_browseWindows.length > 0) {
      const win = _browseWindows[0];
      while (win.tabs.length > 0) {
        _destroyTab(win.tabs[0]);
        win.tabs.shift();
      }
      _browseWindows.shift();
    }
  }

  // Load the session
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
      if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
    }
  } else if (session.tabs) {
    // Legacy format - create one window
    const newWin = _createBrowseWindow('Window 1');
    for (const t of session.tabs) {
      _browseCreateTabInWindow(newWin.id, t.url);
    }
    if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
  }

  // Activate the first window
  if (_browseWindows.length) {
    _browseActiveWindow = _browseWindows[0].id;
    const win = _browseWindows[0];
    if (win.activeTab) browseSelectTab(win.activeTab);
  }

  _browseSaveTabs();
  _browseRenderTabs();
}
