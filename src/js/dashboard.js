import Settings from '/js/core/core-settings.js';

// ── Dashboard ──

// Make AetherUI primitives available as globals (VStack, HStack, Text, Button, etc.)
if (window.AetherUI) AetherUI.globals();

export const _dashSearchDebounce = null;


export function _closeDashSearch(e) {
  const dropdown = document.getElementById('dashboard-search-results');
  const input = document.getElementById('dashboard-search');
  if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = 'none';
  }
}


export function dashRemoveSaved(link) {
  toggleSavePostByLink(link);
  renderDashboard();
}

// ── Bento dashboard helpers ──

export function _dashPapersReadRecent() {
  const readSet = new Set(Settings.getJSON('readPosts', []));
  if (!readSet.size) return 0;
  const papers = typeof allPapers !== 'undefined' ? allPapers : [];
  return papers.filter(p => readSet.has(p.link)).length;
}


export function _dashTrending(limit) {
  limit = limit || 5;
  const papers = typeof allPapers !== 'undefined' ? allPapers : [];
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

export function _dashBuildStatsRow(papersRead, savedCount, projectCount) {
  const stats = [
    { value: papersRead, label: 'Papers Read', sub: 'in feed', color: '#60a5fa' },
    { value: savedCount, label: 'Saved', sub: 'reading list', color: '#34d399' },
    { value: projectCount, label: 'Projects', sub: 'active', color: '#a78bfa' },
  ];
  return HStack(stats.map(function(s) {
    return VStack(
      Text(s.value + (s.suffix || '')).className('stat-value').styles({color: s.color}),
      Text(s.label).className('stat-label'),
      Text(s.sub).className('stat-sub')
    ).className('bento-stat');
  })).className('bento-stats');
}

export function _dashBuildQuickActions() {
  const actions = [
    { label: 'Search', fn: function() { openSearch(); }, iconName: 'search' },
    { label: 'Calendar', fn: function() { wmOpen('calendar'); }, iconName: 'calendar' },
  ];
  return Grid(actions.map(function(a) {
    const btn = Button(null).ghost().onTap(a.fn);
    btn.el.innerHTML = icon(a.iconName, {size: 16, class: 'w-4 h-4 shrink-0'}) +
                       '<span>' + a.label + '</span>';
    return btn;
  })).columns(2).gap('8px').frame({height: '100%'});
}

export function _dashBuildTrendingCard(trending) {
  if (!trending.length) return Text('No trending posts yet. Open your feed to get started.').className('text-[0.8rem] text-dimmer px-1');
  return ForEach(trending, function(p, i) {
    const chip = typeof getSourceChip === 'function' ? getSourceChip(p.source, p.arxivId) : '';
    const engagement = (p.points || 0) + (p.citations || 0);
    const engLabel = engagement > 0 ? '<span class="text-[0.68rem] text-dimmest shrink-0">' + engagement + '</span>' : '';
    const row = HStack(
      Text(String(i + 1)).className('bento-trending-rank'),
      VStack(
        Text(p.title).className('text-[0.8rem] text-primary truncate'),
        RawHTML('<div class="flex items-center gap-1.5 mt-0.5">' + chip + engLabel + '</div>')
      ).className('flex-1 min-w-0')
    ).className('bento-trending-item').onTap(function() {
      window.location.hash = 'view/' + encodeURIComponent(p.link);
    });
    return row;
  });
}

export async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  AetherUI.mount(RawHTML('<div class="text-center py-20 text-dim"><div class="spinner"></div></div>'), container);

  const _uname = _authUserInfo?.username;
  const [calResp, profileResp, commentsResp, repostsResp, inboxMessages] = await Promise.all([
    apiGet('/api/calendar').catch(() => []),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname)).catch(() => null) : Promise.resolve(null),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/comments').catch(() => []) : Promise.resolve([]),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/reposts').catch(() => []) : Promise.resolve([]),
    apiGet('/api/messages').catch(() => []),
  ]);

  const events = calResp || [];
  const profile = profileResp || {};
  const myComments = commentsResp || [];
  const myReposts = repostsResp || [];

  _dashStatusProfile = profile;
  const mergedSaved = getSavedPosts();

  // ── Daily overview — all today's interactions ──
  const now = new Date();
  const _todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const _todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const _isToday = (ts) => ts && ts >= _todayStart;

  // Gather all today's interactions into a unified timeline
  const _todayActivity = [];

  // Calendar events today
  events.filter(ev => ev.date === _todayKey).forEach(ev => {
    _todayActivity.push({ type: 'event', title: ev.title || 'Calendar event', time: _todayStart, icon: 'cal' });
  });

  // Papers saved today
  Object.values(mergedSaved).forEach(entry => {
    if (_isToday(entry.savedAt)) {
      _todayActivity.push({ type: 'saved', title: entry.paper?.title || 'Untitled', time: entry.savedAt, link: entry.paper?.link, icon: 'bookmark' });
    }
  });

  // Comments made today
  myComments.filter(c => _isToday(c.timestamp)).forEach(c => {
    _todayActivity.push({ type: 'comment', title: (c.content || '').slice(0, 80) + ((c.content || '').length > 80 ? '...' : ''), time: c.timestamp, link: c.paperLink, icon: 'comment' });
  });

  // Reposts today
  myReposts.filter(r => _isToday(r.timestamp)).forEach(r => {
    _todayActivity.push({ type: 'repost', title: r.paperTitle || r.paperLink, time: r.timestamp, link: r.paperLink, icon: 'repost' });
  });

  // Feed searches today
  const _searchHist = Settings.getJSON('searchHistory', []);
  _searchHist.filter(s => s.ts && _isToday(s.ts)).forEach(s => {
    _todayActivity.push({ type: 'search', title: s.q || s, time: s.ts, icon: 'search' });
  });

  // Web searches today
  const _webSearchHist = Settings.getJSON('webSearchHistory', []);
  _webSearchHist.filter(s => s.ts && _isToday(s.ts)).forEach(s => {
    _todayActivity.push({ type: 'web-search', title: s.q, time: s.ts, icon: 'globe' });
  });

  // Feed notifications (new posts discovered) today
  const _feedNotifs = Settings.getJSON('feedNotifications', []);
  _feedNotifs.filter(n => n.seenAt && _isToday(n.seenAt)).forEach(n => {
    _todayActivity.push({ type: 'notif', title: n.title, time: n.seenAt, link: n.link, icon: 'bell' });
  });

  // Sort by time descending (most recent first)
  _todayActivity.sort((a, b) => (b.time || 0) - (a.time || 0));

  const _unreadSavedCount = Object.values(mergedSaved).filter(e => !e.read).length;

  const _todayDateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const _ovIcons = {
    cal:      icon('calendar', {class: 'w-3.5 h-3.5', style: 'color:#60a5fa'}),
    bookmark: icon('bookmark', {class: 'w-3.5 h-3.5', style: 'color:#34d399'}),
    comment:  icon('comment', {class: 'w-3.5 h-3.5', style: 'color:#a78bfa'}),
    repost:   icon('repost', {class: 'w-3.5 h-3.5', style: 'color:#4ade80'}),
    task:     icon('taskCheck', {class: 'w-3.5 h-3.5', style: 'color:#fbbf24'}),
    search:   icon('search', {class: 'w-3.5 h-3.5', style: 'color:#f97316'}),
    globe:    icon('globe', {class: 'w-3.5 h-3.5', style: 'color:#38bdf8'}),
    bell:     icon('bell', {class: 'w-3.5 h-3.5', style: 'color:#fb923c'}),
  };

  const _ovLabels = { event: 'Event', saved: 'Saved', comment: 'Commented', repost: 'Reposted', task: 'New task', search: 'Searched', 'web-search': 'Web search', notif: 'New post' };

  const _fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  // Summary chips
  const _chips = [];
  const _todayEvents = events.filter(ev => ev.date === _todayKey);
  const _todayEvtCount = _todayEvents.length;
  if (_todayEvtCount) _chips.push(_todayEvtCount + ' event' + (_todayEvtCount > 1 ? 's' : ''));
  if (_unreadSavedCount) _chips.push(_unreadSavedCount + ' unread');
  const _todaySavedCount = _todayActivity.filter(a => a.type === 'saved').length;
  if (_todaySavedCount) _chips.push(_todaySavedCount + ' saved');
  const _todayCommentCount = _todayActivity.filter(a => a.type === 'comment').length;
  if (_todayCommentCount) _chips.push(_todayCommentCount + ' comment' + (_todayCommentCount > 1 ? 's' : ''));
  const _todaySearchCount = _todayActivity.filter(a => a.type === 'search' || a.type === 'web-search').length;
  if (_todaySearchCount) _chips.push(_todaySearchCount + ' search' + (_todaySearchCount > 1 ? 'es' : ''));

  // Today's events banner view
  let _eventsBanner = null;
  if (_todayEvents.length) {
    _eventsBanner = VStack(
      HStack(
        RawHTML(icon('calendar', {size: 16, class: 'w-4 h-4 shrink-0', style: 'color:#60a5fa'})),
        Text("Today's Events").className('text-[0.78rem] font-semibold').styles({color:'#60a5fa'})
      ).spacing('8px').className('mb-2'),
      VStack(_todayEvents.map(function(ev) {
        const evColor = ev.color || '#60a5fa';
        const dot = new View('span');
        dot.className('w-2 h-2 rounded-full shrink-0');
        dot.styles({ background: evColor });
        const descView = ev.description ? Text(ev.description).className('text-[0.72rem] text-dimmer truncate') : null;
        return HStack(
          dot,
          Text(ev.title || 'Calendar event').className('text-[0.85rem] text-primary font-medium'),
          descView
        ).className('flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-hover transition-colors')
         .onTap(function() { window.location.hash = 'calendar'; });
      })).spacing('6px')
    ).className('rounded-lg p-3 mb-3')
     .styles({background:'rgba(96,165,250,0.08)', border:'1px solid rgba(96,165,250,0.2)'});
  }

  // Build LLM prompt data (used after render)
  const _llmActivityData = _todayActivity.slice(0, 20).map(a => _fmtTime(a.time) + ' ' + (_ovLabels[a.type] || a.type) + ': ' + a.title);

  // Filter events out of timeline (they have their own banner)
  const _timelineItems = _todayActivity.filter(a => a.type !== 'event');

  // Chips view
  function _buildChipsView(cls) {
    if (!_chips.length) return null;
    return HStack(_chips.map(function(c) {
      return Text(c).className('text-[0.7rem] px-2 py-0.5 rounded-full bg-accent/10 text-accent');
    })).className('flex flex-wrap gap-1.5 ' + (cls || ''));
  }

  // Summary element placeholder
  function _buildSummaryEl(cls) {
    const el = new View('div');
    el.id('dash-day-summary').className('text-[0.8rem] text-dim leading-relaxed ' + (cls || 'mb-3'));
    el.styles({ minHeight: '1.2em' });
    const inner = Text('Summarizing your day...').className('text-dimmest text-[0.75rem]');
    el.el.appendChild(inner.build());
    return el;
  }

  let overviewView;
  if (_timelineItems.length || _todayEvents.length) {
    const maxItems = 8;
    const shown = _timelineItems.slice(0, maxItems);
    const remaining = _timelineItems.length - maxItems;

    const timelineRows = shown.map(function(a) {
      const row = HStack(
        RawHTML('<span class="shrink-0">' + (_ovIcons[a.icon] || '') + '</span>'),
        Text(_fmtTime(a.time)).className('text-[0.7rem] text-dimmest w-12 shrink-0'),
        Text(_ovLabels[a.type] || a.type).className('text-[0.65rem] text-dimmer w-16 shrink-0'),
        Text(a.title).className('text-[0.78rem] text-primary truncate')
      ).className('flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-hover transition-colors');
      if (a.link) {
        row.onTap(function() { window.location.hash = 'view/' + encodeURIComponent(a.link); });
      }
      return row;
    });
    const remainderView = remaining > 0 ? Text('+ ' + remaining + ' more').className('text-[0.72rem] text-dimmest px-1.5 mt-1') : null;
    const timelineView = shown.length ? VStack(timelineRows.concat(remainderView ? [remainderView] : [])).spacing('4px') : null;

    overviewView = VStack(
      HStack(
        Text(_todayDateStr).className('text-[0.82rem] text-primary font-medium'),
        Spacer(),
        Text(_todayActivity.length + ' interaction' + (_todayActivity.length > 1 ? 's' : '') + ' today').className('text-[0.7rem] text-dimmer')
      ).className('mb-3'),
      _buildSummaryEl('mb-3'),
      _eventsBanner,
      _buildChipsView('mb-3'),
      timelineView
    );
  } else if (_unreadSavedCount) {
    overviewView = VStack(
      HStack(
        Text(_todayDateStr).className('text-[0.82rem] text-primary font-medium')
      ).className('mb-2'),
      _buildSummaryEl('mb-2'),
      _buildChipsView('')
    );
  } else {
    overviewView = HStack(
      Text(_todayDateStr).className('text-[0.82rem] text-primary font-medium'),
      Text('\u2014 A clear day to explore.').className('text-[0.78rem] text-dimmest ml-1')
    ).className('flex items-center gap-2');
  }

  // ── Inbox card ──
  const _inboxFeedNotifs = typeof _getFeedNotifications === 'function' ? _getFeedNotifications() : [];
  const _inboxMsgs = inboxMessages || [];
  const _inboxTotal = _inboxFeedNotifs.length + _inboxMsgs.length;
  let inboxView = null;
  if (_inboxTotal > 0) {
    const inboxItems = [];
    _inboxFeedNotifs.slice().sort(function(a, b) { return (b.seenAt || 0) - (a.seenAt || 0); }).slice(0, 5).forEach(function(n) {
      const chip = typeof getSourceChip === 'function' ? getSourceChip(n.source) : '';
      const dot = new View('span');
      dot.className('w-1.5 h-1.5 rounded-full bg-accent shrink-0');
      const dismissBtn = new View('button');
      dismissBtn.className('text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-0.5 shrink-0');
      dismissBtn.el.textContent = '\u00d7';
      dismissBtn.el.title = 'Dismiss';
      dismissBtn.onTap(function(e) { e.stopPropagation(); dismissFeedNotification(n.link, dismissBtn.el); renderDashboard(); });
      const row = HStack(
        dot,
        chip ? RawHTML(chip) : null,
        Text(n.title).className('text-[0.78rem] text-primary truncate flex-1'),
        dismissBtn
      ).className('flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-hover transition-colors cursor-pointer')
       .onTap(function() { clearFeedNotification(n.link); _setBrowseReturnView('dashboard'); openBrowse(n.link); });
      inboxItems.push(row);
    });
    _inboxMsgs.slice(0, 3).forEach(function(m) {
      const dot = new View('span');
      dot.className('w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0');
      const content = '<span class="font-medium">' + escapeHtml(m.from_username || 'Unknown') + '</span>: ' + escapeHtml((m.content || '').slice(0, 60));
      inboxItems.push(HStack(
        dot,
        RawHTML('<span class="text-[0.78rem] text-primary truncate flex-1">' + content + '</span>')
      ).className('flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-hover transition-colors cursor-pointer')
       .onTap(function() { window.location.hash = 'inbox'; }));
    });
    const inboxList = VStack(inboxItems).className('flex flex-col gap-0.5').styles({maxHeight:'200px', overflowY:'auto'});
    inboxView = VStack(
      HStack(
        Text('Inbox').className('text-[0.82rem] font-semibold text-primary'),
        Spacer(),
        Text(_inboxTotal + ' new').className('text-[0.68rem] text-dimmest')
      ).className('mb-2'),
      inboxList
    );
  }

  // ── Activity heatmap (full year, GitHub-style) ──
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const heatYear = now.getFullYear();

  // Build activity items per date key (YYYY-MM-DD)
  const activityItems = {};
  const addItem = (dateStr, item) => { (activityItems[dateStr] ||= []).push(item); };
  events.forEach(ev => { if (ev.date) addItem(ev.date, { type: 'event', title: ev.title || 'Calendar event', id: ev.id, color: ev.color, description: ev.description }); });
  Object.values(mergedSaved).forEach(entry => {
    if (entry.savedAt) {
      const d = new Date(entry.savedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'saved', title: entry.paper?.title || 'Saved post', link: entry.paper?.link });
    }
  });
  // Enrich heatmap: comments, reposts, search history
  myComments.forEach(c => {
    if (c.timestamp) {
      const d = new Date(c.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'comment', title: (c.content || '').slice(0, 80) });
    }
  });
  myReposts.forEach(r => {
    if (r.timestamp) {
      const d = new Date(r.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'repost', title: r.paperTitle || 'Repost' });
    }
  });
  const _shist = Settings.getJSON('searchHistory', []);
  _shist.forEach(s => {
    if (s.ts) {
      const d = new Date(s.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'search', title: s.q || 'Search' });
    }
  });
  const _wshist = Settings.getJSON('webSearchHistory', []);
  _wshist.forEach(s => {
    if (s.ts) {
      const d = new Date(s.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'web-search', title: s.q || 'Web search' });
    }
  });

  // Helper to get count
  const activityCount = (key) => (activityItems[key] || []).length;

  // Jan 1 to Dec 31 of current year
  const jan1 = new Date(heatYear, 0, 1);
  const dec31 = new Date(heatYear, 11, 31);
  const startDow = jan1.getDay(); // 0=Sun
  // Total weeks columns needed
  const totalDays = Math.ceil((dec31 - jan1) / 86400000) + 1;
  const numWeeks = Math.ceil((startDow + totalDays) / 7);

  // Build cells
  const cells = [];
  for (let day = 0; day < totalDays; day++) {
    const d = new Date(heatYear, 0, 1 + day);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const count = activityCount(key);
    const isToday = d.getTime() === today.getTime();
    const isFuture = d > today;
    const dow = d.getDay();
    const col = Math.floor((startDow + day) / 7);
    cells.push({ key, count, isToday, isFuture, col, row: dow, month: d.getMonth(), date: d.getDate() });
  }

  // Month labels — find the first week column where each month starts
  const monthLabels = [];
  let lastMonth = -1;
  cells.forEach(c => {
    if (c.month !== lastMonth && c.row === 0) {
      lastMonth = c.month;
      monthLabels.push({ col: c.col, label: new Date(heatYear, c.month).toLocaleDateString('en-US', { month: 'short' }) });
    }
  });

  // 1-10 scale: count 1 = level 1, count 10+ = level 10
  const levelFn = (count) => Math.min(count, 10);

  // Easter egg themes based on today's date (or override for preview)
  const _heatThemes = {
    default:    { accent: null, alt: null, outline: null, label: 'Default' },
    halloween:  { accent: '#f97316', alt: null, outline: '#a855f7', label: 'Halloween' },
    christmas:  { accent: '#22c55e', alt: null, outline: '#dc2626', label: 'Christmas' },
    valentine:  { accent: '#ec4899', alt: null, outline: '#ec4899', label: "Valentine's" },
    stpatricks: { accent: '#22c55e', alt: null, outline: '#eab308', label: "St. Patrick's" },
    july4:      { accent: '#ef4444', alt: null, outline: '#3b82f6', label: '4th of July' },
    newyear:    { accent: '#eab308', alt: null, outline: '#eab308', label: "New Year's" },
  };
  // Auto-detect theme from date
  let activeThemeKey = 'default';
  { const mm = now.getMonth(), dd = now.getDate();
    if (mm === 9 && dd >= 25 && dd <= 31) activeThemeKey = 'halloween';
    else if (mm === 11 && dd >= 20 && dd <= 31) activeThemeKey = 'christmas';
    else if (mm === 1 && dd === 14) activeThemeKey = 'valentine';
    else if (mm === 2 && dd === 17) activeThemeKey = 'stpatricks';
    else if (mm === 6 && dd === 4) activeThemeKey = 'july4';
    else if (mm === 0 && dd === 1) activeThemeKey = 'newyear';
  }
  const theme = _heatThemes[activeThemeKey];
  const heatAccent = theme.accent, heatAccentAlt = theme.alt;

  const colorFn = (lvl, col) => {
    if (lvl === 0) return 'var(--nr-border-default)';
    if (heatAccentAlt) {
      const c = col % 2 === 0 ? heatAccent : heatAccentAlt;
      return `color-mix(in srgb, ${c} ${lvl * 10}%, transparent)`;
    }
    if (heatAccent) return `color-mix(in srgb, ${heatAccent} ${lvl * 10}%, transparent)`;
    return `color-mix(in srgb, var(--nr-accent) ${lvl * 10}%, transparent)`;
  };

  const cellSize = 11;
  const cellGap = 3;
  const labelW = 30;
  const monthLabelH = 16;
  const gridW = labelW + numWeeks * (cellSize + cellGap);
  const gridH = monthLabelH + 7 * (cellSize + cellGap);

  let heatmapHtml = `<div class="overflow-x-auto scrollbar-hide" style="position:relative"><svg width="${gridW}" height="${gridH}" class="block heatmap-svg" style="min-width:${gridW}px">`;
  // Month labels along top
  monthLabels.forEach(m => {
    heatmapHtml += `<text x="${labelW + m.col * (cellSize + cellGap)}" y="11" fill="var(--nr-text-quaternary)" font-size="10" font-family="sans-serif">${m.label}</text>`;
  });
  // Day labels (Mon, Wed, Fri)
  const dayLabelMap = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
  Object.entries(dayLabelMap).forEach(([row, label]) => {
    heatmapHtml += `<text x="0" y="${monthLabelH + row * (cellSize + cellGap) + 9}" fill="var(--nr-text-quaternary)" font-size="9" font-family="sans-serif">${label}</text>`;
  });
  // Cells
  cells.forEach(c => {
    const x = labelW + c.col * (cellSize + cellGap);
    const y = monthLabelH + c.row * (cellSize + cellGap);
    const lvl = c.isFuture ? 0 : levelFn(c.count);
    const stroke = c.isToday ? (theme.outline || 'var(--nr-accent)') : 'none';
    const sw = c.isToday ? '1.5' : '0';
    const prettyDate = new Date(heatYear, c.month, c.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const tooltipText = c.isFuture ? prettyDate : (c.count === 0 ? `No activity on ${prettyDate}` : `${c.count} activit${c.count === 1 ? 'y' : 'ies'} on ${prettyDate}`);
    heatmapHtml += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colorFn(lvl, c.col)}" stroke="${stroke}" stroke-width="${sw}" data-tip="${escapeAttr(tooltipText)}" data-key="${c.key}" class="heatmap-cell" style="cursor:pointer"/>`;
  });
  heatmapHtml += '</svg></div>';
  // Tooltip and popover are fixed-position, appended to body via JS
  heatmapHtml += '<div id="heatmap-tip" style="display:none;position:fixed;pointer-events:none;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--nr-text-primary);white-space:nowrap;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>';
  // Popover is rendered outside heatmapHtml so it exists in both year and month modes

  // Store activity items on window for click handler
  window._heatmapItems = activityItems;

  // Attach tooltip + click handlers after render
  requestAnimationFrame(() => {
    const tip = document.getElementById('heatmap-tip');
    const pop = document.getElementById('heatmap-popover');
    if (!pop) return;

    // SVG heatmap handlers
    const svg = document.querySelector('.heatmap-svg');
    if (svg && tip) {
      svg.addEventListener('mouseover', e => {
        const r = e.target.closest('.heatmap-cell');
        if (!r) { tip.style.display = 'none'; return; }
        tip.textContent = r.dataset.tip;
        tip.style.display = 'block';
        const cr = r.getBoundingClientRect();
        let left = cr.left + cr.width / 2 - tip.offsetWidth / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - tip.offsetWidth - 4));
        tip.style.left = left + 'px';
        tip.style.top = (cr.top - tip.offsetHeight - 6) + 'px';
      });
      svg.addEventListener('mouseout', e => {
        if (!e.target.closest('.heatmap-cell')) return;
        tip.style.display = 'none';
      });
      svg.addEventListener('click', e => {
        const r = e.target.closest('.heatmap-cell');
        if (!r) return;
        const key = r.dataset.key;
        window._heatmapPopoverKey = key;
        window._heatmapPopoverAddForm = false;
        window._renderHeatmapPopover(key);
        pop.style.display = 'block';
        const cr = r.getBoundingClientRect();
        let left = cr.left + cr.width / 2 - pop.offsetWidth / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - pop.offsetWidth - 4));
        let top = cr.bottom + 6;
        if (top + pop.offsetHeight > window.innerHeight) top = cr.top - pop.offsetHeight - 6;
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
      });
    }

    // Popover renderer + event CRUD (shared by both modes)
    window._heatmapPopoverKey = null;
    window._heatmapPopoverAddForm = false;
    window._renderHeatmapPopover = function(key) {
      const items = window._heatmapItems[key] || [];
      const parts = key.split('-');
      const dateLabel = new Date(+parts[0], +parts[1]-1, +parts[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const typeIcons = { event: '\u{1F4C5}', note: '\u{1F4DD}', saved: '\u{1F516}' };
      const typeLabels = { event: 'Event', note: 'Note', saved: 'Saved' };
      const presetColors = ['#b4451a','#3b82f6','#22c55e','#a855f7','#eab308','#ef4444'];
      const colorLabels = ['Accent','Blue','Green','Purple','Yellow','Red'];

      // Header
      const addBtn = new View('button');
      addBtn.el.textContent = '+';
      addBtn.el.title = 'Add event';
      addBtn.cssText('background:none;border:none;color:var(--nr-accent);cursor:pointer;font-size:13px;font-weight:600;padding:0 2px');
      addBtn.onTap(function() { window._heatmapPopoverAddForm = !window._heatmapPopoverAddForm; window._renderHeatmapPopover(key); });
      const header = HStack(
        Text(dateLabel).styles({color:'var(--nr-text-quaternary)', fontSize:'11px'}),
        Spacer(), addBtn
      ).styles({padding:'4px 12px 6px', borderBottom:'1px solid var(--nr-border-default)', marginBottom:'2px'});

      const children = [header];

      // Add form
      if (window._heatmapPopoverAddForm) {
        const titleInput = new View('input');
        titleInput.el.id = 'hm-ev-title';
        titleInput.el.type = 'text';
        titleInput.el.placeholder = 'Event title\u2026';
        titleInput.cssText('width:100%;padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:12px;margin-bottom:6px;box-sizing:border-box');

        const descTa = new View('textarea');
        descTa.el.id = 'hm-ev-desc';
        descTa.el.placeholder = 'Description (optional)';
        descTa.el.rows = 2;
        descTa.cssText('width:100%;padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:12px;margin-bottom:6px;resize:none;box-sizing:border-box');

        const colorLabel = new View('span');
        colorLabel.cssText('font-size:11px;color:var(--nr-text-quaternary)');
        colorLabel.el.textContent = 'Color:';

        var colorSwatches = presetColors.map(function(c, i) {
          const radioInput = new View('input');
          radioInput.el.type = 'radio';
          radioInput.el.name = 'hm-ev-color';
          radioInput.el.value = c;
          radioInput.el.checked = (i === 0);
          radioInput.cssText('display:none');

          const swatch = new View('span');
          swatch.cssText('width:18px;height:18px;border-radius:50%;display:inline-block;border:2px solid transparent;background:' + c);
          swatch.el.title = colorLabels[i];
          (function(ri, sw) {
            swatch.onTap(function() {
              ri.el.checked = true;
              colorSwatches.forEach(function(s) { s[1].el.style.borderColor = 'transparent'; });
              sw.el.style.borderColor = 'white';
            });
          })(radioInput, swatch);

          const lbl = new View('label');
          lbl.cssText('cursor:pointer');
          lbl.el.appendChild(radioInput.el);
          lbl.el.appendChild(swatch.el);
          return [radioInput, swatch, lbl];
        });

        const colorRow = new View('div');
        colorRow.cssText('display:flex;align-items:center;gap:6px;margin-bottom:6px');
        colorRow.el.appendChild(colorLabel.el);
        colorSwatches.forEach(function(s) { colorRow.el.appendChild(s[2].el); });

        const saveEvtBtn = new View('button');
        saveEvtBtn.el.textContent = 'Save';
        saveEvtBtn.cssText('padding:3px 10px;border-radius:6px;background:var(--nr-accent);color:white;border:none;font-size:12px;cursor:pointer');
        (function(k) { saveEvtBtn.onTap(function() { _heatmapAddEvent(k); }); })(key);

        const cancelEvtBtn = new View('button');
        cancelEvtBtn.el.textContent = 'Cancel';
        cancelEvtBtn.cssText('padding:3px 10px;border-radius:6px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);color:var(--nr-text-primary);font-size:12px;cursor:pointer');
        (function(k) { cancelEvtBtn.onTap(function() { window._heatmapPopoverAddForm = false; window._renderHeatmapPopover(k); }); })(key);

        const btnRow = new View('div');
        btnRow.cssText('display:flex;gap:6px');
        btnRow.el.appendChild(saveEvtBtn.el);
        btnRow.el.appendChild(cancelEvtBtn.el);

        const formView = new View('div');
        formView.cssText('padding:6px 12px 8px');
        formView.el.appendChild(titleInput.el);
        formView.el.appendChild(descTa.el);
        formView.el.appendChild(colorRow.el);
        formView.el.appendChild(btnRow.el);
        children.push(formView);
      }

      // Items list
      if (!items.length && !window._heatmapPopoverAddForm) {
        children.push(Text('No activity').styles({padding:'6px 12px', color:'var(--nr-text-quaternary)'}));
      } else {
        items.forEach(function(item) {
          const ico = typeIcons[item.type] || '';
          const colorDot = item.type === 'event' && item.color
            ? RawHTML('<span style="width:8px;height:8px;border-radius:50%;background:' + item.color + ';flex-shrink:0"></span>')
            : RawHTML('<span style="flex-shrink:0">' + ico + '</span>');
          const titleText = Text(item.title).truncate().flex(1);
          const tagText = Text(typeLabels[item.type] || '').styles({fontSize:'9px', color:'var(--nr-text-quaternary)', marginLeft:'4px'});
          const rowChildren = [colorDot, titleText, tagText];
          if (item.type === 'event' && item.id) {
            const delBtn = new View('button');
            delBtn.el.innerHTML = '&times;';
            delBtn.el.title = 'Delete event';
            delBtn.cssText('background:none;border:none;color:var(--nr-text-quaternary);cursor:pointer;padding:0 2px;font-size:14px;line-height:1;flex-shrink:0');
            (function(eventId) {
              delBtn.onTap(function(e) { e.stopPropagation(); _heatmapDeleteEvent(eventId, key); });
            })(item.id);
            rowChildren.push(delBtn);
          }
          const row = HStack.apply(null, rowChildren).spacing(1)
            .styles({padding:'4px 12px', color:'var(--nr-text-primary)'}).className('hover:bg-hover');
          if (item.type === 'saved' && item.link) {
            row.cursor();
            (function(link) {
              row.onTap(function(e) { openSavedPaper(link, e); });
            })(item.link);
          }
          children.push(row);
        });
      }

      const view = VStack.apply(null, children);
      pop.innerHTML = '';
      pop.appendChild(view.build());
    };

    window._heatmapAddEvent = async function(key) {
      const title = document.getElementById('hm-ev-title')?.value.trim();
      if (!title) return;
      const desc = document.getElementById('hm-ev-desc')?.value.trim() || '';
      const colorEl = document.querySelector('input[name="hm-ev-color"]:checked');
      const color = colorEl ? colorEl.value : '#b4451a';
      await addCalendarEvent({ title, description: desc, date: key, color });
      (window._heatmapItems[key] ||= []).push({ type: 'event', title, id: calendarEvents[calendarEvents.length - 1]?.id, color, description: desc });
      window._heatmapPopoverAddForm = false;
      window._renderHeatmapPopover(key);
    };

    window._heatmapDeleteEvent = async function(id, key) {
      await deleteCalendarEvent(id);
      if (window._heatmapItems[key]) {
        window._heatmapItems[key] = window._heatmapItems[key].filter(item => item.id !== id);
      }
      window._renderHeatmapPopover(key);
    };

    // Close popover on click outside
    pop.addEventListener('click', e => { e.stopPropagation(); });
    document.addEventListener('click', e => {
      if (!e.target.closest('.heatmap-cell') && !e.target.closest('#heatmap-popover')) {
        pop.style.display = 'none';
      }
    });
  });

  // ── Reading list ──
  const savedEntries = Object.values(mergedSaved).sort((a, b) => b.savedAt - a.savedAt);
  const READING_LIST_LIMIT = 10;
  const displayedSaved = savedEntries.slice(0, READING_LIST_LIMIT);
  const hasMoreSaved = savedEntries.length > READING_LIST_LIMIT;
  const _renderSavedRow = (entry) => {
    const p = entry.paper;
    if (!p || !p.link) return null;
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
    const faviconHtml = favicon
      ? '<img src="' + escapeAttr(favicon) + '" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">'
      : pixelFallback;
    const rp = entry.readProgress;
    const progressHtml = rp ? '<div style="height:2px;margin-top:2px;background:var(--nr-border-default);border-radius:1px;overflow:hidden"><div style="width:' + Math.round(rp * 100) + '%;height:100%;background:var(--nr-accent);border-radius:1px"></div></div>' : '';

    const hostnameView = hostname ? Text(hostname).className('text-[0.7rem] text-dimmer truncate') : null;
    const progressView = rp ? RawHTML(progressHtml) : null;
    const contentCol = VStack(
      Text(p.title).className('text-[0.82rem] text-primary truncate'),
      hostnameView,
      progressView
    ).className('flex-1 min-w-0').onTap(function(e) { openSavedPaper(p.link, e); });

    const ratingHtml = getPaperRating(p.link) > 0 ? renderStarRating(p.link, { size: 'sm', interactive: false }) : '';
    const cached = isPostCached(p.link);
    const offlineBtn = RawHTML('<button class="dash-offline shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none' + (cached ? ' cached' : '') + '" title="' + (cached ? 'Saved offline' : 'Save offline') + '">' + (cached ? _offlineCachedIcon() : _offlineDownloadIcon()) + '</button>');
    offlineBtn.el.firstChild.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!isPostCached(p.link)) cachePostOffline(p.link, p, offlineBtn.el.firstChild);
    });

    const delBtn = new View('button');
    delBtn.className('dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none');
    delBtn.styles({ color: 'var(--nr-text-quaternary)', fontSize: '1rem' });
    delBtn.el.textContent = '\u00d7';
    delBtn.el.title = 'Remove';
    delBtn.onTap(function() { dashRemoveSaved(p.link); });

    const row = HStack(
      RawHTML(faviconHtml),
      contentCol,
      ratingHtml ? RawHTML('<span class="shrink-0">' + ratingHtml + '</span>') : null,
      offlineBtn,
      delBtn
    ).className('dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors' + (entry.read ? ' opacity-50' : ''));

    return row;
  };
  let readingView;
  if (displayedSaved.length) {
    const savedRows = displayedSaved.map(_renderSavedRow).filter(Boolean);
    const readingContainer = VStack(savedRows);
    if (hasMoreSaved) {
      const viewAllBtn = Button('View all ' + savedEntries.length + ' saved posts').ghost()
        .className('text-[0.78rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer mt-2 px-2')
        .onTap(function() { openAllSaved(); });
      readingContainer.el.appendChild(viewAllBtn.build());
    }
    readingView = readingContainer;
  } else {
    readingView = Text('No saved posts').className('text-[0.8rem] text-dimmer px-2');
  }

  // Task priority colors/labels (used in bento grid)
  const _priColors = { high: '#f87171', medium: '#fbbf24', low: '#6ee7b7' };
  const _priLabels = { high: 'High', medium: 'Med', low: 'Low' };

  // ── Profile header ──
  const _pAccent = profile.accent_color || '#b4451a';
  const _pJoinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';

  // Background banner
  const bgBanner = new View('div');
  bgBanner.className('relative rounded-xl overflow-hidden mb-6 ' + (profile.profile_bg ? '' : 'nr-living-gradient'));
  bgBanner.styles({
    minHeight: '120px',
    background: profile.profile_bg
      ? "url('" + escapeAttr(profile.profile_bg) + "') center/cover no-repeat"
      : 'linear-gradient(135deg, ' + _pAccent + '33, ' + _pAccent + '11)'
  });
  const bgGrad = new View('div');
  bgGrad.styles({ position: 'absolute', bottom: '0', left: '0', right: '0', height: '60px', background: 'linear-gradient(to top,var(--nr-bg-body),transparent)' });
  bgBanner.el.appendChild(bgGrad.build());
  const bgBtn = new View('button');
  bgBtn.className('absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 text-white/70 hover:text-white border-none cursor-pointer transition-colors');
  bgBtn.el.title = 'Change background';
  bgBtn.el.innerHTML = icon('camera', {class: 'w-3.5 h-3.5'});
  bgBtn.onTap(function() { _uploadProfileBg(); });
  bgBanner.el.appendChild(bgBtn.build());

  // Avatar
  const avatarHtml = profile.picture
    ? '<img src="' + escapeAttr(profile.picture) + '" class="w-16 h-16 rounded-full border-[3px]" style="border-color:var(--nr-bg-body)" referrerpolicy="no-referrer" />'
    : '<div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-[3px]" style="border-color:var(--nr-bg-body);background:' + _pAccent + '33;color:' + _pAccent + '">' + escapeHtml((profile.username || (_authUserInfo && _authUserInfo.username) || '?')[0].toUpperCase()) + '</div>';
  const avatarGroup = RawHTML('<div class="relative group">' + avatarHtml + '<button class="absolute inset-0 w-full h-full rounded-full bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none" title="Change picture">' + icon('camera', {size: 20, class: 'w-5 h-5 text-white'}) + '</button></div>');
  avatarGroup.el.querySelector('button').addEventListener('click', function() { _uploadProfilePic(); });

  // Status display
  const statusPetHtml = profile.status_emoji ? '<canvas id="dash-status-pet" width="18" height="18" class="shrink-0" style="image-rendering:pixelated"></canvas>' : '';
  const statusTextHtml = profile.status_text
    ? '<span class="text-dim text-[0.78rem]">' + escapeHtml(profile.status_text) + '</span>'
    : '<span class="text-dimmest text-[0.72rem] italic">Set status...</span>';
  const statusDisplay = RawHTML('<span id="dash-status-display" class="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity" title="Click to set status">' + statusPetHtml + statusTextHtml + '</span>');
  statusDisplay.el.firstChild.addEventListener('click', function() { _openStatusPicker(); });

  const joinDateView = _pJoinDate ? Text('Joined ' + _pJoinDate).className('text-dimmer text-[0.78rem] mt-0.5') : null;

  const profileInfoCol = VStack(
    HStack(
      Text(profile.username || (_authUserInfo && _authUserInfo.username) || '').className('text-[1.3rem] font-semibold text-white_'),
      RawHTML('<div class="w-2.5 h-2.5 rounded-full" style="background:#22c55e;box-shadow:0 0 4px #22c55e80" title="Online"></div>')
    ).spacing('8px'),
    HStack(statusDisplay).spacing('6px').className('mt-1'),
    joinDateView
  );

  const settingsBtn = RawHTML('<button class="w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors" title="Settings">' + icon('settings', {size: 16, class: 'w-4 h-4'}) + '</button>');
  settingsBtn.el.firstChild.addEventListener('click', function() { openSettings(); });

  const profileRow = HStack(
    avatarGroup,
    profileInfoCol,
    VStack(settingsBtn).className('ml-auto')
  ).className('flex items-center gap-4 mb-6 -mt-12 relative z-10 px-2');

  const statusPicker = new View('div');
  statusPicker.id('dash-status-picker').className('hidden mb-4');

  // Profile counters
  function _counterView(count, label) {
    return HStack(
      Text(String(count || 0)).fontWeight('600'),
      Text('\u00a0' + label).className('text-dimmer')
    );
  }
  const countersRow = HStack(
    _counterView(profile.comment_count, 'comments'),
    _counterView(profile.repost_count, 'reposts'),
  ).className('flex gap-6 mb-6 text-[0.82rem]');

  const greetingView = Text(getGreeting()).className('text-[0.95rem] font-medium text-dimmer mb-4');

  const profileHeaderView = VStack(bgBanner, profileRow, statusPicker, countersRow, greetingView);

  // ── Bento layout data ──
  const _papersRead = _dashPapersReadRecent();
  const _savedCount = Object.keys(mergedSaved).length;
  const _projectCount = 0;
  const _trending = _dashTrending(5);

  // Comments card view
  const _bentoCommentsView = myComments.length ? VStack(myComments.slice(0, 4).map(function(c) {
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
    const preview = (c.content || '').length > 80 ? c.content.slice(0, 80) + '...' : c.content;
    const link = new View('a');
    link.el.href = '#paper/' + encodeURIComponent(c.paperLink);
    link.className('block px-2 py-1.5 rounded-md hover:bg-hover transition-colors');
    link.styles({ textDecoration: 'none' });
    const inner = VStack(
      Text(preview).className('text-[0.75rem] text-primary leading-snug truncate'),
      Text(timeAgo).className('text-dimmest text-[0.65rem] mt-0.5')
    );
    link.el.appendChild(inner.build());
    return link;
  })) : null;

  // Reposts card view
  const _bentoRepostsView = myReposts.length ? VStack(myReposts.slice(0, 4).map(function(r) {
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
    const link = new View('a');
    link.el.href = '#view/' + encodeURIComponent(r.paperLink);
    link.className('flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover transition-colors');
    link.styles({ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' });
    const inner = HStack(
      RawHTML(icon('repost', {size: 12, class: 'w-3 h-3 text-green-400 shrink-0'})),
      Text(r.paperTitle || r.paperLink).className('text-[0.75rem] text-primary truncate flex-1'),
      Text(timeAgo).className('text-[0.65rem] text-dimmest shrink-0')
    );
    link.el.appendChild(inner.build());
    return link;
  })) : null;

  // Bottom row: only show if there's content
  const _hasBottomRow = myComments.length || myReposts.length;

  // Helper to wrap a view in a bento card
  function _bentoCard(view, cls) {
    const card = new View('div');
    card.className('nr-card ' + cls);
    card._appendChildren([view]);
    return card;
  }

  // Card header helper
  function _cardHeader(title, right) {
    return HStack(
      Text(title).className('text-[0.82rem] font-semibold text-primary'),
      Spacer(),
      right
    ).className('mb-2');
  }

  // ── Build bento grid ──
  const bentoGrid = new View('div');
  bentoGrid.className('bento-grid');

  // Daily Overview (3x1)
  bentoGrid.el.appendChild(_bentoCard(overviewView, 'bento-3x1').build());

  // Quick Actions (1x1)
  const qaCard = _bentoCard(_dashBuildQuickActions(), 'bento-1x1');
  qaCard.styles({ padding: '10px' });
  bentoGrid.el.appendChild(qaCard.build());

  // Inbox (2x1) — conditional
  if (inboxView) {
    bentoGrid.el.appendChild(_bentoCard(inboxView, 'bento-2x1').build());
  }

  // Activity Heatmap (4x1)
  const heatmapCard = new View('div');
  heatmapCard.className('nr-card bento-4x1');
  const heatmapHeader = _cardHeader('Activity', Text(String(now.getFullYear())).className('text-[0.68rem] text-dimmest'));
  heatmapCard.el.appendChild(heatmapHeader.build());
  const heatmapWrap = RawHTML(heatmapHtml);
  heatmapCard.el.appendChild(heatmapWrap.build());
  const popoverView = new View('div').attr('id', 'heatmap-popover');
  popoverView.cssText('display:none;position:fixed;z-index:10001;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;padding:8px 0;min-width:220px;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:12px');
  const popoverEl = popoverView.el;
  heatmapCard.el.appendChild(popoverEl);
  bentoGrid.el.appendChild(heatmapCard.build());

  // Trending
  const trendCard = _bentoCard(VStack(
    _cardHeader('Trending', null),
    _dashBuildTrendingCard(_trending)
  ), 'bento-4x1');
  bentoGrid.el.appendChild(trendCard.build());

  // Reading List (2x2)
  const readingScroll = VStack(readingView).className('scrollbar-hide').styles({maxHeight:'320px', overflowY:'auto'});
  const readingCard = _bentoCard(VStack(
    _cardHeader('Reading List', Text(String(savedEntries.length)).className('text-[0.68rem] text-dimmest')),
    readingScroll
  ), 'bento-2x2');
  bentoGrid.el.appendChild(readingCard.build());

  // Bottom row: comments, reposts
  if (myComments.length || myReposts.length) {
    if (myComments.length) {
      const commentsCls = !myReposts.length ? 'bento-4x1' : 'bento-2x1';
      const commentsCard = _bentoCard(VStack(
        _cardHeader('Recent Comments', Text(String(myComments.length)).className('text-[0.68rem] text-dimmest')),
        _bentoCommentsView
      ), commentsCls);
      bentoGrid.el.appendChild(commentsCard.build());
    }
    if (myReposts.length) {
      const repostsCls = !myComments.length ? 'bento-4x1' : 'bento-2x1';
      const repostsCard = _bentoCard(VStack(
        _cardHeader('Reposts', Text(String(myReposts.length)).className('text-[0.68rem] text-dimmest')),
        _bentoRepostsView
      ), repostsCls);
      bentoGrid.el.appendChild(repostsCard.build());
    }
  }

  // ── Mount the full dashboard view ──
  const dashView = VStack(profileHeaderView, _dashBuildStatsRow(_papersRead, _savedCount, _projectCount), bentoGrid);
  AetherUI.mount(dashView, container);

  document.removeEventListener('mousedown', _closeDashSearch);
  document.addEventListener('mousedown', _closeDashSearch);

  // Render status pet thumbnail if set
  if (profile.status_emoji && typeof _renderPetThumb === 'function') {
    const petCanvas = document.getElementById('dash-status-pet');
    if (petCanvas) {
      const thumb = _renderPetThumb(profile.status_emoji, 18);
      if (thumb) {
        const ctx = petCanvas.getContext('2d');
        ctx.drawImage(thumb, 0, 0);
      }
    }
  }

  // ── Snapshot stats into living context (hourly) ──
  if (typeof contextIngest === 'function') {
    const _statsItems = [];
    if (_todayActivity.length) _statsItems.push(_todayActivity.length + ' activities');
    if (_unreadSavedCount) _statsItems.push(_unreadSavedCount + ' unread saved');
    // Fetch context file size and include in stats
    electronAPI.dbQuery('context-list').then(function(res) {
      const mainFile = (res.files || []).find(function(f) { return f.file_id === 'main.md' || f.filePath === 'main.md'; });
      const kb = mainFile ? (mainFile.char_count / 1024).toFixed(1) : '0';
      _statsItems.push(kb + ' KB context');
      if (_statsItems.length) {
        contextIngest('dashboard', '## Stats', '- ' + _statsItems.join(', '),
          { dedupeKey: 'dash-' + Math.floor(Date.now() / 3600000) });
      }
    }).catch(function() {
      if (_statsItems.length) {
        contextIngest('dashboard', '## Stats', '- ' + _statsItems.join(', '),
          { dedupeKey: 'dash-' + Math.floor(Date.now() / 3600000) });
      }
    });
  }

  // ── LLM daily summary (async, streamed) ──
  const _summaryModel = Settings.get('summaryModel') || 'qwen3:0.6b';
  const summaryEl = document.getElementById('dash-day-summary');
  if (summaryEl && _summaryModel && _summaryModel !== 'off') {
    // Cache key: date + interaction count + task/unread counts
    const _sumCacheKey = `${_todayKey}:${_llmActivityData.length}:${_unreadSavedCount}`;
    const _sumCache = Settings.getJSON('daySummaryCache', {});
    if (_sumCache.key === _sumCacheKey && _sumCache.text) {
      summaryEl.textContent = _sumCache.text;
    } else {
      _streamDaySummary(summaryEl, _llmActivityData, 0, _unreadSavedCount, _todayDateStr, _summaryModel, _sumCacheKey);
    }
  } else if (summaryEl) {
    summaryEl.remove();
  }
}

// ── LLM Day Summary ──

export let _dashSummaryAbort = null;

export async function _streamDaySummary(el, activityLines, openTasks, unreadCount, dateStr, model, cacheKey) {
  // Abort any in-flight summary
  if (_dashSummaryAbort) { try { _dashSummaryAbort.abort(); } catch(e) {} }
  _dashSummaryAbort = new AbortController();

  const name = (_authUserInfo && (_authUserInfo.name || '').split(' ')[0]) || Settings.get('userName') || 'there';
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  let activityBlock = '';
  if (activityLines.length) {
    activityBlock = 'Here is what they did today:\n' + activityLines.join('\n');
  } else {
    activityBlock = 'They have no logged activity yet today.';
  }

  const extras = [];
  if (openTasks) extras.push(`${openTasks} open task${openTasks > 1 ? 's' : ''}`);
  if (unreadCount) extras.push(`${unreadCount} unread saved paper${unreadCount > 1 ? 's' : ''}`);
  const extrasBlock = extras.length ? '\nThey also have: ' + extras.join(', ') + '.' : '';

  const prompt = `It is ${timeOfDay} on ${dateStr}. The user's name is ${name}. ${activityBlock}${extrasBlock}

Write a brief, friendly 1-2 sentence summary of their day so far. Be warm and concise. Reference specific things they did (papers, searches, comments). If they have no activity, give a short encouraging note about the day ahead. Do not use emoji. Do not greet them.`;

  try {
    islandUpdate('ai-summary', { type: 'ai', label: model || 'default', detail: 'Day summary \u00B7 ' + (model || 'default') });
    const result = await apiPost('/api/doc-chat', {
      messages: [{ role: 'user', content: prompt }],
      model: model
    });

    let text = '';
    if (result && result._stream) {
      await new Promise((resolve) => {
        const handler = (_ev, sid, evt) => {
          if (sid !== result.sessionId) return;
          if (evt.event === 'token') {
            text += (evt.data || '');
            el.textContent = text;
          } else if (evt.event === 'done' || evt.event === 'error') {
            window.electronAPI.removeDocChatEventListener(handler);
            resolve();
          }
        };
        window.electronAPI.onDocChatEvent(handler);
        if (_dashSummaryAbort) {
          _dashSummaryAbort.signal.addEventListener('abort', () => {
            window.electronAPI.removeDocChatEventListener(handler);
            resolve();
          });
        }
      });
    }
    islandRemove('ai-summary');
    if (!text.trim()) {
      el.textContent = '';
    } else if (cacheKey) {
      Settings.setJSON('daySummaryCache', { key: cacheKey, text: text.trim() });
    }
  } catch (e) {
    islandRemove('ai-summary');
    el.textContent = '';
  }
}

// ── Status Picker ──

export let _dashStatusProfile = null;

export function _openStatusPicker() {
  const picker = document.getElementById('dash-status-picker');
  if (!picker) return;
  if (!picker.classList.contains('hidden')) { picker.classList.add('hidden'); return; }

  const petTypes = (typeof _PET_TYPE_KEYS !== 'undefined') ? _PET_TYPE_KEYS : ['cat','dog','bunny','froog','blackCat','poodle','pacman'];
  const currentEmoji = _dashStatusProfile ? (_dashStatusProfile.status_emoji || '') : '';
  const currentText = _dashStatusProfile ? (_dashStatusProfile.status_text || '') : '';

  picker.classList.remove('hidden');

  // None option
  const noneOpt = new View('div');
  noneOpt.className('w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center text-dimmer text-sm ' + (!currentEmoji ? 'border-accent bg-accent/10' : 'border-border-card hover:border-accent/40'));
  noneOpt.attr('data-pet', '');
  noneOpt.el.innerHTML = '&mdash;';
  noneOpt.el.title = 'None';
  noneOpt.onTap(function() { _selectStatusPet(noneOpt.el); });

  // Pet options
  const petOpts = petTypes.map(function(t) {
    const opt = new View('div');
    opt.className('w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center ' + (currentEmoji === t ? 'border-accent bg-accent/10' : 'border-border-card hover:border-accent/40'));
    opt.attr('data-pet', t);
    opt.el.title = t;
    opt.el.innerHTML = '<canvas width="24" height="24" class="status-pet-thumb" data-type="' + t + '" style="image-rendering:pixelated"></canvas>';
    opt.onTap(function() { _selectStatusPet(opt.el); });
    return opt;
  });

  const petGrid = HStack([noneOpt].concat(petOpts)).spacing('8px').id('status-pet-grid').className('mb-3');

  const textInput = TextField(currentText, 'What are you up to?');
  textInput.id('status-text-input');
  textInput.el.maxLength = 80;
  textInput.className('w-full bg-input border border-border-input rounded-lg px-3 py-2 text-primary text-[0.82rem] outline-none focus:border-accent mb-3');

  const saveBtn = Button('Save').onTap(function() { _saveStatus(); })
    .className('px-3 py-1.5 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors');
  const clearBtn = Button('Clear').onTap(function() { _clearStatus(); })
    .className('px-3 py-1.5 rounded-md text-[0.78rem] bg-transparent text-dimmer border border-border-card cursor-pointer hover:text-primary hover:border-accent/40 transition-colors');
  const cancelBtn = Button('Cancel').onTap(function() { document.getElementById('dash-status-picker').classList.add('hidden'); })
    .className('px-3 py-1.5 rounded-md text-[0.78rem] bg-transparent text-dimmer border-none cursor-pointer hover:text-primary transition-colors ml-auto');

  const pickerContent = VStack(
    Text('Pick a pet').className('text-[0.78rem] text-dimmer font-medium mb-2'),
    petGrid,
    textInput,
    HStack(saveBtn, clearBtn, cancelBtn).spacing('8px')
  ).className('p-4 rounded-lg border border-border-card bg-card');

  AetherUI.mount(pickerContent, picker);

  // Render pet thumbnails
  if (typeof _renderPetThumb === 'function') {
    picker.querySelectorAll('.status-pet-thumb').forEach(function(c) {
      const thumb = _renderPetThumb(c.dataset.type, 24);
      if (thumb) c.getContext('2d').drawImage(thumb, 0, 0);
    });
  }
}

export function _selectStatusPet(el) {
  const grid = document.getElementById('status-pet-grid');
  if (!grid) return;
  grid.querySelectorAll('[data-pet]').forEach(d => {
    d.classList.remove('border-accent', 'bg-accent/10');
    d.classList.add('border-border-card');
  });
  el.classList.remove('border-border-card');
  el.classList.add('border-accent', 'bg-accent/10');
}

export async function _saveStatus() {
  const grid = document.getElementById('status-pet-grid');
  const selected = grid?.querySelector('.border-accent[data-pet]');
  const emoji = selected?.dataset.pet || '';
  const text = (document.getElementById('status-text-input')?.value || '').trim().slice(0, 80);
  try {
    const data = await apiPut('/api/users/me/status', { emoji, text });
    if (data.achievement) {
      if (typeof petCelebrate === 'function') petCelebrate();
      showAchievement(data.achievement.name, data.achievement.description);
    }
    document.getElementById('dash-status-picker')?.classList.add('hidden');
    renderDashboard();
  } catch (e) { console.error('Save status error', e); }
}

export async function _clearStatus() {
  try {
    await apiPut('/api/users/me/status', { emoji: '', text: '' });
    document.getElementById('dash-status-picker')?.classList.add('hidden');
    renderDashboard();
  } catch (e) { console.error('Clear status error', e); }
}

// ── All Saved Posts view ──
export async function openAllSaved() {
  hideAllViews();
  const view = await ensureView('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'saved-all';
  setSidebarActive('sb-dashboard');
  const container = document.getElementById('dashboard-content');
  const saved = getSavedPosts();
  const entries = Object.values(saved).sort(function(a, b) { return b.savedAt - a.savedAt; });

  const backBtn = HStack(
    RawHTML(icon('backArrow', {size: 16, class: 'w-4 h-4 mr-1.5'})),
    Text('Back').className('text-[0.82rem]')
  ).className('bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center hover:text-primary shrink-0 mb-4')
   .onTap(function() { openDashboard(); });

  const titleView = RawHTML('<h2 class="text-[1.3rem] font-semibold text-white_ mb-4">Reading List <span class="text-dim font-normal text-[0.9rem]">(' + entries.length + ')</span></h2>');

  let rowViews;
  if (entries.length) {
    rowViews = entries.map(function(entry) {
      const p = entry.paper;
      const hostname = p.hostname || (function() { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch(e) { return ''; } })();
      const favicon = p.favicon || (function() { try { return new URL(p.link).origin + '/favicon.ico'; } catch(e) { return ''; } })();
      const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
      const faviconHtml = favicon
        ? '<img src="' + escapeAttr(favicon) + '" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=' + escapeAttr(JSON.stringify(pixelFallback)) + '">'
        : pixelFallback;
      const dateStr = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const rp = entry.readProgress;
      const progressHtml = rp ? '<div style="height:2px;margin-top:2px;background:var(--nr-border-default);border-radius:1px;overflow:hidden"><div style="width:' + Math.round(rp * 100) + '%;height:100%;background:var(--nr-accent);border-radius:1px"></div></div>' : '';

      const contentCol = VStack(
        Text(p.title).className('text-[0.82rem] text-primary truncate'),
        hostname ? Text(hostname).className('text-[0.7rem] text-dimmer truncate') : null,
        rp ? RawHTML(progressHtml) : null
      ).className('flex-1 min-w-0').onTap(function(e) { openSavedPaper(p.link, e); });

      const ratingHtml = getPaperRating(p.link) > 0 ? renderStarRating(p.link, { size: 'sm', interactive: false }) : '';
      const cached = isPostCached(p.link);
      const offlineBtn = RawHTML('<button class="dash-offline shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none' + (cached ? ' cached' : '') + '" title="' + (cached ? 'Saved offline' : 'Save offline') + '">' + (cached ? _offlineCachedIcon() : _offlineDownloadIcon()) + '</button>');
      offlineBtn.el.firstChild.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!isPostCached(p.link)) cachePostOffline(p.link, p, offlineBtn.el.firstChild);
      });

      const delBtn = new View('button');
      delBtn.className('dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none');
      delBtn.styles({ color: 'var(--nr-text-quaternary)', fontSize: '1rem' });
      delBtn.el.textContent = '\u00d7';
      delBtn.el.title = 'Remove';
      delBtn.onTap(function(e) { e.stopPropagation(); dashRemoveSaved(p.link); openAllSaved(); });

      return HStack(
        RawHTML(faviconHtml),
        contentCol,
        ratingHtml ? RawHTML('<span class="shrink-0">' + ratingHtml + '</span>') : null,
        dateStr ? Text(dateStr).className('text-[0.68rem] text-dimmest shrink-0') : null,
        offlineBtn,
        delBtn
      ).className('dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors' + (entry.read ? ' opacity-50' : ''));
    });
  } else {
    rowViews = [Text('No saved posts').className('text-[0.8rem] text-dimmer px-2')];
  }

  const allSavedView = VStack([backBtn, titleView].concat(rowViews));
  AetherUI.mount(allSavedView, container);
}

