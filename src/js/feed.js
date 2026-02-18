if (window.AetherUI) AetherUI.globals();

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
  return new Set(getLS('seenPostLinks', []));
}
function _setSeenPostLinks(set) {
  setLS('seenPostLinks', [...set]);
}
function _getFeedNotifications() {
  return getLS('feedNotifications', []);
}
function _setFeedNotifications(arr) {
  setLS('feedNotifications', arr);
}

function _getFeedNotifSources() {
  return getLS('feedNotifSources', {});
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
    const prevLen = existingLinks.size;
    if (notifications.length > 50) notifications.splice(0, notifications.length - 50);
    _setFeedNotifications(notifications);
    const newCount = notifications.length - prevLen;
    if (newCount > 0) {
      islandUpdate('feed-notif', {
        type: 'feed-notif',
        label: newCount + ' new',
        detail: newCount + ' new post' + (newCount === 1 ? '' : 's'),
        done: true,
        action: function() { location.hash = '#inbox'; islandRemove('feed-notif'); }
      });
    }
  }

  // Mark all current links as seen
  const updatedSeen = new Set(seen);
  for (const p of allPapers) {
    if (p.link) updatedSeen.add(p.link);
  }
  _setSeenPostLinks(updatedSeen);
}

function clearFeedNotification(link) {
  const notifications = _getFeedNotifications().filter(n => n.link !== link);
  _setFeedNotifications(notifications);
}

function getHiddenPosts() {
  return getLS('hiddenPosts', []);
}
function getReadPosts() {
  return getLS('readPosts', []);
}
function markPostAsRead(link) {
  const read = getReadPosts();
  if (!read.includes(link)) { read.push(link); setLS('readPosts', read); }
  // Capture read article into living context
  if (typeof contextIngest === 'function') {
    var paper = allPapers.find(function(p) { return p.link === link; });
    if (paper) {
      contextIngest('feed', '## Reading', '- Read: [' + (paper.title || 'Untitled') + '](' + link + ')', { dedupeKey: 'read-' + link });
    }
  }
}

function _menuBtn(label, fn) {
  var b = new View('button');
  b.el.textContent = label;
  b.el.addEventListener('mousedown', function(e) { e.stopPropagation(); fn(); });
  return b;
}

function openCardMenu(btn, ev, index) {
  ev.stopPropagation();
  ev.preventDefault();
  closeCardMenu();
  const p = lastFilteredPapers[index];
  if (!p) return;
  const sourceKey = p.source;
  const sourceName = SOURCE_NAMES[p.source] || p.source;

  var menu = document.createElement('div');
  menu.id = 'card-menu-portal';
  menu.className = 'card-menu';
  var menuItems = VStack(
    _menuBtn('Block post', function() { hidePost(p.link, p.title); closeCardMenu(); }),
    _menuBtn('Unsubscribe from ' + sourceName, function() { unsubscribeSource(sourceKey); closeCardMenu(); })
  );
  menu.appendChild(menuItems.build());
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
  setLS('hiddenPosts', hidden);
  if (title) addTestTitle(title);
  if (!Settings.get('ach_curator')) {
    Settings.set('ach_curator', '1');
    if (typeof showAchievement === 'function') showAchievement('Curator', 'Curated your feed by hiding a post');
  }
  renderPapers();
}
// ── Blocked Words ──
function getBlockedWords() {
  return getLS('blockedWords', []);
}
function setBlockedWords(words) {
  setLS('blockedWords', words);
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
  var el = document.getElementById('blocked-words-list');
  if (!el) return;
  var words = getBlockedWords();
  if (!words.length) {
    AetherUI.mount(Text('No blocked words yet.').className('text-dimmer text-[0.75rem]'), el);
    return;
  }
  var chips = words.map(function(w) {
    var btn = new View('button').className('text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-sm leading-none ml-0.5');
    btn.el.textContent = '\u00d7';
    btn.onTap(function() { removeBlockedWord(w); });
    return HStack(
      Text(w),
      btn
    ).spacing(1).className('inline-flex items-center bg-input border border-border-input rounded-full px-2.5 py-0.5 text-primary text-[0.78rem]');
  });
  var wrap = new View('div');
  wrap.el.className = 'flex flex-wrap gap-1.5';
  chips.forEach(function(c) { wrap.el.appendChild(c.build()); });
  AetherUI.mount(wrap, el);
}

// ── Offline caching ──

function getOfflineCachedSet() {
  return new Set(getLS('offlineCached', []));
}

function isPostCached(link) {
  return getOfflineCachedSet().has(link);
}

async function cachePostOffline(link, paper, btnEl) {
  if (isPostCached(link)) return;
  if (btnEl) {
    AetherUI.mount(Text('Caching\u2026').className('text-dimmer text-[0.7rem]'), btnEl);
    btnEl.disabled = true;
  }
  try {
    const { text } = await apiPost('/api/extract-text', { url: link });
    if (!text || text.length < 50) throw new Error('no content');
    await apiPost('/api/saved-content', { url: link, title: paper?.title || '', text, savedAt: Date.now() });
    const cached = getOfflineCachedSet();
    cached.add(link);
    setLS('offlineCached', [...cached]);
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
  return icon('download', {size: 14, class: 'text-dimmer'});
}

function _offlineCachedIcon() {
  return icon('checkCircle', {size: 14, class: 'text-green-400'});
}

function getSavedPosts() {
  return getLS('savedPosts', {});
}
function savePosts(data) { setLS('savedPosts', data); }
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
    // Capture saved article into living context
    if (typeof contextIngest === 'function') {
      contextIngest('feed', '## Reading', '- Saved: [' + (paper.title || 'Untitled') + '](' + paper.link + ')', { dedupeKey: 'saved-' + paper.link });
    }
    if (event) _showBookmarkFly(event);
    const _bmTitle = (paper.title || '').length > 40 ? paper.title.slice(0, 38) + '\u2026' : (paper.title || 'Saved');
    islandUpdate('bookmark', { type: 'bookmark', label: 'Saved', detail: _bmTitle });
    setTimeout(function() { islandRemove('bookmark'); }, 2500);
    if (!Settings.get('ach_bookworm')) {
      Settings.set('ach_bookworm', '1');
      if (typeof showAchievement === 'function') showAchievement('Bookworm', 'Saved your first post');
    }
  }
}

function _showBookmarkFly(event) {
  // Flying bookmark icon from click position to pill island
  const target = document.getElementById('pill-island') || document.getElementById('sb-dashboard');
  if (target) {
    const iconEl = document.createElement('div');
    iconEl.innerHTML = window.icon('bookmark', {size: 24, fill: 'var(--nr-accent)', stroke: 'var(--nr-accent)'});
    iconEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;transition:all 0.5s cubic-bezier(0.4,0,0.2,1);';
    const startX = event.clientX - 12;
    const startY = event.clientY - 12;
    iconEl.style.left = startX + 'px';
    iconEl.style.top = startY + 'px';
    iconEl.style.opacity = '1';
    document.body.appendChild(iconEl);
    const tr = target.getBoundingClientRect();
    requestAnimationFrame(() => {
      iconEl.style.left = (tr.left + tr.width / 2 - 8) + 'px';
      iconEl.style.top = (tr.top + tr.height / 2 - 8) + 'px';
      iconEl.style.opacity = '0';
      iconEl.style.transform = 'scale(0.3)';
    });
    setTimeout(() => iconEl.remove(), 550);
  }
}

function markPostRead(link) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  saved[link].read = true;
  savePosts(saved);
  updateSavedBadge();
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
const allCategories = new Set();
const citationMap = {};
let currentSort = 'foryou';
const PAGE_SIZE = 20;
let visibleCount = PAGE_SIZE;
const hiddenSourceFilters = new Set();
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
    setLS('feedSources', sources);
  }
  // Check custom feeds
  const custom = getCustomFeeds();
  const idx = custom.findIndex(f => f.url === key || f.name === key);
  if (idx !== -1) {
    custom[idx].enabled = false;
    Settings.setJSON('customFeeds', custom);
  }
  // Remove posts from this source and re-render
  allPapers = allPapers.filter(p => p.source !== key);
  renderSourceBubbles();
  renderPapers();
}

