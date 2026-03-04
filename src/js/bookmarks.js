// bookmarks.js — Library / Bookmarks view (netrun://bookmarks)

import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse } from '/js/browse/browse-windows.js';
import { _browseWindows, getBrowseActiveWindow } from '/js/browse/browse-state.js';
import { getSavedPosts, savePosts, toggleSavePostByLink, openSavedPaper } from '/js/feed.js';
import { getLS, setLS } from '/js/core/core-auth.js';
import { _relativeTime } from '/js/search.js';

// ─── Content type detection ──────────────────────────────────

export function _detectContentType(url) {
  if (!url) return 'link';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('twitter.com') || host.includes('x.com') || host.includes('nitter')) return 'twitter';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (/\.pdf($|\?)/i.test(url) || host.includes('arxiv.org')) return 'pdf';
  } catch {}
  return 'link';
}

// ─── Data defaults ───────────────────────────────────────────

const _DEFAULT_GROUPS = [
  { id: 'all', name: 'All', color: '#9ca3af', builtin: true },
  { id: 'uncategorized', name: 'Uncategorized', color: '#9ca3af', builtin: true },
];

// ─── State signals ───────────────────────────────────────────

const _searchQuery = State('');
const _activeGroup = State('all');
const _activeFilter = State('all');
const _bookmarkItems = State([]);
const _groups = State([..._DEFAULT_GROUPS]);

// ─── Data layer ──────────────────────────────────────────────

function _loadBookmarkData() {
  _migrateBookmarks();
  const saved = getSavedPosts();
  const entries = Object.entries(saved).map(([link, entry]) => ({ link, ...entry }));
  entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  _bookmarkItems.value = entries;

  const storedGroups = getLS('bookmarkGroups', null);
  if (storedGroups && storedGroups.length > 0) {
    _groups.value = storedGroups;
  } else {
    _groups.value = [..._DEFAULT_GROUPS];
    setLS('bookmarkGroups', _DEFAULT_GROUPS);
  }
}

function _migrateBookmarks() {
  const saved = getSavedPosts();
  let changed = false;
  const needsThumbnail = [];
  for (const [link, entry] of Object.entries(saved)) {
    if (!entry.groupId) { entry.groupId = 'uncategorized'; changed = true; }
    if (!entry.contentType) { entry.contentType = _detectContentType(link); changed = true; }
    if (entry.thumbnail === undefined) { entry.thumbnail = entry.paper?.image || null; changed = true; }
    if (!entry.tags) { entry.tags = []; changed = true; }
    if (!entry.thumbnail && link.startsWith('http')) needsThumbnail.push(link);
  }
  if (changed) savePosts(saved);
  // Backfill thumbnails for bookmarks that have none (async, non-blocking)
  if (needsThumbnail.length > 0) _backfillThumbnails(needsThumbnail);
}

async function _backfillThumbnails(urls) {
  // Process a few at a time to avoid hammering the network
  const batch = urls.slice(0, 10);
  for (const url of batch) {
    try {
      const result = await window.electronAPI.dbQuery('link-preview', url);
      if (result && (result.title || result.image)) {
        const saved = getSavedPosts();
        if (!saved[url]) continue;
        const paper = saved[url].paper || {};
        if (result.title && (!paper.title || paper.title === paper.hostname)) paper.title = result.title;
        if (result.description && !paper.description) paper.description = result.description;
        if (result.hostname) paper.hostname = result.hostname;
        if (result.image) { paper.image = result.image; saved[url].thumbnail = result.image; }
        saved[url].paper = paper;
        savePosts(saved);
      }
    } catch {}
  }
  // Refresh the view if any thumbnails were fetched
  _loadBookmarkData();
}

function _saveGroups(groups) {
  setLS('bookmarkGroups', groups);
  _groups.value = groups;
}

function _updateBookmarkEntry(link, updates) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  Object.assign(saved[link], updates);
  savePosts(saved);
  _loadBookmarkData();
}

function _deleteBookmark(link) {
  toggleSavePostByLink(link);
  _loadBookmarkData();
}

// ─── Computed filtered items ─────────────────────────────────

const _filteredItems = Computed(() => {
  const items = _bookmarkItems.value;
  const group = _activeGroup.value;
  const filter = _activeFilter.value;
  const query = _searchQuery.value.toLowerCase().trim();

  let result = items;

  // Group filter
  if (group !== 'all') {
    result = result.filter(e => (e.groupId || 'uncategorized') === group);
  }

  // Content type filter
  if (filter !== 'all') {
    result = result.filter(e => (e.contentType || 'link') === filter);
  }

  // Search
  if (query) {
    result = result.filter(e => {
      const title = (e.paper?.title || '').toLowerCase();
      const desc = (e.paper?.description || '').toLowerCase();
      const link = (e.link || '').toLowerCase();
      const host = (e.paper?.hostname || '').toLowerCase();
      return title.includes(query) || desc.includes(query) || link.includes(query) || host.includes(query);
    });
  }

  return result;
});

