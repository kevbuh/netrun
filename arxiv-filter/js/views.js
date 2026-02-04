// ── arXiv category labels ──
const ARXIV_CAT_NAMES = {
  'cs.AI':'Artificial Intelligence','cs.AR':'Hardware Architecture','cs.CC':'Computational Complexity',
  'cs.CE':'Computational Engineering','cs.CG':'Computational Geometry','cs.CL':'Computation and Language',
  'cs.CR':'Cryptography and Security','cs.CV':'Computer Vision and Pattern Recognition',
  'cs.CY':'Computers and Society','cs.DB':'Databases','cs.DC':'Distributed Computing',
  'cs.DL':'Digital Libraries','cs.DM':'Discrete Mathematics','cs.DS':'Data Structures and Algorithms',
  'cs.ET':'Emerging Technologies','cs.FL':'Formal Languages and Automata Theory',
  'cs.GL':'General Literature','cs.GR':'Graphics','cs.GT':'Computer Science and Game Theory',
  'cs.HC':'Human-Computer Interaction','cs.IR':'Information Retrieval','cs.IT':'Information Theory',
  'cs.LG':'Machine Learning','cs.LO':'Logic in Computer Science','cs.MA':'Multiagent Systems',
  'cs.MM':'Multimedia','cs.MS':'Mathematical Software','cs.NA':'Numerical Analysis',
  'cs.NE':'Neural and Evolutionary Computing','cs.NI':'Networking and Internet Architecture',
  'cs.OH':'Other Computer Science','cs.OS':'Operating Systems','cs.PF':'Performance',
  'cs.PL':'Programming Languages','cs.RO':'Robotics','cs.SC':'Symbolic Computation',
  'cs.SD':'Sound','cs.SE':'Software Engineering','cs.SI':'Social and Information Networks',
  'cs.SY':'Systems and Control',
  'stat.ML':'Machine Learning (Statistics)','stat.TH':'Statistics Theory',
  'stat.ME':'Methodology','stat.AP':'Applications','stat.CO':'Computation',
  'math.OC':'Optimization and Control','math.ST':'Statistics Theory',
  'eess.IV':'Image and Video Processing','eess.AS':'Audio and Speech Processing',
  'eess.SP':'Signal Processing','eess.SY':'Systems and Control',
  'q-bio.QM':'Quantitative Methods','q-bio.NC':'Neurons and Cognition',
  'physics.comp-ph':'Computational Physics','cond-mat.dis-nn':'Disordered Systems and Neural Networks',
};

// ── Reader View (saved content) ──
function _insertIframeWithOverlay(container, url) {
  container.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:none;background:#fff" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer"></iframe>`;
  const iframe = container.querySelector('iframe');
  if (iframe) _injectIframeChatHandler(iframe);
}

function _tryRenderSavedContent(container, paper) {
  const url = paper.link;
  fetch(`/api/saved-content?url=${encodeURIComponent(url)}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && data.text && data.text.length > 50) {
        _renderReaderView(container, data);
      } else {
        _insertIframeWithOverlay(container, paper.link);
      }
    })
    .catch(() => {
      _insertIframeWithOverlay(container, paper.link);
    });
}

function _isTwitterUrl(url) {
  try { const h = new URL(url).hostname; return h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com'); } catch { return false; }
}

function _parseTwitterAuthor(title) {
  // Title format: "Name on X: \"text\"" or "Name (@handle) on X: ..."
  const m = title.match(/^(.+?)\s+on\s+X:/i) || title.match(/^(.+?)\s+on\s+Twitter:/i);
  if (!m) return { name: '', handle: '' };
  const raw = m[1].trim();
  const hm = raw.match(/^(.+?)\s*\((@\w+)\)$/);
  if (hm) return { name: hm[1].trim(), handle: hm[2] };
  return { name: raw, handle: '' };
}

function _renderTwitterThread(container, data) {
  const div = document.createElement('div');
  div.className = 'reader-view reader-view--twitter';

  const author = _parseTwitterAuthor(data.title || '');

  // Author header
  const header = document.createElement('div');
  header.className = 'tweet-thread-header';
  header.innerHTML = `
    <div class="tweet-avatar">${(author.name || '?')[0].toUpperCase()}</div>
    <div>
      <div class="tweet-author-name">${_escHtml(author.name || 'Thread')}</div>
      ${author.handle ? `<div class="tweet-author-handle">${_escHtml(author.handle)}</div>` : ''}
    </div>
  `;
  div.appendChild(header);

  // Source link
  if (data.url) {
    const link = document.createElement('a');
    link.href = data.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reader-view-source';
    link.textContent = 'View on X';
    div.appendChild(link);
  }

  // Parse text into tweets — split on double newlines, then group short consecutive paragraphs as one tweet
  const rawParas = (data.text || '').split('\n\n').map(s => s.trim()).filter(Boolean);
  // Filter out noise lines (metadata, follow buttons, timestamps, etc.)
  const noise = /^(follow|click to follow|©|terms of service|privacy policy|cookie policy|accessibility|ads info|more|post|repost|reply|like|bookmark|share|\d+$|\d+:\d+|show more|sign up|log in)/i;
  const paras = rawParas.filter(p => !noise.test(p) && p.length > 2);

  // Group into tweets: each paragraph that's >=80 chars is its own tweet, shorter ones merge with next
  const tweets = [];
  let buf = [];
  for (const p of paras) {
    buf.push(p);
    if (p.length >= 80 || p.endsWith('.') || p.endsWith('!') || p.endsWith('?') || p.endsWith(':')) {
      tweets.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length) tweets.push(buf.join('\n'));

  const thread = document.createElement('div');
  thread.className = 'tweet-thread';
  tweets.forEach((text, i) => {
    const card = document.createElement('div');
    card.className = 'tweet-card';
    // Thread line
    if (i < tweets.length - 1) card.classList.add('tweet-card--continued');
    const counter = document.createElement('div');
    counter.className = 'tweet-counter';
    counter.textContent = `${i + 1}/${tweets.length}`;
    const body = document.createElement('div');
    body.className = 'tweet-body';
    text.split('\n').forEach(line => {
      const p = document.createElement('p');
      p.textContent = line;
      body.appendChild(p);
    });
    card.appendChild(counter);
    card.appendChild(body);
    thread.appendChild(card);
  });
  div.appendChild(thread);

  container.innerHTML = '';
  container.appendChild(div);
}

function _escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function _renderReaderView(container, data) {
  if (_isTwitterUrl(data.url || '')) {
    return _renderTwitterThread(container, data);
  }
  const div = document.createElement('div');
  div.className = 'reader-view';
  const h1 = document.createElement('h1');
  h1.textContent = data.title || '';
  div.appendChild(h1);
  if (data.url) {
    const link = document.createElement('a');
    link.href = data.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reader-view-source';
    link.textContent = data.url;
    div.appendChild(link);
  }
  const body = document.createElement('div');
  body.className = 'reader-view-body';
  (data.text || '').split('\n\n').forEach(para => {
    if (!para.trim()) return;
    const p = document.createElement('p');
    p.textContent = para.trim();
    body.appendChild(p);
  });
  div.appendChild(body);
  container.innerHTML = '';
  container.appendChild(div);
}

// ── Topbar overflow (three-dots menu) ──
let _topbarOverflowRO = null;

function _setupTopbarOverflow(topbar) {
  if (_topbarOverflowRO) _topbarOverflowRO.disconnect();
  _topbarOverflowRO = new ResizeObserver(() => _updateTopbarOverflow(topbar));
  _topbarOverflowRO.observe(topbar);
  // Run once immediately after layout
  requestAnimationFrame(() => _updateTopbarOverflow(topbar));
}

function _updateTopbarOverflow(topbar) {
  const actionsWrap = topbar.querySelector('#topbar-actions');
  const overflowWrap = topbar.querySelector('#topbar-overflow-wrap');
  const menu = topbar.querySelector('#topbar-overflow-menu');
  if (!actionsWrap || !overflowWrap) return;

  const actions = topbar._topbarActions || [];
  const items = actionsWrap.querySelectorAll('.topbar-action');

  // First show all to measure
  items.forEach(el => el.style.display = '');
  overflowWrap.style.display = 'none';

  // Also hide meta on very narrow screens
  const meta = topbar.querySelector('.topbar-meta');
  if (meta) meta.style.display = '';

  const topbarWidth = topbar.clientWidth;
  const topbarScroll = topbar.scrollWidth;

  // If everything fits, done
  if (topbarScroll <= topbarWidth + 2) return;

  // Hide meta first if needed
  if (meta && topbarScroll > topbarWidth + 2) {
    meta.style.display = 'none';
    if (topbar.scrollWidth <= topbarWidth + 2) return;
  }

  // Show overflow button, then hide actions from the end until it fits
  overflowWrap.style.display = '';
  const overflowed = [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (topbar.scrollWidth <= topbarWidth + 2) break;
    // Don't overflow items marked noOverflow (star rating needs inline interaction)
    if (actions[i]?.noOverflow) continue;
    items[i].style.display = 'none';
    overflowed.unshift(i);
  }

  if (!overflowed.length) {
    overflowWrap.style.display = 'none';
    return;
  }

  // Build menu items
  menu.innerHTML = overflowed.map(i => {
    const a = actions[i];
    if (a.href) {
      return `<a href="${escapeHtml(a.href)}" target="_blank" rel="noopener" class="flex items-center gap-2 px-3 py-1.5 text-[0.78rem] text-primary hover:bg-hover cursor-pointer" style="text-decoration:none" onclick="_closeTopbarOverflow()">${escapeHtml(a.label)}</a>`;
    }
    return `<div class="flex items-center gap-2 px-3 py-1.5 text-[0.78rem] text-primary hover:bg-hover cursor-pointer" onclick="${a.action}; _closeTopbarOverflow()">${escapeHtml(a.label)}</div>`;
  }).join('');
}

function _toggleTopbarOverflow() {
  const menu = document.getElementById('topbar-overflow-menu');
  if (!menu) return;
  if (menu.style.display !== 'none') {
    _closeTopbarOverflow();
  } else {
    menu.style.display = '';
    setTimeout(() => document.addEventListener('click', _topbarOverflowOutside), 0);
  }
}

function _closeTopbarOverflow() {
  const menu = document.getElementById('topbar-overflow-menu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('click', _topbarOverflowOutside);
}

function _topbarOverflowOutside(e) {
  const wrap = document.getElementById('topbar-overflow-wrap');
  if (wrap && !wrap.contains(e.target)) _closeTopbarOverflow();
}

// ── Paper Viewer (shared) ──
let paperViewOrigin = 'arxiv';

function paperViewGoBack() {
  cleanupPdfViewer();
  dismissPaperExpDropdown();
  dismissAuthorPopover();
  // Use browser history to go back to wherever we came from
  window.history.back();
}

let _currentPaperViewPaper = null;
let _paperOriginExpId = null;
let _paperInsightsLoaded = false;
function togglePaperViewBookmark() {
  if (!_currentPaperViewPaper) return;
  toggleSavePost(_currentPaperViewPaper);
  const btn = document.getElementById('paper-view-bookmark');
  if (!btn) return;
  const saved = isPostSaved(_currentPaperViewPaper.link);
  btn.className = `inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 ${saved ? 'text-accent' : 'text-muted hover:text-primary'}`;
  btn.title = saved ? 'Saved' : 'Save';
  btn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`;
}

// ── Sidebar resize ──
function _initSidebarResize(handle, sidebar) {
  let startX, startW;
  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function onMouseMove(e) {
    const w = Math.max(200, Math.min(700, startW - (e.clientX - startX)));
    sidebar.style.width = w + 'px';
  }
  function onMouseUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('paperSidebarWidth', sidebar.offsetWidth);
  }
  handle.addEventListener('mousedown', onMouseDown);
}

// ── Toggle paper sidebar ──
function togglePaperSidebar() {
  const sidebar = document.getElementById('paper-sidebar');
  if (!sidebar) return;
  const hidden = sidebar.style.display === 'none';
  sidebar.style.display = hidden ? '' : 'none';
}

// ── Open URL in the Internet Browser view ──
function openInBrowser(url) {
  if (typeof openBrowse === 'function') openBrowse(url);
}

// ── Enable notetaking mode ──
function enableNotetakingMode() {
  const sidebar = document.getElementById('paper-sidebar');
  if (sidebar) sidebar.style.display = '';
  switchSidebarTab('notes');
  // Hide the notetaking mode button since we're now in notetaking mode
  const notetakingBtn = document.getElementById('notetaking-mode-btn');
  if (notetakingBtn) notetakingBtn.style.display = 'none';
  // Focus on note textarea if empty
  setTimeout(() => {
    const textarea = document.getElementById('paper-note-textarea');
    const rendered = document.getElementById('paper-note-rendered');
    if (textarea && rendered && rendered.classList.contains('hidden')) {
      textarea.classList.remove('hidden');
      textarea.focus();
    }
  }, 100);
}

function toggleBrowseSidebar() {
  const sidebar = document.getElementById('browse-sidebar');
  if (!sidebar) return;
  const hidden = sidebar.style.display === 'none';
  sidebar.style.display = hidden ? '' : 'none';
}

