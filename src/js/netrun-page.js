// netrun-page.js — netrun:// hub page (home + full dashboard)

import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse } from '/js/browse/browse-windows.js';
import { _browseWindows, getBrowseActiveWindow } from '/js/browse/browse-state.js';
import { wmOpen, getSourceChip } from '/js/core/core-views.js';
import { getSavedPosts, allPapers, openSavedPaper, toggleSavePostByLink } from '/js/feed.js';
import { apiGet } from '/js/api.js';
import { escapeAttr } from '/js/core/core-utils.js';
import { _relativeTime } from '/js/search.js';
import { addCalendarEvent, deleteCalendarEvent } from '/js/calendar.js';
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
  const elView = new View('div').id('browse-netrun-' + tab.id).className('nr-hub-scroll')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;');
  AetherUI.append(elView, container);
  tab.el = elView.el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://');

  _renderNetrunPage(tab.el);
}

// ─── Render the hub page into an element ─────────────────────

export function _renderNetrunPage(el) {
  if (!el) return;

  const dashSlot = new View('div');
  const content = VStack(
    _buildHero(),
    _buildFeatureCards(),
    dashSlot,
  ).className('nr-hub-content');

  // Mount content
  AetherUI.mount(content, el);

  _buildDashboard(dashSlot.el);

  // Easter egg: Konami code starts the netrunner game
  initNetrunner();
}

// ─── Hero ────────────────────────────────────────────────────

function _buildHero() {
  const versionStr = State('');
  const versionText = Text(versionStr).className('nr-hub-hero-version');
  apiGet('/api/version').then(v => {
    if (v && v.version) versionStr.value = 'v' + v.version + (v.sha ? ' (' + v.sha + ')' : '');
  }).catch(() => {});
  return VStack(
    RawHTML('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/></svg>').className('nr-hub-hero-logo'),
    Text('netrun').className('nr-hub-hero-title'),
    Text('Browse, read, chat, draw.').className('nr-hub-hero-tagline'),
    versionText,
  ).className('nr-hub-hero');
}

// ─── Feature Cards ───────────────────────────────────────────

const _FEATURES = [
  { icon: 'globe',      title: 'Browse',    desc: 'Web browser with ad blocking, split tabs, and bangs.', action: () => browseNavigate('ntp://') },
  { icon: 'chatBubble', title: 'Chat',      desc: 'AI assistant with tools. Search, fetch, navigate.',    action: () => browseNavigate('chat://') },
  { icon: 'edit',       title: 'Draw',      desc: 'Whiteboard with pen, shapes, text.',                   action: () => browseNavigate('draw://') },
  { icon: 'feed',       title: 'Feed',      desc: '125+ sources. arXiv, HN, RSS, and more.',              action: () => wmOpen('feed') },
  { icon: 'bookmark',   title: 'Library',   desc: 'Saved bookmarks, groups, and reading list.',             action: () => browseNavigate('netrun://bookmarks') },
  { icon: 'clock',      title: 'History',   desc: 'Browse and search history.',                            action: () => browseNavigate('netrun://history') },
  { icon: 'terminal',   title: 'Terminal',   desc: 'Shell with tabs, splits, and themes.',                   action: () => openTerminalPage() },
  { icon: 'research',   title: 'Docs',      desc: 'API reference, shortcuts, and help.',                     action: () => browseNavigate('netrun://docs') },
];

