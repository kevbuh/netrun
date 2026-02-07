// browse-urlbar.js — URL bar, instant answers, history, ad blocker
// ── Browse URL Bar History Dropdown ──

let _browseUrlHistIdx = -1;
let _browseUrlOriginalInput = '';
let _suggestDebounce = null;
let _suggestAbort = null;
let _suggestCache = {};
let _currentSuggestions = [];
let _defCache = {};
let _defDebounce = null;
let _currentDef = null; // cached definition entry for current word
let _instantAnswer = null; // { type, html } for non-definition instant answers
let _instantDebounce = null;
let _instantCache = {};

function _browseUrlKeydown(e) {
  const dd = document.getElementById('browse-url-history-dd');
  const visible = dd && dd.style.display !== 'none';

  if (e.key === 'Enter') {
    if (visible && _browseUrlHistIdx >= 0) {
      e.preventDefault();
      const items = dd.querySelectorAll('[data-histq]');
      if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        _browseUrlHideHistory();
        if (q.startsWith('project:')) {
          openExperimentDetail(q.slice(8));
        } else {
          document.getElementById('browse-url-input').value = q;
          browseNavigate(q);
        }
      }
    } else {
      _browseUrlHideHistory();
      const urlInput = document.getElementById('browse-url-input');
      browseNavigate(urlInput ? urlInput.value : '');
    }
    return;
  }
  if (!visible) return;
  const items = dd.querySelectorAll('[data-histq]');
  const input = document.getElementById('browse-url-input');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (_browseUrlHistIdx === -1) _browseUrlOriginalInput = input ? input.value : '';
    _browseUrlHistIdx = Math.min(_browseUrlHistIdx + 1, items.length - 1);
    _browseUrlHighlight(items);
    if (input && _browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
      const q = items[_browseUrlHistIdx].dataset.histq;
      input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q;
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _browseUrlHistIdx = Math.max(_browseUrlHistIdx - 1, -1);
    _browseUrlHighlight(items);
    if (input) {
      if (_browseUrlHistIdx === -1) {
        input.value = _browseUrlOriginalInput;
      } else if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q;
      }
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _browseUrlHideHistory();
  }
}

function _browseUrlHighlight(items) {
  items.forEach((el, i) => {
    if (i === _browseUrlHistIdx) {
      el.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)';
      el.style.borderRadius = '6px';
    } else {
      el.style.background = 'none';
      el.style.borderRadius = '';
    }
  });
  if (_browseUrlHistIdx >= 0 && items[_browseUrlHistIdx]) {
    items[_browseUrlHistIdx].scrollIntoView({ block: 'nearest' });
  }
}

let _feelingLuckyQuery = '';
let _feelingLuckyLoading = false;

function _browseUrlFeelingLucky() {
  const input = document.getElementById('browse-url-input');
  const dd = document.getElementById('browse-url-history-dd');
  _feelingLuckyLoading = true;
  _feelingLuckyQuery = '';
  _browseUrlRenderLuckyRow(dd);
  const model = localStorage.getItem('chatModel') || 'qwen2.5:3b';
  fetch('/api/doc-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Give me a single interesting, surprising, or obscure topic to search on the web right now. Just reply with the search query, nothing else. No quotes. Be creative and varied — pick from science, history, art, philosophy, technology, nature, space, culture, or anything fascinating. Do not repeat yourself.' }],
      model: model
    })
  }).then(r => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          _feelingLuckyLoading = false;
          _feelingLuckyQuery = _feelingLuckyQuery.replace(/^["']|["']$/g, '').trim();
          _browseUrlRenderLuckyRow(dd);
          return;
        }
        const chunk = dec.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const evt = line.slice(6).trim();
          if (evt === '[DONE]') continue;
          try { const token = JSON.parse(evt); if (typeof token === 'string') _feelingLuckyQuery += token; } catch (_) {}
        }
        _browseUrlRenderLuckyRow(dd);
        read();
      });
    }
    read();
  }).catch(() => { _feelingLuckyLoading = false; _browseUrlRenderLuckyRow(dd); });
}

function _browseUrlRenderLuckyRow(dd) {
  // Re-render the full dropdown so styles (pointer-events, redo btn) update
  _browseUrlShowHistory();
}

function _browseUrlShowHistory() {
  const input = document.getElementById('browse-url-input');
  const dd = document.getElementById('browse-url-history-dd');
  if (!input || !dd) return;
  const filter = (input.value || '').trim().toLowerCase();

  // /history command — show browsing history in the dropdown
  if (filter === '/history') {
    _browseUrlRenderHistoryCommand(dd, input);
    return;
  }

  // Search history matches
  const hist = _getWebSearchHistory();
  const filteredHist = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
  let showHist = filteredHist.slice(0, 8);
  if (showHist.length === 1 && showHist[0].q.toLowerCase() === filter) showHist = [];

  // Browsing history matches
  const browseHist = _getBrowseHistory();
  const filteredBrowse = filter ? browseHist.filter(h => {
    const t = (h.title || '').toLowerCase();
    const u = (h.url || '').toLowerCase();
    return t.includes(filter) || u.includes(filter);
  }) : browseHist;
  let showBrowse = filteredBrowse.slice(0, filter ? 6 : 4);
  // Don't show if exact URL match
  if (showBrowse.length === 1 && showBrowse[0].url.toLowerCase() === filter) showBrowse = [];

  // Project matches (only when there's a filter)
  const projects = (filter && typeof allExperiments !== 'undefined') ?
    allExperiments.filter(exp => exp.title.toLowerCase().includes(filter) || (exp.desc || '').toLowerCase().includes(filter)).slice(0, 5) : [];

  // Kick off suggestion fetch (debounced)
  if (filter && filter.length >= 2) {
    _fetchSearchSuggestions(filter);
  } else {
    _currentSuggestions = [];
    if (_suggestDebounce) { clearTimeout(_suggestDebounce); _suggestDebounce = null; }
  }

  // Kick off definition fetch for single words
  if (filter && /^[a-zA-Z]{2,}$/.test(filter)) {
    _fetchWordDefinition(filter);
  } else {
    _currentDef = null;
    if (_defDebounce) { clearTimeout(_defDebounce); _defDebounce = null; }
  }

  // Kick off instant answers (math, color, conversion, weather, timezone, sports, stocks)
  _computeInstantAnswer(filter);

  _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse);
}

function _browseUrlRenderHistoryCommand(dd, input) {
  const hist = _getBrowseHistory().slice(0, 20);
  _browseUrlHistIdx = -1;
  _browseUrlOriginalInput = '/history';

  const rect = input.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 2) + 'px';
  dd.style.width = rect.width + 'px';

  if (!hist.length) {
    dd.innerHTML = '<div style="padding:12px;font-size:0.8rem;color:var(--text-dim);text-align:center;">No browsing history</div>';
    dd.style.display = '';
    return;
  }

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);transition:background 0.1s;';
  const hoverOn = "this.style.background='var(--bg-hover)'";
  const hoverOff = "if(this.dataset.idx!=window._browseUrlHistIdx)this.style.background='none'";

  let html = '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Recent Sites</div>';
  html += hist.map((h, i) => {
    const favicon = _browseFaviconUrl(h.url);
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const safeUrl = escapeHtml(h.url).replace(/"/g, '&quot;');
    const time = _relativeTime(h.ts);
    return `<div data-idx="${i}" data-histq="${safeUrl}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${escapeHtml(h.url).replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${escapeHtml(h.url).replace(/'/g, "\\'")}');">
      <img src="${escapeHtml(favicon)}" style="width:14px;height:14px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</span>
      <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(domain)}</span>
      <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(time)}</span>
    </div>`;
  }).join('');

  dd.innerHTML = html;
  dd.style.display = '';
}