// ── Dev Stats ──

export let _devFpsRaf = null;

export var _devChartId = 0;
export var _devChartRegistry = [];

// Dev panel navigation structure
export const DEV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'function-registry', label: 'Function Registry' },
  { id: 'feed-validator', label: 'Feed Validator' },
  { id: 'load-order', label: 'Load Order' },
  { id: 'dependency-graph', label: 'Dependency Graph' },
  { id: 'git-log', label: 'Git Log' },
  { id: 'tools', label: 'Dev Tools' }
];

export var _devActiveSection = null;
export var _devD3Loaded = false;
export var _devGraphLevel = 'file'; // 'file' or 'function'
export var _devGraphData = null;

export function _devLineChart(hist, yKey, label, color, tooltipFn) {
  if (!hist || hist.length < 2) return `<div class="text-sm mt-4" style="color:var(--nr-text-quaternary)">Not enough data for ${label}</div>`;
  const id = '_dchart_' + (_devChartId++);
  const W = 400, H = 130, PAD = { t: 16, r: 12, b: 24, l: 42 };
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;
  const vals = hist.map(h => typeof yKey === 'function' ? yKey(h) : h[yKey]);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  function xp(i) { return PAD.l + (i / (hist.length - 1)) * cw; }
  function yp(v) { return PAD.t + ch - ((v - minV) / range) * ch; }
  const gridColor = 'rgba(255,255,255,0.06)';
  const textColor = 'var(--nr-text-quaternary)';
  let svg = `<text x="${PAD.l}" y="11" fill="${textColor}" font-size="9" font-weight="600">${label}</text>`;
  const yTicks = 3;
  for (let i = 0; i <= yTicks; i++) {
    const val = minV + (range / yTicks) * i;
    const yy = yp(val);
    svg += `<line x1="${PAD.l}" y1="${yy}" x2="${W - PAD.r}" y2="${yy}" stroke="${gridColor}"/>`;
    svg += `<text x="${PAD.l - 4}" y="${yy + 3}" text-anchor="end" fill="${textColor}" font-size="8">${Math.round(val).toLocaleString()}</text>`;
  }
  // Area fill
  const pts = hist.map((h, i) => `${xp(i)},${yp(vals[i])}`);
  const areaPts = [`${xp(0)},${PAD.t + ch}`, ...pts, `${xp(hist.length - 1)},${PAD.t + ch}`].join(' ');
  svg += `<polygon points="${areaPts}" fill="${color}" opacity="0.07"/>`;
  // Line
  svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
  // Static dots
  hist.forEach((h, i) => {
    svg += `<circle cx="${xp(i)}" cy="${yp(vals[i])}" r="2" fill="${color}"/>`;
  });
  // Crosshair line + hover dot (hidden by default)
  svg += `<line id="${id}-vline" x1="0" y1="${PAD.t}" x2="0" y2="${PAD.t + ch}" stroke="${color}" stroke-width="1" stroke-dasharray="3,2" opacity="0.5" style="display:none"/>`;
  svg += `<circle id="${id}-hdot" cx="0" cy="0" r="4" fill="${color}" stroke="var(--nr-bg-body)" stroke-width="1.5" style="display:none"/>`;
  // Invisible hover rect
  svg += `<rect x="${PAD.l}" y="${PAD.t}" width="${cw}" height="${ch}" fill="transparent" style="cursor:crosshair" id="${id}-hover"/>`;
  // X labels
  const step = Math.max(1, Math.floor(hist.length / 5));
  for (let i = 0; i < hist.length; i += step) {
    svg += `<text x="${xp(i)}" y="${H - 3}" text-anchor="middle" fill="${textColor}" font-size="7">${hist[i].date.slice(5)}</text>`;
  }
  // Store chart data for binding
  _devChartRegistry.push({ id, hist, vals, color, tooltipFn, W, H, PAD, cw, ch, minV, range, xp, yp });
  return `<div class="dev-chart-wrap" style="position:relative"><svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" id="${id}">${svg}</svg><div id="${id}-tip" class="dev-chart-tooltip"></div></div>`;
}

