// chat-view.js — Chat as an in-place NTP morph (search box slides to bottom, messages above)
// Uses ChatEngine for agent streaming and ChatRender for rich message rendering.
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import ChatEngine from '/js/chat-engine.js';
import ChatRender from '/js/chat-render.js';
import { _aetherCommands, _aetherFilterCommands, _aetherHideAgentDropdown, _aetherHideCmdDropdown, _aetherHideHistoryDropdown, _aetherHideModelDropdown, _aetherHideTabDropdown, _aetherRenderAgentDropdown, _aetherRenderCmdDropdown, _aetherRenderHistoryDropdown, _aetherRenderModelDropdown, _aetherSelectAgent, _aetherSelectHistory, _aetherSelectModel, _aetherSelectTab, _aetherSwitchToTab, _doAetherAgent, _doAetherCapture, _doAetherHelp, _doAetherHistory, _doAetherModel, _doAetherSearchNewTab, _doAetherTab, _doAetherTabs } from '/js/panel-commands.js';
import { _browseRenderTabs, _updateIslandNavButtons, browseNavigate } from '/js/browse/browse-island.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseUpdateNewTabPage } from '/js/browse/browse-passwords.js';
import { _ttsStopAll } from '/js/panel-tts.js';
import { openBrowse } from '/js/browse/browse-windows.js';

let _chatViewThreadId = null;
let _chatViewThread = null;
let _chatViewSession = null;      // ChatEngine session
let _chatViewMsgList = null;       // the .chat-view-messages div inside the morphed NTP
let _chatViewOrigPlaceholder = ''; // original input placeholder to restore on un-morph
let _chatViewOrigHandlers = null;  // original input handlers to restore on un-morph
let _chatViewCmdPopup = null;      // the "popup" adapter element for command handlers

// ── Morph NTP into chat mode ──

export function chatViewNewThread(initialMessage) {
  _chatViewNewThread(initialMessage);
}

async function _chatViewNewThread(initialMessage) {
  const session = await ChatEngine.createSession();
  if (!session) return;

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  const container = document.getElementById('browse-content');
  const ntp = container?.querySelector('.browse-ntp');
  if (!ntp) return;

  // Save current state for back navigation
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url || 'ntp://');
  tab.forwardStack = [];

  // Set tab metadata
  tab.blank = false;
  tab._chatPage = true;
  tab._chatThreadId = session.threadId;
  tab.url = 'chat://' + session.threadId;
  tab.title = 'Chat';
  tab.favicon = '';

  _chatViewThreadId = session.threadId;
  _chatViewThread = session.thread;
  _chatViewSession = session;

  // Morph the NTP
  _chatViewMorphNTP(ntp);

  // Register session update listener
  _chatViewRegisterUpdates(session);

  // Update URL bar and tabs
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, tab.url);
  _browseRenderTabs();

  // Send initial message
  if (initialMessage) {
    setTimeout(() => _chatViewSend(initialMessage), 100);
  }
}

function _chatViewRegisterUpdates(session) {
  session.onUpdate((type) => {
    _chatViewRenderMessages(type === 'done' || type === 'message');
    // Update tab title from thread
    if (session.thread.title) {
      const tab = _browseTabs.find(t => t.id === _browseActiveTab);
      if (tab && tab._chatThreadId === session.threadId) {
        tab.title = session.thread.title;
        _browseRenderTabs();
      }
    }
  });
}

