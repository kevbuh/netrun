// urlbar-dropdown.js — Omnibox resolution, keyboard nav, autocomplete, dropdown rendering, search suggestions, definitions
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _browseFaviconUrl } from '/js/toolbar/toolbar-nav.js';
import { _BANGS, browseNavigate } from '/js/toolbar/toolbar-url.js';
import { _relativeTime, submitSearch } from '/js/search.js';
import { chatViewNewThread, openChatPage } from '/js/chat-view.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { _computeInstantAnswer, _instantAnswer } from '/js/urlbar/urlbar-instant.js';
import { _getBrowseHistory, _getWebSearchHistory } from '/js/urlbar/urlbar-history.js';

// ── Browse URL Bar Section Config ──

export const _URL_BAR_SECTIONS = [
  { key: 'quickopen',  label: 'Quick Open' },
  { key: 'chat',       label: 'Chat' },
  { key: 'search',     label: 'Search' },
  { key: 'bangs',      label: 'Bangs' },
  { key: 'definition', label: 'Definition' },
  { key: 'instant',    label: 'Instant Answers' },
  { key: 'recent',     label: 'Recent Sites' },
  { key: 'suggestions',label: 'Suggestions' },
  { key: 'projects',   label: 'Projects' },
  { key: 'users',      label: 'Users' },
  { key: 'threads',    label: 'Chat History' },
  { key: 'notes',      label: 'Notes' },
  { key: 'history',    label: 'Search History' },
];

