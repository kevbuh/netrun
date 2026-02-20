// chat-engine.js — Shared chat engine backed by SQLite threads
// Both panel-chat.js and chat-view.js use this for session management,
// message sending via agentStart, and DB persistence.
import Settings from '/js/core/core-settings.js';

// ── Active sessions (keyed by threadId) ──
const _sessions = new Map();

// ── Session factory ──

async function createSession(opts) {
  opts = opts || {};
  const thread = await electronAPI.dbQuery('chat-thread-create', opts.title || 'New Chat', opts.model || '');
  if (!thread?.id) return null;
  const session = _makeSession(thread, []);
  _sessions.set(thread.id, session);
  return session;
}

function _hydrateMessage(m) {
  const msg = { id: m.id, role: m.role, content: m.content, created_at: m.created_at, parent_id: m.parent_id || null };
  if (m.metadata && m.metadata !== '{}') {
    try {
      const meta = JSON.parse(m.metadata);
      if (meta._systemPrompt) msg._systemPrompt = meta._systemPrompt;
      if (meta._thinkingText) msg._thinkingText = meta._thinkingText;
      if (meta._toolsCalled) msg._toolsCalled = meta._toolsCalled;
      if (meta._ctxSources) msg._ctxSources = meta._ctxSources;
      if (meta._usage) msg._usage = meta._usage;
      if (meta._searchResults) msg._searchResults = meta._searchResults;
      if (meta._paperResults) msg._paperResults = meta._paperResults;
      if (meta._userResults) msg._userResults = meta._userResults;
      if (meta._webSources) msg._webSources = meta._webSources;
      if (meta._followUps) msg._followUps = meta._followUps;
      if (meta.images) msg.images = meta.images;
      if (meta._display) msg._display = meta._display;
      if (meta._activity) msg._activity = meta._activity;
      if (meta._timings) msg._timings = meta._timings;
    } catch { /* ignore bad metadata */ }
  }
  return msg;
}

async function loadSession(threadId) {
  const thread = await electronAPI.dbQuery('chat-thread-get', threadId);
  if (!thread) return null;

  // Migrate old linear threads to have parent_id chain
  await electronAPI.dbQuery('chat-message-migrate-parents', threadId);

  // Load full tree from DB
  const allDbMessages = await electronAPI.dbQuery('chat-message-tree', threadId);
  const allMessages = (allDbMessages || []).map(_hydrateMessage);

  // Determine active leaf from thread metadata or find the latest leaf
  let activeLeafId = null;
  try {
    const meta = JSON.parse(thread.metadata || '{}');
    if (meta.activeLeafId) activeLeafId = meta.activeLeafId;
  } catch { /* ignore */ }

  if (!activeLeafId && allMessages.length) {
    // Find leaves (messages that aren't anyone's parent)
    const parentIds = new Set(allMessages.map(m => m.parent_id).filter(Boolean));
    const allIds = new Set(allMessages.map(m => m.id));
    const leaves = allMessages.filter(m => {
      // A leaf has no children
      return !allMessages.some(c => c.parent_id === m.id);
    });
    // Pick the most recent leaf
    if (leaves.length) activeLeafId = leaves[leaves.length - 1].id;
    else activeLeafId = allMessages[allMessages.length - 1].id;
  }

  // Build the active path from root to leaf
  let activePath = [];
  if (activeLeafId) {
    const pathMsgs = await electronAPI.dbQuery('chat-message-path', activeLeafId);
    activePath = (pathMsgs || []).map(_hydrateMessage);
  }

  const session = _makeSession(thread, activePath, allMessages);
  _sessions.set(threadId, session);
  return session;
}

function getSession(threadId) {
  return _sessions.get(threadId) || null;
}