function _chatViewMorphNTP(ntp) {
  // Create messages container above the form
  const inner = ntp.querySelector('.browse-ntp-inner');
  const center = ntp.querySelector('.browse-ntp-center');
  if (!inner || !center) return;

  // Insert messages div before the center (which contains the form)
  const msgList = document.createElement('div');
  msgList.className = 'chat-view-messages';
  msgList.id = 'chat-view-msg-list';
  inner.insertBefore(msgList, center);
  _chatViewMsgList = msgList;

  // Swap the search input to chat mode
  const input = ntp.querySelector('#search-query');
  const form = ntp.querySelector('#search-form');
  if (input) {
    _chatViewOrigPlaceholder = input.placeholder;
    // Save original handlers
    _chatViewOrigHandlers = {
      oninput: input.oninput,
      onfocus: input.onfocus,
      onblur: input.onblur,
      onkeydown: input.onkeydown,
    };
    input.placeholder = 'Type a message...';
    input.value = '';
    input.onfocus = null;
    input.onblur = function() {
      // Delay to allow click events on dropdown items to fire first
      setTimeout(function() { _chatViewHideAllDropdowns(); }, 150);
    };

    // Add adapter classes so panel-commands.js querySelector calls find our elements
    input.classList.add('doc-ask-inline-input');
    if (form) form.classList.add('doc-ask-inline-wrap');

    // Make search box full width in chat mode (remove Tailwind constraints)
    const searchBox = ntp.querySelector('.ntp-search-box');
    if (searchBox) {
      searchBox.classList.remove('max-w-[680px]', 'mx-auto');
    }

    // Insert attachment strip (for /capture, /tab context chips) before the form
    const attachStrip = document.createElement('div');
    attachStrip.className = 'doc-screenshot-attachments';
    attachStrip.style.display = 'none';
    if (form) center.insertBefore(attachStrip, form);
    else center.appendChild(attachStrip);

    // Store center as the command popup adapter
    _chatViewCmdPopup = center;
    // Override center.remove so command handlers that call popup.remove() don't destroy our DOM
    center._origRemove = center.remove;
    center.remove = function() {
      _chatViewHideAllDropdowns();
      if (input) { input.value = ''; input.focus(); }
    };

    // ── oninput: slash command detection ──
    input.oninput = function() {
      const val = input.value;
      if (val.startsWith('/')) {
        const histMatch = val.match(/^\/history(\s+(.*))?$/i);
        if (histMatch && histMatch[1] !== undefined) {
          _aetherHideCmdDropdown(_chatViewCmdPopup);
          window._aetherHistoryIdx = -1;
          _aetherRenderHistoryDropdown(_chatViewCmdPopup, (histMatch[2] || '').trim());
        } else {
          _aetherHideHistoryDropdown(_chatViewCmdPopup);
          window._aetherCmdIdx = 0;
          _aetherRenderCmdDropdown(_chatViewCmdPopup, val.slice(1).trim());
        }
      } else {
        _aetherHideCmdDropdown(_chatViewCmdPopup);
        _aetherHideHistoryDropdown(_chatViewCmdPopup);
      }
    };

    // ── onkeydown: full keyboard handling for dropdowns + chat ──
    input.onkeydown = function(ev) {
      const val = input.value;
      const isCmd = val.startsWith('/');
      const popup = _chatViewCmdPopup;
      if (!popup) return;

      const dropdown = popup.querySelector('.aether-cmd-dropdown');
      const modelDropdown = popup.querySelector('.aether-model-dropdown');
      const agentDropdown = popup.querySelector('.aether-agent-dropdown');
      const tabDropdown = popup.querySelector('.aether-tab-dropdown');
      const histDropdown = popup.querySelector('.aether-history-dropdown');

      // ── Model dropdown navigation ──
      if (modelDropdown && window._aetherModelList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') window._aetherModelIdx = Math.min(window._aetherModelIdx + 1, window._aetherModelList.length - 1);
        else window._aetherModelIdx = Math.max(window._aetherModelIdx - 1, 0);
        _aetherRenderModelDropdown(popup);
        const sel = modelDropdown.querySelector('.aether-note-item.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (modelDropdown && window._aetherModelList.length && ev.key === 'Enter') {
        ev.preventDefault();
        _aetherSelectModel(popup);
        return;
      }
      if (modelDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _aetherHideModelDropdown(popup);
        return;
      }

      // ── Agent dropdown navigation ──
      if (agentDropdown && window._aetherAgentList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') window._aetherAgentIdx = Math.min(window._aetherAgentIdx + 1, window._aetherAgentList.length - 1);
        else window._aetherAgentIdx = Math.max(window._aetherAgentIdx - 1, 0);
        _aetherRenderAgentDropdown(popup);
        const sel2 = agentDropdown.querySelector('.aether-note-item.selected');
        if (sel2) sel2.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (agentDropdown && window._aetherAgentList.length && ev.key === 'Enter') {
        ev.preventDefault();
        _aetherSelectAgent(popup);
        return;
      }
      if (agentDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _aetherHideAgentDropdown(popup);
        return;
      }

      // ── Tab dropdown navigation ──
      if (tabDropdown && window._aetherTabList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') window._aetherTabIdx = Math.min(window._aetherTabIdx + 1, window._aetherTabList.length - 1);
        else window._aetherTabIdx = Math.max(window._aetherTabIdx - 1, 0);
        const items = tabDropdown.querySelectorAll('.aether-tab-item');
        items.forEach(function(el, i) { el.classList.toggle('selected', i === window._aetherTabIdx); });
        const selTab = items[window._aetherTabIdx];
        if (selTab) selTab.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (tabDropdown && window._aetherTabList.length && ev.key === 'Enter') {
        ev.preventDefault();
        if (window._aetherTabSwitchMode) _aetherSwitchToTab(popup);
        else _aetherSelectTab(popup);
        return;
      }
      if (tabDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _aetherHideTabDropdown(popup);
        return;
      }

      // ── History dropdown navigation ──
      if (histDropdown && window._aetherHistoryList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') window._aetherHistoryIdx = Math.min(window._aetherHistoryIdx + 1, window._aetherHistoryList.length - 1);
        else window._aetherHistoryIdx = Math.max(window._aetherHistoryIdx - 1, -1);
        const hItems = histDropdown.querySelectorAll('.aether-note-item');
        hItems.forEach(function(el) { el.classList.toggle('selected', parseInt(el.dataset.idx) === window._aetherHistoryIdx); });
        const selHist = histDropdown.querySelector('.aether-note-item[data-idx="' + window._aetherHistoryIdx + '"]');
        if (selHist) selHist.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (histDropdown && ev.key === 'Enter') {
        ev.preventDefault();
        _aetherSelectHistory(popup);
        return;
      }
      if (histDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _aetherHideHistoryDropdown(popup);
        return;
      }

      // ── Command dropdown navigation ──
      if (isCmd && dropdown && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        const cmdItems = dropdown.querySelectorAll('.aether-cmd-item');
        if (ev.key === 'ArrowDown') window._aetherCmdIdx = Math.min(window._aetherCmdIdx + 1, cmdItems.length - 1);
        else window._aetherCmdIdx = Math.max(window._aetherCmdIdx - 1, 0);
        _aetherRenderCmdDropdown(popup, val.slice(1).trim());
        const dd = popup.querySelector('.aether-cmd-dropdown');
        const selCmd = dd && dd.querySelector('.aether-cmd-item.selected');
        if (selCmd) selCmd.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (isCmd && dropdown && ev.key === 'Tab') {
        ev.preventDefault();
        const matches = _aetherFilterCommands(val.slice(1).trim());
        if (matches[window._aetherCmdIdx]) input.value = '/' + matches[window._aetherCmdIdx].name;
        _aetherRenderCmdDropdown(popup, matches[window._aetherCmdIdx]?.name || '');
        return;
      }

      // ── Enter: execute command or send chat message ──
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        if (isCmd && dropdown) {
          const cmdMatches = _aetherFilterCommands(val.slice(1).trim());
          const cmd = cmdMatches[window._aetherCmdIdx] || cmdMatches[0];
          if (cmd) {
            if (cmd.hasArgs) {
              input.value = '/' + cmd.name + ' ';
              _aetherHideCmdDropdown(popup);
            } else if (cmd._special) {
              _aetherHideCmdDropdown(popup);
              _chatViewExecSpecial(cmd.name, popup);
            } else {
              _aetherHideCmdDropdown(popup);
              cmd.fn();
              input.value = '';
            }
            return;
          }
        }
        if (isCmd && val.trim().length > 1) {
          _chatViewExecFullCommand(popup, val);
        } else if (!isCmd) {
          const text = val.trim();
          if (text && _chatViewSession && !_chatViewSession.streaming) {
            input.value = '';
            _chatViewSend(text);
          }
        }
        return;
      }

      // ── Escape: dismiss dropdowns or do nothing ──
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (modelDropdown) { _aetherHideModelDropdown(popup); return; }
        if (agentDropdown) { _aetherHideAgentDropdown(popup); return; }
        if (dropdown) { _aetherHideCmdDropdown(popup); return; }
        if (tabDropdown) { _aetherHideTabDropdown(popup); return; }
        if (histDropdown) { _aetherHideHistoryDropdown(popup); return; }
        // Clear input if it has text
        if (input.value) { input.value = ''; return; }
      }
    };

    // Focus after morph
    requestAnimationFrame(() => input.focus());
  }

  // Override form submit
  if (form) {
    form._origOnsubmit = form.onsubmit;
    form.onsubmit = function(e) {
      e.preventDefault();
      const text = input ? input.value.trim() : '';
      if (text && _chatViewSession && !_chatViewSession.streaming) {
        input.value = '';
        _chatViewSend(text);
      }
    };
  }

  // Add chat-mode class (triggers CSS transitions)
  ntp.classList.add('chat-mode');
}

// ── Slash command helpers ──

function _chatViewHideAllDropdowns() {
  if (!_chatViewCmdPopup) return;
  _aetherHideCmdDropdown(_chatViewCmdPopup);
  _aetherHideModelDropdown(_chatViewCmdPopup);
  _aetherHideAgentDropdown(_chatViewCmdPopup);
  _aetherHideTabDropdown(_chatViewCmdPopup);
  _aetherHideHistoryDropdown(_chatViewCmdPopup);
}

function _chatViewExecSpecial(name, popup) {
  // Commands that use popup chat (panel-specific) — send as natural language instead
  if (name === 'links') {
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) input.value = '';
    _chatViewSend('List all links on the current page');
    return;
  }
  // Commands that work as-is with the adapter
  if (name === 'capture') _doAetherCapture(popup);
  else if (name === 'agent') _doAetherAgent(popup);
  else if (name === 'model') _doAetherModel(popup);
  else if (name === 'tab') _doAetherTab(popup);
  else if (name === 'tabs') _doAetherTabs(popup);
  else if (name === 'history') _doAetherHistory(popup);
  else if (name === 'help') _doAetherHelp(popup);
}

function _chatViewExecFullCommand(popup, text) {
  const raw = text.slice(1).trim();
  const spaceIdx = raw.indexOf(' ');
  if (spaceIdx > 0) {
    const cmdName = raw.slice(0, spaceIdx).toLowerCase();
    const args = raw.slice(spaceIdx + 1).trim();
    const cmd = _aetherCommands.find(function(c) { return c.name === cmdName; });
    if (cmd && cmd.hasArgs && args) {
      _aetherHideCmdDropdown(popup);
      var input = popup.querySelector('.doc-ask-inline-input');
      if (input) input.value = '';
      // Commands with chat results — send as natural language
      if (cmdName === 'define') { _chatViewSend('Define: ' + args); return; }
      if (cmdName === 'paper') { _chatViewSend('Search for papers about: ' + args); return; }
      if (cmdName === 'user') { _chatViewSend('Search for user: ' + args); return; }
      // /search opens in new tab
      if (cmdName === 'search') { _doAetherSearchNewTab(popup, args); return; }
    }
    if (cmd && cmd.fn) { cmd.fn(); if (input) input.value = ''; return; }
  }
  // No space — try to match and execute
  const query = raw.toLowerCase();
  const matches = _aetherFilterCommands(query);
  const matched = matches[window._aetherCmdIdx] || matches[0];
  if (matched) {
    if (matched.hasArgs) return; // needs args
    if (matched._special) {
      _aetherHideCmdDropdown(popup);
      _chatViewExecSpecial(matched.name, popup);
      return;
    }
    _aetherHideCmdDropdown(popup);
    matched.fn();
    const inp = popup.querySelector('.doc-ask-inline-input');
    if (inp) inp.value = '';
  }
}

// ── Clean up morph DOM (no tab state changes) ──

function _chatViewCleanupMorph() {
  const container = document.getElementById('browse-content');
  const ntp = container?.querySelector('.browse-ntp');
  if (!ntp) return;

  // Hide all dropdowns before tearing down
  _chatViewHideAllDropdowns();

  ntp.classList.remove('chat-mode');

  const msgList = ntp.querySelector('.chat-view-messages');
  if (msgList) msgList.remove();
  const rail = ntp.querySelector('.chat-tree-rail');
  if (rail) rail.remove();
  _chatViewMsgList = null;

  const input = ntp.querySelector('#search-query');
  if (input) {
    input.placeholder = _chatViewOrigPlaceholder || 'Ask anything...';
    input.value = '';
    input.classList.remove('doc-ask-inline-input');
    if (_chatViewOrigHandlers) {
      input.oninput = _chatViewOrigHandlers.oninput;
      input.onfocus = _chatViewOrigHandlers.onfocus;
      input.onblur = _chatViewOrigHandlers.onblur;
      input.onkeydown = _chatViewOrigHandlers.onkeydown;
    }
    _chatViewOrigHandlers = null;
  }

  const form = ntp.querySelector('#search-form');
  if (form) {
    form.classList.remove('doc-ask-inline-wrap');
    if (form._origOnsubmit) {
      form.onsubmit = form._origOnsubmit;
      delete form._origOnsubmit;
    }
  }

  // Restore search box width constraints
  const searchBox = ntp.querySelector('.ntp-search-box');
  if (searchBox) {
    searchBox.classList.add('max-w-[680px]', 'mx-auto');
  }

  // Remove attachment strip
  const center = ntp.querySelector('.browse-ntp-center');
  if (center) {
    const strip = center.querySelector('.doc-screenshot-attachments');
    if (strip) strip.remove();
    // Restore original remove method
    if (center._origRemove) {
      center.remove = center._origRemove;
      delete center._origRemove;
    }
  }
  _chatViewCmdPopup = null;

  if (_chatViewSession) {
    _chatViewSession.cancel();
    _chatViewSession = null;
  }
  _chatViewThreadId = null;
  _chatViewThread = null;
}

// ── Un-morph: restore NTP to normal (full — for back button) ──

export function chatViewUnmorph() {
  _chatViewCleanupMorph();

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab) {
    // Pop the ntp:// entry we pushed when entering chat mode
    if (tab.backStack && tab.backStack.length) tab.backStack.pop();
    tab.blank = true;
    tab.url = '';
    tab.title = 'New Tab';
    tab.favicon = '';
    delete tab._chatPage;
    delete tab._chatThreadId;
    _browseRenderTabs();
    const urlInput = document.getElementById('browse-url-input');
    if (urlInput) _browseSetUrlDisplay(urlInput, '');
    _browseUpdateNewTabPage(tab);
  }

  if (typeof _updateIslandNavButtons === 'function') _updateIslandNavButtons();
}

// ── Clean up morph only (for browseNavigate — tab state handled externally) ──

export function chatViewCleanupMorph() {
  _chatViewCleanupMorph();
}

// ── Open an existing chat thread (morph into NTP) ──

export function openChatPage(threadId) {
  if (typeof openBrowse === 'function') openBrowse();

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  // If no threadId, show thread list as a standalone page (old behavior)
  if (!threadId) {
    _openChatListPage(tab);
    return;
  }

  const container = document.getElementById('browse-content');

  // If coming from the chat list page, tear it down first
  if (tab._chatPage && !tab._chatThreadId && tab.el) {
    tab.el.remove();
    tab.el = null;
    delete tab._chatPage;
  }

  let ntp = container?.querySelector('.browse-ntp');

  // If already in chat-mode, just switch threads
  if (ntp && ntp.classList.contains('chat-mode')) {
    _chatViewOpenThread(threadId);
    return;
  }

  // Ensure NTP is showing
  if (!ntp || ntp.style.display === 'none') {
    tab.blank = true;
    _browseUpdateNewTabPage(tab);
    ntp = container?.querySelector('.browse-ntp');
    if (!ntp) return;
  }

  // Only push to backStack if not already a chat tab (avoid duplicates on restore)
  if (!tab._chatPage) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url || 'ntp://');
    tab.forwardStack = [];
  }

  // Set tab metadata
  tab.blank = false;
  tab._chatPage = true;
  tab._chatThreadId = threadId;
  tab.url = 'chat://' + threadId;
  tab.title = 'Chat';
  tab.favicon = '';

  _chatViewThreadId = threadId;

  // Morph the NTP
  _chatViewMorphNTP(ntp);

  // Update URL bar and tabs
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, tab.url);
  _browseRenderTabs();

  // Load and render the thread
  _chatViewOpenThread(threadId);
}

