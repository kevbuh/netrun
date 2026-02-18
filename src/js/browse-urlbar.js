// browse-urlbar.js — URL bar, instant answers, history, ad blocker

// ── URL Shortening ──

function _browseUrlDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function _browseShortUrl(url) {
  const domain = _browseUrlDomain(url);
  const tab = typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined'
    ? _browseTabs.find(t => t.id === _browseActiveTab) : null;
  if (tab && tab.title && tab.title !== _browseTitleFromUrl(tab.url)) {
    return domain + '  /  ' + tab.title;
  }
  return domain;
}

function _browseAutoSizeUrlInput(input) {
  if (!input || input.id !== 'pill-browse-url-input') return;
  const pill = document.getElementById('sidebar-nav');
  if (!pill || !pill.classList.contains('island-mode')) return;
  const canvas = _browseAutoSizeUrlInput._c || (_browseAutoSizeUrlInput._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  ctx.font = getComputedStyle(input).font;
  const text = input.value || input.placeholder || '';
  const w = Math.ceil(ctx.measureText(text).width) + 24; // 24 for padding
  input.style.width = Math.min(Math.max(w, 80), 320) + 'px';
}

function _browseSetUrlDisplay(input, url) {
  if (!input) return;
  input.dataset.fullUrl = url || '';
  if (document.activeElement === input || input.matches(':hover')) {
    input.value = url || '';
  } else if (Settings.get('urlShorten') !== 'false' && url && !url.startsWith('netrun://')) {
    input.value = _browseShortUrl(url);
  } else {
    input.value = url || '';
  }
  _browseAutoSizeUrlInput(input);
}

function _browseUrlOnFocus(input) {
  const full = input.dataset.fullUrl;
  if (full) input.value = full;
  _browseAutoSizeUrlInput(input);
}

function _browseUrlOnBlur(input) {
  _browseUrlClearAutocomplete();
  const full = input.dataset.fullUrl || input.value;
  input.dataset.fullUrl = full;
  if (Settings.get('urlShorten') !== 'false' && full && !full.startsWith('netrun://')) {
    input.value = _browseShortUrl(full);
  }
  _browseAutoSizeUrlInput(input);
}

function _browseUrlOnMouseEnter(input) {
  if (document.activeElement === input) return;
  const full = input.dataset.fullUrl;
  if (full) input.value = full;
  _browseAutoSizeUrlInput(input);
}

function _browseUrlOnMouseLeave(input) {
  if (document.activeElement === input) return;
  const full = input.dataset.fullUrl || input.value;
  if (Settings.get('urlShorten') !== 'false' && full && !full.startsWith('netrun://')) {
    input.value = _browseShortUrl(full);
  }
  _browseAutoSizeUrlInput(input);
}

// ── Adaptive URL Bar Color ──

function _browseParseColor(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  // Hex
  const hex = str.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
    }
  }
  // rgb/rgba
  const rgb = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

function _browseResetAdaptiveColor() {
  document.documentElement.style.removeProperty('--nr-bg-body');
}

// ── Browse URL Bar History Dropdown ──

const _URL_BAR_SECTIONS = [
  { key: 'bangs',      label: 'Bangs' },
  { key: 'definition', label: 'Definition' },
  { key: 'instant',    label: 'Instant Answers' },
  { key: 'recent',     label: 'Recent Sites' },
  { key: 'suggestions',label: 'Suggestions' },
  { key: 'projects',   label: 'Projects' },
  { key: 'users',      label: 'Users' },
  { key: 'notes',      label: 'Notes' },
  { key: 'history',    label: 'Search History' },
  { key: 'lucky',      label: 'Feeling Lucky' },
];

function _getUrlBarSections() {
  let saved = null;
  try { saved = Settings.getJSON('urlBarSections', null); } catch {}
  if (!Array.isArray(saved)) return _URL_BAR_SECTIONS.map(s => ({ key: s.key, label: s.label, enabled: true }));
  const result = [];
  const seen = new Set();
  for (const s of saved) {
    const def = _URL_BAR_SECTIONS.find(d => d.key === s.key);
    if (def && !seen.has(s.key)) {
      seen.add(s.key);
      result.push({ key: s.key, label: def.label, enabled: s.enabled !== false });
    }
  }
  for (const d of _URL_BAR_SECTIONS) {
    if (!seen.has(d.key)) result.push({ key: d.key, label: d.label, enabled: true });
  }
  return result;
}

let _browseUrlHistIdx = -1;
let _browseUrlOriginalInput = '';
let _suggestDebounce = null;
let _suggestAbort = null;
const _suggestCache = {};
let _currentSuggestions = [];
const _defCache = {};
let _defDebounce = null;
let _currentDef = null; // cached definition entry for current word
let _instantAnswer = null; // { type, html } for non-definition instant answers
let _instantDebounce = null;
const _instantCache = {};

// ── Inline Autocomplete (Chrome-style selection) ──

let _browseUrlAutocompleteSuggestion = ''; // full domain suggestion currently shown
let _browseUrlTypedLength = 0; // length of the user's actual typed text
let _browseUrlAcSuppressed = false; // suppress re-autocomplete after delete

function _browseUrlGetAutocomplete(filter) {
  if (!filter || filter.includes(' ') || filter.startsWith('/')) return '';
  const lf = filter.toLowerCase();
  const browseHist = _getBrowseHistory();
  let best = '';
  let bestTs = 0;
  for (const h of browseHist) {
    try {
      const u = new URL(h.url);
      const domain = u.hostname.replace(/^www\./, '');
      if (domain.toLowerCase().startsWith(lf) && (h.ts || 0) > bestTs) {
        best = domain;
        bestTs = h.ts || 0;
      }
    } catch { /* skip invalid */ }
  }
  // Also check common TLDs for bare words (e.g. "x" → "x.com")
  if (!best) {
    const tlds = ['.com', '.org', '.net', '.io', '.dev', '.ai', '.co'];
    for (const tld of tlds) {
      const candidate = lf + tld;
      for (const h of browseHist) {
        try {
          const domain = new URL(h.url).hostname.replace(/^www\./, '').toLowerCase();
          if (domain === candidate && (h.ts || 0) > bestTs) {
            best = domain;
            bestTs = h.ts || 0;
          }
        } catch { /* skip */ }
      }
      if (best) break;
    }
  }
  return best;
}

function _browseUrlApplyAutocomplete(input, suggestion) {
  if (!input) return;
  const typed = input.value;
  if (!suggestion || suggestion.toLowerCase() === typed.toLowerCase()) {
    _browseUrlAutocompleteSuggestion = '';
    return;
  }
  _browseUrlAutocompleteSuggestion = suggestion;
  _browseUrlTypedLength = typed.length;
  // Set the full suggestion as the value, then select only the suffix
  input.value = typed + suggestion.slice(typed.length);
  input.setSelectionRange(typed.length, suggestion.length);
}

function _browseUrlClearAutocomplete() {
  _browseUrlAutocompleteSuggestion = '';
  _browseUrlTypedLength = 0;
}