function _makeSession(thread, messages, allMessages) {
  let _updateListeners = [];
  let _abortController = null;
  let _streaming = false;
  let _streamStart = 0;
  let _memoryRetrieved = false;
  const _allMessages = allMessages || messages.slice(); // full tree
  let _activeLeafId = messages.length ? messages[messages.length - 1].id : null;

  const session = {
    threadId: thread.id,
    thread,
    messages,       // current active path
    allMessages: _allMessages,

    get streaming() { return _streaming; },
    get streamStart() { return _streamStart; },
    get abortController() { return _abortController; },
    get activeLeafId() { return _activeLeafId; },

    onUpdate(fn) {
      _updateListeners.push(fn);
      return () => { _updateListeners = _updateListeners.filter(f => f !== fn); };
    },

    _notify(type) {
      for (const fn of _updateListeners) {
        try { fn(type, session); } catch(e) { console.warn('[chat-engine] listener error:', e); }
      }
    },

    cancel() {
      if (_abortController) {
        _abortController.abort();
        _abortController = null;
      }
      if (_streaming) {
        const sessionId = 'chat-' + thread.id + '-' + Date.now();
        if (window.electronAPI?.agentCancel) electronAPI.agentCancel(sessionId);
        _streaming = false;
        session._notify('cancel');
      }
    },

    async send(text, opts) {
      if (_streaming) return;
      opts = opts || {};

      // Build user message
      const capturedText = opts.capturedText || '';
      const userContent = messages.length === 0 && capturedText
        ? (text || 'What is this?') + '\n\n> ' + capturedText
        : (text || 'What is this?');

      const userMsg = { role: 'user', content: userContent, _display: text || 'What is this?' };
      if (opts.images?.length) userMsg.images = opts.images;

      // Save user message to DB with parent_id pointing to last message in current path
      const parentId = messages.length ? messages[messages.length - 1].id : null;
      const savedUser = await electronAPI.dbQuery('chat-message-add', thread.id, 'user', userContent,
        JSON.stringify({ _display: userMsg._display, images: userMsg.images }), parentId);
      userMsg.id = savedUser?.id;
      userMsg.parent_id = parentId;
      messages.push(userMsg);
      _allMessages.push(userMsg);

      // Create assistant placeholder
      const aiMsg = { role: 'assistant', content: '', _thinking: true, _activity: [], _firstTokenAt: null };
      messages.push(aiMsg);
      session._notify('message');

      // Auto-title on first user message
      if (messages.filter(m => m.role === 'user').length === 1) {
        const title = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        await electronAPI.dbQuery('chat-thread-update', thread.id, { title });
        thread.title = title;
      }

      _streaming = true;
      _abortController = new AbortController();
      _streamStart = Date.now();

      const hasVision = messages.some(m => m.images?.length > 0);
      const filteredMsgs = messages.filter(m => !m._thinking && m.content).map(m => {
        const msg = { role: m.role, content: m.content };
        if (m.images?.length) msg.images = m.images;
        return msg;
      });

      const body = { messages: filteredMsgs };
      const chatModel = Settings.get('chatModel');
      if (chatModel) body.model = chatModel;
      const toolsOn = Settings.get('chatTools') !== 'off';

      // Context sources for transparency
      const _ctxSources = [];

      if (hasVision) {
        _ctxSources.push({ label: 'vision' });
        body.vision = true;
        const vm = Settings.get('visionModel');
        if (vm) body.model = vm;
      } else {
        if (toolsOn) body.tools = true;
        body.think = Settings.get('chatThinking') === 'on';

        // Build context
        let ctx = opts.documentText || '';
        if (ctx) _ctxSources.push({ label: 'doc', content: ctx });

        if (opts.tabContexts?.length) {
          const tabCtx = opts.tabContexts.map(t =>
            `--- Tab: ${t.title} (${t.url}) ---\n${t.content}`
          ).join('\n\n');
          _ctxSources.push({ label: opts.tabContexts.length + ' tab' + (opts.tabContexts.length > 1 ? 's' : ''), content: tabCtx });
          ctx = ctx ? ctx + '\n\n' + tabCtx : tabCtx;
        }

        if (opts.fileContexts?.length) {
          const fileCtx = opts.fileContexts.map(f =>
            `--- File: ${f.name} ---\n${f.content}`
          ).join('\n\n');
          _ctxSources.push({ label: opts.fileContexts.length + ' file' + (opts.fileContexts.length > 1 ? 's' : ''), content: fileCtx });
          ctx = ctx ? ctx + '\n\n' + fileCtx : fileCtx;
        }

        // Memory retrieval on first exchange
        if (!_memoryRetrieved && messages.filter(m => m.role === 'user').length <= 1) {
          _memoryRetrieved = true;
          try {
            const firstUser = messages.find(m => m.role === 'user');
            if (firstUser && typeof apiGet === 'function') {
              const memData = await apiGet('/api/chat-memories?query=' + encodeURIComponent(firstUser.content));
              if (memData?.memories?.length) {
                const memCtx = memData.memories.map((m, i) => `${i + 1}. ${m.summary}` + (m.page_title ? ` (from: ${m.page_title})` : '')).join('\n');
                _ctxSources.push({ label: memData.memories.length + ' memor' + (memData.memories.length > 1 ? 'ies' : 'y'), content: memCtx });
                ctx = ctx ? ctx + '\n\n' + memCtx : memCtx;
              }
            }
          } catch { /* best-effort */ }
        }

        // DOM tree injection for agent tools
        if (toolsOn && opts.domTree) {
          _ctxSources.push({ label: 'page DOM (' + (opts.domTree.elementCount || '?') + ')', content: opts.domTree.elements });
          const domCtx = `\n\n--- BROWSER TAB DOM (${opts.domTree.title}) [${opts.domTree.url}] ---\n${opts.domTree.elements}\n--- END DOM ---`;
          ctx = ctx ? ctx + domCtx : domCtx;
        }

        if (toolsOn) _ctxSources.push({ label: 'tools', content: null });
        body.context = ctx;
      }

      // Store context sources on AI message
      const aiIdx = messages.length - 1;
      if (_ctxSources.length) messages[aiIdx]._ctxSources = _ctxSources;

      // Include page info for tool context
      if (toolsOn) {
        if (opts.pageUrl) body.pageUrl = opts.pageUrl;
        if (opts.pageTitle) body.pageTitle = opts.pageTitle;
      }

      const _aiModelName = hasVision ? (Settings.get('visionModel') || chatModel || 'default') : (chatModel || 'default');
      if (typeof islandUpdate === 'function') {
        islandUpdate('aether', { type: 'ai', label: _aiModelName, detail: 'Chatting \u00B7 ' + _aiModelName });
      }

      // ── Stream via IPC Agent ──
      if (window.electronAPI?.coreAvailable) {
        let aiText = '';
        let _inThinkTag = false;
        const agentSessionId = 'chat-' + thread.id + '-' + Date.now();
        messages[aiIdx]._thinking = false;

        const toolLabels = { 'web-search': 'Searching web', 'web-research': 'Researching web', 'paper-search': 'Searching papers', 'extract-text': 'Fetching page', 'save-to-reading-list': 'Bookmarking', navigate: 'Navigating', 'create-calendar-event': 'Adding to calendar', 'open-tab': 'Opening tab', 'browser-read-page': 'Reading page', 'browser-click': 'Clicking', 'browser-type': 'Typing', 'browser-scroll': 'Scrolling', 'browser-navigate': 'Navigating', 'browser-screenshot': 'Taking screenshot', 'browser-query-selector': 'Querying page', 'browser-wait-for': 'Waiting for element', 'browser-get-url': 'Getting URL', 'browser-get-tabs': 'Listing tabs', 'browser-switch-tab': 'Switching tab', 'browser-back': 'Going back', 'browser-forward': 'Going forward', 'browser-press-key': 'Pressing key', 'browser-get-storage': 'Reading storage' };
        const toolCategories = { 'web-search': 'search', 'web-research': 'search', 'paper-search': 'search', 'extract-text': 'extract', 'browser-read-page': 'extract' };

        const _handleEvent = (agentEvent) => {
          if (!messages[aiIdx]) return;

          if (agentEvent.type === 'thinking') {
            if (!messages[aiIdx]._thinkingText) messages[aiIdx]._thinkingText = '';
            messages[aiIdx]._thinkingText += (agentEvent.content || agentEvent.text || agentEvent.token || '');
            messages[aiIdx]._thinking = true;
            messages[aiIdx]._thinkingLabel = 'Thinking\u2026';
            // Add thinking activity entry (only once)
            const act = messages[aiIdx]._activity;
            if (!act.find(a => a.type === 'thinking')) {
              act.push({ type: 'thinking', label: 'Thinking', detail: '', startedAt: Date.now(), endedAt: null });
            }
            session._notify('stream');
          } else if (agentEvent.type === 'token') {
            const token = agentEvent.content || agentEvent.text || agentEvent.token || '';
            let _visibleToken = token;
            // Track first token timing + add generating activity
            if (!messages[aiIdx]._firstTokenAt) {
              messages[aiIdx]._firstTokenAt = Date.now();
              // Close thinking activity if open
              const act = messages[aiIdx]._activity;
              const thinkEntry = act.find(a => a.type === 'thinking' && !a.endedAt);
              if (thinkEntry) thinkEntry.endedAt = Date.now();
              act.push({ type: 'inference', label: 'Generating response', detail: '', startedAt: Date.now(), endedAt: null });
            }
            if (_inThinkTag) {
              const endIdx = _visibleToken.indexOf('</think>');
              if (endIdx !== -1) {
                if (!messages[aiIdx]._thinkingText) messages[aiIdx]._thinkingText = '';
                messages[aiIdx]._thinkingText += _visibleToken.slice(0, endIdx);
                _visibleToken = _visibleToken.slice(endIdx + 8);
                _inThinkTag = false;
              } else {
                if (!messages[aiIdx]._thinkingText) messages[aiIdx]._thinkingText = '';
                messages[aiIdx]._thinkingText += _visibleToken;
                messages[aiIdx]._thinking = true;
                messages[aiIdx]._thinkingLabel = 'Thinking\u2026';
                session._notify('stream');
                return;
              }
            }
            if (!_inThinkTag && _visibleToken.includes('<think>')) {
              const startIdx = _visibleToken.indexOf('<think>');
              const before = _visibleToken.slice(0, startIdx);
              const after = _visibleToken.slice(startIdx + 7);
              _inThinkTag = true;
              const endIdx2 = after.indexOf('</think>');
              if (endIdx2 !== -1) {
                if (!messages[aiIdx]._thinkingText) messages[aiIdx]._thinkingText = '';
                messages[aiIdx]._thinkingText += after.slice(0, endIdx2);
                _visibleToken = before + after.slice(endIdx2 + 8);
                _inThinkTag = false;
              } else {
                if (!messages[aiIdx]._thinkingText) messages[aiIdx]._thinkingText = '';
                messages[aiIdx]._thinkingText += after;
                _visibleToken = before;
              }
            }
            if (_visibleToken) {
              messages[aiIdx]._thinking = false;
              aiText += _visibleToken;
              messages[aiIdx].content = aiText;
              session._notify('stream');
            }
          } else if (agentEvent.type === 'tool_result') {
            // Complete matching activity entry
            const act = messages[aiIdx]._activity;
            const toolName = agentEvent.name || agentEvent.toolName;
            const activeEntry = [...act].reverse().find(a => a.type === 'tool' && !a.endedAt && a.toolName === toolName);
            if (activeEntry) activeEntry.endedAt = Date.now();
            const confirmation = _formatToolResult(agentEvent);
            if (confirmation) {
              messages[aiIdx].content = confirmation;
              messages[aiIdx]._thinking = false;
              session._notify('stream');
            }
          } else if (agentEvent.type === 'tool_call') {
            if (!messages[aiIdx]._toolsCalled) messages[aiIdx]._toolsCalled = [];
            const tc = agentEvent;
            const _tcLabel = tc.name + (tc.args ? '(' + Object.values(tc.args).map(v => JSON.stringify(v)).join(', ') + ')' : '()');
            messages[aiIdx]._toolsCalled.push(_tcLabel);
            aiText = '';
            messages[aiIdx].content = '';
            messages[aiIdx]._thinking = true;
            messages[aiIdx]._thinkingLabel = toolLabels[tc.name] || 'Using tool\u2026';
            // Push activity entry for tool call
            const act = messages[aiIdx]._activity;
            // Close any open thinking entry
            const thinkEntry = act.find(a => a.type === 'thinking' && !a.endedAt);
            if (thinkEntry) thinkEntry.endedAt = Date.now();
            const toolDetail = tc.args?.query || tc.args?.url || tc.args?.text || '';
            act.push({ type: 'tool', label: toolLabels[tc.name] || tc.name, detail: typeof toolDetail === 'string' ? toolDetail : '', toolName: tc.name, category: toolCategories[tc.name] || 'other', startedAt: Date.now(), endedAt: null });
            session._notify('stream');
          } else if (agentEvent.type === 'web_sources') {
            // Accumulate deduplicated web sources for source cards
            if (!messages[aiIdx]._webSources) messages[aiIdx]._webSources = [];
            const existing = messages[aiIdx]._webSources;
            const seen = new Set(existing.map(s => s.url));
            for (const src of (agentEvent.results || [])) {
              if (!seen.has(src.url)) {
                seen.add(src.url);
                existing.push({ n: existing.length + 1, title: src.title, url: src.url, snippet: src.snippet });
              }
            }
            session._notify('stream');
          } else if (agentEvent.type === 'action') {
            if (typeof _handleAgentAction === 'function') {
              _handleAgentAction(agentEvent.action || agentEvent);
            }
          } else if (agentEvent.type === 'system_prompt') {
            messages[aiIdx]._systemPrompt = agentEvent.content;
          } else if (agentEvent.type === 'usage') {
            messages[aiIdx]._usage = agentEvent.usage || agentEvent;
          } else if (agentEvent.type === 'error') {
            messages[aiIdx].content = aiText || ('Error: ' + (agentEvent.error || 'Unknown error'));
            messages[aiIdx]._thinking = false;
            // Close all open activity entries
            for (const a of messages[aiIdx]._activity) {
              if (!a.endedAt) a.endedAt = Date.now();
            }
            session._notify('stream');
          }
        };

        const eventHandler = (_ipcEvent, evtSessionId, agentEvent) => {
          if (evtSessionId !== agentSessionId) return;
          _handleEvent(agentEvent);
        };
        window.electronAPI.onAgentEvent(eventHandler);

        const agentMessages = filteredMsgs.map(m => ({ role: m.role, content: m.content }));

        try {
          await window.electronAPI.agentStart({
            sessionId: agentSessionId,
            agentId: Settings.get('chatAgent') || 'research-assistant',
            messages: agentMessages,
            context: {
              googleId: typeof _getGoogleId === 'function' ? _getGoogleId() : '',
              pageUrl: body.pageUrl,
              pageTitle: body.pageTitle,
              documentText: body.context,
              model: body.model,
              tools: body.tools,
            },
          });

          await new Promise((resolve) => {
            const checkDone = (_ipcEvent, evtSessionId, agentEvent) => {
              if (evtSessionId !== agentSessionId) return;
              if (agentEvent.type === 'done' || agentEvent.type === 'error') {
                window.electronAPI.removeAgentEventListener(checkDone);
                resolve();
              }
            };
            window.electronAPI.onAgentEvent(checkDone);
            if (_abortController) {
              _abortController.signal.addEventListener('abort', () => {
                window.electronAPI.agentCancel(agentSessionId);
                resolve();
              });
            }
          });
        } finally {
          window.electronAPI.removeAgentEventListener(eventHandler);
        }

        messages[aiIdx]._thinking = false;
        if (aiText) messages[aiIdx].content = aiText;

        // Close all open activity entries and compute timings
        const now = Date.now();
        for (const a of messages[aiIdx]._activity) {
          if (!a.endedAt) a.endedAt = now;
        }
        const _timings = { total: now - _streamStart };
        const _act = messages[aiIdx]._activity;
        const toolEntries = _act.filter(a => a.type === 'tool');
        const searchTime = toolEntries.filter(a => a.category === 'search').reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
        const extractTime = toolEntries.filter(a => a.category === 'extract').reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
        const inferenceEntry = _act.find(a => a.type === 'inference');
        if (searchTime) _timings.search = searchTime;
        if (extractTime) _timings.extract = extractTime;
        if (inferenceEntry) _timings.inference = inferenceEntry.endedAt - inferenceEntry.startedAt;
        // Tools time = total tool execution
        const toolsTime = toolEntries.reduce((s, a) => s + (a.endedAt - a.startedAt), 0);
        if (toolsTime) _timings.tools = toolsTime;
        messages[aiIdx]._timings = _timings;

        // Parse FOLLOW_UP section from content
        const fuMatch = messages[aiIdx].content?.match(/\n---\nFOLLOW_UP:\n([\s\S]+)$/);
        if (fuMatch) {
          messages[aiIdx]._followUps = fuMatch[1].split('\n')
            .map(l => l.replace(/^-\s*/, '').trim())
            .filter(Boolean);
          messages[aiIdx].content = messages[aiIdx].content.slice(0, fuMatch.index).trimEnd();
        }
      } else {
        messages[aiIdx]._thinking = false;
        messages[aiIdx].content = 'Error: IPC not available';
      }

      _streaming = false;
      _abortController = null;

      // Save assistant message to DB
      const finalContent = messages[aiIdx].content || '';
      const metadata = {};
      if (messages[aiIdx]._systemPrompt) metadata._systemPrompt = messages[aiIdx]._systemPrompt;
      if (messages[aiIdx]._thinkingText) metadata._thinkingText = messages[aiIdx]._thinkingText;
      if (messages[aiIdx]._toolsCalled) metadata._toolsCalled = messages[aiIdx]._toolsCalled;
      if (messages[aiIdx]._ctxSources) metadata._ctxSources = messages[aiIdx]._ctxSources;
      if (messages[aiIdx]._usage) metadata._usage = messages[aiIdx]._usage;
      if (messages[aiIdx]._searchResults) metadata._searchResults = messages[aiIdx]._searchResults;
      if (messages[aiIdx]._paperResults) metadata._paperResults = messages[aiIdx]._paperResults;
      if (messages[aiIdx]._userResults) metadata._userResults = messages[aiIdx]._userResults;
      if (messages[aiIdx]._webSources) metadata._webSources = messages[aiIdx]._webSources;
      if (messages[aiIdx]._followUps) metadata._followUps = messages[aiIdx]._followUps;
      if (messages[aiIdx]._activity?.length) metadata._activity = messages[aiIdx]._activity;
      if (messages[aiIdx]._timings) metadata._timings = messages[aiIdx]._timings;

      // parent_id for assistant = the user message it responds to
      const aiParentId = messages[aiIdx - 1]?.id || null;
      const savedAi = await electronAPI.dbQuery('chat-message-add', thread.id, 'assistant', finalContent, JSON.stringify(metadata), aiParentId);
      messages[aiIdx].id = savedAi?.id;
      messages[aiIdx].parent_id = aiParentId;
      _allMessages.push(messages[aiIdx]);

      // Update active leaf
      _activeLeafId = savedAi?.id || _activeLeafId;
      _saveActiveLeaf();

      session._notify('done');
    },

    // Redo: branch from the message before the last user message, resend same text
    async redo() {
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx < 0) return;
      const lastUserMsg = messages[lastUserIdx];
      // Truncate the active path to the parent of that user message
      messages.splice(lastUserIdx);
      session._notify('message');
      return lastUserMsg._display || lastUserMsg.content;
    },

    // Edit: branch from the message before msgIdx, return the old text for editing
    async editFrom(msgIdx) {
      const msg = messages[msgIdx];
      if (!msg || msg.role !== 'user') return null;
      const text = msg.content;
      // Truncate the active path to just before this message
      messages.splice(msgIdx);
      session._notify('message');
      return text;
    },

    // Navigate to a specific message — rebuild path from root to that message
    async navigateTo(messageId) {
      const pathMsgs = await electronAPI.dbQuery('chat-message-path', messageId);
      if (!pathMsgs?.length) return;
      const hydrated = pathMsgs.map(_hydrateMessage);
      messages.length = 0;
      hydrated.forEach(m => messages.push(m));
      _activeLeafId = messages[messages.length - 1]?.id || null;
      _saveActiveLeaf();
      session._notify('message');
    },

    // Get the full tree structure for visualization
    getTree() {
      return _allMessages;
    },

    // Get siblings of a message (other children of same parent)
    getSiblings(messageId) {
      const msg = _allMessages.find(m => m.id === messageId);
      if (!msg) return [];
      return _allMessages.filter(m => m.parent_id === msg.parent_id && m.id !== messageId);
    },

    // Check if a message is a branch point (has multiple children)
    isBranchPoint(messageId) {
      return _allMessages.filter(m => m.parent_id === messageId).length > 1;
    },

    // Get children of a message
    getChildrenOf(messageId) {
      return _allMessages.filter(m => m.parent_id === messageId);
    },

    destroy() {
      session.cancel();
      _updateListeners = [];
      _sessions.delete(thread.id);
    },
  };

  function _saveActiveLeaf() {
    if (!_activeLeafId) return;
    try {
      const meta = JSON.parse(thread.metadata || '{}');
      meta.activeLeafId = _activeLeafId;
      thread.metadata = JSON.stringify(meta);
      electronAPI.dbQuery('chat-thread-update', thread.id, { metadata: thread.metadata });
    } catch { /* best effort */ }
  }

  return session;
}

