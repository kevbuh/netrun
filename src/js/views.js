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
  if (typeof dismissPaperExpDropdown === 'function') dismissPaperExpDropdown();
  if (typeof dismissAuthorPopover === 'function') dismissAuthorPopover();
  // Close the active browse tab
  const win = typeof _getCurrentWindow === 'function' ? _getCurrentWindow() : null;
  if (win) {
    browseCloseTab(win.activeTab);
  } else {
    cleanupPdfViewer();
    window.history.back();
  }
}

let _currentPaperViewPaper = null;
let _paperOriginExpId = null;
let _paperInsightsLoaded = false;
function togglePaperViewBookmark() {
  if (!_currentPaperViewPaper) return;
  toggleSavePost(_currentPaperViewPaper);
  const saved = isPostSaved(_currentPaperViewPaper.link);
  // Update browse bar bookmark button
  const browseBtn = document.getElementById('browse-paper-bookmark-btn');
  if (browseBtn) {
    browseBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (saved ? 'text-accent' : 'text-dimmer hover:text-primary');
    browseBtn.title = saved ? 'Saved' : 'Save';
    browseBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (saved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
  }
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
  const sidebar = document.getElementById('browse-sidebar');
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
  const sidebar = document.getElementById('browse-sidebar');
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
function _renderSidebarHTML(paper) {
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
  // Paper info section for PDF mode (above tab toolbar)
  let paperInfoHtml = '';
  if (paper) {
    const sourceName = (typeof SOURCE_NAMES !== 'undefined' && SOURCE_NAMES[paper.source]) || (paper.source?.startsWith('custom:') ? paper.source.slice(7) : '');
    let infoMeta = [];
    if (sourceName) infoMeta.push(`<span class="text-meta-value">${escapeHtml(sourceName)}</span>`);
    if (paper.authors) infoMeta.push(`<span class="text-muted truncate">${escapeHtml(paper.authors)}</span>`);
    if (paper.published) infoMeta.push(`<span class="text-dim">${escapeHtml(paper.published)}</span>`);
    if (paper.categories && paper.categories.length) {
      const catTags = paper.categories.slice(0, 3).map(c => {
        const fullName = (typeof ARXIV_CAT_NAMES !== 'undefined' && ARXIV_CAT_NAMES[c]) || '';
        return `<span class="text-[0.68rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border shrink-0 cursor-default" ${fullName ? `title="${escapeHtml(fullName)}"` : ''}>${escapeHtml(c)}</span>`;
      });
      infoMeta.push(...catTags);
    }
    paperInfoHtml = `<div id="sidebar-paper-info" class="px-4 py-3 border-b border-border-card shrink-0">
      <div class="text-[0.85rem] font-semibold text-primary leading-snug mb-1.5">${renderTitle(paper.title)}</div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem]">${infoMeta.join('<span class="text-dimmest">\u00b7</span>')}</div>
    </div>`;
  }

  return `
    ${paperInfoHtml}
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
  _browseReturnView = _browseReturnView || _lastActiveView || 'feed';
  openBrowseWithPaper(paper.link, paper);
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
    if (!parent || (!parent.closest('#browse-content') && !parent.closest('#paper-pdf-container'))) return;
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
    const input = document.getElementById('pdf-search-input');
    if (input && input.offsetParent !== null) {
      e.preventDefault();
      // Toggle: if focused or has a search active, close; otherwise open
      if (document.activeElement === input || input.value.trim()) {
        closePdfFindBar();
      } else {
        input.focus(); input.select();
      }
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
      // iframe-based viewer (browse-content or legacy paper-pdf-container)
      const iframe = document.querySelector('#browse-content iframe') || document.querySelector('#paper-pdf-container iframe');
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
let _lookupTrackMode = false;
let _lastMouseX = 0;
let _lastMouseY = 0;
let _pendingScreenshots = [];
let _pendingNoteContexts = []; // {id, title, content} — vault notes attached to chat
let _pendingTabContexts = []; // {tabId, title, url, content} — browser tabs attached to chat
let _lookupDragging = false;
let _lookupDragOffset = { x: 0, y: 0 };

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
  if (!q && _pendingScreenshots.length === 0) return;
  input.value = '';

  // Grab pending screenshots and note contexts, clear strip
  const images = _pendingScreenshots.slice();
  _pendingScreenshots = [];
  const noteContexts = _pendingNoteContexts.slice();
  _pendingNoteContexts = [];
  const tabContexts = _pendingTabContexts.slice();
  _pendingTabContexts = [];
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

  _renderPopupChat(popup, false);
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
      if (hasVision) {
        body.vision = true;
      } else {
        // Build context from doc text + any attached note/tab contents
        let ctx = _docText || '';
        if (noteContexts.length) {
          const notesCtx = noteContexts.map(n =>
            `--- Note: ${n.title} ---\n${n.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + notesCtx : notesCtx;
        }
        if (tabContexts.length) {
          const tabCtx = tabContexts.map(t =>
            `--- Tab: ${t.title} (${t.url}) ---\n${t.content}`
          ).join('\n\n');
          ctx = ctx ? ctx + '\n\n' + tabCtx : tabCtx;
        }
        body.context = ctx;
      }
      const resp = await fetch('/api/doc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: _popupChatAbort.signal
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        _popupChatMessages[_popupChatMessages.length - 1].content = 'Error: server returned ' + resp.status;
        _popupChatMessages[_popupChatMessages.length - 1]._thinking = false;
        _renderPopupChat(popup, true);
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

function _updateContextBar(popup) {
  const fill = popup.querySelector('.lookup-context-fill');
  if (!fill) return;
  // Estimate tokens: chars / 4, context window ~32k for most models
  let chars = 0;
  // Document context
  if (_docText) chars += _docText.length;
  // Note contexts
  for (const n of _pendingNoteContexts) chars += (n.content || '').length;
  // Tab contexts
  for (const t of _pendingTabContexts) chars += (t.content || '').length;
  // All messages
  for (const m of _popupChatMessages) chars += (m.content || '').length;
  // Screenshots count as ~1k tokens each
  const imgTokens = _pendingScreenshots.length * 1000;
  for (const m of _popupChatMessages) {
    if (m.images) imgTokens + m.images.length * 1000;
  }
  const tokens = Math.round(chars / 4) + imgTokens;
  const limit = 32000;
  const pct = Math.min(100, (tokens / limit) * 100);
  fill.style.width = pct + '%';
  // Color: green → yellow → red
  if (pct < 50) fill.style.background = 'var(--accent)';
  else if (pct < 80) fill.style.background = '#c8a030';
  else fill.style.background = '#c44';
  fill.title = Math.round(tokens).toLocaleString() + ' / ' + limit.toLocaleString() + ' tokens (~' + Math.round(pct) + '%)';
  fill.parentElement.title = fill.title;
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
      return `<div class="doc-msg-user">${imgsHtml}${searchIcon}${paperIcon}${userIcon}${noteIcon}${escapeHtml(display)}</div>`;
    }
    if (m._thinking) {
      return `<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
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
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
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
      // Dismiss the lookup panel
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) { _lookupTrackMode = false; popup.remove(); }
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
      if (popup) { _lookupTrackMode = false; popup.remove(); }
    });
    el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  });
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
  _pendingScreenshots = [];
  _pendingNoteContexts = [];
  _pendingTabContexts = [];
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

  // Tab context panel: anchor top-left below the tab
  if (popup._tabContextAnchor) {
    let left = popup._tabContextAnchor.left;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.top = popup._tabContextAnchor.top + 'px';
    popup.style.left = left + 'px';
    return;
  }

  // Lookup panel: anchor bottom-left to stored mouse position
  if (popup._isLookupPanel) {
    const anchorX = popup._lookupAnchorX ?? _lastMouseX;
    const anchorY = popup._lookupAnchorY ?? _lastMouseY;
    let top = anchorY - rect.height;
    if (top < 0) top = 0;
    let left = anchorX;
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

// Text selection → floating popup; drag-to-screenshot when lookup panel is open
let _selPopupDragging = false;

document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) {
    return;
  }
  // Skip if clicking inside a sticky pinned panel
  if (e.target.closest('[id^="doc-chat-pinned-"]')) return;
  // In track mode with captureScreen available: pin panel and start screenshot drag
  if (existing && _lookupTrackMode && window.electronAPI?.captureScreen) {
    e.preventDefault(); // prevent text selection during drag
    _lookupTrackMode = false;
    _screenshotDragStart = { x: e.clientX, y: e.clientY };
    // Create selection rect + dim overlay elements
    _screenshotDim = document.createElement('div');
    _screenshotDim.className = 'screenshot-dim';
    document.body.appendChild(_screenshotDim);
    _screenshotSelection = document.createElement('div');
    _screenshotSelection.className = 'screenshot-selection';
    document.body.appendChild(_screenshotSelection);
    return;
  }
  // If NOT in track mode, remove existing panel
  if (existing && !_lookupTrackMode) {
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
  // User is actively selecting text — stop tracking, show selection preview
  _lookupTrackMode = false;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing._isLookupPanel) existing.remove();
  const range = sel.getRangeAt(0);
  _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, finalized: false });
});

document.addEventListener('mouseup', async function(e) {
  // Screenshot drag completion
  if (_screenshotDragStart) {
    const startPos = _screenshotDragStart;
    _screenshotDragStart = null;
    const x = Math.min(e.clientX, startPos.x);
    const y = Math.min(e.clientY, startPos.y);
    const w = Math.abs(e.clientX - startPos.x);
    const h = Math.abs(e.clientY - startPos.y);
    // Remove selection visuals before capture
    if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
    if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
    if (w >= 10 && h >= 10 && window.electronAPI?.captureScreen) {
      // Small delay so overlay removal renders before capture
      await new Promise(r => setTimeout(r, 50));
      try {
        const popup = document.getElementById('doc-chat-ask-float');
        const base64 = await window.electronAPI.captureScreen({ x, y, width: w, height: h });
        if (base64 && popup) {
          _addScreenshotToPanel(popup, base64);
        }
      } catch (err) {
        console.error('Screenshot capture failed:', err);
      }
    }
    return;
  }

  if (!_selPopupDragging) return;
  _selPopupDragging = false;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text && text.length >= 3 && sel.rangeCount > 0) {
    // Text was selected → finalize selection popup
    _lookupTrackMode = false;
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const inTextLayer = ancestor.closest ? !!ancestor.closest('.textLayer') : !!(ancestor.parentElement && ancestor.parentElement.closest('.textLayer'));
    _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, selectionRange: range.cloneRange(), inTextLayer, finalized: true });
    return;
  }

  // Single click, no selection → dismiss existing panel if not pinned
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _lookupTrackMode = false; }
});

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

// Dismiss popup on outside click (only when NOT in track mode)
document.addEventListener('mousedown', function(e) {
  if (_lookupTrackMode) return;
  if (_screenshotDragStart) return; // screenshot drag in progress, keep panel open
  const btn = document.getElementById('doc-chat-ask-float');
  if (btn && !btn.contains(e.target)) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    _savePopupChatToHighlight(btn);
    btn.remove();
  }
});

// Lookup panel: tracks cursor + screenshot drag
document.addEventListener('mousemove', function(e) {
  _lastMouseX = e.clientX;
  _lastMouseY = e.clientY;

  // Screenshot drag in progress
  if (_screenshotDragStart && _screenshotSelection && _screenshotDim) {
    const sx = Math.min(e.clientX, _screenshotDragStart.x);
    const sy = Math.min(e.clientY, _screenshotDragStart.y);
    const sw = Math.abs(e.clientX - _screenshotDragStart.x);
    const sh = Math.abs(e.clientY - _screenshotDragStart.y);
    _screenshotSelection.style.display = 'block';
    _screenshotSelection.style.left = sx + 'px';
    _screenshotSelection.style.top = sy + 'px';
    _screenshotSelection.style.width = sw + 'px';
    _screenshotSelection.style.height = sh + 'px';
    const vw = window.innerWidth, vh = window.innerHeight;
    _screenshotDim.style.clipPath = `polygon(0 0,${vw}px 0,${vw}px ${vh}px,0 ${vh}px,0 0,${sx}px ${sy}px,${sx}px ${sy+sh}px,${sx+sw}px ${sy+sh}px,${sx+sw}px ${sy}px,${sx}px ${sy}px)`;
    return;
  }

  // Drag-to-move the lookup panel
  if (_lookupDragging) {
    const popup = document.getElementById('doc-chat-ask-float');
    if (!popup) { _lookupDragging = false; return; }
    let left = e.clientX - _lookupDragOffset.x;
    let top = e.clientY - _lookupDragOffset.y;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + popup.offsetWidth > window.innerWidth) left = window.innerWidth - popup.offsetWidth;
    if (top + popup.offsetHeight > window.innerHeight) top = window.innerHeight - popup.offsetHeight;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup._lookupAnchorX = left;
    popup._lookupAnchorY = top + popup.offsetHeight;
    return;
  }

  if (!_lookupTrackMode) return;
  if (e.shiftKey) { _lookupTrackMode = false; return; } // Shift freezes panel in place
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) { _lookupTrackMode = false; return; }
  popup._lookupAnchorX = e.clientX;
  popup._lookupAnchorY = e.clientY;
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

// End drag-to-move
document.addEventListener('mouseup', function(e) {
  if (_lookupDragging) {
    _lookupDragging = false;
    const topBar = document.querySelector('.lookup-top-actions');
    if (topBar) topBar.style.cursor = 'grab';
  }
});

// Escape to dismiss from anywhere
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // Cancel screenshot drag if active
    if (_screenshotDragStart) {
      _screenshotDragStart = null;
      if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
      if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
      return;
    }
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) {
      if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
      _lookupTrackMode = false;
      _pendingScreenshots = [];
      _pendingNoteContexts = [];
      _pendingTabContexts = [];
      popup.remove();
    }
  }
});

// "/" key opens lookup panel with "/" pre-filled
document.addEventListener('keydown', function(e) {
  // Cmd+I or Ctrl+I toggles lookup panel
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
    e.preventDefault();
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; } popup.remove(); _lookupTrackMode = false; return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    _showPanel({ anchor: { x, y } });
    return;
  }
  if (e.key !== '/') return;
  // Skip if typing in an input, textarea, or contentEditable
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  // Skip if lookup panel already open
  if (document.getElementById('doc-chat-ask-float')) return;
  e.preventDefault();
  // Open centered horizontally, near top of viewport
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  _showPanel({ anchor: { x, y }, initialValue: '/' });
});

// Right-click anywhere opens lookup panel
function _handleContextMenuChat(e) {
  if (localStorage.getItem('clickLookup') === 'off') return;
  // Skip if right-clicking inside an existing popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup && popup.contains(e.target)) return;
  // Skip if clicking inside a sticky pinned panel
  if (e.target.closest('[id^="doc-chat-pinned-"]')) return;
  // Skip inputs/textareas
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  // Intercept right-click on browse tabs for tab context menu
  const browseTab = e.target.closest('.browse-tab');
  if (browseTab) {
    e.preventDefault();
    _showTabContextMenu(e, browseTab);
    return;
  }
  // Skip browse view chrome — iframe/webview handles its own context menu
  if (e.target.closest('#browse-bar, #browse-tab-row, #browse-sidebar')) return;
  // In browse content, skip only iframes/webviews (they have injected handlers)
  const browseContent = e.target.closest('#browse-content');
  if (browseContent && (e.target.tagName === 'IFRAME' || e.target.tagName === 'WEBVIEW')) return;
  e.preventDefault();
  // _showPanel handles retiring pinned panels
  if (popup) { popup.remove(); _lookupTrackMode = false; }
  _showPanel({ anchor: { x: e.clientX, y: e.clientY } });
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
        if (popup) { popup.remove(); _lookupTrackMode = false; }
        _showPanel({ anchor: { x, y } });
      });
      doc.addEventListener('click', function(e) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const a = e.target.closest('a');
        if (!a || !a.href) return;
        e.preventDefault();
        e.stopPropagation();
        window.top.open(a.href, '_blank');
      }, true);
      doc.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar();
        }
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); if (typeof _switchTabLeft === 'function') _switchTabLeft(); }
          if (e.key === 'ArrowRight') { e.preventDefault(); if (typeof _switchTabRight === 'function') _switchTabRight(); }
        }
      });
    } catch (e) {
      // Cross-origin — can't inject
    }
  };
  iframe.addEventListener('load', tryInject);
  // Also try immediately in case already loaded
  tryInject();
}

// ── Screenshot drag-to-capture ──
// State for drag-to-screenshot (active when lookup panel is open)
let _screenshotDragStart = null; // {x, y} or null
let _screenshotSelection = null; // DOM element
let _screenshotDim = null; // DOM element

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
  chip.innerHTML = `<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>` +
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
    `<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>`) +
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
  const onclickAttr = tabEl.getAttribute('onclick') || '';
  const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
  if (!idMatch) return;
  const tabId = parseInt(idMatch[1]);
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const isActive = win.activeTab === tabId;
  const domain = (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
  const items = [];

  // Header: title (+ domain for background tabs)
  const headerLabel = (tab.title || 'Tab') + (!isActive && domain ? ' · ' + domain : '');
  const memMB = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : '';
  items.push({ label: headerLabel, info: true, subtext: memMB, fn() {} });

  items.push({ sep: true });

  // Add to assistant
  items.push({
    label: 'Add to assistant',
    icon: '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"/></svg>',
    fn() {
      (async () => {
        try {
          const resp = await fetch('/api/extract-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: tab.url })
          });
          const data = await resp.json();
          const content = data.text || '';
          let lookupPanel = document.getElementById('doc-chat-ask-float');
          if (!lookupPanel && typeof _showPanel === 'function') {
            _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
            lookupPanel = document.getElementById('doc-chat-ask-float');
          }
          if (lookupPanel && typeof _addTabContextToPanel === 'function') {
            _addTabContextToPanel(lookupPanel, { tabId: tab.id, title: tab.title, url: tab.url, content });
          }
        } catch (err) {
          console.warn('Failed to extract tab context:', err);
        }
      })();
    }
  });

  items.push({ sep: true });

  // Close Tab
  items.push({
    label: 'Close Tab',
    icon: '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>',
    fn() { browseCloseTab(tabId); }
  });

  // Duplicate Tab
  items.push({
    label: 'Duplicate Tab',
    icon: '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
    fn() { browseNewTab(tab.url); }
  });

  // Mute/Unmute (only if tab has audio)
  if (_browseAudioTabs.has(tabId)) {
    const audioInfo = _browseAudioTabs.get(tabId);
    const isMuted = audioInfo && audioInfo.muted;
    items.push({
      label: isMuted ? 'Unmute Tab' : 'Mute Tab',
      icon: isMuted
        ? '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>'
        : '<svg class="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>',
      fn() { toggleTabMute(tabId); }
    });
  }

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

// Web search from lookup panel (Shift+Enter)
async function _doLookupWebSearch(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  // Pin panel if tracking
  _lookupTrackMode = false;

  // Show searching state in chat area
  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: q, _display: q, _isSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/web-search?q=' + encodeURIComponent(q));
    const data = await resp.json();
    const results = data.results || [];
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._searchResults = results;
    _popupChatMessages[aiIdx].content = results.length
      ? results.length + ' result' + (results.length !== 1 ? 's' : '')
      : 'No results found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── Slash commands for lookup panel ──

const _lookupCommands = [
  { name: 'bookmark', desc: 'Save page to reading list', fn: () => { if (typeof browseSaveToReadingList === 'function') browseSaveToReadingList(); } },
  { name: 'close', desc: 'Close current tab', fn: () => { if (typeof browseCloseTab === 'function' && typeof _browseActiveTab !== 'undefined') browseCloseTab(_browseActiveTab); } },
  { name: 'reload', desc: 'Reload current page', fn: () => { if (typeof browseReload === 'function') browseReload(); } },
  { name: 'back', desc: 'Go back', fn: () => { if (typeof browseBack === 'function') browseBack(); } },
  { name: 'forward', desc: 'Go forward', fn: () => { if (typeof browseForward === 'function') browseForward(); } },
  { name: 'newtab', desc: 'Open a new tab', fn: () => { if (typeof browseNewTab === 'function') browseNewTab(); } },
  { name: 'copy', desc: 'Copy page URL', fn: () => { const t = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab); if (t) navigator.clipboard.writeText(t.url).catch(() => {}); } },
  { name: 'share', desc: 'Share page', fn: () => { if (typeof browseShare === 'function') browseShare(); } },
  { name: 'mute', desc: 'Mute/unmute tab audio', fn: () => { if (typeof toggleTabMute === 'function' && typeof _browseActiveTab !== 'undefined') toggleTabMute(_browseActiveTab); } },
  { name: 'find', desc: 'Find in page', fn: () => { if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar(); } },
  { name: 'zoomin', desc: 'Zoom in', fn: () => { if (typeof browseZoom === 'function') browseZoom(1); } },
  { name: 'zoomout', desc: 'Zoom out', fn: () => { if (typeof browseZoom === 'function') browseZoom(-1); } },
  { name: 'zoomreset', desc: 'Reset zoom to 100%', fn: () => { if (typeof browseZoom === 'function') browseZoom(0); } },
  { name: 'print', desc: 'Print page', fn: () => { if (typeof browsePrintPage === 'function') browsePrintPage(); } },
  { name: 'note', desc: 'Open in note viewer', fn: () => { if (typeof browseOpenNoteView === 'function') browseOpenNoteView(); } },
  { name: 'paper', desc: 'Search for papers', hasArgs: true },
  { name: 'user', desc: 'Search for users', hasArgs: true },
  { name: 'notes', desc: 'Search your notes', hasArgs: true },
  { name: 'capture', desc: 'Screenshot the page', _special: true },
  { name: 'model', desc: 'Change chat model', _special: true },
  { name: 'search', desc: 'Web search in new tab', hasArgs: true },
  { name: 'links', desc: 'List all links on page', _special: true },
  { name: 'tab', desc: 'Add a tab to context', _special: true },
  { name: 'define', desc: 'Look up a word definition', hasArgs: true },
];

let _lookupCmdIdx = 0; // selected index in autocomplete
let _lookupNoteIdx = 0; // selected index in note search results
let _lookupNoteResults = []; // current note search results
let _lookupNoteQuery = ''; // current note search query (for create-on-enter)
let _lookupTabIdx = 0; // selected index in tab dropdown
let _lookupTabList = []; // current tab list for /tab command

function _lookupFilterCommands(query) {
  const q = query.toLowerCase();
  return _lookupCommands.filter(c => c.name.startsWith(q) || c.desc.toLowerCase().includes(q));
}

function _lookupRenderCmdDropdown(popup, query) {
  let dropdown = popup.querySelector('.lookup-cmd-dropdown');
  const matches = _lookupFilterCommands(query);
  if (!matches.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'lookup-cmd-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    // Insert before askWrap
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _lookupCmdIdx = Math.min(_lookupCmdIdx, matches.length - 1);
  dropdown.innerHTML = matches.map((c, i) =>
    `<div class="lookup-cmd-item ${i === _lookupCmdIdx ? 'selected' : ''}" data-idx="${i}">` +
    `<span class="lookup-cmd-name">/${c.name}</span>` +
    `<span class="lookup-cmd-desc">${escapeHtml(c.desc)}</span></div>`
  ).join('');
  // Click to execute or fill
  dropdown.querySelectorAll('.lookup-cmd-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const cmd = matches[idx];
      if (!cmd) return;
      if (cmd.hasArgs) {
        // Fill input with command name + space so user can type args
        const askInput = popup.querySelector('.doc-ask-inline-input') || popup.querySelector('.doc-ask-inline');
        if (askInput) { askInput.value = '/' + cmd.name + ' '; askInput.focus(); }
        _lookupHideCmdDropdown(popup);
      } else if (cmd._special) {
        _lookupHideCmdDropdown(popup);
        if (cmd.name === 'capture') _doLookupCapture(popup);
        else if (cmd.name === 'model') _doLookupModel(popup);
        else if (cmd.name === 'links') _doLookupLinks(popup);
        else if (cmd.name === 'tab') _doLookupTab(popup);
      } else {
        cmd.fn();
        _lookupTrackMode = false;
        popup.remove();
      }
    });
  });
  _repositionSelectionPopup();
}

function _lookupHideCmdDropdown(popup) {
  const dropdown = popup.querySelector('.lookup-cmd-dropdown');
  if (dropdown) dropdown.remove();
}

function _lookupHideNoteDropdown(popup) {
  const dropdown = popup.querySelector('.lookup-note-dropdown');
  if (dropdown) dropdown.remove();
  _lookupNoteResults = [];
  _lookupNoteIdx = 0;
  _lookupNoteQuery = '';
}

function _lookupHideTabDropdown(popup) {
  const dropdown = popup.querySelector('.lookup-tab-dropdown');
  if (dropdown) dropdown.remove();
  _lookupTabList = [];
  _lookupTabIdx = 0;
}

async function _lookupRenderNoteDropdown(popup, query) {
  if (!query) { _lookupHideNoteDropdown(popup); return; }
  _lookupNoteQuery = query;

  // Get notes (cached or fetch)
  let notes;
  if (typeof _vaultNotes !== 'undefined' && _vaultNotes.length > 0) {
    notes = _vaultNotes;
  } else {
    try {
      const resp = await fetch('/api/vault/notes', { headers: _authHeaders() });
      if (!resp.ok) { _lookupHideNoteDropdown(popup); return; }
      notes = await resp.json();
    } catch { _lookupHideNoteDropdown(popup); return; }
  }

  const q = query.toLowerCase();
  _lookupNoteResults = notes.filter(n => {
    const title = (n.title || '').toLowerCase();
    const content = (n.content || '').toLowerCase();
    const tags = (n.tags || []).join(' ').toLowerCase();
    return title.includes(q) || content.includes(q) || tags.includes(q);
  }).slice(0, 8);

  let dropdown = popup.querySelector('.lookup-note-dropdown');
  if (!_lookupNoteResults.length) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'lookup-note-dropdown';
      dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
      const askWrap = popup.querySelector('.doc-ask-inline-wrap');
      if (askWrap) popup.insertBefore(dropdown, askWrap);
      else popup.appendChild(dropdown);
    }
    dropdown.innerHTML = `<div class="lookup-note-create selected" data-create="1">` +
      `<span class="lookup-note-create-icon">+</span> Create "<strong>${escapeHtml(query)}</strong>"</div>`;
    dropdown.querySelector('.lookup-note-create').addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _lookupCreateAndOpenNote(popup, query);
    });
    _repositionSelectionPopup();
    return;
  }

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'lookup-note-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _lookupNoteIdx = Math.min(_lookupNoteIdx, _lookupNoteResults.length - 1);
  dropdown.innerHTML = _lookupNoteResults.map((n, i) => {
    const preview = (n.content || '').replace(/[#*_`>\-\[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const snippet = preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
    const tags = (n.tags || []).slice(0, 3);
    const tagsHtml = tags.length ? tags.map(t => `<span class="lookup-note-tag">#${escapeHtml(t)}</span>`).join('') : '';
    return `<div class="lookup-note-item ${i === _lookupNoteIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<div class="lookup-note-item-title">${escapeHtml(n.title || 'Untitled')}</div>` +
      (snippet ? `<div class="lookup-note-item-snippet">${escapeHtml(snippet)}</div>` : '') +
      (tagsHtml ? `<div class="lookup-note-item-tags">${tagsHtml}</div>` : '') +
      `</div>`;
  }).join('');

  // Click to open note
  dropdown.querySelectorAll('.lookup-note-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const note = _lookupNoteResults[idx];
      if (!note) return;
      _lookupHideNoteDropdown(popup);
      _lookupTrackMode = false;
      popup.remove();
      window.location.hash = '#vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(note.id); }, 100);
    });
  });
  _repositionSelectionPopup();
}