function renderSourceBubbles() {
  var el = document.getElementById('source-bubbles');
  if (!el) return;
  var sourceCounts = {};
  for (var _i = 0; _i < allPapers.length; _i++) {
    var _p = allPapers[_i];
    sourceCounts[_p.source] = (sourceCounts[_p.source] || 0) + 1;
  }
  var sources = Object.keys(sourceCounts);
  var catSelect = document.getElementById('category');
  var currentCat = catSelect ? catSelect.value : '';
  var bubbleViews = [];

  sources.forEach(function(key) {
    var entry = FEED_CATALOG.find(function(f) { return f.key === key; });
    var name = entry ? entry.name : (key.startsWith('custom:') ? key.slice(7) : key);
    var logo = SOURCE_LOGO_INLINE[key] || '';
    var count = sourceCounts[key];
    var dimmed = hiddenSourceFilters.has(key);

    if (key === 'arxiv' && catSelect) {
      var opts = Array.from(catSelect.options);
      var selectOpts = opts.map(function(o) {
        var label = o.value ? o.textContent : 'arXiv (' + count + ')';
        return '<option value="' + escapeHtml(o.value) + '"' + (o.value === currentCat ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
      }).join('');
      var arxivBubble = RawHTML('<span class="inline-flex items-center rounded-full border ' + (dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15') + ' text-[0.78rem] transition-all duration-150 whitespace-nowrap select-none"><span class="inline-flex items-center pl-2.5 pointer-events-none">' + logo + '</span><select class="arxiv-cat-select bg-transparent border-none text-[0.78rem] ' + (dimmed ? 'text-dim' : 'text-primary') + ' cursor-pointer outline-none appearance-none py-1 pl-1 pr-5" onchange="document.getElementById(\'category\').value=this.value; renderPapers(); renderSourceBubbles(); _fitArxivSelect(this)">' + selectOpts + '</select></span>');
      bubbleViews.push(arxivBubble);
    } else {
      var bubble = HStack(
        logo ? RawHTML(logo) : null,
        Text(name).className(dimmed ? 'text-dim' : 'text-primary'),
        Text(String(count)).className('text-[0.68rem] ' + (dimmed ? 'text-dimmer' : 'text-dim'))
      ).spacing(1).className('inline-flex items-center px-2.5 py-1 rounded-full border ' + (dimmed ? 'border-border-subtle bg-card opacity-40' : 'border-accent bg-accent/15') + ' text-[0.78rem] cursor-pointer transition-all duration-150 whitespace-nowrap select-none')
        .onTap(function() { toggleSourceBubble(key); });
      bubbleViews.push(bubble);
    }
  });

  var wrap = HStack.apply(null, bubbleViews).className('flex-wrap gap-1.5');
  AetherUI.mount(wrap, el);
  // Auto-size the arxiv select after rendering
  var arxivSel = el.querySelector('.arxiv-cat-select');
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

async function fetchHNFeed() {
  try {
    const stories = await apiGet('/hn-feed');
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
    const markets = await apiGet('/polymarket-feed');
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

function hasOnboarded() { return Settings.get('feedSources') !== null; }

const onboardSelected = new Set();
const onboardNotifSelected = new Set();

/* === Honeycomb globals === */
const _hcPanX = 0, _hcPanY = 0;
const _hcDragging = false, _hcDragStartX = 0, _hcDragStartY = 0, _hcPanStartX = 0, _hcPanStartY = 0;
const _hcDidDrag = false;
const _hcCircleEls = [];
const _hcPositions = []; // {x, y, key}
const _hcRafId = 0;
const _hcMouseX = 0, _hcMouseY = 0;
const _hcListenersAttached = false;
let _hcActiveCategory = null; // null = All
const _hcHoveredIdx = -1;
const _hcZoom = 1;

function _renderHcCategoryTabs() {
  var container = document.getElementById('hc-category-tabs');
  if (!container) return;
  var cats = [];
  FEED_CATALOG.forEach(function(f) { if (!cats.includes(f.cat)) cats.push(f.cat); });
  var tabs = [
    new View('button').className('hc-tab' + (_hcActiveCategory === null ? ' active' : ''))
      .onTap(function() { _hcSelectCategory(null); })
  ];
  tabs[0].el.textContent = 'All';
  cats.forEach(function(cat) {
    var tab = new View('button').className('hc-tab' + (_hcActiveCategory === cat ? ' active' : ''));
    tab.el.textContent = cat;
    tab.onTap(function() { _hcSelectCategory(cat); });
    tabs.push(tab);
  });
  var wrap = HStack(tabs).spacing(1);
  AetherUI.mount(wrap, container);
}

function _hcSelectCategory(cat) {
  _hcActiveCategory = cat;
  _renderHcCategoryTabs();
  renderOnboardGrid();
  _updateOnboardCardStates();
}

function renderOnboardGrid() {
  var grid = document.getElementById('onboard-grid');
  var entries = _hcActiveCategory
    ? FEED_CATALOG.filter(function(f) { return f.cat === _hcActiveCategory; })
    : FEED_CATALOG;

  // Group by category
  var byCategory = {};
  entries.forEach(function(f) {
    if (!byCategory[f.cat]) byCategory[f.cat] = [];
    byCategory[f.cat].push(f);
  });

  var sections = [];
  Object.keys(byCategory).forEach(function(cat) {
    var items = byCategory[cat];
    var allOn = items.every(function(f) { return onboardSelected.has(f.key); });
    var toggleBtn = new View('button').className('text-[0.68rem] text-dimmer hover:text-primary cursor-pointer bg-transparent border-none transition-colors');
    toggleBtn.el.textContent = allOn ? 'Deselect all' : 'Select all';
    toggleBtn.onTap(function() { _toggleOnboardCategory(cat); });

    var header = HStack(
      Text(cat).className('text-[0.72rem] text-dim uppercase tracking-wider font-medium'),
      new View('span').className('flex-1 h-px bg-border-subtle'),
      toggleBtn
    ).spacing(2).className('mb-1.5 px-1');

    var itemViews = items.map(function(f) {
      var sel = onboardSelected.has(f.key);
      var iconHtml = f.favicon
        ? '<img src="https://www.google.com/s2/favicons?domain=' + f.favicon + '&sz=32" class="w-5 h-5 rounded" onerror="this.outerHTML=\'<span class=\\\'inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold\\\' style=\\\'background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '\\\'>' + (f.letter || f.name[0]) + '</span>\'">'
        : '<span class="inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold" style="background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>';
      var checkHtml = sel ? icon('check', {size: 12, class: 'w-3 h-3 text-white', strokeWidth: '3'}) : '';
      return HStack(
        RawHTML(iconHtml),
        VStack(
          Text(f.name).className('text-[0.82rem] font-medium ' + (sel ? 'text-primary' : 'text-muted') + ' truncate'),
          Text(f.desc).className('text-[0.7rem] text-dimmer truncate')
        ).className('flex-1 min-w-0'),
        RawHTML('<div class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ' + (sel ? 'border-accent bg-accent' : 'border-border-input bg-transparent') + '">' + checkHtml + '</div>')
      ).spacing(2).className('onboard-source flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors hover:bg-hover' + (sel ? ' onboard-selected' : ''))
        .attr('data-source', f.key)
        .onTap(function() { toggleOnboardSource(f.key); });
    });

    var section = VStack([header].concat(itemViews)).className('mb-4');
    sections.push(section);
  });

  AetherUI.mount(VStack(sections), grid);
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
  // Hide top pill bar during onboarding
  const pillBar = document.getElementById('sidebar-nav');
  if (pillBar) pillBar.style.display = 'none';
  renderCustomFeedsList();
}

function completeOnboarding() {
  const sources = {};
  const notifSources = {};
  FEED_CATALOG.forEach(f => {
    sources[f.key] = onboardSelected.has(f.key);
    notifSources[f.key] = onboardNotifSelected.has(f.key);
  });
  setLS('feedSources', sources);
  setLS('feedNotifSources', notifSources);
  document.getElementById('onboard-view').style.display = 'none';
  document.getElementById('home-feed-section').style.display = '';
  // Show top pill bar after onboarding
  const pillBar = document.getElementById('sidebar-nav');
  if (pillBar) pillBar.style.display = '';
  loadAllFeeds();
}

function getFeedSources() {
  return { ...FEED_SOURCE_DEFAULTS, ...getLS('feedSources', {}) };
}

function getCustomFeeds() {
  return getLS('customFeeds', []);
}

function renderCustomFeedsList() {
  var list = document.getElementById('custom-feeds-list');
  if (!list) return;
  var feeds = getCustomFeeds();
  if (!feeds.length) { AetherUI.mount(Text('No custom feeds added.').className('text-dim text-[0.78rem]'), list); return; }
  var rows = feeds.map(function(f, i) {
    var toggle = RawHTML('<span class="nr-switch"><input type="checkbox" ' + (f.enabled !== false ? 'checked' : '') + '><span class="slider"></span></span>');
    toggle.el.querySelector('input').addEventListener('change', function() { toggleCustomFeed(i, this.checked); });
    var removeBtn = new View('button').className('text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-base leading-none').attr('title', 'Remove');
    removeBtn.el.textContent = '\u00d7';
    removeBtn.onTap(function() { removeCustomFeed(i); });
    return HStack(
      Text(f.name || f.url).className('text-primary text-[0.78rem] truncate flex-1').attr('title', f.url),
      HStack(toggle, removeBtn).spacing(2).className('shrink-0')
    ).spacing(2).className('flex items-center justify-between bg-input rounded-md px-3 py-2');
  });
  AetherUI.mount(VStack(rows).spacing(2), list);
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
  try { name = new URL(url).hostname.replace(/^www\./, '').replace(/^api\./, ''); } catch (e) { /* fire-and-forget */ }
  try {
    const result = await apiGet(`/api/rss-proxy?url=${encodeURIComponent(url)}`);
    const xml = result && result._proxy ? atob(result.data) : '';
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const feedTitle = (doc.querySelector('channel > title, feed > title')?.textContent || '').trim();
    if (feedTitle) name = feedTitle;
  } catch (e) { /* fire-and-forget */ }
  feeds.push({ url, name, enabled: true });
  setLS('customFeeds', feeds);
  input.value = '';
  renderCustomFeedsList();
  allPapers = [];
  loadAllFeeds();
}

function removeCustomFeed(index) {
  const feeds = getCustomFeeds();
  feeds.splice(index, 1);
  setLS('customFeeds', feeds);
  renderCustomFeedsList();
  allPapers = [];
  loadAllFeeds();
}

function toggleCustomFeed(index, enabled) {
  const feeds = getCustomFeeds();
  feeds[index].enabled = enabled;
  setLS('customFeeds', feeds);
  allPapers = [];
  loadAllFeeds();
}



function renderAlgorithmView() {
  var container = document.getElementById('algorithm-view-content');
  if (!container) return;

  var profile = typeof getInterestProfile === 'function' ? getInterestProfile() : null;
  var readCount = getReadPosts().length;
  var savedCount = Object.keys(getSavedPosts()).length;
  var hiddenCount = getHiddenPosts().length;
  var topTopics = profile ? (profile.topTopics || []) : [];
  var topCats = profile ? (profile.topCategories || []) : [];

  var wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
  var wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
  var wRec = parseFloat(Settings.get('fyWeightRecency') || '1.0');
  var maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10);

  var exampleLlm = 72, exampleAff = 0.8, exampleAge = 3;
  var exampleRecency = Math.max(0, 10 - exampleAge * 0.5) * wRec;
  var exampleScore = (exampleLlm * (wBase + exampleAff * wAff) + exampleRecency).toFixed(1);

  var topicsHtml = topTopics.length ? topTopics.map(function(t) { return '<span class="bg-hover text-dim text-[0.68rem] px-1.5 py-0.5 rounded">' + escapeHtml(t) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';
  var catsHtml = topCats.length ? topCats.map(function(c) { return '<span class="bg-accent/10 text-accent text-[0.68rem] px-1.5 py-0.5 rounded border border-accent/20">' + escapeHtml(c) + '</span>'; }).join('') : '<span class="text-dimmer text-[0.68rem]">Not enough data yet</span>';

  function _algoSlider(label, id, min, max, value, onInput, onChange) {
    var slider = new View('input');
    slider.el.type = 'range'; slider.el.min = min; slider.el.max = max; slider.el.value = value;
    slider.el.className = 'flex-1 accent-[var(--nr-accent)]';
    slider.el.addEventListener('input', onInput);
    slider.el.addEventListener('change', onChange);
    return HStack(
      Text(label).className('text-dim text-[0.72rem] w-16 shrink-0'),
      slider,
      Text(String(typeof value === 'number' && max <= 10 ? value : (value / 100).toFixed(2))).id(id).className('text-dim text-[0.68rem] tabular-nums w-8 text-right')
    ).spacing(3);
  }


  var resetBtn = new View('button').className('text-red-400/80 text-[0.78rem] hover:text-red-400 bg-transparent border border-red-400/30 hover:border-red-400/60 rounded-md px-3 py-1 cursor-pointer transition-colors');
  resetBtn.el.textContent = 'Reset all personalization';
  resetBtn.onTap(function() { resetPersonalization(); renderAlgorithmView(); });

  var view = VStack(
    RawHTML('<h2 class="text-[1.3rem] font-semibold text-white_ mb-1">How the Algorithm Works</h2>'),
    Text('Your feed is ranked using a personalized composite score that combines LLM relevance scoring, source affinity from your reading habits, and recency.').className('text-dim text-[0.8rem] mb-6'),

    // 1. LLM Relevance
    VStack(
      RawHTML('<h3 class="text-muted text-[0.85rem] font-medium mb-2">1. LLM Relevance Score</h3>'),
      Text('Every post that passes the verdict filter (KEEP/SKIP) is scored 0\u2013100 by a local LLM (qwen3:8b). The scoring prompt asks the model to rate how interesting and relevant the post title is.').className('text-dim text-[0.78rem] leading-relaxed mb-2'),
      Text('When you have an interest profile, your top topics and categories are appended to the scoring prompt, so the LLM boosts scores for content matching your interests while still scoring objectively.').className('text-dim text-[0.78rem] leading-relaxed')
    ).className('mb-6'),

    // 2. Interest Profile
    RawHTML('<div class="mb-6 pt-5 border-t border-border-subtle"><h3 class="text-muted text-[0.85rem] font-medium mb-2">2. Interest Profile</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">Built automatically from your reading behavior. Recomputed every 5 minutes.</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.75rem] space-y-2 mb-3"><div class="flex justify-between"><span class="text-dim">Posts read</span><span class="text-primary font-mono">' + readCount + '</span></div><div class="flex justify-between"><span class="text-dim">Posts saved</span><span class="text-primary font-mono">' + savedCount + '</span></div><div class="flex justify-between"><span class="text-dim">Posts hidden</span><span class="text-primary font-mono">' + hiddenCount + '</span></div></div><div class="space-y-2 text-[0.75rem]"><div><span class="text-dimmer text-[0.68rem]">Signal weights for topic extraction:</span><div class="text-dim mt-1">Read = <span class="text-primary">1x</span> &middot; Saved = <span class="text-primary">3x</span> &middot; Rated = <span class="text-primary">rating value</span> &middot; Hidden = negative signal</div></div><div><span class="text-dimmer text-[0.68rem]">Your top topics:</span><div class="flex flex-wrap gap-1 mt-1">' + topicsHtml + '</div></div><div><span class="text-dimmer text-[0.68rem]">Your top categories:</span><div class="flex flex-wrap gap-1 mt-1">' + catsHtml + '</div></div></div></div>'),

    // 3. Source Affinity
    RawHTML('<div class="mb-6 pt-5 border-t border-border-subtle"><h3 class="text-muted text-[0.85rem] font-medium mb-2">3. Source Affinity</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">Each feed source gets an affinity score (0.1\u20131.0) based on how often you engage with its posts. Sources you read, save, and rate highly get boosted. Sources you frequently hide get penalized.</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.72rem] font-mono mb-3"><div class="text-dim mb-1">engagement = (read + saved\u00d72 + rated\u00d73) / total</div><div class="text-dim mb-1">penalty = (hidden / total) \u00d7 0.5</div><div class="text-primary">affinity = clamp(engagement \u2212 penalty, 0.1, 1.0)</div><div class="text-dimmer text-[0.65rem] mt-1">Sources with &lt;3 posts default to 0.5</div></div></div>'),

    // 4. Composite Score
    RawHTML('<div class="mb-6 pt-5 border-t border-border-subtle"><h3 class="text-muted text-[0.85rem] font-medium mb-2">4. Composite Score</h3><p class="text-dim text-[0.78rem] leading-relaxed mb-3">When you use the &quot;For You&quot; sort, each post is ranked by a composite score combining all signals:</p><div class="bg-input border border-border-input rounded-lg p-3 text-[0.78rem] font-mono mb-3"><div class="text-accent">score = LLM \u00d7 (base + affinity \u00d7 aff_weight) + recency_boost \u00d7 rec_weight</div></div><div class="space-y-1.5 text-[0.75rem] text-dim mb-4"><div><span class="text-dimmer">LLM:</span> Quality score from local model (0\u2013100)</div><div><span class="text-dimmer">base:</span> Baseline multiplier \u2014 how much the LLM score matters on its own</div><div><span class="text-dimmer">affinity \u00d7 aff_weight:</span> Bonus for sources you engage with often</div><div><span class="text-dimmer">recency_boost:</span> max(0, 10 \u2212 age_hours \u00d7 0.5) \u2014 decays over 20h, max +10</div><div><span class="text-dimmer">rec_weight:</span> How much recency matters relative to quality</div></div><div class="bg-input border border-border-input rounded-lg p-3 mb-4"><div class="text-dimmer text-[0.68rem] mb-2">Example: LLM=' + exampleLlm + ', affinity=' + exampleAff + ', age=' + exampleAge + 'h</div><div class="text-[0.75rem] font-mono text-dim">' + exampleLlm + ' \u00d7 (' + wBase.toFixed(2) + ' + ' + exampleAff + ' \u00d7 ' + wAff.toFixed(2) + ') + ' + exampleRecency.toFixed(1) + ' = <span class="text-accent font-semibold">' + exampleScore + '</span></div></div></div>'),

    // Weight sliders
    VStack(
      Text('Current weights').className('text-dimmer text-[0.68rem] mb-2'),
      _algoSlider('Base', 'algo-base-val', 0, 100, Math.round(wBase * 100),
        function() { document.getElementById('algo-base-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightBase', (this.value / 100).toFixed(2)); renderPapers(); renderAlgorithmView(); }),
      _algoSlider('Affinity', 'algo-aff-val', 0, 100, Math.round(wAff * 100),
        function() { document.getElementById('algo-aff-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightAffinity', (this.value / 100).toFixed(2)); renderPapers(); renderAlgorithmView(); }),
      _algoSlider('Recency', 'algo-rec-val', 0, 200, Math.round(wRec * 100),
        function() { document.getElementById('algo-rec-val').textContent = (this.value / 100).toFixed(2); },
        function() { Settings.set('fyWeightRecency', (this.value / 100).toFixed(2)); renderPapers(); renderAlgorithmView(); })
    ).spacing(2),

    // 5. Category Diversity
    VStack(
      RawHTML('<h3 class="text-muted text-[0.85rem] font-medium mb-2">5. Category Diversity</h3>'),
      RawHTML('<p class="text-dim text-[0.78rem] leading-relaxed mb-3">After scoring, posts are reordered to prevent any single category from dominating a run. If more than <span class="text-primary">' + maxRun + '</span> consecutive posts come from the same category, a post from a different category is pulled forward.</p>'),
      (function() {
        var s = new View('input');
        s.el.type = 'range'; s.el.min = '1'; s.el.max = '10'; s.el.value = maxRun;
        s.el.className = 'flex-1 accent-[var(--nr-accent)]';
        s.el.addEventListener('input', function() { document.getElementById('algo-div-val').textContent = this.value; });
        s.el.addEventListener('change', function() { Settings.set('maxPerCategoryRun', this.value); renderPapers(); renderAlgorithmView(); });
        return HStack(
          Text('Max same-category run').className('text-dim text-[0.72rem] shrink-0'),
          s,
          Text(String(maxRun)).id('algo-div-val').className('text-dim text-[0.68rem] tabular-nums w-4 text-right')
        ).spacing(3);
      })()
    ).className('mb-6 pt-5 border-t border-border-subtle'),

    // Reset
    HStack(
      resetBtn,
      Text('Clears your interest profile, resets all weights to defaults').className('text-dimmer text-[0.68rem]')
    ).spacing(3).className('pt-5 border-t border-border-subtle')
  );
  AetherUI.mount(view, container);
}

async function fetchGenericRSS(feedUrl, sourceName) {
  try {
    const result = await apiGet(`/api/rss-proxy?url=${encodeURIComponent(feedUrl)}`);
    const xml = result && result._proxy ? atob(result.data) : '';
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
  if (typeof islandUpdate === 'function') islandUpdate('feed', { type: 'feed', label: 'Loading feeds', detail: 'Fetching feed sources…' });
  const sources = getFeedSources();
  if (allPapers.length > 0) {
    _previousPostLinks = new Set(allPapers.map(p => p.link));
  }
  allPapers = [];
  _renderedLinks = new Set();

  // Show spinner only if we have nothing to show yet
  const container = document.getElementById('papers');
  if (allPapers.length === 0) {
    AetherUI.mount(RawHTML('<div style="column-span:all" class="flex items-center justify-center h-[60vh]"><span class="spinner"></span></div>'), container);
  }

  // Build list of enabled catalog source keys
  const enabledKeys = FEED_CATALOG.filter(f => sources[f.key]).map(f => f.key);
  const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
  const promises = [];

  // 1) Fetch catalog sources from the central poller DB
  if (enabledKeys.length > 0) {
    promises.push(
      apiGet(`/api/feed-items?sources=${enabledKeys.join(',')}&limit=500`)
        .catch(() => [])
    );
  } else {
    promises.push(Promise.resolve([]));
  }

  // 2) Fetch custom user feeds
  if (customFeeds.length > 0) {
    promises.push(
      apiPost('/api/feed-items/custom', { feeds: customFeeds.map(f => ({ url: f.url, name: f.name })) })
        .catch(() => [])
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
    if (typeof islandUpdate === 'function') islandUpdate('feed', { type: 'feed', label: 'Feeds loaded', detail: 'Feed refresh complete', done: true });
    if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();
    _detectNewPosts();
    startRefreshTimer();
  } catch (e) {
    if (abort.signal.aborted) return;
    if (typeof islandRemove === 'function') islandRemove('feed');
    // Fallback: show error
    AetherUI.mount(VStack(
      Text('Failed to load feed: ' + e.message).foreground('red'),
      Text('Try refreshing or check your connection.').className('mt-2 text-[0.85rem] text-muted')
    ).className('text-center py-20 text-red-400'), container);
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
    const data = await apiPost('/api/citations', { ids });
    Object.assign(citationMap, data);
    for (const p of papers) {
      if (p.arxivId && citationMap[p.arxivId] !== undefined) {
        p.citations = citationMap[p.arxivId];
      }
    }
    renderPapers();
  } catch (e) { /* silently fail */ }
}

// ── Trends extraction ──

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
  allPapers.forEach(p => { const cats = Array.isArray(p.categories) ? p.categories : []; cats.forEach(c => { freq[c] = (freq[c] || 0) + 1; }); });
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


function getFilteredPapers(ctx) {
  if (!ctx) ctx = _buildRenderCtx();
  const rawSearch = (document.getElementById('search')?.value || '').toLowerCase();
  const category = document.getElementById('category').value;
  const { hiddenSet: hidden, blockedWords: _blockedWordsSet } = ctx;

  // Parse structured search prefixes, quoted phrases, and title: prefix
  const parsed = parseSearchQuery(rawSearch);
  const authorFilter = parsed.authorFilter, sourceFilter = parsed.sourceFilter, sortOverride = parsed.sortOverride;
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
    if (category && !(Array.isArray(p.categories) ? p.categories : []).includes(category)) return false;
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
    const wBase = parseFloat(Settings.get('fyWeightBase') || '0.7');
    const wAff = parseFloat(Settings.get('fyWeightAffinity') || '0.3');
    const wRecency = parseFloat(Settings.get('fyWeightRecency') || '1.0');
    filtered = [...filtered].sort((a, b) => {
      const aLlm = 50;
      const bLlm = 50;
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
  // Category-aware interleaving: limit same-category runs (O(n) bucket algorithm)
  const maxRun = parseInt(Settings.get('maxPerCategoryRun') || '3', 10) || 3;
  if (filtered.length > 1) {
    // Group items into per-category queues, preserving sort order within each
    const buckets = new Map(); // cat -> array of items
    const catOrder = []; // insertion order of categories
    for (const p of filtered) {
      const cat = FEED_CAT_MAP[p.source] || p.source;
      if (!buckets.has(cat)) { buckets.set(cat, []); catOrder.push(cat); }
      buckets.get(cat).push(p);
    }
    // Round-robin across categories, taking up to maxRun from each before moving on
    if (buckets.size > 1) {
      const result = [];
      const cursors = new Map(); // cat -> index into its bucket
      for (const cat of catOrder) cursors.set(cat, 0);
      let remaining = filtered.length;
      while (remaining > 0) {
        for (const cat of catOrder) {
          const arr = buckets.get(cat);
          const cur = cursors.get(cat);
          if (cur >= arr.length) continue;
          const take = Math.min(maxRun, arr.length - cur);
          for (let j = 0; j < take; j++) result.push(arr[cur + j]);
          cursors.set(cat, cur + take);
          remaining -= take;
        }
      }
      filtered = result;
    }
  }
  return filtered;
}

function _renderPaperCompactRow(p, i, ctx) {
  var readSet = ctx.readSet;
  var sourceChip = getSourceChip(p.source, p.arxivId);
  var isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  var isRead = readSet.has(p.link);
  var actionWrap = new View('span').className('ml-auto flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity');
  actionWrap.el.appendChild(_cardActionRow(p, i, ctx).build());
  var row = HStack(
    isNew && !isRead ? new View('span').className('inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0') : null,
    RawHTML(sourceChip),
    RawHTML('<span class="text-[0.82rem] ' + (isRead ? 'text-muted' : 'text-primary') + ' truncate">' + renderTitle(p.title) + '</span>'),
    actionWrap,
    p.date ? Text(p.date).className('text-[0.68rem] text-dim shrink-0') : null
  ).spacing(2).className('py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors')
    .onTap(function(e) { openPaper(i, e); });
  return VStack(row, _cardCommentContainer(p, i))
    .className('group' + (isRead ? ' opacity-50' : ''))
    .attr('data-link', p.link);
}

function _renderPaperCard(p, i, ctx) {
  var readSet = ctx.readSet;
  var isHN = p.source === 'hn';
  var _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
  var sourceLabel = _hasExternalLink ? (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return SOURCE_NAMES[p.source] || p.source; } })() : (SOURCE_NAMES[p.source] || p.source);
  var isPoly = p.source === 'polymarket';
  var snippet = isPoly ? '' : (p.description ? truncate(p.description, 120) : '');
  var nLink = _normalizeRatingKey(p.link);
  var userRating = ctx.ratings ? (ctx.ratings[nLink] || ctx.ratings[p.link] || 0) : getPaperRating(p.link);
  var isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  var isRead = readSet.has(p.link);
  var cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(p.link).hostname) + '&sz=64'; } catch(e) { return ''; } })();
  var pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  var imgView = RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);

  // Title row
  var titleHtml = (isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '') + renderTitle(p.title);
  var titleEl = RawHTML(titleHtml);
  titleEl.className('text-[0.92rem] font-semibold ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug min-w-0');
  var titleRow = HStack(imgView, titleEl).spacing(2).className('items-center');

  // Body
  var body = null;
  if (snippet) {
    body = Text(snippet).className('text-[0.78rem] text-muted leading-relaxed mt-1.5');
  }

  // Meta row
  var metaItems = [Text(sourceLabel).className('text-[0.75rem] text-dim')];
  if (_hasExternalLink) metaItems.push(RawHTML('<span class="text-[0.68rem] text-dimmer">via ' + escapeHtml(SOURCE_NAMES[p.source] || p.source) + (isHN ? ' \u00b7 ' + p.hnScore + ' pts' : '') + '</span>'));
  if (!(isHN && _hasExternalLink)) {
    if (isHN) metaItems.push(Text(p.hnScore + ' pts').className('text-[0.68rem] text-dim'));
    else if (isPoly) metaItems.push(Text(p.polyYesPct + '%').className('text-[0.68rem] font-semibold ' + (p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400')));
    else if (p.citations !== undefined) metaItems.push(Text(p.citations + ' cited').className('text-[0.68rem] text-dim'));
  }
  if (userRating > 0) metaItems.push(RawHTML(renderStarRating(p.link, { size: 'sm', interactive: false })));
  if (p.date) metaItems.push(Text(p.date).className('text-[0.68rem] text-dim'));
  metaItems.push(_cardActionRow(p, i, ctx));
  var metaRow = HStack.apply(null, metaItems).spacing(2).className('flex-wrap mt-2');

  var card = VStack(titleRow, body, metaRow, _cardCommentContainer(p, i));
  card.className('paper break-inside-avoid bg-card border border-border-card rounded-xl p-4 mb-3.5 cursor-pointer transition-all duration-150' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

// ── Debounced renderPapers ──
let _renderPapersRafId = 0;
function renderPapers() {
  if (_renderPapersRafId) return; // already scheduled
  _renderPapersRafId = requestAnimationFrame(() => {
    _renderPapersRafId = 0;
    _renderPapersNow();
    if (typeof Motion !== 'undefined') Motion.pulse.emit('feed', { label: 'render', detail: allPapers.length + ' posts' });
  });
}

function _buildRenderCtx() {
  const hiddenSet = new Set(getHiddenPosts());
  const readSet = new Set(getReadPosts());
  const blockedWords = new Set(getBlockedWords());
  const savedPosts = getSavedPosts();
  const repostedSet = new Set(_getRepostedLinks());
  const ratings = getPaperRatings();
  return { hiddenSet, readSet, blockedWords, savedPosts, repostedSet, ratings };
}

function _renderFeedEmptyState(container) {
  var children = [ Text('No papers match your filter').className('text-dim').styles({fontSize:'0.9rem'}) ];
  var v = VStack(children).alignment('center').styles({justifyContent:'center', columnSpan:'all', padding:'5rem 0'}).spacing(4);
  AetherUI.mount(v, container);
}

function _renderPaperVerboseCard(p, i, ctx) {
  var readSet = ctx.readSet;
  var isHN = p.source === 'hn';
  var _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
  var sourceName = _hasExternalLink ? (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return SOURCE_NAMES[p.source] || p.source; } })() : (SOURCE_NAMES[p.source] || p.source);
  var isPoly = p.source === 'polymarket';
  var fullDesc = isPoly ? '' : (p.description || '');
  var pCats = Array.isArray(p.categories) ? p.categories : [];
  var nLink = _normalizeRatingKey(p.link);
  var userRating = ctx.ratings[nLink] || ctx.ratings[p.link] || 0;
  var isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  var isRead = readSet.has(p.link);
  var cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(p.link).hostname) + '&sz=64'; } catch(e) { return ''; } })();
  var pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  var imgView = RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);

  // Title row
  var titleHtml = (isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '') + renderTitle(p.title);
  var titleEl = RawHTML(titleHtml);
  titleEl.className('text-[1rem] font-semibold ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug min-w-0');
  var titleRow = HStack(imgView, titleEl).spacing(2).className('items-center');

  // Authors
  var authorsView = p.authors ? Text(truncate(p.authors, 200)).className('text-[0.76rem] text-dimmer mt-1') : null;

  // Description
  var descView = fullDesc ? Text(fullDesc).className('text-[0.82rem] text-muted leading-relaxed mt-2') : null;

  // Categories
  var catsView = null;
  if (pCats.length) {
    var catItems = pCats.slice(0, 6).map(function(c) {
      return Text(c).className('text-[0.65rem] px-1.5 py-0.5 rounded bg-hover text-dim');
    });
    catsView = HStack.apply(null, catItems).spacing(0.5).className('flex-wrap mt-1.5');
  }

  // Meta row
  var metaItems = [Text(sourceName).className('text-[0.72rem] text-dim')];
  if (_hasExternalLink) metaItems.push(RawHTML('<span class="text-[0.72rem] text-dimmer">via ' + escapeHtml(SOURCE_NAMES[p.source] || p.source) + (isHN ? ' \u00b7 ' + p.hnScore + ' pts' : '') + '</span>'));
  if (!(isHN && _hasExternalLink)) {
    if (isHN) metaItems.push(Text(p.hnScore + ' pts').className('text-[0.72rem] text-dim'));
    else if (isPoly) metaItems.push(Text(p.polyYesPct + '%').className('text-[0.72rem] font-semibold ' + (p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400')));
    else if (p.citations !== undefined) metaItems.push(Text(p.citations + ' cited').className('text-[0.72rem] text-dim'));
  }
  if (userRating > 0) metaItems.push(RawHTML(renderStarRating(p.link, { size: 'sm', interactive: false })));
  if (p.date) metaItems.push(Text(p.date).className('text-[0.72rem] text-dim'));
  metaItems.push(_cardActionRow(p, i, ctx));
  var metaRow = HStack.apply(null, metaItems).spacing(2).className('flex-wrap mt-3');

  var card = VStack(titleRow, authorsView, descView, catsView, metaRow, _cardCommentContainer(p, i));
  card.className('paper bg-card border border-border-card rounded-xl p-5 cursor-pointer transition-all duration-150' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

function _renderPaperTwitterCard(p, i, ctx) {
  var readSet = ctx.readSet;
  var isHN = p.source === 'hn';
  var sourceName = SOURCE_NAMES[p.source] || p.source;
  var handle = (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return p.source; } })();
  var isPoly = p.source === 'polymarket';
  var snippet = isPoly ? '' : (p.description ? truncate(p.description, 280) : '');
  var isSaved = !!ctx.savedPosts[p.link];
  var bmFill = isSaved ? 'var(--nr-accent)' : 'none';
  var bmStroke = isSaved ? 'var(--nr-accent)' : 'currentColor';
  var isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  var isRead = readSet.has(p.link);
  var cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(p.link).hostname) + '&sz=64'; } catch(e) { return ''; } })();
  var pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  var avatarView = RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-10 h-10 rounded-full shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);
  var tAgo = p.pubDate && typeof _relativeTime === 'function' ? _relativeTime(p.pubDate) : (p.date || '');
  var hnPts = isHN ? p.hnScore || 0 : 0;
  var citations = p.citations !== undefined ? p.citations : null;
  var statsNum = isPoly ? p.polyYesPct + '%' : isHN ? String(hnPts) : (citations !== null ? String(citations) : '');
  var reposted = ctx.repostedSet.has(p.link);
  var commentCount = _tweetCommentCounts[p.link] || '';

  // Build action buttons using AetherUI
  var btnClass = 'group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 transition-colors';
  var commentBtn = RawHTML('<button class="' + btnClass + ' text-dimmer hover:text-blue-400">' + icon('chatBubble', {size: 16, class: 'w-4 h-4'}) + '<span class="text-[0.72rem]" data-tweet-comment-count="' + escapeAttr(p.link) + '">' + commentCount + '</span></button>');
  commentBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); _toggleTweetComments(p.link, i); });
  var repostBtn = RawHTML('<button class="' + btnClass + ' ' + (reposted ? '' : 'text-dimmer hover:text-green-400') + '" style="' + (reposted ? 'color:rgb(74,222,128)' : '') + '">' + icon('repost', {size: 16, class: 'w-4 h-4'}) + '<span class="text-[0.72rem]">' + statsNum + '</span></button>');
  repostBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); _tweetRepost(i, repostBtn.el.firstChild); });
  var bmBtn = RawHTML('<button class="' + btnClass + '" style="color:' + (bmFill === 'none' ? 'var(--nr-text-quaternary)' : 'var(--nr-accent)') + '">' + icon('bookmark', {size: 16, class: 'w-4 h-4', fill: bmFill, stroke: bmStroke}) + '</button>');
  bmBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); toggleSavePost(lastFilteredPapers[i], e); });
  var menuBtn = RawHTML('<button class="' + btnClass + ' text-dimmer hover:text-primary">' + icon('moreVertical', {size: 16, class: 'w-4 h-4'}) + '</button>');
  menuBtn.el.firstChild.addEventListener('click', function(e) { openCardMenu(menuBtn.el.firstChild, e, i); });
  var actionBar = HStack(commentBtn, repostBtn, bmBtn, menuBtn).className('justify-between mt-2.5 max-w-[400px]');

  // Header line
  var headerItems = [];
  if (isNew && !isRead) headerItems.push(RawHTML('<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>'));
  headerItems.push(Text(sourceName).className('text-[0.88rem] font-bold ' + (isRead ? 'text-muted' : 'text-primary')));
  headerItems.push(Text('@' + handle).className('text-[0.8rem] text-dimmer'));
  headerItems.push(Text('\u00b7').className('text-dimmer'));
  headerItems.push(Text(tAgo).className('text-[0.8rem] text-dimmer'));
  var headerRow = HStack.apply(null, headerItems).spacing(1).className('flex-wrap');

  // Title
  var titleEl = RawHTML(renderTitle(p.title));
  titleEl.className('text-[0.92rem] ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug mt-1 font-semibold');

  // Body content
  var bodyChildren = [headerRow, titleEl];
  if (snippet) bodyChildren.push(Text(snippet).className('text-[0.84rem] text-muted leading-relaxed mt-1'));
  bodyChildren.push(actionBar);
  bodyChildren.push(_cardCommentContainer(p, i));

  var content = VStack.apply(null, bodyChildren);
  content.className('min-w-0 flex-1');

  var card = HStack(avatarView, content).spacing(3);
  card.className('py-3 px-4 border-b border-border-card cursor-pointer transition-colors hover:bg-hover' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

function _renderPapersNow() {
  var ctx = _buildRenderCtx();
  var hiddenSet = ctx.hiddenSet;
  var filtered = getFilteredPapers(ctx);
  lastFilteredPapers = filtered;
  var visible = filtered.slice(0, visibleCount);
  document.getElementById('stats').textContent = 'Showing ' + visible.length + ' of ' + filtered.length + ' papers';
  var container = document.getElementById('papers');
  if (!filtered.length) {
    _renderFeedEmptyState(container);
    return;
  }

  container.innerHTML = '';

  var cards = visible.map(function(p, i) {
    if (feedViewMode === 'compact') return _renderPaperCompactRow(p, i, ctx);
    if (feedViewMode === 'verbose') return _renderPaperVerboseCard(p, i, ctx);
    if (feedViewMode === 'twitter') return _renderPaperTwitterCard(p, i, ctx);
    return _renderPaperCard(p, i, ctx);
  });

  if (feedViewMode === 'compact' || feedViewMode === 'verbose' || feedViewMode === 'twitter') {
    var wrapClass = feedViewMode === 'twitter' ? 'flex flex-col max-w-[600px] mx-auto' : 'flex flex-col' + (feedViewMode === 'verbose' ? ' gap-3' : '');
    var wrap = VStack.apply(null, cards).className(wrapClass);
    wrap.styles({ columnSpan: 'all' });
    container.appendChild(wrap.build());
  } else {
    // Block view: cards are direct children of container for CSS columns
    cards.forEach(function(c) { container.appendChild(c.build()); });
  }

  // Animate cards that are new since the last render
  var prevLinks = _renderedLinks;
  _renderedLinks = new Set(visible.map(function(p) { return p.link; }));
  if (prevLinks.size > 0) {
    var _feedNewIdx = 0;
    container.querySelectorAll('[data-link]').forEach(function(el) {
      if (!prevLinks.has(el.dataset.link)) {
        Motion.fadeIn(el, { y: 8, delay: _feedNewIdx * Motion.stagger.tight });
        _feedNewIdx++;
        var dot = document.createElement('span');
        dot.className = 'feed-new-dot';
        el.style.position = 'relative';
        el.appendChild(dot);
      }
    });
  }
  fetchCitationsFor(visible);
  _fetchTweetCommentCounts(visible);
  visible.forEach(function(p, i) {
    if (_tweetCommentsOpen.has(p.link)) {
      var cmtContainer = document.getElementById('tweet-comments-' + i);
      if (cmtContainer) {
        cmtContainer.style.display = 'block';
        apiGet('/api/comments?paperLink=' + encodeURIComponent(p.link))
          .then(function(comments) { _renderTweetComments(cmtContainer, comments, p.link, i); })
          .catch(function(e) { console.warn('loadTweetComments:', e); });
      }
    }
  });
}

// ── Twitter view: inline comments & repost ──

const _tweetCommentCounts = {}; // link -> count
const _tweetCommentsOpen = new Set(); // links with expanded comment sections

async function _fetchTweetCommentCounts(papers) {
  const needed = papers.filter(p => _tweetCommentCounts[p.link] === undefined);
  if (needed.length) {
    await Promise.all(needed.map(async p => {
      try {
        const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(p.link));
        _tweetCommentCounts[p.link] = comments.length;
      } catch { _tweetCommentCounts[p.link] = 0; }
    }));
  }
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
  AetherUI.mount(Text('Loading...').className('text-dim text-[0.75rem] py-2'), container);
  try {
    const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(link));
    _tweetCommentCounts[link] = comments.length;
    // Update badge
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    _renderTweetComments(container, comments, link, idx);
  } catch {
    AetherUI.mount(Text('Failed to load comments').className('text-red-400 text-[0.75rem] py-2'), container);
  }
}

