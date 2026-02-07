// ── Auto-refresh timer ──
let _refreshTimer = null;
let _refreshSecondsLeft = 300;
let _previousPostLinks = new Set();
let _renderedLinks = new Set();

function startRefreshTimer() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshSecondsLeft = 300;
  renderRefreshCountdown();
  _refreshTimer = setInterval(() => {
    _refreshSecondsLeft--;
    renderRefreshCountdown();
    if (_refreshSecondsLeft <= 0) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
      loadAllFeeds();
    }
  }, 1000);
}

function renderRefreshCountdown() {
  const el = document.getElementById('refresh-countdown');
  if (!el) return;
  const m = Math.floor(_refreshSecondsLeft / 60);
  const s = _refreshSecondsLeft % 60;
  el.textContent = m + ':' + String(s).padStart(2, '0');
}

// ── Reading List (localStorage) ──
setTimeout(updateSavedBadge, 0);
function updateSavedBadge() {
  const saved = getSavedPosts();
  const unread = Object.values(saved).filter(e => !e.read).length;
  const badge = document.getElementById('saved-badge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Feed Notifications ──
function _getSeenPostLinks() {
  try { return new Set(JSON.parse(localStorage.getItem('seenPostLinks') || '[]')); } catch { return new Set(); }
}
function _setSeenPostLinks(set) {
  localStorage.setItem('seenPostLinks', JSON.stringify([...set]));
}
function _getFeedNotifications() {
  try { return JSON.parse(localStorage.getItem('feedNotifications') || '[]'); } catch { return []; }
}
function _setFeedNotifications(arr) {
  localStorage.setItem('feedNotifications', JSON.stringify(arr));
}

function _getFeedNotifSources() {
  try { return JSON.parse(localStorage.getItem('feedNotifSources') || '{}'); } catch { return {}; }
}

function _detectNewPosts() {
  const seen = _getSeenPostLinks();
  const isFirstRun = seen.size === 0;
  const notifications = isFirstRun ? [] : _getFeedNotifications();

  if (!isFirstRun) {
    const notifSources = _getFeedNotifSources();
    const hasNotifConfig = Object.keys(notifSources).length > 0;
    const existingLinks = new Set(notifications.map(n => n.link));
    for (const p of allPapers) {
      if (p.source === 'quote') continue;
      // Skip sources with notifications disabled (if config exists)
      if (hasNotifConfig && notifSources[p.source] === false) continue;
      if (!seen.has(p.link) && !existingLinks.has(p.link)) {
        notifications.push({
          title: p.title,
          link: p.link,
          source: p.source,
          date: p.date || '',
          seenAt: Date.now()
        });
      }
    }
    // Cap at 50 most recent
    if (notifications.length > 50) notifications.splice(0, notifications.length - 50);
    _setFeedNotifications(notifications);
  }

  // Mark all current links as seen
  const updatedSeen = new Set(seen);
  for (const p of allPapers) {
    if (p.link) updatedSeen.add(p.link);
  }
  _setSeenPostLinks(updatedSeen);
  _updateInboxBadgeWithFeed();
}

function _updateInboxBadgeWithFeed() {
  const feedCount = _getFeedNotifications().length;
  const badge = document.getElementById('inbox-badge');
  if (!badge) return;
  const serverCount = parseInt(badge.dataset.serverCount || '0', 10);
  const total = serverCount + feedCount;
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function clearFeedNotification(link) {
  const notifications = _getFeedNotifications().filter(n => n.link !== link);
  _setFeedNotifications(notifications);
  _updateInboxBadgeWithFeed();
}

function clearAllFeedNotifications() {
  _setFeedNotifications([]);
  _updateInboxBadgeWithFeed();
}

function getHiddenPosts() {
  try { return JSON.parse(localStorage.getItem('hiddenPosts') || '[]'); } catch { return []; }
}
function getReadPosts() {
  try { return JSON.parse(localStorage.getItem('readPosts') || '[]'); } catch { return []; }
}
function markPostAsRead(link) {
  const read = getReadPosts();
  if (!read.includes(link)) { read.push(link); localStorage.setItem('readPosts', JSON.stringify(read)); }
  _embedPost(link);
}

function _embedPost(link) {
  const paper = allPapers.find(p => p.link === link) || (getSavedPosts()[link] || {}).paper;
  if (!paper) return;
  fetch('/api/embed-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: paper.title, link: paper.link, source: paper.source || '', description: paper.description || '', type: 'post' })
  }).catch(() => {});
}
function openCardMenu(btn, ev, index) {
  ev.stopPropagation();
  ev.preventDefault();
  closeCardMenu();
  const p = lastFilteredPapers[index];
  if (!p) return;
  const sourceKey = p.source;
  const sourceName = SOURCE_NAMES[p.source] || p.source;

  const menu = document.createElement('div');
  menu.id = 'card-menu-portal';
  menu.className = 'card-menu';
  const isQuote = p.source === 'quote' && p._quoteId;
  menu.innerHTML = isQuote ? `
    <button onmousedown="event.stopPropagation(); deleteUserQuote('${escapeAttr(p._quoteId)}'); closeCardMenu()">Delete quote</button>
  ` : `
    <button onmousedown="event.stopPropagation(); findSimilarPosts(${index}); closeCardMenu()">Find similar</button>
    <button onmousedown="event.stopPropagation(); hidePost('${escapeAttr(p.link)}', '${escapeAttr(p.title)}'); closeCardMenu()">Block post</button>
    <button onmousedown="event.stopPropagation(); unsubscribeSource('${escapeAttr(sourceKey)}'); closeCardMenu()">Unsubscribe from ${escapeHtml(sourceName)}</button>
  `;
  document.body.appendChild(menu);

  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  let left = rect.right - menu.offsetWidth;
  if (left < 8) left = 8;
  menu.style.left = left + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', _cardMenuOutsideClick);
    window.addEventListener('scroll', closeCardMenu, true);
  }, 0);
}

function _cardMenuOutsideClick(e) {
  const menu = document.getElementById('card-menu-portal');
  if (menu && !menu.contains(e.target)) closeCardMenu();
}

function closeCardMenu() {
  const menu = document.getElementById('card-menu-portal');
  if (menu) menu.remove();
  document.removeEventListener('mousedown', _cardMenuOutsideClick);
  window.removeEventListener('scroll', closeCardMenu, true);
}

function hidePost(link, title, event) {
  if (event) event.stopPropagation();
  const hidden = getHiddenPosts();
  if (!hidden.includes(link)) hidden.push(link);
  localStorage.setItem('hiddenPosts', JSON.stringify(hidden));
  if (title) addTestTitle(title);
  renderPapers();
}
function getTestTitles() {
  try { return JSON.parse(localStorage.getItem('qualityTestTitles') || '[]'); } catch { return []; }
}
async function fetchTestTitlesFromServer() {
  try {
    const resp = await fetch('/api/blocked-titles');
    if (resp.ok) {
      const titles = await resp.json();
      localStorage.setItem('qualityTestTitles', JSON.stringify(titles));
      return titles;
    }
  } catch {}
  return getTestTitles();
}
function addTestTitle(title) {
  const titles = getTestTitles();
  if (!titles.includes(title)) { titles.push(title); localStorage.setItem('qualityTestTitles', JSON.stringify(titles)); }
  fetch('/api/blocked-titles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  }).catch(() => {});
}
function isPostHidden(link) { return getHiddenPosts().includes(link); }

// ── User Quotes ──
function _getUserQuotes() {
  try { return JSON.parse(localStorage.getItem('userQuotes') || '[]'); } catch { return []; }
}
function deleteUserQuote(id) {
  const quotes = _getUserQuotes().filter(q => q.id !== id);
  localStorage.setItem('userQuotes', JSON.stringify(quotes));
  allPapers = allPapers.filter(p => p._quoteId !== id);
  renderPapers();
}

// ── Semantic Search / Find Similar ──
async function findSimilarPosts(index) {
  const p = lastFilteredPapers[index];
  if (!p) return;
  openResearch('search');
  const container = document.getElementById('search-feed-results');
  if (container) container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Finding similar posts...</div></div>';
  const hints = document.getElementById('search-hints');
  if (hints) hints.style.display = 'none';
  const arxiv = document.getElementById('search-arxiv-results');
  if (arxiv) arxiv.innerHTML = '';
  const input = document.getElementById('search-query');
  if (input) input.value = '';
  try {
    const resp = await fetch('/api/find-similar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: p.title, link: p.link, description: p.description || '', limit: 20 })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _renderSemanticResults(container, data.results || [], `Similar to "${p.title}"`);
  } catch (err) {
    if (container) container.innerHTML = `<div class="text-center py-8 text-dim text-[0.9rem]">${err.message === 'HTTP 503' ? 'Embedding model not available. Run: <code>ollama pull nomic-embed-text</code>' : 'Search failed: ' + escapeHtml(err.message)}</div>`;
  }
}

function _renderSemanticResults(container, results, heading) {
  if (!container) return;
  if (!results.length) {
    container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]">No similar posts found. Read more posts to build the semantic index.</div>';
    return;
  }
  container.innerHTML = `<div class="mb-2 text-[0.75rem] text-dimmer uppercase tracking-wide">${escapeHtml(heading)} (${results.length})</div>` +
    results.map(r => {
      const sourceChip = getSourceChip(r.source);
      const scorePct = Math.round(r.score * 100);
      const scoreColor = scorePct >= 80 ? 'text-green-400' : scorePct >= 60 ? 'text-yellow-400' : 'text-dimmer';
      return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openPaperByUrl('${escapeAttr(r.link)}', event)">
        ${sourceChip}
        <span class="text-[0.82rem] text-primary truncate">${escapeHtml(r.title)}</span>
        <span class="text-[0.68rem] ${scoreColor} shrink-0 ml-auto">${scorePct}%</span>
      </div>`;
    }).join('');
}

// ── Blocked Words ──
function getBlockedWords() {
  try { return JSON.parse(localStorage.getItem('blockedWords') || '[]'); } catch { return []; }
}
function setBlockedWords(words) {
  localStorage.setItem('blockedWords', JSON.stringify(words));
}
function addBlockedWord() {
  const input = document.getElementById('blocked-word-input');
  if (!input) return;
  const raw = input.value.trim().toLowerCase();
  if (!raw) return;
  const newWords = raw.split(/,\s*/).map(w => w.trim()).filter(Boolean);
  const words = getBlockedWords();
  let changed = false;
  for (const w of newWords) {
    if (!words.includes(w)) { words.push(w); changed = true; }
  }
  if (changed) {
    setBlockedWords(words);
    renderBlockedWordsList();
    renderPapers();
  }
  input.value = '';
}
function removeBlockedWord(word) {
  const words = getBlockedWords().filter(w => w !== word);
  setBlockedWords(words);
  renderBlockedWordsList();
  renderPapers();
}
function renderBlockedWordsList() {
  const el = document.getElementById('blocked-words-list');
  if (!el) return;
  const words = getBlockedWords();
  if (!words.length) {
    el.innerHTML = '<span class="text-dimmer text-[0.75rem]">No blocked words yet.</span>';
    return;
  }
  el.innerHTML = words.map(w =>
    `<span class="inline-flex items-center gap-1 bg-input border border-border-input rounded-full px-2.5 py-0.5 text-primary text-[0.78rem]">${escapeHtml(w)}<button onclick="removeBlockedWord('${escapeHtml(w.replace(/'/g, "\\'"))}')" class="text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-sm leading-none ml-0.5">&times;</button></span>`
  ).join('');
}

// ── Offline caching ──

function getOfflineCachedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('offlineCached') || '[]')); } catch { return new Set(); }
}

function isPostCached(link) {
  return getOfflineCachedSet().has(link);
}

async function cachePostOffline(link, paper, btnEl) {
  if (isPostCached(link)) return;
  if (btnEl) {
    btnEl.innerHTML = '<span class="text-dimmer text-[0.7rem]">Caching…</span>';
    btnEl.disabled = true;
  }
  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ url: link })
    });
    if (!resp.ok) throw new Error('extract failed');
    const { text } = await resp.json();
    if (!text || text.length < 50) throw new Error('no content');
    await fetch('/api/saved-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ url: link, title: paper?.title || '', text, savedAt: Date.now() })
    });
    const cached = getOfflineCachedSet();
    cached.add(link);
    localStorage.setItem('offlineCached', JSON.stringify([...cached]));
    if (btnEl) { btnEl.innerHTML = _offlineCachedIcon(); btnEl.classList.add('cached'); }
  } catch (e) {
    console.error('cachePostOffline error', e);
    if (btnEl) {
      btnEl.innerHTML = _offlineDownloadIcon();
      btnEl.disabled = false;
    }
  }
}

function _offlineDownloadIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-dimmer"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
}

function _offlineCachedIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
}

function getSavedPosts() {
  try { return JSON.parse(localStorage.getItem('savedPosts') || '{}'); } catch { return {}; }
}
function savePosts(data) { localStorage.setItem('savedPosts', JSON.stringify(data)); }
function isPostSaved(link) { return !!getSavedPosts()[link]; }


function toggleSavePost(paper, event) {
  if (event) event.stopPropagation();
  const saved = getSavedPosts();
  const wasAdding = !saved[paper.link];
  if (saved[paper.link]) {
    delete saved[paper.link];
  } else {
    saved[paper.link] = { paper, savedAt: Date.now(), read: false };
    if (typeof petReact === 'function') petReact('happy');
  }
  savePosts(saved);
  updateSavedBadge();
  renderPapers();
  if (wasAdding) {
    _embedPost(paper.link);
    if (event) _showBookmarkToast(event);
  }
}