// ── Shared sidebar rendering ──
function _renderSidebarHTML() {
  const username = escapeHtml((_authUserInfo && _authUserInfo.username) || _authUser || 'Anonymous');
  const notesPanel = `
    <div id="paper-notes-section">
      <div id="paper-note-editor" class="hidden">
        <div id="paper-note-rendered" class="hidden text-[0.82rem] text-primary leading-relaxed nb-rendered-md cursor-text" data-latex onclick="startPaperNoteEdit()"></div>
        <textarea id="paper-note-textarea" class="hidden w-full bg-transparent border-none text-[0.82rem] text-primary p-0 resize-none focus:outline-none" rows="6" placeholder="Write your note…"></textarea>
      </div>
    </div>
  `;
  const chatPanel = `
    <div class="flex-1 flex flex-col border-t border-border-card pt-2" id="doc-chat-section" style="min-height:0">
      <div class="doc-chat-bar" id="doc-chat-bar" onclick="toggleDocChat()">
        <span id="doc-chat-chevron">▾</span>
        <span>Chat</span>
        <span class="doc-chat-status-inline text-dim text-[0.72rem] ml-auto" id="doc-chat-status-inline"></span>
      </div>
      <div class="flex flex-col" id="doc-chat-panel" style="min-height:0;flex:1">
        <div class="doc-chat-status" id="doc-chat-status"></div>
        <div class="doc-chat-messages" id="doc-chat-messages"></div>
        <div class="doc-chat-input-row">
          <input id="doc-chat-input" placeholder="Ask about this document…" onkeydown="if(event.key==='Enter')sendDocMessage()" />
          <button onclick="sendDocMessage()" id="doc-chat-send">Send</button>
        </div>
      </div>
    </div>
  `;
  const commentsPanel = `
    <div class="flex flex-col flex-1 min-h-0">
      <div id="comments-list" class="flex-1 overflow-y-auto"></div>
      <div class="border-t border-border-card pt-2 mt-2 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[0.72rem] text-dim">Posting as</span>
          <span class="text-[0.78rem] text-primary font-medium">${username}</span>
        </div>
        <textarea id="comment-input" class="w-full text-[0.78rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a comment..."></textarea>
        <button onclick="postComment()" class="mt-1 px-3 py-1 text-[0.78rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none font-medium">Post</button>
      </div>
    </div>
  `;
  return `
    <div class="sidebar-tab-toolbar">
      <button id="sidebar-tab-insights" class="sidebar-tab-btn active" onclick="switchSidebarTab('insights')" title="Insights"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-notes" class="sidebar-tab-btn" onclick="switchSidebarTab('notes')" title="Notes"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-chat" class="sidebar-tab-btn" onclick="switchSidebarTab('chat')" title="Chat"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg></button>
      <button id="sidebar-tab-comments" class="sidebar-tab-btn" onclick="switchSidebarTab('comments')" title="Comments"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" /></svg></button>
    </div>
    <div id="paper-selection-mirror" class="mx-4 mt-3 mb-3 shrink-0 hidden"></div>
    <div id="sidebar-pane-insights" class="flex flex-col flex-1 min-h-0">
      <div class="insight-subtabs px-4 pt-2 pb-1 border-b border-border-card flex gap-1 shrink-0">
        <button class="insight-subtab active" data-subtab="authors" onclick="switchInsightSubtab('authors')">Authors</button>
        <button class="insight-subtab" data-subtab="ai" onclick="switchInsightSubtab('ai')">AI</button>
        <button class="insight-subtab" data-subtab="references" onclick="switchInsightSubtab('references')">References</button>
        <button class="insight-subtab" data-subtab="links" onclick="switchInsightSubtab('links')">Links</button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <div id="insight-pane-authors" class="insight-subpane"></div>
        <div id="insight-pane-ai" class="insight-subpane" style="display:none"></div>
        <div id="insight-pane-references" class="insight-subpane" style="display:none"></div>
        <div id="insight-pane-links" class="insight-subpane" style="display:none">
          <div id="pdf-links-section"></div>
        </div>
      </div>
    </div>
    <div id="sidebar-pane-notes" class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style="display:none">
      <div id="pdf-highlights-section">
        <div id="pdf-highlights-panel"></div>
      </div>
      ${notesPanel}
    </div>
    <div id="sidebar-pane-chat" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">
      ${chatPanel}
    </div>
    <div id="sidebar-pane-comments" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">
      ${commentsPanel}
    </div>
  `;
}

function _initSidebar(sidebarEl) {
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sidebar-resize-handle';
  sidebarEl.appendChild(resizeHandle);
  _initSidebarResize(resizeHandle, sidebarEl);
  const savedW = localStorage.getItem('paperSidebarWidth');
  if (savedW) sidebarEl.style.width = savedW + 'px';
}

function _initSidebarForUrl(url) {
  _paperNoteLink = url;
  _docChatPaperUrl = url;
  _docChatMessages = [];
  _docText = '';
  _docTextLoading = false;
  _docChatExpanded = false;
  if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
  _paperNoteSelected = null;
  _paperInsightsLoaded = false; // Reset insights loaded flag for new paper
  _insightsDataCache = null; // Clear cached insights data
  _insightSubLoaded = { authors: false, ai: false, references: false, links: false };
  // Reset scroll positions for new paper
  _sidebarScrollPositions = {};
  fetchPaperNotes();
  fetchPaperComments();
  // Restore saved sidebar tab
  const savedTab = localStorage.getItem('sidebarTab');
  if (savedTab && ['insights', 'notes', 'chat', 'comments'].includes(savedTab)) {
    setTimeout(() => switchSidebarTab(savedTab), 0);
  }
}

// ── Add to project dropdown ──
let _paperExpDropdown = null;

function togglePaperExpDropdown() {
  if (_paperExpDropdown) { dismissPaperExpDropdown(); return; }
  const wrap = document.getElementById('paper-exp-btn-wrap');
  if (!wrap) return;
  const btnRect = wrap.getBoundingClientRect();

  const dropdown = document.createElement('div');
  dropdown.className = 'paper-exp-dropdown';
  dropdown.style.cssText = `position:fixed;top:${btnRect.bottom + 4}px;min-width:220px;max-height:260px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;`;
  // Align right edge to button right edge
  dropdown.style.right = (window.innerWidth - btnRect.right) + 'px';

  dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">Loading...</div>';
  document.body.appendChild(dropdown);

  // Fetch experiments
  fetch('/api/experiments', { headers: _authHeaders() }).then(r => r.json()).then(exps => {
    dropdown.innerHTML = '';
    if (!exps.length) {
      dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">No projects yet</div>';
      return;
    }
    const paper = _currentPaperViewPaper;
    exps.forEach(exp => {
      const papers = exp.papers || [];
      const isLinked = papers.some(p => p.link === paper.link);
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 12px;font-size:0.78rem;transition:background 0.1s;';
      item.onmouseenter = () => item.style.background = 'var(--bg-hover)';
      item.onmouseleave = () => item.style.background = 'none';
      if (isLinked) {
        // Linked: click row to navigate to experiment, × to unlink
        const link = document.createElement('button');
        link.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:none;background:none;color:var(--accent);font-size:0.78rem;cursor:pointer;text-align:left;padding:0;';
        link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" style="flex-shrink:0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exp.title)}</span>`;
        link.onclick = (e) => { e.stopPropagation(); dismissPaperExpDropdown(); openExperimentDetail(exp.id); };
        item.appendChild(link);
        const unlinkBtn = document.createElement('button');
        unlinkBtn.style.cssText = 'border:none;background:none;color:var(--text-dimmest);cursor:pointer;padding:0 2px;font-size:0.9rem;line-height:1;flex-shrink:0;';
        unlinkBtn.innerHTML = '&times;';
        unlinkBtn.title = 'Remove from project';
        unlinkBtn.onmouseenter = () => unlinkBtn.style.color = 'var(--text-primary)';
        unlinkBtn.onmouseleave = () => unlinkBtn.style.color = 'var(--text-dimmest)';
        unlinkBtn.onclick = (e) => { e.stopPropagation(); togglePaperInExperiment(exp.id, paper, true, papers); };
        item.appendChild(unlinkBtn);
      } else {
        // Not linked: click to add
        const addBtn = document.createElement('button');
        addBtn.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;text-align:left;padding:0;';
        addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dimmest)" stroke-width="2" style="flex-shrink:0"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exp.title)}</span>`;
        addBtn.onclick = (e) => { e.stopPropagation(); togglePaperInExperiment(exp.id, paper, false, papers); };
        item.appendChild(addBtn);
      }
      dropdown.appendChild(item);
    });
  }).catch(() => {
    dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">Failed to load</div>';
  });
  _paperExpDropdown = dropdown;

  setTimeout(() => document.addEventListener('mousedown', _dismissPaperExpHandler), 0);
}

function _dismissPaperExpHandler(e) {
  if (_paperExpDropdown && !_paperExpDropdown.contains(e.target)) {
    dismissPaperExpDropdown();
  }
}

function dismissPaperExpDropdown() {
  if (_paperExpDropdown) { _paperExpDropdown.remove(); _paperExpDropdown = null; }
  document.removeEventListener('mousedown', _dismissPaperExpHandler);
}

// ── Unified Share Dropdown (projects + teams) ──
let _shareDropdown = null;

function toggleShareDropdown() {
  if (_shareDropdown) { _shareDropdown.remove(); _shareDropdown = null; return; }
  const wrap = document.getElementById('paper-share-btn-wrap');
  if (!wrap) return;
  const btnRect = wrap.getBoundingClientRect();

  const dd = document.createElement('div');
  dd.className = 'paper-exp-dropdown';
  dd.style.cssText = `position:fixed;top:${btnRect.bottom + 4}px;min-width:240px;max-height:360px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10001;padding:4px 0;`;
  dd.style.right = (window.innerWidth - btnRect.right) + 'px';
  dd.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">Loading...</div>';
  document.body.appendChild(dd);
  _shareDropdown = dd;

  const close = (e) => {
    if (_shareDropdown && !_shareDropdown.contains(e.target) && !wrap.contains(e.target)) {
      _shareDropdown.remove(); _shareDropdown = null;
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);

  const paper = _currentPaperViewPaper;
  // Load both projects and teams
  Promise.all([
    fetch('/api/experiments', { headers: _authHeaders() }).then(r => r.json()).catch(() => []),
    (typeof _cachedTeams !== 'undefined' && _cachedTeams.length ? Promise.resolve(_cachedTeams) : (typeof fetchTeams === 'function' ? fetchTeams().then(() => _cachedTeams) : Promise.resolve([]))),
  ]).then(([exps, teams]) => {
    if (!_shareDropdown) return;
    let html = '';

    // Projects section
    html += '<div style="padding:4px 12px 4px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Add to project</div>';
    if (exps.length) {
      for (const exp of exps) {
        const papers = exp.papers || [];
        const isLinked = papers.some(p => p.link === paper.link);
        const icon = isLinked
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" style="flex-shrink:0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dimmest)" stroke-width="2" style="flex-shrink:0"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>`;
        html += `<div class="share-dd-exp hover:bg-hover" data-exp-id="${exp.id}" data-linked="${isLinked}" style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.78rem;color:${isLinked ? 'var(--accent)' : 'var(--text-primary)'}">
          ${icon}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exp.title)}</span>
        </div>`;
      }
    } else {
      html += '<div style="padding:4px 12px 8px;font-size:0.78rem;color:var(--text-dim)">No projects yet</div>';
    }

    // Teams section
    if (teams && teams.length) {
      html += '<div style="height:1px;background:var(--border-card);margin:4px 0"></div>';
      html += '<div style="padding:4px 12px 4px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Share to team</div>';
      for (const t of teams) {
        html += `<div class="hover:bg-hover" style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.78rem;color:var(--text-primary)" onclick="sharePaperToTeam(${t.id}, '${escapeAttr(t.name)}', false, this);if(_shareDropdown){_shareDropdown.remove();_shareDropdown=null;}">
          <div style="width:20px;height:20px;border-radius:5px;background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${escapeHtml(t.name[0].toUpperCase())}</div>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.name)}</span>
        </div>`;
      }
    }

    dd.innerHTML = html;

    // Attach click handlers for project items
    dd.querySelectorAll('.share-dd-exp').forEach(el => {
      el.addEventListener('click', () => {
        const expId = el.dataset.expId;
        const isLinked = el.dataset.linked === 'true';
        const exp = exps.find(e => e.id === expId);
        if (exp) togglePaperInExperiment(expId, paper, isLinked, exp.papers || []);
        if (_shareDropdown) { _shareDropdown.remove(); _shareDropdown = null; }
      });
    });
  });
}

