import Settings from '/js/core/core-settings.js';
import { ipcRoute } from '/js/api-ipc.js';
import { apiPost, apiGet, apiDelete } from '/js/api.js';
import { formatDate, escapeHtml, escapeAttr, stripHtml, getPaperRatings, getPaperRating, _normalizeRatingKey, truncate, renderTitle, renderStarRating } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { getLS, setLS } from '/js/core/core-auth.js';
import { _isNewTabClick, _openInNewTab } from '/js/core/core-layout.js';
import { FEED_CAT_MAP, getSourceChip, SOURCE_LOGO_INLINE, SOURCE_NAMES } from '/js/core/core-views.js';
import { _relativeTime } from '/js/search.js';
import { openBrowse, openLocalPdf } from '/js/browse/browse-windows.js';
import { openPaper } from '/js/panel.js';
import { petReact } from '/js/pixel-pet.js';
import { logger } from '/js/logger.js';
import { allPapers, allCategories, citationMap, hiddenSourceFilters, PAGE_SIZE, getSavedPosts, isPostSaved, toggleSavePost, isPostCached, _offlineCachedIcon, _offlineDownloadIcon, cachePostOffline, markPostAsRead, openCardMenu, getSourceAffinity, getInterestProfile, _computeContentScore, getHiddenPosts, getReadPosts, getBlockedWords, _renderedLinks, setRenderedLinks, _previousPostLinks, lastFilteredPapers, setLastFilteredPapers, fetchCitationsFor, showOnboarding, loadAllFeeds } from '/js/feed/feed-data.js';
import { currentSort, feedViewMode, getFilteredPapers, parseSearchQuery, visibleCount, setVisibleCount } from '/js/feed/feed-filter.js';

// ── Card rendering helpers ──

function _scoreBadge(p) {
  if (p._compositeScore == null) return null;
  return window.Text(String(Math.round(p._compositeScore))).className('text-[0.6rem] text-dimmer tabular-nums opacity-60 shrink-0');
}

function _displayDate(p) {
  if (p.pubDate) {
    const d = new Date(p.pubDate);
    if (!isNaN(d)) return formatDate(d);
  }
  if (p.date) {
    const d = new Date(p.date);
    if (!isNaN(d)) return formatDate(d);
  }
  return p.date || '';
}

export function _renderPaperCompactRow(p, i, ctx) {
  const readSet = ctx.readSet;
  const sourceChip = getSourceChip(p.source, p.arxivId);
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const actionWrap = new window.View('span').className('ml-auto flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity');
  actionWrap.add(_cardActionRow(p, i, ctx));
  const row = window.HStack(
    isNew && !isRead ? new window.View('span').className('inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0') : null,
    window.RawHTML(sourceChip),
    window.RawHTML('<span class="text-[0.82rem] ' + (isRead ? 'text-muted' : 'text-primary') + ' truncate">' + renderTitle(p.title) + '</span>'),
    actionWrap,
    _scoreBadge(p),
    (function() { const dd = _displayDate(p); return dd ? window.Text(dd).className('text-[0.68rem] text-dim shrink-0') : null; })()
  ).spacing(2).className('py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors')
    .onTap(function(e) { openPaper(i, e); });
  return window.VStack(row, _cardCommentContainer(p, i))
    .className('group' + (isRead ? ' opacity-50' : ''))
    .attr('data-link', p.link);
}

// ── Card renderers ──

