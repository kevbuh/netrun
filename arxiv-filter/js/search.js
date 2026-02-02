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

function _browseSaveTabs() {
  const data = _browseTabs
    .filter(t => !t.blank && t.url)
    .map(t => ({ id: t.id, url: t.url, title: t.title }));
  localStorage.setItem('browseTabs', JSON.stringify({ tabs: data, activeTab: _browseActiveTab, nextId: _browseNextId }));
}

function _browseRestoreTabs() {
  try {
    const raw = localStorage.getItem('browseTabs');
    if (!raw) return false;
    const { tabs, activeTab, nextId } = JSON.parse(raw);
    if (!tabs || !tabs.length) return false;
    _browseNextId = nextId || (Math.max(...tabs.map(t => t.id)) + 1);
    const container = document.getElementById('browse-content');
    for (const saved of tabs) {
      const el = _browseCreateFrame(saved.id, saved.url);
      el.style.display = 'none';
      container.appendChild(el);
      const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false };
      _browseTabs.push(tab);
      _browseBindFrame(tab);
    }
    const target = _browseTabs.find(t => t.id === activeTab) ? activeTab : _browseTabs[0].id;
    browseSelectTab(target);
    return true;
  } catch { return false; }
}

let _browseReturnView = null; // set by openPaper/inbox to enable "back to feed/inbox" button

function _browseGoBack() {
  const nav = { feed: goHome, dashboard: openDashboard, search: openSearch, inbox: typeof openInbox === 'function' ? openInbox : null, calendar: typeof openCalendar === 'function' ? openCalendar : null, settings: typeof openSettings === 'function' ? openSettings : null };
  const fn = nav[_browseReturnView];
  _browseReturnView = null;
  if (fn) fn(); else goHome();
}

function openBrowse(url) {
  hideAllViews();
  // Clear paper-sidebar to avoid duplicate IDs
  const paperSb = document.getElementById('paper-sidebar');
  if (paperSb) paperSb.innerHTML = '';

  const view = document.getElementById('browse-view');
  view.classList.add('active');
  view.style.display = 'flex';
  view.style.flexDirection = 'column';
  window.location.hash = 'browse';
  setSidebarActive('sb-browse');

  // Initialize browse sidebar (hidden by default)
  const browseSb = document.getElementById('browse-sidebar');
  if (browseSb) {
    browseSb.innerHTML = _renderSidebarHTML();
    _initSidebar(browseSb);
    browseSb.style.display = 'none';
  }

  if (!_browseTabs.length) {
    if (!url && !_browseRestoreTabs()) {
      browseNewTab(url);
    } else if (url) {
      browseNewTab(url);
    }
  } else {
    if (url) browseNewTab(url);
    else {
      _browseRenderTabs();
      // Update sidebar for current tab
      const tab = _browseTabs.find(t => t.id === _browseActiveTab);
      if (tab && tab.url && !tab.blank) _initSidebarForUrl(tab.url);
    }
  }
  _browseInstallPinchOverlay();
  _browseInstallKeyGuard();
  // Show/hide return button
  const retBtn = document.getElementById('browse-return-btn');
  if (retBtn) retBtn.style.display = _browseReturnView ? '' : 'none';
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
  _browseSaveTabs();
  setTimeout(() => {
    const urlInput = document.getElementById('browse-url-input');
    if (urlInput) { urlInput.focus(); urlInput.select(); }
  }, 50);
}

function _browseProxyUrl(url) {
  if (localStorage.getItem('adBlockEnabled') === 'true' && !_browseIsElectron && url) {
    return '/api/browse-proxy?url=' + encodeURIComponent(url);
  }
  return url;
}

function _browseCreateFrame(id, url) {
  const el = document.createElement(_browseIsElectron ? 'webview' : 'iframe');
  el.id = 'browse-frame-' + id;
  const proxied = _browseProxyUrl(url);
  el.src = proxied;
  el.dataset.originalUrl = url;
  el.style.cssText = 'width:100%;height:100%;border:none;position:absolute;top:0;left:0;';
  if (!_browseIsElectron) {
    el.sandbox = 'allow-scripts allow-same-origin allow-popups allow-forms';
    el.referrerPolicy = 'no-referrer';
  }
  // Fetch blocked count after load
  if (proxied !== url) {
    el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
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
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
  });
  el.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    _browseRenderTabs();
    _browseSaveTabs();
    if (_browseActiveTab === tab.id) {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) urlInput.value = e.url;
      _browseUpdateSaveBtn();
      if (typeof _initSidebarForUrl === 'function') _initSidebarForUrl(e.url);
    }
  });
  el.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || _browseTitleFromUrl(tab.url);
    _browseRenderTabs();
    _browseSaveTabs();
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
  _browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  // Update sidebar for the selected tab
  if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
    _initSidebarForUrl(tab.url);
  }
}