// ── Thread list as standalone page (fallback) ──

function _openChatListPage(tab) {
  // Tear down existing special pages
  if (tab._historyPage || tab._helpPage || tab._chatPage) {
    if (tab.el) tab.el.remove();
    tab.el = null;
    delete tab._historyPage;
    delete tab._helpPage;
    delete tab._chatPage;
  } else if (tab.el) {
    tab.el.remove();
    tab.el = null;
  }

  // Save back stack for back button
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url || 'ntp://');
  tab.forwardStack = [];

  tab.blank = false;
  tab._chatPage = true;
  tab._chatThreadId = null;
  tab.url = 'chat://';
  tab.title = 'Chats';
  tab.favicon = '';

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-chat-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;';
  container.appendChild(el);
  tab.el = el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab.url);

  _chatViewRenderThreadList(el);
}

// ── Thread list ──

async function _chatViewRenderThreadList(container) {
  const threads = await electronAPI.dbQuery('chat-thread-list', 50, 0);

  const chatIcon = icon('chatHistory', { size: 18 });
  const plusIcon = icon('plus', { size: 14 });

  // Group threads by date
  const now = Date.now();
  const today = new Date().setHours(0, 0, 0, 0);
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  function _groupLabel(ts) {
    const ms = ts * 1000;
    if (ms >= today) return 'Today';
    if (ms >= yesterday) return 'Yesterday';
    if (ms >= weekAgo) return 'This Week';
    return new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  let html = '<div style="max-width:680px;margin:0 auto;padding:32px 24px 64px;">';

  // Header: back button + icon + title + new chat button
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">';
  html += '<span style="display:flex;align-items:center;color:var(--nr-text-quaternary);">' + chatIcon + '</span>';
  html += '<span style="font-size:1.1rem;font-weight:600;color:var(--nr-text-primary);flex:1;">Chats</span>';
  html += '<button onclick="_chatListNewChat()" style="background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;color:var(--nr-text-secondary);display:flex;align-items:center;gap:4px;font-size:0.75rem;transition:background 0.15s;" onmouseenter="this.style.background=\'var(--nr-bg-raised)\'" onmouseleave="this.style.background=\'none\'">' + plusIcon + ' New</button>';
  html += '</div>';

  if (!threads || threads.length === 0) {
    html += '<div style="text-align:center;padding:48px 0;color:var(--nr-text-secondary);font-size:0.85rem;">No chats yet</div>';
    html += '</div>';
    container.innerHTML = html;
    return;
  }

  // Build grouped list
  const groups = [];
  const groupMap = {};
  threads.forEach(t => {
    const label = _groupLabel(t.updated_at);
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(t);
  });

  for (const label of groups) {
    html += '<div style="margin-bottom:12px;">';
    html += '<div style="font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    for (const t of groupMap[label]) {
      const time = _chatViewRelativeTime(new Date(t.updated_at * 1000));
      const safeId = escapeHtml(t.id);
      const title = escapeHtml(t.title || 'Untitled');
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" '
        + 'onmouseenter="this.style.background=\'var(--nr-bg-raised)\';this.querySelector(\'.chat-del\').style.display=\'flex\';this.querySelector(\'.chat-time\').style.display=\'none\'" '
        + 'onmouseleave="this.style.background=\'none\';this.querySelector(\'.chat-del\').style.display=\'none\';this.querySelector(\'.chat-time\').style.display=\'\'" '
        + 'onclick="openChatPage(\'' + safeId + '\')">';
      html += icon('chatDots', {size: 14, style: 'color:var(--nr-text-quaternary);flex-shrink:0;'});
      html += '<span style="font-size:0.82rem;color:var(--nr-text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</span>';
      html += '<span class="chat-time" style="font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">' + escapeHtml(time) + '</span>';
      html += '<button class="chat-del" onclick="event.stopPropagation();_chatListDelete(\'' + safeId + '\');" style="display:none;align-items:center;background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);flex-shrink:0;border-radius:4px;">'
        + icon('close', {size: 14})
        + '</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

function _chatViewRelativeTime(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return date.toLocaleDateString();
}

async function _chatListDelete(id) {
  await electronAPI.dbQuery('chat-thread-delete', id);
  // Re-render the list in the current container
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el) _chatViewRenderThreadList(tab.el);
}

function _chatListNewChat() {
  _chatViewNewThread();
}

// ── Chat conversation (load existing thread into morphed NTP) ──

async function _chatViewOpenThread(threadId) {
  // Clean up previous session
  if (_chatViewSession) {
    _chatViewSession.cancel();
    _chatViewSession = null;
  }

  _chatViewThreadId = threadId;

  // Load session via engine (hydrates metadata for rich fields)
  const session = await ChatEngine.loadSession(threadId);
  if (!session) return;
  _chatViewSession = session;
  _chatViewThread = session.thread;

  // Register update listener
  _chatViewRegisterUpdates(session);

  // Update tab title and URL bar
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab) {
    tab.title = session.thread.title || 'Chat';
    tab.url = 'chat://' + threadId;
    tab._chatThreadId = threadId;
    _browseRenderTabs();
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, tab.url);
  }

  // Render messages
  _chatViewRenderMessages(true);
}

