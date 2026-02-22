// netrun-page.js — netrun:// hub page (home + full dashboard)

import { _HELP_DATA } from '/js/settings/settings-helpers.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseRenderTabs, browseNavigate } from '/js/browse/browse-island.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse } from '/js/browse/browse-windows.js';
import { _browseWindows, getBrowseActiveWindow } from '/js/browse/browse-state.js';
import { wmOpen, getSourceChip } from '/js/core/core-views.js';
import { getSavedPosts, allPapers, openSavedPaper, toggleSavePostByLink } from '/js/feed.js';
import { apiGet, apiPut } from '/js/api.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
import { _relativeTime } from '/js/search.js';
import { calendarEvents, addCalendarEvent, deleteCalendarEvent } from '/js/calendar.js';
import { getGreeting } from '/js/core/core-profile.js';
import Settings from '/js/core/core-settings.js';
import { initNetrunner } from '/js/netrunner-game.js';
import { openTerminalPage } from '/js/terminal.js';

// ─── Open / reuse the netrun:// tab ─────────────────────────

export function openNetrunPage() {
  openBrowse();

  // Reuse existing netrun tab
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._netrunPage);
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
  tab.url = 'netrun://';
  tab.title = 'Netrun';
  tab.favicon = '';
  tab._netrunPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-netrun-' + tab.id;
  el.className = 'nr-hub-scroll';
  el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;';
  container.appendChild(el);
  tab.el = el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://');

  _renderNetrunPage(tab.el);
}

// ─── Render the hub page into an element ─────────────────────

export function _renderNetrunPage(el) {
  if (!el) return;
  el.innerHTML = '';
  el.className = 'nr-hub-scroll';

  const content = document.createElement('div');
  content.className = 'nr-hub-content';

  // Hero
  content.appendChild(_buildHero());

  // Feature cards
  content.appendChild(_buildFeatureCards());

  // Full dashboard (async — renders in-place when data loads)
  const dashSlot = document.createElement('div');
  content.appendChild(dashSlot);
  _buildDashboard(dashSlot);

  // Special routes
  content.appendChild(_buildRoutes());

  // Help sections
  _buildHelpSections(content);

  el.appendChild(content);

  // Easter egg: Konami code starts the netrunner game
  initNetrunner();
}

// ─── Hero ────────────────────────────────────────────────────

function _buildHero() {
  const hero = document.createElement('div');
  hero.className = 'nr-hub-hero';

  const logo = document.createElement('div');
  logo.className = 'nr-hub-hero-logo';
  logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/></svg>';
  hero.appendChild(logo);

  const title = document.createElement('div');
  title.className = 'nr-hub-hero-title';
  title.textContent = 'netrun';
  hero.appendChild(title);

  const tagline = document.createElement('div');
  tagline.className = 'nr-hub-hero-tagline';
  tagline.textContent = 'Browse, read, chat, draw.';
  hero.appendChild(tagline);

  const version = document.createElement('div');
  version.className = 'nr-hub-hero-version';
  version.textContent = 'v' + (window.electronAPI?.getVersion?.() || '0');
  hero.appendChild(version);

  return hero;
}

// ─── Feature Cards ───────────────────────────────────────────

const _FEATURES = [
  { icon: 'globe',      title: 'Browse',    desc: 'Web browser with ad blocking, split tabs, and bangs.', action: () => browseNavigate('ntp://') },
  { icon: 'chatBubble', title: 'Chat',      desc: 'AI assistant with tools. Search, fetch, navigate.',    action: () => browseNavigate('chat://') },
  { icon: 'edit',       title: 'Draw',      desc: 'Whiteboard with pen, shapes, text.',                   action: () => browseNavigate('draw://') },
  { icon: 'feed',       title: 'Feed',      desc: '125+ sources. arXiv, HN, RSS, and more.',              action: () => wmOpen('feed') },
  { icon: 'clock',      title: 'History',   desc: 'Browse and search history.',                            action: () => browseNavigate('netrun://history') },
  { icon: 'terminal',   title: 'Terminal',   desc: 'Shell with tabs, splits, and themes.',                   action: () => openTerminalPage() },
  { icon: 'research',   title: 'Docs',      desc: 'AetherUI API reference and live previews.',              action: () => browseNavigate('netrun://docs') },
];

