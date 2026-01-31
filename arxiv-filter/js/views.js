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
  const readingHtml = savedEntries.length ? savedEntries.map(entry => {
    const p = entry.paper;
    const hostname = p.hostname || (() => { try { return new URL(p.link).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const favicon = p.favicon || (() => { try { return new URL(p.link).origin + '/favicon.ico'; } catch { return ''; } })();
    const pixelFallback = typeof _pixelArt === 'function' ? _pixelArt(p.title || p.link) : '';
    const faviconImg = favicon
      ? `<img src="${escapeAttr(favicon)}" class="w-4 h-4 rounded-sm shrink-0" onerror="this.outerHTML=${escapeAttr(JSON.stringify(pixelFallback))}">`
      : pixelFallback;
    return `<div class="dash-row flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-hover transition-colors${entry.read ? ' opacity-50' : ''}">
      ${faviconImg}
      <div class="flex-1 min-w-0" onclick="openSavedPaper('${escapeAttr(p.link)}')">
        <div class="text-[0.82rem] text-primary truncate">${escapeHtml(p.title)}</div>
        ${hostname ? `<div class="text-[0.7rem] text-dimmer truncate">${escapeHtml(hostname)}</div>` : ''}
      </div>
      <button class="dash-del shrink-0 bg-transparent border-none cursor-pointer p-0 leading-none" style="color:var(--text-dimmer);font-size:1rem" onclick="dashRemoveSaved('${escapeAttr(p.link)}')" title="Remove">&times;</button>
    </div>`;
  }).join('') : '<div class="text-[0.8rem] text-dimmer px-2">No saved posts</div>';

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

  container.innerHTML = `
    <h2 class="text-[1.3rem] font-semibold text-white_ mb-5">${getGreeting()}</h2>
    <div class="flex gap-5 items-start">
      <!-- Left column: Calendar, Reading List -->
      <div class="flex-1 min-w-0">
        <div class="mb-5">
          ${heatmapHtml}
        </div>

        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Reading List</h3>
          </div>
          ${readingHtml}
        </div>
      </div>

      <!-- Right column: Recent Experiments -->
      <div class="flex-1 min-w-0">
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-[0.9rem] font-semibold text-primary">Recent Experiments</h3>
            <button onclick="openExperiments()" class="text-[0.75rem] text-dimmer hover:text-primary bg-transparent border-none cursor-pointer">View all</button>
          </div>
          <div class="flex flex-col gap-2">${expsHtml}</div>
        </div>
      </div>
    </div>
  `;
}

// ── Paper Viewer (shared) ──
let paperViewOrigin = 'arxiv';

function paperViewGoBack() {
  cleanupPdfViewer();
  dismissPaperExpDropdown();
  if (paperViewOrigin === 'saved') { openDashboard(); return; }
  if (paperViewOrigin === 'search') { openSearch(); return; }
  if (paperViewOrigin === 'experiment' && _paperOriginExpId) { openExperimentDetail(_paperOriginExpId); return; }
  goHome();
}

let _currentPaperViewPaper = null;
let _paperOriginExpId = null;
function togglePaperViewBookmark() {
  if (!_currentPaperViewPaper) return;
  toggleSavePost(_currentPaperViewPaper);
  const btn = document.getElementById('paper-view-bookmark');
  if (!btn) return;
  const saved = isPostSaved(_currentPaperViewPaper.link);
  btn.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[0.82rem] cursor-pointer transition-colors ${saved ? 'bg-accent/15 border-accent text-accent' : 'bg-transparent border-border-input text-muted hover:text-primary hover:border-dimmer'}`;
  btn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="${saved ? 'var(--accent)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>${saved ? 'Saved' : 'Bookmark'}`;
}

// ── Add to experiment dropdown ──
let _paperExpDropdown = null;

function togglePaperExpDropdown() {
  if (_paperExpDropdown) { dismissPaperExpDropdown(); return; }
  const wrap = document.getElementById('paper-exp-btn-wrap');
  if (!wrap) return;
  const btnRect = wrap.getBoundingClientRect();

  const dropdown = document.createElement('div');
  dropdown.className = 'paper-exp-dropdown';
  dropdown.style.cssText = `position:fixed;top:${btnRect.bottom + 4}px;min-width:220px;max-height:260px;overflow-y:auto;background:var(--bg-popup);border:1px solid var(--border-card);border-radius:8px;box-shadow:0 4px 16px var(--shadow-popup);z-index:10000;padding:4px 0;`;
  // Align right edge to button right edge
  dropdown.style.right = (window.innerWidth - btnRect.right) + 'px';

  dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">Loading...</div>';
  document.body.appendChild(dropdown);

  // Fetch experiments
  fetch('/api/experiments').then(r => r.json()).then(exps => {
    dropdown.innerHTML = '';
    if (!exps.length) {
      dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">No experiments yet</div>';
      return;
    }
    const paper = _currentPaperViewPaper;
    exps.forEach(exp => {
      const papers = exp.papers || [];
      const isLinked = papers.some(p => p.link === paper.link);
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 12px;font-size:0.78rem;transition:background 0.1s;';
      item.onmouseenter = () => item.style.background = 'var(--bg-hover)';
      item.onmouseleave = () => item.style.background = 'none';
      if (isLinked) {
        // Linked: click row to navigate to experiment, × to unlink
        const link = document.createElement('button');
        link.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:none;background:none;color:var(--accent);font-size:0.78rem;cursor:pointer;text-align:left;padding:0;';
        link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" style="flex-shrink:0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exp.title)}</span>`;
        link.onclick = (e) => { e.stopPropagation(); dismissPaperExpDropdown(); openExperimentDetail(exp.id); };
        item.appendChild(link);
        const unlinkBtn = document.createElement('button');
        unlinkBtn.style.cssText = 'border:none;background:none;color:var(--text-dimmest);cursor:pointer;padding:0 2px;font-size:0.9rem;line-height:1;flex-shrink:0;';
        unlinkBtn.innerHTML = '&times;';
        unlinkBtn.title = 'Remove from experiment';
        unlinkBtn.onmouseenter = () => unlinkBtn.style.color = 'var(--text-primary)';
        unlinkBtn.onmouseleave = () => unlinkBtn.style.color = 'var(--text-dimmest)';
        unlinkBtn.onclick = (e) => { e.stopPropagation(); togglePaperInExperiment(exp.id, paper, true, papers); };
        item.appendChild(unlinkBtn);
      } else {
        // Not linked: click to add
        const addBtn = document.createElement('button');
        addBtn.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:none;background:none;color:var(--text-primary);font-size:0.78rem;cursor:pointer;text-align:left;padding:0;';
        addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dimmest)" stroke-width="2" style="flex-shrink:0"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exp.title)}</span>`;
        addBtn.onclick = (e) => { e.stopPropagation(); togglePaperInExperiment(exp.id, paper, false, papers); };
        item.appendChild(addBtn);
      }
      dropdown.appendChild(item);
    });
  }).catch(() => {
    dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--text-dim)">Failed to load</div>';
  });
  _paperExpDropdown = dropdown;

  setTimeout(() => document.addEventListener('mousedown', _dismissPaperExpHandler), 0);
}

function _dismissPaperExpHandler(e) {
  if (_paperExpDropdown && !_paperExpDropdown.contains(e.target)) {
    dismissPaperExpDropdown();
  }
}

function dismissPaperExpDropdown() {
  if (_paperExpDropdown) { _paperExpDropdown.remove(); _paperExpDropdown = null; }
  document.removeEventListener('mousedown', _dismissPaperExpHandler);
}