// ── Render all messages using ChatRender ──

function _chatViewRenderMessages(isFinal) {
  const list = _chatViewMsgList || document.getElementById('chat-view-msg-list');
  if (!list || !_chatViewSession) return;

  const messages = _chatViewSession.messages;
  const total = messages.length;

  // Build branch navigation indicators on messages
  let messagesHtml = messages.map((m, i) => {
    const html = ChatRender.renderMessageHTML(m, i, total, isFinal);
    const branchNav = _chatViewBranchNav(m, i);
    return `<div class="chat-view-msg chat-view-msg-${m.role || 'user'}">${branchNav}<div class="chat-view-msg-content">${html}</div></div>`;
  }).join('');

  // Append stats bar after last assistant message
  const statsHtml = ChatRender.renderChatStats(messages, _chatViewSession.streamStart);
  if (statsHtml) {
    messagesHtml += `<div class="chat-view-stats">${statsHtml}</div>`;
  }

  list.innerHTML = messagesHtml;

  // Render the tree rail alongside the message list
  _chatViewRenderTreeRail(list);

  // Attach branch nav click handlers
  list.querySelectorAll('.chat-branch-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const msgId = btn.getAttribute('data-navigate-to');
      if (msgId && _chatViewSession) {
        _chatViewSession.navigateTo(msgId).then(() => _chatViewRenderMessages(true));
      }
    });
  });

  // Attach handlers via ChatRender
  ChatRender.attachMessageHandlers(list, {
    onRedo() {
      if (!_chatViewSession) return;
      _chatViewSession.redo().then(text => {
        if (text) {
          // Redo = branch from parent of last user msg, resend same text
          _chatViewRenderMessages(true);
          _chatViewSend(text);
        }
      });
    },
    onEdit(msgIdx) {
      if (!_chatViewSession) return;
      _chatViewSession.editFrom(msgIdx).then(text => {
        if (text != null) {
          // Edit = branch from parent of the edited msg, let user type new text
          const input = document.querySelector('.browse-ntp.chat-mode #search-query');
          if (input) { input.value = text; input.focus(); }
          _chatViewRenderMessages(true);
        }
      });
    },
    onFollowUp(text) {
      if (!_chatViewSession || _chatViewSession.streaming) return;
      const input = document.querySelector('.browse-ntp.chat-mode #search-query');
      if (input) input.value = '';
      _chatViewSend(text);
    },
    onSpeak(btn) {
      // Delegate to panel TTS if available
      if (typeof _ttsStopAll === 'function' && (typeof window._ttsAudio !== 'undefined' && window._ttsAudio || (typeof window._ttsChunks !== 'undefined' && window._ttsChunks.length > 0))) {
        const wasToggling = btn.classList.contains('doc-msg-speaking');
        _ttsStopAll();
        list.querySelectorAll('.doc-msg-speak-btn').forEach(b => b.classList.remove('doc-msg-speaking'));
        if (wasToggling) return;
      }
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      btn.classList.add('doc-msg-speaking');
      if (typeof apiPost === 'function') {
        apiPost('/api/tts', { text }).then(data => {
          if (!data || !data.audioPath) throw new Error('No audio generated');
          const audio = new Audio('file://' + data.audioPath);
          audio.playbackRate = parseFloat(Settings.get('ttsSpeed')) || 1;
          audio.onended = () => { btn.classList.remove('doc-msg-speaking'); };
          audio.onerror = () => { btn.classList.remove('doc-msg-speaking'); };
          audio.play();
        }).catch(() => { btn.classList.remove('doc-msg-speaking'); });
      }
    },
  });

  // Scroll to bottom
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