function togglePaperInExperiment(expId, paper, isLinked, currentPapers) {
  let papers;
  if (isLinked) {
    papers = currentPapers.filter(p => p.link !== paper.link);
  } else {
    papers = [...currentPapers, { link: paper.link, title: paper.title, source: paper.source, addedAt: new Date().toISOString() }];
  }
  fetch(`/api/experiments/${expId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ papers })
  }).then(() => {
    dismissPaperExpDropdown();
    togglePaperExpDropdown(); // re-open to show updated state
  });
}

function showPaperView(paper, hashValue) {
  markPostRead(paper.link);
  if (typeof petReact === 'function') petReact('happy');
  hideAllViews();
  const view = document.getElementById('paper-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = hashValue;

  const topbar = document.getElementById('paper-topbar');
  const sidebar = document.getElementById('paper-sidebar');
  const isHN = paper.source === 'hn';
  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/(abs|pdf)\//.test(paper.link);
  const hnDiscussionUrl = paper.hnId ? `https://news.ycombinator.com/item?id=${paper.hnId}` : '';
  _currentPaperViewPaper = paper;
  const isSaved = isPostSaved(paper.link);
  const bookmarkBtn = `<button id="paper-view-bookmark" class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 ${isSaved ? 'text-accent' : 'text-muted hover:text-primary'}" onclick="togglePaperViewBookmark()" title="${isSaved ? 'Saved' : 'Save'}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg></button>`;

  // ── Top bar: back + metadata compact ──
  const _backLabels = { saved: 'Reading List', search: 'Search', browse: 'Browse', experiment: 'Project', arxiv: 'Feed', feed: 'Feed', dashboard: 'Home', inbox: 'Inbox', calendar: 'Calendar', settings: 'Settings' };
  const backLabel = _backLabels[paperViewOrigin] || 'Back';
  const backBtn = `<button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center gap-1 hover:text-primary shrink-0" onclick="paperViewGoBack()"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg><span class="text-[0.75rem]">${backLabel}</span></button>`;
  const sourceName = SOURCE_NAMES[paper.source] || (paper.source?.startsWith('custom:') ? paper.source.slice(7) : '');

  let metaParts = [];
  if (sourceName) metaParts.push(`<span class="text-meta-value shrink-0">${escapeHtml(sourceName)}</span>`);
  if (paper.authors) metaParts.push(`<span class="text-muted truncate topbar-scroll-span max-w-[300px]">${escapeHtml(paper.authors)}</span>`);
  if (paper.published) metaParts.push(`<span class="text-dim shrink-0">${paper.published}</span>`);
  if (isHN && paper.hnScore) metaParts.push(`<span class="text-[#f60] font-semibold shrink-0">${paper.hnScore} pts</span>`);
  if (isHN && hnDiscussionUrl) metaParts.push(`<a href="${hnDiscussionUrl}" target="_blank" rel="noopener" class="text-link no-underline hover:underline shrink-0">${paper.hnComments} comments</a>`);
  if (paper.commentsUrl) metaParts.push(`<a href="${paper.commentsUrl}" target="_blank" rel="noopener" class="text-link no-underline hover:underline shrink-0">discussion</a>`);
  if (paper.categories && paper.categories.length) metaParts.push(...paper.categories.slice(0, 3).map(c => {
    const fullName = ARXIV_CAT_NAMES[c] || '';
    return `<span class="text-[0.68rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border shrink-0 cursor-default" ${fullName ? `title="${escapeHtml(fullName)}"` : ''}>${escapeHtml(c)}</span>`;
  }));

  const sidebarToggleBtn = '';

  // Action items: each has label (for overflow menu), html (inline button), and optional id
  const _topbarActions = [
    { label: 'Rate', html: `<span class="shrink-0 text-dimmer">${renderStarRating(paper.link, { size: 'md', interactive: true })}</span>`, noOverflow: true },
    { label: isSaved ? 'Unsave' : 'Save', html: bookmarkBtn, action: 'togglePaperViewBookmark()' },
    { label: 'Share', html: `<div class="relative shrink-0" id="paper-share-btn-wrap"><button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="toggleShareDropdown()" title="Share"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" /></svg></button></div>`, action: 'toggleShareDropdown()' },
    { label: 'Cite', html: `<button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="showCitePopup()" title="Cite paper"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 1 0-2.636 6.364M16.5 12V8.25" /></svg></button>`, action: 'showCitePopup()' },
    { label: 'Open in browser', html: `<button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="openInBrowser('${escapeAttr(paper.link)}')" title="Open in browser"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`, action: "openInBrowser('" + escapeAttr(paper.link) + "')" },
    { label: 'Toggle sidebar', html: `<button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="togglePaperSidebar()" title="Toggle sidebar"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`, action: 'togglePaperSidebar()' },
  ];

  topbar.innerHTML = `
    ${backBtn}
    <span class="w-px h-5 bg-border-dim shrink-0"></span>
    <span class="text-[0.82rem] font-semibold text-white_ truncate topbar-scroll-span">${renderTitle(paper.title)}</span>
    <span class="flex items-center gap-2 text-[0.75rem] shrink-0 ml-auto topbar-meta">${metaParts.join('<span class="text-dimmest shrink-0">·</span>')}</span>
    ${sidebarToggleBtn}
    <span id="topbar-actions" class="flex items-center gap-0.5 shrink-0">
      ${_topbarActions.map((a, i) => `<span class="topbar-action" data-idx="${i}">${a.html}</span>`).join('')}
    </span>
    <div class="relative shrink-0" id="topbar-overflow-wrap" style="display:none">
      <button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="_toggleTopbarOverflow()" title="More actions">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
      <div id="topbar-overflow-menu" style="display:none" class="absolute right-0 top-full mt-1 w-48 py-1 rounded-lg border border-border-card bg-card shadow-lg z-[9999]"></div>
    </div>
  `;

  // Store actions data for overflow menu
  topbar._topbarActions = _topbarActions;
  _setupTopbarOverflow(topbar);

  // ── Sidebar: notes + chat ──
  // Clear browse-sidebar to avoid duplicate IDs
  const browseSb = document.getElementById('browse-sidebar');
  if (browseSb) browseSb.innerHTML = '';

  sidebar.innerHTML = _renderSidebarHTML();
  _initSidebar(sidebar);

  const pdfContainer = document.getElementById('paper-pdf-container');
  cleanupPdfViewer();
  pdfContainer.innerHTML = '';
  const arxivId = isArxiv ? (paper.arxivId || (paper.link.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '') : '';
  if (arxivId) {
    initPdfViewer(pdfContainer, `/api/arxiv-pdf?id=${encodeURIComponent(arxivId)}`, arxivId);
  } else {
    _tryRenderSavedContent(pdfContainer, paper);
  }

  _initSidebarForUrl(paper.link);

  // Start scroll progress tracking
  _startScrollTracker(paper.link);

  // Check for OpenReview link (async, non-blocking)
  checkOpenReview(paper.title);
}

// ── Post Quote from Viewer ──
function postQuoteFromViewer() {
  const input = document.getElementById('paper-quote-input');
  if (input && input.value.trim()) { _postQuoteText(input.value.trim()); input.value = ''; }
}

// ── Paper Insights ──
async function _verifyInsightsInPdf(insights) {
  // Skip verification for non-PDF views (e.g. iframe websites) — no text layers to check
  const pdfContainer = document.querySelector('.pdf-pages-container');
  if (!pdfContainer) return insights;
  // Wait for at least some PDF text layers to render (up to 8s, checking every 500ms)
  if (typeof pdfTextExists === 'function') {
    for (let attempt = 0; attempt < 16; attempt++) {
      if (pdfContainer.querySelector('.textLayer span')) break;
      await new Promise(r => setTimeout(r, 500));
    }
    return insights.filter(insight => {
      const q = insight.text.replace(/\.\.\.$/, '');
      return pdfTextExists(q);
    });
  }
  return insights;
}

// Track which insight sub-tabs have been loaded
let _insightSubLoaded = { authors: false, ai: false, references: false, links: false };

async function fetchPaperInsights(url) {
  _paperInsightsLoaded = true;
  _insightSubLoaded = { authors: false, ai: false, references: false, links: false };

  // Restore saved subtab or default to authors
  const savedSubtab = localStorage.getItem('insightSubtab');
  const activeSubtab = (savedSubtab && ['authors', 'ai', 'references', 'links'].includes(savedSubtab)) ? savedSubtab : 'authors';
  setTimeout(() => switchInsightSubtab(activeSubtab), 0);
}

function _loadInsightSubtab(subtab) {
  if (_insightSubLoaded[subtab]) return;
  _insightSubLoaded[subtab] = true;
  const url = _currentPaperViewPaper?.link;
  if (!url) return;

  if (subtab === 'authors' || subtab === 'ai') {
    _fetchAuthorsAndAI(url, subtab);
  } else if (subtab === 'references') {
    _fetchReferences(url);
  }
  // 'links' is rendered from PDF extraction, no fetch needed
}

let _insightsDataCache = null;

async function _fetchAuthorsAndAI(url, requestedTab) {
  // Both authors and AI come from the same endpoint; cache the result
  if (_insightsDataCache) {
    if (requestedTab === 'authors') _renderAuthorsPane(_insightsDataCache);
    if (requestedTab === 'ai') _renderAIPane(_insightsDataCache);
    return;
  }

  const pane = document.getElementById(`insight-pane-${requestedTab}`);
  if (pane) pane.innerHTML = `<div class="flex items-center gap-2 text-[0.75rem] text-dim py-1"><span class="spinner"></span>Loading...</div>`;

  try {
    const resp = await fetch('/api/paper-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowHeuristics: localStorage.getItem('insightsAllowHeuristics') !== 'false' })
    });
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    _insightsDataCache = data;

    // Merge repo links
    if (data.repos?.length) {
      for (const repo of data.repos) _pdfExtractedLinks.add(repo.url);
      _renderPdfLinks();
    }

    _renderAuthorsPane(data);
    // Mark AI as loaded too since we have the data
    _insightSubLoaded.ai = true;
    _renderAIPane(data);
  } catch (e) {
    console.error('[Insights] Error:', e);
    if (pane) pane.innerHTML = '<div class="text-[0.75rem] text-dimmer">Failed to load</div>';
  }
}

function _renderAuthorsPane(data) {
  const authorsPane = document.getElementById('insight-pane-authors');
  if (!authorsPane) return;
  const hasAuthors = data.authors?.length > 0;
  if (!hasAuthors) { authorsPane.innerHTML = '<div class="text-[0.75rem] text-dimmer">No author data available</div>'; return; }

  const fmtNum = (n) => {
    if (!n) return null;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };
  let html = '<div class="space-y-1" id="paper-authors-list">';
  for (let i = 0; i < data.authors.length; i++) {
    const author = data.authors[i];
    const stats = [];
    if (author.paperCount) stats.push(`${fmtNum(author.paperCount)} papers`);
    if (author.hIndex) stats.push(`h-index ${author.hIndex}`);
    if (author.citationCount) stats.push(`${fmtNum(author.citationCount)} citations`);
    html += `<div class="author-card" data-idx="${i}">
      <div class="author-card-avatar">${escapeHtml((author.name || '?')[0].toUpperCase())}</div>
      <div class="author-card-info">
        <div class="author-card-name">${escapeHtml(author.name)}</div>
        ${author.affiliation ? `<div class="author-card-affiliation">${escapeHtml(author.affiliation)}</div>` : ''}
        ${stats.length ? `<div class="author-card-stats">${stats.join(' · ')}</div>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';
  authorsPane.innerHTML = html;
  window._insightAuthors = data.authors;

  const authorsList = document.getElementById('paper-authors-list');
  if (authorsList) {
    authorsList.querySelectorAll('[data-idx]').forEach(card => {
      const idx = parseInt(card.dataset.idx);
      const author = window._insightAuthors[idx];
      if (!author) return;
      card.addEventListener('mouseenter', () => { if (author.name) pdfSearchHighlight(author.name, true); });
      card.addEventListener('mouseleave', pdfClearSearchHighlights);
      card.addEventListener('click', () => {
        if (author.authorId) {
          openAuthorProfile(author.authorId);
        } else if (author.name) {
          pdfSearchHighlight(author.name, false);
        }
      });
      card.style.cursor = 'pointer';
    });
  }
}

async function _renderAIPane(data) {
  const aiPane = document.getElementById('insight-pane-ai');
  if (!aiPane) return;
  const hasInsights = data.insights?.length > 0;
  if (!hasInsights) { aiPane.innerHTML = '<div class="text-[0.75rem] text-dimmer">No AI insights available</div>'; return; }

  const verified = await _verifyInsightsInPdf(data.insights);
  const labelColors = { Contribution: 'text-blue-400', Result: 'text-green-400', Method: 'text-purple-400', Surprising: 'text-yellow-400', Design: 'text-orange-400', Hardware: 'text-red-400' };
  let html = '<div class="space-y-2">';
  for (const insight of verified) {
    const searchSnippet = insight.text.replace(/\.\.\.$/, '');
    const colorCls = labelColors[insight.label] || 'text-dim';
    let extraHtml = '';
    if (insight.gpus?.length) {
      extraHtml = `<div class="flex flex-wrap gap-1 mt-1">${insight.gpus.map(g => `<span class="text-[0.68rem] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">${escapeHtml(g)}</span>`).join('')}</div>`;
    }
    const isHardware = insight.label === 'Hardware';
    html += `<div class="insight-card cursor-pointer transition-colors hover:bg-white/5 rounded p-1.5 -mx-1.5" data-q="${escapeHtml(searchSnippet)}" data-click-only="${isHardware}">
      <div class="text-[0.68rem] font-semibold ${colorCls} uppercase tracking-wide mb-0.5">${escapeHtml(insight.label)}</div>
      <div class="text-[0.78rem] text-primary leading-relaxed border-l-2 border-accent/40 pl-2.5 italic">${escapeHtml(insight.text)}</div>
      ${extraHtml}
    </div>`;
  }
  html += '</div>';
  aiPane.innerHTML = verified.length ? html : '<div class="text-[0.75rem] text-dimmer">No insights found</div>';

  aiPane.querySelectorAll('.insight-card').forEach(card => {
    const isClickOnly = card.dataset.clickOnly === 'true';
    if (isClickOnly) {
      card.addEventListener('click', () => pdfSearchHighlight(card.dataset.q, false));
    } else {
      card.addEventListener('mouseenter', () => pdfSearchHighlight(card.dataset.q, true));
      card.addEventListener('mouseleave', pdfClearSearchHighlights);
      card.addEventListener('click', () => pdfSearchHighlight(card.dataset.q, false));
    }
  });
}

function _fetchReferences(url) {
  const refsPane = document.getElementById('insight-pane-references');
  if (!refsPane) return;
  const arxivMatch = url.match(/(\d{4}\.\d{4,5})/);
  if (arxivMatch) {
    fetchPaperReferences(arxivMatch[1], refsPane);
  } else {
    refsPane.innerHTML = '<div class="text-[0.75rem] text-dimmer">References only available for arXiv papers</div>';
  }
}

// ── Paper References Section ──
async function fetchPaperReferences(arxivId, containerEl) {
  const section = containerEl || document.getElementById('paper-references-section');
  if (!section) return;

  section.innerHTML = `<div class="flex items-center gap-2 text-[0.75rem] text-dim py-1"><span class="spinner"></span>Loading references...</div>`;

  try {
    console.log('[References] Fetching references for:', arxivId);
    const resp = await fetch('/api/paper-references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arxivId })
    });
    console.log('[References] Response status:', resp.status);
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    console.log('[References] Data:', data);
    if (data.error) throw new Error(data.error);

    let refs = data.references || [];
    if (!refs.length) {
      section.innerHTML = '<div class="text-[0.75rem] text-dimmer">No references found</div>';
      return;
    }

    // Sort by citation count (most cited first) since S2 doesn't preserve paper's citation order
    refs = refs.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));

    const fmtNum = (n) => {
      if (!n) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toLocaleString();
    };

    // Sorted by citation count since S2 doesn't preserve paper's citation order
    let html = `<div class="text-[0.68rem] text-dimmer mb-2">${refs.length} cited papers (sorted by influence)</div><div class="space-y-1" id="references-list">`;
    for (const ref of refs) {
      const authorsStr = ref.authors?.slice(0, 2).join(', ') + (ref.authors?.length > 2 ? ' et al.' : '');
      html += `<div class="reference-item cursor-pointer rounded px-2 py-1.5 hover:bg-white/5 transition-colors" data-ref-title="${escapeHtml(ref.title || '')}" data-arxiv-id="${arxivId}">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-[0.75rem] text-primary leading-snug line-clamp-2">${escapeHtml(ref.title || 'Unknown')}</div>
            <div class="text-[0.68rem] text-dimmer mt-0.5">${authorsStr ? escapeHtml(authorsStr) : ''}${ref.year ? (authorsStr ? ' · ' : '') + ref.year : ''}${ref.citationCount ? ' · ' + fmtNum(ref.citationCount) + ' citations' : ''}</div>
          </div>
        </div>
      </div>`;
    }
    html += '</div>';
    section.innerHTML = html;

    // Add click handlers - search by title since S2 doesn't preserve order
    section.querySelectorAll('.reference-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const title = item.dataset.refTitle;
        if (title) {
          showReferenceByTitle(title, item);
        }
      });
    });
  } catch (e) {
    console.error('[References] Error:', e);
    const isRateLimit = e.message?.includes('429');
    section.innerHTML = `<div class="text-[0.75rem] text-dimmer">${isRateLimit ? 'Rate limited - try again in a minute' : 'Could not load references'}</div>`;
  }
}

