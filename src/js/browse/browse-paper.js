// browse-paper.js — Academic paper detection, metadata, and reference tooltips
// Depends on: browse-state.js, browse-downloads.js, core-ui.js

// ── Paper site detection ──

const _paperSitePatterns = [
  { host: 'arxiv.org', path: /^\/(abs|pdf|html)\//, idExtract: url => { const m = url.pathname.match(/\/(abs|pdf|html)\/([\d.]+)/); return m ? m[2] : null; } },
  { host: 'openreview.net', path: /^\/(forum|pdf)/ },
  { host: 'proceedings.neurips.cc', path: /\/paper/ },
  { host: 'neurips.cc', path: /\/paper/ },
  { host: 'proceedings.mlr.press', path: /\// },
  { host: 'nature.com', path: /\/articles\// },
  { host: 'science.org', path: /\/doi\// },
  { host: 'aclanthology.org', path: /\/[\w.-]+\/$|\/[\w.-]+$/ },
  { host: 'semanticscholar.org', path: /\/paper\// },
];

function _isPaperUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    for (const p of _paperSitePatterns) {
      if (host === p.host || host.endsWith('.' + p.host)) {
        if (p.path.test(u.pathname)) return p;
      }
    }
  } catch {}
  return null;
}

function _extractArxivId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(abs|pdf|html)\/([\d.]+)/);
    return m ? m[2] : null;
  } catch {}
  return null;
}

// ── Semantic Scholar API ──

const _s2Cache = new Map(); // key → { data, ts }
const _S2_CACHE_TTL = 600000; // 10 minutes
const _S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const _s2RequestQueue = [];
let _s2Processing = false;
const _S2_RATE_DELAY = 350; // ~100 req / 5 min ≈ 1 per 3s, but we use 350ms for bursts

async function _s2Fetch(urlPath) {
  const cacheKey = urlPath;
  const cached = _s2Cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < _S2_CACHE_TTL) return cached.data;

  return new Promise((resolve, reject) => {
    _s2RequestQueue.push({ urlPath, resolve, reject });
    _s2ProcessQueue();
  });
}

async function _s2ProcessQueue() {
  if (_s2Processing || !_s2RequestQueue.length) return;
  _s2Processing = true;
  while (_s2RequestQueue.length) {
    const { urlPath, resolve, reject } = _s2RequestQueue.shift();
    // Check cache again (may have been populated while queued)
    const cached = _s2Cache.get(urlPath);
    if (cached && Date.now() - cached.ts < _S2_CACHE_TTL) {
      resolve(cached.data);
      continue;
    }
    try {
      const resp = await fetch(_S2_BASE + urlPath);
      if (!resp.ok) { resolve(null); continue; }
      const data = await resp.json();
      _s2Cache.set(urlPath, { data, ts: Date.now() });
      resolve(data);
    } catch {
      resolve(null);
    }
    if (_s2RequestQueue.length) await new Promise(r => setTimeout(r, _S2_RATE_DELAY));
  }
  _s2Processing = false;
}

async function _s2LookupByArxivId(arxivId) {
  const fields = 'title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
  return _s2Fetch('/paper/ARXIV:' + arxivId + '?fields=' + fields);
}

async function _s2SearchPaper(title) {
  const q = encodeURIComponent(title.slice(0, 200));
  const fields = 'title,authors,citationCount,year,venue';
  const data = await _s2Fetch('/paper/search?query=' + q + '&limit=1&fields=' + fields);
  return data && data.data && data.data[0] ? data.data[0] : null;
}

async function _s2GetAuthor(authorId) {
  return _s2Fetch('/author/' + authorId + '?fields=name,citationCount,hIndex');
}

// ── Per-tab paper state ──

const _paperState = new Map(); // tabId → { url, meta, refs, s2Data, authorDetails }

function _getPaperState(tabId) {
  return _paperState.get(tabId) || null;
}

// ── Content script injection ──