export const _QUICK_OPEN_VIEWS = [
  // ── Main views ──
  { key: 'feed',      label: 'Feed',      aliases: ['feed'],               icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>' },
  { key: 'chat',      label: 'Chat',      aliases: ['chat', 'ai'],         icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>' },
  { key: 'browse',    label: 'Browse',    aliases: ['browse', 'web'],      icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>' },
  { key: 'docs',      label: 'Docs',      aliases: ['docs', 'documents'],  icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>' },
  { key: 'settings',  label: 'Settings',  aliases: ['settings', 'prefs', 'preferences'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>' },
  { key: 'dashboard', label: 'Dashboard', aliases: ['dashboard', 'home'],  icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>' },
  { key: 'inbox',     label: 'Inbox',     aliases: ['inbox', 'notifications', 'messages'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3"/>' },
  { key: 'draw',      label: 'Draw',      aliases: ['draw', 'canvas', 'sketch'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.764m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/>' },
  { key: 'neuralook', label: 'Neuralook', aliases: ['neuralook', 'neural', 'ml', 'machine learning'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>' },
  { key: 'dev',       label: 'Dev Stats',  aliases: ['dev', 'developer', 'stats'], icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/>' },
  { key: 'history',   label: 'History',   aliases: ['history'], action: 'history', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/>' },
  // ── Features ──
  { key: 'terminal',  label: 'Terminal',  aliases: ['terminal', 'console', 'shell'], action: 'terminal', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/>' },
  { key: 'research',  label: 'Research',  aliases: ['research', 'search'], action: 'research', icon: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>' },
  { key: 'downloads', label: 'Downloads', aliases: ['downloads'], action: 'downloads', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>' },
  { key: 'newtab',    label: 'New Tab',   aliases: ['new tab', 'newtab', 'tab'], action: 'newtab', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>' },
  // ── Settings sub-sections ──
  { key: 'appearance', label: 'Appearance', aliases: ['appearance', 'theme', 'themes', 'colors'], action: 'settings:appearance', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z"/>' },
  { key: 'ai-settings', label: 'AI Settings', aliases: ['ai settings', 'llm', 'models', 'providers'], action: 'settings:ai', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"/>' },
  { key: 'browser-settings', label: 'Browser Settings', aliases: ['browser settings', 'bookmarks', 'passwords'], action: 'settings:browser', icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>' },
  // ── Fun ──
  { key: 'pixelpet',  label: 'Pixel Pet', aliases: ['pixel pet', 'pixelpet', 'pet'], action: 'pixelpet', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"/>' },
  { key: 'netrunner', label: 'Netrunner', aliases: ['netrunner', 'game', 'konami'], action: 'netrunner', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"/>' },
];

export function _getUrlBarSections() {
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

export function _saveUrlBarSections(sections) {
  Settings.setJSON('urlBarSections', sections.map(s => ({ key: s.key, enabled: s.enabled })));
}

// ── Dropdown state ──

export let _browseUrlHistIdx = -1;
export let _browseUrlOriginalInput = '';
export let _suggestDebounce = null;
export let _suggestAbort = null;
export const _suggestCache = {};
export let _currentSuggestions = [];
export const _defCache = {};
export let _defDebounce = null;
export let _currentDef = null; // cached definition entry for current word
export let _currentChatThreads = []; // cached chat threads matching filter

// ── Inline Autocomplete (Chrome-style selection) ──

export let _browseUrlAutocompleteSuggestion = ''; // full domain suggestion currently shown
export let _browseUrlTypedLength = 0; // length of the user's actual typed text
export let _browseUrlAcSuppressed = false; // suppress re-autocomplete after delete

export function _browseUrlGetAutocomplete(filter) {
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

export function _browseUrlApplyAutocomplete(input, suggestion) {
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

export function _browseUrlClearAutocomplete() {
  _browseUrlAutocompleteSuggestion = '';
  _browseUrlTypedLength = 0;
}

// Returns the active omnibox input & dropdown elements (NTP search or URL bar)
export function _getOmniInput() {
  // NTP check first: if the NTP is visible, use its search input + dropdown
  const ntpEl = document.getElementById('browse-content')?.querySelector('.browse-ntp');
  if (ntpEl && ntpEl.style.display !== 'none') {
    const input = document.getElementById('search-query');
    const dd = document.getElementById('search-history-dropdown-view');
    if (input && dd) return { input, dd, ntp: true };
  }
  // Popup mode: URL input stays in pill, dropdown renders in popup
  if (window._urlPopupEl) {
    const input = document.getElementById('pill-browse-url-input');
    const dd = window._urlPopupEl.querySelector('#pill-url-popup-dropdown');
    return { input, dd, ntp: false, island: true, popup: true };
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

export function _browseUrlKeydown(e) {
  const { input, dd, ntp, island, popup } = _getOmniInput();
  const visible = popup
    ? !!(dd && dd.style.display !== 'none' && dd.innerHTML)
    : island
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
    if (typeof window._browseAutoSizeUrlInput === 'function') window._browseAutoSizeUrlInput(input);
    return;
  }

  if (e.key === 'Enter') {
    if (visible && _browseUrlHistIdx >= 0) {
      e.preventDefault();
      const items = dd.querySelectorAll('[data-histq]');
      if (items[_browseUrlHistIdx]) {
        const q = items[_browseUrlHistIdx].dataset.histq;
        _browseUrlHideHistory();
        if (q.startsWith('chat:')) {
          if (typeof chatViewNewThread === 'function') chatViewNewThread(q.slice(5));
        } else if (q.startsWith('project:')) {
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
      input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q.startsWith('chat:') ? q.slice(5) : q;
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
        input.value = q.startsWith('project:') ? items[_browseUrlHistIdx].querySelector('span').textContent : q.startsWith('chat:') ? q.slice(5) : q;
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

export function _browseUrlHighlight(items) {
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


export function _browseUrlShowHistory() {
  const { input, dd, ntp, popup } = _getOmniInput();
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

  // In expanded island mode with no filter, still show recents
  // (the render function will handle showing recent sites/searches)

  // Don't show dropdown on blank new-tab pages with no input (URL bar only, NTP always shows)
  if (!filter && !ntp) {
    const win = typeof window._getCurrentWindow === 'function' ? window._getCurrentWindow() : null;
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

  // Chat thread matches — also fetch recent threads for NTP with no filter
  const chatThreads = [];
  if (filter && filter.length >= 2 && typeof electronAPI !== 'undefined') {
    electronAPI.dbQuery('chat-thread-list', 50, 0).then(threads => {
      if (!threads) return;
      _currentChatThreads = threads.filter(t =>
        (t.title || '').toLowerCase().includes(filter)
      ).slice(0, 4);
      // Re-render dropdown with thread results
      const { dd: dd2, input: input2 } = _getOmniInput();
      if (dd2 && dd2.style.display !== 'none') {
        _browseUrlRenderDropdown(dd2, input2, projects, showHist, filter, showBrowse);
      }
    });
  } else if (!filter && ntp && typeof electronAPI !== 'undefined') {
    electronAPI.dbQuery('chat-thread-list', 10, 0).then(threads => {
      if (!threads) return;
      _currentChatThreads = threads.slice(0, 6);
      const { dd: dd2, input: input2 } = _getOmniInput();
      if (dd2 && dd2.style.display !== 'none') {
        _browseUrlRenderDropdown(dd2, input2, projects, showHist, filter, showBrowse);
      }
    });
  } else {
    _currentChatThreads = [];
  }

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

export function _browseUrlRenderHistoryCommand(dd, input) {
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
    AetherUI.mount(
      Text('No browsing history').cssText('padding:12px;font-size:0.8rem;color:var(--nr-text-secondary);text-align:center;'),
      dd
    );
    dd.style.display = '';
    dd.classList.remove('hidden');
    return;
  }

  const header = Text('Recent Sites').cssText('padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;');
  const rows = VStack(header);
  hist.forEach((h, i) => {
    const favicon = _browseFaviconUrl(h.url);
    let domain = '';
    try { domain = new URL(h.url).hostname.replace('www.', ''); } catch {}
    const time = _relativeTime(h.ts);
    const img = new View('img').attr('src', favicon).cssText('width:14px;height:14px;flex-shrink:0;border-radius:2px;');
    img.el.onerror = function() { this.style.display = 'none'; };
    const row = HStack(
      img,
      Text(h.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
      Text(domain).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;'),
      Text(time).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;')
    ).cssText('display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;color:var(--nr-text-primary);transition:background 0.1s;');
    row.el.dataset.idx = String(i);
    row.el.dataset.histq = h.url;
    row.on('mouseenter', function() { this.style.background = 'var(--nr-bg-raised)'; });
    row.on('mouseleave', function() { if (this.dataset.idx != window._browseUrlHistIdx) this.style.background = 'none'; });
    row.on('mousedown', function(ev) {
      ev.preventDefault();
      const _i = _getOmniInput().input;
      if (_i) _i.value = h.url;
      _browseUrlHideHistory();
      browseNavigate(h.url);
    });
    rows.add(row);
  });

  AetherUI.mount(rows, dd);
  dd.style.display = '';
  dd.classList.remove('hidden');
}

export const _BANG_LABELS = {
  g: 'Google', ddg: 'DuckDuckGo', b: 'Bing', yt: 'YouTube', w: 'Wikipedia',
  r: 'Reddit', gh: 'GitHub', so: 'Stack Overflow', npm: 'npm', mdn: 'MDN',
  tw: 'X / Twitter', twitch: 'Twitch', am: 'Amazon', maps: 'Google Maps',
  img: 'Google Images', imdb: 'IMDb', sp: 'Spotify', arxiv: 'arXiv',
  py: 'PyPI', crates: 'crates.io', hn: 'Hacker News', wa: 'Wolfram Alpha',
  nix: 'Nix Packages',
};

// ── Dropdown row helper — creates a styled HStack with hover + mousedown ──
function _ddRow(opts) {
  // opts: { histq, rowStyle, hoverBg, children[], onMousedown }
  const row = HStack(...opts.children).cssText(opts.rowStyle);
  row.el.dataset.histq = opts.histq;
  if (opts.className) row.el.className = opts.className;
  if (opts.extraStyle) row.cssText(opts.rowStyle + opts.extraStyle);
  row.on('mouseenter', function() { this.style.background = opts.hoverBg; });
  row.on('mouseleave', function() { this.style.background = opts.hoverOffBg || 'none'; });
  row.on('mousedown', opts.onMousedown);
  return row;
}

export function _ddSectionHeader(label) {
  return Text(label).cssText('padding:4px 12px 2px;font-size:0.65rem;color:var(--nr-text-quaternary);text-transform:uppercase;letter-spacing:0.05em;');
}

export function _ddSvgIcon(svgInner, size, color) {
  return RawHTML('<svg style="width:' + size + ';height:' + size + ';color:' + (color || 'var(--nr-text-quaternary)') + ';flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' + svgInner + '</svg>');
}

export function _ddFaviconWithFallback(faviconUrl, size) {
  const img = new View('img').attr('src', faviconUrl).cssText('width:' + size + ';height:' + size + ';flex-shrink:0;border-radius:3px;');
  const fallback = _ddSvgIcon('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke-linecap="round" stroke-linejoin="round"/>', size, 'var(--nr-text-quaternary)');
  fallback.cssText(fallback.el.style.cssText + 'display:none;');
  img.el.onerror = function() { this.style.display = 'none'; this.nextElementSibling.style.display = ''; };
  return { img, fallback };
}

const _SEARCH_SVG = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>';
const _CHAT_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>';
const _CLOCK_SVG = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/>';
const _BOLT_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>';
const _USER_SVG = '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>';
const _FLASK_SVG = '<path d="M7 2v2h1v7.15L5.03 17.49C4.08 19.3 5.36 21.5 7.41 21.5h9.18c2.05 0 3.33-2.2 2.38-4.01L16 11.15V4h1V2H7zm7 9.85l2.88 5.15H7.12L10 11.85V4h4v7.85z"/>';

export function _browseUrlRenderDropdown(dd, input, projects, showHist, filter, showBrowse) {
  showBrowse = showBrowse || [];
  const suggestions = filter ? _currentSuggestions.filter(s => s.toLowerCase() !== filter) : [];
  const hasDef = _currentDef && /^[a-zA-Z]{2,}$/.test(filter);
  const hasInstant = _instantAnswer && _instantAnswer.html;
  const { ntp } = _getOmniInput();


  // Match bangs: input starts with "!" and has no space yet (still picking a bang)
  const bangFilter = filter && /^!(\S*)$/.test(filter) ? filter.slice(1).toLowerCase() : null;
  const matchedBangs = bangFilter !== null && typeof _BANGS !== 'undefined'
    ? Object.keys(_BANGS).filter(k => k.startsWith(bangFilter)).slice(0, 8)
    : [];

  // Quick open: match view keywords
  const quickOpenMatches = filter && filter.length >= 2
    ? _QUICK_OPEN_VIEWS.filter(v => v.aliases.some(a => a.startsWith(filter)) || v.label.toLowerCase().startsWith(filter))
    : [];

  const pillWrap = document.getElementById('pill-url-wrap');
  const isIsland = dd.id === 'pill-url-dropdown';
  const isPopup = dd.id === 'pill-url-popup-dropdown';

  if (!showHist.length && !projects.length && !suggestions.length && !hasDef && !hasInstant && !showBrowse.length && !matchedBangs.length && !quickOpenMatches.length && !(ntp && filter)) {
    if (isPopup) {
      // In popup mode: show tabs, hide dropdown
      const tabsEl = window._urlPopupEl ? window._urlPopupEl.querySelector('#pill-url-popup-tabs') : null;
      if (tabsEl) tabsEl.style.display = '';
      dd.innerHTML = '';
      dd.style.display = 'none';
    } else {
      dd.style.display = 'none'; dd.classList.add('hidden');
      if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    }
    return;
  }

  _browseUrlHistIdx = -1;

  if (ntp) {
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '320px';
    dd.style.overflowY = 'auto';
  } else if (isPopup) {
    // Popup mode: container handles positioning, toggle tab list visibility
    dd.style.position = '';
    dd.style.left = '';
    dd.style.top = '';
    dd.style.width = '';
    dd.style.maxHeight = '320px';
    dd.style.overflowY = 'auto';
    const tabsEl = window._urlPopupEl ? window._urlPopupEl.querySelector('#pill-url-popup-tabs') : null;
    if (tabsEl) tabsEl.style.display = filter ? 'none' : '';
  } else if (isIsland) {
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
  const iconSize = ntp ? '16px' : '14px';
  const smallIconSize = ntp ? '16px' : '13px';
  const trailSize = ntp ? '0.75rem' : '0.68rem';

  // Section renderers — each returns a View or null
  const _urlBarRenderers = {
    quickopen: () => {
      if (!quickOpenMatches.length) return null;
      const qoSize = ntp ? '16px' : '14px';
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Open'));
      quickOpenMatches.forEach(v => {
        const actionFn = _resolveQuickOpenAction(v);
        const row = _ddRow({
          histq: 'open:' + v.key, rowStyle, hoverBg,
          children: [
            RawHTML('<svg style="width:' + qoSize + ';height:' + qoSize + ';color:var(--nr-accent);flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">' + v.icon + '</svg>'),
            Text('Open ' + v.label).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;'),
            Text('View').cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); actionFn(); }
        });
        container.add(row);
      });
      return container;
    },
    chat: () => {
      if (!filter || !ntp) return null;
      const row = _ddRow({
        histq: 'chat:' + filter, rowStyle, hoverBg: 'color-mix(in srgb, var(--nr-accent) 30%, transparent)',
        hoverOffBg: 'color-mix(in srgb, var(--nr-accent) 20%, transparent)',
        extraStyle: 'background:color-mix(in srgb, var(--nr-accent) 20%, transparent);font-weight:500;',
        className: 'ntp-chat-row',
        children: [
          _ddSvgIcon(_CHAT_SVG, '16px', 'var(--nr-accent)'),
          RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(filter) + ' <span style="color:var(--nr-text-secondary);font-weight:400;">\u2014 Chat</span></span>')
        ],
        onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof chatViewNewThread === 'function') chatViewNewThread(filter); }
      });
      return row;
    },
    search: () => {
      if (!filter || !ntp) return null;
      return _ddRow({
        histq: filter, rowStyle, hoverBg,
        children: [
          _ddSvgIcon(_SEARCH_SVG, '16px'),
          RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(filter) + ' <span style="color:var(--nr-text-secondary);">\u2014 Google</span></span>')
        ],
        onMousedown: function(ev) {
          ev.preventDefault();
          const sq = document.getElementById('search-query');
          if (sq) sq.value = filter;
          _browseUrlHideHistory();
          submitSearch();
        }
      });
    },
    bangs: () => {
      if (!matchedBangs.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Bangs'));
      matchedBangs.forEach(key => {
        const label = _BANG_LABELS[key] || key;
        const fillValue = '!' + key + ' ';
        const row = _ddRow({
          histq: 'bang:' + key, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_BOLT_SVG, smallIconSize),
            RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="font-weight:600;color:var(--nr-accent);">!' + escapeHtml(key) + '</span> <span style="color:var(--nr-text-secondary);">' + escapeHtml(label) + '</span></span>')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            const el = ntp ? document.getElementById('search-query') : document.getElementById('browse-url-input');
            if (el) { el.value = fillValue; el.focus(); }
            _browseUrlShowHistory();
          }
        });
        container.add(row);
      });
      return container;
    },
    definition: () => {
      if (!hasDef) return null;
      const entry = _currentDef;
      const container = VStack();
      container.cssText('padding:10px 14px;border-bottom:1px solid var(--nr-border-default);');

      const headerRow = HStack(
        Text(entry.word).cssText('font-size:1rem;font-weight:700;color:var(--nr-text-primary);')
      ).cssText('display:flex;align-items:baseline;gap:8px;');

      const phonetic = entry.phonetics?.find(p => p.text)?.text;
      if (phonetic) headerRow.add(Text(phonetic).cssText('font-size:0.78rem;color:var(--nr-text-secondary);'));
      const audio = entry.phonetics?.find(p => p.audio);
      if (audio) {
        const playBtn = Button(RawHTML('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>'))
          .cssText('background:none;border:none;cursor:pointer;color:var(--nr-text-quaternary);padding:0;margin-left:2px;')
          .attr('title', 'Listen');
        playBtn.onTap(function(ev) { ev.stopPropagation(); ev.preventDefault(); new Audio(audio.audio).play(); });
        headerRow.add(playBtn);
      }
      container.add(headerRow);

      for (const meaning of (entry.meanings || []).slice(0, 2)) {
        container.add(Text(meaning.partOfSpeech).cssText('margin-top:6px;font-size:0.65rem;font-weight:600;color:var(--nr-accent);text-transform:uppercase;letter-spacing:0.04em;'));
        for (const def of (meaning.definitions || []).slice(0, 1)) {
          container.add(Text(def.definition).cssText('font-size:0.8rem;color:var(--nr-text-primary);line-height:1.45;margin-top:2px;padding-left:8px;border-left:2px solid color-mix(in srgb, var(--nr-accent) 30%, transparent);'));
          if (def.example) container.add(Text('"' + def.example + '"').cssText('font-size:0.72rem;color:var(--nr-text-secondary);font-style:italic;margin-top:1px;padding-left:8px;'));
        }
      }
      return container;
    },
    instant: () => {
      if (!hasInstant) return null;
      return RawHTML(_instantAnswer.html);
    },
    recent: () => {
      // On NTP with no filter, merge browse history and recent chat threads sorted by recency
      if (ntp && !filter) {
        const merged = [
          ...showBrowse.map(bh => ({ type: 'browse', data: bh, ts: bh.ts || 0 })),
          ..._currentChatThreads.map(t => ({ type: 'thread', data: t, ts: (t.updated_at || 0) * 1000 })),
        ].sort((a, b) => b.ts - a.ts).slice(0, 8);
        if (!merged.length) return null;
        const container = VStack();
        merged.forEach(item => {
          if (item.type === 'browse') {
            const bh = item.data;
            const favicon = _browseFaviconUrl(bh.url);
            let domain = '';
            try { domain = new URL(bh.url).hostname.replace('www.', ''); } catch {}
            const { img, fallback } = _ddFaviconWithFallback(favicon, iconSize);
            const row = _ddRow({
              histq: bh.url, rowStyle, hoverBg,
              children: [
                img, fallback,
                Text(bh.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
                Text(domain).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;')
              ],
              onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); browseNavigate(bh.url); }
            });
            container.add(row);
          } else {
            const t = item.data;
            const time = _relativeTime(t.updated_at * 1000);
            const row = _ddRow({
              histq: 'thread:' + t.id, rowStyle, hoverBg,
              children: [
                _ddSvgIcon(_CHAT_SVG, iconSize),
                RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.title || 'Untitled') + ' <span style="color:var(--nr-text-secondary);">\u2014 Chat</span></span>'),
                Text(time).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;')
              ],
              onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openChatPage === 'function') openChatPage(t.id); }
            });
            container.add(row);
          }
        });
        return container;
      }
      if (!showBrowse.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Recent Sites'));
      showBrowse.forEach(bh => {
        const favicon = _browseFaviconUrl(bh.url);
        let domain = '';
        try { domain = new URL(bh.url).hostname.replace('www.', ''); } catch {}
        const { img, fallback } = _ddFaviconWithFallback(favicon, iconSize);
        const row = _ddRow({
          histq: bh.url, rowStyle, hoverBg,
          children: [
            img, fallback,
            Text(bh.title || domain).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            Text(domain).cssText('font-size:' + trailSize + ';color:var(--nr-text-quaternary);flex-shrink:0;white-space:nowrap;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (!ntp) { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = bh.url; }
            _browseUrlHideHistory();
            browseNavigate(bh.url);
          }
        });
        container.add(row);
      });
      return container;
    },
    suggestions: () => {
      if (!suggestions.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Suggestions'));
      suggestions.forEach(s => {
        const row = _ddRow({
          histq: s, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_SEARCH_SVG, smallIconSize),
            Text(s).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (ntp) { const sq = document.getElementById('search-query'); if (sq) sq.value = s; _browseUrlHideHistory(); submitSearch(); }
            else { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = s; _browseUrlHideHistory(); browseNavigate(s); }
          }
        });
        container.add(row);
      });
      return container;
    },
    projects: () => {
      if (!projects.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Projects'));
      projects.forEach(exp => {
        const updated = exp.lastUpdated ? _relativeTime(exp.lastUpdated) : '';
        const children = [
          _ddSvgIcon(_FLASK_SVG, smallIconSize),
          Text(exp.title).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
        ];
        if (updated) children.push(Text(updated).cssText('font-size:0.68rem;color:var(--nr-text-quaternary);flex-shrink:0;'));
        const row = _ddRow({
          histq: 'project:' + exp.id, rowStyle, hoverBg, children,
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openExperimentDetail === 'function') openExperimentDetail(exp.id); }
        });
        container.add(row);
      });
      return container;
    },
    users: () => {
      if (!filter) return null;
      const unique = [];
      const matched = unique.filter(u => u.toLowerCase().includes(filter)).slice(0, 5);
      if (!matched.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Users'));
      matched.forEach(username => {
        const row = _ddRow({
          histq: 'user:' + username, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_USER_SVG, smallIconSize),
            Text(username).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openUserProfile === 'function') openUserProfile(username); }
        });
        container.add(row);
      });
      return container;
    },
    threads: () => {
      if (!_currentChatThreads.length || !ntp) return null;
      if (!filter) return null; // no-filter threads are mixed into 'recent' section
      const container = VStack();
      _currentChatThreads.forEach(t => {
        const time = _relativeTime(t.updated_at * 1000);
        const row = _ddRow({
          histq: 'thread:' + t.id, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_CHAT_SVG, '16px'),
            RawHTML('<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.title || 'Untitled') + ' <span style="color:var(--nr-text-secondary);">\u2014 Chat</span></span>'),
            Text(time).cssText('font-size:0.75rem;color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) { ev.preventDefault(); _browseUrlHideHistory(); if (typeof openChatPage === 'function') openChatPage(t.id); }
        });
        container.add(row);
      });
      return container;
    },
    notes: () => null,
    history: () => {
      if (!showHist.length) return null;
      const container = VStack();
      if (!ntp) container.add(_ddSectionHeader('Recent Searches'));
      showHist.forEach(sh => {
        const time = _relativeTime(sh.ts);
        const row = _ddRow({
          histq: sh.q, rowStyle, hoverBg,
          children: [
            _ddSvgIcon(_CLOCK_SVG, smallIconSize),
            Text(sh.q).cssText('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            Text(time).cssText('font-size:' + trailSize + ';color:var(--nr-text-quaternary);flex-shrink:0;')
          ],
          onMousedown: function(ev) {
            ev.preventDefault();
            if (ntp) { const sq = document.getElementById('search-query'); if (sq) sq.value = sh.q; _browseUrlHideHistory(); submitSearch(); }
            else { const ui = document.getElementById('browse-url-input'); if (ui) ui.value = sh.q; _browseUrlHideHistory(); browseNavigate(sh.q); }
          }
        });
        container.add(row);
      });
      return container;
    },
  };

  const root = VStack();
  const sections = _getUrlBarSections();
  let hasContent = false;
  for (const sec of sections) {
    if (sec.enabled === false) continue;
    const renderer = _urlBarRenderers[sec.key];
    if (renderer) {
      const view = renderer();
      if (view) { root.add(view); hasContent = true; }
    }
  }

  if (!hasContent) {
    if (isPopup) {
      const tabsEl = window._urlPopupEl ? window._urlPopupEl.querySelector('#pill-url-popup-tabs') : null;
      if (tabsEl) tabsEl.style.display = '';
      dd.innerHTML = '';
      dd.style.display = 'none';
    } else {
      dd.style.display = 'none'; dd.classList.add('hidden');
      if (isIsland && pillWrap) pillWrap.classList.remove('pill-dropdown-open');
    }
    return;
  }

  if (isPopup) {
    // In popup mode: hide tabs when showing suggestions, render into popup dropdown
    const tabsEl = window._urlPopupEl ? window._urlPopupEl.querySelector('#pill-url-popup-tabs') : null;
    if (tabsEl) tabsEl.style.display = filter ? 'none' : '';
    AetherUI.mount(root, dd);
    dd.style.display = '';
  } else {
    AetherUI.mount(root, dd);
    dd.style.display = '';
    dd.classList.remove('hidden');
  }
}

// Resolve quick-open action to a function
function _resolveQuickOpenAction(v) {
  if (v.action === 'history') return function() { const _i = _getOmniInput().input; if (_i) { _i.value = '/history'; } _browseUrlShowHistory(); };
  if (v.action === 'terminal') return function() { _browseUrlHideHistory(); if (typeof toggleBottomTerminal === 'function') toggleBottomTerminal(); };
  if (v.action === 'research') return function() { _browseUrlHideHistory(); if (typeof openResearch === 'function') openResearch(); };
  if (v.action === 'downloads') return function() { _browseUrlHideHistory(); if (typeof toggleBrowseDownloads === 'function') toggleBrowseDownloads(); };
  if (v.action === 'newtab') return function() { _browseUrlHideHistory(); if (typeof browseNewTab === 'function') browseNewTab(); };
  if (v.action === 'pixelpet') return function() { _browseUrlHideHistory(); if (typeof togglePixelPet === 'function') togglePixelPet(true); };
  if (v.action === 'netrunner') return function() { _browseUrlHideHistory(); if (typeof startNetrunner === 'function') startNetrunner(); };
  if (v.action && v.action.startsWith('settings:')) {
    const section = v.action.split(':')[1];
    return function() { _browseUrlHideHistory(); if (typeof wmOpen === 'function') wmOpen('settings'); if (typeof _setSettingsSection === 'function') setTimeout(function() { _setSettingsSection(section); }, 50); };
  }
  if (v.key === 'draw') return function() { _browseUrlHideHistory(); if (typeof openDrawPage === 'function') openDrawPage(); };
  return function() { _browseUrlHideHistory(); if (typeof wmOpen === 'function') wmOpen(v.key); };
}

export function _fetchSearchSuggestions(query) {
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

export function _fetchWordDefinition(word) {
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

// ── Hide/Show scheduling ──

export let _browseUrlHideTimeout = null;

export function _browseUrlScheduleHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = setTimeout(_browseUrlHideHistory, 150);
}

export function _browseUrlCancelHide() {
  clearTimeout(_browseUrlHideTimeout);
  _browseUrlHideTimeout = null;
}

// _islandCenterRestorePageInfo removed — popup mode doesn't use center column for dropdown

export function _browseUrlHideHistory() {
  _browseUrlClearAutocomplete();
  _browseUrlHideTimeout = null;
  const dd = document.getElementById('browse-url-history-dd');
  if (dd) dd.style.display = 'none';
  const ntpDd = document.getElementById('search-history-dropdown-view');
  if (ntpDd) { ntpDd.style.display = 'none'; ntpDd.classList.add('hidden'); }
  const pillWrap = document.getElementById('pill-url-wrap');
  if (pillWrap) pillWrap.classList.remove('pill-dropdown-open');
  // Popup mode: restore tabs, clear dropdown
  if (window._urlPopupEl) {
    const popupDd = window._urlPopupEl.querySelector('#pill-url-popup-dropdown');
    if (popupDd) { popupDd.innerHTML = ''; popupDd.style.display = 'none'; }
    const tabsEl = window._urlPopupEl.querySelector('#pill-url-popup-tabs');
    if (tabsEl) tabsEl.style.display = '';
  }
  _browseUrlHistIdx = -1;
}

// ── Window bindings (set at module load time) ──
window._browseUrlHideHistory = _browseUrlHideHistory;
window._browseUrlShowHistory = _browseUrlShowHistory;
window._getOmniInput = _getOmniInput;

// ── Global mousedown to close dropdown ──
document.addEventListener('mousedown', (e) => {
  const { input, dd, island, popup } = _getOmniInput();
  if (!dd) return;
  // Check visibility: popup mode is handled by its own outside-click handler
  if (popup) {
    if (dd.style.display === 'none' || !dd.innerHTML) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target)) return;
    if (window._urlPopupEl && window._urlPopupEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#pill-url-wrap')) return;
  } else if (island) {
    const pillWrap = document.getElementById('pill-url-wrap');
    if (!pillWrap || !pillWrap.classList.contains('pill-dropdown-open')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target) || (e.target.closest && e.target.closest('#pill-url-wrap'))) return;
  } else {
    if (dd.style.display === 'none' && dd.classList.contains('hidden')) return;
    if ((input && input.contains(e.target)) || dd.contains(e.target)) return;
  }
  _browseUrlHideHistory();
});
