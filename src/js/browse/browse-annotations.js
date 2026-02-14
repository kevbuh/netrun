// browse-annotations.js — Extracted from browse-tabs.js
// Depends on: browse-state.js

// ── Live Annotations ──

const _annotationsEnabled = new Map(); // tabId → bool
const _annotationsCache = new Map();   // url → { annotations, ts }

// Restore annotation cache from localStorage on load
try {
  const _savedAnnCache = JSON.parse(localStorage.getItem('annotationsCache') || '{}');
  const _annNow = Date.now();
  for (const [url, entry] of Object.entries(_savedAnnCache)) {
    if (_annNow - entry.ts < 300000) _annotationsCache.set(url, entry);
  }
} catch {}

function _persistAnnotationsCache() {
  const obj = {};
  const now = Date.now();
  for (const [url, entry] of _annotationsCache) {
    if (now - entry.ts < 300000) obj[url] = entry;
  }
  localStorage.setItem('annotationsCache', JSON.stringify(obj));
}
let _annotationOfferTimer = null;
let _annotationAbort = null; // AbortController for in-flight annotation

function _offerAnnotation(tab) {
  // Clear any previous offer timer
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  // Don't offer if already annotating or on blank/internal pages
  if (!tab || tab.blank) return;
  const url = tab.url || '';
  if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;
  // Don't offer if annotations already enabled for this tab
  if (_annotationsEnabled.get(tab.id)) return;
  // If we have a cached result for this URL, restore it directly
  if (_restoreAnnotationPill(tab)) return;
  // Remove any existing annotate pill
  if (typeof islandRemove === 'function') islandRemove('annotate');
  // Auto-annotate: skip the offer and annotate immediately
  if (localStorage.getItem('autoAnnotate') === 'on') {
    _annotationOfferTimer = setTimeout(() => {
      if (_browseActiveTab !== tab.id) return;
      if (_annotationsEnabled.get(tab.id)) return;
      toggleAnnotations();
    }, 1500);
    return;
  }
  // Show offer after a short delay (let page settle)
  _annotationOfferTimer = setTimeout(() => {
    // Re-check tab is still active
    if (_browseActiveTab !== tab.id) return;
    if (_annotationsEnabled.get(tab.id)) return;
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', {
        type: 'annotate',
        label: 'Annotate',
        detail: 'Annotate this page',
        loading: false,
        offer: true,
        action: () => {
          toggleAnnotations();
        }
      });
    }
    // Compact offer to icon-only after 15s
    _annotationOfferTimer = setTimeout(() => {
      const pill = document.querySelector('.pill-island[data-island-id="annotate"]');
      if (pill) pill.classList.add('island-compact');
    }, 15000);
  }, 1500);
}

function _restoreAnnotationPill(tab) {
  if (!tab || !tab.url) return false;
  const cached = _annotationsCache.get(tab.url);
  if (!cached || Date.now() - cached.ts > 300000) return false;
  const annotations = cached.annotations || [];
  if (!annotations.length) return false;
  const typeCounts = {};
  for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
  const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'ALPHA';
  // Auto-enable and inject cached annotations into the page
  _annotationsEnabled.set(tab.id, true);
  injectAnnotations(tab, annotations);
  _updateAnnotateButtonState();
  if (typeof islandUpdate === 'function') {
    islandUpdate('annotate', {
      type: 'annotate',
      label: `${annotations.length} annotations`,
      detail: `${annotations.length} annotations on this page`,
      items: annotations,
      modeType,
      loading: false,
      offer: false
    });
  }
  return true;
}

function toggleAnnotations() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  logger.debug('annotate toggleAnnotations tab=', tab?.id, 'blank=', tab?.blank, 'url=', tab?.url, 'el=', tab?.el?.tagName);
  if (!tab || tab.blank) return;
  // Clear any pending offer timer
  if (_annotationOfferTimer) { clearTimeout(_annotationOfferTimer); _annotationOfferTimer = null; }
  const enabled = !_annotationsEnabled.get(tab.id);
  _annotationsEnabled.set(tab.id, enabled);
  _updateAnnotateButtonState();
  if (enabled) {
    annotateCurrentPage(tab);
  } else {
    clearAnnotations(tab);
  }
}

