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
  showSearchHistoryView();
}

function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;

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

// ── Browse View (multi-window, multi-tab embedded browser) ──

let _browseWindows = []; // { id, name, tabs: [], activeTab }
let _browseActiveWindow = null;
let _browseNextWindowId = 1;
let _browseNextTabId = 1;
const _browseIsElectron = !!(window.electronAPI && window.electronAPI.isElectron);

// Audio tracking: { tabId: { windowId, muted } }
let _browseAudioTabs = new Map();
const _BROWSE_CLOSED_TABS_MAX = 50;
let _browseClosedTabs = JSON.parse(localStorage.getItem('browseClosedTabs') || '[]'); // stack of { url, title } for Cmd+Shift+T reopen

// Convenience getters for current window's tabs
function _getCurrentWindow() {
  return _browseWindows.find(w => w.id === _browseActiveWindow);
}
// For backward compatibility
Object.defineProperty(window, '_browseTabs', {
  get() { const w = _getCurrentWindow(); return w ? w.tabs : []; },
  set(v) { const w = _getCurrentWindow(); if (w) w.tabs = v; }
});
Object.defineProperty(window, '_browseActiveTab', {
  get() { const w = _getCurrentWindow(); return w ? w.activeTab : null; },
  set(v) { const w = _getCurrentWindow(); if (w) w.activeTab = v; }
});

function _getBrowseStorageKey(baseKey) {
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo?.username) || null;
  return username ? `${baseKey}_${username}` : baseKey;
}

function _browseSaveTabs() {
  const data = _browseWindows.map(w => ({
    id: w.id,
    name: w.name,
    activeTab: w.activeTab,
    tabs: w.tabs.map(t => {
      const saved = { id: t.id, url: t.url || '', title: t.title, blank: !!t.blank };
      if (t._historyPage) saved._historyPage = true;
      if (t.paper) { saved.paper = t.paper; saved.contentType = t.contentType; saved.arxivId = t.arxivId || null; }
      return saved;
    })
  }));
  localStorage.setItem(_getBrowseStorageKey('browseWindows'), JSON.stringify({
    windows: data,
    activeWindow: _browseActiveWindow,
    nextWindowId: _browseNextWindowId,
    nextTabId: _browseNextTabId
  }));
}

// Check if URL is a heavy video site that should be lazy-loaded
function _isHeavyVideoSite(url) {
  if (!url) return false;
  const heavyDomains = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com', 'dailymotion.com'];
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return heavyDomains.some(d => hostname.includes(d));
  } catch { return false; }
}

function _browseRestoreTabs() {
  try {
    // Try new multi-window format first (user-specific key)
    let raw = localStorage.getItem(_getBrowseStorageKey('browseWindows'));
    if (raw) {
      const { windows, activeWindow, nextWindowId, nextTabId } = JSON.parse(raw);
      if (!windows || !windows.length) return false;
      _browseNextWindowId = nextWindowId || 1;
      _browseNextTabId = nextTabId || 1;
      const container = document.getElementById('browse-content');

      for (const savedWin of windows) {
        if (!savedWin.tabs.length) continue;
        const win = { id: savedWin.id, name: savedWin.name, tabs: [], activeTab: savedWin.activeTab };
        for (const saved of savedWin.tabs) {
          if (saved.blank) {
            const tab = { id: saved.id, url: '', title: 'New Tab', favicon: '', el: null, blank: true };
            win.tabs.push(tab);
            continue;
          }
          // History page tab — restore as special tab (content renders on select)
          if (saved._historyPage) {
            const tab = { id: saved.id, url: '', title: 'History', favicon: '', el: null, blank: false, _historyPage: true };
            win.tabs.push(tab);
            continue;
          }
          // Paper tab — create container div (content renders lazily on select)
          if (saved.paper && saved.contentType) {
            const el = document.createElement('div');
            el.id = 'browse-paper-' + saved.id;
            el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;overflow:hidden;';
            container.appendChild(el);
            const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false,
                          paper: saved.paper, contentType: saved.contentType, arxivId: saved.arxivId || null };
            win.tabs.push(tab);
            continue;
          }
          // Lazy load: don't create frame for heavy video sites in background tabs
          const isActiveTab = saved.id === savedWin.activeTab && savedWin.id === activeWindow;
          const shouldDefer = !isActiveTab && _isHeavyVideoSite(saved.url);

          let el = null;
          if (!shouldDefer) {
            el = _browseCreateFrame(saved.id, saved.url);
            el.style.display = 'none';
            container.appendChild(el);
          }
          const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false, deferred: shouldDefer };
          win.tabs.push(tab);
          if (el) _browseBindFrame(tab);
        }
        _browseWindows.push(win);
      }
      if (!_browseWindows.length) return false;
      _browseActiveWindow = _browseWindows.find(w => w.id === activeWindow) ? activeWindow : _browseWindows[0].id;
      const win = _getCurrentWindow();
      if (win && win.tabs.length) {
        const target = win.tabs.find(t => t.id === win.activeTab) ? win.activeTab : win.tabs[0].id;
        browseSelectTab(target);
      }
      return true;
    }

    // Fallback to old single-window format
    raw = localStorage.getItem('browseTabs');
    if (raw) {
      const { tabs, activeTab, nextId } = JSON.parse(raw);
      if (!tabs || !tabs.length) return false;
      _browseNextTabId = nextId || 1;
      const container = document.getElementById('browse-content');
      const win = { id: _browseNextWindowId++, name: 'Window 1', tabs: [], activeTab: null };
      for (const saved of tabs) {
        const el = _browseCreateFrame(saved.id, saved.url);
        el.style.display = 'none';
        container.appendChild(el);
        const tab = { id: saved.id, url: saved.url, title: saved.title || _browseTitleFromUrl(saved.url), favicon: _browseFaviconUrl(saved.url), el, blank: false };
        win.tabs.push(tab);
        _browseBindFrame(tab);
      }
      win.activeTab = win.tabs.find(t => t.id === activeTab) ? activeTab : win.tabs[0]?.id;
      _browseWindows.push(win);
      _browseActiveWindow = win.id;
      if (win.activeTab) browseSelectTab(win.activeTab);
      localStorage.removeItem('browseTabs'); // Migrate to new format
      _browseSaveTabs();
      return true;
    }
    return false;
  } catch { return false; }
}

// Window management
function browseCreateWindow(name) {
  const id = _browseNextWindowId++;
  const win = { id, name: name || `Window ${id}`, tabs: [], activeTab: null };
  _browseWindows.push(win);
  browseSelectWindow(id);
  browseNewTab(); // Create initial tab
  _browseSaveTabs();
  return win;
}

function browseSelectWindow(id) {
  const win = _browseWindows.find(w => w.id === id);
  if (!win) return;

  // Hide all tabs from other windows
  _browseWindows.forEach(w => {
    w.tabs.forEach(t => { if (t.el) t.el.style.display = 'none'; });
  });

  _browseActiveWindow = id;
  _browseRenderTabs();

  // Show active tab of this window
  if (win.activeTab) {
    const tab = win.tabs.find(t => t.id === win.activeTab);
    if (tab && tab.el) tab.el.style.display = '';
  }
  _browseUpdateNewTabPage(win.tabs.find(t => t.id === win.activeTab));
  _browseSaveTabs();
}

function browseCloseWindow(id) {
  const idx = _browseWindows.findIndex(w => w.id === id);
  if (idx === -1) return;

  const win = _browseWindows[idx];
  // Remove all tab elements
  win.tabs.forEach(t => { if (t.el) t.el.remove(); });
  _browseWindows.splice(idx, 1);

  if (_browseWindows.length === 0) {
    browseCreateWindow();
  } else if (_browseActiveWindow === id) {
    browseSelectWindow(_browseWindows[Math.min(idx, _browseWindows.length - 1)].id);
  }
  _browseSaveTabs();
}

function browseRenameWindow(id, name) {
  const win = _browseWindows.find(w => w.id === id);
  if (win) {
    win.name = name;
    _browseSaveTabs();
  }
}

// Helper: create window without auto-creating a tab (for session restore)
function _createBrowseWindow(name) {
  const id = _browseNextWindowId++;
  const win = { id, name: name || `Window ${id}`, tabs: [], activeTab: null };
  _browseWindows.push(win);
  return win;
}

// Helper: create a tab in a specific window (for session restore)
function _browseCreateTabInWindow(windowId, url) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return null;

  const id = _browseNextTabId++;
  const resolved = _browseResolveUrl(url);

  const container = document.getElementById('browse-content');
  const el = _browseCreateFrame(id, resolved);
  el.style.display = 'none';
  container.appendChild(el);

  const tab = {
    id,
    url: resolved,
    title: _browseTitleFromUrl(resolved),
    favicon: _browseFaviconUrl(resolved),
    el,
    blank: false,
    backStack: [],
    forwardStack: []
  };
  win.tabs.push(tab);
  _browseBindFrame(tab);
  if (resolved) _saveBrowseVisit(resolved, tab.title);

  return tab;
}

// Helper: destroy a tab's DOM elements (for session replace)
function _destroyTab(tab) {
  if (tab.el) tab.el.remove();
  _browseAudioTabs.delete(tab.id);
}

function switchWindowUp() {
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx > 0) {
    _animateWindowSwitch('up', () => {
      browseSelectWindow(_browseWindows[idx - 1].id);
    });
  }
}

function switchWindowDown() {
  const idx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  if (idx < _browseWindows.length - 1) {
    _animateWindowSwitch('down', () => {
      browseSelectWindow(_browseWindows[idx + 1].id);
    });
  }
}

function _animateWindowSwitch(direction, callback) {
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }

  const offset = direction === 'up' ? '30px' : '-30px';
  const offsetIn = direction === 'up' ? '-30px' : '30px';

  content.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
  content.style.transform = `translateY(${offset})`;
  content.style.opacity = '0';

  setTimeout(() => {
    callback();
    content.style.transition = 'none';
    content.style.transform = `translateY(${offsetIn})`;
    content.style.opacity = '0';

    requestAnimationFrame(() => {
      content.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      content.style.transform = 'translateY(0)';
      content.style.opacity = '1';

      setTimeout(() => {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
      }, 200);
    });
  }, 150);
}

let _browseReturnView = null; // set by openPaper/inbox to enable "back to feed/inbox" button

function _browseGoBack() {
  const nav = { feed: goHome, dashboard: openDashboard, search: openSearch, inbox: typeof openInbox === 'function' ? openInbox : null, calendar: typeof openCalendar === 'function' ? openCalendar : null, settings: typeof openSettings === 'function' ? openSettings : null };
  const fn = nav[_browseReturnView];
  _browseReturnView = null;
  if (fn) fn(); else goHome();
}

function openBrowse(url) {
  setSidebarLoading('sb-browse');
  hideAllViews();

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

  if (!_browseWindows.length) {
    if (!_browseRestoreTabs()) {
      browseCreateWindow();
    }
  }
  if (url) {
    const resolved = _browseResolveUrl(url);
    // Search all windows for an existing tab with this URL
    let found = null;
    for (const w of _browseWindows) {
      const t = w.tabs.find(t => t.url === resolved);
      if (t) { found = { winId: w.id, tabId: t.id }; break; }
    }
    if (found) {
      if (found.winId !== _browseActiveWindow) browseSelectWindow(found.winId);
      browseSelectTab(found.tabId);
    } else {
      browseNewTab(url);
    }
  } else {
    _browseRenderTabs();
    const win = _getCurrentWindow();
    const tab = win?.tabs.find(t => t.id === win.activeTab);
    if (tab && tab.url && !tab.blank) _initSidebarForUrl(tab.url);
  }
  _browseInstallPinchOverlay();
  _browseInstallKeyGuard();
  // Show/hide return button
  const retBtn = document.getElementById('browse-return-btn');
  if (retBtn) retBtn.style.display = _browseReturnView ? '' : 'none';
}

function browseNewTab(url) {
  const win = _getCurrentWindow();
  if (!win) return;

  const id = _browseNextTabId++;
  const isBlank = !url;
  const resolved = isBlank ? '' : _browseResolveUrl(url);

  let el = null;
  if (!isBlank) {
    const container = document.getElementById('browse-content');
    el = _browseCreateFrame(id, resolved);
    el.style.display = 'none';
    container.appendChild(el);
  }

  const tab = { id, url: resolved, title: isBlank ? 'New Tab' : _browseTitleFromUrl(resolved), favicon: isBlank ? '' : _browseFaviconUrl(resolved), el, blank: isBlank, backStack: [], forwardStack: [] };
  const activeIdx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (activeIdx >= 0) win.tabs.splice(activeIdx + 1, 0, tab);
  else win.tabs.push(tab);
  if (el) _browseBindFrame(tab);
  if (!isBlank && resolved) _saveBrowseVisit(resolved, tab.title);

  browseSelectTab(id);
  _browseSaveTabs();
  if (isBlank) {
    setTimeout(() => {
      const urlInput = document.getElementById('browse-url-input');
      if (urlInput) { urlInput.focus(); urlInput.select(); }
    }, 50);
  }
}

function browseNewPaperTab(url, paper) {
  const win = _getCurrentWindow();
  if (!win) return;
  const id = _browseNextTabId++;
  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/(abs|pdf)\//.test(url);
  const arxivId = isArxiv ? (paper.arxivId || (url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '') : '';

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-paper-' + id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none;overflow:hidden;';
  if (!arxivId) el.style.display = 'none';
  container.appendChild(el);

  const isUpload = paper.source === 'upload';
  const favicon = typeof _browseFaviconUrl === 'function' ? _browseFaviconUrl(url) : '';
  const tab = { id, url, title: paper.title || _browseTitleFromUrl(url), favicon, el, blank: false,
                paper, contentType: (arxivId || isUpload) ? 'pdf' : 'reader', arxivId: arxivId || null };
  if (isUpload && paper.pdfUrl) tab.pdfUrl = paper.pdfUrl;
  const activeIdx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (activeIdx >= 0) win.tabs.splice(activeIdx + 1, 0, tab);
  else win.tabs.push(tab);
  if (url) _saveBrowseVisit(url, tab.title);
  browseSelectTab(id);
  _browseSaveTabs();
}

function openLocalPdf(file) {
  const blobUrl = URL.createObjectURL(file);
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const paper = { title: file.name, link: blobUrl, source: 'upload', pdfUrl: blobUrl };
    browseNewPaperTab(blobUrl, paper);
  } else {
    browseNewTab(blobUrl);
    // Update title after tab is created
    const win = _getCurrentWindow();
    if (win) {
      const tab = win.tabs.find(t => t.url === blobUrl);
      if (tab) { tab.title = file.name; _browseRenderTabs(); }
    }
  }
}

