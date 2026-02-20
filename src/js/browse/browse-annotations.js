// browse-annotations.js — Unified Insight (ambient + annotations)
// Depends on: browse-state.js
import { logger } from '/js/logger.js';
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { icon } from '/js/core/icons.js';
import { _updateAudioUnified } from '/js/core/core-audio.js';
import { islandUpdate } from '/js/core/core-ui.js';
import { _ttsChunkText, _ttsFetchAndQueue, _ttsStopAll, _ttsUpdateBtnIcon } from '/js/panel-tts.js';

// ── Insight state ──

export const _annotationsEnabled = new Map(); // tabId → bool
export const _insightCache = new Map();       // url → { insight, annotations, related, ts }

// Restore insight cache from localStorage on load
try {
  const _savedCache = Settings.getJSON('insightCache', {});
  const _cacheNow = Date.now();
  for (const [url, entry] of Object.entries(_savedCache)) {
    if (_cacheNow - entry.ts < 300000) _insightCache.set(url, entry);
  }
} catch {}

export function _persistInsightCache() {
  const obj = {};
  const now = Date.now();
  for (const [url, entry] of _insightCache) {
    if (now - entry.ts < 300000) obj[url] = entry;
  }
  Settings.setJSON('insightCache', obj);
}

// ── Trigger insight (manual — called when user clicks annotate pill) ──

export function _triggerInsight(tab) {
  if (!tab || tab.blank) return;
  const url = tab.url || '';
  if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;

  // Ensure this is the current active tab
  if (tab.id !== _browseActiveTab) return;

  // If we have a cached result for this URL, restore it directly
  if (_restoreInsightPill(tab)) return;

  // Extract text and send to pipeline (will show "Analyzing…" pill when ready)
  _triggerInsightExtract(tab);
}

export async function _triggerInsightExtract(tab) {
  if (!window.electronAPI || !window.electronAPI.insightPageLoaded) return;
  if (!tab || !tab.el) return;

  try {
    const pageText = await _extractTextFromFrame(tab);
    if (!pageText || pageText.length < 100) return;

    // Show loading pill immediately
    if (typeof islandUpdate === 'function') {
      islandUpdate('insight', {
        type: 'insight',
        label: 'Analyzing\u2026',
        loading: true,
        offer: false,
      });
    }

    // Capture screenshot for OCR if enabled — only for the active tab
    let screenshot = null;
    if (Settings.get('insightOcr') !== 'off' && tab.id === _browseActiveTab) {
      // Wait for webview guest process to be ready (getWebContentsId returns 0 until loaded)
      let wc = tab.el.getWebContentsId ? tab.el.getWebContentsId() : null;
      if (!wc) {
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 400));
          wc = tab.el.getWebContentsId ? tab.el.getWebContentsId() : null;
          if (wc) break;
        }
      }
      logger.debug('[insight] OCR capture: webContentsId =', wc, 'tag =', tab.el.tagName);
      if (wc) {
        try {
          screenshot = await window.electronAPI.captureWebview(wc);
          // capturePage() can return an empty base64 string if the page hasn't painted yet
          if (screenshot && screenshot.length < 100) {
            logger.debug('[insight] OCR capture: image too small, retrying after delay');
            await new Promise(r => setTimeout(r, 500));
            screenshot = await window.electronAPI.captureWebview(wc);
          }
          logger.debug('[insight] OCR capture: got screenshot, length =', screenshot?.length ?? 0);
        } catch (e) {
          logger.debug('[insight] OCR capture failed:', e);
        }
      }
    }

    window.electronAPI.insightPageLoaded({
      url: tab.url,
      title: tab.title || '',
      text: pageText.slice(0, 12000),
      tabId: tab.id,
      model: Settings.get('annotateModel') || '',
      screenshot: screenshot || undefined,
      ocrModel: Settings.get('ocrModel') || undefined,
    });
  } catch (e) { /* silent */ }
}

export function _restoreInsightPill(tab) {
  if (!tab || !tab.url) return false;
  const cached = _insightCache.get(tab.url);
  if (!cached || Date.now() - cached.ts > 300000) return false;
  const annotations = cached.annotations || [];
  const insight = cached.insight || null;
  if (!annotations.length && !insight) return false;

  // Restore annotations only if user had already enabled them for this tab
  if (annotations.length && _annotationsEnabled.get(tab.id)) {
    injectAnnotations(tab, annotations);
    _updateAnnotateButtonState();
  }

  // Build pill
  const typeCounts = {};
  for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
  const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'ALPHA';

  if (typeof islandUpdate === 'function') {
    islandUpdate('insight', {
      type: 'insight',
      label: annotations.length + ' annotation' + (annotations.length !== 1 ? 's' : ''),
      detail: insight || (annotations.length + ' annotations on this page'),
      insight: insight,
      items: annotations,
      related: cached.related || [],
      modeType,
      loading: false,
      offer: false,
    });
  }
  return true;
}