function _browseUpdateNewTabPage(tab) {
  const container = document.getElementById('browse-content');
  if (!container) return;
  let ntp = container.querySelector('.browse-ntp');
  if (tab && tab.blank) {
    if (!ntp) {
      ntp = document.createElement('div');
      ntp.className = 'browse-ntp';
      ntp.innerHTML = '<span class="browse-ntp-text">alpha</span>';
      container.appendChild(ntp);
    }
    ntp.style.display = '';
  } else if (ntp) {
    ntp.style.display = 'none';
  }
}

function browseCloseTab(id) {
  const idx = _browseTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = _browseTabs[idx];
  const wasLast = _browseTabs.length === 1;
  if (tab.el) tab.el.remove();
  _browseTabs.splice(idx, 1);
  if (!_browseTabs.length) {
    browseNewTab();
    if (wasLast) _browseAnimateBounce();
    return;
  }
  if (_browseActiveTab === id) {
    const nextIdx = Math.min(idx, _browseTabs.length - 1);
    browseSelectTab(_browseTabs[nextIdx].id);
  } else {
    _browseRenderTabs();
  }
  _browseSaveTabs();
}

function _browseAnimateBounce() {
  const content = document.getElementById('browse-content');
  if (!content) return;
  content.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  content.style.transform = 'translateX(-60px) scale(0.97)';
  requestAnimationFrame(() => {
    setTimeout(() => {
      content.style.transform = '';
      setTimeout(() => { content.style.transition = ''; }, 350);
    }, 120);
  });
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
    const proxied = _browseProxyUrl(url);
    tab.el.dataset.originalUrl = url;
    tab.el.src = proxied;
    if (proxied !== url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(url), { once: true });
    }
  }
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = url;
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateAdBlockBtn();
  _browseUpdateNewTabPage(tab);
  // Update sidebar for the navigated URL
  if (typeof _initSidebarForUrl === 'function') {
    _initSidebarForUrl(url);
  }
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

let _browseZoomLevel = 1.0;
let _browseZoomHideTimer = null;
function _browseShowZoomControls() {
  const controls = document.getElementById('browse-zoom-controls');
  if (!controls) return;
  controls.style.display = 'flex';
  clearTimeout(_browseZoomHideTimer);
  _browseZoomHideTimer = setTimeout(() => { controls.style.display = 'none'; }, 1500);
}
function browseZoom(dir) {
  if (dir === 0) _browseZoomLevel = 1.0;
  else _browseZoomLevel = Math.min(3.0, Math.max(0.25, _browseZoomLevel + dir * 0.1));
  _browseApplyZoom();
}
function _browseApplyZoom() {
  const el = _browseActiveEl();
  if (el) {
    if (_browseIsElectron && el.setZoomFactor) el.setZoomFactor(_browseZoomLevel);
    else {
      el.style.transform = `scale(${_browseZoomLevel})`;
      el.style.transformOrigin = 'top left';
      el.style.width = (100 / _browseZoomLevel) + '%';
      el.style.height = (100 / _browseZoomLevel) + '%';
    }
  }
  const label = document.getElementById('browse-zoom-level');
  if (label) label.textContent = Math.round(_browseZoomLevel * 100) + '%';
  // Show zoom controls briefly
  _browseShowZoomControls();
}
// Pinch-to-zoom (trackpad pinch fires wheel with ctrlKey)
document.addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  _browseZoomLevel = Math.min(3.0, Math.max(0.25, _browseZoomLevel + delta));
  _browseApplyZoom();
}, { passive: false });

// Cmd+Plus / Cmd+Minus / Cmd+0 / Cmd+T / Cmd+W for browse view
document.addEventListener('keydown', function(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); browseZoom(1); }
  else if (e.key === '-') { e.preventDefault(); browseZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); browseZoom(0); }
});

