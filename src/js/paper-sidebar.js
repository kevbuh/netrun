// paper-sidebar.js — Paper sidebar panels, insights, notes, comments, citations

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
    if (paper.published) infoMeta.push(`<span class="text-dim">${escapeHtml(paper.published)}</span>`);
    if (paper.categories && paper.categories.length) {
      const catTags = paper.categories.slice(0, 3).map(c => {
        const fullName = (typeof ARXIV_CAT_NAMES !== 'undefined' && ARXIV_CAT_NAMES[c]) || '';
        return `<span class="text-[0.68rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border shrink-0 cursor-default" ${fullName ? `title="${escapeHtml(fullName)}"` : ''}>${escapeHtml(c)}</span>`;
      });
      infoMeta.push(...catTags);
    }
    paperInfoHtml = `<div id="sidebar-paper-info" class="px-4 py-3 border-b border-border-card shrink-0">
      <div class="sidebar-paper-title text-[0.85rem] font-semibold text-primary leading-snug mb-1">${renderTitle(paper.title)}</div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] mb-1">${infoMeta.join('<span class="text-dimmest">\u00b7</span>')}</div>
      <div class="sidebar-paper-authors text-[0.72rem] text-muted leading-snug">${paper.authors ? escapeHtml(paper.authors) : ''}</div>
      <div id="sidebar-paper-authors-cards" class="mt-2"></div>
    </div>`;
  }

  return `
    ${paperInfoHtml}
    <div class="sidebar-tab-toolbar">
      <button id="sidebar-tab-insights" class="sidebar-tab-btn active" onclick="switchSidebarTab('insights')" title="Insights"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="sidebar-tab-notes" class="sidebar-tab-btn" onclick="switchSidebarTab('notes')" title="Notes"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg></button>

      <button id="sidebar-tab-comments" class="sidebar-tab-btn" onclick="switchSidebarTab('comments')" title="Comments"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" /></svg></button>
      <button id="sidebar-tab-terminal" class="sidebar-tab-btn" onclick="switchSidebarTab('terminal')" title="Terminal"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></button>
    </div>
    <div id="paper-selection-mirror" class="mx-4 mt-3 mb-3 shrink-0 hidden"></div>
    <div id="sidebar-pane-insights" class="flex flex-col flex-1 min-h-0">
      <div class="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <div class="insight-section" id="insight-drop-ai">
          <div class="insight-section-title">AI</div>
          <div class="insight-section-body" id="insight-pane-ai"></div>
        </div>
        <div class="insight-section" id="insight-drop-smart">
          <div class="insight-section-title" style="display:flex;align-items:center;gap:6px">
            Smart Highlights
            <span style="flex:1"></span>
            <button id="smart-hl-toggle" class="pdf-tb-btn" title="Toggle highlights in PDF" onclick="toggleSmartHighlightsVisibility()" style="padding:2px 4px;font-size:0.7rem;opacity:1">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </button>
          </div>
          <div class="insight-section-body" id="insight-pane-smart"></div>
        </div>
        <div class="insight-section" id="insight-drop-references">
          <div class="insight-section-title">References</div>
          <div class="insight-section-body" id="insight-pane-references"></div>
        </div>
        <div class="insight-section" id="insight-drop-links">
          <div class="insight-section-title">Links</div>
          <div class="insight-section-body" id="insight-pane-links">
            <div id="pdf-links-section"></div>
          </div>
        </div>
      </div>
    </div>
    <div id="sidebar-pane-notes" class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style="display:none">
      <div id="pdf-highlights-section">
        <div id="pdf-highlights-panel"></div>
      </div>
      ${notesPanel}
    </div>
    <div id="sidebar-pane-comments" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">
      ${commentsPanel}
    </div>
    <div id="sidebar-pane-terminal" class="flex flex-col flex-1 min-h-0" style="display:none">
      <div id="sidebar-terminal-container" style="flex:1;min-height:0;padding:4px;"></div>
    </div>
  `;
}

function _initSidebar() {
  // No-op — sidebar resize is now handled by universal panel
}