export function _renderPaperCard(p, i, ctx) {
  const readSet = ctx.readSet;
  const isHN = p.source === 'hn';
  const _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
  const sourceLabel = _hasExternalLink ? (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return SOURCE_NAMES[p.source] || p.source; } })() : (SOURCE_NAMES[p.source] || p.source);
  const isPoly = p.source === 'polymarket';
  const snippet = isPoly ? '' : (p.description ? truncate(stripHtml(p.description), 120) : '');
  const nLink = _normalizeRatingKey(p.link);
  const userRating = ctx.ratings ? (ctx.ratings[nLink] || ctx.ratings[p.link] || 0) : getPaperRating(p.link);
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return '/api/favicon?domain=' + encodeURIComponent(new URL(p.link).hostname); } catch(e) { return ''; } })();
  const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  const imgView = window.RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);

  // Title row
  const titleHtml = (isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '') + renderTitle(p.title);
  const titleEl = window.RawHTML(titleHtml);
  titleEl.className('text-[0.92rem] font-semibold ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug min-w-0');
  const titleRow = window.HStack(imgView, titleEl).spacing(2).className('items-center');

  // Body
  let body = null;
  if (snippet) {
    body = window.Text(snippet).className('text-[0.78rem] text-muted leading-relaxed mt-1.5');
  }

  // Meta row
  const metaItems = [window.Text(sourceLabel).className('text-[0.75rem] text-dim')];
  if (_hasExternalLink) metaItems.push(window.RawHTML('<span class="text-[0.68rem] text-dimmer">via ' + escapeHtml(SOURCE_NAMES[p.source] || p.source) + (isHN ? ' \u00b7 ' + p.hnScore + ' pts' : '') + '</span>'));
  if (!(isHN && _hasExternalLink)) {
    if (isHN) metaItems.push(window.Text(p.hnScore + ' pts').className('text-[0.68rem] text-dim'));
    else if (isPoly) metaItems.push(window.Text(p.polyYesPct + '%').className('text-[0.68rem] font-semibold ' + (p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400')));
    else if (p.citations !== undefined) metaItems.push(window.Text(p.citations + ' cited').className('text-[0.68rem] text-dim'));
  }
  if (userRating > 0) metaItems.push(window.RawHTML(renderStarRating(p.link, { size: 'sm', interactive: false })));
  const dd = _displayDate(p);
  if (dd) metaItems.push(window.Text(dd).className('text-[0.68rem] text-dim'));
  const badge = _scoreBadge(p);
  if (badge) metaItems.push(badge);
  metaItems.push(_cardActionRow(p, i, ctx));
  const metaRow = HStack(metaItems).spacing(2).className('flex-wrap mt-2');

  const card = window.VStack(titleRow, body, metaRow, _cardCommentContainer(p, i));
  card.className('paper break-inside-avoid bg-card border border-border-card rounded-xl p-4 mb-3.5 cursor-pointer transition-all duration-150' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

export function _renderPaperVerboseCard(p, i, ctx) {
  const readSet = ctx.readSet;
  const isHN = p.source === 'hn';
  const _hasExternalLink = p.commentsUrl || (isHN && !/news\.ycombinator\.com/.test(p.link));
  const sourceName = _hasExternalLink ? (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return SOURCE_NAMES[p.source] || p.source; } })() : (SOURCE_NAMES[p.source] || p.source);
  const isPoly = p.source === 'polymarket';
  const fullDesc = isPoly ? '' : (p.description ? stripHtml(p.description) : '');
  const pCats = Array.isArray(p.categories) ? p.categories : [];
  const nLink = _normalizeRatingKey(p.link);
  const userRating = ctx.ratings[nLink] || ctx.ratings[p.link] || 0;
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return '/api/favicon?domain=' + encodeURIComponent(new URL(p.link).hostname); } catch(e) { return ''; } })();
  const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  const imgView = window.RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-8 h-8 rounded-lg shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);

  // Title row
  const titleHtml = (isNew && !isRead ? '<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>' : '') + renderTitle(p.title);
  const titleEl = window.RawHTML(titleHtml);
  titleEl.className('text-[1rem] font-semibold ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug min-w-0');
  const titleRow = window.HStack(imgView, titleEl).spacing(2).className('items-center');

  // Authors
  const authorsView = p.authors ? window.Text(truncate(p.authors, 200)).className('text-[0.76rem] text-dimmer mt-1') : null;

  // Description
  const descView = fullDesc ? window.Text(fullDesc).className('text-[0.82rem] text-muted leading-relaxed mt-2') : null;

  // Categories
  let catsView = null;
  if (pCats.length) {
    const catItems = pCats.slice(0, 6).map(function(c) {
      return window.Text(c).className('text-[0.65rem] px-1.5 py-0.5 rounded bg-hover text-dim');
    });
    catsView = HStack(catItems).spacing(0.5).className('flex-wrap mt-1.5');
  }

  // Meta row
  const metaItems = [window.Text(sourceName).className('text-[0.72rem] text-dim')];
  if (_hasExternalLink) metaItems.push(window.RawHTML('<span class="text-[0.72rem] text-dimmer">via ' + escapeHtml(SOURCE_NAMES[p.source] || p.source) + (isHN ? ' \u00b7 ' + p.hnScore + ' pts' : '') + '</span>'));
  if (!(isHN && _hasExternalLink)) {
    if (isHN) metaItems.push(window.Text(p.hnScore + ' pts').className('text-[0.72rem] text-dim'));
    else if (isPoly) metaItems.push(window.Text(p.polyYesPct + '%').className('text-[0.72rem] font-semibold ' + (p.polyYesPct >= 50 ? 'text-green-400' : 'text-red-400')));
    else if (p.citations !== undefined) metaItems.push(window.Text(p.citations + ' cited').className('text-[0.72rem] text-dim'));
  }
  if (userRating > 0) metaItems.push(window.RawHTML(renderStarRating(p.link, { size: 'sm', interactive: false })));
  const dd2 = _displayDate(p);
  if (dd2) metaItems.push(window.Text(dd2).className('text-[0.72rem] text-dim'));
  const vBadge = _scoreBadge(p);
  if (vBadge) metaItems.push(vBadge);
  metaItems.push(_cardActionRow(p, i, ctx));
  const metaRow = HStack(metaItems).spacing(2).className('flex-wrap mt-3');

  const card = window.VStack(titleRow, authorsView, descView, catsView, metaRow, _cardCommentContainer(p, i));
  card.className('paper bg-card border border-border-card rounded-xl p-5 cursor-pointer transition-all duration-150' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

export function _renderPaperTwitterCard(p, i, ctx) {
  const readSet = ctx.readSet;
  const isHN = p.source === 'hn';
  const sourceName = SOURCE_NAMES[p.source] || p.source;
  const handle = (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return p.source; } })();
  const isPoly = p.source === 'polymarket';
  const snippet = isPoly ? '' : (p.description ? truncate(stripHtml(p.description), 280) : '');
  const isSaved = !!ctx.savedPosts[p.link];
  const bmFill = isSaved ? 'var(--nr-accent)' : 'none';
  const bmStroke = isSaved ? 'var(--nr-accent)' : 'currentColor';
  const isNew = _previousPostLinks.size > 0 && !_previousPostLinks.has(p.link);
  const isRead = readSet.has(p.link);
  const cardImgSrc = isPoly && p.polyImage ? escapeAttr(p.polyImage) : (function() { try { return '/api/favicon?domain=' + encodeURIComponent(new URL(p.link).hostname); } catch(e) { return ''; } })();
  const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title) : '';
  const avatarView = window.RawHTML(cardImgSrc ? '<img src="' + cardImgSrc + '" class="w-10 h-10 rounded-full shrink-0 object-cover" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">' : pixelFallback);
  const tAgo = _displayDate(p);
  const hnPts = isHN ? p.hnScore || 0 : 0;
  const citations = p.citations !== undefined ? p.citations : null;
  const statsNum = isPoly ? p.polyYesPct + '%' : isHN ? String(hnPts) : (citations !== null ? String(citations) : '');
  const reposted = ctx.repostedSet.has(p.link);
  const commentCount = _tweetCommentCounts[p.link] || '';

  // Build action buttons using AetherUI
  const btnClass = 'group flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 transition-colors';
  const commentBtn = window.RawHTML('<button class="' + btnClass + ' text-dimmer hover:text-blue-400">' + icon('chatBubble', {size: 16, class: 'w-4 h-4'}) + '<span class="text-[0.72rem]" data-tweet-comment-count="' + escapeAttr(p.link) + '">' + commentCount + '</span></button>');
  commentBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); _toggleTweetComments(p.link, i); });
  const repostBtn = window.RawHTML('<button class="' + btnClass + ' ' + (reposted ? '' : 'text-dimmer hover:text-green-400') + '" style="' + (reposted ? 'color:rgb(74,222,128)' : '') + '">' + icon('repost', {size: 16, class: 'w-4 h-4'}) + '<span class="text-[0.72rem]">' + statsNum + '</span></button>');
  repostBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); _tweetRepost(i, repostBtn.el.firstChild); });
  const bmBtn = window.RawHTML('<button class="' + btnClass + '" style="color:' + (bmFill === 'none' ? 'var(--nr-text-quaternary)' : 'var(--nr-accent)') + '">' + icon('bookmark', {size: 16, class: 'w-4 h-4', fill: bmFill, stroke: bmStroke}) + '</button>');
  bmBtn.el.firstChild.addEventListener('click', function(e) { e.stopPropagation(); toggleSavePost(lastFilteredPapers[i], e); });
  const menuBtn = window.RawHTML('<button class="' + btnClass + ' text-dimmer hover:text-primary">' + icon('moreVertical', {size: 16, class: 'w-4 h-4'}) + '</button>');
  menuBtn.el.firstChild.addEventListener('click', function(e) { openCardMenu(menuBtn.el.firstChild, e, i); });
  const actionBar = window.HStack(commentBtn, repostBtn, bmBtn, menuBtn).className('justify-between mt-2.5 max-w-[400px]');

  // Header line
  const headerItems = [];
  if (isNew && !isRead) headerItems.push(window.RawHTML('<span class="inline-block w-2 h-2 rounded-full bg-accent shrink-0" title="New"></span>'));
  headerItems.push(window.Text(sourceName).className('text-[0.88rem] font-bold ' + (isRead ? 'text-muted' : 'text-primary')));
  headerItems.push(window.Text('@' + handle).className('text-[0.8rem] text-dimmer'));
  headerItems.push(window.Text('\u00b7').className('text-dimmer'));
  headerItems.push(window.Text(tAgo).className('text-[0.8rem] text-dimmer'));
  const tBadge = _scoreBadge(p);
  if (tBadge) headerItems.push(tBadge);
  const headerRow = HStack(headerItems).spacing(1).className('flex-wrap');

  // Title
  const titleEl = window.RawHTML(renderTitle(p.title));
  titleEl.className('text-[0.92rem] ' + (isRead ? 'text-muted' : 'text-primary') + ' leading-snug mt-1 font-semibold');

  // Body content
  const bodyChildren = [headerRow, titleEl];
  if (snippet) bodyChildren.push(window.Text(snippet).className('text-[0.84rem] text-muted leading-relaxed mt-1'));
  bodyChildren.push(actionBar);
  bodyChildren.push(_cardCommentContainer(p, i));

  const content = VStack(bodyChildren);
  content.className('min-w-0 flex-1');

  const card = window.HStack(avatarView, content).spacing(3);
  card.className('py-3 px-4 border-b border-border-card cursor-pointer transition-colors hover:bg-hover' + (isRead ? ' opacity-50' : ''));
  card.attr('data-link', p.link);
  card.onTap(function(e) { openPaper(i, e); });
  return card;
}