// Cmd+W / Cmd+T work when the parent document has focus (clicking tab bar, URL bar,
// sidebar, etc.). When a cross-origin iframe has focus, browser security prevents
// intercepting these shortcuts — this is the same limitation every web app faces.
// No-op stubs kept so callers don't break.
function _browseInstallKeyGuard() {}
function _browseRemoveKeyGuard() {}

// Transparent overlay to capture pinch gestures over iframes
function _browseInstallPinchOverlay() {
  const container = document.getElementById('browse-content');
  if (!container || container.querySelector('.browse-pinch-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'browse-pinch-overlay';
  overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;';
  container.appendChild(overlay);
  // On pinch start (ctrlKey+wheel), temporarily capture events
  container.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    _browseZoomLevel = Math.min(3.0, Math.max(0.25, _browseZoomLevel + delta));
    _browseApplyZoom();
  }, { passive: false });
}

function browseSaveToReadingList() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;
  const wasAdding = !getSavedPosts()[tab.url];
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
  if (wasAdding) {
    const btn = document.getElementById('browse-save-btn');
    if (btn && typeof _showBookmarkToast === 'function') {
      const r = btn.getBoundingClientRect();
      _showBookmarkToast({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
  }
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

// ── Tab Sessions (save/restore named tab groups) ──

function _getTabSessions() {
  try { return JSON.parse(localStorage.getItem('browseTabSessions') || '[]'); } catch { return []; }
}

function _saveTabSessions(sessions) {
  localStorage.setItem('browseTabSessions', JSON.stringify(sessions));
}

function toggleTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
  _renderTabStateDropdown();
  dd.style.display = '';
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.focus();
  }, 50);
  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleTabStateDropdown"]')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

function _renderTabStateDropdown() {
  const dd = document.getElementById('tab-state-dropdown');
  if (!dd) return;
  const sessions = _getTabSessions();
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  const canSave = openTabs.length > 0;

  let html = `<div style="position:absolute;right:0;top:calc(100% + 4px);min-width:260px;max-height:360px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">`;

  // Save current tabs section
  html += `<div style="padding:6px 12px;border-bottom:1px solid var(--border-subtle);">
    <div id="tab-session-save-row" style="display:flex;align-items:center;gap:4px;">
      <input id="tab-session-name-input" type="text" placeholder="Session name…" style="flex:1;min-width:0;padding:5px 8px;border:1px solid var(--border-input);background:var(--bg-input);color:var(--text-primary);font-size:0.78rem;border-radius:6px;outline:none;" onkeydown="if(event.key==='Enter')confirmSaveTabSession()" ${canSave ? '' : 'disabled'}>
      <button onclick="confirmSaveTabSession()" style="padding:5px 10px;border:none;background:${canSave ? 'var(--accent)' : 'var(--bg-hover)'};color:${canSave ? '#fff' : 'var(--text-dimmest)'};font-size:0.78rem;border-radius:6px;cursor:${canSave ? 'pointer' : 'default'};white-space:nowrap;" ${canSave ? '' : 'disabled'}>Save ${openTabs.length} tab${openTabs.length !== 1 ? 's' : ''}</button>
    </div>
  </div>`;

  if (!sessions.length) {
    html += `<div style="padding:12px;font-size:0.75rem;color:var(--text-dimmest);text-align:center">No saved sessions</div>`;
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const count = s.tabs.length;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      html += `<div class="tab-session-row" style="display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
        <button onclick="loadTabSession(${i})" style="flex:1;min-width:0;text-align:left;border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;gap:1px;">
          <span style="font-size:0.8rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escapeHtml(s.name)}</span>
          <span style="font-size:0.68rem;color:var(--text-dimmer)">${count} tab${count !== 1 ? 's' : ''} · ${date}</span>
        </button>
        <button onclick="event.stopPropagation();deleteTabSession(${i})" style="border:none;background:none;color:var(--text-dimmest);cursor:pointer;padding:2px;font-size:0.9rem;line-height:1;flex-shrink:0;" title="Delete session" onmouseenter="this.style.color='var(--text-primary)'" onmouseleave="this.style.color='var(--text-dimmest)'">&times;</button>
      </div>`;
    }
  }

  html += '</div>';
  dd.innerHTML = html;
}

function confirmSaveTabSession() {
  const input = document.getElementById('tab-session-name-input');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const openTabs = _browseTabs.filter(t => !t.blank && t.url);
  if (!openTabs.length) return;
  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    tabs: openTabs.map(t => ({ url: t.url, title: t.title })),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  // Focus the new input after re-render
  setTimeout(() => {
    const ni = document.getElementById('tab-session-name-input');
    if (ni) ni.value = '';
  }, 0);
}

