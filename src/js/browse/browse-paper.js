// browse-paper.js — Academic paper detection, metadata, and reference tooltips
// Depends on: browse-state.js, browse-downloads.js, core-ui.js
import { escapeHtml } from '/js/core/core-utils.js';
import { islandUpdate } from '/js/core/core-ui.js';

// ── Paper site detection ──

export const _paperSitePatterns = [
  { host: 'arxiv.org', path: /^\/(abs|pdf|html)\// },
  { host: 'openreview.net', path: /^\/(forum|pdf)/ },
  { host: 'proceedings.neurips.cc', path: /\/paper/ },
  { host: 'neurips.cc', path: /\/paper/ },
  { host: 'proceedings.mlr.press', path: /\// },
  { host: 'nature.com', path: /\/articles\// },
  { host: 'science.org', path: /\/doi\// },
  { host: 'aclanthology.org', path: /\/[\w.-]+\/$|\/[\w.-]+$/ },
  { host: 'semanticscholar.org', path: /\/paper\// },
];

export function _isPaperUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    for (const p of _paperSitePatterns) {
      if (host === p.host || host.endsWith('.' + p.host)) {
        if (p.path.test(u.pathname)) return true;
      }
    }
  } catch {}
  return false;
}

export function _extractArxivId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(abs|pdf|html)\/([\d.]+)/);
    return m ? m[2] : null;
  } catch {}
  return null;
}

// ── Semantic Scholar API ──

export const _s2Cache = new Map(); // key → { data, ts }
export const _S2_CACHE_TTL = 600000; // 10 minutes
export const _S2_BASE = 'https://api.semanticscholar.org/graph/v1';
export const _s2RequestQueue = [];
export let _s2Processing = false;
export const _S2_RATE_DELAY = 350;

export async function _s2Fetch(urlPath) {
  const cached = _s2Cache.get(urlPath);
  if (cached && Date.now() - cached.ts < _S2_CACHE_TTL) return cached.data;

  return new Promise((resolve) => {
    _s2RequestQueue.push({ urlPath, resolve });
    _s2ProcessQueue();
  });
}

export async function _s2ProcessQueue() {
  if (_s2Processing || !_s2RequestQueue.length) return;
  _s2Processing = true;
  while (_s2RequestQueue.length) {
    const { urlPath, resolve } = _s2RequestQueue.shift();
    const cached = _s2Cache.get(urlPath);
    if (cached && Date.now() - cached.ts < _S2_CACHE_TTL) {
      resolve(cached.data);
      continue;
    }
    try {
      let data = null;
      if (window.electronAPI && window.electronAPI.dbQuery) {
        data = await window.electronAPI.dbQuery('s2-proxy', urlPath);
      } else {
        const resp = await fetch(_S2_BASE + urlPath);
        if (resp.ok) data = await resp.json();
      }
      _s2Cache.set(urlPath, { data, ts: Date.now() });
      resolve(data);
    } catch {
      resolve(null);
    }
    if (_s2RequestQueue.length) await new Promise(r => setTimeout(r, _S2_RATE_DELAY));
  }
  _s2Processing = false;
}

export async function _s2LookupByArxivId(arxivId) {
  const fields = 'title,authors,citationCount,year,venue,references.title,references.authors,references.year,references.venue,references.citationCount';
  return _s2Fetch('/paper/ARXIV:' + arxivId + '?fields=' + fields);
}

export async function _s2SearchPaper(title) {
  const q = encodeURIComponent(title.slice(0, 200));
  const fields = 'title,authors,citationCount,year,venue';
  const data = await _s2Fetch('/paper/search?query=' + q + '&limit=1&fields=' + fields);
  return data && data.data && data.data[0] ? data.data[0] : null;
}

export async function _s2GetAuthor(authorId) {
  return _s2Fetch('/author/' + authorId + '?fields=name,citationCount,hIndex');
}

export async function _s2GetRecommendations(paperId) {
  return _s2Fetch('https://api.semanticscholar.org/recommendations/v1/papers/forpaper/' + paperId + '?limit=10&fields=title,authors,year,citationCount,venue');
}

export async function _s2GetCitations(paperId) {
  return _s2Fetch('/paper/' + paperId + '/citations?limit=20&fields=title,authors,year,citationCount,venue');
}

export async function _s2GetAuthorFull(authorId) {
  return _s2Fetch('/author/' + authorId + '?fields=name,citationCount,hIndex,paperCount,affiliations');
}