function showReferencePopup(refNum, arxivId, anchorEl) {
  // Reuse the citation popup from pdfviewer.js
  if (typeof showCitationPopup === 'function') {
    showCitationPopup(refNum, anchorEl);
  }
}

async function showReferenceByTitle(title, anchorEl) {
  // Show popup and search by title
  if (typeof dismissCitationPopup === 'function') dismissCitationPopup();

  const popup = document.createElement('div');
  popup.className = 'citation-popup';
  popup.innerHTML = `<div class="citation-popup-loading"><span class="spinner"></span> Looking up paper...</div>`;
  document.body.appendChild(popup);
  if (typeof _citationPopup !== 'undefined') window._citationPopup = popup;

  // Position popup
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.top = (rect.bottom + 8) + 'px';

  try {
    const resp = await fetch('/api/citation-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: title })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    if (typeof renderCitationPopup === 'function') {
      renderCitationPopup(popup, data);
    } else {
      // Fallback rendering
      const fmtNum = (n) => n >= 1000 ? (n/1000).toFixed(1) + 'K' : n;
      popup.innerHTML = `
        <div class="citation-popup-title">${escapeHtml(data.title || 'Unknown')}</div>
        <div class="citation-popup-meta">${data.authors?.slice(0,3).join(', ')}${data.year ? ' · ' + data.year : ''}</div>
        ${data.abstract ? `<div class="citation-popup-abstract">${escapeHtml(data.abstract.slice(0,200))}...</div>` : ''}
        <div class="citation-popup-footer">
          <span class="citation-popup-cited">Cited by ${fmtNum(data.citationCount || 0)}</span>
          ${data.url ? `<a href="${data.url}" target="_blank" class="citation-popup-link">View paper →</a>` : ''}
        </div>
      `;
    }
  } catch (e) {
    popup.innerHTML = `<div class="citation-popup-error">Could not find paper info</div>`;
  }
}

// ── Author Popover (legacy, kept for cleanup function) ──
function dismissAuthorPopover() {
  // No-op, tooltip removed
}

// ── Author Profile Page ──
async function openAuthorProfile(authorId) {
  hideAllViews();
  const view = document.getElementById('author-profile-view');
  const content = document.getElementById('author-profile-content');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = `author/${authorId}`;
  setSidebarActive('');

  content.innerHTML = `
    <div class="flex items-center justify-center py-16">
      <span class="spinner"></span>
      <span class="ml-3 text-muted">Loading researcher profile...</span>
    </div>
  `;

  try {
    const resp = await fetch('/api/author-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorId })
    });
    if (!resp.ok) throw new Error('Failed to fetch author details');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    let html = `
      <button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center gap-1 hover:text-primary mb-6" onclick="history.back()">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        <span class="text-[0.75rem]">Back</span>
      </button>

      <div class="flex items-start gap-6 mb-8">
        <div class="w-20 h-20 rounded-full bg-accent flex items-center justify-center text-white text-3xl font-semibold flex-shrink-0">
          ${(data.name || '?')[0].toUpperCase()}
        </div>
        <div class="flex-1">
          <h1 class="text-2xl font-bold text-primary mb-1">${escapeHtml(data.name || 'Unknown')}</h1>
          ${data.affiliations && data.affiliations.length ? `<p class="text-muted text-sm">${escapeHtml(data.affiliations.join(' · '))}</p>` : ''}
          <div class="flex items-center gap-3 mt-3">
            ${data.homepage ? `<a href="${escapeHtml(data.homepage)}" target="_blank" class="text-sm text-accent hover:underline">Homepage</a>` : ''}
            ${data.url ? `<a href="${escapeHtml(data.url)}" target="_blank" class="text-sm text-accent hover:underline">Semantic Scholar</a>` : ''}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-4 mb-8">
        <div class="bg-card border border-border-card rounded-xl p-5 text-center">
          <div class="text-3xl font-bold text-accent">${data.hIndex || '—'}</div>
          <div class="text-xs text-muted uppercase tracking-wide mt-1">h-index</div>
        </div>
        <div class="bg-card border border-border-card rounded-xl p-5 text-center">
          <div class="text-3xl font-bold text-accent">${data.citationCount ? data.citationCount.toLocaleString() : '—'}</div>
          <div class="text-xs text-muted uppercase tracking-wide mt-1">Citations</div>
        </div>
        <div class="bg-card border border-border-card rounded-xl p-5 text-center">
          <div class="text-3xl font-bold text-accent">${data.paperCount ? data.paperCount.toLocaleString() : '—'}</div>
          <div class="text-xs text-muted uppercase tracking-wide mt-1">Papers</div>
        </div>
      </div>
    `;

    // Papers section
    if (data.papers && data.papers.length) {
      html += `
        <div class="mb-4">
          <h2 class="text-lg font-semibold text-primary mb-4">Top Papers</h2>
          <div class="space-y-3">
      `;
      for (const paper of data.papers) {
        const citations = paper.citationCount || 0;
        html += `
          <div class="bg-card border border-border-card rounded-lg p-4 hover:border-accent/50 transition-colors cursor-pointer" onclick="${paper.url ? `window.open('${escapeHtml(paper.url)}', '_blank')` : ''}">
            <div class="font-medium text-primary mb-2">${escapeHtml(paper.title || 'Untitled')}</div>
            <div class="flex items-center gap-4 text-xs text-muted">
              ${paper.year ? `<span>${paper.year}</span>` : ''}
              ${paper.venue ? `<span class="truncate max-w-[200px]">${escapeHtml(paper.venue)}</span>` : ''}
              <span class="ml-auto font-medium ${citations > 100 ? 'text-accent' : ''}">${citations.toLocaleString()} citations</span>
            </div>
          </div>
        `;
      }
      html += '</div></div>';
    }

    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `
      <button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center gap-1 hover:text-primary mb-6" onclick="history.back()">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        <span class="text-[0.75rem]">Back</span>
      </button>
      <div class="text-center py-16">
        <div class="text-muted mb-2">Failed to load researcher profile</div>
        <div class="text-dimmer text-sm">${escapeHtml(e.message)}</div>
      </div>
    `;
  }
}

// ── OpenReview Link ──
async function checkOpenReview(title) {
  try {
    const resp = await fetch('/api/openreview-search?' + new URLSearchParams({ title }));
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.url) {
      _pdfExtractedLinks.add(data.url);
      _renderPdfLinks();
    }
  } catch {}
}

// ── Share to Team ──
let _shareDropdownOpen = false;

async function toggleShareToTeamDropdown() {
  const wrap = document.getElementById('paper-share-btn-wrap');
  if (!wrap) return;
  const existing = document.querySelector('.share-team-dropdown');
  if (existing) { existing.remove(); _shareDropdownOpen = false; return; }

  _shareDropdownOpen = true;
  const dd = document.createElement('div');
  dd.className = 'share-team-dropdown';
  dd.style.cssText = 'position:fixed;z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:6px 0;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:12px';
  dd.innerHTML = '<div style="padding:4px 12px;color:var(--text-dimmer);font-size:11px">Loading teams...</div>';
  document.body.appendChild(dd);
  const btnRect = wrap.getBoundingClientRect();
  dd.style.top = (btnRect.bottom + 4) + 'px';
  dd.style.right = (window.innerWidth - btnRect.right) + 'px';

  // Close on outside click
  const closeHandler = (e) => {
    if (!dd.contains(e.target) && !wrap.contains(e.target)) { dd.remove(); _shareDropdownOpen = false; document.removeEventListener('click', closeHandler, true); }
  };
  setTimeout(() => document.addEventListener('click', closeHandler, true), 0);

  if (!_cachedTeams.length) await fetchTeams();
  if (!_cachedTeams.length) {
    dd.innerHTML = '<div style="padding:8px 12px;color:var(--text-dimmer)">No teams yet</div>';
    return;
  }

  // Check if paper has highlights or notes
  const paper = _currentPaperViewPaper;
  const arxivId = paper ? (paper.arxivId || (paper.link.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '') : '';
  const highlights = arxivId && typeof loadPdfHighlights === 'function' ? loadPdfHighlights(arxivId) : [];
  const note = _paperNotes.find(n => n.id === _paperNoteSelected);
  const noteContent = note && note.content ? note.content.trim() : '';
  const hasAnnotations = highlights.length > 0 || noteContent.length > 0;

  dd.innerHTML = '<div style="padding:4px 12px 6px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Share to team chat</div>' +
    _cachedTeams.map(t => {
      const teamRow = `<div style="display:flex;align-items:center;gap:8px"><div style="width:24px;height:24px;border-radius:6px;background:color-mix(in srgb, var(--accent) 20%, transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${escapeHtml(t.name[0].toUpperCase())}</div><span>${escapeHtml(t.name)}</span></div>`;
      if (!hasAnnotations) {
        return `<div class="hover:bg-hover" style="padding:6px 12px;cursor:pointer;color:var(--text-primary)" onclick="sharePaperToTeam(${t.id}, '${escapeAttr(t.name)}', false, this)">${teamRow}</div>`;
      }
      return `<div class="share-team-row" style="padding:6px 12px;color:var(--text-primary)">
        ${teamRow}
        <div style="display:flex;gap:6px;margin-top:6px;margin-left:32px">
          <button onclick="sharePaperToTeam(${t.id}, '${escapeAttr(t.name)}', false, this.closest('.share-team-row'))" style="font-size:0.68rem;padding:3px 8px;border-radius:4px;border:1px solid var(--border-input);background:transparent;color:var(--text-muted);cursor:pointer">Link only</button>
          <button onclick="sharePaperToTeam(${t.id}, '${escapeAttr(t.name)}', true, this.closest('.share-team-row'))" style="font-size:0.68rem;padding:3px 8px;border-radius:4px;border:1px solid var(--accent);background:color-mix(in srgb, var(--accent) 10%, transparent);color:var(--accent);cursor:pointer">With notes</button>
        </div>
      </div>`;
    }).join('');
}

async function sharePaperToTeam(teamId, teamName, withNotes, el) {
  const paper = _currentPaperViewPaper;
  if (!paper) return;
  if (el) { el.style.pointerEvents = 'none'; el.style.opacity = '0.5'; }

  let content = paper.link;
  if (withNotes) {
    const arxivId = paper.arxivId || (paper.link.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '';
    const highlights = arxivId && typeof loadPdfHighlights === 'function' ? loadPdfHighlights(arxivId) : [];
    const note = _paperNotes.find(n => n.id === _paperNoteSelected);
    const noteContent = note && note.content ? note.content.trim() : '';
    const parts = [paper.link];
    if (highlights.length) {
      parts.push('\n--- Highlights ---');
      highlights.forEach(h => {
        const quote = h.text.length > 200 ? h.text.slice(0, 200) + '...' : h.text;
        let line = `> ${quote}`;
        if (h.note) line += `\n  Note: ${h.note}`;
        parts.push(line);
      });
    }
    if (noteContent) {
      parts.push('\n--- Notes ---');
      parts.push(noteContent.length > 500 ? noteContent.slice(0, 500) + '...' : noteContent);
    }
    content = parts.join('\n');
  }

  try {
    const resp = await fetch(`/api/teams/${teamId}/messages`, {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ content })
    });
    if (resp.ok) {
      if (el) { el.innerHTML = `<span style="color:var(--accent)">Shared to ${escapeHtml(teamName)}</span>`; }
      setTimeout(() => {
        const dd = document.querySelector('.share-team-dropdown');
        if (dd) dd.remove();
        _shareDropdownOpen = false;
      }, 800);
    }
  } catch (err) {
    if (el) { el.innerHTML = '<span style="color:#f87171">Failed</span>'; el.style.pointerEvents = ''; el.style.opacity = ''; }
  }
}