function _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse) {
  showBrowse = showBrowse || [];
  const suggestions = filter ? _currentSuggestions.filter(s => s.toLowerCase() !== filter) : [];
  const hasDef = _currentDef && /^[a-zA-Z]{2,}$/.test(filter);
  const hasInstant = _instantAnswer && _instantAnswer.html;

  const showLucky = !filter;
  if (!showHist.length && !projects.length && !suggestions.length && !hasDef && !hasInstant && !showLucky && !showBrowse.length) { dd.style.display = 'none'; return; }

  _browseUrlHistIdx = -1;
  const rect = input.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 2) + 'px';
  dd.style.width = rect.width + 'px';

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--text-primary);transition:background 0.1s;';
  const hoverOn = "this.style.background='var(--bg-hover)'";
  const hoverOff = "this.style.background='none'";

  let html = '';

  // "Feeling Lucky" row when input is empty
  if (showLucky) {
    const hasText = !!_feelingLuckyQuery;
    const waiting = _feelingLuckyLoading && !hasText;
    // Auto-trigger on first show if no query yet
    if (!_feelingLuckyQuery && !_feelingLuckyLoading) {
      setTimeout(_browseUrlFeelingLucky, 0);
    }
    const displayText = hasText ? escapeHtml(_feelingLuckyQuery) : (waiting ? '<span style="color:var(--text-dimmer);">Thinking\u2026</span>' : '');
    html += `<div class="browse-lucky-row" data-histq="${escapeHtml(_feelingLuckyQuery || '')}" style="${rowStyle}border-bottom:1px solid var(--border-card);${waiting ? 'opacity:0.7;cursor:wait;' : ''}">
      <svg style="width:14px;height:14px;flex-shrink:0;color:var(--text-dimmer);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
        <span style="font-weight:600;color:var(--text-primary);">Feeling Lucky</span>
        <span class="browse-lucky-text" style="margin-left:6px;color:var(--text-dim);font-size:0.75rem;">${displayText}</span>
      </span>
      ${hasText && !_feelingLuckyLoading ? '<span class="browse-lucky-redo" style="flex-shrink:0;cursor:pointer;padding:2px 4px;border-radius:4px;color:var(--text-dimmer);font-size:0.7rem;">\u21BB</span>' : ''}
    </div>`;
  }

  // Definition section for single-word searches (always at top)
  if (hasDef) {
    const entry = _currentDef;
    html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);">';
    html += '<div style="display:flex;align-items:baseline;gap:8px;">';
    html += '<span style="font-size:1rem;font-weight:700;color:var(--text-primary);">' + escapeHtml(entry.word) + '</span>';
    const phonetic = entry.phonetics?.find(p => p.text)?.text;
    if (phonetic) html += '<span style="font-size:0.78rem;color:var(--text-dim);">' + escapeHtml(phonetic) + '</span>';
    const audio = entry.phonetics?.find(p => p.audio);
    if (audio) html += '<button onclick="event.stopPropagation();event.preventDefault();new Audio(\'' + escapeHtml(audio.audio) + '\').play()" style="background:none;border:none;cursor:pointer;color:var(--text-dimmer);padding:0;margin-left:2px;" title="Listen"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>';
    html += '</div>';
    for (const meaning of (entry.meanings || []).slice(0, 2)) {
      html += '<div style="margin-top:6px;"><span style="font-size:0.65rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.04em;">' + escapeHtml(meaning.partOfSpeech) + '</span></div>';
      for (const def of (meaning.definitions || []).slice(0, 1)) {
        html += '<div style="font-size:0.8rem;color:var(--text-primary);line-height:1.45;margin-top:2px;padding-left:8px;border-left:2px solid color-mix(in srgb, var(--accent) 30%, transparent);">' + escapeHtml(def.definition) + '</div>';
        if (def.example) html += '<div style="font-size:0.72rem;color:var(--text-dim);font-style:italic;margin-top:1px;padding-left:8px;">"' + escapeHtml(def.example) + '"</div>';
      }
    }
    html += '</div>';
  }

  // Instant answer section (math, color, conversion, weather, timezone, sports, stocks — always at top)
  if (hasInstant) {
    html += _instantAnswer.html;
  }

  // Browsing history section (visited sites)
  if (showBrowse.length) {
    html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Recent Sites</div>';
    html += showBrowse.map(h => {
      const favicon = _browseFaviconUrl(h.url);
      let domain = '';
      try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
      const safeUrl = escapeHtml(h.url).replace(/"/g, '&quot;');
      const displayTitle = escapeHtml(h.title || domain);
      return `<div data-histq="${safeUrl}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${escapeHtml(h.url).replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${escapeHtml(h.url).replace(/'/g, "\\'")}');">
        <img src="${escapeHtml(favicon)}" style="width:14px;height:14px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayTitle}</span>
        <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(domain)}</span>
      </div>`;
    }).join('');
  }

  // Suggestions section (AI autocomplete)
  if (suggestions.length) {
    html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Suggestions</div>';
    html += suggestions.map(s => {
      const safeS = escapeHtml(s);
      return `<div data-histq="${safeS.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${safeS.replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${safeS.replace(/'/g, "\\'")}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeS}</span>
      </div>`;
    }).join('');
  }

  // Projects section
  if (projects.length) {
    if (suggestions.length) html += '<div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>';
    html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Projects</div>';
    html += projects.map(exp => {
      const safeId = escapeHtml(exp.id);
      const updated = exp.lastUpdated ? _relativeTime(exp.lastUpdated) : '';
      return `<div data-histq="project:${safeId}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); _browseUrlHideHistory(); openExperimentDetail('${safeId}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(exp.title)}</span>
        ${updated ? `<span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(updated)}</span>` : ''}
      </div>`;
    }).join('');
  }

  // Search history section
  if (showHist.length) {
    if (projects.length || suggestions.length) {
      html += '<div style="border-top:1px solid var(--border-card);margin:2px 0;"></div>';
      html += '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;">Recent Searches</div>';
    }
    html += showHist.map(h => {
      const time = _relativeTime(h.ts);
      const safeQ = escapeHtml(h.q);
      return `<div data-histq="${safeQ.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); document.getElementById('browse-url-input').value='${safeQ.replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${safeQ.replace(/'/g, "\\'")}');">
        <svg style="width:13px;height:13px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeQ}</span>
        <span style="font-size:0.68rem;color:var(--text-dimmer);flex-shrink:0;">${escapeHtml(time)}</span>
      </div>`;
    }).join('');
  }

  dd.innerHTML = html;
  dd.style.display = '';

  // Attach feeling lucky click handlers (must be after innerHTML)
  const luckyRow = dd.querySelector('.browse-lucky-row');
  if (luckyRow) {
    luckyRow.addEventListener('mousedown', (ev) => {
      // Don't navigate if clicking the redo button
      if (ev.target.closest('.browse-lucky-redo')) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (_feelingLuckyQuery) {
        const inp = document.getElementById('browse-url-input');
        if (inp) inp.value = _feelingLuckyQuery;
        _browseUrlHideHistory();
        browseNavigate(_feelingLuckyQuery);
      }
    });
    const redo = luckyRow.querySelector('.browse-lucky-redo');
    if (redo) {
      redo.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _browseUrlFeelingLucky();
      });
      redo.addEventListener('mouseenter', () => { redo.style.color = 'var(--accent)'; });
      redo.addEventListener('mouseleave', () => { redo.style.color = 'var(--text-dimmer)'; });
    }
  }
}

function _fetchSearchSuggestions(query) {
  // Check cache
  if (_suggestCache[query]) {
    _currentSuggestions = _suggestCache[query];
    return;
  }
  // Debounce: wait 300ms after last keystroke
  if (_suggestDebounce) clearTimeout(_suggestDebounce);
  _suggestDebounce = setTimeout(async () => {
    if (_suggestAbort) _suggestAbort.abort();
    const controller = new AbortController();
    _suggestAbort = controller;
    try {
      const resp = await fetch('/api/search-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const suggestions = data.suggestions || [];
      _suggestCache[query] = suggestions;
      _currentSuggestions = suggestions;
      // Re-render dropdown if input still matches
      const input = document.getElementById('browse-url-input');
      if (input && input.value.trim().toLowerCase() === query) {
        _browseUrlShowHistory();
      }
    } catch (e) {
      if (e.name !== 'AbortError') _currentSuggestions = [];
    }
  }, 300);
}

function _fetchWordDefinition(word) {
  const key = word.toLowerCase();
  if (_defCache[key]) {
    _currentDef = _defCache[key];
    return;
  }
  if (_defDebounce) clearTimeout(_defDebounce);
  _defDebounce = setTimeout(async () => {
    try {
      const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key));
      if (!resp.ok) { _defCache[key] = null; _currentDef = null; return; }
      const data = await resp.json();
      const entry = data[0] || null;
      _defCache[key] = entry;
      _currentDef = entry;
      // Re-render dropdown if input still matches
      const input = document.getElementById('browse-url-input');
      if (input && input.value.trim().toLowerCase() === key) {
        _browseUrlShowHistory();
      }
    } catch {
      _defCache[key] = null;
      _currentDef = null;
    }
  }, 250);
}