function _initSidebarForUrl(url) {
  _paperNoteLink = url;
  _docChatPaperUrl = url;
  _docText = '';
  _docTextLoading = false;
  if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
  _paperNoteSelected = null;
  _paperInsightsLoaded = false;
  _insightsDataCache = null;
  _insightSubLoaded = { contents: false, authors: false, ai: false, references: false, links: false, smart: false };
  _sidebarScrollPositions = {};
  fetchPaperNotes();
  fetchPaperComments();
  // Extract doc text in background so popup chat has context
  extractDocText(url);
  const savedTab = localStorage.getItem('sidebarTab');
  if (savedTab && ['insights', 'notes', 'comments', 'terminal'].includes(savedTab)) {
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
let _insightSubLoaded = { contents: false, authors: false, ai: false, references: false, links: false, smart: false };

async function fetchPaperInsights(url) {
  _paperInsightsLoaded = true;
  _insightSubLoaded = { contents: false, authors: false, ai: false, references: false, links: false, smart: false };

  // Load all sections immediately
  setTimeout(() => {
    _loadInsightSubtab('contents');
    _loadInsightSubtab('authors');
    _loadInsightSubtab('references');
    _loadInsightSubtab('links');
  }, 0);
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
    if (requestedTab === 'ai') { _renderAIPane(_insightsDataCache); _renderSmartHighlightsPane(url); }
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

    // Update header with real title and authors from API
    _updatePaperHeader(data);

    // Merge repo links
    if (data.repos?.length) {
      for (const repo of data.repos) _pdfExtractedLinks.add(repo.url);
      _renderPdfLinks();
    }

    _renderAuthorsPane(data);
    // Mark AI as loaded too since we have the data
    _insightSubLoaded.ai = true;
    _renderAIPane(data);
    // Render smart highlights pane (on-demand generation)
    _renderSmartHighlightsPane(url);
  } catch (e) {
    console.error('[Insights] Error:', e);
    if (pane) pane.innerHTML = '<div class="text-[0.75rem] text-dimmer">Failed to load</div>';
  }
}

function _updatePaperHeader(data) {
  const header = document.getElementById('sidebar-paper-info');
  if (!header) return;
  const paper = _currentPaperViewPaper;
  if (!paper) return;

  // Update title if API returned a real one
  if (data.title) {
    paper.title = data.title;
    const titleEl = header.querySelector('.sidebar-paper-title');
    if (titleEl) titleEl.innerHTML = renderTitle(data.title);
  }

  // Update authors line from API data
  if (data.authors?.length) {
    const names = data.authors.map(a => a.name).join(', ');
    paper.authors = names;
    const authorsEl = header.querySelector('.sidebar-paper-authors');
    if (authorsEl) authorsEl.textContent = names;
  }
}

function _renderAuthorsPane(data) {
  const container = document.getElementById('sidebar-paper-authors-cards');
  if (!container) return;
  const hasAuthors = data.authors?.length > 0;
  if (!hasAuthors) return;

  // Hide the plain-text author line since we have rich cards
  const plainAuthors = document.querySelector('#sidebar-paper-info .sidebar-paper-authors');
  if (plainAuthors) plainAuthors.style.display = 'none';

  const AUTHOR_LIMIT = 5;
  const total = data.authors.length;
  let html = '<div class="space-y-1" id="paper-authors-list">';
  for (let i = 0; i < total; i++) {
    const author = data.authors[i];
    const stats = [];
    if (author.paperCount) stats.push(`${fmtNum(author.paperCount)} papers`);
    if (author.hIndex) stats.push(`h-index ${author.hIndex}`);
    if (author.citationCount) stats.push(`${fmtNum(author.citationCount)} citations`);
    const hidden = i >= AUTHOR_LIMIT ? ' style="display:none" data-extra-author' : '';
    html += `<div class="author-card" data-idx="${i}"${hidden}>
      <div class="author-card-avatar">${escapeHtml((author.name || '?')[0].toUpperCase())}</div>
      <div class="author-card-info">
        <div class="author-card-name">${escapeHtml(author.name)}</div>
        ${author.affiliation ? `<div class="author-card-affiliation">${escapeHtml(author.affiliation)}</div>` : ''}
        ${stats.length ? `<div class="author-card-stats">${stats.join(' · ')}</div>` : ''}
      </div>
    </div>`;
  }
  if (total > AUTHOR_LIMIT) {
    html += `<button id="authors-show-more" class="w-full text-[0.72rem] text-dim hover:text-primary py-1 cursor-pointer bg-transparent border-none transition-colors" onclick="_toggleExtraAuthors()">Show ${total - AUTHOR_LIMIT} more authors</button>`;
  }
  html += '</div>';
  container.innerHTML = html;
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

function _toggleExtraAuthors() {
  const btn = document.getElementById('authors-show-more');
  const extras = document.querySelectorAll('[data-extra-author]');
  if (!extras.length) return;
  const showing = extras[0].style.display !== 'none';
  extras.forEach(el => el.style.display = showing ? 'none' : '');
  if (btn) btn.textContent = showing ? `Show ${extras.length} more authors` : 'Show fewer';
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
    const resp = await fetch('/api/paper-references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arxivId })
    });
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    let refs = data.references || [];
    if (!refs.length) {
      section.innerHTML = '<div class="text-[0.75rem] text-dimmer">No references found</div>';
      return;
    }

    // Sort by citation count (most cited first) since S2 doesn't preserve paper's citation order
    refs = refs.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));

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