function _buildFeatureCards() {
  const grid = document.createElement('div');
  grid.className = 'nr-hub-cards';

  for (const f of _FEATURES) {
    const card = document.createElement('div');
    card.className = 'nr-hub-card';
    card.addEventListener('click', f.action);

    const iconEl = document.createElement('div');
    iconEl.className = 'nr-hub-card-icon';
    iconEl.innerHTML = icon(f.icon, { size: 24 });
    card.appendChild(iconEl);

    const text = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-card-title';
    titleEl.textContent = f.title;
    text.appendChild(titleEl);

    const descEl = document.createElement('div');
    descEl.className = 'nr-hub-card-desc';
    descEl.textContent = f.desc;
    text.appendChild(descEl);

    card.appendChild(text);
    grid.appendChild(card);
  }

  return grid;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── Full Dashboard ──────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _ACTIVITY_COLORS = {
  event:  '#60a5fa', saved:  '#34d399', comment: '#a78bfa',
  repost: '#4ade80', search: '#f97316', web:    '#38bdf8',
  notif:  '#fb923c',
};
const _ACTIVITY_LABELS = {
  event: 'Event', saved: 'Saved', comment: 'Commented', repost: 'Reposted',
  search: 'Search', web: 'Web search', notif: 'New post',
};

async function _buildDashboard(slot) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const isToday = ts => ts && ts >= todayStart;

  // ── Fetch all data in parallel ──
  const _uname = window._authUserInfo?.username;
  const [
    calResp, profileResp, commentsResp, repostsResp,
  ] = await Promise.all([
    apiGet('/api/calendar').catch(() => []),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname)).catch(() => null) : null,
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/comments').catch(() => []) : [],
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/reposts').catch(() => []) : [],
  ]);

  const events = calResp || [];
  const profile = profileResp || {};
  const myComments = commentsResp || [];
  const myReposts = repostsResp || [];
  const saved = getSavedPosts();
  const savedEntries = Object.values(saved);
  const savedCount = savedEntries.length;
  const searchHist = Settings.getJSON('searchHistory', []);
  const webHist = Settings.getJSON('webSearchHistory', []);
  const readSet = new Set(Settings.getJSON('readPosts', []));
  const papersRead = allPapers.filter(p => readSet.has(p.link)).length;

  // ── Build today's timeline ──
  const timeline = [];
  events.filter(ev => ev.date === todayStr).forEach(ev => {
    timeline.push({ type: 'event', title: ev.title || 'Event', ts: todayStart, color: ev.color });
  });
  savedEntries.forEach(e => {
    if (isToday(e.savedAt)) timeline.push({ type: 'saved', title: e.paper?.title || 'Saved', ts: e.savedAt });
  });
  myComments.filter(c => isToday(c.timestamp)).forEach(c => {
    timeline.push({ type: 'comment', title: (c.content || '').slice(0, 80), ts: c.timestamp });
  });
  myReposts.filter(r => isToday(r.timestamp)).forEach(r => {
    timeline.push({ type: 'repost', title: r.paperTitle || 'Repost', ts: r.timestamp });
  });
  searchHist.filter(s => isToday(s.ts)).forEach(s => {
    timeline.push({ type: 'search', title: s.q || s.query || 'Search', ts: s.ts });
  });
  webHist.filter(s => isToday(s.ts)).forEach(s => {
    timeline.push({ type: 'web', title: s.q || s.query || 'Web search', ts: s.ts });
  });
  timeline.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // ── Build heatmap activity data ──
  const activityItems = {};
  const addItem = (key, item) => { (activityItems[key] ||= []).push(item); };
  events.forEach(ev => { if (ev.date) addItem(ev.date, { type: 'event', title: ev.title || 'Event' }); });
  savedEntries.forEach(e => { if (e.savedAt) { const d = new Date(e.savedAt); addItem(_dateKey(d), { type: 'saved', title: e.paper?.title || 'Saved' }); } });
  myComments.forEach(c => { if (c.timestamp) addItem(_dateKey(new Date(c.timestamp)), { type: 'comment', title: (c.content || '').slice(0, 60) }); });
  myReposts.forEach(r => { if (r.timestamp) addItem(_dateKey(new Date(r.timestamp)), { type: 'repost', title: r.paperTitle || 'Repost' }); });
  searchHist.forEach(s => { if (s.ts) addItem(_dateKey(new Date(s.ts)), { type: 'search', title: s.q || 'Search' }); });
  webHist.forEach(s => { if (s.ts) addItem(_dateKey(new Date(s.ts)), { type: 'web', title: s.q || 'Web search' }); });

  // Upcoming events
  const upcomingEvents = events.filter(e => e.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const todayEvents = events.filter(e => e.date === todayStr);

  // Trending
  const trending = _getTrending(5);

  // ── Render ──
  const wrap = document.createElement('div');
  wrap.className = 'nr-hub-dash';

  // ── Profile header ──
  wrap.appendChild(_buildProfile(profile));

  // ── Stats row ──
  wrap.appendChild(_buildStats(papersRead, savedCount, 0));

  // ── Greeting + Today header ──
  const greetEl = document.createElement('div');
  greetEl.className = 'nr-hub-greeting';
  greetEl.textContent = getGreeting();
  wrap.appendChild(greetEl);

  const header = document.createElement('div');
  header.className = 'nr-hub-dash-header';
  const dateEl = document.createElement('div');
  dateEl.className = 'nr-hub-dash-date';
  dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  header.appendChild(dateEl);
  const todaySearchCount = searchHist.filter(e => isToday(e.ts)).length + webHist.filter(e => isToday(e.ts)).length;
  if (todaySearchCount > 0) _addChip(header, todaySearchCount + ' search' + (todaySearchCount === 1 ? '' : 'es'));
  if (savedCount > 0) _addChip(header, savedCount + ' saved');
  if (todayEvents.length > 0) _addChip(header, todayEvents.length + ' event' + (todayEvents.length === 1 ? '' : 's'));
  wrap.appendChild(header);

  // ── Activity Heatmap ──
  wrap.appendChild(_buildHeatmap(activityItems, now));

  // ── Today's Activity Timeline ──
  if (timeline.length > 0) {
    wrap.appendChild(_buildTimeline(timeline));
  }

  // ── Calendar Events ──
  wrap.appendChild(_buildCalendarCard(upcomingEvents, todayStr));

  // ── Reading List ──
  wrap.appendChild(_buildReadingList(savedEntries, savedCount));

  // ── Trending ──
  if (trending.length > 0) {
    wrap.appendChild(_buildTrending(trending));
  }

  // ── Comments & Reposts ──
  if (myComments.length > 0) {
    wrap.appendChild(_buildComments(myComments));
  }
  if (myReposts.length > 0) {
    wrap.appendChild(_buildReposts(myReposts));
  }

  slot.appendChild(wrap);
}

