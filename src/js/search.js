// ── Search View ──
let searchResultsCache = [];
let searchCurrentQuery = '';
let searchCurrentStart = 0;
let searchSort = 'citations';
let searchLastTotal = 0;
let searchResultsSorted = [];
function _searchAuthorLabel(authors) {
  if (!authors) return '';
  const list = authors.split(',').map(a => a.trim()).filter(Boolean);
  if (!list.length) return '';
  const byMatch = searchCurrentQuery.match(/\bby:(.+)/i);
  if (byMatch) {
    const needle = byMatch[1].trim().toLowerCase();
    const match = list.find(a => a.toLowerCase().includes(needle));
    if (match) return escapeHtml(match);
  }
  return list.length > 1 ? escapeHtml(list[0]) + ' et al.' : escapeHtml(list[0]);
}

function onSearchInput() {
  const input = document.getElementById('search-query');
  const query = (input?.value || '').trim();
  // If input cleared on new-tab page, hide dropdown but keep input focused
  if (!query && input && input.closest('.browse-ntp')) {
    if (typeof _browseUrlHideHistory === 'function') _browseUrlHideHistory();
    renderSearchFeedResults('');
    return;
  }
  renderSearchFeedResults(query);
  showSearchHistoryView();
}

function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;

  // If files are uploaded on NTP, open Aether panel with file context
  if (typeof _ntpUploadedFiles !== 'undefined' && _ntpUploadedFiles.length > 0) {
    const fileEntries = _ntpUploadedFiles.map(f => ({ name: f.name, content: f.content || '' }));
    _ntpUploadedFiles = [];
    _renderNtpFileChips();
    if (typeof _showPanel === 'function') {
      _showPanel({ anchor: { x: window.innerWidth / 2 - 200, y: 120 }, initialValue: query, finalized: true });
      // Set file contexts AFTER _showPanel (which clears them during reset)
      if (typeof _pendingFileContexts !== 'undefined') {
        for (const f of fileEntries) _pendingFileContexts.push(f);
      }
      // Auto-send the query
      setTimeout(() => {
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) {
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = query; }
          if (typeof _sendPopupChatMessage === 'function') _sendPopupChatMessage(popup);
        }
      }, 50);
    }
    return;
  }

  // Default: navigate via browseNavigate (Google search or URL)
  // Paper search only when Papers tab is explicitly active
  if (_researchActiveTab !== 'search') {
    if (typeof browseNavigate === 'function') browseNavigate(query);
    return;
  }

  // Handle user: search - open user profile directly
  const userMatch = query.match(/^user:(.+)$/i);
  if (userMatch) {
    const username = userMatch[1].trim();
    if (username && typeof openUserProfile === 'function') {
      openUserProfile(username);
      return;
    }
  }

  if (typeof saveSearchHistory === 'function') saveSearchHistory(query);
  hideSearchHistoryView();
  const hints = document.getElementById('search-hints');
  if (hints) hints.style.display = 'none';

  // Semantic search mode: ~query
  if (query.startsWith('~')) {
    const semQuery = query.slice(1).trim();
    if (semQuery) { doSemanticSearch(semQuery); return; }
  }

  // Filter feed results
  renderSearchFeedResults(query);
  // Count feed matches for history
  const feedCount = (searchResultsCache._feedMatches || []).length;
  // Skip arXiv search if query is only source:/sort: prefixes (no searchable terms)
  const searchableTokens = query.split(/\s+/).filter(t => !t.startsWith('source:') && !t.startsWith('sort:'));
  if (searchableTokens.length === 0) {
    if (feedCount && typeof _updateSearchHistoryCount === 'function') _updateSearchHistoryCount(feedCount);
    return;
  }
  searchCurrentStart = 0;
  searchSort = 'citations';
  searchCurrentQuery = query;
  arxivCollapsed = false;
  doSearchArxiv().then(() => {
    const arxivCount = searchResultsCache ? searchResultsCache.length : 0;
    if (typeof _updateSearchHistoryCount === 'function') _updateSearchHistoryCount(feedCount + arxivCount);
  });
}

