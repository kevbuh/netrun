import Settings from '/js/core/core-settings.js';
import { ipcRoute } from '/js/api-ipc.js';
import { apiPost, apiGet, apiDelete } from '/js/api.js';
import { formatDate, escapeHtml, escapeAttr, stripHtml, getPaperRatings, _normalizeRatingKey } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove, showAchievement } from '/js/core/core-ui.js';
import { _updateNowPlayingContext } from '/js/core/core-audio.js';
import { getLS, setLS } from '/js/core/core-auth.js';
import { _isNewTabClick, _openInNewTab } from '/js/core/core-layout.js';
import { FEED_CAT_MAP, FEED_CATALOG, getSourceChip, goHome, SOURCE_LOGO_INLINE, SOURCE_NAMES } from '/js/core/core-views.js';
import { openBrowse, openLocalPdf } from '/js/browse/browse-windows.js';
import { openPaper } from '/js/panel.js';
import { petReact } from '/js/pixel-pet.js';
import { logger } from '/js/logger.js';

// ── Feed IPC helpers ──

function _feedIPC(channel, ...args) {
  if (window.electronAPI) electronAPI.dbQuery(channel, ...args).catch(() => {});
}

let _sourcesSynced = false;

// ── Auto-refresh timer ──
export let _refreshTimer = null;
export let _refreshSecondsLeft = 300;
export function clearRefreshTimer() { if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; } }
export let _previousPostLinks = new Set();
export let _renderedLinks = new Set();
export function setRenderedLinks(s) { _renderedLinks = s; }

