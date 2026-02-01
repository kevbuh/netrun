// ── Dashboard ──

let _dashYear, _dashMonth;
{
  const _n = new Date();
  _dashYear = _n.getFullYear();
  _dashMonth = _n.getMonth();
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
  if (!localStorage.getItem('feedSources')) { goHome(); return; }
  const container = document.getElementById('dashboard-content');
  container.innerHTML = '<div class="text-center py-20 text-dim"><div class="spinner"></div></div>';

  const [expResp, calResp, savedResp] = await Promise.all([
    fetch('/api/experiments').then(r => r.json()).catch(() => []),
    fetch('/api/calendar').then(r => r.json()).catch(() => []),
    fetch('/api/saved-posts').then(r => r.json()).catch(() => ({}))
  ]);

  const experiments = expResp || [];
  const events = calResp || [];
  const savedPosts = savedResp || {};

  // Merge server saved posts into localStorage
  const localSaved = getSavedPosts();
  let mergedSaved = { ...localSaved };
  for (const [url, entry] of Object.entries(savedPosts)) {
    if (!mergedSaved[url]) mergedSaved[url] = entry;
  }

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
        <div class="min-w-0">
          <div class="text-[0.85rem] font-medium text-primary truncate">${escapeHtml(exp.title)}</div>
          <div class="text-[0.72rem] text-dimmer mt-0.5">${runCount} run${runCount !== 1 ? 's' : ''}${lastUpdated ? ' · ' + lastUpdated : ''}</div>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer">No experiments yet</div>';

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

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">${getGreeting()}</h2>

    <!-- Calendar: full width -->
    <div class="mb-5">
      ${heatmapHtml}
    </div>

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

      <!-- Right column: Recent Experiments, Quotes -->
      <div class="flex-1 min-w-0">
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Recent Experiments</h3>
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
      </div>
    </div>
  `;
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