async function annotateCurrentPage(tab) {
  logger.debug('annotate annotateCurrentPage tab=', tab?.id, 'el=', tab?.el?.tagName, 'url=', tab?.url);
  if (!tab || !tab.el) return;
  const url = tab.url || '';

  // Check cache (5 min)
  const cached = _annotationsCache.get(url);
  if (cached && Date.now() - cached.ts < 300000) {
    injectAnnotations(tab, cached.annotations);
    _restoreAnnotationPill(tab);
    return;
  }

  // Abort any previous in-flight annotation
  if (_annotationAbort) { _annotationAbort.abort(); _annotationAbort = null; }
  const abortCtrl = new AbortController();
  _annotationAbort = abortCtrl;

  // Show island with yellow dot; delay before showing cancel button
  if (typeof islandUpdate === 'function') {
    const dismissFn = () => {
      abortCtrl.abort();
      _annotationsEnabled.delete(tab.id);
      _updateAnnotateButtonState();
      islandRemove('annotate');
    };
    islandUpdate('annotate', {
      type: 'annotate', label: 'Annotating…', loading: true, offer: false, action: null,
      showCancel: false, dismiss: dismissFn
    });
    setTimeout(() => {
      const act = typeof _islandActivities !== 'undefined' ? _islandActivities['annotate'] : null;
      if (act && act.loading) {
        islandUpdate('annotate', Object.assign({}, act, { showCancel: true }));
      }
    }, 1500);
  }

  try {
    // Extract text directly from the webview/iframe (already loaded)
    const pageText = await _extractTextFromFrame(tab);
    if (abortCtrl.signal.aborted) return;
    if (!pageText) {
      if (typeof islandUpdate === 'function') {
        islandUpdate('annotate', { type: 'annotate', label: 'No text found', loading: false, done: true });
      }
      return;
    }

    // Call annotate API (current tab only — no cross-tab context)
    const model = localStorage.getItem('annotateModel') || '';
    const interestCtx = typeof buildInterestContext === 'function' ? buildInterestContext() : '';
    const data = await apiPost('/api/annotate', { url, text: pageText, otherTabs: [], model, interest_context: interestCtx });
    if (abortCtrl.signal.aborted) return;
    const annotations = data.annotations || [];

    // Cache
    _annotationsCache.set(url, { annotations, ts: Date.now() });
    _persistAnnotationsCache();

    // Only inject if still enabled
    if (_annotationsEnabled.get(tab.id)) {
      injectAnnotations(tab, annotations);
    }

    // Keep pill persistent with annotation items (clickable list)
    // Icon color = mode (most frequent type)
    const typeCounts = {};
    for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
    const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'ALPHA';
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', {
        type: 'annotate',
        label: `${annotations.length} annotations`,
        detail: `${annotations.length} annotations on this page`,
        items: annotations,
        modeType,
        loading: false
      });
    }
  } catch (err) {
    if (abortCtrl.signal.aborted) return; // cancelled by user
    console.error('[annotate] Error:', err);
    if (typeof islandUpdate === 'function') {
      islandUpdate('annotate', { type: 'annotate', label: 'Failed', loading: false, done: true });
    }
  }
}

async function _extractTextFromFrame(tab) {
  if (!tab || !tab.el) return '';
  const frame = tab.el;
  const script = `(function() {
    const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
    const block = new Set(['DIV','P','BR','H1','H2','H3','H4','H5','H6','LI','TR','BLOCKQUOTE','PRE','SECTION','ARTICLE','HEADER','FOOTER','ASIDE','DT','DD','FIGCAPTION','HR','BIG','DETAILS','SUMMARY','NAV','MAIN','TABLE','THEAD','TBODY','TFOOT','OL','UL']);
    function getText(el) {
      if (skip.has(el.tagName)) return '';
      if (el.tagName === 'BR') return '\\n';
      let t = '';
      for (const c of el.childNodes) {
        if (c.nodeType === 3) t += c.textContent;
        else if (c.nodeType === 1) {
          var inner = getText(c);
          if (block.has(c.tagName) && inner.trim()) t += '\\n' + inner + '\\n';
          else t += inner;
        }
      }
      return t;
    }
    return getText(document.body || document.documentElement).replace(/[^\\S\\n]+/g, ' ').replace(/\\n\\s*\\n/g, '\\n\\n').trim();
  })()`;
  try {
    if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
      return await frame.executeJavaScript(script);
    } else if (frame.tagName === 'IFRAME') {
      return frame.contentDocument.body.innerText || '';
    }
  } catch (err) { console.error('[annotate] _extractTextFromFrame error:', err); }
  return '';
}


