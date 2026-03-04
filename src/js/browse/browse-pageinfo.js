// browse-pageinfo.js — Page info state provider for unified AI pill
// Consolidates page metadata (publish date, author, word count, scroll %, token count)
import { icon } from '/js/core/icons.js';

// ── Cache ──
const _pageInfoCache = new Map(); // url -> { data, ts }
const _CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Live state (not cached — updates in real time) ──
let _scrollPct = -1;
let _tokenCount = 0;

// ── Display mode: 'reading-time' (first 10s), 'scroll' (while scrolling), 'idle' (icon only) ──
let _displayMode = 'idle';
let _readingTimeTimer = null;
let _scrollIdleTimer = null;

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

// ── Build pill label based on display mode ──
function _buildLabel(meta) {
  if (_displayMode === 'scroll' && _scrollPct > 0) {
    return _scrollPct + '%';
  }
  if (_displayMode === 'reading-time' && meta && meta.wordCount) {
    const rt = _readingTime(meta.wordCount);
    if (rt) return rt;
  }
  // idle mode — no label, just icon
  return null;
}

// ── Build secondary badges ──
function _buildBadges() {
  return '';
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
  // Push into island activities so toolbar-activities._getPageInfoState() can find it
  if (typeof window._setIslandActivity === 'function') {
    if (label || badges || (meta && Object.keys(meta).length)) {
      window._setIslandActivity('pageinfo', { type: 'pageinfo', label: label || '', badges: badges, meta: meta || {} });
    } else {
      if (typeof window._clearIslandActivity === 'function') window._clearIslandActivity('pageinfo');
    }
  }
  if (typeof window._islandRender === 'function') window._islandRender();
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
  // Start reading-time display for 10 seconds
  _startReadingTimeMode();
  // Check cache
  const cached = _pageInfoCache.get(url);
  if (cached && (Date.now() - cached.ts) < _CACHE_TTL) {
    _pushPill(cached.data);
    return;
  }
  // Inject content script to extract metadata + fetch IP geolocation
  try {
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch(e) {}
    const metaPromise = frame.executeJavaScript(_EXTRACT_SCRIPT).catch(function() { return {}; });
    const geoPromise = (hostname && window.electronAPI && window.electronAPI.ipGeo)
      ? window.electronAPI.ipGeo(hostname).catch(function() { return null; })
      : Promise.resolve(null);
    Promise.all([metaPromise, geoPromise]).then(function(results) {
      const meta = results[0] || {};
      const geo = results[1];
      if (geo && !geo.error) {
        meta.ip = geo.ip;
        const locParts = [geo.city, geo.region, geo.country].filter(Boolean);
        meta.location = locParts.join(', ');
        meta.org = geo.org || geo.isp || null;
      }
      _pageInfoCache.set(url, { data: meta, ts: Date.now() });
      // Only push if this tab is still the active one
      const win = window._getCurrentWindow ? window._getCurrentWindow() : null;
      if (win && win.activeTab === tab.id) {
        _pushPill(meta);
      }
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
  _startReadingTimeMode();
  const cached = _pageInfoCache.get(url);
  if (cached && (Date.now() - cached.ts) < _CACHE_TTL) {
    _pushPill(cached.data);
  } else {
    // No cache — show minimal pill (will populate on scroll/token messages)
    _pushPill(null);
  }
}

function _startReadingTimeMode() {
  if (_readingTimeTimer) clearTimeout(_readingTimeTimer);
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  _displayMode = 'reading-time';
  _readingTimeTimer = setTimeout(function() {
    _readingTimeTimer = null;
    if (_displayMode === 'reading-time') {
      _displayMode = 'idle';
      _pushPill(_getCurrentMeta());
    }
  }, 10000);
}

export function _pageInfoCleanup() {
  _scrollPct = -1;
  _tokenCount = 0;
  _displayMode = 'idle';
  if (_readingTimeTimer) { clearTimeout(_readingTimeTimer); _readingTimeTimer = null; }
  if (_scrollIdleTimer) { clearTimeout(_scrollIdleTimer); _scrollIdleTimer = null; }
  _currentLabel = '';
  _currentBadges = '';
  _currentMeta = null;
  if (typeof window._clearIslandActivity === 'function') window._clearIslandActivity('pageinfo');
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
}

export function _pageInfoUpdateScroll(pct) {
  _scrollPct = pct;
  // Switch to scroll mode, cancel reading-time timer
  if (_readingTimeTimer) { clearTimeout(_readingTimeTimer); _readingTimeTimer = null; }
  _displayMode = 'scroll';
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
