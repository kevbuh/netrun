// chat-view.js — Chat as an in-place NTP morph (search box slides to bottom, messages above)
import Settings from '/js/core/core-settings.js';

var _chatViewThreadId = null;
var _chatViewThread = null;
var _chatViewMessages = [];
var _chatViewStreaming = false;
var _chatViewStreamContent = '';
var _chatViewMsgList = null;       // the .chat-view-messages div inside the morphed NTP
var _chatViewOrigPlaceholder = ''; // original input placeholder to restore on un-morph
var _chatViewOrigHandlers = null;  // original input handlers to restore on un-morph

// ── Morph NTP into chat mode ──

export function chatViewNewThread(initialMessage) {
  _chatViewNewThread(initialMessage);
}

async function _chatViewNewThread(initialMessage) {
  const thread = await electronAPI.dbQuery('chat-thread-create', 'New Chat', '');
  if (!thread?.id) return;

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
  tab._chatThreadId = thread.id;
  tab.url = 'chat://' + thread.id;
  tab.title = 'Chat';
  tab.favicon = '';

  _chatViewThreadId = thread.id;
  _chatViewThread = thread;
  _chatViewMessages = [];
  _chatViewStreaming = false;
  _chatViewStreamContent = '';

  // Morph the NTP
  _chatViewMorphNTP(ntp);

  // Update URL bar and tabs
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) _browseSetUrlDisplay(urlInput, tab.url);
  _browseRenderTabs();

  // Send initial message
  if (initialMessage) {
    setTimeout(() => _chatViewSend(initialMessage), 100);
  }
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
        if (text && !_chatViewStreaming) {
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
      if (text && !_chatViewStreaming) {
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

  _chatViewThreadId = null;
  _chatViewThread = null;
  _chatViewMessages = [];
  _chatViewStreaming = false;
  _chatViewStreamContent = '';
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

  // Save current state for back navigation
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url || 'ntp://');
  tab.forwardStack = [];

  // Set tab metadata
  tab.blank = false;
  tab._chatPage = true;
  tab._chatThreadId = threadId;
  tab.url = 'chat://' + threadId;
  tab.title = 'Chat';
  tab.favicon = '';

  _chatViewThreadId = threadId;
  _chatViewStreaming = false;
  _chatViewStreamContent = '';

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
  _chatViewThreadId = threadId;
  _chatViewStreaming = false;
  _chatViewStreamContent = '';

  const thread = await electronAPI.dbQuery('chat-thread-get', threadId);
  if (!thread) return;
  _chatViewThread = thread;

  const messages = await electronAPI.dbQuery('chat-message-list', threadId);
  _chatViewMessages = messages || [];

  // Update tab title and URL bar
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab) {
    tab.title = thread.title || 'Chat';
    tab.url = 'chat://' + threadId;
    tab._chatThreadId = threadId;
    _browseRenderTabs();
    const urlInput = document.getElementById('browse-url-input');
    _browseSetUrlDisplay(urlInput, tab.url);
  }

  // Render messages into the msg list
  const list = _chatViewMsgList || document.getElementById('chat-view-msg-list');
  if (list) {
    list.innerHTML = '';
    _chatViewMessages.forEach(msg => {
      list.appendChild(_chatViewRenderMessage(msg));
    });
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }
}

function _chatViewRenderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-view-msg chat-view-msg-' + (msg.role || 'user');
  const content = document.createElement('div');
  content.className = 'chat-view-msg-content';
  content.textContent = msg.content || '';
  div.appendChild(content);
  return div;
}

async function _chatViewSend(text) {
  if (!_chatViewThreadId || _chatViewStreaming) return;

  // Add user message to DB and UI
  const userMsg = await electronAPI.dbQuery('chat-message-add', _chatViewThreadId, 'user', text);
  _chatViewMessages.push(userMsg);
  const list = _chatViewMsgList || document.getElementById('chat-view-msg-list');
  if (list) {
    list.appendChild(_chatViewRenderMessage(userMsg));
    list.scrollTop = list.scrollHeight;
  }

  // Auto-title on first message
  if (_chatViewMessages.length === 1 && _chatViewThread) {
    const title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
    await electronAPI.dbQuery('chat-thread-update', _chatViewThreadId, { title });
    _chatViewThread.title = title;
    const tab = _browseTabs.find(t => t.id === _browseActiveTab);
    if (tab) { tab.title = title; _browseRenderTabs(); }
  }

  // Create streaming placeholder
  _chatViewStreaming = true;
  _chatViewStreamContent = '';
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'chat-view-msg chat-view-msg-assistant';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'chat-view-msg-content chat-view-msg-streaming';
  contentDiv.textContent = '';
  assistantDiv.appendChild(contentDiv);
  if (list) {
    list.appendChild(assistantDiv);
    list.scrollTop = list.scrollHeight;
  }

  // Build messages for Ollama
  const ollamaMessages = _chatViewMessages.map(m => ({ role: m.role, content: m.content }));
  const model = Settings.get('chatModel') || 'qwen2.5:3b';

  // Start streaming
  const sessionId = 'cv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const handler = (_ev, sid, evt) => {
    if (sid !== sessionId) return;
    if (evt.event === 'token') {
      _chatViewStreamContent += evt.data;
      contentDiv.textContent = _chatViewStreamContent;
      if (list) list.scrollTop = list.scrollHeight;
    } else if (evt.event === 'done') {
      window.electronAPI.removeDocChatEventListener(handler);
      contentDiv.classList.remove('chat-view-msg-streaming');
      _chatViewStreaming = false;
      electronAPI.dbQuery('chat-message-add', _chatViewThreadId, 'assistant', _chatViewStreamContent).then(saved => {
        if (saved) _chatViewMessages.push(saved);
      });
    } else if (evt.event === 'error') {
      window.electronAPI.removeDocChatEventListener(handler);
      contentDiv.textContent = 'Error: ' + (evt.data || 'unknown');
      contentDiv.classList.remove('chat-view-msg-streaming');
      contentDiv.classList.add('chat-view-msg-error');
      _chatViewStreaming = false;
    }
  };
  window.electronAPI.onDocChatEvent(handler);

  await electronAPI.dbQuery('doc-chat-start', {
    sessionId,
    context: '',
    messages: ollamaMessages,
    model,
    think: false,
  });
}

window.openChatPage = openChatPage;
window.chatViewNewThread = chatViewNewThread;
window.chatViewUnmorph = chatViewUnmorph;
window.chatViewCleanupMorph = chatViewCleanupMorph;