function openBrowseWithPaper(url, paper) {
  const view = document.getElementById('browse-view');
  const isAlreadyOpen = view && view.style.display !== 'none' && view.style.display !== '';

  if (!isAlreadyOpen) openBrowse();

  // Check for existing tab with this URL across all windows
  for (const w of _browseWindows) {
    const t = w.tabs.find(t => t.url === url);
    if (t) {
      if (w.id !== _browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(t.id);
      return;
    }
  }
  browseNewPaperTab(url, paper);
  // Close initial blank tab if one was just created by openBrowse
  const win = _getCurrentWindow();
  if (win && win.tabs.length > 1) {
    const blank = win.tabs.find(t => t.blank && t.id !== win.activeTab);
    if (blank) browseCloseTab(blank.id);
  }
}

function _browseRefreshScheme() {
  // Reload all proxied browse tabs with the updated color scheme
  if (!_browseWindows.length) return;
  for (const win of _browseWindows) {
    for (const tab of win.tabs) {
      if (!tab.el || tab.blank || !tab.url || tab.contentType) continue;
      const newSrc = _browseProxyUrl(tab.url);
      if (tab.el.src !== newSrc) tab.el.src = newSrc;
    }
  }
}

function _browseProxyUrl(url) {
  // Never proxy blob: or data: URLs
  if (url && (url.startsWith('blob:') || url.startsWith('data:'))) return url;
  // Serve file:// URLs through the local server
  if (url && url.startsWith('file://')) return '/api/local-file?path=' + encodeURIComponent(url.replace(/^file:\/\//, ''));
  // Always proxy in browser mode (not Electron) to enable link context menu and ad blocking
  if (!_browseIsElectron && url) {
    const scheme = typeof getThemeColorScheme === 'function' ? getThemeColorScheme() : 'light';
    return '/api/browse-proxy?url=' + encodeURIComponent(url) + '&scheme=' + scheme;
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
  // Inject right-click chat handler into iframe
  if (typeof _injectIframeChatHandler === 'function') {
    _injectIframeChatHandler(el);
  }
  return el;
}

// ── Download Manager ──
const DOWNLOAD_RETENTION_MS = 60 * 60 * 1000; // 1 hour

let _browseDownloads = []; // { id, filename, url, state: 'progressing'|'completed'|'cancelled', receivedBytes, totalBytes, startTime }
let _browseDownloadIdCounter = 0;
let _browseDownloadsLastSeenCount = 0;

function _loadBrowseDownloads() {
  try {
    const saved = JSON.parse(localStorage.getItem('browseDownloads') || '[]');
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    _browseDownloads = saved.filter(d => d.startTime > oneHourAgo);
    // Find max ID
    _browseDownloads.forEach(d => {
      const num = parseInt(d.id.replace('dl-', ''));
      if (num > _browseDownloadIdCounter) _browseDownloadIdCounter = num;
    });
    // Load last seen count
    const lastSeen = parseInt(localStorage.getItem('browseDownloadsLastSeen') || '0');
    _browseDownloadsLastSeenCount = Math.min(lastSeen, _browseDownloads.length);
  } catch (e) {
    _browseDownloads = [];
  }
}

function _saveBrowseDownloads() {
  try {
    const oneHourAgo = Date.now() - DOWNLOAD_RETENTION_MS;
    const toSave = _browseDownloads.filter(d => d.startTime > oneHourAgo);
    localStorage.setItem('browseDownloads', JSON.stringify(toSave));
    // Save last seen count
    localStorage.setItem('browseDownloadsLastSeen', _browseDownloadsLastSeenCount.toString());
  } catch (e) {}
}

// Initialize downloads on load
_loadBrowseDownloads();
// Update UI after a short delay (DOM may not be ready)
setTimeout(() => {
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
}, 100);

// Check if URL looks like a downloadable file
function _isDownloadableUrl(url) {
  if (!url) return false;
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  const downloadExts = ['pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dmg', 'pkg', 'deb', 'rpm',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt',
    'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac',
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico',
    'iso', 'img', 'bin', 'apk', 'ipa'];
  return downloadExts.includes(ext);
}

function _browseUpdateDownloadBadge() {
  const btn = document.getElementById('browse-downloads-btn');
  const badge = document.getElementById('browse-download-badge');
  const ring = document.getElementById('browse-download-progress-ring');

  const count = _browseDownloads.length;
  const newDownloads = count - _browseDownloadsLastSeenCount;

  // Show/hide download button
  if (btn) btn.style.display = count > 0 ? 'block' : 'none';

  // Show badge only for new downloads
  if (badge) {
    if (newDownloads > 0) {
      badge.textContent = newDownloads > 99 ? '99+' : newDownloads;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Show progress ring only for new active downloads
  if (ring) {
    const hasNewActive = newDownloads > 0 && _browseDownloads.some(d => d.state === 'progressing');
    ring.style.display = hasNewActive ? 'block' : 'none';
  }
}

function _browseRenderDownloads() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (_browseDownloads.length === 0) {
    dropdown.innerHTML = '<div class="browse-downloads-empty">No downloads</div>';
    return;
  }

  let html = `<div class="browse-downloads-header">
    <span class="browse-downloads-title">Downloads</span>
    <button class="browse-downloads-clear" onclick="event.stopPropagation();clearBrowseDownloads()">Clear all</button>
  </div>`;

  for (const dl of _browseDownloads) {
    const icon = dl.state === 'completed'
      ? '<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
      : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>';

    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const size = dl.totalBytes > 0 ? _formatBytes(dl.totalBytes) : '';
    const status = dl.state === 'completed' ? 'Completed' + (size ? ' · ' + size : '')
      : dl.state === 'cancelled' ? 'Cancelled'
      : pct + '% · ' + _formatBytes(dl.receivedBytes) + (dl.totalBytes > 0 ? ' / ' + size : '');

    const progressBar = dl.state === 'progressing'
      ? `<div class="browse-download-item-progress"><div class="browse-download-item-progress-bar" style="width:${pct}%"></div></div>`
      : '';

    html += `<div class="browse-download-item" onclick="openDownloadFile('${dl.id}')">
      <div class="browse-download-item-icon">${icon}</div>
      <div class="browse-download-item-info">
        <div class="browse-download-item-name">${escapeHtml(dl.filename)}</div>
        <div class="browse-download-item-status">${status}</div>
        ${progressBar}
      </div>
      <div class="browse-download-item-actions">
        ${dl.state === 'completed' ? `<button class="browse-download-item-btn" onclick="event.stopPropagation();showDownloadInFolder('${dl.id}')" title="Show in folder"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg></button>` : ''}
        <button class="browse-download-item-btn" onclick="event.stopPropagation();removeBrowseDownload('${dl.id}')" title="Remove"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
    </div>`;
  }

  dropdown.innerHTML = html;

  // Stop propagation on clicks inside dropdown to prevent closing
  dropdown.onclick = (e) => e.stopPropagation();
}

function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function _closeBrowseDownloadsDropdown() {
  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  document.removeEventListener('click', _closeBrowseDownloadsOnClick);
  window.removeEventListener('blur', _closeBrowseDownloadsOnBlur);
}

function toggleBrowseDownloads(event) {
  if (event) event.stopPropagation();

  const dropdown = document.getElementById('browse-downloads-dropdown');
  if (!dropdown) return;

  if (dropdown.style.display === 'none') {
    _browseRenderDownloads();
    dropdown.style.display = 'block';

    // Mark all downloads as seen
    _browseDownloadsLastSeenCount = _browseDownloads.length;
    _saveBrowseDownloads();

    const badge = document.getElementById('browse-download-badge');
    if (badge) badge.style.display = 'none';

    // Add close listeners
    requestAnimationFrame(() => {
      document.addEventListener('click', _closeBrowseDownloadsOnClick);
    });
    window.addEventListener('blur', _closeBrowseDownloadsOnBlur);
  } else {
    _closeBrowseDownloadsDropdown();
  }
}

function _closeBrowseDownloadsOnClick(e) {
  const btn = document.getElementById('browse-downloads-btn');
  if (btn && !btn.contains(e.target)) {
    _closeBrowseDownloadsDropdown();
  }
}

function _closeBrowseDownloadsOnBlur() {
  _closeBrowseDownloadsDropdown();
}

function clearBrowseDownloads() {
  _browseDownloads = [];
  _browseDownloadsLastSeenCount = 0;
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

function removeBrowseDownload(id) {
  _browseDownloads = _browseDownloads.filter(d => d.id !== id);
  // Adjust seen count if we're below it
  if (_browseDownloads.length < _browseDownloadsLastSeenCount) {
    _browseDownloadsLastSeenCount = _browseDownloads.length;
  }
  _browseUpdateDownloadBadge();
  _browseRenderDownloads();
  _saveBrowseDownloads();
}

function openDownloadFile(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (dl && dl.state === 'completed' && dl.savePath && window.electronAPI) {
    window.electronAPI.openPath(dl.savePath);
  }
}

function showDownloadInFolder(id) {
  const dl = _browseDownloads.find(d => d.id === id);
  if (dl && dl.savePath && window.electronAPI) {
    window.electronAPI.showItemInFolder(dl.savePath);
  }
}

// Initialize download event listeners from Electron main process
let _downloadsInitialized = false;

function _initBrowseDownloads() {
  if (!window.electronAPI) return;
  if (_downloadsInitialized) return;
  _downloadsInitialized = true;

  // Listen for download-started event
  if (window.electronAPI.onDownloadStarted) {
    window.electronAPI.onDownloadStarted((event, data) => {
      const dl = {
        id: data.id,
        filename: data.filename || 'download',
        url: data.url || '',
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: data.totalBytes || 0,
        startTime: Date.now(),
        savePath: data.savePath || ''
      };
      _browseDownloads.unshift(dl);
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    });
  }

  // Listen for download-progress event
  if (window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.receivedBytes = data.receivedBytes || 0;
        dl.totalBytes = data.totalBytes || dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }

  // Listen for download-completed event
  if (window.electronAPI.onDownloadCompleted) {
    window.electronAPI.onDownloadCompleted((event, data) => {
      const dl = _browseDownloads.find(d => d.id === data.id);
      if (dl) {
        dl.state = data.state || 'completed';
        dl.savePath = data.savePath || dl.savePath;
        dl.receivedBytes = dl.totalBytes;
        _browseUpdateDownloadBadge();
        _browseRenderDownloads();
      }
    });
  }
}

// Initialize downloads on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initBrowseDownloads);
} else {
  _initBrowseDownloads();
}

function _browseBindFrame(tab) {
  if (tab.contentType === 'pdf' || tab.contentType === 'reader') return;
  const el = tab.el;
  if (!el || !_browseIsElectron) return;

  el.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.title = _browseTitleFromUrl(e.url);
    tab.favicon = _browseFaviconUrl(e.url);
    tab.blank = false;
    _saveBrowseVisit(e.url, tab.title);
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
    // Update the most recent browse history entry with the real title
    if (tab.url) _saveBrowseVisit(tab.url, tab.title);
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

  // Audio tracking
  el.addEventListener('media-started-playing', () => {
    // Find which window this tab belongs to
    const winId = _browseWindows.find(w => w.tabs.some(t => t.id === tab.id))?.id;
    if (winId) {
      _browseAudioTabs.set(tab.id, { windowId: winId, muted: false });
      _browseRenderTabs();
      _updateAudioIndicator();
    }
  });
  el.addEventListener('media-paused', () => {
    _browseAudioTabs.delete(tab.id);
    _browseRenderTabs();
    _updateAudioIndicator();
  });

  // Context menu — always show lookup panel (with context items for links/images)
  el.addEventListener('context-menu', (e) => {
    e.preventDefault();
    if (typeof _showPanel !== 'function') return;
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { popup.remove(); _lookupTrackMode = false; }
    const ctxData = (e.linkURL || e.srcURL) ? {
      linkUrl: e.linkURL || '', linkText: e.linkText || '',
      imgUrl: e.srcURL || '', mediaType: e.mediaType || ''
    } : null;
    _showPanel({ anchor: { x: e.x, y: e.y }, contextMenu: ctxData });
  });

  // Inject right-click handler after page loads
  el.addEventListener('dom-ready', () => {
    el.executeJavaScript(`
      (function(){
        if(window.__alphaContextMenuInjected)return;
        window.__alphaContextMenuInjected=true;
        document.addEventListener('contextmenu',function(e){
          var tag = e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||e.target.isContentEditable) return;
          var data = {x:e.screenX,y:e.screenY};
          var a=e.target.closest('a[href]');
          if(a){
            var h=a.getAttribute('href');
            if(h&&h.indexOf('javascript:')!==0&&h.charAt(0)!=='#'){
              data.linkUrl=h;
              data.linkText=a.textContent.trim().slice(0,100);
            }
          }
          var img=e.target.closest('img');
          if(img && img.src){
            data.imgUrl=img.src;
            data.imgAlt=img.alt||'';
          }
          e.preventDefault();
          e.stopPropagation();
          if(data.linkUrl||data.imgUrl){
            console.log('__ALPHA_CONTEXT__'+JSON.stringify(data));
          } else {
            console.log('__ALPHA_CHAT__'+JSON.stringify(data));
          }
          return false;
        },true);
        // Text selection inside webview → relay to parent
        var _wvSelDragging=false;
        document.addEventListener('mousedown',function(e){
          if(e.button!==0) return;
          console.log('__ALPHA_CLOSE_MENU__'); console.log('__ALPHA_DISMISS_CHAT__');
          var tag=e.target.tagName;
          if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||tag==='BUTTON') return;
          if(e.target.isContentEditable) return;
          _wvSelDragging=true;
        },true);
        document.addEventListener('selectionchange',function(){
          if(!_wvSelDragging) return;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(!text||text.length<3||sel.rangeCount===0) return;
          var r=sel.getRangeAt(0).getBoundingClientRect();
          console.log('__ALPHA_SEL_PREVIEW__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
        });
        document.addEventListener('mouseup',function(e){
          if(!_wvSelDragging) return;
          _wvSelDragging=false;
          var sel=document.getSelection();
          var text=sel?sel.toString().trim():'';
          if(text&&text.length>=3&&sel.rangeCount>0){
            var r=sel.getRangeAt(0).getBoundingClientRect();
            console.log('__ALPHA_SEL_FINAL__'+JSON.stringify({text:text,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}));
          } else {
            console.log('__ALPHA_SEL_CLEAR__');
          }
        },true);
        document.addEventListener('keydown',function(e){
          if(e.key==='Escape') console.log('__ALPHA_DISMISS_CHAT__');
          if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();console.log('__ALPHA_FIND__');}
          if(e.altKey&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){if(e.key==='ArrowLeft'){e.preventDefault();console.log('__ALPHA_TAB_LEFT__');}if(e.key==='ArrowRight'){e.preventDefault();console.log('__ALPHA_TAB_RIGHT__');}}
        },true);
        // Throttled mousemove for lookup panel
        var _lastMove=0;
        document.addEventListener('mousemove',function(e){
          var now=Date.now();
          if(now-_lastMove<16) return;
          _lastMove=now;
          console.log('__ALPHA_MOUSE__'+e.screenX+','+e.screenY);
        });
      })();
    `).catch(()=>{});
  });

  // Listen for context menu via console message
  el.addEventListener('console-message', (e) => {
    if (e.message === '__ALPHA_DISMISS_CHAT__') {
      const popup = document.getElementById('doc-chat-ask-float');
      if (popup) {
        if (_popupChatAbort) { _popupChatAbort.abort(); _popupChatAbort = null; }
        _lookupTrackMode = false;
        popup.remove();
      }
    } else if (e.message && e.message.startsWith('__ALPHA_MOUSE__')) {
      if (!_lookupTrackMode) return;
      const parts = e.message.slice('__ALPHA_MOUSE__'.length).split(',');
      const x = parseInt(parts[0]) - window.screenX;
      const y = parseInt(parts[1]) - window.screenY;
      _lastMouseX = x;
      _lastMouseY = y;
      const popup = document.getElementById('doc-chat-ask-float');
      if (!popup) { _lookupTrackMode = false; return; }
      const w = popup.offsetWidth;
      const h = popup.offsetHeight;
      let left = x;
      let top = y - h;
      if (top < 0) top = 0;
      if (left + w > window.innerWidth) left = window.innerWidth - w;
      if (left < 0) left = 0;
      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
    } else if (e.message === '__ALPHA_CLOSE_MENU__') {
      _hideBrowseContextMenu();
    } else if (e.message && e.message.startsWith('__ALPHA_CONTEXT__')) {
      try {
        const data = JSON.parse(e.message.slice('__ALPHA_CONTEXT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _lookupTrackMode = false; }
          _showPanel({ anchor: { x, y }, contextMenu: data });
        }
      } catch (err) {}
    } else if (e.message && e.message.startsWith('__ALPHA_CHAT__')) {
      try {
        const data = JSON.parse(e.message.slice('__ALPHA_CHAT__'.length));
        const x = data.x - window.screenX;
        const y = data.y - window.screenY;
        if (typeof _showPanel === 'function') {
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); _lookupTrackMode = false; }
          _showPanel({ anchor: { x, y } });
        }
      } catch (err) {}
    } else if (e.message === '__ALPHA_FIND__') {
      _browseToggleFindBar();
    } else if (e.message === '__ALPHA_TAB_LEFT__') {
      _switchTabLeft();
    } else if (e.message === '__ALPHA_TAB_RIGHT__') {
      _switchTabRight();
    } else if (e.message && (e.message.startsWith('__ALPHA_SEL_PREVIEW__') || e.message.startsWith('__ALPHA_SEL_FINAL__'))) {
      try {
        const isFinal = e.message.startsWith('__ALPHA_SEL_FINAL__');
        const prefix = isFinal ? '__ALPHA_SEL_FINAL__' : '__ALPHA_SEL_PREVIEW__';
        const data = JSON.parse(e.message.slice(prefix.length));
        const selectionRect = _iframeRectToParent(data, el);
        _lookupTrackMode = false;
        if (!isFinal) {
          const existing = document.getElementById('doc-chat-ask-float');
          if (existing && existing._isLookupPanel) existing.remove();
        }
        _showPanel({ anchor: { selectionRect }, selectionText: data.text, finalized: isFinal });
      } catch (err) {}
    } else if (e.message === '__ALPHA_SEL_CLEAR__') {
      const existing = document.getElementById('doc-chat-ask-float');
      if (existing) { existing.remove(); _lookupTrackMode = false; }
    } else if (e.message && e.message.startsWith('__ALPHA_LINK__')) {
      // Legacy support
      try {
        const data = JSON.parse(e.message.slice('__ALPHA_LINK__'.length));
        if (data.href) {
          const x = data.x - window.screenX;
          const y = data.y - window.screenY;
          _showBrowseContextMenu(x, y, { linkUrl: data.href, linkText: data.text || '' });
        }
      } catch (err) {}
    }
  });
}

// Context menu for Browse view (links and images)
let _browseContextMenu = null;
let _browseContextData = null;

function _hideBrowseContextMenu() {
  if (_browseContextMenu) {
    _browseContextMenu.remove();
    _browseContextMenu = null;
  }
  _browseContextData = null;
}

// Legacy alias
function _hideBrowseLinkMenu() { _hideBrowseContextMenu(); }

function _showBrowseContextMenu(x, y, data) {
  _hideBrowseContextMenu();
  _browseContextData = data;

  const menu = document.createElement('div');
  menu.className = 'browse-link-menu';

  let html = '';
  const linkUrl = data.linkUrl || '';
  const linkText = data.linkText || '';
  const imgUrl = data.imgUrl || '';

  // Link options
  if (linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-item" data-action="newtab">Open Link in New Tab</div>`;
    html += `<div class="blm-item" data-action="here">Open Link Here</div>`;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="savelink">Save Link As...</div>`;
    html += `<div class="blm-item" data-action="copylink">Copy Link Address</div>`;
    if (linkText) {
      html += `<div class="blm-item" data-action="copytext">Copy Link Text</div>`;
    }
  }

  // Image options
  if (imgUrl) {
    if (linkUrl) html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="openimg">Open Image in New Tab</div>`;
    html += `<div class="blm-item" data-action="saveimg">Save Image As...</div>`;
    html += `<div class="blm-item" data-action="copyimg">Copy Image Address</div>`;
  }

  // Search option
  if (linkText && linkUrl) {
    const truncatedText = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
    html += `<div class="blm-sep"></div>`;
    html += `<div class="blm-item" data-action="search">Search Google for "${escapeHtml(truncatedText)}"</div>`;
  }

  menu.innerHTML = html;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  _browseContextMenu = menu;

  // Adjust if off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.blm-item');
    if (!item) return;
    const action = item.dataset.action;

    if (action === 'newtab') {
      browseNewTab(linkUrl);
    } else if (action === 'here') {
      browseNavigate(linkUrl);
    } else if (action === 'savelink') {
      _browseSaveLink(linkUrl);
    } else if (action === 'copylink') {
      navigator.clipboard.writeText(linkUrl).catch(() => {});
    } else if (action === 'copytext') {
      navigator.clipboard.writeText(linkText).catch(() => {});
    } else if (action === 'search') {
      browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
    } else if (action === 'openimg') {
      browseNewTab(imgUrl);
    } else if (action === 'saveimg') {
      _browseSaveImage(imgUrl);
    } else if (action === 'copyimg') {
      navigator.clipboard.writeText(imgUrl).catch(() => {});
    }
    _hideBrowseContextMenu();
  });
}

// Helper to trigger download
function _browseDownloadFile(url, defaultFilename = 'download') {
  const filename = url.split('/').pop().split('?')[0] || defaultFilename;

  if (window.electronAPI && window.electronAPI.downloadURL) {
    // Electron handles download tracking via download-started event
    window.electronAPI.downloadURL(url);
  } else {
    // Browser fallback: create manual download entry
    const dl = {
      id: 'dl-' + (++_browseDownloadIdCounter),
      filename,
      url,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: 0,
      startTime: Date.now(),
      savePath: ''
    };
    _browseDownloads.unshift(dl);
    _browseUpdateDownloadBadge();
    _browseRenderDownloads();
    _saveBrowseDownloads();

    // Trigger download via anchor
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Mark as completed (can't track progress in browser)
    setTimeout(() => {
      dl.state = 'completed';
      dl.receivedBytes = dl.totalBytes = 1;
      _browseUpdateDownloadBadge();
      _browseRenderDownloads();
      _saveBrowseDownloads();
    }, 1500);
  }
}

function _browseSaveImage(url) {
  _browseDownloadFile(url, 'image');
}

function _browseSaveLink(url) {
  _browseDownloadFile(url, 'download');
}

// Close menu on click outside or escape
document.addEventListener('mousedown', (e) => {
  if (_browseContextMenu && !_browseContextMenu.contains(e.target)) {
    _hideBrowseContextMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _hideBrowseContextMenu();
});
// Close menu when webview gets focus (user clicked inside it)
window.addEventListener('blur', () => {
  _hideBrowseContextMenu();
});

function browseSelectTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;
  // Close find bar when switching tabs
  if (_browseFindBarActive) _browseCloseFindBar();

  // Clean up PDF viewer when switching away from a PDF tab
  const prevTab = win.tabs.find(t => t.id === win.activeTab);
  if (prevTab && prevTab.contentType === 'pdf' && prevTab.id !== id) {
    cleanupPdfViewer();
  }

  win.activeTab = id;
  const tab = win.tabs.find(t => t.id === id);

  // Load deferred tab if needed (lazy loading for YouTube etc.)
  if (tab && tab.deferred && !tab.el && tab.url) {
    const container = document.getElementById('browse-content');
    tab.el = _browseCreateFrame(tab.id, tab.url);
    container.appendChild(tab.el);
    _browseBindFrame(tab);
    tab.deferred = false;
  }

  // Restore history page tab if needed
  if (tab && tab._historyPage && !tab.el) {
    const container = document.getElementById('browse-content');
    const el = document.createElement('div');
    el.id = 'browse-history-' + tab.id;
    el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);';
    container.appendChild(el);
    tab.el = el;
    _renderWebSearchHistoryPage(el);
  }

  win.tabs.forEach(t => {
    if (t.el) t.el.style.display = t.id === id ? '' : 'none';
  });
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = tab ? (tab._historyPage ? '/history' : tab.url) : '';
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
  _browseUpdateNewTabPage(tab);
  _updateAudioIndicator();

  // Paper tab handling
  if (tab && tab.paper) {
    _currentPaperViewPaper = tab.paper;
    // Render PDF if not yet rendered
    if (tab.contentType === 'pdf' && tab.el && !tab.el.querySelector('.pdf-toolbar')) {
      cleanupPdfViewer();
      const pdfUrl = tab.pdfUrl || ('/api/arxiv-pdf?id=' + encodeURIComponent(tab.arxivId));
      initPdfViewer(tab.el, pdfUrl, tab.arxivId || ('upload-' + tab.id));
    }
    // Render reader/iframe if not yet rendered
    else if (tab.contentType === 'reader' && tab.el && !tab.el.children.length) {
      _tryRenderSavedContent(tab.el, tab.paper);
    }
    // Update sidebar with paper metadata
    const browseSb = document.getElementById('browse-sidebar');
    if (browseSb) {
      browseSb.innerHTML = _renderSidebarHTML(tab.contentType === 'pdf' ? tab.paper : null);
      _initSidebar(browseSb);
      browseSb.style.display = '';
    }
    _initSidebarForUrl(tab.url);
    _startScrollTracker(tab.url);
    _browseUpdateBarForTab(tab);
  } else {
    _currentPaperViewPaper = null;
    _browseUpdateBarForTab(tab);
    // Update sidebar for the selected tab
    if (tab && tab.url && !tab.blank && typeof _initSidebarForUrl === 'function') {
      _initSidebarForUrl(tab.url);
    }
  }
}

function _browseUpdateBarForTab(tab) {
  let citeBtn = document.getElementById('browse-cite-btn');
  let bookmarkBtn = document.getElementById('browse-paper-bookmark-btn');
  if (tab && tab.paper) {
    // Cite button
    if (!citeBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      citeBtn = document.createElement('button');
      citeBtn.id = 'browse-cite-btn';
      citeBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover flex items-center justify-center';
      citeBtn.onclick = function() { if (typeof showCitePopup === 'function') showCitePopup(); };
      citeBtn.title = 'Cite';
      citeBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>';
      if (moreBtn) moreBtn.parentElement.insertBefore(citeBtn, moreBtn);
    }
    citeBtn.style.display = '';
    // Bookmark button
    if (!bookmarkBtn) {
      const moreBtn = document.getElementById('browse-more-btn');
      bookmarkBtn = document.createElement('button');
      bookmarkBtn.id = 'browse-paper-bookmark-btn';
      bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center';
      bookmarkBtn.onclick = function() { if (typeof togglePaperViewBookmark === 'function') togglePaperViewBookmark(); };
      bookmarkBtn.title = 'Save';
      if (moreBtn) moreBtn.parentElement.insertBefore(bookmarkBtn, citeBtn);
    }
    const isSaved = typeof isPostSaved === 'function' && isPostSaved(tab.paper.link);
    bookmarkBtn.className = 'browse-bar-draggable shrink-0 w-7 h-7 rounded-md bg-transparent border-none cursor-pointer hover:bg-hover flex items-center justify-center ' + (isSaved ? 'text-accent' : 'text-dimmer hover:text-primary');
    bookmarkBtn.title = isSaved ? 'Saved' : 'Save';
    bookmarkBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="' + (isSaved ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    bookmarkBtn.style.display = '';
  } else {
    if (citeBtn) citeBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
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
      ntp.innerHTML = `<div class="browse-ntp-inner"><span class="browse-ntp-text">alpha</span>
        <button id="browse-open-pdf-btn" class="mt-2 px-3 py-1 rounded text-dimmer hover:text-primary cursor-pointer text-xs transition-colors" style="font-family:inherit;opacity:0.5">open file</button>
        <input type="file" id="browse-pdf-file-input" style="display:none">
        <div id="browse-ntp-drop-hint" class="mt-1 text-xs text-dimmer" style="opacity:0.5">or drop here</div></div>`;
      container.appendChild(ntp);
      ntp.querySelector('#browse-open-pdf-btn').onclick = function() {
        ntp.querySelector('#browse-pdf-file-input').click();
      };
      ntp.querySelector('#browse-pdf-file-input').onchange = function(e) {
        const file = e.target.files[0];
        if (file) openLocalPdf(file);
        e.target.value = '';
      };
      ntp.addEventListener('dragover', function(e) { e.preventDefault(); ntp.style.outline = '2px dashed var(--accent)'; });
      ntp.addEventListener('dragleave', function() { ntp.style.outline = ''; });
      ntp.addEventListener('drop', function(e) {
        e.preventDefault();
        ntp.style.outline = '';
        const file = e.dataTransfer.files[0];
        if (file) openLocalPdf(file);
      });
    }
    ntp.style.display = '';
  } else if (ntp) {
    ntp.style.display = 'none';
  }
}

function browseCloseTab(id) {
  const win = _getCurrentWindow();
  if (!win) return;
  const idx = win.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = win.tabs[idx];
  const wasLast = win.tabs.length === 1;
  _browseClosedTabs.push({ url: tab.url || '', title: tab.title, blank: !!tab.blank, paper: tab.paper || null, contentType: tab.contentType || null, arxivId: tab.arxivId || null });
  if (_browseClosedTabs.length > _BROWSE_CLOSED_TABS_MAX) _browseClosedTabs.splice(0, _browseClosedTabs.length - _BROWSE_CLOSED_TABS_MAX);
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  if (tab.contentType === 'pdf') cleanupPdfViewer();
  if (tab.el) tab.el.remove();
  // Clean up audio tracking
  _browseAudioTabs.delete(id);
  _updateAudioIndicator();
  win.tabs.splice(idx, 1);
  if (!win.tabs.length) {
    if (_browseWindows.length > 1) {
      browseCloseWindow(win.id);
      _browseAnimateBounce();
    } else {
      browseNewTab();
      _browseAnimateBounce();
    }
    return;
  }
  if (win.activeTab === id) {
    const nextIdx = Math.min(idx, win.tabs.length - 1);
    browseSelectTab(win.tabs[nextIdx].id);
  } else {
    _browseRenderTabs();
  }
  _browseSaveTabs();
}

function browseReopenTab() {
  if (!_browseClosedTabs.length) return;
  const closed = _browseClosedTabs.pop();
  localStorage.setItem('browseClosedTabs', JSON.stringify(_browseClosedTabs));
  if (closed.paper && closed.contentType) {
    browseNewPaperTab(closed.url, closed.paper);
  } else {
    browseNewTab(closed.url);
  }
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

// ── Audio Tracking ──

function toggleTabMute(tabId) {
  const audioInfo = _browseAudioTabs.get(tabId);
  if (!audioInfo) return;

  // Find the tab element
  for (const win of _browseWindows) {
    const tab = win.tabs.find(t => t.id === tabId);
    if (tab && tab.el && _browseIsElectron) {
      const newMuted = !audioInfo.muted;
      tab.el.setAudioMuted(newMuted);
      audioInfo.muted = newMuted;
      _browseAudioTabs.set(tabId, audioInfo);
      _browseRenderTabs();
      _updateAudioIndicator();
      return;
    }
  }
}

function goToAudioTab() {
  // Go to the first tab playing audio
  const entry = _browseAudioTabs.entries().next().value;
  if (!entry) return;

  const [tabId, info] = entry;
  if (info.windowId !== _browseActiveWindow) {
    browseSelectWindow(info.windowId);
  }
  browseSelectTab(tabId);

  // If not in browse view, navigate there
  if (!document.getElementById('browse-view')?.style.display || document.getElementById('browse-view').style.display === 'none') {
    openBrowse();
  }
}

function toggleAllAudio() {
  // Check if all are muted
  const allMuted = [..._browseAudioTabs.values()].every(info => info.muted);
  const newMuted = !allMuted;

  for (const [tabId, info] of _browseAudioTabs) {
    for (const win of _browseWindows) {
      const tab = win.tabs.find(t => t.id === tabId);
      if (tab && tab.el && _browseIsElectron) {
        tab.el.setAudioMuted(newMuted);
        info.muted = newMuted;
        _browseAudioTabs.set(tabId, info);
      }
    }
  }
  _browseRenderTabs();
  _updateAudioIndicator();
}

function _updateAudioIndicator() {
  let indicator = document.getElementById('audio-indicator');

  if (_browseAudioTabs.size === 0) {
    if (indicator) indicator.style.display = 'none';
    return;
  }

  // Create indicator if it doesn't exist
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'audio-indicator';
    indicator.className = 'audio-indicator';
    document.body.appendChild(indicator);
  }

  // Get info about playing tabs
  const playingTabs = [];
  for (const [tabId, info] of _browseAudioTabs) {
    for (const win of _browseWindows) {
      const tab = win.tabs.find(t => t.id === tabId);
      if (tab) {
        playingTabs.push({ tab, win, muted: info.muted, tabId });
        break;
      }
    }
  }

  const firstTab = playingTabs[0];
  if (!firstTab) {
    indicator.style.display = 'none';
    return;
  }

  // Hide if we're already on this tab in the browse view
  const browseView = document.getElementById('browse-view');
  const isOnBrowseView = browseView && browseView.style.display !== 'none';
  const isCurrentTab = isOnBrowseView &&
    firstTab.win.id === _browseActiveWindow &&
    firstTab.tab.id === firstTab.win.activeTab;

  if (isCurrentTab) {
    indicator.style.display = 'none';
    return;
  }

  const allMuted = playingTabs.every(p => p.muted);

  indicator.innerHTML = `
    <button class="audio-indicator-icon" onclick="toggleAllAudio()" title="${allMuted ? 'Unmute audio' : 'Mute audio'}">
      <svg class="w-4 h-4 ${allMuted ? '' : 'audio-playing'}" fill="currentColor" viewBox="0 0 24 24">
        ${allMuted
          ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
          : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'}
      </svg>
    </button>
    <button class="audio-indicator-title-btn" onclick="goToAudioTab()" title="Go to tab">
      ${escapeHtml(firstTab.tab.title.slice(0, 25) || 'Audio')}
    </button>
  `;

  indicator.style.display = 'flex';
}

function _browseRenderTabs() {
  const bar = document.getElementById('browse-tabs');
  if (!bar) return;
  const win = _getCurrentWindow();
  const tabs = win ? win.tabs : [];
  const activeTab = win ? win.activeTab : null;

  // Window switcher (if multiple windows)
  let windowSelector = '';
  if (_browseWindows.length > 1) {
    const winIdx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
    windowSelector = `<div class="browse-window-switcher" data-window-idx="${winIdx}" onclick="toggleBrowseTabOverview()">
      <button class="browse-window-arrow up ${winIdx === 0 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowUp()" title="Previous window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg>
      </button>
      <button class="browse-window-arrow down ${winIdx === _browseWindows.length - 1 ? 'disabled' : ''}" onclick="event.stopPropagation();switchWindowDown()" title="Next window">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg>
      </button>
    </div>`;
  }

  bar.innerHTML = windowSelector + tabs.map(t => {
    const active = t.id === activeTab;
    const hasAudio = _browseAudioTabs.has(t.id);
    const audioInfo = _browseAudioTabs.get(t.id);
    const isMuted = audioInfo?.muted;
    const title = escapeHtml(t.title);
    const fav = t.favicon ? `<img class="browse-tab-favicon" src="${escapeHtml(t.favicon)}" onerror="this.style.display='none'">` : '';
    const audioIcon = hasAudio ? `<button class="browse-tab-audio ${isMuted ? 'muted' : ''}" onclick="event.stopPropagation();toggleTabMute(${t.id})" title="${isMuted ? 'Unmute' : 'Mute'}">
      ${isMuted ? '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' : '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>'}</button>` : '';
    return `<div class="browse-tab ${active ? 'active' : ''} ${hasAudio ? 'has-audio' : ''}" onclick="_focusBrowseTabBar();browseSelectTab(${t.id})">
      ${fav}${audioIcon}<span class="browse-tab-title">${title}</span>
      <button class="browse-tab-close" onclick="event.stopPropagation();browseCloseTab(${t.id})" title="Close tab">&times;</button>
    </div>`;
  }).join('') + `<button class="browse-tab-new" onclick="browseNewTab()" title="New tab">+</button>`;

  // Update tab count on overview button
  const totalTabs = _browseWindows.reduce((sum, w) => sum + w.tabs.length, 0);
  const countBadge = document.getElementById('browse-tab-overview-btn');
  if (countBadge) countBadge.title = `Show all tabs (${totalTabs} tabs, ${_browseWindows.length} windows)`;

  // Render toolbar sessions dropdown only if overview is visible
  if (_browseTabOverviewVisible) {
    _renderToolbarSessions();
  }

  // Attach tab drag-to-reorder handlers + hover tooltips
  bar.querySelectorAll('.browse-tab').forEach(tabEl => {
    tabEl.addEventListener('mousedown', _tabDragStart);
    tabEl.addEventListener('mouseenter', _browseTabHoverIn);
    tabEl.addEventListener('mouseleave', _browseTabHoverOut);
  });
}

// ── Tab hover tooltip ──

let _tabHoverTooltip = null;
let _tabHoverTimeout = null;
let _tabHoverDismissTimeout = null;

function _isInsideTooltip(el) {
  return _tabHoverTooltip && (el === _tabHoverTooltip || _tabHoverTooltip.contains(el));
}

function _dismissTooltip() {
  clearTimeout(_tabHoverTimeout);
  clearTimeout(_tabHoverDismissTimeout);
  if (_tabHoverTooltip) { _tabHoverTooltip.remove(); _tabHoverTooltip = null; }
}

function _browseTabHoverIn(e) {
  const tabEl = e.currentTarget;
  clearTimeout(_tabHoverTimeout);
  clearTimeout(_tabHoverDismissTimeout);
  if (_tabHoverTooltip) return;
  _tabHoverTimeout = setTimeout(() => _showTabTooltip(tabEl), 400);
}

function _browseTabHoverOut(e) {
  clearTimeout(_tabHoverTimeout);
  // If mouse moved into the tooltip, don't dismiss
  if (e && e.relatedTarget && _isInsideTooltip(e.relatedTarget)) return;
  clearTimeout(_tabHoverDismissTimeout);
  _tabHoverDismissTimeout = setTimeout(_dismissTooltip, 150);
}

function _showTabTooltip(tabEl) {
  const onclickAttr = tabEl.getAttribute('onclick') || '';
  const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
  if (!idMatch) return;
  const tabId = parseInt(idMatch[1]);
  const tabs = typeof _browseTabs !== 'undefined' ? _browseTabs : [];
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  _dismissTooltip();
  const tip = document.createElement('div');
  tip.className = 'browse-tab-tooltip';
  const isBlank = !tab.url;
  const domain = !isBlank ? (() => { try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; } })() : '';
  const favUrl = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16` : '';
  const favHtml = favUrl ? `<img src="${escapeAttr(favUrl)}" class="browse-tab-tooltip-favicon" onerror="this.style.display='none'">` : '';
  tip.innerHTML = `
    <div class="browse-tab-tooltip-header">
      ${favHtml}
      <div class="browse-tab-tooltip-text">
        <div class="browse-tab-tooltip-title">${escapeHtml(tab.title || (isBlank ? 'New Tab' : 'Untitled'))}</div>
        ${isBlank ? '' : `<div class="browse-tab-tooltip-url">${escapeHtml(tab.url.length > 80 ? tab.url.slice(0, 77) + '...' : tab.url)}</div>`}
      </div>
    </div>
    <button class="browse-tab-tooltip-add${isBlank ? ' disabled' : ''}" data-tab-id="${tabId}"${isBlank ? ' disabled' : ''}>
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
      Add to assistant
    </button>`;
  document.body.appendChild(tip);

  const rect = tabEl.getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 4)) + 'px';
  tip.style.top = rect.bottom + 'px';

  if (!isBlank) {
    tip.querySelector('.browse-tab-tooltip-add').addEventListener('click', (ev) => {
      ev.stopPropagation();
      _browseTabAddToAssistant(tabId);
      _dismissTooltip();
    });
  }

  tip.addEventListener('mouseenter', () => { clearTimeout(_tabHoverDismissTimeout); });
  tip.addEventListener('mouseleave', (ev) => {
    // If mouse moved back to a tab, let the tab's hover handler deal with it
    clearTimeout(_tabHoverDismissTimeout);
    _tabHoverDismissTimeout = setTimeout(_dismissTooltip, 150);
  });

  _tabHoverTooltip = tip;
}

async function _browseTabAddToAssistant(tabId) {
  const tabs = typeof _browseTabs !== 'undefined' ? _browseTabs : [];
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || !tab.url) return;

  // Find or create the popup panel
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup && typeof _showPanel === 'function') {
    _showPanel({ anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
    await new Promise(r => setTimeout(r, 100));
  }
  const panel = document.getElementById('doc-chat-ask-float');
  if (!panel) return;

  // Fetch page content and add as context
  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url })
    });
    const data = await resp.json();
    if (typeof _addTabContextToPanel === 'function') {
      _addTabContextToPanel(panel, { tabId: tab.id, title: tab.title, url: tab.url, content: data.text || '' });
    }
  } catch (e) {
    if (typeof _addTabContextToPanel === 'function') {
      _addTabContextToPanel(panel, { tabId: tab.id, title: tab.title, url: tab.url, content: '' });
    }
  }
}

// ── Tab drag-to-reorder ──

let _tabDragState = null;
const TAB_DRAG_THRESHOLD = 5;

function _tabDragStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.browse-tab-close, .browse-tab-audio')) return;
  const tabEl = e.currentTarget;
  const onclickAttr = tabEl.getAttribute('onclick') || '';
  const idMatch = onclickAttr.match(/browseSelectTab\((\d+)\)/);
  if (!idMatch) return;
  e.preventDefault(); // prevent text selection and let _tabDragEnd handle click
  const tabId = parseInt(idMatch[1]);
  _tabDragState = { tabId, startX: e.clientX, startY: e.clientY, tabEl, ghostEl: null, indicator: null, insertBeforeId: null, hasMoved: false };
  // Suppress the inline onclick so _tabDragEnd controls selection
  const origOnclick = tabEl.getAttribute('onclick');
  tabEl.removeAttribute('onclick');
  _tabDragState._origOnclick = origOnclick;
  document.addEventListener('mousemove', _tabDragMove);
  document.addEventListener('mouseup', _tabDragEnd);
}

function _tabDragMove(e) {
  if (!_tabDragState) return;
  const dx = e.clientX - _tabDragState.startX;
  const dy = e.clientY - _tabDragState.startY;
  if (!_tabDragState.hasMoved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;

  if (!_tabDragState.hasMoved) {
    _tabDragState.hasMoved = true;
    // Prevent the onclick from firing
    _tabDragState.tabEl.style.pointerEvents = 'none';
    // Create ghost
    const ghost = _tabDragState.tabEl.cloneNode(true);
    ghost.className += ' browse-tab-dragging';
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10001';
    ghost.style.width = _tabDragState.tabEl.offsetWidth + 'px';
    document.body.appendChild(ghost);
    _tabDragState.ghostEl = ghost;
    _tabDragState.tabEl.classList.add('browse-tab-drag-source');
    // Create insertion indicator
    const indicator = document.createElement('div');
    indicator.className = 'browse-tab-insert-indicator';
    const bar = document.getElementById('browse-tabs');
    if (bar) {
      bar.style.position = 'relative';
      bar.appendChild(indicator);
    }
    _tabDragState.indicator = indicator;
  }

  // Move ghost with cursor
  _tabDragState.ghostEl.style.left = (e.clientX - _tabDragState.tabEl.offsetWidth / 2) + 'px';
  _tabDragState.ghostEl.style.top = (e.clientY - _tabDragState.tabEl.offsetHeight / 2) + 'px';

  // Find nearest insertion point
  _tabDragUpdatePosition(e.clientX);
}

function _tabDragUpdatePosition(clientX) {
  if (!_tabDragState || !_tabDragState.indicator) return;
  const bar = document.getElementById('browse-tabs');
  if (!bar) return;
  const tabs = Array.from(bar.querySelectorAll('.browse-tab'));
  let insertBeforeId = null;
  let indicatorLeft = null;
  const barRect = bar.getBoundingClientRect();

  for (const t of tabs) {
    const rect = t.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) {
      const onclickAttr = t.getAttribute('onclick') || '';
      const m = onclickAttr.match(/browseSelectTab\((\d+)\)/);
      if (m) insertBeforeId = parseInt(m[1]);
      indicatorLeft = rect.left - barRect.left - 1;
      break;
    }
  }

  // If no tab found, insert at end
  if (indicatorLeft === null && tabs.length > 0) {
    const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
    indicatorLeft = lastRect.right - barRect.left + 1;
  }

  _tabDragState.insertBeforeId = insertBeforeId;
  if (indicatorLeft !== null) {
    _tabDragState.indicator.style.display = '';
    _tabDragState.indicator.style.left = indicatorLeft + 'px';
    _tabDragState.indicator.style.top = '4px';
    _tabDragState.indicator.style.height = (bar.offsetHeight - 8) + 'px';
  }
}

function _tabDragEnd(e) {
  document.removeEventListener('mousemove', _tabDragMove);
  document.removeEventListener('mouseup', _tabDragEnd);
  if (!_tabDragState) return;

  const { tabId, hasMoved, insertBeforeId, ghostEl, indicator, tabEl, _origOnclick } = _tabDragState;
  _tabDragState = null;

  // Clean up visual elements
  if (ghostEl) ghostEl.remove();
  if (indicator) indicator.remove();
  tabEl.classList.remove('browse-tab-drag-source');
  tabEl.style.pointerEvents = '';
  if (_origOnclick) tabEl.setAttribute('onclick', _origOnclick);

  if (hasMoved) {
    const win = _getCurrentWindow();
    if (!win) return;
    const fromIdx = win.tabs.findIndex(t => t.id === tabId);
    if (fromIdx === -1) return;
    const [movedTab] = win.tabs.splice(fromIdx, 1);
    if (insertBeforeId !== null) {
      const toIdx = win.tabs.findIndex(t => t.id === insertBeforeId);
      if (toIdx !== -1) {
        win.tabs.splice(toIdx, 0, movedTab);
      } else {
        win.tabs.push(movedTab);
      }
    } else {
      win.tabs.push(movedTab);
    }
    _browseRenderTabs();
    _browseSaveTabs();
  } else {
    // No drag movement — treat as a normal click to select tab
    _focusBrowseTabBar();
    browseSelectTab(tabId);
  }
}

// ── Tab Overview (Safari iPad style) ──

let _browseTabOverviewVisible = false;

function toggleBrowseTabOverview() {
  _browseTabOverviewVisible ? hideBrowseTabOverview() : showBrowseTabOverview();
}

// Tab overview keyboard navigation state
let _overviewSelectedIndex = 0; // Flat index across all tabs
let _overviewKeyHandler = null;

// Get flat list of all selectable items (tabs + new tab cards)
function _getOverviewItems() {
  const items = [];
  _browseWindows.forEach((win, winIdx) => {
    win.tabs.forEach((tab, tabIdx) => {
      items.push({ type: 'tab', windowId: win.id, tabId: tab.id, winIdx, tabIdx });
    });
    // Add new tab card for this window
    items.push({ type: 'newTab', windowId: win.id, winIdx, tabIdx: win.tabs.length });
  });
  return items;
}

function showBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _browseTabOverviewVisible = true;

  // Initialize selection to current active window and tab (niri-style)
  const currentWinIdx = _browseWindows.findIndex(w => w.id === _browseActiveWindow);
  _overviewSelectedWinIdx = currentWinIdx >= 0 ? currentWinIdx : 0;
  const currentWin = _browseWindows[_overviewSelectedWinIdx];
  if (currentWin) {
    const tabIdx = currentWin.tabs.findIndex(t => t.id === currentWin.activeTab);
    _overviewSelectedTabIdx = tabIdx >= 0 ? tabIdx : 0;
  } else {
    _overviewSelectedTabIdx = 0;
  }

  _renderBrowseTabOverview();
  overlay.style.display = 'flex';
  // Install keyboard handler
  _installOverviewKeyHandler();
  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  });
}

function hideBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;
  _browseTabOverviewVisible = false;
  _removeOverviewKeyHandler();
  overlay.classList.remove('visible');
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 200);
}

// Track selected window and tab index for niri-style navigation
let _overviewSelectedWinIdx = 0;
let _overviewSelectedTabIdx = 0;

function _installOverviewKeyHandler() {
  if (_overviewKeyHandler) return;
  _overviewKeyHandler = (e) => {
    if (!_browseTabOverviewVisible) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Left/Right: switch windows (horizontal)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (_overviewSelectedWinIdx > 0) {
        _overviewSelectedWinIdx--;
        _overviewSelectedTabIdx = Math.min(_overviewSelectedTabIdx, _browseWindows[_overviewSelectedWinIdx].tabs.length - 1);
        _updateOverviewSelection();
        _scrollToOverviewWindow(_browseWindows[_overviewSelectedWinIdx].id);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (_overviewSelectedWinIdx < _browseWindows.length - 1) {
        _overviewSelectedWinIdx++;
        _overviewSelectedTabIdx = Math.min(_overviewSelectedTabIdx, _browseWindows[_overviewSelectedWinIdx].tabs.length - 1);
        _updateOverviewSelection();
        _scrollToOverviewWindow(_browseWindows[_overviewSelectedWinIdx].id);
      }
    }
    // Up/Down: switch tabs within window (vertical)
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_overviewSelectedTabIdx > 0) {
        _overviewSelectedTabIdx--;
        _updateOverviewSelection();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const win = _browseWindows[_overviewSelectedWinIdx];
      if (win && _overviewSelectedTabIdx < win.tabs.length - 1) {
        _overviewSelectedTabIdx++;
        _updateOverviewSelection();
      }
    }
    // Enter: select current tab
    else if (e.key === 'Enter') {
      e.preventDefault();
      _selectOverviewItem();
    }
    // Escape: close overview
    else if (e.key === 'Escape') {
      e.preventDefault();
      hideBrowseTabOverview();
    }
    // N: new window
    else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      _newWindowFromOverview();
    }
    // T: new tab in current window
    else if (e.key === 't' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const win = _browseWindows[_overviewSelectedWinIdx];
      if (win) _newTabInWindowFromOverview(win.id);
    }
  };
  document.addEventListener('keydown', _overviewKeyHandler);
}

function _removeOverviewKeyHandler() {
  if (_overviewKeyHandler) {
    document.removeEventListener('keydown', _overviewKeyHandler);
    _overviewKeyHandler = null;
  }
}

function _updateOverviewSelection() {
  // Re-render to update selection state
  _renderBrowseTabOverview();
}

function _scrollSelectedCellIntoView() {
  const cell = document.querySelector('.browse-tab-cell.keyboard-selected');
  if (cell) {
    cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

function _selectOverviewItem() {
  const win = _browseWindows[_overviewSelectedWinIdx];
  if (!win) return;

  const tab = win.tabs[_overviewSelectedTabIdx];
  if (tab) {
    _selectTabFromOverview(win.id, tab.id);
  }
}

// Keyboard shortcut for tab overview (Cmd+Shift+\)
document.addEventListener('keydown', (e) => {
  const view = document.getElementById('browse-view');
  if (!view || view.style.display === 'none') return;
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? e.metaKey : e.ctrlKey;
  if (cmdKey && e.shiftKey && e.key === '\\') {
    e.preventDefault();
    toggleBrowseTabOverview();
  }
  // Escape to close overview
  if (e.key === 'Escape' && _browseTabOverviewVisible) {
    e.preventDefault();
    hideBrowseTabOverview();
  }
});

function _renderBrowseTabOverview() {
  const overlay = document.getElementById('browse-tab-overview');
  if (!overlay) return;

  const totalTabs = _browseWindows.reduce((sum, w) => sum + w.tabs.length, 0);

  // Render each window as a column in a 2D grid
  const windowColumns = _browseWindows.map((win, winIdx) => {
    const isActiveWindow = win.id === _browseActiveWindow;
    const isSelectedColumn = winIdx === _overviewSelectedWinIdx;

    // Window header
    const hasNonBlankTabs = win.tabs.some(t => !t.blank && t.url);
    const windowHeader = `
      <div class="browse-window-header">
        <span class="browse-window-title" ondblclick="event.stopPropagation();_startRenameWindow(${win.id}, this)">${escapeHtml(win.name)}</span>
        <span class="browse-window-tab-count">${win.tabs.length}</span>
        <div class="browse-window-actions">
          ${hasNonBlankTabs ? `<button class="browse-window-save" onclick="event.stopPropagation();_saveWindowAsSession(${win.id})" title="Save as session">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
          </button>` : ''}
          ${_browseWindows.length > 1 ? `<button class="browse-window-close" onclick="event.stopPropagation();_closeWindowFromOverview(${win.id})" title="Close window">&times;</button>` : ''}
        </div>
      </div>
    `;

    // Render tabs as cells
    const tabCells = win.tabs.map((t, tabIdx) => {
      const isActiveTab = isActiveWindow && t.id === win.activeTab;
      const isSelected = isSelectedColumn && tabIdx === _overviewSelectedTabIdx;
      const title = escapeHtml(t.title);
      let urlDisplay = '';
      try {
        const u = new URL(t.url);
        urlDisplay = u.hostname.replace(/^www\./, '');
      } catch { urlDisplay = t.url || 'New Tab'; }

      const favContent = t.favicon
        ? `<img src="${escapeHtml(t.favicon)}" onerror="this.parentElement.innerHTML='●'">`
        : `<span style="color:var(--text-dimmer);font-size:0.7rem;">●</span>`;

      // Audio indicator
      const hasAudio = _browseAudioTabs.has(t.id);
      const audioInfo = _browseAudioTabs.get(t.id);
      const isMuted = audioInfo?.muted;
      const audioIcon = hasAudio ? `
        <svg class="w-4 h-4" style="flex-shrink:0;color:${isMuted ? 'var(--text-dimmer)' : 'var(--accent)'}" fill="currentColor" viewBox="0 0 24 24">
          ${isMuted
            ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
            : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'}
        </svg>
      ` : '';

      return `
        <div class="browse-tab-cell ${isActiveTab ? 'active' : ''} ${isSelected ? 'keyboard-selected' : ''}"
             data-win-idx="${winIdx}" data-tab-idx="${tabIdx}"
             onclick="event.stopPropagation();_selectTabFromOverview(${win.id}, ${t.id})">
          <div class="browse-tab-cell-favicon">${favContent}</div>
          <div class="browse-tab-cell-info">
            <div class="browse-tab-cell-title">${title}</div>
            <div class="browse-tab-cell-url">${escapeHtml(urlDisplay)}</div>
          </div>
          ${audioIcon}
          <button class="browse-tab-cell-close" onclick="event.stopPropagation();_closeTabFromOverview(${win.id}, ${t.id})" title="Close">&times;</button>
        </div>
      `;
    }).join('');

    // New tab cell
    const newTabCell = `
      <div class="browse-tab-cell-new" onclick="event.stopPropagation();_newTabInWindowFromOverview(${win.id})">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
        New Tab
      </div>
    `;

    return `
      <div class="browse-window-section ${isSelectedColumn ? 'column-selected' : ''}" data-window-id="${win.id}" data-win-idx="${winIdx}">
        ${windowHeader}
        ${tabCells}
        ${newTabCell}
      </div>
    `;
  }).join('');

  // New window column at the end
  const newWindowColumn = `
    <div class="browse-window-new" onclick="event.stopPropagation();_newWindowFromOverview()">
      <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
      <span>New Window</span>
    </div>
  `;

  // Position indicator
  const currentWin = _browseWindows[_overviewSelectedWinIdx];
  const positionIndicator = `
    <div class="browse-overview-position">
      <span class="browse-overview-position-cell active">
        Window ${_overviewSelectedWinIdx + 1}/${_browseWindows.length}
      </span>
      <span>·</span>
      <span class="browse-overview-position-cell active">
        Tab ${_overviewSelectedTabIdx + 1}/${currentWin ? currentWin.tabs.length : 0}
      </span>
      <span style="margin-left:auto;opacity:0.6">
        <kbd>←→</kbd> windows
        <kbd>↑↓</kbd> tabs
        <kbd>Enter</kbd> select
      </span>
    </div>
  `;

  // Header row with window/tab info and panel button
  const headerRow = `
    <div class="browse-overview-header">
      <span class="browse-overview-title">${_browseWindows.length} Window${_browseWindows.length !== 1 ? 's' : ''}</span>
      <span class="browse-overview-count">${totalTabs} tab${totalTabs !== 1 ? 's' : ''}</span>
      <div class="browse-overview-hints">
        <span><kbd>←→</kbd> windows</span>
        <span><kbd>↑↓</kbd> tabs</span>
        <span><kbd>N</kbd> new window</span>
        <span><kbd>T</kbd> new tab</span>
      </div>
      <button class="browse-overview-close-btn" onclick="hideBrowseTabOverview()" title="Close panel">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
      </button>
    </div>
  `;

  overlay.innerHTML = `
    ${headerRow}
    <div class="browse-tab-overview-grid-container" id="browse-overview-scroll">
      <div class="browse-tab-overview-windows">
        ${windowColumns}
        ${newWindowColumn}
      </div>
    </div>
    ${positionIndicator}
  `;

  // Scroll selected cell into view
  requestAnimationFrame(() => {
    _scrollSelectedCellIntoView();
  });
}

function _selectWindowFromOverview(windowId, event) {
  // Don't trigger if clicking on a tab card or button
  if (event.target.closest('.browse-tab-card') || event.target.closest('button')) return;

  const win = _browseWindows.find(w => w.id === windowId);
  if (!win || !win.tabs.length) return;

  browseSelectWindow(windowId);
  // Select the last active tab or the first tab
  const tabId = win.activeTab || win.tabs[0].id;
  browseSelectTab(tabId);
  hideBrowseTabOverview();
}

function _selectTabFromOverview(windowId, tabId) {
  if (_browseActiveWindow !== windowId) {
    browseSelectWindow(windowId);
  }
  browseSelectTab(tabId);
  hideBrowseTabOverview();
}

function _closeTabFromOverview(windowId, tabId) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return;

  const idx = win.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  const tab = win.tabs[idx];
  if (tab.el) tab.el.remove();
  win.tabs.splice(idx, 1);

  // If window is now empty, close it or create new tab
  if (win.tabs.length === 0) {
    if (_browseWindows.length > 1) {
      browseCloseWindow(windowId);
    } else {
      // Last window - create a new tab
      _browseActiveWindow = windowId;
      browseNewTab();
    }
  } else if (win.activeTab === tabId) {
    win.activeTab = win.tabs[Math.min(idx, win.tabs.length - 1)].id;
  }

  _browseSaveTabs();
  _renderBrowseTabOverview();
}

function _newTabInWindowFromOverview(windowId) {
  browseSelectWindow(windowId);
  browseNewTab();
  hideBrowseTabOverview();
}

function _newWindowFromOverview() {
  browseCreateWindow();
  hideBrowseTabOverview();
}

function _closeWindowFromOverview(windowId) {
  browseCloseWindow(windowId);
  _renderBrowseTabOverview();
}

// Click handler for selecting a cell in the 2D grid
function _selectGridCell(winIdx, tabIdx) {
  _overviewSelectedWinIdx = winIdx;
  _overviewSelectedTabIdx = tabIdx;
  _updateOverviewSelection();
}

function _startRenameWindow(windowId, el) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = win.name;
  input.className = 'browse-window-rename-input';

  const finish = () => {
    const newName = input.value.trim() || win.name;
    browseRenameWindow(windowId, newName);
    _renderBrowseTabOverview();
  };

  input.onblur = finish;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = win.name; input.blur(); }
  };

  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  input.select();
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
  // Handle slash commands
  const cmd = (input || '').trim().toLowerCase();
  if (cmd === '/history') {
    openSearchHistoryPage();
    return;
  }
  if (cmd === '/upload') {
    const fi = document.getElementById('browse-pdf-file-input');
    if (fi) { fi.click(); return; }
    const tmp = document.createElement('input');
    tmp.type = 'file'; tmp.style.display = 'none';
    tmp.onchange = function() { if (tmp.files[0]) openLocalPdf(tmp.files[0]); tmp.remove(); };
    document.body.appendChild(tmp); tmp.click();
    return;
  }
  const url = _browseResolveUrl(input);
  // Track web searches (when input resolved to a Google search, not a direct URL)
  const trimmed = (input || '').trim();
  if (trimmed && url.startsWith('https://www.google.com/search?q=')) {
    _saveWebSearch(trimmed);
  }
  // arXiv URL → open as paper tab
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  if (arxivMatch) {
    browseNewPaperTab(url, { title: 'arXiv: ' + arxivMatch[1], link: url, source: 'arxiv', arxivId: arxivMatch[1], description: '', authors: '', categories: [] });
    return;
  }
  // Local/blob PDF → open in PDF viewer
  if (/\.pdf$/i.test(url) && /^(file|blob):/.test(url)) {
    const name = url.split('/').pop().replace(/\.pdf$/i, '') || 'Local PDF';
    const pdfUrl = url.startsWith('file://') ? '/api/local-file?path=' + encodeURIComponent(url.replace(/^file:\/\//, '')) : url;
    const paper = { title: decodeURIComponent(name), link: url, source: 'upload', pdfUrl };
    browseNewPaperTab(url, paper);
    return;
  }
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) { browseNewTab(url); return; }
  // Push current URL onto back stack for navigation history
  if (tab.url && !tab.blank) {
    if (!tab.backStack) tab.backStack = [];
    tab.backStack.push(tab.url);
    tab.forwardStack = [];
  }
  tab.url = url;
  tab.title = _browseTitleFromUrl(url);
  tab.favicon = _browseFaviconUrl(url);
  tab.blank = false;
  _saveBrowseVisit(url, tab.title);
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
  if (/^(https?|file|blob|data):\/\//i.test(input)) return input;
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
  // Use our own history stack for non-Electron (cross-origin iframes block history.back())
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.backStack || !tab.backStack.length) return;
  if (!tab.forwardStack) tab.forwardStack = [];
  tab.forwardStack.push(tab.url);
  const prevUrl = tab.backStack.pop();
  tab.url = prevUrl;
  tab.title = _browseTitleFromUrl(prevUrl);
  tab.favicon = _browseFaviconUrl(prevUrl);
  const proxied = _browseProxyUrl(prevUrl);
  el.dataset.originalUrl = prevUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = prevUrl;
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
}

function browseForward() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.canGoForward && el.canGoForward()) { el.goForward(); return; }
  // Use our own history stack for non-Electron
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.forwardStack || !tab.forwardStack.length) return;
  if (!tab.backStack) tab.backStack = [];
  tab.backStack.push(tab.url);
  const nextUrl = tab.forwardStack.pop();
  tab.url = nextUrl;
  tab.title = _browseTitleFromUrl(nextUrl);
  tab.favicon = _browseFaviconUrl(nextUrl);
  const proxied = _browseProxyUrl(nextUrl);
  el.dataset.originalUrl = nextUrl;
  el.src = proxied;
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = nextUrl;
  _browseRenderTabs();
  _browseUpdateSaveBtn();
  _browseSaveTabs();
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
// ── Find in page ──

let _browseFindBarActive = false;
let _browseFindRequestId = 0;

function _browseToggleFindBar() {
  if (_browseFindBarActive) {
    // If already open, focus and select the input
    const input = document.getElementById('browse-find-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
  _browseFindBarActive = true;

  const browseView = document.getElementById('browse-view');
  if (!browseView) return;

  // Create the find bar
  const bar = document.createElement('div');
  bar.id = 'browse-find-bar';
  bar.className = 'browse-find-bar';
  bar.innerHTML =
    `<input type="text" id="browse-find-input" class="browse-find-input" placeholder="Find…" autocomplete="off" spellcheck="false">` +
    `<span id="browse-find-count" class="browse-find-count"></span>` +
    `<button class="browse-find-btn" id="browse-find-prev" title="Previous">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 7-7 7 7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-next" title="Next">` +
    `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/></svg></button>` +
    `<button class="browse-find-btn" id="browse-find-close" title="Close">&times;</button>`;

  // Insert into browse-content so it floats over the page
  const content = document.getElementById('browse-content');
  if (content) {
    content.appendChild(bar);
  } else {
    browseView.appendChild(bar);
  }

  const input = document.getElementById('browse-find-input');
  const countEl = document.getElementById('browse-find-count');

  const doFind = (forward) => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward, findNext: true });
    } else {
      // For same-origin iframes
      try { el.contentWindow.find(q, false, !forward); } catch (e) {}
    }
  };

  const onInput = () => {
    const q = input.value;
    if (!q) { _browseStopFind(); countEl.textContent = ''; return; }
    const el = _browseActiveEl();
    if (!el) return;
    if (_browseIsElectron && el.findInPage) {
      _browseFindRequestId = el.findInPage(q, { forward: true, findNext: false });
    } else {
      try { el.contentWindow.find(q); } catch (e) {}
    }
  };

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); _browseCloseFindBar(); }
    // Cmd+G / Cmd+Shift+G for next/prev
    if ((e.metaKey || e.ctrlKey) && e.key === 'g') { e.preventDefault(); doFind(!e.shiftKey); }
  });

  document.getElementById('browse-find-next').addEventListener('click', () => doFind(true));
  document.getElementById('browse-find-prev').addEventListener('click', () => doFind(false));
  document.getElementById('browse-find-close').addEventListener('click', _browseCloseFindBar);

  // Listen for found-in-page results (Electron webview)
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el) {
      const handler = (e) => {
        if (e.result && e.result.requestId === _browseFindRequestId) {
          const ct = document.getElementById('browse-find-count');
          if (ct) ct.textContent = e.result.matches > 0
            ? `${e.result.activeMatchOrdinal}/${e.result.matches}`
            : 'No matches';
        }
      };
      el._findHandler = handler;
      el.addEventListener('found-in-page', handler);
    }
  }

  input.focus();
}