export function _devBindCharts() {
  _devChartRegistry.forEach(c => {
    const svg = document.getElementById(c.id);
    const tip = document.getElementById(c.id + '-tip');
    const vline = document.getElementById(c.id + '-vline');
    const hdot = document.getElementById(c.id + '-hdot');
    const hoverRect = document.getElementById(c.id + '-hover');
    if (!svg || !tip || !hoverRect) return;

    function nearest(mx) {
      const rect = svg.getBoundingClientRect();
      const svgX = (mx - rect.left) / rect.width * c.W;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < c.hist.length; i++) {
        const d = Math.abs(c.xp(i) - svgX);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }

    hoverRect.addEventListener('mousemove', e => {
      const i = nearest(e.clientX);
      const h = c.hist[i];
      const cx = c.xp(i), cy = c.yp(c.vals[i]);
      vline.setAttribute('x1', cx); vline.setAttribute('x2', cx);
      vline.style.display = '';
      hdot.setAttribute('cx', cx); hdot.setAttribute('cy', cy);
      hdot.style.display = '';
      const tipText = c.tooltipFn ? c.tooltipFn(h) : `${c.vals[i].toLocaleString()}`;
      const lines = tipText.split('\n');
      tip.innerHTML = `<div style="font-weight:600;margin-bottom:1px">${h.date.slice(5)}</div>` + lines.map(l => `<div>${l}</div>`).join('');
      tip.style.display = 'block';
      // Position tooltip relative to chart container
      const rect = svg.getBoundingClientRect();
      const pxX = (cx / c.W) * rect.width;
      const pxY = (cy / c.H) * rect.height;
      const tipW = tip.offsetWidth;
      const flip = pxX + tipW + 12 > rect.width;
      tip.style.left = flip ? (pxX - tipW - 8) + 'px' : (pxX + 10) + 'px';
      tip.style.top = Math.max(0, pxY - tip.offsetHeight / 2) + 'px';
    });
    hoverRect.addEventListener('mouseleave', () => {
      vline.style.display = 'none';
      hdot.style.display = 'none';
      tip.style.display = 'none';
    });
  });
}

