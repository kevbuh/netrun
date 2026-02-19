// chat-view.js — Chat as an in-place NTP morph (search box slides to bottom, messages above)
// Uses ChatEngine for agent streaming and ChatRender for rich message rendering.
import Settings from '/js/core/core-settings.js';

var _chatViewThreadId = null;
var _chatViewThread = null;
var _chatViewSession = null;      // ChatEngine session
var _chatViewMsgList = null;       // the .chat-view-messages div inside the morphed NTP
var _chatViewOrigPlaceholder = ''; // original input placeholder to restore on un-morph
var _chatViewOrigHandlers = null;  // original input handlers to restore on un-morph

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
  var msgList = document.createElement('div');
  msgList.className = 'chat-view-messages';
  msgList.id = 'chat-view-msg-list';
  inner.insertBefore(msgList, center);
  _chatViewMsgList = msgList;

  // Swap the search input to chat mode
  const input = ntp.querySelector('#search-query');
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
    input.oninput = null;
    input.onfocus = null;
    input.onblur = null;
    input.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var text = input.value.trim();
        if (text && _chatViewSession && !_chatViewSession.streaming) {
          input.value = '';
          _chatViewSend(text);
        }
      }
    };
    // Focus after morph
    requestAnimationFrame(() => input.focus());
  }

  // Override form submit
  const form = ntp.querySelector('#search-form');
  if (form) {
    form._origOnsubmit = form.onsubmit;
    form.onsubmit = function(e) {
      e.preventDefault();
      var text = input ? input.value.trim() : '';
      if (text && _chatViewSession && !_chatViewSession.streaming) {
        input.value = '';
        _chatViewSend(text);
      }
    };
  }

  // Add chat-mode class (triggers CSS transitions)
  ntp.classList.add('chat-mode');
}

// ── Clean up morph DOM (no tab state changes) ──

function _chatViewCleanupMorph() {
  const container = document.getElementById('browse-content');
  const ntp = container?.querySelector('.browse-ntp');
  if (!ntp) return;

  ntp.classList.remove('chat-mode');

  const msgList = ntp.querySelector('.chat-view-messages');
  if (msgList) msgList.remove();
  _chatViewMsgList = null;

  const input = ntp.querySelector('#search-query');
  if (input) {
    input.placeholder = _chatViewOrigPlaceholder || 'Ask anything...';
    input.value = '';
    if (_chatViewOrigHandlers) {
      input.oninput = _chatViewOrigHandlers.oninput;
      input.onfocus = _chatViewOrigHandlers.onfocus;
      input.onblur = _chatViewOrigHandlers.onblur;
      input.onkeydown = _chatViewOrigHandlers.onkeydown;
    }
    _chatViewOrigHandlers = null;
  }

  const form = ntp.querySelector('#search-form');
  if (form && form._origOnsubmit) {
    form.onsubmit = form._origOnsubmit;
    delete form._origOnsubmit;
  }

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
  const backIcon = icon('chevronLeft', { size: 16 });
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
  html += '<button onclick="if(typeof browseBack===\'function\')browseBack();" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:var(--nr-text-secondary);display:flex;align-items:center;transition:background 0.15s;" onmouseenter="this.style.background=\'var(--nr-bg-raised)\'" onmouseleave="this.style.background=\'none\'">' + backIcon + '</button>';
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
        + 'onmouseenter="this.style.background=\'var(--nr-bg-raised)\';this.querySelector(\'.chat-del\').style.opacity=\'1\'" '
        + 'onmouseleave="this.style.background=\'none\';this.querySelector(\'.chat-del\').style.opacity=\'0\'" '
        + 'onclick="openChatPage(\'' + safeId + '\')">';
      html += '<svg style="width:14px;height:14px;color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';
      html += '<span style="font-size:0.82rem;color:var(--nr-text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</span>';
      html += '<span style="font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">' + escapeHtml(time) + '</span>';
      html += '<button class="chat-del" onclick="event.stopPropagation();_chatListDelete(\'' + safeId + '\');" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);opacity:0;flex-shrink:0;transition:opacity 0.15s;">'
        + '<svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
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

  list.innerHTML = messages.map((m, i) => {
    const html = ChatRender.renderMessageHTML(m, i, total, isFinal);
    return `<div class="chat-view-msg chat-view-msg-${m.role || 'user'}"><div class="chat-view-msg-content">${html}</div></div>`;
  }).join('');

  // Attach handlers via ChatRender
  ChatRender.attachMessageHandlers(list, {
    onRedo() {
      if (!_chatViewSession) return;
      _chatViewSession.redo().then(text => {
        if (text) {
          const input = document.querySelector('.browse-ntp.chat-mode #search-query');
          if (input) input.value = text;
          _chatViewSend(text);
        }
      });
    },
    onEdit(msgIdx) {
      if (!_chatViewSession) return;
      _chatViewSession.editFrom(msgIdx).then(text => {
        if (text != null) {
          const input = document.querySelector('.browse-ntp.chat-mode #search-query');
          if (input) { input.value = text; input.focus(); }
          _chatViewRenderMessages(true);
        }
      });
    },
    onSpeak(btn) {
      // Delegate to panel TTS if available
      if (typeof _ttsStopAll === 'function' && (typeof _ttsAudio !== 'undefined' && _ttsAudio || (typeof _ttsChunks !== 'undefined' && _ttsChunks.length > 0))) {
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

  // Render immediately to show the sending state
  _chatViewRenderMessages(false);

  await _chatViewSession.send(text);

  // Update tab title after send
  if (_chatViewSession.thread.title) {
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab) { tab.title = _chatViewSession.thread.title; _browseRenderTabs(); }
  }
}

window.openChatPage = openChatPage;
window.chatViewNewThread = chatViewNewThread;
window.chatViewUnmorph = chatViewUnmorph;
window.chatViewCleanupMorph = chatViewCleanupMorph;
window._chatListDelete = _chatListDelete;
window._chatListNewChat = _chatListNewChat;
