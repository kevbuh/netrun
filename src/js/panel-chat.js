// panel-chat.js — Chat system, context attachments, and screenshots

// Model context sizes for different AI models
const _modelContextSizes = {
  'claude-sonnet-4': 200000, 'claude-opus-4': 200000, 'claude-3.5-sonnet': 200000,
  'gpt-4o': 128000, 'gpt-4-turbo': 128000, 'gpt-4': 8192, 'gpt-3.5-turbo': 16384,
  'qwen2.5:1.5b': 32000, 'qwen2.5:3b': 32000, 'qwen2.5:7b': 32000,
  'qwen3:8b': 32000, 'qwen3-vl:8b': 32000, 'llama3:8b': 8000,
  'gemma2:9b': 8000, 'mistral:7b': 32000, 'deepseek-r1:8b': 64000
};

function _saveChatMemory() {
  if (_popupChatMessages.length < 2) return;
  // Skip search-only interactions (all user messages start with web search prefix)
  const userMsgs = _popupChatMessages.filter(m => m.role === 'user');
  if (!userMsgs.length) return;
  const msgs = _popupChatMessages.filter(m => !m._thinking).map(m => ({ role: m.role, content: m.content || '' }));
  const paper = typeof _currentPaperViewPaper !== 'undefined' ? _currentPaperViewPaper : null;
  const browseTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  const pageUrl = (paper && paper.link) || (browseTab && browseTab.url) || '';
  const pageTitle = (paper && paper.title) || (browseTab && browseTab.title) || '';
  apiPost('/api/chat-memory', { messages: msgs, pageUrl, pageTitle }).catch(() => {});
}