// ── Profile ──

function _buildProfile(profile) {
  const section = document.createElement('div');
  section.className = 'nr-hub-profile';

  // Banner
  const banner = document.createElement('div');
  banner.className = 'nr-hub-profile-banner';
  if (profile.profile_bg) {
    banner.style.backgroundImage = "url('" + escapeAttr(profile.profile_bg) + "')";
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';
  } else {
    banner.classList.add('nr-living-gradient');
  }
  const bannerGrad = document.createElement('div');
  bannerGrad.className = 'nr-hub-profile-banner-grad';
  banner.appendChild(bannerGrad);
  section.appendChild(banner);

  // Avatar row
  const row = document.createElement('div');
  row.className = 'nr-hub-profile-row';

  const avatar = document.createElement('div');
  avatar.className = 'nr-hub-profile-avatar';
  const username = profile.username || window._authUserInfo?.username || '';
  if (profile.picture) {
    avatar.innerHTML = '<img src="' + escapeAttr(profile.picture) + '" referrerpolicy="no-referrer" />';
  } else {
    avatar.innerHTML = '<div class="nr-hub-profile-avatar-fallback">' + escapeHtml((username || '?')[0].toUpperCase()) + '</div>';
  }
  row.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'nr-hub-profile-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'nr-hub-profile-name';
  nameEl.innerHTML = escapeHtml(username);
  const onlineDot = document.createElement('span');
  onlineDot.className = 'nr-hub-online-dot';
  nameEl.appendChild(onlineDot);
  info.appendChild(nameEl);

  // Status
  const statusEl = document.createElement('div');
  statusEl.className = 'nr-hub-profile-status';
  statusEl.textContent = profile.status_text || '';
  info.appendChild(statusEl);

  // Join date
  if (profile.created) {
    const joinEl = document.createElement('div');
    joinEl.className = 'nr-hub-profile-join';
    joinEl.textContent = 'Joined ' + new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    info.appendChild(joinEl);
  }

  row.appendChild(info);

  // Counters
  const counters = document.createElement('div');
  counters.className = 'nr-hub-profile-counters';
  counters.innerHTML =
    '<span><strong>' + (profile.comment_count || 0) + '</strong> comments</span>' +
    '<span><strong>' + (profile.repost_count || 0) + '</strong> reposts</span>';
  info.appendChild(counters);

  section.appendChild(row);
  return section;
}

// ── Stats Row ──

function _buildStats(papersRead, savedCount, projectCount) {
  const row = document.createElement('div');
  row.className = 'nr-hub-stats';
  const stats = [
    { value: papersRead, label: 'Papers Read', sub: 'in feed', color: '#60a5fa' },
    { value: savedCount, label: 'Saved', sub: 'reading list', color: '#34d399' },
    { value: projectCount, label: 'Projects', sub: 'active', color: '#a78bfa' },
  ];
  for (const s of stats) {
    const stat = document.createElement('div');
    stat.className = 'nr-hub-stat';
    stat.innerHTML =
      '<div class="nr-hub-stat-value" style="color:' + s.color + '">' + s.value + '</div>' +
      '<div class="nr-hub-stat-label">' + s.label + '</div>' +
      '<div class="nr-hub-stat-sub">' + s.sub + '</div>';
    row.appendChild(stat);
  }
  return row;
}