function _paperInjectContentScript(frame, url) {
  const pattern = _isPaperUrl(url);
  if (!pattern) return;

  const script = `(function() {
    if (window.__aetherPaperInjected) return;
    window.__aetherPaperInjected = true;

    // ── Extract metadata ──
    function extractMeta() {
      var meta = { title: '', authors: [], site: '' };
      var host = location.hostname.replace(/^www\\./, '');

      // Title extraction
      var metaTitle = document.querySelector('meta[name="citation_title"]');
      if (metaTitle) meta.title = metaTitle.content || '';
      if (!meta.title) {
        var h1 = document.querySelector('h1.title, h1');
        if (h1) meta.title = h1.textContent.replace(/^\\s*Title:\\s*/i, '').trim();
      }

      // Author extraction
      var metaAuthors = document.querySelectorAll('meta[name="citation_author"]');
      if (metaAuthors.length) {
        for (var i = 0; i < metaAuthors.length; i++) {
          if (metaAuthors[i].content) meta.authors.push(metaAuthors[i].content.trim());
        }
      }
      if (!meta.authors.length) {
        var metaAuthorsOg = document.querySelectorAll('meta[property="article:author"]');
        for (var i = 0; i < metaAuthorsOg.length; i++) {
          if (metaAuthorsOg[i].content) meta.authors.push(metaAuthorsOg[i].content.trim());
        }
      }
      // Site-specific author selectors
      if (!meta.authors.length && (host === 'arxiv.org' || host.endsWith('.arxiv.org'))) {
        var authorEls = document.querySelectorAll('.authors a, .ltx_authors .ltx_personname');
        for (var i = 0; i < authorEls.length; i++) {
          var n = authorEls[i].textContent.trim();
          if (n && n !== ',') meta.authors.push(n);
        }
      }
      if (!meta.authors.length && host === 'openreview.net') {
        var authorEls = document.querySelectorAll('.note-authors a');
        for (var i = 0; i < authorEls.length; i++) meta.authors.push(authorEls[i].textContent.trim());
      }
      if (!meta.authors.length && host.endsWith('nature.com')) {
        var authorEls = document.querySelectorAll('[data-test="author-name"]');
        for (var i = 0; i < authorEls.length; i++) meta.authors.push(authorEls[i].textContent.trim());
      }

      meta.site = host;
      return meta;
    }

    // ── Extract references from bottom of page ──
    function extractRefs() {
      var refs = {};
      var host = location.hostname.replace(/^www\\./, '');

      // Try common reference section selectors
      var refSection = document.querySelector('#references, .references, .ltx_bibliography, [role="doc-bibliography"], .citation-list');
      if (!refSection) return refs;

      var items = refSection.querySelectorAll('li, .reference-cit, .ltx_bibitem, .citation');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        // Try to get ref number
        var num = null;
        var label = item.querySelector('.ltx_tag_bibitem, .label, .cit-count-label');
        if (label) {
          var m = label.textContent.match(/(\\d+)/);
          if (m) num = parseInt(m[1]);
        }
        if (num === null) {
          var id = item.id || item.getAttribute('data-id') || '';
          var m = id.match(/(\\d+)/);
          if (m) num = parseInt(m[1]);
        }
        if (num === null) num = i + 1;

        // Extract text content (title, authors, year)
        var text = item.textContent.trim();
        // Try to extract title from structured elements
        var titleEl = item.querySelector('.ltx_bib_title, .ref-title, .cit-title, i, em');
        var title = titleEl ? titleEl.textContent.trim() : '';
        refs[num] = { num: num, text: text.slice(0, 300), title: title };
      }
      return refs;
    }

    // ── Wrap reference markers [N] with hover handlers ──
    function wrapRefMarkers(refs) {
      // Walk text nodes in the main content area (not the references section itself)
      var refSection = document.querySelector('#references, .references, .ltx_bibliography, [role="doc-bibliography"], .citation-list');
      var contentArea = document.querySelector('article, .ltx_document, .main-content, .paper-content, #content, main') || document.body;
      var walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null, false);
      var nodesToProcess = [];
      var node;
      while (node = walker.nextNode()) {
        if (refSection && refSection.contains(node)) continue;
        if (/\\[\\d+\\]/.test(node.textContent)) {
          nodesToProcess.push(node);
        }
      }

      for (var ni = 0; ni < nodesToProcess.length; ni++) {
        var textNode = nodesToProcess[ni];
        var parent = textNode.parentNode;
        if (!parent || parent.classList && parent.classList.contains('aether-ref-marker')) continue;
        var html = textNode.textContent.replace(/\\[(\\d+)\\]/g, function(match, num) {
          return '<span class="aether-ref-marker" data-ref-num="' + num + '">' + match + '</span>';
        });
        if (html !== textNode.textContent) {
          var span = document.createElement('span');
          span.innerHTML = html;
          parent.replaceChild(span, textNode);
        }
      }

      // Add hover listeners
      document.querySelectorAll('.aether-ref-marker').forEach(function(el) {
        el.style.cursor = 'pointer';
        el.style.borderBottom = '1px dotted rgba(128,128,128,0.4)';
        el.addEventListener('mouseenter', function(e) {
          var num = parseInt(el.getAttribute('data-ref-num'));
          var ref = refs[num] || { num: num, text: '', title: '' };
          var rect = el.getBoundingClientRect();
          console.log('__AETHER_REF_HOVER__' + JSON.stringify({
            refNum: num,
            x: rect.left + rect.width / 2,
            y: rect.top,
            title: ref.title || '',
            text: ref.text || ''
          }));
        });
        el.addEventListener('mouseleave', function() {
          console.log('__AETHER_REF_LEAVE__');
        });
      });
    }

    // Run extraction after a short delay (SPA pages may still be loading)
    setTimeout(function() {
      var meta = extractMeta();
      var refs = extractRefs();
      console.log('__AETHER_PAPER_META__' + JSON.stringify({ meta: meta, refCount: Object.keys(refs).length }));
      wrapRefMarkers(refs);
    }, 1500);
  })();`;

  try {
    frame.executeJavaScript(script);
  } catch {}
}