function _browseStopFind() {
  const el = _browseActiveEl();
  if (!el) return;
  if (_browseIsElectron && el.stopFindInPage) {
    el.stopFindInPage('clearSelection');
  }
}

function _browseCloseFindBar() {
  _browseFindBarActive = false;
  _browseStopFind();
  // Remove found-in-page listener
  if (_browseIsElectron) {
    const el = _browseActiveEl();
    if (el && el._findHandler) {
      el.removeEventListener('found-in-page', el._findHandler);
      delete el._findHandler;
    }
  }
  const bar = document.getElementById('browse-find-bar');
  if (bar) bar.remove();
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

// Cmd+Plus / Cmd+Minus / Cmd+0 / Cmd+F / Cmd+T / Cmd+W for browse view
document.addEventListener('keydown', function(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const browseView = document.getElementById('browse-view');
  if (!browseView || browseView.style.display === 'none') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); browseZoom(1); }
  else if (e.key === '-') { e.preventDefault(); browseZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); browseZoom(0); }
  else if (e.key === 'f') { e.preventDefault(); _browseToggleFindBar(); }
  else if (e.key === ']') { e.preventDefault(); if (typeof toggleBrowseSidebar === 'function') toggleBrowseSidebar(); }
});

// Cmd+W / Cmd+T work when the parent document has focus (clicking tab bar, URL bar,
// sidebar, etc.). When a cross-origin iframe has focus, browser security prevents
// intercepting these shortcuts — this is the same limitation every web app faces.
// No-op stubs kept so callers don't break.
let _browseKeyHandler = null;