export function _devRelativeTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString();
}

export function renderDevPanel() {
  if (_devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; }

  const sidebar = document.getElementById('dev-sidebar');
  const contentPane = document.getElementById('dev-content-pane');
  if (!sidebar || !contentPane) return;

  // Load active section from localStorage or default to 'overview'
  if (!_devActiveSection) {
    _devActiveSection = Settings.get('devPanelSection') || 'overview';
  }

  // Render sidebar navigation
  const sidebarView = VStack(DEV_SECTIONS.map(function(section) {
    const isActive = section.id === _devActiveSection;
    const item = Text(section.label)
      .styles({
        padding:'12px 16px',
        borderLeft:'3px solid ' + (isActive ? 'var(--nr-accent)' : 'transparent'),
        background: isActive ? 'var(--nr-bg-raised)' : 'transparent',
        color: isActive ? 'var(--nr-text-primary)' : 'var(--nr-text-secondary)',
        fontSize:'0.8rem',
        fontWeight: isActive ? '600' : '400',
        transition:'all var(--motion-fast) var(--motion-smooth)'
      }).cursor()
      .onTap(function() { _devNavigateTo(section.id); });
    if (!isActive) {
      item.onHover(
        function() { item.el.style.background = 'var(--nr-bg-raised)'; },
        function() { item.el.style.background = 'transparent'; }
      );
    }
    return item;
  }));
  AetherUI.mount(sidebarView, sidebar);

  // Render active section content
  renderDevSection(_devActiveSection);
}