// ─── Group counts ────────────────────────────────────────────

function _groupCount(groupId) {
  return Computed(() => {
    const items = _bookmarkItems.value;
    if (groupId === 'all') return items.length;
    return items.filter(e => (e.groupId || 'uncategorized') === groupId).length;
  });
}

// ─── Open bookmarks view ─────────────────────────────────────

export function openBookmarks() {
  openBrowse();

  // Reuse existing bookmarks tab
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._bookmarksPage);
    if (existing) {
      if (w.id !== getBrowseActiveWindow()) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      return;
    }
  }

  const win = _browseWindows.find(w => w.id === getBrowseActiveWindow());
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab) return;

  tab.blank = false;
  tab.url = 'netrun://bookmarks';
  tab.title = 'Library';
  tab.favicon = '';
  tab._bookmarksPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const elView = new View('div').id('browse-bookmarks-' + tab.id).className('nr-bm-layout')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;');
  AetherUI.append(elView, container);
  tab.el = elView.el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://bookmarks');

  _renderBookmarksView(tab.el);
}

// ─── Render full view ────────────────────────────────────────

function _renderBookmarksView(container) {
  _loadBookmarkData();

  const sidebar = _buildBookmarksSidebar();
  const content = _buildBookmarksContent();

  // Mount a wrapping HStack into the container, replacing any previous view
  AetherUI.mount(
    HStack(sidebar, content).styles({ width: '100%', height: '100%', overflow: 'hidden' }),
    container
  );
}

// ─── Sidebar ─────────────────────────────────────────────────

function _buildBookmarksSidebar() {
  const groupList = VStack(
    ForEach(_groups, (group) => {
      const count = _groupCount(group.id);
      const row = HStack(
        Text('').className('nr-bm-group-dot').style('background', group.color || '#9ca3af'),
        Text(group.name).className('nr-bm-group-name'),
        Text(Computed(() => String(count.value))).className('nr-bm-group-count'),
      ).className('nr-bm-group-row');

      // Reactive active state
      Effect(() => {
        const active = _activeGroup.value;
        row.el.classList.toggle('nr-bm-group-active', active === group.id);
      });

      row.onTap(() => { _activeGroup.value = group.id; });

      // Context menu for custom groups
      if (!group.builtin) {
        row.on('contextmenu', (e) => {
          e.preventDefault();
          _showGroupContextMenu(group, e.clientX, e.clientY);
        });
      }

      return row;
    })
  );

  const newGroupBtn = HStack(
    RawHTML(icon('plus', { size: 14 })),
    Text('New Group'),
  ).className('nr-bm-new-group').onTap(() => _createNewGroup());

  return VStack(
    Text('Groups').className('nr-bm-sidebar-title'),
    groupList,
    newGroupBtn,
  ).className('nr-bm-sidebar');
}

// ─── Content area ────────────────────────────────────────────

function _buildBookmarksContent() {
  const searchField = SearchField(_searchQuery, 'Search bookmarks or paste a URL...')
    .className('nr-bm-search');

  // Paste handler for quick-add — attach to the inner input element
  const searchInput = searchField.el.querySelector('input');
  if (searchInput) {
    searchInput.addEventListener('paste', (e) => {
      setTimeout(() => {
        const val = (e.target.value || '').trim();
        if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
          _quickAddBookmark(val);
          e.target.value = '';
          _searchQuery.value = '';
        }
      }, 0);
    });
  }

  const filters = ['all', 'link', 'twitter', 'youtube', 'pdf'];
  const filterLabels = { all: 'All', link: 'Links', twitter: 'Twitter', youtube: 'YouTube', pdf: 'PDFs' };

  const filterTabs = HStack(
    ...filters.map(f => {
      const tab = Text(filterLabels[f]).className('nr-bm-filter-tab');
      Effect(() => {
        tab.el.classList.toggle('nr-bm-filter-active', _activeFilter.value === f);
      });
      tab.onTap(() => { _activeFilter.value = f; });
      return tab;
    })
  ).className('nr-bm-filters');

  const header = VStack(
    HStack(searchField).className('nr-bm-content-header'),
    filterTabs,
  ).styles({ display: 'flex', flexDirection: 'column', gap: '12px' });

  // Masonry grid of cards — reactive via AetherUI.mount
  const grid = new View('div').className('nr-bm-grid');

  Effect(() => {
    const items = _filteredItems.value;
    grid.el.innerHTML = '';

    if (items.length === 0) {
      // Mount empty state as sole child
      const empty = _buildEmptyState();
      grid.el.appendChild(empty.el);
      return;
    }

    // Append each card directly so masonry CSS (columns) sees them as siblings
    for (const entry of items) {
      const card = _renderBookmarkCard(entry);
      grid.el.appendChild(card.el);
    }
  });

  return VStack(header, grid).className('nr-bm-content');
}