let _browseTabBarFocused = false;

function _browseInstallKeyGuard() {
  if (_browseKeyHandler) return;
  _browseKeyHandler = (e) => {
    // Only handle if browse view is visible and not typing in an input
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    // Don't handle if tab overview is open (it has its own handler)
    if (_browseTabOverviewVisible) return;
    // Option+Arrow switches tabs globally (no tab bar focus needed)
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _switchTabLeft(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); _switchTabRight(); return; }
    }
    // Only handle arrow keys if tab bar is focused
    if (!_browseTabBarFocused) return;

    const win = _getCurrentWindow();
    if (!win) return;

    // Arrow keys for navigation when tab bar is focused
    if (e.key === 'ArrowUp' && _browseWindows.length > 1) {
      e.preventDefault();
      switchWindowUp();
    } else if (e.key === 'ArrowDown' && _browseWindows.length > 1) {
      e.preventDefault();
      switchWindowDown();
    } else if (e.key === 'ArrowLeft' && win.tabs.length > 1) {
      e.preventDefault();
      _switchTabLeft();
    } else if (e.key === 'ArrowRight' && win.tabs.length > 1) {
      e.preventDefault();
      _switchTabRight();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _blurBrowseTabBar();
    }
  };
  document.addEventListener('keydown', _browseKeyHandler);

  // Click on content area blurs tab bar
  document.addEventListener('mousedown', (e) => {
    if (!_browseTabBarFocused) return;
    const tabBar = document.getElementById('browse-tabs');
    const switcher = e.target.closest('.browse-window-switcher');
    if (tabBar && !tabBar.contains(e.target) && !switcher) {
      _blurBrowseTabBar();
    }
  });
}