async function _readPageAloud() {
  // Pause/resume if already playing
  if (_ttsAudio || _ttsPaused) {
    _ttsPauseResume();
    return;
  }
  // Stop if queued but not playing (shouldn't normally happen)
  if (_ttsChunks.length > 0) {
    _ttsStopAll();
    return;
  }
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  if (!tab) return;
  const btn = document.getElementById('pill-readaloud-btn');
  if (btn) btn.classList.add('pill-readaloud-active');
  _ttsTabId = tab.id;
  _updateAudioUnified('tts', { label: 'Extracting\u2026', detail: 'Extracting page text' });
  const text = await _extractTextFromFrame(tab);
  if (!text || text.length < 10) {
    _updateAudioUnified('tts', { label: 'No text', detail: 'No readable text found', done: true });
    if (btn) btn.classList.remove('pill-readaloud-active');
    _ttsTabId = null;
    return;
  }
  // Chunk text and queue for playback
  _ttsStopped = false;
  _ttsPaused = false;
  _ttsChunks = _ttsChunkText(text);
  _ttsChunkIdx = 0;
  _ttsUpdateBtnIcon();
  _ttsQueue = [];
  _ttsFetchAndQueue();
}

var _annTooltipPinned = false;

function _showAnnotationTooltip(data, frame, pinned) {
  let tip = document.getElementById('aether-annotation-tooltip');
  if (_annTooltipPinned && !pinned) return; // don't overwrite pinned tooltip with hover
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'aether-annotation-tooltip';
    tip.className = 'doc-selection-popup aether-ann-tooltip';
    tip.style.zIndex = '999999';
    tip.style.pointerEvents = 'auto';
    tip.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    document.body.appendChild(tip);
  }
  _annTooltipPinned = !!pinned;
  const confBadge = data.confidence != null ? '<span class="aether-ann-confidence">' + data.confidence + '%</span>' : '';
  // Rate buttons — small icons, top-right
  const rateEl = '<div style="position:absolute;top:6px;right:6px;display:flex;gap:2px">'
    + '<button data-ann-tip-rate="good" style="background:none;border:none;cursor:pointer;padding:2px;opacity:0.5;color:rgba(255,255,255,0.7)" title="Good" onmouseenter="this.style.opacity=1;this.style.color=\'#4caf50\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'rgba(255,255,255,0.7)\'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg></button>'
    + '<button data-ann-tip-rate="bad" style="background:none;border:none;cursor:pointer;padding:2px;opacity:0.5;color:rgba(255,255,255,0.7)" title="Bad" onmouseenter="this.style.opacity=1;this.style.color=\'#ef5350\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'rgba(255,255,255,0.7)\'"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg></button>'
    + '</div>';
  const labelEl = '<div class="aether-ann-label" style="color:' + (data.labelColor || '#4caf50') + ';padding-right:36px">' + (data.label || data.type) + confBadge + '</div>';
  const explEl = '<div class="aether-ann-explanation">' + data.explanation + '</div>';
  const conflictEl = data.conflictsWith ? '<div class="aether-ann-conflict">Conflicts with: ' + data.conflictsWith + '</div>' : '';
  tip.style.position = 'fixed';
  tip.innerHTML = rateEl + labelEl + explEl + conflictEl;
  // Wire rating buttons
  tip.querySelectorAll('[data-ann-tip-rate]').forEach(function(btn) {
    btn.addEventListener('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    btn.addEventListener('click', function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (btn.disabled) return;
      const rating = btn.getAttribute('data-ann-tip-rate');
      const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
      apiPost('/api/annotation-feedback', { quote: data.quote || data.explanation || '', explanation: data.explanation || '', annType: data.type || '', rating: rating, url: (tab && tab.url) || '', pageTitle: (tab && tab.title) || '' })
        .then(function() {
          btn.style.opacity = '1';
          btn.style.color = rating === 'good' ? '#4caf50' : '#ef5350';
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
          btn.disabled = true;
          const sibling = btn.parentElement.querySelector('[data-ann-tip-rate]:not([disabled])');
          if (sibling) sibling.style.display = 'none';
        }).catch(function() {
          btn.style.opacity = '0.5';
        });
    });
  });
  tip.style.opacity = '1';
  tip.style.pointerEvents = 'auto';
  const fRect = frame.getBoundingClientRect();
  const cx = data.x + fRect.left;
  const cy = data.y + fRect.top;
  const tipW = tip.offsetWidth || 320;
  const tipH = tip.offsetHeight || 60;
  const left = Math.min(cx + 12, window.innerWidth - tipW - 8);
  let top = cy - tipH - 12;
  if (top < 4) top = cy + 20;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function _hideAnnotationTooltip(force) {
  if (_annTooltipPinned && !force) return;
  _annTooltipPinned = false;
  const tip = document.getElementById('aether-annotation-tooltip');
  if (tip) { tip.style.opacity = '0'; tip.style.pointerEvents = 'none'; }
}

