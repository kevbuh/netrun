// chat-threads.js — Document chat, thread persistence, sidebar tabs

// ── Document Chat ──
let _docChatMessages = [];
let _docText = '';
let _docTextLoading = false;
let _docChatAbort = null;
let _docChatExpanded = false;
let _docChatPaperUrl = '';

// ── Chat Thread Persistence ──
let _chatSaveTimer = null;

function _getChatData(url) {
  try {
    const all = JSON.parse(localStorage.getItem('chatThreads') || '{}');
    return all[url] || null;
  } catch { return null; }
}

function _saveChatData(url, data) {
  clearTimeout(_chatSaveTimer);
  _chatSaveTimer = setTimeout(() => {
    try {
      const all = JSON.parse(localStorage.getItem('chatThreads') || '{}');
      all[url] = data;
      localStorage.setItem('chatThreads', JSON.stringify(all));
    } catch {}
  }, 500);
}

function _saveChatDataImmediate(url, data) {
  clearTimeout(_chatSaveTimer);
  try {
    const all = JSON.parse(localStorage.getItem('chatThreads') || '{}');
    all[url] = data;
    localStorage.setItem('chatThreads', JSON.stringify(all));
  } catch {}
}

function _ensureChatData(url) {
  let data = _getChatData(url);
  if (!data) {
    data = {
      threads: {
        root: { id: 'root', parentThreadId: null, branchAfterIndex: null, messages: [] }
      },
      activeThreadId: 'root'
    };
  }
  return data;
}

function _getThreadChain(data, threadId) {
  const thread = data.threads[threadId];
  if (!thread) return [];
  if (!thread.parentThreadId) return thread.messages.slice();
  const parentMsgs = _getThreadChain(data, thread.parentThreadId);
  const sliced = parentMsgs.slice(0, thread.branchAfterIndex + 1);
  return sliced.concat(thread.messages);
}

function _getActiveMessages(url) {
  const data = _getChatData(url);
  if (!data) return [];
  return _getThreadChain(data, data.activeThreadId);
}

function _appendToActiveThread(url, msg) {
  const data = _ensureChatData(url);
  const thread = data.threads[data.activeThreadId];
  if (!thread) return;
  thread.messages.push(msg);
  _saveChatData(url, data);
}

function _branchAtMessage(url, displayIndex) {
  const data = _ensureChatData(url);
  const activeId = data.activeThreadId;
  const newId = 't_' + Date.now();
  data.threads[newId] = {
    id: newId,
    parentThreadId: activeId,
    branchAfterIndex: displayIndex,
    messages: []
  };
  data.activeThreadId = newId;
  _saveChatDataImmediate(url, data);
  return newId;
}

function _switchThread(url, threadId) {
  const data = _ensureChatData(url);
  if (!data.threads[threadId]) return;
  data.activeThreadId = threadId;
  _saveChatDataImmediate(url, data);
  _docChatMessages = _getThreadChain(data, threadId);
  renderDocChatMessages(true);
  _renderThreadNav();
}

function _clearChatThreads(url) {
  try {
    const all = JSON.parse(localStorage.getItem('chatThreads') || '{}');
    delete all[url];
    localStorage.setItem('chatThreads', JSON.stringify(all));
  } catch {}
  _docChatMessages = [];
  renderDocChatMessages(true);
  _renderThreadNav();
}

function _getSiblingThreads(data, threadId) {
  const thread = data.threads[threadId];
  if (!thread || !thread.parentThreadId) return [];
  return Object.values(data.threads).filter(t =>
    t.parentThreadId === thread.parentThreadId &&
    t.branchAfterIndex === thread.branchAfterIndex
  );
}

function _buildThreadTree(data) {
  // Build tree: each node = { thread, children: [] }
  const nodes = {};
  for (const t of Object.values(data.threads)) {
    nodes[t.id] = { thread: t, children: [] };
  }
  const roots = [];
  for (const n of Object.values(nodes)) {
    const pid = n.thread.parentThreadId;
    if (pid && nodes[pid]) nodes[pid].children.push(n);
    else roots.push(n);
  }
  // Sort children by branch point, then creation time
  for (const n of Object.values(nodes)) {
    n.children.sort((a, b) => {
      const ai = a.thread.branchAfterIndex || 0;
      const bi = b.thread.branchAfterIndex || 0;
      if (ai !== bi) return ai - bi;
      return (a.thread.id > b.thread.id ? 1 : -1);
    });
  }
  return roots;
}

