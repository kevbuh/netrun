// ── Dashboard ──

let _dashYear, _dashMonth;
{
  const _n = new Date();
  _dashYear = _n.getFullYear();
  _dashMonth = _n.getMonth();
}

let _dashSearchDebounce = null;

function dashboardSearchInput() {
  clearTimeout(_dashSearchDebounce);
  _dashSearchDebounce = setTimeout(() => {
    const input = document.getElementById('dashboard-search');
    const query = (input?.value || '').trim();
    const dropdown = document.getElementById('dashboard-search-results');
    if (!dropdown) return;
    if (!query) { dropdown.style.display = 'none'; return; }
    _renderDashSearchResults(query, dropdown);
  }, 150);
}

function dashboardSearchSubmit() {
  const input = document.getElementById('dashboard-search');
  const query = (input?.value || '').trim();
  if (!query) return;
  _dashSearchGoToSearch(query);
}

function _dashSearchGoToSearch(query) {
  document.getElementById('dashboard-search-results')?.style.setProperty('display', 'none');
  openSearch();
  const searchInput = document.getElementById('search-query');
  if (searchInput) { searchInput.value = query; submitSearch(); }
}

function _dashSearchGoToArxiv(query) {
  document.getElementById('dashboard-search-results')?.style.setProperty('display', 'none');
  openSearch();
  const searchInput = document.getElementById('search-query');
  if (searchInput) { searchInput.value = query; submitSearch(); }
}

function _dashSearchWebSearch(query) {
  document.getElementById('dashboard-search-results')?.style.setProperty('display', 'none');
  openBrowse(query);
}