// ── Show "Annotate" offer pill for current tab ──

export function _showAnnotateOfferPill(tab) {
  if (!tab || tab.blank) return;
  const url = tab.url || '';
  if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;
  if (_annotationsEnabled.get(tab.id)) return; // already enabled

  // Check if we have cached results — restore pill if so
  if (_restoreInsightPill(tab)) return;

  // Show clickable "Annotate" offer pill
  if (typeof islandUpdate === 'function') {
    islandUpdate('insight', {
      type: 'insight',
      label: 'Annotate',
      loading: false,
      offer: true,
      action: function() { toggleAnnotations(); },
    });
  }
}

// ── Toggle insight (clear/restore) ──

export function toggleInsight() {
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  if (!tab || tab.blank) return;
  const enabled = !_annotationsEnabled.get(tab.id);
  _annotationsEnabled.set(tab.id, enabled);
  _updateAnnotateButtonState();
  if (enabled) {
    // Try to restore from cache or re-trigger
    if (!_restoreInsightPill(tab)) {
      _triggerInsight(tab);
    }
  } else {
    clearAnnotations(tab);
    // Show the offer pill again so user can re-annotate
    _showAnnotateOfferPill(tab);
  }
}

// Keep old name as alias for browse-pill.js compatibility
export function toggleAnnotations() { toggleInsight(); }

// ── Manual re-analyze ──

export async function _manualInsightAnalyze(tab) {
  if (!tab || !tab.el) return;
  if (!window.electronAPI || !window.electronAPI.insightAnalyze) return;

  // Clear cache for this URL
  _insightCache.delete(tab.url);
  clearAnnotations(tab);

  // Show loading
  if (typeof islandUpdate === 'function') {
    islandUpdate('insight', {
      type: 'insight',
      label: 'Analyzing\u2026',
      loading: true,
      offer: false,
    });
  }

  try {
    const pageText = await _extractTextFromFrame(tab);
    if (!pageText || pageText.length < 100) return;

    // Capture screenshot for OCR if enabled
    let screenshot = null;
    if (Settings.get('insightOcr') !== 'off') {
      let wc = tab.el.getWebContentsId?.();
      if (!wc) {
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 400));
          wc = tab.el.getWebContentsId?.();
          if (wc) break;
        }
      }
      if (wc) {
        try {
          screenshot = await window.electronAPI.captureWebview(wc);
          if (screenshot && screenshot.length < 100) {
            await new Promise(r => setTimeout(r, 500));
            screenshot = await window.electronAPI.captureWebview(wc);
          }
        } catch {}
      }
    }

    window.electronAPI.insightAnalyze({
      url: tab.url,
      title: tab.title || '',
      text: pageText.slice(0, 12000),
      tabId: tab.id,
      model: Settings.get('annotateModel') || '',
      screenshot: screenshot || undefined,
      ocrModel: Settings.get('ocrModel') || undefined,
    });
  } catch (e) { /* silent */ }
}

// ── Insight result listener ──

export function _initInsightListener() {
  if (!window.electronAPI || !window.electronAPI.onInsightResult) return;

  window.electronAPI.onInsightResult(function (_event, result) {
    if (!result || !result.tabId) return;

    // Only process if this is for the currently active tab
    if (typeof _browseActiveTab !== 'undefined' && result.tabId !== _browseActiveTab) return;

    // Handle error (manual trigger, Ollama down)
    if (result.error) {
      if (typeof islandUpdate === 'function') {
        islandUpdate('insight', {
          type: 'insight',
          label: result.error,
          loading: false,
          done: true,
        });
      }
      return;
    }

    const tab = _browseTabs.find(function(t) { return t.id === result.tabId; });
    const annotations = result.annotations || [];
    const insight = result.insight || null;
    const related = result.related || [];
    const ocrText = result.ocrText || null;

    // Cache result
    _insightCache.set(result.url, { insight, annotations, related, ocrText, ts: Date.now() });
    _persistInsightCache();

    // Only inject annotations if user explicitly enabled for this tab
    if (tab && annotations.length && _annotationsEnabled.get(tab.id)) {
      injectAnnotations(tab, annotations);
      _updateAnnotateButtonState();
    }

    // Update island pill
    const typeCounts = {};
    for (const a of annotations) { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1; }
    const modeType = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || 'ALPHA';

    if (typeof islandUpdate === 'function') {
      const count = annotations.length;
      islandUpdate('insight', {
        type: 'insight',
        label: count ? count + ' annotation' + (count !== 1 ? 's' : '') : 'No annotations',
        detail: insight || (count + ' annotations on this page'),
        insight: insight,
        ocrText: ocrText,
        items: annotations,
        related: related,
        modeType,
        loading: false,
        offer: false,
        done: (!insight && !count),
      });
    }
  });
}

