// core-utils.js — Utilities, ratings
// Extracted from core.js

// ── Utilities ──
function formatDate(d) {
  if (!d) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (d.toDateString() === now.toDateString()) return `${diffHrs}h ago`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function decodeHtml(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// Shared KaTeX macros — \mathcal shortcuts (\gA–\gZ) and \mathbb shortcuts (\sA–\sZ)
// from the standard ICLR/NeurIPS math_commands.tex template
const KATEX_MACROS = (() => {
  const m = {};
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const L of letters) {
    m['\\g' + L] = '{\\mathcal{' + L + '}}';
    m['\\s' + L] = '{\\mathbb{' + L + '}}';
  }
  m['\\R'] = '\\mathbb{R}';
  m['\\E'] = '\\mathbb{E}';
  m['\\Ls'] = '\\mathcal{L}';
  m['\\train'] = '\\mathcal{D}';
  m['\\valid'] = '\\mathcal{D_{\\mathrm{valid}}}';
  m['\\test'] = '\\mathcal{D_{\\mathrm{test}}}';
  return m;
})();

function _katexOpts(display) {
  return { displayMode: display, throwOnError: false, macros: KATEX_MACROS };
}

function renderTitle(rawTitle) {
  const decoded = decodeHtml(rawTitle);
  let html = escapeHtml(decoded);
  if (typeof katex !== 'undefined') {
    html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
      try { return katex.renderToString(tex, _katexOpts(true)); } catch { return _; }
    });
    html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
      try { return katex.renderToString(tex, _katexOpts(false)); } catch { return _; }
    });
  }
  return html;
}