// ── Rendering orchestration ──

export let _renderPapersRafId = 0;
export function renderPapers() {
  if (_renderPapersRafId) return; // already scheduled
  _renderPapersRafId = requestAnimationFrame(() => {
    _renderPapersRafId = 0;
    _renderPapersNow();
    if (typeof Motion !== 'undefined') Motion.pulse.emit('feed', { label: 'render', detail: allPapers.length + ' posts' });
  });
}

export function _buildRenderCtx() {
  const hiddenSet = new Set(getHiddenPosts());
  const readSet = new Set(getReadPosts());
  const blockedWords = new Set(getBlockedWords());
  const savedPosts = getSavedPosts();
  const repostedSet = new Set(_getRepostedLinks());
  const ratings = getPaperRatings();
  return { hiddenSet, readSet, blockedWords, savedPosts, repostedSet, ratings };
}

export function _renderFeedEmptyState(container, hasUnfilteredPapers) {
  const msg = hasUnfilteredPapers ? 'No recommendations match your filter' : 'No recommendations';
  const children = [ window.Text(msg).className('text-dim').styles({fontSize:'0.9rem'}) ];
  if (!hasUnfilteredPapers) {
    const selectBtn = window.Button('Select sources').onTap(function() { showOnboarding(); });
    const refreshBtn = window.Button('Refresh feeds').onTap(function() { loadAllFeeds(); });
    children.push(window.HStack(selectBtn, refreshBtn).spacing(3));
  }
  const v = window.VStack(children).alignment('center').styles({justifyContent:'center', gridColumn:'1 / -1', padding:'5rem 0'}).spacing(4);
  AetherUI.mount(v, container);
}