// ── Activity Heatmap (GitHub-style) ──

function _buildHeatmap(activityItems, now) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';

  const headerRow = document.createElement('div');
  headerRow.className = 'nr-hub-dash-card-header';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Activity';
  headerRow.appendChild(title);
  const yearLabel = document.createElement('div');
  yearLabel.className = 'nr-hub-heatmap-year';
  yearLabel.textContent = String(now.getFullYear());
  headerRow.appendChild(yearLabel);
  card.appendChild(headerRow);

  const year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate());
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const startDow = jan1.getDay();
  const totalDays = Math.ceil((dec31 - jan1) / 86400000) + 1;
  const numWeeks = Math.ceil((startDow + totalDays) / 7);

  const cells = [];
  for (let day = 0; day < totalDays; day++) {
    const d = new Date(year, 0, 1 + day);
    const key = _dateKey(d);
    const count = (activityItems[key] || []).length;
    const isT = d.getTime() === today.getTime();
    const isFuture = d > today;
    cells.push({ key, count, isToday: isT, isFuture, col: Math.floor((startDow + day) / 7), row: d.getDay(), month: d.getMonth(), date: d.getDate() });
  }

  // Month labels
  const monthLabels = [];
  let lastMonth = -1;
  for (const c of cells) {
    if (c.month !== lastMonth && c.row === 0) {
      lastMonth = c.month;
      monthLabels.push({ col: c.col, label: new Date(year, c.month).toLocaleDateString('en-US', { month: 'short' }) });
    }
  }

  // Holiday theme
  const mm = now.getMonth(), dd = now.getDate();
  let heatAccent = null;
  if (mm === 9 && dd >= 25) heatAccent = '#f97316';
  else if (mm === 11 && dd >= 20) heatAccent = '#22c55e';
  else if (mm === 1 && dd === 14) heatAccent = '#ec4899';

  const cellSize = 11, cellGap = 3, labelW = 28, monthLabelH = 16;
  const gridW = labelW + numWeeks * (cellSize + cellGap);
  const gridH = monthLabelH + 7 * (cellSize + cellGap);

  const colorFn = (lvl) => {
    if (lvl === 0) return 'var(--nr-border-default)';
    const accent = heatAccent || 'var(--nr-accent)';
    return 'color-mix(in srgb, ' + accent + ' ' + (lvl * 10) + '%, transparent)';
  };

  let svg = '<svg width="' + gridW + '" height="' + gridH + '" class="nr-hub-heatmap-svg" style="min-width:' + gridW + 'px">';
  for (const m of monthLabels) {
    svg += '<text x="' + (labelW + m.col * (cellSize + cellGap)) + '" y="11" fill="var(--nr-text-quaternary)" font-size="10" font-family="sans-serif">' + m.label + '</text>';
  }
  const dayLabels = { 1: 'M', 3: 'W', 5: 'F' };
  for (const [r, label] of Object.entries(dayLabels)) {
    svg += '<text x="0" y="' + (monthLabelH + r * (cellSize + cellGap) + 9) + '" fill="var(--nr-text-quaternary)" font-size="9" font-family="sans-serif">' + label + '</text>';
  }
  for (const c of cells) {
    const x = labelW + c.col * (cellSize + cellGap);
    const y = monthLabelH + c.row * (cellSize + cellGap);
    const lvl = c.isFuture ? 0 : Math.min(c.count, 10);
    const stroke = c.isToday ? 'var(--nr-accent)' : 'none';
    const sw = c.isToday ? '1.5' : '0';
    const prettyDate = new Date(year, c.month, c.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const tip = c.isFuture ? prettyDate : (c.count === 0 ? 'No activity on ' + prettyDate : c.count + ' activit' + (c.count === 1 ? 'y' : 'ies') + ' on ' + prettyDate);
    svg += '<rect x="' + x + '" y="' + y + '" width="' + cellSize + '" height="' + cellSize + '" rx="2" fill="' + colorFn(lvl) + '" stroke="' + stroke + '" stroke-width="' + sw + '" data-tip="' + escapeAttr(tip) + '" data-key="' + c.key + '" class="nr-hub-heatmap-cell"/>';
  }
  svg += '</svg>';

  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'nr-hub-heatmap-scroll';
  scrollWrap.innerHTML = svg;
  card.appendChild(scrollWrap);

  // Tooltip
  const tipEl = document.createElement('div');
  tipEl.className = 'nr-hub-heatmap-tip';
  card.appendChild(tipEl);

  // Attach tooltip handlers after render
  requestAnimationFrame(() => {
    const svgEl = card.querySelector('.nr-hub-heatmap-svg');
    if (!svgEl) return;
    svgEl.addEventListener('mouseover', e => {
      const r = e.target.closest('.nr-hub-heatmap-cell');
      if (!r) { tipEl.style.display = 'none'; return; }
      tipEl.textContent = r.dataset.tip;
      tipEl.style.display = 'block';
      const cr = r.getBoundingClientRect();
      let left = cr.left + cr.width / 2 - tipEl.offsetWidth / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - tipEl.offsetWidth - 4));
      tipEl.style.left = left + 'px';
      tipEl.style.top = (cr.top - tipEl.offsetHeight - 6) + 'px';
    });
    svgEl.addEventListener('mouseout', e => {
      if (e.target.closest('.nr-hub-heatmap-cell')) tipEl.style.display = 'none';
    });
  });

  return card;
}