function _lookupOpenSelectedNote(popup) {
  const note = _lookupNoteResults[_lookupNoteIdx];
  if (!note) return false;
  _lookupHideNoteDropdown(popup);
  _lookupTrackMode = false;
  popup.remove();
  window.location.hash = '#vault';
  setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(note.id); }, 100);
  return true;
}

async function _lookupCreateAndOpenNote(popup, title) {
  _lookupHideNoteDropdown(popup);
  _lookupTrackMode = false;
  popup.remove();
  window.location.hash = '#vault';
  // Wait for vault view to render, then create the note
  setTimeout(async () => {
    if (typeof vaultCreateNoteWithTitle === 'function') {
      await vaultCreateNoteWithTitle(title);
      // Focus the editor so user can start typing immediately
      const editor = document.getElementById('vault-editor');
      if (editor) editor.focus();
    }
  }, 150);
}

async function _doLookupCapture(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; }
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  // Hide the popup temporarily so it's not in the screenshot
  popup.style.visibility = 'hidden';
  await new Promise(r => setTimeout(r, 80));

  // Determine capture region — content area only for browse view, else full window
  let captureRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const browseView = document.getElementById('browse-view');
  if (browseView && browseView.style.display !== 'none') {
    const el = document.getElementById('browse-content');
    if (el) { const r = el.getBoundingClientRect(); captureRect = { x: r.x, y: r.y, width: r.width, height: r.height }; }
  }

  // Capture screenshot
  let screenshot = null;
  if (window.electronAPI?.captureScreen) {
    try {
      screenshot = await window.electronAPI.captureScreen(captureRect);
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    }
  }

  // Show the popup again
  popup.style.visibility = '';

  if (!screenshot) {
    _popupChatMessages.push({ role: 'assistant', content: 'Screenshot capture not available. Run the app in Electron to use /capture.', _thinking: false });
    popup.classList.add('has-chat');
    const chatArea = popup.querySelector('.doc-popup-chat-area');
    if (chatArea) chatArea.classList.add('visible');
    _renderPopupChat(popup, true);
    _repositionSelectionPopup();
    if (input) input.focus();
    return;
  }

  // Add screenshot to attachment strip — user can type a message and send
  _addScreenshotToPanel(popup, screenshot);
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── /model command ──
let _lookupModelIdx = 0;
let _lookupModelList = [];