// ── Instant Answers engine ──

function _computeInstantAnswer(query) {
  if (!query) { _instantAnswer = null; return; }

  // 1. Math expressions — detect and evaluate synchronously
  const mathResult = _tryMathAnswer(query);
  if (mathResult) { _instantAnswer = mathResult; return; }

  // 2. Color preview — hex or rgb
  const colorResult = _tryColorAnswer(query);
  if (colorResult) { _instantAnswer = colorResult; return; }

  // 3. Unit conversion
  const convResult = _tryConversionAnswer(query);
  if (convResult) { _instantAnswer = convResult; return; }

  // 4. Timezone / world clock
  const tzResult = _tryTimezoneAnswer(query);
  if (tzResult) { _instantAnswer = tzResult; return; }

  // 5. Async answers (weather, sports, stocks) — debounced
  const weatherMatch = query.match(/^weather\s+(.+)$/i);
  const sportsMatch = _matchSportsQuery(query);
  const stockMatch = query.match(/^\$([A-Za-z]{1,5})$/) || query.match(/^([A-Za-z]{1,5})\s+stock$/i);

  if (weatherMatch || sportsMatch || stockMatch) {
    const cacheKey = query.toLowerCase();
    if (_instantCache[cacheKey]) {
      _instantAnswer = _instantCache[cacheKey];
      return;
    }
    // Keep previous instant answer while loading (don't flash)
    if (_instantDebounce) clearTimeout(_instantDebounce);
    _instantDebounce = setTimeout(async () => {
      let result = null;
      try {
        if (weatherMatch) result = await _fetchWeatherAnswer(weatherMatch[1].trim());
        else if (sportsMatch) result = await _fetchSportsAnswer(sportsMatch);
        else if (stockMatch) result = await _fetchStockAnswer(stockMatch[1].toUpperCase());
      } catch {}
      if (result) {
        _instantCache[cacheKey] = result;
        _instantAnswer = result;
      } else {
        _instantAnswer = null;
      }
      const input = document.getElementById('browse-url-input');
      if (input && input.value.trim().toLowerCase() === query.toLowerCase()) {
        _browseUrlShowHistory();
      }
    }, 300);
    return;
  }

  _instantAnswer = null;
}