// ── Today's Timeline ──

function _buildTimeline(timeline) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Today';
  card.appendChild(title);

  for (const item of timeline.slice(0, 8)) {
    const color = item.color || _ACTIVITY_COLORS[item.type] || '#999';
    const label = _ACTIVITY_LABELS[item.type] || item.type;
    const row = document.createElement('div');
    row.className = 'nr-hub-timeline-row';

    const dot = document.createElement('div');
    dot.className = 'nr-hub-timeline-dot';
    dot.style.background = color;
    row.appendChild(dot);

    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-timeline-title';
    titleEl.textContent = (item.title || '').slice(0, 80);
    row.appendChild(titleEl);

    const badge = document.createElement('div');
    badge.className = 'nr-hub-timeline-badge';
    badge.textContent = label;
    badge.style.color = color;
    row.appendChild(badge);

    if (item.ts) {
      const time = document.createElement('div');
      time.className = 'nr-hub-timeline-time';
      time.textContent = _relativeTime(item.ts);
      row.appendChild(time);
    }

    card.appendChild(row);
  }

  if (timeline.length > 8) {
    const more = document.createElement('div');
    more.className = 'nr-hub-dash-more';
    more.textContent = (timeline.length - 8) + ' more today';
    card.appendChild(more);
  }

  return card;
}

// ── Calendar Events ──

function _buildCalendarCard(upcomingEvents, todayStr) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'nr-hub-dash-card-header';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Calendar';
  titleRow.appendChild(title);

  const addBtn = document.createElement('div');
  addBtn.className = 'nr-hub-cal-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add event';
  addBtn.addEventListener('click', () => _showAddEventForm(card));
  titleRow.appendChild(addBtn);
  card.appendChild(titleRow);

  if (upcomingEvents.length > 0) {
    for (const ev of upcomingEvents) {
      const row = document.createElement('div');
      row.className = 'nr-hub-event-row';

      const dot = document.createElement('div');
      dot.className = 'nr-hub-event-dot';
      dot.style.background = ev.color || 'var(--nr-accent)';
      row.appendChild(dot);

      const info = document.createElement('div');
      info.className = 'nr-hub-event-info';
      const titleEl = document.createElement('div');
      titleEl.className = 'nr-hub-event-title';
      titleEl.textContent = ev.title || 'Event';
      info.appendChild(titleEl);

      if (ev.date !== todayStr) {
        const dateLabel = document.createElement('div');
        dateLabel.className = 'nr-hub-event-date';
        const d = new Date(ev.date + 'T12:00:00');
        dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        info.appendChild(dateLabel);
      }
      if (ev.description) {
        const descEl = document.createElement('div');
        descEl.className = 'nr-hub-event-desc';
        descEl.textContent = ev.description;
        info.appendChild(descEl);
      }
      row.appendChild(info);

      const del = document.createElement('div');
      del.className = 'nr-hub-event-del';
      del.textContent = '\u00d7';
      del.title = 'Delete event';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteCalendarEvent(ev.id);
        row.remove();
      });
      row.appendChild(del);
      card.appendChild(row);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'nr-hub-dash-empty';
    empty.textContent = 'No upcoming events';
    card.appendChild(empty);
  }

  return card;
}

// ── Reading List ──