function _sendPopupChatMessage(popup, capturedText) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  // Allow sending if there's capturedText, screenshots, or a query
  if (!q && _pendingScreenshots.length === 0 && !capturedText) return;
  input.value = '';

  // Pin the panel in place and restore the cursor
  _aetherTrackMode = false;
  _aetherPinned = true;
  _aetherShowCursor();

  // Grab pending screenshots and note contexts, clear strip
  const images = _pendingScreenshots.slice();
  _pendingScreenshots = [];
  const noteContexts = _pendingNoteContexts.slice();
  _pendingNoteContexts = [];
  const tabContexts = _pendingTabContexts.slice();
  _pendingTabContexts = [];
  const fileContexts = _pendingFileContexts.slice();
  _pendingFileContexts = [];
  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (strip) { strip.innerHTML = ''; strip.style.display = 'none'; }

  // Build user message with context on first message
  const userMsg = _popupChatMessages.length === 0 && capturedText
    ? (q || 'What is this?') + '\n\n> ' + capturedText
    : (q || 'What is this?');
  const msgObj = { role: 'user', content: userMsg, _display: q || 'What is this?' };
  if (images.length) msgObj.images = images;
  _popupChatMessages.push(msgObj);
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });

  // Show chat area, add has-chat class
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _renderPopupChatLive(false);
  _repositionSelectionPopup();

  input.disabled = true;
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) sendBtn.disabled = true;

  _popupChatAbort = new AbortController();

  // Check if any message has images (vision mode)
  const hasVision = _popupChatMessages.some(m => m.images && m.images.length > 0);

  const filteredMsgs = _popupChatMessages.filter(m => !m._thinking).map(m => {
    const msg = { role: m.role, content: m.content };
    if (m.images && m.images.length) msg.images = m.images;
    return msg;
  });

  (async () => {
    try {
      const body = { messages: filteredMsgs };
      const chatModel = localStorage.getItem('chatModel');
      if (chatModel) body.model = chatModel;
      const _aiModelName = hasVision ? (localStorage.getItem('visionModel') || chatModel || 'default') : (chatModel || 'default');
      islandUpdate('aether', { type: 'ai', label: _aiModelName, detail: 'Chatting \u00B7 ' + _aiModelName });
      const toolsOn = localStorage.getItem('chatTools') !== 'off';
      // Include current page info for tool context
      if (toolsOn) {
        const paper = _currentPaperViewPaper;
        const browseTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
          ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
        if (paper) {
          body.pageUrl = paper.link || paper.url || '';
          body.pageTitle = paper.title || '';
        } else if (browseTab && browseTab.url) {
          body.pageUrl = browseTab.url;
          body.pageTitle = browseTab.title || '';
        }
      }
      // Track context sources for transparency indicator
      const _ctxSources = [];
      if (hasVision) {
        _ctxSources.push('vision');
        body.vision = true;
        const vm = localStorage.getItem('visionModel');
        if (vm) body.model = vm;
      } else {
        if (toolsOn) body.tools = true;
        body.think = localStorage.getItem('chatThinking') === 'on';
        // Build context from doc text + any attached note/tab contents
        let ctx = _docText || '';
        if (ctx) _ctxSources.push('doc');
        if (noteContexts.length) {
          _ctxSources.push(noteContexts.length + ' note' + (noteContexts.length > 1 ? 's' : ''));
          const notesCtx = noteContexts.map(n =>
            `--- Note: ${n.title} ---\n${n.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + notesCtx : notesCtx;
        }
        if (tabContexts.length) {
          _ctxSources.push(tabContexts.length + ' tab' + (tabContexts.length > 1 ? 's' : ''));
          const tabCtx = tabContexts.map(t =>
            `--- Tab: ${t.title} (${t.url}) ---\n${t.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + tabCtx : tabCtx;
        }
        if (fileContexts.length) {
          _ctxSources.push(fileContexts.length + ' file' + (fileContexts.length > 1 ? 's' : ''));
          const fileCtx = fileContexts.map(f =>
            `--- File: ${f.name} ---\n${f.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + fileCtx : fileCtx;
        }
        // Retrieve relevant past conversations on first exchange
        if (!_chatMemoryRetrieved && _popupChatMessages.length <= 2) {
          _chatMemoryRetrieved = true;
          try {
            const userMsg = _popupChatMessages.find(m => m.role === 'user');
            if (userMsg) {
              const memResp = await api('/api/chat-memories?query=' + encodeURIComponent(userMsg.content),
                { signal: _popupChatAbort.signal });
              if (memResp.ok) {
                const memData = await memResp.json();
                if (memData.memories && memData.memories.length) {
                  _ctxSources.push(memData.memories.length + ' memor' + (memData.memories.length > 1 ? 'ies' : 'y'));
                  const memCtx = '\n\nRELEVANT PAST CONVERSATIONS:\n' +
                    memData.memories.map((m, i) => `${i + 1}. ${m.summary}` + (m.page_title ? ` (from: ${m.page_title})` : '')).join('\n');
                  ctx = ctx ? ctx + memCtx : memCtx;
                }
              }
            }
          } catch (e) { /* memory retrieval is best-effort */ }
        }
        // Auto-inject accessible DOM from active browse tab for agent tools
        if (toolsOn && typeof agentGetAccessibleDOM === 'function') {
          const _agentTab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
            ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
          if (_agentTab && _agentTab.el) {
            try {
              const domTree = await agentGetAccessibleDOM(_agentTab);
              if (domTree && domTree.elements) {
                _ctxSources.push('page DOM (' + (domTree.elementCount || '?') + ')');
                const domCtx = `\n\n--- BROWSER TAB DOM (${domTree.title}) [${domTree.url}] ---\n${domTree.elements}\n--- END DOM ---`;
                ctx = ctx ? ctx + domCtx : domCtx;
              } else if (domTree && domTree.error) {
                console.warn('[agent] DOM extraction error:', domTree.error);
              }
            } catch (_e) { console.warn('[agent] DOM extraction failed:', _e); }
          }
        }
        if (toolsOn) _ctxSources.push('tools');
        body.context = ctx;
      }
      // Store context sources + raw context on the AI message for display
      const aiMsg = _popupChatMessages[_popupChatMessages.length - 1];
      if (aiMsg && _ctxSources.length) {
        aiMsg._ctxSources = _ctxSources;
        aiMsg._ctxRaw = body.context || '';
      }
      _chatStreamStart = Date.now();
      const resp = await api('/api/doc-chat', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: _popupChatAbort.signal
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        _popupChatMessages[_popupChatMessages.length - 1].content = 'Error: server returned ' + resp.status;
        _popupChatMessages[_popupChatMessages.length - 1]._thinking = false;
        _renderPopupChatLive(true);
        return;
      }

      let aiText = '';
      const aiIdx = _popupChatMessages.length - 1;
      _popupChatMessages[aiIdx]._thinking = false;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      let streamDone = false;
      let _inThinkTag = false; // Track <think>...</think> in content stream
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            if (currentEvent === 'thinking') {
              try {
                const token = JSON.parse(line.slice(6));
                if (!_popupChatMessages[aiIdx]._thinkingText) _popupChatMessages[aiIdx]._thinkingText = '';
                _popupChatMessages[aiIdx]._thinkingText += token;
                _popupChatMessages[aiIdx]._thinking = true;
                _popupChatMessages[aiIdx]._thinkingLabel = 'Thinking…';
                _renderPopupChatLive(false);
              } catch (e) {}
            } else if (currentEvent === 'token') {
              try {
                const token = JSON.parse(line.slice(6));
                // Handle <think>...</think> tags embedded in content stream
                let _visibleToken = token;
                if (_inThinkTag) {
                  const endIdx = _visibleToken.indexOf('</think>');
                  if (endIdx !== -1) {
                    // Capture thinking text, resume visible output after tag
                    const thinkPart = _visibleToken.slice(0, endIdx);
                    if (!_popupChatMessages[aiIdx]._thinkingText) _popupChatMessages[aiIdx]._thinkingText = '';
                    _popupChatMessages[aiIdx]._thinkingText += thinkPart;
                    _visibleToken = _visibleToken.slice(endIdx + 8);
                    _inThinkTag = false;
                  } else {
                    // Still inside think tag — capture as thinking, don't display
                    if (!_popupChatMessages[aiIdx]._thinkingText) _popupChatMessages[aiIdx]._thinkingText = '';
                    _popupChatMessages[aiIdx]._thinkingText += _visibleToken;
                    _popupChatMessages[aiIdx]._thinking = true;
                    _popupChatMessages[aiIdx]._thinkingLabel = 'Thinking…';
                    _renderPopupChatLive(false);
                    _visibleToken = '';
                  }
                }
                if (!_inThinkTag && _visibleToken.includes('<think>')) {
                  const startIdx = _visibleToken.indexOf('<think>');
                  const before = _visibleToken.slice(0, startIdx);
                  const after = _visibleToken.slice(startIdx + 7);
                  _inThinkTag = true;
                  // Check if </think> is also in this token
                  const endIdx2 = after.indexOf('</think>');
                  if (endIdx2 !== -1) {
                    const thinkPart = after.slice(0, endIdx2);
                    if (!_popupChatMessages[aiIdx]._thinkingText) _popupChatMessages[aiIdx]._thinkingText = '';
                    _popupChatMessages[aiIdx]._thinkingText += thinkPart;
                    _visibleToken = before + after.slice(endIdx2 + 8);
                    _inThinkTag = false;
                  } else {
                    if (!_popupChatMessages[aiIdx]._thinkingText) _popupChatMessages[aiIdx]._thinkingText = '';
                    _popupChatMessages[aiIdx]._thinkingText += after;
                    _visibleToken = before;
                  }
                }
                if (_visibleToken) {
                  _popupChatMessages[aiIdx]._thinking = false;
                  aiText += _visibleToken;
                  _popupChatMessages[aiIdx].content = aiText;
                  _renderPopupChatLive(false);
                }
              } catch (e) {}
            } else if (currentEvent === 'tool_call') {
              try {
                const tc = JSON.parse(line.slice(6));
                const labels = { web_search: 'Searching web…', search_papers: 'Searching papers…', fetch_page: 'Fetching page…', save_to_reading_list: 'Bookmarking…', navigate: 'Navigating…', create_experiment: 'Creating experiment…', create_calendar_event: 'Adding to calendar…', open_tab: 'Opening tab…', browser_read_page: 'Reading page…', browser_click: 'Clicking…', browser_type: 'Typing…', browser_scroll: 'Scrolling…', browser_navigate: 'Navigating…', browser_screenshot: 'Taking screenshot…' };
                _popupChatMessages[aiIdx].content = '';
                _popupChatMessages[aiIdx]._thinking = true;
                _popupChatMessages[aiIdx]._thinkingLabel = labels[tc.name] || 'Using tool…';
                _renderPopupChatLive(false);
              } catch (e) {}
            } else if (currentEvent === 'action') {
              try {
                const act = JSON.parse(line.slice(6));
                if (act.type === 'bookmark' && act.url) {
                  const paper = { link: act.url, title: act.title || act.url };
                  if (typeof toggleSavePost === 'function') {
                    const saved = JSON.parse(localStorage.getItem('savedPosts') || '{}');
                    if (!saved[act.url]) toggleSavePost(paper);
                  }
                } else if (act.type === 'navigate' && act.view) {
                  const routes = { home: '#', browse: '#browse', experiments: '#experiments', saved: '#saved', calendar: '#calendar', settings: '#settings', quality: '#quality' };
                  location.hash = routes[act.view] || '#';
                } else if (act.type === 'open_tab') {
                  if (typeof browseNewTab === 'function') {
                    location.hash = '#browse';
                    if (act.url) setTimeout(() => browseNewTab(act.url), 100);
                    else setTimeout(() => browseNewTab(), 100);
                  }
                } else if (act.type === 'agent_click') {
                  const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
                  if (_tab) agentClick(_tab, act.element_id);
                } else if (act.type === 'agent_type') {
                  const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
                  if (_tab) agentType(_tab, act.element_id, act.text);
                } else if (act.type === 'agent_scroll') {
                  const _tab = typeof _browseTabs !== 'undefined' ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
                  if (_tab) agentScroll(_tab, act.direction);
                } else if (act.type === 'agent_navigate') {
                  if (typeof browseNavigate === 'function') {
                    location.hash = '#browse';
                    setTimeout(() => browseNavigate(act.url), 100);
                  }
                }
              } catch (e) {}
            } else if (currentEvent === 'usage') {
              try {
                const usage = JSON.parse(line.slice(6));
                _popupChatMessages[aiIdx]._usage = usage;
              } catch (e) {}
            } else if (currentEvent === 'done') {
              streamDone = true;
            } else if (currentEvent === 'error') {
              try {
                const errMsg = JSON.parse(line.slice(6));
                _popupChatMessages[aiIdx].content = aiText || ('Error: ' + errMsg);
              } catch (e) {}
              streamDone = true;
            }
            currentEvent = '';
          } else if (line === '') {
            currentEvent = '';
          }
        }
      }

      // Intercept: if streamed text contains a raw JSON tool call, execute it instead of displaying
      let _intercepted = false;
      if (aiText && aiText.includes('"name"')) {
        // Extract JSON object from anywhere in the text (model may prepend thinking text)
        // Regex handles one level of nesting (e.g. "arguments": {} or {"element_id": 5})
        const _jsonMatch = aiText.match(/\{(?:[^{}]|\{[^{}]*\})*\}/);
        if (_jsonMatch) try {
          const _tc = JSON.parse(_jsonMatch[0]);
          if (_tc.name && typeof _tc.name === 'string') {
            _intercepted = true;
            const _tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
              ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
            const _args = _tc.arguments || _tc.parameters || {};
            if (_tc.name === 'browser_click' && _tab && _args.element_id != null) {
              agentClick(_tab, _args.element_id);
              aiText = `Clicked element ${_args.element_id}.`;
            } else if (_tc.name === 'browser_type' && _tab && _args.element_id != null) {
              agentType(_tab, _args.element_id, _args.text || '');
              aiText = `Typed "${_args.text || ''}" into element ${_args.element_id}.`;
            } else if (_tc.name === 'browser_scroll' && _tab) {
              agentScroll(_tab, _args.direction || 'down');
              aiText = `Scrolled ${_args.direction || 'down'}.`;
            } else if (_tc.name === 'browser_navigate' && _args.url) {
              if (typeof browseNavigate === 'function') {
                location.hash = '#browse';
                setTimeout(() => browseNavigate(_args.url), 100);
              }
              aiText = `Navigating to ${_args.url}`;
            } else if (_tc.name === 'browser_read_page' && _tab) {
              const domResult = await agentGetAccessibleDOM(_tab);
              aiText = domResult && domResult.elements
                ? `Page has ${domResult.elementCount} elements. Here's what I see:\n${domResult.elements}`
                : 'Could not read the page DOM.';
            } else if (_tc.name === 'navigate' && _args.view) {
              const routes = { home: '#', browse: '#browse', experiments: '#experiments', saved: '#saved', calendar: '#calendar', settings: '#settings', quality: '#quality' };
              location.hash = routes[_args.view] || '#';
              aiText = `Navigated to ${_args.view}.`;
            } else if (_tc.name === 'open_tab') {
              if (typeof browseNewTab === 'function') {
                location.hash = '#browse';
                setTimeout(() => browseNewTab(_args.url || undefined), 100);
              }
              aiText = _args.url ? `Opened ${_args.url}` : 'Opened a new tab.';
            } else {
              _intercepted = false; // Unknown tool, show raw text
            }
          }
        } catch (_e) { /* not valid JSON, show as normal text */ }
      }
      _popupChatMessages[aiIdx]._thinking = false;
      _popupChatMessages[aiIdx].content = aiText;
      _renderPopupChatLive(true);
    } catch (e) {
      if (e.name !== 'AbortError') {
        _popupChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
        _renderPopupChatLive(true);
      }
    }
    _popupChatAbort = null;
    if (_aetherBackgroundStreaming) {
      // Stream finished while panel was dismissed — show "ready" in island
      islandUpdate('aether', {
        type: 'ai', label: 'Response ready \u2713',
        detail: 'Response ready \u2713',
        action: function() { _reopenAetherPanel(); }
      });
      // Auto-dismiss after 8s
      setTimeout(function() { if (_aetherBackgroundStreaming) { _aetherBackgroundStreaming = false; islandRemove('aether'); } }, 8000);
    } else {
      islandRemove('aether');
    }
    // Re-enable input via DOM lookup (panel may have been reopened)
    const _p = document.getElementById('doc-chat-ask-float');
    if (_p) {
      const _inp = _p.querySelector('.doc-ask-inline-input');
      const _sb = _p.querySelector('.doc-ask-inline-send');
      if (_inp) { _inp.disabled = false; _inp.focus(); }
      if (_sb) _sb.disabled = false;
    }
    _repositionSelectionPopup();
  })();
}

