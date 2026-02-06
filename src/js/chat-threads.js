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
  const panes = ['insights', 'notes', 'chat', 'comments', 'terminal'];

  // Save current tab's scroll position before switching
  panes.forEach(p => {
    const pane = document.getElementById('sidebar-pane-' + p);
    if (pane && pane.style.display !== 'none') {
      _sidebarScrollPositions[p] = pane.scrollTop;
    }
  });

  // Switch tabs
  panes.forEach(p => {
    const pane = document.getElementById('sidebar-pane-' + p);
    const btn = document.getElementById('sidebar-tab-' + p);
    if (pane) pane.style.display = p === tab ? '' : 'none';
    if (btn) btn.classList.toggle('active', p === tab);
  });

  // Restore scroll position for the new tab
  const newPane = document.getElementById('sidebar-pane-' + tab);
  if (newPane && _sidebarScrollPositions[tab] !== undefined) {
    setTimeout(() => { newPane.scrollTop = _sidebarScrollPositions[tab]; }, 0);
  }

  if (tab === 'chat' && !_docChatExpanded) toggleDocChat();
  if (tab === 'comments') fetchPaperComments();
  // Lazy load insights only when tab is opened
  if (tab === 'insights' && !_paperInsightsLoaded && _currentPaperViewPaper) {
    fetchPaperInsights(_currentPaperViewPaper.link);
  }
  // Initialize sidebar terminal on first open
  if (tab === 'terminal') {
    _initSidebarTerminal();
  }
  // Remember the active tab
  localStorage.setItem('sidebarTab', tab);
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
  const sidebar = document.getElementById('browse-sidebar');
  if (!panel) return;
  if (_docChatExpanded) {
    panel.classList.remove('hidden');
    chevron.textContent = '▾';
    // Make sidebar non-scrollable so chat fills remaining space
    if (sidebar) sidebar.style.overflow = 'hidden';
    if (!_docText && !_docTextLoading) {
      extractDocText(_docChatPaperUrl);
    }
  } else {
    panel.classList.add('hidden');
    chevron.textContent = '▸';
    if (sidebar) sidebar.style.overflow = '';
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

async function sendDocMessage(prefill) {
  const input = document.getElementById('doc-chat-input');
  const text = prefill || (input ? input.value.trim() : '');
  if (!text) return;
  if (input) input.value = '';

  _docChatMessages.push({ role: 'user', content: text });
  _appendToActiveThread(_chatUrl(), { role: 'user', content: text, ts: Date.now() });
  // Add a thinking placeholder that will be replaced when tokens arrive
  _docChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  renderDocChatMessages();

  const setButtonDisabled = (v) => {
    const b = document.getElementById('doc-chat-send');
    if (b) b.disabled = v;
  };
  setButtonDisabled(true);

  _docChatAbort = new AbortController();
  try {
    const resp = await fetch('/api/doc-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: _docText, messages: _docChatMessages }),
      signal: _docChatAbort.signal
    });

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
          if (currentEvent === 'token') {
            try {
              const token = JSON.parse(line.slice(6));
              aiText += token;
              _docChatMessages[aiIdx].content = aiText;
              renderDocChatMessages();
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
    // Final render with parsed markdown
    _docChatMessages[aiIdx].content = aiText;
    _appendToActiveThread(_chatUrl(), { role: 'assistant', content: aiText, ts: Date.now() });
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
      return `<div class="doc-msg-user">${escapeHtml(m.content)}</div>`;
    }
    if (m._thinking) {
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
    }
    const isLast = i === _docChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    const branchBtn = (final || !isLast) ? `<button class="chat-branch-btn" onclick="branchFromMessage(${i})" title="Branch conversation here"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M12 15V12c0-2 2-3 6-3M12 12c0-2-2-3-6-3"/></svg></button>` : '';
    return `<div class="doc-msg-ai">${content}${branchBtn}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}
