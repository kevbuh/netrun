// ── Dashboard ──

const _dashSearchDebounce = null;


function _closeDashSearch(e) {
  const dropdown = document.getElementById('dashboard-search-results');
  const input = document.getElementById('dashboard-search');
  if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = 'none';
  }
}

async function dashToggleTask(teamId, todoId, done) {
  try {
    await apiPut(`/api/teams/${teamId}/todos/${todoId}`, { done });
    renderDashboard();
  } catch (err) { /* ignore */ }
}

function dashRemoveSaved(link) {
  toggleSavePostByLink(link);
  renderDashboard();
}

// ── Bento dashboard helpers ──

function _dashPapersReadRecent() {
  const readSet = new Set(JSON.parse(localStorage.getItem('readPosts') || '[]'));
  if (!readSet.size) return 0;
  const papers = typeof allPapers !== 'undefined' ? allPapers : [];
  return papers.filter(p => readSet.has(p.link)).length;
}

function _dashReadingStreak(activityItems) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  let streak = 0;
  // Grace period: if before 9am, don't require today to have activity
  const graceToday = today.getHours() < 9;
  const d = new Date(today);
  if (graceToday && !(activityItems[todayKey] || []).length) {
    d.setDate(d.getDate() - 1);
  }
  for (let i = 0; i < 365; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if ((activityItems[key] || []).length > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function _dashTrending(limit) {
  limit = limit || 5;
  const papers = typeof allPapers !== 'undefined' ? allPapers : [];
  if (!papers.length) return [];
  const now = Date.now();
  return papers.map(p => {
    const engagement = (p.points || 0) + (p.citations || 0);
    const qs = p._qualityScore || 0;
    const ageH = (now - (p.pubDate || now)) / 3600000;
    const recency = Math.max(0, 1 - ageH / 72);
    const score = (engagement * 2 + qs) * (0.3 + recency * 0.7);
    return { ...p, _trendScore: score };
  }).filter(p => p._trendScore > 0).sort((a, b) => b._trendScore - a._trendScore).slice(0, limit);
}

function _dashBuildStatsRow(papersRead, streak, savedCount, projectCount, taskCount) {
  const stats = [
    { value: papersRead, label: 'Papers Read', sub: 'in feed', color: '#60a5fa' },
    { value: streak, label: 'Streak', sub: streak === 1 ? 'day' : 'days', color: '#f97316', suffix: streak > 0 ? ' \u{1F525}' : '' },
    { value: savedCount, label: 'Saved', sub: 'reading list', color: '#34d399' },
    { value: projectCount, label: 'Projects', sub: 'active', color: '#a78bfa' },
    { value: taskCount, label: 'Tasks', sub: 'open', color: '#fbbf24' },
  ];
  return `<div class="bento-stats">${stats.map(s =>
    `<div class="bento-stat">
      <span class="stat-value" style="color:${s.color}">${s.value}${s.suffix || ''}</span>
      <span class="stat-label">${s.label}</span>
      <span class="stat-sub">${s.sub}</span>
    </div>`
  ).join('')}</div>`;
}

function _dashBuildQuickActions() {
  const actions = [
    { label: 'New Project', onclick: 'openExperiments()', icon: icon('folder', {size: 20, class: 'w-5 h-5'}) },
    { label: 'Search', onclick: 'openSearch()', icon: icon('search', {size: 20, class: 'w-5 h-5'}) },
    { label: 'Vault', onclick: 'openVault()', icon: icon('file', {size: 20, class: 'w-5 h-5'}) },
    { label: 'Calendar', onclick: 'wmOpen(\'calendar\')', icon: icon('calendar', {size: 20, class: 'w-5 h-5'}) },
  ];
  return `<div class="grid grid-cols-2 gap-2 h-full">${actions.map(a =>
    `<button class="nr-btn nr-btn-ghost" onclick="${a.onclick}">${a.icon}<span>${a.label}</span></button>`
  ).join('')}</div>`;
}

function _dashBuildTrendingCard(trending) {
  if (!trending.length) return '<div class="text-[0.8rem] text-dimmer px-1">No trending posts yet. Open your feed to get started.</div>';
  return trending.map((p, i) => {
    const chip = typeof getSourceChip === 'function' ? getSourceChip(p.source, p.arxivId) : '';
    const engagement = (p.points || 0) + (p.citations || 0);
    const engLabel = engagement > 0 ? `<span class="text-[0.68rem] text-dimmest shrink-0">${engagement}</span>` : '';
    return `<div class="bento-trending-item" onclick="window.location.hash='view/'+encodeURIComponent('${escapeAttr(p.link)}')">
      <span class="bento-trending-rank">${i + 1}</span>
      <div class="flex-1 min-w-0">
        <div class="text-[0.8rem] text-primary truncate">${escapeHtml(p.title)}</div>
        <div class="flex items-center gap-1.5 mt-0.5">${chip}${engLabel}</div>
      </div>
    </div>`;
  }).join('');
}

async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';

  const _uname = _authUserInfo?.username;
  const [expResp, calResp, tasksResp, teamsResp, profileResp, commentsResp, repostsResp, inboxInvites, inboxMessages] = await Promise.all([
    apiGet('/api/experiments').catch(() => []),
    apiGet('/api/calendar').catch(() => []),
    apiGet('/api/my-tasks').catch(() => []),
    apiGet('/api/teams').catch(() => []),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname)).catch(() => null) : Promise.resolve(null),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/comments').catch(() => []) : Promise.resolve([]),
    _uname ? apiGet('/api/users/' + encodeURIComponent(_uname) + '/reposts').catch(() => []) : Promise.resolve([]),
    apiGet('/api/inbox').catch(() => []),
    apiGet('/api/messages').catch(() => []),
  ]);

  const experiments = expResp || [];
  const events = calResp || [];
  const myTasks = tasksResp || [];
  const teams = teamsResp || [];
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

  // Tasks created today
  myTasks.filter(t => _isToday(t.timestamp)).forEach(t => {
    _todayActivity.push({ type: 'task', title: t.title, time: t.timestamp, icon: 'task' });
  });

  // Feed searches today
  const _searchHist = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  _searchHist.filter(s => s.ts && _isToday(s.ts)).forEach(s => {
    _todayActivity.push({ type: 'search', title: s.q || s, time: s.ts, icon: 'search' });
  });

  // Web searches today
  const _webSearchHist = JSON.parse(localStorage.getItem('webSearchHistory') || '[]');
  _webSearchHist.filter(s => s.ts && _isToday(s.ts)).forEach(s => {
    _todayActivity.push({ type: 'web-search', title: s.q, time: s.ts, icon: 'globe' });
  });

  // Feed notifications (new posts discovered) today
  const _feedNotifs = JSON.parse(localStorage.getItem('feedNotifications') || '[]');
  _feedNotifs.filter(n => n.seenAt && _isToday(n.seenAt)).forEach(n => {
    _todayActivity.push({ type: 'notif', title: n.title, time: n.seenAt, link: n.link, icon: 'bell' });
  });

  // Sort by time descending (most recent first)
  _todayActivity.sort((a, b) => (b.time || 0) - (a.time || 0));

  // Open tasks (not time-filtered — these are ongoing)
  const _openTaskCount = myTasks.length;
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

  let overviewHtml = '';
  // Summary chips
  const _chips = [];
  const _todayEvents = events.filter(ev => ev.date === _todayKey);
  const _todayEvtCount = _todayEvents.length;
  if (_todayEvtCount) _chips.push(`${_todayEvtCount} event${_todayEvtCount > 1 ? 's' : ''}`);
  if (_openTaskCount) _chips.push(`${_openTaskCount} open task${_openTaskCount > 1 ? 's' : ''}`);
  if (_unreadSavedCount) _chips.push(`${_unreadSavedCount} unread`);
  const _todaySavedCount = _todayActivity.filter(a => a.type === 'saved').length;
  if (_todaySavedCount) _chips.push(`${_todaySavedCount} saved`);
  const _todayCommentCount = _todayActivity.filter(a => a.type === 'comment').length;
  if (_todayCommentCount) _chips.push(`${_todayCommentCount} comment${_todayCommentCount > 1 ? 's' : ''}`);
  const _todaySearchCount = _todayActivity.filter(a => a.type === 'search' || a.type === 'web-search').length;
  if (_todaySearchCount) _chips.push(`${_todaySearchCount} search${_todaySearchCount > 1 ? 'es' : ''}`);

  // Today's events banner
  const _eventsHtml = _todayEvents.length ? `
    <div class="rounded-lg p-3 mb-3" style="background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2)">
      <div class="flex items-center gap-2 mb-2">
        ${icon('calendar', {size: 16, class: 'w-4 h-4 shrink-0', style: 'color:#60a5fa'})}
        <span class="text-[0.78rem] font-semibold" style="color:#60a5fa">Today's Events</span>
      </div>
      <div class="flex flex-col gap-1.5">
        ${_todayEvents.map(ev => {
          const evColor = ev.color || '#60a5fa';
          return `<div class="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-hover transition-colors" onclick="window.location.hash='calendar'">
            <span class="w-2 h-2 rounded-full shrink-0" style="background:${evColor}"></span>
            <span class="text-[0.85rem] text-primary font-medium">${escapeHtml(ev.title || 'Calendar event')}</span>
            ${ev.description ? `<span class="text-[0.72rem] text-dimmer truncate">${escapeHtml(ev.description)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // Build LLM prompt data (used after render)
  const _llmActivityData = _todayActivity.slice(0, 20).map(a => `${_fmtTime(a.time)} ${_ovLabels[a.type] || a.type}: ${a.title}`);

  // Filter events out of timeline (they have their own banner)
  const _timelineItems = _todayActivity.filter(a => a.type !== 'event');

  if (_timelineItems.length || _todayEvents.length) {
    const maxItems = 8;
    const shown = _timelineItems.slice(0, maxItems);
    const remaining = _timelineItems.length - maxItems;
    overviewHtml = `
      <div class="flex items-center justify-between mb-3">
        <span class="text-[0.82rem] text-primary font-medium">${_todayDateStr}</span>
        <span class="text-[0.7rem] text-dimmer">${_todayActivity.length} interaction${_todayActivity.length > 1 ? 's' : ''} today</span>
      </div>
      <div id="dash-day-summary" class="text-[0.8rem] text-dim leading-relaxed mb-3" style="min-height:1.2em"><span class="text-dimmest text-[0.75rem]">Summarizing your day...</span></div>
      ${_eventsHtml}
      ${_chips.length ? `<div class="flex flex-wrap gap-1.5 mb-3">${_chips.map(c => `<span class="text-[0.7rem] px-2 py-0.5 rounded-full bg-accent/10 text-accent">${c}</span>`).join('')}</div>` : ''}
      ${shown.length ? `<div class="flex flex-col gap-1">
        ${shown.map(a => {
          const onclick = a.link ? ` onclick="window.location.hash='view/'+encodeURIComponent('${escapeAttr(a.link)}')" style="cursor:pointer"` : '';
          return `<div class="flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-hover transition-colors"${onclick}>
            <span class="shrink-0">${_ovIcons[a.icon] || ''}</span>
            <span class="text-[0.7rem] text-dimmest w-12 shrink-0">${_fmtTime(a.time)}</span>
            <span class="text-[0.65rem] text-dimmer w-16 shrink-0">${_ovLabels[a.type] || a.type}</span>
            <span class="text-[0.78rem] text-primary truncate">${escapeHtml(a.title)}</span>
          </div>`;
        }).join('')}
        ${remaining > 0 ? `<div class="text-[0.72rem] text-dimmest px-1.5 mt-1">+ ${remaining} more</div>` : ''}
      </div>` : ''}`;
  } else if (_openTaskCount || _unreadSavedCount) {
    overviewHtml = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-[0.82rem] text-primary font-medium">${_todayDateStr}</span>
      </div>
      <div id="dash-day-summary" class="text-[0.8rem] text-dim leading-relaxed mb-2" style="min-height:1.2em"><span class="text-dimmest text-[0.75rem]">Summarizing your day...</span></div>
      <div class="flex flex-wrap gap-1.5">${_chips.map(c => `<span class="text-[0.7rem] px-2 py-0.5 rounded-full bg-accent/10 text-accent">${c}</span>`).join('')}</div>`;
  } else {
    overviewHtml = `
      <div class="flex items-center gap-2">
        <span class="text-[0.82rem] text-primary font-medium">${_todayDateStr}</span>
        <span class="text-[0.78rem] text-dimmest ml-1">— A clear day to explore.</span>
      </div>`;
  }

  // ── Inbox card ──
  const _inboxFeedNotifs = typeof _getFeedNotifications === 'function' ? _getFeedNotifications() : [];
  const _inboxInvites = inboxInvites || [];
  const _inboxMsgs = inboxMessages || [];
  const _inboxTotal = _inboxFeedNotifs.length + _inboxInvites.length + _inboxMsgs.length;
  let inboxHtml = '';
  if (_inboxTotal > 0) {
    let items = '';
    _inboxFeedNotifs.slice().sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0)).slice(0, 5).forEach(n => {
      const chip = typeof getSourceChip === 'function' ? getSourceChip(n.source) : '';
      items += `<div class="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-hover transition-colors cursor-pointer" onclick="clearFeedNotification('${escapeAttr(n.link)}'); _setBrowseReturnView('dashboard'); openBrowse('${escapeAttr(n.link)}')">
        <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
        ${chip}
        <span class="text-[0.78rem] text-primary truncate flex-1">${escapeHtml(n.title)}</span>
        <button onclick="event.stopPropagation(); dismissFeedNotification('${escapeAttr(n.link)}', this); renderDashboard()" class="text-dimmer hover:text-primary text-sm bg-transparent border-none cursor-pointer px-0.5 shrink-0" title="Dismiss">&times;</button>
      </div>`;
    });
    _inboxInvites.slice(0, 3).forEach(inv => {
      items += `<div class="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-hover transition-colors">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
        <span class="text-[0.78rem] text-primary truncate flex-1"><a href="#profile/${encodeURIComponent(inv.from_username)}" class="text-primary hover:text-accent" style="text-decoration:none">${escapeHtml(inv.from_username)}</a> invited you to <span class="text-accent font-medium">${escapeHtml(inv.team_name)}</span></span>
        <button onclick="respondToInvite(${inv.id}, true); renderDashboard()" class="px-2 py-0.5 rounded text-[0.65rem] bg-accent text-white border-none cursor-pointer">Accept</button>
        <button onclick="respondToInvite(${inv.id}, false); renderDashboard()" class="px-2 py-0.5 rounded text-[0.65rem] border border-border-input text-muted bg-card cursor-pointer">Decline</button>
      </div>`;
    });
    _inboxMsgs.slice(0, 3).forEach(m => {
      items += `<div class="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-hover transition-colors cursor-pointer" onclick="window.location.hash='inbox'">
        <span class="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
        <span class="text-[0.78rem] text-primary truncate flex-1"><span class="font-medium">${escapeHtml(m.from_username || 'Unknown')}</span>: ${escapeHtml((m.content || '').slice(0, 60))}</span>
      </div>`;
    });
    inboxHtml = `
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-[0.82rem] font-semibold text-primary">Inbox</h3>
        <span class="text-[0.68rem] text-dimmest">${_inboxTotal} new</span>
      </div>
      <div class="flex flex-col gap-0.5" style="max-height:200px;overflow-y:auto">${items}</div>`;
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
  const _shist = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  _shist.forEach(s => {
    if (s.ts) {
      const d = new Date(s.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'search', title: s.q || 'Search' });
    }
  });
  const _wshist = JSON.parse(localStorage.getItem('webSearchHistory') || '[]');
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
      const icons = { event: '\u{1F4C5}', note: '\u{1F4DD}', saved: '\u{1F516}' };
      const labels = { event: 'Event', note: 'Note', saved: 'Saved' };
      const presetColors = ['#b4451a','#3b82f6','#22c55e','#a855f7','#eab308','#ef4444'];
      const colorLabels = ['Accent','Blue','Green','Purple','Yellow','Red'];

      let html = `<div style="padding:4px 12px 6px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--nr-border-default);margin-bottom:2px">
        <span style="color:var(--nr-text-quaternary);font-size:11px">${dateLabel}</span>
        <button onclick="window._heatmapPopoverAddForm=!window._heatmapPopoverAddForm;window._renderHeatmapPopover('${key}')" style="background:none;border:none;color:var(--nr-accent);cursor:pointer;font-size:13px;font-weight:600;padding:0 2px" title="Add event">+</button>
      </div>`;

      if (window._heatmapPopoverAddForm) {
        html += `<div style="padding:6px 12px 8px">
          <input type="text" id="hm-ev-title" placeholder="Event title…" style="width:100%;padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:12px;margin-bottom:6px;box-sizing:border-box">
          <textarea id="hm-ev-desc" placeholder="Description (optional)" rows="2" style="width:100%;padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-input);color:var(--nr-text-primary);font-size:12px;margin-bottom:6px;resize:none;box-sizing:border-box"></textarea>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:11px;color:var(--nr-text-quaternary)">Color:</span>
            ${presetColors.map((c,i) => `<label style="cursor:pointer"><input type="radio" name="hm-ev-color" value="${c}" ${i===0?'checked':''} style="display:none"><span style="width:18px;height:18px;border-radius:50%;display:inline-block;border:2px solid transparent;background:${c}" title="${colorLabels[i]}" onclick="this.parentElement.querySelector('input').checked=true;this.closest('div').querySelectorAll('span').forEach(s=>s.style.borderColor='transparent');this.style.borderColor='white'"></span></label>`).join('')}
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="_heatmapAddEvent('${key}')" style="padding:3px 10px;border-radius:6px;background:var(--nr-accent);color:white;border:none;font-size:12px;cursor:pointer">Save</button>
            <button onclick="window._heatmapPopoverAddForm=false;window._renderHeatmapPopover('${key}')" style="padding:3px 10px;border-radius:6px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);color:var(--nr-text-primary);font-size:12px;cursor:pointer">Cancel</button>
          </div>
        </div>`;
      }

      if (!items.length && !window._heatmapPopoverAddForm) {
        html += `<div style="padding:6px 12px;color:var(--nr-text-quaternary)">No activity</div>`;
      } else {
        items.forEach(item => {
          const icon = icons[item.type] || '';
          const tag = `<span style="font-size:9px;color:var(--nr-text-quaternary);margin-left:4px">${labels[item.type] || ''}</span>`;
          let onclick = '';
          if (item.type === 'saved' && item.link) onclick = `onclick="openSavedPaper('${escapeAttr(item.link)}', event)"`;
          const cursor = onclick ? 'cursor:pointer;' : '';
          const deleteBtn = item.type === 'event' && item.id ? `<button onclick="event.stopPropagation();_heatmapDeleteEvent('${item.id}','${key}')" style="background:none;border:none;color:var(--nr-text-quaternary);cursor:pointer;padding:0 2px;font-size:14px;line-height:1;flex-shrink:0" title="Delete event">&times;</button>` : '';
          const colorDot = item.type === 'event' && item.color ? `<span style="width:8px;height:8px;border-radius:50%;background:${item.color};flex-shrink:0"></span>` : `<span style="flex-shrink:0">${icon}</span>`;
          html += `<div style="padding:4px 12px;${cursor}display:flex;align-items:center;gap:6px;color:var(--nr-text-primary)" ${onclick} class="hover:bg-hover">
            ${colorDot}
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(item.title)}</span>${tag}${deleteBtn}
          </div>`;
        });
      }
      pop.innerHTML = html;
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
    if (!p || !p.link) return '';
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
    const faviconImg = favicon
      ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
      : pixelFallback;
    const rp = entry.readProgress;
    const progressBar = rp ? `<div style="height:2px;margin-top:2px;background:var(--nr-border-default);border-radius:1px;overflow:hidden"><div style="width:${Math.round(rp * 100)}%;height:100%;background:var(--nr-accent);border-radius:1px"></div></div>` : '';
    return `<div class="dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}">
      ${faviconImg}
      <div class="flex-1 min-w-0" onclick="openSavedPaper('${escapeAttr(p.link)}', event)">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
        ${progressBar}
      </div>
      ${getPaperRating(p.link) > 0 ? `<span class="shrink-0">${renderStarRating(p.link, { size: 'sm', interactive: false })}</span>` : ''}
      <button class="dash-offline shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none${isPostCached(p.link) ? ' cached' : ''}" title="${isPostCached(p.link) ? 'Saved offline' : 'Save offline'}" onclick="event.stopPropagation(); if(!isPostCached('${escapeAttr(p.link)}')) cachePostOffline('${escapeAttr(p.link)}', ${escapeAttr(JSON.stringify(p))}, this)">${isPostCached(p.link) ? _offlineCachedIcon() : _offlineDownloadIcon()}</button>
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--nr-text-quaternary);font-size:1rem" onclick="dashRemoveSaved('${escapeAttr(p.link)}')" title="Remove">&times;</button>
    </div>`;
  };
  const readingHtml = displayedSaved.length ? displayedSaved.map(_renderSavedRow).join('') + (hasMoreSaved ? `<button onclick="openAllSaved()" class="text-[0.78rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer mt-2 px-2">View all ${savedEntries.length} saved posts</button>` : '') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';

  // ── Recent experiments ──
  const recentExps = experiments.slice(0, 4);
  const expsHtml = recentExps.length ? recentExps.map(exp => {
    const runCount = exp.runCount || 0;
    const lastUpdated = exp.lastUpdated ? new Date(exp.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `<div class="p-3 rounded-lg border border-border-card bg-card cursor-pointer hover:border-border-input transition-colors" onclick="openExperimentDetail('${exp.id}', event)">
      <div class="flex items-center gap-2.5">
        ${_pixelArt(exp.id)}
        <div class="min-w-0 flex-1">
          <div class="text-[0.85rem] font-medium text-primary truncate">${escapeHtml(exp.title)}</div>
          <div class="text-[0.72rem] text-dimmer mt-0.5">${runCount} run${runCount !== 1 ? 's' : ''}${lastUpdated ? ' · ' + lastUpdated : ''}</div>
        </div>
        ${exp.team_name ? `<span class="text-[0.65rem] px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0">${escapeHtml(exp.team_name)}</span>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer">No projects yet</div>';

  // ── User Quotes ──
  const userQuotes = typeof _getUserQuotes === 'function' ? _getUserQuotes() : [];
  const quotesHtml = userQuotes.length ? userQuotes.slice().reverse().map(q => {
    const hostname = (() => { try { return new URL(q.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const dateStr = q.pubDate ? new Date(q.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `<div class="dash-row flex gap-2 px-2 py-2 rounded-md hover:bg-hover transition-colors group">
      <div class="w-0.5 bg-accent rounded shrink-0 self-stretch"></div>
      <div class="flex-1 min-w-0">
        <div class="text-[0.82rem] text-primary italic leading-snug">${escapeHtml(truncate(q.quote, 200))}</div>
        <div class="flex items-center gap-1.5 mt-1">
          <span class="text-[0.7rem] text-dimmer truncate cursor-pointer hover:text-primary" onclick="if(_isNewTabClick(event)){_openInNewTab('${escapeAttr(q.link)}');return;} window.location.hash='view/'+encodeURIComponent('${escapeAttr(q.link)}')">${escapeHtml(q.title || hostname)}</span>
          ${dateStr ? `<span class="text-[0.68rem] text-dimmest">${dateStr}</span>` : ''}
        </div>
      </div>
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--nr-text-quaternary);font-size:1rem" onclick="deleteUserQuote('${escapeAttr(q.id)}'); renderDashboard()" title="Remove">&times;</button>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No quotes yet. Open a page and use Post Quote in the sidebar.</div>';

  // Task priority colors/labels (used in bento grid)
  const _priColors = { high: '#f87171', medium: '#fbbf24', low: '#6ee7b7' };
  const _priLabels = { high: 'High', medium: 'Med', low: 'Low' };

  // ── Profile header ──
  const _pAccent = profile.accent_color || '#b4451a';
  const _pJoinDate = profile.created ? new Date(profile.created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '';
  const profileHeaderHtml = `
    <div class="relative rounded-xl overflow-hidden mb-6 ${profile.profile_bg ? '' : 'nr-living-gradient'}" style="min-height:120px; ${profile.profile_bg ? `background:url('${escapeAttr(profile.profile_bg)}') center/cover no-repeat` : `background:linear-gradient(135deg, ${_pAccent}33, ${_pAccent}11)`}">
      <div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:linear-gradient(to top,var(--nr-bg-body),transparent)"></div>
      <button onclick="_uploadProfileBg()" class="absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center bg-black/40 text-white/70 hover:text-white border-none cursor-pointer transition-colors" title="Change background">
        ${icon('camera', {class: 'w-3.5 h-3.5'})}
      </button>
    </div>
    <div class="flex items-center gap-4 mb-6 -mt-12 relative z-10 px-2">
      <div class="relative group">
        ${profile.picture
          ? `<img src="${escapeAttr(profile.picture)}" class="w-16 h-16 rounded-full border-[3px]" style="border-color:var(--nr-bg-body)" referrerpolicy="no-referrer" />`
          : `<div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-[3px]" style="border-color:var(--nr-bg-body);background:${_pAccent}33;color:${_pAccent}">${escapeHtml((profile.username || _authUserInfo?.username || '?')[0].toUpperCase())}</div>`
        }
        <button onclick="_uploadProfilePic()" class="absolute inset-0 w-full h-full rounded-full bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none" title="Change picture">
          ${icon('camera', {size: 20, class: 'w-5 h-5 text-white'})}
        </button>
      </div>
      <div>
        <div class="flex items-center gap-2">
          <h2 class="text-[1.3rem] font-semibold text-white_">${escapeHtml(profile.username || _authUserInfo?.username || '')}</h2>
          <div class="w-2.5 h-2.5 rounded-full" style="background:#22c55e;box-shadow:0 0 4px #22c55e80" title="Online"></div>
        </div>
        <div class="flex items-center gap-1.5 mt-1">
          <span id="dash-status-display" class="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity" onclick="_openStatusPicker()" title="Click to set status">
            ${profile.status_emoji ? `<canvas id="dash-status-pet" width="18" height="18" class="shrink-0" style="image-rendering:pixelated"></canvas>` : ''}
            ${profile.status_text ? `<span class="text-dim text-[0.78rem]">${escapeHtml(profile.status_text)}</span>` : `<span class="text-dimmest text-[0.72rem] italic">Set status...</span>`}
          </span>
        </div>
        ${_pJoinDate ? `<div class="text-dimmer text-[0.78rem] mt-0.5">Joined ${_pJoinDate}</div>` : ''}
      </div>
      <div class="ml-auto">
        <button onclick="openSettings()" class="w-8 h-8 rounded-lg flex items-center justify-center bg-transparent border border-border-card text-dim hover:text-primary hover:border-accent/40 cursor-pointer transition-colors" title="Settings">${icon('settings', {size: 16, class: 'w-4 h-4'})}</button>
      </div>
    </div>
    <div id="dash-status-picker" class="hidden mb-4"></div>
    <div class="flex gap-6 mb-6 text-[0.82rem]">
      <div><span class="text-white_ font-semibold">${profile.comment_count || 0}</span> <span class="text-dimmer">comments</span></div>
      <div><span class="text-white_ font-semibold">${profile.repost_count || 0}</span> <span class="text-dimmer">reposts</span></div>
      <div><span class="text-white_ font-semibold">${profile.team_count || 0}</span> <span class="text-dimmer">teams</span></div>
      <div><span class="text-white_ font-semibold">${profile.experiment_count || 0}</span> <span class="text-dimmer">projects</span></div>
    </div>
    <h3 class="text-[0.95rem] font-medium text-dimmer mb-4">${getGreeting()}</h3>
  `;

  // ── Bento layout data ──
  const _papersRead = _dashPapersReadRecent();
  const _streak = _dashReadingStreak(activityItems);
  const _savedCount = Object.keys(mergedSaved).length;
  const _projectCount = experiments.length;
  const _taskCount = myTasks.length;
  const _trending = _dashTrending(5);

  // Tasks card HTML
  const _bentoTasksHtml = myTasks.length ? myTasks.slice(0, 5).map(t => `
    <div class="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-hover transition-colors">
      <input type="checkbox" onchange="dashToggleTask(${t.team_id}, '${t.id}', this.checked)" class="accent-[var(--nr-accent)] cursor-pointer shrink-0" />
      <div class="flex-1 min-w-0 cursor-pointer" onclick="window.location.hash='teams'; setTimeout(()=>showTeamDetailView(${t.team_id}),100)">
        <div class="text-[0.78rem] text-primary truncate">${escapeHtml(t.title)}</div>
        <div class="text-[0.65rem] text-dimmest">${escapeHtml(t.team_name)}</div>
      </div>
      <span class="text-[0.55rem] px-1.5 py-0.5 rounded-full font-medium shrink-0" style="background:${_priColors[t.priority]}20;color:${_priColors[t.priority]}">${_priLabels[t.priority]}</span>
    </div>
  `).join('') : '';

  // Teams card HTML
  const _bentoTeamsHtml = teams.length ? teams.slice(0, 4).map(t => `
    <div class="flex items-center gap-2 px-1 py-1.5 rounded-md hover:bg-hover transition-colors cursor-pointer" onclick="showTeamDetailView(${t.id}, event)">
      ${typeof _pixelArt === 'function' ? _pixelArt(t.name) : ''}
      <div class="min-w-0 flex-1">
        <div class="text-[0.8rem] text-primary truncate">${escapeHtml(t.name)}</div>
        <div class="text-[0.65rem] text-dimmest">${t.member_count} member${t.member_count !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('') : '';

  // Comments card HTML
  const _bentoCommentsHtml = myComments.slice(0, 4).map(c => {
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(c.timestamp) : '';
    const preview = (c.content || '').length > 80 ? c.content.slice(0, 80) + '...' : c.content;
    return `<a href="#paper/${encodeURIComponent(c.paperLink)}" class="block px-2 py-1.5 rounded-md hover:bg-hover transition-colors" style="text-decoration:none">
      <div class="text-[0.75rem] text-primary leading-snug truncate">${escapeHtml(preview)}</div>
      <div class="text-dimmest text-[0.65rem] mt-0.5">${timeAgo}</div>
    </a>`;
  }).join('');

  // Reposts card HTML
  const _bentoRepostsHtml = myReposts.slice(0, 4).map(r => {
    const timeAgo = typeof _relativeTime === 'function' ? _relativeTime(r.timestamp) : '';
    return `<a href="#view/${encodeURIComponent(r.paperLink)}" class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover transition-colors" style="text-decoration:none">
      ${icon('repost', {size: 12, class: 'w-3 h-3 text-green-400 shrink-0'})}
      <div class="text-[0.75rem] text-primary truncate flex-1">${escapeHtml(r.paperTitle || r.paperLink)}</div>
      <span class="text-[0.65rem] text-dimmest shrink-0">${timeAgo}</span>
    </a>`;
  }).join('');

  // Bottom row: only show if there's content
  const _hasBottomRow = teams.length || myComments.length || myReposts.length;

  container.innerHTML = `
    ${profileHeaderHtml}

    <!-- Stats Row -->
    ${_dashBuildStatsRow(_papersRead, _streak, _savedCount, _projectCount, _taskCount)}

    <!-- Bento Grid -->
    <div class="bento-grid">

      <!-- Daily Overview (3x1) -->
      <div class="nr-card bento-3x1">
        ${overviewHtml}
      </div>

      <!-- Quick Actions (1x1) -->
      <div class="nr-card bento-1x1" style="padding:10px">
        ${_dashBuildQuickActions()}
      </div>

      ${inboxHtml ? `<!-- Inbox -->
      <div class="nr-card bento-2x1">
        ${inboxHtml}
      </div>` : ''}

      <!-- Activity Heatmap (4x1) -->
      <div class="nr-card bento-4x1">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[0.82rem] font-semibold text-primary">Activity</h3>
          <span class="text-[0.68rem] text-dimmest">${now.getFullYear()}</span>
        </div>
        ${heatmapHtml}
        <div id="heatmap-popover" style="display:none;position:fixed;z-index:10001;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;padding:8px 0;min-width:220px;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:12px"></div>
      </div>

      <!-- Tasks or Trending -->
      ${_taskCount ? `
        <div class="nr-card bento-2x1">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.82rem] font-semibold text-primary">My Tasks</h3>
            <span class="text-[0.68rem] text-dimmest">${_taskCount} open</span>
          </div>
          ${_bentoTasksHtml}
        </div>
        <div class="nr-card bento-2x1">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.82rem] font-semibold text-primary">Trending</h3>
          </div>
          ${_dashBuildTrendingCard(_trending)}
        </div>
      ` : `
        <div class="nr-card bento-4x1">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.82rem] font-semibold text-primary">Trending</h3>
          </div>
          ${_dashBuildTrendingCard(_trending)}
        </div>
      `}

      <!-- Reading List (2x2) -->
      <div class="nr-card bento-2x2">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[0.82rem] font-semibold text-primary">Reading List</h3>
          <span class="text-[0.68rem] text-dimmest">${savedEntries.length}</span>
        </div>
        <div style="max-height:320px;overflow-y:auto" class="scrollbar-hide">
          ${readingHtml}
        </div>
      </div>

      <!-- Recent Projects (2x1) -->
      <div class="nr-card bento-2x1">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[0.82rem] font-semibold text-primary">Recent Projects</h3>
          <button onclick="openExperiments()" class="text-[0.7rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
        </div>
        <div class="flex flex-col gap-2">${expsHtml}</div>
      </div>

      <!-- Quotes (2x1) -->
      <div class="nr-card bento-2x1">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-[0.82rem] font-semibold text-primary">Quotes</h3>
          <span class="text-[0.68rem] text-dimmest">${userQuotes.length}</span>
        </div>
        <div style="max-height:180px;overflow-y:auto" class="scrollbar-hide">
          ${quotesHtml}
        </div>
      </div>

      ${_hasBottomRow ? `
        ${teams.length ? `
          <div class="nr-card ${!myComments.length && !myReposts.length ? 'bento-4x1' : myComments.length && myReposts.length ? 'bento-1x1' : 'bento-2x1'}">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-[0.82rem] font-semibold text-primary">Teams</h3>
              <button onclick="openTeams()" class="text-[0.7rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
            </div>
            ${_bentoTeamsHtml}
          </div>
        ` : ''}
        ${myComments.length ? `
          <div class="nr-card ${!teams.length && !myReposts.length ? 'bento-4x1' : teams.length && myReposts.length ? 'bento-2x1' : !teams.length ? 'bento-2x1' : 'bento-2x1'}">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-[0.82rem] font-semibold text-primary">Recent Comments</h3>
              <span class="text-[0.68rem] text-dimmest">${myComments.length}</span>
            </div>
            ${_bentoCommentsHtml}
          </div>
        ` : ''}
        ${myReposts.length ? `
          <div class="nr-card ${!teams.length && !myComments.length ? 'bento-4x1' : teams.length && myComments.length ? 'bento-1x1' : 'bento-2x1'}">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-[0.82rem] font-semibold text-primary">Reposts</h3>
              <span class="text-[0.68rem] text-dimmest">${myReposts.length}</span>
            </div>
            ${_bentoRepostsHtml}
          </div>
        ` : ''}
      ` : ''}

    </div>
  `;

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

  // ── LLM daily summary (async, streamed) ──
  const _summaryModel = localStorage.getItem('summaryModel') || 'qwen3:0.6b';
  const summaryEl = document.getElementById('dash-day-summary');
  if (summaryEl && _summaryModel && _summaryModel !== 'off') {
    // Cache key: date + interaction count + task/unread counts
    const _sumCacheKey = `${_todayKey}:${_llmActivityData.length}:${_openTaskCount}:${_unreadSavedCount}`;
    const _sumCache = JSON.parse(localStorage.getItem('daySummaryCache') || '{}');
    if (_sumCache.key === _sumCacheKey && _sumCache.text) {
      summaryEl.textContent = _sumCache.text;
    } else {
      _streamDaySummary(summaryEl, _llmActivityData, _openTaskCount, _unreadSavedCount, _todayDateStr, _summaryModel, _sumCacheKey);
    }
  } else if (summaryEl) {
    summaryEl.remove();
  }
}

// ── LLM Day Summary ──

let _dashSummaryAbort = null;

async function _streamDaySummary(el, activityLines, openTasks, unreadCount, dateStr, model, cacheKey) {
  // Abort any in-flight summary
  if (_dashSummaryAbort) { try { _dashSummaryAbort.abort(); } catch(e) {} }
  _dashSummaryAbort = new AbortController();

  const name = (_authUserInfo && (_authUserInfo.name || '').split(' ')[0]) || localStorage.getItem('userName') || 'there';
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
      localStorage.setItem('daySummaryCache', JSON.stringify({ key: cacheKey, text: text.trim() }));
    }
  } catch (e) {
    islandRemove('ai-summary');
    el.textContent = '';
  }
}

// ── Status Picker ──

let _dashStatusProfile = null;

function _openStatusPicker() {
  const picker = document.getElementById('dash-status-picker');
  if (!picker) return;
  if (!picker.classList.contains('hidden')) { picker.classList.add('hidden'); return; }

  const petTypes = (typeof _PET_TYPE_KEYS !== 'undefined') ? _PET_TYPE_KEYS : ['cat','dog','bunny','froog','blackCat','poodle','pacman'];
  const currentEmoji = _dashStatusProfile?.status_emoji || '';
  const currentText = _dashStatusProfile?.status_text || '';

  picker.classList.remove('hidden');
  picker.innerHTML = `
    <div class="p-4 rounded-lg border border-border-card bg-card">
      <div class="text-[0.78rem] text-dimmer font-medium mb-2">Pick a pet</div>
      <div class="flex gap-2 mb-3" id="status-pet-grid">
        <div class="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center text-dimmer text-sm ${!currentEmoji ? 'border-accent bg-accent/10' : 'border-border-card hover:border-accent/40'}" data-pet="" onclick="_selectStatusPet(this)" title="None">&mdash;</div>
        ${petTypes.map(t => `<div class="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center ${currentEmoji === t ? 'border-accent bg-accent/10' : 'border-border-card hover:border-accent/40'}" data-pet="${t}" onclick="_selectStatusPet(this)" title="${t}"><canvas width="24" height="24" class="status-pet-thumb" data-type="${t}" style="image-rendering:pixelated"></canvas></div>`).join('')}
      </div>
      <input type="text" id="status-text-input" value="${escapeAttr(currentText)}" placeholder="What are you up to?" maxlength="80" class="w-full bg-input border border-border-input rounded-lg px-3 py-2 text-primary text-[0.82rem] outline-none focus:border-accent mb-3">
      <div class="flex gap-2">
        <button onclick="_saveStatus()" class="px-3 py-1.5 rounded-md text-[0.78rem] bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors">Save</button>
        <button onclick="_clearStatus()" class="px-3 py-1.5 rounded-md text-[0.78rem] bg-transparent text-dimmer border border-border-card cursor-pointer hover:text-primary hover:border-accent/40 transition-colors">Clear</button>
        <button onclick="document.getElementById('dash-status-picker').classList.add('hidden')" class="px-3 py-1.5 rounded-md text-[0.78rem] bg-transparent text-dimmer border-none cursor-pointer hover:text-primary transition-colors ml-auto">Cancel</button>
      </div>
    </div>
  `;

  // Render pet thumbnails
  if (typeof _renderPetThumb === 'function') {
    picker.querySelectorAll('.status-pet-thumb').forEach(c => {
      const thumb = _renderPetThumb(c.dataset.type, 24);
      if (thumb) c.getContext('2d').drawImage(thumb, 0, 0);
    });
  }
}

function _selectStatusPet(el) {
  const grid = document.getElementById('status-pet-grid');
  if (!grid) return;
  grid.querySelectorAll('[data-pet]').forEach(d => {
    d.classList.remove('border-accent', 'bg-accent/10');
    d.classList.add('border-border-card');
  });
  el.classList.remove('border-border-card');
  el.classList.add('border-accent', 'bg-accent/10');
}

async function _saveStatus() {
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

async function _clearStatus() {
  try {
    await apiPut('/api/users/me/status', { emoji: '', text: '' });
    document.getElementById('dash-status-picker')?.classList.add('hidden');
    renderDashboard();
  } catch (e) { console.error('Clear status error', e); }
}

// ── All Saved Posts view ──
async function openAllSaved() {
  hideAllViews();
  const view = await ensureView('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'saved-all';
  setSidebarActive('sb-dashboard');
  const container = document.getElementById('dashboard-content');
  const saved = getSavedPosts();
  const entries = Object.values(saved).sort((a, b) => b.savedAt - a.savedAt);
  const backBtn = `<button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center hover:text-primary shrink-0 mb-4" onclick="openDashboard()">${icon('backArrow', {size: 16, class: 'w-4 h-4 mr-1.5'})}<span class="text-[0.82rem]">Back</span></button>`;
  const rows = entries.length ? entries.map(entry => {
    const p = entry.paper;
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
    const faviconImg = favicon
      ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
      : pixelFallback;
    const dateStr = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const rp = entry.readProgress;
    const progressBar = rp ? `<div style="height:2px;margin-top:2px;background:var(--nr-border-default);border-radius:1px;overflow:hidden"><div style="width:${Math.round(rp * 100)}%;height:100%;background:var(--nr-accent);border-radius:1px"></div></div>` : '';
    return `<div class="dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}">
      ${faviconImg}
      <div class="flex-1 min-w-0" onclick="openSavedPaper('${escapeAttr(p.link)}', event)">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
        ${progressBar}
      </div>
      ${getPaperRating(p.link) > 0 ? `<span class="shrink-0">${renderStarRating(p.link, { size: 'sm', interactive: false })}</span>` : ''}
      ${dateStr ? `<span class="text-[0.68rem] text-dimmest shrink-0">${dateStr}</span>` : ''}
      <button class="dash-offline shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none${isPostCached(p.link) ? ' cached' : ''}" title="${isPostCached(p.link) ? 'Saved offline' : 'Save offline'}" onclick="event.stopPropagation(); if(!isPostCached('${escapeAttr(p.link)}')) cachePostOffline('${escapeAttr(p.link)}', ${escapeAttr(JSON.stringify(p))}, this)">${isPostCached(p.link) ? _offlineCachedIcon() : _offlineDownloadIcon()}</button>
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--nr-text-quaternary);font-size:1rem" onclick="event.stopPropagation(); dashRemoveSaved('${escapeAttr(p.link)}'); openAllSaved()" title="Remove">&times;</button>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';
  container.innerHTML = `${backBtn}<h2 class="text-[1.3rem] font-semibold text-white_ mb-4">Reading List <span class="text-dim font-normal text-[0.9rem]">(${entries.length})</span></h2>${rows}`;
}

// ── Dev Stats ──

let _devFpsRaf = null;

var _devChartId = 0;
var _devChartRegistry = [];

// Dev panel navigation structure
const DEV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'function-registry', label: 'Function Registry' },
  { id: 'feed-validator', label: 'Feed Validator' },
  { id: 'load-order', label: 'Load Order' },
  { id: 'dependency-graph', label: 'Dependency Graph' },
  { id: 'git-log', label: 'Git Log' },
  { id: 'tools', label: 'Dev Tools' }
];

var _devActiveSection = null;
var _devD3Loaded = false;
var _devGraphLevel = 'file'; // 'file' or 'function'
var _devGraphData = null;

function _devLineChart(hist, yKey, label, color, tooltipFn) {
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

function _devBindCharts() {
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

function _devRelativeTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function renderDevPanel() {
  if (_devFpsRaf) { cancelAnimationFrame(_devFpsRaf); _devFpsRaf = null; }

  const sidebar = document.getElementById('dev-sidebar');
  const contentPane = document.getElementById('dev-content-pane');
  if (!sidebar || !contentPane) return;

  // Load active section from localStorage or default to 'overview'
  if (!_devActiveSection) {
    _devActiveSection = localStorage.getItem('devPanelSection') || 'overview';
  }

  // Render sidebar navigation
  sidebar.innerHTML = DEV_SECTIONS.map(section => {
    const isActive = section.id === _devActiveSection;
    return `<div
      onclick="_devNavigateTo('${section.id}')"
      style="
        padding:12px 16px;
        cursor:pointer;
        border-left:3px solid ${isActive ? 'var(--nr-accent)' : 'transparent'};
        background:${isActive ? 'var(--nr-bg-raised)' : 'transparent'};
        color:${isActive ? 'var(--nr-text-primary)' : 'var(--nr-text-secondary)'};
        font-size:0.8rem;
        font-weight:${isActive ? '600' : '400'};
        transition:all var(--motion-fast) var(--motion-smooth);
        border-radius:${isActive ? '0' : '0'};
      "
      onmouseover="if ('${section.id}' !== '${_devActiveSection}') this.style.background='var(--nr-bg-raised)'"
      onmouseout="if ('${section.id}' !== '${_devActiveSection}') this.style.background='transparent'"
    >
      ${section.label}
    </div>`;
  }).join('');

  // Render active section content
  renderDevSection(_devActiveSection);
}

function _devNavigateTo(sectionId) {
  _devActiveSection = sectionId;
  localStorage.setItem('devPanelSection', sectionId);
  renderDevPanel();
}

function renderDevSection(sectionId) {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = '<div class="text-sm" style="color:var(--nr-text-quaternary)">Loading…</div>';

  switch (sectionId) {
    case 'overview':
      _renderDevOverview();
      break;
    case 'function-registry':
      _renderDevFunctionRegistry();
      break;
    case 'feed-validator':
      _renderDevFeedValidator();
      break;
    case 'load-order':
      _renderDevLoadOrder();
      break;
    case 'dependency-graph':
      _renderDevDependencyGraph();
      break;
    case 'git-log':
      _renderDevGitLog();
      break;
    case 'tools':
      _renderDevTools();
      break;
    default:
      contentPane.innerHTML = '<div class="text-sm" style="color:var(--nr-text-quaternary)">Unknown section</div>';
  }
}

// ── Overview Section ──
async function _renderDevOverview() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Project Health</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">Real-time metrics and performance monitoring</p>
    </div>
    <div class="dev-stats-cards" id="dev-stats-cards"></div>
    <div id="dev-loc-chart"></div>
  `;

  const cards = document.getElementById('dev-stats-cards');
  const chart = document.getElementById('dev-loc-chart');

  cards.innerHTML = '<div class="text-sm" style="color:var(--nr-text-quaternary)">Loading…</div>';

  let data;
  try {
    data = await apiGet('/api/dev-stats');
    if (data.error) throw new Error(data.error);
  } catch (e) {
    cards.innerHTML = `<div class="text-sm" style="color:var(--nr-text-quaternary)">Error: ${e.message}</div>`;
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
  cards.innerHTML = stats.map(s =>
    `<div class="dev-stat-card">
      <div class="dev-stat-value" ${s.id ? `id="${s.id}"` : ''}>${s.value}</div>
      <div class="dev-stat-label">${s.label}</div>
    </div>`
  ).join('');

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

  chart.innerHTML = `<div class="dev-charts-grid">
    <div class="dev-loc-chart">${locChart}</div>
    <div class="dev-loc-chart">${commitsChart}</div>
    <div class="dev-loc-chart">${toolChart}</div>
    <div class="dev-loc-chart">${aetherChart}</div>
  </div>`;
  _devBindCharts();
}

// ── Function Registry Section ──
function _renderDevFunctionRegistry() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Function Registry</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">
        Analyze global functions, duplicates, and unused code across all vanilla JS files.
      </p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button onclick="_devRunFunctionRegistry()" id="dev-fn-reg-btn" class="dev-btn-primary">Analyze Functions</button>
      <button onclick="_devOpenFunctionRegistryReport()" class="dev-btn-secondary">Open HTML Report</button>
      <span id="dev-fn-reg-status" style="color:var(--nr-text-quaternary);font-size:0.7rem"></span>
    </div>
    <div id="dev-fn-reg-results"></div>
  `;
}

// ── Feed Validator Section ──
function _renderDevFeedValidator() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Feed Catalog Validator</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">
        Validate sync between JS (core.js) and Python (feed_catalog.py) feed catalogs.
      </p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <button onclick="_devRunFeedValidator()" id="dev-feed-val-btn" class="dev-btn-primary">Run Validation</button>
      <span id="dev-feed-val-status" style="color:var(--nr-text-quaternary);font-size:0.7rem"></span>
    </div>
    <div id="dev-feed-val-results"></div>
  `;
}

// ── Load Order Section ──
function _renderDevLoadOrder() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Script Load Order</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">
        Analyze script dependencies and detect forward references or circular dependencies.
      </p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <button onclick="_devRunLoadOrderAnalysis()" id="dev-load-ord-btn" class="dev-btn-primary">Run Analysis</button>
      <span id="dev-load-ord-status" style="color:var(--nr-text-quaternary);font-size:0.7rem"></span>
    </div>
    <div id="dev-load-ord-results"></div>
  `;
}

// ── Dependency Graph Section ──
function _renderDevDependencyGraph() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Dependency Graph</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">
        Interactive dependency visualization. Switch between file-level and function-level views.
      </p>
    </div>

    <!-- Controls Row 1: Load & Level Toggle -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button onclick="_devLoadDependencyGraph()" id="dev-dep-graph-btn" class="dev-btn-primary">Load Graph</button>

      <div style="display:flex;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;overflow:hidden">
        <button onclick="_devSetGraphLevel('file')" id="dev-graph-level-file" style="background:var(--nr-accent);color:#fff;border:none;padding:6px 14px;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all var(--motion-fast) var(--motion-smooth)">Files</button>
        <button onclick="_devSetGraphLevel('function')" id="dev-graph-level-function" style="background:transparent;color:var(--nr-text-primary);border:none;padding:6px 14px;font-size:0.75rem;cursor:pointer;transition:all var(--motion-fast) var(--motion-smooth)">Functions</button>
      </div>

      <button onclick="_devResetGraphZoom()" id="dev-graph-reset-btn" class="dev-btn-secondary" style="display:none">Reset Zoom</button>
      <span id="dev-dep-graph-status" style="color:var(--nr-text-quaternary);font-size:0.7rem"></span>
    </div>

    <!-- Controls Row 2: Search & Filters (for function view) -->
    <div id="dev-graph-function-controls" style="display:none;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <input type="text" id="dev-graph-search" placeholder="Search functions..." class="dev-input" oninput="_devGraphSearch(this.value)">
      <select id="dev-graph-file-filter" onchange="_devGraphFilterByFile(this.value)" class="dev-input">
        <option value="">All Files</option>
      </select>
      <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--nr-text-quaternary)">
        <input type="checkbox" id="dev-graph-show-unused" onchange="_devGraphToggleUnused(this.checked)">
        Show unused
      </label>
    </div>

    <!-- Legend -->
    <div style="display:flex;gap:16px;margin-bottom:12px;font-size:0.65rem;color:var(--nr-text-quaternary);flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:4px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444"></span>
        Cross-file dependency
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--nr-text-quaternary)"></span>
        Same-file dependency
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--nr-accent)"></span>
        File group
      </div>
      <div style="margin-left:8px">Click to expand/collapse</div>
    </div>

    <div id="dev-dep-graph-container" style="background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;padding:16px;max-height:600px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:1.6">
      <div style="color:var(--nr-text-quaternary)">Click "Load Graph" to start...</div>
    </div>
  `;
}

function _devSetGraphLevel(level) {
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

async function _devLoadDependencyGraph() {
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

var _devCollapsedFiles = new Set();

function _devRenderFileTree(nodes, edges) {
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

  let html = '<div style="color:var(--nr-text-primary)">';
  html += `<div style="margin-bottom:12px;display:flex;gap:8px">`;
  html += `<button onclick="_devExpandAllFiles()" style="background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Expand All</button>`;
  html += `<button onclick="_devCollapseAllFiles()" style="background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Collapse All</button>`;
  html += `</div>`;

  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const isCollapsed = _devCollapsedFiles.has(node.id);
    const nodeDeps = deps.get(node.id) || [];

    html += `<div style="margin-bottom:4px">`;
    html += `<div onclick="_devToggleFileInFileView('${node.id}')" style="cursor:pointer">`;
    html += `<span style="color:var(--nr-accent)">${isCollapsed ? '▶' : '▼'}</span> `;
    html += `<span style="color:var(--nr-text-primary);font-weight:600">${node.id}</span>`;
    html += `<span style="color:var(--nr-text-quaternary);margin-left:12px;font-size:11px">${node.functions} funcs, ${node.loc} LOC</span>`;
    html += `</div>`;

    if (!isCollapsed && nodeDeps.length > 0) {
      const topDeps = nodeDeps.slice(0, 5);
      html += `<div style="margin-left:24px;color:var(--nr-text-quaternary);font-size:11px;margin-top:2px">`;
      topDeps.forEach((dep, j) => {
        html += `<div>→ ${dep.target} <span style="opacity:0.7">(${dep.calls}× calls)</span></div>`;
      });
      if (nodeDeps.length > 5) html += `<div>→ +${nodeDeps.length - 5} more dependencies...</div>`;
      html += `</div>`;
    }
    html += `</div>`;

    if (!isLast) html += `<div style="color:var(--nr-border-default);margin-left:5px">│</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function _devToggleFileInFileView(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'file') {
    _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

function _devExpandAllFiles() {
  _devCollapsedFiles.clear();
  if (_devGraphData) {
    if (_devGraphLevel === 'file') {
      _devRenderFileTree(_devGraphData.nodes, _devGraphData.edges);
    } else {
      _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
    }
  }
}

function _devCollapseAllFiles() {
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

function _devRenderFunctionTree(allNodes, allEdges) {
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

  let html = '<div style="color:var(--nr-text-primary)">';
  html += `<div style="margin-bottom:12px;display:flex;gap:8px">`;
  html += `<button onclick="_devExpandAllFiles()" style="background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Expand All</button>`;
  html += `<button onclick="_devCollapseAllFiles()" style="background:var(--nr-bg-raised);color:var(--nr-text-primary);border:1px solid var(--nr-border-default);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Collapse All</button>`;
  html += `</div>`;

  Object.keys(fileGroups).sort().forEach((file) => {
    const isCollapsed = _devCollapsedFiles.has(file);
    const funcs = fileGroups[file];

    html += `<div style="margin-bottom:8px">`;
    html += `<div onclick="_devToggleFile('${file}')" style="cursor:pointer;color:var(--nr-accent);font-weight:600;margin-bottom:4px">`;
    html += `${isCollapsed ? '▶' : '▼'} 📁 ${file} <span style="font-weight:normal;color:var(--nr-text-quaternary);font-size:11px">(${funcs.length} functions)</span>`;
    html += `</div>`;

    if (!isCollapsed) {
      funcs.forEach((func, i) => {
        const isLast = i === funcs.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const funcDeps = deps.get(func.id) || [];
        const crossFileDeps = funcDeps.filter(d => {
          const target = allNodes.find(n => n.id === d.target);
          return target && target.file !== func.file;
        });

        html += `<div style="margin-left:16px;margin-bottom:2px">`;
        html += `<span style="color:var(--nr-border-default)">${prefix}</span> `;
        html += `<span style="color:${func.callCount > 10 ? 'var(--nr-accent)' : 'var(--nr-text-primary)'}">${func.id}</span>`;
        html += `<span style="color:var(--nr-text-quaternary);margin-left:8px;font-size:10px">`;
        html += `${func.callCount}× called`;
        if (crossFileDeps.length > 0) {
          html += ` • ${crossFileDeps.length} cross-file`;
        }
        html += `</span>`;

        if (crossFileDeps.length > 0) {
          const topDeps = crossFileDeps.slice(0, 2);
          html += `<div style="margin-left:32px;color:var(--nr-text-quaternary);font-size:10px">`;
          topDeps.forEach(dep => {
            const target = allNodes.find(n => n.id === dep.target);
            html += `<span style="color:#ef4444">→</span> ${dep.target} <span style="opacity:0.7">(${target?.file})</span> `;
          });
          if (crossFileDeps.length > 2) html += `+${crossFileDeps.length - 2} more`;
          html += `</div>`;
        }
        html += `</div>`;

        if (!isLast) {
          html += `<div style="margin-left:16px;color:var(--nr-border-default)">│</div>`;
        }
      });
    }
    html += `</div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function _devToggleFile(file) {
  if (_devCollapsedFiles.has(file)) {
    _devCollapsedFiles.delete(file);
  } else {
    _devCollapsedFiles.add(file);
  }
  if (_devGraphData && _devGraphLevel === 'function') {
    _devRenderFunctionTree(_devGraphData.nodes, _devGraphData.edges);
  }
}

function _devGraphSearch(query) {
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

function _devGraphFilterByFile(file) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

function _devGraphToggleUnused(show) {
  if (!_devGraphData || _devGraphLevel !== 'function') return;
  _devRenderFunctionGraph(_devGraphData.nodes, _devGraphData.edges);
}

// ── Git Log Section ──
async function _renderDevGitLog() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Git History</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">Recent commit activity</p>
    </div>
    <div id="dev-git-log-container"></div>
  `;

  const container = document.getElementById('dev-git-log-container');
  container.innerHTML = '<div class="text-sm" style="color:var(--nr-text-quaternary)">Loading…</div>';

  try {
    const data = await apiGet('/api/dev-stats');
    const log = data.git_log || [];

    if (log.length) {
      container.innerHTML = `
        <div class="dev-git-log-list" id="dev-git-log-list">${_devRenderCommitRows(log)}</div>
      `;
      _devGitLogOffset = log.length;
      if (log.length >= 20) _devAppendLoadMoreBtn();
    } else {
      container.innerHTML = '<div class="text-sm" style="color:var(--nr-text-quaternary)">No commits found</div>';
    }
  } catch (e) {
    container.innerHTML = `<div class="text-sm" style="color:var(--nr-text-quaternary)">Error: ${e.message}</div>`;
  }
}

// ── Dev Tools Section ──
function _renderDevTools() {
  const contentPane = document.getElementById('dev-content-pane');
  if (!contentPane) return;

  contentPane.innerHTML = `
    <div style="margin-bottom:24px">
      <h2 style="color:var(--nr-text-primary);font-size:1.25rem;font-weight:700;margin:0 0 4px 0">Dev Tools</h2>
      <p style="color:var(--nr-text-quaternary);font-size:0.75rem;margin:0">Testing utilities and debugging tools</p>
    </div>
    <div style="background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;padding:16px">
      <div style="color:var(--nr-text-primary);font-size:0.85rem;font-weight:600;margin-bottom:12px">Achievement Tester</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap" id="dev-ach-tester">
        <select id="dev-ach-select" class="dev-input" style="min-width:180px">
          <option value="bookworm">Bookworm</option>
          <option value="curator">Curator</option>
          <option value="critic">Critic</option>
          <option value="explorer">Explorer</option>
          <option value="model_switch">Model Swapper</option>
          <option value="its_alive">It's Alive!</option>
          <option value="pixel_parent">Pixel Parent</option>
        </select>
        <button onclick="_devTestAchievement()" style="background:linear-gradient(135deg,#b8860b,#ffd700);color:#1a1400;border:none;border-radius:6px;padding:6px 14px;font-size:0.75rem;font-weight:600;cursor:pointer;transition:opacity 0.2s">Show</button>
        <button onclick="islandRemove('achievement')" class="dev-btn-secondary">Dismiss</button>
        <button onclick="_devResetAchievements()" class="dev-btn-secondary">Reset All</button>
      </div>
    </div>
  `;
}

var _devAchievements = {
  bookworm:     { name: 'Bookworm',      desc: 'Saved your first post' },
  curator:      { name: 'Curator',       desc: 'Curated your feed by hiding a post' },
  critic:       { name: 'Critic',        desc: 'Rated your first paper' },
  explorer:     { name: 'Explorer',      desc: 'Enabled a new feed source' },
  model_switch: { name: 'Model Swapper', desc: 'Switched your AI model for the first time' },
  its_alive:    { name: "It's Alive!",   desc: 'Ran an experiment kernel for the first time' },
  pixel_parent: { name: 'Pixel Parent',  desc: 'Adopted your pixel pet' },
  gaze_master:  { name: 'Gaze Master',  desc: 'Trained your eye-tracking model 5 times' }
};

function _devTestAchievement() {
  const sel = document.getElementById('dev-ach-select');
  if (!sel) return;
  const ach = _devAchievements[sel.value];
  if (!ach) return;
  islandRemove('achievement');
  setTimeout(function() { showAchievement(ach.name, ach.desc); }, 50);
}

function _devResetAchievements() {
  const keys = ['ach_bookworm', 'ach_curator', 'ach_critic', 'ach_explorer', 'ach_model_switch', 'ach_its_alive', 'ach_pixel_parent', 'ach_gaze_master'];
  keys.forEach(function(k) { localStorage.removeItem(k); });
  islandRemove('achievement');
}

async function _devRunFunctionRegistry() {
  const btn = document.getElementById('dev-fn-reg-btn');
  const status = document.getElementById('dev-fn-reg-status');
  const results = document.getElementById('dev-fn-reg-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  results.innerHTML = '';

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

    results.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:8px">
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-accent)">${summary.totalFunctions}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Functions</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:${summary.duplicateFunctions > 0 ? '#f59e0b' : 'var(--nr-text-primary)'}">${summary.duplicateFunctions}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Duplicates</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:${summary.unusedFunctions > 0 ? '#ef4444' : 'var(--nr-text-primary)'}">${summary.unusedFunctions}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Unused</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-text-primary)">${summary.totalFiles}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Files</div>
        </div>
      </div>

      ${data.issues.duplicates.length > 0 ? `
        <div style="margin-top:16px;padding:8px 12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px">
          <div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">
            Severity Breakdown:
            <span style="color:#ef4444;margin-left:12px">${errorCount} ERROR</span>
            <span style="color:#f59e0b;margin-left:8px">${warningCount} WARNING</span>
            <span style="color:#60a5fa;margin-left:8px">${infoCount} INFO</span>
          </div>
        </div>
      ` : ''}

      ${errorCount > 0 ? `
        <div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #ef4444">
          <div style="color:#ef4444;font-size:0.75rem;font-weight:600;margin-bottom:8px">ERROR: Global Naming Conflicts (${errorCount})</div>
          ${dupsBySeverity.ERROR.slice(0, 5).map(dup => `
            <div style="margin-bottom:8px;font-size:0.65rem">
              <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code>
              <div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">
                ${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}
              </div>
            </div>
          `).join('')}
          ${errorCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${errorCount - 5} more</div>` : ''}
        </div>
      ` : ''}

      ${warningCount > 0 ? `
        <div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b">
          <div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Same-Scope Duplicates (${warningCount})</div>
          ${dupsBySeverity.WARNING.slice(0, 5).map(dup => `
            <div style="margin-bottom:8px;font-size:0.65rem">
              <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code>
              <div style="color:var(--nr-text-quaternary);margin-top:4px;margin-left:8px">
                ${dup.definitions.map(def => `${def.file}:${def.line}`).join(', ')}
              </div>
            </div>
          `).join('')}
          ${warningCount > 5 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${warningCount - 5} more</div>` : ''}
        </div>
      ` : ''}

      ${infoCount > 0 ? `
        <details style="margin-top:12px">
          <summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;border-left:3px solid #60a5fa;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600">
            ℹ️ INFO: Nested Duplicates (${infoCount}) - Safe, intentional
          </summary>
          <div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px">
            ${dupsBySeverity.INFO.slice(0, 10).map(dup => `
              <div style="margin-bottom:8px;font-size:0.65rem">
                <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px">${escapeHtml(dup.name)}()</code>
                <span style="color:var(--nr-text-quaternary);margin-left:8px">(${dup.definitions.length} definitions)</span>
              </div>
            `).join('')}
            ${infoCount > 10 ? `<div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-top:8px">...and ${infoCount - 10} more</div>` : ''}
          </div>
        </details>
      ` : ''}

      ${data.issues.unused.length > 0 ? `
        <div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px">
          <div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">🗑️ Unused Functions (${data.issues.unused.length})</div>
          <div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:150px;overflow-y:auto">
            ${data.issues.unused.slice(0, 10).map(u => `<code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-right:8px;margin-bottom:4px;display:inline-block">${escapeHtml(u.name)}()</code>`).join('')}
            ${data.issues.unused.length > 10 ? `<div style="margin-top:8px">...and ${data.issues.unused.length - 10} more</div>` : ''}
          </div>
        </div>
      ` : ''}

      ${Object.entries(data.functions).sort((a, b) => b[1].callCount - a[1].callCount).slice(0, 5).length > 0 ? `
        <div style="margin-top:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px">
          <div style="color:var(--nr-text-primary);font-size:0.7rem;font-weight:600;margin-bottom:8px">🔥 Most Called Functions</div>
          ${Object.entries(data.functions).sort((a, b) => b[1].callCount - a[1].callCount).slice(0, 5).map(([name, info], i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:0.65rem">
              <span>
                <span style="color:var(--nr-accent);font-weight:600">#${i + 1}</span>
                <code style="color:#60a5fa;background:var(--nr-bg-raised);padding:2px 6px;border-radius:3px;margin-left:8px">${escapeHtml(name)}()</code>
              </span>
              <span style="color:var(--nr-text-quaternary)">${info.callCount} calls</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze Functions';
  }
}

function _devOpenFunctionRegistryReport() {
  if (window.electronAPI && window.electronAPI.openExternal) {
    const path = require('path');
    const reportPath = path.join(process.cwd(), 'coverage', 'function-registry.html');
    window.electronAPI.openExternal('file://' + reportPath);
  } else {
    window.open('../coverage/function-registry.html', '_blank');
  }
}

async function _devRunFeedValidator() {
  const btn = document.getElementById('dev-feed-val-btn');
  const status = document.getElementById('dev-feed-val-status');
  const results = document.getElementById('dev-feed-val-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Validating...';
  status.textContent = 'Running validation...';
  results.innerHTML = '';

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

    results.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:8px;margin-bottom:16px">
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-accent)">${data.jsCatalogSize}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">JS Entries</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-accent)">${data.pyCatalogSize}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">PY Entries</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:${isSync ? '#34d399' : '#ef4444'}">${data.errorCount}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Mismatches</div>
        </div>
      </div>

      ${data.errorCount > 0 ? `
        ${_devRenderFeedValidatorErrors(data.errors)}
      ` : `
        <div style="padding:24px;text-align:center;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px">
          <div style="width:48px;height:48px;margin:0 auto 12px;border-radius:50%;background:#34d399;display:flex;align-items:center;justify-content:center">
            ${icon('check', {size: 24, stroke: 'white', strokeWidth: '3'})}
          </div>
          <div style="color:var(--nr-text-primary);font-size:0.85rem;font-weight:600">All ${data.jsCatalogSize} feed entries are in sync!</div>
          <div style="color:var(--nr-text-quaternary);font-size:0.7rem;margin-top:4px">JS and Python catalogs match perfectly.</div>
        </div>
      `}
    `;
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Validation';
  }
}

function _devRenderFeedValidatorErrors(errors) {
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

async function _devRunLoadOrderAnalysis() {
  const btn = document.getElementById('dev-load-ord-btn');
  const status = document.getElementById('dev-load-ord-status');
  const results = document.getElementById('dev-load-ord-results');
  if (!btn || !status || !results) return;

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  status.textContent = 'Running analysis...';
  results.innerHTML = '';

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

    results.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:8px;margin-bottom:16px">
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-accent)">${data.scriptCount}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Scripts</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:${data.warnings.length > 0 ? '#f59e0b' : 'var(--nr-text-primary)'}">${data.warnings.length}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Warnings</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-text-quaternary)">${data.infos.length}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Info</div>
        </div>
        <div class="dev-stat-card" style="padding:12px">
          <div class="dev-stat-value" style="font-size:24px;color:var(--nr-text-primary)">${data.cycles.length}</div>
          <div class="dev-stat-label" style="font-size:0.65rem">Circular Deps</div>
        </div>
      </div>

      <details open style="margin-bottom:12px">
        <summary style="padding:10px 14px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.75rem;font-weight:600;transition:all var(--motion-fast) var(--motion-smooth)">
          Script Load Order (${data.scriptCount} files)
        </summary>
        <div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px;max-height:300px;overflow-y:auto">
          ${data.scriptOrder.map((script, i) => `
            <div style="font-size:0.65rem;color:var(--nr-text-quaternary);margin-bottom:2px;font-family:monospace">
              <span style="color:var(--nr-accent);font-weight:600">${i + 1}.</span>
              <span style="margin-left:8px">${escapeHtml(script)}</span>
            </div>
          `).join('')}
        </div>
      </details>

      ${data.warnings.length > 0 ? `
        <div style="margin-bottom:12px;padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:8px;border-left:3px solid #f59e0b">
          <div style="color:#f59e0b;font-size:0.75rem;font-weight:600;margin-bottom:8px">WARNING: Forward References (may cause issues)</div>
          <div style="color:var(--nr-text-quaternary);font-size:0.65rem;max-height:200px;overflow-y:auto">
            ${data.warnings.slice(0, 10).map(ref => `
              <div style="margin-bottom:8px;padding:8px;background:var(--nr-bg-raised);border-radius:4px">
                <div><strong>${ref.callFile}</strong> (order ${ref.callOrder}) calls <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code></div>
                <div style="margin-top:4px;color:var(--nr-text-quaternary)">→ Defined in <strong>${ref.defFile}</strong> (order ${ref.defOrder})</div>
              </div>
            `).join('')}
            ${data.warnings.length > 10 ? `<div style="margin-top:8px">...and ${data.warnings.length - 10} more</div>` : ''}
          </div>
        </div>
      ` : ''}

      ${data.infos.length > 0 ? `
        <details style="margin-bottom:12px">
          <summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:#60a5fa;font-size:0.7rem;font-weight:600;border-left:3px solid #60a5fa">
            ℹ️ Forward References (INFO - ${data.infos.length}) - Safe with defer
          </summary>
          <div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px">
            <div style="color:var(--nr-text-quaternary);font-size:0.65rem;margin-bottom:8px">
              These forward references are safe because scripts use defer attribute and functions are called inside other functions or event handlers.
            </div>
            <div style="color:var(--nr-text-quaternary);font-size:0.65rem">
              ${data.infos.slice(0, 5).map(ref => `
                <div style="margin-bottom:4px">
                  ${ref.callFile} → <code style="color:#60a5fa">${escapeHtml(ref.funcName)}()</code> → ${ref.defFile}
                </div>
              `).join('')}
              ${data.infos.length > 5 ? `<div style="margin-top:8px">...and ${data.infos.length - 5} more</div>` : ''}
            </div>
          </div>
        </details>
      ` : ''}

      ${data.cycles.length > 0 ? `
        <details style="margin-bottom:12px">
          <summary style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-radius:6px;cursor:pointer;color:var(--nr-text-primary);font-size:0.7rem;font-weight:600">
            🔄 Circular Dependencies (${data.cycles.length})
          </summary>
          <div style="padding:12px;background:var(--nr-bg-surface);border:1px solid var(--nr-border-default);border-top:none;border-radius:0 0 6px 6px">
            <div style="color:var(--nr-text-quaternary);font-size:0.65rem">
              ${data.cycles.slice(0, 10).map(cycle => `
                <div style="margin-bottom:4px">${cycle.join(' → ')}</div>
              `).join('')}
              ${data.cycles.length > 10 ? `<div style="margin-top:8px">...and ${data.cycles.length - 10} more</div>` : ''}
            </div>
          </div>
        </details>
      ` : ''}
    `;
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = 'var(--nr-text-error, #ef4444)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Analysis';
  }
}

var _devGitLogOffset = 0;

function _devRenderCommitRows(log) {
  return log.map(c => {
    const d = new Date(c.date);
    const relative = _devRelativeTime(d);
    const diffStr = (c.ins || c.del) ? `<span class="dev-git-log-diff"><span style="color:#3fb950">+${c.ins}</span> <span style="color:#f85149">-${c.del}</span></span>` : '';
    return `<div class="dev-git-log-item">
      <span class="dev-git-log-sha">${c.sha}</span>
      <span class="dev-git-log-msg">${escapeHtml(c.message)}</span>
      ${diffStr}
      <span class="dev-git-log-meta">${relative}</span>
    </div>`;
  }).join('');
}

function _devAppendLoadMoreBtn() {
  const list = document.getElementById('dev-git-log-list');
  if (!list) return;
  const old = document.getElementById('dev-git-load-more');
  if (old) old.remove();
  const btn = document.createElement('button');
  btn.id = 'dev-git-load-more';
  btn.className = 'dev-git-load-more-btn';
  btn.textContent = 'Load more commits';
  btn.onclick = () => _devLoadMoreCommits(btn);
  list.after(btn);
}

async function _devLoadMoreCommits(btn) {
  btn.textContent = 'Loading…';
  btn.disabled = true;
  try {
    const data = await apiGet(`/api/dev-git-log?offset=${_devGitLogOffset}&limit=20`);
    const log = data.git_log || [];
    if (log.length) {
      const list = document.getElementById('dev-git-log-list');
      if (list) list.insertAdjacentHTML('beforeend', _devRenderCommitRows(log));
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

