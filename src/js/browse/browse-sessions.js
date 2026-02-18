// browse-sessions.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

// ── Tab Sessions (save/restore named tab groups) ──

function _getTabSessions() {
  try { return Settings.getJSON(_getBrowseStorageKey('browseTabSessions'), []); } catch { return []; }
}

function _saveTabSessions(sessions) {
  Settings.setJSON(_getBrowseStorageKey('browseTabSessions'), sessions);
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

  // Save row
  var nameInput = new View('input');
  nameInput.el.type = 'text';
  nameInput.el.id = 'tab-session-name-input';
  nameInput.el.placeholder = 'Session name\u2026';
  nameInput.cssText('flex:1;min-width:0;padding:5px 8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:0.78rem;border-radius:6px;outline:none;');
  nameInput.on('keydown', function(e) { if (e.key === 'Enter') confirmSaveTabSession(); });
  if (!canSave) nameInput.el.disabled = true;

  var saveBtn = new View('button');
  saveBtn.el.textContent = 'Save ' + openTabs.length + ' tab' + (openTabs.length !== 1 ? 's' : '');
  saveBtn.cssText('padding:5px 10px;border:none;background:' + (canSave ? 'var(--nr-accent)' : 'var(--nr-bg-raised)') + ';color:' + (canSave ? '#fff' : 'var(--nr-text-quaternary)') + ';font-size:0.78rem;border-radius:6px;cursor:' + (canSave ? 'pointer' : 'default') + ';white-space:nowrap;');
  if (!canSave) saveBtn.el.disabled = true;
  saveBtn.onTap(function() { confirmSaveTabSession(); });

  var saveRow = HStack([nameInput, saveBtn]).spacing(1).alignment('center').id('tab-session-save-row');
  var saveSection = new View('div');
  saveSection.cssText('padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);');
  saveSection.el.appendChild(saveRow.build());

  // Session list
  var listItems = [];
  if (!sessions.length) {
    listItems.push(Text('No saved sessions').font('caption1').foreground('quaternary')
      .padding('12px').textAlign('center'));
  } else {
    sessions.forEach(function(s, i) {
      var count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce(function(n, w) { return n + w.tabs.length; }, 0) : 0);
      var winCount = s.windows ? s.windows.length : 1;
      var date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      var subtitle = winCount > 1 ? winCount + ' windows \u00b7 ' + count + ' tabs \u00b7 ' + date : count + ' tab' + (count !== 1 ? 's' : '') + ' \u00b7 ' + date;

      var infoBtn = VStack([
        Text(s.name).font('callout').foreground('primary').truncate(),
        Text(subtitle).font('caption2').foreground('quaternary')
      ]).spacing(0).flex(1).styles({minWidth:'0'}).textAlign('left')
        .styles({ border: 'none', background: 'none', padding: '0' }).cursor();
      infoBtn.onTap(function() { loadTabSession(i); });

      var delBtn = Text('\u00d7').foreground('quaternary')
        .styles({ border: 'none', background: 'none', padding: '2px', fontSize: '0.9rem', lineHeight: '1', flexShrink: '0' }).cursor()
        .onHover(function() { delBtn.el.style.color = 'var(--nr-text-primary)'; }, function() { delBtn.el.style.color = 'var(--nr-text-quaternary)'; })
        .onTap(function(e) { e.stopPropagation(); deleteTabSession(i); });
      delBtn.el.title = 'Delete session';

      var row = HStack([infoBtn, delBtn]).spacing(2).alignment('center').className('tab-session-row')
        .padding('6px', '12px').cursor().transition(['background'], '0.1s')
        .onHover(function() { row.el.style.background = 'var(--aether-hover)'; }, function() { row.el.style.background = 'none'; });
      listItems.push(row);
    });
  }

  var panel = VStack([saveSection].concat(listItems))
    .position('absolute').inset(null, 0, null, null).styles({top:'calc(100% + 4px)'})
    .styles({ minWidth: '260px', maxHeight: '360px', overflowY: 'auto' })
    .background('overlay').border('border-default').cornerRadius('md')
    .shadow('popup').zIndex('overlay').padding('4px', '0');

  AetherUI.mount(panel, dd);
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
        if (!e.target.closest('.browse-sessions-dropdown.nr-menu')) {
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
  const totalTabs = _browseWindows.reduce(function(n, w) { return n + w.tabs.filter(function(t) { return !t.blank && t.url; }).length; }, 0);
  const canSave = totalTabs > 0;

  // Toggle button
  var toggleBtn = RawHTML('<button class="browse-sessions-toggle" onclick="_toggleSessionsDropdown()">' +
    '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>' +
    '<svg class="w-3 h-3 chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
    '</button>');

  // Save current button
  var saveCurrentBtn = new View('button');
  saveCurrentBtn.el.className = 'browse-save-session-btn';
  saveCurrentBtn.el.appendChild(RawHTML('<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>').build());
  saveCurrentBtn.el.appendChild(document.createTextNode(' Save current'));
  if (!canSave) saveCurrentBtn.el.disabled = true;
  saveCurrentBtn.onTap(function() { _promptSaveSessionFromOverview(); });

  var header = new View('div');
  header.el.className = 'browse-sessions-menu-header';
  header.el.appendChild(saveCurrentBtn.build());

  // Session list items
  var listChildren = [];
  if (sessions.length === 0) {
    listChildren.push(new View('div').className('browse-sessions-empty')._bindText('No saved sessions'));
  } else {
    sessions.forEach(function(s, i) {
      var count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce(function(n, w) { return n + w.tabs.length; }, 0) : 0);
      var winCount = s.windows ? s.windows.length : 1;
      var date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      var subtitle = winCount > 1 ? winCount + ' win \u00b7 ' + count + ' tabs' : count + ' tab' + (count !== 1 ? 's' : '');

      var infoBtn = new View('button');
      infoBtn.el.className = 'browse-session-info';
      infoBtn.el.title = 'Replace current tabs';
      infoBtn.el.appendChild(Text(s.name).className('browse-session-name').build());
      infoBtn.el.appendChild(Text(subtitle + ' \u00b7 ' + date).className('browse-session-meta').build());
      infoBtn.onTap(function() { _loadSessionFromOverview(i); });

      var addBtn = new View('button');
      addBtn.el.className = 'browse-session-add';
      addBtn.el.title = 'Add to existing';
      addBtn.el.textContent = '+';
      addBtn.onTap(function() { _loadSessionFromOverview(i, true); });

      var delBtn = new View('button');
      delBtn.el.className = 'browse-session-delete';
      delBtn.el.title = 'Delete';
      delBtn.el.textContent = '\u00d7';
      delBtn.onTap(function() { deleteTabSession(i); });

      var item = HStack([infoBtn, addBtn, delBtn]).className('browse-session-item');
      listChildren.push(item);
    });
  }

  var sessionsList = VStack(listChildren).className('browse-sessions-list');
  var menuDiv = VStack([header, sessionsList]).className('browse-sessions-menu').styles({display:'none'});
  var wrapper = VStack([toggleBtn, menuDiv]);

  AetherUI.mount(wrapper, container);
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
  var inputView = new View('input');
  inputView.el.type = 'text';
  inputView.el.placeholder = 'Session name...';
  inputView.el.autofocus = true;

  var confirmBtnView = new View('button');
  confirmBtnView.el.className = 'save-confirm';
  confirmBtnView.el.textContent = 'Save';

  var cancelBtnView = new View('button');
  cancelBtnView.el.className = 'save-cancel';
  cancelBtnView.el.textContent = '\u00d7';

  var inputRow = HStack([inputView, confirmBtnView, cancelBtnView]).className('browse-session-input-row').build();
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