function _renderThreadNav() {
  const nav = document.getElementById('doc-chat-thread-nav');
  if (!nav) return;
  const url = _chatUrl();
  const data = _getChatData(url);
  if (!data || Object.keys(data.threads).length <= 1) {
    nav.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');
  const activeId = data.activeThreadId;
  const roots = _buildThreadTree(data);
  const escUrl = url.replace(/'/g, "\\'").replace(/\\/g, '\\\\');

  // Flatten tree into rows with column assignments for git-graph layout
  const rows = [];
  let nextCol = 0;
  function walk(node, col, depth) {
    const msgCount = node.thread.messages.length;
    const label = node.thread.id === 'root' ? 'main' : 'branch';
    const branchPt = node.thread.branchAfterIndex;
    rows.push({ id: node.thread.id, label, col, depth, msgCount, branchPt, children: node.children.map(c => c.thread.id) });
    // First child continues on same column, rest get new columns
    for (let i = 0; i < node.children.length; i++) {
      if (i === 0) {
        walk(node.children[i], col, depth + 1);
      } else {
        nextCol++;
        walk(node.children[i], nextCol, depth + 1);
      }
    }
  }
  for (const r of roots) { walk(r, nextCol, 0); nextCol++; }

  const maxCol = Math.max(...rows.map(r => r.col));
  const colW = 20;
  const rowH = 28;
  const svgW = (maxCol + 1) * colW + 80;
  const svgH = rows.length * rowH + 8;
  const nodeR = 4;

  // Build row lookup
  const rowById = {};
  rows.forEach((r, i) => { r.rowIdx = i; rowById[r.id] = r; });

  let svg = `<svg class="thread-tree-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;

  // Draw connections
  for (const row of rows) {
    const x1 = row.col * colW + colW / 2 + 4;
    const y1 = row.rowIdx * rowH + rowH / 2 + 4;
    for (const cid of row.children) {
      const child = rowById[cid];
      if (!child) continue;
      const x2 = child.col * colW + colW / 2 + 4;
      const y2 = child.rowIdx * rowH + rowH / 2 + 4;
      if (x1 === x2) {
        // Straight vertical line
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-dimmer)" stroke-width="1.5"/>`;
      } else {
        // Curved branch line
        const midY = y1 + (y2 - y1) * 0.4;
        svg += `<path d="M${x1},${y1} L${x1},${midY} Q${x1},${y2} ${x2},${y2}" fill="none" stroke="var(--text-dimmer)" stroke-width="1.5"/>`;
      }
    }
  }

  // Draw nodes and labels
  for (const row of rows) {
    const x = row.col * colW + colW / 2 + 4;
    const y = row.rowIdx * rowH + rowH / 2 + 4;
    const isActive = row.id === activeId;
    const fill = isActive ? 'var(--accent)' : 'var(--text-dim)';
    const r = isActive ? nodeR + 1 : nodeR;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" class="thread-node" data-id="${row.id}" style="cursor:pointer"/>`;
    // Label
    const labelX = (maxCol + 1) * colW + 10;
    const countStr = row.msgCount > 0 ? ` (${row.msgCount} msg${row.msgCount !== 1 ? 's' : ''})` : ' (empty)';
    const textFill = isActive ? 'var(--accent)' : 'var(--text-dim)';
    const fw = isActive ? 'bold' : 'normal';
    svg += `<text x="${labelX}" y="${y + 4}" fill="${textFill}" font-size="11" font-weight="${fw}" class="thread-label" data-id="${row.id}" style="cursor:pointer">${row.label}${countStr}</text>`;
  }

  svg += '</svg>';
  nav.innerHTML = svg;

  // Click handlers
  nav.querySelectorAll('.thread-node, .thread-label').forEach(el => {
    el.addEventListener('click', () => {
      const tid = el.dataset.id;
      if (tid && tid !== activeId) _switchThread(url, tid);
    });
  });
}

function _chatUrl() {
  if (_docChatPaperUrl) return _docChatPaperUrl;
  if (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
    const t = _browseTabs.find(t => t.id === _browseActiveTab);
    if (t && t.url) { _docChatPaperUrl = t.url; return t.url; }
  }
  return '';
}

function branchFromMessage(displayIndex) {
  const url = _chatUrl();
  if (!url) return;
  _branchAtMessage(url, displayIndex);
  _docChatMessages = _getActiveMessages(url);
  renderDocChatMessages(true);
  _renderThreadNav();
}