function _buildReadingList(savedEntries, savedCount) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'nr-hub-dash-card-header';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Reading List';
  titleRow.appendChild(title);
  if (savedCount > 0) {
    const countEl = document.createElement('div');
    countEl.className = 'nr-hub-heatmap-year';
    countEl.textContent = String(savedCount);
    titleRow.appendChild(countEl);
  }
  card.appendChild(titleRow);

  if (savedCount > 0) {
    const sorted = savedEntries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, 8);
    for (const entry of sorted) {
      const paper = entry.paper || {};
      const row = document.createElement('div');
      row.className = 'nr-hub-saved-row';
      row.addEventListener('click', () => openSavedPaper(paper.link));

      let hostname = '';
      try { hostname = new URL(paper.link).hostname.replace(/^www\./, ''); } catch {}

      const fav = document.createElement('img');
      fav.className = 'nr-hub-saved-favicon';
      fav.src = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
      fav.alt = '';
      fav.loading = 'lazy';
      row.appendChild(fav);

      const titleEl = document.createElement('div');
      titleEl.className = 'nr-hub-saved-title';
      titleEl.textContent = paper.title || paper.link || 'Untitled';
      row.appendChild(titleEl);

      if (hostname) {
        const hostEl = document.createElement('div');
        hostEl.className = 'nr-hub-saved-host';
        hostEl.textContent = hostname;
        row.appendChild(hostEl);
      }

      // Delete button
      const del = document.createElement('div');
      del.className = 'nr-hub-event-del';
      del.textContent = '\u00d7';
      del.title = 'Remove';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSavePostByLink(paper.link);
        row.remove();
      });
      row.appendChild(del);

      card.appendChild(row);
    }

    if (savedCount > 8) {
      const more = document.createElement('div');
      more.className = 'nr-hub-dash-more';
      more.textContent = 'View all ' + savedCount + ' saved \u2192';
      more.addEventListener('click', () => browseNavigate('netrun://'));
      card.appendChild(more);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'nr-hub-dash-empty';
    empty.textContent = 'No saved posts yet';
    card.appendChild(empty);
  }

  return card;
}

// ── Trending ──

function _buildTrending(trending) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Trending';
  card.appendChild(title);

  for (let i = 0; i < trending.length; i++) {
    const p = trending[i];
    const row = document.createElement('div');
    row.className = 'nr-hub-trending-row';
    row.addEventListener('click', () => browseNavigate(p.link));

    const rank = document.createElement('div');
    rank.className = 'nr-hub-trending-rank';
    rank.textContent = String(i + 1);
    row.appendChild(rank);

    const info = document.createElement('div');
    info.className = 'nr-hub-trending-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-trending-title';
    titleEl.textContent = p.title;
    info.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = 'nr-hub-trending-meta';
    const chip = getSourceChip(p.source, p.arxivId);
    const engagement = (p.points || 0) + (p.citations || 0);
    meta.innerHTML = (chip || '') + (engagement > 0 ? '<span class="nr-hub-trending-eng">' + engagement + '</span>' : '');
    info.appendChild(meta);

    row.appendChild(info);
    card.appendChild(row);
  }

  return card;
}

// ── Recent Comments ──

function _buildComments(comments) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'nr-hub-dash-card-header';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Recent Comments';
  titleRow.appendChild(title);
  const countEl = document.createElement('div');
  countEl.className = 'nr-hub-heatmap-year';
  countEl.textContent = String(comments.length);
  titleRow.appendChild(countEl);
  card.appendChild(titleRow);

  for (const c of comments.slice(0, 4)) {
    const row = document.createElement('div');
    row.className = 'nr-hub-timeline-row';
    row.style.cursor = 'pointer';
    if (c.paperLink) row.addEventListener('click', () => browseNavigate(c.paperLink));

    const preview = (c.content || '').length > 80 ? c.content.slice(0, 80) + '...' : c.content;
    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-timeline-title';
    titleEl.textContent = preview;
    row.appendChild(titleEl);

    if (c.timestamp) {
      const time = document.createElement('div');
      time.className = 'nr-hub-timeline-time';
      time.textContent = _relativeTime(c.timestamp);
      row.appendChild(time);
    }

    card.appendChild(row);
  }

  return card;
}

// ── Recent Reposts ──

function _buildReposts(reposts) {
  const card = document.createElement('div');
  card.className = 'nr-hub-dash-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'nr-hub-dash-card-header';
  const title = document.createElement('div');
  title.className = 'nr-hub-dash-card-title';
  title.textContent = 'Reposts';
  titleRow.appendChild(title);
  const countEl = document.createElement('div');
  countEl.className = 'nr-hub-heatmap-year';
  countEl.textContent = String(reposts.length);
  titleRow.appendChild(countEl);
  card.appendChild(titleRow);

  for (const r of reposts.slice(0, 4)) {
    const row = document.createElement('div');
    row.className = 'nr-hub-timeline-row';
    row.style.cursor = 'pointer';
    if (r.paperLink) row.addEventListener('click', () => browseNavigate(r.paperLink));

    const titleEl = document.createElement('div');
    titleEl.className = 'nr-hub-timeline-title';
    titleEl.textContent = r.paperTitle || r.paperLink || 'Repost';
    row.appendChild(titleEl);

    if (r.timestamp) {
      const time = document.createElement('div');
      time.className = 'nr-hub-timeline-time';
      time.textContent = _relativeTime(r.timestamp);
      row.appendChild(time);
    }

    card.appendChild(row);
  }

  return card;
}