// ── Cite Paper ──
let _citePopup = null;

function showCitePopup() {
  if (_citePopup) { dismissCitePopup(); return; }
  const paper = _currentPaperViewPaper;
  if (!paper) return;

  _citePopup = document.createElement('div');
  _citePopup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:12px;padding:20px;min-width:400px;max-width:600px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  _citePopup.innerHTML = `<div class="flex items-center justify-between mb-3"><span class="text-[0.9rem] font-semibold text-white_">Cite</span><button onclick="dismissCitePopup()" class="bg-transparent border-none text-dimmer cursor-pointer hover:text-primary text-lg">&times;</button></div><div class="flex gap-1.5 mb-3"><button onclick="switchCiteFormat('bibtex')" id="cite-fmt-bibtex" class="px-2.5 py-1 rounded-md text-[0.75rem] border cursor-pointer border-accent text-accent bg-accent/10">BibTeX</button><button onclick="switchCiteFormat('apa')" id="cite-fmt-apa" class="px-2.5 py-1 rounded-md text-[0.75rem] border cursor-pointer border-border-input text-muted bg-card hover:text-primary">APA</button></div><pre id="cite-content" class="bg-body border border-border-input rounded-lg p-3 text-[0.78rem] text-primary font-mono whitespace-pre-wrap overflow-auto max-h-[300px] m-0">Loading...</pre><button onclick="copyCitation()" id="cite-copy-btn" class="mt-3 px-3 py-1.5 rounded-md bg-accent text-white text-[0.78rem] border-none cursor-pointer hover:opacity-90">Copy</button>`;
  document.body.appendChild(_citePopup);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'cite-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4)';
  backdrop.onclick = dismissCitePopup;
  document.body.appendChild(backdrop);

  generateCitation('bibtex');
}

function dismissCitePopup() {
  if (_citePopup) { _citePopup.remove(); _citePopup = null; }
  const bd = document.getElementById('cite-backdrop');
  if (bd) bd.remove();
}

function switchCiteFormat(fmt) {
  ['bibtex', 'apa'].forEach(f => {
    const btn = document.getElementById('cite-fmt-' + f);
    if (btn) btn.className = `px-2.5 py-1 rounded-md text-[0.75rem] border cursor-pointer ${f === fmt ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:text-primary'}`;
  });
  generateCitation(fmt);
}

function _citeKey(paper) {
  const first = (paper.authors || '').split(/[,;&]/)[0].trim().split(/\s+/).pop() || 'unknown';
  const year = paper.published ? new Date(paper.published).getFullYear() : new Date().getFullYear();
  const word = (paper.title || '').split(/\s+/).find(w => w.length > 3 && /^[a-zA-Z]/.test(w)) || 'paper';
  return (first + year + word).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function generateCitation(fmt) {
  const el = document.getElementById('cite-content');
  if (!el) return;
  const paper = _currentPaperViewPaper;
  if (!paper) return;

  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/(abs|pdf)\//.test(paper.link);
  const arxivId = isArxiv ? (paper.arxivId || (paper.link.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '') : '';

  let authors = paper.authors || '';
  let title = paper.title || '';
  let year = paper.published ? new Date(paper.published).getFullYear() : '';
  let journal = '';
  let eprint = arxivId;

  // Try to fetch richer metadata from arXiv API
  if (arxivId) {
    try {
      const resp = await fetch('/api/arxiv-search?' + new URLSearchParams({ query: `id:${arxivId}`, max_results: '1' }));
      if (resp.ok) {
        const text = await resp.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const entry = xml.querySelector('entry');
        if (entry) {
          const names = [...entry.querySelectorAll('author name')].map(n => n.textContent);
          if (names.length) authors = names.join(' and ');
          const t = entry.querySelector('title');
          if (t) title = t.textContent.replace(/\s+/g, ' ').trim();
          const pub = entry.querySelector('published');
          if (pub) year = new Date(pub.textContent).getFullYear();
          const cat = entry.querySelector('category');
          if (cat) journal = cat.getAttribute('term') || '';
        }
      }
    } catch {}
  }

  const key = _citeKey(paper);

  if (fmt === 'bibtex') {
    let bib = `@article{${key},\n  title = {${title}},\n  author = {${authors}},\n  year = {${year}}`;
    if (eprint) bib += `,\n  eprint = {${eprint}},\n  archivePrefix = {arXiv}`;
    if (journal) bib += `,\n  primaryClass = {${journal}}`;
    bib += `,\n  url = {${paper.link}}\n}`;
    el.textContent = bib;
  } else {
    // APA format
    const authorList = authors.split(/\s+and\s+|,\s*/).map(a => a.trim()).filter(Boolean);
    let apaAuthors = '';
    if (authorList.length === 1) apaAuthors = authorList[0];
    else if (authorList.length === 2) apaAuthors = authorList.join(' & ');
    else if (authorList.length > 2) apaAuthors = authorList.slice(0, -1).join(', ') + ', & ' + authorList[authorList.length - 1];
    const yearStr = year ? ` (${year})` : '';
    const arxivNote = eprint ? ` arXiv:${eprint}.` : '';
    el.textContent = `${apaAuthors}${yearStr}. ${title}.${arxivNote} ${paper.link}`;
  }
}

function copyCitation() {
  const el = document.getElementById('cite-content');
  const btn = document.getElementById('cite-copy-btn');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
  });
}

// ── Selection Mirror + Search-in-PDF ──
let _selMirrorSearchTimer = null;

document.addEventListener('selectionchange', function() {
  const el = document.getElementById('paper-selection-mirror');
  if (!el) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 2) {
    // Don't hide if user is typing in the search input
    const active = document.activeElement;
    if (active && active.id === 'pdf-find-input') return;
    if (!el.querySelector('#pdf-find-input')) {
      el.classList.add('hidden');
      el.innerHTML = '';
    }
    return;
  }
  // Only show for selections inside the PDF container
  if (sel.anchorNode) {
    const parent = sel.anchorNode.parentElement;
    if (!parent || !parent.closest('#paper-pdf-container')) return;
  }
  _renderSelectionMirror(el, text);
});

function _renderSelectionMirror(el, selectedText) {
  el.classList.remove('hidden');
  el.innerHTML = `<div class="rounded-lg border border-border-card bg-card-bg p-3">
    <div class="flex items-center justify-between mb-1.5">
      <div class="text-[0.72rem] font-semibold text-dim uppercase tracking-wide">Selected Text</div>
    </div>
    <div class="text-[0.78rem] text-primary leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">${escapeHtml(selectedText)}</div>
  </div>`;
}

// Intercept Cmd/Ctrl+F in paper view to focus the PDF toolbar search
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    const paperView = document.getElementById('paper-view');
    if (paperView && paperView.style.display === 'block') {
      const input = document.getElementById('pdf-search-input');
      if (input) { e.preventDefault(); input.focus(); input.select(); }
    }
  }
});

function showPdfFindBar() {
  const input = document.getElementById('pdf-search-input');
  if (input) { input.focus(); input.select(); }
}

function closePdfFindBar() {
  if (typeof pdfClearSearchHighlights === 'function') pdfClearSearchHighlights();
  const input = document.getElementById('pdf-search-input');
  if (input) { input.value = ''; input.blur(); }
}

// ── Paper Notes ──
let _paperNoteSelected = null;
let _paperNoteLink = '';
let _paperNotes = [];
let _paperNoteSaveTimer = null;

async function fetchPaperNotes() {
  try {
    const resp = await fetch('/api/todos', { headers: _authHeaders() });
    const all = await resp.json();
    let note = (all || []).find(n => n.paperLink === _paperNoteLink);
    if (!note) {
      // Auto-create a note for this paper
      note = await _createPaperNote();
    }
    if (note) {
      _paperNotes = [note];
      _paperNoteSelected = note.id;
      renderPaperNoteEditor();
    }
  } catch (e) {
    _paperNotes = [];
  }
}

async function _createPaperNote() {
  const resp = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify({ title: 'Untitled', content: '', paperLink: _paperNoteLink })
  });
  return await resp.json();
}

let _paperNoteEditing = false;

function renderPaperNoteEditor() {
  const editor = document.getElementById('paper-note-editor');
  const rendered = document.getElementById('paper-note-rendered');
  const textarea = document.getElementById('paper-note-textarea');
  if (!editor || !rendered || !textarea) return;
  const note = _paperNotes.find(n => n.id === _paperNoteSelected);
  if (!note) { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');
  if (_paperNoteEditing) {
    rendered.classList.add('hidden');
    textarea.classList.remove('hidden');
    textarea.value = note.content || '';
    textarea.focus();
    textarea.oninput = () => {
      if (_paperNoteSaveTimer) clearTimeout(_paperNoteSaveTimer);
      _paperNoteSaveTimer = setTimeout(() => savePaperNote(note.id, textarea.value), 600);
    };
    textarea.onblur = () => {
      setTimeout(() => {
        _paperNoteEditing = false;
        savePaperNote(note.id, textarea.value);
        renderPaperNoteEditor();
      }, 150);
    };
  } else {
    textarea.classList.add('hidden');
    rendered.classList.remove('hidden');
    const content = note.content || '';
    if (content.trim()) {
      rendered.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');
      // Render LaTeX
      if (typeof katex !== 'undefined') {
        function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
        let html = rendered.innerHTML;
        html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
          try { return katex.renderToString(decodeTex(tex), { displayMode: true, throwOnError: false }); } catch { return _; }
        });
        html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
          try { return katex.renderToString(decodeTex(tex), { displayMode: false, throwOnError: false }); } catch { return _; }
        });
        rendered.innerHTML = html;
      }
    } else {
      rendered.innerHTML = '<span class="text-dimmer">Start taking notes...</span>';
    }
  }
}

function startPaperNoteEdit() {
  _paperNoteEditing = true;
  renderPaperNoteEditor();
}

async function savePaperNote(id, content) {
  try {
    await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ content })
    });
    const note = _paperNotes.find(n => n.id === id);
    if (note) note.content = content;
  } catch (e) { /* silent */ }
}

// ── Paper Comments ──
let _commentsCache = [];

async function fetchPaperComments() {
  const list = document.getElementById('comments-list');
  if (!list) return;
  try {
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(_paperNoteLink));
    _commentsCache = await resp.json();
  } catch (e) {
    _commentsCache = [];
  }
  renderComments();
}