function renderSearchFeedResults(query) {
  const container = document.getElementById('search-feed-results');
  if (!container) return;
  if (!query) { container.innerHTML = ''; return; }
  const parsed = parseSearchQuery(query.toLowerCase());
  const { authorFilter, sourceFilter, textTokens, exactPhrases, titleTokens, titlePhrases } = parsed;
  const matches = allPapers.filter(p => {
    if (authorFilter && !(p.authors || '').toLowerCase().includes(authorFilter)) return false;
    if (sourceFilter && !p.source.toLowerCase().includes(sourceFilter) && !(SOURCE_NAMES[p.source] || '').toLowerCase().includes(sourceFilter)) return false;
    const allPhrases = exactPhrases.slice();
    if (textTokens.length) allPhrases.push(textTokens.join(' '));
    if (allPhrases.length || titleTokens.length || titlePhrases.length) {
      const titleLow = p.title.toLowerCase();
      const h = `${p.title} ${p.authors} ${p.description}`.toLowerCase();
      if (!allPhrases.every(ph => h.includes(ph))) return false;
      if (!titlePhrases.every(ph => titleLow.includes(ph))) return false;
      if (!titleTokens.every(t => titleLow.includes(t))) return false;
      return true;
    }
    return !!(authorFilter || sourceFilter);
  }).slice(0, 30);

  if (!matches.length) {
    container.innerHTML = '';

    return;
  }

  container.innerHTML = `<div class="mb-2 text-[0.75rem] text-dimmer uppercase tracking-wide">Feed (${matches.length})</div>` +
    matches.map((p, i) => {
      const sourceChip = getSourceChip(p.source, p.arxivId);
      const authorLabel = _searchAuthorLabel(p.authors);
      const date = p.date ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(p.date)}</span>` : '';
      return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchFeedPaper(${i}, event)">
        ${sourceChip}
        <span class="text-[0.82rem] text-primary truncate">${renderTitle(p.title)}</span>
        ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
        <span class="shrink-0">${renderStarRating(p.link, { size: 'sm', interactive: true })}</span>
        <span class="ml-auto shrink-0">${date}</span>
      </div>`;
    }).join('');

  // Stash matches for click handling
  searchResultsCache._feedMatches = matches;
}

function openSearchFeedPaper(i, e) {
  const matches = searchResultsCache._feedMatches;
  if (!matches || !matches[i]) return;
  openPaperByUrl(matches[i].link, e);
}

async function doSearchArxiv() {
  const container = document.getElementById('search-arxiv-results');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Searching arXiv...</div></div>';
  try {
    const data = await apiGet(`/api/arxiv-search?q=${encodeURIComponent(searchCurrentQuery)}&start=${searchCurrentStart}&max_results=100`);
    parseSearchArxivResults(data.xml);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-dim text-[0.9rem]">Search failed: ${err.message}</div>`;
  }
}

