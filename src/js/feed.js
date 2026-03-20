// feed.js — Orchestrator: imports sub-modules, re-exports for external consumers, window bindings

// ── Re-exports from feed-data.js ──
export {
  _refreshTimer, _refreshSecondsLeft, clearRefreshTimer, _previousPostLinks, _renderedLinks,
  startRefreshTimer, renderRefreshCountdown,
  updateSavedBadge,
  _getSeenPostLinks, _setSeenPostLinks,
  _getFeedNotifications, _setFeedNotifications, _getFeedNotifSources,
  _detectNewPosts, clearFeedNotification,
  getHiddenPosts, getReadPosts,
  getSourceAffinity, getInterestProfile, _computeContentScore,
  resetPersonalization, markPostAsRead,
  openCardMenu, closeCardMenu, hidePost,
  getBlockedWords, setBlockedWords, addBlockedWord, removeBlockedWord, renderBlockedWordsList,
  getOfflineCachedSet, isPostCached, cachePostOffline,
  _offlineDownloadIcon, _offlineCachedIcon,
  getSavedPosts, savePosts, isPostSaved, toggleSavePost,
  _showBookmarkFly, markPostRead, renderSavedPosts,
  toggleSavePostByLink, openSavedPaper,
  allPapers, allCategories, citationMap, PAGE_SIZE, hiddenSourceFilters,
  unsubscribeSource,
  fetchHNFeed, fetchPolymarketFeed,
  FEED_SOURCE_DEFAULTS, hasOnboarded,
  onboardSelected, onboardNotifSelected,
  _hcActiveCategory, _hcCircleEls, _hcPositions,
  _renderHcCategoryTabs, _hcSelectCategory,
  renderOnboardGrid, toggleOnboardSource, _toggleOnboardCategory, _updateOnboardCardStates,
  showOnboarding, completeOnboarding,
  getFeedSources, getCustomFeeds,
  renderCustomFeedsList, addCustomFeed, removeCustomFeed, toggleCustomFeed,
  fetchGenericRSS, allSourcesOff,
  loadAllFeeds,
  extractArxivId, parseFeed, fetchCitationsFor,
  extractAuthors,
  lastFilteredPapers, setLastFilteredPapers,
} from '/js/feed/feed-data.js';

// ── Re-exports from feed-filter.js ──
export {
  currentSort, visibleCount, setVisibleCount, feedViewMode,
  _viewModes, _viewModeIcons,
  toggleViewMode, toggleSourceBubble, renderSourceBubbles, _fitArxivSelect,
  setSortMode, renderAlgorithmView, renderTrends,
  populateCategories,
  parseSearchQuery, getFilteredPapers,
} from '/js/feed/feed-filter.js';

// ── Re-exports from feed-render.js ──
export {
  _renderPaperCompactRow, _renderPaperCard, _renderPaperVerboseCard, _renderPaperTwitterCard,
  _renderPapersRafId, renderPapers, _buildRenderCtx,
  _renderFeedEmptyState, _renderFilteredPapers, _renderPapersNow,
  _tweetCommentCounts, _tweetCommentsOpen,
  _fetchTweetCommentCounts, _toggleTweetComments, _renderTweetComments,
  _postTweetComment, _postTweetReply, _deleteTweetComment,
  _showTweetReply, _hideTweetReply,
  _getRepostedLinks, _isReposted, _markReposted, _unmarkReposted, _tweetRepost,
  _cardActionRow, _cardCommentContainer,
  scrollTicking,
} from '/js/feed/feed-render.js';

// ── Imports for window bindings + registerActions ──
import { getSavedPosts, resetPersonalization, showOnboarding, completeOnboarding, addCustomFeed, loadAllFeeds, getCustomFeeds } from '/js/feed/feed-data.js';
import { renderPapers, _buildRenderCtx } from '/js/feed/feed-render.js';
import { renderSourceBubbles, renderTrends, currentSort, setSortMode, toggleViewMode } from '/js/feed/feed-filter.js';

// ── Window bindings (for cross-module + onclick calls) ──
window.renderPapers = renderPapers;
window.renderTrends = renderTrends;
window.renderSourceBubbles = renderSourceBubbles;
window._buildRenderCtx = _buildRenderCtx;
window._feedPost = function() {}; // no-op, feedserver removed
window.getCustomFeeds = getCustomFeeds;
window.getSavedPosts = getSavedPosts;
window.resetPersonalization = resetPersonalization;

// ── Action registry ──
registerActions({
  completeOnboarding: () => completeOnboarding(),
  addCustomFeed: () => addCustomFeed(),
  addCustomFeedOnEnter: (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomFeed(); } },
  toggleSortForyou: () => setSortMode(currentSort === 'foryou' ? 'latest' : 'foryou'),
  toggleSortCitations: () => setSortMode(currentSort === 'citations' ? 'latest' : 'citations'),
  toggleViewMode: () => toggleViewMode(),
  showOnboarding: () => showOnboarding(),
});