async function _doLookupModel(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  // Fetch available models
  _lookupModelList = [];
  _lookupModelIdx = 0;
  try {
    const resp = await fetch('/api/models');
    const data = await resp.json();
    _lookupModelList = data.models || [];
  } catch (e) {
    _lookupModelList = [];
  }

  if (!_lookupModelList.length) {
    // Show error inline
    if (input) { input.value = ''; input.placeholder = 'No models available'; input.focus(); }
    return;
  }

  const currentModel = localStorage.getItem('chatModel') || '';
  // Pre-select current model if found
  const curIdx = _lookupModelList.indexOf(currentModel);
  if (curIdx >= 0) _lookupModelIdx = curIdx;

  _lookupRenderModelDropdown(popup);
}

function _lookupRenderModelDropdown(popup) {
  let dropdown = popup.querySelector('.lookup-model-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'lookup-note-dropdown lookup-model-dropdown';
    dropdown.addEventListener('mousedown', ev => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  const currentModel = localStorage.getItem('chatModel') || '';
  dropdown.innerHTML = _lookupModelList.map((m, i) => {
    const active = m === currentModel;
    return `<div class="lookup-note-item ${i === _lookupModelIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<span class="lookup-note-item-title">${escapeHtml(m)}</span>` +
      (active ? `<span class="lookup-note-item-tags" style="margin-left:auto;opacity:0.6;">current</span>` : '') +
      `</div>`;
  }).join('');

  dropdown.querySelectorAll('.lookup-note-item').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation(); ev.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const model = _lookupModelList[idx];
      if (model) {
        _lookupModelIdx = idx;
        localStorage.setItem('chatModel', model);
        _lookupRenderModelDropdown(popup);
        const label = popup.querySelector('.lookup-model-label');
        if (label) label.textContent = model;
        const input = popup.querySelector('.doc-ask-inline-input');
        if (input) { input.value = ''; input.focus(); }
      }
    });
  });
  _repositionSelectionPopup();
}