// Store scroll positions per sidebar tab
let _sidebarScrollPositions = {};

function switchSidebarTab(tab) {
  switchPanelTab(tab);
}

let _sidebarTerminal = null;

function _initSidebarTerminal() {
  const container = document.getElementById('sidebar-terminal-container');
  if (!container) return;
  // Already initialized and container still has the terminal
  if (_sidebarTerminal && _sidebarTerminal.term && container.querySelector('.xterm')) {
    _sidebarTerminal.fitAddon.fit();
    return;
  }
  // Clean up old instance
  if (_sidebarTerminal) {
    if (_sidebarTerminal.ws) try { _sidebarTerminal.ws.close(); } catch (_) {}
    if (_sidebarTerminal.term) _sidebarTerminal.term.dispose();
    _sidebarTerminal = null;
  }
  container.innerHTML = '';

  const theme = TERMINAL_THEMES[_termSettings.theme] || TERMINAL_THEMES.dark;
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    scrollback: 5000,
    theme: theme,
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const obj = { term, fitAddon, ws: null };
  _sidebarTerminal = obj;

  term.open(container);
  setTimeout(() => fitAddon.fit(), 50);

  // Connect WebSocket
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProto}//${location.host}/ws/terminal`);
  ws.binaryType = 'arraybuffer';
  obj.ws = ws;

  ws.onopen = () => {
    fitAddon.fit();
    const { cols, rows } = term;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    } else {
      term.write(ev.data);
    }
  };
  ws.onerror = (e) => console.error('[sidebar-terminal] ws error', e);
  ws.onclose = () => term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  // Re-fit on sidebar resize
  const observer = new ResizeObserver(() => {
    if (container.offsetWidth > 0 && container.offsetHeight > 0) fitAddon.fit();
  });
  observer.observe(container);
}

function toggleInsightDropdown(subtab) {
  const drop = document.getElementById(`insight-drop-${subtab}`);
  const body = document.getElementById(`insight-pane-${subtab}`);
  if (!drop || !body) return;
  const isOpen = body.style.display !== 'none';
  if (isOpen) {
    body.style.display = 'none';
    drop.classList.remove('open');
  } else {
    body.style.display = '';
    drop.classList.add('open');
    _loadInsightSubtab(subtab);
  }
}

function switchInsightSubtab(subtab) {
  // Open the requested dropdown (used on initial load)
  const drop = document.getElementById(`insight-drop-${subtab}`);
  const body = document.getElementById(`insight-pane-${subtab}`);
  if (drop && body) {
    body.style.display = '';
    drop.classList.add('open');
  }
  localStorage.setItem('insightSubtab', subtab);
  _loadInsightSubtab(subtab);
}

function toggleDocChat() {
  _docChatExpanded = !_docChatExpanded;
  const panel = document.getElementById('doc-chat-panel');
  const chevron = document.getElementById('doc-chat-chevron');
  const panelContent = document.getElementById('universal-panel-content');
  if (!panel) return;
  if (_docChatExpanded) {
    panel.classList.remove('hidden');
    chevron.textContent = '▾';
    // Make panel content non-scrollable so chat fills remaining space
    if (panelContent) panelContent.style.overflow = 'hidden';
    if (!_docText && !_docTextLoading) {
      extractDocText(_docChatPaperUrl);
    }
  } else {
    panel.classList.add('hidden');
    chevron.textContent = '▸';
    if (panelContent) panelContent.style.overflow = '';
  }
}

let _extractSpinnerInterval = null;

async function extractDocText(url) {
  _docTextLoading = true;
  const status = document.getElementById('doc-chat-status');
  const frames = ['\u2840','\u2844','\u2846','\u2847','\u283F','\u2839','\u2838','\u2830'];
  let fi = 0;
  if (_extractSpinnerInterval) clearInterval(_extractSpinnerInterval);
  const inlineStatus = document.getElementById('doc-chat-status-inline');
  const setStatus = (txt) => {
    if (status) status.textContent = txt;
    if (inlineStatus) inlineStatus.textContent = txt;
  };
  _extractSpinnerInterval = setInterval(() => {
    setStatus(frames[fi % frames.length] + ' Extracting…');
    fi++;
  }, 100);
  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    clearInterval(_extractSpinnerInterval);
    _extractSpinnerInterval = null;
    if (data.error) {
      setStatus('Failed: ' + data.error);
    } else {
      _docText = data.text || '';
      setStatus(`${data.pages} pg · ${_docText.length.toLocaleString()} chars`);
    }
  } catch (e) {
    clearInterval(_extractSpinnerInterval);
    _extractSpinnerInterval = null;
    setStatus('Failed: ' + e.message);
  }
  _docTextLoading = false;
}