function _renderPopupChatLive(final) {
  const p = document.getElementById('doc-chat-ask-float');
  if (p) _renderPopupChat(p, final);
}

function _maybeDismissToIsland(popup) {
  if (_popupChatAbort) {
    _aetherBackgroundStreaming = true;
    islandUpdate('aether', {
      type: 'ai', label: 'Generating response\u2026',
      detail: 'Generating response\u2026',
      action: function() { _reopenAetherPanel(); }
    });
    // Don't abort — let stream continue in background
  }
}

function _reopenAetherPanel() {
  _aetherBackgroundStreaming = false;
  islandRemove('aether');

  // Preserve messages, reopen panel via _showPanel (which resets them), then restore
  const savedMsgs = _popupChatMessages.slice();
  const savedAbort = _popupChatAbort;
  _popupChatAbort = null; // prevent _showPanel from aborting the stream

  _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, trackCursor: false });

  // Restore the stream and messages
  _popupChatMessages = savedMsgs;
  _popupChatAbort = savedAbort;
  _aetherPinned = true;
  _aetherTrackMode = false;

  const popup = document.getElementById('doc-chat-ask-float');
  if (popup) {
    popup.classList.add('has-chat');
    const chatArea = popup.querySelector('.doc-popup-chat-area');
    if (chatArea) chatArea.classList.add('visible');
    const isStreaming = !!_popupChatAbort;
    _renderPopupChat(popup, !isStreaming);
    if (isStreaming) {
      const input = popup.querySelector('.doc-ask-inline-input');
      const sendBtn = popup.querySelector('.doc-ask-inline-send');
      if (input) input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
    }
  }
}