function loadTabSession(index) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;
  // Close dropdown
  const dd = document.getElementById('tab-state-dropdown');
  if (dd) dd.style.display = 'none';
  // Open each tab from the session
  for (const saved of session.tabs) {
    browseNewTab(saved.url);
  }
}

function deleteTabSession(index) {
  const sessions = _getTabSessions();
  sessions.splice(index, 1);
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
}

// ── Browse More Menu (three dots) ──

function toggleBrowseMoreMenu() {
  const dd = document.getElementById('browse-more-menu');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const hasTab = tab && !tab.blank && tab.url;
  dd.innerHTML = `<div style="position:absolute;right:0;top:calc(100% + 4px);min-width:180px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">
    <button onclick="browseOpenNoteView()" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Note view
    </button>
    <button onclick="browsePrintPage()" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg>
      Print page
    </button>
  </div>`;
  dd.style.display = '';

  setTimeout(() => {
    const handler = (e) => {
      if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleBrowseMoreMenu"]')) {
        dd.style.display = 'none';
        document.removeEventListener('mousedown', handler);
      }
    };
    document.addEventListener('mousedown', handler);
  }, 0);
}

function browsePrintPage() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const el = _browseActiveEl();
  if (!el) return;

  if (_browseIsElectron && el.print) {
    el.print();
  } else {
    try { el.contentWindow.print(); } catch (e) {
      // Cross-origin iframe — open in new tab so user can print from there
      const tab = _browseTabs.find(t => t.id === _browseActiveTab);
      if (tab && tab.url) window.open(tab.url, '_blank');
    }
  }
}

function browseOpenNoteView() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;

  // Open current tab's URL in the paper viewer (with PDF highlighting, pen, notes, etc.)
  paperViewOrigin = 'browse';
  const isArxiv = /arxiv\.org\/(abs|pdf)\//.test(tab.url);
  const arxivId = isArxiv ? (tab.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '' : '';
  const paper = {
    title: tab.title || _browseTitleFromUrl(tab.url),
    link: tab.url,
    description: '',
    authors: '',
    categories: [],
    source: isArxiv ? 'arxiv' : 'browse',
    arxivId: arxivId
  };
  const hashVal = 'view/' + encodeURIComponent(tab.url);
  showPaperView(paper, hashVal);
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

// ── Ad Blocker toggle & badge ──

function toggleAdBlock() {
  const on = localStorage.getItem('adBlockEnabled') === 'true';
  localStorage.setItem('adBlockEnabled', on ? 'false' : 'true');
  _browseUpdateAdBlockBtn();
  // Reload current tab through/without proxy
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.url && !tab.blank && tab.el) {
    const proxied = _browseProxyUrl(tab.url);
    tab.el.dataset.originalUrl = tab.url;
    tab.el.src = proxied;
    if (proxied !== tab.url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(tab.url), { once: true });
    } else {
      // Cleared proxy — hide badge
      const badge = document.getElementById('browse-adblock-badge');
      if (badge) badge.style.display = 'none';
    }
  }
}

function _browseUpdateAdBlockBtn() {
  const btn = document.getElementById('browse-adblock-btn');
  if (!btn) return;
  const on = localStorage.getItem('adBlockEnabled') === 'true';
  btn.style.color = on ? 'var(--accent)' : '';
  btn.title = on ? 'Ad Blocker (on)' : 'Ad Blocker (off)';
  btn.classList.toggle('text-dimmer', !on);
}

function _browseUpdateAdBlockBadge(url) {
  const badge = document.getElementById('browse-adblock-badge');
  if (!badge) return;
  if (localStorage.getItem('adBlockEnabled') !== 'true') {
    badge.style.display = 'none';
    return;
  }
  // Try to read the blocked count from the proxied iframe's meta tag (same-origin)
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el) {
    try {
      const doc = tab.el.contentDocument;
      if (doc) {
        const meta = doc.querySelector('meta[name="adblock-count"]');
        if (meta) {
          const count = parseInt(meta.getAttribute('content') || '0', 10);
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
          return;
        }
      }
    } catch (e) { /* cross-origin, fall through */ }
  }
  badge.style.display = 'none';
}

// Initialize button state on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', _browseUpdateAdBlockBtn);
}