// ── Send message via ChatEngine session ──

async function _chatViewSend(text) {
  if (!_chatViewSession || _chatViewSession.streaming) return;

  // Collect pending attachments
  const sendOpts = {};
  if (typeof window._pendingScreenshots !== 'undefined' && window._pendingScreenshots.length) {
    sendOpts.images = window._pendingScreenshots.slice();
    window._pendingScreenshots.length = 0;
  }
  if (typeof window._pendingTabContexts !== 'undefined' && window._pendingTabContexts.length) {
    sendOpts.tabContexts = window._pendingTabContexts.slice();
    window._pendingTabContexts.length = 0;
  }
  if (typeof window._pendingElementContexts !== 'undefined' && window._pendingElementContexts.length) {
    sendOpts.elementContexts = window._pendingElementContexts.slice();
    window._pendingElementContexts.length = 0;
  }
  // Clear attachment strip UI
  if (_chatViewCmdPopup) {
    const strip = _chatViewCmdPopup.querySelector('.doc-screenshot-attachments');
    if (strip) { strip.innerHTML = ''; strip.style.display = 'none'; }
  }

  // Render immediately to show the sending state
  _chatViewRenderMessages(false);

  await _chatViewSession.send(text, sendOpts);

  // Update tab title after send
  if (_chatViewSession.thread.title) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab) { tab.title = _chatViewSession.thread.title; _browseRenderTabs(); }
  }
}