let _docChatStreamStart = 0;

async function sendDocMessage(prefill) {
  const input = document.getElementById('doc-chat-input');
  const text = prefill || (input ? input.value.trim() : '');
  if (!text) return;
  if (input) input.value = '';

  const userMsg = { role: 'user', content: text, ts: Date.now() };
  _docChatMessages.push(userMsg);
  _appendToActiveThread(_chatUrl(), userMsg);
  _docChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  renderDocChatMessages();

  const setButtonDisabled = (v) => {
    const b = document.getElementById('doc-chat-send');
    if (b) b.disabled = v;
  };
  setButtonDisabled(true);

  _docChatAbort = new AbortController();
  try {
    // Build request body matching popup chat
    const filteredMsgs = _docChatMessages.filter(m => !m._thinking).map(m => {
      const msg = { role: m.role, content: m.content };
      if (m.images && m.images.length) msg.images = m.images;
      return msg;
    });
    const body = { messages: filteredMsgs };
    const chatModel = localStorage.getItem('chatModel');
    if (chatModel) body.model = chatModel;
    const toolsOn = localStorage.getItem('chatTools') !== 'off';
    if (toolsOn) {
      body.tools = true;
      const paper = typeof _currentPaperViewPaper !== 'undefined' ? _currentPaperViewPaper : null;
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
    body.context = _docText || '';

    // If no context, fall back to vault-chat (RAG over notes)
    const useVaultChat = !body.context;
    const chatUrl = useVaultChat ? '/api/vault-chat' : '/api/doc-chat';
    const chatHeaders = useVaultChat
      ? { ..._authHeaders(), 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
    if (useVaultChat) {
      body.query = text;
      body.min_similarity = (parseInt(localStorage.getItem('vaultChatMinSimilarity') || '70', 10)) / 100;
      delete body.context;
      delete body.tools;
    }

    _docChatStreamStart = Date.now();
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify(body),
      signal: _docChatAbort.signal
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const aiIdx = _docChatMessages.length - 1;
      _docChatMessages[aiIdx].content = 'Error: server returned ' + resp.status;
      _docChatMessages[aiIdx]._thinking = false;
      renderDocChatMessages(true);
      setButtonDisabled(false);
      _docChatAbort = null;
      return;
    }

    let aiText = '';
    const aiIdx = _docChatMessages.length - 1;
    _docChatMessages[aiIdx]._thinking = false;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    let streamDone = false;
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
          if (currentEvent === 'sources') {
            try {
              _docChatMessages[aiIdx]._sources = JSON.parse(line.slice(6));
            } catch (e) {}
          } else if (currentEvent === 'token') {
            try {
              const token = JSON.parse(line.slice(6));
              aiText += token;
              _docChatMessages[aiIdx].content = aiText;
              renderDocChatMessages();
            } catch (e) {}
          } else if (currentEvent === 'tool_call') {
            try {
              const tc = JSON.parse(line.slice(6));
              const labels = { web_search: 'Searching web\u2026', search_papers: 'Searching papers\u2026', fetch_page: 'Fetching page\u2026', save_to_reading_list: 'Bookmarking\u2026', navigate: 'Navigating\u2026', create_experiment: 'Creating experiment\u2026' };
              _docChatMessages[aiIdx].content = '';
              _docChatMessages[aiIdx]._thinking = true;
              _docChatMessages[aiIdx]._thinkingLabel = labels[tc.name] || 'Using tool\u2026';
              renderDocChatMessages();
            } catch (e) {}
          } else if (currentEvent === 'web_sources') {
            try {
              _docChatMessages[aiIdx]._webSources = JSON.parse(line.slice(6));
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
                const routes = { home: '#', experiments: '#experiments', saved: '#saved', calendar: '#calendar', settings: '#settings', quality: '#quality' };
                location.hash = routes[act.view] || '#';
              }
            } catch (e) {}
          } else if (currentEvent === 'usage') {
            try {
              _docChatMessages[aiIdx]._usage = JSON.parse(line.slice(6));
            } catch (e) {}
          } else if (currentEvent === 'done') {
            streamDone = true;
          } else if (currentEvent === 'error') {
            try {
              const errMsg = JSON.parse(line.slice(6));
              _docChatMessages[aiIdx].content = aiText || ('Error: ' + errMsg);
            } catch (e) {}
            streamDone = true;
          }
          currentEvent = '';
        } else if (line === '') {
          currentEvent = '';
        }
      }
    }
    // Final render — persist full metadata
    _docChatMessages[aiIdx].content = aiText;
    const aiMsg = { role: 'assistant', content: aiText, ts: Date.now() };
    if (_docChatMessages[aiIdx]._sources) aiMsg._sources = _docChatMessages[aiIdx]._sources;
    if (_docChatMessages[aiIdx]._webSources) aiMsg._webSources = _docChatMessages[aiIdx]._webSources;
    if (_docChatMessages[aiIdx]._usage) aiMsg._usage = _docChatMessages[aiIdx]._usage;
    _appendToActiveThread(_chatUrl(), aiMsg);
    renderDocChatMessages(true);
  } catch (e) {
    if (e.name !== 'AbortError') {
      const errContent = 'Error: ' + e.message;
      _docChatMessages.push({ role: 'assistant', content: errContent });
      _appendToActiveThread(_chatUrl(), { role: 'assistant', content: errContent, ts: Date.now() });
      renderDocChatMessages(true);
    }
  }
  _docChatAbort = null;
  setButtonDisabled(false);
}