// Returns the active omnibox input & dropdown elements (NTP search or URL bar)
function _getOmniInput() {
  // NTP check first: if the NTP is visible, use its search input + dropdown
  const ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
  if (ntpEl && ntpEl.style.display !== 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  // Island mode: use pill input + pill dropdown
  const nav = document.getElementById('sidebar-nav');
  if (nav && nav.classList.contains('island-mode') && nav.classList.contains('browse-mode')) {
    const pillInput = document.getElementById('pill-browse-url-input');
    const pillDd = document.getElementById('pill-url-dropdown');
    if (pillInput && pillDd) return { input: pillInput, dd: pillDd, ntp: false, island: true };
  }
  const bar = document.getElementById('browse-bar');
  if (bar && bar.style.display === 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  return { input: document.getElementById('browse-url-input'), dd: document.getElementById('browse-url-history-dd'), ntp: false };
}

function _browseUrlKeydown(e) {
  const { input, dd, ntp, island } = _getOmniInput();
  const visible = island
    ? !!(document.getElementById('pill-url-wrap') && document.getElementById('pill-url-wrap').classList.contains('pill-dropdown-open'))
    : dd && dd.style.display !== 'none' && !dd.classList.contains('hidden');

  // Backspace/Delete: clear autocomplete, keep only the typed portion
  if ((e.key === 'Backspace' || e.key === 'Delete') && _browseUrlAutocompleteSuggestion) {
    e.preventDefault();
    if (input) {
      input.value = input.value.slice(0, _browseUrlTypedLength);
      input.setSelectionRange(_browseUrlTypedLength, _browseUrlTypedLength);
    }
    _browseUrlClearAutocomplete();
    _browseUrlAcSuppressed = true;
    // Dispatch input event so oninput handler re-renders dropdown (with suppression flag active)
    if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Tab: accept inline autocomplete suggestion
  if (e.key === 'Tab' && _browseUrlAutocompleteSuggestion) {
    e.preventDefault();
    if (input) {
      input.value = _browseUrlAutocompleteSuggestion;
      input.setSelectionRange(input.value.length, input.value.length);
    }
    _browseUrlClearAutocomplete();
    _browseAutoSizeUrlInput(input);
    return;
  }

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
          browseNavigate(q);
        }
      }
    } else if (ntp) {
      // NTP: hide dropdown, let form onsubmit (submitSearch) handle Enter
      _browseUrlHideHistory();
    } else {
      _browseUrlHideHistory();
      browseNavigate(input ? input.value : '');
    }
    return;
  }
  if (!visible) return;
  _browseUrlClearAutocomplete();
  const items = dd.querySelectorAll('[data-histq]');
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
    // Restore just the typed portion if autocomplete was active
    if (_browseUrlAutocompleteSuggestion && input) {
      input.value = input.value.slice(0, _browseUrlTypedLength);
    }
    _browseUrlClearAutocomplete();
    _browseUrlHideHistory();
  }
}