function _buildFeatureCards() {
  return Grid(
    ..._FEATURES.map(f =>
      HStack(
        RawHTML(icon(f.icon, { size: 24 })).className('nr-hub-card-icon'),
        VStack(
          Text(f.title).className('nr-hub-card-title'),
          Text(f.desc).className('nr-hub-card-desc'),
        ),
      ).className('nr-hub-card').onTap(f.action)
    )
  ).className('nr-hub-cards');
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
    calResp, commentsResp, repostsResp,
  ] = await Promise.all([
    apiGet('/api/calendar').catch(() => []),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/comments').catch(() => []) : [],
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/reposts').catch(() => []) : [],
  ]);

  const events = calResp || [];
  const myComments = commentsResp || [];
  const myReposts = repostsResp || [];
  const saved = getSavedPosts();
  const savedEntries = Object.values(saved);
  const savedCount = savedEntries.length;
  const searchHist = Settings.getJSON('searchHistory', []);
  const webHist = Settings.getJSON('webSearchHistory', []);

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
  const todaySearchCount = searchHist.filter(e => isToday(e.ts)).length + webHist.filter(e => isToday(e.ts)).length;
  const chips = [];
  if (todaySearchCount > 0) chips.push(todaySearchCount + ' search' + (todaySearchCount === 1 ? '' : 'es'));
  if (savedCount > 0) chips.push(savedCount + ' saved');
  if (todayEvents.length > 0) chips.push(todayEvents.length + ' event' + (todayEvents.length === 1 ? '' : 's'));

  const dashChildren = [
    Text(getGreeting()).className('nr-hub-greeting'),
    HStack(
      Text(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })).className('nr-hub-dash-date'),
      ...chips.map(c => Text(c).className('nr-hub-dash-chip')),
    ).className('nr-hub-dash-header'),
  ];

  // Heatmap stays raw — wrap its DOM element
  const heatmapEl = _buildHeatmap(activityItems, now);
  dashChildren.push(heatmapEl);

  if (timeline.length > 0) dashChildren.push(_buildTimeline(timeline));
  dashChildren.push(_buildCalendarCard(upcomingEvents, todayStr));
  dashChildren.push(_buildReadingList(savedEntries, savedCount));
  if (trending.length > 0) dashChildren.push(_buildTrending(trending));
  if (myComments.length > 0) dashChildren.push(_buildComments(myComments));
  if (myReposts.length > 0) dashChildren.push(_buildReposts(myReposts));

  const wrap = VStack(...dashChildren).className('nr-hub-dash');
  AetherUI.append(wrap, slot);
}


// ── Activity Heatmap (GitHub-style) — stays raw ──

function _buildHeatmap(activityItems, now) {
  const headerRow = HStack(
    Text('Activity').className('nr-hub-dash-card-title'),
    Text(String(now.getFullYear())).className('nr-hub-heatmap-year'),
  ).className('nr-hub-dash-card-header');

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

  const scrollWrap = RawHTML(svg).className('nr-hub-heatmap-scroll');
  const tipEl = new View('div').className('nr-hub-heatmap-tip');
  const card = VStack(headerRow, scrollWrap, tipEl).className('nr-hub-dash-card');

  // Attach tooltip handlers after render
  requestAnimationFrame(() => {
    const svgEl = card.el.querySelector('.nr-hub-heatmap-svg');
    if (!svgEl) return;
    svgEl.addEventListener('mouseover', e => {
      const r = e.target.closest('.nr-hub-heatmap-cell');
      if (!r) { tipEl.el.style.display = 'none'; return; }
      tipEl.el.textContent = r.dataset.tip;
      tipEl.el.style.display = 'block';
      const cr = r.getBoundingClientRect();
      let left = cr.left + cr.width / 2 - tipEl.el.offsetWidth / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - tipEl.el.offsetWidth - 4));
      tipEl.el.style.left = left + 'px';
      tipEl.el.style.top = (cr.top - tipEl.el.offsetHeight - 6) + 'px';
    });
    svgEl.addEventListener('mouseout', e => {
      if (e.target.closest('.nr-hub-heatmap-cell')) tipEl.el.style.display = 'none';
    });
  });

  return card;
}

// ── Today's Timeline ──

function _buildTimeline(timeline) {
  return VStack(
    Text('Today').className('nr-hub-dash-card-title'),
    ...timeline.slice(0, 8).map(item => {
      const color = item.color || _ACTIVITY_COLORS[item.type] || '#999';
      const label = _ACTIVITY_LABELS[item.type] || item.type;
      const children = [
        Text('').className('nr-hub-timeline-dot').style('background', color),
        Text((item.title || '').slice(0, 80)).className('nr-hub-timeline-title'),
        Text(label).className('nr-hub-timeline-badge').style('color', color),
      ];
      if (item.ts) children.push(Text(_relativeTime(item.ts)).className('nr-hub-timeline-time'));
      return HStack(...children).className('nr-hub-timeline-row');
    }),
    ...(timeline.length > 8
      ? [Text((timeline.length - 8) + ' more today').className('nr-hub-dash-more')]
      : []),
  ).className('nr-hub-dash-card');
}