async function _dashSearchUsers(query, placeholderId) {
  try {
    const resp = await fetch('/api/users?q=' + encodeURIComponent(query), { headers: _authHeaders() });
    if (!resp.ok) return;
    const users = (await resp.json()).slice(0, 4);
    const el = document.getElementById(placeholderId);
    if (!el || !users.length) return;
    let html = `<div class="px-3 pt-2 pb-1 text-[0.65rem] text-dimmer uppercase tracking-wide font-semibold">Users</div>`;
    html += users.map(u => {
      const pic = u.picture ? `<img src="${escapeAttr(u.picture)}" class="w-5 h-5 rounded-full shrink-0" onerror="this.style.display='none'">` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-pink-400 shrink-0"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      return `<a href="#user/${encodeURIComponent(u.username)}" class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" style="text-decoration:none" onclick="document.getElementById('dashboard-search-results').style.display='none'">
        ${pic}
        <div class="text-primary text-[0.82rem] truncate">${escapeHtml(u.username)}</div>
      </a>`;
    }).join('');
    el.innerHTML = html;
  } catch (e) { /* ignore */ }
}

function _renderDashSearchResults(query, dropdown) {
  const q = query.toLowerCase();

  // Search experiments
  const exps = (typeof allExperiments !== 'undefined' ? allExperiments : [])
    .filter(e => e.title?.toLowerCase().includes(q) || (e.desc || '').toLowerCase().includes(q))
    .slice(0, 4);

  // Search papers (from feed cache)
  const papers = (typeof allPapers !== 'undefined' ? allPapers : [])
    .filter(p => p.title?.toLowerCase().includes(q) || (p.authors || '').toLowerCase().includes(q))
    .slice(0, 4);

  // Search saved papers
  const saved = JSON.parse(localStorage.getItem('savedPosts') || '{}');
  const savedPapers = Object.values(saved)
    .filter(s => s.paper?.title?.toLowerCase().includes(q))
    .map(s => s.paper)
    .filter(p => !papers.some(fp => fp.link === p.link))
    .slice(0, 3);

  // Search teams
  const teams = (_cachedTeams || [])
    .filter(t => t.name?.toLowerCase().includes(q))
    .slice(0, 3);

  const hasResults = exps.length || papers.length || savedPapers.length || teams.length;

  let html = '';

  // Projects section
  if (exps.length) {
    html += `<div class="px-3 pt-2 pb-1 text-[0.65rem] text-dimmer uppercase tracking-wide font-semibold">Projects</div>`;
    html += exps.map(e => `
      <a href="#experiment/${encodeURIComponent(e.id)}" class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" style="text-decoration:none" onclick="document.getElementById('dashboard-search-results').style.display='none'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-purple-400 shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div class="min-w-0 flex-1">
          <div class="text-primary text-[0.82rem] truncate">${escapeHtml(e.title || e.id)}</div>
          ${e.desc ? `<div class="text-dimmer text-[0.7rem] truncate">${escapeHtml(e.desc)}</div>` : ''}
        </div>
      </a>`).join('');
  }

  // Papers section (feed + saved)
  const allPaperResults = [...papers, ...savedPapers];
  if (allPaperResults.length) {
    html += `<div class="px-3 pt-2 pb-1 text-[0.65rem] text-dimmer uppercase tracking-wide font-semibold">${exps.length ? '' : ''}Papers</div>`;
    html += allPaperResults.map(p => {
      const href = '#view/' + encodeURIComponent(p.link);
      return `
      <a href="${href}" class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" style="text-decoration:none" onclick="document.getElementById('dashboard-search-results').style.display='none'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-400 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="min-w-0 flex-1">
          <div class="text-primary text-[0.82rem] truncate">${escapeHtml(p.title)}</div>
          ${p.authors ? `<div class="text-dimmer text-[0.7rem] truncate">${escapeHtml(p.authors.split(',').slice(0, 2).join(', '))}${p.authors.split(',').length > 2 ? ' et al.' : ''}</div>` : ''}
        </div>
      </a>`;
    }).join('');
  }

  // Teams section
  if (teams.length) {
    html += `<div class="px-3 pt-2 pb-1 text-[0.65rem] text-dimmer uppercase tracking-wide font-semibold">Teams</div>`;
    html += teams.map(t => `
      <div class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" onclick="document.getElementById('dashboard-search-results').style.display='none'; openTeams(); showTeamDetailView(${t.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400 shrink-0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <div class="text-primary text-[0.82rem] truncate">${escapeHtml(t.name)}</div>
        ${t.private ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-dimmer shrink-0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}
      </div>`).join('');
  }

  // Users section (async, filled below)
  const usersPlaceholderId = '_dash-search-users-' + Date.now();
  html += `<div id="${usersPlaceholderId}"></div>`;

  // Divider before actions
  html += `<div class="border-t border-border-subtle my-1"></div>`;

  // Search actions (always shown)
  const eq = escapeAttr(query);
  html += `
    <div class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" onclick="_dashSearchGoToSearch('${eq}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div class="text-primary text-[0.82rem]">Search feed for <span class="text-accent font-medium">${escapeHtml(query)}</span></div>
    </div>
    <div class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" onclick="_dashSearchGoToArxiv('${eq}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-400 shrink-0"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      <div class="text-primary text-[0.82rem]">Search arXiv for <span class="text-accent font-medium">${escapeHtml(query)}</span></div>
    </div>
    <div class="flex items-center gap-2.5 px-3 py-2 hover:bg-hover transition-colors cursor-pointer" onclick="_dashSearchWebSearch('${eq}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-sky-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <div class="text-primary text-[0.82rem]">Web search for <span class="text-accent font-medium">${escapeHtml(query)}</span></div>
    </div>
  `;

  // Fetch users async
  _dashSearchUsers(query, usersPlaceholderId);

  dropdown.innerHTML = html;
  dropdown.style.display = '';
}

function _closeDashSearch(e) {
  const dropdown = document.getElementById('dashboard-search-results');
  const input = document.getElementById('dashboard-search');
  if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = 'none';
  }
}

async function dashToggleTask(teamId, todoId, done) {
  try {
    await fetch(`/api/teams/${teamId}/todos/${todoId}`, {
      method: 'PUT',
      headers: _authHeaders(),
      body: JSON.stringify({ done })
    });
    renderDashboard();
  } catch (err) { /* ignore */ }
}

function dashRemoveSaved(link) {
  toggleSavePostByLink(link);
  renderDashboard();
}

function dashCalNav(dir) {
  _dashMonth += dir;
  if (_dashMonth > 11) { _dashMonth = 0; _dashYear++; }
  if (_dashMonth < 0) { _dashMonth = 11; _dashYear--; }
  renderDashboard();
}

async function renderDashboard() {
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';

  const [expResp, calResp, tasksResp, teamsResp] = await Promise.all([
    fetch('/api/experiments', { headers: _authHeaders() }).then(r => r.json()).catch(() => []),
    fetch('/api/calendar', { headers: _authHeaders() }).then(r => r.json()).catch(() => []),
    fetch('/api/my-tasks', { headers: _authHeaders() }).then(r => r.json()).catch(() => []),
    fetch('/api/teams', { headers: _authHeaders() }).then(r => r.json()).catch(() => [])
  ]);

  const experiments = expResp || [];
  const events = calResp || [];
  const myTasks = tasksResp || [];
  const teams = teamsResp || [];

  const mergedSaved = getSavedPosts();

  // ── Activity heatmap (full year, GitHub-style) ──
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const heatYear = now.getFullYear();

  // Build activity items per date key (YYYY-MM-DD)
  const activityItems = {};
  const addItem = (dateStr, item) => { (activityItems[dateStr] ||= []).push(item); };
  events.forEach(ev => { if (ev.date) addItem(ev.date, { type: 'event', title: ev.title || 'Calendar event' }); });
  Object.values(mergedSaved).forEach(entry => {
    if (entry.savedAt) {
      const d = new Date(entry.savedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      addItem(key, { type: 'saved', title: entry.paper?.title || 'Saved post', link: entry.paper?.link });
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
    if (lvl === 0) return 'var(--border-card)';
    if (heatAccentAlt) {
      const c = col % 2 === 0 ? heatAccent : heatAccentAlt;
      return `color-mix(in srgb, ${c} ${lvl * 10}%, transparent)`;
    }
    if (heatAccent) return `color-mix(in srgb, ${heatAccent} ${lvl * 10}%, transparent)`;
    return `color-mix(in srgb, var(--accent) ${lvl * 10}%, transparent)`;
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
    heatmapHtml += `<text x="${labelW + m.col * (cellSize + cellGap)}" y="11" fill="var(--text-dimmer)" font-size="10" font-family="sans-serif">${m.label}</text>`;
  });
  // Day labels (Mon, Wed, Fri)
  const dayLabelMap = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
  Object.entries(dayLabelMap).forEach(([row, label]) => {
    heatmapHtml += `<text x="0" y="${monthLabelH + row * (cellSize + cellGap) + 9}" fill="var(--text-dimmest)" font-size="9" font-family="sans-serif">${label}</text>`;
  });
  // Cells
  cells.forEach(c => {
    const x = labelW + c.col * (cellSize + cellGap);
    const y = monthLabelH + c.row * (cellSize + cellGap);
    const lvl = c.isFuture ? 0 : levelFn(c.count);
    const stroke = c.isToday ? (theme.outline || 'var(--accent)') : 'none';
    const sw = c.isToday ? '1.5' : '0';
    const prettyDate = new Date(heatYear, c.month, c.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const tooltipText = c.isFuture ? prettyDate : (c.count === 0 ? `No activity on ${prettyDate}` : `${c.count} activit${c.count === 1 ? 'y' : 'ies'} on ${prettyDate}`);
    heatmapHtml += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${colorFn(lvl, c.col)}" stroke="${stroke}" stroke-width="${sw}" data-tip="${escapeAttr(tooltipText)}" data-key="${c.key}" class="heatmap-cell" style="cursor:pointer"/>`;
  });
  heatmapHtml += '</svg></div>';
  // Tooltip and popover are fixed-position, appended to body via JS
  heatmapHtml += '<div id="heatmap-tip" style="display:none;position:fixed;pointer-events:none;background:var(--bg-card);border:1px solid var(--border-card);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text-primary);white-space:nowrap;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>';
  heatmapHtml += '<div id="heatmap-popover" style="display:none;position:fixed;z-index:10001;background:var(--bg-card);border:1px solid var(--border-card);border-radius:8px;padding:8px 0;min-width:220px;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:12px"></div>';

  // Store activity items on window for click handler
  window._heatmapItems = activityItems;

  // Attach tooltip + click handlers after render
  requestAnimationFrame(() => {
    const tip = document.getElementById('heatmap-tip');
    const pop = document.getElementById('heatmap-popover');
    const svg = document.querySelector('.heatmap-svg');
    if (!svg || !tip || !pop) return;

    // Hover tooltip (fixed positioning — works with scroll)
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

    // Click popover (fixed positioning — works with scroll)
    svg.addEventListener('click', e => {
      const r = e.target.closest('.heatmap-cell');
      if (!r) return;
      const key = r.dataset.key;
      const items = window._heatmapItems[key] || [];
      const parts = key.split('-');
      const dateLabel = new Date(+parts[0], +parts[1]-1, +parts[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      if (!items.length) {
        pop.innerHTML = `<div style="padding:6px 12px;color:var(--text-dimmer)">${dateLabel}<br>No activity</div>`;
      } else {
        const icons = { event: '\u{1F4C5}', note: '\u{1F4DD}', saved: '\u{1F516}' };
        const labels = { event: 'Event', note: 'Note', saved: 'Saved' };
        let html = `<div style="padding:4px 12px 6px;color:var(--text-dimmer);font-size:11px;border-bottom:1px solid var(--border-card);margin-bottom:2px">${dateLabel}</div>`;
        items.forEach(item => {
          const icon = icons[item.type] || '';
          const tag = `<span style="font-size:9px;color:var(--text-dimmest);margin-left:4px">${labels[item.type] || ''}</span>`;
          let onclick = '';
          if (item.type === 'saved' && item.link) onclick = `onclick="openSavedPaper('${escapeAttr(item.link)}')"`;
          else if (item.type === 'event') onclick = '';
          const cursor = onclick ? 'cursor:pointer;' : '';
          html += `<div style="padding:4px 12px;${cursor}display:flex;align-items:center;gap:6px;color:var(--text-primary)" ${onclick} class="hover:bg-hover">
            <span style="flex-shrink:0">${icon}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(item.title)}</span>${tag}
          </div>`;
        });
        pop.innerHTML = html;
      }

      pop.style.display = 'block';
      const cr = r.getBoundingClientRect();
      let left = cr.left + cr.width / 2 - pop.offsetWidth / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - pop.offsetWidth - 4));
      let top = cr.bottom + 6;
      if (top + pop.offsetHeight > window.innerHeight) top = cr.top - pop.offsetHeight - 6;
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    });

    // Close popover on click outside
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
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
    const faviconImg = favicon
      ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
      : pixelFallback;
    const rp = entry.readProgress;
    const progressBar = rp ? `<div style="height:2px;margin-top:2px;background:var(--border-card);border-radius:1px;overflow:hidden"><div style="width:${Math.round(rp * 100)}%;height:100%;background:var(--accent);border-radius:1px"></div></div>` : '';
    return `<div class="dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}">
      ${faviconImg}
      <div class="flex-1 min-w-0" onclick="openSavedPaper('${escapeAttr(p.link)}')">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
        ${progressBar}
      </div>
      ${getPaperRating(p.link) > 0 ? `<span class="shrink-0">${renderStarRating(p.link, { size: 'sm', interactive: false })}</span>` : ''}
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--text-dimmer);font-size:1rem" onclick="dashRemoveSaved('${escapeAttr(p.link)}')" title="Remove">&times;</button>
    </div>`;
  };
  const readingHtml = displayedSaved.length ? displayedSaved.map(_renderSavedRow).join('') + (hasMoreSaved ? `<button onclick="openAllSaved()" class="text-[0.78rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer mt-2 px-2">View all ${savedEntries.length} saved posts</button>` : '') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';

  // ── Recent experiments ──
  const recentExps = experiments.slice(0, 4);
  const expsHtml = recentExps.length ? recentExps.map(exp => {
    const runCount = exp.runCount || 0;
    const lastUpdated = exp.lastUpdated ? new Date(exp.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return `<div class="p-3 rounded-lg border border-border-card bg-card cursor-pointer hover:border-border-input transition-colors" onclick="openExperimentDetail('${exp.id}')">
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
          <span class="text-[0.7rem] text-dimmer truncate cursor-pointer hover:text-primary" onclick="window.location.hash='view/'+encodeURIComponent('${escapeAttr(q.link)}')">${escapeHtml(q.title || hostname)}</span>
          ${dateStr ? `<span class="text-[0.68rem] text-dimmest">${dateStr}</span>` : ''}
        </div>
      </div>
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--text-dimmer);font-size:1rem" onclick="deleteUserQuote('${escapeAttr(q.id)}'); renderDashboard()" title="Remove">&times;</button>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No quotes yet. Open a page and use Post Quote in the sidebar.</div>';

  // ── My Tasks (assigned team todos) ──
  const _priColors = { high: '#f87171', medium: '#fbbf24', low: '#6ee7b7' };
  const _priLabels = { high: 'High', medium: 'Med', low: 'Low' };
  const myTasksHtml = myTasks.length ? `
    <div class="mb-5">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-[0.9rem] font-semibold text-primary">My Tasks</h3>
        <span class="text-[0.72rem] text-dimmer">${myTasks.length} open</span>
      </div>
      ${myTasks.map(t => `
        <div class="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-hover transition-colors group">
          <input type="checkbox" onchange="dashToggleTask(${t.team_id}, '${t.id}', this.checked)" class="accent-[var(--accent)] cursor-pointer" />
          <div class="flex-1 min-w-0 cursor-pointer" onclick="window.location.hash='teams'; setTimeout(()=>showTeamDetailView(${t.team_id}),100)">
            <div class="flex items-center gap-2">
              <span class="text-[0.82rem] text-primary">${escapeHtml(t.title)}</span>
              <span class="text-[0.55rem] px-1.5 py-0.5 rounded-full font-medium" style="background:${_priColors[t.priority]}20;color:${_priColors[t.priority]}">${_priLabels[t.priority]}</span>
            </div>
            <div class="text-[0.7rem] text-dimmer">${escapeHtml(t.team_name)} · from ${escapeHtml(t.author)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">${getGreeting()}</h2>

    <!-- Search bar -->
    <div class="mb-5">
      <div class="relative" id="dashboard-search-wrapper">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-dimmer pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="dashboard-search" placeholder="Search projects, papers, teams..." class="w-full bg-input border border-border-input rounded-lg pl-10 pr-4 py-2.5 text-primary text-sm outline-none focus:border-accent transition-colors" oninput="dashboardSearchInput()" onkeydown="if(event.key==='Enter'){event.preventDefault();dashboardSearchSubmit()}else if(event.key==='Escape'){document.getElementById('dashboard-search-results').style.display='none'}" onfocus="dashboardSearchInput()" autocomplete="off">
        <div id="dashboard-search-results" class="absolute left-0 right-0 top-full mt-1 bg-card border border-border-card rounded-lg shadow-xl overflow-hidden overflow-y-auto z-50" style="display:none;max-height:400px"></div>
      </div>
    </div>

    <!-- Calendar: full width -->
    <div class="mb-5">
      ${heatmapHtml}
    </div>

    ${myTasksHtml}

    <!-- Two-column layout below calendar -->
    <div class="flex gap-5 items-start">
      <!-- Left column: Reading List -->
      <div class="flex-1 min-w-0">
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Reading List</h3>
          </div>
          ${readingHtml}
        </div>
      </div>

      <!-- Right column: Recent Projects, Quotes -->
      <div class="flex-1 min-w-0">
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Recent Projects</h3>
            <button onclick="openExperiments()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          <div class="flex flex-col gap-2">${expsHtml}</div>
        </div>

        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Quotes</h3>
            <span class="text-[0.72rem] text-dimmer">${userQuotes.length}</span>
          </div>
          ${quotesHtml}
        </div>

        ${teams.length ? `<div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Teams</h3>
            <button onclick="openTeams()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          <div class="flex flex-col gap-2">${teams.map(t => `
            <div class="p-3 rounded-lg border border-border-card bg-card cursor-pointer hover:border-border-input transition-colors" onclick="openTeams(); showTeamDetailView(${t.id})">
              <div class="flex items-center gap-2.5">
                ${typeof _pixelArt === 'function' ? _pixelArt(t.name) : ''}
                <div class="min-w-0 flex-1">
                  <div class="text-[0.85rem] font-medium text-primary truncate">${escapeHtml(t.name)}</div>
                  <div class="text-[0.72rem] text-dimmer mt-0.5">${t.member_count} member${t.member_count !== 1 ? 's' : ''}</div>
                </div>
              </div>
            </div>
          `).join('')}</div>
        </div>` : ''}
      </div>
    </div>
  `;

  document.removeEventListener('mousedown', _closeDashSearch);
  document.addEventListener('mousedown', _closeDashSearch);
}

// ── All Saved Posts view ──
function openAllSaved() {
  hideAllViews();
  const view = document.getElementById('dashboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'saved-all';
  setSidebarActive('sb-dashboard');
  const container = document.getElementById('dashboard-content');
  const saved = getSavedPosts();
  const entries = Object.values(saved).sort((a, b) => b.savedAt - a.savedAt);
  const backBtn = `<button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center hover:text-primary shrink-0 mb-4" onclick="openDashboard()"><svg class="w-4 h-4 fill-current mr-1.5" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg><span class="text-[0.82rem]">Back</span></button>`;
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
    const progressBar = rp ? `<div style="height:2px;margin-top:2px;background:var(--border-card);border-radius:1px;overflow:hidden"><div style="width:${Math.round(rp * 100)}%;height:100%;background:var(--accent);border-radius:1px"></div></div>` : '';
    return `<div class="dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}">
      ${faviconImg}
      <div class="flex-1 min-w-0" onclick="openSavedPaper('${escapeAttr(p.link)}')">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
        ${progressBar}
      </div>
      ${getPaperRating(p.link) > 0 ? `<span class="shrink-0">${renderStarRating(p.link, { size: 'sm', interactive: false })}</span>` : ''}
      ${dateStr ? `<span class="text-[0.68rem] text-dimmest shrink-0">${dateStr}</span>` : ''}
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--text-dimmer);font-size:1rem" onclick="event.stopPropagation(); dashRemoveSaved('${escapeAttr(p.link)}'); openAllSaved()" title="Remove">&times;</button>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';
  container.innerHTML = `${backBtn}<h2 class="text-[1.3rem] font-semibold text-white_ mb-4">Reading List <span class="text-dim font-normal text-[0.9rem]">(${entries.length})</span></h2>${rows}`;
}

