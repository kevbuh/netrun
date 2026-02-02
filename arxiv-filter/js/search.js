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
  const query = (document.getElementById('search-query')?.value || '').trim();
  renderSearchFeedResults(query);
}

function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;
  if (typeof saveSearchHistory === 'function') saveSearchHistory(query);
  hideSearchHistoryView();
  const hints = document.getElementById('search-hints');
  if (hints) hints.style.display = 'none';
  // Filter feed results
  renderSearchFeedResults(query);
  // Skip arXiv search if query is only source:/sort: prefixes (no searchable terms)
  const searchableTokens = query.split(/\s+/).filter(t => !t.startsWith('source:') && !t.startsWith('sort:'));
  if (searchableTokens.length === 0) return;
  searchCurrentStart = 0;
  searchSort = 'citations';
  searchCurrentQuery = query;
  // Reset OpenAlex (lazy-loaded on header click)
  openalexResultsCache = [];
  openalexLoaded = false;
  openalexCollapsed = true;
  arxivCollapsed = false;
  doSearchArxiv();
  // Show collapsed OpenAlex header
  const oaContainer = document.getElementById('search-openalex-results');
  if (oaContainer) renderOpenAlexHeader(oaContainer, false);
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
      return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchFeedPaper(${i})">
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

function openSearchFeedPaper(i) {
  const matches = searchResultsCache._feedMatches;
  if (!matches || !matches[i]) return;
  openPaperByUrl(matches[i].link);
}