function showReferenceByTitle(title, anchorEl) {
  _showTitleLookupPopup(title, anchorEl);
}

// ── Author Profile Page ──
async function openAuthorProfile(authorId) {
  hideAllViews();
  const view = await ensureView('author-profile-view');
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
          try { return katex.renderToString(decodeTex(tex), _katexOpts(true)); } catch { return _; }
        });
        html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
          try { return katex.renderToString(decodeTex(tex), _katexOpts(false)); } catch { return _; }
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
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(_paperNoteLink), { headers: _authHeaders() });
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

// _relativeTime defined in search.js (loaded after views.js)

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

// ── Universal panel integration for browse sidebar ──

function _renderPaperInfoHeader(container) {
  const paper = _currentPaperViewPaper;
  if (!paper) { container.innerHTML = ''; return; }
  const sourceName = (typeof SOURCE_NAMES !== 'undefined' && SOURCE_NAMES[paper.source]) || (paper.source?.startsWith('custom:') ? paper.source.slice(7) : '');
  let infoMeta = [];
  if (sourceName) infoMeta.push('<span class="text-meta-value">' + escapeHtml(sourceName) + '</span>');
  if (paper.published) infoMeta.push('<span class="text-dim">' + escapeHtml(paper.published) + '</span>');
  if (paper.categories && paper.categories.length) {
    paper.categories.slice(0, 3).forEach(function(c) {
      var fullName = (typeof ARXIV_CAT_NAMES !== 'undefined' && ARXIV_CAT_NAMES[c]) || '';
      infoMeta.push('<span class="text-[0.68rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border shrink-0 cursor-default"' + (fullName ? ' title="' + escapeHtml(fullName) + '"' : '') + '>' + escapeHtml(c) + '</span>');
    });
  }
  container.innerHTML = '<div id="sidebar-paper-info" class="px-4 py-3 border-b border-border-card shrink-0">' +
    '<div class="sidebar-paper-title text-[0.85rem] font-semibold text-primary leading-snug mb-1">' + renderTitle(paper.title) + '</div>' +
    '<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] mb-1">' + infoMeta.join('<span class="text-dimmest">\u00b7</span>') + '</div>' +
    '<div class="sidebar-paper-authors text-[0.72rem] text-muted leading-snug">' + (paper.authors ? escapeHtml(paper.authors) : '') + '</div>' +
    '<div id="sidebar-paper-authors-cards" class="mt-2"></div>' +
    '</div>';
}