// ── Add Event Form ──

function _showAddEventForm(card) {
  if (card.querySelector('.nr-hub-cal-form')) return;

  const form = document.createElement('div');
  form.className = 'nr-hub-cal-form';

  const titleInput = document.createElement('input');
  titleInput.className = 'nr-hub-cal-input';
  titleInput.placeholder = 'Event title';
  form.appendChild(titleInput);

  const dateInput = document.createElement('input');
  dateInput.className = 'nr-hub-cal-input';
  dateInput.type = 'date';
  dateInput.value = new Date().toISOString().slice(0, 10);
  form.appendChild(dateInput);

  const descInput = document.createElement('input');
  descInput.className = 'nr-hub-cal-input';
  descInput.placeholder = 'Description (optional)';
  form.appendChild(descInput);

  const colors = ['#60a5fa', '#34d399', '#f97316', '#a78bfa', '#fb923c', '#f43f5e'];
  let selectedColor = colors[0];
  const swatches = document.createElement('div');
  swatches.className = 'nr-hub-cal-swatches';
  for (const c of colors) {
    const sw = document.createElement('div');
    sw.className = 'nr-hub-cal-swatch' + (c === selectedColor ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      swatches.querySelectorAll('.nr-hub-cal-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      selectedColor = c;
    });
    swatches.appendChild(sw);
  }
  form.appendChild(swatches);

  const actions = document.createElement('div');
  actions.className = 'nr-hub-cal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'nr-hub-cal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'nr-hub-cal-btn nr-hub-cal-btn-primary';
  saveBtn.textContent = 'Add';
  saveBtn.addEventListener('click', async () => {
    const t = titleInput.value.trim();
    if (!t) return;
    await addCalendarEvent({ title: t, date: dateInput.value, description: descInput.value.trim() || undefined, color: selectedColor });
    form.remove();
    const hubEl = card.closest('.nr-hub-scroll');
    if (hubEl) _renderNetrunPage(hubEl);
  });
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  const titleRow = card.querySelector('.nr-hub-dash-card-header');
  if (titleRow && titleRow.nextSibling) card.insertBefore(form, titleRow.nextSibling);
  else card.appendChild(form);
  titleInput.focus();
}

// ── Helpers ──

function _dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _addChip(parent, text) {
  const chip = document.createElement('span');
  chip.className = 'nr-hub-dash-chip';
  chip.textContent = text;
  parent.appendChild(chip);
}

function _getTrending(limit) {
  const papers = allPapers || [];
  if (!papers.length) return [];
  const now = Date.now();
  return papers.map(p => {
    const engagement = (p.points || 0) + (p.citations || 0);
    const ageH = (now - (p.pubDate || now)) / 3600000;
    const recency = Math.max(0, 1 - ageH / 72);
    const score = engagement * 2 * (0.3 + recency * 0.7);
    return { ...p, _trendScore: score };
  }).filter(p => p._trendScore > 0).sort((a, b) => b._trendScore - a._trendScore).slice(0, limit);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ─── Help Reference ──────────────────────────────────────────
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _ROUTES = [
  ['netrun://',        'This page \u2014 hub and help reference'],
  ['netrun://history', 'Browse and search history'],
  ['netrun://docs',    'AetherUI API reference'],
  ['chat://',          'Chat threads view'],
  ['chat://<id>',      'Open a specific chat thread'],
  ['draw://',          'Drawing whiteboard'],
  ['ntp://',           'New tab page'],
];

function _buildRoutes() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle('Special Routes', 'Type these in the URL bar to open internal pages.'));

  for (const [url, desc] of _ROUTES) {
    const row = document.createElement('div');
    row.className = 'nr-hub-route';
    if (!url.includes('<')) row.addEventListener('click', () => browseNavigate(url));

    const urlEl = document.createElement('span');
    urlEl.className = 'nr-hub-route-url';
    urlEl.textContent = url;
    row.appendChild(urlEl);

    const descEl = document.createElement('span');
    descEl.className = 'nr-hub-route-desc';
    descEl.textContent = desc;
    row.appendChild(descEl);

    section.appendChild(row);
  }

  return section;
}