function _focusBrowseTabBar() {
  _browseTabBarFocused = true;
  const tabBar = document.getElementById('browse-tabs');
  if (tabBar) tabBar.classList.add('tab-bar-focused');
}

function _blurBrowseTabBar() {
  _browseTabBarFocused = false;
  const tabBar = document.getElementById('browse-tabs');
  if (tabBar) tabBar.classList.remove('tab-bar-focused');
}

function _switchTabLeft() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx > 0) {
    _animateTabSwitch('left', () => {
      browseSelectTab(win.tabs[idx - 1].id);
    });
  }
}

function _switchTabRight() {
  const win = _getCurrentWindow();
  if (!win || win.tabs.length < 2) return;
  const idx = win.tabs.findIndex(t => t.id === win.activeTab);
  if (idx < win.tabs.length - 1) {
    _animateTabSwitch('right', () => {
      browseSelectTab(win.tabs[idx + 1].id);
    });
  }
}

function _animateTabSwitch(direction, callback) {
  const content = document.getElementById('browse-content');
  if (!content) { callback(); return; }

  const offset = direction === 'left' ? '30px' : '-30px';
  const offsetIn = direction === 'left' ? '-30px' : '30px';

  content.style.transition = 'transform 0.12s ease-out, opacity 0.12s ease-out';
  content.style.transform = `translateX(${offset})`;
  content.style.opacity = '0.5';

  setTimeout(() => {
    callback();
    content.style.transition = 'none';
    content.style.transform = `translateX(${offsetIn})`;

    requestAnimationFrame(() => {
      content.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
      content.style.transform = 'translateX(0)';
      content.style.opacity = '1';

      setTimeout(() => {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
      }, 150);
    });
  }, 120);
}