// ── Calendar Events ──

function _buildCalendarCard(upcomingEvents, todayStr) {
  const children = [
    HStack(
      Text('Calendar').className('nr-hub-dash-card-title'),
      Spacer(),
      Text('+').className('nr-hub-cal-add').onTap(function() {
        _showAddEventForm(card);
      }),
    ).className('nr-hub-dash-card-header'),
  ];

  if (upcomingEvents.length > 0) {
    for (const ev of upcomingEvents) {
      const infoChildren = [
        Text(ev.title || 'Event').className('nr-hub-event-title'),
      ];
      if (ev.date !== todayStr) {
        const d = new Date(ev.date + 'T12:00:00');
        infoChildren.push(Text(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })).className('nr-hub-event-date'));
      }
      if (ev.description) {
        infoChildren.push(Text(ev.description).className('nr-hub-event-desc'));
      }

      const row = HStack(
        Text('').className('nr-hub-event-dot').style('background', ev.color || 'var(--nr-accent)'),
        VStack(...infoChildren).className('nr-hub-event-info'),
        Spacer(),
        Text('\u00d7').className('nr-hub-event-del').onTap(async function(e) {
          e.stopPropagation();
          await deleteCalendarEvent(ev.id);
          row.el.remove();
        }),
      ).className('nr-hub-event-row');
      children.push(row);
    }
  } else {
    children.push(Text('No upcoming events').className('nr-hub-dash-empty'));
  }

  const card = VStack(...children).className('nr-hub-dash-card');
  return card;
}

// ── Reading List ──

function _buildReadingList(savedEntries, savedCount) {
  const children = [
    HStack(
      Text('Reading List').className('nr-hub-dash-card-title'),
      Spacer(),
      ...(savedCount > 0 ? [Text(String(savedCount)).className('nr-hub-heatmap-year')] : []),
    ).className('nr-hub-dash-card-header'),
  ];

  if (savedCount > 0) {
    const sorted = savedEntries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, 8);
    for (const entry of sorted) {
      const paper = entry.paper || {};
      let hostname = '';
      try { hostname = new URL(paper.link).hostname.replace(/^www\./, ''); } catch {}

      const rowChildren = [
        new View('img').className('nr-hub-saved-favicon')
          .attr('src', '/api/favicon?domain=' + encodeURIComponent(hostname))
          .attr('alt', '').attr('loading', 'lazy'),
        Text(paper.title || paper.link || 'Untitled').className('nr-hub-saved-title'),
      ];
      if (hostname) rowChildren.push(Text(hostname).className('nr-hub-saved-host'));

      const row = HStack(...rowChildren).className('nr-hub-saved-row').onTap(() => openSavedPaper(paper.link));

      // Delete button
      const del = Text('\u00d7').className('nr-hub-event-del').onTap(function(e) {
        e.stopPropagation();
        toggleSavePostByLink(paper.link);
        row.el.remove();
      });
      row.add(del);

      children.push(row);
    }

    if (savedCount > 8) {
      children.push(
        Text('View all ' + savedCount + ' saved \u2192').className('nr-hub-dash-more').onTap(() => browseNavigate('netrun://bookmarks'))
      );
    }
  } else {
    children.push(Text('No saved posts yet').className('nr-hub-dash-empty'));
  }

  return VStack(...children).className('nr-hub-dash-card');
}

// ── Trending ──

function _buildTrending(trending) {
  return VStack(
    Text('Trending').className('nr-hub-dash-card-title'),
    ...trending.map((p, i) => {
      const chip = getSourceChip(p.source, p.arxivId);
      const engagement = (p.points || 0) + (p.citations || 0);
      return HStack(
        Text(String(i + 1)).className('nr-hub-trending-rank'),
        VStack(
          Text(p.title).className('nr-hub-trending-title'),
          RawHTML((chip || '') + (engagement > 0 ? '<span class="nr-hub-trending-eng">' + engagement + '</span>' : '')).className('nr-hub-trending-meta'),
        ).className('nr-hub-trending-info'),
      ).className('nr-hub-trending-row').onTap(() => browseNavigate(p.link));
    }),
  ).className('nr-hub-dash-card');
}