// ── Handle paper metadata from content script ──

async function _paperHandleMeta(tab, data) {
  if (!data || !data.meta) return;
  const tabId = tab.id;
  const url = tab.url || '';
  const meta = data.meta;

  const state = { url, meta, refs: null, s2Data: null, authorDetails: [] };
  _paperState.set(tabId, state);

  // Show loading state in insight pill
  _paperUpdateInsightPill(tab, state, true);

  // Lookup via Semantic Scholar
  let s2Data = null;
  const arxivId = _extractArxivId(url);
  if (arxivId) {
    s2Data = await _s2LookupByArxivId(arxivId);
  }
  if (!s2Data && meta.title) {
    s2Data = await _s2SearchPaper(meta.title);
  }

  if (!s2Data) {
    // No S2 data — still show basic metadata
    _paperUpdateInsightPill(tab, state, false);
    return;
  }

  state.s2Data = s2Data;
  // Store refs from S2 if we got them
  if (s2Data.references) {
    state.refs = s2Data.references;
  }

  // Fetch top 3 author details (h-index)
  const authors = (s2Data.authors || []).slice(0, 3);
  const authorPromises = authors
    .filter(a => a.authorId)
    .map(a => _s2GetAuthor(a.authorId));
  const authorResults = await Promise.all(authorPromises);
  state.authorDetails = authorResults.filter(Boolean);

  _paperState.set(tabId, state);
  _paperUpdateInsightPill(tab, state, false);
}

// ── Update insight pill with paper metadata ──

function _paperUpdateInsightPill(tab, state, loading) {
  if (tab.id !== _browseActiveTab) return;

  const s2 = state.s2Data;
  const citationCount = s2 ? s2.citationCount : null;
  const label = loading ? 'Loading paper\u2026'
    : citationCount != null ? (citationCount + ' citation' + (citationCount !== 1 ? 's' : ''))
    : 'Paper';

  islandUpdate('insight', {
    type: 'insight',
    label: label,
    loading: loading,
    done: !loading,
    _paper: true,
    _paperState: state,
    modeType: 'PAPER',
  });
}