// ── Tree rail (vertical minimap on right side) ──

function _chatViewRenderTreeRail(msgList) {
  if (!_chatViewSession) return;

  // Remove existing rail
  const existingRail = msgList.parentElement?.querySelector('.chat-tree-rail');
  if (existingRail) existingRail.remove();

  const messages = _chatViewSession.messages.filter(m => m.id || m.content);
  if (messages.length < 2) return;

  // Calculate proportional heights based on content length
  const minH = 4;
  const maxH = 40;
  const totalContent = messages.reduce((s, m) => s + Math.max((m.content || '').length, 20), 0);

  // Build rail
  const rail = document.createElement('div');
  rail.className = 'chat-tree-rail';

  const track = document.createElement('div');
  track.className = 'chat-tree-rail-track';

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isUser = m.role === 'user';
    const contentLen = Math.max((m.content || '').length, 20);
    // Height proportional to content length
    const h = Math.max(minH, Math.min(maxH, Math.round((contentLen / totalContent) * messages.length * 24)));

    const bar = document.createElement('div');
    bar.className = 'chat-tree-rail-bar' + (isUser ? ' user' : ' assistant');
    bar.style.height = h + 'px';
    bar.setAttribute('data-idx', String(i));

    // Click scrolls to that message
    bar.addEventListener('click', () => {
      const allMsgEls = msgList.querySelectorAll('.chat-view-msg');
      if (allMsgEls[i]) {
        allMsgEls[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        allMsgEls[i].classList.add('chat-view-msg-flash');
        setTimeout(() => allMsgEls[i].classList.remove('chat-view-msg-flash'), 800);
      }
    });

    // Tooltip with snippet on hover
    const tooltipContent = isUser ? (m._display || m.content) : m.content;
    if (tooltipContent) {
      const tooltip = document.createElement('div');
      tooltip.className = 'chat-tree-rail-tooltip';
      const snippet = tooltipContent.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim();
      tooltip.textContent = snippet.length > 100 ? snippet.slice(0, 97) + '\u2026' : snippet;
      bar.appendChild(tooltip);
    }

    track.appendChild(bar);
  }

  rail.appendChild(track);
  msgList.parentElement.appendChild(rail);

  // Sync scroll indicator: highlight the visible portion on the minimap
  const viewport = document.createElement('div');
  viewport.className = 'chat-tree-rail-viewport';
  track.appendChild(viewport);

  function syncViewport() {
    const scrollH = msgList.scrollHeight;
    const clientH = msgList.clientHeight;
    const trackH = track.offsetHeight;
    if (scrollH <= clientH) {
      viewport.style.display = 'none';
      return;
    }
    viewport.style.display = 'block';
    const ratio = clientH / scrollH;
    const vpH = Math.max(12, Math.round(trackH * ratio));
    const vpTop = Math.round((msgList.scrollTop / scrollH) * trackH);
    viewport.style.height = vpH + 'px';
    viewport.style.top = vpTop + 'px';
  }

  msgList.addEventListener('scroll', syncViewport, { passive: true });
  requestAnimationFrame(syncViewport);
}