// ── Recent Comments ──

function _buildComments(comments) {
  return VStack(
    HStack(
      Text('Recent Comments').className('nr-hub-dash-card-title'),
      Spacer(),
      Text(String(comments.length)).className('nr-hub-heatmap-year'),
    ).className('nr-hub-dash-card-header'),
    ...comments.slice(0, 4).map(c => {
      const preview = (c.content || '').length > 80 ? c.content.slice(0, 80) + '...' : c.content;
      const children = [
        Text(preview).className('nr-hub-timeline-title'),
      ];
      if (c.timestamp) children.push(Text(_relativeTime(c.timestamp)).className('nr-hub-timeline-time'));
      const row = HStack(...children).className('nr-hub-timeline-row').style('cursor', 'pointer');
      if (c.paperLink) row.onTap(() => browseNavigate(c.paperLink));
      return row;
    }),
  ).className('nr-hub-dash-card');
}

// ── Recent Reposts ──

function _buildReposts(reposts) {
  return VStack(
    HStack(
      Text('Reposts').className('nr-hub-dash-card-title'),
      Spacer(),
      Text(String(reposts.length)).className('nr-hub-heatmap-year'),
    ).className('nr-hub-dash-card-header'),
    ...reposts.slice(0, 4).map(r => {
      const children = [
        Text(r.paperTitle || r.paperLink || 'Repost').className('nr-hub-timeline-title'),
      ];
      if (r.timestamp) children.push(Text(_relativeTime(r.timestamp)).className('nr-hub-timeline-time'));
      const row = HStack(...children).className('nr-hub-timeline-row').style('cursor', 'pointer');
      if (r.paperLink) row.onTap(() => browseNavigate(r.paperLink));
      return row;
    }),
  ).className('nr-hub-dash-card');
}

// ── Add Event Form ──

function _showAddEventForm(card) {
  if (card._calFormOpen) return;
  card._calFormOpen = true;

  const titleInput = new View('input').className('nr-hub-cal-input').attr('placeholder', 'Event title');
  const dateInput = new View('input').className('nr-hub-cal-input').attr('type', 'date');
  dateInput.el.value = new Date().toISOString().slice(0, 10);
  const descInput = new View('input').className('nr-hub-cal-input').attr('placeholder', 'Description (optional)');

  const colors = ['#60a5fa', '#34d399', '#f97316', '#a78bfa', '#fb923c', '#f43f5e'];
  const selectedColor = State(colors[0]);
  const swatchViews = colors.map(c => {
    const sw = new View('div').style('background', c);
    Effect(() => {
      sw.el.className = 'nr-hub-cal-swatch' + (selectedColor.value === c ? ' active' : '');
    });
    sw.onTap(() => { selectedColor.value = c; });
    return sw;
  });
  const swatchesView = new View('div').className('nr-hub-cal-swatches').add(...swatchViews);

  const cancelBtn = new View('button').className('nr-hub-cal-btn').text('Cancel');
  const saveBtn = new View('button').className('nr-hub-cal-btn nr-hub-cal-btn-primary').text('Add');

  const form = VStack(
    titleInput, dateInput, descInput, swatchesView,
    new View('div').className('nr-hub-cal-actions').add(cancelBtn, saveBtn),
  ).className('nr-hub-cal-form');

  const dismiss = () => { card._calFormOpen = false; form.el.remove(); };

  cancelBtn.onTap(dismiss);
  saveBtn.onTap(async () => {
    const t = titleInput.el.value.trim();
    if (!t) return;
    await addCalendarEvent({ title: t, date: dateInput.el.value, description: descInput.el.value.trim() || undefined, color: selectedColor.value });
    dismiss();
    const hubEl = card.el.closest('.nr-hub-scroll');
    if (hubEl) _renderNetrunPage(hubEl);
  });

  // Insert form after the header row (first child), before any existing event rows
  card.el.insertBefore(form.el, card.el.children[1] || null);
  titleInput.el.focus();
}

// ── Helpers ──

function _dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

// Expose to window for browse modules that use global references
window.openNetrunPage = openNetrunPage;
window._renderNetrunPage = _renderNetrunPage;
