// browse-sessions.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
import Settings from '/js/core/core-settings.js';
import { truncate } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _browseCreateTabInWindow, _createBrowseWindow, _destroyTab, browseNewTab } from '/js/browse/browse-windows.js';
import { _browseRenderTabs } from '/js/browse/browse-island.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';

// ── Tab Sessions (save/restore named tab groups) ──

export function _getTabSessions() {
  try { return Settings.getJSON(window._getBrowseStorageKey('browseTabSessions'), []); } catch { return []; }
}

export function _saveTabSessions(sessions) {
  Settings.setJSON(window._getBrowseStorageKey('browseTabSessions'), sessions);
}

export function toggleTabStateDropdown() {
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

export function _renderTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  const sessions = _getTabSessions();
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  const canSave = openTabs.length > 0;

  // Save row
  const nameInput = new window.View('input').id('tab-session-name-input')
    .attr('type', 'text').attr('placeholder', 'Session name\u2026')
    .cssText('flex:1;min-width:0;padding:5px 8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:0.78rem;border-radius:6px;outline:none;')
    .on('keydown', function(e) { if (e.key === 'Enter') confirmSaveTabSession(); });
  if (!canSave) nameInput.attr('disabled', true);

  const saveBtn = new window.View('button');
  saveBtn.text('Save ' + openTabs.length + ' tab' + (openTabs.length !== 1 ? 's' : ''));
  saveBtn.cssText('padding:5px 10px;border:none;background:' + (canSave ? 'var(--nr-accent)' : 'var(--nr-bg-raised)') + ';color:' + (canSave ? '#fff' : 'var(--nr-text-quaternary)') + ';font-size:0.78rem;border-radius:6px;cursor:' + (canSave ? 'pointer' : 'default') + ';white-space:nowrap;');
  if (!canSave) saveBtn.attr('disabled', true);
  saveBtn.onTap(function() { confirmSaveTabSession(); });

  const saveRow = window.HStack([nameInput, saveBtn]).spacing(1).alignment('center').id('tab-session-save-row');
  const saveSection = new window.View('div');
  saveSection.cssText('padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);');
  saveSection.add(saveRow);

  // Session list
  const listItems = [];
  if (!sessions.length) {
    listItems.push(window.EmptyState({ title: 'No saved sessions', message: 'Save your open tabs as a session to restore later.' }));
  } else {
    sessions.forEach(function(s, i) {
      const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce(function(n, w) { return n + w.tabs.length; }, 0) : 0);
      const winCount = s.windows ? s.windows.length : 1;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const subtitle = winCount > 1 ? winCount + ' windows \u00b7 ' + count + ' tabs \u00b7 ' + date : count + ' tab' + (count !== 1 ? 's' : '') + ' \u00b7 ' + date;

      const infoBtn = window.VStack([
        window.Text(s.name).font('callout').foreground('primary').truncate(),
        window.Text(subtitle).font('caption2').foreground('quaternary')
      ]).spacing(0).flex(1).styles({minWidth:'0'}).textAlign('left')
        .styles({ border: 'none', background: 'none', padding: '0' }).cursor();
      infoBtn.onTap(function() { loadTabSession(i); });

      var delBtn = window.Text('\u00d7').foreground('quaternary')
        .styles({ border: 'none', background: 'none', padding: '2px', fontSize: '0.9rem', lineHeight: '1', flexShrink: '0' }).cursor()
        .onHover(function() { delBtn.el.style.color = 'var(--nr-text-primary)'; }, function() { delBtn.el.style.color = 'var(--nr-text-quaternary)'; })
        .attr('title', 'Delete session')
        .onTap(function(e) { e.stopPropagation(); deleteTabSession(i); });

      var row = window.HStack([infoBtn, delBtn]).spacing(2).alignment('center').className('tab-session-row')
        .padding('6px', '12px').cursor().transition(['background'], '0.1s')
        .onHover(function() { row.el.style.background = 'var(--aether-hover)'; }, function() { row.el.style.background = 'none'; });
      listItems.push(row);
    });
  }

  const panel = window.VStack([saveSection].concat(listItems))
    .position('absolute').inset(null, 0, null, null).styles({top:'calc(100% + 4px)'})
    .styles({ minWidth: '260px', maxHeight: '360px', overflowY: 'auto' })
    .background('overlay').border('border-default').cornerRadius('md')
    .shadow('popup').zIndex('overlay').padding('4px', '0');

  AetherUI.mount(panel, dd);
}