function renderComments() {
  const list = document.getElementById('comments-list');
  if (!list) return;
  if (!_commentsCache.length) {
    list.innerHTML = '<div class="text-dim text-[0.8rem] py-4 text-center">No comments yet</div>';
    return;
  }
  // Build threaded tree
  const topLevel = _commentsCache.filter(c => !c.parentId);
  const byParent = {};
  _commentsCache.forEach(c => {
    if (c.parentId) {
      (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
    }
  });
  // Sort by timestamp
  topLevel.sort((a, b) => a.timestamp - b.timestamp);

  function renderThread(comment, depth) {
    const replies = (byParent[comment.id] || []).sort((a, b) => a.timestamp - b.timestamp);
    const ml = depth > 0 ? `margin-left:${Math.min(depth, 4) * 16}px; border-left: 2px solid var(--border-card); padding-left: 8px;` : '';
    const initial = (comment.author || '?')[0].toUpperCase();
    const timeAgo = _relativeTime(comment.timestamp);
    const currentUsername = (_authUserInfo && _authUserInfo.username) || _authUser || '';
    const isOwn = comment.author === currentUsername;
    const deleteBtn = isOwn ? `<button onclick="deleteComment('${comment.id}')" class="text-dimmest hover:text-red-400 text-[0.7rem] ml-auto" title="Delete" style="background:none;border:none;cursor:pointer;">x</button>` : '';
    let html = `<div class="comment-thread" style="${ml}; margin-bottom: 8px;">
      <div class="flex items-start gap-2">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(initial)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <a href="#profile/${encodeURIComponent(comment.author)}" class="text-[0.75rem] font-medium text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(comment.author)}</a>
            <span class="text-[0.68rem] text-dimmer">${timeAgo}</span>
            ${deleteBtn}
          </div>
          <div class="text-[0.78rem] text-primary mt-0.5 leading-relaxed">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</div>
          <button onclick="showReplyInput('${comment.id}')" class="text-[0.7rem] text-dim hover:text-accent mt-1" style="background:none;border:none;cursor:pointer;">Reply</button>
          <div id="reply-input-${comment.id}" class="hidden mt-1">
            <textarea id="reply-textarea-${comment.id}" class="w-full text-[0.75rem] bg-input border border-border-input rounded px-2 py-1 text-primary resize-none outline-none focus:border-accent" rows="2" placeholder="Write a reply..."></textarea>
            <div class="flex gap-1 mt-1">
              <button onclick="postReply('${comment.id}')" class="px-2 py-0.5 text-[0.72rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none">Reply</button>
              <button onclick="hideReplyInput('${comment.id}')" class="px-2 py-0.5 text-[0.72rem] rounded border border-border-input text-dim hover:text-primary cursor-pointer bg-transparent">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
    replies.forEach(r => { html += renderThread(r, depth + 1); });
    html += '</div>';
    return html;
  }

  list.innerHTML = topLevel.map(c => renderThread(c, 0)).join('');
}

function _relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

async function postComment(parentId) {
  const contentInput = document.getElementById('comment-input');
  if (!contentInput) return;
  const content = contentInput.value.trim();
  if (!content) return;
  const author = (_authUserInfo && _authUserInfo.username) || _authUser || 'Anonymous';
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ paperLink: _paperNoteLink, author, content, parentId: parentId || null })
    });
    contentInput.value = '';
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

async function postReply(parentId) {
  const textarea = document.getElementById('reply-textarea-' + parentId);
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;
  const author = (_authUserInfo && _authUserInfo.username) || _authUser || 'Anonymous';
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ paperLink: _paperNoteLink, author, content, parentId })
    });
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

async function deleteComment(id) {
  try {
    await fetch('/api/comments/' + id, { method: 'DELETE', headers: _authHeaders() });
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

function showReplyInput(id) {
  const el = document.getElementById('reply-input-' + id);
  if (el) { el.classList.remove('hidden'); el.querySelector('textarea')?.focus(); }
}

function hideReplyInput(id) {
  const el = document.getElementById('reply-input-' + id);
  if (el) el.classList.add('hidden');
}

// ── Read Progress Tracking ──
let _scrollTrackerInterval = null;

function _startScrollTracker(link) {
  if (_scrollTrackerInterval) clearInterval(_scrollTrackerInterval);
  _scrollTrackerInterval = setInterval(() => {
    try {
      // PDF viewer — scroll tracked on .pdf-pages-container
      const pdfContainer = document.querySelector('.pdf-pages-container');
      if (pdfContainer) {
        const { scrollTop, scrollHeight, clientHeight } = pdfContainer;
        if (scrollHeight > clientHeight) {
          const progress = Math.min(1, scrollTop / (scrollHeight - clientHeight));
          _saveReadProgress(link, progress);
        }
        return;
      }
      // iframe-based viewer
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

// Store scroll positions per sidebar tab
let _sidebarScrollPositions = {};

function switchSidebarTab(tab) {
  const panes = ['insights', 'notes', 'chat', 'comments'];

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
  // Remember the active tab
  localStorage.setItem('sidebarTab', tab);
}

function switchInsightSubtab(subtab) {
  // Update active button
  document.querySelectorAll('.insight-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === subtab);
  });
  // Show/hide panes
  document.querySelectorAll('.insight-subpane').forEach(pane => {
    pane.style.display = pane.id === `insight-pane-${subtab}` ? '' : 'none';
  });
  // Remember the active subtab
  localStorage.setItem('insightSubtab', subtab);
  // Lazy load this sub-tab's data
  _loadInsightSubtab(subtab);
}

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

async function sendDocMessage(prefill) {
  const input = document.getElementById('doc-chat-input');
  const text = prefill || (input ? input.value.trim() : '');
  if (!text) return;
  if (input) input.value = '';

  _docChatMessages.push({ role: 'user', content: text });
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
    if (m._thinking) {
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
    }
    const isLast = i === _docChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ── Selection popup: state for inline chat ──
let _popupChatMessages = [];
let _popupChatAbort = null;
let _lookupFollowMode = false;
let _lastMouseX = 0;
let _lastMouseY = 0;

function _isLookupEligible(text) {
  if (!text || text.length > 80) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  // Skip if it looks like a sentence (contains sentence-ending punctuation)
  if (/[.!?;]/.test(text)) return false;
  return true;
}

async function _fetchWikipediaPreview(text, containerDiv) {
  const title = text.trim().replace(/\s+/g, '_');
  try {
    const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    if (data.type === 'disambiguation' || !data.extract) { containerDiv.style.display = 'none'; return; }
    const extract = data.extract.length > 200 ? data.extract.slice(0, 200) + '…' : data.extract;
    let html = '<div class="doc-wiki-result">';
    if (data.thumbnail && data.thumbnail.source) {
      html += `<img class="doc-wiki-thumb" src="${data.thumbnail.source}" alt="" />`;
    }
    html += '<div>';
    html += `<div class="doc-wiki-title">${escapeHtml(data.title)}</div>`;
    html += `<div class="doc-wiki-extract">${escapeHtml(extract)}</div>`;
    html += `<a class="doc-wiki-link" href="${data.content_urls?.desktop?.page || '#'}" data-external-link>Wikipedia →</a>`;
    html += '</div></div>';
    containerDiv.innerHTML = html;
    containerDiv.style.display = '';
    containerDiv.querySelectorAll('[data-external-link]').forEach(a => {
      a.addEventListener('mousedown', (ev) => ev.stopPropagation());
      a.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        window.open(a.getAttribute('href'), '_blank');
      });
    });
    _repositionSelectionPopup();
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

function _isAuthorEligible(text) {
  if (!text || text.length > 50) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // All words should start with uppercase (name pattern)
  if (!words.every(w => /^[A-Z\u00C0-\u024F]/.test(w))) return false;
  // No digits, no sentence punctuation
  if (/[\d.!?;:,]/.test(text)) return false;
  return true;
}

function _findKnownAuthor(text) {
  // Check if this author name matches one already loaded in the sidebar Authors tab
  if (!window._insightAuthors?.length) return null;
  const q = text.trim().toLowerCase();
  return window._insightAuthors.find(a => a.name && a.name.toLowerCase() === q) || null;
}

function _renderAuthorPreviewHtml(data, containerDiv) {
  const fmtNum = (n) => {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  let html = '<div class="doc-author-result">';
  html += `<div class="doc-author-name">${escapeHtml(data.name)}</div>`;
  const affil = data.affiliations?.length ? data.affiliations[0] : data.affiliation;
  if (affil) {
    html += `<div class="doc-author-affil">${escapeHtml(affil)}</div>`;
  }
  html += `<div class="doc-author-stats">`;
  if (data.hIndex) html += `<span>h-index: ${data.hIndex}</span>`;
  if (data.paperCount) html += `<span>${fmtNum(data.paperCount)} papers</span>`;
  if (data.citationCount) html += `<span>${fmtNum(data.citationCount)} citations</span>`;
  html += `</div>`;
  if (data.topPapers?.length) {
    html += `<div class="doc-author-papers">`;
    for (const p of data.topPapers) {
      html += `<div class="doc-author-paper">${escapeHtml(p.title)}${p.year ? ` (${p.year})` : ''}${p.citationCount ? ` · ${fmtNum(p.citationCount)}` : ''}</div>`;
    }
    html += `</div>`;
  }
  // Author profile link (opens in-app) and Semantic Scholar link (opens in browser)
  const authorId = data.authorId;
  html += `<div class="doc-ref-footer">`;
  if (authorId) {
    html += `<a class="doc-ref-link" href="#author/${encodeURIComponent(authorId)}" data-author-nav>Profile →</a>`;
  }
  if (data.url) {
    html += `<a class="doc-ref-link" href="${escapeHtml(data.url)}" data-external-link>Semantic Scholar →</a>`;
  }
  html += `</div>`;
  html += '</div>';
  containerDiv.innerHTML = html;
  containerDiv.style.display = '';

  // Wire up link handlers
  containerDiv.querySelectorAll('[data-external-link]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      window.open(a.getAttribute('href'), '_blank');
    });
  });
  containerDiv.querySelectorAll('[data-author-nav]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Remove the popup when navigating to profile
      document.getElementById('doc-chat-ask-float')?.remove();
    });
  });

  _repositionSelectionPopup();
}

async function _fetchAuthorPreview(text, containerDiv) {
  // First check if this author is already known from the sidebar
  const known = _findKnownAuthor(text);
  if (known && known.authorId) {
    // Use the known author data directly — right person guaranteed
    _renderAuthorPreviewHtml(known, containerDiv);
    return;
  }

  try {
    const resp = await fetch('/api/author-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text.trim() })
    });
    if (!resp.ok) { containerDiv.style.display = 'none'; return; }
    const data = await resp.json();
    if (data.error || !data.name) { containerDiv.style.display = 'none'; return; }
    _renderAuthorPreviewHtml(data, containerDiv);
  } catch (e) {
    containerDiv.style.display = 'none';
  }
}

function _sendPopupChatMessage(popup, capturedText) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  // Build user message with context on first message
  const userMsg = _popupChatMessages.length === 0
    ? q + '\n\n> ' + capturedText
    : q;
  _popupChatMessages.push({ role: 'user', content: userMsg, _display: q });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });

  // Show chat area, add has-chat class
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  input.disabled = true;
  const sendBtn = popup.querySelector('.doc-ask-inline-send');
  if (sendBtn) sendBtn.disabled = true;

  _popupChatAbort = new AbortController();

  (async () => {
    try {
      const resp = await fetch('/api/doc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: _docText, messages: _popupChatMessages.filter(m => !m._thinking) }),
        signal: _popupChatAbort.signal
      });

      let aiText = '';
      const aiIdx = _popupChatMessages.length - 1;
      _popupChatMessages[aiIdx]._thinking = false;

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
                _popupChatMessages[aiIdx].content = aiText;
                _renderPopupChat(popup, false);
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

      _popupChatMessages[aiIdx].content = aiText;
      _renderPopupChat(popup, true);
    } catch (e) {
      if (e.name !== 'AbortError') {
        _popupChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
        _renderPopupChat(popup, true);
      }
    }
    _popupChatAbort = null;
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
    _repositionSelectionPopup();
  })();
}

function _renderPopupChat(popup, final) {
  const container = popup.querySelector('.doc-popup-chat-messages');
  if (!container) return;
  container.innerHTML = _popupChatMessages.map((m, i) => {
    if (m.role === 'user') {
      const display = m._display || m.content;
      return `<div class="doc-msg-user">${escapeHtml(display)}</div>`;
    }
    if (m._thinking) {
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
    }
    const isLast = i === _popupChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function _sendPopupChatToSidebar() {
  // Copy popup messages into sidebar doc chat
  for (const m of _popupChatMessages) {
    _docChatMessages.push({ role: m.role, content: m.content });
  }
  renderDocChatMessages(true);
  switchSidebarTab('chat');
  // Dismiss popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup) popup.remove();
  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
}

function _saveChatAsHighlight(popup) {
  if (!_popupChatMessages.length) return;
  const range = popup._savedRange;
  if (!range || typeof createHighlight !== 'function') return;

  const text = range.toString().trim();
  if (!text) return;

  const ancestor = range.commonAncestorContainer;
  const textLayerEl = ancestor.closest
    ? ancestor.closest('.textLayer')
    : ancestor.parentElement?.closest('.textLayer');
  if (!textLayerEl) return;

  const wrapper = textLayerEl.closest('.pdf-page-wrapper');
  if (!wrapper) return;

  const pageNum = parseInt(wrapper.dataset.page);
  const wrapperRect = wrapper.getBoundingClientRect();

  const clientRects = range.getClientRects();
  const rects = [];
  for (let i = 0; i < clientRects.length; i++) {
    const cr = clientRects[i];
    if (cr.width < 1 || cr.height < 1) continue;
    rects.push({
      x: (cr.left - wrapperRect.left) / _pdfScale,
      y: (cr.top - wrapperRect.top) / _pdfScale,
      w: cr.width / _pdfScale,
      h: cr.height / _pdfScale,
    });
  }
  if (!rects.length) return;

  const highlight = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    page: pageNum,
    color: 'blue',
    rects,
    text,
    note: '',
    chat: _popupChatMessages.map(m => ({ role: m.role, content: m.content })),
    createdAt: new Date().toISOString(),
  };

  _pdfHighlights.push(highlight);
  savePdfHighlights();
  renderHighlightRects(wrapper, highlight);
  renderHighlightsPanel();

  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  popup.remove();
  window.getSelection()?.removeAllRanges();
}

function _showChatHighlightPopup(e, hl) {
  // Remove any existing popup
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();
  dismissNotePopup();

  _popupChatMessages = (hl.chat || []).map(m => ({ role: m.role, content: m.content }));

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup has-chat';
  popup._chatHighlight = hl;

  // Context quote
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area visible';
  const chatContext = document.createElement('div');
  chatContext.className = 'doc-popup-chat-context';
  const contextTrunc = hl.text.length > 120 ? hl.text.slice(0, 120) + '…' : hl.text;
  chatContext.textContent = contextTrunc;
  chatArea.appendChild(chatContext);

  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);

  // Actions
  const chatActions = document.createElement('div');
  chatActions.className = 'doc-popup-chat-actions';
  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.textContent = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatToSidebar();
  });
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  deleteBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    deleteHighlight(hl.id);
    _popupChatMessages = [];
    popup.remove();
  });
  chatActions.appendChild(openSidebarBtn);
  chatActions.appendChild(deleteBtn);
  chatArea.appendChild(chatActions);
  popup.appendChild(chatArea);

  // Ask input for follow-ups
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask follow-up…';
  askInput.className = 'doc-ask-inline-input';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatMessage(popup, hl.text);
  });
  askInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _sendPopupChatMessage(popup, hl.text);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _savePopupChatToHighlight(popup);
      popup.remove();
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
  askWrap.appendChild(askInput);
  askWrap.appendChild(sendBtn);
  popup.appendChild(askWrap);

  // Prevent popup from being dismissed by the selection mousedown handler
  popup.addEventListener('mousedown', (ev) => ev.stopPropagation());

  document.body.appendChild(popup);

  // Render loaded messages
  _renderPopupChat(popup, true);

  // Position above the highlight rects
  const hlRects = document.querySelectorAll(`.pdf-highlight-rect[data-highlight-id="${hl.id}"]`);
  let hlTop = Infinity, hlBottom = -Infinity, hlLeft = Infinity;
  hlRects.forEach(r => {
    const br = r.getBoundingClientRect();
    if (br.top < hlTop) hlTop = br.top;
    if (br.bottom > hlBottom) hlBottom = br.bottom;
    if (br.left < hlLeft) hlLeft = br.left;
  });
  // Fallback to click position if rects not found
  if (hlTop === Infinity) { hlTop = e.clientY; hlBottom = e.clientY; hlLeft = e.clientX; }

  const popupRect = popup.getBoundingClientRect();
  let top = hlTop - popupRect.height - 8;
  const fitsAbove = top >= 4;
  if (!fitsAbove) top = hlBottom + 8;
  let left = hlLeft;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 4) left = 4;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup._anchorTop = hlTop;
  popup._anchorBottom = hlBottom;
  popup._anchorLeft = hlLeft;
  popup._aboveSelection = fitsAbove;

  setTimeout(() => askInput.focus(), 10);
}

function _savePopupChatToHighlight(popup) {
  const hl = popup && popup._chatHighlight;
  if (hl && _popupChatMessages.length) {
    hl.chat = _popupChatMessages.map(m => ({ role: m.role, content: m.content }));
    savePdfHighlights();
  }
  _popupChatMessages = [];
}

async function _findReferenceTextAsync(refNum) {
  // Extract text from the last pages of the PDF to find the reference
  if (typeof _pdfDoc === 'undefined' || !_pdfDoc) return null;
  const total = _pdfDoc.numPages;
  // Search last 5 pages (references are usually at the end)
  const startPage = Math.max(1, total - 4);

  let allText = '';
  for (let p = startPage; p <= total; p++) {
    try {
      const page = await _pdfDoc.getPage(p);
      const content = await page.getTextContent();
      // Join items without extra spaces — PDF.js items already include trailing spaces
      const pageText = content.items.map(item => item.str + (item.hasEOL ? '\n' : '')).join('');
      allText += pageText + '\n';
    } catch (e) { /* skip */ }
  }

  if (!allText) return null;

  // Search for the reference pattern
  const patterns = [
    new RegExp(`\\[\\s*${refNum}\\s*\\]\\s*([^\\[\\]]{10,300})`, 'i'),
    new RegExp(`(?:^|\\s)${refNum}\\.\\s*([^\\n]{10,300})`, 'm'),
    new RegExp(`\\(\\s*${refNum}\\s*\\)\\s*([^\\(\\)]{10,300})`, 'i'),
    new RegExp(`(?:^|\\s)${refNum}\\s+([A-Z][a-z]+[^\\d]{10,200})`, 'm'),
  ];

  for (const pattern of patterns) {
    const match = allText.match(pattern);
    if (match) {
      let refText = match[1].trim();
      // Try to extract a quoted title
      const titleMatch = refText.match(/"([^"]+)"|[\u201C]([^\u201D]+)[\u201D]|'([^']+)'/);
      if (titleMatch) {
        return titleMatch[1] || titleMatch[2] || titleMatch[3];
      }
      return refText.slice(0, 100).replace(/\s+/g, ' ');
    }
  }

  // Broader fallback
  const globalPatterns = [
    new RegExp(`\\[\\s*${refNum}\\s*\\]\\s*([A-Z][^\\[\\]]{10,200})`, 'g'),
    new RegExp(`(?:^|\\n)\\s*${refNum}\\.\\s*([A-Z][^\\n]{10,200})`, 'gm'),
  ];
  for (const pattern of globalPatterns) {
    const matches = [...allText.matchAll(pattern)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim().slice(0, 100).replace(/\s+/g, ' ');
    }
  }

  return null;
}

function _showReferencePopup(refNum, anchorEl) {
  // Remove any existing popup
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();
  if (typeof dismissCitationPopup === 'function') dismissCitationPopup();

  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  popup.style.visibility = 'hidden';

  // -- Reference info area (loading initially) --
  const refInfo = document.createElement('div');
  refInfo.className = 'doc-ref-info';
  refInfo.innerHTML = `<div class="doc-ref-loading"><span class="spinner"></span> Looking up [${refNum}]…</div>`;
  popup.appendChild(refInfo);

  // -- Ask input + send button --
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask about this reference…';
  askInput.className = 'doc-ask-inline-input';
  askInput.disabled = true; // Enabled once reference loads
  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.disabled = true;

  // We'll store the context text for chat once the reference loads
  let refContextText = `Reference [${refNum}]`;

  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatMessage(popup, refContextText);
  });
  askInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _sendPopupChatMessage(popup, refContextText);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      popup.remove();
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());

  // -- Inline chat area (hidden until first message) --
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area';
  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);
  const chatActions = document.createElement('div');
  chatActions.className = 'doc-popup-chat-actions';
  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.textContent = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatToSidebar();
  });
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _popupChatMessages = [];
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    chatMsgs.innerHTML = '';
    chatArea.classList.remove('visible');
    popup.classList.remove('has-chat');
    _repositionSelectionPopup();
  });
  chatActions.appendChild(openSidebarBtn);
  chatActions.appendChild(clearBtn);
  chatArea.appendChild(chatActions);
  popup.appendChild(chatArea);

  // Ask input always at the bottom
  askWrap.appendChild(askInput);
  askWrap.appendChild(sendBtn);
  popup.appendChild(askWrap);

  popup.addEventListener('mousedown', (ev) => ev.stopPropagation());
  document.body.appendChild(popup);

  // Position above the anchor element
  const anchorRect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = anchorRect.top - popupRect.height - 8;
  const fitsAbove = top >= 4;
  if (!fitsAbove) top = anchorRect.bottom + 8;
  let left = anchorRect.left;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 4) left = 4;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.visibility = '';
  popup._anchorTop = anchorRect.top;
  popup._anchorBottom = anchorRect.bottom;
  popup._anchorLeft = anchorRect.left;
  popup._aboveSelection = fitsAbove;

  // Fetch reference data
  const cacheKey = `${_pdfArxivId}:ref:${refNum}`;
  if (_citationCache[cacheKey]) {
    _renderRefInfo(refInfo, _citationCache[cacheKey], refNum, popup);
    refContextText = _buildRefContext(_citationCache[cacheKey], refNum);
    askInput.disabled = false;
    sendBtn.disabled = false;
    _repositionSelectionPopup();
    setTimeout(() => askInput.focus(), 10);
    return;
  }

  // Try sync search first (rendered pages), then async (extract from PDF directly)
  const refText = typeof findReferenceText === 'function' ? findReferenceText(refNum) : null;

  const doLookup = (query) => {
    fetch('/api/citation-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);
        _citationCache[cacheKey] = data;
        _renderRefInfo(refInfo, data, refNum, popup);
        refContextText = _buildRefContext(data, refNum);
        askInput.disabled = false;
        sendBtn.disabled = false;
        _repositionSelectionPopup();
        setTimeout(() => askInput.focus(), 10);
      })
      .catch(() => {
        // Show the extracted reference text even if the API is down
        refInfo.innerHTML = `<div class="doc-ref-badge">[${refNum}]</div><div class="doc-ref-title" style="font-weight:400">${escapeHtml(query)}</div><div class="doc-ref-meta" style="color:var(--text-dimmer)">Semantic Scholar unavailable</div>`;
        refContextText = `Reference [${refNum}]: ${query}`;
        askInput.disabled = false;
        sendBtn.disabled = false;
        _repositionSelectionPopup();
        setTimeout(() => askInput.focus(), 10);
      });
  };

  const showNotFound = () => {
    refInfo.innerHTML = `<div class="doc-ref-error">Could not find [${refNum}]</div>`;
    askInput.disabled = false;
    sendBtn.disabled = false;
    _repositionSelectionPopup();
  };

  if (refText) {
    doLookup(refText);
  } else {
    // Async fallback: extract text from last pages of PDF to find reference
    _findReferenceTextAsync(refNum).then(asyncRefText => {
      if (asyncRefText) {
        doLookup(asyncRefText);
      } else {
        showNotFound();
      }
    }).catch(() => showNotFound());
  }
}

function _renderRefInfo(container, data, refNum, popup) {
  const fmtNum = (n) => {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };
  const authors = data.authors?.length
    ? data.authors.slice(0, 3).join(', ') + (data.authors.length > 3 ? ' et al.' : '')
    : '';
  const abstract = data.abstract ? (data.abstract.length > 150 ? data.abstract.slice(0, 150) + '…' : data.abstract) : '';

  let html = `<div class="doc-ref-badge">[${refNum}]</div>`;
  html += `<div class="doc-ref-title">${escapeHtml(data.title || 'Unknown')}</div>`;
  if (authors || data.year) {
    html += `<div class="doc-ref-meta">`;
    if (authors) html += `<span>${escapeHtml(authors)}</span>`;
    if (data.venue) html += `<span> · ${escapeHtml(data.venue)}</span>`;
    if (data.year) html += `<span> · ${data.year}</span>`;
    html += `</div>`;
  }
  if (abstract) html += `<div class="doc-ref-abstract">${escapeHtml(abstract)}</div>`;
  html += `<div class="doc-ref-footer">`;
  html += `<span class="doc-ref-cited">Cited by ${fmtNum(data.citationCount)}</span>`;
  if (data.url) html += `<a class="doc-ref-link" href="${escapeHtml(data.url)}" data-external-link>View paper →</a>`;
  // Open in viewer if it has an arXiv ID
  if (data.arxivId) {
    html += `<a class="doc-ref-link" href="#view/${encodeURIComponent('https://arxiv.org/abs/' + data.arxivId)}" data-ref-nav>Open →</a>`;
  }
  html += `</div>`;
  container.innerHTML = html;
  // External links: explicit window.open to guarantee new browser tab
  container.querySelectorAll('[data-external-link]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      window.open(a.getAttribute('href'), '_blank');
    });
  });
  // In-app navigation links
  container.querySelectorAll('[data-ref-nav]').forEach(a => {
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      document.getElementById('doc-chat-ask-float')?.remove();
    });
  });
}

function _buildRefContext(data, refNum) {
  let ctx = `Reference [${refNum}]`;
  if (data.title) ctx += `: "${data.title}"`;
  if (data.authors?.length) ctx += ` by ${data.authors.slice(0, 3).join(', ')}`;
  if (data.year) ctx += ` (${data.year})`;
  if (data.abstract) ctx += `\n\nAbstract: ${data.abstract.slice(0, 300)}`;
  return ctx;
}

function _repositionSelectionPopup() {
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) return;
  const rect = popup.getBoundingClientRect();

  // Follow panel: reposition with bottom-left at mouse
  if (popup._isFollowPanel) {
    let top = _lastMouseY - rect.height;
    if (top < 0) top = 0;
    let left = _lastMouseX;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    return;
  }

  // Re-anchor relative to stored selection position so popup grows upward
  let top;
  if (popup._aboveSelection) {
    // Anchor bottom edge above the selection
    top = popup._anchorTop - rect.height - 8;
    if (top < 4) {
      // No longer fits above — flip below
      top = popup._anchorBottom + 8;
      popup._aboveSelection = false;
    }
  } else {
    // Below selection — keep top anchored below selection
    top = popup._anchorBottom + 8;
  }
  // Clamp to viewport bottom
  if (top + rect.height > window.innerHeight - 8) {
    top = window.innerHeight - rect.height - 8;
  }
  if (top < 4) top = 4;

  let left = popup._anchorLeft || parseFloat(popup.style.left);
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (left < 4) left = 4;

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

// Text selection → floating popup; left-click → follow-mode chat panel
let _selPopupDragging = false;

document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) {
    return;
  }
  // If NOT in follow mode, remove existing panel
  if (existing && !_lookupFollowMode) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Skip interactive elements and navigation
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target.isContentEditable) return;
  if (e.target.closest('#sidebar-nav')) return;
  if (e.target.closest('.doc-selection-popup')) return;
  if (e.target.closest('a[href]')) return;
  if (e.target.closest('[onclick]')) return;
  _selPopupDragging = true;
});

document.addEventListener('selectionchange', function() {
  if (!_selPopupDragging) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3 || sel.rangeCount === 0) return;
  // User is actively selecting text — stop follow mode, show selection preview
  _lookupFollowMode = false;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing._isFollowPanel) existing.remove();
  _buildSelectionPopup(sel, text, false);
});

document.addEventListener('mouseup', function(e) {
  if (!_selPopupDragging) return;
  _selPopupDragging = false;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text && text.length >= 3 && sel.rangeCount > 0) {
    // Text was selected → finalize selection popup
    _lookupFollowMode = false;
    _buildSelectionPopup(sel, text, true);
    return;
  }

  // Single click, no selection → toggle follow-mode chat panel
  if (localStorage.getItem('clickLookup') === 'off') return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _lookupFollowMode = false; return; }
  _showFollowPanel(e.clientX, e.clientY);
});

function _buildSelectionPopup(sel, text, finalize) {
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  popup.style.visibility = 'hidden';

  const capturedText = text;

  // -- Top row: action buttons (only shown when finalized) --
  if (finalize) {
    const btnRow = document.createElement('div');
    btnRow.className = 'doc-selection-popup-btns';

    const quoteBtn = document.createElement('button');
    quoteBtn.className = 'doc-selection-popup-btn';
    quoteBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 21c3-3 4-6 4-9 0-3.31-2.69-6-6-6h1a5 5 0 015 5c0 3-1.5 6-4 10zm12 0c3-3 4-6 4-9 0-3.31-2.69-6-6-6h1a5 5 0 015 5c0 3-1.5 6-4 10z" stroke-linecap="round" stroke-linejoin="round"/></svg> Quote';
    quoteBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    quoteBtn.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      popup.remove();
      _postQuoteText(capturedText);
    });
    btnRow.appendChild(quoteBtn);

    // Single word → Lookup (right next to Quote)
    const isSingleWord = /^\w+$/.test(capturedText) && !capturedText.includes(' ');
    if (isSingleWord) {
      const lookupBtn = document.createElement('button');
      lookupBtn.className = 'doc-selection-popup-btn';
      lookupBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round"/></svg> Lookup';
      lookupBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
      lookupBtn.addEventListener('click', function(ev) {
        ev.stopPropagation(); ev.preventDefault();
        const px = popup.style.left, py = popup.style.top;
        popup.remove();
        _showWordLookup(capturedText, parseInt(px), parseInt(py));
      });
      btnRow.appendChild(lookupBtn);
    }

    // Highlight color dots (only for PDF text layer) — pushed to right side
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      const inTextLayer = ancestor.closest ? ancestor.closest('.textLayer') : ancestor.parentElement?.closest('.textLayer');
      if (inTextLayer && typeof createHighlight === 'function') {
        popup._inTextLayer = true;
        popup._savedRange = range.cloneRange();
        const dotsWrap = document.createElement('div');
        dotsWrap.className = 'doc-hl-dots';
        const colors = typeof HIGHLIGHT_COLORS !== 'undefined' ? HIGHLIGHT_COLORS : [
          { name: 'yellow', bg: 'rgba(255,235,59,0.35)', solid: '#ffeb3b' },
          { name: 'green', bg: 'rgba(76,175,80,0.35)', solid: '#4caf50' },
          { name: 'blue', bg: 'rgba(66,165,245,0.35)', solid: '#42a5f5' },
          { name: 'pink', bg: 'rgba(236,64,122,0.35)', solid: '#ec407a' },
        ];
        for (const c of colors) {
          const dot = document.createElement('button');
          dot.className = 'doc-selection-hl-dot';
          dot.style.background = c.solid;
          dot.title = c.name;
          dot.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
          dot.addEventListener('click', function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            popup.remove();
            _pdfSavedRange = range.cloneRange();
            createHighlight(c);
          });
          dotsWrap.appendChild(dot);
        }
        btnRow.appendChild(dotsWrap);
      }
    }

    popup.appendChild(btnRow);
  }

  // -- Selected text preview --
  const preview = document.createElement('div');
  preview.className = 'doc-selection-preview';
  const truncated = capturedText.length > 150 ? capturedText.slice(0, 150) + '…' : capturedText;
  preview.textContent = truncated;
  popup.appendChild(preview);

  // -- Author preview or Wikipedia preview (async) --
  if (finalize) {
    if (_isAuthorEligible(capturedText)) {
      const authorDiv = document.createElement('div');
      authorDiv.className = 'doc-wiki-preview';
      authorDiv.style.display = 'none';
      popup.appendChild(authorDiv);
      _fetchAuthorPreview(capturedText, authorDiv);
    } else if (_isLookupEligible(capturedText)) {
      const wikiDiv = document.createElement('div');
      wikiDiv.className = 'doc-wiki-preview';
      wikiDiv.style.display = 'none';
      popup.appendChild(wikiDiv);
      _fetchWikipediaPreview(capturedText, wikiDiv);
    }
  }

  if (finalize) {
    // Reset popup chat state for new selection
    _popupChatMessages = [];
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }

    // -- Inline chat area (hidden until first message, above the input) --
    const chatArea = document.createElement('div');
    chatArea.className = 'doc-popup-chat-area';
    const chatContext = document.createElement('div');
    chatContext.className = 'doc-popup-chat-context';
    const contextTrunc = capturedText.length > 120 ? capturedText.slice(0, 120) + '…' : capturedText;
    chatContext.textContent = contextTrunc;
    chatArea.appendChild(chatContext);
    const chatMsgs = document.createElement('div');
    chatMsgs.className = 'doc-popup-chat-messages';
    chatArea.appendChild(chatMsgs);
    const chatActions = document.createElement('div');
    chatActions.className = 'doc-popup-chat-actions';
    const openSidebarBtn = document.createElement('button');
    openSidebarBtn.textContent = 'Open in sidebar';
    openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    openSidebarBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _sendPopupChatToSidebar();
    });
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    clearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _popupChatMessages = [];
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      chatMsgs.innerHTML = '';
      chatArea.classList.remove('visible');
      popup.classList.remove('has-chat');
      _repositionSelectionPopup();
    });
    chatActions.appendChild(openSidebarBtn);
    // "Save chat" — only for PDF text layer (creates a highlight with chat attached)
    const saveChatBtn = document.createElement('button');
    saveChatBtn.textContent = 'Save chat';
    saveChatBtn.style.display = 'none';
    saveChatBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    saveChatBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _saveChatAsHighlight(popup);
    });
    chatActions.appendChild(saveChatBtn);
    // Show "Save chat" only when in PDF text layer — checked after popup is built
    popup._saveChatBtn = saveChatBtn;
    chatActions.appendChild(clearBtn);
    chatArea.appendChild(chatActions);
    popup.appendChild(chatArea);

    // -- Ask input + send button (always at the bottom) --
    const askWrap = document.createElement('div');
    askWrap.className = 'doc-ask-inline-wrap';
    const askInput = document.createElement('input');
    askInput.type = 'text';
    askInput.placeholder = 'Ask about this…';
    askInput.className = 'doc-ask-inline-input';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'doc-ask-inline-send';
    sendBtn.innerHTML = '↑';
    sendBtn.title = 'Send';
    sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    sendBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _sendPopupChatMessage(popup, capturedText);
    });
    askInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        _sendPopupChatMessage(popup, capturedText);
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
        popup.remove();
      }
    });
    askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
    askWrap.appendChild(askInput);
    askWrap.appendChild(sendBtn);
    popup.appendChild(askWrap);
  }

  // Show "Save chat" button if we're in a PDF text layer
  if (popup._inTextLayer && popup._saveChatBtn) {
    popup._saveChatBtn.style.display = '';
  }

  document.body.appendChild(popup);

  // Position above selection, clamp to viewport
  const selRange = sel.getRangeAt(0);
  const selRect = selRange.getBoundingClientRect();
  // Store anchor points so _repositionSelectionPopup can re-anchor on content change
  popup._anchorTop = selRect.top;
  popup._anchorBottom = selRect.bottom;
  popup._anchorLeft = selRect.left;
  const popupRect = popup.getBoundingClientRect();
  let top = selRect.top - popupRect.height - 8;
  const fitsAbove = top >= 4;
  if (!fitsAbove) top = selRect.bottom + 8;
  popup._aboveSelection = fitsAbove;
  let left = selRect.left;
  if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
  if (left < 4) left = 4;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.visibility = '';

  if (finalize) {
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) setTimeout(() => input.focus(), 10);
  }
}

function _postQuoteText(text) {
  const paper = _currentPaperViewPaper;
  if (!paper || !text) return;
  const quotes = JSON.parse(localStorage.getItem('userQuotes') || '[]');
  quotes.push({
    id: 'q-' + Date.now(),
    quote: text,
    link: paper.link,
    title: paper.title,
    source: 'quote',
    pubDate: new Date().toISOString()
  });
  localStorage.setItem('userQuotes', JSON.stringify(quotes));
  // Brief toast
  const toast = document.createElement('div');
  toast.className = 'doc-selection-popup';
  toast.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);padding:6px 14px;font-size:0.78rem;pointer-events:none;';
  toast.textContent = 'Quote posted to feed';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

async function _showWordLookup(word, x, y) {
  const panel = document.createElement('div');
  panel.id = 'doc-chat-ask-float';
  panel.className = 'doc-lookup-panel';
  // Position near selection, clamp to viewport
  const left = Math.min(x, window.innerWidth - 340);
  const top = Math.min(Math.max(y, 10), window.innerHeight - 300);
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.innerHTML = '<div class="flex items-center gap-2 text-[0.75rem] text-dim py-2 px-3"><span class="spinner"></span>Looking up…</div>';
  document.body.appendChild(panel);

  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!resp.ok) throw new Error('Not found');
    const data = await resp.json();
    const entry = data[0];

    let html = '<div class="px-3 py-2.5">';
    // Word + phonetic
    html += `<div class="text-[1rem] font-bold text-primary">${escapeHtml(entry.word)}</div>`;
    const phonetic = entry.phonetics?.find(p => p.text)?.text;
    if (phonetic) html += `<div class="text-[0.78rem] text-dim mt-0.5">${escapeHtml(phonetic)}</div>`;

    // Meanings
    for (const meaning of (entry.meanings || []).slice(0, 3)) {
      html += `<div class="mt-2"><span class="text-[0.68rem] font-semibold text-accent uppercase tracking-wide">${escapeHtml(meaning.partOfSpeech)}</span></div>`;
      for (const def of (meaning.definitions || []).slice(0, 2)) {
        html += `<div class="text-[0.78rem] text-primary leading-relaxed mt-1 pl-2 border-l-2 border-accent/30">${escapeHtml(def.definition)}</div>`;
        if (def.example) html += `<div class="text-[0.72rem] text-dim italic mt-0.5 pl-2">${escapeHtml(def.example)}</div>`;
      }
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<div class="px-3 py-2.5"><div class="text-[1rem] font-bold text-primary">${escapeHtml(word)}</div><div class="text-[0.78rem] text-dim mt-1">No definition found.</div></div>`;
  }
}

// Dismiss popup on outside click (only when NOT in follow mode)
document.addEventListener('mousedown', function(e) {
  if (_lookupFollowMode) return;
  const btn = document.getElementById('doc-chat-ask-float');
  if (btn && !btn.contains(e.target)) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    _savePopupChatToHighlight(btn);
    btn.remove();
  }
});