function _browseRemoveKeyGuard() {
  if (_browseKeyHandler) {
    document.removeEventListener('keydown', _browseKeyHandler);
    _browseKeyHandler = null;
  }
}

// Transparent overlay to capture pinch gestures over iframes
function _browseInstallPinchOverlay() {
  const container = document.getElementById('browse-content');
  if (!container || container.querySelector('.browse-pinch-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'browse-pinch-overlay';
  overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:auto;';
  container.appendChild(overlay);

  // Pinch-to-zoom: capture ctrlKey+wheel (trackpad pinch gesture)
  overlay.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      _browseZoomLevel = Math.min(3.0, Math.max(0.25, _browseZoomLevel + delta));
      _browseApplyZoom();
    } else {
      // Normal scroll: let it pass through to the iframe
      overlay.style.pointerEvents = 'none';
      setTimeout(function() { overlay.style.pointerEvents = 'auto'; }, 60);
    }
  }, { passive: false });

  // Forward clicks/mousedown to iframe underneath
  function _pinchPassthrough(e) {
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';
    if (el && el !== overlay) {
      el.dispatchEvent(new MouseEvent(e.type, e));
    }
  }
  overlay.addEventListener('mousedown', _pinchPassthrough);
  overlay.addEventListener('click', _pinchPassthrough);
  overlay.addEventListener('dblclick', _pinchPassthrough);
  // After mousedown, keep overlay transparent so drag/select works in iframe
  overlay.addEventListener('mousedown', function() {
    overlay.style.pointerEvents = 'none';
    function _restore() { overlay.style.pointerEvents = 'auto'; document.removeEventListener('mouseup', _restore); }
    document.addEventListener('mouseup', _restore);
  });
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
  try { return JSON.parse(localStorage.getItem(_getBrowseStorageKey('browseTabSessions')) || '[]'); } catch { return []; }
}