// ── Reference tooltip ──

let _refTooltipEl = null;
let _refTooltipHideTimer = null;

function _paperShowRefTooltip(data, frame) {
  if (_refTooltipHideTimer) { clearTimeout(_refTooltipHideTimer); _refTooltipHideTimer = null; }
  if (!_refTooltipEl) {
    _refTooltipEl = document.createElement('div');
    _refTooltipEl.id = 'aether-ref-tooltip';
    _refTooltipEl.className = 'nr-ref-tooltip';
    document.body.appendChild(_refTooltipEl);
  }

  const tip = _refTooltipEl;
  const refNum = data.refNum;

  // Build initial content from content script data
  let html = '<div class="nr-ref-tooltip-num">[' + refNum + ']</div>';
  if (data.title) {
    html += '<div class="nr-ref-tooltip-title">' + escapeHtml(data.title) + '</div>';
  } else if (data.text) {
    html += '<div class="nr-ref-tooltip-text">' + escapeHtml(data.text.slice(0, 200)) + '</div>';
  }
  html += '<div class="nr-ref-tooltip-loading">Looking up\u2026</div>';
  tip.innerHTML = html;
  tip.style.display = 'block';

  // Position relative to the webview frame
  const fRect = frame.getBoundingClientRect();
  const cx = data.x + fRect.left;
  const cy = data.y + fRect.top;
  const tipW = tip.offsetWidth || 300;
  const tipH = tip.offsetHeight || 80;
  const left = Math.min(Math.max(cx - tipW / 2, 8), window.innerWidth - tipW - 8);
  let top = cy - tipH - 10;
  if (top < 4) top = cy + 24;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';

  // Lookup from S2 cache or fetch
  _paperLookupRef(data, frame);
}

async function _paperLookupRef(data, frame) {
  if (!data.title) return;
  const result = await _s2SearchPaper(data.title);
  if (!_refTooltipEl || _refTooltipEl.style.display === 'none') return;

  // Update tooltip with S2 data
  const loading = _refTooltipEl.querySelector('.nr-ref-tooltip-loading');
  if (loading) loading.remove();

  if (result) {
    let extra = '';
    const authors = (result.authors || []).slice(0, 3).map(a => a.name);
    if (result.authors && result.authors.length > 3) authors.push('et al.');
    if (authors.length) extra += '<div class="nr-ref-tooltip-authors">' + escapeHtml(authors.join(', ')) + '</div>';
    const details = [];
    if (result.year) details.push(result.year);
    if (result.venue) details.push(result.venue);
    if (result.citationCount != null) details.push(result.citationCount + ' citations');
    if (details.length) extra += '<div class="nr-ref-tooltip-details">' + escapeHtml(details.join(' \u00b7 ')) + '</div>';

    // Insert after title
    const titleEl = _refTooltipEl.querySelector('.nr-ref-tooltip-title, .nr-ref-tooltip-text');
    if (titleEl) {
      titleEl.insertAdjacentHTML('afterend', extra);
    } else {
      _refTooltipEl.insertAdjacentHTML('beforeend', extra);
    }

    // Re-position after content change
    const fRect = frame.getBoundingClientRect();
    const cy = data.y + fRect.top;
    const tipH = _refTooltipEl.offsetHeight;
    let top = cy - tipH - 10;
    if (top < 4) top = cy + 24;
    _refTooltipEl.style.top = top + 'px';
  }
}

function _paperHideRefTooltip() {
  if (_refTooltipHideTimer) clearTimeout(_refTooltipHideTimer);
  _refTooltipHideTimer = setTimeout(() => {
    if (_refTooltipEl) _refTooltipEl.style.display = 'none';
  }, 150);
}

// ── Cleanup on tab close / navigation ──

function _paperCleanup(tabId) {
  _paperState.delete(tabId);
}

// ── Hook into page load ──

function _paperOnPageLoad(tab, frame) {
  const url = tab.url || '';
  if (!_isPaperUrl(url)) {
    _paperCleanup(tab.id);
    return;
  }
  _paperInjectContentScript(frame, url);
}