export function startRefreshTimer() {
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

export function renderRefreshCountdown() {
  const el = document.getElementById('refresh-countdown');
  if (!el) return;
  const m = Math.floor(_refreshSecondsLeft / 60);
  const s = _refreshSecondsLeft % 60;
  el.textContent = m + ':' + String(s).padStart(2, '0');
}

// ── Reading window.List(localStorage) ──
setTimeout(updateSavedBadge, 0);
export function updateSavedBadge() {
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
export function _getSeenPostLinks() {
  return new Set(getLS('seenPostLinks', []));
}
export function _setSeenPostLinks(set) {
  setLS('seenPostLinks', [...set]);
}
export function _getFeedNotifications() {
  return getLS('feedNotifications', []);
}
export function _setFeedNotifications(arr) {
  setLS('feedNotifications', arr);
}

export function _getFeedNotifSources() {
  return getLS('feedNotifSources', {});
}

export function _detectNewPosts() {
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

export function clearFeedNotification(link) {
  const notifications = _getFeedNotifications().filter(n => n.link !== link);
  _setFeedNotifications(notifications);
}

export function getHiddenPosts() {
  return getLS('hiddenPosts', []);
}
export function getReadPosts() {
  return getLS('readPosts', []);
}

// ── Source Affinity ──
export function getSourceAffinity() {
  const readSet = new Set(getReadPosts());
  const savedPosts = getSavedPosts();
  const savedSet = new Set(Object.keys(savedPosts));
  const hiddenSet = new Set(getHiddenPosts());
  const ratings = getPaperRatings();

  // Count per-source totals and engagement
  const sourceCounts = {}; // source -> { total, read, saved, rated, hidden }
  for (const p of allPapers) {
    if (!sourceCounts[p.source]) sourceCounts[p.source] = { total: 0, read: 0, saved: 0, rated: 0, hidden: 0 };
    const c = sourceCounts[p.source];
    c.total++;
    if (readSet.has(p.link)) c.read++;
    if (savedSet.has(p.link)) c.saved++;
    const nLink = typeof _normalizeRatingKey === 'function' ? _normalizeRatingKey(p.link) : p.link;
    if (ratings[nLink] || ratings[p.link]) c.rated++;
    if (hiddenSet.has(p.link)) c.hidden++;
  }

  const affinity = {};
  for (const source of Object.keys(sourceCounts)) {
    const c = sourceCounts[source];
    if (c.total < 3) { affinity[source] = 0.5; continue; }
    const engagement = (c.read + c.saved * 2 + c.rated * 3) / c.total;
    const penalty = (c.hidden / c.total) * 0.5;
    affinity[source] = Math.max(0.1, Math.min(1.0, engagement - penalty));
  }
  return affinity;
}

// ── Interest Profile ──
const _STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','it','that','this','are','was','were','be','been','has','have','had','not','no','do','does','did','will','would','can','could','should','may','might','shall','into','as','if','its','than','so','very','just','about','also','more','other','some','only','over','such','after','before','between','each','all','both','through','during','up','out','then','them','these','those','own','same','how','our','new','using','via','based','we','i','you','he','she','they','what','which','who','when','where','why','how','two','one','three','first','second','third','most','many','any','few','large','small','high','low','long','short','old']);

export function getInterestProfile() {
  const readPosts = getReadPosts();
  const savedPosts = getSavedPosts();
  const hiddenPosts = getHiddenPosts();
  const ratings = getPaperRatings();

  const topicScores = {};  // keyword -> score
  const catScores = {};    // category -> score

  function addTitle(title, weight) {
    if (!title) return;
    const words = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(function(w) { return w.length > 2 && !_STOP_WORDS.has(w); });
    for (const w of words) {
      topicScores[w] = (topicScores[w] || 0) + weight;
    }
  }

  function addCategories(cats, weight) {
    if (!Array.isArray(cats)) return;
    for (const c of cats) {
      catScores[c] = (catScores[c] || 0) + weight;
    }
  }

  // Read posts: weight 1
  const readSet = new Set(readPosts);
  for (const p of allPapers) {
    if (readSet.has(p.link)) {
      addTitle(p.title, 1);
      addCategories(p.categories, 1);
    }
  }

  // Saved posts: weight 3
  const savedSet = new Set(Object.keys(savedPosts));
  for (const p of allPapers) {
    if (savedSet.has(p.link)) {
      addTitle(p.title, 3);
      addCategories(p.categories, 3);
    }
  }

  // Rated posts: weight = rating value
  for (const p of allPapers) {
    const nLink = typeof _normalizeRatingKey === 'function' ? _normalizeRatingKey(p.link) : p.link;
    const rating = ratings[nLink] || ratings[p.link] || 0;
    if (rating > 0) {
      addTitle(p.title, rating);
      addCategories(p.categories, rating);
    }
  }

  // Hidden posts: negative weight
  const hiddenSet = new Set(hiddenPosts);
  for (const p of allPapers) {
    if (hiddenSet.has(p.link)) {
      addTitle(p.title, -0.5);
      addCategories(p.categories, -0.5);
    }
  }

  // Extract top topics and categories
  const topTopics = Object.entries(topicScores)
    .filter(function(e) { return e[1] > 0; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 15)
    .map(function(e) { return e[0]; });

  const topCategories = Object.entries(catScores)
    .filter(function(e) { return e[1] > 0; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 10)
    .map(function(e) { return e[0]; });

  const profile = { topTopics, topCategories };
  Settings.set('interestProfile', JSON.stringify(profile));
  return profile;
}

// ── Content Score (replaces LLM) ──
export function _computeContentScore(paper, profile) {
  let score = 30; // baseline
  if (!profile) return score;

  const titleWords = (paper.title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(function(w) { return w.length > 2; });
  const topTopics = profile.topTopics || [];
  const topCategories = profile.topCategories || [];

  // Topic match bonus: up to +40
  let topicMatches = 0;
  const topTopicSet = new Set(topTopics);
  for (let j = 0; j < titleWords.length; j++) {
    if (topTopicSet.has(titleWords[j])) topicMatches++;
  }
  score += Math.min(40, topicMatches * 15);

  // Category match bonus: up to +30
  const paperCats = Array.isArray(paper.categories) ? paper.categories : [];
  const topCatSet = new Set(topCategories);
  let catMatches = 0;
  for (let k = 0; k < paperCats.length; k++) {
    if (topCatSet.has(paperCats[k])) catMatches++;
  }
  score += Math.min(30, catMatches * 15);

  return Math.min(100, score);
}

// ── Reset Personalization ──
export function resetPersonalization() {
  setLS('readPosts', []);
  setLS('hiddenPosts', []);
  setLS('savedPosts', {});
  Settings.set('paperRatings', '{}');
  Settings.set('interestProfile', '');
  Settings.set('fyWeightBase', '0.70');
  Settings.set('fyWeightAffinity', '0.30');
  Settings.set('fyWeightRecency', '1.00');
  Settings.set('fyWeightExploration', '0.10');
  Settings.set('maxPerCategoryRun', '3');
  window.renderPapers();
}

export function markPostAsRead(link) {
  const read = getReadPosts();
  if (!read.includes(link)) { read.push(link); setLS('readPosts', read); }
  _feedIPC('db:feed-mark-read', link);
  // Capture read article into living context
  if (typeof contextIngest === 'function') {
    const paper = allPapers.find(function(p) { return p.link === link; });
    if (paper) {
      contextIngest('feed', '## Reading', '- Read: [' + (paper.title || 'Untitled') + '](' + link + ')', { dedupeKey: 'read-' + link });
    }
  }
}

let _feedCardMenu = null;

export function openCardMenu(btn, ev, index) {
  ev.stopPropagation();
  ev.preventDefault();
  closeCardMenu();
  const p = lastFilteredPapers[index];
  if (!p) return;
  const sourceKey = p.source;
  const sourceName = SOURCE_NAMES[p.source] || p.source;

  _feedCardMenu = Menu(null, [
    { label: 'Block post', handler: function() { hidePost(p.link, p.title); } },
    { label: 'Unsubscribe from ' + sourceName, handler: function() { unsubscribeSource(sourceKey); } }
  ]);
  const rect = btn.getBoundingClientRect();
  _feedCardMenu.showAt(Math.max(8, rect.right - 200), rect.bottom + 4);
}

export function closeCardMenu() {
  if (_feedCardMenu) { _feedCardMenu.dismiss(); _feedCardMenu = null; }
}

export function hidePost(link, title, event) {
  if (event) event.stopPropagation();
  const hidden = getHiddenPosts();
  if (!hidden.includes(link)) hidden.push(link);
  setLS('hiddenPosts', hidden);
  _feedIPC('db:feed-hide', link);
  if (title) addTestTitle(title);
  if (!Settings.get('ach_curator')) {
    Settings.set('ach_curator', '1');
    if (typeof showAchievement === 'function') showAchievement('Curator', 'Curated your feed by hiding a post');
  }
  window.renderPapers();
}
// ── Blocked Words ──
export function getBlockedWords() {
  return getLS('blockedWords', []);
}
export function setBlockedWords(words) {
  setLS('blockedWords', words);
}
export function addBlockedWord() {
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
    window.renderPapers();
  }
  input.value = '';
}
export function removeBlockedWord(word) {
  const words = getBlockedWords().filter(w => w !== word);
  setBlockedWords(words);
  renderBlockedWordsList();
  window.renderPapers();
}
export function renderBlockedWordsList() {
  const el = document.getElementById('blocked-words-list');
  if (!el) return;
  const words = getBlockedWords();
  if (!words.length) {
    AetherUI.mount(window.Text('No blocked words yet.').className('text-dimmer text-[0.75rem]'), el);
    return;
  }
  const chips = words.map(function(w) {
    const btn = new window.View('button').className('text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-sm leading-none ml-0.5');
    btn.el.textContent = '\u00d7';
    btn.onTap(function() { removeBlockedWord(w); });
    return window.HStack(
      window.Text(w),
      btn
    ).spacing(1).className('inline-flex items-center bg-input border border-border-input rounded-full px-2.5 py-0.5 text-primary text-[0.78rem]');
  });
  const wrap = new window.View('div');
  wrap.el.className = 'flex flex-wrap gap-1.5';
  chips.forEach(function(c) { wrap.add(c); });
  AetherUI.mount(wrap, el);
}

// ── Offline caching ──

export function getOfflineCachedSet() {
  return new Set(getLS('offlineCached', []));
}

export function isPostCached(link) {
  return getOfflineCachedSet().has(link);
}

export async function cachePostOffline(link, paper, btnEl) {
  if (isPostCached(link)) return;
  if (btnEl) {
    AetherUI.mount(window.Text('Caching\u2026').className('text-dimmer text-[0.7rem]'), btnEl);
    btnEl.disabled = true;
  }
  try {
    const { text } = await apiPost('/api/extract-text', { url: link });
    if (!text || text.length < 50) throw new Error('no content');
    await apiPost('/api/saved-content', { url: link, title: paper?.title || '', text, savedAt: Date.now() });
    const cached = getOfflineCachedSet();
    cached.add(link);
    setLS('offlineCached', [...cached]);
    if (btnEl) { AetherUI.mount(RawHTML(_offlineCachedIcon()), btnEl); btnEl.classList.add('cached'); }
  } catch (e) {
    logger.error('cachePostOffline error', e);
    if (btnEl) {
      AetherUI.mount(RawHTML(_offlineDownloadIcon()), btnEl);
      btnEl.disabled = false;
    }
  }
}

export function _offlineDownloadIcon() {
  return icon('download', {size: 14, class: 'text-dimmer'});
}

export function _offlineCachedIcon() {
  return icon('checkCircle', {size: 14, class: 'text-green-400'});
}

export function getSavedPosts() {
  return getLS('savedPosts', {});
}
export function savePosts(data) { setLS('savedPosts', data); }
export function isPostSaved(link) { return !!getSavedPosts()[link]; }

function _detectContentType(url) {
  if (!url) return 'link';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('twitter.com') || host.includes('x.com') || host.includes('nitter')) return 'twitter';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (/\.pdf($|\?)/i.test(url) || host.includes('arxiv.org')) return 'pdf';
  } catch {}
  return 'link';
}

export function toggleSavePost(paper, event) {
  if (event) event.stopPropagation();
  const saved = getSavedPosts();
  const wasAdding = !saved[paper.link];
  if (saved[paper.link]) {
    delete saved[paper.link];
    _feedIPC('db:feed-unsave', paper.link);
  } else {
    saved[paper.link] = { paper, savedAt: Date.now(), read: false, groupId: 'uncategorized', contentType: _detectContentType(paper.link), thumbnail: paper.image || null, tags: [] };
    _feedIPC('db:feed-save', paper.link);
    if (typeof petReact === 'function') petReact('happy');
  }
  savePosts(saved);
  updateSavedBadge();
  window.renderPapers();
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

export function _showBookmarkFly(event) {
  // Flying bookmark icon from click position to pill island
  const target = document.getElementById('pill-island') || document.getElementById('sb-home');
  if (target) {
    const iconView = window.RawHTML(window.icon('bookmark', {size: 24, fill: 'var(--nr-accent)', stroke: 'var(--nr-accent)'}))
      .cssText('position:fixed;z-index:9999;pointer-events:none;transition:all 0.5s cubic-bezier(0.4,0,0.2,1);');
    const startX = event.clientX - 12;
    const startY = event.clientY - 12;
    iconView.el.style.left = startX + 'px';
    iconView.el.style.top = startY + 'px';
    iconView.el.style.opacity = '1';
    AetherUI.append(iconView, document.body);
    const tr = target.getBoundingClientRect();
    requestAnimationFrame(() => {
      iconView.el.style.left = (tr.left + tr.width / 2 - 8) + 'px';
      iconView.el.style.top = (tr.top + tr.height / 2 - 8) + 'px';
      iconView.el.style.opacity = '0';
      iconView.el.style.transform = 'scale(0.3)';
    });
    setTimeout(() => iconView.el.remove(), 550);
  }
}

export function markPostRead(link) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  saved[link].read = true;
  savePosts(saved);
  updateSavedBadge();
}

export function renderSavedPosts() {
  // Reading list is now part of the dashboard — no-op
}

export function toggleSavePostByLink(link) {
  const saved = getSavedPosts();
  if (saved[link]) {
    delete saved[link];
    savePosts(saved);
    updateSavedBadge();
    renderSavedPosts();
    window.renderPapers();
  }
}

export function openSavedPaper(link, e) {
  if (_isNewTabClick(e)) { _openInNewTab(link); return; }
  markPostRead(link);
  openBrowse(link);
}

// ── Core state vars ──
export let allPapers = [];
export const allCategories = new Set();
export const citationMap = {};
export const PAGE_SIZE = 20;
export const hiddenSourceFilters = new Set();

// ── Unsubscribe source ──
export function unsubscribeSource(key) {
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
  _feedIPC('db:feed-sources-sync', { [key]: false });
  // Remove posts from this source and re-render
  allPapers = allPapers.filter(p => p.source !== key);
  window.renderSourceBubbles();
  window.renderPapers();
}

// ── HN / Polymarket feeds ──
export async function fetchHNFeed() {
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

export async function fetchPolymarketFeed() {
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

// ── Feed source management ──
export const FEED_SOURCE_DEFAULTS = {};
let _feedDefaultsReady = false;
function _ensureFeedDefaults() {
  if (_feedDefaultsReady) return;
  _feedDefaultsReady = true;
  FEED_CATALOG.forEach(f => { FEED_SOURCE_DEFAULTS[f.key] = false; });
}

export function hasOnboarded() { return Settings.get('feedSources') !== null; }

export const onboardSelected = new Set();
export const onboardNotifSelected = new Set();

/* === Honeycomb globals === */
export const _hcPanX = 0, _hcPanY = 0;
export const _hcDragging = false, _hcDragStartX = 0, _hcDragStartY = 0, _hcPanStartX = 0, _hcPanStartY = 0;
export const _hcDidDrag = false;
export const _hcCircleEls = [];
export const _hcPositions = []; // {x, y, key}
export const _hcRafId = 0;
export const _hcMouseX = 0, _hcMouseY = 0;
export const _hcListenersAttached = false;
export let _hcActiveCategory = null; // null = All
export const _hcHoveredIdx = -1;
export const _hcZoom = 1;

export function _renderHcCategoryTabs() {
  const container = document.getElementById('hc-category-tabs');
  if (!container) return;
  const cats = [];
  FEED_CATALOG.forEach(function(f) { if (!cats.includes(f.cat)) cats.push(f.cat); });
  const tabs = [null].concat(cats).map(function(cat) {
    return window.View('button')
      .className('hc-tab' + ((cat === null ? _hcActiveCategory === null : _hcActiveCategory === cat) ? ' active' : ''))
      .onTap(function() { _hcSelectCategory(cat); })
      .add(window.Text(cat || 'All'));
  });
  AetherUI.mount(window.HStack(tabs).spacing(1), container);
}

export function _hcSelectCategory(cat) {
  _hcActiveCategory = cat;
  _renderHcCategoryTabs();
  renderOnboardGrid();
  _updateOnboardCardStates();
}

export function renderOnboardGrid() {
  const grid = document.getElementById('onboard-grid');
  const entries = _hcActiveCategory
    ? FEED_CATALOG.filter(function(f) { return f.cat === _hcActiveCategory; })
    : FEED_CATALOG;

  // Group by category
  const byCategory = {};
  entries.forEach(function(f) {
    if (!byCategory[f.cat]) byCategory[f.cat] = [];
    byCategory[f.cat].push(f);
  });

  const sections = [];
  Object.keys(byCategory).forEach(function(cat) {
    const items = byCategory[cat];
    const allOn = items.every(function(f) { return onboardSelected.has(f.key); });
    const toggleBtn = new window.View('button').className('text-[0.68rem] text-dimmer hover:text-primary cursor-pointer bg-transparent border-none transition-colors');
    toggleBtn.el.textContent = allOn ? 'Deselect all' : 'Select all';
    toggleBtn.onTap(function() { _toggleOnboardCategory(cat); });

    const header = window.HStack(
      window.Text(cat).className('text-[0.72rem] text-dim uppercase tracking-wider font-medium'),
      new window.View('span').className('flex-1 h-px bg-border-subtle'),
      toggleBtn
    ).spacing(2).className('mb-1.5 px-1');

    const itemViews = items.map(function(f) {
      const sel = onboardSelected.has(f.key);
      const iconHtml = f.favicon
        ? '<img src="/api/favicon?domain=' + f.favicon + '" class="w-5 h-5 rounded" onerror="this.outerHTML=\'<span class=\\\'inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold\\\' style=\\\'background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '\\\'>' + (f.letter || f.name[0]) + '</span>\'">'
        : '<span class="inline-flex items-center justify-center w-5 h-5 rounded text-[0.6rem] font-bold" style="background:' + (f.bg || '#333') + ';color:' + (f.fg || '#fff') + '">' + (f.letter || f.name[0]) + '</span>';
      const checkHtml = sel ? icon('check', {size: 12, class: 'w-3 h-3 text-white', strokeWidth: '3'}) : '';
      return window.HStack(
        window.RawHTML(iconHtml),
        window.VStack(
          window.Text(f.name).className('text-[0.82rem] font-medium ' + (sel ? 'text-primary' : 'text-muted') + ' truncate'),
          window.Text(f.desc).className('text-[0.7rem] text-dimmer truncate')
        ).className('flex-1 min-w-0'),
        window.RawHTML('<div class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ' + (sel ? 'border-accent bg-accent' : 'border-border-input bg-transparent') + '">' + checkHtml + '</div>')
      ).spacing(2).className('onboard-source flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors hover:bg-hover' + (sel ? ' onboard-selected' : ''))
        .attr('data-source', f.key)
        .onTap(function() { toggleOnboardSource(f.key); });
    });

    const section = window.VStack([header].concat(itemViews)).className('mb-4');
    sections.push(section);
  });

  AetherUI.mount(window.VStack(sections), grid);
}

export function toggleOnboardSource(key) {
  if (onboardSelected.has(key)) {
    onboardSelected.delete(key);
    onboardNotifSelected.delete(key);
  } else {
    onboardSelected.add(key);
  }
  renderOnboardGrid();
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

export function _toggleOnboardCategory(cat) {
  const items = FEED_CATALOG.filter(f => f.cat === cat);
  const allOn = items.every(f => onboardSelected.has(f.key));
  items.forEach(f => {
    if (allOn) { onboardSelected.delete(f.key); onboardNotifSelected.delete(f.key); }
    else onboardSelected.add(f.key);
  });
  renderOnboardGrid();
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

export function _updateOnboardCardStates() {
  document.getElementById('onboard-start-btn').disabled = onboardSelected.size === 0;
}

export function showOnboarding() {
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

export function completeOnboarding() {
  const sources = {};
  const notifSources = {};
  FEED_CATALOG.forEach(f => {
    sources[f.key] = onboardSelected.has(f.key);
    notifSources[f.key] = onboardNotifSelected.has(f.key);
  });
  setLS('feedSources', sources);
  setLS('feedNotifSources', notifSources);
  _feedIPC('db:feed-sources-sync', sources);
  document.getElementById('onboard-view').style.display = 'none';
  document.getElementById('home-feed-section').style.display = '';
  // Show top pill bar after onboarding
  const pillBar = document.getElementById('sidebar-nav');
  if (pillBar) pillBar.style.display = '';
  loadAllFeeds();
}

export function getFeedSources() {
  _ensureFeedDefaults();
  return { ...FEED_SOURCE_DEFAULTS, ...getLS('feedSources', {}) };
}

export function getCustomFeeds() {
  return getLS('customFeeds', []);
}

export function renderCustomFeedsList() {
  const list = document.getElementById('custom-feeds-list');
  if (!list) return;
  const feeds = getCustomFeeds();
  if (!feeds.length) { AetherUI.mount(window.Text('No custom feeds added.').className('text-dim text-[0.78rem]'), list); return; }
  const rows = feeds.map(function(f, i) {
    const toggle = window.RawHTML('<span class="nr-switch"><input type="checkbox" ' + (f.enabled !== false ? 'checked' : '') + '><span class="slider"></span></span>');
    toggle.el.querySelector('input').addEventListener('change', function() { toggleCustomFeed(i, this.checked); });
    const removeBtn = window.View('button').className('text-dim hover:text-red-400 bg-transparent border-none cursor-pointer text-base leading-none').attr('title', 'Remove')
      .onTap(function() { removeCustomFeed(i); });
    removeBtn.add(window.Text('\u00d7'));
    return window.HStack(
      window.Text(f.name || f.url).className('text-primary text-[0.78rem] truncate flex-1').attr('title', f.url),
      window.HStack(toggle, removeBtn).spacing(2).className('shrink-0')
    ).spacing(2).className('flex items-center justify-between bg-input rounded-md px-3 py-2');
  });
  AetherUI.mount(window.VStack(rows).spacing(2), list);
}

export async function addCustomFeed() {
  const input = document.getElementById('custom-feed-url');
  let url = input.value.trim();
  if (!url) return;
  // Auto-detect Substack: convert blog URL to RSS feed URL
  if (/^https?:\/\/[\w-]+\.substack\.com\/?$/.test(url)) {
    url = url.replace(/\/?$/, '/feed');
  }
  const feeds = getCustomFeeds();
  if (feeds.some(f => f.url === url)) return;
  // Try to fetch the feed title via IPC proxy
  let name = url;
  try { name = new URL(url).hostname.replace(/^www\./, '').replace(/^api\./, ''); } catch (e) { /* fire-and-forget */ }
  try {
    const result = await electronAPI.dbQuery('db:rss-proxy', url);
    if (result && result._proxy) {
      const xml = atob(result.data);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const feedTitle = (doc.querySelector('channel > title, feed > title')?.textContent || '').trim();
      if (feedTitle) name = feedTitle;
    }
  } catch (_) { /* proxy unavailable — use hostname as name */ }
  feeds.push({ url, name, enabled: true });
  setLS('customFeeds', feeds);
  input.value = '';
  renderCustomFeedsList();
  _feedIPC('db:feed-source-add', { key: 'custom:' + name, name, url, cat: 'Custom' });
  allPapers = [];
  loadAllFeeds();
}

export function removeCustomFeed(index) {
  const feeds = getCustomFeeds();
  const removed = feeds.splice(index, 1)[0];
  setLS('customFeeds', feeds);
  if (removed) _feedIPC('db:feed-sources-sync', { ['custom:' + removed.name]: false });
  renderCustomFeedsList();
  allPapers = [];
  loadAllFeeds();
}

export function toggleCustomFeed(index, enabled) {
  const feeds = getCustomFeeds();
  feeds[index].enabled = enabled;
  setLS('customFeeds', feeds);
  const f = feeds[index];
  _feedIPC('db:feed-sources-sync', { ['custom:' + f.name]: enabled });
  allPapers = [];
  loadAllFeeds();
}

// ── Feed loading ──
export async function fetchGenericRSS(feedUrl, sourceName) {
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

export function allSourcesOff() {
  const s = getFeedSources();
  const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
  return !FEED_CATALOG.some(f => s[f.key]) && customFeeds.length === 0;
}

export let _feedAbort = null;

export async function loadAllFeeds() {
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
    AetherUI.mount(window.RawHTML('<div style="grid-column:1/-1" class="flex items-center justify-center h-[60vh]"><span class="spinner"></span></div>'), container);
  }

  // Seed sources and sync prefs on first contact
  if (!_sourcesSynced) {
    _sourcesSynced = true;
    try {
      await electronAPI.dbQuery('db:feed-sources-init', FEED_CATALOG);
      await electronAPI.dbQuery('db:feed-sources-sync', getFeedSources());
      const customFeeds = getCustomFeeds().filter(f => f.enabled !== false);
      for (const f of customFeeds) {
        await electronAPI.dbQuery('db:feed-source-add', { key: 'custom:' + f.name, name: f.name, url: f.url, cat: 'Custom' });
      }
    } catch (_) { /* ignore init errors */ }
  }

  // Fetch ranked timeline via IPC
  try {
    const result = await electronAPI.dbQuery('db:feed-timeline', { sort: 'latest', limit: 2000 });
    if (abort.signal.aborted) return;
    if (result && result.items) {
      allPapers = result.items;
      window.renderPapers();
      if (typeof islandUpdate === 'function') islandUpdate('feed', { type: 'feed', label: 'Loading feeds', detail: 'Feed loaded' });
      // Trigger background refresh so next load has fresher data
      electronAPI.dbQuery('db:feed-refresh').catch(() => {});
    }
  } catch (e) {
    if (abort.signal.aborted) return;
    if (typeof islandRemove === 'function') islandRemove('feed');
    AetherUI.mount(window.VStack(
      window.Text('Feed unavailable').foreground('red'),
      window.Text('Could not load feed data.').className('mt-2 text-[0.85rem] text-muted')
    ).className('text-center py-20 text-red-400'), container);
    return;
  }

  if (abort.signal.aborted) return;
  window.renderTrends();
  if (typeof computeInterestProfile === 'function') computeInterestProfile();
  window.renderPapers();
  if (typeof islandUpdate === 'function') islandUpdate('feed', { type: 'feed', label: 'Feeds loaded', detail: 'Feed refresh complete', done: true });
  if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();
  _detectNewPosts();
  startRefreshTimer();
}

export function extractArxivId(link) {
  const m = link.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
  return m ? m[1] : null;
}

export function parseFeed(xml) {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      logger.error('Feed parsing error:', parserError.textContent);
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
    logger.error('Error parsing feed:', e);
    return [];
  }
}

export async function fetchCitationsFor(papers) {
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
    window.renderPapers();
  } catch (e) { /* silently fail */ }
}

// ── extractAuthors (used by parseFeed) ──
export function extractAuthors(desc) {
  const m = desc.match(/Authors?:\s*(.+?)(?:\.|<br|$)/i);
  return m ? m[1].trim() : '';
}

// ── lastFilteredPapers (shared state for card menus) ──
export let lastFilteredPapers = [];
export function setLastFilteredPapers(arr) { lastFilteredPapers = arr; }