function togglePaperInExperiment(expId, paper, isLinked, currentPapers) {
  let papers;
  if (isLinked) {
    papers = currentPapers.filter(p => p.link !== paper.link);
  } else {
    papers = [...currentPapers, { link: paper.link, title: paper.title, source: paper.source, addedAt: new Date().toISOString() }];
  }
  fetch(`/api/experiments/${expId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ papers })
  }).then(() => {
    dismissPaperExpDropdown();
    togglePaperExpDropdown(); // re-open to show updated state
  });
}

function showPaperView(paper, hashValue) {
  markPostRead(paper.link);
  if (typeof petReact === 'function') petReact('happy');
  hideAllViews();
  const view = document.getElementById('paper-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = hashValue;

  const topbar = document.getElementById('paper-topbar');
  const sidebar = document.getElementById('paper-sidebar');
  const isHN = paper.source === 'hn';
  const isArxiv = paper.source === 'arxiv' || /arxiv\.org\/abs\//.test(paper.link);
  const hnDiscussionUrl = paper.hnId ? `https://news.ycombinator.com/item?id=${paper.hnId}` : '';
  _currentPaperViewPaper = paper;
  const isSaved = isPostSaved(paper.link);
  const bookmarkBtn = `<button id="paper-view-bookmark" class="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[0.78rem] cursor-pointer transition-colors shrink-0 ${isSaved ? 'bg-accent/15 border-accent text-accent' : 'bg-transparent border-border-input text-muted hover:text-primary hover:border-dimmer'}" onclick="togglePaperViewBookmark()"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="${isSaved ? 'var(--accent)' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>${isSaved ? 'Saved' : 'Save'}</button>`;

  // ── Top bar: back + metadata compact ──
  const backBtn = `<button class="bg-transparent border-none text-muted cursor-pointer p-0 inline-flex items-center hover:text-primary shrink-0" onclick="paperViewGoBack()"><svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button>`;
  const sourceName = SOURCE_NAMES[paper.source] || (paper.source?.startsWith('custom:') ? paper.source.slice(7) : '');

  let metaParts = [];
  if (sourceName) metaParts.push(`<span class="text-meta-value">${escapeHtml(sourceName)}</span>`);
  if (paper.authors) metaParts.push(`<span class="text-muted truncate max-w-[300px]">${escapeHtml(paper.authors)}</span>`);
  if (paper.published) metaParts.push(`<span class="text-dim">${paper.published}</span>`);
  if (isHN && paper.hnScore) metaParts.push(`<span class="text-[#f60] font-semibold">${paper.hnScore} pts</span>`);
  if (isHN && hnDiscussionUrl) metaParts.push(`<a href="${hnDiscussionUrl}" target="_blank" rel="noopener" class="text-link no-underline hover:underline">${paper.hnComments} comments</a>`);
  if (paper.categories && paper.categories.length) metaParts.push(...paper.categories.slice(0, 3).map(c => `<span class="text-[0.68rem] bg-sidebar-cat text-sidebar-cat-color px-1.5 py-0.5 rounded border border-sidebar-cat-border">${escapeHtml(c)}</span>`));

  topbar.innerHTML = `
    ${backBtn}
    <span class="w-px h-5 bg-border-dim shrink-0"></span>
    <span class="text-[0.82rem] font-semibold text-white_ truncate">${renderTitle(paper.title)}</span>
    <span class="flex items-center gap-2 text-[0.75rem] shrink-0 ml-auto">${metaParts.join('<span class="text-dimmest">·</span>')}</span>
    ${bookmarkBtn}
    <div class="relative shrink-0" id="paper-exp-btn-wrap">
      <button class="inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-transparent border-border-input text-muted text-[0.78rem] cursor-pointer transition-colors hover:text-primary hover:border-dimmer" onclick="togglePaperExpDropdown()" title="Add to experiment">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Experiment
      </button>
    </div>
    <a href="${paper.link}" target="_blank" rel="noopener" class="text-dim hover:text-primary shrink-0" title="Open in new tab"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
  `;

  // ── Sidebar: notes + chat ──
  const notesPanel = `
    <div id="paper-notes-section">
      <div id="paper-note-editor" class="hidden">
        <div id="paper-note-rendered" class="hidden text-[0.82rem] text-primary leading-relaxed nb-rendered-md cursor-text" data-latex onclick="startPaperNoteEdit()"></div>
        <textarea id="paper-note-textarea" class="hidden w-full bg-transparent border-none text-[0.82rem] text-primary p-0 resize-none focus:outline-none" rows="6" placeholder="Write your note…"></textarea>
      </div>
    </div>
  `;

  const chatPanel = `
    <div class="flex-1 flex flex-col border-t border-border-card pt-2" id="doc-chat-section" style="min-height:0">
      <div class="doc-chat-bar" id="doc-chat-bar" onclick="toggleDocChat()">
        <span id="doc-chat-chevron">▾</span>
        <span>Chat</span>
        <span class="doc-chat-status-inline text-dim text-[0.72rem] ml-auto" id="doc-chat-status-inline"></span>
      </div>
      <div class="flex flex-col" id="doc-chat-panel" style="min-height:0;flex:1">
        <div class="doc-chat-status" id="doc-chat-status"></div>
        <div class="doc-chat-messages" id="doc-chat-messages"></div>
        <div class="doc-chat-input-row">
          <input id="doc-chat-input" placeholder="Ask about this document…" onkeydown="if(event.key==='Enter')sendDocMessage()" />
          <button onclick="sendDocMessage()" id="doc-chat-send">Send</button>
        </div>
      </div>
    </div>
  `;

  const commentsPanel = `
    <div class="flex flex-col flex-1 min-h-0">
      <div id="comments-list" class="flex-1 overflow-y-auto"></div>
      <div class="border-t border-border-card pt-2 mt-2 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[0.72rem] text-dim">Name:</span>
          <input id="comment-author" class="flex-1 text-[0.78rem] bg-input border border-border-input rounded px-2 py-1 text-primary outline-none focus:border-accent" value="${escapeHtml(localStorage.getItem('userName') || '')}" placeholder="Your name" />
        </div>
        <textarea id="comment-input" class="w-full text-[0.78rem] bg-input border border-border-input rounded px-2 py-1.5 text-primary resize-none outline-none focus:border-accent" rows="3" placeholder="Write a comment..."></textarea>
        <button onclick="postComment()" class="mt-1 px-3 py-1 text-[0.78rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none font-medium">Post</button>
      </div>
    </div>
  `;

  sidebar.innerHTML = `
    <div id="paper-insights" class="mb-3 shrink-0"></div>
    <div id="paper-selection-mirror" class="mb-3 shrink-0 hidden"></div>
    <div class="flex gap-1 mb-3 shrink-0">
      <button id="sidebar-tab-notes" class="sidebar-tab-btn active" onclick="switchSidebarTab('notes')">Notes</button>
      <button id="sidebar-tab-chat" class="sidebar-tab-btn" onclick="switchSidebarTab('chat')">Chat</button>
      <button id="sidebar-tab-comments" class="sidebar-tab-btn" onclick="switchSidebarTab('comments')">Comments</button>
    </div>
    <div id="sidebar-pane-notes" class="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div id="pdf-highlights-section">
        <div id="pdf-highlights-panel"></div>
      </div>
      ${notesPanel}
    </div>
    <div id="sidebar-pane-chat" class="flex flex-col flex-1 min-h-0" style="display:none">
      ${chatPanel}
    </div>
    <div id="sidebar-pane-comments" class="flex flex-col flex-1 min-h-0" style="display:none">
      ${commentsPanel}
    </div>
  `;

  const pdfContainer = document.getElementById('paper-pdf-container');
  cleanupPdfViewer();
  pdfContainer.innerHTML = '';
  const arxivId = isArxiv ? (paper.arxivId || (paper.link.match(/arxiv\.org\/abs\/(\d+\.\d+)/) || [])[1] || '') : '';
  if (arxivId) {
    initPdfViewer(pdfContainer, `/api/arxiv-pdf?id=${encodeURIComponent(arxivId)}`, arxivId);
  } else {
    pdfContainer.innerHTML = `<iframe src="${paper.link}" style="width:100%;height:100%;border:none;background:#fff" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer"></iframe>`;
  }

  // Reset chat state
  _docChatMessages = [];
  _docText = '';
  _docTextLoading = false;
  _docChatExpanded = false;
  if (_docChatAbort) { _docChatAbort.abort(); _docChatAbort = null; }
  _docChatPaperUrl = paper.link;

  // Start extracting document text eagerly so it's ready for chat
  extractDocText(paper.link);

  // Load paper notes
  _paperNoteSelected = null;
  _paperNoteLink = paper.link;
  fetchPaperNotes();

  // Start scroll progress tracking
  _startScrollTracker(paper.link);

  // Fetch paper insights (async, non-blocking)
  fetchPaperInsights(paper.link);
}

// ── Paper Insights ──
async function _verifyInsightsInPdf(insights) {
  // Skip verification for non-PDF views (e.g. iframe websites) — no text layers to check
  const pdfContainer = document.querySelector('.pdf-pages-container');
  if (!pdfContainer) return insights;
  // Wait for at least some PDF text layers to render (up to 8s, checking every 500ms)
  if (typeof pdfTextExists === 'function') {
    for (let attempt = 0; attempt < 16; attempt++) {
      if (pdfContainer.querySelector('.textLayer span')) break;
      await new Promise(r => setTimeout(r, 500));
    }
    return insights.filter(insight => {
      const q = insight.text.replace(/\.\.\.$/, '');
      return pdfTextExists(q);
    });
  }
  return insights;
}

async function fetchPaperInsights(url) {
  const el = document.getElementById('paper-insights');
  if (!el) return;
  el.innerHTML = `<div class="flex items-center gap-2 text-[0.75rem] text-dim py-1"><svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>Analyzing paper...</div>`;
  try {
    const resp = await fetch('/api/paper-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!resp.ok) throw new Error('Failed');
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const hasRepos = data.repos && data.repos.length > 0;
    const hasInsights = data.insights && data.insights.length > 0;
    if (!hasRepos && !hasInsights) {
      el.innerHTML = '';
      return;
    }
    let html = '<div class="rounded-lg border border-border-card bg-card-bg p-3 space-y-2">';
    html += '<div class="text-[0.72rem] font-semibold text-dim uppercase tracking-wide">Insights</div>';
    if (hasRepos) {
      html += '<div class="flex flex-wrap gap-1.5">';
      for (const repo of data.repos) {
        const label = repo.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const isGH = repo.url.includes('github.com');
        const isHF = repo.url.includes('huggingface.co');
        const icon = isGH
          ? '<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>'
          : isHF
          ? '<span class="text-[0.7rem] shrink-0">&#129303;</span>'
          : '<svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        html += `<a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border-input bg-sidebar-bg text-[0.74rem] text-link no-underline hover:border-accent hover:bg-accent/10 transition-colors">${icon}<span class="truncate max-w-[200px]">${escapeHtml(label)}</span></a>`;
      }
      html += '</div>';
    }
    if (hasInsights) {
      // Wait for PDF text layers to render before verifying quotes
      const verified = await _verifyInsightsInPdf(data.insights);
      const labelColors = { Contribution: 'text-blue-400', Result: 'text-green-400', Method: 'text-purple-400', Surprising: 'text-yellow-400', Design: 'text-orange-400', Hardware: 'text-red-400' };
      for (const insight of verified) {
        const searchSnippet = insight.text.replace(/\.\.\.$/, '');
        const colorCls = labelColors[insight.label] || 'text-dim';
        let extraHtml = '';
        if (insight.gpus && insight.gpus.length) {
          extraHtml = `<div class="flex flex-wrap gap-1 mt-1">${insight.gpus.map(g => `<span class="text-[0.68rem] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">${escapeHtml(g)}</span>`).join('')}</div>`;
        }
        html += `<div class="cursor-pointer transition-colors hover:bg-white/5 rounded p-1.5 -mx-1.5" onmouseenter="pdfSearchHighlight(this.dataset.q)" onmouseleave="pdfClearSearchHighlights()" data-q="${escapeHtml(searchSnippet)}">
          <div class="text-[0.68rem] font-semibold ${colorCls} uppercase tracking-wide mb-0.5">${escapeHtml(insight.label)}</div>
          <div class="text-[0.78rem] text-primary leading-relaxed border-l-2 border-accent/40 pl-2.5 italic">${escapeHtml(insight.text)}</div>
          ${extraHtml}
        </div>`;
      }
      if (!verified.length && !hasRepos) {
        el.innerHTML = '';
        return;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
}

// ── Selection Mirror + Search-in-PDF ──
let _selMirrorSearchTimer = null;

document.addEventListener('selectionchange', function() {
  const el = document.getElementById('paper-selection-mirror');
  if (!el) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 2) {
    // Don't hide if user is typing in the search input
    const active = document.activeElement;
    if (active && active.id === 'pdf-find-input') return;
    if (!el.querySelector('#pdf-find-input')) {
      el.classList.add('hidden');
      el.innerHTML = '';
    }
    return;
  }
  // Only show for selections inside the PDF container
  if (sel.anchorNode) {
    const parent = sel.anchorNode.parentElement;
    if (!parent || !parent.closest('#paper-pdf-container')) return;
  }
  _renderSelectionMirror(el, text);
});

function _renderSelectionMirror(el, selectedText) {
  el.classList.remove('hidden');
  el.innerHTML = `<div class="rounded-lg border border-border-card bg-card-bg p-3">
    <div class="flex items-center justify-between mb-1.5">
      <div class="text-[0.72rem] font-semibold text-dim uppercase tracking-wide">Selected Text</div>
    </div>
    <div class="text-[0.78rem] text-primary leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">${escapeHtml(selectedText)}</div>
  </div>`;
}

function showPdfFindBar() {
  const el = document.getElementById('paper-selection-mirror');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="rounded-lg border border-border-card bg-card-bg p-3">
    <div class="flex items-center justify-between mb-1.5">
      <div class="text-[0.72rem] font-semibold text-dim uppercase tracking-wide">Find in PDF</div>
      <button onclick="closePdfFindBar()" class="text-dim hover:text-primary text-[0.7rem] bg-transparent border-none cursor-pointer p-0">&times;</button>
    </div>
    <input id="pdf-find-input" type="text" class="w-full text-[0.78rem] bg-input border border-border-input rounded px-2 py-1 text-primary outline-none focus:border-accent" placeholder="Type to find in PDF..." autofocus />
  </div>`;
  const input = document.getElementById('pdf-find-input');
  if (input) {
    input.focus();
    input.addEventListener('input', function() {
      clearTimeout(_selMirrorSearchTimer);
      const q = this.value.trim();
      _selMirrorSearchTimer = setTimeout(() => {
        if (typeof pdfSearchHighlight === 'function') pdfSearchHighlight(q);
      }, 300);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closePdfFindBar();
    });
  }
}

function closePdfFindBar() {
  if (typeof pdfClearSearchHighlights === 'function') pdfClearSearchHighlights();
  const el = document.getElementById('paper-selection-mirror');
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

// ── Paper Notes ──
let _paperNoteSelected = null;
let _paperNoteLink = '';
let _paperNotes = [];
let _paperNoteSaveTimer = null;

async function fetchPaperNotes() {
  try {
    const resp = await fetch('/api/todos');
    const all = await resp.json();
    let note = (all || []).find(n => n.paperLink === _paperNoteLink);
    if (!note) {
      // Auto-create a note for this paper
      note = await _createPaperNote();
    }
    if (note) {
      _paperNotes = [note];
      _paperNoteSelected = note.id;
      renderPaperNoteEditor();
    }
  } catch (e) {
    _paperNotes = [];
  }
}

async function _createPaperNote() {
  const resp = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled', content: '', paperLink: _paperNoteLink })
  });
  return await resp.json();
}

let _paperNoteEditing = false;

function renderPaperNoteEditor() {
  const editor = document.getElementById('paper-note-editor');
  const rendered = document.getElementById('paper-note-rendered');
  const textarea = document.getElementById('paper-note-textarea');
  if (!editor || !rendered || !textarea) return;
  const note = _paperNotes.find(n => n.id === _paperNoteSelected);
  if (!note) { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');
  if (_paperNoteEditing) {
    rendered.classList.add('hidden');
    textarea.classList.remove('hidden');
    textarea.value = note.content || '';
    textarea.focus();
    textarea.oninput = () => {
      if (_paperNoteSaveTimer) clearTimeout(_paperNoteSaveTimer);
      _paperNoteSaveTimer = setTimeout(() => savePaperNote(note.id, textarea.value), 600);
    };
    textarea.onblur = () => {
      setTimeout(() => {
        _paperNoteEditing = false;
        savePaperNote(note.id, textarea.value);
        renderPaperNoteEditor();
      }, 150);
    };
  } else {
    textarea.classList.add('hidden');
    rendered.classList.remove('hidden');
    const content = note.content || '';
    if (content.trim()) {
      rendered.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>');
      // Render LaTeX
      if (typeof katex !== 'undefined') {
        function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
        let html = rendered.innerHTML;
        html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
          try { return katex.renderToString(decodeTex(tex), { displayMode: true, throwOnError: false }); } catch { return _; }
        });
        html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
          try { return katex.renderToString(decodeTex(tex), { displayMode: false, throwOnError: false }); } catch { return _; }
        });
        rendered.innerHTML = html;
      }
    } else {
      rendered.innerHTML = '<span class="text-dimmer">Start taking notes...</span>';
    }
  }
}

function startPaperNoteEdit() {
  _paperNoteEditing = true;
  renderPaperNoteEditor();
}

async function savePaperNote(id, content) {
  try {
    await fetch(`/api/todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const note = _paperNotes.find(n => n.id === id);
    if (note) note.content = content;
  } catch (e) { /* silent */ }
}

// ── Paper Comments ──
let _commentsCache = [];

async function fetchPaperComments() {
  const list = document.getElementById('comments-list');
  if (!list) return;
  try {
    const resp = await fetch('/api/comments?paperLink=' + encodeURIComponent(_paperNoteLink));
    _commentsCache = await resp.json();
  } catch (e) {
    _commentsCache = [];
  }
  renderComments();
}

function renderComments() {
  const list = document.getElementById('comments-list');
  if (!list) return;
  if (!_commentsCache.length) {
    list.innerHTML = '<div class="text-dim text-[0.8rem] py-4 text-center">No comments yet</div>';
    return;
  }
  // Build threaded tree
  const topLevel = _commentsCache.filter(c => !c.parentId);
  const byParent = {};
  _commentsCache.forEach(c => {
    if (c.parentId) {
      (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
    }
  });
  // Sort by timestamp
  topLevel.sort((a, b) => a.timestamp - b.timestamp);

  function renderThread(comment, depth) {
    const replies = (byParent[comment.id] || []).sort((a, b) => a.timestamp - b.timestamp);
    const ml = depth > 0 ? `margin-left:${Math.min(depth, 4) * 16}px; border-left: 2px solid var(--border-card); padding-left: 8px;` : '';
    const initial = (comment.author || '?')[0].toUpperCase();
    const timeAgo = _relativeTime(comment.timestamp);
    const userName = localStorage.getItem('userName') || '';
    const isOwn = comment.author === userName;
    const deleteBtn = isOwn ? `<button onclick="deleteComment('${comment.id}')" class="text-dimmest hover:text-red-400 text-[0.7rem] ml-auto" title="Delete" style="background:none;border:none;cursor:pointer;">x</button>` : '';
    let html = `<div class="comment-thread" style="${ml}; margin-bottom: 8px;">
      <div class="flex items-start gap-2">
        <div style="width:22px;height:22px;min-width:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(initial)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[0.75rem] font-medium text-primary">${escapeHtml(comment.author)}</span>
            <span class="text-[0.68rem] text-dimmer">${timeAgo}</span>
            ${deleteBtn}
          </div>
          <div class="text-[0.78rem] text-primary mt-0.5 leading-relaxed">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</div>
          <button onclick="showReplyInput('${comment.id}')" class="text-[0.7rem] text-dim hover:text-accent mt-1" style="background:none;border:none;cursor:pointer;">Reply</button>
          <div id="reply-input-${comment.id}" class="hidden mt-1">
            <textarea id="reply-textarea-${comment.id}" class="w-full text-[0.75rem] bg-input border border-border-input rounded px-2 py-1 text-primary resize-none outline-none focus:border-accent" rows="2" placeholder="Write a reply..."></textarea>
            <div class="flex gap-1 mt-1">
              <button onclick="postReply('${comment.id}')" class="px-2 py-0.5 text-[0.72rem] rounded bg-accent text-white hover:bg-accent-hover cursor-pointer border-none">Reply</button>
              <button onclick="hideReplyInput('${comment.id}')" class="px-2 py-0.5 text-[0.72rem] rounded border border-border-input text-dim hover:text-primary cursor-pointer bg-transparent">Cancel</button>
            </div>
          </div>
        </div>
      </div>`;
    replies.forEach(r => { html += renderThread(r, depth + 1); });
    html += '</div>';
    return html;
  }

  list.innerHTML = topLevel.map(c => renderThread(c, 0)).join('');
}

function _relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

async function postComment(parentId) {
  const authorInput = document.getElementById('comment-author');
  const contentInput = document.getElementById('comment-input');
  if (!contentInput) return;
  const content = contentInput.value.trim();
  if (!content) return;
  const author = (authorInput?.value || '').trim() || 'Anonymous';
  // Save author name
  localStorage.setItem('userName', author);
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperLink: _paperNoteLink, author, content, parentId: parentId || null })
    });
    contentInput.value = '';
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

async function postReply(parentId) {
  const textarea = document.getElementById('reply-textarea-' + parentId);
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;
  const author = (localStorage.getItem('userName') || '').trim() || 'Anonymous';
  try {
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperLink: _paperNoteLink, author, content, parentId })
    });
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

