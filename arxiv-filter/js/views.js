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

// ── Paper Viewer (shared) ──
let paperViewOrigin = 'arxiv';

function paperViewGoBack() {
  cleanupPdfViewer();
  dismissPaperExpDropdown();
  if (paperViewOrigin === 'saved') { openDashboard(); return; }
  if (paperViewOrigin === 'search') { openSearch(); return; }
  if (paperViewOrigin === 'experiment' && _paperOriginExpId) { openExperimentDetail(_paperOriginExpId); return; }
  goHome();
}

let _currentPaperViewPaper = null;
let _paperOriginExpId = null;
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

// ── Add to experiment dropdown ──
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
  fetch('/api/experiments').then(r => r.json()).then(exps => {
    dropdown.innerHTML = '';
    if (!exps.length) {
      dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">No experiments yet</div>';
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
        unlinkBtn.title = 'Remove from experiment';
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
  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/abs\//.test(paper.link);
  const hnDiscussionUrl = paper.hnId ? `https://news.ycombinator.com/item?id=${paper.hnId}` : '';
  _currentPaperViewPaper = paper;
  const isSaved = isPostSaved(paper.link);
  const bookmarkBtn = `<button id="paper-view-bookmark" class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 ${isSaved ? 'text-accent' : 'text-muted hover:text-primary'}" onclick="togglePaperViewBookmark()" title="${isSaved ? 'Saved' : 'Save'}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg></button>`;

  // ── Top bar: back + metadata compact ──
  const backBtn = `<button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center hover:text-primary shrink-0" onclick="paperViewGoBack()"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button>`;
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

  const sidebarToggleBtn = `<button id="paper-view-sidebar-toggle" class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="togglePaperSidebarMobile()" title="Show notes" style="display:none"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

  topbar.innerHTML = `
    ${backBtn}
    <span class="w-px h-5 bg-border-dim shrink-0"></span>
    <span class="text-[0.82rem] font-semibold text-white_ truncate topbar-scroll-span">${renderTitle(paper.title)}</span>
    <span class="flex items-center gap-2 text-[0.75rem] shrink-0 ml-auto">${metaParts.join('<span class="text-dimmest shrink-0">·</span>')}</span>
    ${sidebarToggleBtn}
    <div class="relative shrink-0" id="paper-exp-btn-wrap">
      <button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="togglePaperExpDropdown()" title="Add to experiment">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/></svg>
      </button>
    </div>
    ${bookmarkBtn}
    <button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="showCitePopup()" title="Cite paper"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button class="inline-flex items-center p-1.5 rounded-md bg-transparent border-none cursor-pointer transition-colors shrink-0 text-muted hover:text-primary" onclick="togglePaperSidebar()" title="Toggle sidebar"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <a href="${paper.link}" target="_blank" rel="noopener" class="text-dim hover:text-primary shrink-0" title="Open in new tab"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
  `;

  // ── Sidebar: notes + chat ──
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
          <span class="text-[0.72rem] text-dim">Name:</span>
          <input id="comment-author" class="flex-1 text-[0.78rem] bg-input border border-border-input rounded px-2 py-1 text-primary outline-none focus:border-accent" value="${escapeHtml(localStorage.getItem('userName') || '')}" placeholder="Your name" />
        </div>
        <textarea id="comment-input" class="w-full text-[0.78rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a comment..."></textarea>
        <button onclick="postComment()" class="mt-1 px-3 py-1 text-[0.78rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none font-medium">Post</button>
      </div>
    </div>
  `;

  sidebar.innerHTML = `
    <div class="sidebar-tab-toolbar">
      <button id="sidebar-tab-notes" class="sidebar-tab-btn active" onclick="switchSidebarTab('notes')" title="Notes"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-insights" class="sidebar-tab-btn" onclick="switchSidebarTab('insights')" title="Insights"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-chat" class="sidebar-tab-btn" onclick="switchSidebarTab('chat')" title="Chat"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-comments" class="sidebar-tab-btn" onclick="switchSidebarTab('comments')" title="Comments"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg></button>
    </div>
    <div id="paper-selection-mirror" class="mx-4 mt-3 mb-3 shrink-0 hidden"></div>
    <div id="sidebar-pane-notes" class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4">
      <div id="pdf-highlights-section">
        <div id="pdf-highlights-panel"></div>
      </div>
      ${notesPanel}
    </div>
    <div id="sidebar-pane-insights" class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style="display:none">
      <div id="pdf-links-section"></div>
      <div id="paper-insights"></div>
    </div>
    <div id="sidebar-pane-chat" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">
      ${chatPanel}
    </div>
    <div id="sidebar-pane-comments" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">
      ${commentsPanel}
    </div>
  `;

  // Sidebar resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sidebar-resize-handle';
  sidebar.appendChild(resizeHandle);
  _initSidebarResize(resizeHandle, sidebar);

  // Restore saved sidebar width
  const savedW = localStorage.getItem('paperSidebarWidth');
  if (savedW) sidebar.style.width = savedW + 'px';

  const pdfContainer = document.getElementById('paper-pdf-container');
  cleanupPdfViewer();
  pdfContainer.innerHTML = '';
  const arxivId = isArxiv ? (paper.arxivId || (paper.link.match(/arxiv\.org\/abs\/(\d+\.\d+)/) || [])[1] || '') : '';
  if (arxivId) {
    initPdfViewer(pdfContainer, `/api/arxiv-pdf?id=${encodeURIComponent(arxivId)}`, arxivId);
  } else {
    pdfContainer.innerHTML = `<iframe src="${paper.link}" style="width:100%;height:100%;border:none;background:#fff" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer"></iframe>`;
  }

  // Reset chat state
  _docChatMessages = [];
  _docText = '';
  _docTextLoading = false;
  _docChatExpanded = false;
  if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
  _docChatPaperUrl = paper.link;

  // Load paper notes
  _paperNoteSelected = null;
  _paperNoteLink = paper.link;
  fetchPaperNotes();

  // Start scroll progress tracking
  _startScrollTracker(paper.link);

  // Fetch paper insights (async, non-blocking)
  fetchPaperInsights(paper.link);

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

async function fetchPaperInsights(url) {
  const el = document.getElementById('paper-insights');
  if (!el) return;
  el.innerHTML = `<div class="flex items-center gap-2 text-[0.75rem] text-dim py-1"><span class="spinner"></span>Analyzing paper...</div>`;
  try {
    const resp = await fetch('/api/paper-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowHeuristics: localStorage.getItem('insightsAllowHeuristics') !== 'false' })
    });
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const hasRepos = data.repos && data.repos.length > 0;
    const hasInsights = data.insights && data.insights.length > 0;
    // Merge repo links from insights API into the unified PDF links section
    if (hasRepos) {
      for (const repo of data.repos) _pdfExtractedLinks.add(repo.url);
      _renderPdfLinks();
    }
    if (!hasInsights) {
      el.innerHTML = '';
      return;
    }
    let html = '<div class="space-y-2">';
    if (hasInsights) {
      // Wait for PDF text layers to render before verifying quotes
      const verified = await _verifyInsightsInPdf(data.insights);
      const labelColors = { Contribution: 'text-blue-400', Result: 'text-green-400', Method: 'text-purple-400', Surprising: 'text-yellow-400', Design: 'text-orange-400', Hardware: 'text-red-400' };
      for (const insight of verified) {
        const searchSnippet = insight.text.replace(/\.\.\.$/, '');
        const colorCls = labelColors[insight.label] || 'text-dim';
        let extraHtml = '';
        if (insight.gpus && insight.gpus.length) {
          extraHtml = `<div class="flex flex-wrap gap-1 mt-1">${insight.gpus.map(g => `<span class="text-[0.68rem] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">${escapeHtml(g)}</span>`).join('')}</div>`;
        }
        html += `<div class="cursor-pointer transition-colors hover:bg-white/5 rounded p-1.5 -mx-1.5" onmouseenter="pdfSearchHighlight(this.dataset.q)" onmouseleave="pdfClearSearchHighlights()" data-q="${escapeHtml(searchSnippet)}">
          <div class="text-[0.68rem] font-semibold ${colorCls} uppercase tracking-wide mb-0.5">${escapeHtml(insight.label)}</div>
          <div class="text-[0.78rem] text-primary leading-relaxed border-l-2 border-accent/40 pl-2.5 italic">${escapeHtml(insight.text)}</div>
          ${extraHtml}
        </div>`;
      }
      if (!verified.length) {
        el.innerHTML = '';
        return;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
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

  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/abs\//.test(paper.link);
  const arxivId = isArxiv ? (paper.arxivId || (paper.link.match(/arxiv\.org\/abs\/(\d+\.\d+)/) || [])[1] || '') : '';

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
    const resp = await fetch('/api/todos');
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
    headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    const userName = localStorage.getItem('userName') || '';
    const isOwn = comment.author === userName;
    const deleteBtn = isOwn ? `<button onclick="deleteComment('${comment.id}')" class="text-dimmest hover:text-red-400 text-[0.7rem] ml-auto" title="Delete" style="background:none;border:none;cursor:pointer;">x</button>` : '';
    let html = `<div class="comment-thread" style="${ml}; margin-bottom: 8px;">
      <div class="flex items-start gap-2">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(initial)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[0.75rem] font-medium text-primary">${escapeHtml(comment.author)}</span>
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
  const authorInput = document.getElementById('comment-author');
  const contentInput = document.getElementById('comment-input');
  if (!contentInput) return;
  const content = contentInput.value.trim();
  if (!content) return;
  const author = (authorInput?.value || '').trim() || 'Anonymous';
  // Save author name
  localStorage.setItem('userName', author);
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const author = (localStorage.getItem('userName') || '').trim() || 'Anonymous';
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperLink: _paperNoteLink, author, content, parentId })
    });
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

async function deleteComment(id) {
  try {
    await fetch('/api/comments/' + id, { method: 'DELETE' });
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

function switchSidebarTab(tab) {
  const panes = ['insights', 'notes', 'chat', 'comments'];
  panes.forEach(p => {
    const pane = document.getElementById('sidebar-pane-' + p);
    const btn = document.getElementById('sidebar-tab-' + p);
    if (pane) pane.style.display = p === tab ? '' : 'none';
    if (btn) btn.classList.toggle('active', p === tab);
  });
  if (tab === 'chat' && !_docChatExpanded) toggleDocChat();
  if (tab === 'comments') fetchPaperComments();
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
    const isLast = i === _docChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// Text selection → floating popup with "Ask about this" + "Post Quote"
document.addEventListener('mouseup', function(e) {
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) {
    if (existing.contains(e.target)) return; // let the click handler fire
    existing.remove();
  }

  // Allow in: chat messages, highlights panel, notes, sidebar, PDF pages
  const sidebar = document.getElementById('paper-sidebar');
  const pdfPages = document.getElementById('paper-pdf-container');
  const inSidebar = sidebar && sidebar.contains(e.target);
  const inPdf = pdfPages && pdfPages.contains(e.target);
  if (!inSidebar && !inPdf) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3) return;

  const popup = document.createElement('div');
  popup.id = 'doc-chat-ask-float';
  popup.className = 'doc-selection-popup';
  popup.style.left = e.clientX + 'px';
  popup.style.top = (e.clientY - 40) + 'px';

  const capturedText = text;

  const askBtn = document.createElement('button');
  askBtn.className = 'doc-selection-popup-btn';
  askBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke-linecap="round" stroke-linejoin="round"/></svg> Ask';
  askBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
  askBtn.addEventListener('click', function(ev) {
    ev.stopPropagation(); ev.preventDefault();
    popup.remove();
    switchSidebarTab('chat');
    sendDocMessage('Explain this:\n> ' + capturedText);
  });

  const quoteBtn = document.createElement('button');
  quoteBtn.className = 'doc-selection-popup-btn';
  quoteBtn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 21c3-3 4-6 4-9 0-3.31-2.69-6-6-6h1a5 5 0 015 5c0 3-1.5 6-4 10zm12 0c3-3 4-6 4-9 0-3.31-2.69-6-6-6h1a5 5 0 015 5c0 3-1.5 6-4 10z" stroke-linecap="round" stroke-linejoin="round"/></svg> Quote';
  quoteBtn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
  quoteBtn.addEventListener('click', function(ev) {
    ev.stopPropagation(); ev.preventDefault();
    popup.remove();
    _postQuoteText(capturedText);
  });

  popup.appendChild(askBtn);
  popup.appendChild(quoteBtn);

  // Single word → add Lookup button
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
    popup.appendChild(lookupBtn);
  }

  document.body.appendChild(popup);
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

document.addEventListener('mousedown', function(e) {
  const btn = document.getElementById('doc-chat-ask-float');
  if (btn && !btn.contains(e.target)) btn.remove();
});

function openPaper(index) {
  paperViewOrigin = 'arxiv';
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  markPostAsRead(paper.link);
  const hashVal = 'view/' + encodeURIComponent(paper.link);
  if (paper.source === 'arxiv') {
    showPaperView(paper, hashVal);
  } else {
    fetch(`/api/check-embed?url=${encodeURIComponent(paper.link)}`)
      .then(r => r.json())
      .then(data => {
        if (data.embeddable) {
          showPaperView(paper, hashVal);
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
  paperViewOrigin = 'search';
  const hashVal = 'view/' + encodeURIComponent(url);
  const cached = (searchResultsCache || []).find(r => r && r.link === url);
  if (cached) { showPaperView(cached, hashVal); return; }
  const savedEntry = getSavedPosts()[url];
  if (savedEntry?.paper) { paperViewOrigin = 'saved'; showPaperView(savedEntry.paper, hashVal); return; }
  const feedPaper = allPapers.find(p => p.link === url);
  if (feedPaper) { showPaperView(feedPaper, hashVal); return; }
  showPaperView({ title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' }, hashVal);
}

// ── Mobile Paper Sidebar ──

let _paperSidebarBackdrop = null;
let _sidebarSwipeStartX = 0;
let _sidebarSwipeStartY = 0;
let _sidebarSwipeDeltaX = 0;

function togglePaperSidebarMobile() {
  const sidebar = document.getElementById('paper-sidebar');
  if (!sidebar) return;

  // Check if mobile
  if (window.innerWidth >= 768) {
    // Desktop: use default toggle behavior
    togglePaperSidebar();
    return;
  }

  // Mobile: slide-over behavior
  const isOpen = sidebar.classList.contains('mobile-open');

  if (isOpen) {
    closePaperSidebarMobile();
  } else {
    openPaperSidebarMobile();
  }
}

function openPaperSidebarMobile() {
  const sidebar = document.getElementById('paper-sidebar');
  if (!sidebar) return;

  // Create backdrop if it doesn't exist
  if (!_paperSidebarBackdrop) {
    _paperSidebarBackdrop = document.createElement('div');
    _paperSidebarBackdrop.id = 'paper-sidebar-backdrop';
    _paperSidebarBackdrop.onclick = closePaperSidebarMobile;
    document.body.appendChild(_paperSidebarBackdrop);

    // Add swipe-to-close gesture
    sidebar.addEventListener('touchstart', handleSidebarSwipeStart, { passive: true });
    sidebar.addEventListener('touchmove', handleSidebarSwipeMove, { passive: false });
    sidebar.addEventListener('touchend', handleSidebarSwipeEnd, { passive: true });
  }

  // Show backdrop
  _paperSidebarBackdrop.classList.add('visible');

  // Open sidebar
  sidebar.classList.add('mobile-open');
}

function closePaperSidebarMobile() {
  const sidebar = document.getElementById('paper-sidebar');
  if (!sidebar) return;

  // Hide backdrop
  if (_paperSidebarBackdrop) {
    _paperSidebarBackdrop.classList.remove('visible');
  }

  // Close sidebar
  sidebar.classList.remove('mobile-open');
}

function handleSidebarSwipeStart(e) {
  if (e.touches.length !== 1) return;
  _sidebarSwipeStartX = e.touches[0].clientX;
  _sidebarSwipeStartY = e.touches[0].clientY;
  _sidebarSwipeDeltaX = 0;
}

function handleSidebarSwipeMove(e) {
  if (e.touches.length !== 1) return;
  const currentX = e.touches[0].clientX;
  const currentY = e.touches[0].clientY;
  _sidebarSwipeDeltaX = currentX - _sidebarSwipeStartX;
  const deltaY = currentY - _sidebarSwipeStartY;

  // Only track horizontal swipes (more horizontal than vertical)
  if (Math.abs(_sidebarSwipeDeltaX) > Math.abs(deltaY) && _sidebarSwipeDeltaX > 10) {
    e.preventDefault();
  }
}

function handleSidebarSwipeEnd(e) {
  // Swipe right to close (threshold: 50px)
  if (_sidebarSwipeDeltaX > 50) {
    closePaperSidebarMobile();
  }
  _sidebarSwipeDeltaX = 0;
}

// ── Mobile Modal Positioning ──

function positionModalForMobile(modal) {
  if (!modal || window.innerWidth >= 768) return;

  // Ensure modal doesn't go below bottom nav
  const rect = modal.getBoundingClientRect();
  const bottomNavHeight = 60;
  const safeArea = typeof CSS !== 'undefined' && CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')
    ? 20 // approximate safe area
    : 0;
  const minBottomClearance = bottomNavHeight + safeArea + 16;

  if (rect.bottom > window.innerHeight - minBottomClearance) {
    const newTop = window.innerHeight - minBottomClearance - rect.height - 16;
    if (newTop > 0) {
      modal.style.top = newTop + 'px';
    } else {
      // Modal too tall, position at top with scroll
      modal.style.top = '16px';
      modal.style.maxHeight = `calc(100vh - ${minBottomClearance + 32}px)`;
      modal.style.overflowY = 'auto';
    }
  }

  // Ensure horizontal centering
  const modalWidth = rect.width;
  const viewportWidth = window.innerWidth;
  if (modalWidth < viewportWidth - 32) {
    modal.style.left = '50%';
    modal.style.transform = 'translateX(-50%)';
  } else {
    modal.style.left = '16px';
    modal.style.right = '16px';
    modal.style.transform = 'none';
  }
}

// Apply to all modals when they appear
const _modalObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1 && (
        node.classList?.contains('modal') ||
        node.classList?.contains('popup') ||
        node.classList?.contains('dropdown') ||
        node.classList?.contains('card-menu')
      )) {
        setTimeout(() => positionModalForMobile(node), 0);
      }
    });
  });
});

if (typeof window !== 'undefined' && document.body) {
  _modalObserver.observe(document.body, { childList: true, subtree: true });
}