function renderDocChatMessages(final) {
  const container = document.getElementById('doc-chat-messages');
  if (!container) return;
  container.innerHTML = _docChatMessages.map((m, i) => {
    if (m.role === 'user') {
      const display = m._display || m.content;
      const searchIcon = m._isSearch ? '<span class="doc-search-badge">search</span>' : '';
      const editBtn = `<button class="doc-msg-action-btn" data-action="edit" data-msg-idx="${i}" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
      return `<div class="doc-msg-user">${searchIcon}${escapeHtml(display)}<div class="doc-msg-actions-row">${editBtn}</div></div>`;
    }
    if (m._thinking) {
      const label = m._thinkingLabel ? `<span class="doc-thinking-label">${escapeHtml(m._thinkingLabel)}</span>` : '';
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>${label}</div>`;
    }
    // Search results — render as sources pill
    if (m._searchResults && m._searchResults.length) {
      const pill = typeof _buildSourcesPill === 'function' ? _buildSourcesPill(m._searchResults) : '';
      const resultsHtml = m._searchResults.map(r =>
        `<div class="doc-search-result" data-href="${escapeAttr(r.url)}">` +
        `<div class="doc-search-result-title">${escapeHtml(r.title)}</div>` +
        (r.snippet ? `<div class="doc-search-result-snippet">${escapeHtml(r.snippet)}</div>` : '') +
        `<div class="doc-search-result-url">${escapeHtml(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url)}</div>` +
        `</div>`
      ).join('');
      return `<div class="doc-msg-ai doc-msg-search-bubble">${pill}<div class="doc-sources-expanded">${resultsHtml}</div></div>`;
    }
    const isLast = i === _docChatMessages.length - 1;
    let content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    // Replace [1], [2], etc. with clickable inline source badges
    if (m._sources && m._sources.length) {
      content = content.replace(/\[(\d+)\]/g, (match, num) => {
        const idx = parseInt(num, 10) - 1;
        if (idx >= 0 && idx < m._sources.length) {
          const s = m._sources[idx];
          return `<span class="vault-source-ref" data-note-id="${escapeAttr(s.id)}" title="${escapeAttr(s.title)}">${num}</span>`;
        }
        return match;
      });
    }
    // Sources pill (vault notes or web sources)
    let sourcesPillHtml = '';
    if (m._sources && m._sources.length) {
      const icons = m._sources.slice(0, 3).map((s, si) =>
        `<span class="doc-sources-favicon doc-sources-favicon-num" style="z-index:${3 - si}">${si + 1}</span>`
      ).join('');
      const cardsHtml = m._sources.map((s, si) =>
        `<div class="vault-chat-source-card" data-note-id="${escapeAttr(s.id)}" title="${escapeAttr(s.title)}">` +
        `<span class="vault-source-num">${si + 1}</span>` +
        `<span class="vault-source-title">${escapeHtml(s.title.length > 20 ? s.title.slice(0, 18) + '\u2026' : s.title)}</span>` +
        `<span class="vault-source-score">${Math.round(s.score * 100)}%</span>` +
        `</div>`
      ).join('');
      sourcesPillHtml = `<div class="doc-msg-search-bubble"><div class="doc-sources-pill"><div class="doc-sources-favicons">${icons}</div><span class="doc-sources-label">${m._sources.length} source${m._sources.length !== 1 ? 's' : ''}</span></div><div class="doc-sources-expanded"><div class="doc-sources-cards">${cardsHtml}</div></div></div>`;
    }
    if (m._webSources && m._webSources.length) {
      const pill = typeof _buildSourcesPill === 'function' ? _buildSourcesPill(m._webSources) : '';
      const expandedHtml = m._webSources.map(r =>
        `<div class="doc-search-result" data-href="${escapeAttr(r.url)}">` +
        `<div class="doc-search-result-title">${escapeHtml(r.title)}</div>` +
        (r.snippet ? `<div class="doc-search-result-snippet">${escapeHtml(r.snippet)}</div>` : '') +
        `<div class="doc-search-result-url">${escapeHtml(r.url.length > 60 ? r.url.slice(0, 57) + '...' : r.url)}</div>` +
        `</div>`
      ).join('');
      sourcesPillHtml += `<div class="doc-msg-search-bubble">${pill}<div class="doc-sources-expanded">${expandedHtml}</div></div>`;
    }
    const branchBtn = (final || !isLast) ? `<button class="chat-branch-btn" onclick="branchFromMessage(${i})" title="Branch conversation here"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M12 15V12c0-2 2-3 6-3M12 12c0-2-2-3-6-3"/></svg></button>` : '';
    const speakBtn = `<button class="doc-msg-action-btn doc-msg-speak-btn" data-action="speak" title="Read aloud"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`;
    const copyBtn = `<button class="doc-msg-action-btn" data-action="copy" data-msg-idx="${i}" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
    const redoBtn = `<button class="doc-msg-action-btn" data-action="redo" data-msg-idx="${i}" title="Redo"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>`;
    // Stats line (tokens, duration, model)
    let statsHtml = '';
    if (final && m._usage) {
      const parts = [];
      if (m._usage.total_tokens) parts.push('~' + (m._usage.total_tokens >= 1000 ? (m._usage.total_tokens / 1000).toFixed(1) + 'k' : m._usage.total_tokens) + ' tokens');
      if (m._usage.duration_ms) { const ms = m._usage.duration_ms; parts.push(ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'); }
      if (m._usage.model) parts.push(m._usage.model);
      if (parts.length) statsHtml = `<div class="doc-chat-stats">${parts.join(' \u00B7 ')}</div>`;
    }
    return `<div class="doc-msg-ai">${content}<div class="doc-msg-actions-row">${sourcesPillHtml}${speakBtn}${copyBtn}${redoBtn}${branchBtn}</div>${statsHtml}</div>`;
  }).join('');
  container.querySelectorAll('.doc-msg-ai').forEach(el => renderLatexInEl(el));
  // Attach click handlers
  _attachDocChatHandlers(container);
  container.scrollTop = container.scrollHeight;
}

function _attachDocChatHandlers(container) {
  // Sources pill toggle
  container.querySelectorAll('.doc-sources-pill').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const bubble = el.closest('.doc-msg-search-bubble');
      if (bubble) bubble.classList.toggle('expanded');
    });
  });
  // Search result clicks
  container.querySelectorAll('.doc-search-result[data-href]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const url = el.getAttribute('data-href');
      if (typeof browseNewTab === 'function') browseNewTab(url);
      else window.open(url, '_blank');
    });
  });
  // Vault source cards
  container.querySelectorAll('.vault-chat-source-card[data-note-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
    });
  });
  // Inline source references [1], [2], etc.
  container.querySelectorAll('.vault-source-ref[data-note-id]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
    });
  });
  // Action buttons (speak, copy, redo, edit)
  container.querySelectorAll('.doc-msg-action-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      btn.classList.remove('doc-msg-btn-clicked');
      void btn.offsetWidth;
      btn.classList.add('doc-msg-btn-clicked');
      const action = btn.getAttribute('data-action');
      const idx = parseInt(btn.getAttribute('data-msg-idx'), 10);

      if (action === 'speak') {
        const wasSpeaking = btn.classList.contains('doc-msg-speaking');
        if (speechSynthesis.speaking) {
          speechSynthesis.cancel();
          container.querySelectorAll('[data-action="speak"]').forEach(b => b.classList.remove('doc-msg-speaking'));
        }
        if (wasSpeaking) return;
        const bubble = btn.closest('.doc-msg-ai');
        if (!bubble) return;
        const clone = bubble.cloneNode(true);
        const actRow = clone.querySelector('.doc-msg-actions-row');
        if (actRow) actRow.remove();
        const statsRow = clone.querySelector('.doc-chat-stats');
        if (statsRow) statsRow.remove();
        const text = clone.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return;
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.1;
        btn.classList.add('doc-msg-speaking');
        utter.onend = () => { if (btn.isConnected) btn.classList.remove('doc-msg-speaking'); };
        utter.onerror = () => { if (btn.isConnected) btn.classList.remove('doc-msg-speaking'); };
        speechSynthesis.speak(utter);
      } else if (action === 'copy') {
        const msg = _docChatMessages[idx];
        if (msg && msg.content) {
          navigator.clipboard.writeText(msg.content).then(() => {
            btn.title = 'Copied';
            setTimeout(() => { if (btn.isConnected) btn.title = 'Copy'; }, 1200);
          }).catch(() => {});
        }
      } else if (action === 'redo') {
        // Find preceding user message, branch there, and resend
        let userIdx = -1;
        for (let j = idx - 1; j >= 0; j--) {
          if (_docChatMessages[j].role === 'user') { userIdx = j; break; }
        }
        if (userIdx < 0) return;
        const userMsg = _docChatMessages[userIdx];
        const url = _chatUrl();
        if (url) _branchAtMessage(url, userIdx);
        _docChatMessages = _docChatMessages.slice(0, userIdx);
        if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
        sendDocMessage(userMsg._display || userMsg.content);
      } else if (action === 'edit') {
        const userMsg = _docChatMessages[idx];
        if (!userMsg || userMsg.role !== 'user') return;
        const bubble = btn.closest('.doc-msg-user');
        if (!bubble) return;
        const origText = userMsg._display || userMsg.content;
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'doc-msg-edit-input';
        editInput.value = origText;
        bubble.innerHTML = '';
        bubble.appendChild(editInput);
        bubble.classList.add('doc-msg-editing');
        editInput.focus();
        editInput.setSelectionRange(origText.length, origText.length);
        const submitEdit = () => {
          const val = editInput.value.trim();
          if (!val) return;
          const url = _chatUrl();
          if (url) _branchAtMessage(url, idx);
          _docChatMessages = _docChatMessages.slice(0, idx);
          if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
          sendDocMessage(val);
        };
        editInput.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); submitEdit(); }
          if (ev.key === 'Escape') { ev.preventDefault(); renderDocChatMessages(true); }
        });
      }
    });
  });
}

function _handleSidebarChatKey(event) {
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();
    _doSidebarWebSearch();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    sendDocMessage();
  }
}

async function _doSidebarWebSearch() {
  const input = document.getElementById('doc-chat-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  const userMsg = { role: 'user', content: q, _display: q, _isSearch: true, ts: Date.now() };
  _docChatMessages.push(userMsg);
  _appendToActiveThread(_chatUrl(), userMsg);
  _docChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isSearch: true });
  renderDocChatMessages();

  try {
    const resp = await fetch('/api/web-search?q=' + encodeURIComponent(q));
    const data = await resp.json();
    const results = data.results || [];
    const aiIdx = _docChatMessages.length - 1;
    _docChatMessages[aiIdx]._thinking = false;
    _docChatMessages[aiIdx]._searchResults = results;
    _docChatMessages[aiIdx].content = results.length
      ? results.length + ' result' + (results.length !== 1 ? 's' : '')
      : 'No results found.';
    const aiMsg = { role: 'assistant', content: _docChatMessages[aiIdx].content, _searchResults: results, ts: Date.now() };
    _appendToActiveThread(_chatUrl(), aiMsg);
    renderDocChatMessages(true);
  } catch (e) {
    const aiIdx = _docChatMessages.length - 1;
    _docChatMessages[aiIdx]._thinking = false;
    _docChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _appendToActiveThread(_chatUrl(), { role: 'assistant', content: _docChatMessages[aiIdx].content, ts: Date.now() });
    renderDocChatMessages(true);
  }
  if (input) input.focus();
}