// ── Filtered papers rendering ──

export function _renderFilteredPapers(filtered, ctx) {
  const visible = filtered.slice(0, visibleCount);
  document.getElementById('stats').textContent = 'Showing ' + visible.length + ' of ' + filtered.length;
  const container = document.getElementById('papers');
  if (!filtered.length) {
    _renderFeedEmptyState(container, allPapers.length > 0);
    return;
  }

  const cards = visible.map(function(p, i) {
    if (feedViewMode === 'compact') return _renderPaperCompactRow(p, i, ctx);
    if (feedViewMode === 'verbose') return _renderPaperVerboseCard(p, i, ctx);
    if (feedViewMode === 'twitter') return _renderPaperTwitterCard(p, i, ctx);
    return _renderPaperCard(p, i, ctx);
  });

  if (feedViewMode === 'compact' || feedViewMode === 'verbose' || feedViewMode === 'twitter') {
    const wrapClass = feedViewMode === 'twitter' ? 'flex flex-col max-w-[600px] mx-auto' : 'flex flex-col' + (feedViewMode === 'verbose' ? ' gap-3' : '');
    const wrap = VStack(cards).className(wrapClass);
    wrap.styles({ gridColumn: '1 / -1' });
    AetherUI.mount(wrap, container);
  } else {
    // Block view: cards are direct children of container for CSS columns
    const frag = new View('div').className('contents');
    cards.forEach(function(c) { frag.add(c); });
    AetherUI.mount(frag, container);
  }

  // Animate cards that are new since the last render
  const prevLinks = _renderedLinks;
  setRenderedLinks(new Set(visible.map(function(p) { return p.link; })));
  if (prevLinks.size > 0) {
    let _feedNewIdx = 0;
    container.querySelectorAll('[data-link]').forEach(function(el) {
      if (!prevLinks.has(el.dataset.link)) {
        Motion.fadeIn(el, { y: 8, delay: _feedNewIdx * Motion.stagger.tight });
        _feedNewIdx++;
        const dot = new View('span').className('feed-new-dot');
        el.style.position = 'relative';
        AetherUI.append(dot, el);
      }
    });
  }
  fetchCitationsFor(visible);
  _fetchTweetCommentCounts(visible);
  visible.forEach(function(p, i) {
    if (_tweetCommentsOpen.has(p.link)) {
      const cmtContainer = document.getElementById('tweet-comments-' + i);
      if (cmtContainer) {
        cmtContainer.style.display = 'block';
        apiGet('/api/comments?paperLink=' + encodeURIComponent(p.link))
          .then(function(comments) { _renderTweetComments(cmtContainer, comments, p.link, i); })
          .catch(function(e) { logger.warn('loadTweetComments:', e); });
      }
    }
  });
}