function _lookupHideModelDropdown(popup) {
  const dd = popup.querySelector('.lookup-model-dropdown');
  if (dd) dd.remove();
  _lookupModelList = [];
  _lookupModelIdx = 0;
}

function _lookupSelectModel(popup) {
  const model = _lookupModelList[_lookupModelIdx];
  if (model) {
    localStorage.setItem('chatModel', model);
    _lookupRenderModelDropdown(popup);
    const label = popup.querySelector('.lookup-model-label');
    if (label) label.textContent = model;
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input) { input.value = ''; input.focus(); }
  }
}

// ── /search command — open web search in new tab ──
function _doLookupSearchNewTab(popup, query) {
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
  if (typeof browseNewTab === 'function') browseNewTab(url);
  else window.open(url, '_blank');
  _lookupTrackMode = false;
  popup.remove();
}

// ── /links command — list all links on current page ──
async function _doLookupLinks(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: 'Links on this page', _display: 'Links on this page', _isSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  // Get current page URL
  let pageUrl = '';
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab)
    : null;
  if (tab && tab.url) pageUrl = tab.url;

  if (!pageUrl) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'No page open to extract links from.';
    _renderPopupChat(popup, true);
    if (input) input.focus();
    return;
  }

  try {
    const resp = await fetch('/api/extract-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl })
    });
    const data = await resp.json();
    const links = data.links || [];
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    if (links.length) {
      _popupChatMessages[aiIdx]._searchResults = links.map(l => ({ title: l.text, url: l.url, snippet: '' }));
      _popupChatMessages[aiIdx].content = links.length + ' link' + (links.length !== 1 ? 's' : '') + ' found';
    } else {
      _popupChatMessages[aiIdx].content = 'No links found on this page.';
    }
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Failed to extract links: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── /tab command — add a browser tab to chat context ──
let _lookupTabAutoAdding = false;