// ─── Card renderers ──────────────────────────────────────────

function _renderBookmarkCard(entry) {
  const type = entry.contentType || _detectContentType(entry.link);
  switch (type) {
    case 'twitter': return _renderTwitterBookmark(entry);
    case 'youtube': return _renderYoutubeBookmark(entry);
    default: return _renderLinkBookmark(entry);
  }
}

function _renderLinkBookmark(entry) {
  const paper = entry.paper || {};
  const thumb = entry.thumbnail || paper.image;
  let hostname = '';
  try { hostname = new URL(entry.link || paper.link).hostname.replace(/^www\./, ''); } catch {}

  const children = [];

  if (thumb) {
    const img = new View('img').className('nr-bm-card-thumb')
      .attr('src', thumb).attr('alt', '').attr('loading', 'lazy');
    img.on('error', function() { img.el.style.display = 'none'; });
    children.push(img);
  }

  const bodyChildren = [
    Text(paper.title || hostname || 'Untitled').className('nr-bm-card-title'),
  ];
  if (paper.description) {
    bodyChildren.push(Text(paper.description).className('nr-bm-card-desc'));
  }

  const meta = HStack(
    new View('img').className('nr-bm-card-favicon')
      .attr('src', '/api/favicon?domain=' + encodeURIComponent(hostname))
      .attr('alt', '').attr('loading', 'lazy'),
    Text(hostname).className('nr-bm-card-domain'),
    Text(_relativeTime(entry.savedAt)).className('nr-bm-card-date'),
  ).className('nr-bm-card-meta');
  bodyChildren.push(meta);

  children.push(VStack(...bodyChildren).className('nr-bm-card-body'));

  const card = VStack(...children).className('nr-bm-card nr-bm-card-link');
  card.onTap(() => openSavedPaper(entry.link || paper.link));
  card.on('contextmenu', (e) => {
    e.preventDefault();
    _showCardContextMenu(entry, e.clientX, e.clientY);
  });

  return card;
}

function _renderTwitterBookmark(entry) {
  const paper = entry.paper || {};
  let handle = '';
  try {
    const urlObj = new URL(entry.link || paper.link);
    const parts = urlObj.pathname.split('/');
    if (parts[1]) handle = '@' + parts[1];
  } catch {}

  const bodyChildren = [
    HStack(
      Text(handle || paper.source || 'Twitter').className('nr-bm-tweet-handle'),
      Spacer(),
      Text(_relativeTime(entry.savedAt)).className('nr-bm-card-date'),
    ).className('nr-bm-tweet-header'),
    Text(paper.title || paper.description || '').className('nr-bm-tweet-text'),
  ];

  const thumb = entry.thumbnail || paper.image;
  if (thumb) {
    const img = new View('img').className('nr-bm-card-thumb')
      .attr('src', thumb).attr('alt', '').attr('loading', 'lazy');
    img.on('error', function() { img.el.style.display = 'none'; });
    bodyChildren.push(img);
  }

  const card = VStack(
    VStack(...bodyChildren).className('nr-bm-card-body'),
  ).className('nr-bm-card nr-bm-card-twitter');

  card.onTap(() => openSavedPaper(entry.link || paper.link));
  card.on('contextmenu', (e) => {
    e.preventDefault();
    _showCardContextMenu(entry, e.clientX, e.clientY);
  });
  return card;
}

function _renderYoutubeBookmark(entry) {
  const paper = entry.paper || {};
  const thumb = entry.thumbnail || paper.image;
  let hostname = '';
  try { hostname = new URL(entry.link || paper.link).hostname.replace(/^www\./, ''); } catch {}

  const children = [];
  if (thumb) {
    const img = new View('img').className('nr-bm-card-thumb')
      .attr('src', thumb).attr('alt', '').attr('loading', 'lazy');
    img.on('error', function() { img.el.style.display = 'none'; });
    children.push(img);
  }

  children.push(VStack(
    Text(paper.title || 'Untitled Video').className('nr-bm-card-title'),
    Text(paper.source || hostname).className('nr-bm-yt-channel'),
    Text(_relativeTime(entry.savedAt)).className('nr-bm-card-date'),
  ).className('nr-bm-card-body'));

  const card = VStack(...children).className('nr-bm-card nr-bm-card-youtube');
  card.onTap(() => openSavedPaper(entry.link || paper.link));
  card.on('contextmenu', (e) => {
    e.preventDefault();
    _showCardContextMenu(entry, e.clientX, e.clientY);
  });
  return card;
}