function _buildHelpSections(container) {
  container.appendChild(_tableSection('Instant Answers', 'Type in the URL bar \u2014 results appear inline as you type.', ['Type', 'Try'], _HELP_DATA.instantAnswers));
  container.appendChild(_tableSection('Search Syntax', 'Use these in the Papers search on new tab pages.', ['Syntax', 'Effect'], _HELP_DATA.searchSyntax, true));
  const bangs = _HELP_DATA.getBangs();
  if (bangs.length) container.appendChild(_tableSection('Bangs', 'Type ! followed by a shortcut and your query to search a specific site.', ['Bang', 'Site'], bangs, true));
  container.appendChild(_tableSection('Slash Commands', 'Right-click \u2192 type / in the aether panel.', ['Command', 'Action'], _HELP_DATA.slashCommands));
  container.appendChild(_buildShortcuts());
  container.appendChild(_buildAetherPanel());
  container.appendChild(_tableSection('Chat Tools', 'When enabled, the chat assistant can use these tools autonomously.', ['Tool', 'Description'], _HELP_DATA.chatTools, true));
  container.appendChild(_tableSection('AI Models', 'Local Ollama models. All optional \u2014 features degrade gracefully.', ['Model', 'Used for'], _HELP_DATA.aiModels, true));
}

function _buildShortcuts() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle('Keyboard Shortcuts'));

  const table = document.createElement('table');
  table.className = 'nr-hub-table';
  const thead = document.createElement('tr');
  for (const h of ['Key', 'Action']) { const th = document.createElement('th'); th.className = 'nr-hub-th'; th.textContent = h; thead.appendChild(th); }
  table.appendChild(thead);

  for (const [key, val] of _HELP_DATA.shortcuts) {
    const tr = document.createElement('tr');
    tr.className = 'nr-hub-tr';
    if (!key) {
      const td = document.createElement('td'); td.colSpan = 2; td.style.cssText = 'padding:12px 12px 4px;'; td.innerHTML = val; tr.appendChild(td);
    } else {
      const tdKey = document.createElement('td'); tdKey.className = 'nr-hub-td-key';
      const kbd = document.createElement('kbd'); kbd.className = 'nr-hub-kbd'; kbd.textContent = key; tdKey.appendChild(kbd); tr.appendChild(tdKey);
      const tdVal = document.createElement('td'); tdVal.className = 'nr-hub-td-val'; tdVal.textContent = val; tr.appendChild(tdVal);
    }
    table.appendChild(tr);
  }
  section.appendChild(table);
  return section;
}

function _buildAetherPanel() {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle('Aether Panel'));
  const desc = document.createElement('div');
  desc.className = 'nr-hub-panel-desc';
  desc.innerHTML = '<strong>Right-click</strong> anywhere to open the panel.<br>Type to <strong>chat with AI</strong> about the current page.<br><strong>Select text</strong> \u2192 highlight, quote, or define.<br><strong>Drag</strong> while panel is open to capture a screenshot region.';
  section.appendChild(desc);
  return section;
}

function _sectionTitle(title, subtitle) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('div'); h.className = 'nr-hub-section-title'; h.textContent = title; frag.appendChild(h);
  if (subtitle) { const p = document.createElement('div'); p.className = 'nr-hub-section-desc'; p.textContent = subtitle; frag.appendChild(p); }
  return frag;
}

function _tableSection(title, subtitle, headers, rows, monoKeys) {
  const section = document.createElement('div');
  section.className = 'nr-hub-section';
  section.appendChild(_sectionTitle(title, subtitle));
  const table = document.createElement('table'); table.className = 'nr-hub-table';
  const thead = document.createElement('tr');
  for (const h of headers) { const th = document.createElement('th'); th.className = 'nr-hub-th'; th.textContent = h; thead.appendChild(th); }
  table.appendChild(thead);
  for (const [key, val] of rows) {
    const tr = document.createElement('tr'); tr.className = 'nr-hub-tr';
    const tdKey = document.createElement('td'); tdKey.className = 'nr-hub-td-key';
    if (monoKeys) { const code = document.createElement('code'); code.style.fontSize = '0.8rem'; code.textContent = key; tdKey.appendChild(code); }
    else tdKey.textContent = key;
    tr.appendChild(tdKey);
    const tdVal = document.createElement('td'); tdVal.className = 'nr-hub-td-val'; tdVal.textContent = val; tr.appendChild(tdVal);
    table.appendChild(tr);
  }
  section.appendChild(table);
  return section;
}

// Expose to window for browse modules that use global references
window.openNetrunPage = openNetrunPage;
window._renderNetrunPage = _renderNetrunPage;