async function _doLookupTab(popup) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  // Get all open tabs from all windows
  const allTabs = [];
  if (typeof _browseWindows !== 'undefined') {
    for (const win of _browseWindows) {
      for (const tab of (win.tabs || [])) {
        if (!tab.blank && tab.url) allTabs.push(tab);
      }
    }
  }

  if (!allTabs.length) {
    if (input) input.focus();
    return;
  }

  // Auto-add current tab if on a webpage
  const activeTabId = typeof _browseActiveTab !== 'undefined' ? _browseActiveTab : null;
  const currentTab = activeTabId != null ? allTabs.find(t => t.id === activeTabId) : null;
  if (currentTab && !_pendingTabContexts.some(t => t.tabId === currentTab.id)) {
    _lookupTabAutoAdding = true;
    try {
      const resp = await fetch('/api/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentTab.url })
      });
      const data = await resp.json();
      _addTabContextToPanel(popup, { tabId: currentTab.id, title: currentTab.title, url: currentTab.url, content: data.text || '' });
    } catch (e) { /* ignore */ }
    _lookupTabAutoAdding = false;
  }

  // Show remaining tabs (excluding already-added ones) in a dropdown
  const addedIds = new Set(_pendingTabContexts.map(t => t.tabId));
  const otherTabs = allTabs.filter(t => !addedIds.has(t.id));
  if (!otherTabs.length) {
    if (input) input.focus();
    return;
  }

  _lookupTabList = otherTabs;
  _lookupTabIdx = 0;
  _renderTabDropdown(popup);
  if (input) input.focus();
}

function _renderTabDropdown(popup) {
  let dropdown = popup.querySelector('.lookup-tab-dropdown');
  if (!_lookupTabList.length) {
    if (dropdown) dropdown.remove();
    return;
  }
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'lookup-tab-dropdown';
    dropdown.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const askWrap = popup.querySelector('.doc-ask-inline-wrap');
    if (askWrap) popup.insertBefore(dropdown, askWrap);
    else popup.appendChild(dropdown);
  }
  _lookupTabIdx = Math.min(_lookupTabIdx, _lookupTabList.length - 1);
  dropdown.innerHTML = _lookupTabList.map((tab, i) => {
    const domain = (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })();
    const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;
    return `<div class="lookup-tab-item ${i === _lookupTabIdx ? 'selected' : ''}" data-idx="${i}">` +
      `<img src="${favUrl}" class="lookup-tab-item-favicon" onerror="this.style.display='none'">` +
      `<div class="lookup-tab-item-info">` +
      `<div class="lookup-tab-item-title">${escapeHtml(tab.title || 'Untitled')}</div>` +
      `<div class="lookup-tab-item-url">${escapeHtml(domain)}</div>` +
      `</div></div>`;
  }).join('');

  dropdown.querySelectorAll('.lookup-tab-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _lookupTabIdx = parseInt(el.dataset.idx);
      _lookupSelectTab(popup);
    });
  });
  _repositionSelectionPopup();
}

async function _lookupSelectTab(popup) {
  const tab = _lookupTabList[_lookupTabIdx];
  if (!tab) return;

  const dropdown = popup.querySelector('.lookup-tab-dropdown');
  const items = dropdown ? dropdown.querySelectorAll('.lookup-tab-item') : [];
  const el = items[_lookupTabIdx];
  if (el) {
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    el.insertAdjacentHTML('beforeend', '<span class="lookup-tab-item-loading">extracting...</span>');
  }

  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url })
    });
    const data = await resp.json();
    _addTabContextToPanel(popup, { tabId: tab.id, title: tab.title, url: tab.url, content: data.text || '' });
  } catch (e) {
    if (el) {
      el.style.opacity = '1';
      el.style.pointerEvents = '';
      const loading = el.querySelector('.lookup-tab-item-loading');
      if (loading) loading.remove();
    }
    return;
  }
  _lookupHideTabDropdown(popup);
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.focus();
}

// ── /define command — dictionary lookup ──
async function _doLookupDefine(popup, word) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: word, _display: 'Define: ' + word });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.trim()));
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    if (!resp.ok) {
      _popupChatMessages[aiIdx].content = 'No definition found for "' + word.trim() + '".';
      _renderPopupChat(popup, true);
      if (input) input.focus();
      _repositionSelectionPopup();
      return;
    }
    const data = await resp.json();
    let md = '';
    const entry = data[0];
    if (entry) {
      const phonetic = entry.phonetics?.find(p => p.text)?.text || '';
      md += '**' + entry.word + '**' + (phonetic ? '  ' + phonetic : '') + '\n\n';
      for (const meaning of (entry.meanings || [])) {
        md += '*' + meaning.partOfSpeech + '*\n';
        for (const def of (meaning.definitions || []).slice(0, 3)) {
          md += '- ' + def.definition + '\n';
          if (def.example) md += '  *"' + def.example + '"*\n';
        }
        const syns = (meaning.synonyms || []).slice(0, 5);
        if (syns.length) md += '  Synonyms: ' + syns.join(', ') + '\n';
        md += '\n';
      }
    }
    _popupChatMessages[aiIdx].content = md.trim() || 'No definitions available.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Failed to look up definition: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

function _lookupExecCommand(popup, text) {
  const raw = text.slice(1).trim();
  // Check for commands with arguments: "/paper transformer attention"
  const spaceIdx = raw.indexOf(' ');
  if (spaceIdx > 0) {
    const cmdName = raw.slice(0, spaceIdx).toLowerCase();
    const args = raw.slice(spaceIdx + 1).trim();
    const cmd = _lookupCommands.find(c => c.name === cmdName);
    if (cmd && cmd.hasArgs && args) {
      _lookupHideCmdDropdown(popup);
      if (cmdName === 'paper') { _doLookupPaperSearch(popup, args); return true; }
      if (cmdName === 'user') { _doLookupUserSearch(popup, args); return true; }
      if (cmdName === 'notes') { _doLookupNoteSearch(popup, args); return true; }
      if (cmdName === 'search') { _doLookupSearchNewTab(popup, args); return true; }
      if (cmdName === 'define') { _doLookupDefine(popup, args); return true; }
    }
    if (cmd && cmd.fn) { cmd.fn(); _lookupTrackMode = false; popup.remove(); return true; }
  }
  const query = raw.toLowerCase();
  const matches = _lookupFilterCommands(query);
  const cmd = matches[_lookupCmdIdx] || matches[0];
  if (cmd) {
    if (cmd.hasArgs) return false; // needs arguments, don't execute bare
    if (cmd._special) {
      _lookupHideCmdDropdown(popup);
      if (cmd.name === 'capture') _doLookupCapture(popup);
      else if (cmd.name === 'model') _doLookupModel(popup);
      else if (cmd.name === 'links') _doLookupLinks(popup);
      else if (cmd.name === 'tab') _doLookupTab(popup);
      return true;
    }
    cmd.fn();
    _lookupTrackMode = false;
    popup.remove();
    return true;
  }
  return false;
}

