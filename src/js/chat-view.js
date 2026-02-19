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

  tab.blank = false;
  tab._chatPage = true;
  tab._chatThreadId = null;
  tab.url = 'chat://';
  tab.title = 'Chats';
  tab.favicon = '';

  const container = document.getElementById('browse-content');
  const { View } = window.AetherUI ? AetherUI : {};
  if (!View) return;
  var elView = new View('div').attr('id', 'browse-chat-' + tab.id);
  elView.el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow:hidden;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;display:flex;flex-direction:column;';
  container.appendChild(elView.el);
  tab.el = elView.el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, tab.url);

  _chatViewRenderThreadList(elView.el);
}

// ── Thread list ──

async function _chatViewRenderThreadList(container) {
  container.innerHTML = '';
  const { VStack, HStack, Text, Button } = window.AetherUI ? AetherUI : {};
  if (!VStack) { container.textContent = 'AetherUI not loaded'; return; }

  const threads = await electronAPI.dbQuery('chat-thread-list', 50, 0);

  const header = HStack(
    Text('Chats').className('chat-view-title'),
    Button('New Chat').className('nr-btn nr-btn-sm nr-btn-primary').onTap(() => _chatViewNewThread())
  ).className('chat-view-header');

  if (!threads || threads.length === 0) {
    const empty = VStack(
      header,
      VStack(
        Text('No chats yet').className('text-secondary text-center'),
        Text('Start a new conversation').className('text-tertiary text-center text-sm'),
      ).className('chat-view-empty').gap(2)
    ).className('chat-view-list-wrap');
    AetherUI.mount(empty, container);
    return;
  }

  const listItems = threads.map(t => {
    const date = new Date(t.updated_at * 1000);
    const timeStr = _chatViewRelativeTime(date);
    const row = HStack(
      VStack(
        Text(t.title || 'Untitled').className('chat-view-thread-title'),
        Text(timeStr).className('chat-view-thread-time'),
      ).gap(1).styles({ flex: '1', minWidth: '0' }),
      Button('\u00d7').className('chat-view-thread-delete').onTap((e) => {
        e.stopPropagation();
        _chatViewDeleteThread(t.id, container);
      })
    ).className('chat-view-thread-row').onTap(() => {
      openChatPage(t.id);
    });
    return row;
  });

  const layout = VStack(header, ...listItems).className('chat-view-list-wrap');
  AetherUI.mount(layout, container);
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

async function _chatViewDeleteThread(id, container) {
  await electronAPI.dbQuery('chat-thread-delete', id);
  _chatViewRenderThreadList(container);
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