// ── Paper ratings (1-5 stars) ──
function getPaperRatings() {
  try { return JSON.parse(localStorage.getItem('paperRatings') || '{}'); } catch { return {}; }
}
function _normalizeRatingKey(link) {
  // Normalize arXiv URLs: strip version, use https, use /abs/ form
  let k = link;
  try {
    const u = new URL(k);
    if (u.hostname.includes('arxiv.org')) {
      u.protocol = 'https:';
      // /abs/1706.03762v7 → /abs/1706.03762
      u.pathname = u.pathname.replace(/(\/abs\/[\d.]+)v\d+$/, '$1');
      // /pdf/... → /abs/...
      u.pathname = u.pathname.replace(/^\/pdf\//, '/abs/');
      k = u.origin + u.pathname;
    }
  } catch (e) { /* fire-and-forget */ }
  return k;
}
function getPaperRating(link) {
  const ratings = getPaperRatings();
  return ratings[_normalizeRatingKey(link)] || ratings[link] || 0;
}
function setPaperRating(link, rating) {
  const r = getPaperRatings();
  const key = _normalizeRatingKey(link);
  // Clean up old non-normalized key if different
  if (key !== link && r[link]) delete r[link];
  if (rating <= 0) delete r[key]; else r[key] = rating;
  localStorage.setItem('paperRatings', JSON.stringify(r));
  if (rating > 0 && !localStorage.getItem('ach_critic')) {
    localStorage.setItem('ach_critic', '1');
    showAchievement('Critic', 'Rated your first paper');
  }
}

function renderStarRating(link, opts) {
  const nLink = _normalizeRatingKey(link);
  const rating = getPaperRating(nLink);
  const size = opts?.size || 'sm';
  const interactive = opts?.interactive !== false;
  const cls = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  let html = `<span class="inline-flex items-center gap-px paper-rating" data-link="${escapeAttr(nLink)}">`;
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating;
    const fill = filled ? 'var(--nr-accent)' : 'none';
    const stroke = filled ? 'var(--nr-accent)' : 'currentColor';
    const opacity = filled ? '' : 'opacity:0.3;';
    const click = interactive ? ` onclick="event.stopPropagation();ratePaper('${escapeAttr(nLink)}',${i})" style="cursor:pointer;${opacity}"` : ` style="${opacity}"`;
    html += `<svg class="${cls}"${click} viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  html += '</span>';
  return html;
}

function ratePaper(link, rating) {
  const current = getPaperRating(link);
  // Click same star again → clear rating
  setPaperRating(link, current === rating ? 0 : rating);
  // Update all visible rating widgets for this paper
  document.querySelectorAll(`.paper-rating[data-link="${CSS.escape(link)}"]`).forEach(el => {
    el.outerHTML = renderStarRating(link, { interactive: el.closest('#browse-bar') || el.closest('#paper-topbar') ? true : true, size: el.closest('#browse-bar') || el.closest('#paper-topbar') ? 'md' : 'sm' });
  });
}

function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function renderLatexInEl(el) {
  if (!el) return;
  if (typeof katex === 'undefined') return;
  function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
  let html = el.innerHTML;
  // Display math: $$ ... $$ and \[ ... \]
  html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(true)); }
    catch (e) { return _; }
  });
  html = html.replace(/\\\[(.+?)\\\]/gs, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(true)); }
    catch (e) { return _; }
  });
  // Inline math: $ ... $ and \( ... \)
  html = html.replace(/\$([^$]+?)\$/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(false)); }
    catch (e) { return _; }
  });
  html = html.replace(/\\\((.+?)\\\)/g, (_, tex) => {
    try { return katex.renderToString(decodeTex(tex), _katexOpts(false)); }
    catch (e) { return _; }
  });
  el.innerHTML = html;
}

function renderLatexIn(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (typeof katex === 'undefined') {
    setTimeout(() => renderLatexIn(elementId), 200);
    return;
  }
  renderLatexInEl(el);
}

// Double-tap Cmd/Ctrl → toggle window overview
let _dblCmdLast = 0;
let _dblCmdArmed = false;
window.addEventListener('keydown', e => {
  if (e.key === 'Meta' || e.key === 'Control') {
    const now = Date.now();
    if (_dblCmdArmed && now - _dblCmdLast < 400) {
      _dblCmdArmed = false;
      _wmToggleTiling();
    } else {
      _dblCmdArmed = true;
      _dblCmdLast = now;
    }
  } else {
    _dblCmdArmed = false;
  }
});

// Close settings on Escape + WM tiling toggle
window.addEventListener('keydown', e => {
  // Cmd+Esc → toggle tiling WM
  if ((e.metaKey || e.ctrlKey) && e.key === 'Escape') {
    e.preventDefault();
    _wmToggleTiling();
    return;
  }
  if (e.key === 'Escape') {
    const sv = document.getElementById('settings-view');
    if (sv && sv.style.display === 'block') goHome();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    // Dismiss aether panel if open
    const _popup = document.getElementById('doc-chat-ask-float');
    if (_popup) { _popup.remove(); _aetherTrackMode = false; if (typeof _aetherShowCursor === 'function') _aetherShowCursor(); }
    const browseView = document.getElementById('browse-view');
    const isOpen = browseView && browseView.style.display !== 'none' && browseView.style.display !== '';
    if (!isOpen && typeof openBrowse === 'function') openBrowse();
    if (typeof browseNewTab === 'function') {
      if (!isOpen) { setTimeout(browseNewTab, 50); }
      else {
        // If current tab is already NTP, just focus the search input
        const win = typeof _getCurrentWindow === 'function' && _getCurrentWindow();
        const active = win && win.tabs && win.tabs.find(t => t.id === win.activeTab);
        if (active && active.blank) {
          const inp = browseView.querySelector('.browse-ntp #search-query');
          if (inp) { inp.focus(); inp.select(); }
        } else {
          browseNewTab();
        }
      }
    }
  }
  // Cmd+P: In Electron, handled via IPC (before-input-event → browse-command 'print').
  // In browser, handle here.
  if (!window.electronAPI && (e.metaKey || e.ctrlKey) && e.key === 'p') {
    e.preventDefault();
    const browseView = document.getElementById('browse-view');
    const browseOpen = browseView && browseView.style.display !== 'none' && browseView.style.display !== '';
    if (browseOpen && typeof _browseActiveTab !== 'undefined' && _browseActiveTab !== null) {
      const tab = typeof _browseTabs !== 'undefined' && _browseTabs.find(t => t.id === _browseActiveTab);
      if (typeof browsePrintPage === 'function') {
        browsePrintPage();
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
    e.preventDefault();
    if (typeof openSearchHistoryPage === 'function') openSearchHistoryPage();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
    const browseView = document.getElementById('browse-view');
    if (browseView && browseView.style.display !== 'none' && browseView.style.display !== '' && typeof _browseActiveTab !== 'undefined' && _browseActiveTab !== null) {
      e.preventDefault();
      browseCloseTab(_browseActiveTab);
    }
  }
});

// ── Sidebar icon visibility & order ──