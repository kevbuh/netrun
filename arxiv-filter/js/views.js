// ── Dashboard ──

let _dashYear, _dashMonth;
{
  const _n = new Date();
  _dashYear = _n.getFullYear();
  _dashMonth = _n.getMonth();
}

function dashCalNav(dir) {
  _dashMonth += dir;
  if (_dashMonth > 11) { _dashMonth = 0; _dashYear++; }
  if (_dashMonth < 0) { _dashMonth = 11; _dashYear--; }
  renderDashboard();
}

async function renderDashboard() {
  if (!localStorage.getItem('feedSources')) { goHome(); return; }
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';

  const [todosResp, expResp, calResp, savedResp] = await Promise.all([
    fetch('/api/todos').then(r => r.json()).catch(() => []),
    fetch('/api/experiments').then(r => r.json()).catch(() => []),
    fetch('/api/calendar').then(r => r.json()).catch(() => []),
    fetch('/api/saved-posts').then(r => r.json()).catch(() => ({}))
  ]);

  const allNotes = todosResp || [];
  const experiments = expResp || [];
  const events = calResp || [];
  const savedPosts = savedResp || {};

  // Merge server saved posts into localStorage
  const localSaved = getSavedPosts();
  let mergedSaved = { ...localSaved };
  for (const [url, entry] of Object.entries(savedPosts)) {
    if (!mergedSaved[url]) mergedSaved[url] = entry;
  }

  // ── Calendar ──
  const now = new Date();
  const year = _dashYear;
  const month = _dashMonth;
  const todayDate = now.getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const eventsByDay = {};
  const todosByDay = {};
  events.forEach(ev => {
    if (!ev.date) return;
    const [ey, em, ed] = ev.date.split('-').map(Number);
    if (ey === year && em === month + 1) {
      if (!eventsByDay[ed]) eventsByDay[ed] = [];
      eventsByDay[ed].push(ev);
    }
  });
  allNotes.forEach(t => {
    if (!t.date) return;
    const [ty, tm, td] = t.date.split('-').map(Number);
    if (ty === year && tm === month + 1) {
      if (!todosByDay[td]) todosByDay[td] = [];
      todosByDay[td].push(t);
    }
  });

  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let calGrid = '';
  for (let i = 0; i < firstDay; i++) calGrid += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && d === todayDate;
    const evts = eventsByDay[d] || [];
    const tds = todosByDay[d] || [];
    const dots = evts.map(e => `<span class="w-1.5 h-1.5 rounded-full" style="background:${e.color || 'var(--accent)'}"></span>`).join('') +
      tds.map(t => `<span class="w-1.5 h-1.5 rounded-full border" style="border-color:${t.color || 'var(--accent)'}; ${t.done ? 'opacity:0.4' : ''}"></span>`).join('');
    calGrid += `<div class="py-1 rounded-md text-center ${isToday ? 'bg-accent text-white font-bold' : 'text-primary'} hover:bg-hover cursor-default">
      ${d}${dots ? `<div class="flex justify-center gap-0.5 mt-0.5">${dots}</div>` : ''}
    </div>`;
  }

  // ── Notes (non-experiment) ──
  const notes = allNotes.filter(n => !n.experimentId);
  const notesHtml = notes.length ? notes.slice(0, 6).map(n => {
    const preview = (n.content || '').split('\n')[0] || '';
    return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors" onclick="openTodos(); setTimeout(()=>selectTodo('${n.id}'),100)">
      <div class="flex-1 min-w-0">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(n.title)}</div>
        ${preview ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(preview.slice(0, 50))}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No notes yet</div>';

  // ── Experiment todos ──
  const expTodos = allNotes.filter(n => n.experimentId && !n.done);
  const expMap = {};
  experiments.forEach(e => { expMap[e.id] = e.title; });
  const expTodosHtml = expTodos.length ? expTodos.slice(0, 6).map(t => {
    const expName = expMap[t.experimentId] || '';
    return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover transition-colors">
      <span class="w-2 h-2 rounded-full shrink-0" style="background:${t.color || 'var(--accent)'}"></span>
      <div class="flex-1 min-w-0">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(t.title)}</div>
        ${expName ? `<div class="text-[0.7rem] text-dimmer truncate cursor-pointer hover:text-primary" onclick="openExperimentDetail('${t.experimentId}')">${escapeHtml(expName)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No experiment todos</div>';

  // ── Reading list ──
  const savedEntries = Object.values(mergedSaved).sort((a, b) => b.savedAt - a.savedAt).slice(0, 6);
  const readingHtml = savedEntries.length ? savedEntries.map(entry => {
    const p = entry.paper;
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const faviconImg = favicon ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.style.display='none'">` : '';
    return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}" onclick="openSavedPaper('${escapeAttr(p.link)}')">
      ${faviconImg}
      <div class="flex-1 min-w-0">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';

  // ── Recent experiments ──
  const recentExps = experiments.slice(0, 4);
  const expsHtml = recentExps.length ? recentExps.map(exp => {
    const runCount = exp.runCount || 0;
    const lastUpdated = exp.lastUpdated ? new Date(exp.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `<div class="p-3 rounded-lg border border-border-card bg-card cursor-pointer hover:border-border-input transition-colors" onclick="openExperimentDetail('${exp.id}')">
      <div class="text-[0.85rem] font-medium text-primary truncate">${escapeHtml(exp.title)}</div>
      <div class="text-[0.72rem] text-dimmer mt-1">${runCount} run${runCount !== 1 ? 's' : ''}${lastUpdated ? ' · ' + lastUpdated : ''}</div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer">No experiments yet</div>';

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">Home</h2>
    <div class="grid grid-cols-[1fr_1fr] gap-6">
      <div>
        <div class="mb-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">${monthName}</h3>
            <div class="flex gap-1">
              <button onclick="dashCalNav(-1)" class="w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]">&lsaquo;</button>
              <button onclick="dashCalNav(1)" class="w-6 h-6 rounded flex items-center justify-center bg-transparent border border-border-input text-dimmer cursor-pointer hover:text-primary text-[0.75rem]">&rsaquo;</button>
            </div>
          </div>
          <div class="bg-card border border-border-card rounded-xl p-3">
            <div class="grid grid-cols-7 text-center text-[0.7rem] text-dimmer mb-1">${dayNames.map(d => `<div>${d}</div>`).join('')}</div>
            <div class="grid grid-cols-7 text-[0.75rem]">${calGrid}</div>
          </div>
        </div>

        <div class="mb-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Notes</h3>
            <button onclick="openTodos()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          ${notesHtml}
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Experiment Todos</h3>
          </div>
          ${expTodosHtml}
        </div>
      </div>

      <div>
        <div class="mb-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Reading List</h3>
            <button onclick="openSaved()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          ${readingHtml}
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Recent Experiments</h3>
            <button onclick="openExperiments()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          <div class="flex flex-col gap-2">${expsHtml}</div>
        </div>
      </div>
    </div>
  `;
}

// ── Paper Viewer (shared) ──
let paperViewOrigin = 'arxiv';

function paperViewGoBack() {
  if (paperViewOrigin === 'saved') { openSaved(); return; }
  goHome();
}

let _currentPaperViewPaper = null;
function togglePaperViewBookmark() {
  if (!_currentPaperViewPaper) return;
  toggleSavePost(_currentPaperViewPaper);
  const btn = document.getElementById('paper-view-bookmark');
  if (!btn) return;
  const saved = isPostSaved(_currentPaperViewPaper.link);
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[0.82rem] cursor-pointer transition-colors ${saved ? 'bg-accent/15 border-accent text-accent' : 'bg-transparent border-border-input text-muted hover:text-primary hover:border-dimmer'}`;
  btn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="${saved ? 'var(--accent)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>${saved ? 'Saved' : 'Bookmark'}`;
}

function showPaperView(paper, hashValue) {
  markPostRead(paper.link);
  hideAllViews();
  const view = document.getElementById('paper-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = hashValue;

  const sidebar = document.getElementById('paper-sidebar');
  const isHN = paper.source === 'hn';
  const isArxiv = paper.source === 'arxiv';
  const hnDiscussionUrl = paper.hnId ? `https://news.ycombinator.com/item?id=${paper.hnId}` : '';
  const backBtn = `<button class="bg-transparent border-none text-muted text-[0.85rem] cursor-pointer p-0 inline-flex items-center gap-1.5 hover:text-primary mb-4" onclick="paperViewGoBack()"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>Back</button>`;
  _currentPaperViewPaper = paper;
  const isSaved = isPostSaved(paper.link);
  const bookmarkBtn = `<button id="paper-view-bookmark" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[0.82rem] cursor-pointer transition-colors ${isSaved ? 'bg-accent/15 border-accent text-accent' : 'bg-transparent border-border-input text-muted hover:text-primary hover:border-dimmer'}" onclick="togglePaperViewBookmark()"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'var(--accent)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>${isSaved ? 'Saved' : 'Bookmark'}</button>`;

  const chatPanel = `
    <div class="mt-auto pt-4 border-t border-border-card flex flex-col" id="doc-chat-section" style="min-height:0">
      <div class="doc-chat-bar" id="doc-chat-bar" onclick="toggleDocChat()">
        <span id="doc-chat-chevron">▸</span>
        <span>Chat</span>
        <span class="doc-chat-status-inline text-dim text-[0.72rem] ml-auto" id="doc-chat-status-inline"></span>
      </div>
      <div class="hidden flex flex-col" id="doc-chat-panel" style="min-height:0;flex:1">
        <div class="doc-chat-status" id="doc-chat-status"></div>
        <div class="doc-chat-messages" id="doc-chat-messages"></div>
        <div class="doc-chat-input-row">
          <input id="doc-chat-input" placeholder="Ask about this document…" onkeydown="if(event.key==='Enter')sendDocMessage()" />
          <button onclick="sendDocMessage()" id="doc-chat-send">Send</button>
        </div>
      </div>
    </div>
  `;

  if (isHN) {
    sidebar.innerHTML = `
      ${backBtn}
      <div class="flex gap-2 mb-3">${bookmarkBtn}</div>
      <div class="text-[0.92rem] font-semibold text-white_ leading-snug mb-2">${renderTitle(paper.title)}</div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-meta-value mb-3">
        ${paper.authors ? `<span class="text-muted">${escapeHtml(paper.authors)}</span>` : ''}
        <span class="text-[#f60] font-semibold">${paper.hnScore} pts</span>
        <a href="${hnDiscussionUrl}" target="_blank" rel="noopener" class="text-link no-underline hover:underline">${paper.hnComments} comments</a>
        ${paper.date ? `<span class="text-dim">${paper.date}</span>` : ''}
      </div>
      <div class="text-[0.78rem] text-dim mb-3 truncate"><a href="${paper.link}" target="_blank" rel="noopener" class="text-link no-underline hover:underline">${escapeHtml(paper.link)}</a></div>
      ${hnDiscussionUrl ? `<div class="text-[0.78rem] mb-3"><a href="${hnDiscussionUrl}" target="_blank" rel="noopener" class="text-link no-underline hover:underline">View on Hacker News</a></div>` : ''}
      ${chatPanel}
    `;
  } else {
    const sourceName = SOURCE_NAMES[paper.source]
      || (paper.source?.startsWith('custom:') ? paper.source.slice(7) : '');
    sidebar.innerHTML = `
      ${backBtn}
      <div class="flex gap-2 mb-3">${bookmarkBtn}</div>
      <div class="text-[0.92rem] font-semibold text-white_ leading-snug mb-2">${renderTitle(paper.title)}</div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] mb-3">
        ${sourceName ? `<span class="text-meta-value">${escapeHtml(sourceName)}</span>` : ''}
        ${paper.authors ? `<span class="text-muted">${escapeHtml(paper.authors)}</span>` : ''}
        ${paper.published ? `<span class="text-dim">${paper.published}</span>` : ''}
      </div>
      <div class="text-[0.78rem] text-dim mb-3 truncate"><a href="${paper.link}" target="_blank" rel="noopener" class="text-link no-underline hover:underline">${escapeHtml(paper.link)}</a></div>
      ${paper.categories && paper.categories.length ? `
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${paper.categories.map(c => `<span class="text-[0.7rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border">${escapeHtml(c)}</span>`).join('')}
        </div>` : ''}
      ${!isArxiv ? `<div class="mb-3"><a href="${paper.link}" target="_blank" rel="noopener" class="text-[0.82rem] text-link no-underline hover:underline">Open in new tab</a></div>` : ''}
      ${chatPanel}
    `;
  }

  const pdfContainer = document.getElementById('paper-pdf-container');
  if (isArxiv) {
    const pdfUrl = paper.link.replace('/abs/', '/pdf/');
    pdfContainer.innerHTML = `<iframe src="${pdfUrl}" title="PDF viewer" class="w-full h-full border-none"></iframe>`;
  } else {
    pdfContainer.innerHTML = `<iframe src="${paper.link}" title="Article viewer" class="w-full h-full border-none" sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe>`;
  }

  // Reset chat state
  _docChatMessages = [];
  _docText = '';
  _docTextLoading = false;
  _docChatExpanded = false;
  if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
  _docChatPaperUrl = paper.link;

  // Start scroll progress tracking
  _startScrollTracker(paper.link);
}

// ── Read Progress Tracking ──
let _scrollTrackerInterval = null;

function _startScrollTracker(link) {
  if (_scrollTrackerInterval) clearInterval(_scrollTrackerInterval);
  _scrollTrackerInterval = setInterval(() => {
    try {
      const iframe = document.querySelector('#paper-pdf-container iframe');
      if (!iframe || !iframe.contentWindow) return;
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || !doc.documentElement) return;
      const scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
      const scrollHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight || 0;
      const clientHeight = doc.documentElement.clientHeight || doc.body.clientHeight || 0;
      if (scrollHeight <= clientHeight) return;
      const progress = Math.min(1, scrollTop / (scrollHeight - clientHeight));
      _saveReadProgress(link, progress);
    } catch (e) {
      // Cross-origin — silently ignore
    }
  }, 2000);
}

function _stopScrollTracker() {
  if (_scrollTrackerInterval) { clearInterval(_scrollTrackerInterval); _scrollTrackerInterval = null; }
}

function _saveReadProgress(link, progress) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  const prev = saved[link].readProgress || 0;
  if (progress > prev) {
    saved[link].readProgress = Math.round(progress * 100) / 100;
    savePosts(saved);
  }
}

// ── Document Chat ──
let _docChatMessages = [];
let _docText = '';
let _docTextLoading = false;
let _docChatAbort = null;
let _docChatExpanded = false;
let _docChatPaperUrl = '';

function toggleDocChat() {
  _docChatExpanded = !_docChatExpanded;
  const panel = document.getElementById('doc-chat-panel');
  const chevron = document.getElementById('doc-chat-chevron');
  const sidebar = document.getElementById('paper-sidebar');
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

async function sendDocMessage() {
  const input = document.getElementById('doc-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  _docChatMessages.push({ role: 'user', content: text });
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
    _docChatMessages.push({ role: 'assistant', content: '' });
    const aiIdx = _docChatMessages.length - 1;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
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
          }
          currentEvent = '';
        } else if (line === '') {
          currentEvent = '';
        }
      }
    }
    // Final render with parsed markdown
    _docChatMessages[aiIdx].content = aiText;
    renderDocChatMessages(true);
  } catch (e) {
    if (e.name !== 'AbortError') {
      _docChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
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
    const isLast = i === _docChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// Text selection → "Ask about this" floating button
document.addEventListener('mouseup', function(e) {
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();

  const msgContainer = document.getElementById('doc-chat-messages');
  if (!msgContainer || !msgContainer.contains(e.target)) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3) return;

  const btn = document.createElement('button');
  btn.id = 'doc-chat-ask-float';
  btn.className = 'doc-chat-ask-btn';
  btn.textContent = 'Ask about this';
  btn.style.left = e.pageX + 'px';
  btn.style.top = (e.pageY - 30) + 'px';
  btn.onclick = function() {
    const input = document.getElementById('doc-chat-input');
    if (input) input.value = '> ' + text + '\n\n';
    input.focus();
    btn.remove();
  };
  document.body.appendChild(btn);
});

document.addEventListener('mousedown', function(e) {
  const btn = document.getElementById('doc-chat-ask-float');
  if (btn && !btn.contains(e.target)) btn.remove();
});

function openPaper(index) {
  paperViewOrigin = 'arxiv';
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  if (paper.source === 'arxiv') {
    showPaperView(paper, 'paper/' + index);
  } else {
    fetch(`/api/check-embed?url=${encodeURIComponent(paper.link)}`)
      .then(r => r.json())
      .then(data => {
        if (data.embeddable) {
          showPaperView(paper, 'paper/' + index);
        } else {
          window.open(paper.link, '_blank');
        }
      })
      .catch(() => {
        window.open(paper.link, '_blank');
      });
  }
}

function openPaperByUrl(url) {
  paperViewOrigin = 'finder';
  const hashVal = 'view/' + encodeURIComponent(url);
  const cached = finderResultsCache.find(r => r.link === url);
  if (cached) { showPaperView(cached, hashVal); return; }
  const savedEntry = getSavedPosts()[url];
  if (savedEntry?.paper) { paperViewOrigin = 'saved'; showPaperView(savedEntry.paper, hashVal); return; }
  const feedPaper = allPapers.find(p => p.link === url);
  if (feedPaper) { showPaperView(feedPaper, hashVal); return; }
  showPaperView({ title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' }, hashVal);
}

// ── Paper Finder ──
let finderResultsCache = [];
let finderCurrentQuery = '';
let finderCurrentStart = 0;

document.getElementById('finder-form').addEventListener('submit', e => {
  e.preventDefault();
  finderCurrentStart = 0;
  finderSort = 'relevance';
  finderCurrentQuery = document.getElementById('finder-query').value.trim();
  if (finderCurrentQuery) doFinderSearch();
});

document.getElementById('finder-query').addEventListener('input', () => {
  if (!document.getElementById('finder-query').value.trim()) {
    showFeedHideFinder();
  }
});

function showFeedHideFinder() {
  document.getElementById('finder-results-masonry').innerHTML = '';
  document.getElementById('home-feed-section').style.display = '';
}

function showFinderHideFeed() {
  document.getElementById('home-feed-section').style.display = 'none';
}

async function doFinderSearch() {
  showFinderHideFeed();
  const container = document.getElementById('finder-results-masonry');
  container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Searching arXiv...</div></div>';
  try {
    const resp = await fetch(`/api/arxiv-search?q=${encodeURIComponent(finderCurrentQuery)}&start=${finderCurrentStart}&max_results=20`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    parseFinderResults(xml);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-dim text-[0.9rem]">Search failed: ${err.message}</div>`;
  }
}

function parseFinderResults(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ns = 'http://www.w3.org/2005/Atom';
  const entries = doc.getElementsByTagNameNS(ns, 'entry');
  const totalStr = doc.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/', 'totalResults')[0]?.textContent || '0';
  const total = parseInt(totalStr, 10);

  finderResultsCache = Array.from(entries).map(entry => {
    const title = (entry.getElementsByTagNameNS(ns, 'title')[0]?.textContent || '').trim().replace(/\s+/g, ' ');
    const summary = (entry.getElementsByTagNameNS(ns, 'summary')[0]?.textContent || '').trim().replace(/\s+/g, ' ');
    const published = (entry.getElementsByTagNameNS(ns, 'published')[0]?.textContent || '').slice(0, 10);
    const authors = Array.from(entry.getElementsByTagNameNS(ns, 'author'))
      .map(a => a.getElementsByTagNameNS(ns, 'name')[0]?.textContent?.trim() || '').join(', ');
    const links = entry.getElementsByTagNameNS(ns, 'link');
    let link = '';
    for (const l of links) {
      if (l.getAttribute('type') === 'text/html' || (!link && l.getAttribute('rel') === 'alternate')) {
        link = l.getAttribute('href') || '';
      }
    }
    if (!link) link = entry.getElementsByTagNameNS(ns, 'id')[0]?.textContent || '';
    const categories = Array.from(entry.getElementsByTagNameNS(ns, 'category'))
      .map(c => c.getAttribute('term')).filter(Boolean);
    const arxivCats = entry.querySelectorAll('category');
    for (const c of arxivCats) {
      const t = c.getAttribute('term');
      if (t && !categories.includes(t)) categories.push(t);
    }
    const dateStr = published ? formatDate(new Date(published + 'T00:00:00')) : '';
    const arxivId = extractArxivId(link);
    return { title, description: summary, authors, link, published, date: dateStr, categories, arxivId };
  });

  renderFinderResults(total);
  fetchFinderCitations(total);
}

let finderSort = 'relevance';
let finderLastTotal = 0;

function setFinderSort(mode) {
  finderSort = mode;
  renderFinderResults(finderLastTotal);
}

function renderFinderResults(total) {
  const container = document.getElementById('finder-results-masonry');
  if (!finderResultsCache.length) {
    container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]">No results found.</div>';
    return;
  }

  let sorted = [...finderResultsCache];
  if (finderSort === 'citations') {
    sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  } else if (finderSort === 'latest') {
    sorted.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const sortBar = `<div class="flex gap-1 mb-4">
    <button class="sort-btn shrink-0 px-3.5 py-1.5 rounded-lg border border-border-input bg-card text-muted text-[0.82rem] cursor-pointer transition-all duration-150 whitespace-nowrap hover:border-accent hover:text-primary ${finderSort === 'relevance' ? 'active' : ''}" onclick="setFinderSort('relevance')">Relevance</button>
    <button class="sort-btn shrink-0 px-3.5 py-1.5 rounded-lg border border-border-input bg-card text-muted text-[0.82rem] cursor-pointer transition-all duration-150 whitespace-nowrap hover:border-accent hover:text-primary ${finderSort === 'latest' ? 'active' : ''}" onclick="setFinderSort('latest')">Latest</button>
    <button class="sort-btn shrink-0 px-3.5 py-1.5 rounded-lg border border-border-input bg-card text-muted text-[0.82rem] cursor-pointer transition-all duration-150 whitespace-nowrap hover:border-accent hover:text-primary ${finderSort === 'citations' ? 'active' : ''}" onclick="setFinderSort('citations')">Most Cited</button>
  </div>`;

  container.innerHTML = sortBar + sorted.map((r, i) => `
    <div class="paper break-inside-avoid bg-card border border-border-card rounded-xl p-4 mb-3.5 cursor-pointer transition-all duration-150 relative" onclick="openFinderPaper(${i})">
      <div class="flex gap-1.5 flex-wrap items-center mb-2">${r.arxivId ? ARXIV_LOGO_INLINE : ''}${r.citations !== undefined ? `<span class="text-[0.68rem] text-dim">${r.citations} cited</span>` : ''}${r.categories.slice(0,3).map(c => `<span class="text-[0.68rem] bg-cat-tag text-cat-tag-color px-[7px] py-0.5 rounded border border-border-subtle">${escapeHtml(c)}</span>`).join('')}${r.date ? `<span class="text-[0.68rem] text-dim ml-auto">${escapeHtml(r.date)}</span>` : ''}</div>
      <div class="text-[0.92rem] font-semibold text-primary mb-1.5 leading-snug">${renderTitle(r.title)}</div>
      ${r.description ? `<div class="text-[0.78rem] text-muted leading-relaxed">${escapeHtml(truncate(r.description, 120))}</div>` : ''}
    </div>
  `).join('') + (total > 20 ? `
    <div class="finder-pagination flex justify-center gap-3 pt-6">
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${finderCurrentStart === 0 ? 'disabled' : ''} onclick="finderPrev()">Previous</button>
      <span class="text-dimmer text-[0.8rem] self-center">${finderCurrentStart + 1}&ndash;${finderCurrentStart + finderResultsCache.length} of ${total}</span>
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${finderCurrentStart + 20 >= total ? 'disabled' : ''} onclick="finderNext()">Next</button>
    </div>
  ` : '');
  finderLastTotal = total;
}

async function fetchFinderCitations(total) {
  const ids = finderResultsCache.map(r => r.arxivId).filter(Boolean);
  if (!ids.length) return;
  try {
    const resp = await fetch('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (resp.ok) {
      const data = await resp.json();
      for (const r of finderResultsCache) {
        if (r.arxivId && data[r.arxivId] !== undefined) {
          r.citations = data[r.arxivId];
        }
      }
      renderFinderResults(total);
    }
  } catch (e) { /* silently fail */ }
}

function openFinderPaper(i) {
  const r = finderResultsCache[i];
  if (r && r.link) openPaperByUrl(r.link);
}

function finderPrev() {
  finderCurrentStart = Math.max(0, finderCurrentStart - 20);
  doFinderSearch();
}

function finderNext() {
  finderCurrentStart += 20;
  doFinderSearch();
}

// ── Todos ──
let todos = [];
let selectedTodoId = null;
let _todoSaveTimer = null;

function openTodos() {
  hideAllViews();
  const view = document.getElementById('todos-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'todos';
  setSidebarActive('sb-todos');
  fetchTodos();
}

async function fetchTodos() {
  try {
    const [todosResp, expResp] = await Promise.all([fetch('/api/todos'), fetch('/api/experiments')]);
    todos = await todosResp.json();
    allExperiments = await expResp.json();
  } catch (e) { todos = []; }
  renderTodosView();
}

async function addTodo(todo) {
  try {
    const resp = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(todo)
    });
    const created = await resp.json();
    todos.push(created);
    selectedTodoId = created.id;
    renderTodosView();
  } catch (e) { /* silently fail */ }
}

async function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  try {
    const resp = await fetch('/api/todos/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !todo.done })
    });
    const updated = await resp.json();
    const idx = todos.findIndex(t => t.id === id);
    if (idx !== -1) todos[idx] = updated;
    renderTodosView();
    if (document.getElementById('calendar-view-content').innerHTML) renderCalendarView();
  } catch (e) { /* silently fail */ }
}

async function deleteTodo(id) {
  try {
    await fetch('/api/todos/' + id, { method: 'DELETE' });
    todos = todos.filter(t => t.id !== id);
    if (selectedTodoId === id) selectedTodoId = null;
    renderTodosView();
    if (document.getElementById('calendar-view-content').innerHTML) renderCalendarView();
  } catch (e) { /* silently fail */ }
}

function selectTodo(id) {
  selectedTodoId = id;
  _todoEditing = false;
  renderTodosList();
  renderTodoEditor();
}

function todoEditorInput() {
  if (_todoSaveTimer) clearTimeout(_todoSaveTimer);
  _todoSaveTimer = setTimeout(saveTodoContent, 600);
}

async function saveTodoContent() {
  const todo = todos.find(t => t.id === selectedTodoId);
  if (!todo) return;
  const editor = document.getElementById('todo-editor');
  if (!editor) return;
  const content = editor.value;
  todo.content = content;
  try {
    await fetch('/api/todos/' + todo.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch {}
}

async function saveTodoTitle(id) {
  const input = document.getElementById('todo-title-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  todo.title = title;
  try {
    await fetch('/api/todos/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
  } catch {}
  renderTodosList();
}

function renderTodosList() {
  const list = document.getElementById('todos-list');
  if (!list) return;
  const sorted = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return 0;
  });
  list.innerHTML = sorted.map(todo => {
    const sel = todo.id === selectedTodoId;
    const preview = (todo.content || '').split('\n')[0] || '';
    return `
    <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors group ${sel ? 'bg-accent/15' : 'hover:bg-hover'}" onclick="selectTodo('${todo.id}')">
      <div class="flex-1 min-w-0">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(todo.title)}</div>
        ${preview ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(preview.slice(0, 50))}</div>` : ''}
      </div>
      <button onclick="event.stopPropagation(); deleteTodo('${todo.id}')" class="shrink-0 bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

let _todoEditing = false;

function renderTodoEditor() {
  const pane = document.getElementById('todos-editor-pane');
  if (!pane) return;
  const todo = todos.find(t => t.id === selectedTodoId);
  if (!todo) {
    pane.innerHTML = `<div class="flex items-center justify-center h-full text-dimmer text-[0.9rem]">Select or create a note</div>`;
    return;
  }
  if (_todoEditing) {
    // Show raw editor
    pane.innerHTML = `
      <input id="todo-title-input" value="${escapeAttr(todo.title)}" class="w-full text-[1.1rem] font-semibold text-primary bg-transparent border-none outline-none mb-2 px-0" onblur="saveTodoTitle('${todo.id}')" onkeydown="if(event.key==='Enter'){this.blur()}" />
      <textarea id="todo-editor" class="w-full flex-1 bg-transparent border-none outline-none text-[0.86rem] text-primary leading-relaxed resize-none font-mono" placeholder="Write markdown, LaTeX ($...$), or plain text..." oninput="todoEditorInput()" onblur="todoEditorBlur()">${escapeHtml(todo.content || '')}</textarea>
    `;
  } else {
    // Show rendered preview
    const content = todo.content || '';
    let rendered = '';
    if (content.trim()) {
      rendered = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');
    } else {
      rendered = '<span class="text-dimmer">Click to edit...</span>';
    }
    pane.innerHTML = `
      <div class="text-[1.1rem] font-semibold text-primary mb-2">${escapeHtml(todo.title)}</div>
      <div id="todo-rendered" class="flex-1 text-[0.86rem] text-primary leading-relaxed overflow-y-auto cursor-text nb-rendered-md" data-latex onclick="startTodoEdit()">${rendered}</div>
    `;
    // Render LaTeX in preview
    const el = document.getElementById('todo-rendered');
    if (el && typeof katex !== 'undefined') {
      function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
      let html = el.innerHTML;
      html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
        try { return katex.renderToString(decodeTex(tex), { displayMode: true, throwOnError: false }); } catch { return _; }
      });
      html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
        try { return katex.renderToString(decodeTex(tex), { displayMode: false, throwOnError: false }); } catch { return _; }
      });
      el.innerHTML = html;
    }
  }
}

function startTodoEdit() {
  _todoEditing = true;
  renderTodoEditor();
  setTimeout(() => {
    const editor = document.getElementById('todo-editor');
    if (editor) editor.focus();
  }, 30);
}

function todoEditorBlur() {
  // Small delay to allow clicking title input without triggering blur render
  setTimeout(() => {
    const active = document.activeElement;
    if (active && (active.id === 'todo-editor' || active.id === 'todo-title-input')) return;
    _todoEditing = false;
    saveTodoContent();
    renderTodoEditor();
  }, 150);
}

function renderTodosView() {
  const container = document.getElementById('todos-view-content');
  container.innerHTML = `
    <div class="flex h-[calc(100vh-80px)]">
      <div class="w-[200px] shrink-0 border-r border-border-dim pr-0 flex flex-col">
        <div class="flex items-center justify-between mb-2 px-2">
          <h2 class="text-[1rem] font-semibold text-white_">Notes</h2>
          <button onclick="addTodo({title:'Untitled',content:''})" class="w-6 h-6 rounded-md bg-accent text-white text-[0.9rem] font-bold cursor-pointer hover:opacity-90 transition-opacity border-none flex items-center justify-center leading-none">+</button>
        </div>
        <div id="todos-list" class="flex-1 overflow-y-auto px-1"></div>
      </div>
      <div id="todos-editor-pane" class="flex-1 flex flex-col px-5 pt-1 min-w-0"></div>
    </div>
  `;
  renderTodosList();
  renderTodoEditor();
}

// ── Calendar ──
let calendarEvents = [];
let calendarYear, calendarMonth;
let calendarSelectedDay = null;
let calendarShowForm = false;

{
  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
}

function openCalendar() {
  hideAllViews();
  const view = document.getElementById('calendar-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'calendar';
  setSidebarActive('sb-dashboard');
  fetchCalendarEvents();
}

async function fetchCalendarEvents() {
  try {
    const [evResp, tdResp] = await Promise.all([fetch('/api/calendar'), fetch('/api/todos')]);
    calendarEvents = await evResp.json();
    todos = await tdResp.json();
  } catch (e) { calendarEvents = []; }
  renderCalendarView();
}

async function addCalendarEvent(ev) {
  try {
    const resp = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev)
    });
    const created = await resp.json();
    calendarEvents.push(created);
    calendarShowForm = false;
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

async function deleteCalendarEvent(id) {
  try {
    await fetch('/api/calendar/' + id, { method: 'DELETE' });
    calendarEvents = calendarEvents.filter(e => e.id !== id);
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

function calendarPrev() { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarNext() { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarToday() { const n = new Date(); calendarYear = n.getFullYear(); calendarMonth = n.getMonth(); calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }

function calendarSelectDay(day) {
  calendarSelectedDay = day;
  calendarShowForm = false;
  renderCalendarView();
}

function calendarToggleForm() {
  calendarShowForm = !calendarShowForm;
  renderCalendarView();
}

function calendarSubmitForm() {
  const title = document.getElementById('cal-ev-title').value.trim();
  if (!title) return;
  const desc = document.getElementById('cal-ev-desc').value.trim();
  const colorEl = document.querySelector('input[name="cal-ev-color"]:checked');
  const color = colorEl ? colorEl.value : '#b4451a';
  const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(calendarSelectedDay).padStart(2, '0')}`;
  addCalendarEvent({ title, description: desc, date: dateStr, color });
}

function renderCalendarView() {
  const container = document.getElementById('calendar-view-content');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth;
  const todayDate = today.getDate();

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

  const eventsByDay = {};
  calendarEvents.forEach(ev => {
    const [y, m, d] = ev.date.split('-').map(Number);
    if (y === calendarYear && m === calendarMonth + 1) {
      if (!eventsByDay[d]) eventsByDay[d] = [];
      eventsByDay[d].push(ev);
    }
  });

  const todosByDay = {};
  todos.forEach(todo => {
    if (!todo.date) return;
    const [y, m, d] = todo.date.split('-').map(Number);
    if (y === calendarYear && m === calendarMonth + 1) {
      if (!todosByDay[d]) todosByDay[d] = [];
      todosByDay[d].push(todo);
    }
  });

  const presetColors = [
    { value: '#b4451a', label: 'Accent' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#22c55e', label: 'Green' },
    { value: '#a855f7', label: 'Purple' },
    { value: '#eab308', label: 'Yellow' },
    { value: '#ef4444', label: 'Red' }
  ];

  let html = `
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-[1.3rem] font-semibold text-white_">Calendar</h2>
    </div>
    <div class="flex items-center gap-3 mb-5">
      <button onclick="calendarPrev()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <button onclick="calendarToday()" class="px-3 py-1 rounded-lg bg-card border border-border-card text-[0.8rem] text-primary cursor-pointer hover:bg-hover transition-colors">Today</button>
      <button onclick="calendarNext()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>
      <span class="text-[1.1rem] font-semibold text-white_ ml-1">${monthNames[calendarMonth]} ${calendarYear}</span>
    </div>
    <div class="grid grid-cols-7 gap-px bg-border-card rounded-xl overflow-hidden border border-border-card">
  `;

  dayNames.forEach(d => {
    html += `<div class="bg-card px-2 py-2 text-center text-[0.75rem] font-semibold text-dimmer uppercase tracking-wide">${d}</div>`;
  });

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && d === todayDate;
    const isSelected = d === calendarSelectedDay;
    const evs = eventsByDay[d] || [];
    const tds = todosByDay[d] || [];
    const borderClass = isToday ? 'border-2 border-accent' : '';
    const selectedClass = isSelected ? 'bg-hover' : 'bg-card';
    html += `<div class="${selectedClass} ${borderClass} px-2 py-1.5 min-h-[70px] cursor-pointer hover:bg-hover transition-colors" onclick="calendarSelectDay(${d})">
      <span class="text-[0.8rem] ${isToday ? 'text-accent font-bold' : 'text-primary'}">${d}</span>
      <div class="flex flex-wrap gap-1 mt-1">
        ${evs.map(ev => `<span class="w-2 h-2 rounded-full inline-block" style="background:${ev.color}" title="${ev.title.replace(/"/g, '&quot;')}"></span>`).join('')}
        ${tds.map(td => `<span class="w-2 h-2 rounded-full inline-block border border-current" style="color:${td.color}${td.done ? ';opacity:0.4' : ''}" title="${td.title.replace(/"/g, '&quot;')}"></span>`).join('')}
      </div>
    </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  html += `</div>`;

  if (calendarSelectedDay !== null) {
    const evs = eventsByDay[calendarSelectedDay] || [];
    const dayTodos = todosByDay[calendarSelectedDay] || [];
    const dateStr = `${monthNames[calendarMonth]} ${calendarSelectedDay}, ${calendarYear}`;
    html += `
      <div class="mt-6 p-5 bg-card rounded-xl border border-border-card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[1rem] font-semibold text-white_">${dateStr}</h3>
          <button onclick="calendarToggleForm()" class="px-3 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">${calendarShowForm ? 'Cancel' : '+ Add Event'}</button>
        </div>
    `;

    if (calendarShowForm) {
      html += `
        <div class="mb-4 p-4 bg-body rounded-lg border border-border-card">
          <input type="text" id="cal-ev-title" placeholder="Event title..." class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 focus:outline-none focus:border-accent" />
          <textarea id="cal-ev-desc" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 resize-none focus:outline-none focus:border-accent"></textarea>
          <div class="flex items-center gap-3 mb-3">
            <span class="text-[0.8rem] text-dimmer">Color:</span>
            ${presetColors.map((c, i) => `
              <label class="cursor-pointer">
                <input type="radio" name="cal-ev-color" value="${c.value}" ${i === 0 ? 'checked' : ''} class="sr-only peer" />
                <span class="w-6 h-6 rounded-full inline-block border-2 border-transparent peer-checked:border-white transition-colors" style="background:${c.value}" title="${c.label}"></span>
              </label>
            `).join('')}
          </div>
          <div class="flex gap-2">
            <button onclick="calendarSubmitForm()" class="px-4 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">Save</button>
            <button onclick="calendarToggleForm()" class="px-4 py-1.5 rounded-lg bg-card border border-border-card text-primary text-[0.8rem] cursor-pointer hover:bg-hover transition-colors">Cancel</button>
          </div>
        </div>
      `;
    }

    if (evs.length === 0 && dayTodos.length === 0 && !calendarShowForm) {
      html += `<p class="text-[0.85rem] text-dimmer">No events or todos on this day.</p>`;
    } else {
      evs.forEach(ev => {
        html += `
          <div class="flex items-start gap-3 py-2.5 border-b border-border-dim last:border-0">
            <span class="w-3 h-3 rounded-full mt-1 flex-shrink-0" style="background:${ev.color}"></span>
            <div class="flex-1 min-w-0">
              <div class="text-[0.9rem] font-medium text-white_">${ev.title}</div>
              ${ev.description ? `<div class="text-[0.8rem] text-dimmer mt-0.5">${ev.description}</div>` : ''}
            </div>
            <button onclick="deleteCalendarEvent('${ev.id}')" class="text-dimmer hover:text-red-400 transition-colors cursor-pointer bg-transparent border-none p-1" title="Delete event">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
      });

      if (dayTodos.length > 0) {
        html += `<div class="mt-3 pt-3 ${evs.length ? 'border-t border-border-dim' : ''}">
          <div class="text-[0.75rem] font-semibold text-dimmer uppercase tracking-wide mb-2">Todos</div>`;
        dayTodos.forEach(td => {
          html += `
            <div class="flex items-start gap-3 py-2 ${td.done ? 'opacity-50' : ''}">
              <input type="checkbox" ${td.done ? 'checked' : ''} onchange="toggleTodo('${td.id}')" class="mt-0.5 w-4 h-4 cursor-pointer accent-accent" />
              <span class="w-3 h-3 rounded-full mt-1 flex-shrink-0 border-2" style="border-color:${td.color}"></span>
              <div class="flex-1 min-w-0">
                <div class="text-[0.9rem] font-medium text-white_ ${td.done ? 'line-through' : ''}">${escapeHtml(td.title)}</div>
                ${td.description ? `<div class="text-[0.8rem] text-dimmer mt-0.5">${escapeHtml(td.description)}</div>` : ''}
              </div>
            </div>
          `;
        });
        html += `</div>`;
      }
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}