function _saveTabSessions(sessions) {
  localStorage.setItem(_getBrowseStorageKey('browseTabSessions'), JSON.stringify(sessions));
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
      const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
      const winCount = s.windows ? s.windows.length : 1;
      const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const subtitle = winCount > 1 ? `${winCount} windows · ${count} tabs · ${date}` : `${count} tab${count !== 1 ? 's' : ''} · ${date}`;
      html += `<div class="tab-session-row" style="display:flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;transition:background 0.1s;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
        <button onclick="loadTabSession(${i})" style="flex:1;min-width:0;text-align:left;border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;gap:1px;">
          <span style="font-size:0.8rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escapeHtml(s.name)}</span>
          <span style="font-size:0.68rem;color:var(--text-dimmer)">${subtitle}</span>
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

  // Handle multi-window sessions
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
    }
  } else {
    // Legacy single-window sessions
    for (const saved of session.tabs) {
      browseNewTab(saved.url);
    }
  }
  _browseRenderTabs();
}

function deleteTabSession(index) {
  const sessions = _getTabSessions();
  sessions.splice(index, 1);
  _saveTabSessions(sessions);
  _renderTabStateDropdown();
  _renderToolbarSessions();
  // Also update overview if visible
  if (_browseTabOverviewVisible) _renderBrowseTabOverview();
}

// Save all windows as a session (for tab overview)
function saveAllWindowsAsSession(name) {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessions = _getTabSessions();
  sessions.unshift({
    name,
    windows: _browseWindows.map(w => ({
      name: w.name,
      tabs: w.tabs.filter(t => !t.blank && t.url).map(t => ({ url: t.url, title: t.title }))
    })).filter(w => w.tabs.length > 0),
    savedAt: Date.now()
  });
  _saveTabSessions(sessions);
}

// Toggle sessions dropdown
function _toggleSessionsDropdown() {
  const menu = document.querySelector('.browse-sessions-menu');
  const toggle = document.querySelector('.browse-sessions-toggle');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (toggle) toggle.classList.toggle('open', !isOpen);

  if (!isOpen) {
    // Close on click outside
    setTimeout(() => {
      const handler = (e) => {
        if (!e.target.closest('.browse-sessions-dropdown')) {
          menu.style.display = 'none';
          if (toggle) toggle.classList.remove('open');
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }, 0);
  }
}

// Render sessions dropdown in toolbar
function _renderToolbarSessions() {
  const container = document.getElementById('browse-toolbar-sessions');
  if (!container) return;

  const sessions = _getTabSessions();
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  const canSave = totalTabs > 0;

  container.innerHTML = `
    <button class="browse-sessions-toggle" onclick="_toggleSessionsDropdown()">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
      <svg class="w-3 h-3 chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
    </button>
    <div class="browse-sessions-menu" style="display:none;">
      <div class="browse-sessions-menu-header">
        <button class="browse-save-session-btn" onclick="_promptSaveSessionFromOverview()" ${canSave ? '' : 'disabled'}>
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Save current
        </button>
      </div>
      <div class="browse-sessions-list">
        ${sessions.length === 0 ? '<div class="browse-sessions-empty">No saved sessions</div>' : sessions.map((s, i) => {
          const count = s.tabs ? s.tabs.length : (s.windows ? s.windows.reduce((n, w) => n + w.tabs.length, 0) : 0);
          const winCount = s.windows ? s.windows.length : 1;
          const date = new Date(s.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const subtitle = winCount > 1 ? `${winCount} win · ${count} tabs` : `${count} tab${count !== 1 ? 's' : ''}`;
          return `
            <div class="browse-session-item">
              <button class="browse-session-info" onclick="_loadSessionFromOverview(${i})" title="Replace current tabs">
                <span class="browse-session-name">${escapeHtml(s.name)}</span>
                <span class="browse-session-meta">${subtitle} · ${date}</span>
              </button>
              <button class="browse-session-add" onclick="_loadSessionFromOverview(${i}, true)" title="Add to existing">+</button>
              <button class="browse-session-delete" onclick="deleteTabSession(${i})" title="Delete">&times;</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Prompt to save session from overview - show inline input in sessions menu
function _promptSaveSessionFromOverview() {
  const totalTabs = _browseWindows.reduce((n, w) => n + w.tabs.filter(t => !t.blank && t.url).length, 0);
  if (!totalTabs) return;

  const sessionsList = document.querySelector('.browse-sessions-list');
  if (!sessionsList) return;

  // Check if input already exists
  if (sessionsList.querySelector('.browse-session-input-row')) return;

  // Create input row at top
  const inputRow = document.createElement('div');
  inputRow.className = 'browse-session-input-row';
  inputRow.innerHTML = `
    <input type="text" placeholder="Session name..." autofocus>
    <button class="save-confirm">Save</button>
    <button class="save-cancel">&times;</button>
  `;
  sessionsList.insertBefore(inputRow, sessionsList.firstChild);

  const input = inputRow.querySelector('input');
  const confirmBtn = inputRow.querySelector('.save-confirm');
  const cancelBtn = inputRow.querySelector('.save-cancel');

  input.focus();

  const doSave = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    saveAllWindowsAsSession(name);
    _renderToolbarSessions();
    _renderBrowseTabOverview();
  };

  const doCancel = () => inputRow.remove();

  confirmBtn.onclick = (e) => { e.stopPropagation(); doSave(); };
  cancelBtn.onclick = (e) => { e.stopPropagation(); doCancel(); };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  };
}

// Save a single window as a session - show inline input
function _saveWindowAsSession(windowId) {
  const win = _browseWindows.find(w => w.id === windowId);
  if (!win) return;

  const tabs = win.tabs.filter(t => !t.blank && t.url);
  if (!tabs.length) return;

  // Find the window section and show inline input
  const section = document.querySelector(`.browse-window-section[onclick*="${windowId}"]`);
  if (!section) return;

  const header = section.querySelector('.browse-window-header');
  if (!header) return;

  // Create input row
  const inputRow = document.createElement('div');
  inputRow.className = 'browse-window-save-input';
  inputRow.innerHTML = `
    <input type="text" placeholder="Session name..." value="${escapeHtml(win.name)}" autofocus>
    <button class="save-confirm">Save</button>
    <button class="save-cancel">&times;</button>
  `;
  header.after(inputRow);

  const input = inputRow.querySelector('input');
  const confirmBtn = inputRow.querySelector('.save-confirm');
  const cancelBtn = inputRow.querySelector('.save-cancel');

  input.focus();
  input.select();

  const doSave = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const sessions = _getTabSessions();
    sessions.unshift({
      name,
      tabs: tabs.map(t => ({ url: t.url, title: t.title })),
      savedAt: Date.now()
    });
    _saveTabSessions(sessions);
    _renderToolbarSessions();
    _renderBrowseTabOverview();
  };

  const doCancel = () => inputRow.remove();

  confirmBtn.onclick = (e) => { e.stopPropagation(); doSave(); };
  cancelBtn.onclick = (e) => { e.stopPropagation(); doCancel(); };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  };
  input.onclick = (e) => e.stopPropagation();
}

// Load session from overview (replaces current windows)
function _loadSessionFromOverview(index, addToExisting = false) {
  const sessions = _getTabSessions();
  const session = sessions[index];
  if (!session) return;

  if (!addToExisting) {
    // Close all existing windows/tabs first
    while (_browseWindows.length > 0) {
      const win = _browseWindows[0];
      while (win.tabs.length > 0) {
        _destroyTab(win.tabs[0]);
        win.tabs.shift();
      }
      _browseWindows.shift();
    }
  }

  // Load the session
  if (session.windows) {
    for (const win of session.windows) {
      const newWin = _createBrowseWindow(win.name);
      for (const t of win.tabs) {
        _browseCreateTabInWindow(newWin.id, t.url);
      }
      if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
    }
  } else if (session.tabs) {
    // Legacy format - create one window
    const newWin = _createBrowseWindow('Window 1');
    for (const t of session.tabs) {
      _browseCreateTabInWindow(newWin.id, t.url);
    }
    if (newWin.tabs.length) newWin.activeTab = newWin.tabs[0].id;
  }

  // Activate the first window
  if (_browseWindows.length) {
    _browseActiveWindow = _browseWindows[0].id;
    const win = _browseWindows[0];
    if (win.activeTab) browseSelectTab(win.activeTab);
  }

  _browseSaveTabs();
  _browseRenderTabs();
  _renderBrowseTabOverview();
}

// ── Browse More Menu (three dots) ──

function toggleBrowseMoreMenu() {
  const dd = document.getElementById('browse-more-menu');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const hasTab = tab && !tab.blank && tab.url;

  // Build overflow rows for buttons hidden in the bar
  let overflowRows = '';
  const overflowIds = typeof getBarOverflowIds === 'function' ? getBarOverflowIds() : [];
  overflowIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = (el.title || (el.querySelector('[title]') || {}).title || id).replace('browse-', '').replace('-btn', '');
    const svgEl = el.querySelector('svg');
    let icon = svgEl ? svgEl.outerHTML.replace(/w-5 h-5/g, 'w-4 h-4') : '';

    // Bookmark button: toggle in-place instead of removing from overflow
    if (id === 'browse-save-btn') {
      const isSaved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
      icon = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="${isSaved ? 'var(--accent)' : 'none'}" stroke="${isSaved ? 'var(--accent)' : 'currentColor'}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`;
      overflowRows += `<button data-overflow-id="${id}" onclick="browseSaveToReadingList();_refreshOverflowBookmark(this);" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">${icon} ${isSaved ? 'Saved' : 'Save to Reading List'}</button>`;
    } else {
      overflowRows += `<button data-overflow-id="${id}" onclick="removeFromBarOverflow('${id}');toggleBrowseMoreMenu();" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">${icon} ${label}</button>`;
    }
  });
  const overflowSep = overflowRows ? '<div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>' : '';

  const btnRect = document.getElementById('browse-more-btn').getBoundingClientRect();
  dd.innerHTML = `<div style="position:fixed;right:${Math.round(window.innerWidth - btnRect.right)}px;top:${Math.round(btnRect.bottom + 4)}px;min-width:180px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;">
    ${overflowRows}${overflowSep}
    <button onclick="document.getElementById('browse-more-menu').style.display='none'; openSearchHistoryPage();" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
      Search History
    </button>
    <div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>
    <button onclick="browseEnableNoteMode()" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Note mode
    </button>
    <button onclick="togglePaperSidebar()" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M3 3h18v18H3V3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 3v18" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Toggle sidebar
    </button>
    <button onclick="browsePrintPage()" style="width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:${hasTab ? 'var(--text-primary)' : 'var(--text-dimmest)'};font-size:0.78rem;cursor:${hasTab ? 'pointer' : 'default'};display:flex;align-items:center;gap:8px;" ${hasTab ? '' : 'disabled'} onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background='none'">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m0 0a48.159 48.159 0 0 1 10.5 0m-10.5 0V6.007c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 10.186 0c1.1.128 1.907 1.077 1.907 2.185V7.034"/></svg>
      Print page
    </button>
  </div>`;
  dd.style.display = '';

  // Set up long-press drag on overflow items to drag back to bar
  _setupOverflowDrag(dd);

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

// Refresh bookmark button appearance in the overflow menu after toggling
function _refreshOverflowBookmark(btn) {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const isSaved = tab && !tab.blank && tab.url && isPostSaved(tab.url);
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.setAttribute('fill', isSaved ? 'var(--accent)' : 'none');
    svg.setAttribute('stroke', isSaved ? 'var(--accent)' : 'currentColor');
  }
  // Update the label text
  const textNode = Array.from(btn.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
  if (textNode) textNode.textContent = ' ' + (isSaved ? 'Saved' : 'Save to Reading List');
}

// Long-press on overflow menu items to drag them back to the browse bar
function _setupOverflowDrag(dd) {
  let holdTimer = null;
  let dragGhost = null;
  let dragId = null;
  let dragBtn = null;

  function onPointerDown(e) {
    const btn = e.target.closest('[data-overflow-id]');
    if (!btn) return;
    const id = btn.dataset.overflowId;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      dragId = id;
      dragBtn = btn;
      // Prevent the click from firing
      btn.style.opacity = '0.4';
      // Create floating ghost
      dragGhost = btn.cloneNode(true);
      dragGhost.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;padding:6px 12px;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);font-size:0.78rem;display:flex;align-items:center;gap:8px;opacity:0.9;color:var(--text-primary);white-space:nowrap;';
      dragGhost.style.left = (e.clientX - 40) + 'px';
      dragGhost.style.top = (e.clientY - 14) + 'px';
      document.body.appendChild(dragGhost);
      // Suppress click after drag
      btn.addEventListener('click', suppressClick, { capture: true, once: true });
    }, 400);
  }

  function suppressClick(e) { e.stopPropagation(); e.preventDefault(); }

  function onPointerMove(e) {
    if (holdTimer && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (!dragGhost) return;
    dragGhost.style.left = (e.clientX - 40) + 'px';
    dragGhost.style.top = (e.clientY - 14) + 'px';
    // Highlight browse bar when hovering over it
    const bar = document.getElementById('browse-bar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        bar.style.outline = '2px solid var(--accent)';
        bar.style.outlineOffset = '-2px';
      } else {
        bar.style.outline = '';
        bar.style.outlineOffset = '';
      }
    }
  }

  function onPointerUp(e) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; return; }
    if (!dragGhost || !dragId) return;
    const bar = document.getElementById('browse-bar');
    let dropped = false;
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        dropped = true;
      }
      bar.style.outline = '';
      bar.style.outlineOffset = '';
    }
    dragGhost.remove();
    dragGhost = null;
    if (dragBtn) dragBtn.style.opacity = '';
    if (dropped) {
      removeFromBarOverflow(dragId);
      // Close the menu
      dd.style.display = 'none';
    }
    dragId = null;
    dragBtn = null;
  }

  dd.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  // Clean up when menu hides
  const obs = new MutationObserver(() => {
    if (dd.style.display === 'none') {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
      obs.disconnect();
    }
  });
  obs.observe(dd, { attributes: true, attributeFilter: ['style'] });
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

function browseEnableNoteMode() {
  // Close the menu
  const dd = document.getElementById('browse-more-menu');
  if (dd) dd.style.display = 'none';

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank || !tab.url) return;

  // Already a paper tab — just show sidebar
  if (tab.contentType) {
    togglePaperSidebar();
    return;
  }

  // Convert current iframe tab into a paper tab with reader view
  const isArxiv = /arxiv\.org\/(abs|pdf)\//.test(tab.url);
  const arxivId = isArxiv ? (tab.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/) || [])[1] || '' : '';
  tab.paper = {
    title: tab.title || _browseTitleFromUrl(tab.url),
    link: tab.url,
    description: '',
    authors: '',
    categories: [],
    source: isArxiv ? 'arxiv' : 'browse',
    arxivId: arxivId
  };
  tab.contentType = arxivId ? 'pdf' : 'reader';
  tab.arxivId = arxivId || null;

  // Replace iframe with a container div
  if (tab.el) tab.el.remove();
  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-paper-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow:hidden;';
  container.appendChild(el);
  tab.el = el;

  // Re-select to trigger paper rendering
  browseSelectTab(tab.id);
  _browseSaveTabs();
}

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

// ── Browse URL Bar History Dropdown ──

let _browseUrlHistIdx = -1;
let _browseUrlOriginalInput = '';
let _suggestDebounce = null;
let _suggestAbort = null;
let _suggestCache = {};
let _currentSuggestions = [];