// ── Insight partial (streaming) listener ──

export function _initInsightPartialListener() {
  if (!window.electronAPI || !window.electronAPI.onInsightPartial) return;

  window.electronAPI.onInsightPartial(function (_event, partial) {
    if (!partial || !partial.tabId) return;
    if (typeof _browseActiveTab !== 'undefined' && partial.tabId !== _browseActiveTab) return;

    // Inject streamed annotation incrementally only if user enabled for this tab
    if (partial.annotation) {
      const tab = _browseTabs.find(function(t) { return t.id === partial.tabId; });
      if (tab && _annotationsEnabled.get(tab.id)) {
        injectSingleAnnotation(tab, partial.annotation);
        _updateAnnotateButtonState();
      }
      if (typeof islandUpdate === 'function') {
        const count = partial.annotationCount || 0;
        const currentLabel = count + ' annotation' + (count !== 1 ? 's' : '');
        islandUpdate('insight', {
          type: 'insight',
          label: currentLabel,
          loading: true,
          offer: false,
        });
      }
    }
  });
}

// Initialize when DOM is ready
export function _initInsightSystem() {
  _initInsightListener();
  _initInsightPartialListener();
  // Sync enabled state with backend
  if (Settings.get('insightEnabled') === 'off' && window.electronAPI && window.electronAPI.insightSetEnabled) {
    window.electronAPI.insightSetEnabled(false);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initInsightSystem);
} else {
  _initInsightSystem();
}

// ── Text extraction (unchanged) ──