function parseSearchArxivResults(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ns = 'http://www.w3.org/2005/Atom';
  const entries = doc.getElementsByTagNameNS(ns, 'entry');
  const totalStr = doc.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/', 'totalResults')[0]?.textContent || '0';
  const total = parseInt(totalStr, 10);

  searchResultsCache = Array.from(entries).map(entry => {
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

  renderSearchArxivResults(total);
  fetchSearchCitations(total);
}

let arxivCollapsed = false;

function toggleArxivCollapse() {
  arxivCollapsed = !arxivCollapsed;
  renderSearchArxivResults(searchLastTotal);
}

function setSearchSort(mode) {
  searchSort = mode;
  renderSearchArxivResults(searchLastTotal);
}

function renderSearchArxivResults(total) {
  const container = document.getElementById('search-arxiv-results');
  if (!container) return;
  if (!searchResultsCache.length || typeof searchResultsCache[0] === 'undefined') {
    if (!Array.isArray(searchResultsCache) || !searchResultsCache.length) {
      searchResultsCache = [];
    }
  }

  const sorted = [...searchResultsCache].filter(r => r && r.title);
  if (searchSort === 'citations') {
    sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  } else if (searchSort === 'latest') {
    sorted.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const chevron = arxivCollapsed
    ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'
    : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const isCited = searchSort === 'citations';
  const sortIcon = isCited
    ? `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>`
    : `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
  const header = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleArxivCollapse()">${chevron} arXiv <span class="text-[0.7rem] normal-case">(${sorted.length})</span></button>
    ${!arxivCollapsed ? `<button class="shrink-0 w-7 h-7 rounded-lg border border-border-input bg-card text-muted cursor-pointer transition-all duration-150 hover:border-accent hover:text-primary flex items-center justify-center" onclick="setSearchSort('${isCited ? 'latest' : 'citations'}')" title="${isCited ? 'Sort by latest' : 'Sort by most cited'}">${sortIcon}</button>` : ''}
  </div>`;

  if (arxivCollapsed) {
    container.innerHTML = header;
    searchLastTotal = total;
    return;
  }

  searchResultsSorted = sorted;
  container.innerHTML = header + sorted.map((r, i) => {
    const authorLabel = _searchAuthorLabel(r.authors);
    const rLink = r.arxivId ? `https://arxiv.org/abs/${r.arxivId}` : (r.link || '');
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchArxivPaper(${i}, event)">
      ${r.arxivId ? ARXIV_LOGO_INLINE : ''}<span class="text-[0.82rem] text-primary truncate">${renderTitle(r.title)}</span>
      ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
      ${rLink ? `<span class="shrink-0">${renderStarRating(rLink, { size: 'sm', interactive: true })}</span>` : ''}
      ${r.citations !== undefined ? `<span class="text-[0.68rem] text-dim shrink-0">${r.citations} cited</span>` : ''}
      ${r.date ? `<span class="text-[0.68rem] text-dim shrink-0 ml-auto">${escapeHtml(r.date)}</span>` : ''}
    </div>`;
  }).join('') + (total > 100 ? `
    <div class="finder-pagination flex justify-center gap-3 pt-6">
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${searchCurrentStart === 0 ? 'disabled' : ''} onclick="searchPrev()">Previous</button>
      <span class="text-dimmer text-[0.8rem] self-center">${searchCurrentStart + 1}&ndash;${searchCurrentStart + sorted.length} of ${total}</span>
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${searchCurrentStart + 100 >= total ? 'disabled' : ''} onclick="searchNext()">Next</button>
    </div>
  ` : '');
  searchLastTotal = total;
}

async function fetchSearchCitations(total) {
  const results = searchResultsCache.filter(r => r && r.arxivId);
  const ids = results.map(r => r.arxivId);
  if (!ids.length) return;
  try {
    const data = await apiPost('/api/citations', { ids });
    if (data) {
      for (const r of searchResultsCache) {
        if (r && r.arxivId && data[r.arxivId] !== undefined) {
          r.citations = data[r.arxivId];
        }
      }
      renderSearchArxivResults(total);
    }
  } catch (e) { /* silently fail */ }
}

function openSearchArxivPaper(i, e) {
  const r = searchResultsSorted[i];
  if (r && r.link) openPaperByUrl(r.link, e);
}

function searchPrev() {
  searchCurrentStart = Math.max(0, searchCurrentStart - 100);
  doSearchArxiv();
}

function searchNext() {
  searchCurrentStart += 100;
  doSearchArxiv();
}


// ── Browse tabs moved to browse-tabs.js ──

// ── Search History (for search view) ──
let _searchHistorySelectedIdx = -1;

function _relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function selectSearchHistory(index) {
  const hist = _getFilteredSearchHistory();
  if (!hist[index]) return;
  const input = document.getElementById('search-query');
  if (input) input.value = hist[index].q;
  hideSearchHistoryView();
  submitSearch();
}

function _getFilteredSearchHistory() {
  const input = document.getElementById('search-query');
  const filter = (input?.value || '').trim().toLowerCase();
  const hist = getSearchHistory();
  if (!filter) return hist.slice(0, 15);
  return hist.filter(h => h.q.toLowerCase().includes(filter));
}

function showSearchHistoryView() {
  const input = document.getElementById('search-query');
  const dd = document.getElementById('search-history-dropdown-view');
  if (!dd || !input) return;
  const filtered = _getFilteredSearchHistory();
  if (!filtered.length) { dd.classList.add('hidden'); return; }
  // Don't show dropdown if the input exactly matches the top entry (just submitted)
  const val = input.value.trim();
  if (filtered.length === 1 && filtered[0].q === val) { dd.classList.add('hidden'); return; }
  dd.innerHTML = filtered.map((h, i) => {
    const sel = i === _searchHistorySelectedIdx ? 'bg-hover' : '';
    const time = _relativeTime(h.ts);
    const count = h.c ? h.c + ' results' : '';
    const meta = [time, count].filter(Boolean).join(' · ');
    return `<div class="flex items-center gap-2 px-3 py-1.5 hover:bg-hover cursor-pointer text-[0.82rem] text-primary ${sel}" onmousedown="event.preventDefault(); selectSearchHistory(${i})">
      <svg class="w-3.5 h-3.5 text-dimmer shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
      <span class="truncate flex-1">${escapeHtml(h.q)}</span>
      <span class="text-[0.7rem] text-dimmer shrink-0 whitespace-nowrap">${escapeHtml(meta)}</span>
      <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary shrink-0" onmousedown="event.preventDefault(); event.stopPropagation(); removeSearchHistory(${_getSearchHistoryOriginalIndex(h.q)});">×</button>
    </div>`;
  }).join('');
  dd.classList.remove('hidden');
}

function _getSearchHistoryOriginalIndex(query) {
  return getSearchHistory().findIndex(h => h.q === query);
}

function hideSearchHistoryView() {
  const dd = document.getElementById('search-history-dropdown-view');
  if (dd) dd.classList.add('hidden');
  _searchHistorySelectedIdx = -1;
}

function _searchHistoryKeydown(e) {
  const dd = document.getElementById('search-history-dropdown-view');
  if (!dd || dd.classList.contains('hidden')) {
    if (e.key === 'Escape') { hideSearchHistoryView(); return; }
    return;
  }
  const filtered = _getFilteredSearchHistory();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _searchHistorySelectedIdx = Math.min(_searchHistorySelectedIdx + 1, filtered.length - 1);
    showSearchHistoryView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _searchHistorySelectedIdx = Math.max(_searchHistorySelectedIdx - 1, -1);
    showSearchHistoryView();
  } else if (e.key === 'Enter' && _searchHistorySelectedIdx >= 0) {
    e.preventDefault();
    selectSearchHistory(_searchHistorySelectedIdx);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideSearchHistoryView();
  }
}


// ── Semantic Search ──
async function doSemanticSearch(query) {
  const feedContainer = document.getElementById('search-feed-results');
  const arxivContainer = document.getElementById('search-arxiv-results');
  if (feedContainer) feedContainer.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Semantic search...</div></div>';
  if (arxivContainer) arxivContainer.innerHTML = '';
  try {
    islandUpdate('ai-semantic', { type: 'ai', label: 'nomic-embed-text', detail: 'Semantic search \u00B7 nomic-embed-text' });
    let data;
    try { data = await apiPost('/api/semantic-search', { query, limit: 20 }); }
    finally { islandRemove('ai-semantic'); }
    _renderSemanticResults(feedContainer, data.results || [], `Semantic results for "${query}"`);
  } catch (err) {
    if (feedContainer) feedContainer.innerHTML = `<div class="text-center py-8 text-dim text-[0.9rem]">${err.message === 'HTTP 503' ? 'Embedding model not available. Run: <code>ollama pull nomic-embed-text</code>' : 'Search failed: ' + escapeHtml(err.message)}</div>`;
  }
}

// ── Browse URL bar moved to browse-urlbar.js ──