async function deleteComment(id) {
  try {
    await fetch('/api/comments/' + id, { method: 'DELETE' });
    fetchPaperComments();
  } catch (e) { /* silent */ }
}

function showReplyInput(id) {
  const el = document.getElementById('reply-input-' + id);
  if (el) { el.classList.remove('hidden'); el.querySelector('textarea')?.focus(); }
}

function hideReplyInput(id) {
  const el = document.getElementById('reply-input-' + id);
  if (el) el.classList.add('hidden');
}

// ── Read Progress Tracking ──
let _scrollTrackerInterval = null;

function _startScrollTracker(link) {
  if (_scrollTrackerInterval) clearInterval(_scrollTrackerInterval);
  _scrollTrackerInterval = setInterval(() => {
    try {
      const iframe = document.querySelector('#paper-pdf-container iframe');
      if (!iframe || !iframe.contentWindow) return;
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || !doc.documentElement) return;
      const scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
      const scrollHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight || 0;
      const clientHeight = doc.documentElement.clientHeight || doc.body.clientHeight || 0;
      if (scrollHeight <= clientHeight) return;
      const progress = Math.min(1, scrollTop / (scrollHeight - clientHeight));
      _saveReadProgress(link, progress);
    } catch (e) {
      // Cross-origin — silently ignore
    }
  }, 2000);
}