function _showBookmarkToast(event) {
  // Flying bookmark icon from click position to dashboard sidebar icon
  const target = document.getElementById('sb-dashboard');
  if (target) {
    const icon = document.createElement('div');
    icon.innerHTML = '<svg style="width:24px;height:24px" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>';
    icon.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;transition:all 0.5s cubic-bezier(0.4,0,0.2,1);';
    const startX = event.clientX - 12;
    const startY = event.clientY - 12;
    icon.style.left = startX + 'px';
    icon.style.top = startY + 'px';
    icon.style.opacity = '1';
    document.body.appendChild(icon);
    const tr = target.getBoundingClientRect();
    requestAnimationFrame(() => {
      icon.style.left = (tr.left + tr.width / 2 - 8) + 'px';
      icon.style.top = (tr.top + tr.height / 2 - 8) + 'px';
      icon.style.opacity = '0';
      icon.style.transform = 'scale(0.3)';
    });
    setTimeout(() => icon.remove(), 550);
  }
  // Toast pill
  let toast = document.getElementById('bookmark-toast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'bookmark-toast';
  toast.textContent = 'Added to Reading List';
  toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-card);font-size:0.78rem;padding:6px 16px;border-radius:8px;z-index:9999;opacity:0;transition:opacity 0.25s,transform 0.25s;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,0.2);';
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

function markPostRead(link) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  saved[link].read = true;
  savePosts(saved);
  updateSavedBadge();
}

function openSaved() {
  openDashboard();
}

function renderSavedPosts() {
  // Reading list is now part of the dashboard — no-op
}

function toggleSavePostByLink(link) {
  const saved = getSavedPosts();
  if (saved[link]) {
    delete saved[link];
    savePosts(saved);
    updateSavedBadge();
    renderSavedPosts();
    renderPapers();
  }
}

function openSavedPaper(link, e) {
  if (_isNewTabClick(e)) { _openInNewTab(link); return; }
  markPostRead(link);
  openBrowse(link);
}

// ── arXiv Feed (loads on startup) ──
let allPapers = [];
let allCategories = new Set();
let citationMap = {};
let currentSort = 'foryou';
const PAGE_SIZE = 20;
let visibleCount = PAGE_SIZE;
let hiddenSourceFilters = new Set();
let feedViewMode = 'block'; // 'block', 'verbose', 'twitter', or 'compact'
const _viewModes = ['block', 'verbose', 'twitter', 'compact'];
const _viewModeIcons = {
  block: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
  verbose: '<path d="M4 5h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4z"/>',
  twitter: '<path d="M22.46 6c-.77.35-1.6.58-2.46.69a4.3 4.3 0 001.88-2.38 8.59 8.59 0 01-2.72 1.04A4.28 4.28 0 0015.86 4c-2.37 0-4.29 1.92-4.29 4.29 0 .34.04.67.1.98C8.28 9.09 5.11 7.38 3 4.79a4.28 4.28 0 001.33 5.72A4.26 4.26 0 012.8 10v.05a4.29 4.29 0 003.44 4.2 4.27 4.27 0 01-1.93.07 4.29 4.29 0 004 2.98A8.6 8.6 0 012 19.54a12.13 12.13 0 006.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0024 6.56a8.49 8.49 0 01-2.54.7z"/>',
  compact: '<path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>',
};

function toggleViewMode() {
  const idx = _viewModes.indexOf(feedViewMode);
  feedViewMode = _viewModes[(idx + 1) % _viewModes.length];
  const icon = document.getElementById('view-mode-icon');
  if (icon) icon.innerHTML = _viewModeIcons[feedViewMode];
  renderPapers();
}

function toggleSourceBubble(key) {
  if (hiddenSourceFilters.has(key)) hiddenSourceFilters.delete(key);
  else hiddenSourceFilters.add(key);
  renderSourceBubbles();
  renderPapers();
}

function unsubscribeSource(key) {
  // Check catalog sources
  const sources = getFeedSources();
  if (key in sources) {
    sources[key] = false;
    localStorage.setItem('feedSources', JSON.stringify(sources));
  }
  // Check custom feeds
  const custom = getCustomFeeds();
  const idx = custom.findIndex(f => f.url === key || f.name === key);
  if (idx !== -1) {
    custom[idx].enabled = false;
    localStorage.setItem('customFeeds', JSON.stringify(custom));
  }
  // Remove posts from this source and re-render
  allPapers = allPapers.filter(p => p.source !== key);
  renderSourceBubbles();
  renderPapers();
}