// ── Worker management ──

let _feedWorker = null;
let _workerRequestId = 0;
const _workerResolves = new Map();

function _getFeedWorker() {
  if (_feedWorker) return _feedWorker;
  try {
    _feedWorker = new Worker('/js/workers/feed-worker.js');
    _feedWorker.onmessage = _handleWorkerMessage;
    _feedWorker.onerror = function(e) {
      logger.warn('Feed worker error:', e);
      _feedWorker = null;
    };
    return _feedWorker;
  } catch (e) {
    logger.warn('Feed worker init failed:', e);
    return null;
  }
}

function _handleWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'scored') {
    const resolve = _workerResolves.get(msg.requestId);
    _workerResolves.delete(msg.requestId);
    if (resolve) resolve(msg);
  }
}

function _cancelPendingWorkerRequest() {
  // Discard all pending resolves — stale results will be ignored
  _workerResolves.clear();
}

function _scoreInWorker(papers, ctx, searchQuery, category) {
  const worker = _getFeedWorker();
  if (!worker) return null;
  const requestId = ++_workerRequestId;
  return new Promise(function(resolve) {
    _workerResolves.set(requestId, resolve);
    worker.postMessage({
      type: 'score',
      requestId: requestId,
      papers: papers,
      userState: {
        readPosts: Array.from(ctx.readSet),
        savedPosts: ctx.savedPosts,
        hiddenPosts: Array.from(ctx.hiddenSet),
        blockedWords: Array.from(ctx.blockedWords),
        ratings: ctx.ratings
      },
      params: {
        searchQuery: searchQuery,
        category: category,
        currentSort: currentSort,
        hiddenSourceFilters: Array.from(hiddenSourceFilters),
        SOURCE_NAMES: SOURCE_NAMES,
        FEED_CAT_MAP: FEED_CAT_MAP,
        fyWeightBase: Settings.get('fyWeightBase') || '0.7',
        fyWeightAffinity: Settings.get('fyWeightAffinity') || '0.3',
        fyWeightRecency: Settings.get('fyWeightRecency') || '1.0',
        fyWeightExploration: Settings.get('fyWeightExploration') || '0.10',
        maxPerCategoryRun: Settings.get('maxPerCategoryRun') || '3'
      }
    });
  });
}