function _stopScrollTracker() {
  if (_scrollTrackerInterval) { clearInterval(_scrollTrackerInterval); _scrollTrackerInterval = null; }
}

function _saveReadProgress(link, progress) {
  const saved = getSavedPosts();
  if (!saved[link]) return;
  const prev = saved[link].readProgress || 0;
  if (progress > prev) {
    saved[link].readProgress = Math.round(progress * 100) / 100;
    savePosts(saved);
  }
}

// ── Document Chat ──
let _docChatMessages = [];
let _docText = '';
let _docTextLoading = false;
let _docChatAbort = null;
let _docChatExpanded = false;
let _docChatPaperUrl = '';

function switchSidebarTab(tab) {
  const panes = ['notes', 'chat', 'comments'];
  panes.forEach(p => {
    const pane = document.getElementById('sidebar-pane-' + p);
    const btn = document.getElementById('sidebar-tab-' + p);
    if (pane) pane.style.display = p === tab ? '' : 'none';
    if (btn) btn.classList.toggle('active', p === tab);
  });
  if (tab === 'chat' && !_docChatExpanded) toggleDocChat();
  if (tab === 'comments') fetchPaperComments();
}

function toggleDocChat() {
  _docChatExpanded = !_docChatExpanded;
  const panel = document.getElementById('doc-chat-panel');
  const chevron = document.getElementById('doc-chat-chevron');
  const sidebar = document.getElementById('paper-sidebar');
  if (!panel) return;
  if (_docChatExpanded) {
    panel.classList.remove('hidden');
    chevron.textContent = '▾';
    // Make sidebar non-scrollable so chat fills remaining space
    if (sidebar) sidebar.style.overflow = 'hidden';
    if (!_docText && !_docTextLoading) {
      extractDocText(_docChatPaperUrl);
    }
  } else {
    panel.classList.add('hidden');
    chevron.textContent = '▸';
    if (sidebar) sidebar.style.overflow = '';
  }
}

let _extractSpinnerInterval = null;

async function extractDocText(url) {
  _docTextLoading = true;
  const status = document.getElementById('doc-chat-status');
  const frames = ['\u2840','\u2844','\u2846','\u2847','\u283F','\u2839','\u2838','\u2830'];
  let fi = 0;
  if (_extractSpinnerInterval) clearInterval(_extractSpinnerInterval);
  const inlineStatus = document.getElementById('doc-chat-status-inline');
  const setStatus = (txt) => {
    if (status) status.textContent = txt;
    if (inlineStatus) inlineStatus.textContent = txt;
  };
  _extractSpinnerInterval = setInterval(() => {
    setStatus(frames[fi % frames.length] + ' Extracting…');
    fi++;
  }, 100);
  try {
    const resp = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    clearInterval(_extractSpinnerInterval);
    _extractSpinnerInterval = null;
    if (data.error) {
      setStatus('Failed: ' + data.error);
    } else {
      _docText = data.text || '';
      setStatus(`${data.pages} pg · ${_docText.length.toLocaleString()} chars`);
    }
  } catch (e) {
    clearInterval(_extractSpinnerInterval);
    _extractSpinnerInterval = null;
    setStatus('Failed: ' + e.message);
  }
  _docTextLoading = false;
}

async function sendDocMessage() {
  const input = document.getElementById('doc-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  _docChatMessages.push({ role: 'user', content: text });
  renderDocChatMessages();

  const setButtonDisabled = (v) => {
    const b = document.getElementById('doc-chat-send');
    if (b) b.disabled = v;
  };
  setButtonDisabled(true);

  _docChatAbort = new AbortController();
  try {
    const resp = await fetch('/api/doc-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: _docText, messages: _docChatMessages }),
      signal: _docChatAbort.signal
    });

    let aiText = '';
    _docChatMessages.push({ role: 'assistant', content: '' });
    const aiIdx = _docChatMessages.length - 1;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          if (currentEvent === 'token') {
            try {
              const token = JSON.parse(line.slice(6));
              aiText += token;
              _docChatMessages[aiIdx].content = aiText;
              renderDocChatMessages();
            } catch (e) {}
          } else if (currentEvent === 'done') {
            streamDone = true;
          } else if (currentEvent === 'error') {
            try {
              const errMsg = JSON.parse(line.slice(6));
              _docChatMessages[aiIdx].content = aiText || ('Error: ' + errMsg);
            } catch (e) {}
            streamDone = true;
          }
          currentEvent = '';
        } else if (line === '') {
          currentEvent = '';
        }
      }
    }
    // Final render with parsed markdown
    _docChatMessages[aiIdx].content = aiText;
    renderDocChatMessages(true);
  } catch (e) {
    if (e.name !== 'AbortError') {
      _docChatMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
      renderDocChatMessages(true);
    }
  }
  _docChatAbort = null;
  setButtonDisabled(false);
}

function renderDocChatMessages(final) {
  const container = document.getElementById('doc-chat-messages');
  if (!container) return;
  container.innerHTML = _docChatMessages.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="doc-msg-user">${escapeHtml(m.content)}</div>`;
    }
    const isLast = i === _docChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return `<div class="doc-msg-ai">${content}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// Text selection → "Ask about this" floating button
document.addEventListener('mouseup', function(e) {
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) existing.remove();

  const msgContainer = document.getElementById('doc-chat-messages');
  if (!msgContainer || !msgContainer.contains(e.target)) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3) return;

  const btn = document.createElement('button');
  btn.id = 'doc-chat-ask-float';
  btn.className = 'doc-chat-ask-btn';
  btn.textContent = 'Ask about this';
  btn.style.left = e.pageX + 'px';
  btn.style.top = (e.pageY - 30) + 'px';
  btn.onclick = function() {
    const input = document.getElementById('doc-chat-input');
    if (input) input.value = '> ' + text + '\n\n';
    input.focus();
    btn.remove();
  };
  document.body.appendChild(btn);
});