function renderSourceBubbles() {
  const el = document.getElementById('source-bubbles');
  if (!el) return;
  const sourceCounts = {};
  for (const p of allPapers) {
    sourceCounts[p.source] = (sourceCounts[p.source] || 0) + 1;
  }
  const sources = Object.keys(sourceCounts);
  const catSelect = document.getElementById('category');
  const currentCat = catSelect ? catSelect.value : '';

  el.innerHTML = sources.map(key => {
    const entry = FEED_CATALOG.find(f => f.key === key);
    const name = entry ? entry.name : (key.startsWith('custom:') ? key.slice(7) : key);
    const logo = SOURCE_LOGO_INLINE[key] || '';
    const count = sourceCounts[key];
    const dimmed = hiddenSourceFilters.has(key);
    const baseClass = `inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15'} text-[0.78rem] cursor-pointer transition-all duration-150 whitespace-nowrap select-none`;

    if (key === 'arxiv' && catSelect) {
      const opts = Array.from(catSelect.options);
      const selectOpts = opts.map(o => {
        const label = o.value ? o.textContent : `arXiv (${count})`;
        return `<option value="${escapeHtml(o.value)}"${o.value === currentCat ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      return `<span class="inline-flex items-center rounded-full border ${dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15'} text-[0.78rem] transition-all duration-150 whitespace-nowrap select-none">
        <span class="inline-flex items-center pl-2.5 pointer-events-none">${logo}</span>
        <select class="arxiv-cat-select bg-transparent border-none text-[0.78rem] ${dimmed ? 'text-dim' : 'text-primary'} cursor-pointer outline-none appearance-none py-1 pl-1 pr-5" onchange="document.getElementById('category').value=this.value; renderPapers(); renderSourceBubbles(); _fitArxivSelect(this)">${selectOpts}</select>
      </span>`;
    }

    return `<span class="${baseClass}" onclick="toggleSourceBubble('${escapeHtml(key)}')">${logo}<span class="${dimmed ? 'text-dim' : 'text-primary'}">${escapeHtml(name)}</span><span class="text-[0.68rem] ${dimmed ? 'text-dimmer' : 'text-dim'}">${count}</span></span>`;
  }).join('');

  // Auto-size the arxiv select after rendering
  const arxivSel = el.querySelector('.arxiv-cat-select');
  if (arxivSel) _fitArxivSelect(arxivSel);
}

function _fitArxivSelect(sel) {
  const span = document.createElement('span');
  span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:0.78rem;';
  span.textContent = sel.options[sel.selectedIndex].text;
  document.body.appendChild(span);
  sel.style.width = (span.offsetWidth + 24) + 'px'; // 24px for chevron padding
  document.body.removeChild(span);
}

function setSortMode(mode) {
  currentSort = mode;
  const citBtn = document.getElementById('sort-citations');
  if (citBtn) citBtn.classList.toggle('active', mode === 'citations');
  const fyBtn = document.getElementById('sort-foryou');
  if (fyBtn) fyBtn.classList.toggle('active', mode === 'foryou');
  visibleCount = PAGE_SIZE;
  renderPapers();
}

async function fetchFeed() {
  try {
    const resp = await fetch('/feed');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return parseFeed(await resp.text());
  } catch (err) {
    document.getElementById('papers').innerHTML =
      `<div class="text-center py-20 text-red-400"><p>Failed to load feed: ${err.message}</p>
       <p class="mt-2 text-[0.85rem] text-muted">Try refreshing or check your connection.</p></div>`;
    return [];
  }
}

async function fetchHNFeed() {
  try {
    const resp = await fetch('/hn-feed');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const stories = await resp.json();
    return stories.map(s => {
      const url = s.url || `https://news.ycombinator.com/item?id=${s.id}`;
      const ts = s.time ? new Date(s.time * 1000) : null;
      const dateStr = ts ? formatDate(ts) : '';
      const pubDate = ts ? ts.toUTCString() : '';
      return {
        source: 'hn',
        title: s.title || '',
        link: url,
        authors: s.by || '',
        categories: [],
        description: '',
        date: dateStr,
        pubDate,
        arxivId: null,
        hnScore: s.score || 0,
        hnComments: s.descendants || 0,
        hnId: s.id
      };
    });
  } catch (e) {
    return [];
  }
}

async function fetchPolymarketFeed() {
  try {
    const resp = await fetch('/polymarket-feed');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const markets = await resp.json();
    if (markets.error) return [];
    return markets.map(m => {
      const sign = m.changePct >= 0 ? '+' : '';
      return {
        source: 'polymarket',
        title: m.question,
        link: m.url,
        authors: '',
        categories: ['Prediction Markets'],
        description: `${m.yesPct}% Yes · ${sign}${m.changePct}% today · $${m.volume.toLocaleString()} volume`,
        date: 'live',
        pubDate: new Date().toUTCString(),
        arxivId: null,
        polyYesPct: m.yesPct,
        polyChangePct: m.changePct,
        polyVolume: m.volume,
        polyImage: m.image,
        polySlug: m.slug
      };
    });
  } catch (e) {
    return [];
  }
}

const FEED_SOURCE_DEFAULTS = {};
FEED_CATALOG.forEach(f => { FEED_SOURCE_DEFAULTS[f.key] = false; });

function hasOnboarded() { return localStorage.getItem('feedSources') !== null; }

const onboardSelected = new Set();
const onboardNotifSelected = new Set();

/* === Honeycomb globals === */
let _hcPanX = 0, _hcPanY = 0;
let _hcDragging = false, _hcDragStartX = 0, _hcDragStartY = 0, _hcPanStartX = 0, _hcPanStartY = 0;
let _hcDidDrag = false;
let _hcCircleEls = [];
let _hcPositions = []; // {x, y, key}
let _hcRafId = 0;
let _hcMouseX = 0, _hcMouseY = 0;
let _hcListenersAttached = false;
let _hcActiveCategory = null; // null = All
let _hcHoveredIdx = -1;
let _hcZoom = 1;

function _honeycombCircleContent(entry) {
  if (entry.favicon) {
    return `<img src="https://www.google.com/s2/favicons?domain=${entry.favicon}&sz=64" alt="${entry.name}" onerror="this.outerHTML='<span class=\\'hc-letter\\' style=\\'color:${entry.fg || '#fff'}\\'>${entry.letter || entry.name[0]}</span>'">`;
  }
  if (entry.img) {
    return `<img src="${entry.img}" alt="${entry.name}">`;
  }
  return `<span class="hc-letter" style="color:${entry.fg || '#fff'}">${entry.letter || entry.name[0]}</span>`;
}

function _renderHcCategoryTabs() {
  const container = document.getElementById('hc-category-tabs');
  if (!container) return;
  const cats = [];
  FEED_CATALOG.forEach(f => { if (!cats.includes(f.cat)) cats.push(f.cat); });
  let html = `<button class="hc-tab${_hcActiveCategory === null ? ' active' : ''}" onclick="_hcSelectCategory(null)">All</button>`;
  cats.forEach(cat => {
    html += `<button class="hc-tab${_hcActiveCategory === cat ? ' active' : ''}" onclick="_hcSelectCategory('${cat.replace(/'/g, "\\'")}')">${cat}</button>`;
  });
  container.innerHTML = html;
}

function _hcSelectCategory(cat) {
  _hcActiveCategory = cat;
  _renderHcCategoryTabs();
  renderOnboardGrid();
  _updateOnboardCardStates();
}

function renderOnboardGrid() {
  const grid = document.getElementById('onboard-grid');
  const entries = _hcActiveCategory
    ? FEED_CATALOG.filter(f => f.cat === _hcActiveCategory)
    : FEED_CATALOG;

  // Group by category
  const byCategory = {};
  entries.forEach(f => {
    if (!byCategory[f.cat]) byCategory[f.cat] = [];
    byCategory[f.cat].push(f);
  });

  let html = '';
  for (const cat of Object.keys(byCategory)) {
    const items = byCategory[cat];
    const allOn = items.every(f => onboardSelected.has(f.key));
    html += `<div class="mb-4">
      <div class="flex items-center gap-2 mb-1.5 px-1">
        <span class="text-[0.72rem] text-dim uppercase tracking-wider font-medium">${escapeHtml(cat)}</span>
        <span class="flex-1 h-px bg-border-subtle"></span>
        <button class="text-[0.68rem] text-dimmer hover:text-primary cursor-pointer bg-transparent border-none transition-colors" onclick="_toggleOnboardCategory('${cat.replace(/'/g, "\\'")}')">
          ${allOn ? 'Deselect all' : 'Select all'}
        </button>
      </div>`;
    for (const f of items) {
      const sel = onboardSelected.has(f.key);
      const icon = f.favicon
        ? `<img src="https://www.google.com/s2/favicons?domain=${f.favicon}&sz=32" class="w-5 h-5 rounded" onerror="this.outerHTML='<span class=\\'inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold\\' style=\\'background:${f.bg || '#333'};color:${f.fg || '#fff'}\\'>${f.letter || f.name[0]}</span>'">`
        : `<span class="inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold" style="background:${f.bg || '#333'};color:${f.fg || '#fff'}">${f.letter || f.name[0]}</span>`;
      html += `<div class="onboard-source flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors hover:bg-hover${sel ? ' onboard-selected' : ''}" data-source="${f.key}" onclick="toggleOnboardSource('${f.key}')">
        ${icon}
        <div class="flex-1 min-w-0">
          <div class="text-[0.82rem] font-medium ${sel ? 'text-primary' : 'text-muted'} truncate">${escapeHtml(f.name)}</div>
          <div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(f.desc)}</div>
        </div>
        <div class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${sel ? 'border-accent bg-accent' : 'border-border-input bg-transparent'}">
          ${sel ? '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  grid.innerHTML = html;
}

function _hcApplyTransform() {
  const grid = document.getElementById('onboard-grid');
  if (grid) grid.style.transform = `translate(${_hcPanX}px, ${_hcPanY}px) scale(${_hcZoom})`;
}

function _centerHoneycomb() {
  const vp = document.getElementById('honeycomb-viewport');
  const grid = document.getElementById('onboard-grid');
  if (!vp || !grid) return;
  _hcZoom = 1;
  const vpW = vp.clientWidth;
  const vpH = vp.clientHeight;
  const gW = parseFloat(grid.style.width);
  const gH = parseFloat(grid.style.height);
  _hcPanX = (vpW - gW) / 2;
  _hcPanY = (vpH - gH) / 2;
  _hcApplyTransform();
}

function _attachHoneycombListeners() {
  const vp = document.getElementById('honeycomb-viewport');
  if (!vp) return;

  vp.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    _hcDragging = true;
    _hcDidDrag = false;
    _hcDragStartX = e.clientX;
    _hcDragStartY = e.clientY;
    _hcPanStartX = _hcPanX;
    _hcPanStartY = _hcPanY;
    vp.classList.add('grabbing');
  });

  window.addEventListener('mousemove', (e) => {
    const vpRect = document.getElementById('honeycomb-viewport')?.getBoundingClientRect();
    if (vpRect) {
      _hcMouseX = e.clientX - vpRect.left;
      _hcMouseY = e.clientY - vpRect.top;
    }
    if (_hcDragging) {
      const dx = e.clientX - _hcDragStartX;
      const dy = e.clientY - _hcDragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _hcDidDrag = true;
      _hcPanX = _hcPanStartX + dx;
      _hcPanY = _hcPanStartY + dy;
      _hcApplyTransform();
    }
    if (!_hcRafId && document.getElementById('honeycomb-viewport')) {
      _hcRafId = requestAnimationFrame(_applyFisheye);
    }
  });

  window.addEventListener('mouseup', () => {
    if (_hcDragging) {
      _hcDragging = false;
      const vpEl = document.getElementById('honeycomb-viewport');
      if (vpEl) vpEl.classList.remove('grabbing');
    }
  });

  vp.addEventListener('mouseleave', () => {
    if (_hcHoveredIdx >= 0 && _hcHoveredIdx < _hcCircleEls.length) {
      _hcCircleEls[_hcHoveredIdx].style.transform = 'scale(1)';
      _hcCircleEls[_hcHoveredIdx].style.zIndex = '';
      _hcCircleEls[_hcHoveredIdx].classList.remove('hc-hovered');
    }
    _hcHoveredIdx = -1;
  });

  // Touch support
  let _touchId = null;
  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    _touchId = t.identifier;
    _hcDragging = true;
    _hcDidDrag = false;
    _hcDragStartX = t.clientX;
    _hcDragStartY = t.clientY;
    _hcPanStartX = _hcPanX;
    _hcPanStartY = _hcPanY;
  }, { passive: true });

  vp.addEventListener('touchmove', (e) => {
    const t = Array.from(e.touches).find(t => t.identifier === _touchId);
    if (!t) return;
    const dx = t.clientX - _hcDragStartX;
    const dy = t.clientY - _hcDragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _hcDidDrag = true;
    _hcPanX = _hcPanStartX + dx;
    _hcPanY = _hcPanStartY + dy;
    _hcApplyTransform();
  }, { passive: true });

  vp.addEventListener('touchend', () => {
    _hcDragging = false;
    _touchId = null;
  }, { passive: true });

  // Scroll to zoom
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const vpRect = vp.getBoundingClientRect();
    const mx = e.clientX - vpRect.left;
    const my = e.clientY - vpRect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(3, Math.max(0.3, _hcZoom * delta));
    // Zoom toward cursor
    _hcPanX = mx - (mx - _hcPanX) * (newZoom / _hcZoom);
    _hcPanY = my - (my - _hcPanY) * (newZoom / _hcZoom);
    _hcZoom = newZoom;
    _hcApplyTransform();
  }, { passive: false });
}

function _applyFisheye() {
  _hcRafId = 0;
  // Convert viewport mouse coords to grid coords (accounting for zoom)
  const gx = (_hcMouseX - _hcPanX) / _hcZoom;
  const gy = (_hcMouseY - _hcPanY) / _hcZoom;
  const hitRadius = 28; // half of circle size + small margin

  // Find closest circle to cursor
  let closestIdx = -1, closestDist = Infinity;
  for (let i = 0; i < _hcPositions.length; i++) {
    const dx = gx - _hcPositions[i].x;
    const dy = gy - _hcPositions[i].y;
    const d = dx * dx + dy * dy;
    if (d < closestDist) { closestDist = d; closestIdx = i; }
  }
  closestDist = Math.sqrt(closestDist);
  const hovIdx = closestDist < hitRadius ? closestIdx : -1;

  // Update hovered class + tooltip
  if (hovIdx !== _hcHoveredIdx) {
    if (_hcHoveredIdx >= 0 && _hcHoveredIdx < _hcCircleEls.length) {
      _hcCircleEls[_hcHoveredIdx].classList.remove('hc-hovered');
      _hcCircleEls[_hcHoveredIdx].style.transform = 'scale(1)';
      _hcCircleEls[_hcHoveredIdx].style.zIndex = '';
    }
    _hcHoveredIdx = hovIdx;
    if (_hcHoveredIdx >= 0) {
      _hcCircleEls[_hcHoveredIdx].classList.add('hc-hovered');
      _hcCircleEls[_hcHoveredIdx].style.transform = 'scale(1.35)';
      _hcCircleEls[_hcHoveredIdx].style.zIndex = '50';
    }
  }
}

function toggleOnboardSource(key) {
  if (onboardSelected.has(key)) {
    onboardSelected.delete(key);
    onboardNotifSelected.delete(key);
  } else {
    onboardSelected.add(key);
  }
  renderOnboardGrid();
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

function _toggleOnboardCategory(cat) {
  const items = FEED_CATALOG.filter(f => f.cat === cat);
  const allOn = items.every(f => onboardSelected.has(f.key));
  items.forEach(f => {
    if (allOn) { onboardSelected.delete(f.key); onboardNotifSelected.delete(f.key); }
    else onboardSelected.add(f.key);
  });
  renderOnboardGrid();
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

function toggleOnboardNotif(key) {
  if (!onboardSelected.has(key)) return;
  if (onboardNotifSelected.has(key)) onboardNotifSelected.delete(key);
  else onboardNotifSelected.add(key);
}

function _updateOnboardCardStates() {
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

function showOnboarding() {
  onboardSelected.clear();
  onboardNotifSelected.clear();
  if (hasOnboarded()) {
    const sources = getFeedSources();
    const notifSources = _getFeedNotifSources();
    FEED_CATALOG.forEach(f => {
      if (sources[f.key]) {
        onboardSelected.add(f.key);
        if (notifSources[f.key] !== false) onboardNotifSelected.add(f.key);
      }
    });
  } else {
    FEED_CATALOG.forEach(f => {
      onboardSelected.add(f.key);
    });
  }
  _hcActiveCategory = null;
  _renderHcCategoryTabs();
  renderOnboardGrid();
  _updateOnboardCardStates();
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
  document.getElementById('onboard-view').style.display = '';
  document.getElementById('home-feed-section').style.display = 'none';
  renderCustomFeedsList();
}

function completeOnboarding() {
  const sources = {};
  const notifSources = {};
  FEED_CATALOG.forEach(f => {
    sources[f.key] = onboardSelected.has(f.key);
    notifSources[f.key] = onboardNotifSelected.has(f.key);
  });
  localStorage.setItem('feedSources', JSON.stringify(sources));
  localStorage.setItem('feedNotifSources', JSON.stringify(notifSources));
  document.getElementById('onboard-view').style.display = 'none';
  document.getElementById('home-feed-section').style.display = '';
  loadAllFeeds();
}

function getFeedSources() {
  try { return { ...FEED_SOURCE_DEFAULTS, ...JSON.parse(localStorage.getItem('feedSources')) }; }
  catch { return { ...FEED_SOURCE_DEFAULTS }; }
}

function getCustomFeeds() {
  try { return JSON.parse(localStorage.getItem('customFeeds')) || []; }
  catch { return []; }
}

function renderCustomFeedsList() {
  const list = document.getElementById('custom-feeds-list');
  if (!list) return;
  const feeds = getCustomFeeds();
  if (!feeds.length) { list.innerHTML = '<div class="text-dim text-[0.78rem]">No custom feeds added.</div>'; return; }
  list.innerHTML = feeds.map((f, i) => `
    <div class="flex items-center justify-between gap-2 bg-input rounded-md px-3 py-2">
      <span class="text-primary text-[0.78rem] truncate flex-1" title="${escapeHtml(f.url)}">${escapeHtml(f.name || f.url)}</span>
      <div class="flex items-center gap-2 shrink-0">
        <span class="toggle-switch">
          <input type="checkbox" ${f.enabled !== false ? 'checked' : ''} onchange="toggleCustomFeed(${i}, this.checked)">
          <span class="slider"></span>
        </span>
        <button onclick="removeCustomFeed(${i})" class="text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-base leading-none" title="Remove">&times;</button>
      </div>
    </div>
  `).join('');
}

async function addCustomFeed() {
  const input = document.getElementById('custom-feed-url');
  let url = input.value.trim();
  if (!url) return;
  // Auto-detect Substack: convert blog URL to RSS feed URL
  if (/^https?:\/\/[\w-]+\.substack\.com\/?$/.test(url)) {
    url = url.replace(/\/?$/, '/feed');
  }
  const feeds = getCustomFeeds();
  if (feeds.some(f => f.url === url)) return;
  // Try to fetch the feed title
  let name = url;
  try { name = new URL(url).hostname.replace(/^www\./, '').replace(/^api\./, ''); } catch {}
  try {
    const resp = await fetch(`/api/rss-proxy?url=${encodeURIComponent(url)}`);
    if (resp.ok) {
      const xml = await resp.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const feedTitle = (doc.querySelector('channel > title, feed > title')?.textContent || '').trim();
      if (feedTitle) name = feedTitle;
    }
  } catch {}
  feeds.push({ url, name, enabled: true });
  localStorage.setItem('customFeeds', JSON.stringify(feeds));
  input.value = '';
  renderCustomFeedsList();
  allPapers = [];
  loadAllFeeds();
}

function removeCustomFeed(index) {
  const feeds = getCustomFeeds();
  feeds.splice(index, 1);
  localStorage.setItem('customFeeds', JSON.stringify(feeds));
  renderCustomFeedsList();
  allPapers = [];
  loadAllFeeds();
}

function toggleCustomFeed(index, enabled) {
  const feeds = getCustomFeeds();
  feeds[index].enabled = enabled;
  localStorage.setItem('customFeeds', JSON.stringify(feeds));
  allPapers = [];
  loadAllFeeds();
}


// ── Quality Filter Panel (feed page) ──

function toggleQualityPanel() {
  const panel = document.getElementById('quality-filter-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') {
    _closeQualityPanel();
  } else {
    const btn = document.getElementById('quality-filter-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.left = Math.max(8, r.right - 256) + 'px';
    }
    panel.style.display = '';
    btn?.classList.add('border-accent', 'text-accent');
    renderQualityPanel();
    _updateQfProgress();
    setTimeout(() => document.addEventListener('click', _qualityPanelOutsideClick), 0);
  }
}
function _closeQualityPanel() {
  const panel = document.getElementById('quality-filter-panel');
  if (panel) panel.style.display = 'none';
  document.getElementById('quality-filter-btn')?.classList.remove('border-accent', 'text-accent');
  document.removeEventListener('click', _qualityPanelOutsideClick);
}
function _qualityPanelOutsideClick(e) {
  const panel = document.getElementById('quality-filter-panel');
  const btn = document.getElementById('quality-filter-btn');
  if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
    _closeQualityPanel();
  }
}

function renderQualityPanel() {
  const panel = document.getElementById('quality-filter-panel');
  if (!panel) return;
  const cache = getQualityCache();
  const cacheEntries = Object.entries(cache);
  const keptCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'skip').length;

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-2.5">
      <div class="flex items-center gap-2">
        <span class="text-primary text-[0.78rem] font-medium">Quality Filter</span>
        <span class="text-dimmer text-[0.62rem]">qwen3:8b</span>
        <span id="qf-progress"></span>
      </div>
      <label class="flex items-center gap-1.5 cursor-pointer">
        <span class="text-dim text-[0.7rem]">${isQualityFilterOn() ? 'On' : 'Off'}</span>
        <span class="toggle-switch" style="transform:scale(0.8)">
          <input type="checkbox" ${isQualityFilterOn() ? 'checked' : ''} onchange="setQualityFilter(this.checked); renderQualityPanel()">
          <span class="slider"></span>
        </span>
      </label>
    </div>
    <div class="text-[0.7rem] text-dim space-y-1 mb-2.5">
      <div class="flex justify-between"><span>Threshold</span><span class="text-primary">${getQualityThreshold()}%</span></div>
      <div class="flex justify-between"><span>Kept</span><span class="text-green-400/80">${keptCount}</span></div>
      <div class="flex justify-between"><span>Skipped</span><span class="text-red-400/80">${skippedCount}</span></div>
    </div>
    ${getQualityPrompt() !== DEFAULT_QUALITY_PROMPT ? '<div class="text-[0.65rem] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5 mb-2.5 inline-block">Custom prompt</div>' : ''}
    <a href="#quality" onclick="toggleQualityPanel()" class="flex items-center justify-center gap-1.5 text-[0.72rem] text-accent hover:text-accent-hover cursor-pointer w-full py-1.5 rounded-md border border-border-input hover:border-accent transition-colors" style="text-decoration:none">
      Manage filters
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93s.844.083 1.178-.188l.702-.585a1.132 1.132 0 011.536.07l.774.773c.44.44.48 1.137.07 1.536l-.585.702c-.271.334-.322.773-.188 1.178.134.396.506.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.424.07-.764.383-.93.78-.135.404-.083.843.188 1.177l.585.703c.41.399.37 1.096-.07 1.536l-.774.773a1.132 1.132 0 01-1.536.07l-.702-.584c-.334-.272-.773-.323-1.178-.188-.396.133-.71.505-.78.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.404-.134-.843-.082-1.177.188l-.703.585a1.132 1.132 0 01-1.536-.07l-.773-.774a1.132 1.132 0 01-.07-1.536l.584-.702c.272-.334.322-.773.188-1.178-.133-.396-.506-.71-.929-.78l-.894-.149c-.542-.09-.94-.56-.94-1.11v-1.094c0-.55.398-1.02.94-1.11l.894-.148c.423-.071.764-.384.929-.781.135-.404.083-.843-.188-1.177l-.585-.703a1.132 1.132 0 01.07-1.536l.774-.773a1.132 1.132 0 011.536-.07l.702.584c.334.272.773.322 1.178.188.396-.133.71-.505.78-.929l.149-.894zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
    </a>
    <a href="#algorithm" onclick="toggleQualityPanel()" class="flex items-center justify-center gap-1.5 text-[0.65rem] text-dimmer hover:text-dim cursor-pointer w-full py-1 transition-colors mt-1" style="text-decoration:none">
      How the algorithm works
    </a>
  `;
}

// ── Quality Filter Dedicated View ──

async function openQualityView() {
  hideAllViews();
  const view = await ensureView('quality-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'quality';
  setSidebarActive('sb-home');
  renderQualityView();
}

async function openAlgorithmView() {
  hideAllViews();
  const view = await ensureView('algorithm-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'algorithm';
  setSidebarActive('sb-home');
  renderAlgorithmView();
}

function renderAlgorithmView() {
  const container = document.getElementById('algorithm-view-content');
  if (!container) return;

  const profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  const affinity = typeof getSourceAffinity === 'function' ? getSourceAffinity() : {};
  const readCount = getReadPosts().length;
  const savedCount = Object.keys(getSavedPosts()).length;
  const hiddenCount = getHiddenPosts().length;
  const topTopics = profile?.topTopics || [];
  const topCats = profile?.topCategories || [];

  const wBase = parseFloat(localStorage.getItem('fyWeightBase') || '0.7');
  const wAff = parseFloat(localStorage.getItem('fyWeightAffinity') || '0.3');
  const wRec = parseFloat(localStorage.getItem('fyWeightRecency') || '1.0');
  const maxRun = parseInt(localStorage.getItem('maxPerCategoryRun') || '3', 10);

  // Example scores for illustration
  const exampleLlm = 72;
  const exampleAff = 0.8;
  const exampleAge = 3;
  const exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  const exampleScore = (exampleLlm * (wBase + exampleAff * wAff) + exampleRecency).toFixed(1);

  container.innerHTML = `
    <a href="#quality" class="text-dim text-[0.72rem] hover:text-primary transition-colors inline-flex items-center gap-1 mb-4" style="text-decoration:none">
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
      Back to Quality Filter
    </a>
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-1">How the Algorithm Works</h2>
    <p class="text-dim text-[0.8rem] mb-6">Your feed is ranked using a personalized composite score that combines LLM relevance scoring, source affinity from your reading habits, and recency.</p>

    <div class="mb-6">
      <h3 class="text-muted text-[0.85rem] font-medium mb-2">1. LLM Relevance Score</h3>
      <p class="text-dim text-[0.78rem] leading-relaxed mb-2">Every post that passes the verdict filter (KEEP/SKIP) is scored 0\u2013100 by a local LLM (qwen3:8b). The scoring prompt asks the model to rate how interesting and relevant the post title is.</p>
      <p class="text-dim text-[0.78rem] leading-relaxed">When you have an interest profile, your top topics and categories are appended to the scoring prompt, so the LLM boosts scores for content matching your interests while still scoring objectively.</p>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.85rem] font-medium mb-2">2. Interest Profile</h3>
      <p class="text-dim text-[0.78rem] leading-relaxed mb-3">Built automatically from your reading behavior. Recomputed every 5 minutes.</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.75rem] space-y-2 mb-3">
        <div class="flex justify-between"><span class="text-dim">Posts read</span><span class="text-primary font-mono">${readCount}</span></div>
        <div class="flex justify-between"><span class="text-dim">Posts saved</span><span class="text-primary font-mono">${savedCount}</span></div>
        <div class="flex justify-between"><span class="text-dim">Posts hidden</span><span class="text-primary font-mono">${hiddenCount}</span></div>
      </div>
      <div class="space-y-2 text-[0.75rem]">
        <div>
          <span class="text-dimmer text-[0.68rem]">Signal weights for topic extraction:</span>
          <div class="text-dim mt-1">Read = <span class="text-primary">1x</span> &middot; Saved = <span class="text-primary">3x</span> &middot; Rated = <span class="text-primary">rating value</span> &middot; Hidden = negative signal</div>
        </div>
        <div>
          <span class="text-dimmer text-[0.68rem]">Your top topics:</span>
          <div class="flex flex-wrap gap-1 mt-1">${topTopics.length ? topTopics.map(t => `<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">${escapeHtml(t)}</span>`).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>'}</div>
        </div>
        <div>
          <span class="text-dimmer text-[0.68rem]">Your top categories:</span>
          <div class="flex flex-wrap gap-1 mt-1">${topCats.length ? topCats.map(c => `<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">${escapeHtml(c)}</span>`).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>'}</div>
        </div>
      </div>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.85rem] font-medium mb-2">3. Source Affinity</h3>
      <p class="text-dim text-[0.78rem] leading-relaxed mb-3">Each feed source gets an affinity score (0.1\u20131.0) based on how often you engage with its posts. Sources you read, save, and rate highly get boosted. Sources you frequently hide get penalized.</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] font-mono mb-3">
        <div class="text-dim mb-1">engagement = (read + saved\u00d72 + rated\u00d73) / total</div>
        <div class="text-dim mb-1">penalty = (hidden / total) \u00d7 0.5</div>
        <div class="text-primary">affinity = clamp(engagement \u2212 penalty, 0.1, 1.0)</div>
        <div class="text-dimmer text-[0.65rem] mt-1">Sources with &lt;3 posts default to 0.5</div>
      </div>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.85rem] font-medium mb-2">4. Composite Score</h3>
      <p class="text-dim text-[0.78rem] leading-relaxed mb-3">When you use the "For You" sort, each post is ranked by a composite score combining all signals:</p>
      <div class="bg-input border border-border-input rounded-lg p-3 text-[0.78rem] font-mono mb-3">
        <div class="text-accent">score = LLM \u00d7 (base + affinity \u00d7 aff_weight) + recency_boost \u00d7 rec_weight</div>
      </div>
      <div class="space-y-1.5 text-[0.75rem] text-dim mb-4">
        <div><span class="text-dimmer">LLM:</span> Quality score from local model (0\u2013100)</div>
        <div><span class="text-dimmer">base:</span> Baseline multiplier \u2014 how much the LLM score matters on its own</div>
        <div><span class="text-dimmer">affinity \u00d7 aff_weight:</span> Bonus for sources you engage with often</div>
        <div><span class="text-dimmer">recency_boost:</span> max(0, 10 \u2212 age_hours \u00d7 0.5) \u2014 decays over 20h, max +10</div>
        <div><span class="text-dimmer">rec_weight:</span> How much recency matters relative to quality</div>
      </div>

      <div class="bg-input border border-border-input rounded-lg p-3 mb-4">
        <div class="text-dimmer text-[0.68rem] mb-2">Example: LLM=${exampleLlm}, affinity=${exampleAff}, age=${exampleAge}h</div>
        <div class="text-[0.75rem] font-mono text-dim">${exampleLlm} \u00d7 (${wBase.toFixed(2)} + ${exampleAff} \u00d7 ${wAff.toFixed(2)}) + ${exampleRecency.toFixed(1)} = <span class="text-accent font-semibold">${exampleScore}</span></div>
      </div>

      <div class="text-dimmer text-[0.68rem] mb-2">Current weights</div>
      <div class="space-y-2">
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Base</span>
          <input type="range" min="0" max="100" value="${Math.round(wBase * 100)}" oninput="document.getElementById('algo-base-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightBase',(this.value/100).toFixed(2));renderPapers();renderAlgorithmView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-base-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wBase.toFixed(2)}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Affinity</span>
          <input type="range" min="0" max="100" value="${Math.round(wAff * 100)}" oninput="document.getElementById('algo-aff-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightAffinity',(this.value/100).toFixed(2));renderPapers();renderAlgorithmView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-aff-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wAff.toFixed(2)}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-dim text-[0.72rem] w-16 shrink-0">Recency</span>
          <input type="range" min="0" max="200" value="${Math.round(wRec * 100)}" oninput="document.getElementById('algo-rec-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightRecency',(this.value/100).toFixed(2));renderPapers();renderAlgorithmView()" class="flex-1 accent-[var(--accent)]" />
          <span id="algo-rec-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${wRec.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.85rem] font-medium mb-2">5. Category Diversity</h3>
      <p class="text-dim text-[0.78rem] leading-relaxed mb-3">After scoring, posts are reordered to prevent any single category from dominating a run. If more than <span class="text-primary">${maxRun}</span> consecutive posts come from the same category, a post from a different category is pulled forward.</p>
      <div class="flex items-center gap-3">
        <span class="text-dim text-[0.72rem] shrink-0">Max same-category run</span>
        <input type="range" min="1" max="10" value="${maxRun}" oninput="document.getElementById('algo-div-val').textContent=this.value" onchange="localStorage.setItem('maxPerCategoryRun',this.value);renderPapers();renderAlgorithmView()" class="flex-1 accent-[var(--accent)]" />
        <span id="algo-div-val" class="text-dim text-[0.68rem] tabular-nums w-4 text-right">${maxRun}</span>
      </div>
    </div>

    <div class="pt-5 border-t border-border-subtle flex items-center gap-3">
      <button onclick="resetPersonalization();renderAlgorithmView()" class="text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all personalization</button>
      <span class="text-dimmer text-[0.68rem]">Clears your interest profile, resets all weights to defaults</span>
    </div>
  `;
}

function _toggleBlockedPostsList() {
  const list = document.getElementById('quality-blocked-list');
  const chevron = document.getElementById('blocked-posts-chevron');
  if (!list) return;
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  if (chevron) chevron.style.transform = hidden ? 'rotate(0deg)' : 'rotate(-90deg)';
  if (hidden) renderBlockedList();
}

function _editVerdictPrompt() {
  document.getElementById('verdict-prompt-readonly').style.display = 'none';
  document.getElementById('verdict-prompt-actions').style.display = 'none';
  const ta = document.getElementById('quality-prompt-input');
  ta.style.display = '';
  ta.focus();
  document.getElementById('verdict-prompt-edit-actions').style.display = 'flex';
}

function _cancelEditVerdictPrompt() {
  document.getElementById('quality-prompt-input').style.display = 'none';
  document.getElementById('verdict-prompt-edit-actions').style.display = 'none';
  document.getElementById('verdict-prompt-readonly').style.display = '';
  document.getElementById('verdict-prompt-actions').style.display = 'flex';
  document.getElementById('quality-prompt-input').value = getQualityPrompt();
}

function renderQualityView() {
  const container = document.getElementById('quality-view-content');
  if (!container) return;
  const cache = getQualityCache();
  const cacheEntries = Object.entries(cache);
  const keptCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'skip').length;

  container.innerHTML = `
    <div class="flex items-center gap-3 mb-1">
      <h2 class="text-[1.3rem] font-semibold text-white_">Quality Filter</h2>
      <span class="text-dimmer text-[0.68rem]">qwen3:8b</span>
      <label class="flex items-center gap-2 cursor-pointer ml-auto">
        <span class="text-primary text-sm">Enable</span>
        <span class="toggle-switch">
          <input type="checkbox" id="toggle-quality-filter" ${isQualityFilterOn() ? 'checked' : ''} onchange="setQualityFilter(this.checked)">
          <span class="slider"></span>
        </span>
      </label>
    </div>
    <p class="text-dim text-[0.8rem] mb-6">Uses a local LLM (Ollama) to hide low-quality posts. Two phases: verdict (KEEP/SKIP), then scoring.</p>

    <div class="mb-6">
      <div class="flex items-center gap-2 mb-2">
        <h3 class="text-muted text-[0.8rem] font-medium">Verdict Prompt</h3>
        ${getQualityPrompt() !== DEFAULT_QUALITY_PROMPT ? '<span class="text-[0.65rem] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5">Edited</span>' : ''}
      </div>
      <p class="text-dimmer text-[0.72rem] mb-2">Classifies each post title as KEEP or SKIP.</p>
      <div id="verdict-prompt-readonly" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-2 max-h-[200px] overflow-y-auto">${escapeHtml(getQualityPrompt())}</div>
      <textarea id="quality-prompt-input" rows="6" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-primary text-[0.78rem] font-mono leading-relaxed outline-none focus:border-accent resize-y" spellcheck="false" style="display:none">${escapeHtml(getQualityPrompt())}</textarea>
      <div id="verdict-prompt-actions" class="flex items-center gap-2 justify-end">
        <button onclick="_editVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input hover:border-accent rounded-md px-3 py-1 cursor-pointer transition-colors">Edit</button>
        ${getQualityPrompt() !== DEFAULT_QUALITY_PROMPT ? '<button onclick="resetQualityPrompt(); renderQualityView()" class="text-dim text-[0.78rem] hover:text-red-400 bg-transparent border border-border-input hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset</button>' : ''}
      </div>
      <div id="verdict-prompt-edit-actions" class="flex items-center gap-2 justify-end" style="display:none">
        <button onclick="_cancelEditVerdictPrompt()" class="text-dim text-[0.78rem] hover:text-primary bg-transparent border border-border-input rounded-md px-3 py-1 cursor-pointer transition-colors">Cancel</button>
        <button onclick="saveQualityPrompt().then(function(){ renderQualityView(); })" class="bg-accent text-white text-[0.78rem] px-3 py-1 rounded-md border-none cursor-pointer hover:bg-accent-hover">Save</button>
      </div>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.8rem] font-medium mb-2">Scoring Threshold</h3>
      <p class="text-dimmer text-[0.72rem] mb-2">Posts passing the verdict are scored 0\u2013100%. Below threshold = hidden.</p>
      <div id="scoring-prompt-display" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-3">Loading\u2026</div>
      <div class="flex items-center gap-3">
        <input type="range" id="quality-threshold-slider" min="0" max="100" value="${getQualityThreshold()}" oninput="document.getElementById('quality-threshold-value').textContent=this.value+'%'" onchange="setQualityThreshold(parseInt(this.value))" class="flex-1 accent-[var(--accent)]" />
        <span id="quality-threshold-value" class="text-primary text-sm font-mono w-10 text-right">${getQualityThreshold()}%</span>
      </div>
      <p class="text-dimmer text-[0.68rem] mt-1">Minimum score to display (0% = show all kept, 100% = strictest)</p>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <h3 class="text-muted text-[0.8rem] font-medium mb-2">Blocked Words</h3>
      <p class="text-dimmer text-[0.75rem] mb-3">Posts with titles containing any of these words will be automatically hidden.</p>
      <div class="flex gap-2 mb-3">
        <input type="text" id="blocked-word-input" placeholder="e.g. politics, lawsuit, review" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addBlockedWord()}">
        <button onclick="addBlockedWord()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
      <div id="blocked-words-list" class="flex flex-wrap gap-1.5"></div>
    </div>

    <div class="mb-6 pt-5 border-t border-border-subtle">
      <button onclick="_toggleBlockedPostsList()" class="flex items-center gap-2 text-muted text-[0.8rem] font-medium bg-transparent border-none cursor-pointer p-0 hover:text-primary transition-colors">
        <svg id="blocked-posts-chevron" class="w-3.5 h-3.5 transition-transform" style="transform:rotate(-90deg)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        Blocked Posts
      </button>
      <div id="quality-blocked-list" class="text-[0.78rem] text-muted max-h-[300px] overflow-y-auto mt-2" style="display:none"></div>
    </div>

    <div id="personalization-panel-container" class="mb-6 pt-5 border-t border-border-subtle"></div>

    <div class="flex items-center justify-between pt-5 border-t border-border-subtle">
      <div class="text-dim text-[0.78rem]">
        Cached: ${cacheEntries.length} &middot; Kept: ${keptCount} &middot; Skipped: ${skippedCount}
      </div>
      <button onclick="resetEverything()" class="text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all &amp; clear cache</button>
    </div>
  `;

  renderBlockedWordsList();
  _renderPersonalizationPanel();
  fetch('/api/quality-prompt').then(r => r.json()).then(data => {
    if (data.prompt) {
      localStorage.setItem('qualityPrompt', data.prompt);
      const el = document.getElementById('quality-prompt-input');
      if (el) el.value = data.prompt;
    }
    const scoringEl = document.getElementById('scoring-prompt-display');
    if (scoringEl && data.scoringPrompt) scoringEl.textContent = data.scoringPrompt;
  }).catch(() => {});
}

function _renderPersonalizationPanel() {
  const container = document.getElementById('personalization-panel-container');
  if (!container) return;
  const profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  const readCount = getReadPosts().length;

  if (readCount < 10 || !profile) {
    container.innerHTML = `
      <h3 class="text-muted text-[0.8rem] font-medium mb-2">Personalization</h3>
      <p class="text-dimmer text-[0.75rem]">Read more posts to build your profile (${readCount}/10).</p>`;
    return;
  }

  // Topic chips
  const topicChips = (profile.topTopics || []).map(t =>
    `<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">${escapeHtml(t)}</span>`
  ).join('');

  // Category chips
  const catChips = (profile.topCategories || []).map(c =>
    `<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">${escapeHtml(c)}</span>`
  ).join('');

  // Source engagement table
  const affinity = typeof getSourceAffinity === 'function' ? getSourceAffinity() : {};
  const sourceRows = Object.entries(profile.sourceCounts || {})
    .filter(([, c]) => c.total > 0)
    .sort((a, b) => (affinity[b[0]] || 0) - (affinity[a[0]] || 0))
    .map(([src, c]) => {
      const name = SOURCE_NAMES[src] || (src.startsWith('custom:') ? src.slice(7) : src);
      const readPct = c.total > 0 ? Math.round(c.read / c.total * 100) : 0;
      const savedPct = c.total > 0 ? Math.round(c.saved / c.total * 100) : 0;
      const aff = affinity[src] ?? 0.5;
      const barW = Math.round(aff * 100);
      return `<tr class="border-b border-border-subtle last:border-0">
        <td class="py-1 pr-2 text-[0.72rem] text-primary truncate max-w-[120px]">${escapeHtml(name)}</td>
        <td class="py-1 px-2 text-[0.68rem] text-dim text-right tabular-nums">${readPct}%</td>
        <td class="py-1 px-2 text-[0.68rem] text-dim text-right tabular-nums">${savedPct}%</td>
        <td class="py-1 pl-2 w-20"><div class="h-1.5 rounded-full bg-hover overflow-hidden"><div class="h-full rounded-full bg-accent" style="width:${barW}%"></div></div></td>
      </tr>`;
    }).join('');

  const maxRun = parseInt(localStorage.getItem('maxPerCategoryRun') || '3', 10) || 3;

  container.innerHTML = `
    <h3 class="text-muted text-[0.8rem] font-medium mb-3">Personalization</h3>

    <div class="mb-3">
      <span class="text-dimmer text-[0.68rem]">Top Topics</span>
      <div class="flex flex-wrap gap-1 mt-1">${topicChips || '<span class="text-dimmer text-[0.68rem]">None yet</span>'}</div>
    </div>

    <div class="mb-4">
      <span class="text-dimmer text-[0.68rem]">Top Categories</span>
      <div class="flex flex-wrap gap-1 mt-1">${catChips || '<span class="text-dimmer text-[0.68rem]">None yet</span>'}</div>
    </div>

    ${sourceRows ? `
    <div class="mb-4">
      <span class="text-dimmer text-[0.68rem]">Source Engagement</span>
      <div class="max-h-[240px] overflow-y-auto mt-1">
        <table class="w-full text-left">
          <thead><tr class="text-dimmer text-[0.62rem]">
            <th class="pb-1 font-normal">Source</th>
            <th class="pb-1 font-normal text-right pr-2">Read</th>
            <th class="pb-1 font-normal text-right pr-2">Saved</th>
            <th class="pb-1 font-normal pl-2">Affinity</th>
          </tr></thead>
          <tbody>${sourceRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="mb-4">
      <div class="flex items-center gap-3">
        <span class="text-dimmer text-[0.68rem]">Category diversity</span>
        <input type="range" min="1" max="10" value="${maxRun}" oninput="document.getElementById('diversity-val').textContent=this.value" onchange="localStorage.setItem('maxPerCategoryRun',this.value);renderPapers()" class="flex-1 accent-[var(--accent)]" />
        <span id="diversity-val" class="text-dim text-[0.68rem] tabular-nums w-4 text-right">${maxRun}</span>
      </div>
      <p class="text-dimmer text-[0.62rem] mt-0.5">Max posts from same category in a row before mixing in others.</p>
    </div>

    <div class="mb-4">
      <span class="text-dimmer text-[0.68rem]">Composite Score Weights</span>
      <p class="text-dimmer text-[0.62rem] mt-0.5 mb-2">score = LLM × (base + affinity × aff_weight) + recency_boost × recency_weight</p>
      <div class="flex items-center gap-3 mb-1.5">
        <span class="text-dim text-[0.68rem] w-16 shrink-0">Base</span>
        <input type="range" min="0" max="100" value="${Math.round(parseFloat(localStorage.getItem('fyWeightBase') || '0.7') * 100)}" oninput="document.getElementById('fy-base-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightBase',(this.value/100).toFixed(2));renderPapers()" class="flex-1 accent-[var(--accent)]" />
        <span id="fy-base-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${parseFloat(localStorage.getItem('fyWeightBase') || '0.7').toFixed(2)}</span>
      </div>
      <div class="flex items-center gap-3 mb-1.5">
        <span class="text-dim text-[0.68rem] w-16 shrink-0">Affinity</span>
        <input type="range" min="0" max="100" value="${Math.round(parseFloat(localStorage.getItem('fyWeightAffinity') || '0.3') * 100)}" oninput="document.getElementById('fy-aff-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightAffinity',(this.value/100).toFixed(2));renderPapers()" class="flex-1 accent-[var(--accent)]" />
        <span id="fy-aff-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${parseFloat(localStorage.getItem('fyWeightAffinity') || '0.3').toFixed(2)}</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-dim text-[0.68rem] w-16 shrink-0">Recency</span>
        <input type="range" min="0" max="200" value="${Math.round(parseFloat(localStorage.getItem('fyWeightRecency') || '1.0') * 100)}" oninput="document.getElementById('fy-rec-val').textContent=(this.value/100).toFixed(2)" onchange="localStorage.setItem('fyWeightRecency',(this.value/100).toFixed(2));renderPapers()" class="flex-1 accent-[var(--accent)]" />
        <span id="fy-rec-val" class="text-dim text-[0.68rem] tabular-nums w-8 text-right">${parseFloat(localStorage.getItem('fyWeightRecency') || '1.0').toFixed(2)}</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button onclick="resetPersonalization()" class="text-red-400/80 text-[0.72rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-2.5 py-0.5 cursor-pointer transition-colors shrink-0">Reset personalization</button>
    </div>
  `;
}

function toggleFeedSource(key, value) {
  const sources = getFeedSources();
  sources[key] = value;
  localStorage.setItem('feedSources', JSON.stringify(sources));
  allPapers = [];
  loadAllFeeds();
}

async function fetchGenericRSS(feedUrl, sourceName) {
  try {
    const resp = await fetch(`/api/rss-proxy?url=${encodeURIComponent(feedUrl)}`);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = doc.querySelectorAll('item, entry');
    return Array.from(items).map(item => {
      const title = (item.querySelector('title')?.textContent || '').trim();
      const link = item.querySelector('link')?.getAttribute('href')
        || (item.querySelector('link')?.textContent || '').trim();
      const desc = item.querySelector('description, summary, content, content\\:encoded')?.textContent || '';
      const author = item.querySelector('author, dc\\:creator, itunes\\:author')?.textContent?.trim() || '';
      const pubStr = item.querySelector('pubDate, published, updated')?.textContent?.trim() || '';
      const ts = pubStr ? new Date(pubStr) : null;
      const commentsUrl = (item.querySelector('comments')?.textContent || '').trim();
      const cats = Array.from(item.querySelectorAll('category')).map(c => c.textContent.trim());
      return {
        source: sourceName,
        title,
        link,
        authors: author,
        categories: cats,
        description: stripHtml(desc).replace(/^\s*Comments\s*$/i, '').slice(0, 300),
        date: ts ? formatDate(ts) : '',
        pubDate: ts ? ts.toUTCString() : '',
        arxivId: null,
        commentsUrl: commentsUrl || null,
      };
    });
  } catch { return []; }
}

function allSourcesOff() {
  const s = getFeedSources();
  const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
  return !FEED_CATALOG.some(f => s[f.key]) && customFeeds.length === 0;
}

let _feedAbort = null;

async function loadAllFeeds() {
  if (!hasOnboarded() || allSourcesOff()) { showOnboarding(); return; }
  // Abort any in-flight feed load
  if (_feedAbort) _feedAbort.abort();
  const abort = _feedAbort = new AbortController();

  document.getElementById('onboard-view').style.display = 'none';
  document.getElementById('home-feed-section').style.display = '';
  const sources = getFeedSources();
  if (allPapers.length > 0) {
    _previousPostLinks = new Set(allPapers.map(p => p.link));
  }
  allPapers = [];
  _renderedLinks = new Set();

  // Inject user quotes immediately so they show while feeds load
  const userQuotes = _getUserQuotes();
  for (const q of userQuotes) {
    allPapers.push({
      source: 'quote',
      title: q.title || 'Quote',
      link: q.link,
      authors: '',
      categories: [],
      description: q.quote,
      date: formatDate(new Date(q.pubDate)),
      pubDate: q.pubDate,
      arxivId: null,
      _quoteId: q.id,
      _quoteText: q.quote,
    });
  }

  // Show spinner only if we have nothing to show yet
  const container = document.getElementById('papers');
  if (allPapers.length === 0) {
    container.innerHTML = `<div style="column-span:all" class="flex items-center justify-center h-[60vh]"><span class="spinner"></span></div>`;
  }

  // Build list of enabled catalog source keys
  const enabledKeys = FEED_CATALOG.filter(f => sources[f.key]).map(f => f.key);
  const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
  const promises = [];

  // 1) Fetch catalog sources from the central poller DB
  if (enabledKeys.length > 0) {
    promises.push(
      fetch(`/api/feed-items?sources=${enabledKeys.join(',')}&limit=500`, { signal: abort.signal })
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    );
  } else {
    promises.push(Promise.resolve([]));
  }

  // 2) Fetch custom user feeds
  if (customFeeds.length > 0) {
    promises.push(
      fetch('/api/feed-items/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: customFeeds.map(f => ({ url: f.url, name: f.name })) }),
        signal: abort.signal,
      }).then(r => r.ok ? r.json() : []).catch(() => [])
    );
  } else {
    promises.push(Promise.resolve([]));
  }

  try {
    const [catalogItems, customItems] = await Promise.all(promises);
    if (abort.signal.aborted) return;

    const MAX_PER_SOURCE = 100;
    // Group catalog items by source and cap per source
    const bySource = {};
    for (const item of catalogItems) {
      const src = item.source;
      if (!bySource[src]) bySource[src] = [];
      if (bySource[src].length < MAX_PER_SOURCE) bySource[src].push(item);
    }
    for (const items of Object.values(bySource)) {
      allPapers = allPapers.concat(items);
    }

    // Add custom feed items (already capped server-side at 100 per source)
    if (customItems.length) {
      allPapers = allPapers.concat(customItems);
    }

    renderTrends();
    if (typeof computeInterestProfile === 'function') computeInterestProfile();
    renderPapers();
    if (isQualityFilterOn()) qualityFilterPapers();
    _detectNewPosts();
    startRefreshTimer();
  } catch (e) {
    if (abort.signal.aborted) return;
    // Fallback: show error
    container.innerHTML = `<div class="text-center py-20 text-red-400"><p>Failed to load feed: ${e.message}</p>
       <p class="mt-2 text-[0.85rem] text-muted">Try refreshing or check your connection.</p></div>`;
  }
}

function extractArxivId(link) {
  const m = link.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
  return m ? m[1] : null;
}

function parseFeed(xml) {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.error('Feed parsing error:', parserError.textContent);
      return [];
    }

    // Try RSS format first
    let items = Array.from(doc.querySelectorAll('item'));

    // Fall back to Atom format if no RSS items
    if (items.length === 0) {
      items = Array.from(doc.querySelectorAll('entry'));
    }

    const parsedItems = items.map(item => {
      // Extract title
      const title = (item.querySelector('title')?.textContent || '').trim();
      if (!title) return null; // Skip items without titles

      // Extract link (different for RSS vs Atom)
      let link = item.querySelector('link')?.textContent?.trim();
      if (!link) {
        // Try Atom format (link is an attribute)
        const linkEl = item.querySelector('link[href]');
        link = linkEl?.getAttribute('href') || '';
      }

      // Extract description/summary
      const description = (
        item.querySelector('description')?.textContent ||
        item.querySelector('summary')?.textContent ||
        item.querySelector('content')?.textContent ||
        ''
      ).trim();

      // Extract authors (try multiple formats)
      const creators = item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator');
      let authors = Array.from(creators).map(c => c.textContent.trim()).join(', ');
      if (!authors) {
        const authorEls = item.querySelectorAll('author name');
        authors = Array.from(authorEls).map(a => a.textContent.trim()).join(', ');
      }
      if (!authors) {
        authors = extractAuthors(description);
      }

      // Extract categories
      const categories = Array.from(item.querySelectorAll('category'))
        .map(c => c.textContent.trim() || c.getAttribute('term') || '')
        .filter(Boolean);
      categories.forEach(c => allCategories.add(c));

      // Extract date (try multiple formats)
      const pubDate = (
        item.querySelector('pubDate')?.textContent ||
        item.querySelector('published')?.textContent ||
        item.querySelector('updated')?.textContent ||
        ''
      ).trim();
      const dateStr = pubDate ? formatDate(new Date(pubDate)) : '';

      // Extract arXiv ID
      const arxivId = extractArxivId(link);

      // Clean description
      const cleanDesc = stripHtml(description)
        .replace(/^arXiv:\S+\s+Announce Type:\s*\w+\s+Abstract:\s*/i, '')
        .trim();

      return {
        source: 'arxiv',
        title,
        link,
        authors,
        categories,
        description: cleanDesc,
        date: dateStr,
        pubDate,
        arxivId
      };
    }).filter(Boolean); // Remove null entries

    return parsedItems;
  } catch (e) {
    console.error('Error parsing feed:', e);
    return [];
  }
}

async function fetchCitationsFor(papers) {
  const ids = papers.map(p => p.arxivId).filter(Boolean).filter(id => citationMap[id] === undefined);
  if (!ids.length) return;
  try {
    const resp = await fetch('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (resp.ok) {
      const data = await resp.json();
      Object.assign(citationMap, data);
      for (const p of papers) {
        if (p.arxivId && citationMap[p.arxivId] !== undefined) {
          p.citations = citationMap[p.arxivId];
        }
      }
      renderPapers();
    }
  } catch (e) { /* silently fail */ }
}

// ── Trends extraction ──
function extractTopCategories(papers) {
  const freq = {};
  papers.forEach(p => p.categories.forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function renderTrends() {
  const panel = document.getElementById('trends-panel');
  if (!allPapers.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  populateCategories();
  renderSourceBubbles();
}

function extractAuthors(desc) {
  const m = desc.match(/Authors?:\s*(.+?)(?:\.|<br|$)/i);
  return m ? m[1].trim() : '';
}

function populateCategories() {
  const select = document.getElementById('category');
  const current = select.value;
  const freq = {};
  allPapers.forEach(p => p.categories.forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  select.innerHTML = '<option value="">All</option>';
  sorted.forEach(([cat, count]) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `${cat} (${count})`;
    select.appendChild(opt);
  });
  select.value = current;
}

let lastFilteredPapers = [];

function getSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    return raw.map(h => typeof h === 'string' ? { q: h, ts: 0, c: 0 } : h);
  } catch { return []; }
}
function saveSearchHistory(query, resultCount) {
  const q = query.trim();
  if (!q) return;
  let hist = getSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now(), c: resultCount || 0 });
  if (hist.length > 50) hist = hist.slice(0, 50);
  localStorage.setItem('searchHistory', JSON.stringify(hist));
}
function _updateSearchHistoryCount(count) {
  const hist = getSearchHistory();
  if (hist.length) { hist[0].c = count; localStorage.setItem('searchHistory', JSON.stringify(hist)); }
}
function removeSearchHistory(index) {
  const hist = getSearchHistory();
  hist.splice(index, 1);
  localStorage.setItem('searchHistory', JSON.stringify(hist));
  showSearchHistoryView();
}

/**
 * Parse a search query string into structured parts:
 * - "quoted phrases" → exact phrase match (across title+authors+desc)
 * - title:"quoted" or title:word → match in title only
 * - by:name → author filter
 * - source:key → source filter
 * - sort:mode → sort override
 * - bare words → loose token match (across title+authors+desc)
 */
function parseSearchQuery(raw) {
  let authorFilter = null, sourceFilter = null, sortOverride = null;
  const textTokens = [], exactPhrases = [], titleTokens = [], titlePhrases = [];

  // Extract by: — everything after by: is the author name
  const byMatch = raw.match(/\bby:(.+)/);
  if (byMatch) {
    authorFilter = byMatch[1].trim().toLowerCase();
    raw = raw.slice(0, byMatch.index).trim();
  }

  // Extract title:"quoted phrases" first
  let s = raw.replace(/title:"([^"]+)"/g, (_, ph) => { titlePhrases.push(ph.toLowerCase()); return ''; });
  // Extract generic "quoted phrases"
  s = s.replace(/"([^"]+)"/g, (_, ph) => { exactPhrases.push(ph.toLowerCase()); return ''; });

  const tokens = s.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t.startsWith('source:')) sourceFilter = t.slice(7).toLowerCase();
    else if (t.startsWith('sort:')) sortOverride = t.slice(5).toLowerCase();
    else if (t.startsWith('title:')) titleTokens.push(t.slice(6).toLowerCase());
    else textTokens.push(t);
  }
  return { authorFilter, sourceFilter, sortOverride, textTokens, exactPhrases, titleTokens, titlePhrases };
}

function _syncUserQuotesIntoAllPapers() {
  const quotes = _getUserQuotes();
  const existingIds = new Set(allPapers.filter(p => p._quoteId).map(p => p._quoteId));
  // Remove quotes that were deleted
  allPapers = allPapers.filter(p => !p._quoteId || quotes.some(q => q.id === p._quoteId));
  // Add new quotes not yet in allPapers
  for (const q of quotes) {
    if (!existingIds.has(q.id)) {
      allPapers.push({
        source: 'quote',
        title: q.title || 'Quote',
        link: q.link,
        authors: '',
        categories: [],
        description: q.quote,
        date: formatDate(new Date(q.pubDate)),
        pubDate: q.pubDate,
        arxivId: null,
        _quoteId: q.id,
        _quoteText: q.quote,
      });
    }
  }
}

function getFilteredPapers() {
  _syncUserQuotesIntoAllPapers();
  const rawSearch = (document.getElementById('search')?.value || '').toLowerCase();
  const category = document.getElementById('category').value;
  const hidden = new Set(getHiddenPosts());
  const _blockedWordsSet = new Set(getBlockedWords());
  const qfOn = isQualityFilterOn();
  const qCache = qfOn ? getQualityCache() : {};
  const bypass = qfOn ? getQualityBypass() : {};

  // Parse structured search prefixes, quoted phrases, and title: prefix
  const parsed = parseSearchQuery(rawSearch);
  let authorFilter = parsed.authorFilter, sourceFilter = parsed.sourceFilter, sortOverride = parsed.sortOverride;
  const textTokens = parsed.textTokens, exactPhrases = parsed.exactPhrases, titleTokens = parsed.titleTokens, titlePhrases = parsed.titlePhrases;

  let filtered = allPapers.filter(p => {
    if (hiddenSourceFilters.has(p.source)) return false;
    if (hidden.has(p.link)) return false;
    if (_blockedWordsSet.size > 0) {
      const titleLower = p.title.toLowerCase();
      for (const w of _blockedWordsSet) {
        if (titleLower.includes(w)) return false;
      }
    }
    const bypassed = bypass[p.source] || p.source === 'quote';
    if (qfOn && !bypassed && !(p.title in qCache)) return false;
    if (qfOn && !bypassed && (p.title in qCache)) {
      const entry = qCache[p.title];
      const verdict = entry?.v ?? entry;
      if (verdict === 'skip') return false;
      if (verdict === 'keep' && entry?.s != null && entry.s < getQualityThreshold()) return false;
    }
    if (category && !p.categories.includes(category)) return false;
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
    return true;
  });

  const effectiveSort = sortOverride === 'cited' || sortOverride === 'popular' ? 'citations' : sortOverride === 'latest' ? 'latest' : currentSort;
  if (effectiveSort === 'foryou') {
    const affinity = typeof getSourceAffinity === 'function' ? getSourceAffinity() : {};
    const now = Date.now();
    const wBase = parseFloat(localStorage.getItem('fyWeightBase') || '0.7');
    const wAff = parseFloat(localStorage.getItem('fyWeightAffinity') || '0.3');
    const wRecency = parseFloat(localStorage.getItem('fyWeightRecency') || '1.0');
    filtered = [...filtered].sort((a, b) => {
      const aLlm = qfOn && qCache[a.title]?.s != null ? qCache[a.title].s : 50;
      const bLlm = qfOn && qCache[b.title]?.s != null ? qCache[b.title].s : 50;
      const aAff = affinity[a.source] ?? 0.5;
      const bAff = affinity[b.source] ?? 0.5;
      const aAge = a.pubDate ? Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000) : 24;
      const bAge = b.pubDate ? Math.max(0, (now - new Date(b.pubDate).getTime()) / 3600000) : 24;
      const aRecency = Math.max(0, 10 - aAge * 0.5) * wRecency;
      const bRecency = Math.max(0, 10 - bAge * 0.5) * wRecency;
      a._compositeScore = aLlm * (wBase + aAff * wAff) + aRecency;
      b._compositeScore = bLlm * (wBase + bAff * wAff) + bRecency;
      return b._compositeScore - a._compositeScore;
    });
  } else if (effectiveSort === 'citations') {
    filtered = [...filtered].sort((a, b) => {
      const aScore = a.source === 'hn' ? (a.hnScore || 0) : (a.citations || 0);
      const bScore = b.source === 'hn' ? (b.hnScore || 0) : (b.citations || 0);
      return bScore - aScore;
    });
  } else {
    filtered = [...filtered].sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }
  // Category-aware interleaving: limit same-category runs
  const catMap = {};
  for (const f of FEED_CATALOG) catMap[f.key] = f.cat;
  const maxRun = parseInt(localStorage.getItem('maxPerCategoryRun') || '3', 10) || 3;
  if (filtered.length > 1) {
    const result = [];
    const remaining = filtered.slice();
    let lastCat = null;
    let catRun = 0;
    while (remaining.length) {
      let picked = -1;
      for (let i = 0; i < remaining.length; i++) {
        const pCat = catMap[remaining[i].source] || remaining[i].source;
        if (pCat !== lastCat || catRun < maxRun) { picked = i; break; }
      }
      if (picked === -1) picked = 0; // all same category, just take next
      const p = remaining.splice(picked, 1)[0];
      const pCat = catMap[p.source] || p.source;
      if (pCat === lastCat) { catRun++; } else { lastCat = pCat; catRun = 1; }
      result.push(p);
    }
    filtered = result;
  }
  return filtered;
}

function _renderPaperCompactRow(p, i, ctx) {
  const { readSet } = ctx;
  const sourceChip = getSourceChip(p.source, p.arxivId);
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const newDot = isNew && !isRead ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>' : '';
  const date = p.date ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(p.date)}</span>` : '';
  return `<div class="group${isRead ? ' opacity-50' : ''}" data-link="${escapeAttr(p.link)}">
    <div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openPaper(${i}, event)">
      ${newDot}${sourceChip}
      <span class="text-[0.82rem] ${isRead ? 'text-muted' : 'text-primary'} truncate">${renderTitle(p.title)}</span>
      <span class="ml-auto flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">${_cardActionRow(p, i)}</span>
      ${date}
    </div>
    ${_cardCommentContainer(p, i)}
  </div>`;
}

function _renderPaperCard(p, i, ctx) {
  const { qfOn, qCache, readSet } = ctx;
  const isHN = p.source === 'hn';
  const isArxiv = p.source === 'arxiv';
  const _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
  const sourceChip = _hasExternalLink ? (() => { try { const h = new URL(p.link).hostname.replace(/^www\./, ''); return `<span class="text-[0.75rem] text-dim">${escapeHtml(h)}</span>`; } catch { return `<span class="text-[0.75rem] text-dim">${escapeHtml(SOURCE_NAMES[p.source] || p.source)}</span>`; } })() : `<span class="text-[0.75rem] text-dim">${escapeHtml(SOURCE_NAMES[p.source] || p.source)}</span>`;
  const viaInfo = _hasExternalLink ? `<span class="text-[0.68rem] text-dimmer">via ${escapeHtml(SOURCE_NAMES[p.source] || p.source)}${isHN ? ` · ${p.hnScore} pts` : ''}</span>` : '';
  const aiEntry = qfOn ? qCache[p.title] : null;
  const aiVerdict = aiEntry?.v || aiEntry;
  const aiScore = aiEntry?.s;
  const aiChip = qfOn && aiVerdict === 'keep' ? `<span class="inline-flex items-center gap-0.5 text-[0.68rem]" title="AI quality score: ${aiScore != null ? aiScore + '%' : 'scoring…'}">${aiScore != null ? `<span class="text-dim">${aiScore}%</span>` : '<span class="text-dim animate-pulse">…</span>'}<span class="text-green-500">&#10003;</span></span>` : '';
  const isPoly = p.source === 'polymarket';
  const statsChips = (isHN && _hasExternalLink)
    ? ''
    : isHN
    ? `<span class="text-[0.68rem] text-dim">${p.hnScore} pts</span>`
    : isPoly
    ? `<span class="text-[0.68rem] font-semibold ${p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400'}">${p.polyYesPct}%</span>`
    : (p.citations !== undefined ? `<span class="text-[0.68rem] text-dim">${p.citations} cited</span>` : '');
  const dateChip = p.date ? `<span class="text-[0.68rem] text-dim">${escapeHtml(p.date)}</span>` : '';
  const snippet = isPoly ? '' : (p.description ? truncate(p.description, 120) : '');
  const userRating = getPaperRating(p.link);
  const ratingChip = userRating > 0 ? renderStarRating(p.link, { size: 'sm', interactive: false }) : '';
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const newDot = isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '';
  // Card image: polymarket uses polyImage, others use favicon, fallback to pixel art
  const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (() => { try { return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(p.link).hostname)}&sz=64`; } catch { return ''; } })();
  const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  const cardImg = cardImgSrc
    ? `<img src="${cardImgSrc}" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
    : pixelFallback;
  return `
  <div class="paper break-inside-avoid bg-card border border-border-card rounded-xl p-4 mb-3.5 cursor-pointer transition-all duration-150${isRead ? ' opacity-50' : ''}" data-link="${escapeAttr(p.link)}" onclick="openPaper(${i}, event)">
    <div class="flex gap-2.5 items-center">${cardImg}<div class="text-[0.92rem] font-semibold ${isRead ? 'text-muted' : 'text-primary'} leading-snug min-w-0">${newDot}${renderTitle(p.title)}</div></div>
    ${p.source === 'quote' && p._quoteText ? `<div class="text-[0.82rem] text-muted leading-relaxed italic border-l-2 border-accent pl-3 my-1.5">${escapeHtml(p._quoteText)}</div><div class="text-[0.68rem] text-dim truncate">${escapeHtml(p.link)}</div>` : snippet ? `<div class="text-[0.78rem] text-muted leading-relaxed mt-1.5">${escapeHtml(snippet)}</div>` : ''}
    <div class="flex gap-2 flex-wrap items-center mt-2">${sourceChip}${viaInfo}${aiChip}${statsChips}${ratingChip}${dateChip}${_cardActionRow(p, i)}</div>
    ${_cardCommentContainer(p, i)}
  </div>`;
}

function renderPapers() {
  const filtered = getFilteredPapers();
  lastFilteredPapers = filtered;
  const visible = filtered.slice(0, visibleCount);
  const qfOn = isQualityFilterOn();
  const qCache = qfOn ? getQualityCache() : {};
  const hiddenSet = new Set(getHiddenPosts());
  const readSet = new Set(getReadPosts());
  const bypass = qfOn ? getQualityBypass() : {};
  const pendingCount = qfOn ? allPapers.filter(p => !hiddenSet.has(p.link) && !bypass[p.source] && p.source !== 'quote' && !(p.title in qCache)).length : 0;
  document.getElementById('stats').textContent = `Showing ${visible.length} of ${filtered.length} papers`;
  const evalEl = document.getElementById('eval-indicator');
  const evalCountEl = document.getElementById('eval-count');
  if (evalEl) {
    if (pendingCount > 0) {
      evalCountEl.textContent = pendingCount;
      evalEl.classList.remove('hidden');
    } else {
      evalEl.classList.add('hidden');
    }
  }
  const container = document.getElementById('papers');
  if (!filtered.length && pendingCount > 0) return;
  if (!filtered.length) {
    const threshold = qfOn ? getQualityThreshold() : 0;
    const filledDots = Math.round(threshold / 10);
    const dots = Array.from({ length: 10 }, (_, i) =>
      `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px;background:${i < filledDots ? 'var(--accent)' : 'var(--border-card)'};transition:background 0.2s" title="${(i + 1) * 10}%"></span>`
    ).join('');
    container.innerHTML = `<div style="column-span:all;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5rem 0;gap:16px">
      <div class="text-dim" style="font-size:0.9rem">No papers match your filter</div>
      ${qfOn ? `<div style="display:flex;align-items:center;justify-content:center">${dots}</div>
      <div class="text-dimmer" style="font-size:0.75rem">Quality threshold: ${threshold}%</div>` : ''}
    </div>`;
    return;
  }
  const _ctx = { qfOn, qCache, readSet };
  if (feedViewMode === 'compact') {
    container.innerHTML = `<div style="column-span:all" class="flex flex-col">` + visible.map((p, i) => _renderPaperCompactRow(p, i, _ctx)).join('') + `</div>`;
  } else if (feedViewMode === 'verbose') {
    container.innerHTML = `<div style="column-span:all" class="flex flex-col gap-3">` + visible.map((p, i) => {
      const isHN = p.source === 'hn';
      const _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
      const sourceName = _hasExternalLink ? (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return SOURCE_NAMES[p.source] || p.source; } })() : (SOURCE_NAMES[p.source] || p.source);
      const viaInfo = _hasExternalLink ? `<span class="text-[0.72rem] text-dimmer">via ${escapeHtml(SOURCE_NAMES[p.source] || p.source)}${isHN ? ` · ${p.hnScore} pts` : ''}</span>` : '';
      const aiEntry = qfOn ? qCache[p.title] : null;
      const aiVerdict = aiEntry?.v || aiEntry;
      const aiScore = aiEntry?.s;
      const aiChip = qfOn && aiVerdict === 'keep' ? `<span class="inline-flex items-center gap-0.5 text-[0.72rem]" title="AI quality score: ${aiScore != null ? aiScore + '%' : 'scoring…'}">${aiScore != null ? `<span class="text-dim">${aiScore}%</span>` : '<span class="text-dim animate-pulse">…</span>'}<span class="text-green-500">&#10003;</span></span>` : '';
      const isPoly = p.source === 'polymarket';
      const statsChips = (isHN && _hasExternalLink) ? '' : isHN ? `<span class="text-[0.72rem] text-dim">${p.hnScore} pts</span>` : isPoly ? `<span class="text-[0.72rem] font-semibold ${p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400'}">${p.polyYesPct}%</span>` : (p.citations !== undefined ? `<span class="text-[0.72rem] text-dim">${p.citations} cited</span>` : '');
      const dateChip = p.date ? `<span class="text-[0.72rem] text-dim">${escapeHtml(p.date)}</span>` : '';
      const fullDesc = isPoly ? '' : (p.description || '');
      const authors = p.authors ? `<div class="text-[0.76rem] text-dimmer mt-1">${escapeHtml(truncate(p.authors, 200))}</div>` : '';
      const categories = p.categories && p.categories.length ? `<div class="flex gap-1 flex-wrap mt-1.5">${p.categories.slice(0, 6).map(c => `<span class="text-[0.65rem] px-1.5 py-0.5 rounded bg-hover text-dim">${escapeHtml(c)}</span>`).join('')}</div>` : '';
      const userRating = getPaperRating(p.link);
      const ratingChip = userRating > 0 ? renderStarRating(p.link, { size: 'sm', interactive: false }) : '';
      const isSaved = isPostSaved(p.link);
      const bmFill = isSaved ? 'var(--accent)' : 'none';
      const bmStroke = isSaved ? 'var(--accent)' : 'currentColor';
      const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
      const isRead = readSet.has(p.link);
      const newDot = isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '';
      const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (() => { try { return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(p.link).hostname)}&sz=64`; } catch { return ''; } })();
      const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
      const cardImg = cardImgSrc
        ? `<img src="${cardImgSrc}" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
        : pixelFallback;
      return `
      <div class="paper bg-card border border-border-card rounded-xl p-5 cursor-pointer transition-all duration-150${isRead ? ' opacity-50' : ''}" data-link="${escapeAttr(p.link)}" onclick="openPaper(${i}, event)">
        <div class="flex gap-2.5 items-center">${cardImg}<div class="text-[1rem] font-semibold ${isRead ? 'text-muted' : 'text-primary'} leading-snug min-w-0">${newDot}${renderTitle(p.title)}</div></div>
        ${authors}
        ${fullDesc ? `<div class="text-[0.82rem] text-muted leading-relaxed mt-2">${escapeHtml(fullDesc)}</div>` : ''}
        ${categories}
        <div class="flex gap-2 flex-wrap items-center mt-3"><span class="text-[0.72rem] text-dim">${escapeHtml(sourceName)}</span>${viaInfo}${aiChip}${statsChips}${ratingChip}${dateChip}${_cardActionRow(p, i)}</div>
        ${_cardCommentContainer(p, i)}
      </div>`;
    }).join('') + `</div>`;
  } else if (feedViewMode === 'twitter') {
    container.innerHTML = `<div style="column-span:all" class="flex flex-col max-w-[600px] mx-auto">` + visible.map((p, i) => {
      const isHN = p.source === 'hn';
      const _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
      const sourceName = SOURCE_NAMES[p.source] || p.source;
      const handle = (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return p.source; } })();
      const isPoly = p.source === 'polymarket';
      const snippet = isPoly ? '' : (p.description ? truncate(p.description, 280) : '');
      const isSaved = isPostSaved(p.link);
      const bmFill = isSaved ? 'var(--accent)' : 'none';
      const bmStroke = isSaved ? 'var(--accent)' : 'currentColor';
      const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
      const isRead = readSet.has(p.link);
      const newDot = isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '';
      const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (() => { try { return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(p.link).hostname)}&sz=64`; } catch { return ''; } })();
      const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
      const avatar = cardImgSrc
        ? `<img src="${cardImgSrc}" class="w-10 h-10 rounded-full shrink-0 object-cover" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
        : pixelFallback;
      const timeAgo = p.pubDate && typeof _relativeTime === 'function' ? _relativeTime(p.pubDate) : (p.date || '');
      const aiEntry = qfOn ? qCache[p.title] : null;
      const aiScore = aiEntry?.s;
      const hnPts = isHN ? p.hnScore || 0 : 0;
      const citations = p.citations !== undefined ? p.citations : null;
      const statsNum = isPoly ? `${p.polyYesPct}%` : isHN ? `${hnPts}` : (citations !== null ? `${citations}` : '');
      const statsLabel = isPoly ? (p.polyYesPct >= 50 ? 'Yes' : 'No') : isHN ? (hnPts === 1 ? 'point' : 'points') : (citations !== null ? (citations === 1 ? 'citation' : 'citations') : '');
      return `
      <div class="py-3 px-4 border-b border-border-card cursor-pointer transition-colors hover:bg-hover${isRead ? ' opacity-50' : ''}" data-link="${escapeAttr(p.link)}" onclick="openPaper(${i}, event)">
        <div class="flex gap-3">
          ${avatar}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${newDot}
              <span class="text-[0.88rem] font-bold ${isRead ? 'text-muted' : 'text-primary'}">${escapeHtml(sourceName)}</span>
              <span class="text-[0.8rem] text-dimmer">@${escapeHtml(handle)}</span>
              <span class="text-dimmer">·</span>
              <span class="text-[0.8rem] text-dimmer">${escapeHtml(timeAgo)}</span>
              ${aiScore != null ? `<span class="text-[0.72rem] text-dim ml-auto">${aiScore}% <span class="text-green-500">&#10003;</span></span>` : ''}
            </div>
            <div class="text-[0.92rem] ${isRead ? 'text-muted' : 'text-primary'} leading-snug mt-1 font-semibold">${renderTitle(p.title)}</div>
            ${snippet ? `<div class="text-[0.84rem] text-muted leading-relaxed mt-1">${escapeHtml(snippet)}</div>` : ''}
            ${p.source === 'quote' && p._quoteText ? `<div class="text-[0.84rem] text-muted leading-relaxed italic border-l-2 border-accent pl-3 mt-2">${escapeHtml(p._quoteText)}</div>` : ''}
            <div class="flex items-center justify-between mt-2.5 max-w-[400px]">
              <button class="group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-blue-400 transition-colors" onclick="event.stopPropagation(); _toggleTweetComments('${escapeAttr(p.link)}', ${i})">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
                <span class="text-[0.72rem]" data-tweet-comment-count="${escapeAttr(p.link)}">${_tweetCommentCounts[p.link] || ''}</span>
              </button>
              <button class="group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 transition-colors ${_isReposted(p.link) ? '' : 'text-dimmer hover:text-green-400'}" style="${_isReposted(p.link) ? 'color:rgb(74,222,128)' : ''}" onclick="event.stopPropagation(); _tweetRepost(${i}, this)">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                <span class="text-[0.72rem]">${statsNum ? statsNum : ''}</span>
              </button>
              <button class="group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 transition-colors" style="color:${bmFill === 'none' ? 'var(--text-dimmer)' : 'var(--accent)'}" onclick="event.stopPropagation(); toggleSavePost(lastFilteredPapers[${i}], event)">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="${bmFill}" stroke="${bmStroke}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
              </button>
              <button class="group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-primary transition-colors" onclick="openCardMenu(this, event, ${i})">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              </button>
            </div>
            <div id="tweet-comments-${i}" style="display:${_tweetCommentsOpen.has(p.link) ? 'block' : 'none'}"></div>
          </div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  } else {
    container.innerHTML = visible.map((p, i) => _renderPaperCard(p, i, _ctx)).join('');
  }
  // Animate cards that are new since the last render
  const prevLinks = _renderedLinks;
  _renderedLinks = new Set(visible.map(p => p.link));
  if (prevLinks.size > 0) {
    container.querySelectorAll('[data-link]').forEach(el => {
      if (!prevLinks.has(el.dataset.link)) {
        el.classList.add('feed-enter');
        // Add a notification dot that fades after 10s
        const dot = document.createElement('span');
        dot.className = 'feed-new-dot';
        el.style.position = 'relative';
        el.appendChild(dot);
      }
    });
  }
  fetchCitationsFor(visible);
  // Fetch comment counts & re-expand open comment sections
  _fetchTweetCommentCounts(visible);
  visible.forEach((p, i) => {
    if (_tweetCommentsOpen.has(p.link)) {
      const container = document.getElementById('tweet-comments-' + i);
      if (container) {
        container.style.display = 'block';
        fetch('/api/comments?paperLink=' + encodeURIComponent(p.link), { headers: _authHeaders() })
          .then(r => r.json())
          .then(comments => _renderTweetComments(container, comments, p.link, i))
          .catch(() => {});
      }
    }
  });
}

// ── Twitter view: inline comments & repost ──

const _tweetCommentCounts = {}; // link -> count
const _tweetCommentsOpen = new Set(); // links with expanded comment sections

async function _fetchTweetCommentCounts(papers) {
  for (const p of papers) {
    if (_tweetCommentCounts[p.link] !== undefined) continue;
    try {
      const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(p.link), { headers: _authHeaders() });
      const comments = await resp.json();
      _tweetCommentCounts[p.link] = comments.length;
    } catch { _tweetCommentCounts[p.link] = 0; }
  }
  // Update count badges in-place
  document.querySelectorAll('[data-tweet-comment-count]').forEach(el => {
    const link = el.dataset.tweetCommentCount;
    if (_tweetCommentCounts[link] !== undefined && _tweetCommentCounts[link] > 0) {
      el.textContent = _tweetCommentCounts[link];
    }
  });
}

async function _toggleTweetComments(link, idx) {
  const container = document.getElementById('tweet-comments-' + idx);
  if (!container) return;
  if (_tweetCommentsOpen.has(link)) {
    _tweetCommentsOpen.delete(link);
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  _tweetCommentsOpen.add(link);
  container.style.display = 'block';
  container.innerHTML = '<div class="text-dim text-[0.75rem] py-2">Loading...</div>';
  try {
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(link), { headers: _authHeaders() });
    const comments = await resp.json();
    _tweetCommentCounts[link] = comments.length;
    // Update badge
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    _renderTweetComments(container, comments, link, idx);
  } catch {
    container.innerHTML = '<div class="text-red-400 text-[0.75rem] py-2">Failed to load comments</div>';
  }
}

function _renderTweetComments(container, comments, link, idx) {
  const topLevel = comments.filter(c => !c.parentId).sort((a, b) => a.timestamp - b.timestamp);
  const byParent = {};
  comments.forEach(c => { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
  const currentUser = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';

  function renderThread(c, depth) {
    const replies = (byParent[c.id] || []).sort((a, b) => a.timestamp - b.timestamp);
    const ml = depth > 0 ? `margin-left:${Math.min(depth, 4) * 16}px; border-left: 2px solid var(--border-card); padding-left: 8px;` : '';
    const initial = (c.author || '?')[0].toUpperCase();
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
    const isOwn = c.author === currentUser;
    const delBtn = isOwn ? `<button onclick="event.stopPropagation(); _deleteTweetComment('${c.id}', '${escapeAttr(link)}', ${idx})" class="text-dimmest hover:text-red-400 text-[0.65rem] ml-auto bg-transparent border-none cursor-pointer">x</button>` : '';
    let html = `<div style="${ml}; margin-bottom: 6px;">
      <div class="flex items-start gap-1.5">
        <div style="width:20px;height:20px;min-width:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:0.6rem;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(initial)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <a href="#profile/${encodeURIComponent(c.author)}" onclick="event.stopPropagation()" class="text-[0.72rem] font-medium text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(c.author)}</a>
            <span class="text-[0.65rem] text-dimmer">${timeAgo}</span>${delBtn}
          </div>
          <div class="text-[0.78rem] text-primary mt-0.5 leading-relaxed">${escapeHtml(c.content).replace(/\n/g, '<br>')}</div>
          <button onclick="event.stopPropagation(); _showTweetReply('${c.id}')" class="text-[0.68rem] text-dim hover:text-accent mt-0.5 bg-transparent border-none cursor-pointer p-0">Reply</button>
          <div id="tweet-reply-${c.id}" class="hidden mt-1">
            <textarea id="tweet-reply-ta-${c.id}" onclick="event.stopPropagation()" class="w-full text-[0.75rem] bg-input border border-border-input rounded px-2 py-1 text-primary resize-none outline-none focus:border-accent" rows="2" placeholder="Write a reply..."></textarea>
            <div class="flex gap-1 mt-1">
              <button onclick="event.stopPropagation(); _postTweetReply('${c.id}', '${escapeAttr(link)}', ${idx})" class="px-2 py-0.5 text-[0.68rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none">Reply</button>
              <button onclick="event.stopPropagation(); _hideTweetReply('${c.id}')" class="px-2 py-0.5 text-[0.68rem] rounded border border-border-input text-dim hover:text-primary cursor-pointer bg-transparent">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
    replies.forEach(r => { html += renderThread(r, depth + 1); });
    html += '</div>';
    return html;
  }

  const author = currentUser || 'Anonymous';
  container.innerHTML = `
    <div class="mt-2 pt-2 border-t border-border-card">
      ${topLevel.length ? topLevel.map(c => renderThread(c, 0)).join('') : '<div class="text-dim text-[0.75rem] py-1">No comments yet</div>'}
      <div class="flex gap-2 mt-2">
        <textarea id="tweet-comment-input-${idx}" onclick="event.stopPropagation()" class="flex-1 text-[0.75rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent" rows="1" placeholder="Add a comment..."></textarea>
        <button onclick="event.stopPropagation(); _postTweetComment('${escapeAttr(link)}', ${idx})" class="px-3 py-1 text-[0.72rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none shrink-0">Post</button>
      </div>
    </div>`;
}

async function _postTweetComment(link, idx) {
  const ta = document.getElementById('tweet-comment-input-' + idx);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  const author = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || 'Anonymous';
  try {
    await fetch('/api/comments', { method: 'POST', headers: _authHeaders(), body: JSON.stringify({ paperLink: link, author, content, parentId: null }) });
    ta.value = '';
    // Re-fetch and re-render
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(link), { headers: _authHeaders() });
    const comments = await resp.json();
    _tweetCommentCounts[link] = comments.length;
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    const container = document.getElementById('tweet-comments-' + idx);
    if (container) _renderTweetComments(container, comments, link, idx);
  } catch { /* silent */ }
}

async function _postTweetReply(parentId, link, idx) {
  const ta = document.getElementById('tweet-reply-ta-' + parentId);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  const author = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || 'Anonymous';
  try {
    await fetch('/api/comments', { method: 'POST', headers: _authHeaders(), body: JSON.stringify({ paperLink: link, author, content, parentId }) });
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(link), { headers: _authHeaders() });
    const comments = await resp.json();
    _tweetCommentCounts[link] = comments.length;
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    const container = document.getElementById('tweet-comments-' + idx);
    if (container) _renderTweetComments(container, comments, link, idx);
  } catch { /* silent */ }
}

async function _deleteTweetComment(commentId, link, idx) {
  try {
    await fetch('/api/comments/' + commentId, { method: 'DELETE', headers: _authHeaders() });
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(link), { headers: _authHeaders() });
    const comments = await resp.json();
    _tweetCommentCounts[link] = comments.length;
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    const container = document.getElementById('tweet-comments-' + idx);
    if (container) _renderTweetComments(container, comments, link, idx);
  } catch { /* silent */ }
}

function _showTweetReply(id) {
  const el = document.getElementById('tweet-reply-' + id);
  if (el) { el.classList.remove('hidden'); el.querySelector('textarea')?.focus(); }
}

function _hideTweetReply(id) {
  const el = document.getElementById('tweet-reply-' + id);
  if (el) el.classList.add('hidden');
}

function _getRepostedLinks() {
  try { return JSON.parse(localStorage.getItem('repostedLinks') || '[]'); } catch { return []; }
}
function _isReposted(link) { return _getRepostedLinks().includes(link); }
function _markReposted(link) {
  const links = _getRepostedLinks();
  if (!links.includes(link)) { links.push(link); localStorage.setItem('repostedLinks', JSON.stringify(links)); }
}
function _unmarkReposted(link) {
  const links = _getRepostedLinks().filter(l => l !== link);
  localStorage.setItem('repostedLinks', JSON.stringify(links));
}

function _tweetRepost(idx, btn) {
  const p = lastFilteredPapers[idx];
  if (!p) return;
  const svg = btn.querySelector('svg');
  // Undo repost
  if (_isReposted(p.link)) {
    _unmarkReposted(p.link);
    btn.style.color = '';
    btn.className = btn.className.replace(/(?:^|\s)text-dimmer\s+hover:text-green-400/g, '') + ' text-dimmer hover:text-green-400';
    delete btn.dataset.reposted;
    fetch('/api/reposts', {
      method: 'DELETE',
      headers: _authHeaders(),
      body: JSON.stringify({ paperLink: p.link })
    }).catch(e => console.error('Unrepost error:', e));
    return;
  }
  // Animate the repost icon
  if (svg) {
    svg.style.transition = 'transform 0.4s cubic-bezier(.4,2,.6,1)';
    svg.style.transform = 'scale(1.4) rotate(360deg)';
    setTimeout(() => {
      svg.style.transform = 'scale(1) rotate(0deg)';
      setTimeout(() => { svg.style.transition = ''; }, 400);
    }, 400);
  }
  // Keep it green
  btn.style.color = 'rgb(74, 222, 128)';
  btn.dataset.reposted = '1';
  _markReposted(p.link);
  // Save repost to server
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';
  fetch('/api/reposts', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ paperLink: p.link, paperTitle: p.title, username })
  }).then(r => { if (!r.ok) console.error('Repost failed:', r.status); })
    .catch(e => console.error('Repost error:', e));
}

// Shared comment & repost action buttons for all card views
function _cardActionRow(p, i) {
  const isSaved = isPostSaved(p.link);
  const bmFill = isSaved ? 'var(--accent)' : 'none';
  const bmStroke = isSaved ? 'var(--accent)' : 'currentColor';
  const commentCount = _tweetCommentCounts[p.link] || '';
  const reposted = _isReposted(p.link);
  return `<div class="flex items-center gap-3 shrink-0 ml-auto">
    <button class="flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-blue-400 transition-colors" onclick="event.stopPropagation(); _toggleTweetComments('${escapeAttr(p.link)}', ${i})" title="Comments">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
      <span class="text-[0.68rem]" data-tweet-comment-count="${escapeAttr(p.link)}">${commentCount}</span>
    </button>
    <button class="flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 transition-colors ${reposted ? '' : 'text-dimmer hover:text-green-400'}" style="${reposted ? 'color:rgb(74,222,128)' : ''}" onclick="event.stopPropagation(); _tweetRepost(${i}, this)" title="Repost">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
    </button>
    <button class="bg-transparent border-none cursor-pointer p-0 transition-colors" style="color:${bmFill === 'none' ? 'var(--text-dimmer)' : 'var(--accent)'}" onclick="event.stopPropagation(); toggleSavePost(lastFilteredPapers[${i}], event)" title="${isSaved ? 'Remove from Reading List' : 'Save to Reading List'}">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="${bmFill}" stroke="${bmStroke}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
    </button>
    <button class="bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-primary transition-colors" onclick="openCardMenu(this, event, ${i})">
      <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
    </button>
  </div>`;
}

function _cardCommentContainer(p, i) {
  return `<div id="tweet-comments-${i}" style="display:${_tweetCommentsOpen.has(p.link) ? 'block' : 'none'}"></div>`;
}

// Infinite scroll
let scrollTicking = false;
window.addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    if (document.getElementById('home-main').style.display === 'none') return;
    if (visibleCount >= lastFilteredPapers.length) return;
    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    if (scrollBottom >= docHeight - 400) {
      visibleCount += PAGE_SIZE;
      renderPapers();
    }
  });
});

// Drag & drop files onto home feed to open in browse viewer
(function() {
  const feed = document.getElementById('home-feed-section');
  if (!feed) return;
  feed.addEventListener('dragover', function(e) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    feed.style.outline = '2px dashed var(--accent)';
  });
  feed.addEventListener('dragleave', function(e) {
    if (feed.contains(e.relatedTarget)) return;
    feed.style.outline = '';
  });
  feed.addEventListener('drop', function(e) {
    e.preventDefault();
    feed.style.outline = '';
    const file = e.dataTransfer.files[0];
    if (file) openLocalPdf(file);
  });
})();

// Feed loading is triggered by goHome() via routing