function _renderTweetComments(container, comments, link, idx) {
  var topLevel = comments.filter(function(c) { return !c.parentId; }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  var byParent = {};
  comments.forEach(function(c) { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
  var currentUser = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';

  function renderThread(c, depth) {
    var replies = (byParent[c.id] || []).sort(function(a, b) { return a.timestamp - b.timestamp; });
    var ml = depth > 0 ? 'margin-left:' + Math.min(depth, 4) * 16 + 'px; border-left: 2px solid var(--nr-border-default); padding-left: 8px;' : '';
    var initial = (c.author || '?')[0].toUpperCase();
    var timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
    var isOwn = c.author === currentUser;

    var threadEl = new View('div');
    threadEl.cssText(ml + '; margin-bottom: 6px;');

    var avatarDiv = new View('div');
    avatarDiv.cssText('width:20px;height:20px;min-width:20px;border-radius:50%;background:var(--nr-accent);color:#fff;font-size:0.6rem;font-weight:700;display:flex;align-items:center;justify-content:center');
    avatarDiv.el.textContent = initial;

    var authorLink = new View('a');
    authorLink.el.href = '#profile/' + encodeURIComponent(c.author);
    authorLink.el.className = 'text-[0.72rem] font-medium text-primary hover:text-accent';
    authorLink.el.style.textDecoration = 'none';
    authorLink.el.textContent = c.author;
    authorLink.el.addEventListener('click', function(e) { e.stopPropagation(); });

    var timeSpan = new View('span');
    timeSpan.el.className = 'text-[0.65rem] text-dimmer';
    timeSpan.el.textContent = timeAgo;

    var metaRow = new View('div');
    metaRow.el.className = 'flex items-center gap-1.5';
    metaRow.el.appendChild(authorLink.el);
    metaRow.el.appendChild(timeSpan.el);

    if (isOwn) {
      var delBtnEl = new View('button');
      delBtnEl.el.className = 'cmt-del text-dimmest hover:text-red-400 text-[0.65rem] ml-auto bg-transparent border-none cursor-pointer';
      delBtnEl.el.dataset.cid = c.id;
      delBtnEl.el.textContent = 'x';
      delBtnEl.el.addEventListener('click', function(e) { e.stopPropagation(); _deleteTweetComment(c.id, link, idx); });
      metaRow.el.appendChild(delBtnEl.el);
    }

    var contentDiv = new View('div');
    contentDiv.el.className = 'text-[0.78rem] text-primary mt-0.5 leading-relaxed';
    contentDiv.el.innerHTML = escapeHtml(c.content).replace(/\n/g, '<br>');

    var showReplyBtn = new View('button');
    showReplyBtn.el.className = 'cmt-show-reply text-[0.68rem] text-dim hover:text-accent mt-0.5 bg-transparent border-none cursor-pointer p-0';
    showReplyBtn.el.dataset.cid = c.id;
    showReplyBtn.el.textContent = 'Reply';
    showReplyBtn.el.addEventListener('click', function(e) { e.stopPropagation(); _showTweetReply(c.id); });

    var replyTa = new View('textarea');
    replyTa.el.id = 'tweet-reply-ta-' + c.id;
    replyTa.el.className = 'w-full text-[0.75rem] bg-input border border-border-input rounded px-2 py-1 text-primary resize-none outline-none focus:border-accent';
    replyTa.el.rows = 2;
    replyTa.el.placeholder = 'Write a reply...';
    replyTa.el.addEventListener('click', function(e) { e.stopPropagation(); });

    var replySubmit = new View('button');
    replySubmit.el.className = 'cmt-reply-submit px-2 py-0.5 text-[0.68rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none';
    replySubmit.el.dataset.cid = c.id;
    replySubmit.el.textContent = 'Reply';
    replySubmit.el.addEventListener('click', function(e) { e.stopPropagation(); _postTweetReply(c.id, link, idx); });

    var replyCancel = new View('button');
    replyCancel.el.className = 'cmt-reply-cancel px-2 py-0.5 text-[0.68rem] rounded border border-border-input text-dim hover:text-primary cursor-pointer bg-transparent';
    replyCancel.el.dataset.cid = c.id;
    replyCancel.el.textContent = 'Cancel';
    replyCancel.el.addEventListener('click', function(e) { e.stopPropagation(); _hideTweetReply(c.id); });

    var replyBtnRow = new View('div');
    replyBtnRow.el.className = 'flex gap-1 mt-1';
    replyBtnRow.el.appendChild(replySubmit.el);
    replyBtnRow.el.appendChild(replyCancel.el);

    var replyForm = new View('div');
    replyForm.el.id = 'tweet-reply-' + c.id;
    replyForm.el.className = 'hidden mt-1';
    replyForm.el.appendChild(replyTa.el);
    replyForm.el.appendChild(replyBtnRow.el);

    var bodyDiv = new View('div');
    bodyDiv.el.className = 'flex-1 min-w-0';
    bodyDiv.el.appendChild(metaRow.el);
    bodyDiv.el.appendChild(contentDiv.el);
    bodyDiv.el.appendChild(showReplyBtn.el);
    bodyDiv.el.appendChild(replyForm.el);

    var rowDiv = new View('div');
    rowDiv.el.className = 'flex items-start gap-1.5';
    rowDiv.el.appendChild(avatarDiv.el);
    rowDiv.el.appendChild(bodyDiv.el);

    threadEl.el.appendChild(rowDiv.el);

    replies.forEach(function(r) { threadEl.el.appendChild(renderThread(r, depth + 1).build()); });
    return threadEl;
  }

  var wrap = new View('div');
  wrap.el.className = 'mt-2 pt-2 border-t border-border-card';
  if (topLevel.length) {
    topLevel.forEach(function(c) { wrap.el.appendChild(renderThread(c, 0).build()); });
  } else {
    wrap.el.appendChild(Text('No comments yet').className('text-dim text-[0.75rem] py-1').build());
  }

  var inputRow = new View('div');
  inputRow.el.className = 'flex gap-2 mt-2';
  var commentTa = new View('textarea');
  commentTa.el.id = 'tweet-comment-input-' + idx;
  commentTa.el.className = 'flex-1 text-[0.75rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent';
  commentTa.el.rows = 1;
  commentTa.el.placeholder = 'Add a comment...';
  commentTa.el.addEventListener('click', function(e) { e.stopPropagation(); });
  var postBtn = new View('button').className('px-3 py-1 text-[0.72rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none shrink-0');
  postBtn.el.textContent = 'Post';
  postBtn.el.addEventListener('click', function(e) { e.stopPropagation(); _postTweetComment(link, idx); });
  inputRow.el.appendChild(commentTa.el);
  inputRow.el.appendChild(postBtn.el);
  wrap.el.appendChild(inputRow.el);

  AetherUI.mount(wrap, container);
}

async function _postTweetComment(link, idx) {
  const ta = document.getElementById('tweet-comment-input-' + idx);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  const author = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || 'Anonymous';
  try {
    await apiPost('/api/comments', { paperLink: link, author, content, parentId: null });
    ta.value = '';
    // Re-fetch and re-render
    const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(link));
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
    await apiPost('/api/comments', { paperLink: link, author, content, parentId });
    const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(link));
    _tweetCommentCounts[link] = comments.length;
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    const container = document.getElementById('tweet-comments-' + idx);
    if (container) _renderTweetComments(container, comments, link, idx);
  } catch { /* silent */ }
}

async function _deleteTweetComment(commentId, link, idx) {
  try {
    await apiDelete('/api/comments/' + commentId);
    const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(link));
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
  return getLS('repostedLinks', []);
}
function _isReposted(link) { return _getRepostedLinks().includes(link); }
function _markReposted(link) {
  const links = _getRepostedLinks();
  if (!links.includes(link)) { links.push(link); setLS('repostedLinks', links); }
}
function _unmarkReposted(link) {
  const links = _getRepostedLinks().filter(l => l !== link);
  setLS('repostedLinks', links);
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
    ipcRoute('/api/reposts', { method: 'DELETE', body: JSON.stringify({ paperLink: p.link }) })
      .catch(e => console.error('Unrepost error:', e));
    return;
  }
  // Animate the repost icon
  if (svg) {
    Motion.animate(svg, {
      spring: 'bouncy',
      from: { scale: 1, rotate: 0 },
      to: { scale: 1.4, rotate: 360 },
      duration: 400,
      onFinish: function() {
        Motion.animate(svg, { spring: 'smooth', from: { scale: 1.4, rotate: 360 }, to: { scale: 1, rotate: 0 } });
      }
    });
  }
  // Keep it green
  btn.style.color = 'rgb(74, 222, 128)';
  btn.dataset.reposted = '1';
  _markReposted(p.link);
  // Save repost to server
  const username = (typeof _authUserInfo !== 'undefined' && _authUserInfo && _authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';
  apiPost('/api/reposts', { paperLink: p.link, paperTitle: p.title, username })
    .catch(e => console.error('Repost error:', e));
}

// Shared comment & repost action buttons for all card views
function _cardActionRow(p, i, ctx) {
  var isSaved = ctx ? !!ctx.savedPosts[p.link] : isPostSaved(p.link);
  var bmFill = isSaved ? 'var(--nr-accent)' : 'none';
  var bmStroke = isSaved ? 'var(--nr-accent)' : 'currentColor';
  var commentCount = _tweetCommentCounts[p.link] || '';
  var reposted = ctx ? ctx.repostedSet.has(p.link) : _isReposted(p.link);
  var v = new View('div');
  v.el.className = 'flex items-center gap-3 shrink-0 ml-auto';
  v.el.innerHTML =
    '<button class="flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-blue-400 transition-colors" title="Comments">' + icon('chatBubble', {size: 14, class: 'w-3.5 h-3.5'}) + '<span class="text-[0.68rem]" data-tweet-comment-count="' + escapeAttr(p.link) + '">' + commentCount + '</span></button>' +
    '<button class="flex items-center gap-1 bg-transparent border-none cursor-pointer p-0 transition-colors ' + (reposted ? '' : 'text-dimmer hover:text-green-400') + '" style="' + (reposted ? 'color:rgb(74,222,128)' : '') + '" title="Repost">' + icon('repost', {size: 14, class: 'w-3.5 h-3.5'}) + '</button>' +
    '<button class="bg-transparent border-none cursor-pointer p-0 transition-colors" style="color:' + (bmFill === 'none' ? 'var(--nr-text-quaternary)' : 'var(--nr-accent)') + '" title="' + (isSaved ? 'Remove from Reading List' : 'Save to Reading List') + '">' + icon('bookmark', {size: 14, class: 'w-3.5 h-3.5', fill: bmFill, stroke: bmStroke}) + '</button>' +
    '<button class="bg-transparent border-none cursor-pointer p-0 text-dimmer hover:text-primary transition-colors">' + icon('moreVertical', {size: 14, class: 'w-3.5 h-3.5'}) + '</button>';
  var btns = v.el.querySelectorAll('button');
  btns[0].addEventListener('click', function(e) { e.stopPropagation(); _toggleTweetComments(p.link, i); });
  btns[1].addEventListener('click', function(e) { e.stopPropagation(); _tweetRepost(i, btns[1]); });
  btns[2].addEventListener('click', function(e) { e.stopPropagation(); toggleSavePost(lastFilteredPapers[i], e); });
  btns[3].addEventListener('click', function(e) { openCardMenu(btns[3], e, i); });
  return v;
}

function _cardCommentContainer(p, i) {
  var v = new View('div').id('tweet-comments-' + i);
  v.styles({ display: _tweetCommentsOpen.has(p.link) ? 'block' : 'none' });
  return v;
}

// Infinite scroll
let scrollTicking = false;
(document.getElementById('app-bezel') || window).addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    if (document.getElementById('home-main').style.display === 'none') return;
    if (visibleCount >= lastFilteredPapers.length) return;
    const bezel = document.getElementById('app-bezel');
    const scrollBottom = bezel ? (bezel.scrollTop + bezel.clientHeight) : (window.innerHeight + window.scrollY);
    const docHeight = bezel ? bezel.scrollHeight : document.documentElement.scrollHeight;
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
    feed.style.outline = '2px dashed var(--nr-accent)';
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