document.addEventListener('mousedown', function(e) {
  const btn = document.getElementById('doc-chat-ask-float');
  if (btn && !btn.contains(e.target)) btn.remove();
});

function openPaper(index) {
  paperViewOrigin = 'arxiv';
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  markPostAsRead(paper.link);
  if (paper.source === 'arxiv') {
    showPaperView(paper, 'paper/' + index);
  } else {
    fetch(`/api/check-embed?url=${encodeURIComponent(paper.link)}`)
      .then(r => r.json())
      .then(data => {
        if (data.embeddable) {
          showPaperView(paper, 'paper/' + index);
        } else {
          window.open(paper.link, '_blank');
        }
      })
      .catch(() => {
        window.open(paper.link, '_blank');
      });
  }
}

function openPaperByUrl(url) {
  paperViewOrigin = 'search';
  const hashVal = 'view/' + encodeURIComponent(url);
  const cached = (searchResultsCache || []).find(r => r && r.link === url);
  if (cached) { showPaperView(cached, hashVal); return; }
  const savedEntry = getSavedPosts()[url];
  if (savedEntry?.paper) { paperViewOrigin = 'saved'; showPaperView(savedEntry.paper, hashVal); return; }
  const feedPaper = allPapers.find(p => p.link === url);
  if (feedPaper) { showPaperView(feedPaper, hashVal); return; }
  showPaperView({ title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' }, hashVal);
}

// ── Search View ──
let searchResultsCache = [];
let searchCurrentQuery = '';
let searchCurrentStart = 0;
let searchSort = 'citations';
let searchLastTotal = 0;
let searchResultsSorted = [];
function _searchAuthorLabel(authors) {
  if (!authors) return '';
  const list = authors.split(',').map(a => a.trim()).filter(Boolean);
  if (!list.length) return '';
  const byMatch = searchCurrentQuery.match(/\bby:(.+)/i);
  if (byMatch) {
    const needle = byMatch[1].trim().toLowerCase();
    const match = list.find(a => a.toLowerCase().includes(needle));
    if (match) return escapeHtml(match);
  }
  return list.length > 1 ? escapeHtml(list[0]) + ' et al.' : escapeHtml(list[0]);
}

function onSearchInput() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  renderSearchFeedResults(query);
}

function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;
  if (typeof saveSearchHistory === 'function') saveSearchHistory(query);
  hideSearchHistoryView();
  const hints = document.getElementById('search-hints');
  if (hints) hints.style.display = 'none';
  // Filter feed results
  renderSearchFeedResults(query);
  // Skip arXiv search if query is only source:/sort: prefixes (no searchable terms)
  const searchableTokens = query.split(/\s+/).filter(t => !t.startsWith('source:') && !t.startsWith('sort:'));
  if (searchableTokens.length === 0) return;
  searchCurrentStart = 0;
  searchSort = 'citations';
  searchCurrentQuery = query;
  // Reset OpenAlex (lazy-loaded on header click)
  openalexResultsCache = [];
  openalexLoaded = false;
  openalexCollapsed = true;
  arxivCollapsed = false;
  doSearchArxiv();
  // Show collapsed OpenAlex header
  const oaContainer = document.getElementById('search-openalex-results');
  if (oaContainer) renderOpenAlexHeader(oaContainer, false);
}

function renderSearchFeedResults(query) {
  const container = document.getElementById('search-feed-results');
  if (!container) return;
  if (!query) { container.innerHTML = ''; return; }
  const parsed = parseSearchQuery(query.toLowerCase());
  const { authorFilter, sourceFilter, textTokens, exactPhrases, titleTokens, titlePhrases } = parsed;
  const matches = allPapers.filter(p => {
    if (authorFilter && !(p.authors || '').toLowerCase().includes(authorFilter)) return false;
    if (sourceFilter && !p.source.toLowerCase().includes(sourceFilter) && !(SOURCE_NAMES[p.source] || '').toLowerCase().includes(sourceFilter)) return false;
    const allPhrases = exactPhrases.slice();
    if (textTokens.length) allPhrases.push(textTokens.join(' '));
    if (allPhrases.length || titleTokens.length || titlePhrases.length) {
      const titleLow = p.title.toLowerCase();
      const h = `${p.title} ${p.authors} ${p.description}`.toLowerCase();
      if (!allPhrases.every(ph => h.includes(ph))) return false;
      if (!titlePhrases.every(ph => titleLow.includes(ph))) return false;
      if (!titleTokens.every(t => titleLow.includes(t))) return false;
      return true;
    }
    return !!(authorFilter || sourceFilter);
  }).slice(0, 30);

  if (!matches.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<div class="mb-2 text-[0.75rem] text-dimmer uppercase tracking-wide">Feed (${matches.length})</div>` +
    matches.map((p, i) => {
      const sourceChip = getSourceChip(p.source, p.arxivId);
      const authorLabel = _searchAuthorLabel(p.authors);
      const date = p.date ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(p.date)}</span>` : '';
      return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchFeedPaper(${i})">
        ${sourceChip}
        <span class="text-[0.82rem] text-primary truncate">${renderTitle(p.title)}</span>
        ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
        <span class="ml-auto shrink-0">${date}</span>
      </div>`;
    }).join('');

  // Stash matches for click handling
  searchResultsCache._feedMatches = matches;
}

function openSearchFeedPaper(i) {
  const matches = searchResultsCache._feedMatches;
  if (!matches || !matches[i]) return;
  openPaperByUrl(matches[i].link);
}

async function doSearchArxiv() {
  const container = document.getElementById('search-arxiv-results');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-8 text-dim text-[0.9rem]"><div class="spinner"></div><div>Searching arXiv...</div></div>';
  try {
    const resp = await fetch(`/api/arxiv-search?q=${encodeURIComponent(searchCurrentQuery)}&start=${searchCurrentStart}&max_results=100`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    parseSearchArxivResults(xml);
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-dim text-[0.9rem]">Search failed: ${err.message}</div>`;
  }
}

function parseSearchArxivResults(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ns = 'http://www.w3.org/2005/Atom';
  const entries = doc.getElementsByTagNameNS(ns, 'entry');
  const totalStr = doc.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/', 'totalResults')[0]?.textContent || '0';
  const total = parseInt(totalStr, 10);

  searchResultsCache = Array.from(entries).map(entry => {
    const title = (entry.getElementsByTagNameNS(ns, 'title')[0]?.textContent || '').trim().replace(/\s+/g, ' ');
    const summary = (entry.getElementsByTagNameNS(ns, 'summary')[0]?.textContent || '').trim().replace(/\s+/g, ' ');
    const published = (entry.getElementsByTagNameNS(ns, 'published')[0]?.textContent || '').slice(0, 10);
    const authors = Array.from(entry.getElementsByTagNameNS(ns, 'author'))
      .map(a => a.getElementsByTagNameNS(ns, 'name')[0]?.textContent?.trim() || '').join(', ');
    const links = entry.getElementsByTagNameNS(ns, 'link');
    let link = '';
    for (const l of links) {
      if (l.getAttribute('type') === 'text/html' || (!link && l.getAttribute('rel') === 'alternate')) {
        link = l.getAttribute('href') || '';
      }
    }
    if (!link) link = entry.getElementsByTagNameNS(ns, 'id')[0]?.textContent || '';
    const categories = Array.from(entry.getElementsByTagNameNS(ns, 'category'))
      .map(c => c.getAttribute('term')).filter(Boolean);
    const arxivCats = entry.querySelectorAll('category');
    for (const c of arxivCats) {
      const t = c.getAttribute('term');
      if (t && !categories.includes(t)) categories.push(t);
    }
    const dateStr = published ? formatDate(new Date(published + 'T00:00:00')) : '';
    const arxivId = extractArxivId(link);
    return { title, description: summary, authors, link, published, date: dateStr, categories, arxivId };
  });

  renderSearchArxivResults(total);
  fetchSearchCitations(total);
}

let arxivCollapsed = false;

function toggleArxivCollapse() {
  arxivCollapsed = !arxivCollapsed;
  renderSearchArxivResults(searchLastTotal);
}

function setSearchSort(mode) {
  searchSort = mode;
  renderSearchArxivResults(searchLastTotal);
}