// ─── Empty state ─────────────────────────────────────────────

function _buildEmptyState() {
  return VStack(
    RawHTML(icon('bookmark', { size: 48 })).className('nr-bm-empty-icon'),
    Text('No bookmarks yet').className('nr-bm-empty-title'),
    Text('Save posts from the feed, or paste a URL above to add one.').className('nr-bm-empty-desc'),
  ).className('nr-bm-empty');
}

// ─── Quick add ───────────────────────────────────────────────

function _quickAddBookmark(url) {
  const saved = getSavedPosts();
  if (saved[url]) return; // already saved

  const contentType = _detectContentType(url);
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  saved[url] = {
    paper: { title: hostname || url, link: url, source: '', hostname, description: '', image: null },
    savedAt: Date.now(),
    read: false,
    groupId: 'uncategorized',
    contentType,
    thumbnail: null,
    tags: [],
  };
  savePosts(saved);
  _loadBookmarkData();

  // Fetch metadata in background
  _fetchUrlMetadata(url);
}

async function _fetchUrlMetadata(url) {
  try {
    const result = await window.electronAPI.dbQuery('link-preview', url);
    if (result && (result.title || result.image)) {
      const saved = getSavedPosts();
      if (!saved[url]) return;
      const paper = saved[url].paper || {};
      if (result.title) paper.title = result.title;
      if (result.description) paper.description = result.description;
      if (result.image) { paper.image = result.image; saved[url].thumbnail = result.image; }
      if (result.hostname) paper.hostname = result.hostname;
      saved[url].paper = paper;
      savePosts(saved);
      _loadBookmarkData();
    }
  } catch {}
}

// ─── Group CRUD ──────────────────────────────────────────────

function _createNewGroup() {
  const colors = ['#a78bfa', '#60a5fa', '#34d399', '#f97316', '#fb923c', '#f43f5e', '#ec4899', '#14b8a6'];
  const selectedColor = State(colors[0]);

  const nameInput = TextField('Group name');

  const swatchViews = colors.map(c => {
    const sw = new View('div').styles({ background: c }).className('nr-bm-color-swatch');
    Effect(() => {
      sw.el.classList.toggle('active', selectedColor.value === c);
    });
    sw.onTap(() => { selectedColor.value = c; });
    return sw;
  });

  const swatches = HStack(...swatchViews).className('nr-bm-color-swatches');

  Alert({
    title: 'New Group',
    content: VStack(nameInput, swatches).styles({ display: 'flex', flexDirection: 'column', gap: '12px' }),
    actions: [
      { label: 'Cancel', style: 'cancel' },
      {
        label: 'Create', style: 'default', handler: () => {
          const name = (nameInput.el.value || '').trim();
          if (!name) return;
          const groups = _groups.value.slice();
          groups.push({ id: 'grp_' + Date.now(), name, color: selectedColor.value });
          _saveGroups(groups);
        }
      },
    ],
  });
}

function _deleteGroup(id) {
  // Move entries to uncategorized
  const saved = getSavedPosts();
  for (const entry of Object.values(saved)) {
    if (entry.groupId === id) entry.groupId = 'uncategorized';
  }
  savePosts(saved);

  const groups = _groups.value.filter(g => g.id !== id);
  _saveGroups(groups);

  if (_activeGroup.value === id) _activeGroup.value = 'all';
  _loadBookmarkData();
}

function _showGroupContextMenu(group, x, y) {
  const menu = Menu(null, [
    { label: 'Delete Group', handler: () => _deleteGroup(group.id) },
  ]);
  menu.showAt(x, y);
}

// ─── Card context menu ───────────────────────────────────────

function _showCardContextMenu(entry, x, y) {
  const groups = _groups.value.filter(g => g.id !== 'all');
  const moveItems = groups.map(g => ({
    label: g.name,
    handler: () => _updateBookmarkEntry(entry.link, { groupId: g.id }),
  }));

  const items = [
    { label: 'Open', handler: () => openSavedPaper(entry.link || entry.paper?.link) },
    { divider: true },
    { label: 'Move to...', handler: () => {
      const submenu = Menu(null, moveItems);
      submenu.showAt(x + 10, y);
    }},
    { divider: true },
    { label: 'Delete', handler: () => _deleteBookmark(entry.link) },
  ];

  const menu = Menu(null, items);
  menu.showAt(x, y);
}

// ─── Expose to window ────────────────────────────────────────

window.openBookmarks = openBookmarks;