function _renderBrowsePanes(container) {
  var username = escapeHtml((_authUserInfo && _authUserInfo.username) || _authUser || 'Anonymous');
  container.innerHTML =
    '<div data-pane-id="insights" id="sidebar-pane-insights" class="flex flex-col flex-1 min-h-0">' +
      '<div class="flex-1 overflow-y-auto px-4 pt-3 pb-4">' +
        '<div class="insight-section" id="insight-drop-ai"><div class="insight-section-title">AI</div><div class="insight-section-body" id="insight-pane-ai"></div></div>' +
        '<div class="insight-section" id="insight-drop-smart"><div class="insight-section-title" style="display:flex;align-items:center;gap:6px">Smart Highlights<span style="flex:1"></span><button id="smart-hl-toggle" class="pdf-tb-btn" title="Toggle highlights in PDF" onclick="toggleSmartHighlightsVisibility()" style="padding:2px 4px;font-size:0.7rem;opacity:1"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></button></div><div class="insight-section-body" id="insight-pane-smart"></div></div>' +
        '<div class="insight-section" id="insight-drop-references"><div class="insight-section-title">References</div><div class="insight-section-body" id="insight-pane-references"></div></div>' +
        '<div class="insight-section" id="insight-drop-links"><div class="insight-section-title">Links</div><div class="insight-section-body" id="insight-pane-links"><div id="pdf-links-section"></div></div></div>' +
      '</div>' +
    '</div>' +
    '<div data-pane-id="notes" id="sidebar-pane-notes" class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4" style="display:none">' +
      '<div id="pdf-highlights-section"><div id="pdf-highlights-panel"></div></div>' +
      '<div id="paper-notes-section"><div id="paper-note-editor" class="hidden"><div id="paper-note-rendered" class="hidden text-[0.82rem] text-primary leading-relaxed nb-rendered-md cursor-text" data-latex onclick="startPaperNoteEdit()"></div><textarea id="paper-note-textarea" class="hidden w-full bg-transparent border-none text-[0.82rem] text-primary p-0 resize-none focus:outline-none" rows="6" placeholder="Write your note\u2026"></textarea></div></div>' +
    '</div>' +
    '<div data-pane-id="comments" id="sidebar-pane-comments" class="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-4" style="display:none">' +
      '<div class="flex flex-col flex-1 min-h-0"><div id="comments-list" class="flex-1 overflow-y-auto"></div><div class="border-t border-border-card pt-2 mt-2 shrink-0"><div class="flex items-center gap-2 mb-2"><span class="text-[0.72rem] text-dim">Posting as</span><span class="text-[0.78rem] text-primary font-medium">' + username + '</span></div><textarea id="comment-input" class="w-full text-[0.78rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a comment..."></textarea><button onclick="postComment()" class="mt-1 px-3 py-1 text-[0.78rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none font-medium">Post</button></div></div>' +
    '</div>' +
    '<div data-pane-id="terminal" id="sidebar-pane-terminal" class="flex flex-col flex-1 min-h-0" style="display:none"><div id="sidebar-terminal-container" style="flex:1;min-height:0;padding:4px;"></div></div>' +
    '<div id="paper-selection-mirror" class="mx-4 mt-3 mb-3 shrink-0 hidden"></div>';
}

function _onBrowseTabSwitch(oldTab, newTab) {
  if (newTab === 'comments') fetchPaperComments();
  if (newTab === 'insights' && !_paperInsightsLoaded && _currentPaperViewPaper) {
    fetchPaperInsights(_currentPaperViewPaper.link);
  }
  if (newTab === 'terminal') _initSidebarTerminal();
  localStorage.setItem('sidebarTab', newTab);
}

// ── Smart Highlights ──

function _renderSmartHighlightsPane(url) {
  const pane = document.getElementById('insight-pane-smart');
  if (!pane) return;

  // Derive cache key (arXiv ID or URL)
  const arxivMatch = url.match(/(\d{4}\.\d{4,5})/);
  const cacheKey = arxivMatch ? arxivMatch[1] : url;

  // Check localStorage cache for instant render
  const cached = typeof loadSmartHighlights === 'function' ? loadSmartHighlights(cacheKey) : null;
  if (cached && cached.length) {
    _renderSmartHighlightsList(pane, cached);
    if (typeof renderSmartHighlightsInPdf === 'function' && typeof pdfTextExists === 'function') {
      var pdfItems = cached.filter(function(h) { return pdfTextExists(h.text.replace(/\.\.\.$/, '')); });
      renderSmartHighlightsInPdf(pdfItems);
    }
    return;
  }

  // Auto-generate
  _generateSmartHighlights(url);
}