// Follow-mode: panel tracks cursor
document.addEventListener('mousemove', function(e) {
  _lastMouseX = e.clientX;
  _lastMouseY = e.clientY;
  if (!_lookupFollowMode) return;
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) { _lookupFollowMode = false; return; }
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  let left = e.clientX;
  let top = e.clientY - h;
  if (top < 0) top = 0;
  if (left + w > window.innerWidth) left = window.innerWidth - w;
  if (left < 4) left = 4;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
});

// Escape to dismiss from anywhere
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) {
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _lookupFollowMode = false;
      popup.remove();
    }
  }
});

// Right-click anywhere opens follow panel
function _handleContextMenuChat(e) {
  if (localStorage.getItem('clickLookup') === 'off') return;
  // Skip if right-clicking inside an existing popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup && popup.contains(e.target)) return;
  // Skip inputs/textareas
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  e.preventDefault();
  if (popup) { popup.remove(); _lookupFollowMode = false; }
  console.log('[chat] contextmenu at', e.clientX, e.clientY);
  _showFollowPanel(e.clientX, e.clientY);
}
document.addEventListener('contextmenu', _handleContextMenuChat);

// Inject right-click handler into same-origin iframes (browse proxy)
function _injectIframeChatHandler(iframe) {
  const tryInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;
      if (doc._chatHandlerInjected) return;
      doc._chatHandlerInjected = true;
      doc.addEventListener('contextmenu', function(e) {
        if (localStorage.getItem('clickLookup') === 'off') return;
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
        e.preventDefault();
        // Convert iframe-relative coords to parent viewport coords
        const rect = iframe.getBoundingClientRect();
        const x = e.clientX + rect.left;
        const y = e.clientY + rect.top;
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) { popup.remove(); _lookupFollowMode = false; }
        _showFollowPanel(x, y);
      });
    } catch (e) {
      // Cross-origin — can't inject
    }
  };
  iframe.addEventListener('load', tryInject);
  // Also try immediately in case already loaded
  tryInject();
}