// ── Tool result formatting (extracted from panel-chat.js) ──

function _formatToolResult(agentEvent) {
  const r = agentEvent.result;
  const data = (typeof r === 'object' && r !== null) ? r : {};
  switch (agentEvent.name) {
    case 'browser-scroll': return 'Scrolled.';
    case 'browser-click': return 'Clicked.';
    case 'browser-type': return 'Typed.';
    case 'browser-navigate': return 'Navigating\u2026';
    case 'browser-screenshot': return 'Took screenshot.';
    case 'browser-back': return data.url ? 'Back \u2192 ' + data.url : 'Went back.';
    case 'browser-forward': return data.url ? 'Forward \u2192 ' + data.url : 'Went forward.';
    case 'browser-get-url':
      return data.url ? '**' + (data.title || 'Untitled') + '**\n' + data.url : 'Got URL.';
    case 'browser-get-tabs':
      if (data.tabs?.length) {
        return data.tabs.map(t =>
          (t.active ? '\u2192 ' : '  ') + '**' + (t.title || 'Untitled') + '** (tab ' + t.id + ')\n  ' + (t.url || '')
        ).join('\n');
      }
      return 'No tabs open.';
    case 'browser-switch-tab':
      return data.url ? 'Switched \u2192 **' + (data.title || 'Tab') + '**\n' + data.url : 'Switched tab.';
    case 'browser-query-selector':
      if (data.elements) return 'Found ' + (data.count || '?') + ' element(s):\n```\n' + data.elements + '\n```';
      return data.error || 'No elements found.';
    case 'browser-wait-for':
      if (data.found) return 'Found: `<' + (data.tag || '?') + '>` ' + (data.text ? '"' + data.text.slice(0, 100) + '"' : '');
      return data.timeout ? 'Timed out waiting.' : 'Not found.';
    case 'browser-press-key': return 'Pressed key.';
    case 'browser-get-storage':
      if (data.entries?.length) {
        return '**' + (data.type || 'Storage') + '** (' + data.count + ' entries):\n```\n' +
          data.entries.map(e => e.key + '=' + e.value).join('\n') + '\n```';
      }
      return data.error || 'No entries found.';
    default: return null;
  }
}

// ── Public API ──

const ChatEngine = { createSession, loadSession, getSession };
window.ChatEngine = ChatEngine;
export default ChatEngine;