// ── Branch nav (prev/next sibling on user messages) ──

function _chatViewBranchNav(msg, msgIdx) {
  if (!_chatViewSession || !msg.id) return '';
  if (msg.role !== 'user') return '';

  const siblings = _chatViewSession.getSiblings(msg.id);
  if (!siblings.length) return '';

  const allSiblings = [msg, ...siblings].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  const currentIdx = allSiblings.findIndex(s => s.id === msg.id);
  const total = allSiblings.length;

  const prevId = currentIdx > 0 ? allSiblings[currentIdx - 1].id : null;
  const nextId = currentIdx < total - 1 ? allSiblings[currentIdx + 1].id : null;

  function findLeaf(msgId) {
    const children = _chatViewSession.getChildrenOf(msgId);
    if (!children.length) return msgId;
    return findLeaf(children[children.length - 1].id);
  }

  const prevLeaf = prevId ? findLeaf(prevId) : null;
  const nextLeaf = nextId ? findLeaf(nextId) : null;

  const leftBtn = prevLeaf
    ? `<button class="chat-branch-btn" data-navigate-to="${prevLeaf}" title="Previous branch">${typeof icon === 'function' ? icon('chevronLeft', { size: 10 }) : '\u2039'}</button>`
    : `<button class="chat-branch-btn disabled" disabled>${typeof icon === 'function' ? icon('chevronLeft', { size: 10 }) : '\u2039'}</button>`;
  const rightBtn = nextLeaf
    ? `<button class="chat-branch-btn" data-navigate-to="${nextLeaf}" title="Next branch">${typeof icon === 'function' ? icon('chevronRight', { size: 10 }) : '\u203A'}</button>`
    : `<button class="chat-branch-btn disabled" disabled>${typeof icon === 'function' ? icon('chevronRight', { size: 10 }) : '\u203A'}</button>`;

  return `<div class="chat-branch-nav">${leftBtn}<span class="chat-branch-count">${currentIdx + 1}/${total}</span>${rightBtn}</div>`;
}