// Follow-mode chat panel: blank chat input that tracks cursor
function _showFollowPanel(x, y) {
  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  popup._isFollowPanel = true;
  _lookupFollowMode = true;

  _popupChatMessages = [];
  if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }

  // Chat area (hidden until first message sent)
  const chatArea = document.createElement('div');
  chatArea.className = 'doc-popup-chat-area';
  const chatMsgs = document.createElement('div');
  chatMsgs.className = 'doc-popup-chat-messages';
  chatArea.appendChild(chatMsgs);
  const chatActions = document.createElement('div');
  chatActions.className = 'doc-popup-chat-actions';
  const openSidebarBtn = document.createElement('button');
  openSidebarBtn.textContent = 'Open in sidebar';
  openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  openSidebarBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _lookupFollowMode = false;
    _sendPopupChatToSidebar();
  });
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  clearBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _popupChatMessages = [];
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    chatMsgs.innerHTML = '';
    chatArea.classList.remove('visible');
    popup.classList.remove('has-chat');
  });
  chatActions.appendChild(openSidebarBtn);
  chatActions.appendChild(clearBtn);
  chatArea.appendChild(chatActions);
  popup.appendChild(chatArea);

  // Ask input (always visible, no divider in follow mode)
  const askWrap = document.createElement('div');
  askWrap.className = 'doc-ask-inline-wrap';
  askWrap.style.borderTop = 'none';
  askWrap.style.marginTop = '0';
  askWrap.style.paddingTop = '0';
  const askInput = document.createElement('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask anything…';
  askInput.className = 'doc-ask-inline-input';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'doc-ask-inline-send';
  sendBtn.innerHTML = '↑';
  sendBtn.title = 'Send';
  sendBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
  sendBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    _sendPopupChatMessage(popup, '');
  });
  askInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      _sendPopupChatMessage(popup, '');
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      _lookupFollowMode = false;
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      popup.remove();
    }
  });
  askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
  askWrap.appendChild(askInput);
  askWrap.appendChild(sendBtn);
  popup.appendChild(askWrap);

  popup.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
  });

  document.body.appendChild(popup);

  // Position: top-left corner at cursor
  const rect = popup.getBoundingClientRect();
  let left = x;
  let top = y - rect.height;
  if (top < 0) top = 0;
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';

  // Auto-focus so user can type immediately
  askInput.focus();
}

function openPaper(index) {
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  markPostAsRead(paper.link);
  _browseReturnView = _lastActiveView || 'feed';
  openBrowse(paper.link);
}

function openPaperByUrl(url) {
  paperViewOrigin = typeof _lastActiveView !== 'undefined' ? _lastActiveView : 'feed';
  const hashVal = 'view/' + encodeURIComponent(url);
  const cached = (searchResultsCache || []).find(r => r && r.link === url);
  if (cached) { showPaperView(cached, hashVal); return; }
  const savedEntry = getSavedPosts()[url];
  if (savedEntry?.paper) { showPaperView(savedEntry.paper, hashVal); return; }
  const feedPaper = allPapers.find(p => p.link === url);
  if (feedPaper) { showPaperView(feedPaper, hashVal); return; }
  showPaperView({ title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' }, hashVal);
}

// ── Mobile Paper Sidebar ──