function renderSearchArxivResults(total) {
  const container = document.getElementById('search-arxiv-results');
  if (!container) return;
  if (!searchResultsCache.length || typeof searchResultsCache[0] === 'undefined') {
    if (!Array.isArray(searchResultsCache) || !searchResultsCache.length) {
      searchResultsCache = [];
    }
  }

  let sorted = [...searchResultsCache].filter(r => r && r.title);
  if (searchSort === 'citations') {
    sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  } else if (searchSort === 'latest') {
    sorted.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const chevron = arxivCollapsed
    ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'
    : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const isCited = searchSort === 'citations';
  const sortIcon = isCited
    ? `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>`
    : `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
  const header = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleArxivCollapse()">${chevron} arXiv <span class="text-[0.7rem] normal-case">(${sorted.length})</span></button>
    ${!arxivCollapsed ? `<button class="shrink-0 w-7 h-7 rounded-lg border border-border-input bg-card text-muted cursor-pointer transition-all duration-150 hover:border-accent hover:text-primary flex items-center justify-center" onclick="setSearchSort('${isCited ? 'latest' : 'citations'}')" title="${isCited ? 'Sort by latest' : 'Sort by most cited'}">${sortIcon}</button>` : ''}
  </div>`;

  if (arxivCollapsed) {
    container.innerHTML = header;
    searchLastTotal = total;
    return;
  }

  searchResultsSorted = sorted;
  container.innerHTML = header + sorted.map((r, i) => {
    const authorLabel = _searchAuthorLabel(r.authors);
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openSearchArxivPaper(${i})">
      ${r.arxivId ? ARXIV_LOGO_INLINE : ''}<span class="text-[0.82rem] text-primary truncate">${renderTitle(r.title)}</span>
      ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
      ${r.citations !== undefined ? `<span class="text-[0.68rem] text-dim shrink-0">${r.citations} cited</span>` : ''}
      ${r.date ? `<span class="text-[0.68rem] text-dim shrink-0 ml-auto">${escapeHtml(r.date)}</span>` : ''}
    </div>`;
  }).join('') + (total > 100 ? `
    <div class="finder-pagination flex justify-center gap-3 pt-6">
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${searchCurrentStart === 0 ? 'disabled' : ''} onclick="searchPrev()">Previous</button>
      <span class="text-dimmer text-[0.8rem] self-center">${searchCurrentStart + 1}&ndash;${searchCurrentStart + sorted.length} of ${total}</span>
      <button class="px-5 py-2 rounded-md border border-border-input bg-card text-muted text-[0.85rem] cursor-pointer hover:border-accent hover:text-white_ disabled:opacity-30 disabled:cursor-default disabled:border-border-input disabled:text-muted" ${searchCurrentStart + 100 >= total ? 'disabled' : ''} onclick="searchNext()">Next</button>
    </div>
  ` : '');
  searchLastTotal = total;
}

async function fetchSearchCitations(total) {
  const results = searchResultsCache.filter(r => r && r.arxivId);
  const ids = results.map(r => r.arxivId);
  if (!ids.length) return;
  try {
    const resp = await fetch('/api/citations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (resp.ok) {
      const data = await resp.json();
      for (const r of searchResultsCache) {
        if (r && r.arxivId && data[r.arxivId] !== undefined) {
          r.citations = data[r.arxivId];
        }
      }
      renderSearchArxivResults(total);
    }
  } catch (e) { /* silently fail */ }
}

function openSearchArxivPaper(i) {
  const r = searchResultsSorted[i];
  if (r && r.link) openPaperByUrl(r.link);
}

function searchPrev() {
  searchCurrentStart = Math.max(0, searchCurrentStart - 100);
  doSearchArxiv();
}

function searchNext() {
  searchCurrentStart += 100;
  doSearchArxiv();
}

// ── OpenAlex Search ──
let openalexResultsCache = [];
let openalexSort = 'citations';
let openalexResultsSorted = [];
let openalexCollapsed = true;
let openalexLoaded = false;

function toggleOpenAlexCollapse() {
  openalexCollapsed = !openalexCollapsed;
  if (!openalexCollapsed && !openalexLoaded && searchCurrentQuery) {
    openalexLoaded = true;
    doSearchOpenAlex();
    return;
  }
  renderOpenAlexResults();
}

async function doSearchOpenAlex() {
  const container = document.getElementById('search-openalex-results');
  if (!container) return;
  renderOpenAlexHeader(container, true);
  try {
    const resp = await fetch(`/api/openalex-search?q=${encodeURIComponent(searchCurrentQuery)}&per_page=100`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    openalexResultsCache = (data.results || []).map(w => {
      const authors = (w.authorships || []).map(a => a.author?.display_name || '').filter(Boolean).join(', ');
      const published = w.publication_date || '';
      const dateStr = published ? formatDate(new Date(published + 'T00:00:00')) : '';
      const doi = w.doi || '';
      const link = doi || (w.primary_location?.landing_page_url || w.id || '');
      const source = w.primary_location?.source?.display_name || '';
      return { title: w.title || '', authors, link, date: dateStr, pubDate: published, citations: w.cited_by_count || 0, source, type: w.type || '' };
    });
    renderOpenAlexResults();
  } catch (err) {
    renderOpenAlexHeader(container, false);
  }
}

function renderOpenAlexHeader(container, loading) {
  const chevron = openalexCollapsed
    ? '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'
    : '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const count = openalexResultsCache.length ? ` <span class="text-[0.7rem] normal-case">(${openalexResultsCache.length})</span>` : '';
  const loadingEl = loading ? ' <span class="text-[0.7rem] text-dim normal-case">loading...</span>' : '';
  container.innerHTML = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleOpenAlexCollapse()">${chevron} OpenAlex${count}${loadingEl}</button>
  </div>`;
}

function renderOpenAlexResults() {
  const container = document.getElementById('search-openalex-results');
  if (!container) return;
  if (!searchCurrentQuery) { container.innerHTML = ''; return; }

  if (openalexCollapsed || !openalexResultsCache.length) {
    renderOpenAlexHeader(container, false);
    return;
  }

  let sorted = [...openalexResultsCache];
  if (openalexSort === 'citations') {
    sorted.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  } else {
    sorted.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });
  }

  const chevron = '<svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  const isCited = openalexSort === 'citations';
  const sortIcon = isCited
    ? `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>`
    : `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
  const header = `<div class="flex items-center gap-2 mb-3 mt-4">
    <button class="flex items-center gap-1 text-[0.75rem] text-dimmer uppercase tracking-wide cursor-pointer bg-transparent border-none hover:text-primary transition-colors" onclick="toggleOpenAlexCollapse()">${chevron} OpenAlex <span class="text-[0.7rem] normal-case">(${sorted.length})</span></button>
    <button class="shrink-0 w-7 h-7 rounded-lg border border-border-input bg-card text-muted cursor-pointer transition-all duration-150 hover:border-accent hover:text-primary flex items-center justify-center" onclick="setOpenAlexSort('${isCited ? 'latest' : 'citations'}')" title="${isCited ? 'Sort by latest' : 'Sort by most cited'}">${sortIcon}</button>
  </div>`;

  openalexResultsSorted = sorted;
  container.innerHTML = header + sorted.map((r, i) => {
    const sourceTag = r.source ? `<span class="text-[0.68rem] text-dim shrink-0">${escapeHtml(truncate(r.source, 30))}</span>` : '';
    const authorLabel = _searchAuthorLabel(r.authors);
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors" onclick="openOpenAlexPaper(${i})">
      ${sourceTag}<span class="text-[0.82rem] text-primary truncate">${escapeHtml(r.title)}</span>
      ${authorLabel ? `<span class="text-[0.68rem] text-dimmer shrink-0">${authorLabel}</span>` : ''}
      <span class="text-[0.68rem] text-dim shrink-0">${r.citations} cited</span>
      ${r.date ? `<span class="text-[0.68rem] text-dim shrink-0 ml-auto">${escapeHtml(r.date)}</span>` : ''}
    </div>`;
  }).join('');
}

function setOpenAlexSort(mode) {
  openalexSort = mode;
  renderOpenAlexResults();
}

function openOpenAlexPaper(i) {
  const r = openalexResultsSorted[i];
  if (!r || !r.link) return;
  openPaperByUrl(r.link);
}

// ── Search History (for search view) ──
function selectSearchHistory(index) {
  const hist = getSearchHistory();
  if (!hist[index]) return;
  const input = document.getElementById('search-query');
  if (input) input.value = hist[index];
  hideSearchHistoryView();
  submitSearch();
}