export function _devNavigateTo(sectionId) {
  _devActiveSection = sectionId;
  Settings.set('devPanelSection', sectionId);
  renderDevPanel();
}

export function renderDevSection(sectionId) {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const renderers = {
    'overview': _renderDevOverview,
    'function-registry': _renderDevFunctionRegistry,
    'feed-validator': _renderDevFeedValidator,
    'load-order': _renderDevLoadOrder,
    'dependency-graph': _renderDevDependencyGraph,
    'git-log': _renderDevGitLog,
    'tools': _renderDevTools,
  };

  AetherUI.mount(Text('Loading\u2026').className('text-sm').foreground('quaternary'), contentPane);
  const render = renderers[sectionId];
  if (render) render();
  else AetherUI.mount(Text('Unknown section').className('text-sm').foreground('quaternary'), contentPane);
}

// ── Dev helpers ──

function _devStatCard(value, label, color) {
  return VStack(
    Text(String(value)).className('dev-stat-value').styles({ fontSize: '24px', color: color || 'var(--nr-text-primary)' }),
    Text(label).className('dev-stat-label').styles({ fontSize: '0.65rem' })
  ).className('dev-stat-card').styles({ padding: '12px' });
}

function _devStatGrid() {
  const items = Array.prototype.slice.call(arguments);
  return Grid.apply(null, items)
    .styles({ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '12px', marginTop: '8px' });
}

// ── Overview Section ──
export async function _renderDevOverview() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Project Health').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Real-time metrics and performance monitoring').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});
  const statsCards = new View('div');
  statsCards.className('dev-stats-cards').id('dev-stats-cards');
  const chartArea = new View('div');
  chartArea.id('dev-loc-chart');
  AetherUI.mount(VStack(header, statsCards, chartArea), contentPane);

  const cards = document.getElementById('dev-stats-cards');
  const chart = document.getElementById('dev-loc-chart');

  AetherUI.mount(Text('Loading\u2026').className('text-sm').foreground('quaternary'), cards);

  let data;
  try {
    data = await apiGet('/api/dev-stats');
    if (data.error) throw new Error(data.error);
  } catch (e) {
    AetherUI.mount(Text('Error: ' + e.message).className('text-sm').foreground('quaternary'), cards);
    return;
  }

  // Stat cards
  const stats = [
    { value: (data.project_age_days || 0) + 'd', label: 'Project Age' },
    { value: data.total_loc.toLocaleString(), label: 'Total Lines' },
    { value: data.files, label: 'Files' },
    { value: (data.total_commits || 0).toLocaleString(), label: 'Commits' },
    { value: '—', label: 'FPS', id: 'dev-fps-value' },
    { value: (data.ram_mb || 0) + ' MB', label: 'RAM' },
    { value: (data.project_mb || 0) + ' MB', label: 'Size' },
  ];
  const cardsView = HStack(stats.map(function(s) {
    const valView = Text(String(s.value)).className('dev-stat-value');
    if (s.id) valView.id(s.id);
    return VStack(valView, Text(s.label).className('dev-stat-label')).className('dev-stat-card');
  }));
  AetherUI.mount(cardsView, cards);

  // FPS counter
  const fpsEl = document.getElementById('dev-fps-value');
  if (fpsEl) {
    const frameTimes = [];
    let lastUpdate = performance.now();
    function fpsLoop(now) {
      frameTimes.push(now);
      while (frameTimes.length > 60) frameTimes.shift();
      if (now - lastUpdate > 500 && frameTimes.length > 1) {
        const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
        fpsEl.textContent = Math.round((frameTimes.length - 1) / (elapsed / 1000));
        lastUpdate = now;
      }
      _devFpsRaf = requestAnimationFrame(fpsLoop);
    }
    _devFpsRaf = requestAnimationFrame(fpsLoop);
  }

  _devChartId = 0;
  _devChartRegistry = [];

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b4451a';
  const hist = data.loc_history || [];

  // LOC chart
  const locChart = _devLineChart(hist, 'lines', 'Lines of Code', accent, h =>
    `${h.lines.toLocaleString()} lines\n<span style="color:#3fb950">+${(h.added || 0).toLocaleString()}</span> <span style="color:#f85149">-${(h.deleted || 0).toLocaleString()}</span>`
  );

  // Build usage history arrays from all available dates
  const usage = data.usage_history || {};
  const usageDates = Object.keys(usage).sort();
  const chartDates = usageDates.length >= 2 ? usageDates : hist.map(h => h.date);
  function usageSeries(eventName) {
    return chartDates.map(d => ({ date: d, count: (usage[d] && usage[d][eventName]) || 0 }));
  }
  const toolSeries = usageSeries('tool_call');
  const aetherSeries = usageSeries('aether_chat');

  const toolChart = _devLineChart(toolSeries, 'count', 'Tool Calls', '#6d9eeb', h => `${h.count} tool calls`);
  const aetherChart = _devLineChart(aetherSeries, 'count', 'Aether Chats', '#93c47d', h => `${h.count} aether chats`);

  const cpd = data.commits_per_day || [];
  const commitsChart = cpd.length >= 2 ? _devLineChart(cpd, 'count', 'Commits / Day', '#f6b26b', h => `${h.count} commits`) : '';

  AetherUI.mount(RawHTML('<div class="dev-charts-grid">' +
    '<div class="dev-loc-chart">' + locChart + '</div>' +
    '<div class="dev-loc-chart">' + commitsChart + '</div>' +
    '<div class="dev-loc-chart">' + toolChart + '</div>' +
    '<div class="dev-loc-chart">' + aetherChart + '</div>' +
  '</div>'), chart);
  _devBindCharts();
}