export function _renderPapersNow() {
  const ctx = _buildRenderCtx();
  const searchQuery = document.getElementById('search')?.value || '';
  const category = document.getElementById('category')?.value || '';

  const worker = _getFeedWorker();
  if (!worker) {
    // Synchronous fallback (current code path)
    const filtered = getFilteredPapers(ctx);
    setLastFilteredPapers(filtered);
    _renderFilteredPapers(filtered, ctx);
    return;
  }

  _cancelPendingWorkerRequest();
  _scoreInWorker(allPapers, ctx, searchQuery, category).then(function(result) {
    if (!result) return;
    setLastFilteredPapers(result.filteredIndices.map(function(i) {
      if (result.compositeScores[i] != null) allPapers[i]._compositeScore = result.compositeScores[i];
      return allPapers[i];
    }));
    if (result.interestProfile) Settings.set('interestProfile', JSON.stringify(result.interestProfile));
    _renderFilteredPapers(lastFilteredPapers, ctx);
  });
}

// ── Twitter view: inline comments & repost ──

export const _tweetCommentCounts = {}; // link -> count
export const _tweetCommentsOpen = new Set(); // links with expanded comment sections

export async function _fetchTweetCommentCounts(papers) {
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

export async function _toggleTweetComments(link, idx) {
  const container = document.getElementById('tweet-comments-' + idx);
  if (!container) return;
  if (_tweetCommentsOpen.has(link)) {
    _tweetCommentsOpen.delete(link);
    AetherUI.mount(new View('div'), container);
    container.style.display = 'none';
    return;
  }
  _tweetCommentsOpen.add(link);
  container.style.display = 'block';
  AetherUI.mount(window.Skeleton().lines(2).padding(2), container);
  try {
    const comments = await apiGet('/api/comments?paperLink=' + encodeURIComponent(link));
    _tweetCommentCounts[link] = comments.length;
    // Update badge
    const badge = document.querySelector(`[data-tweet-comment-count="${CSS.escape(link)}"]`);
    if (badge) badge.textContent = comments.length || '';
    _renderTweetComments(container, comments, link, idx);
  } catch {
    AetherUI.mount(window.Text('Failed to load comments').className('text-red-400 text-[0.75rem] py-2'), container);
  }
}

export function _renderTweetComments(container, comments, link, idx) {
  const topLevel = comments.filter(function(c) { return !c.parentId; }).sort(function(a, b) { return a.timestamp - b.timestamp; });
  const byParent = {};
  comments.forEach(function(c) { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
  const currentUser = (typeof window._authUserInfo !== 'undefined' && window._authUserInfo && window._authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';

  function renderThread(c, depth) {
    const replies = (byParent[c.id] || []).sort(function(a, b) { return a.timestamp - b.timestamp; });
    const ml = depth > 0 ? 'margin-left:' + Math.min(depth, 4) * 16 + 'px; border-left: 2px solid var(--nr-border-default); padding-left: 8px;' : '';
    const initial = (c.author || '?')[0].toUpperCase();
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
    const isOwn = c.author === currentUser;

    const avatar = new window.View('div')
      .cssText('width:20px;height:20px;min-width:20px;border-radius:50%;background:var(--nr-accent);color:#fff;font-size:0.6rem;font-weight:700;display:flex;align-items:center;justify-content:center');
    avatar.add(window.Text(initial));

    const authorEl = new window.View('a')
      .className('text-[0.72rem] font-medium text-primary hover:text-accent')
      .attr('href', '#profile/' + encodeURIComponent(c.author))
      .styles({textDecoration: 'none'})
      .onTap(function(e) { e.stopPropagation(); });
    authorEl.add(window.Text(c.author));

    const metaItems = [authorEl, window.Text(timeAgo).className('text-[0.65rem] text-dimmer')];
    if (isOwn) {
      metaItems.push(
        new window.View('button')
          .className('cmt-del text-dimmest hover:text-red-400 text-[0.65rem] ml-auto bg-transparent border-none cursor-pointer')
          .attr('data-cid', c.id)
          .onTap(function(e) { e.stopPropagation(); _deleteTweetComment(c.id, link, idx); })
          .add(window.Text('x'))
      );
    }
    const metaRow = window.HStack(metaItems).spacing(1.5).className('items-center');

    const contentDiv = window.RawHTML('<div class="text-[0.78rem] text-primary mt-0.5 leading-relaxed">' + escapeHtml(c.content).replace(/\n/g, '<br>') + '</div>');

    const showReplyBtn = new window.View('button')
      .className('cmt-show-reply text-[0.68rem] text-dim hover:text-accent mt-0.5 bg-transparent border-none cursor-pointer p-0')
      .attr('data-cid', c.id)
      .onTap(function(e) { e.stopPropagation(); _showTweetReply(c.id); });
    showReplyBtn.add(window.Text('Reply'));

    const replyTa = new window.View('textarea')
      .id('tweet-reply-ta-' + c.id)
      .className('w-full text-[0.75rem] bg-input border border-border-input rounded px-2 py-1 text-primary resize-none outline-none focus:border-accent')
      .attr('rows', '2').attr('placeholder', 'Write a reply...')
      .onTap(function(e) { e.stopPropagation(); });

    const replyBtnRow = window.HStack(
      new window.View('button')
        .className('cmt-reply-submit px-2 py-0.5 text-[0.68rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none')
        .attr('data-cid', c.id)
        .onTap(function(e) { e.stopPropagation(); _postTweetReply(c.id, link, idx); })
        .add(window.Text('Reply')),
      new window.View('button')
        .className('cmt-reply-cancel px-2 py-0.5 text-[0.68rem] rounded border border-border-input text-dim hover:text-primary cursor-pointer bg-transparent')
        .attr('data-cid', c.id)
        .onTap(function(e) { e.stopPropagation(); _hideTweetReply(c.id); })
        .add(window.Text('Cancel'))
    ).spacing(1).className('mt-1');

    const replyForm = window.VStack(replyTa, replyBtnRow)
      .id('tweet-reply-' + c.id).className('hidden mt-1');

    const body = window.VStack(metaRow, contentDiv, showReplyBtn, replyForm).className('flex-1 min-w-0');
    const row = window.HStack(avatar, body).spacing(1.5).className('items-start');

    const threadEl = window.VStack(row).cssText(ml + '; margin-bottom: 6px;');
    replies.forEach(function(r) { threadEl.add(renderThread(r, depth + 1)); });
    return threadEl;
  }

  const threadViews = topLevel.length
    ? topLevel.map(function(c) { return renderThread(c, 0); })
    : [window.Text('No comments yet').className('text-dim text-[0.75rem] py-1')];

  const commentTa = new window.View('textarea')
    .id('tweet-comment-input-' + idx)
    .className('flex-1 text-[0.75rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent')
    .attr('rows', '1').attr('placeholder', 'Add a comment...')
    .onTap(function(e) { e.stopPropagation(); });

  const postBtn = new window.View('button')
    .className('px-3 py-1 text-[0.72rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none shrink-0')
    .onTap(function(e) { e.stopPropagation(); _postTweetComment(link, idx); });
  postBtn.add(window.Text('Post'));

  const inputRow = window.HStack(commentTa, postBtn).spacing(2).className('mt-2');
  const wrap = window.VStack(threadViews.concat(inputRow)).className('mt-2 pt-2 border-t border-border-card');

  AetherUI.mount(wrap, container);
}

export async function _postTweetComment(link, idx) {
  const ta = document.getElementById('tweet-comment-input-' + idx);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  const author = (typeof window._authUserInfo !== 'undefined' && window._authUserInfo && window._authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || 'Anonymous';
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

export async function _postTweetReply(parentId, link, idx) {
  const ta = document.getElementById('tweet-reply-ta-' + parentId);
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  const author = (typeof window._authUserInfo !== 'undefined' && window._authUserInfo && window._authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || 'Anonymous';
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

export async function _deleteTweetComment(commentId, link, idx) {
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

export function _showTweetReply(id) {
  const el = document.getElementById('tweet-reply-' + id);
  if (el) { el.classList.remove('hidden'); el.querySelector('textarea')?.focus(); }
}

export function _hideTweetReply(id) {
  const el = document.getElementById('tweet-reply-' + id);
  if (el) el.classList.add('hidden');
}

export function _getRepostedLinks() {
  return getLS('repostedLinks', []);
}
export function _isReposted(link) { return _getRepostedLinks().includes(link); }
export function _markReposted(link) {
  const links = _getRepostedLinks();
  if (!links.includes(link)) { links.push(link); setLS('repostedLinks', links); }
}
export function _unmarkReposted(link) {
  const links = _getRepostedLinks().filter(l => l !== link);
  setLS('repostedLinks', links);
}

export function _tweetRepost(idx, btn) {
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
      .catch(e => logger.error('Unrepost error:', e));
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
  const username = (typeof window._authUserInfo !== 'undefined' && window._authUserInfo && window._authUserInfo.username) || (typeof _authUser !== 'undefined' && _authUser) || '';
  apiPost('/api/reposts', { paperLink: p.link, paperTitle: p.title, username })
    .catch(e => logger.error('Repost error:', e));
}

// ── Action row & comment container ──

export function _cardActionRow(p, i, ctx) {
  const isSaved = ctx ? !!ctx.savedPosts[p.link] : isPostSaved(p.link);
  const bmFill = isSaved ? 'var(--nr-accent)' : 'none';
  const bmStroke = isSaved ? 'var(--nr-accent)' : 'currentColor';
  const commentCount = _tweetCommentCounts[p.link] || '';
  const reposted = ctx ? ctx.repostedSet.has(p.link) : _isReposted(p.link);
  const btnBase = 'bg-transparent border-none cursor-pointer p-0 transition-colors';

  const commentBtn = window.HStack(
    window.RawHTML(icon('chatBubble', {size: 14, class: 'w-3.5 h-3.5'})),
    window.Text(String(commentCount)).className('text-[0.68rem]').attr('data-tweet-comment-count', p.link)
  ).spacing(1).className(btnBase + ' text-dimmer hover:text-blue-400').attr('title', 'Comments').attr('role', 'button')
    .onTap(function(e) { e.stopPropagation(); _toggleTweetComments(p.link, i); });

  const repostBtn = new window.View('button')
    .className(btnBase + ' flex items-center gap-1 ' + (reposted ? '' : 'text-dimmer hover:text-green-400'))
    .attr('title', 'Repost');
  repostBtn.add(window.RawHTML(icon('repost', {size: 14, class: 'w-3.5 h-3.5'})));
  if (reposted) repostBtn.styles({color: 'rgb(74,222,128)'});
  repostBtn.onTap(function(e) { e.stopPropagation(); _tweetRepost(i, repostBtn.el); });

  const bookmarkBtn = new window.View('button')
    .className(btnBase)
    .styles({color: bmFill === 'none' ? 'var(--nr-text-quaternary)' : 'var(--nr-accent)'})
    .attr('title', isSaved ? 'Remove from Reading List' : 'Save to Reading List');
  bookmarkBtn.add(window.RawHTML(icon('bookmark', {size: 14, class: 'w-3.5 h-3.5', fill: bmFill, stroke: bmStroke})));
  bookmarkBtn.onTap(function(e) { e.stopPropagation(); toggleSavePost(lastFilteredPapers[i], e); });

  const menuBtn = new window.View('button')
    .className(btnBase + ' text-dimmer hover:text-primary');
  menuBtn.add(window.RawHTML(icon('moreVertical', {size: 14, class: 'w-3.5 h-3.5'})));
  menuBtn.onTap(function(e) { openCardMenu(menuBtn.el, e, i); });

  return window.HStack(commentBtn, repostBtn, bookmarkBtn, menuBtn)
    .spacing(3).className('flex items-center shrink-0 ml-auto');
}

export function _cardCommentContainer(p, i) {
  const v = new window.View('div').id('tweet-comments-' + i);
  v.styles({ display: _tweetCommentsOpen.has(p.link) ? 'block' : 'none' });
  return v;
}

// ── Infinite scroll ──

export let scrollTicking = false;
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
      setVisibleCount(visibleCount + PAGE_SIZE);
      renderPapers();
    }
  });
});

// ── Drag & drop files onto home feed to open in browse viewer ──

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