// Dismiss pinned tooltip on click outside
document.addEventListener('mousedown', function(ev) {
  if (!_annTooltipPinned) return;
  const tip = document.getElementById('aether-annotation-tooltip');
  if (tip && tip.contains(ev.target)) return;
  _hideAnnotationTooltip(true);
});

function injectAnnotations(tab, annotations) {
  if (!tab || !tab.el || !annotations.length) return;
  const frame = tab.el;

  const colorMap = {
    ALPHA: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50', label: 'Alpha', labelColor: '#4caf50' },
    CONTRADICTION: { bg: 'rgba(239, 83, 80, 0.25)', border: '#ef5350', label: 'Contradiction', labelColor: '#ef5350' },
    AD: { bg: 'rgba(255, 152, 0, 0.25)', border: '#ff9800', label: 'Ad', labelColor: '#ff9800' },
    CONNECTION: { bg: 'rgba(33, 150, 243, 0.25)', border: '#2196f3', label: 'Connection', labelColor: '#2196f3' }
  };
  // Extend with custom annotation categories
  if (typeof _customAnnotationCategories !== 'undefined') {
    for (const cc of _customAnnotationCategories) {
      colorMap[cc.key] = { bg: cc.color + '40', border: cc.color, label: cc.name, labelColor: cc.color };
    }
  }

  const annotationsJSON = JSON.stringify(annotations).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const colorMapJSON = JSON.stringify(colorMap).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const script = `
    (function() {
      if (window.__aetherAnnotationsActive) return;
      window.__aetherAnnotationsActive = true;
      const annotations = JSON.parse('${annotationsJSON}');
      const colorMap = JSON.parse('${colorMapJSON}');

      var _hoveredAnn = null;
      var _clickedAnn = false;
      function showTooltip(mark, ann) {
        var c = colorMap[ann.type] || colorMap.ALPHA;
        _hoveredAnn = { type: ann.type, label: c.label, labelColor: c.labelColor, explanation: ann.explanation, conflictsWith: ann.conflictsWith || '', confidence: ann.confidence != null ? ann.confidence : null, quote: ann.quote || '' };
      }

      function hideTooltip() {
        if (_clickedAnn) return;
        _hoveredAnn = null;
        console.log('__AETHER_ANN_LEAVE__');
      }

      var _clickedMark = null;
      function clickTooltip(mark, ann, e) {
        var c = colorMap[ann.type] || colorMap.ALPHA;
        // Remove previous clicked state
        if (_clickedMark && _clickedMark !== mark) {
          _clickedMark.style.outline = '';
          _clickedMark.style.outlineOffset = '';
          _clickedMark.style.opacity = _clickedMark._origOpacity || '';
        }
        _clickedAnn = true;
        _clickedMark = mark;
        // Visual affordance: outline + full opacity
        mark._origOpacity = mark.style.opacity;
        mark.style.opacity = '1';
        mark.style.outline = '1.5px solid ' + c.border;
        mark.style.outlineOffset = '1px';
        console.log('__AETHER_ANN_CLICK__' + JSON.stringify({ x: e.clientX, y: e.clientY, type: ann.type, label: c.label, labelColor: c.labelColor, explanation: ann.explanation, conflictsWith: ann.conflictsWith || '', confidence: ann.confidence != null ? ann.confidence : null, quote: ann.quote || '' }));
      }

      document.addEventListener('mousedown', function(e) {
        if (_clickedAnn && !e.target.closest('.aether-annotation')) {
          // Remove clicked visual state
          if (_clickedMark) {
            _clickedMark.style.outline = '';
            _clickedMark.style.outlineOffset = '';
            _clickedMark.style.opacity = _clickedMark._origOpacity || '';
            _clickedMark = null;
          }
          _clickedAnn = false;
          _hoveredAnn = null;
          console.log('__AETHER_ANN_DISMISS__');
        }
      });

      document.addEventListener('mousemove', function(e) {
        if (!_hoveredAnn || _clickedAnn) return;
        console.log('__AETHER_ANN_MOVE__' + JSON.stringify({ x: e.clientX, y: e.clientY, type: _hoveredAnn.type, label: _hoveredAnn.label, labelColor: _hoveredAnn.labelColor, explanation: _hoveredAnn.explanation, conflictsWith: _hoveredAnn.conflictsWith, confidence: _hoveredAnn.confidence, quote: _hoveredAnn.quote }));
      });

      // Build concatenated text from all text nodes with position mapping
      const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
      function collectTextNodes(el) {
        const result = [];
        if (skip.has(el.tagName)) return result;
        for (const child of el.childNodes) {
          if (child.nodeType === 3) result.push(child);
          else if (child.nodeType === 1) result.push(...collectTextNodes(child));
        }
        return result;
      }
      const textNodes = collectTextNodes(document.body);
      let fullText = '';
      const nodeMap = []; // { node, start, end }
      for (const node of textNodes) {
        const start = fullText.length;
        fullText += node.textContent;
        nodeMap.push({ node, start, end: fullText.length });
      }
      const fullLower = fullText.toLowerCase();

      for (const ann of annotations) {
        const quote = ann.quote;
        if (!quote) continue;
        const quoteLower = quote.toLowerCase();
        const matchIdx = fullLower.indexOf(quoteLower);
        if (matchIdx === -1) continue;
        const matchEnd = matchIdx + quote.length;
        const c = colorMap[ann.type] || colorMap.ALPHA;

        // Find all text nodes that overlap with this match range
        const affectedNodes = [];
        for (const nm of nodeMap) {
          if (nm.end <= matchIdx || nm.start >= matchEnd) continue;
          affectedNodes.push(nm);
        }
        if (!affectedNodes.length) continue;

        // Single-node match (most common)
        var annOpacity = ann.confidence != null ? Math.max(0.4, ann.confidence / 100) : 1;
        if (affectedNodes.length === 1) {
          const nm = affectedNodes[0];
          const node = nm.node;
          if (!node.parentNode) continue;
          if (node.parentNode.closest && node.parentNode.closest('.aether-annotation')) continue;
          const localIdx = matchIdx - nm.start;
          const nodeText = node.textContent;
          const before = nodeText.substring(0, localIdx);
          const matchText = nodeText.substring(localIdx, localIdx + quote.length);
          const after = nodeText.substring(localIdx + quote.length);

          const mark = document.createElement('mark');
          mark.className = 'aether-annotation';
          mark.style.cssText = 'background:' + c.bg + ';border-bottom:2px solid ' + c.border + ';padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;opacity:' + annOpacity + ';';
          mark.textContent = matchText;
          mark.addEventListener('mouseover', function() { showTooltip(mark, ann); });
          mark.addEventListener('mouseout', hideTooltip);
          mark.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); clickTooltip(mark, ann, e); });

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
          // Update nodeMap for subsequent annotations
          const nmIdx = nodeMap.indexOf(nm);
          if (nmIdx !== -1) nodeMap.splice(nmIdx, 1);
          continue;
        }

        // Cross-node match: wrap the matching portion of each node in a mark
        let isFirst = true;
        let wrapMark = null;
        for (const nm of affectedNodes) {
          const node = nm.node;
          if (!node.parentNode) continue;
          const overlapStart = Math.max(matchIdx, nm.start) - nm.start;
          const overlapEnd = Math.min(matchEnd, nm.end) - nm.start;
          const nodeText = node.textContent;
          const before = nodeText.substring(0, overlapStart);
          const matchText = nodeText.substring(overlapStart, overlapEnd);
          const after = nodeText.substring(overlapEnd);

          const mark = document.createElement('mark');
          mark.className = 'aether-annotation';
          mark.style.cssText = 'background:' + c.bg + ';border-bottom:2px solid ' + c.border + ';padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;opacity:' + annOpacity + ';';
          mark.textContent = matchText;
          if (isFirst) { wrapMark = mark; isFirst = false; }
          mark.addEventListener('mouseover', function() { showTooltip(wrapMark || mark, ann); });
          mark.addEventListener('mouseout', hideTooltip);
          mark.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); clickTooltip(wrapMark || mark, ann, e); });

          const parent = node.parentNode;
          if (before) parent.insertBefore(document.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(document.createTextNode(after), node);
          parent.removeChild(node);
          const nmIdx = nodeMap.indexOf(nm);
          if (nmIdx !== -1) nodeMap.splice(nmIdx, 1);
        }
      }
    })();
  `;

  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try {
      frame.contentWindow.eval(script);
    } catch { /* cross-origin */ }
  }
}