// ── Function Registry Section ──
export function _renderDevFunctionRegistry() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Function Registry').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Analyze global functions, duplicates, and unused code across all vanilla JS files.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const analyzeBtn = Button('Analyze Functions').className('dev-btn-primary').id('dev-fn-reg-btn').onTap(function() { _devRunFunctionRegistry(); });
  const reportBtn = Button('Open HTML Report').className('dev-btn-secondary').onTap(function() { _devOpenFunctionRegistryReport(); });
  const statusEl = Text('').id('dev-fn-reg-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controls = HStack(analyzeBtn, reportBtn, statusEl).gap('8px').wrap().styles({marginBottom:'16px'});
  const results = new View('div');
  results.id('dev-fn-reg-results');

  AetherUI.mount(VStack(header, controls, results), contentPane);
}

// ── Feed Validator Section ──
export function _renderDevFeedValidator() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Feed Catalog Validator').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Validate sync between JS (core.js) and Python (feed_catalog.py) feed catalogs.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const valBtn = Button('Run Validation').className('dev-btn-primary').id('dev-feed-val-btn').onTap(function() { _devRunFeedValidator(); });
  const statusEl = Text('').id('dev-feed-val-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controls = HStack(valBtn, statusEl).gap('8px').styles({marginBottom:'16px'});
  const results = new View('div');
  results.id('dev-feed-val-results');

  AetherUI.mount(VStack(header, controls, results), contentPane);
}

// ── Load Order Section ──
export function _renderDevLoadOrder() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Script Load Order').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Analyze script dependencies and detect forward references or circular dependencies.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const runBtn = Button('Run Analysis').className('dev-btn-primary').id('dev-load-ord-btn').onTap(function() { _devRunLoadOrderAnalysis(); });
  const statusEl = Text('').id('dev-load-ord-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controls = HStack(runBtn, statusEl).gap('8px').styles({marginBottom:'16px'});
  const results = new View('div');
  results.id('dev-load-ord-results');

  AetherUI.mount(VStack(header, controls, results), contentPane);
}

// ── Dependency Graph Section ──
export function _renderDevDependencyGraph() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Dependency Graph').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Interactive dependency visualization. Switch between file-level and function-level views.').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  // Controls Row 1
  const loadBtn = Button('Load Graph').className('dev-btn-primary').id('dev-dep-graph-btn').onTap(function() { _devLoadDependencyGraph(); });
  const fileToggle = Button('Files').id('dev-graph-level-file')
    .styles({background:'var(--nr-accent)', color:'#fff', border:'none', padding:'6px 14px', fontSize:'0.75rem', fontWeight:'600', transition:'all var(--motion-fast) var(--motion-smooth)'})
    .cursor().onTap(function() { _devSetGraphLevel('file'); });
  const funcToggle = Button('Functions').id('dev-graph-level-function')
    .styles({background:'transparent', color:'var(--nr-text-primary)', border:'none', padding:'6px 14px', fontSize:'0.75rem', transition:'all var(--motion-fast) var(--motion-smooth)'})
    .cursor().onTap(function() { _devSetGraphLevel('function'); });
  const toggleGroup = HStack(fileToggle, funcToggle)
    .styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'6px', overflow:'hidden'});
  const resetBtn = Button('Reset Zoom').className('dev-btn-secondary').id('dev-graph-reset-btn').visible(false)
    .onTap(function() { _devResetGraphZoom(); });
  const statusEl = Text('').id('dev-dep-graph-status').styles({color:'var(--nr-text-quaternary)', fontSize:'0.7rem'});
  const controlsRow1 = HStack(loadBtn, toggleGroup, resetBtn, statusEl)
    .gap('8px').styles({marginBottom:'12px'}).wrap();

  // Controls Row 2 (function view)
  const searchInput = new View('input');
  searchInput.id('dev-graph-search').className('dev-input');
  searchInput.el.type = 'text';
  searchInput.el.placeholder = 'Search functions...';
  searchInput.on('input', function() { _devGraphSearch(searchInput.el.value); });
  const fileFilter = new View('select');
  fileFilter.id('dev-graph-file-filter').className('dev-input');
  fileFilter.el.innerHTML = '<option value="">All Files</option>';
  fileFilter.onChange(function() { _devGraphFilterByFile(fileFilter.el.value); });
  const unusedCb = new View('input');
  unusedCb.el.type = 'checkbox';
  unusedCb.id('dev-graph-show-unused');
  unusedCb.onChange(function() { _devGraphToggleUnused(unusedCb.el.checked); });
  const unusedLabel = RawHTML('<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--nr-text-quaternary)"></label>');
  unusedLabel.el.firstChild.appendChild(unusedCb.build());
  unusedLabel.el.firstChild.appendChild(document.createTextNode('Show unused'));
  const controlsRow2 = HStack(searchInput, fileFilter, unusedLabel)
    .id('dev-graph-function-controls')
    .styles({display:'none', marginBottom:'12px'}).gap('8px').wrap();

  // Legend
  function _legendItem(color, radius, text) {
    return RawHTML('<div style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:' + radius + ';background:' + color + '"></span>' + text + '</div>');
  }
  const legend = HStack(
    _legendItem('#ef4444', '50%', 'Cross-file dependency'),
    _legendItem('var(--nr-text-quaternary)', '50%', 'Same-file dependency'),
    _legendItem('var(--nr-accent)', '2px', 'File group'),
    RawHTML('<div style="margin-left:8px">Click to expand/collapse</div>')
  ).gap('16px').styles({marginBottom:'12px', fontSize:'0.65rem', color:'var(--nr-text-quaternary)'}).wrap();

  // Graph container
  const graphContainer = new View('div');
  graphContainer.id('dev-dep-graph-container')
    .styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'6px', padding:'16px', maxHeight:'600px', overflowY:'auto', fontFamily:'monospace', fontSize:'12px', lineHeight:'1.6'});
  graphContainer.el.innerHTML = '<div style="color:var(--nr-text-quaternary)">Click "Load Graph" to start...</div>';

  AetherUI.mount(VStack(header, controlsRow1, controlsRow2, legend, graphContainer), contentPane);
}

export function _devSetGraphLevel(level) {
  _devGraphLevel = level;

  // Update button styles
  const fileBtn = document.getElementById('dev-graph-level-file');
  const funcBtn = document.getElementById('dev-graph-level-function');
  const funcControls = document.getElementById('dev-graph-function-controls');

  if (level === 'file') {
    fileBtn.style.background = 'var(--nr-accent)';
    fileBtn.style.color = '#fff';
    funcBtn.style.background = 'transparent';
    funcBtn.style.color = 'var(--nr-text-primary)';
    funcControls.style.display = 'none';
  } else {
    fileBtn.style.background = 'transparent';
    fileBtn.style.color = 'var(--nr-text-primary)';
    funcBtn.style.background = 'var(--nr-accent)';
    funcBtn.style.color = '#fff';
    funcControls.style.display = 'flex';
  }

  // Reload if data already loaded
  if (_devGraphData) {
    _devLoadDependencyGraph();
  }
}