// Paper search from lookup panel (/paper query)
async function _doLookupPaperSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) input.value = '';

  _lookupTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isPaperSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isPaperSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/arxiv-search?q=' + encodeURIComponent(query) + '&max_results=8');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const xml = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const entries = doc.querySelectorAll('entry');
    const papers = [];
    entries.forEach(entry => {
      const title = (entry.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
      const summary = (entry.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim();
      const authors = Array.from(entry.querySelectorAll('author name')).map(n => n.textContent).join(', ');
      const published = entry.querySelector('published')?.textContent || '';
      const year = published ? new Date(published).getFullYear() : '';
      let link = '';
      entry.querySelectorAll('link').forEach(l => {
        if (l.getAttribute('type') === 'text/html') link = l.getAttribute('href');
      });
      if (!link) {
        const alt = entry.querySelector('link[rel="alternate"]');
        if (alt) link = alt.getAttribute('href');
      }
      if (!link) link = entry.querySelector('id')?.textContent || '';
      papers.push({ title, authors, summary, link, year });
    });

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._paperResults = papers;
    _popupChatMessages[aiIdx].content = papers.length
      ? papers.length + ' paper' + (papers.length !== 1 ? 's' : '') + ' found'
      : 'No papers found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

async function _doLookupNoteSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isNoteSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isNoteSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    // Use cached _vaultNotes if available, otherwise fetch
    let notes;
    if (typeof _vaultNotes !== 'undefined' && _vaultNotes.length > 0) {
      notes = _vaultNotes;
    } else {
      const resp = await fetch('/api/vault/notes', { headers: _authHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      notes = await resp.json();
    }

    const q = query.toLowerCase();
    const matches = notes.filter(n => {
      const title = (n.title || '').toLowerCase();
      const content = (n.content || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      return title.includes(q) || content.includes(q) || tags.includes(q);
    }).slice(0, 10);

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._noteResults = matches;
    _popupChatMessages[aiIdx].content = matches.length
      ? matches.length + ' note' + (matches.length !== 1 ? 's' : '') + ' found'
      : 'No notes found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

async function _doLookupUserSearch(popup, query) {
  const input = popup.querySelector('.doc-ask-inline-input');
  if (input) { input.value = ''; input.style.height = 'auto'; }
  _lookupHideCmdDropdown(popup);
  _lookupTrackMode = false;

  popup.classList.add('has-chat');
  const chatArea = popup.querySelector('.doc-popup-chat-area');
  if (chatArea) chatArea.classList.add('visible');

  _popupChatMessages.push({ role: 'user', content: query, _display: query, _isUserSearch: true });
  _popupChatMessages.push({ role: 'assistant', content: '', _thinking: true, _isUserSearch: true });
  _renderPopupChat(popup, false);
  _repositionSelectionPopup();

  try {
    const resp = await fetch('/api/users?q=' + encodeURIComponent(query), {
      headers: _authHeaders()
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const users = await resp.json();

    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx]._userResults = users;
    _popupChatMessages[aiIdx].content = users.length
      ? users.length + ' user' + (users.length !== 1 ? 's' : '') + ' found'
      : 'No users found.';
    _renderPopupChat(popup, true);
  } catch (e) {
    const aiIdx = _popupChatMessages.length - 1;
    _popupChatMessages[aiIdx]._thinking = false;
    _popupChatMessages[aiIdx].content = 'Search failed: ' + e.message;
    _renderPopupChat(popup, true);
  }
  if (input) input.focus();
  _repositionSelectionPopup();
}

// ── Unified Popup Panel ──
// _showPanel(config) replaces both _showLookupPanel and _buildSelectionPopup.
// Config:
//   anchor: { x, y } | { selectionRect: DOMRect } | { tab: HTMLElement }
//   trackCursor: bool         — follow mouse until interaction
//   contextMenu: { items, linkUrl, linkText, imgUrl }
//   selectionText: string     — selected text preview
//   selectionRange: Range     — for highlight creation
//   inTextLayer: bool         — PDF text layer (show highlight dots)
//   initialValue: string      — pre-fill input (e.g. '/')
//   finalized: bool           — false = selection preview only (no buttons/input)
function _showPanel(config) {
  config = config || {};
  const anchor = config.anchor || {};
  const contextMenu = config.contextMenu || null;
  const selectionText = config.selectionText || '';
  const selectionRange = config.selectionRange || null;
  const inTextLayer = !!config.inTextLayer;
  const initialValue = config.initialValue || '';
  const finalized = config.finalized !== false; // default true

  // Remove any existing active panel
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) {
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
    if (!selectionText) _savePopupChatToHighlight(existing);
    existing.remove();
  }

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';

  // Determine anchor mode
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isCursorAnchor) popup._isLookupPanel = true;
  if (!finalized) popup.style.visibility = 'hidden';

  const hasContext = contextMenu && (contextMenu.linkUrl || contextMenu.imgUrl || contextMenu.items);
  if (isCursorAnchor) {
    _lookupTrackMode = config.trackCursor !== undefined ? config.trackCursor : !hasContext;
  } else {
    _lookupTrackMode = false;
  }

  const capturedText = selectionText;

  // Reset shared state for new panel (unless preview)
  if (finalized) {
    _popupChatMessages = [];
    _pendingScreenshots = [];
    _pendingNoteContexts = [];
    _pendingTabContexts = [];
    _lookupDragging = false;
    if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
  }

  // ── Context usage progress bar (very top) ──
  const ctxBar = document.createElement('div');
  ctxBar.className = 'lookup-context-bar';
  const ctxFill = document.createElement('div');
  ctxFill.className = 'lookup-context-fill';
  ctxBar.appendChild(ctxFill);
  popup.appendChild(ctxBar);

  // ── Generic context items (vault, tab, custom items) ──
  if (contextMenu && contextMenu.items) {
    const ctxDiv = document.createElement('div');
    ctxDiv.className = 'doc-lookup-context-items';
    for (const entry of contextMenu.items) {
      if (entry.sep) {
        const sep = document.createElement('div');
        sep.className = 'doc-lookup-ctx-sep';
        ctxDiv.appendChild(sep);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'doc-lookup-ctx-item' + (entry.danger ? ' doc-lookup-ctx-danger' : '') + (entry.info ? ' doc-lookup-ctx-info' : '');
      if (entry.icon) {
        item.innerHTML = entry.icon + ' ' + escapeHtml(entry.label);
      } else if (entry.subtext) {
        item.innerHTML = '<span class="doc-lookup-ctx-label">' + escapeHtml(entry.label) + '</span><span class="doc-lookup-ctx-sub">' + escapeHtml(entry.subtext) + '</span>';
      } else {
        item.textContent = entry.label;
      }
      if (!entry.info) {
        item.addEventListener('mousedown', (ev) => ev.stopPropagation());
        item.addEventListener('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          entry.fn();
          _lookupTrackMode = false;
          popup.remove();
        });
      }
      ctxDiv.appendChild(item);
    }
    popup.appendChild(ctxDiv);
  }

  // ── Link preview (async) ──
  if (contextMenu && contextMenu.linkUrl) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'doc-link-preview';
    fetch('/api/link-preview?url=' + encodeURIComponent(contextMenu.linkUrl))
      .then(r => r.json())
      .then(data => {
        if (!popup.isConnected) return;
        if (!data.title && !data.description) return;
        let html = '';
        if (data.image) {
          html += `<img class="doc-link-preview-img" src="${escapeAttr(data.image)}" onerror="this.remove()">`;
        }
        html += '<div class="doc-link-preview-text">';
        html += `<div class="doc-link-preview-site">${escapeHtml(data.site || data.domain || '')}</div>`;
        html += `<div class="doc-link-preview-title">${escapeHtml(data.title)}</div>`;
        if (data.description) {
          html += `<div class="doc-link-preview-desc">${escapeHtml(data.description)}</div>`;
        }
        html += '</div>';
        previewDiv.innerHTML = html;
        previewDiv.style.cursor = 'pointer';
        previewDiv.addEventListener('mousedown', (ev) => ev.stopPropagation());
        previewDiv.addEventListener('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          if (typeof browseNewTab === 'function') browseNewTab(contextMenu.linkUrl);
          else window.open(contextMenu.linkUrl, '_blank');
        });
        popup.insertBefore(previewDiv, popup.firstChild);
        _repositionSelectionPopup();
      })
      .catch(() => {});
  }

  // ── Context menu items (links, images) ──
  if (contextMenu && (contextMenu.linkUrl || contextMenu.imgUrl) && !contextMenu.items) {
    const ctxDiv = document.createElement('div');
    ctxDiv.className = 'doc-lookup-context-items';
    const linkUrl = contextMenu.linkUrl || '';
    const linkText = contextMenu.linkText || '';
    const imgUrl = contextMenu.imgUrl || '';

    const addItem = (label, fn) => {
      const item = document.createElement('div');
      item.className = 'doc-lookup-ctx-item';
      item.textContent = label;
      item.addEventListener('mousedown', (ev) => ev.stopPropagation());
      item.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        fn();
        _lookupTrackMode = false;
        popup.remove();
      });
      ctxDiv.appendChild(item);
    };
    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'doc-lookup-ctx-sep';
      ctxDiv.appendChild(sep);
    };

    if (linkUrl) {
      addItem('Open Link in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(linkUrl); });
      addItem('Open Link Here', () => { if (typeof browseNavigate === 'function') browseNavigate(linkUrl); });
      addSep();
      addItem('Copy Link Address', () => navigator.clipboard.writeText(linkUrl).catch(() => {}));
      if (linkText) addItem('Copy Link Text', () => navigator.clipboard.writeText(linkText).catch(() => {}));
    }
    if (imgUrl) {
      if (linkUrl) addSep();
      addItem('Open Image in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(imgUrl); });
      addItem('Copy Image Address', () => navigator.clipboard.writeText(imgUrl).catch(() => {}));
    }
    if (linkText && linkUrl) {
      const truncated = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
      addSep();
      addItem('Search Google for "' + truncated + '"', () => {
        if (typeof browseNewTab === 'function') browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
      });
    }

    popup.appendChild(ctxDiv);
  }

  // ── Selection actions (Quote, Lookup, Highlight dots) ──
  if (finalized && capturedText) {
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

    // Single word → Lookup
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

    // Highlight color dots (only for PDF text layer)
    if (inTextLayer && selectionRange && typeof createHighlight === 'function') {
      popup._inTextLayer = true;
      popup._savedRange = selectionRange.cloneRange();
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
          _pdfSavedRange = selectionRange.cloneRange();
          createHighlight(c);
        });
        dotsWrap.appendChild(dot);
      }
      btnRow.appendChild(dotsWrap);
    }

    popup.appendChild(btnRow);
  }

  // ── Selected text preview ──
  if (capturedText) {
    const preview = document.createElement('div');
    preview.className = 'doc-selection-preview';
    const truncated = capturedText.length > 150 ? capturedText.slice(0, 150) + '…' : capturedText;
    preview.textContent = truncated;
    popup.appendChild(preview);
  }

  // ── Author / Wikipedia preview (async) ──
  if (finalized && capturedText) {
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

  // ── Top actions bar (model label, pin, sidebar, drag) — ALWAYS present when finalized ──
  if (finalized) {
    const topBar = document.createElement('div');
    topBar.className = 'doc-popup-chat-actions lookup-top-actions';
    topBar.style.cursor = 'grab';

    // Model label
    const modelLabel = document.createElement('span');
    modelLabel.className = 'lookup-model-label';
    const cm = localStorage.getItem('chatModel') || 'qwen2.5:3b';
    modelLabel.textContent = cm;
    modelLabel.title = 'Current model';
    topBar.appendChild(modelLabel);

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    topBar.appendChild(spacer);

    const openSidebarBtn = document.createElement('button');
    openSidebarBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="m16.49 12 3.75-3.751m0 0-3.75-3.75m3.75 3.75H3.74V19.5" /></svg>';
    openSidebarBtn.title = 'Open in sidebar';
    openSidebarBtn.style.display = 'flex';
    openSidebarBtn.style.alignItems = 'center';
    openSidebarBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    openSidebarBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _lookupTrackMode = false;
      const sidebar = document.getElementById('browse-sidebar');
      if (sidebar) sidebar.style.display = '';
      _sendPopupChatToSidebar();
    });
    topBar.appendChild(openSidebarBtn);

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.className = 'lookup-pin-btn';
    pinBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.75V8.25L18 9.75V12H12.75V20.25L12 21L11.25 20.25V12H6V9.75L7.5 8.25V3.75H16.5Z" /></svg>';
    pinBtn.title = 'Pin panel';
    pinBtn.style.display = 'flex';
    pinBtn.style.alignItems = 'center';
    pinBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    pinBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (popup._isStickyNote) {
        popup.remove();
        return;
      }
      popup._isStickyNote = true;
      popup.id = 'doc-chat-pinned-' + Date.now();
      popup.classList.add('lookup-pinned');
      _lookupTrackMode = false;
      const svg = pinBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', 'currentColor');
      pinBtn.style.opacity = '1';
      pinBtn.title = 'Unpin (close)';
    });
    pinBtn.style.opacity = '0.5';
    topBar.appendChild(pinBtn);

    // Drag to move
    topBar.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('button')) return;
      ev.stopPropagation();
      ev.preventDefault();
      _lookupDragging = true;
      _lookupTrackMode = false;
      topBar.style.cursor = 'grabbing';
      const r = popup.getBoundingClientRect();
      _lookupDragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    });

    popup.appendChild(topBar);
  }

  // ── Chat area ──
  if (finalized) {
    const chatArea = document.createElement('div');
    chatArea.className = 'doc-popup-chat-area';
    chatArea.style.borderTop = 'none';
    if (capturedText) {
      const chatContext = document.createElement('div');
      chatContext.className = 'doc-popup-chat-context';
      const contextTrunc = capturedText.length > 120 ? capturedText.slice(0, 120) + '…' : capturedText;
      chatContext.textContent = contextTrunc;
      chatArea.appendChild(chatContext);
    }
    const chatMsgs = document.createElement('div');
    chatMsgs.className = 'doc-popup-chat-messages';
    chatArea.appendChild(chatMsgs);
    const chatActions = document.createElement('div');
    chatActions.className = 'doc-popup-chat-actions';
    const openSidebarBtnChat = document.createElement('button');
    openSidebarBtnChat.textContent = 'Open in sidebar';
    openSidebarBtnChat.addEventListener('mousedown', (ev) => ev.stopPropagation());
    openSidebarBtnChat.addEventListener('click', (ev) => {
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
    chatActions.appendChild(openSidebarBtnChat);
    // "Save chat" button — only shown for PDF text layer
    const saveChatBtn = document.createElement('button');
    saveChatBtn.textContent = 'Save chat';
    saveChatBtn.style.display = 'none';
    saveChatBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    saveChatBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _saveChatAsHighlight(popup);
    });
    chatActions.appendChild(saveChatBtn);
    popup._saveChatBtn = saveChatBtn;
    chatActions.appendChild(clearBtn);
    chatArea.appendChild(chatActions);
    popup.appendChild(chatArea);
  }

  // ── Screenshot / attachment strip ──
  if (finalized) {
    const attachStrip = document.createElement('div');
    attachStrip.className = 'doc-screenshot-attachments';
    popup.appendChild(attachStrip);
  }

  // ── Ask input + send button ──
  if (finalized) {
    const askWrap = document.createElement('div');
    askWrap.className = 'doc-ask-inline-wrap';
    if (!capturedText) {
      askWrap.style.borderTop = 'none';
      askWrap.style.marginTop = '0';
      askWrap.style.paddingTop = '0';
    }
    const askInput = document.createElement('input');
    askInput.type = 'text';
    askInput.placeholder = capturedText ? 'Ask about this…' : 'Ask anything…';
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
      // Let Cmd+I bubble up to document handler for toggle
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'i') return;
      ev.stopPropagation();
      const val = askInput.value;
      const isCmd = val.startsWith('/');
      const dropdown = popup.querySelector('.lookup-cmd-dropdown');
      const noteDropdown = popup.querySelector('.lookup-note-dropdown:not(.lookup-model-dropdown)');
      const modelDropdown = popup.querySelector('.lookup-model-dropdown');

      // Arrow keys navigate model dropdown
      if (modelDropdown && _lookupModelList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') _lookupModelIdx = Math.min(_lookupModelIdx + 1, _lookupModelList.length - 1);
        else _lookupModelIdx = Math.max(_lookupModelIdx - 1, 0);
        _lookupRenderModelDropdown(popup);
        const sel = modelDropdown.querySelector('.lookup-note-item.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (modelDropdown && _lookupModelList.length && ev.key === 'Enter') {
        ev.preventDefault();
        _lookupSelectModel(popup);
        return;
      }
      if (modelDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _lookupHideModelDropdown(popup);
        return;
      }

      // Arrow keys navigate tab dropdown
      const tabDropdown = popup.querySelector('.lookup-tab-dropdown');
      if (tabDropdown && _lookupTabList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') _lookupTabIdx = Math.min(_lookupTabIdx + 1, _lookupTabList.length - 1);
        else _lookupTabIdx = Math.max(_lookupTabIdx - 1, 0);
        const items = tabDropdown.querySelectorAll('.lookup-tab-item');
        items.forEach((el, i) => el.classList.toggle('selected', i === _lookupTabIdx));
        const sel = items[_lookupTabIdx];
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (tabDropdown && _lookupTabList.length && ev.key === 'Enter') {
        ev.preventDefault();
        _lookupSelectTab(popup);
        return;
      }
      if (tabDropdown && ev.key === 'Escape') {
        ev.preventDefault();
        _lookupHideTabDropdown(popup);
        return;
      }

      // Arrow keys navigate note search results
      if (noteDropdown && _lookupNoteResults.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        if (ev.key === 'ArrowDown') _lookupNoteIdx = Math.min(_lookupNoteIdx + 1, _lookupNoteResults.length - 1);
        else _lookupNoteIdx = Math.max(_lookupNoteIdx - 1, 0);
        const items = noteDropdown.querySelectorAll('.lookup-note-item');
        items.forEach((el, i) => el.classList.toggle('selected', i === _lookupNoteIdx));
        const sel = items[_lookupNoteIdx];
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (noteDropdown && ev.key === 'Enter') {
        ev.preventDefault();
        if (_lookupNoteResults.length) {
          _lookupOpenSelectedNote(popup);
        } else if (_lookupNoteQuery) {
          _lookupCreateAndOpenNote(popup, _lookupNoteQuery);
        }
        return;
      }

      // Arrow keys navigate command autocomplete
      if (isCmd && dropdown && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        const items = dropdown.querySelectorAll('.lookup-cmd-item');
        if (ev.key === 'ArrowDown') _lookupCmdIdx = Math.min(_lookupCmdIdx + 1, items.length - 1);
        else _lookupCmdIdx = Math.max(_lookupCmdIdx - 1, 0);
        _lookupRenderCmdDropdown(popup, val.slice(1).trim());
        return;
      }
      if (isCmd && dropdown && ev.key === 'Tab') {
        ev.preventDefault();
        const matches = _lookupFilterCommands(val.slice(1).trim());
        if (matches[_lookupCmdIdx]) askInput.value = '/' + matches[_lookupCmdIdx].name;
        _lookupRenderCmdDropdown(popup, matches[_lookupCmdIdx]?.name || '');
        return;
      }

      if (ev.key === 'Enter' && ev.shiftKey) {
        ev.preventDefault();
        _lookupHideCmdDropdown(popup);
        _doLookupWebSearch(popup);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (isCmd && dropdown) {
          const matches = _lookupFilterCommands(val.slice(1).trim());
          const cmd = matches[_lookupCmdIdx] || matches[0];
          if (cmd) {
            if (cmd.hasArgs) {
              askInput.value = '/' + cmd.name + ' ';
              _lookupHideCmdDropdown(popup);
            } else if (cmd._special) {
              _lookupHideCmdDropdown(popup);
              if (cmd.name === 'capture') _doLookupCapture(popup);
              else if (cmd.name === 'model') _doLookupModel(popup);
              else if (cmd.name === 'links') _doLookupLinks(popup);
              else if (cmd.name === 'tab') _doLookupTab(popup);
            } else {
              _lookupHideCmdDropdown(popup);
              cmd.fn();
              _lookupTrackMode = false;
              popup.remove();
            }
            return;
          }
        }
        if (isCmd && val.trim().length > 1) {
          _lookupExecCommand(popup, val);
        } else if (!isCmd) {
          _lookupHideCmdDropdown(popup);
          _sendPopupChatMessage(popup, capturedText);
        }
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (modelDropdown) { _lookupHideModelDropdown(popup); return; }
        if (noteDropdown) { _lookupHideNoteDropdown(popup); return; }
        if (dropdown) { _lookupHideCmdDropdown(popup); return; }
        if (popup._isStickyNote) return;
        _lookupTrackMode = false;
        if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
        _pendingScreenshots = [];
        _pendingNoteContexts = [];
        _pendingTabContexts = [];
        _savePopupChatToHighlight(popup);
        popup.remove();
      }
    });
    askInput.addEventListener('input', () => {
      const val = askInput.value;
      if (val.startsWith('/')) {
        const notesMatch = val.match(/^\/notes\s+(.+)/i);
        if (notesMatch) {
          _lookupHideCmdDropdown(popup);
          _lookupNoteIdx = 0;
          _lookupRenderNoteDropdown(popup, notesMatch[1].trim());
        } else {
          _lookupHideNoteDropdown(popup);
          _lookupCmdIdx = 0;
          _lookupRenderCmdDropdown(popup, val.slice(1).trim());
        }
      } else {
        _lookupHideCmdDropdown(popup);
        _lookupHideNoteDropdown(popup);
      }
    });
    askInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
    askWrap.appendChild(askInput);
    askWrap.appendChild(sendBtn);
    popup.appendChild(askWrap);
  }

  // Show "Save chat" button if in PDF text layer
  if (popup._inTextLayer && popup._saveChatBtn) {
    popup._saveChatBtn.style.display = '';
  }

  popup.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
  });

  document.body.appendChild(popup);

  // ── Positioning ──
  if (isTabAnchor) {
    // Tab context: position below the tab element
    const tabEl = anchor.tab;
    const tabRect = tabEl.getBoundingClientRect();
    popup.classList.add('tab-context-panel');
    popup.style.maxWidth = tabRect.width + 'px';
    popup._tabContextAnchor = { left: tabRect.left, top: tabRect.bottom, tabWidth: tabRect.width };
    let left = tabRect.left;
    const rect = popup.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.left = left + 'px';
    popup.style.top = tabRect.bottom + 'px';
    popup._lookupAnchorX = left;
    popup._lookupAnchorY = tabRect.bottom + rect.height;
  } else if (isSelectionAnchor) {
    // Selection: above or below selection rect
    const selRect = anchor.selectionRect;
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
  } else {
    // Cursor anchor: bottom-left at cursor position
    const x = anchor.x || 0;
    const y = anchor.y || 0;
    popup._lookupAnchorX = x;
    popup._lookupAnchorY = y;
    const rect = popup.getBoundingClientRect();
    let left = x;
    let top = y - rect.height;
    if (top < 0) top = 0;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  // Auto-focus input
  if (finalized) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      if (isSelectionAnchor) {
        setTimeout(() => askInput.focus(), 10);
      } else {
        askInput.focus();
      }
    }
    _updateContextBar(popup);
  }

  // Pre-fill input and trigger command dropdown if initialValue provided
  if (finalized && initialValue) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      askInput.value = initialValue;
      if (initialValue.startsWith('/')) {
        _lookupCmdIdx = 0;
        _lookupRenderCmdDropdown(popup, initialValue.slice(1).trim());
      }
      // Reposition after dropdown renders
      if (isCursorAnchor) {
        const ax = anchor.x || 0, ay = anchor.y || 0;
        requestAnimationFrame(() => {
          const r2 = popup.getBoundingClientRect();
          let t2 = ay - r2.height;
          if (t2 < 0) t2 = 0;
          popup.style.top = t2 + 'px';
        });
      }
    }
  }

  return popup;
}


function openPaper(index, e) {
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  if (_isNewTabClick(e)) { _openInNewTab(paper.link); return; }
  markPostAsRead(paper.link);
  _browseReturnView = _lastActiveView || 'feed';
  openBrowseWithPaper(paper.link, paper);
}

function openPaperByUrl(url, e) {
  if (_isNewTabClick(e)) { _openInNewTab(url); return; }
  _browseReturnView = typeof _lastActiveView !== 'undefined' ? _lastActiveView : 'feed';
  const paper = (typeof searchResultsCache !== 'undefined' && searchResultsCache || []).find(r => r && r.link === url)
    || (typeof getSavedPosts === 'function' && getSavedPosts()[url]?.paper)
    || (typeof allPapers !== 'undefined' && allPapers.find(p => p.link === url))
    || { title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' };
  openBrowseWithPaper(url, paper);
}

// ── Mobile Paper Sidebar ──