// ── Per-tab paper state ──

export const _paperState = new Map(); // tabId → { url, meta, refs, s2Data, authorDetails }

export function _getPaperState(tabId) {
  return _paperState.get(tabId) || null;
}

// ── Content script injection ──

export function _paperInjectContentScript(frame, url) {
  if (!_isPaperUrl(url)) return;

  const script = `(function() {
    if (window.__aetherPaperInjected) return;
    window.__aetherPaperInjected = true;

    function extractMeta() {
      var meta = { title: '', authors: [], site: '' };
      var host = location.hostname.replace(/^www\\./, '');

      var metaTitle = document.querySelector('meta[name="citation_title"]');
      if (metaTitle) meta.title = metaTitle.content || '';
      if (!meta.title) {
        var h1 = document.querySelector('h1.title, h1');
        if (h1) meta.title = h1.textContent.replace(/^\\s*Title:\\s*/i, '').trim();
      }

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

    function extractRefs() {
      var refs = {};
      var refSection = document.querySelector('#references, .references, .ltx_bibliography, [role="doc-bibliography"], .citation-list');
      if (!refSection) return refs;

      var items = refSection.querySelectorAll('li, .reference-cit, .ltx_bibitem, .citation');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
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

        var text = item.textContent.trim();
        var titleEl = item.querySelector('.ltx_bib_title, .ref-title, .cit-title, i, em');
        var title = titleEl ? titleEl.textContent.trim() : '';
        refs[num] = { num: num, text: text.slice(0, 300), title: title };
      }
      return refs;
    }

    function wrapRefMarkers(refs) {
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

      document.querySelectorAll('.aether-ref-marker').forEach(function(el) {
        el.style.cursor = 'pointer';
        el.style.borderBottom = '1px dotted rgba(128,128,128,0.4)';
        el.addEventListener('mouseenter', function() {
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
// Stores state and merges paper data into the existing insight pill.

export async function _paperHandleMeta(tab, data) {
  if (!data || !data.meta) return;
  const tabId = tab.id;
  const url = tab.url || '';
  const meta = data.meta;

  const state = { url, meta, refs: null, s2Data: null, authorDetails: [] };
  _paperState.set(tabId, state);

  // Merge paper flag into the existing insight pill (don't replace it)
  _paperMergeIntoPill(tabId, state);

  // Lookup via Semantic Scholar
  let s2Data = null;
  const arxivId = _extractArxivId(url);
  if (arxivId) {
    s2Data = await _s2LookupByArxivId(arxivId);
  }
  if (!s2Data && meta.title) {
    s2Data = await _s2SearchPaper(meta.title);
  }

  state.s2Data = s2Data || null;
  if (s2Data && s2Data.references) {
    state.refs = s2Data.references;
  }

  // Fetch top 3 author details (h-index)
  if (s2Data) {
    const authors = (s2Data.authors || []).slice(0, 3);
    const authorPromises = authors
      .filter(a => a.authorId)
      .map(a => _s2GetAuthor(a.authorId));
    const authorResults = await Promise.all(authorPromises);
    state.authorDetails = authorResults.filter(Boolean);
  }

  _paperState.set(tabId, state);
  _paperMergeIntoPill(tabId, state);
}

// Merge paper data into the current insight pill without replacing it.
// Uses islandUpdate which Object.assign-merges, so existing annotation
// data (items, insight, label, etc.) is preserved.
export function _paperMergeIntoPill(tabId, state) {
  if (typeof _browseActiveTab !== 'undefined' && tabId !== _browseActiveTab) return;
  if (typeof islandUpdate !== 'function') return;

  islandUpdate('insight', {
    _paper: true,
    _paperState: state,
  });
}

// ── Reference tooltip ──

export let _refTooltipEl = null;
export let _refTooltipHideTimer = null;

// Reactive state driving the tooltip's content
let _refTooltipAuthors = null;  // State() — author string or null
let _refTooltipDetails = null;  // State() — details string or null
let _refTooltipLoading = null;  // State() — boolean

function _ensureRefTooltip() {
  if (_refTooltipEl) return;

  _refTooltipAuthors = window.State(null);
  _refTooltipDetails = window.State(null);
  _refTooltipLoading = window.State(false);

  const numText = window.State('');
  const titleText = window.State('');
  const bodyText = window.State('');

  _refTooltipEl = { numText, titleText, bodyText };

  const numView = new window.View('div').className('nr-ref-tooltip-num').text(numText);
  const titleView = window.Show(
    window.Computed(() => !!titleText.value),
    () => new window.View('div').className('nr-ref-tooltip-title').text(titleText)
  );
  const bodyView = window.Show(
    window.Computed(() => !titleText.value && !!bodyText.value),
    () => new window.View('div').className('nr-ref-tooltip-text').text(bodyText)
  );
  const authorsView = window.Show(
    window.Computed(() => !!_refTooltipAuthors.value),
    () => new window.View('div').className('nr-ref-tooltip-authors').text(_refTooltipAuthors)
  );
  const detailsView = window.Show(
    window.Computed(() => !!_refTooltipDetails.value),
    () => new window.View('div').className('nr-ref-tooltip-details').text(_refTooltipDetails)
  );
  const loadingView = window.Show(
    _refTooltipLoading,
    () => new window.View('div').className('nr-ref-tooltip-loading').text('Looking up\u2026')
  );

  const tooltipView = new window.View('div')
    .attr('id', 'aether-ref-tooltip')
    .className('nr-ref-tooltip')
    .add(
      window.VStack([numView, titleView, bodyView, authorsView, detailsView, loadingView])
    );

  _refTooltipEl._el = tooltipView.el;
  _refTooltipEl._el.style.display = 'none';
  _refTooltipEl.numText = numText;
  _refTooltipEl.titleText = titleText;
  _refTooltipEl.bodyText = bodyText;
  document.body.appendChild(_refTooltipEl._el);
}

export function _paperShowRefTooltip(data, frame) {
  if (_refTooltipHideTimer) { clearTimeout(_refTooltipHideTimer); _refTooltipHideTimer = null; }
  _ensureRefTooltip();

  const tip = _refTooltipEl._el;
  window.batch(() => {
    _refTooltipEl.numText.value = '[' + data.refNum + ']';
    _refTooltipEl.titleText.value = data.title ? escapeHtml(data.title) : '';
    _refTooltipEl.bodyText.value = (!data.title && data.text) ? escapeHtml(data.text.slice(0, 200)) : '';
    _refTooltipAuthors.value = null;
    _refTooltipDetails.value = null;
    _refTooltipLoading.value = true;
  });
  tip.style.display = 'block';

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

  _paperLookupRef(data, frame);
}

export async function _paperLookupRef(data, frame) {
  if (!data.title) {
    if (_refTooltipLoading) _refTooltipLoading.value = false;
    return;
  }
  const result = await _s2SearchPaper(data.title);
  if (!_refTooltipEl || _refTooltipEl._el.style.display === 'none') return;

  const authors = result ? (result.authors || []).slice(0, 3).map(a => a.name) : [];
  if (result && result.authors && result.authors.length > 3) authors.push('et al.');

  const details = [];
  if (result) {
    if (result.year) details.push(result.year);
    if (result.venue) details.push(result.venue);
    if (result.citationCount != null) details.push(result.citationCount + ' citations');
  }

  window.batch(() => {
    _refTooltipLoading.value = false;
    _refTooltipAuthors.value = authors.length ? escapeHtml(authors.join(', ')) : null;
    _refTooltipDetails.value = details.length ? escapeHtml(details.join(' \u00b7 ')) : null;
  });

  const fRect = frame.getBoundingClientRect();
  const cy = data.y + fRect.top;
  const tipH = _refTooltipEl._el.offsetHeight;
  let top = cy - tipH - 10;
  if (top < 4) top = cy + 24;
  _refTooltipEl._el.style.top = top + 'px';
}

export function _paperHideRefTooltip() {
  if (_refTooltipHideTimer) clearTimeout(_refTooltipHideTimer);
  _refTooltipHideTimer = setTimeout(() => {
    if (_refTooltipEl) _refTooltipEl._el.style.display = 'none';
  }, 150);
}

// ── Cleanup on tab close / navigation ──

export function _paperCleanup(tabId) {
  _paperState.delete(tabId);
}

// ── Hook into page load ──

export function _paperOnPageLoad(tab, frame) {
  const url = tab.url || '';
  if (!_isPaperUrl(url)) {
    _paperCleanup(tab.id);
    return;
  }
  _paperInjectContentScript(frame, url);
}