export async function _devLoadDependencyGraph() {
  const btn = document.getElementById('dev-dep-graph-btn');
  const status = document.getElementById('dev-dep-graph-status');
  const container = document.getElementById('dev-dep-graph-container');

  if (!btn || !status || !container) return;

  btn.disabled = true;
  btn.textContent = 'Loading...';
  status.textContent = 'Generating graph data...';

  try {
    const data = await apiGet(`/api/dependency-graph?level=${_devGraphLevel}`);

    if (data.status === 'error') {
      status.textContent = 'Error: ' + data.message;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    _devGraphData = data;

    // Update file filter dropdown for function view
    if (_devGraphLevel === 'function') {
      const fileFilter = document.getElementById('dev-graph-file-filter');
      const files = [...new Set(data.nodes.map(n => n.file))].sort();
      fileFilter.innerHTML = '<option value="">All Files</option>' +
        files.map(f => `<option value="${f}">${f}</option>`).join('');
    }

    const nodeLabel = _devGraphLevel === 'file' ? 'files' : 'functions';
    status.textContent = `${data.nodes.length} ${nodeLabel}, ${data.edges.length} dependencies`;
    status.style.color = 'var(--nr-text-success, #22c55e)';

    // Render the tree
    if (_devGraphLevel === 'file') {
      _devRenderFileTree(data.nodes, data.edges);
    } else {
      _devRenderFunctionTree(data.nodes, data.edges);
    }

  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reload Graph';
  }
}

export var _devCollapsedFiles = new Set();

export function _devRenderFileTree(nodes, edges) {
  const container = document.getElementById('dev-dep-graph-container');
  if (!container) return;

  nodes.sort((a, b) => a.order - b.order);

  const deps = new Map();
  edges.forEach(e => {
    const src = e.source.id || e.source;
    const tgt = e.target.id || e.target;
    if (!deps.has(src)) deps.set(src, []);
    deps.get(src).push({ target: tgt, calls: e.calls });
  });

  const wrapper = new View('div');
  wrapper.cssText('color:var(--nr-text-primary)');

  const btnRow = new View('div');
  btnRow.cssText('margin-bottom:12px;display:flex;gap:8px');
  const expandBtn = new View('button');
  expandBtn.el.textContent = 'Expand All';
  expandBtn.cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer');
  expandBtn.onTap(function() { _devExpandAllFiles(); });
  const collapseBtn = new View('button');
  collapseBtn.el.textContent = 'Collapse All';
  collapseBtn.cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer');
  collapseBtn.onTap(function() { _devCollapseAllFiles(); });
  btnRow.el.appendChild(expandBtn.el);
  btnRow.el.appendChild(collapseBtn.el);
  wrapper.el.appendChild(btnRow.el);

  nodes.forEach(function(node, i) {
    const isLast = i === nodes.length - 1;
    const isCollapsed = _devCollapsedFiles.has(node.id);
    const nodeDeps = deps.get(node.id) || [];

    const nodeDiv = new View('div');
    nodeDiv.cssText('margin-bottom:4px');

    const toggleDiv = new View('div');
    toggleDiv.cssText('cursor:pointer');
    const arrowSpan = new View('span');
    arrowSpan.cssText('color:var(--nr-accent)');
    arrowSpan.el.textContent = isCollapsed ? '▶' : '▼';
    const nameSpan = new View('span');
    nameSpan.cssText('color:var(--nr-text-primary);font-weight:600');
    nameSpan.el.textContent = ' ' + node.id;
    const statsSpan = new View('span');
    statsSpan.cssText('color:var(--nr-text-quaternary);margin-left:12px;font-size:11px');
    statsSpan.el.textContent = node.functions + ' funcs, ' + node.loc + ' LOC';
    toggleDiv.el.appendChild(arrowSpan.el);
    toggleDiv.el.appendChild(nameSpan.el);
    toggleDiv.el.appendChild(statsSpan.el);
    (function(nodeId) { toggleDiv.onTap(function() { _devToggleFileInFileView(nodeId); }); })(node.id);
    nodeDiv.el.appendChild(toggleDiv.el);

    if (!isCollapsed && nodeDeps.length > 0) {
      const depsDiv = new View('div');
      depsDiv.cssText('margin-left:24px;color:var(--nr-text-quaternary);font-size:11px;margin-top:2px');
      nodeDeps.slice(0, 5).forEach(function(dep) {
        const depRow = new View('div');
        depRow.el.textContent = '→ ' + dep.target + ' ';
        const callsSpan = new View('span');
        callsSpan.cssText('opacity:0.7');
        callsSpan.el.textContent = '(' + dep.calls + '× calls)';
        depRow.el.appendChild(callsSpan.el);
        depsDiv.el.appendChild(depRow.el);
      });
      if (nodeDeps.length > 5) {
        const moreRow = new View('div');
        moreRow.el.textContent = '→ +' + (nodeDeps.length - 5) + ' more dependencies...';
        depsDiv.el.appendChild(moreRow.el);
      }
      nodeDiv.el.appendChild(depsDiv.el);
    }
    wrapper.el.appendChild(nodeDiv.el);

    if (!isLast) {
      const sep = new View('div');
      sep.cssText('color:var(--nr-border-default);margin-left:5px');
      sep.el.textContent = '│';
      wrapper.el.appendChild(sep.el);
    }
  });

  AetherUI.mount(wrapper, container);
}

export function _devToggleFileInFileView(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'file') {
    _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

export function _devExpandAllFiles() {
  _devCollapsedFiles.clear();
  if (_devGraphData) {
    if (_devGraphLevel === 'file') {
      _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
    } else {
      _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
    }
  }
}

export function _devCollapseAllFiles() {
  if (_devGraphData) {
    if (_devGraphLevel === 'file') {
      _devGraphData.nodes.forEach(n => _devCollapsedFiles.add(n.id));
      _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
    } else {
      _devGraphData.nodes.forEach(n => _devCollapsedFiles.add(n.file));
      _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
    }
  }
}

export function _devRenderFunctionTree(allNodes, allEdges) {
  const container = document.getElementById('dev-dep-graph-container');
  if (!container) return;

  const showUnused = document.getElementById('dev-graph-show-unused')?.checked || false;
  const fileFilter = document.getElementById('dev-graph-file-filter')?.value || '';

  const nodes = allNodes.filter(n => {
    if (fileFilter && n.file !== fileFilter) return false;
    if (!showUnused && n.callCount === 0) return false;
    return true;
  });

  const fileGroups = {};
  nodes.forEach(node => {
    if (!fileGroups[node.file]) fileGroups[node.file] = [];
    fileGroups[node.file].push(node);
  });

  // Default all files to collapsed on first render
  if (_devCollapsedFiles.size === 0) {
    Object.keys(fileGroups).forEach(file => _devCollapsedFiles.add(file));
  }

  const edges = allEdges.filter(e => {
    const src = nodes.find(n => n.id === e.source);
    const tgt = nodes.find(n => n.id === e.target);
    return src && tgt;
  });

  const deps = new Map();
  edges.forEach(e => {
    if (!deps.has(e.source)) deps.set(e.source, []);
    deps.get(e.source).push({ target: e.target, calls: e.calls });
  });

  const wrapper = new View('div');
  wrapper.cssText('color:var(--nr-text-primary)');

  const btnRow = new View('div');
  btnRow.cssText('margin-bottom:12px;display:flex;gap:8px');
  const expandBtn = new View('button');
  expandBtn.el.textContent = 'Expand All';
  expandBtn.cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer');
  expandBtn.onTap(function() { _devExpandAllFiles(); });
  const collapseBtn = new View('button');
  collapseBtn.el.textContent = 'Collapse All';
  collapseBtn.cssText('background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer');
  collapseBtn.onTap(function() { _devCollapseAllFiles(); });
  btnRow.el.appendChild(expandBtn.el);
  btnRow.el.appendChild(collapseBtn.el);
  wrapper.el.appendChild(btnRow.el);

  Object.keys(fileGroups).sort().forEach(function(file) {
    const isCollapsed = _devCollapsedFiles.has(file);
    const funcs = fileGroups[file];

    const fileDiv = new View('div');
    fileDiv.cssText('margin-bottom:8px');

    const fileHeader = new View('div');
    fileHeader.cssText('cursor:pointer;color:var(--nr-accent);font-weight:600;margin-bottom:4px');
    fileHeader.el.textContent = (isCollapsed ? '▶' : '▼') + ' \uD83D\uDCC1 ' + file + ' ';
    const funcCountSpan = new View('span');
    funcCountSpan.cssText('font-weight:normal;color:var(--nr-text-quaternary);font-size:11px');
    funcCountSpan.el.textContent = '(' + funcs.length + ' functions)';
    fileHeader.el.appendChild(funcCountSpan.el);
    (function(f) { fileHeader.onTap(function() { _devToggleFile(f); }); })(file);
    fileDiv.el.appendChild(fileHeader.el);

    if (!isCollapsed) {
      funcs.forEach(function(func, i) {
        const isLast = i === funcs.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const funcDeps = deps.get(func.id) || [];
        const crossFileDeps = funcDeps.filter(function(d) {
          const target = allNodes.find(function(n) { return n.id === d.target; });
          return target && target.file !== func.file;
        });

        const funcRow = new View('div');
        funcRow.cssText('margin-left:16px;margin-bottom:2px');

        const prefixSpan = new View('span');
        prefixSpan.cssText('color:var(--nr-border-default)');
        prefixSpan.el.textContent = prefix;
        funcRow.el.appendChild(prefixSpan.el);
        funcRow.el.appendChild(document.createTextNode(' '));

        const nameSpan = new View('span');
        nameSpan.cssText('color:' + (func.callCount > 10 ? 'var(--nr-accent)' : 'var(--nr-text-primary)'));
        nameSpan.el.textContent = func.id;
        funcRow.el.appendChild(nameSpan.el);

        const statsSpan = new View('span');
        statsSpan.cssText('color:var(--nr-text-quaternary);margin-left:8px;font-size:10px');
        statsSpan.el.textContent = func.callCount + '\u00d7 called' + (crossFileDeps.length > 0 ? ' \u2022 ' + crossFileDeps.length + ' cross-file' : '');
        funcRow.el.appendChild(statsSpan.el);

        if (crossFileDeps.length > 0) {
          const crossDiv = new View('div');
          crossDiv.cssText('margin-left:32px;color:var(--nr-text-quaternary);font-size:10px');
          crossFileDeps.slice(0, 2).forEach(function(dep) {
            const target = allNodes.find(function(n) { return n.id === dep.target; });
            const arrow = new View('span');
            arrow.cssText('color:#ef4444');
            arrow.el.textContent = '\u2192';
            crossDiv.el.appendChild(arrow.el);
            crossDiv.el.appendChild(document.createTextNode(' ' + dep.target + ' '));
            const fileRef = new View('span');
            fileRef.cssText('opacity:0.7');
            fileRef.el.textContent = '(' + (target ? target.file : '') + ') ';
            crossDiv.el.appendChild(fileRef.el);
          });
          if (crossFileDeps.length > 2) {
            crossDiv.el.appendChild(document.createTextNode('+' + (crossFileDeps.length - 2) + ' more'));
          }
          funcRow.el.appendChild(crossDiv.el);
        }
        fileDiv.el.appendChild(funcRow.el);

        if (!isLast) {
          const sep = new View('div');
          sep.cssText('margin-left:16px;color:var(--nr-border-default)');
          sep.el.textContent = '│';
          fileDiv.el.appendChild(sep.el);
        }
      });
    }
    wrapper.el.appendChild(fileDiv.el);
  });

  AetherUI.mount(wrapper, container);
}

export function _devToggleFile(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'function') {
    _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

export function _devGraphSearch(query) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;

  query = query.toLowerCase().trim();
  if (!query) {
    _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
    return;
  }

  const filtered = _devGraphData.nodes.filter(n =>
    n.id.toLowerCase().includes(query)
  );

  const filteredIds = new Set(filtered.map(n => n.id));
  const edges = _devGraphData.edges.filter(e =>
    filteredIds.has(e.source) && filteredIds.has(e.target)
  );

  _devRenderFunctionGraph(filtered, edges);
}

export function _devGraphFilterByFile(file) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

export function _devGraphToggleUnused(show) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

// ── Git Log Section ──
export async function _renderDevGitLog() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Git History').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Recent commit activity').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});
  const logContainer = new View('div');
  logContainer.id('dev-git-log-container');
  AetherUI.mount(VStack(header, logContainer), contentPane);

  const container = document.getElementById('dev-git-log-container');
  AetherUI.mount(Text('Loading\u2026').className('text-sm').foreground('quaternary'), container);

  try {
    const data = await apiGet('/api/dev-stats');
    const log = data.git_log || [];

    AetherUI.mount(Show(log.length,
      function() {
        _devGitLogState = State(log);
        _devGitLogOffset = log.length;
        const logList = new View('div').id('dev-git-log-list').className('dev-git-log-list');
        logList._appendChildren([ForEach(_devGitLogState, function(c) { return c.sha; }, _devCommitRow)]);
        return logList;
      },
      function() { return Text('No commits found').className('text-sm').foreground('quaternary'); }
    ), container);
    if (log.length >= 20) _devAppendLoadMoreBtn();
  } catch (e) {
    AetherUI.mount(Text('Error: ' + e.message).className('text-sm').foreground('quaternary'), container);
  }
}

// ── Dev Tools Section ──
export function _renderDevTools() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  const header = VStack(
    Text('Dev Tools').styles({color:'var(--nr-text-primary)', fontSize:'1.25rem', fontWeight:'700', margin:'0 0 4px 0'}),
    Text('Testing utilities and debugging tools').styles({color:'var(--nr-text-quaternary)', fontSize:'0.75rem', margin:'0'})
  ).styles({marginBottom:'24px'});

  const achSelect = new View('select');
  achSelect.id('dev-ach-select').className('dev-input').styles({minWidth:'180px'});
  achSelect.el.innerHTML = '<option value="bookworm">Bookworm</option><option value="curator">Curator</option><option value="critic">Critic</option><option value="explorer">Explorer</option><option value="model_switch">Model Swapper</option><option value="pixel_parent">Pixel Parent</option>';

  const showBtn = Button('Show').onTap(function() { _devTestAchievement(); })
    .styles({background:'linear-gradient(135deg,#b8860b,#ffd700)', color:'#1a1400', border:'none', borderRadius:'6px', padding:'6px 14px', fontSize:'0.75rem', fontWeight:'600'}).cursor();
  const dismissBtn = Button('Dismiss').className('dev-btn-secondary').onTap(function() { islandRemove('achievement'); });
  const resetBtn = Button('Reset All').className('dev-btn-secondary').onTap(function() { _devResetAchievements(); });

  const tester = VStack(
    Text('Achievement Tester').styles({color:'var(--nr-text-primary)', fontSize:'0.85rem', fontWeight:'600', marginBottom:'12px'}),
    HStack(achSelect, showBtn, dismissBtn, resetBtn).id('dev-ach-tester').gap('8px').wrap()
  ).styles({background:'var(--nr-bg-surface)', border:'1px solid var(--nr-border-default)', borderRadius:'8px', padding:'16px'});

  AetherUI.mount(VStack(header, tester), contentPane);
}

export var _devAchievements = {
  bookworm:     { name: 'Bookworm',      desc: 'Saved your first post' },
  curator:      { name: 'Curator',       desc: 'Curated your feed by hiding a post' },
  critic:       { name: 'Critic',        desc: 'Rated your first paper' },
  explorer:     { name: 'Explorer',      desc: 'Enabled a new feed source' },
  model_switch: { name: 'Model Swapper', desc: 'Switched your AI model for the first time' },
  pixel_parent: { name: 'Pixel Parent',  desc: 'Adopted your pixel pet' },
  gaze_master:  { name: 'Gaze Master',  desc: 'Trained your eye-tracking model 5 times' }
};

export function _devTestAchievement() {
  const sel = document.getElementById('dev-ach-select');
  if (!sel) return;
  const ach = _devAchievements[sel.value];
  if (!ach) return;
  islandRemove('achievement');
  setTimeout(function() { showAchievement(ach.name, ach.desc); }, 50);
}

export function _devResetAchievements() {
  const keys = ['ach_bookworm', 'ach_curator', 'ach_critic', 'ach_explorer', 'ach_model_switch', 'ach_pixel_parent', 'ach_gaze_master'];
  keys.forEach(function(k) { Settings.remove(k); });
  islandRemove('achievement');
}

