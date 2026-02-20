// browse-pageinfo.js — Page info state provider for unified AI pill
// Consolidates page metadata (publish date, author, word count, scroll %, token count)
import { icon } from '/js/core/icons.js';

// ── Cache ──
const _pageInfoCache = new Map(); // url -> { data, ts }
const _CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Live state (not cached — updates in real time) ──
let _scrollPct = -1;
let _tokenCount = 0;

// ── Relative date formatting ──
function _relativeAge(dateStr) {
  if (!dateStr) return null;
  let d;
  try { d = new Date(dateStr); } catch { return null; }
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return null; // future date
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return diffDay + 'd ago';
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return diffMo + 'mo ago';
  // Older than a year — show abbreviated month + year
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

function _readingTime(wordCount) {
  if (!wordCount || wordCount < 1) return null;
  const mins = Math.max(1, Math.round(wordCount / 238));
  return mins + ' min read';
}

function _formatTokens(count) {
  if (!count || count <= 0) return '';
  return count >= 1000 ? Math.round(count / 1000) + 'k tok' : count + ' tok';
}

// ── Build pill label ──
function _buildLabel(meta) {
  // Primary: relative age from publish date
  if (meta && meta.published) {
    const age = _relativeAge(meta.published);
    if (age) return age;
  }
  // Fallback: reading time from word count
  if (meta && meta.wordCount) {
    const rt = _readingTime(meta.wordCount);
    if (rt) return rt;
  }
  return null;
}

// ── Build secondary badges (scroll + tokens) ──
function _buildBadges() {
  const parts = [];
  if (_scrollPct > 0) parts.push(_scrollPct + '%');
  if (_tokenCount > 0) parts.push(_formatTokens(_tokenCount));
  return parts.join(' · ');
}

// ── Module-level state for unified pill ──
let _currentLabel = '';
let _currentBadges = '';
let _currentMeta = null;

export function _getPageInfoState() {
  return { label: _currentLabel, badges: _currentBadges, meta: _currentMeta };
}
window._getPageInfoState = _getPageInfoState;

// ── Push update to unified pill ──
function _pushPill(meta) {
  const label = _buildLabel(meta);
  const badges = _buildBadges();
  _currentLabel = label || '';
  _currentBadges = badges;
  _currentMeta = meta || null;
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
}

// ── Content script (runs inside webview) ──
const _EXTRACT_SCRIPT = `(function(){
  try {
    var meta = {};
    // Publish date
    var pubMeta = document.querySelector('meta[property="article:published_time"]');
    if (pubMeta) meta.published = pubMeta.content;
    if (!meta.published) { var dm = document.querySelector('meta[name="date"]'); if (dm) meta.published = dm.content; }
    if (!meta.published) { var dc = document.querySelector('meta[name="DC.date.issued"]'); if (dc) meta.published = dc.content; }
    if (!meta.published) { var te = document.querySelector('time[datetime]'); if (te) meta.published = te.getAttribute('datetime'); }
    if (!meta.published) {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var j = JSON.parse(scripts[i].textContent);
          var items = Array.isArray(j) ? j : [j];
          for (var k = 0; k < items.length; k++) {
            if (items[k].datePublished) { meta.published = items[k].datePublished; break; }
            if (items[k]['@graph']) {
              for (var g = 0; g < items[k]['@graph'].length; g++) {
                if (items[k]['@graph'][g].datePublished) { meta.published = items[k]['@graph'][g].datePublished; break; }
              }
            }
          }
          if (meta.published) break;
        } catch(e) {}
      }
    }
    // Modified date
    var modMeta = document.querySelector('meta[property="article:modified_time"]');
    if (modMeta) meta.modified = modMeta.content;
    if (!meta.modified) {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var j = JSON.parse(scripts[i].textContent);
          var items = Array.isArray(j) ? j : [j];
          for (var k = 0; k < items.length; k++) {
            if (items[k].dateModified) { meta.modified = items[k].dateModified; break; }
            if (items[k]['@graph']) {
              for (var g = 0; g < items[k]['@graph'].length; g++) {
                if (items[k]['@graph'][g].dateModified) { meta.modified = items[k]['@graph'][g].dateModified; break; }
              }
            }
          }
          if (meta.modified) break;
        } catch(e) {}
      }
    }
    if (!meta.modified) {
      var docMod = document.lastModified;
      if (docMod) {
        var d = new Date(docMod);
        if (!isNaN(d.getTime()) && (Date.now() - d.getTime()) > 60000) meta.modified = docMod;
      }
    }
    // Author
    var authorMeta = document.querySelector('meta[name="author"]');
    if (authorMeta) meta.author = authorMeta.content;
    if (!meta.author) { var am = document.querySelector('meta[property="article:author"]'); if (am) meta.author = am.content; }
    if (!meta.author) {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        try {
          var j = JSON.parse(scripts[i].textContent);
          var items = Array.isArray(j) ? j : [j];
          for (var k = 0; k < items.length; k++) {
            var a = items[k].author;
            if (a) { meta.author = typeof a === 'string' ? a : (a.name || (Array.isArray(a) && a[0] && a[0].name) || ''); break; }
          }
          if (meta.author) break;
        } catch(e) {}
      }
    }
    // Description
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) meta.description = ogDesc.content;
    if (!meta.description) { var dm = document.querySelector('meta[name="description"]'); if (dm) meta.description = dm.content; }
    // Type
    var ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) meta.type = ogType.content;
    // Word count
    var text = document.body ? document.body.innerText.trim() : '';
    meta.wordCount = text ? text.split(/\\s+/).length : 0;
    return meta;
  } catch(e) { return {}; }
})()`;

// ── Public API ──

export function _pageInfoOnPageLoad(tab, frame) {
  if (!tab || !frame) return;
  const url = tab.url || '';
  // Skip blank/internal pages
  if (!url || url === 'about:blank' || url.startsWith('netrun://')) {
    _pageInfoCleanup();
    return;
  }
  // Check cache
  const cached = _pageInfoCache.get(url);
  if (cached && (Date.now() - cached.ts) < _CACHE_TTL) {
    _pushPill(cached.data);
    return;
  }
  // Inject content script to extract metadata
  try {
    frame.executeJavaScript(_EXTRACT_SCRIPT).then(function(meta) {
      if (!meta) meta = {};
      _pageInfoCache.set(url, { data: meta, ts: Date.now() });
      // Only push if this tab is still the active one
      const win = window._getCurrentWindow ? window._getCurrentWindow() : null;
      if (win && win.activeTab === tab.id) {
        _pushPill(meta);
      }
    }).catch(function() {
      // Still show pill with scroll/token data even if metadata extraction fails
      _pushPill(null);
    });
  } catch(e) {
    _pushPill(null);
  }
}

export function _pageInfoRestoreForTab(tab) {
  if (!tab) return;
  const url = tab.url || '';
  if (!url || url === 'about:blank' || url.startsWith('netrun://')) {
    _pageInfoCleanup();
    return;
  }
  // Reset live state (will be re-populated by scroll/token messages)
  _scrollPct = -1;
  _tokenCount = 0;
  const cached = _pageInfoCache.get(url);
  if (cached && (Date.now() - cached.ts) < _CACHE_TTL) {
    _pushPill(cached.data);
  } else {
    // No cache — show minimal pill (will populate on scroll/token messages)
    _pushPill(null);
  }
}

export function _pageInfoCleanup() {
  _scrollPct = -1;
  _tokenCount = 0;
  _currentLabel = '';
  _currentBadges = '';
  _currentMeta = null;
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
}

export function _pageInfoUpdateScroll(pct) {
  _scrollPct = pct;
  // Get current metadata from cache for the active tab
  const meta = _getCurrentMeta();
  _pushPill(meta);
}

export function _pageInfoUpdateTokens(count) {
  _tokenCount = count;
  const meta = _getCurrentMeta();
  _pushPill(meta);
}

function _getCurrentMeta() {
  const win = window._getCurrentWindow ? window._getCurrentWindow() : null;
  if (!win) return null;
  const tab = win.tabs ? win.tabs.find(function(t) { return t.id === win.activeTab; }) : null;
  if (!tab || !tab.url) return null;
  const cached = _pageInfoCache.get(tab.url);
  return (cached && (Date.now() - cached.ts) < _CACHE_TTL) ? cached.data : null;
}