function _browseUrlKeydown(e) {
  const dd = document.getElementById('browse-url-history-dd');
  const visible = dd && dd.style.display !== 'none';

  if (e.key === 'Enter') {
    if (visible && _browseUrlHistIdx >= 0) {
      e.preventDefault();
      const items = dd.querySelectorAll('[data-histq]');
      if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        _browseUrlHideHistory();
        if (q.startsWith('project:')) {
          openExperimentDetail(q.slice(8));
        } else {
          document.getElementById('browse-url-input').value = q;
          browseNavigate(q);
        }
      }
    } else {
      _browseUrlHideHistory();
      browseNavigate(document.getElementById('browse-url-input').value);
    }
    return;
  }
  if (!visible) return;
  const items = dd.querySelectorAll('[data-histq]');
  const input = document.getElementById('browse-url-input');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_browseUrlHistIdx === -1) _browseUrlOriginalInput = input ? input.value : '';
    _browseUrlHistIdx = Math.min(_browseUrlHistIdx + 1, items.length - 1);
    _browseUrlHighlight(items);
    if (input && _browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
      const q = items[_browseUrlHistIdx].dataset.histq;
      input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q;
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _browseUrlHistIdx = Math.max(_browseUrlHistIdx - 1, -1);
    _browseUrlHighlight(items);
    if (input) {
      if (_browseUrlHistIdx === -1) {
        input.value = _browseUrlOriginalInput;
      } else if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q;
      }
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _browseUrlHideHistory();
  }
}

function _browseUrlHighlight(items) {
  items.forEach((el, i) => {
    if (i === _browseUrlHistIdx) {
      el.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)';
      el.style.borderRadius = '6px';
    } else {
      el.style.background = 'none';
      el.style.borderRadius = '';
    }
  });
  if (_browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
    items[_browseUrlHistIdx].scrollIntoView({ block: 'nearest' });
  }
}

function _browseUrlShowHistory() {
  const input = document.getElementById('browse-url-input');
  const dd = document.getElementById('browse-url-history-dd');
  if (!input || !dd) return;
  const filter = (input.value || '').trim().toLowerCase();

  // /history command — show browsing history in the dropdown
  if (filter === '/history') {
    _browseUrlRenderHistoryCommand(dd, input);
    return;
  }

  // Search history matches
  const hist = _getWebSearchHistory();
  const filteredHist = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
  let showHist = filteredHist.slice(0, 8);
  if (showHist.length === 1 && showHist[0].q.toLowerCase() === filter) showHist = [];

  // Project matches (only when there's a filter)
  const projects = (filter && typeof allExperiments !== 'undefined') ?
    allExperiments.filter(exp => exp.title.toLowerCase().includes(filter) || (exp.desc || '').toLowerCase().includes(filter)).slice(0, 5) : [];

  // Kick off suggestion fetch (debounced)
  if (filter && filter.length >= 2) {
    _fetchSearchSuggestions(filter);
  } else {
    _currentSuggestions = [];
    if (_suggestDebounce) { clearTimeout(_suggestDebounce); _suggestDebounce = null; }
  }

  _browseUrlRenderDropdown(dd, input, projects, showHist, filter);
}

function _browseUrlRenderHistoryCommand(dd, input) {
  const hist = _getBrowseHistory().slice(0, 20);
  _browseUrlHistIdx = -1;
  _browseUrlOriginalInput = '/history';

  const rect = input.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.width = rect.width + 'px';

  if (!hist.length) {
    dd.innerHTML = '<div style="padding:12px;font-size:0.8rem;color:var(--text-dim);text-align:center;">No browsing history</div>';
    dd.style.display = '';
    return;
  }

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);transition:background 0.1s;';
  const hoverOn = "this.style.background='var(--bg-hover)'";
  const hoverOff = "if(this.dataset.idx!=window._browseUrlHistIdx)this.style.background='none'";

  let html = '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Recent Sites</div>';
  html += hist.map((h, i) => {
    const favicon = _browseFaviconUrl(h.url);
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const safeUrl = escapeHtml(h.url).replace(/"/g, '&quot;');
    const time = _relativeTime(h.ts);
    return `<div data-idx="${i}" data-histq="${safeUrl}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${escapeHtml(h.url).replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${escapeHtml(h.url).replace(/'/g, "\\'")}');">
      <img src="${escapeHtml(favicon)}" style="width:14px;height:14px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</span>
      <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(domain)}</span>
      <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(time)}</span>
    </div>`;
  }).join('');

  dd.innerHTML = html;
  dd.style.display = '';
}

function _browseUrlRenderDropdown(dd, input, projects, showHist, filter) {
  const suggestions = filter ? _currentSuggestions.filter(s => s.toLowerCase() !== filter) : [];

  if (!showHist.length && !projects.length && !suggestions.length) { dd.style.display = 'none'; return; }

  _browseUrlHistIdx = -1;
  const rect = input.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.width = rect.width + 'px';

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);transition:background 0.1s;';
  const hoverOn = "this.style.background='var(--bg-hover)'";
  const hoverOff = "this.style.background='none'";

  let html = '';

  // Suggestions section (AI autocomplete)
  if (suggestions.length) {
    html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Suggestions</div>';
    html += suggestions.map(s => {
      const safeS = escapeHtml(s);
      return `<div data-histq="${safeS.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${safeS.replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${safeS.replace(/'/g, "\\'")}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeS}</span>
      </div>`;
    }).join('');
  }

  // Projects section
  if (projects.length) {
    if (suggestions.length) html += '<div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>';
    html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Projects</div>';
    html += projects.map(exp => {
      const safeId = escapeHtml(exp.id);
      const updated = exp.lastUpdated ? _relativeTime(exp.lastUpdated) : '';
      return `<div data-histq="project:${safeId}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); _browseUrlHideHistory(); openExperimentDetail('${safeId}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(exp.title)}</span>
        ${updated ? `<span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(updated)}</span>` : ''}
      </div>`;
    }).join('');
  }

  // Search history section
  if (showHist.length) {
    if (projects.length || suggestions.length) {
      html += '<div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>';
      html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Recent Searches</div>';
    }
    html += showHist.map(h => {
      const time = _relativeTime(h.ts);
      const safeQ = escapeHtml(h.q);
      return `<div data-histq="${safeQ.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${safeQ.replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${safeQ.replace(/'/g, "\\'")}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeQ}</span>
        <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(time)}</span>
      </div>`;
    }).join('');
  }

  dd.innerHTML = html;
  dd.style.display = '';
}

function _fetchSearchSuggestions(query) {
  // Check cache
  if (_suggestCache[query]) {
    _currentSuggestions = _suggestCache[query];
    return;
  }
  // Debounce: wait 300ms after last keystroke
  if (_suggestDebounce) clearTimeout(_suggestDebounce);
  _suggestDebounce = setTimeout(async () => {
    if (_suggestAbort) _suggestAbort.abort();
    const controller = new AbortController();
    _suggestAbort = controller;
    try {
      const resp = await fetch('/api/search-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const suggestions = data.suggestions || [];
      _suggestCache[query] = suggestions;
      _currentSuggestions = suggestions;
      // Re-render dropdown if input still matches
      const input = document.getElementById('browse-url-input');
      if (input && input.value.trim().toLowerCase() === query) {
        _browseUrlShowHistory();
      }
    } catch (e) {
      if (e.name !== 'AbortError') _currentSuggestions = [];
    }
  }, 300);
}

function _browseUrlHideHistory() {
  const dd = document.getElementById('browse-url-history-dd');
  if (dd) dd.style.display = 'none';
  _browseUrlHistIdx = -1;
}

// ── Web Search History ──

function _getWebSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('webSearchHistory') || '[]');
    return raw.map(h => typeof h === 'string' ? { q: h, ts: 0 } : h);
  } catch { return []; }
}

function _saveWebSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  let hist = _getWebSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now() });
  if (hist.length > 200) hist = hist.slice(0, 200);
  localStorage.setItem('webSearchHistory', JSON.stringify(hist));
}

function _removeWebSearch(index) {
  const hist = _getWebSearchHistory();
  hist.splice(index, 1);
  localStorage.setItem('webSearchHistory', JSON.stringify(hist));
}

function _clearWebSearchHistory() {
  localStorage.setItem('webSearchHistory', '[]');
}

function openSearchHistoryPage() {
  // Open as a blank-style tab in browse view
  if (typeof openBrowse === 'function') openBrowse();
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  // Mark it as a history tab
  tab.blank = false;
  tab.url = '';
  tab.title = 'History';
  tab.favicon = '';
  tab._historyPage = true;

  // Remove existing iframe/content
  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-history-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);';
  container.appendChild(el);
  tab.el = el;

  // Hide new tab page
  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  // Update URL bar
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = '/history';

  _renderWebSearchHistoryPage(el);
}

let _historyPageTab = 'browse'; // 'browse' or 'search'

function _renderWebSearchHistoryPage(el) {
  if (!el) return;
  const searchHist = _getWebSearchHistory();
  const browseHist = _getBrowseHistory();
  const isBrowse = _historyPageTab === 'browse';

  let html = '<div style="max-width:680px;margin:0 auto;padding:32px 24px 64px;">';

  // Header with tabs
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<svg style="width:20px;height:20px;color:var(--text-dimmer);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>';
  html += '<span style="font-size:1.1rem;font-weight:600;color:var(--text-primary);">History</span>';
  html += '</div>';
  const clearFn = isBrowse
    ? '_clearBrowseHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));'
    : '_clearWebSearchHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));';
  const activeHist = isBrowse ? browseHist : searchHist;
  if (activeHist.length) {
    html += '<button onclick="' + clearFn + '" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-muted);font-size:0.75rem;cursor:pointer;">Clear all</button>';
  }
  html += '</div>';

  // Tab switcher
  const tabStyle = (active) => `padding:6px 14px;border:none;border-bottom:2px solid ${active ? 'var(--accent)' : 'transparent'};background:none;color:${active ? 'var(--text-primary)' : 'var(--text-dim)'};font-size:0.82rem;cursor:pointer;font-weight:${active ? '600' : '400'};`;
  html += '<div style="display:flex;gap:0;border-bottom:1px solid var(--border-input);margin-bottom:16px;">';
  html += `<button onclick="_historyPageTab='browse';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(isBrowse)}">Sites <span style="font-size:0.7rem;color:var(--text-dimmest);">${browseHist.length}</span></button>`;
  html += `<button onclick="_historyPageTab='search';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(!isBrowse)}">Searches <span style="font-size:0.7rem;color:var(--text-dimmest);">${searchHist.length}</span></button>`;
  html += '</div>';

  // Filter
  html += '<div style="position:relative;margin-bottom:16px;">';
  html += '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-dimmer);pointer-events:none;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>';
  html += '<input type="text" id="history-page-filter" placeholder="Filter history..." oninput="_filterWebSearchHistory()" style="width:100%;padding:7px 12px 7px 32px;border-radius:8px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.82rem;outline:none;" />';
  html += '</div>';

  html += '<div id="history-page-list">';
  html += isBrowse ? _renderBrowseHistoryList(browseHist) : _renderWebSearchHistoryList(searchHist);
  html += '</div></div>';
  el.innerHTML = html;
}

function _filterWebSearchHistory() {
  const filter = (document.getElementById('history-page-filter')?.value || '').trim().toLowerCase();
  const list = document.getElementById('history-page-list');
  if (!list) return;
  if (_historyPageTab === 'browse') {
    const hist = _getBrowseHistory();
    const filtered = filter ? hist.filter(h => (h.title || '').toLowerCase().includes(filter) || (h.url || '').toLowerCase().includes(filter)) : hist;
    list.innerHTML = _renderBrowseHistoryList(filtered);
  } else {
    const hist = _getWebSearchHistory();
    const filtered = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
    list.innerHTML = _renderWebSearchHistoryList(filtered);
  }
}

function _renderWebSearchHistoryList(hist) {
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--text-dim);font-size:0.85rem;">No searches found</div>';

  // Group by date
  const groups = [];
  const groupMap = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  // Need original indices for deletion
  const allHist = _getWebSearchHistory();

  hist.forEach(h => {
    let label;
    if (!h.ts) { label = 'Older'; }
    else if (h.ts >= today) { label = 'Today'; }
    else if (h.ts >= yesterday) { label = 'Yesterday'; }
    else if (h.ts >= weekAgo) { label = 'This Week'; }
    else {
      const d = new Date(h.ts);
      label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(h);
  });

  let html = '';
  for (const label of groups) {
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:0.7rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.q === h.q && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      const safeQ = escapeHtml(h.q).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--bg-hover)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNavigate('${safeQ}')">
        <svg style="width:14px;height:14px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
        <span style="font-size:0.82rem;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.q)}</span>
        <span style="font-size:0.7rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeWebSearch(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--text-dimmer);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
          <svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

function _renderBrowseHistoryList(hist) {
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--text-dim);font-size:0.85rem;">No browsing history</div>';

  const groups = [];
  const groupMap = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  const allHist = _getBrowseHistory();

  hist.forEach(h => {
    let label;
    if (!h.ts) { label = 'Older'; }
    else if (h.ts >= today) { label = 'Today'; }
    else if (h.ts >= yesterday) { label = 'Yesterday'; }
    else if (h.ts >= weekAgo) { label = 'This Week'; }
    else {
      const d = new Date(h.ts);
      label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(h);
  });

  let html = '';
  for (const label of groups) {
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:0.7rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.url === h.url && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      let domain = '';
      try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
      const favicon = _browseFaviconUrl(h.url);
      const safeUrl = escapeHtml(h.url).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--bg-hover)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNavigate('${safeUrl}')">
        <img src="${escapeHtml(favicon)}" style="width:16px;height:16px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
        <div style="flex:1;overflow:hidden;min-width:0;">
          <div style="font-size:0.82rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</div>
          <div style="font-size:0.7rem;color:var(--text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(domain)}</div>
        </div>
        <span style="font-size:0.7rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeBrowseVisit(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--text-dimmer);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
          <svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

// ── Browsing History ──

function _getBrowseHistory() {
  try { return JSON.parse(localStorage.getItem('browseHistory') || '[]'); } catch { return []; }
}

function _saveBrowseVisit(url, title) {
  if (!url || url === 'about:blank') return;
  let hist = _getBrowseHistory();
  // Don't duplicate the same URL if it's the most recent entry
  if (hist.length && hist[0].url === url) {
    hist[0].title = title || hist[0].title;
    hist[0].ts = Date.now();
  } else {
    hist.unshift({ url, title: title || _browseTitleFromUrl(url), ts: Date.now() });
  }
  if (hist.length > 1000) hist = hist.slice(0, 1000);
  localStorage.setItem('browseHistory', JSON.stringify(hist));
}

function _removeBrowseVisit(index) {
  const hist = _getBrowseHistory();
  hist.splice(index, 1);
  localStorage.setItem('browseHistory', JSON.stringify(hist));
}

function _clearBrowseHistory() {
  localStorage.setItem('browseHistory', '[]');
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

// Listen for browse commands from Electron main process (for Cmd+T and Cmd+W)
if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onBrowseCommand) {
  window.electronAPI.onBrowseCommand((event, command) => {
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    
    if (command === 'new-tab') {
      browseNewTab();
    } else if (command === 'close-tab') {
      const win = _getCurrentWindow();
      if (win && win.activeTab) {
        browseCloseTab(win.activeTab);
      }
    } else if (command === 'reopen-tab') {
      browseReopenTab();
    }
  });
}