async function _generateSmartHighlights(url) {
  const pane = document.getElementById('insight-pane-smart');
  if (!pane) return;

  pane.innerHTML = '<div class="flex items-center gap-2 text-[0.75rem] text-dim py-1"><span class="spinner"></span>Extracting highlights...</div>';
  var _hlModel = localStorage.getItem('chatModel') || 'default';
  islandUpdate('ai-highlights', { type: 'ai', label: _hlModel, detail: 'Highlights \u00B7 ' + _hlModel });

  try {
    const resp = await fetch('/api/paper-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode: 'highlights', model: localStorage.getItem('chatModel') || '' })
    });
    islandRemove('ai-highlights');
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    var items = data.highlights || [];

    // Cache non-empty results only
    const arxivMatch = url.match(/(\d{4}\.\d{4,5})/);
    const cacheKey = arxivMatch ? arxivMatch[1] : url;
    if (items.length && typeof saveSmartHighlights === 'function') saveSmartHighlights(cacheKey, items);

    // Render all items in sidebar
    _renderSmartHighlightsList(pane, items);

    // Only render PDF overlays for quotes that exist in the text layer
    if (typeof renderSmartHighlightsInPdf === 'function' && typeof pdfTextExists === 'function') {
      var pdfItems = items.filter(h => pdfTextExists(h.text.replace(/\.\.\.$/, '')));
      renderSmartHighlightsInPdf(pdfItems);
    }
  } catch (e) {
    islandRemove('ai-highlights');
    console.error('[Smart Highlights] Error:', e);
    pane.innerHTML = '<div class="text-[0.75rem] text-dimmer">Failed to extract highlights</div>';
  }
}

function _renderSmartHighlightsList(pane, items) {
  if (!pane || !items.length) {
    if (pane) pane.innerHTML = '<div class="text-[0.75rem] text-dimmer">No highlights found</div>';
    return;
  }

  const catColors = {
    Claim:  { border: '#42a5f5', text: 'text-blue-400' },
    Method: { border: '#ab47bc', text: 'text-purple-400' },
    Result: { border: '#4caf50', text: 'text-green-400' },
  };
  const catOrder = ['Claim', 'Method', 'Result'];
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  let html = '<div class="space-y-3">';
  for (const cat of catOrder) {
    const group = grouped[cat];
    if (!group || !group.length) continue;
    const colors = catColors[cat] || catColors.Claim;
    html += `<div>
      <div class="text-[0.68rem] font-semibold ${colors.text} uppercase tracking-wide mb-1">${escapeHtml(cat)}s</div>
      <div class="space-y-1.5">`;
    for (const item of group) {
      const searchSnippet = item.text.replace(/\.\.\.$/, '');
      html += `<div class="smart-hl-item cursor-pointer transition-colors hover:bg-white/5 rounded p-1.5 -mx-1.5" data-q="${escapeHtml(searchSnippet)}" style="border-left:2px solid ${colors.border};padding-left:8px">
        <div class="text-[0.75rem] text-muted leading-relaxed">${escapeHtml(item.summary || item.text)}</div>
      </div>`;
    }
    html += '</div></div>';
  }
  html += '</div>';
  pane.innerHTML = html;

  // Bind hover/click interactions
  pane.querySelectorAll('.smart-hl-item').forEach(card => {
    card.addEventListener('mouseenter', () => { if (typeof pdfSearchHighlight === 'function') pdfSearchHighlight(card.dataset.q, true); });
    card.addEventListener('mouseleave', () => { if (typeof pdfClearSearchHighlights === 'function') pdfClearSearchHighlights(); });
    card.addEventListener('click', () => { if (typeof pdfSearchHighlight === 'function') pdfSearchHighlight(card.dataset.q, false); });
  });
}

registerPanelTabs('browse', {
  header: _renderPaperInfoHeader,
  renderAll: true,
  renderContent: _renderBrowsePanes,
  tabs: [
    { id: 'insights',  label: 'Insights',  icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { id: 'notes',     label: 'Notes',     icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    { id: 'comments',  label: 'Comments',  icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" /></svg>' },
    { id: 'terminal',  label: 'Terminal',  icon: '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' }
  ],
  onTabSwitch: _onBrowseTabSwitch
});