function _browseUrlHighlight(items) {
  items.forEach((el, i) => {
    if (i === _browseUrlHistIdx) {
      el.style.background = 'color-mix(in srgb, var(--nr-accent) 18%, transparent)';
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
  const { input, dd } = _getOmniInput();
  _feelingLuckyLoading = true;
  _feelingLuckyQuery = '';
  _browseUrlRenderLuckyRow(dd);
  const model = Settings.get('chatModel') || 'qwen2.5:3b';
  islandUpdate('ai-lucky', { type: 'ai', label: model, detail: 'Feeling Lucky \u00B7 ' + model });
  apiPost('/api/doc-chat', {
    messages: [{ role: 'user', content: 'Give me a single interesting, surprising, or obscure topic to search on the web right now. Just reply with the search query, nothing else. No quotes. Be creative and varied — pick from science, history, art, philosophy, technology, nature, space, culture, or anything fascinating. Do not repeat yourself.' }],
    model: model
  }).then(result => {
    if (!result || !result._stream) { _feelingLuckyLoading = false; _browseUrlRenderLuckyRow(dd); return; }
    const handler = (_ev, sid, evt) => {
      if (sid !== result.sessionId) return;
      if (evt.event === 'token') {
        _feelingLuckyQuery += (evt.data || '');
        _browseUrlRenderLuckyRow(dd);
      } else if (evt.event === 'done' || evt.event === 'error') {
        window.electronAPI.removeDocChatEventListener(handler);
        islandRemove('ai-lucky');
        _feelingLuckyLoading = false;
        _feelingLuckyQuery = _feelingLuckyQuery.replace(/^["']|["']$/g, '').trim();
        _browseUrlRenderLuckyRow(dd);
      }
    };
    window.electronAPI.onDocChatEvent(handler);
  }).catch(() => { _feelingLuckyLoading = false; _browseUrlRenderLuckyRow(dd); });
}

function _browseUrlRenderLuckyRow(dd) {
  // Re-render the full dropdown so styles (pointer-events, redo btn) update
  _browseUrlShowHistory();
}

function _browseUrlShowHistory() {
  const { input, dd, ntp } = _getOmniInput();
  if (!input || !dd) return;
  // When autocomplete was active and user types, the selection gets replaced.
  // Detect this: if cursor is NOT at the autocomplete boundary, user typed new input.
  let rawVal = input.value || '';
  if (_browseUrlAutocompleteSuggestion) {
    if (input.selectionStart !== _browseUrlTypedLength) {
      // User typed something new — reset autocomplete state
      _browseUrlClearAutocomplete();
    } else {
      // Autocomplete still active — use only the typed portion as filter
      rawVal = rawVal.slice(0, _browseUrlTypedLength);
    }
  }
  const filter = rawVal.trim().toLowerCase();

  // Don't show dropdown on blank new-tab pages with no input (URL bar only, NTP always shows)
  if (!filter && !ntp) {
    const win = typeof _getCurrentWindow === 'function' ? _getCurrentWindow() : null;
    const tab = win?.tabs?.find(t => t.id === win.activeTab);
    if (tab && tab.blank) {
      const _pw = document.getElementById('pill-url-wrap');
      if (_pw) _pw.classList.remove('pill-dropdown-open');
      dd.style.display = 'none';
      return;
    }
  }

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
  // Deduplicate by hostname — show only one entry per unique site
  const _seenHosts = new Set();
  const dedupedBrowse = filteredBrowse.filter(h => {
    try { const host = new URL(h.url).hostname.replace('www.', ''); if (_seenHosts.has(host)) return false; _seenHosts.add(host); return true; } catch { return true; }
  });
  let showBrowse = dedupedBrowse.slice(0, filter ? 6 : 4);
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

  // Update inline autocomplete (Chrome-style: fill input + select suffix)
  if (_browseUrlAcSuppressed) {
    _browseUrlAcSuppressed = false;
  } else if (filter && document.activeElement === input) {
    // Only apply autocomplete if cursor is at end and no selection active from user
    const atEnd = input.selectionStart === filter.length && input.selectionEnd === filter.length;
    // Also apply if our own autocomplete selection is active
    const ownAcActive = _browseUrlAutocompleteSuggestion && input.selectionStart === _browseUrlTypedLength;
    if (atEnd || ownAcActive) {
      const ac = _browseUrlGetAutocomplete(filter.slice(0, atEnd ? filter.length : _browseUrlTypedLength));
      _browseUrlApplyAutocomplete(input, ac);
    }
  } else {
    _browseUrlClearAutocomplete();
  }
}

function _browseUrlRenderHistoryCommand(dd, input) {
  const hist = _getBrowseHistory().slice(0, 20);
  _browseUrlHistIdx = -1;
  _browseUrlOriginalInput = '/history';

  const isIsland = dd.id === 'pill-url-dropdown';
  if (isIsland) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '';
    dd.style.overflowY = '';
    const pillWrap = document.getElementById('pill-url-wrap');
    if (pillWrap) pillWrap.classList.add('pill-dropdown-open');
  } else {
    const rect = input.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    dd.style.width = rect.width + 'px';
    dd.style.maxHeight = '380px';
    dd.style.overflowY = 'auto';
  }

  if (!hist.length) {
    dd.innerHTML = '<div style="padding:12px;font-size:0.8rem;color:var(--nr-text-tertiary);text-align:center;">No browsing history</div>';
    dd.style.display = '';
    dd.classList.remove('hidden');
    return;
  }

  const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--nr-text-primary);transition:background 0.1s;';
  const hoverOn = "this.style.background='var(--nr-bg-raised)'";
  const hoverOff = "if(this.dataset.idx!=window._browseUrlHistIdx)this.style.background='none'";

  let html = '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Recent Sites</div>';
  html += hist.map((h, i) => {
    const favicon = _browseFaviconUrl(h.url);
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const safeUrl = escapeHtml(h.url).replace(/"/g, '&quot;');
    const time = _relativeTime(h.ts);
    return `<div data-idx="${i}" data-histq="${safeUrl}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); var _i=_getOmniInput().input; if(_i)_i.value='${escapeHtml(h.url).replace(/'/g, "\\'")}'; _browseUrlHideHistory(); browseNavigate('${escapeHtml(h.url).replace(/'/g, "\\'")}');">
      <img src="${escapeHtml(favicon)}" style="width:14px;height:14px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</span>
      <span style="font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">${escapeHtml(domain)}</span>
      <span style="font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;">${escapeHtml(time)}</span>
    </div>`;
  }).join('');

  dd.innerHTML = html;
  dd.style.display = '';
  dd.classList.remove('hidden');
}

const _BANG_LABELS = {
  g: 'Google', ddg: 'DuckDuckGo', b: 'Bing', yt: 'YouTube', w: 'Wikipedia',
  r: 'Reddit', gh: 'GitHub', so: 'Stack Overflow', npm: 'npm', mdn: 'MDN',
  tw: 'X / Twitter', twitch: 'Twitch', am: 'Amazon', maps: 'Google Maps',
  img: 'Google Images', imdb: 'IMDb', sp: 'Spotify', arxiv: 'arXiv',
  py: 'PyPI', crates: 'crates.io', hn: 'Hacker News', wa: 'Wolfram Alpha',
  nix: 'Nix Packages',
};

function _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse) {
  showBrowse = showBrowse || [];
  const suggestions = filter ? _currentSuggestions.filter(s => s.toLowerCase() !== filter) : [];
  const hasDef = _currentDef && /^[a-zA-Z]{2,}$/.test(filter);
  const hasInstant = _instantAnswer && _instantAnswer.html;
  const { ntp } = _getOmniInput();
  const showLucky = !filter && !ntp;

  // Match bangs: input starts with "!" and has no space yet (still picking a bang)
  const bangFilter = filter && /^!(\S*)$/.test(filter) ? filter.slice(1).toLowerCase() : null;
  const matchedBangs = bangFilter !== null && typeof _BANGS !== 'undefined'
    ? Object.keys(_BANGS).filter(k => k.startsWith(bangFilter)).slice(0, 8)
    : [];

  const pillWrap = document.getElementById('pill-url-wrap');
  const isIsland = dd.id === 'pill-url-dropdown';

  if (!showHist.length && !projects.length && !suggestions.length && !hasDef && !hasInstant && !showLucky && !showBrowse.length && !matchedBangs.length) {
    dd.style.display = 'none'; dd.classList.add('hidden');
    if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    return;
  }

  _browseUrlHistIdx = -1;

  if (ntp) {
    // NTP: inline inside the search box, no fixed positioning
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '320px';
    dd.style.overflowY = 'auto';
  } else if (isIsland) {
    // Island mode: dropdown flows inside the pill, no fixed positioning
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '';
    dd.style.overflowY = '';
    if (pillWrap) pillWrap.classList.add('pill-dropdown-open');
  } else {
    const rect = input.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + 'px';
    dd.style.top = (rect.bottom + 2) + 'px';
    dd.style.width = rect.width + 'px';
    dd.style.maxHeight = '380px';
    dd.style.overflowY = 'auto';
  }

  const rowStyle = ntp
    ? 'display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer;font-size:0.85rem;color:var(--nr-text-primary);transition:background 0.12s;border-radius:8px;margin:0 -4px;'
    : 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--nr-text-primary);transition:background 0.1s;';
  const hoverBg = ntp ? 'color-mix(in srgb, var(--nr-accent) 12%, transparent)' : 'var(--nr-bg-raised)';
  const hoverOn = "this.style.background='" + hoverBg + "'";
  const hoverOff = "this.style.background='none'";

  // Section renderers — each returns HTML string or '' if nothing to show
  const _urlBarRenderers = {
    bangs: () => {
      if (!matchedBangs.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Bangs</div>';
      h += matchedBangs.map(key => {
        const label = _BANG_LABELS[key] || key;
        const fillValue = '!' + key + ' ';
        const setInput = ntp
          ? `event.preventDefault(); var el=document.getElementById('search-query'); el.value='${fillValue}'; el.focus(); _browseUrlShowHistory();`
          : `event.preventDefault(); var el=document.getElementById('browse-url-input'); el.value='${fillValue}'; el.focus(); _browseUrlShowHistory();`;
        return `<div data-histq="bang:${escapeHtml(key)}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="${setInput}">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="font-weight:600;color:var(--nr-accent);">!${escapeHtml(key)}</span> <span style="color:var(--nr-text-tertiary);">${escapeHtml(label)}</span></span>
        </div>`;
      }).join('');
      return h;
    },
    lucky: () => {
      if (!showLucky) return '';
      const hasText = !!_feelingLuckyQuery;
      const waiting = _feelingLuckyLoading && !hasText;
      if (!_feelingLuckyQuery && !_feelingLuckyLoading) setTimeout(_browseUrlFeelingLucky, 0);
      const displayText = hasText ? escapeHtml(_feelingLuckyQuery) : (waiting ? '<span style="color:var(--nr-text-quaternary);">Thinking\u2026</span>' : '');
      return `<div class="browse-lucky-row" data-histq="${escapeHtml(_feelingLuckyQuery || '')}" style="${rowStyle}border-bottom:1px solid var(--nr-border-default);${waiting ? 'opacity:0.7;cursor:wait;' : ''}">
        <svg style="width:14px;height:14px;flex-shrink:0;color:var(--nr-text-quaternary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
          <span style="font-weight:600;color:var(--nr-text-primary);">Feeling Lucky</span>
          <span class="browse-lucky-text" style="margin-left:6px;color:var(--nr-text-tertiary);font-size:0.75rem;">${displayText}</span>
        </span>
        ${hasText && !_feelingLuckyLoading ? '<span class="browse-lucky-redo" style="flex-shrink:0;cursor:pointer;padding:2px 4px;border-radius:4px;color:var(--nr-text-quaternary);font-size:0.7rem;">\u21BB</span>' : ''}
      </div>`;
    },
    definition: () => {
      if (!hasDef) return '';
      const entry = _currentDef;
      let h = '<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);">';
      h += '<div style="display:flex;align-items:baseline;gap:8px;">';
      h += '<span style="font-size:1rem;font-weight:700;color:var(--nr-text-primary);">' + escapeHtml(entry.word) + '</span>';
      const phonetic = entry.phonetics?.find(p => p.text)?.text;
      if (phonetic) h += '<span style="font-size:0.78rem;color:var(--nr-text-tertiary);">' + escapeHtml(phonetic) + '</span>';
      const audio = entry.phonetics?.find(p => p.audio);
      if (audio) h += '<button onclick="event.stopPropagation();event.preventDefault();new Audio(\'' + escapeHtml(audio.audio) + '\').play()" style="background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:0;margin-left:2px;" title="Listen"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>';
      h += '</div>';
      for (const meaning of (entry.meanings || []).slice(0, 2)) {
        h += '<div style="margin-top:6px;"><span style="font-size:0.65rem;font-weight:600;color:var(--nr-accent);text-transform:uppercase;letter-spacing:0.04em;">' + escapeHtml(meaning.partOfSpeech) + '</span></div>';
        for (const def of (meaning.definitions || []).slice(0, 1)) {
          h += '<div style="font-size:0.8rem;color:var(--nr-text-primary);line-height:1.45;margin-top:2px;padding-left:8px;border-left:2px solid color-mix(in srgb, var(--nr-accent) 30%, transparent);">' + escapeHtml(def.definition) + '</div>';
          if (def.example) h += '<div style="font-size:0.72rem;color:var(--nr-text-tertiary);font-style:italic;margin-top:1px;padding-left:8px;">"' + escapeHtml(def.example) + '"</div>';
        }
      }
      h += '</div>';
      return h;
    },
    instant: () => {
      if (!hasInstant) return '';
      return _instantAnswer.html;
    },
    recent: () => {
      if (!showBrowse.length) return '';
      const iconSize = ntp ? '16px' : '14px';
      const navFn = ntp
        ? (url) => `event.preventDefault(); _browseUrlHideHistory(); browseNavigate('${url}');`
        : (url) => `event.preventDefault(); document.getElementById('browse-url-input').value='${url}'; _browseUrlHideHistory(); browseNavigate('${url}');`;
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Recent Sites</div>';
      h += showBrowse.map(bh => {
        const favicon = _browseFaviconUrl(bh.url);
        let domain = '';
        try { domain = new URL(bh.url).hostname.replace('www.', ''); } catch {}
        const safeUrl = escapeHtml(bh.url).replace(/"/g, '&quot;');
        const displayTitle = escapeHtml(bh.title || domain);
        return `<div data-histq="${safeUrl}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="${navFn(escapeHtml(bh.url).replace(/'/g, "\\'"))}">
          <img src="${escapeHtml(favicon)}" style="width:${iconSize};height:${iconSize};flex-shrink:0;border-radius:3px;" onerror="this.style.display='none';this.nextElementSibling.style.display=''">
          <svg style="width:${iconSize};height:${iconSize};flex-shrink:0;color:var(--nr-text-quaternary);display:none;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayTitle}</span>
          <span style="font-size:${ntp ? '0.75rem' : '0.68rem'};color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">${escapeHtml(domain)}</span>
        </div>`;
      }).join('');
      return h;
    },
    suggestions: () => {
      if (!suggestions.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      const navFn = ntp
        ? (q) => `event.preventDefault(); document.getElementById('search-query').value='${q}'; _browseUrlHideHistory(); submitSearch();`
        : (q) => `event.preventDefault(); document.getElementById('browse-url-input').value='${q}'; _browseUrlHideHistory(); browseNavigate('${q}');`;
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Suggestions</div>';
      h += suggestions.map(s => {
        const safeS = escapeHtml(s);
        return `<div data-histq="${safeS.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="${navFn(safeS.replace(/'/g, "\\'"))}">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeS}</span>
        </div>`;
      }).join('');
      return h;
    },
    projects: () => {
      if (!projects.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Projects</div>';
      h += projects.map(exp => {
        const safeId = escapeHtml(exp.id);
        const updated = exp.lastUpdated ? _relativeTime(exp.lastUpdated) : '';
        return `<div data-histq="project:${safeId}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); _browseUrlHideHistory(); openExperimentDetail('${safeId}');">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(exp.title)}</span>
          ${updated ? `<span style="font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;">${escapeHtml(updated)}</span>` : ''}
        </div>`;
      }).join('');
      return h;
    },
    users: () => {
      if (!filter) return '';
      const unique = [];
      const matched = unique.filter(u => u.toLowerCase().includes(filter)).slice(0, 5);
      if (!matched.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Users</div>';
      h += matched.map(username => {
        const safeU = escapeHtml(username);
        return `<div data-histq="user:${safeU}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); _browseUrlHideHistory(); if(typeof openUserProfile==='function') openUserProfile('${safeU.replace(/'/g, "\\'")}');">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeU}</span>
        </div>`;
      }).join('');
      return h;
    },
    notes: () => {
      if (!filter) return '';
      const notes = typeof _vaultNotes !== 'undefined' ? _vaultNotes : [];
      const matched = notes.filter(n => (n.title || '').toLowerCase().includes(filter)).slice(0, 5);
      if (!matched.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Notes</div>';
      h += matched.map(n => {
        return `<div data-histq="note:${n.id}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="event.preventDefault(); _browseUrlHideHistory(); if(typeof openVaultNote==='function') openVaultNote(${n.id});">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(n.title || 'Untitled')}</span>
        </div>`;
      }).join('');
      return h;
    },
    history: () => {
      if (!showHist.length) return '';
      const iconSize = ntp ? '16px' : '13px';
      const navFn = ntp
        ? (q) => `event.preventDefault(); document.getElementById('search-query').value='${q}'; _browseUrlHideHistory(); submitSearch();`
        : (q) => `event.preventDefault(); document.getElementById('browse-url-input').value='${q}'; _browseUrlHideHistory(); browseNavigate('${q}');`;
      let h = ntp ? '' : '<div style="padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;">Recent Searches</div>';
      h += showHist.map(sh => {
        const time = _relativeTime(sh.ts);
        const safeQ = escapeHtml(sh.q);
        return `<div data-histq="${safeQ.replace(/"/g, '&quot;')}" style="${rowStyle}" onmouseenter="${hoverOn}" onmouseleave="${hoverOff}" onmousedown="${navFn(safeQ.replace(/'/g, "\\'"))}">
          <svg style="width:${iconSize};height:${iconSize};color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeQ}</span>
          <span style="font-size:${ntp ? '0.75rem' : '0.68rem'};color:var(--nr-text-quaternary);flex-shrink:0;">${escapeHtml(time)}</span>
        </div>`;
      }).join('');
      return h;
    },
  };

  let html = '';
  const sections = _getUrlBarSections();
  for (const sec of sections) {
    if (sec.enabled === false) continue;
    const renderer = _urlBarRenderers[sec.key];
    if (renderer) html += renderer();
  }

  if (!html) {
    dd.style.display = 'none'; dd.classList.add('hidden');
    if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    return;
  }

  dd.innerHTML = html;
  dd.style.display = '';
  dd.classList.remove('hidden');

  // Attach feeling lucky click handlers (must be after innerHTML)
  const luckyRow = dd.querySelector('.browse-lucky-row');
  if (luckyRow) {
    luckyRow.addEventListener('mousedown', (ev) => {
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
      redo.addEventListener('mouseenter', () => { redo.style.color = 'var(--nr-accent)'; });
      redo.addEventListener('mouseleave', () => { redo.style.color = 'var(--nr-text-quaternary)'; });
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
      const data = await apiPost('/api/search-suggest', { query });
      const suggestions = data.suggestions || [];
      _suggestCache[query] = suggestions;
      _currentSuggestions = suggestions;
      // Re-render dropdown if input still matches
      const { input } = _getOmniInput();
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
      // External API - keep raw fetch
      const resp = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key));
      if (!resp.ok) { _defCache[key] = null; _currentDef = null; return; }
      const data = await resp.json();
      const entry = data[0] || null;
      _defCache[key] = entry;
      _currentDef = entry;
      // Re-render dropdown if input still matches
      const { input } = _getOmniInput();
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
      const { input } = _getOmniInput();
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
    return { type: 'math', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
      <div><span style="font-size:0.8rem;color:var(--nr-text-tertiary);">${escapeHtml(q)} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)}</span></div>
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
  return { type: 'color', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <div style="width:36px;height:36px;border-radius:8px;background:${color};border:1px solid var(--nr-border-default);flex-shrink:0;"></div>
    <div><div style="font-size:0.95rem;font-weight:600;color:var(--nr-text-primary);">${escapeHtml(label)}</div>
    <div style="font-size:0.72rem;color:var(--nr-text-tertiary);">Color preview</div></div>
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
  return { type: 'conversion', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
    <div><span style="font-size:0.8rem;color:var(--nr-text-tertiary);">${escapeHtml(m[1])} ${escapeHtml(m[2])} =</span> <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(formatted)} ${escapeHtml(m[3])}</span></div>
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
    return { type: 'timezone', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(time)}</span><span style="font-size:0.75rem;color:var(--nr-text-tertiary);">${escapeHtml(date)}</span></div>
      <div style="font-size:0.72rem;color:var(--nr-text-tertiary);">${escapeHtml(m[1].trim())} · ${escapeHtml(offset)}</div></div>
    </div>` };
  } catch { return null; }
}

// ── Weather (async) ──
async function _fetchWeatherAnswer(city) {
  // External API - keep raw fetch
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
  return { type: 'weather', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:12px;">
    <span style="font-size:1.6rem;">${emoji}</span>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:1.1rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(temp)}°C</span><span style="font-size:0.82rem;color:var(--nr-text-tertiary);">${escapeHtml(tempF)}°F</span></div>
      <div style="font-size:0.78rem;color:var(--nr-text-tertiary);">${escapeHtml(desc)}</div>
      <div style="font-size:0.7rem;color:var(--nr-text-quaternary);margin-top:2px;">Feels ${escapeHtml(feelsC)}°C · Humidity ${escapeHtml(humidity)}% · Wind ${escapeHtml(wind)} km/h</div>
    </div>
    <div style="font-size:0.72rem;color:var(--nr-text-tertiary);text-align:right;">${escapeHtml(city)}</div>
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

  // External API - keep raw fetch
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
  let html = '<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);">';
  html += '<div style="font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">' + escapeHtml(league.toUpperCase()) + ' Scores</div>';
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
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${away.winner ? 'font-weight:700;' : ''}">${escapeHtml(away.team?.abbreviation || away.team?.shortDisplayName || '?')}</span>`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(away.score || '-')}</span>`;
    html += `</div>`;
    html += `<span style="color:var(--nr-text-quaternary);font-size:0.7rem;">@</span>`;
    html += `<div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">`;
    html += `<span style="font-weight:700;color:var(--nr-text-primary);min-width:18px;text-align:center;">${escapeHtml(home.score || '-')}</span>`;
    if (home.team?.logo) html += `<img src="${escapeHtml(home.team.logo)}" style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">`;
    html += `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--nr-text-primary);${home.winner ? 'font-weight:700;' : ''}">${escapeHtml(home.team?.abbreviation || home.team?.shortDisplayName || '?')}</span>`;
    html += `</div>`;
    html += `<span style="font-size:0.68rem;color:${isLive ? 'var(--nr-accent)' : 'var(--nr-text-quaternary)'};white-space:nowrap;flex-shrink:0;min-width:50px;text-align:right;${isLive ? 'font-weight:600;' : ''}">${escapeHtml(status)}</span>`;
    html += `</div>`;
  }
  if (events.length > 4) html += `<div style="font-size:0.7rem;color:var(--nr-text-quaternary);padding-top:4px;">+${events.length - 4} more games</div>`;
  html += '</div>';
  return { type: 'sports', html };
}

// ── Stocks ──
async function _fetchStockAnswer(ticker) {
  const data = await apiGet('/api/stock-quote?symbol=' + encodeURIComponent(ticker));
  if (!data.price && data.price !== 0) return null;
  const price = data.price;
  const change = data.change || 0;
  const changePct = data.changePercent || 0;
  const name = data.name || ticker;
  const isUp = change >= 0;
  const arrow = isUp ? '▲' : '▼';
  const color = isUp ? '#22c55e' : '#ef4444';
  return { type: 'stock', html: `<div style="padding:10px 14px;border-bottom:1px solid var(--nr-border-default);display:flex;align-items:center;gap:10px;">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--nr-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
    <div style="flex:1;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:0.82rem;font-weight:700;color:var(--nr-text-primary);">${escapeHtml(ticker)}</span>
        <span style="font-size:0.72rem;color:var(--nr-text-tertiary);">${escapeHtml(name)}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px;">
        <span style="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);">$${parseFloat(price).toFixed(2)}</span>
        <span style="font-size:0.78rem;font-weight:600;color:${color};">${arrow} ${Math.abs(change).toFixed(2)} (${Math.abs(changePct).toFixed(2)}%)</span>
      </div>
    </div>
  </div>` };
}

let _browseUrlHideTimeout = null;

function _browseUrlScheduleHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = setTimeout(_browseUrlHideHistory, 150);
}

function _browseUrlCancelHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = null;
}

function _browseUrlHideHistory() {
  _browseUrlClearAutocomplete();
  _browseUrlHideTimeout = null;
  const dd = document.getElementById('browse-url-history-dd');
  if (dd) dd.style.display = 'none';
  const ntpDd = document.getElementById('search-history-dropdown-view');
  if (ntpDd) { ntpDd.style.display = 'none'; ntpDd.classList.add('hidden'); }
  const pillWrap = document.getElementById('pill-url-wrap');
  if (pillWrap) pillWrap.classList.remove('pill-dropdown-open');
  _browseUrlHistIdx = -1;
}

document.addEventListener('mousedown', (e) => {
  const { input, dd, island } = _getOmniInput();
  if (!dd) return;
  // Check visibility: pill dropdown uses class, others use display
  if (island) {
    const pillWrap = document.getElementById('pill-url-wrap');
    if (!pillWrap || !pillWrap.classList.contains('pill-dropdown-open')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target) || (e.target.closest && e.target.closest('#pill-url-wrap'))) return;
  } else {
    if (dd.style.display === 'none' && dd.classList.contains('hidden')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target)) return;
  }
  _browseUrlHideHistory();
});

// ── Web Search History ──

function _getWebSearchHistory() {
  try {
    const raw = Settings.getJSON('webSearchHistory', []);
    return raw.map(h => typeof h === 'string' ? { q: h, ts: 0 } : h);
  } catch { return []; }
}

function _removeWebSearch(index) {
  const hist = _getWebSearchHistory();
  hist.splice(index, 1);
  Settings.setJSON('webSearchHistory', hist);
}

function _clearWebSearchHistory() {
  Settings.setJSON('webSearchHistory', []);
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
  tab.url = 'netrun://history';
  tab.title = 'History';
  tab.favicon = '';
  tab._historyPage = true;

  // Remove existing iframe/content
  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-history-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;';
  container.appendChild(el);
  tab.el = el;

  // Hide new tab page
  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  // Update URL bar
  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://history');

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
  tab.url = 'netrun://help';
  tab.title = 'Help';
  tab.favicon = '';
  tab._helpPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const el = document.createElement('div');
  el.id = 'browse-help-' + tab.id;
  el.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;overflow-y:auto;background:var(--nr-bg-body);color:var(--nr-text-primary);z-index:3;';
  container.appendChild(el);
  tab.el = el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'netrun://help');

  _renderHelpPage(el);
}

function _renderHelpPage(el) {
  if (!el) return;
  const s = 'style';
  const section = `${s}="margin-bottom:24px;"`;
  const h2 = `${s}="font-size:1.05rem;font-weight:700;color:var(--nr-text-primary);margin-bottom:10px;"`;
  const table = `${s}="width:100%;border-collapse:collapse;font-size:0.82rem;"`;
  const th = `${s}="text-align:left;padding:6px 12px;font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--nr-border-default);"`;
  const td = `${s}="padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);"`;
  const tdk = `${s}="padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);color:var(--nr-text-primary);font-weight:500;white-space:nowrap;"`;
  const tdv = `${s}="padding:6px 12px;border-bottom:1px solid var(--nr-border-subtle);color:var(--nr-text-tertiary);"`;

  let html = '<div style="max-width:640px;margin:0 auto;padding:40px 24px;">';
  html += '<h1 style="font-size:1.4rem;font-weight:700;color:var(--nr-text-primary);margin-bottom:4px;">Help</h1>';
  html += '<p style="font-size:0.82rem;color:var(--nr-text-tertiary);margin-bottom:32px;">Everything you can do from the URL bar and aether panel.</p>';

  // Instant Answers
  html += `<div ${section}><div ${h2}>Instant Answers</div>`;
  html += '<p style="font-size:0.78rem;color:var(--nr-text-tertiary);margin-bottom:8px;">Type in the URL bar — results appear inline as you type.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Type</th><th ${th}>Try</th></tr>`;
  _HELP_DATA.instantAnswers.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Search Syntax
  html += `<div ${section}><div ${h2}>Search Syntax</div>`;
  html += '<p style="font-size:0.78rem;color:var(--nr-text-tertiary);margin-bottom:8px;">Use these in the Papers search on new tab pages.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Syntax</th><th ${th}>Effect</th></tr>`;
  _HELP_DATA.searchSyntax.forEach(([k, v]) => {
    html += `<tr><td ${tdk}><code style="font-size:0.8rem;">${k}</code></td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Bangs
  const bangs = _HELP_DATA.getBangs();
  if (bangs.length) {
    html += `<div ${section}><div ${h2}>Bangs</div>`;
    html += '<p style="font-size:0.78rem;color:var(--nr-text-tertiary);margin-bottom:8px;">Type <code style="font-size:0.8rem;">!</code> followed by a shortcut and your query to search a specific site. Works at the start or end of input.</p>';
    html += `<table ${table}>`;
    html += `<tr><th ${th}>Bang</th><th ${th}>Site</th></tr>`;
    bangs.forEach(([k, v]) => {
      html += `<tr><td ${tdk}><code style="font-size:0.8rem;">${k}</code></td><td ${tdv}>${v}</td></tr>`;
    });
    html += '</table></div>';
  }

  // Slash Commands
  html += `<div ${section}><div ${h2}>Slash Commands</div>`;
  html += '<p style="font-size:0.78rem;color:var(--nr-text-tertiary);margin-bottom:8px;">Right-click → type / in the aether panel.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Command</th><th ${th}>Action</th></tr>`;
  _HELP_DATA.slashCommands.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Keyboard Shortcuts
  html += `<div ${section}><div ${h2}>Keyboard Shortcuts</div>`;
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Key</th><th ${th}>Action</th></tr>`;
  _HELP_DATA.shortcuts.forEach(([k, v]) => {
    if (!k) {
      html += `<tr><td colspan="2" style="padding:10px 12px 4px;">${v}</td></tr>`;
    } else {
      html += `<tr><td ${tdk}><kbd style="font-family:inherit;font-size:0.78rem;padding:1px 6px;border-radius:4px;border:1px solid var(--nr-border-default);background:var(--nr-bg-surface);">${k}</kbd></td><td ${tdv}>${v}</td></tr>`;
    }
  });
  html += '</table></div>';

  // Aether Panel
  html += `<div ${section}><div ${h2}>Aether Panel</div>`;
  html += '<div style="font-size:0.82rem;color:var(--nr-text-tertiary);line-height:1.6;">';
  html += '<strong style="color:var(--nr-text-primary);">Right-click</strong> anywhere to open the panel.<br>';
  html += 'Type to <strong style="color:var(--nr-text-primary);">chat with AI</strong> about the current page.<br>';
  html += '<strong style="color:var(--nr-text-primary);">Select text</strong> → highlight, quote, or define.<br>';
  html += '<strong style="color:var(--nr-text-primary);">Drag</strong> while panel is open to capture a screenshot region.';
  html += '</div></div>';

  // Chat Tools
  html += `<div ${section}><div ${h2}>Chat Tools</div>`;
  html += '<p style="font-size:0.78rem;color:var(--nr-text-tertiary);margin-bottom:8px;">When enabled, the chat assistant can use these tools autonomously. Requires qwen3:8b.</p>';
  html += `<table ${table}>`;
  html += `<tr><th ${th}>Tool</th><th ${th}>Description</th></tr>`;
  _HELP_DATA.chatTools.forEach(([k, v]) => {
    html += `<tr><td ${tdk}>${k}</td><td ${tdv}>${v}</td></tr>`;
  });
  html += '</table></div>';

  // Internal Pages
  html += `<div ${section}><div ${h2}>Internal Pages</div>`;
  html += `<table ${table}>`;
  html += `<tr><th ${th}>URL</th><th ${th}>Page</th></tr>`;
  html += `<tr><td ${tdk}>netrun://help</td><td ${tdv}>This page</td></tr>`;
  html += `<tr><td ${tdk}>netrun://history</td><td ${tdv}>Browsing & search history</td></tr>`;
  html += '</table></div>';

  html += '</div>';
  el.innerHTML = html;
}

const _historyPageTab = 'browse'; // 'browse' or 'search'

function _renderWebSearchHistoryPage(el) {
  if (!el) return;
  const searchHist = _getWebSearchHistory();
  const browseHist = _getBrowseHistory();
  const isBrowse = _historyPageTab === 'browse';

  let html = '<div style="max-width:680px;margin:0 auto;padding:32px 24px 64px;">';

  // Header with tabs
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<svg style="width:20px;height:20px;color:var(--nr-text-quaternary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>';
  html += '<span style="font-size:1.1rem;font-weight:600;color:var(--nr-text-primary);">History</span>';
  html += '</div>';
  const clearFn = isBrowse
    ? '_clearBrowseHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));'
    : '_clearWebSearchHistory(); _renderWebSearchHistoryPage(this.closest(\'[id^=browse-history-]\'));';
  const activeHist = isBrowse ? browseHist : searchHist;
  if (activeHist.length) {
    html += '<button onclick="' + clearFn + '" style="padding:4px 10px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-secondary);font-size:0.75rem;cursor:pointer;">Clear all</button>';
  }
  html += '</div>';

  // Tab switcher
  const tabStyle = (active) => `padding:6px 14px;border:none;border-bottom:2px solid ${active ? 'var(--nr-accent)' : 'transparent'};background:none;color:${active ? 'var(--nr-text-primary)' : 'var(--nr-text-tertiary)'};font-size:0.82rem;cursor:pointer;font-weight:${active ? '600' : '400'};`;
  html += '<div style="display:flex;gap:0;border-bottom:1px solid var(--nr-border-strong);margin-bottom:16px;">';
  html += `<button onclick="_historyPageTab='browse';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(isBrowse)}">Sites <span style="font-size:0.7rem;color:var(--nr-text-quaternary);">${browseHist.length}</span></button>`;
  html += `<button onclick="_historyPageTab='search';_renderWebSearchHistoryPage(this.closest('[id^=browse-history-]'));" style="${tabStyle(!isBrowse)}">Searches <span style="font-size:0.7rem;color:var(--nr-text-quaternary);">${searchHist.length}</span></button>`;
  html += '</div>';

  // Filter
  html += '<div style="position:relative;margin-bottom:16px;">';
  html += '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--nr-text-quaternary);pointer-events:none;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>';
  html += '<input type="text" id="history-page-filter" placeholder="Filter history..." oninput="_filterWebSearchHistory()" style="width:100%;padding:7px 12px 7px 32px;border-radius:8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.82rem;outline:none;" />';
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
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--nr-text-tertiary);font-size:0.85rem;">No searches found</div>';

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
    html += '<div style="font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.q === h.q && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      const safeQ = escapeHtml(h.q).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--nr-bg-raised)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNewTab('${safeQ}')">
        <svg style="width:14px;height:14px;color:var(--nr-text-quaternary);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
        <span style="font-size:0.82rem;color:var(--nr-text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.q)}</span>
        <span style="font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeWebSearch(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
          <svg style="width:14px;height:14px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

function _renderBrowseHistoryList(hist) {
  if (!hist.length) return '<div style="text-align:center;padding:48px 0;color:var(--nr-text-tertiary);font-size:0.85rem;">No browsing history</div>';

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
    html += '<div style="font-size:0.7rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;padding:0 4px;">' + escapeHtml(label) + '</div>';
    groupMap[label].forEach(h => {
      const origIdx = allHist.findIndex(a => a.url === h.url && a.ts === h.ts);
      const time = _relativeTime(h.ts);
      let domain = '';
      try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
      const favicon = _browseFaviconUrl(h.url);
      const safeUrl = escapeHtml(h.url).replace(/'/g, '&#39;');
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseenter="this.style.background='var(--nr-bg-raised)';this.querySelector('.hist-del').style.opacity='1'" onmouseleave="this.style.background='none';this.querySelector('.hist-del').style.opacity='0'" onclick="browseNewTab('${safeUrl}')">
        <img src="${escapeHtml(favicon)}" style="width:16px;height:16px;flex-shrink:0;border-radius:2px;" onerror="this.style.display='none'">
        <div style="flex:1;overflow:hidden;min-width:0;">
          <div style="font-size:0.82rem;color:var(--nr-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title || domain)}</div>
          <div style="font-size:0.7rem;color:var(--nr-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(domain)}</div>
        </div>
        <span style="font-size:0.7rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;">${escapeHtml(time)}</span>
        <button class="hist-del" onclick="event.stopPropagation(); _removeBrowseVisit(${origIdx}); _filterWebSearchHistory();" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--nr-text-quaternary);opacity:0;flex-shrink:0;transition:opacity 0.15s;">
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
  try { return Settings.getJSON('browseHistory', []); } catch { return []; }
}

function _removeBrowseVisit(index) {
  const hist = _getBrowseHistory();
  hist.splice(index, 1);
  Settings.setJSON('browseHistory', hist);
}

function _clearBrowseHistory() {
  Settings.setJSON('browseHistory', []);
}

// ── Ad Blocker toggle & badge ──

function toggleAdBlock() {
  const on = Settings.get('adBlockEnabled') === 'true';
  const newState = !on;
  Settings.set('adBlockEnabled', newState ? 'true' : 'false');
  if (window.electronAPI && window.electronAPI.adblockSetEnabled) {
    window.electronAPI.adblockSetEnabled(newState);
  }
  _browseUpdateAdBlockBtn();
  // Reload current tab to apply/remove blocking
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (tab && tab.url && !tab.blank && tab.el) {
    if (_browseIsElectron) {
      // Electron: just reload the webview — main process handles blocking
      if (tab.el.reload) tab.el.reload();
    } else {
      const proxied = _browseProxyUrl(tab.url);
      tab.el.dataset.originalUrl = tab.url;
      tab.el.src = proxied;
    }
  }
}

function _browseUpdateAdBlockBtn() {
  const btn = document.getElementById('browse-adblock-btn');
  if (!btn) return;
  const on = Settings.get('adBlockEnabled') === 'true';
  btn.style.color = on ? 'var(--nr-accent)' : '';
  btn.title = on ? 'Ad Blocker (on)' : 'Ad Blocker (off)';
  btn.classList.toggle('text-dimmer', !on);
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
    const all = Settings.getJSON('sitePermissions', {});
    return all[domain] || {};
  } catch { return {}; }
}

function _setSitePermission(domain, perm, value) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    if (!all[domain]) all[domain] = {};
    if (value === 'ask') {
      delete all[domain][perm];
      if (!Object.keys(all[domain]).length) delete all[domain];
    } else {
      all[domain][perm] = value;
    }
    Settings.setJSON('sitePermissions', all);
  } catch {}
}

function _clearSitePermissions(domain) {
  try {
    const all = Settings.getJSON('sitePermissions', {});
    delete all[domain];
    Settings.setJSON('sitePermissions', all);
  } catch {}
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
    <div style="background:var(--nr-bg-overlay);border:1px solid var(--nr-border-default);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:380px;overflow:hidden;">
      <div style="padding:20px 20px 12px;display:flex;align-items:flex-start;gap:12px;">
        <div style="flex:1;">
          <div style="font-size:0.92rem;font-weight:600;color:var(--nr-text-primary);line-height:1.4;">
            <strong>${escapeHtml(domain)}</strong> wants to
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--nr-bg-raised);">
            <span style="color:var(--nr-text-quaternary);flex-shrink:0;">${icon}</span>
            <span style="font-size:0.84rem;color:var(--nr-text-primary);">${escapeHtml(label)}</span>
          </div>
        </div>
        <button id="perm-prompt-close" style="background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:2px;flex-shrink:0;" title="Dismiss">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div style="padding:0 20px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span style="font-size:0.75rem;color:var(--nr-text-tertiary);">Remember my decision</span>
          <select id="perm-prompt-remember" style="padding:4px 8px;border-radius:6px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.75rem;cursor:pointer;">
            <option value="session">Until I close this site</option>
            <option value="always" selected>Always</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="perm-prompt-block" style="padding:6px 20px;border-radius:8px;border:1px solid var(--nr-border-strong);background:var(--nr-bg-surface);color:var(--nr-text-primary);font-size:0.82rem;font-weight:500;cursor:pointer;">Block</button>
          <button id="perm-prompt-allow" style="padding:6px 20px;border-radius:8px;border:1px solid var(--nr-accent);background:var(--nr-accent);color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer;">Allow</button>
        </div>
      </div>
      <div style="padding:8px 20px;border-top:1px solid var(--nr-border-subtle);font-size:0.68rem;color:var(--nr-text-quaternary);">
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
const _sessionPermissions = {};

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
    dd.innerHTML = '<div style="padding:12px;text-align:center;font-size:0.78rem;color:var(--aether-text-dim);">Navigate to a site first</div>';
    return;
  }

  const perms = _getSitePermissions(domain);
  const effective = _getEffectivePermissions(domain);
  let html = '';
  html += '<div style="padding:6px 8px 4px;font-size:0.72rem;color:var(--aether-text-dimmer);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(domain) + '</div>';
  html += '<div style="padding:0 8px 4px;font-size:0.65rem;color:var(--aether-text-dimmest);line-height:1.3;">Blocked by default. Click Allow to grant access.</div>';

  for (const key of _SITE_PERM_KEYS) {
    const current = effective[key] || 'ask';
    const label = _SITE_PERM_LABELS[key];
    const icon = _SITE_PERM_ICONS[key];
    const isSession = !perms[key] && (_sessionPermissions[domain] || {})[key];
    html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;">';
    html += '<span style="color:var(--aether-text-dimmer);flex-shrink:0;">' + icon + '</span>';
    html += '<span style="flex:1;font-size:0.75rem;color:var(--aether-text);">' + label + '</span>';
    if (isSession) {
      html += '<span style="font-size:0.58rem;color:var(--aether-text-dimmest);margin-right:2px;">session</span>';
    }
    html += '<div style="display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--aether-border);">';
    for (const val of ['ask', 'allow', 'block']) {
      const active = current === val;
      const bg = active ? (val === 'allow' ? 'color-mix(in srgb, #22c55e 20%, var(--aether-dropdown-bg))' : val === 'block' ? 'color-mix(in srgb, #ef4444 20%, var(--aether-dropdown-bg))' : 'color-mix(in srgb, var(--nr-accent) 20%, var(--aether-dropdown-bg))') : 'var(--aether-dropdown-bg)';
      const fg = active ? (val === 'allow' ? '#22c55e' : val === 'block' ? '#ef4444' : 'var(--nr-accent)') : 'var(--aether-text-dimmer)';
      const safeDomain = escapeHtml(domain).replace(/'/g, "\\'");
      const onclick = val === 'allow'
        ? '_showPermissionPrompt(\'' + safeDomain + '\',\'' + key + '\');'
        : '_setSitePermission(\'' + safeDomain + '\',\'' + key + '\',\'' + val + '\'); delete (_sessionPermissions[\'' + safeDomain + '\'] || {})[\'' + key + '\']; _renderSitePermissionsDropdown(); _browseApplyPermissions();';
      html += '<button onclick="' + onclick + '" style="padding:2px 7px;font-size:0.65rem;border:none;cursor:pointer;background:' + bg + ';color:' + fg + ';font-weight:' + (active ? '600' : '400') + ';text-transform:capitalize;">' + val + '</button>';
    }
    html += '</div></div>';
  }

  const safeDomain2 = escapeHtml(domain).replace(/'/g, "\\'");
  html += '<div style="padding:4px 8px 6px;border-top:1px solid var(--aether-border);margin-top:2px;">';
  html += '<button onclick="_clearSitePermissions(\'' + safeDomain2 + '\'); delete _sessionPermissions[\'' + safeDomain2 + '\']; _renderSitePermissionsDropdown(); _browseApplyPermissions();" style="width:100%;padding:4px;border-radius:6px;border:1px solid var(--aether-border);background:var(--aether-dropdown-bg);color:var(--aether-text-dim);font-size:0.72rem;cursor:pointer;">Reset all to default</button>';
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
    const browseHidden = !browseView || browseView.style.display !== 'flex';
    // open-file works even when browse isn't open
    if (command === 'open-file') {
      if (browseHidden && typeof openBrowse === 'function') openBrowse();
      if (typeof openLocalPdfDialog === 'function') {
        if (browseHidden) setTimeout(openLocalPdfDialog, 50);
        else openLocalPdfDialog();
      }
      return;
    }
    // new-tab works globally — always opens NTP regardless of current view
    if (command === 'new-tab') {
      if (browseHidden && typeof openBrowse === 'function') openBrowse();
      const win = typeof _getCurrentWindow === 'function' ? _getCurrentWindow() : null;
      const active = win && win.tabs && win.tabs.find(t => t.id === win.activeTab);
      if (active && active.blank) {
        const inp = document.querySelector('.browse-ntp #search-query');
        if (inp) { inp.focus(); inp.select(); }
      } else {
        if (typeof browseNewTab === 'function') browseNewTab();
      }
      return;
    }

    if (browseHidden) return;

    // Dismiss aether panel on any browse command
    const _cmdPopup = document.getElementById('doc-chat-ask-float');
    if (_cmdPopup) { _cmdPopup.remove(); _aetherTrackMode = false; _aetherShowCursor(); }

    if (command === 'reload') {
      if (typeof browseReload === 'function') browseReload();
    } else if (command === 'force-reload') {
      if (typeof browseReload === 'function') browseReload();
    } else if (command === 'close-tab') {
      const win = _getCurrentWindow();
      if (win && win.activeTab) {
        browseCloseTab(win.activeTab);
      }
    } else if (command === 'reopen-tab') {
      browseReopenTab();
    } else if (command === 'print') {
      if (typeof browsePrintPage === 'function') {
        browsePrintPage();
      }
    } else if (command === 'back') {
      browseBack();
    } else if (command === 'forward') {
      browseForward();
    }
  });
}

