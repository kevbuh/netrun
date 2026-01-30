// ── Auto-refresh timer ──
let _refreshTimer = null;
let _refreshSecondsLeft = 300;
let _previousPostLinks = new Set();

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

function getHiddenPosts() {
  try { return JSON.parse(localStorage.getItem('hiddenPosts') || '[]'); } catch { return []; }
}
function openCardMenu(btn, ev, index) {
  ev.stopPropagation();
  ev.preventDefault();
  closeCardMenu();
  const p = lastFilteredPapers[index];
  if (!p) return;
  const qfOn = isQualityFilterOn();
  const sourceKey = p.source;
  const sourceName = SOURCE_NAMES[p.source] || p.source;
  const bypassed = qfOn && isSourceBypassed(p.source);

  const menu = document.createElement('div');
  menu.id = 'card-menu-portal';
  menu.className = 'card-menu';
  menu.innerHTML = `
    <button onmousedown="event.stopPropagation(); hidePost('${escapeAttr(p.link)}', '${escapeAttr(p.title)}'); closeCardMenu()">Hide post</button>
    <button onmousedown="event.stopPropagation(); toggleSourceBubble('${escapeAttr(sourceKey)}'); closeCardMenu()">Hide ${escapeHtml(sourceName)}</button>
    ${qfOn ? `<button onmousedown="event.stopPropagation(); setQualityBypass('${escapeAttr(sourceKey)}', ${!bypassed}); closeCardMenu()">${bypassed ? 'Enable' : 'Skip'} filter for ${escapeHtml(sourceName)}</button>` : ''}
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

function getSavedPosts() {
  try { return JSON.parse(localStorage.getItem('savedPosts') || '{}'); } catch { return {}; }
}
function savePosts(data) { localStorage.setItem('savedPosts', JSON.stringify(data)); }
function isPostSaved(link) { return !!getSavedPosts()[link]; }

async function syncSavedPosts() {
  try {
    const resp = await fetch('/api/saved-posts');
    if (!resp.ok) return;
    const serverPosts = await resp.json();
    const localPosts = getSavedPosts();
    let changed = false;
    // Merge: server wins for new items not in local
    for (const [url, entry] of Object.entries(serverPosts)) {
      if (!localPosts[url]) {
        localPosts[url] = entry;
        changed = true;
      }
    }
    // Push local-only items to server
    for (const [url, entry] of Object.entries(localPosts)) {
      if (!serverPosts[url]) {
        fetch('/api/saved-posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, title: entry.paper?.title || '', source: entry.paper?.source || 'web', description: entry.paper?.description || '' })
        }).catch(() => {});
      }
    }
    if (changed) {
      savePosts(localPosts);
      updateSavedBadge();
      if (document.getElementById('saved-view')?.style.display === 'block') renderSavedPosts();
    }
  } catch {}
}
syncSavedPosts();

function toggleSavePost(paper, event) {
  if (event) event.stopPropagation();
  const saved = getSavedPosts();
  if (saved[paper.link]) {
    delete saved[paper.link];
    fetch('/api/saved-posts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: paper.link })
    }).catch(() => {});
  } else {
    saved[paper.link] = { paper, savedAt: Date.now(), read: false };
    fetch('/api/saved-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: paper.link, title: paper.title, source: paper.source, description: paper.description || '' })
    }).catch(() => {});
  }
  savePosts(saved);
  updateSavedBadge();
  renderPapers();
  if (document.getElementById('saved-view').style.display === 'block') renderSavedPosts();
}

function markPostRead(link) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  saved[link].read = true;
  savePosts(saved);
  updateSavedBadge();
}

function openSaved() {
  hideAllViews();
  const view = document.getElementById('saved-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'saved';
  setSidebarActive('sb-dashboard');
  renderSavedPosts();
}

function renderSavedPosts() {
  const saved = getSavedPosts();
  const entries = Object.values(saved).sort((a, b) => b.savedAt - a.savedAt);
  const readCount = entries.filter(e => e.read).length;
  document.getElementById('saved-stats').textContent = entries.length ? `${entries.length} saved, ${readCount} read` : '';
  const container = document.getElementById('saved-list');
  if (!entries.length) {
    container.innerHTML = '<div class="text-center py-20 text-dim text-[0.9rem]">No saved papers yet. Bookmark papers from the feed to see them here.</div>';
    return;
  }
  container.innerHTML = entries.map(entry => {
    const p = entry.paper;
    const readClass = entry.read ? ' opacity-60' : '';
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const faviconImg = favicon ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.style.display='none'">` : '';
    const hostLabel = hostname ? `<span class="text-[0.72rem] text-dim shrink-0">${escapeHtml(hostname)}</span>` : '';
    return `
    <div class="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-hover transition-colors group${readClass}" onclick="openSavedPaper('${escapeAttr(p.link)}')">
      <div class="shrink-0">${faviconImg}</div>
      <div class="flex-1 min-w-0">
        <div class="text-[0.85rem] text-primary truncate leading-snug">${renderTitle(p.title)}</div>
        <div class="text-[0.72rem] text-dimmer truncate">${hostLabel}</div>
      </div>
      <button class="shrink-0 bg-transparent border-none cursor-pointer p-1 text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); toggleSavePostByLink('${escapeAttr(p.link)}')" title="Remove">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

function toggleSavePostByLink(link) {
  const saved = getSavedPosts();
  if (saved[link]) {
    delete saved[link];
    savePosts(saved);
    updateSavedBadge();
    renderSavedPosts();
    renderPapers();
    fetch('/api/saved-posts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: link })
    }).catch(() => {});
  }
}

function openSavedPaper(link) {
  markPostRead(link);
  const saved = getSavedPosts();
  const entry = saved[link];
  if (!entry) return;
  const paper = entry.paper;
  paperViewOrigin = 'saved';
  if (paper.source === 'arxiv') {
    showPaperView(paper, 'view/' + encodeURIComponent(link));
  } else {
    fetch(`/api/check-embed?url=${encodeURIComponent(link)}`)
      .then(r => r.json())
      .then(data => {
        if (data.embeddable) {
          showPaperView(paper, 'view/' + encodeURIComponent(link));
        } else {
          window.open(link, '_blank');
        }
      })
      .catch(() => { window.open(link, '_blank'); });
  }
}

// ── arXiv Feed (loads on startup) ──
let allPapers = [];
let allCategories = new Set();
let citationMap = {};
let currentSort = 'latest';
const PAGE_SIZE = 20;
let visibleCount = PAGE_SIZE;
let hiddenSourceFilters = new Set();
let feedViewMode = 'block'; // 'block' or 'compact'

function toggleViewMode() {
  feedViewMode = feedViewMode === 'block' ? 'compact' : 'block';
  const icon = document.getElementById('view-mode-icon');
  if (icon) {
    // list icon for block mode (click to go compact), grid icon for compact mode (click to go block)
    icon.innerHTML = feedViewMode === 'block'
      ? '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>'
      : '<path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>';
  }
  renderPapers();
}

function toggleSourceBubble(key) {
  if (hiddenSourceFilters.has(key)) hiddenSourceFilters.delete(key);
  else hiddenSourceFilters.add(key);
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
        polyImage: m.image
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

function renderOnboardGrid() {
  const grid = document.getElementById('onboard-grid');
  const cats = []; const catMap = {};
  FEED_CATALOG.forEach(f => {
    if (!catMap[f.cat]) { catMap[f.cat] = []; cats.push(f.cat); }
    catMap[f.cat].push(f);
  });
  grid.innerHTML = cats.map(cat => `
    <div class="text-left mt-6">
      <div class="text-[0.7rem] text-dim uppercase tracking-wider mb-2 pl-1">${cat}</div>
      <div class="grid grid-cols-2 gap-3">
        ${catMap[cat].map(f => `
          <div class="onboard-card cursor-pointer rounded-xl border-2 border-border-card bg-card p-5 transition-all duration-150 hover:border-dimmer" data-source="${f.key}" onclick="toggleOnboardSource('${f.key}')">
            <div class="flex items-center justify-center mb-3">${catalogLogo(f, 'onboard')}</div>
            <div class="text-white_ text-[0.95rem] font-medium mb-1">${f.name}</div>
            <div class="text-muted text-[0.78rem]">${f.desc}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleOnboardSource(key) {
  if (onboardSelected.has(key)) onboardSelected.delete(key);
  else onboardSelected.add(key);
  document.querySelectorAll('.onboard-card').forEach(card => {
    const selected = onboardSelected.has(card.dataset.source);
    card.style.borderColor = selected ? 'var(--accent)' : '';
  });
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

function showOnboarding() {
  renderOnboardGrid();
  if (hasOnboarded()) {
    const sources = getFeedSources();
    FEED_CATALOG.forEach(f => { if (sources[f.key]) onboardSelected.add(f.key); });
    document.querySelectorAll('.onboard-card').forEach(card => {
      if (onboardSelected.has(card.dataset.source)) card.style.borderColor = 'var(--accent)';
    });
    document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
  }
  document.getElementById('onboard-view').style.display = '';
  document.getElementById('finder-section').style.display = 'none';
  document.getElementById('home-feed-section').style.display = 'none';
}

function completeOnboarding() {
  const sources = {};
  FEED_CATALOG.forEach(f => { sources[f.key] = onboardSelected.has(f.key); });
  localStorage.setItem('feedSources', JSON.stringify(sources));
  document.getElementById('onboard-view').style.display = 'none';
  document.getElementById('finder-section').style.display = '';
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

function addCustomFeed() {
  const input = document.getElementById('custom-feed-url');
  const url = input.value.trim();
  if (!url) return;
  const feeds = getCustomFeeds();
  if (feeds.some(f => f.url === url)) return;
  let name = url;
  try { name = new URL(url).hostname.replace(/^www\./, ''); } catch {}
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

function openSettings() {
  hideAllViews();
  const view = document.getElementById('settings-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'settings';
  setSidebarActive('sb-settings');
  renderSettingsView();
}

function renderSettingsView() {
  const container = document.getElementById('settings-view-content');
  const sources = getFeedSources();
  const bypassMap = getQualityBypass();
  const cache = getQualityCache();
  const cacheEntries = Object.entries(cache);
  const keptCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'keep').length;
  const skippedCount = cacheEntries.filter(([, v]) => (v?.v || v) === 'skip').length;
  const testTitles = getTestTitles();
  const blockedWords = getBlockedWords();

  const cats = []; const catMap = {};
  FEED_CATALOG.forEach(f => {
    if (!catMap[f.cat]) { catMap[f.cat] = []; cats.push(f.cat); }
    catMap[f.cat].push(f);
  });

  const currentTheme = localStorage.getItem('theme') || 'dark';
  const currentAccent = localStorage.getItem('accentColor') || '#b4451a';
  const accentColors = [
    { color: '#b4451a', name: 'Orange' },
    { color: '#e53e3e', name: 'Red' },
    { color: '#d69e2e', name: 'Gold' },
    { color: '#38a169', name: 'Green' },
    { color: '#3182ce', name: 'Blue' },
    { color: '#805ad5', name: 'Purple' },
    { color: '#d53f8c', name: 'Pink' },
    { color: '#718096', name: 'Gray' },
  ];

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-6">Settings</h2>

    <!-- APPEARANCE -->
    <div class="mb-8">
      <h3 class="text-white_ text-sm font-semibold mb-3">Appearance</h3>
      <div class="flex items-center justify-between mb-4">
        <span class="text-primary text-sm">Theme</span>
        <div class="flex gap-1.5">
          <button onclick="setTheme('dark')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'dark' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-dark">Dark</button>
          <button onclick="setTheme('light')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'light' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-light">Light</button>
          <button onclick="setTheme('sepia')" class="px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${currentTheme === 'sepia' ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}" id="theme-btn-sepia">Sepia</button>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-primary text-sm">Accent Color</span>
        <div class="flex gap-2">
          ${accentColors.map(a => `
            <button onclick="setAccentColor('${a.color}')" class="w-6 h-6 rounded-full border-2 cursor-pointer transition-transform hover:scale-110 ${currentAccent === a.color ? 'border-white_ scale-110' : 'border-transparent'}" style="background:${a.color}" title="${a.name}"></button>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- FEED SOURCES -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Feed Sources</h3>
      <div class="flex flex-col gap-2" id="settings-builtin-sources">
        ${cats.map(cat => `
          <div class="text-[0.68rem] text-dim uppercase tracking-wider mt-3 first:mt-0">${cat}</div>
          ${catMap[cat].map(f => `
            <div class="flex items-center justify-between">
              <span class="text-primary text-sm">${f.name}</span>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1 cursor-pointer" title="Skip AI quality filter for this source">
                  <span class="text-dimmer text-[0.65rem]">Skip filter</span>
                  <input type="checkbox" class="accent-[var(--accent)]" ${bypassMap[f.key] ? 'checked' : ''} onchange="setQualityBypass('${f.key}', this.checked)">
                </label>
                <label class="cursor-pointer">
                  <span class="toggle-switch">
                    <input type="checkbox" id="toggle-${f.key}" ${sources[f.key] ? 'checked' : ''} onchange="toggleFeedSource('${f.key}', this.checked)">
                    <span class="slider"></span>
                  </span>
                </label>
              </div>
            </div>
          `).join('')}
        `).join('')}
      </div>
    </div>

    <!-- CUSTOM RSS FEEDS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-3">Custom RSS Feeds</h3>
      <div id="custom-feeds-list" class="flex flex-col gap-2 mb-3"></div>
      <div class="flex gap-2">
        <input type="text" id="custom-feed-url" placeholder="https://example.com/feed.xml" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomFeed()}">
        <button onclick="addCustomFeed()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
    </div>

    <!-- BLOCKED WORDS -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <h3 class="text-white_ text-sm font-semibold mb-2">Blocked Words</h3>
      <p class="text-dimmer text-[0.75rem] mb-3">Posts with titles containing any of these words will be automatically hidden.</p>
      <div class="flex gap-2 mb-3">
        <input type="text" id="blocked-word-input" placeholder="e.g. politics, lawsuit, review" class="flex-1 bg-input border border-border-input rounded-md px-3 py-1.5 text-primary text-sm outline-none focus:border-accent" onkeydown="if(event.key==='Enter'){event.preventDefault();addBlockedWord()}">
        <button onclick="addBlockedWord()" class="bg-accent text-white text-sm px-3 py-1.5 rounded-md border-none cursor-pointer hover:bg-accent-hover">Add</button>
      </div>
      <div id="blocked-words-list" class="flex flex-wrap gap-1.5"></div>
    </div>

    <!-- AI QUALITY FILTER -->
    <div class="mb-8 pt-5 border-t border-border-subtle">
      <div class="flex items-center gap-3 mb-1">
        <h3 class="text-white_ text-sm font-semibold">AI Quality Filter</h3>
        <span class="text-dimmer text-[0.68rem]">qwen2.5:7b</span>
        <label class="flex items-center gap-2 cursor-pointer ml-auto">
          <span class="text-primary text-sm">Enable</span>
          <span class="toggle-switch">
            <input type="checkbox" id="toggle-quality-filter" ${isQualityFilterOn() ? 'checked' : ''} onchange="setQualityFilter(this.checked)">
            <span class="slider"></span>
          </span>
        </label>
      </div>
      <p class="text-dim text-[0.8rem] mb-4">Uses a local LLM (Ollama) to hide low-quality posts. Two phases: verdict (KEEP/SKIP), then scoring.</p>

      <div class="mb-5">
        <h4 class="text-muted text-[0.8rem] font-medium mb-2">Verdict Prompt</h4>
        <p class="text-dimmer text-[0.72rem] mb-2">Classifies each post title as KEEP or SKIP.</p>
        <textarea id="quality-prompt-input" rows="6" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-primary text-[0.78rem] font-mono leading-relaxed outline-none focus:border-accent resize-y" spellcheck="false">${escapeHtml(getQualityPrompt())}</textarea>
        <div class="flex items-center justify-end mt-2">
          <button onclick="saveQualityPrompt()" class="bg-accent text-white text-[0.78rem] px-3 py-1 rounded-md border-none cursor-pointer hover:bg-accent-hover">Save prompt</button>
        </div>
      </div>

      <div class="mb-5">
        <h4 class="text-muted text-[0.8rem] font-medium mb-2">Scoring Prompt & Threshold</h4>
        <p class="text-dimmer text-[0.72rem] mb-2">Posts passing the verdict are scored 0–100%. Below threshold = hidden.</p>
        <div id="scoring-prompt-display" class="w-full bg-input border border-border-input rounded-md px-3 py-2 text-dim text-[0.78rem] font-mono leading-relaxed whitespace-pre-wrap mb-3">Loading…</div>
        <div class="flex items-center gap-3">
          <input type="range" id="quality-threshold-slider" min="0" max="100" value="${getQualityThreshold()}" oninput="document.getElementById('quality-threshold-value').textContent=this.value+'%'" onchange="setQualityThreshold(parseInt(this.value))" class="flex-1 accent-[var(--accent)]" />
          <span id="quality-threshold-value" class="text-primary text-sm font-mono w-10 text-right">${getQualityThreshold()}%</span>
        </div>
        <p class="text-dimmer text-[0.68rem] mt-1">Minimum score to display (0% = show all kept, 100% = strictest)</p>
      </div>

      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-muted text-[0.8rem] font-medium">Prompt Test Suite <span class="text-dim font-normal">(<span id="test-title-count">${testTitles.length}</span> titles)</span></h4>
          <button onclick="clearTestTitles()" class="text-dim text-[0.72rem] hover:text-red-400 bg-transparent border-none cursor-pointer">Clear tests</button>
        </div>
        <p class="text-dimmer text-[0.72rem] mb-2">Titles hidden with ✕ are collected here. All should be classified as SKIP.</p>
        <button onclick="runPromptTest()" class="bg-input border border-border-input text-primary text-[0.78rem] px-3 py-1.5 rounded-md cursor-pointer hover:border-accent mb-2">Run test</button>
        <div id="prompt-test-results"></div>
      </div>

      <div class="mb-5">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-muted text-[0.8rem] font-medium">Blocked Posts</h4>
          <button onclick="clearAllBlockedPosts()" class="text-dim text-[0.72rem] hover:text-red-400 bg-transparent border-none cursor-pointer">Clear manual blocks</button>
        </div>
        <div id="quality-blocked-list" class="text-[0.78rem] text-muted max-h-[300px] overflow-y-auto"></div>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-dim text-[0.78rem]">
          Cached: ${cacheEntries.length} &middot; Kept: ${keptCount} &middot; Skipped: ${skippedCount}
        </div>
        <button onclick="resetEverything()" class="text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors">Reset all &amp; clear cache</button>
      </div>
    </div>
  `;

  renderCustomFeedsList();
  renderBlockedWordsList();
  renderBlockedList();
  fetchTestTitlesFromServer().then(() => updateTestTitleCount());
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

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme })
  }).catch(() => {});
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  ['dark', 'light', 'sepia'].forEach(t => {
    const btn = document.getElementById('theme-btn-' + t);
    if (btn) btn.className = `px-3 py-1 rounded-md text-[0.78rem] border cursor-pointer transition-colors ${theme === t ? 'border-accent text-accent bg-accent/10' : 'border-border-input text-muted bg-card hover:border-accent hover:text-primary'}`;
  });
}

function setAccentColor(color) {
  localStorage.setItem('accentColor', color);
  applyAccentColor(color);
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accentColor: color })
  }).catch(() => {});
  // Update swatch borders
  document.querySelectorAll('[onclick^="setAccentColor"]').forEach(btn => {
    const btnColor = btn.style.background;
    const el = btn;
    // Compare by checking if this button's onclick matches
    const isActive = btn.getAttribute('onclick') === `setAccentColor('${color}')`;
    el.className = `w-6 h-6 rounded-full border-2 cursor-pointer transition-transform hover:scale-110 ${isActive ? 'border-white_ scale-110' : 'border-transparent'}`;
  });
}

function applyAccentColor(color) {
  // Compute a lighter hover variant
  const r = parseInt(color.slice(1,3), 16), g = parseInt(color.slice(3,5), 16), b = parseInt(color.slice(5,7), 16);
  const hover = '#' + [Math.min(255, r + 20), Math.min(255, g + 20), Math.min(255, b + 20)].map(v => v.toString(16).padStart(2, '0')).join('');
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover', hover);
}

function applyStoredAppearance() {
  const theme = localStorage.getItem('theme') || 'dark';
  if (theme !== 'dark') document.documentElement.setAttribute('data-theme', theme);
  const accent = localStorage.getItem('accentColor');
  if (accent) applyAccentColor(accent);
}

applyStoredAppearance();

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
      const desc = item.querySelector('description, summary, content')?.textContent || '';
      const author = item.querySelector('author, dc\\:creator')?.textContent?.trim() || '';
      const pubStr = item.querySelector('pubDate, published, updated')?.textContent?.trim() || '';
      const ts = pubStr ? new Date(pubStr) : null;
      return {
        source: sourceName,
        title,
        link,
        authors: author,
        categories: [],
        description: stripHtml(desc).replace(/^\s*Comments\s*$/i, '').slice(0, 300),
        date: ts ? formatDate(ts) : '',
        pubDate: ts ? ts.toUTCString() : '',
        arxivId: null,
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
  document.getElementById('finder-section').style.display = '';
  document.getElementById('home-feed-section').style.display = '';
  const sources = getFeedSources();
  if (allPapers.length > 0) {
    _previousPostLinks = new Set(allPapers.map(p => p.link));
  }
  allPapers = [];
  const promises = [];
  const labels = [];

  FEED_CATALOG.forEach(f => {
    if (!sources[f.key]) return;
    if (f.special === 'arxiv') { promises.push(fetchFeed()); }
    else if (f.special === 'hn') { promises.push(fetchHNFeed()); }
    else if (f.special === 'polymarket') { promises.push(fetchPolymarketFeed()); }
    else { promises.push(fetchGenericRSS(f.url, f.key)); }
    labels.push(f.key);
  });

  const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
  for (const cf of customFeeds) {
    promises.push(fetchGenericRSS(cf.url, 'custom:' + cf.name));
    labels.push('custom');
  }

  // Show centered loading animation
  const container = document.getElementById('papers');
  const loadFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let _loadFi = 0;
  container.innerHTML = `<div style="column-span:all" class="flex items-center justify-center h-[60vh]"><span id="feed-load-anim" class="text-dim text-[1.4rem] font-mono"></span></div>`;
  const _loadAnim = setInterval(() => {
    const el = document.getElementById('feed-load-anim');
    if (el) el.textContent = loadFrames[_loadFi++ % loadFrames.length];
  }, 80);

  const results = await Promise.all(promises);
  clearInterval(_loadAnim);
  if (abort.signal.aborted) return;
  const MAX_PER_SOURCE = 100;
  for (let i = 0; i < results.length; i++) {
    const items = results[i];
    if (Array.isArray(items) && items.length) {
      allPapers = allPapers.concat(items.slice(0, MAX_PER_SOURCE));
    }
  }
  renderTrends();
  renderPapers();
  if (isQualityFilterOn()) qualityFilterPapers();
  startRefreshTimer();
}

function extractArxivId(link) {
  const m = link.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
  return m ? m[1] : null;
}

function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const arxivItems = Array.from(doc.querySelectorAll('item')).map(item => {
    const title = (item.querySelector('title')?.textContent || '').trim();
    const link = (item.querySelector('link')?.textContent || '').trim();
    const description = (item.querySelector('description')?.textContent || '').trim();
    const creators = item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator');
    const authors = Array.from(creators).map(c => c.textContent.trim()).join(', ') || extractAuthors(description);
    const categories = Array.from(item.querySelectorAll('category')).map(c => c.textContent.trim());
    categories.forEach(c => allCategories.add(c));
    const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';
    const dateStr = pubDate ? formatDate(new Date(pubDate)) : '';
    const arxivId = extractArxivId(link);
    const cleanDesc = stripHtml(description).replace(/^arXiv:\S+\s+Announce Type:\s*\w+\s+Abstract:\s*/i, '');
    return { source: 'arxiv', title, link, authors, categories, description: cleanDesc, date: dateStr, pubDate, arxivId };
  });
  return arxivItems;
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

function getFilteredPapers() {
  const search = document.getElementById('search').value.toLowerCase();
  const category = document.getElementById('category').value;
  const hidden = new Set(getHiddenPosts());
  const _blockedWordsSet = new Set(getBlockedWords());
  const qfOn = isQualityFilterOn();
  const qCache = qfOn ? getQualityCache() : {};
  const bypass = qfOn ? getQualityBypass() : {};
  let filtered = allPapers.filter(p => {
    if (hiddenSourceFilters.has(p.source)) return false;
    if (hidden.has(p.link)) return false;
    if (_blockedWordsSet.size > 0) {
      const titleLower = p.title.toLowerCase();
      for (const w of _blockedWordsSet) {
        if (titleLower.includes(w)) return false;
      }
    }
    const bypassed = bypass[p.source];
    if (qfOn && !bypassed && !(p.title in qCache)) return false;
    if (qfOn && !bypassed && (p.title in qCache)) {
      const entry = qCache[p.title];
      const verdict = entry?.v ?? entry;
      if (verdict === 'skip') return false;
      if (verdict === 'keep' && entry?.s != null && entry.s < getQualityThreshold()) return false;
    }
    if (category && !p.categories.includes(category)) return false;
    if (search) {
      const h = `${p.title} ${p.authors} ${p.description}`.toLowerCase();
      return search.split(/\s+/).filter(Boolean).every(t => h.includes(t));
    }
    return true;
  });
  if (currentSort === 'citations') {
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
  // Interleave sources so no single source dominates a run
  const bySource = {};
  for (const p of filtered) {
    (bySource[p.source] || (bySource[p.source] = [])).push(p);
  }
  const sources = Object.keys(bySource);
  if (sources.length > 1) {
    const interleaved = [];
    const indices = {};
    sources.forEach(s => indices[s] = 0);
    let si = 0;
    while (interleaved.length < filtered.length) {
      const s = sources[si % sources.length];
      if (indices[s] < bySource[s].length) {
        interleaved.push(bySource[s][indices[s]++]);
      }
      si++;
      if (sources.every(s => indices[s] >= bySource[s].length)) break;
    }
    filtered = interleaved;
  }
  return filtered;
}

function renderPapers() {
  const filtered = getFilteredPapers();
  lastFilteredPapers = filtered;
  const visible = filtered.slice(0, visibleCount);
  const qfOn = isQualityFilterOn();
  const qCache = qfOn ? getQualityCache() : {};
  const hiddenSet = new Set(getHiddenPosts());
  const bypass = qfOn ? getQualityBypass() : {};
  const pendingCount = qfOn ? allPapers.filter(p => !hiddenSet.has(p.link) && !bypass[p.source] && !(p.title in qCache)).length : 0;
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
  if (!filtered.length && pendingCount > 0) { container.innerHTML = '<div class="text-center py-20 text-dim text-[0.85rem]"><span class="animate-pulse">●</span> Evaluating posts…</div>'; return; }
  if (!filtered.length) { container.innerHTML = '<div class="text-center py-20 text-dim">No papers match your filter.</div>'; return; }
  if (feedViewMode === 'compact') {
    container.innerHTML = `<div style="column-span:all" class="flex flex-col">` + visible.map((p, i) => {
      const sourceChip = getSourceChip(p.source, p.arxivId);
      const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
      const newDot = isNew ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>' : '';
      const date = p.date ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(p.date)}</span>` : '';
      return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors group" onclick="openPaper(${i})">
        ${newDot}${sourceChip}
        <span class="text-[0.82rem] text-primary truncate">${renderTitle(p.title)}</span>
        <span class="ml-auto flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary transition-colors" onclick="event.stopPropagation(); toggleSavePost(lastFilteredPapers[${i}], event)"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="${isPostSaved(p.link) ? 'var(--accent)' : 'none'}" stroke="${isPostSaved(p.link) ? 'var(--accent)' : 'currentColor'}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg></button>
          <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary transition-colors" onclick="openCardMenu(this, event, ${i})"><svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
        </span>
        ${date}
      </div>`;
    }).join('') + `</div>`;
  } else {
    container.innerHTML = visible.map((p, i) => {
      const isHN = p.source === 'hn';
      const isArxiv = p.source === 'arxiv';
      const sourceChip = getSourceChip(p.source, p.arxivId);
      const aiEntry = qfOn ? qCache[p.title] : null;
      const aiVerdict = aiEntry?.v || aiEntry;
      const aiScore = aiEntry?.s;
      const aiChip = qfOn && aiVerdict === 'keep' ? `<span class="inline-flex items-center gap-0.5 text-[0.68rem]" title="AI quality score: ${aiScore != null ? aiScore + '%' : 'scoring…'}">${aiScore != null ? `<span class="text-dim">${aiScore}%</span>` : '<span class="text-dim animate-pulse">…</span>'}<span class="text-green-500">&#10003;</span></span>` : '';
      const isPoly = p.source === 'polymarket';
      const statsChips = isHN
        ? `<span class="text-[0.68rem] text-dim">${p.hnScore} pts</span>`
        : isPoly
        ? `<span class="text-[0.68rem] font-semibold ${p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400'}">${p.polyYesPct}%</span>`
        : (p.citations !== undefined ? `<span class="text-[0.68rem] text-dim">${p.citations} cited</span>` : '');
      const catChips = (isPoly || isArxiv) ? '' : p.categories.slice(0,3).map(c => `<span class="text-[0.68rem] bg-cat-tag text-cat-tag-color px-[7px] py-0.5 rounded border border-border-subtle">${escapeHtml(c)}</span>`).join('');
      const dateChip = p.date ? `<span class="text-[0.68rem] text-dim">${escapeHtml(p.date)}</span>` : '';
      const snippet = isPoly ? '' : (p.description ? truncate(p.description, 120) : '');
      const isSaved = isPostSaved(p.link);
      const bmFill = isSaved ? 'var(--accent)' : 'none';
      const bmStroke = isSaved ? 'var(--accent)' : 'currentColor';
      const actionBtns = `<div class="absolute top-3 right-3 flex items-center z-10">
        ${dateChip ? `<span class="text-[0.68rem] text-dim mr-1.5">${escapeHtml(p.date)}</span>` : ''}
        <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary transition-colors" onclick="event.stopPropagation(); toggleSavePost(lastFilteredPapers[${i}], event)" title="${isSaved ? 'Remove from Reading List' : 'Save to Reading List'}"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="${bmFill}" stroke="${bmStroke}" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg></button>
        <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary transition-colors" onclick="openCardMenu(this, event, ${i})"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
      </div>`;
      const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
      const newDot = isNew ? '<span class="inline-block w-2 h-2 rounded-full bg-accent mr-1 shrink-0" title="New"></span>' : '';
      return `
      <div class="paper break-inside-avoid bg-card border border-border-card rounded-xl p-4 mb-3.5 cursor-pointer transition-all duration-150 relative" onclick="openPaper(${i})">
        ${actionBtns}
        <div class="flex gap-1.5 flex-wrap items-center mb-2 pr-20">${newDot}${sourceChip}${aiChip}${statsChips}${catChips}</div>
        <div class="text-[0.92rem] font-semibold text-primary mb-1.5 leading-snug pr-12">${renderTitle(p.title)}</div>
        ${snippet ? `<div class="text-[0.78rem] text-muted leading-relaxed">${escapeHtml(snippet)}</div>` : ''}
      </div>`;
    }).join('');
  }
  fetchCitationsFor(visible);
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

// Feed loading is triggered by goHome() via routing