export async function _devRunFunctionRegistry() {
  const btn = document.getElementById('dev-fn-reg-btn');
  const status = document.getElementById('dev-fn-reg-status');
  const results = document.getElementById('dev-fn-reg-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  AetherUI.mount(Text(''), results);

  try {
    const data = await apiGet('/api/function-registry');

    if (data.error) {
      status.textContent = 'Error: ' + data.error;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    status.textContent = 'Analysis complete';
    status.style.color = 'var(--nr-text-success, #22c55e)';

    const summary = data.summary;

    // Group duplicates by severity
    const dupsBySeverity = { ERROR: [], WARNING: [], INFO: [] };
    data.issues.duplicates.forEach(dup => {
      const severity = dup.severity || 'WARNING';
      if (!dupsBySeverity[severity]) dupsBySeverity[severity] = [];
      dupsBySeverity[severity].push(dup);
    });

    const errorCount = dupsBySeverity.ERROR.length;
    const warningCount = dupsBySeverity.WARNING.length;
    const infoCount = dupsBySeverity.INFO.length;

    const parts = [
      _devStatGrid(
        _devStatCard(summary.totalFunctions, 'Functions', 'var(--nr-accent)'),
        _devStatCard(summary.duplicateFunctions, 'Duplicates', summary.duplicateFunctions > 0 ? '#f59e0b' : null),
        _devStatCard(summary.unusedFunctions, 'Unused', summary.unusedFunctions > 0 ? '#ef4444' : null),
        _devStatCard(summary.totalFiles, 'Files', null)
      )
    ];

    // Severity breakdown + error/warning/info panels kept as RawHTML (complex structure)
    let detailsHtml = '';
    if (data.issues.duplicates.length > 0) {
      detailsHtml += `<div style="margin-top:16px;padding:8px 12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">Severity Breakdown: <span style="color:#ef4444;margin-left:12px">${errorCount} ERROR</span><span style="color:#f59e0b;margin-left:8px">${warningCount} WARNING</span><span style="color:#60a5fa;margin-left:8px">${infoCount} INFO</span></div></div>`;
    }
    if (errorCount > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #ef4444"><div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:8px">ERROR: Global Naming Conflicts (${errorCount})</div>${dupsBySeverity.ERROR.slice(0, 5).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}</div></div>`).join('')}${errorCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${errorCount - 5} more</div>` : ''}</div>`;
    }
    if (warningCount > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b"><div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Same-Scope Duplicates (${warningCount})</div>${dupsBySeverity.WARNING.slice(0, 5).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}</div></div>`).join('')}${warningCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${warningCount - 5} more</div>` : ''}</div>`;
    }
    if (infoCount > 0) {
      detailsHtml += `<details style="margin-top:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;border-left:3px solid #60a5fa;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600">&#8505;&#65039; INFO: Nested Duplicates (${infoCount}) - Safe, intentional</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px">${dupsBySeverity.INFO.slice(0, 10).map(dup => `<div style="margin-bottom:8px;font-size:0.65rem"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code><span style="color:var(--nr-text-quaternary);margin-left:8px">(${dup.definitions.length} definitions)</span></div>`).join('')}${infoCount > 10 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${infoCount - 10} more</div>` : ''}</div></details>`;
    }
    if (data.issues.unused.length > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">Unused Functions (${data.issues.unused.length})</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:150px;overflow-y:auto">${data.issues.unused.slice(0, 10).map(u => `<code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-right:8px;margin-bottom:4px;display:inline-block">${escapeHtml(u.name)}()</code>`).join('')}${data.issues.unused.length > 10 ? `<div style="margin-top:8px">...and ${data.issues.unused.length - 10} more</div>` : ''}</div></div>`;
    }
    const topFuncs = Object.entries(data.functions).sort((a, b) => b[1].callCount - a[1].callCount).slice(0, 5);
    if (topFuncs.length > 0) {
      detailsHtml += `<div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px"><div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">Most Called Functions</div>${topFuncs.map(([name, info], i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:0.65rem"><span><span style="color:var(--nr-accent);font-weight:600">#${i + 1}</span><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-left:8px">${escapeHtml(name)}()</code></span><span style="color:var(--nr-text-quaternary)">${info.callCount} calls</span></div>`).join('')}</div>`;
    }
    if (detailsHtml) parts.push(RawHTML(detailsHtml));
    AetherUI.mount(VStack.apply(null, parts), results);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze Functions';
  }
}

export function _devOpenFunctionRegistryReport() {
  if (window.electronAPI && window.electronAPI.openExternal) {
    const path = require('path');
    const reportPath = path.join(process.cwd(), 'coverage', 'function-registry.html');
    window.electronAPI.openExternal('file://' + reportPath);
  } else {
    window.open('../coverage/function-registry.html', '_blank');
  }
}

export async function _devRunFeedValidator() {
  const btn = document.getElementById('dev-feed-val-btn');
  const status = document.getElementById('dev-feed-val-status');
  const results = document.getElementById('dev-feed-val-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Validating...';
  status.textContent = 'Running validation...';
  AetherUI.mount(Text(''), results);

  try {
    const data = await apiGet('/api/validate-feeds');

    if (data.status === 'error' && data.message) {
      status.textContent = 'Error: ' + data.message;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    const isSync = data.errorCount === 0;
    status.textContent = isSync ? 'Catalogs in sync' : `${data.errorCount} mismatch${data.errorCount === 1 ? '' : 'es'} found`;
    status.style.color = isSync ? '#34d399' : '#ef4444';

    const feedValidatorParts = [
      _devStatGrid(
        _devStatCard(data.jsCatalogSize, 'JS Entries', 'var(--nr-accent)'),
        _devStatCard(data.pyCatalogSize, 'PY Entries', 'var(--nr-accent)'),
        _devStatCard(data.errorCount, 'Mismatches', isSync ? '#34d399' : '#ef4444')
      )
    ];
    if (data.errorCount > 0) {
      feedValidatorParts.push(RawHTML(_devRenderFeedValidatorErrors(data.errors)));
    } else {
      feedValidatorParts.push(RawHTML(`<div style="padding:24px;text-align:center;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px"><div style="width:48px;height:48px;margin:0 auto 12px;border-radius:50%;background:#34d399;display:flex;align-items:center;justify-content:center">${icon('check', {size: 24, stroke: 'white', strokeWidth: '3'})}</div><div style="color:var(--nr-text-primary);font-size:0.85rem;font-weight:600">All ${data.jsCatalogSize} feed entries are in sync!</div><div style="color:var(--nr-text-quaternary);font-size:0.7rem;margin-top:4px">JS and Python catalogs match perfectly.</div></div>`));
    }
    AetherUI.mount(VStack.apply(null, feedValidatorParts), results);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Validation';
  }
}

export function _devRenderFeedValidatorErrors(errors) {
  const byType = { MISSING_IN_PY: [], MISSING_IN_JS: [], URL_MISMATCH: [], SPECIAL_MISMATCH: [] };
  errors.forEach(e => byType[e.type].push(e));

  return `
    ${byType.MISSING_IN_PY.length > 0 ? `
      <div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b">
        <div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Missing in Python (${byType.MISSING_IN_PY.length})</div>
        <div style="color:var(--nr-text-quaternary);font-size:0.65rem">
          ${byType.MISSING_IN_PY.map(e => `
            <div style="margin-bottom:6px">
              <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(e.key)}</code>
              <span style="margin-left:8px">→ Add to feed_catalog.py</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${byType.MISSING_IN_JS.length > 0 ? `
      <div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b">
        <div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Missing in JavaScript (${byType.MISSING_IN_JS.length})</div>
        <div style="color:var(--nr-text-quaternary);font-size:0.65rem">
          ${byType.MISSING_IN_JS.map(e => `
            <div style="margin-bottom:6px">
              <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(e.key)}</code>
              <span style="margin-left:8px">→ Add to core.js</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${byType.URL_MISMATCH.length > 0 ? `
      <div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #ef4444">
        <div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:8px">ERROR: URL Mismatch (${byType.URL_MISMATCH.length})</div>
        <div style="overflow-x:auto">
          <table style="width:100%;font-size:0.65rem;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:1px solid var(--nr-border-default)">
                <th style="text-align:left;padding:4px;color:var(--nr-text-primary)">Key</th>
                <th style="text-align:left;padding:4px;color:var(--nr-text-primary)">JS URL</th>
                <th style="text-align:left;padding:4px;color:var(--nr-text-primary)">PY URL</th>
              </tr>
            </thead>
            <tbody>
              ${byType.URL_MISMATCH.map(e => `
                <tr style="border-bottom:1px solid var(--nr-border-default)">
                  <td style="padding:4px"><code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 4px;border-radius:3px">${escapeHtml(e.key)}</code></td>
                  <td style="padding:4px;color:var(--nr-text-quaternary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.js?.url || '(none)')}</td>
                  <td style="padding:4px;color:var(--nr-text-quaternary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.py?.url || '(none)')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    ${byType.SPECIAL_MISMATCH.length > 0 ? `
      <div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #ef4444">
        <div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:8px">ERROR: Special Field Mismatch (${byType.SPECIAL_MISMATCH.length})</div>
        <div style="color:var(--nr-text-quaternary);font-size:0.65rem">
          ${byType.SPECIAL_MISMATCH.map(e => `
            <div style="margin-bottom:6px">
              <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(e.key)}</code>
              <span style="margin-left:8px">JS: ${e.js?.special || '(none)'} → PY: ${e.py?.special || '(none)'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

export async function _devRunLoadOrderAnalysis() {
  const btn = document.getElementById('dev-load-ord-btn');
  const status = document.getElementById('dev-load-ord-status');
  const results = document.getElementById('dev-load-ord-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  AetherUI.mount(Text(''), results);

  try {
    const data = await apiGet('/api/validate-load-order');

    if (data.status === 'error' && data.message) {
      status.textContent = 'Error: ' + data.message;
      status.style.color = 'var(--nr-text-error, #ef4444)';
      return;
    }

    const isOptimal = data.warnings.length === 0;
    status.textContent = isOptimal ? 'Load order optimal' : `${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'} found`;
    status.style.color = isOptimal ? '#34d399' : '#f59e0b';

    const loadOrderParts = [
      _devStatGrid(
        _devStatCard(data.scriptCount, 'Scripts', 'var(--nr-accent)'),
        _devStatCard(data.warnings.length, 'Warnings', data.warnings.length > 0 ? '#f59e0b' : null),
        _devStatCard(data.infos.length, 'Info', 'var(--nr-text-quaternary)'),
        _devStatCard(data.cycles.length, 'Circular Deps', null)
      )
    ];
    // Complex panels use RawHTML (details/summary, tables)
    let loadOrderHtml = `<details open style="margin-bottom:12px"><summary style="padding:10px 14px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.75rem;font-weight:600">Script Load Order (${data.scriptCount} files)</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px;max-height:300px;overflow-y:auto">${data.scriptOrder.map((script, i) => `<div style="font-size:0.65rem;color:var(--nr-text-quaternary);margin-bottom:2px;font-family:monospace"><span style="color:var(--nr-accent);font-weight:600">${i + 1}.</span><span style="margin-left:8px">${escapeHtml(script)}</span></div>`).join('')}</div></details>`;
    if (data.warnings.length > 0) {
      loadOrderHtml += `<div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b"><div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Forward References (may cause issues)</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:200px;overflow-y:auto">${data.warnings.slice(0, 10).map(ref => `<div style="margin-bottom:8px;padding:8px;background:var(--nr-bg-raised);border-radius:4px"><div><strong>${ref.callFile}</strong> (order ${ref.callOrder}) calls <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code></div><div style="margin-top:4px;color:var(--nr-text-quaternary)">\u2192 Defined in <strong>${ref.defFile}</strong> (order ${ref.defOrder})</div></div>`).join('')}${data.warnings.length > 10 ? `<div style="margin-top:8px">...and ${data.warnings.length - 10} more</div>` : ''}</div></div>`;
    }
    if (data.infos.length > 0) {
      loadOrderHtml += `<details style="margin-bottom:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600;border-left:3px solid #60a5fa">Forward References (INFO - ${data.infos.length}) - Safe with defer</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px"><div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-bottom:8px">These forward references are safe because scripts use defer and functions are called inside other functions or event handlers.</div><div style="color:var(--nr-text-quaternary);font-size:0.65rem">${data.infos.slice(0, 5).map(ref => `<div style="margin-bottom:4px">${ref.callFile} \u2192 <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code> \u2192 ${ref.defFile}</div>`).join('')}${data.infos.length > 5 ? `<div style="margin-top:8px">...and ${data.infos.length - 5} more</div>` : ''}</div></div></details>`;
    }
    if (data.cycles.length > 0) {
      loadOrderHtml += `<details style="margin-bottom:12px"><summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">Circular Dependencies (${data.cycles.length})</summary><div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px"><div style="color:var(--nr-text-quaternary);font-size:0.65rem">${data.cycles.slice(0, 10).map(cycle => `<div style="margin-bottom:4px">${cycle.join(' \u2192 ')}</div>`).join('')}${data.cycles.length > 10 ? `<div style="margin-top:8px">...and ${data.cycles.length - 10} more</div>` : ''}</div></div></details>`;
    }
    loadOrderParts.push(RawHTML(loadOrderHtml));
    AetherUI.mount(VStack.apply(null, loadOrderParts), results);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Analysis';
  }
}

export var _devGitLogOffset = 0;
export var _devGitLogState = null;

function _devCommitRow(c) {
  const d = new Date(c.date);
  const relative = _devRelativeTime(d);
  const diffView = (c.ins || c.del)
    ? RawHTML('<span class="dev-git-log-diff"><span style="color:#3fb950">+' + c.ins + '</span> <span style="color:#f85149">-' + c.del + '</span></span>')
    : null;
  return HStack(
    Text(c.sha).className('dev-git-log-sha'),
    Text(escapeHtml(c.message)).className('dev-git-log-msg'),
    diffView,
    Text(relative).className('dev-git-log-meta')
  ).className('dev-git-log-item');
}

export function _devRenderCommitRows(log) {
  return ForEach(log, function(c) { return c.sha; }, _devCommitRow);
}

export function _devAppendLoadMoreBtn() {
  const container = document.getElementById('dev-git-log-container');
  if (!container) return;
  const old = document.getElementById('dev-git-load-more');
  if (old) old.remove();
  const btnView = Button('Load more commits').className('dev-git-load-more-btn').attr('id', 'dev-git-load-more');
  btnView.onTap(function() { _devLoadMoreCommits(btnView.el); });
  container.appendChild(btnView.build());
}

export async function _devLoadMoreCommits(btn) {
  btn.textContent = 'Loading\u2026';
  btn.disabled = true;
  try {
    const data = await apiGet(`/api/dev-git-log?offset=${_devGitLogOffset}&limit=20`);
    const log = data.git_log || [];
    if (log.length && _devGitLogState) {
      _devGitLogState.value = _devGitLogState.value.concat(log);
      _devGitLogOffset += log.length;
    }
    if (!data.has_more || !log.length) {
      btn.remove();
    } else {
      btn.textContent = 'Load more commits';
      btn.disabled = false;
    }
  } catch {
    btn.textContent = 'Load more commits';
    btn.disabled = false;
  }
}


// ── Window exports ──
window._dashSearchDebounce = _dashSearchDebounce;
window._closeDashSearch = _closeDashSearch;
window.dashRemoveSaved = dashRemoveSaved;
window._dashPapersReadRecent = _dashPapersReadRecent;
window._dashTrending = _dashTrending;
window._dashBuildStatsRow = _dashBuildStatsRow;
window._dashBuildQuickActions = _dashBuildQuickActions;
window._dashBuildTrendingCard = _dashBuildTrendingCard;
window.renderDashboard = renderDashboard;
window._dashSummaryAbort = _dashSummaryAbort;
window._streamDaySummary = _streamDaySummary;
window._dashStatusProfile = _dashStatusProfile;
window._openStatusPicker = _openStatusPicker;
window._selectStatusPet = _selectStatusPet;
window._saveStatus = _saveStatus;
window._clearStatus = _clearStatus;
window.openAllSaved = openAllSaved;
window._devFpsRaf = _devFpsRaf;
window._devChartId = _devChartId;
window._devChartRegistry = _devChartRegistry;
window.DEV_SECTIONS = DEV_SECTIONS;
window._devActiveSection = _devActiveSection;
window._devD3Loaded = _devD3Loaded;
window._devGraphLevel = _devGraphLevel;
window._devGraphData = _devGraphData;
window._devLineChart = _devLineChart;
window._devBindCharts = _devBindCharts;
window._devRelativeTime = _devRelativeTime;
window.renderDevPanel = renderDevPanel;
window._devNavigateTo = _devNavigateTo;
window.renderDevSection = renderDevSection;
window._renderDevOverview = _renderDevOverview;
window._renderDevFunctionRegistry = _renderDevFunctionRegistry;
window._renderDevFeedValidator = _renderDevFeedValidator;
window._renderDevLoadOrder = _renderDevLoadOrder;
window._renderDevDependencyGraph = _renderDevDependencyGraph;
window._devSetGraphLevel = _devSetGraphLevel;
window._devLoadDependencyGraph = _devLoadDependencyGraph;
window._devCollapsedFiles = _devCollapsedFiles;
window._devRenderFileTree = _devRenderFileTree;
window._devToggleFileInFileView = _devToggleFileInFileView;
window._devExpandAllFiles = _devExpandAllFiles;
window._devCollapseAllFiles = _devCollapseAllFiles;
window._devRenderFunctionTree = _devRenderFunctionTree;
window._devToggleFile = _devToggleFile;
window._devGraphSearch = _devGraphSearch;
window._devGraphFilterByFile = _devGraphFilterByFile;
window._devGraphToggleUnused = _devGraphToggleUnused;
window._renderDevGitLog = _renderDevGitLog;
window._renderDevTools = _renderDevTools;
window._devAchievements = _devAchievements;
window._devTestAchievement = _devTestAchievement;
window._devResetAchievements = _devResetAchievements;
window._devRunFunctionRegistry = _devRunFunctionRegistry;
window._devOpenFunctionRegistryReport = _devOpenFunctionRegistryReport;
window._devRunFeedValidator = _devRunFeedValidator;
window._devRenderFeedValidatorErrors = _devRenderFeedValidatorErrors;
window._devRunLoadOrderAnalysis = _devRunLoadOrderAnalysis;
window._devGitLogOffset = _devGitLogOffset;
window._devGitLogState = _devGitLogState;
window._devRenderCommitRows = _devRenderCommitRows;
window._devAppendLoadMoreBtn = _devAppendLoadMoreBtn;
window._devLoadMoreCommits = _devLoadMoreCommits;