function showSearchHistoryView() {
  const input = document.getElementById('search-query');
  const dd = document.getElementById('search-history-dropdown-view');
  if (!dd || !input) return;
  if (input.value.trim()) { dd.classList.add('hidden'); return; }
  const hist = getSearchHistory();
  if (!hist.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = hist.map((h, i) => `<div class="flex items-center gap-2 px-3 py-1.5 hover:bg-hover cursor-pointer text-[0.82rem] text-primary" onmousedown="event.preventDefault(); selectSearchHistory(${i})">
    <span class="truncate flex-1">${escapeHtml(h)}</span>
    <button class="bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-primary" onmousedown="event.preventDefault(); event.stopPropagation(); removeSearchHistory(${i});">×</button>
  </div>`).join('');
  dd.classList.remove('hidden');
}

function hideSearchHistoryView() {
  const dd = document.getElementById('search-history-dropdown-view');
  if (dd) dd.classList.add('hidden');
}


// ── Calendar ──
let calendarEvents = [];
let calendarYear, calendarMonth;
let calendarSelectedDay = null;
let calendarShowForm = false;

{
  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
}

function openCalendar() {
  hideAllViews();
  const view = document.getElementById('calendar-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'calendar';
  setSidebarActive('sb-home');
  fetchCalendarEvents();
}

async function fetchCalendarEvents() {
  try {
    const evResp = await fetch('/api/calendar');
    calendarEvents = await evResp.json();
  } catch (e) { calendarEvents = []; }
  renderCalendarView();
}

async function addCalendarEvent(ev) {
  try {
    const resp = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev)
    });
    const created = await resp.json();
    calendarEvents.push(created);
    calendarShowForm = false;
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

async function deleteCalendarEvent(id) {
  try {
    await fetch('/api/calendar/' + id, { method: 'DELETE' });
    calendarEvents = calendarEvents.filter(e => e.id !== id);
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

function calendarPrev() { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarNext() { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarToday() { const n = new Date(); calendarYear = n.getFullYear(); calendarMonth = n.getMonth(); calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }

function calendarSelectDay(day) {
  calendarSelectedDay = day;
  calendarShowForm = false;
  renderCalendarView();
}

function calendarToggleForm() {
  calendarShowForm = !calendarShowForm;
  renderCalendarView();
}

function calendarSubmitForm() {
  const title = document.getElementById('cal-ev-title').value.trim();
  if (!title) return;
  const desc = document.getElementById('cal-ev-desc').value.trim();
  const colorEl = document.querySelector('input[name="cal-ev-color"]:checked');
  const color = colorEl ? colorEl.value : '#b4451a';
  const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(calendarSelectedDay).padStart(2, '0')}`;
  addCalendarEvent({ title, description: desc, date: dateStr, color });
}

function renderCalendarView() {
  const container = document.getElementById('calendar-view-content');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth;
  const todayDate = today.getDate();

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

  const eventsByDay = {};
  calendarEvents.forEach(ev => {
    const [y, m, d] = ev.date.split('-').map(Number);
    if (y === calendarYear && m === calendarMonth + 1) {
      if (!eventsByDay[d]) eventsByDay[d] = [];
      eventsByDay[d].push(ev);
    }
  });

  const presetColors = [
    { value: '#b4451a', label: 'Accent' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#22c55e', label: 'Green' },
    { value: '#a855f7', label: 'Purple' },
    { value: '#eab308', label: 'Yellow' },
    { value: '#ef4444', label: 'Red' }
  ];

  let html = `
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-[1.3rem] font-semibold text-white_">Calendar</h2>
    </div>
    <div class="flex items-center gap-3 mb-5">
      <button onclick="calendarPrev()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <button onclick="calendarToday()" class="px-3 py-1 rounded-lg bg-card border border-border-card text-[0.8rem] text-primary cursor-pointer hover:bg-hover transition-colors">Today</button>
      <button onclick="calendarNext()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>
      <span class="text-[1.1rem] font-semibold text-white_ ml-1">${monthNames[calendarMonth]} ${calendarYear}</span>
    </div>
    <div class="grid grid-cols-7 gap-px bg-border-card rounded-xl overflow-hidden border border-border-card">
  `;

  dayNames.forEach(d => {
    html += `<div class="bg-card px-2 py-2 text-center text-[0.75rem] font-semibold text-dimmer uppercase tracking-wide">${d}</div>`;
  });

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && d === todayDate;
    const isSelected = d === calendarSelectedDay;
    const evs = eventsByDay[d] || [];
    const borderClass = isToday ? 'border-2 border-accent' : '';
    const selectedClass = isSelected ? 'bg-hover' : 'bg-card';
    html += `<div class="${selectedClass} ${borderClass} px-2 py-1.5 min-h-[70px] cursor-pointer hover:bg-hover transition-colors" onclick="calendarSelectDay(${d})">
      <span class="text-[0.8rem] ${isToday ? 'text-accent font-bold' : 'text-primary'}">${d}</span>
      <div class="flex flex-wrap gap-1 mt-1">
        ${evs.map(ev => `<span class="w-2 h-2 rounded-full inline-block" style="background:${ev.color}" title="${ev.title.replace(/"/g, '&quot;')}"></span>`).join('')}
      </div>
    </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  html += `</div>`;

  if (calendarSelectedDay !== null) {
    const evs = eventsByDay[calendarSelectedDay] || [];
    const dateStr = `${monthNames[calendarMonth]} ${calendarSelectedDay}, ${calendarYear}`;
    html += `
      <div class="mt-6 p-5 bg-card rounded-xl border border-border-card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[1rem] font-semibold text-white_">${dateStr}</h3>
          <button onclick="calendarToggleForm()" class="px-3 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">${calendarShowForm ? 'Cancel' : '+ Add Event'}</button>
        </div>
    `;

    if (calendarShowForm) {
      html += `
        <div class="mb-4 p-4 bg-body rounded-lg border border-border-card">
          <input type="text" id="cal-ev-title" placeholder="Event title..." class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 focus:outline-none focus:border-accent" />
          <textarea id="cal-ev-desc" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 resize-none focus:outline-none focus:border-accent"></textarea>
          <div class="flex items-center gap-3 mb-3">
            <span class="text-[0.8rem] text-dimmer">Color:</span>
            ${presetColors.map((c, i) => `
              <label class="cursor-pointer">
                <input type="radio" name="cal-ev-color" value="${c.value}" ${i === 0 ? 'checked' : ''} class="sr-only peer" />
                <span class="w-6 h-6 rounded-full inline-block border-2 border-transparent peer-checked:border-white transition-colors" style="background:${c.value}" title="${c.label}"></span>
              </label>
            `).join('')}
          </div>
          <div class="flex gap-2">
            <button onclick="calendarSubmitForm()" class="px-4 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">Save</button>
            <button onclick="calendarToggleForm()" class="px-4 py-1.5 rounded-lg bg-card border border-border-card text-primary text-[0.8rem] cursor-pointer hover:bg-hover transition-colors">Cancel</button>
          </div>
        </div>
      `;
    }

    if (evs.length === 0 && !calendarShowForm) {
      html += `<p class="text-[0.85rem] text-dimmer">No events on this day.</p>`;
    } else {
      evs.forEach(ev => {
        html += `
          <div class="flex items-start gap-3 py-2.5 border-b border-border-dim last:border-0">
            <span class="w-3 h-3 rounded-full mt-1 flex-shrink-0" style="background:${ev.color}"></span>
            <div class="flex-1 min-w-0">
              <div class="text-[0.9rem] font-medium text-white_">${ev.title}</div>
              ${ev.description ? `<div class="text-[0.8rem] text-dimmer mt-0.5">${ev.description}</div>` : ''}
            </div>
            <button onclick="deleteCalendarEvent('${ev.id}')" class="text-dimmer hover:text-red-400 transition-colors cursor-pointer bg-transparent border-none p-1" title="Delete event">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
      });

    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

// ── Whiteboard ──
let _wbStrokes = [];
let _wbRedoStack = [];
let _wbDrawing = false;
let _wbCurrent = null;
let _wbCtx = null;
let _wbCanvas = null;
let _wbMode = 'draw'; // 'draw' | 'eraser' | 'stroke-eraser'
let _wbInited = false;
let _wbResizeObs = null;
let _wbCurrentId = null; // id of active whiteboard
let _wbBoards = []; // [{id, name, createdAt}]

function _loadWbBoards() {
  try {
    const raw = localStorage.getItem('whiteboardBoards');
    _wbBoards = raw ? JSON.parse(raw) : [];
  } catch { _wbBoards = []; }
}

function _saveWbBoards() {
  try { localStorage.setItem('whiteboardBoards', JSON.stringify(_wbBoards)); } catch {}
}

function _wbStrokesKey(id) { return 'wb_strokes_' + id; }

function openWhiteboard() {
  hideAllViews();
  const view = document.getElementById('whiteboard-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'whiteboard';
  setSidebarActive('sb-whiteboard');
  _loadWbBoards();
  // Migrate old single-board data
  const oldStrokes = localStorage.getItem('whiteboardStrokes');
  if (oldStrokes && !_wbBoards.length) {
    const id = Date.now().toString(36) + 'migrated';
    _wbBoards.push({ id, name: 'Untitled', createdAt: Date.now() });
    _saveWbBoards();
    localStorage.setItem(_wbStrokesKey(id), oldStrokes);
    localStorage.removeItem('whiteboardStrokes');
  }
  // Open last board, or create one
  if (!_wbBoards.length) wbNew(true);
  else {
    const lastId = localStorage.getItem('whiteboardLastId');
    const board = _wbBoards.find(b => b.id === lastId) || _wbBoards[0];
    wbOpen(board.id);
  }
  _renderWbList();
  initWhiteboard();
}

function wbNew(silent) {
  _loadWbBoards();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const board = { id, name: 'Untitled', createdAt: Date.now() };
  _wbBoards.unshift(board);
  _saveWbBoards();
  wbOpen(id);
  if (!silent) _renderWbList();
}

function wbOpen(id) {
  // Save current board first
  if (_wbCurrentId && _wbCurrentId !== id) _saveWbStrokes();
  _wbCurrentId = id;
  localStorage.setItem('whiteboardLastId', id);
  // Load strokes
  try {
    const raw = localStorage.getItem(_wbStrokesKey(id));
    _wbStrokes = raw ? JSON.parse(raw) : [];
  } catch { _wbStrokes = []; }
  _wbRedoStack = [];
  if (_wbCtx) { _sizeWbCanvas(); _redrawWb(); }
  _renderWbList();
  // Update title display
  const board = _wbBoards.find(b => b.id === id);
  const titleEl = document.getElementById('wb-title-display');
  if (titleEl && board) titleEl.textContent = board.name;
}

function wbDelete(id) {
  _loadWbBoards();
  _wbBoards = _wbBoards.filter(b => b.id !== id);
  _saveWbBoards();
  try { localStorage.removeItem(_wbStrokesKey(id)); } catch {}
  if (_wbCurrentId === id) {
    if (_wbBoards.length) wbOpen(_wbBoards[0].id);
    else { wbNew(true); }
  }
  _renderWbList();
}

function wbRename(id) {
  const board = _wbBoards.find(b => b.id === id);
  if (!board) return;
  const el = document.getElementById('wb-name-' + id);
  if (!el) return;
  _wbStartEditable(el, (newName) => {
    board.name = newName;
    _saveWbBoards();
    const titleEl = document.getElementById('wb-title-display');
    if (titleEl && _wbCurrentId === id) titleEl.textContent = newName;
    _renderWbList();
  });
}

function wbRenameActive() {
  if (!_wbCurrentId) return;
  const titleEl = document.getElementById('wb-title-display');
  if (!titleEl) return;
  const board = _wbBoards.find(b => b.id === _wbCurrentId);
  if (!board) return;
  _wbStartEditable(titleEl, (newName) => {
    board.name = newName;
    _saveWbBoards();
    _renderWbList();
  });
}

function _wbStartEditable(el, onFinish) {
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const finish = () => {
    el.contentEditable = 'false';
    const newName = el.textContent.trim() || 'Untitled';
    el.textContent = newName;
    onFinish(newName);
  };
  el.onblur = finish;
  el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
}

function _renderWbList() {
  const list = document.getElementById('wb-list');
  if (!list) return;
  list.innerHTML = _wbBoards.map(b => {
    const sel = b.id === _wbCurrentId;
    const date = new Date(b.createdAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    return `<div class="wb-list-item group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${sel ? 'bg-accent/15' : 'hover:bg-hover'}" onclick="wbOpen('${b.id}')">
      <div class="flex-1 min-w-0">
        <div id="wb-name-${b.id}" class="text-[0.82rem] text-primary truncate" ondblclick="event.stopPropagation(); wbRename('${b.id}')">${escapeHtml(b.name)}</div>
        <div class="text-[0.68rem] text-dimmer">${dateStr}</div>
      </div>
      <button onclick="event.stopPropagation(); wbDelete('${b.id}')" class="shrink-0 bg-transparent border-none cursor-pointer p-0.5 text-dimmer hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

function _wbDefaultColor() {
  const theme = document.documentElement.getAttribute('data-theme');
  return (theme === 'light' || theme === 'sepia') ? '#000000' : '#ffffff';
}

function initWhiteboard() {
  _wbCanvas = document.getElementById('wb-canvas');
  _wbCtx = _wbCanvas.getContext('2d');

  // Set color picker default based on theme
  const colorInput = document.getElementById('wb-color');
  if (colorInput) colorInput.value = _wbDefaultColor();

  _sizeWbCanvas();
  _redrawWb();

  if (_wbInited) return;
  _wbInited = true;

  // Pointer events
  _wbCanvas.addEventListener('pointerdown', _wbPointerDown);
  _wbCanvas.addEventListener('pointermove', _wbPointerMove);
  _wbCanvas.addEventListener('pointerup', _wbPointerUp);
  _wbCanvas.addEventListener('pointerleave', _wbPointerUp);

  // Toolbar — mode buttons
  const setMode = (mode) => {
    _wbMode = mode;
    document.getElementById('wb-eraser').classList.toggle('active', mode === 'eraser');
    document.getElementById('wb-stroke-eraser').classList.toggle('active', mode === 'stroke-eraser');
    _wbCanvas.style.cursor = mode === 'draw' ? 'crosshair' : 'pointer';
  };
  document.getElementById('wb-eraser').addEventListener('click', () => {
    setMode(_wbMode === 'eraser' ? 'draw' : 'eraser');
  });
  document.getElementById('wb-stroke-eraser').addEventListener('click', () => {
    setMode(_wbMode === 'stroke-eraser' ? 'draw' : 'stroke-eraser');
  });
  document.getElementById('wb-undo').addEventListener('click', _wbUndo);
  document.getElementById('wb-redo').addEventListener('click', _wbRedo);
  document.getElementById('wb-clear').addEventListener('click', _wbClear);
  document.getElementById('wb-size').addEventListener('input', (e) => {
    document.getElementById('wb-size-label').textContent = e.target.value;
  });

  // Resize
  _wbResizeObs = new ResizeObserver(() => {
    _sizeWbCanvas();
    _redrawWb();
  });
  _wbResizeObs.observe(document.getElementById('wb-canvas-area'));
}

function _sizeWbCanvas() {
  const area = document.getElementById('wb-canvas-area');
  if (!area) return;
  const toolbar = area.querySelector('.wb-toolbar');
  const toolbarH = toolbar ? toolbar.offsetHeight : 0;
  _wbCanvas.width = area.clientWidth;
  _wbCanvas.height = area.clientHeight - toolbarH;
}

function _getWbBgColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg-body').trim() || '#0a0a0a';
}

function _wbPointerDown(e) {
  const rect = _wbCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_wbMode === 'stroke-eraser') {
    // Find and remove the topmost stroke near this point
    _wbDrawing = true;
    _wbCanvas.setPointerCapture(e.pointerId);
    _wbStrokeErase(x, y);
    return;
  }

  _wbDrawing = true;
  _wbCanvas.setPointerCapture(e.pointerId);
  const color = _wbMode === 'eraser' ? _getWbBgColor() : document.getElementById('wb-color').value;
  const size = parseInt(document.getElementById('wb-size').value, 10);
  _wbCurrent = { points: [{ x, y }], color, size, eraser: _wbMode === 'eraser' };
  _wbCtx.lineCap = 'round';
  _wbCtx.lineJoin = 'round';
  _wbCtx.strokeStyle = color;
  _wbCtx.lineWidth = size;
  _wbCtx.beginPath();
  _wbCtx.moveTo(x, y);
}

function _wbPointerMove(e) {
  if (!_wbDrawing) return;
  const rect = _wbCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (_wbMode === 'stroke-eraser') {
    _wbStrokeErase(x, y);
    return;
  }

  if (!_wbCurrent) return;
  _wbCurrent.points.push({ x, y });
  _wbCtx.lineTo(x, y);
  _wbCtx.stroke();
  _wbCtx.beginPath();
  _wbCtx.moveTo(x, y);
}

function _wbPointerUp() {
  if (!_wbDrawing) return;
  _wbDrawing = false;
  if (_wbMode !== 'stroke-eraser' && _wbCurrent && _wbCurrent.points.length > 0) {
    _wbStrokes.push(_wbCurrent);
    _wbRedoStack = [];
    _saveWbStrokes();
  }
  _wbCurrent = null;
}

// Distance from point (px,py) to line segment (ax,ay)-(bx,by)
function _ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _wbStrokeErase(x, y) {
  const threshold = 8;
  // Walk strokes top-to-bottom (last drawn = topmost)
  for (let i = _wbStrokes.length - 1; i >= 0; i--) {
    const s = _wbStrokes[i];
    if (s.eraser) continue; // skip eraser strokes
    for (let j = 0; j < s.points.length - 1; j++) {
      const d = _ptSegDist(x, y, s.points[j].x, s.points[j].y, s.points[j + 1].x, s.points[j + 1].y);
      if (d <= threshold + s.size / 2) {
        _wbRedoStack = [];
        _wbStrokes.splice(i, 1);
        _redrawWb();
        _saveWbStrokes();
        return;
      }
    }
    // Single-point stroke (dot)
    if (s.points.length === 1) {
      const d = Math.hypot(x - s.points[0].x, y - s.points[0].y);
      if (d <= threshold + s.size / 2) {
        _wbRedoStack = [];
        _wbStrokes.splice(i, 1);
        _redrawWb();
        _saveWbStrokes();
        return;
      }
    }
  }
}

function _redrawWb() {
  const ctx = _wbCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, _wbCanvas.width, _wbCanvas.height);
  ctx.fillStyle = _getWbBgColor();
  ctx.fillRect(0, 0, _wbCanvas.width, _wbCanvas.height);
  for (const stroke of _wbStrokes) {
    if (stroke.points.length === 0) continue;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

function _wbUndo() {
  if (!_wbStrokes.length) return;
  _wbRedoStack.push(_wbStrokes.pop());
  _redrawWb();
  _saveWbStrokes();
}

function _wbRedo() {
  if (!_wbRedoStack.length) return;
  _wbStrokes.push(_wbRedoStack.pop());
  _redrawWb();
  _saveWbStrokes();
}

function _wbClear() {
  if (!_wbStrokes.length) return;
  _wbRedoStack = [];
  _wbStrokes = [];
  _redrawWb();
  _saveWbStrokes();
}

function _saveWbStrokes() {
  if (!_wbCurrentId) return;
  try {
    localStorage.setItem(_wbStrokesKey(_wbCurrentId), JSON.stringify(_wbStrokes));
  } catch {}
}