export function confirmSaveTabSession() {
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

export function loadTabSession(index) {
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

export function deleteTabSession(index) {
  const sessions = _getTabSessions();
  sessions.splice(index, 1);
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  _renderToolbarSessions();
}

// Save all windows as a session (for tab overview)
export function saveAllWindowsAsSession(name) {
  const totalTabs = window._browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    windows: window._browseWindows.map(w => ({
      name: w.name,
      tabs: w.tabs.filter(t => !t.blank && t.url).map(t => ({ url: t.url, title: t.title }))
    })).filter(w => w.tabs.length > 0),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
}

// Toggle sessions dropdown
export function _toggleSessionsDropdown() {
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
export function _renderToolbarSessions() {
  const container = document.getElementById('browse-toolbar-sessions');
  if (!container) return;

  const sessions = _getTabSessions();
  const totalTabs = window._browseWindows.reduce(function(n, w) { return n + w.tabs.filter(function(t) { return !t.blank && t.url; }).length; }, 0);
  const canSave = totalTabs > 0;

  // Toggle button
  const toggleBtn = window.RawHTML('<button class="browse-sessions-toggle" onclick="_toggleSessionsDropdown()">' +
    icon('bookmark', {size: 16, strokeWidth: '1.5'}) +
    icon('chevronDown', {size: 12}) +
    '</button>');

  // Save current button
  const saveCurrentBtn = new window.View('button').className('browse-save-session-btn')
    .add(window.RawHTML(icon('plus', {size: 14})), window.Text(' Save current'));
  if (!canSave) saveCurrentBtn.attr('disabled', true);
  saveCurrentBtn.onTap(function() { _promptSaveSessionFromOverview(); });

  const header = new window.View('div').className('browse-sessions-menu-header')
    .add(saveCurrentBtn);

  // Session list items
  const listChildren = [];
  if (sessions.length === 0) {
    listChildren.push(window.Text('No saved sessions').className('browse-sessions-empty'));
  } else {
    sessions.forEach(function(s, i) {
      const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce(function(n, w) { return n + w.tabs.length; }, 0) : 0);
      const winCount = s.windows ? s.windows.length : 1;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const subtitle = winCount > 1 ? winCount + ' win \u00b7 ' + count + ' tabs' : count + ' tab' + (count !== 1 ? 's' : '');

      const infoBtn = new window.View('button').className('browse-session-info').attr('title', 'Replace current tabs')
        .add(window.Text(s.name).className('browse-session-name'),
             window.Text(subtitle + ' \u00b7 ' + date).className('browse-session-meta'))
        .onTap(function() { _loadSessionFromOverview(i); });

      const addBtn = new window.View('button').className('browse-session-add').attr('title', 'Add to existing')
        .text('+').onTap(function() { _loadSessionFromOverview(i, true); });

      const delBtn = new window.View('button').className('browse-session-delete').attr('title', 'Delete')
        .text('\u00d7').onTap(function() { deleteTabSession(i); });

      const item = window.HStack([infoBtn, addBtn, delBtn]).className('browse-session-item');
      listChildren.push(item);
    });
  }

  const sessionsList = window.VStack(listChildren).className('browse-sessions-list');
  const menuDiv = window.VStack([header, sessionsList]).className('browse-sessions-menu').styles({display:'none'});
  const wrapper = window.VStack([toggleBtn, menuDiv]);

  AetherUI.mount(wrapper, container);
}

// Prompt to save session from overview - show inline input in sessions menu
export function _promptSaveSessionFromOverview() {
  const totalTabs = window._browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessionsList = document.querySelector('.browse-sessions-list');
  if (!sessionsList) return;

  // Check if input already exists
  if (sessionsList.querySelector('.browse-session-input-row')) return;

  // Create input row at top
  const inputView = new window.View('input').attr('type', 'text').attr('placeholder', 'Session name...').attr('autofocus', true);

  const doSave = () => {
    const name = inputView.el.value.trim();
    if (!name) { inputView.el.focus(); return; }
    saveAllWindowsAsSession(name);
    _renderToolbarSessions();
  };

  let inputRow; // forward declaration for doCancel
  const doCancel = () => inputRow.el.remove();

  const confirmBtnView = new window.View('button').className('save-confirm').text('Save')
    .onTap(function(e) { e.stopPropagation(); doSave(); });

  const cancelBtnView = new window.View('button').className('save-cancel').text('\u00d7')
    .onTap(function(e) { e.stopPropagation(); doCancel(); });

  inputView.on('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  });

  const inputRow = window.HStack([inputView, confirmBtnView, cancelBtnView]).className('browse-session-input-row');
  sessionsList.insertBefore(inputRow.el, sessionsList.firstChild);

  inputView.el.focus();
}

// Save a single window as a session - show inline input
// Load session from overview (replaces current windows)
export function _loadSessionFromOverview(index, addToExisting = false) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;

  if (!addToExisting) {
    // Close all existing windows/tabs first
    while (window._browseWindows.length > 0) {
      const win = window._browseWindows[0];
      while (win.tabs.length > 0) {
        _destroyTab(win.tabs[0]);
        win.tabs.shift();
      }
      window._browseWindows.shift();
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
  if (window._browseWindows.length) {
    window._browseActiveWindow = window._browseWindows[0].id;
    const win = window._browseWindows[0];
    if (win.activeTab) browseSelectTab(win.activeTab);
  }

  window._browseSaveTabs();
  _browseRenderTabs();
}