function _updateContextBar(popup) {
  // Removed — context bar no longer shown
}

function _renderLatexInElement(element) {
  // Process LaTeX in text nodes, handling both inline ($...$) and display ($$...$$) math
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  const nodesToProcess = [];
  let node;
  while (node = walker.nextNode()) {
    // Skip if parent is code, pre, or already processed
    if (node.parentElement && !node.parentElement.closest('code, pre, .katex')) {
      nodesToProcess.push(node);
    }
  }

  nodesToProcess.forEach(textNode => {
    const text = textNode.textContent;
    // Match both display ($$...$$) and inline ($...$) LaTeX
    const regex = /(\$\$[^$]+?\$\$|\$[^$]+?\$)/g;
    const matches = text.match(regex);
    if (!matches) return;

    const parts = text.split(regex);
    const fragment = document.createDocumentFragment();

    parts.forEach(part => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        // Display math
        const math = part.slice(2, -2);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: true, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) {
          fragment.appendChild(document.createTextNode(part));
        }
      } else if (part.startsWith('$') && part.endsWith('$')) {
        // Inline math
        const math = part.slice(1, -1);
        const span = document.createElement('span');
        try {
          katex.render(math, span, { displayMode: false, throwOnError: false });
          fragment.appendChild(span);
        } catch (e) {
          fragment.appendChild(document.createTextNode(part));
        }
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

function _renderPopupChat(popup, final) {
  const container = popup.querySelector('.doc-popup-chat-messages');
  if (!container) return;
  container.innerHTML = _popupChatMessages.map((m, i) => {
    if (m.role === 'user') {
      const display = m._display || m.content;
      let imgsHtml = '';
      if (m.images && m.images.length) {
        imgsHtml = '<div class="doc-msg-images">' + m.images.map(b64 =>
          `<img src="data:image/png;base64,${b64}" />`
        ).join('') + '</div>';
      }
      const searchIcon = m._isSearch ? '<span class="doc-search-badge">search</span>' : '';
      const paperIcon = m._isPaperSearch ? '<span class="doc-search-badge doc-paper-badge">papers</span>' : '';
      const userIcon = m._isUserSearch ? '<span class="doc-search-badge doc-user-badge">users</span>' : '';
      const noteIcon = m._isNoteSearch ? '<span class="doc-search-badge doc-note-badge">notes</span>' : '';
      const editBtn = `<button class="doc-msg-edit-btn" data-msg-idx="${i}" title="Edit and resend">${icon('edit', { size: 11 })}</button>`;
      return `<div class="doc-msg-user" data-msg-idx="${i}">${imgsHtml}${searchIcon}${paperIcon}${userIcon}${noteIcon}<span class="doc-msg-user-text">${escapeHtml(display)}</span>${editBtn}</div>`;
    }
    if (m._thinking) {
      const label = m._thinkingLabel ? `<span class="doc-thinking-label">${escapeHtml(m._thinkingLabel)}</span>` : '';
      const preview = m._thinkingText ? `<div class="doc-thinking-preview">${escapeHtml(m._thinkingText.length > 200 ? '…' + m._thinkingText.slice(-200) : m._thinkingText)}</div>` : '';
      const ctxBlock = m._ctxSources && m._ctxSources.length
        ? `<details class="doc-ctx-details"><summary class="doc-msg-context-sources">${m._ctxSources.map(s => '<span class="doc-ctx-pill">' + escapeHtml(s) + '</span>').join('')}</summary><pre class="doc-ctx-raw">${escapeHtml((m._ctxRaw || '').slice(0, 4000))}${(m._ctxRaw || '').length > 4000 ? '\n…truncated' : ''}</pre></details>`
        : '';
      return `<div class="doc-msg-ai">${ctxBlock}<span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>${label}${preview}</div>`;
    }
    // Search results
    if (m._searchResults && m._searchResults.length) {
      const resultsHtml = m._searchResults.map(r =>
        `<div class="doc-search-result" data-href="${escapeAttr(r.url)}">` +
        `<div class="doc-search-result-title">${escapeHtml(r.title)}</div>` +
        (r.snippet ? `<div class="doc-search-result-snippet">${escapeHtml(r.snippet)}</div>` : '') +
        `<div class="doc-search-result-url">${escapeHtml(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url)}</div>` +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // Paper search results
    if (m._paperResults && m._paperResults.length) {
      const resultsHtml = m._paperResults.map(r =>
        `<div class="doc-paper-result" data-href="${escapeAttr(r.link)}">` +
        `<div class="doc-paper-result-title">${escapeHtml(r.title)}</div>` +
        `<div class="doc-paper-result-meta">${escapeHtml(r.authors)}${r.year ? ' · ' + r.year : ''}</div>` +
        (r.summary ? `<div class="doc-paper-result-summary">${escapeHtml(r.summary.length > 150 ? r.summary.slice(0, 147) + '...' : r.summary)}</div>` : '') +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // User search results
    if (m._userResults && m._userResults.length) {
      const resultsHtml = m._userResults.map(u =>
        `<div class="doc-user-result" data-username="${escapeAttr(u.username)}">` +
        (u.picture ? `<img class="doc-user-result-avatar" src="${escapeAttr(u.picture)}" />` :
          `<div class="doc-user-result-avatar doc-user-result-avatar-fallback">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>`) +
        `<span class="doc-user-result-name">${escapeHtml(u.username)}</span>` +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    // Note search results
    if (m._noteResults && m._noteResults.length) {
      const resultsHtml = m._noteResults.map(n => {
        const preview = (n.content || '').replace(/[#*_`>\-\[\]()]/g, '').replace(/\s+/g, ' ').trim();
        const snippet = preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
        const tags = (n.tags || []).slice(0, 3);
        return `<div class="doc-note-result" data-note-id="${escapeAttr(n.id)}">` +
          `<div class="doc-note-result-title">${escapeHtml(n.title || 'Untitled')}</div>` +
          (tags.length ? `<div class="doc-note-result-tags">${tags.map(t => '<span class="doc-note-result-tag">' + escapeHtml(t) + '</span>').join('')}</div>` : '') +
          (snippet ? `<div class="doc-note-result-snippet">${escapeHtml(snippet)}</div>` : '') +
          `</div>`;
      }).join('');
      return `<div class="doc-msg-ai doc-msg-search-results">${resultsHtml}</div>`;
    }
    const isLast = i === _popupChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    const thinkingBlock = m._thinkingText ? `<details class="doc-thinking-block"><summary>Thought for a moment</summary><div class="doc-thinking-content">${escapeHtml(m._thinkingText)}</div></details>` : '';
    const ctxBlock = m._ctxSources && m._ctxSources.length
      ? `<details class="doc-ctx-details"><summary class="doc-msg-context-sources">${m._ctxSources.map(s => '<span class="doc-ctx-pill">' + escapeHtml(s) + '</span>').join('')}</summary><pre class="doc-ctx-raw">${escapeHtml((m._ctxRaw || '').slice(0, 4000))}${(m._ctxRaw || '').length > 4000 ? '\n…truncated' : ''}</pre></details>`
      : '';
    const copyBtn = `<button class="doc-msg-copy-btn" title="Copy message">${icon('copy', { size: 12 })}</button>`;
    const speakBtn = `<button class="doc-msg-speak-btn" title="Read aloud">${icon('speaker', { size: 12 })}</button>`;
    const redoBtn = isLast ? `<button class="doc-msg-redo-btn" title="Redo last message">${icon('redo', { size: 12 })}</button>` : '';
    return `<div class="doc-msg-ai">${ctxBlock}${thinkingBlock}${content}<div class="doc-msg-actions">${copyBtn}${speakBtn}${redoBtn}</div></div>`;
  }).join('');
  // Render LaTeX in AI messages
  if (typeof katex !== 'undefined') {
    container.querySelectorAll('.doc-msg-ai').forEach(msgEl => {
      _renderLatexInElement(msgEl);
    });
  }
  // Attach click handlers for search results
  container.querySelectorAll('.doc-search-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for paper results
  container.querySelectorAll('.doc-paper-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for user results
  container.querySelectorAll('.doc-user-result[data-username]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const username = el.getAttribute('data-username');
      window.location.hash = '#profile/' + encodeURIComponent(username);
      // Dismiss the aether panel
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) { _aetherTrackMode = false; popup.remove(); }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach click handlers for note results
  container.querySelectorAll('.doc-note-result[data-note-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) { _aetherTrackMode = false; popup.remove(); }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
  // Attach speak button handlers (Kokoro TTS)
  container.querySelectorAll('.doc-msg-speak-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (_ttsAudio || _ttsChunks.length > 0) {
        const wasToggling = btn.classList.contains('doc-msg-speaking');
        _ttsStopAll();
        container.querySelectorAll('.doc-msg-speak-btn').forEach(b => b.classList.remove('doc-msg-speaking'));
        if (wasToggling) return; // was toggling off
      }
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      btn.classList.add('doc-msg-speaking');
      _updateAudioUnified('tts', { label: 'Generating…', detail: 'Generating speech audio' });
      api('/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text })
      }).then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = parseFloat(localStorage.getItem('ttsSpeed')) || 1;
        _ttsAudio = audio;
        _updateAudioUnified('tts', { label: 'Speaking', detail: 'Playing speech audio' });
        _ttsStartWaveform(audio);
        audio.onended = () => { btn.classList.remove('doc-msg-speaking'); URL.revokeObjectURL(url); _ttsAudio = null; _ttsStopWaveform(); _clearAudioUnified('tts'); };
        audio.onerror = () => { btn.classList.remove('doc-msg-speaking'); URL.revokeObjectURL(url); _ttsAudio = null; _ttsStopWaveform(); _clearAudioUnified('tts'); };
        audio.play();
      }).catch(() => { btn.classList.remove('doc-msg-speaking'); _clearAudioUnified('tts'); });
    });
  });
  // Attach copy button handlers
  container.querySelectorAll('.doc-msg-copy-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const msgEl = btn.closest('.doc-msg-ai');
      if (!msgEl) return;
      const text = msgEl.textContent.replace(/Copy message|Read aloud|Redo last message/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = icon('check', { size: 12 });
        setTimeout(() => {
          btn.innerHTML = icon('copy', { size: 12 });
        }, 1000);
      }).catch(() => {});
    });
  });
  // Attach redo button handlers
  container.querySelectorAll('.doc-msg-redo-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      // Find last user message
      let lastUserIdx = -1;
      for (let i = _popupChatMessages.length - 1; i >= 0; i--) {
        if (_popupChatMessages[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx < 0) return;
      // Remove the last user message and everything after it
      const lastUserMsg = _popupChatMessages[lastUserIdx];
      _popupChatMessages = _popupChatMessages.slice(0, lastUserIdx);
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      // Re-insert user message and re-send
      const input = popup.querySelector('.doc-ask-inline-input');
      if (input) input.value = lastUserMsg._display || lastUserMsg.content;
      _sendPopupChatMessage(popup, popup._capturedText || '');
    });
  });
  // Attach edit button handlers
  container.querySelectorAll('.doc-msg-edit-btn').forEach(btn => {
    btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const msgIdx = parseInt(btn.getAttribute('data-msg-idx'));
      if (isNaN(msgIdx) || msgIdx < 0 || msgIdx >= _popupChatMessages.length) return;
      const msg = _popupChatMessages[msgIdx];
      if (msg.role !== 'user') return;

      // Put the message content back in the input
      const input = popup.querySelector('.doc-ask-inline-input');
      if (!input) return;
      input.value = msg.content;
      input.focus();

      // Remove all messages from this point forward
      _popupChatMessages.splice(msgIdx);
      _renderPopupChat(popup, true);
    });
  });
  // Update send/stop button state
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) {
    if (_popupChatAbort && !final) {
      sendBtn.innerHTML = icon('stopCircle', { size: 14 });
      sendBtn.title = 'Stop';
      sendBtn.disabled = false;
      sendBtn.classList.add('doc-ask-inline-stop');
    } else {
      sendBtn.innerHTML = '↑';
      sendBtn.title = 'Send';
      sendBtn.classList.remove('doc-ask-inline-stop');
    }
  }

  // Scroll: for search results, scroll to the search query; otherwise scroll to bottom
  const lastMsg = _popupChatMessages[_popupChatMessages.length - 1];
  if (lastMsg && ((lastMsg._searchResults && lastMsg._searchResults.length) || (lastMsg._paperResults && lastMsg._paperResults.length) || (lastMsg._userResults && lastMsg._userResults.length) || (lastMsg._noteResults && lastMsg._noteResults.length))) {
    const msgs = container.querySelectorAll('.doc-msg-user, .doc-msg-ai');
    const searchUserMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    if (searchUserMsg) searchUserMsg.scrollIntoView({ block: 'start' });
    else container.scrollTop = 0;
  } else {
    container.scrollTop = container.scrollHeight;
  }
  _updateContextBar(popup);
  _updateChatStats(popup, final);
  // Show/hide redo + copy buttons
  const hasAiMsg = _popupChatMessages.some(m => m.role === 'assistant' && !m._thinking && m.content);
  if (popup._redoBtn) popup._redoBtn.style.display = hasAiMsg ? '' : 'none';
  if (popup._copyChatBtn) popup._copyChatBtn.style.display = hasAiMsg ? '' : 'none';
}