async function doSearchArxiv() {
  const container = document.getElementById('search-arxiv-results');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Searching arXiv...</div></div>';
  try {
    const resp = await fetch(`/api/arxiv-search?q=${encodeURIComponent(searchCurrentQuery)}&start=${searchCurrentStart}&max_results=100`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    parseSearchArxivResults(xml);
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

  let sorted = [...searchResultsCache].filter(r => r && r.title);
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
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchArxivPaper(${i})">
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
    const resp = await fetch('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (resp.ok) {
      const data = await resp.json();
      for (const r of searchResultsCache) {
        if (r && r.arxivId && data[r.arxivId] !== undefined) {
          r.citations = data[r.arxivId];
        }
      }
      renderSearchArxivResults(total);
    }
  } catch (e) { /* silently fail */ }
}

function openSearchArxivPaper(i) {
  const r = searchResultsSorted[i];
  if (r && r.link) openPaperByUrl(r.link);
}

function searchPrev() {
  searchCurrentStart = Math.max(0, searchCurrentStart - 100);
  doSearchArxiv();
}

function searchNext() {
  searchCurrentStart += 100;
  doSearchArxiv();
}

// ── OpenAlex Search ──
let openalexResultsCache = [];
let openalexSort = 'citations';
let openalexResultsSorted = [];
let openalexCollapsed = true;
let openalexLoaded = false;

function toggleOpenAlexCollapse() {
  openalexCollapsed = !openalexCollapsed;
  if (!openalexCollapsed && !openalexLoaded && searchCurrentQuery) {
    openalexLoaded = true;
    doSearchOpenAlex();
    return;
  }
  renderOpenAlexResults();
}

async function doSearchOpenAlex() {
  const container = document.getElementById('search-openalex-results');
  if (!container) return;
  renderOpenAlexHeader(container, true);
  try {
    const resp = await fetch(`/api/openalex-search?q=${encodeURIComponent(searchCurrentQuery)}&per_page=100`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    openalexResultsCache = (data.results || []).map(w => {
      const authors = (w.authorships || []).map(a => a.author?.display_name || '').filter(Boolean).join(', ');
      const published = w.publication_date || '';
      const dateStr = published ? formatDate(new Date(published + 'T00:00:00')) : '';
      const doi = w.doi || '';
      const link = doi || (w.primary_location?.landing_page_url || w.id || '');
      const source = w.primary_location?.source?.display_name || '';
      return { title: w.title || '', authors, link, date: dateStr, pubDate: published, citations: w.cited_by_count || 0, source, type: w.type || '' };
    });
    renderOpenAlexResults();
  } catch (err) {
    renderOpenAlexHeader(container, false);
  }
}

function renderOpenAlexHeader(container, loading) {
  const chevron = openalexCollapsed
    ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'
    : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const count = openalexResultsCache.length ? ` <span class="text-[0.7rem] normal-case">(${openalexResultsCache.length})</span>` : '';
  const loadingEl = loading ? ' <span class="text-[0.7rem] text-dim normal-case">loading...</span>' : '';
  container.innerHTML = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleOpenAlexCollapse()">${chevron} OpenAlex${count}${loadingEl}</button>
  </div>`;
}

function renderOpenAlexResults() {
  const container = document.getElementById('search-openalex-results');
  if (!container) return;
  if (!searchCurrentQuery) { container.innerHTML = ''; return; }

  if (openalexCollapsed || !openalexResultsCache.length) {
    renderOpenAlexHeader(container, false);
    return;
  }

  let sorted = [...openalexResultsCache];
  if (openalexSort === 'citations') {
    sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  } else {
    sorted.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const chevron = '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const isCited = openalexSort === 'citations';
  const sortIcon = isCited
    ? `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>`
    : `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
  const header = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleOpenAlexCollapse()">${chevron} OpenAlex <span class="text-[0.7rem] normal-case">(${sorted.length})</span></button>
    <button class="shrink-0 w-7 h-7 rounded-lg border border-border-input bg-card text-muted cursor-pointer transition-all duration-150 hover:border-accent hover:text-primary flex items-center justify-center" onclick="setOpenAlexSort('${isCited ? 'latest' : 'citations'}')" title="${isCited ? 'Sort by latest' : 'Sort by most cited'}">${sortIcon}</button>
  </div>`;

  openalexResultsSorted = sorted;
  container.innerHTML = header + sorted.map((r, i) => {
    const sourceTag = r.source ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(truncate(r.source, 30))}</span>` : '';
    const authorLabel = _searchAuthorLabel(r.authors);
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openOpenAlexPaper(${i})">
      ${sourceTag}<span class="text-[0.82rem] text-primary truncate">${escapeHtml(r.title)}</span>
      ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
      ${r.link ? `<span class="shrink-0">${renderStarRating(r.link, { size: 'sm', interactive: true })}</span>` : ''}
      <span class="text-[0.68rem] text-dim shrink-0">${r.citations} cited</span>
      ${r.date ? `<span class="text-[0.68rem] text-dim shrink-0 ml-auto">${escapeHtml(r.date)}</span>` : ''}
    </div>`;
  }).join('');
}

function setOpenAlexSort(mode) {
  openalexSort = mode;
  renderOpenAlexResults();
}

function openOpenAlexPaper(i) {
  const r = openalexResultsSorted[i];
  if (!r || !r.link) return;
  openPaperByUrl(r.link);
}

// ── Browse View (multi-tab embedded browser) ──

let _browseTabs = []; // { id, url, title, el }
let _browseActiveTab = null;
let _browseNextId = 1;
const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);

function openBrowse(url) {
  hideAllViews();
  const view = document.getElementById('browse-view');
  view.classList.add('active');
  view.style.display = 'flex';
  view.style.flexDirection = 'column';
  window.location.hash = 'browse';
  setSidebarActive('sb-browse');
  if (!_browseTabs.length) {
    browseNewTab(url);
  } else {
    if (url) browseNewTab(url);
    else _browseRenderTabs();
  }
}

function browseNewTab(url) {
  const id = _browseNextId++;
  const isBlank = !url;
  const resolved = isBlank ? '' : _browseResolveUrl(url);

  let el = null;
  if (!isBlank) {
    const container = document.getElementById('browse-content');
    el = _browseCreateFrame(id, resolved);
    el.style.display = 'none';
    container.appendChild(el);
  }

  const tab = { id, url: resolved, title: isBlank ? 'New Tab' : _browseTitleFromUrl(resolved), favicon: isBlank ? '' : _browseFaviconUrl(resolved), el, blank: isBlank };
  _browseTabs.push(tab);
  if (el) _browseBindFrame(tab);

  browseSelectTab(id);
  setTimeout(() => {
    const urlInput = document.getElementById('browse-url-input');
    if (urlInput) { urlInput.focus(); urlInput.select(); }
  }, 50);
}

function _browseCreateFrame(id, url) {
  const el = document.createElement(_browseIsElectron ? 'webview' : 'iframe');
  el.id = 'browse-frame-' + id;
  el.src = url;
  el.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;';
  if (!_browseIsElectron) {
    el.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
    el.referrerPolicy = 'no-referrer';
  }
  return el;
}

function _browseBindFrame(tab) {
  const el = tab.el;
  if (!el || !_browseIsElectron) return;
  el.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    tab.blank = false;
    _browseRenderTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
    }
  });
  el.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
    }
  });
  el.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    _browseRenderTabs();
  });
  el.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length) tab.favicon = e.favicons[0];
    _browseRenderTabs();
  });
  el.addEventListener('new-window', (e) => {
    e.preventDefault();
    browseNewTab(e.url);
  });
}

function browseSelectTab(id) {
  _browseActiveTab = id;
  const tab = _browseTabs.find(t => t.id === id);
  _browseTabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = tab ? tab.url : '';
  _browseRenderTabs();
  _browseUpdateSaveBtn();
}

function browseCloseTab(id) {
  const idx = _browseTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = _browseTabs[idx];
  if (tab.el) tab.el.remove();
  _browseTabs.splice(idx, 1);
  if (!_browseTabs.length) {
    browseNewTab();
    return;
  }
  if (_browseActiveTab === id) {
    const nextIdx = Math.min(idx, _browseTabs.length - 1);
    browseSelectTab(_browseTabs[nextIdx].id);
  } else {
    _browseRenderTabs();
  }
}

function _browseRenderTabs() {
  const bar = document.getElementById('browse-tabs');
  if (!bar) return;
  bar.innerHTML = _browseTabs.map(t => {
    const active = t.id === _browseActiveTab;
    const title = escapeHtml(t.title.length > 24 ? t.title.slice(0, 22) + '...' : t.title);
    const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : '';
    return `<div class="browse-tab ${active ? 'active' : ''}" onclick="browseSelectTab(${t.id})" title="${escapeHtml(t.title)}">
      ${fav}<span class="browse-tab-title">${title}</span>
      <button class="browse-tab-close" onclick="event.stopPropagation();browseCloseTab(${t.id})" title="Close tab">&times;</button>
    </div>`;
  }).join('') + `<button class="browse-tab-new" onclick="browseNewTab()" title="New tab">+</button>`;
}

function _browseTitleFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/search') {
      const q = u.searchParams.get('q');
      return q ? q + ' - Google' : 'Google';
    }
    return u.hostname.replace(/^www\./, '');
  } catch { return url; }
}

function _browseFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
}

function browseNavigate(input) {
  const url = _browseResolveUrl(input);
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) { browseNewTab(url); return; }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  if (!tab.el) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
  } else {
    tab.el.src = url;
  }
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = url;
  _browseRenderTabs();
  _browseUpdateSaveBtn();
}

function _browseResolveUrl(input) {
  input = (input || '').trim();
  if (!input) return 'https://www.google.com';
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(input)) return 'https://' + input;
  return 'https://www.google.com/search?q=' + encodeURIComponent(input);
}

function _browseActiveEl() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  return tab ? tab.el : null;
}

function browseBack() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoBack && el.canGoBack()) { el.goBack(); return; }
  if (!_browseIsElectron) { try { el.contentWindow.history.back(); } catch(e) {} }
}

function browseForward() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoForward && el.canGoForward()) { el.goForward(); return; }
  if (!_browseIsElectron) { try { el.contentWindow.history.forward(); } catch(e) {} }
}

function browseReload() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.reload) { el.reload(); return; }
  if (!_browseIsElectron) { try { el.contentWindow.location.reload(); } catch(e) {} }
}

function browseSaveToReadingList() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  const paper = { title: tab.title, link: tab.url, source: 'browse', description: '', authors: '', date: '' };
  const saved = getSavedPosts();
  if (saved[tab.url]) {
    delete saved[tab.url];
  } else {
    saved[tab.url] = { paper, savedAt: Date.now(), read: false };
    if (typeof petReact === 'function') petReact('happy');
  }
  savePosts(saved);
  updateSavedBadge();
  _browseUpdateSaveBtn();
}

function browseShare() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  if (navigator.share) {
    navigator.share({ title: tab.title, url: tab.url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(tab.url).then(() => {
      const btn = document.querySelector('#browse-bar button[onclick="browseShare()"]');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';
        btn.classList.add('text-primary');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('text-primary'); }, 1500);
      }
    });
  }
}

function _browseUpdateSaveBtn() {
  const btn = document.getElementById('browse-save-btn');
  if (!btn) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const saved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', saved ? 'var(--accent)' : 'none');
    svg.setAttribute('stroke', saved ? 'var(--accent)' : 'currentColor');
  }
}

// ── Search History (for search view) ──
function selectSearchHistory(index) {
  const hist = getSearchHistory();
  if (!hist[index]) return;
  const input = document.getElementById('search-query');
  if (input) input.value = hist[index];
  hideSearchHistoryView();
  submitSearch();
}

function showSearchHistoryView() {
  const input = document.getElementById('search-query');
  const dd = document.getElementById('search-history-dropdown-view');
  if (!dd || !input) return;
  if (input.value.trim()) { dd.classList.add('hidden'); return; }
  const hist = getSearchHistory();
  if (!hist.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = hist.map((h, i) => `<div class="flex items-center gap-2 px-3 py-1.5 hover:bg-hover cursor-pointer text-[0.82rem] text-primary" onmousedown="event.preventDefault(); selectSearchHistory(${i})">
    <span class="truncate flex-1">${escapeHtml(h)}</span>
    <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary" onmousedown="event.preventDefault(); event.stopPropagation(); removeSearchHistory(${i});">×</button>
  </div>`).join('');
  dd.classList.remove('hidden');
}

function hideSearchHistoryView() {
  const dd = document.getElementById('search-history-dropdown-view');
  if (dd) dd.classList.add('hidden');
}