// ── Math ──
function _tryMathAnswer(q) {
  // Only match math-like patterns
  if (!/[\d]/.test(q)) return null;
  if (/[a-zA-Z]{3,}/.test(q) && !/^(sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|e|ceil|floor|round|pow|min|max)/i.test(q.replace(/[^a-zA-Z]/g, ''))) return null;
  // Sanitize: only allow digits, operators, parens, spaces, dots, and math functions
  const sanitized = q.replace(/\s/g, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**')
    .replace(/%\s*of\s*/i, '/100*');
  if (!/^[\d+\-*/().%,\s^eπ]*$/.test(sanitized) && !/^[\d+\-*/().\s]*(?:sqrt|cbrt|abs|log|ln|sin|cos|tan|pi|ceil|floor|round|pow|min|max)[\d+\-*/().\s]*$/i.test(sanitized)) return null;
  try {
    const expr = sanitized
      .replace(/\bpi\b/gi, 'Math.PI').replace(/\be\b/g, 'Math.E')
      .replace(/\bsqrt\(/gi, 'Math.sqrt(').replace(/\bcbrt\(/gi, 'Math.cbrt(')
      .replace(/\babs\(/gi, 'Math.abs(').replace(/\blog\(/gi, 'Math.log10(')
      .replace(/\bln\(/gi, 'Math.log(').replace(/\bsin\(/gi, 'Math.sin(')
      .replace(/\bcos\(/gi, 'Math.cos(').replace(/\btan\(/gi, 'Math.tan(')
      .replace(/\bceil\(/gi, 'Math.ceil(').replace(/\bfloor\(/gi, 'Math.floor(')
      .replace(/\bround\(/gi, 'Math.round(').replace(/\bpow\(/gi, 'Math.pow(')
      .replace(/\bmin\(/gi, 'Math.min(').replace(/\bmax\(/gi, 'Math.max(');
    // Safety check: no identifiers besides Math
    if (/[a-zA-Z_$]/.test(expr.replace(/Math\.[a-zA-Z]+/g, '').replace(/[eE][+-]?\d/g, ''))) return null;
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    // Don't show if result equals input (e.g. just a number)
    if (String(result) === sanitized || String(result) === q.trim()) return null;
    const formatted = Number.isInteger(result) ? result.toLocaleString() : parseFloat(result.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 10 });
    return { type: 'math', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:10px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
      <div><span style="font-size:0.8rem;color:var(--text-dim);">${escapeHtml(q)} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--text-primary);">${escapeHtml(formatted)}</span></div>
    </div>` };
  } catch { return null; }
}

// ── Color ──
function _tryColorAnswer(q) {
  let color = null, label = q;
  const hexMatch = q.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    color = '#' + hex;
    label = '#' + hex.toUpperCase();
  }
  const rgbMatch = q.match(/^rgb[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbMatch) {
    color = `rgb(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]})`;
    label = color;
  }
  const hslMatch = q.match(/^hsl[a]?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?/i);
  if (hslMatch) {
    color = `hsl(${hslMatch[1]},${hslMatch[2]}%,${hslMatch[3]}%)`;
    label = color;
  }
  if (!color) return null;
  return { type: 'color', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:8px;background:${color};border:1px solid var(--border-card);flex-shrink:0;"></div>
    <div><div style="font-size:0.95rem;font-weight:600;color:var(--text-primary);">${escapeHtml(label)}</div>
    <div style="font-size:0.72rem;color:var(--text-dim);">Color preview</div></div>
  </div>` };
}

// ── Unit Conversion ──
function _tryConversionAnswer(q) {
  const m = q.match(/^([\d.,]+)\s*([a-zA-Z°℃℉]+)\s+(?:to|in|as|=)\s+([a-zA-Z°℃℉]+)$/i);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(val)) return null;
  const from = m[2].toLowerCase(), to = m[3].toLowerCase();
  const conversions = {
    'km_mi': v => v * 0.621371, 'mi_km': v => v * 1.60934,
    'km_m': v => v * 1000, 'm_km': v => v / 1000,
    'm_ft': v => v * 3.28084, 'ft_m': v => v / 3.28084,
    'mi_ft': v => v * 5280, 'ft_mi': v => v / 5280,
    'cm_in': v => v / 2.54, 'in_cm': v => v * 2.54,
    'mm_in': v => v / 25.4, 'in_mm': v => v * 25.4,
    'kg_lb': v => v * 2.20462, 'lb_kg': v => v / 2.20462,
    'kg_lbs': v => v * 2.20462, 'lbs_kg': v => v / 2.20462,
    'g_oz': v => v / 28.3495, 'oz_g': v => v * 28.3495,
    'l_gal': v => v * 0.264172, 'gal_l': v => v / 0.264172,
    'ml_oz': v => v / 29.5735, 'oz_ml': v => v * 29.5735,
    'c_f': v => v * 9/5 + 32, 'f_c': v => (v - 32) * 5/9,
    '°c_°f': v => v * 9/5 + 32, '°f_°c': v => (v - 32) * 5/9,
    'celsius_fahrenheit': v => v * 9/5 + 32, 'fahrenheit_celsius': v => (v - 32) * 5/9,
    '℃_℉': v => v * 9/5 + 32, '℉_℃': v => (v - 32) * 5/9,
    'mph_kph': v => v * 1.60934, 'kph_mph': v => v / 1.60934,
    'mph_kmh': v => v * 1.60934, 'kmh_mph': v => v / 1.60934,
    'yd_m': v => v * 0.9144, 'm_yd': v => v / 0.9144,
  };
  const key = from + '_' + to;
  const fn = conversions[key];
  if (!fn) return null;
  const result = fn(val);
  const formatted = parseFloat(result.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return { type: 'conversion', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:10px;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
    <div><span style="font-size:0.8rem;color:var(--text-dim);">${escapeHtml(m[1])} ${escapeHtml(m[2])} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--text-primary);">${escapeHtml(formatted)} ${escapeHtml(m[3])}</span></div>
  </div>` };
}

// ── Timezone ──
const _tzCityMap = {
  'tokyo': 'Asia/Tokyo', 'london': 'Europe/London', 'paris': 'Europe/Paris',
  'new york': 'America/New_York', 'nyc': 'America/New_York', 'ny': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
  'chicago': 'America/Chicago', 'denver': 'America/Denver',
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
  'berlin': 'Europe/Berlin', 'amsterdam': 'Europe/Amsterdam',
  'dubai': 'Asia/Dubai', 'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'seoul': 'Asia/Seoul',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'moscow': 'Europe/Moscow', 'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver', 'sf': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles',
  'austin': 'America/Chicago', 'boston': 'America/New_York',
  'miami': 'America/New_York', 'atlanta': 'America/New_York',
  'hawaii': 'Pacific/Honolulu', 'honolulu': 'Pacific/Honolulu',
  'alaska': 'America/Anchorage', 'bangkok': 'Asia/Bangkok',
  'istanbul': 'Europe/Istanbul', 'cairo': 'Africa/Cairo',
  'rome': 'Europe/Rome', 'madrid': 'Europe/Madrid',
  'lisbon': 'Europe/Lisbon', 'dublin': 'Europe/Dublin',
  'zurich': 'Europe/Zurich', 'stockholm': 'Europe/Stockholm',
  'oslo': 'Europe/Oslo', 'helsinki': 'Europe/Helsinki',
  'warsaw': 'Europe/Warsaw', 'prague': 'Europe/Prague',
  'vienna': 'Europe/Vienna', 'budapest': 'Europe/Budapest',
  'taipei': 'Asia/Taipei', 'jakarta': 'Asia/Jakarta',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  'johannesburg': 'Africa/Johannesburg', 'nairobi': 'Africa/Nairobi',
  'auckland': 'Pacific/Auckland',
};

function _tryTimezoneAnswer(q) {
  const m = q.match(/^(?:time\s+in|what\s+time\s+(?:is\s+it\s+)?in)\s+(.+)$/i);
  if (!m) return null;
  const city = m[1].trim().toLowerCase();
  const tz = _tzCityMap[city];
  if (!tz) return null;
  try {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
    return { type: 'timezone', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:10px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.05rem;font-weight:700;color:var(--text-primary);">${escapeHtml(time)}</span><span style="font-size:0.75rem;color:var(--text-dim);">${escapeHtml(date)}</span></div>
      <div style="font-size:0.72rem;color:var(--text-dim);">${escapeHtml(m[1].trim())} · ${escapeHtml(offset)}</div></div>
    </div>` };
  } catch { return null; }
}

// ── Weather (async) ──
async function _fetchWeatherAnswer(city) {
  const resp = await fetch('https://wttr.in/' + encodeURIComponent(city) + '?format=j1', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  const cur = data.current_condition?.[0];
  if (!cur) return null;
  const temp = cur.temp_C;
  const tempF = cur.temp_F;
  const desc = cur.weatherDesc?.[0]?.value || '';
  const feelsC = cur.FeelsLikeC;
  const humidity = cur.humidity;
  const wind = cur.windspeedKmph;
  const emoji = _weatherEmoji(desc);
  return { type: 'weather', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.6rem;">${emoji}</span>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.1rem;font-weight:700;color:var(--text-primary);">${escapeHtml(temp)}°C</span><span style="font-size:0.82rem;color:var(--text-dim);">${escapeHtml(tempF)}°F</span></div>
      <div style="font-size:0.78rem;color:var(--text-dim);">${escapeHtml(desc)}</div>
      <div style="font-size:0.7rem;color:var(--text-dimmer);margin-top:2px;">Feels ${escapeHtml(feelsC)}°C · Humidity ${escapeHtml(humidity)}% · Wind ${escapeHtml(wind)} km/h</div>
    </div>
    <div style="font-size:0.72rem;color:var(--text-dim);text-align:right;">${escapeHtml(city)}</div>
  </div>` };
}

function _weatherEmoji(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('sunny') || d.includes('clear')) return '☀️';
  if (d.includes('partly cloudy')) return '⛅';
  if (d.includes('cloud') || d.includes('overcast')) return '☁️';
  if (d.includes('rain') || d.includes('drizzle')) return '🌧️';
  if (d.includes('thunder') || d.includes('storm')) return '⛈️';
  if (d.includes('snow') || d.includes('blizzard')) return '🌨️';
  if (d.includes('fog') || d.includes('mist')) return '🌫️';
  if (d.includes('wind')) return '💨';
  return '🌤️';
}

// ── Sports ──
const _sportsLeagues = {
  'nba': 'basketball', 'nfl': 'football', 'mlb': 'baseball', 'nhl': 'hockey',
  'premier league': 'soccer', 'epl': 'soccer', 'la liga': 'soccer',
  'bundesliga': 'soccer', 'serie a': 'soccer', 'ligue 1': 'soccer',
  'champions league': 'soccer', 'mls': 'soccer', 'ucl': 'soccer',
};
const _sportsTeams = {
  'lakers': 'nba', 'celtics': 'nba', 'warriors': 'nba', 'bulls': 'nba', 'nets': 'nba',
  'knicks': 'nba', 'heat': 'nba', 'bucks': 'nba', 'suns': 'nba', 'nuggets': 'nba',
  'mavericks': 'nba', 'mavs': 'nba', 'clippers': 'nba', 'rockets': 'nba',
  'sixers': 'nba', '76ers': 'nba', 'raptors': 'nba', 'spurs': 'nba', 'thunder': 'nba',
  'timberwolves': 'nba', 'wolves': 'nba', 'grizzlies': 'nba', 'pelicans': 'nba',
  'chiefs': 'nfl', 'eagles': 'nfl', '49ers': 'nfl', 'cowboys': 'nfl', 'bills': 'nfl',
  'ravens': 'nfl', 'dolphins': 'nfl', 'lions': 'nfl', 'packers': 'nfl', 'jets': 'nfl',
  'patriots': 'nfl', 'steelers': 'nfl', 'bears': 'nfl', 'chargers': 'nfl',
  'yankees': 'mlb', 'dodgers': 'mlb', 'red sox': 'mlb', 'cubs': 'mlb', 'mets': 'mlb',
  'astros': 'mlb', 'braves': 'mlb', 'phillies': 'mlb', 'padres': 'mlb',
  'arsenal': 'epl', 'chelsea': 'epl', 'liverpool': 'epl', 'man city': 'epl',
  'manchester city': 'epl', 'man united': 'epl', 'manchester united': 'epl',
  'tottenham': 'epl', 'spurs fc': 'epl', 'barcelona': 'la liga', 'real madrid': 'la liga',
  'bayern': 'bundesliga', 'bayern munich': 'bundesliga', 'psg': 'ligue 1',
  'juventus': 'serie a', 'inter milan': 'serie a', 'ac milan': 'serie a',
};

function _matchSportsQuery(q) {
  const lower = q.toLowerCase().trim();
  if (_sportsLeagues[lower]) return { type: 'league', key: lower };
  // Check for "X score" or "X game"
  const scoreMatch = lower.match(/^(.+?)\s+(?:score|game|scores|games|schedule|results?)$/);
  const teamName = scoreMatch ? scoreMatch[1] : lower;
  if (_sportsTeams[teamName]) return { type: 'team', key: teamName, league: _sportsTeams[teamName] };
  if (_sportsLeagues[teamName]) return { type: 'league', key: teamName };
  return null;
}

async function _fetchSportsAnswer(match) {
  // Use ESPN's public API for scores
  const leagueMap = {
    'nba': 'basketball/nba', 'nfl': 'football/nfl', 'mlb': 'baseball/mlb', 'nhl': 'hockey/nhl',
    'premier league': 'soccer/eng.1', 'epl': 'soccer/eng.1', 'la liga': 'soccer/esp.1',
    'bundesliga': 'soccer/ger.1', 'serie a': 'soccer/ita.1', 'ligue 1': 'soccer/fra.1',
    'champions league': 'soccer/uefa.champions', 'ucl': 'soccer/uefa.champions',
    'mls': 'soccer/usa.1',
  };
  const league = match.type === 'league' ? match.key : match.league;
  const espnPath = leagueMap[league];
  if (!espnPath) return null;

  const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/' + espnPath + '/scoreboard', { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  let events = data.events || [];
  if (!events.length) return null;

  // Filter by team if searching for a specific team
  if (match.type === 'team') {
    const teamLower = match.key.toLowerCase();
    events = events.filter(ev => {
      const names = (ev.name || '').toLowerCase() + ' ' + (ev.shortName || '').toLowerCase();
      return names.includes(teamLower);
    });
    if (!events.length) return null;
  }

  // Show up to 4 games
  const games = events.slice(0, 4);
  let html = '<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);">';
  html += '<div style="font-size:0.65rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">' + escapeHtml(league.toUpperCase()) + ' Scores</div>';
  for (const ev of games) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const teams = comp.competitors || [];
    if (teams.length < 2) continue;
    const away = teams.find(t => t.homeAway === 'away') || teams[1];
    const home = teams.find(t => t.homeAway === 'home') || teams[0];
    const status = ev.status?.type?.shortDetail || '';
    const isLive = ev.status?.type?.state === 'in';
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.8rem;">`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    if (away.team?.logo) html += `<img src="${escapeHtml(away.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);${away.winner ? 'font-weight:700;' : ''}">${escapeHtml(away.team?.abbreviation || away.team?.shortDisplayName || '?')}</span>`;
    html += `<span style="font-weight:700;color:var(--text-primary);min-width:18px;text-align:center;">${escapeHtml(away.score || '-')}</span>`;
    html += `</div>`;
    html += `<span style="color:var(--text-dimmer);font-size:0.7rem;">@</span>`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    html += `<span style="font-weight:700;color:var(--text-primary);min-width:18px;text-align:center;">${escapeHtml(home.score || '-')}</span>`;
    if (home.team?.logo) html += `<img src="${escapeHtml(home.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);${home.winner ? 'font-weight:700;' : ''}">${escapeHtml(home.team?.abbreviation || home.team?.shortDisplayName || '?')}</span>`;
    html += `</div>`;
    html += `<span style="font-size:0.68rem;color:${isLive ? 'var(--accent)' : 'var(--text-dimmer)'};white-space:nowrap;flex-shrink:0;min-width:50px;text-align:right;${isLive ? 'font-weight:600;' : ''}">${escapeHtml(status)}</span>`;
    html += `</div>`;
  }
  if (events.length > 4) html += `<div style="font-size:0.7rem;color:var(--text-dimmer);padding-top:4px;">+${events.length - 4} more games</div>`;
  html += '</div>';
  return { type: 'sports', html };
}

// ── Stocks ──
async function _fetchStockAnswer(ticker) {
  // Use Yahoo Finance v8 quote endpoint
  const resp = await fetch('/api/stock-quote?symbol=' + encodeURIComponent(ticker), { signal: AbortSignal.timeout(4000) });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.price && data.price !== 0) return null;
  const price = data.price;
  const change = data.change || 0;
  const changePct = data.changePercent || 0;
  const name = data.name || ticker;
  const isUp = change >= 0;
  const arrow = isUp ? '▲' : '▼';
  const color = isUp ? '#22c55e' : '#ef4444';
  return { type: 'stock', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--border-card);display:flex;align-items:center;gap:10px;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:0.82rem;font-weight:700;color:var(--text-primary);">${escapeHtml(ticker)}</span>
        <span style="font-size:0.72rem;color:var(--text-dim);">${escapeHtml(name)}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
        <span style="font-size:1.05rem;font-weight:700;color:var(--text-primary);">$${parseFloat(price).toFixed(2)}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${color};">${arrow} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)</span>
      </div>
    </div>
  </div>` };
}

function _browseUrlHideHistory() {
  const dd = document.getElementById('browse-url-history-dd');
  if (dd) dd.style.display = 'none';
  _browseUrlHistIdx = -1;
}

document.addEventListener('mousedown', (e) => {
  const dd = document.getElementById('browse-url-history-dd');
  if (!dd || dd.style.display === 'none') return;
  const input = document.getElementById('browse-url-input');
  if ((input && input.contains(e.target)) || dd.contains(e.target)) return;
  _browseUrlHideHistory();
});

// ── Web Search History ──

function _getWebSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('webSearchHistory') || '[]');
    return raw.map(h => typeof h === 'string' ? { q: h, ts: 0 } : h);
  } catch { return []; }
}

function _saveWebSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  let hist = _getWebSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now() });
  if (hist.length > 200) hist = hist.slice(0, 200);
  localStorage.setItem('webSearchHistory', JSON.stringify(hist));
}

function _removeWebSearch(index) {
  const hist = _getWebSearchHistory();
  hist.splice(index, 1);
  localStorage.setItem('webSearchHistory', JSON.stringify(hist));
}

function _clearWebSearchHistory() {
  localStorage.setItem('webSearchHistory', '[]');
}

function openSearchHistoryPage() {
  // Open as a blank-style tab in browse view
  if (typeof openBrowse === 'function') openBrowse();

  // Reuse existing history tab if one exists
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._historyPage);
    if (existing) {
      if (w.id !== _browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      // Re-render to pick up new history entries
      if (existing.el) _renderWebSearchHistoryPage(existing.el);
      return;
    }
  }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  // Mark it as a history tab
  tab.blank = false;
  tab.url = 'aether://history';
  tab.title = 'History';
  tab.favicon = '';
  tab._historyPage = true;

  // Remove existing iframe/content
  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-history-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
  container.appendChild(el);
  tab.el = el;

  // Hide new tab page
  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  // Update URL bar
  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = 'aether://history';

  _renderWebSearchHistoryPage(el);
}

function openHelpPage() {
  if (typeof openBrowse === 'function') openBrowse();

  // Reuse existing help tab
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._helpPage);
    if (existing) {
      if (w.id !== _browseActiveWindow) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      return;
    }
  }

  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab) return;

  tab.blank = false;
  tab.url = 'aether://help';
  tab.title = 'Help';
  tab.favicon = '';
  tab._helpPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-help-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--bg-body);color:var(--text-primary);z-index:3;';
  container.appendChild(el);
  tab.el = el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  if (urlInput) urlInput.value = 'aether://help';

  _renderHelpPage(el);
}

function _renderHelpPage(el) {
  if (!el) return;
  const s = 'style';
  const section = `${s}="margin-bottom:24px;"`;
  const h2 = `${s}="font-size:1.05rem;font-weight:700;color:var(--text-primary);margin-bottom:10px;"`;
  const table = `${s}="width:100%;border-collapse:collapse;font-size:0.82rem;"`;
  const th = `${s}="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-card);"`;
  const td = `${s}="padding:6px 12px;border-bottom:1px solid var(--border-subtle);"`;
  const tdk = `${s}="padding:6px 12px;border-bottom:1px solid var(--border-subtle);color:var(--text-primary);font-weight:500;white-space:nowrap;"`;
  const tdv = `${s}="padding:6px 12px;border-bottom:1px solid var(--border-subtle);color:var(--text-dim);"`;

  let html = '<div style="max-width:640px;margin:0 auto;padding:40px 24px;">';
  html += '<h1 style="font-size:1.4rem;font-weight:700;color:var(--text-primary);margin-bottom:4px;">Help</h1>';
  html += '<p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:32px;">Everything you can do from the URL bar and aether panel.</p>';

  // Instant Answers
  html += `<div ${section}><div ${h2}>Instant Answers</div>`;
  html += '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">Type in the URL bar — results appear inline as you type.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Type</th><th ${th}>Try</th></tr>`;
  const answers = [
    ['Definition', 'pug, ephemeral'],
    ['Math', 'sqrt(144), 2^10, 15% of 230'],
    ['Color', '#ff5733, rgb(20,120,200)'],
    ['Convert', '5km to mi, 100f to c'],
    ['Time zone', 'time in tokyo'],
    ['Weather', 'weather boston'],
    ['Sports', 'nba, lakers, premier league'],
    ['Stocks', '$AAPL, TSLA stock'],
  ];
  answers.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Slash Commands
  html += `<div ${section}><div ${h2}>Slash Commands</div>`;
  html += '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">Right-click → type / in the aether panel.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Command</th><th ${th}>Action</th></tr>`;
  const cmds = [
    ['/help', 'This help page'],
    ['/define word', 'Dictionary lookup'],
    ['/search query', 'Web search in new tab'],
    ['/paper query', 'Search arXiv papers'],
    ['/user query', 'Search for users'],
    ['/notes', 'Browse your notes'],
    ['/links', 'List links on page'],
    ['/tab', 'Add tab to chat context'],
    ['/model', 'Change chat model'],
    ['/history', 'Browse visited sites'],
    ['/capture', 'Screenshot the page'],
    ['/bookmark', 'Save to reading list'],
    ['/find', 'Find in page'],
    ['/note', 'Open in note viewer'],
    ['/upload', 'Open a local file'],
    ['/close', 'Close tab'],
    ['/copy', 'Copy page URL'],
    ['/mute', 'Mute/unmute tab'],
    ['/print', 'Print page'],
  ];
  cmds.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Keyboard Shortcuts
  html += `<div ${section}><div ${h2}>Keyboard Shortcuts</div>`;
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Key</th><th ${th}>Action</th></tr>`;
  const shortcuts = [
    ['', '<strong style="color:var(--text-dimmest);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Global</strong>'],
    ['Esc', 'Close panel / Go home'],
    ['⌘T', 'New browser tab'],
    ['⌘W', 'Close browser tab'],
    ['⌘Y', 'History page'],
    ['⌘⇧\\\\', 'Tab overview'],
    ['⌘L', 'Focus URL bar'],
    ['⌘⇧T', 'Reopen closed tab'],
    ['Enter', 'Send chat message'],
    ['⇧Enter', 'Web search from panel'],
    ['', '<strong style="color:var(--text-dimmest);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Tab Overview</strong>'],
    ['←→', 'Switch windows'],
    ['↑↓', 'Switch tabs'],
    ['Enter', 'Select tab'],
    ['N', 'New window'],
    ['T', 'New tab'],
    ['', '<strong style="color:var(--text-dimmest);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Browser</strong>'],
    ['⌘+', 'Zoom in'],
    ['⌘-', 'Zoom out'],
    ['⌘0', 'Reset zoom'],
    ['⌘F', 'Find in page'],
    ['', '<strong style="color:var(--text-dimmest);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">PDF Viewer</strong>'],
    ['←', 'Previous page'],
    ['→', 'Next page'],
    ['⌘F', 'Find in document'],
    ['H', 'Highlight mode'],
    ['P', 'Pen mode'],
    ['', '<strong style="color:var(--text-dimmest);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">Editors</strong>'],
    ['⌘S', 'Save'],
    ['⌘Z', 'Undo'],
    ['⌘⇧Z', 'Redo'],
    ['⇧Enter', 'Run cell (notebook)'],
  ];
  shortcuts.forEach(([k, v]) => {
    if (!k) {
      html += `<tr><td colspan="2" style="padding:10px 12px 4px;">${v}</td></tr>`;
    } else {
      html += `<tr><td ${tdk}><kbd style="font-family:inherit;font-size:0.78rem;padding:1px 6px;border-radius:4px;border:1px solid var(--border-card);background:var(--bg-card);">${k}</kbd></td><td ${tdv}>${v}</td></tr>`;
    }
  });
  html += '</table></div>';

  // Aether Panel
  html += `<div ${section}><div ${h2}>Aether Panel</div>`;
  html += '<div style="font-size:0.82rem;color:var(--text-dim);line-height:1.6;">';
  html += '<strong style="color:var(--text-primary);">Right-click</strong> anywhere to open the panel.<br>';
  html += 'Type to <strong style="color:var(--text-primary);">chat with AI</strong> about the current page.<br>';
  html += '<strong style="color:var(--text-primary);">Select text</strong> → highlight, quote, or define.<br>';
  html += '<strong style="color:var(--text-primary);">Drag</strong> while panel is open to capture a screenshot region.';
  html += '</div></div>';

  // Chat Tools
  html += `<div ${section}><div ${h2}>Chat Tools</div>`;
  html += '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:8px;">When enabled, the chat assistant can use these tools autonomously. Requires qwen3:8b.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Tool</th><th ${th}>Description</th></tr>`;
  const tools = [
    ['Web Search', 'Searches DuckDuckGo for current info'],
    ['Paper Search', 'Finds papers on arXiv'],
    ['Fetch Page', 'Reads content from any URL'],
    ['Bookmark', 'Saves posts to your reading list'],
    ['Navigate', 'Opens views (home, experiments, etc.)'],
    ['New Experiment', 'Creates a project from chat'],
  ];
  tools.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Internal Pages
  html += `<div ${section}><div ${h2}>Internal Pages</div>`;
  html += `<table ${table}>`;
  html += `<tr><th ${th}>URL</th><th ${th}>Page</th></tr>`;
  html += `<tr><td ${tdk}>aether://help</td><td ${tdv}>This page</td></tr>`;
  html += `<tr><td ${tdk}>aether://history</td><td ${tdv}>Browsing & search history</td></tr>`;
  html += '</table></div>';

  html += '</div>';
  el.innerHTML = html;
}

let _historyPageTab = 'browse'; // 'browse' or 'search'

function _renderWebSearchHistoryPage(el) {
  if (!el) return;
  const searchHist = _getWebSearchHistory();
  const browseHist = _getBrowseHistory();
  const isBrowse = _historyPageTab === 'browse';

  let html = '<div style="max-width:680px;margin:0 auto;padding:32px 24px 64px;">';

  // Header with tabs
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<svg style="width:20px;height:20px;color:var(--text-dimmer);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>';
  html += '<span style="font-size:1.1rem;font-weight:600;color:var(--text-primary);">History</span>';
  html += '</div>';
  const clearFn = isBrowse
    ? '_clearBrowseHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));'
    : '_clearWebSearchHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));';
  const activeHist = isBrowse ? browseHist : searchHist;
  if (activeHist.length) {
    html += '<button onclick="' + clearFn + '" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-muted);font-size:0.75rem;cursor:pointer;">Clear all</button>';
  }
  html += '</div>';

  // Tab switcher
  const tabStyle = (active) => `padding:6px 14px;border:none;border-bottom:2px solid ${active ? 'var(--accent)' : 'transparent'};background:none;color:${active ? 'var(--text-primary)' : 'var(--text-dim)'};font-size:0.82rem;cursor:pointer;font-weight:${active ? '600' : '400'};`;
  html += '<div style="display:flex;gap:0;border-bottom:1px solid var(--border-input);margin-bottom:16px;">';
  html += `<button onclick="_historyPageTab='browse';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(isBrowse)}">Sites <span style="font-size:0.7rem;color:var(--text-dimmest);">${browseHist.length}</span></button>`;
  html += `<button onclick="_historyPageTab='search';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(!isBrowse)}">Searches <span style="font-size:0.7rem;color:var(--text-dimmest);">${searchHist.length}</span></button>`;
  html += '</div>';

  // Filter
  html += '<div style="position:relative;margin-bottom:16px;">';
  html += '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-dimmer);pointer-events:none;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>';
  html += '<input type="text" id="history-page-filter" placeholder="Filter history..." oninput="_filterWebSearchHistory()" style="width:100%;padding:7px 12px 7px 32px;border-radius:8px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.82rem;outline:none;" />';
  html += '</div>';

  html += '<div id="history-page-list">';
  html += isBrowse ? _renderBrowseHistoryList(browseHist) : _renderWebSearchHistoryList(searchHist);
  html += '</div></div>';
  el.innerHTML = html;
}

function _filterWebSearchHistory() {
  const filter = (document.getElementById('history-page-filter')?.value || '').trim().toLowerCase();
  const list = document.getElementById('history-page-list');
  if (!list) return;
  if (_historyPageTab === 'browse') {
    const hist = _getBrowseHistory();
    const filtered = filter ? hist.filter(h => (h.title || '').toLowerCase().includes(filter) || (h.url || '').toLowerCase().includes(filter)) : hist;
    list.innerHTML = _renderBrowseHistoryList(filtered);
  } else {
    const hist = _getWebSearchHistory();
    const filtered = filter ? hist.filter(h => h.q.toLowerCase().includes(filter)) : hist;
    list.innerHTML = _renderWebSearchHistoryList(filtered);
  }
}

function _renderWebSearchHistoryList(hist) {
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--text-dim);font-size:0.85rem;">No searches found</div>';

  // Group by date
  const groups = [];
  const groupMap = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  // Need original indices for deletion
  const allHist = _getWebSearchHistory();

  hist.forEach(h => {
    let label;
    if (!h.ts) { label = 'Older'; }
    else if (h.ts >= today) { label = 'Today'; }
    else if (h.ts >= yesterday) { label = 'Yesterday'; }
    else if (h.ts >= weekAgo) { label = 'This Week'; }
    else {
      const d = new Date(h.ts);
      label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(h);
  });

  let html = '';
  for (const label of groups) {
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:0.7rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.q === h.q && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      const safeQ = escapeHtml(h.q).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--bg-hover)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNewTab('${safeQ}')">
        <svg style="width:14px;height:14px;color:var(--text-dimmer);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
        <span style="font-size:0.82rem;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.q)}</span>
        <span style="font-size:0.7rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeWebSearch(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--text-dimmer);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
          <svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

function _renderBrowseHistoryList(hist) {
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--text-dim);font-size:0.85rem;">No browsing history</div>';

  const groups = [];
  const groupMap = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 604800000;

  const allHist = _getBrowseHistory();

  hist.forEach(h => {
    let label;
    if (!h.ts) { label = 'Older'; }
    else if (h.ts >= today) { label = 'Today'; }
    else if (h.ts >= yesterday) { label = 'Yesterday'; }
    else if (h.ts >= weekAgo) { label = 'This Week'; }
    else {
      const d = new Date(h.ts);
      label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (!groupMap[label]) { groupMap[label] = []; groups.push(label); }
    groupMap[label].push(h);
  });

  let html = '';
  for (const label of groups) {
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-size:0.7rem;color:var(--text-dimmest);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.url === h.url && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      let domain = '';
      try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
      const favicon = _browseFaviconUrl(h.url);
      const safeUrl = escapeHtml(h.url).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--bg-hover)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNewTab('${safeUrl}')">
        <img src="${escapeHtml(favicon)}" style="width:16px;height:16px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
        <div style="flex:1;overflow:hidden;min-width:0;">
          <div style="font-size:0.82rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</div>
          <div style="font-size:0.7rem;color:var(--text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(domain)}</div>
        </div>
        <span style="font-size:0.7rem;color:var(--text-dimmer);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeBrowseVisit(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--text-dimmer);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
          <svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

// ── Browsing History ──

function _getBrowseHistory() {
  try { return JSON.parse(localStorage.getItem('browseHistory') || '[]'); } catch { return []; }
}

function _saveBrowseVisit(url, title) {
  if (!url || url === 'about:blank') return;
  let hist = _getBrowseHistory();
  // Don't duplicate the same URL if it's the most recent entry
  if (hist.length && hist[0].url === url) {
    hist[0].title = title || hist[0].title;
    hist[0].ts = Date.now();
  } else {
    hist.unshift({ url, title: title || _browseTitleFromUrl(url), ts: Date.now() });
  }
  if (hist.length > 1000) hist = hist.slice(0, 1000);
  localStorage.setItem('browseHistory', JSON.stringify(hist));
}

function _removeBrowseVisit(index) {
  const hist = _getBrowseHistory();
  hist.splice(index, 1);
  localStorage.setItem('browseHistory', JSON.stringify(hist));
}

function _clearBrowseHistory() {
  localStorage.setItem('browseHistory', '[]');
}

// ── Ad Blocker toggle & badge ──

function toggleAdBlock() {
  const on = localStorage.getItem('adBlockEnabled') === 'true';
  localStorage.setItem('adBlockEnabled', on ? 'false' : 'true');
  _browseUpdateAdBlockBtn();
  // Reload current tab through/without proxy
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.url && !tab.blank && tab.el) {
    const proxied = _browseProxyUrl(tab.url);
    tab.el.dataset.originalUrl = tab.url;
    tab.el.src = proxied;
    if (proxied !== tab.url) {
      tab.el.addEventListener('load', () => _browseUpdateAdBlockBadge(tab.url), { once: true });
    } else {
      // Cleared proxy — hide badge
      const badge = document.getElementById('browse-adblock-badge');
      if (badge) badge.style.display = 'none';
    }
  }
}

function _browseUpdateAdBlockBtn() {
  const btn = document.getElementById('browse-adblock-btn');
  if (!btn) return;
  const on = localStorage.getItem('adBlockEnabled') === 'true';
  btn.style.color = on ? 'var(--accent)' : '';
  btn.title = on ? 'Ad Blocker (on)' : 'Ad Blocker (off)';
  btn.classList.toggle('text-dimmer', !on);
}

function _browseUpdateAdBlockBadge(url) {
  const badge = document.getElementById('browse-adblock-badge');
  if (!badge) return;
  if (localStorage.getItem('adBlockEnabled') !== 'true') {
    badge.style.display = 'none';
    return;
  }
  // Try to read the blocked count from the proxied iframe's meta tag (same-origin)
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.el) {
    try {
      const doc = tab.el.contentDocument;
      if (doc) {
        const meta = doc.querySelector('meta[name="adblock-count"]');
        if (meta) {
          const count = parseInt(meta.getAttribute('content') || '0', 10);
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
          } else {
            badge.style.display = 'none';
          }
          return;
        }
      }
    } catch (e) { /* cross-origin, fall through */ }
  }
  badge.style.display = 'none';
}

// ── Site Permissions ──

const _SITE_PERM_KEYS = ['camera', 'microphone', 'location', 'notifications', 'popups'];
const _SITE_PERM_LABELS = { camera: 'Camera', microphone: 'Microphone', location: 'Location', notifications: 'Notifications', popups: 'Pop-ups' };
const _SITE_PERM_PROMPTS = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  location: 'Know your location',
  notifications: 'Send you notifications',
  popups: 'Open pop-up windows'
};
const _SITE_PERM_ICONS = {
  camera: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M4 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  microphone: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  location: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  notifications: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  popups: '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
};
const _SITE_PERM_ICONS_LG = {
  camera: '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M4 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  microphone: '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke-linecap="round"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  location: '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  notifications: '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  popups: '<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
};

function _getSitePermissions(domain) {
  try {
    const all = JSON.parse(localStorage.getItem('sitePermissions') || '{}');
    return all[domain] || {};
  } catch { return {}; }
}

function _setSitePermission(domain, perm, value) {
  try {
    const all = JSON.parse(localStorage.getItem('sitePermissions') || '{}');
    if (!all[domain]) all[domain] = {};
    if (value === 'ask') {
      delete all[domain][perm];
      if (!Object.keys(all[domain]).length) delete all[domain];
    } else {
      all[domain][perm] = value;
    }
    localStorage.setItem('sitePermissions', JSON.stringify(all));
  } catch {}
}

function _clearSitePermissions(domain) {
  try {
    const all = JSON.parse(localStorage.getItem('sitePermissions') || '{}');
    delete all[domain];
    localStorage.setItem('sitePermissions', JSON.stringify(all));
  } catch {}
}

function _getAllSitePermissions() {
  try { return JSON.parse(localStorage.getItem('sitePermissions') || '{}'); } catch { return {}; }
}

function _getCurrentBrowseDomain() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.url || tab.blank) return '';
  try { return new URL(tab.url).hostname.replace('www.', ''); } catch { return ''; }
}

// ── Permission Confirmation Prompt ──
// Shows a browser-style dialog when user tries to allow a permission.
// Nothing is granted until the user explicitly confirms in this dialog.

function _showPermissionPrompt(domain, permKey) {
  // Remove any existing prompt
  const existing = document.getElementById('site-permission-prompt');
  if (existing) existing.remove();

  const label = _SITE_PERM_PROMPTS[permKey] || permKey;
  const icon = _SITE_PERM_ICONS_LG[permKey] || '';

  const overlay = document.createElement('div');
  overlay.id = 'site-permission-prompt';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;background:rgba(0,0,0,0.45);';

  overlay.innerHTML = `
    <div style="background:var(--bg-popup);border:1px solid var(--border-card);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:380px;overflow:hidden;">
      <div style="padding:20px 20px 12px;display:flex;align-items:flex-start;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:0.92rem;font-weight:600;color:var(--text-primary);line-height:1.4;">
            <strong>${escapeHtml(domain)}</strong> wants to
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--bg-hover);">
            <span style="color:var(--text-dimmer);flex-shrink:0;">${icon}</span>
            <span style="font-size:0.84rem;color:var(--text-primary);">${escapeHtml(label)}</span>
          </div>
        </div>
        <button id="perm-prompt-close" style="background:none;border:none;cursor:pointer;color:var(--text-dimmer);padding:2px;flex-shrink:0;" title="Dismiss">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div style="padding:0 20px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span style="font-size:0.75rem;color:var(--text-dim);">Remember my decision</span>
          <select id="perm-prompt-remember" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.75rem;cursor:pointer;">
            <option value="session">Until I close this site</option>
            <option value="always" selected>Always</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="perm-prompt-block" style="padding:6px 20px;border-radius:8px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-primary);font-size:0.82rem;font-weight:500;cursor:pointer;">Block</button>
          <button id="perm-prompt-allow" style="padding:6px 20px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">Allow</button>
        </div>
      </div>
      <div style="padding:8px 20px;border-top:1px solid var(--border-subtle);font-size:0.68rem;color:var(--text-dimmer);">
        You can change your site permissions at any time from the more menu in the toolbar.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on overlay background click
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#perm-prompt-close').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#perm-prompt-block').addEventListener('click', () => {
    const remember = overlay.querySelector('#perm-prompt-remember').value;
    if (remember === 'always') {
      _setSitePermission(domain, permKey, 'block');
    }
    // Session-only block: just leave it as default (blocked), don't persist
    _browseApplyPermissions();
    overlay.remove();
    _renderSitePermissionsDropdown();
  });

  overlay.querySelector('#perm-prompt-allow').addEventListener('click', () => {
    const remember = overlay.querySelector('#perm-prompt-remember').value;
    if (remember === 'always') {
      _setSitePermission(domain, permKey, 'allow');
    } else {
      // Session-only: set on iframe but don't persist to localStorage
      _sessionPermissions[domain] = _sessionPermissions[domain] || {};
      _sessionPermissions[domain][permKey] = 'allow';
    }
    _browseApplyPermissions();
    overlay.remove();
    _renderSitePermissionsDropdown();
  });
}

// Session-only permissions (not persisted to localStorage, cleared on tab close/navigate)
let _sessionPermissions = {};

// Get effective permissions: localStorage merged with session overrides
function _getEffectivePermissions(domain) {
  const stored = _getSitePermissions(domain);
  const session = _sessionPermissions[domain] || {};
  return { ...stored, ...session };
}

function _renderSitePermissionsDropdown(container) {
  const dd = container || document.getElementById('browse-menu-perms-panel');
  if (!dd) return;
  const domain = _getCurrentBrowseDomain();

  if (!domain) {
    dd.innerHTML = '<div style="padding:12px;text-align:center;font-size:0.78rem;color:var(--text-dim);">Navigate to a site first</div>';
    return;
  }

  const perms = _getSitePermissions(domain);
  const effective = _getEffectivePermissions(domain);
  let html = '';
  html += '<div style="padding:6px 8px 4px;font-size:0.72rem;color:var(--text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(domain) + '</div>';
  html += '<div style="padding:0 8px 4px;font-size:0.65rem;color:var(--text-dimmest);line-height:1.3;">Blocked by default. Click Allow to grant access.</div>';

  for (const key of _SITE_PERM_KEYS) {
    const current = effective[key] || 'ask';
    const label = _SITE_PERM_LABELS[key];
    const icon = _SITE_PERM_ICONS[key];
    const isSession = !perms[key] && (_sessionPermissions[domain] || {})[key];
    html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;">';
    html += '<span style="color:var(--text-dimmer);flex-shrink:0;">' + icon + '</span>';
    html += '<span style="flex:1;font-size:0.75rem;color:var(--text-primary);">' + label + '</span>';
    if (isSession) {
      html += '<span style="font-size:0.58rem;color:var(--text-dimmest);margin-right:2px;">session</span>';
    }
    html += '<div style="display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--border-input);">';
    for (const val of ['ask', 'allow', 'block']) {
      const active = current === val;
      const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--bg-card))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--bg-card))' : 'color-mix(in srgb, var(--accent) 20%, var(--bg-card))') : 'var(--bg-card)';
      const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--accent)') : 'var(--text-dimmer)';
      const safeDomain = escapeHtml(domain).replace(/'/g, "\\'");
      const onclick = val === 'allow'
        ? '_showPermissionPrompt(\'' + safeDomain + '\',\'' + key + '\');'
        : '_setSitePermission(\'' + safeDomain + '\',\'' + key + '\',\'' + val + '\'); delete (_sessionPermissions[\'' + safeDomain + '\'] || {})[\'' + key + '\']; _renderSitePermissionsDropdown(); _browseApplyPermissions();';
      html += '<button onclick="' + onclick + '" style="padding:2px 7px;font-size:0.65rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;">' + val + '</button>';
    }
    html += '</div></div>';
  }

  const safeDomain2 = escapeHtml(domain).replace(/'/g, "\\'");
  html += '<div style="padding:4px 8px 6px;border-top:1px solid var(--border-card);margin-top:2px;">';
  html += '<button onclick="_clearSitePermissions(\'' + safeDomain2 + '\'); delete _sessionPermissions[\'' + safeDomain2 + '\']; _renderSitePermissionsDropdown(); _browseApplyPermissions();" style="width:100%;padding:4px;border-radius:6px;border:1px solid var(--border-input);background:var(--bg-card);color:var(--text-dim);font-size:0.72rem;cursor:pointer;">Reset all to default</button>';
  html += '</div>';

  dd.innerHTML = html;
}

// Initialize button state on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', _browseUpdateAdBlockBtn);
}

// Listen for browse commands from Electron main process (for Cmd+T and Cmd+W)
if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onBrowseCommand) {
  window.electronAPI.onBrowseCommand((event, command) => {
    const browseView = document.getElementById('browse-view');
    if (!browseView || browseView.style.display === 'none') return;
    
    if (command === 'new-tab') {
      browseNewTab();
    } else if (command === 'close-tab') {
      const win = _getCurrentWindow();
      if (win && win.activeTab) {
        browseCloseTab(win.activeTab);
      }
    } else if (command === 'reopen-tab') {
      browseReopenTab();
    } else if (command === 'print') {
      const tab = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab);
      if (tab && tab.contentType === 'pdf' && typeof showPrintPreview === 'function') {
        showPrintPreview();
      } else if (typeof browsePrintPage === 'function') {
        browsePrintPage();
      }
    }
  });
}