export async function _waitForWebviewReady(frame, timeout) {
  if (!frame || frame.tagName !== 'WEBVIEW') return false;
  if (frame.isConnected && frame.getWebContentsId && frame.getWebContentsId()) return true;
  return new Promise(function(resolve) {
    const timer = setTimeout(function() { resolve(false); }, timeout || 5000);
    frame.addEventListener('dom-ready', function onReady() {
      frame.removeEventListener('dom-ready', onReady);
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function _extractTextFromFrame(tab) {
  if (!tab || !tab.el) return '';
  const frame = tab.el;
  if (frame.tagName === 'WEBVIEW') {
    const ready = await _waitForWebviewReady(frame, 5000);
    if (!ready) return '';
  }
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
      if (!frame.isConnected) return '';
      return await frame.executeJavaScript(script);
    } else if (frame.tagName === 'IFRAME') {
      return frame.contentDocument.body.innerText || '';
    }
  } catch (err) { logger.error('[insight] _extractTextFromFrame error:', err); }
  return '';
}

export async function _readPageAloud() {
  // Pause/resume if already playing
  if (window._ttsAudio || window._ttsPaused) {
    _ttsPauseResume();
    return;
  }
  // Stop if queued but not playing (shouldn't normally happen)
  if (window._ttsChunks.length > 0) {
    _ttsStopAll();
    return;
  }
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(function(t) { return t.id === win.activeTab; });
  if (!tab) return;
  const btn = document.getElementById('pill-readaloud-btn');
  if (btn) btn.classList.add('pill-readaloud-active');
  window._ttsTabId = tab.id;
  _updateAudioUnified('tts', { label: 'Extracting\u2026', detail: 'Extracting page text' });
  const text = await _extractTextFromFrame(tab);
  if (!text || text.length < 10) {
    _updateAudioUnified('tts', { label: 'No text', detail: 'No readable text found', done: true });
    if (btn) btn.classList.remove('pill-readaloud-active');
    window._ttsTabId = null;
    return;
  }
  // Chunk text and queue for playback
  window._ttsStopped = false;
  window._ttsPaused = false;
  window._ttsChunks = _ttsChunkText(text);
  window._ttsChunkIdx = 0;
  _ttsUpdateBtnIcon();
  window._ttsQueue = [];
  _ttsFetchAndQueue();
}

export var _annTooltipPinned = false;

export function _showAnnotationTooltip(data, frame, pinned) {
  let tip = document.getElementById('aether-annotation-tooltip');
  if (_annTooltipPinned && !pinned) return; // don't overwrite pinned tooltip with hover
  if (!tip) {
    const tipView = new window.View('div').id('aether-annotation-tooltip').className('doc-selection-popup aether-ann-tooltip')
      .styles({zIndex:'999999', pointerEvents:'auto'});
    tipView.on('mousedown', function(ev) { ev.stopPropagation(); });
    tip = tipView.build();
    document.body.appendChild(tip);
  }
  _annTooltipPinned = !!pinned;
  tip.style.position = 'fixed';

  const thumbUpSvg = icon('thumbUp', {size: 11});
  const thumbDownSvg = icon('thumbDown', {size: 11});
  const checkSvg = icon('check', {size: 11, strokeWidth: '2.5'});
  const rateBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', padding: '2px', opacity: '0.5', color: 'rgba(255,255,255,0.7)' };

  function _makeRateBtn(svgHtml, rating, title, hoverColor) {
    const btn = new window.View('button').attr('title', title).styles(rateBtnStyle);
    btn._appendChildren([window.RawHTML(svgHtml)]);
    btn.onHover(
      function() { btn.el.style.opacity = '1'; btn.el.style.color = hoverColor; },
      function() { btn.el.style.opacity = '0.5'; btn.el.style.color = 'rgba(255,255,255,0.7)'; }
    );
    btn.on('mousedown', function(ev) { ev.stopPropagation(); ev.preventDefault(); });
    btn.onTap(function(ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (btn.el.disabled) return;
      const tab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
      apiPost('/api/annotation-feedback', { quote: data.quote || data.explanation || '', explanation: data.explanation || '', annType: data.type || '', rating: rating, url: (tab && tab.url) || '', pageTitle: (tab && tab.title) || '' })
        .then(function() {
          btn.el.style.opacity = '1';
          btn.el.style.color = rating === 'good' ? '#4caf50' : '#ef5350';
          AetherUI.mount(window.RawHTML(checkSvg), btn.el);
          btn.el.disabled = true;
          const sibling = btn.el.parentElement.querySelector('button:not([disabled])');
          if (sibling) sibling.style.display = 'none';
        }).catch(function() {
          btn.el.style.opacity = '0.5';
        });
    });
    return btn;
  }

  const rateRow = window.HStack([
    _makeRateBtn(thumbUpSvg, 'good', 'Good', '#4caf50'),
    _makeRateBtn(thumbDownSvg, 'bad', 'Bad', '#ef5350')
  ]).position('absolute').styles({top:'6px', right:'6px', display:'flex', gap:'2px'});

  const labelChildren = [window.Text(data.label || data.type)];
  if (data.confidence != null) {
    labelChildren.push(new window.View('span').className('aether-ann-confidence')._bindText(data.confidence + '%'));
  }
  const labelEl = window.HStack(labelChildren).className('aether-ann-label')
    .styles({color: data.labelColor || '#4caf50', paddingRight: '36px'});

  const explEl = new window.View('div').className('aether-ann-explanation')._bindText(data.explanation);

  const tipChildren = [rateRow, labelEl, explEl];
  if (data.conflictsWith) {
    tipChildren.push(new window.View('div').className('aether-ann-conflict')._bindText('Conflicts with: ' + data.conflictsWith));
  }

  AetherUI.mount(window.VStack(tipChildren), tip);
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

export function _hideAnnotationTooltip(force) {
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

export function injectAnnotations(tab, annotations) {
  if (!tab || !tab.el || !annotations.length) return;
  const frame = tab.el;

  const colorMap = {
    ALPHA: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50', label: 'Alpha', labelColor: '#4caf50' },
    CONTRADICTION: { bg: 'rgba(239, 83, 80, 0.25)', border: '#ef5350', label: 'Contradiction', labelColor: '#ef5350' },
    EXAGGERATION: { bg: 'rgba(255, 193, 7, 0.25)', border: '#ffc107', label: 'Exaggeration', labelColor: '#ffc107' },
    AD: { bg: 'rgba(255, 152, 0, 0.25)', border: '#ff9800', label: 'Ad', labelColor: '#ff9800' },
    CONNECTION: { bg: 'rgba(33, 150, 243, 0.25)', border: '#2196f3', label: 'Connection', labelColor: '#2196f3' }
  };
  // Extend with custom annotation categories
  if (typeof window._customAnnotationCategories !== 'undefined') {
    for (const cc of window._customAnnotationCategories) {
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

  _execInFrame(frame, script);
}

export function _execInFrame(frame, script) {
  if (frame.tagName === 'WEBVIEW' && frame.executeJavaScript) {
    frame.executeJavaScript(script).catch(() => {});
  } else if (frame.tagName === 'IFRAME') {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      const el = doc.createElement('script');
      el.textContent = script;
      doc.documentElement.appendChild(el);
      el.remove();
    } catch { /* cross-origin */ }
  }
}

export function clearAnnotations(tab) {
  if (!tab || !tab.el) return;
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
  _execInFrame(frame, script);
}

export function injectSingleAnnotation(tab, ann) {
  if (!tab || !tab.el) return;
  const frame = tab.el;
  const colorMap = {
    ALPHA: { bg: 'rgba(76, 175, 80, 0.25)', border: '#4caf50', label: 'Alpha', labelColor: '#4caf50' },
    CONTRADICTION: { bg: 'rgba(239, 83, 80, 0.25)', border: '#ef5350', label: 'Contradiction', labelColor: '#ef5350' },
    EXAGGERATION: { bg: 'rgba(255, 193, 7, 0.25)', border: '#ffc107', label: 'Exaggeration', labelColor: '#ffc107' },
    AD: { bg: 'rgba(255, 152, 0, 0.25)', border: '#ff9800', label: 'Ad', labelColor: '#ff9800' },
    CONNECTION: { bg: 'rgba(33, 150, 243, 0.25)', border: '#2196f3', label: 'Connection', labelColor: '#2196f3' }
  };
  if (typeof window._customAnnotationCategories !== 'undefined') {
    for (const cc of window._customAnnotationCategories) {
      colorMap[cc.key] = { bg: cc.color + '40', border: cc.color, label: cc.name, labelColor: cc.color };
    }
  }
  const c = colorMap[ann.type] || { bg: 'rgba(136,136,136,0.25)', border: '#888', label: ann.type, labelColor: '#888' };
  const annJSON = JSON.stringify({
    type: ann.type, label: c.label, labelColor: c.labelColor,
    explanation: ann.explanation || '', conflictsWith: ann.conflictsWith || '',
    confidence: ann.confidence != null ? ann.confidence : null, quote: ann.quote || ''
  }).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const quoteEsc = JSON.stringify(ann.quote).slice(1, -1).replace(/'/g, "\\'");
  const bgEsc = c.bg.replace(/'/g, "\\'");
  const borderEsc = c.border.replace(/'/g, "\\'");
  const annOpacity = ann.confidence != null ? Math.max(0.4, ann.confidence / 100) : 1;
  const script = `(function(){
    var quote='${quoteEsc}';if(!quote)return;
    var annData=JSON.parse('${annJSON}');
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
      mark.style.cssText='background:${bgEsc};border-bottom:2px solid ${borderEsc};padding:1px 0;border-radius:2px;cursor:pointer;color:inherit;opacity:${annOpacity};';
      mark.textContent=mt;
      var _hoveredAnn=null;
      mark.addEventListener('mouseover',function(){_hoveredAnn=annData;});
      mark.addEventListener('mouseout',function(){if(!mark._clicked){_hoveredAnn=null;console.log('__AETHER_ANN_LEAVE__');}});
      mark.addEventListener('mousemove',function(e){if(_hoveredAnn&&!mark._clicked){console.log('__AETHER_ANN_MOVE__'+JSON.stringify({x:e.clientX,y:e.clientY,type:annData.type,label:annData.label,labelColor:annData.labelColor,explanation:annData.explanation,conflictsWith:annData.conflictsWith,confidence:annData.confidence,quote:annData.quote}));}});
      mark.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();mark._clicked=true;mark.style.opacity='1';mark.style.outline='1.5px solid ${borderEsc}';mark.style.outlineOffset='1px';console.log('__AETHER_ANN_CLICK__'+JSON.stringify({x:e.clientX,y:e.clientY,type:annData.type,label:annData.label,labelColor:annData.labelColor,explanation:annData.explanation,conflictsWith:annData.conflictsWith,confidence:annData.confidence,quote:annData.quote}));});
      var p=node.parentNode;if(before)p.insertBefore(document.createTextNode(before),node);
      p.insertBefore(mark,node);if(after)p.insertBefore(document.createTextNode(after),node);
      p.removeChild(node);break;
    }
  })();`;
  _execInFrame(frame, script);
}

export function scrollToAnnotation(idx) {
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
  _execInFrame(frame, script);
}

export function _updateAnnotateButtonState() {
  const btn = document.getElementById('browse-annotate-btn');
  if (!btn) return;
  const tab = _browseTabs.find(t => t.id === _browseActiveTab);
  const enabled = tab && _annotationsEnabled.get(tab.id);
  btn.classList.toggle('text-accent', !!enabled);
  btn.classList.toggle('text-dimmer', !enabled);
}

// ── Action registry ──
registerActions({
  toggleAnnotations: () => toggleAnnotations(),
});