// Merged into main _modelContextSizes at top of file

function _updateContextUsage(popup) {
  // Removed — context usage no longer shown
}

function _updateChatStats(popup, final) {
  const statsEl = popup.querySelector('.doc-chat-stats');
  if (!statsEl) return;
  _updateContextUsage(popup);
  if (_popupChatMessages.length === 0) { statsEl.textContent = ''; return; }
  const lastAi = [..._popupChatMessages].reverse().find(m => m.role === 'assistant' && !m._thinking);
  if (!lastAi) { statsEl.textContent = ''; return; }
  const parts = [];
  // Token count: use actual usage if available, else estimate from streamed text
  if (lastAi._usage) {
    const u = lastAi._usage;
    const total = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    if (total) parts.push(total >= 1000 ? (total / 1000).toFixed(1) + 'k tokens' : total + ' tokens');
  } else if (lastAi.content) {
    const est = Math.round(lastAi.content.length / 4);
    if (est > 0) parts.push('~' + (est >= 1000 ? (est / 1000).toFixed(1) + 'k' : est) + ' tokens');
  }
  // Timing: use server duration if final, else live elapsed
  if (lastAi._usage && lastAi._usage.duration_ms) {
    const ms = lastAi._usage.duration_ms;
    parts.push(ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
  } else if (_chatStreamStart) {
    const elapsed = Date.now() - _chatStreamStart;
    parts.push(elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms');
  }
  // Model name
  if (lastAi._usage && lastAi._usage.model) parts.push(lastAi._usage.model);
  statsEl.textContent = parts.join(' \u00B7 ');
}

function _savePopupChatToHighlight(popup) {
  _popupChatMessages = [];
}

// Position a popup so one of its four corners is at (cx, cy), picking the best
// corner that keeps it within bounds. preferLeft = bottom-right corner at cursor.

function _screenshotRestoreIframes() {
  document.querySelectorAll('iframe, webview').forEach(f => {
    if ('peTrack' in f.dataset) {
      f.style.pointerEvents = f.dataset.peTrack;
      delete f.dataset.peTrack;
    }
  });
}


async function _browserCaptureRect(rect) {
  const { x, y, width, height } = rect;
  const cx = x + width / 2, cy = y + height / 2;
  const el = document.elementFromPoint(cx, cy);
  try {
    // If the center point is over a canvas (PDF page), crop directly
    const canvas = el?.closest('canvas') || (el?.tagName === 'CANVAS' ? el : null);
    if (canvas) {
      const cr = canvas.getBoundingClientRect();
      const scaleX = canvas.width / cr.width, scaleY = canvas.height / cr.height;
      const sx = (x - cr.left) * scaleX, sy = (y - cr.top) * scaleY;
      const sw = width * scaleX, sh = height * scaleY;
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(sw); tmp.height = Math.round(sh);
      tmp.getContext('2d').drawImage(canvas, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/png').split(',')[1];
    }
    // If over an iframe, try to capture its content document
    const iframe = el?.closest('iframe') || (el?.tagName === 'IFRAME' ? el : null);
    if (iframe && iframe.contentDocument) {
      const ir = iframe.getBoundingClientRect();
      const full = await html2canvas(iframe.contentDocument.body, { useCORS: true, scale: window.devicePixelRatio || 1 });
      const scaleX = full.width / ir.width, scaleY = full.height / ir.height;
      const sx = (x - ir.left) * scaleX, sy = (y - ir.top) * scaleY;
      const sw = width * scaleX, sh = height * scaleY;
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(sw); tmp.height = Math.round(sh);
      tmp.getContext('2d').drawImage(full, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
      return tmp.toDataURL('image/png').split(',')[1];
    }
    // Fallback: capture body and crop
    const full = await html2canvas(document.body, { useCORS: true, scale: window.devicePixelRatio || 1 });
    const scaleX = full.width / window.innerWidth, scaleY = full.height / window.innerHeight;
    const sx = x * scaleX, sy = y * scaleY;
    const sw = width * scaleX, sh = height * scaleY;
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(sw); tmp.height = Math.round(sh);
    tmp.getContext('2d').drawImage(full, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), 0, 0, tmp.width, tmp.height);
    return tmp.toDataURL('image/png').split(',')[1];
  } catch (err) {
    console.error('Browser screenshot capture failed:', err);
    return null;
  }
}


function _addNoteContextToPanel(popup, note) {
  // Don't add duplicate
  if (_pendingNoteContexts.some(n => n.id === note.id)) return;
  _pendingNoteContexts.push({ id: note.id, title: note.title, content: note.content || '' });

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const chip = document.createElement('div');
  chip.className = 'doc-note-context-chip';
  chip.dataset.noteId = note.id;
  chip.innerHTML = icon('documentText', { size: 12, class: 'w-3 h-3 flex-shrink-0' }) +
    `<span class="truncate">${escapeHtml(note.title || 'Untitled')}</span>`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-note-context-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _pendingNoteContexts = _pendingNoteContexts.filter(n => n.id !== note.id);
    chip.remove();
    if (_pendingNoteContexts.length === 0 && _pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  chip.appendChild(removeBtn);
  strip.appendChild(chip);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

function _addTabContextToPanel(popup, tabInfo) {
  if (_pendingTabContexts.some(t => t.tabId === tabInfo.tabId)) return;
  _pendingTabContexts.push({ tabId: tabInfo.tabId, title: tabInfo.title, url: tabInfo.url, content: tabInfo.content || '' });

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const chip = document.createElement('div');
  chip.className = 'doc-tab-context-chip';
  chip.dataset.tabId = tabInfo.tabId;
  const domain = (() => { try { return new URL(tabInfo.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const favUrl = tabInfo.url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16` : '';
  chip.innerHTML = (favUrl ? `<img src="${favUrl}" class="w-3 h-3 flex-shrink-0 rounded-sm" onerror="this.style.display='none'">` :
    icon('browserTab', { size: 12, class: 'w-3 h-3 flex-shrink-0' })) +
    `<span class="truncate">${escapeHtml(tabInfo.title || domain || 'Tab')}</span>`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-note-context-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _pendingTabContexts = _pendingTabContexts.filter(t => t.tabId !== tabInfo.tabId);
    chip.remove();
    if (_pendingTabContexts.length === 0 && _pendingNoteContexts.length === 0 && _pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  chip.appendChild(removeBtn);
  strip.appendChild(chip);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

function _showTabContextMenu(e, tabEl) {
  const tid = tabEl.dataset.tabId || (() => { const m = (tabEl.getAttribute('onclick') || '').match(/browseSelectTab\((\d+)\)/); return m ? m[1] : null; })();
  if (!tid) return;
  const tabId = parseInt(tid);
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const isActive = win.activeTab === tabId;
  const domain = (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const items = [];
  const isPinned = !!tab.pinned;
  const inGroup = tab.groupId != null;
  const groups = win.groups || [];

  // Header: title (+ domain for background tabs)
  const headerLabel = (tab.title || 'Tab') + (!isActive && domain ? ' · ' + domain : '');
  const memMB = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : '';
  items.push({ label: headerLabel, info: true, subtext: memMB, fn() {} });

  items.push({ sep: true });

  // Add to assistant
  items.push({
    label: 'Add to assistant',
    icon: icon('chatContext', { size: 14, class: 'w-3.5 h-3.5 inline', strokeWidth: '1.5' }),
    fn() {
      (async () => {
        try {
          const data = await apiPost('/api/extract-text', { url: tab.url });
          const content = data.text || '';
          let aetherPanel = document.getElementById('doc-chat-ask-float');
          if (!aetherPanel && typeof _showPanel === 'function') {
            _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
            aetherPanel = document.getElementById('doc-chat-ask-float');
          }
          if (aetherPanel && typeof _addTabContextToPanel === 'function') {
            _addTabContextToPanel(aetherPanel, { tabId: tab.id, title: tab.title, url: tab.url, content });
          }
        } catch (err) {
          console.warn('Failed to extract tab context:', err);
        }
      })();
    }
  });

  items.push({ sep: true });

  // Pin / Unpin
  items.push({ label: isPinned ? 'Unpin tab' : 'Pin tab', fn() { browseTogglePin(tabId); } });

  // Group management
  if (!isPinned) {
    items.push({ label: 'Add to new group', fn() { browseAddTabToNewGroup(tabId); } });
    for (const g of groups) {
      if (g.id === tab.groupId) continue;
      const gc = typeof _BROWSE_GROUP_COLOR_MAP !== 'undefined' ? (_BROWSE_GROUP_COLOR_MAP[g.color] || g.color) : g.color;
      items.push({ label: g.name, colorDot: gc, fn() { browseAddTabToGroup(tabId, g.id); } });
    }
    if (inGroup) {
      items.push({ label: 'Remove from group', fn() { browseRemoveTabFromGroup(tabId); } });
    }
  }

  // Split tab
  items.push({ label: 'Split tab', fn() { browseSplitTab(tabId, 'right'); } });

  // Reload
  items.push({ label: 'Reload tab', fn() { browseSelectTab(tabId); browseReload(); } });

  // Duplicate Tab
  items.push({ label: 'Duplicate tab', fn() { browseNewTab(tab.url); } });

  // Mute/Unmute (only if tab has audio)
  if (_browseAudioTabs.has(tabId)) {
    const audioInfo = _browseAudioTabs.get(tabId);
    const isMuted = audioInfo && audioInfo.muted;
    items.push({ label: isMuted ? 'Unmute tab' : 'Mute tab', fn() { toggleTabMute(tabId); } });
  }

  items.push({ sep: true });

  // Close Tab
  items.push({ label: 'Close tab', fn() { browseCloseTab(tabId); } });

  // Close other tabs
  items.push({ label: 'Close other tabs', fn() { _browseCloseOtherTabs(tabId); } });

  // Position below the tab, merging seamlessly
  _showPanel({ anchor: { tab: tabEl }, contextMenu: { items } });
}

function _addScreenshotToPanel(popup, base64) {
  _pendingScreenshots.push(base64);

  const strip = popup.querySelector('.doc-screenshot-attachments');
  if (!strip) return;
  strip.style.display = 'flex';

  const thumb = document.createElement('div');
  thumb.className = 'doc-screenshot-thumb';
  const img = document.createElement('img');
  img.src = 'data:image/png;base64,' + base64;
  thumb.appendChild(img);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'doc-screenshot-thumb-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  removeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const idx = _pendingScreenshots.indexOf(base64);
    if (idx !== -1) _pendingScreenshots.splice(idx, 1);
    thumb.remove();
    if (_pendingScreenshots.length === 0) strip.style.display = 'none';
  });
  thumb.appendChild(removeBtn);
  strip.appendChild(thumb);

  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
  _updateContextBar(popup);
}

// Web search from aether panel (Shift+Enter)