function clearAnnotations(tab) {
  if (!tab || !tab.el) return;
  if (typeof islandRemove === 'function') islandRemove('annotate');
  const hostTooltip = document.getElementById('aether-annotation-tooltip');
  if (hostTooltip) hostTooltip.remove();
  const frame = tab.el;
  const script = `
    (function() {
      window.__aetherAnnotationsActive = false;
      document.querySelectorAll('mark.aether-annotation').forEach(function(mark) {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
      });
      document.body.normalize();
    })();
  `;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try {
      frame.contentWindow.eval(script);
    } catch { /* cross-origin */ }
  }
}

function injectSingleAnnotation(tab, ann) {
  if (!tab || !tab.el) return;
  const frame = tab.el;
  const colorMap = {
    ALPHA: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50' },
    CONTRADICTION: { bg: 'rgba(239, 83, 80, 0.25)', border: '#ef5350' },
    AD: { bg: 'rgba(255, 152, 0, 0.25)', border: '#ff9800' },
    CONNECTION: { bg: 'rgba(33, 150, 243, 0.25)', border: '#2196f3' }
  };
  if (typeof _customAnnotationCategories !== 'undefined') {
    for (const cc of _customAnnotationCategories) {
      colorMap[cc.key] = { bg: cc.color + '40', border: cc.color };
    }
  }
  const c = colorMap[ann.type] || { bg: 'rgba(136,136,136,0.25)', border: '#888' };
  const quoteEsc = JSON.stringify(ann.quote).slice(1, -1).replace(/'/g, "\\'");
  const bgEsc = c.bg.replace(/'/g, "\\'");
  const borderEsc = c.border.replace(/'/g, "\\'");
  const script = `(function(){
    var quote='${quoteEsc}';if(!quote)return;
    var skip=new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','IFRAME']);
    function collect(el){var r=[];if(skip.has(el.tagName))return r;for(var ch of el.childNodes){if(ch.nodeType===3)r.push(ch);else if(ch.nodeType===1)r.push.apply(r,collect(ch));}return r;}
    var nodes=collect(document.body),full='';var map=[];
    for(var n of nodes){var s=full.length;full+=n.textContent;map.push({node:n,start:s,end:full.length});}
    var fl=full.toLowerCase(),ql=quote.toLowerCase(),mi=fl.indexOf(ql);if(mi===-1)return;
    var me=mi+quote.length;
    for(var nm of map){if(nm.end<=mi||nm.start>=me)continue;var node=nm.node;if(!node.parentNode)continue;
      if(node.parentNode.closest&&node.parentNode.closest('.aether-annotation'))continue;
      var os=Math.max(mi,nm.start)-nm.start,oe=Math.min(me,nm.end)-nm.start;
      var nt=node.textContent,before=nt.substring(0,os),mt=nt.substring(os,oe),after=nt.substring(oe);
      var mark=document.createElement('mark');mark.className='aether-annotation';
      mark.style.cssText='background:${bgEsc};border-bottom:2px solid ${borderEsc};padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;';
      mark.textContent=mt;
      var p=node.parentNode;if(before)p.insertBefore(document.createTextNode(before),node);
      p.insertBefore(mark,node);if(after)p.insertBefore(document.createTextNode(after),node);
      p.removeChild(node);break;
    }
  })();`;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try { frame.contentWindow.eval(script); } catch {}
  }
}

function scrollToAnnotation(idx) {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || !tab.el) return;
  const frame = tab.el;
  const script = `(function() {
    var marks = document.querySelectorAll('mark.aether-annotation');
    var mark = marks[${idx}];
    if (!mark) return;
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash effect
    var orig = mark.style.outline;
    mark.style.outline = '2px solid #fff';
    mark.style.outlineOffset = '2px';
    setTimeout(function() { mark.style.outline = orig; mark.style.outlineOffset = ''; }, 1500);
  })()`;
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try { frame.contentWindow.eval(script); } catch {}
  }
}

function _updateAnnotateButtonState() {
  const btn = document.getElementById('browse-annotate-btn');
  if (!btn) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const enabled = tab && _annotationsEnabled.get(tab.id);
  btn.classList.toggle('text-accent', !!enabled);
  btn.classList.toggle('text-dimmer', !enabled);
}

