// core-audio.js — Audio pill
// Extracted from core.js
import Settings from '/js/core/core-settings.js';
import { apiPost } from '/js/api.js';
import { icon } from '/js/core/icons.js';
import { islandRemove } from '/js/core/core-ui.js';
import { NOISE_PRESETS, setRainNoiseType, startRain, stopRain, getRainNoiseType, getRainOn } from '/js/core/core-sounds.js';
import { _browseUrlHideHistory } from '/js/browse-urlbar.js';
import { _paperState } from '/js/browse/browse-paper.js';
import { _pillMicClick, _pillMicRecorder, _showTabsInPillDropdown, _syncIslandPillPosition } from '/js/browse/browse-island.js';
import { _readPageAloud, scrollToAnnotation } from '/js/browse/browse-annotations.js';
import { _ttsStopAll } from '/js/panel-tts.js';
import { browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseNewTab } from '/js/browse/browse-windows.js';
import { clearBrowseDownloads, openDownloadFile, removeBrowseDownload } from '/js/browse/browse-downloads.js';
import { goToAudioTab } from '/js/browse/browse-audio.js';
import { toggleCaptions } from '/js/browse/browse-captions.js';

// ── Webview pointer guard — prevent webview from stealing events when dropdowns are open ──

// Centralized guard: observe any island-tray-open or dropdown-open to block webview pointer events
var _islandGuardObserver = null;
function _islandInitGuard() {
  if (_islandGuardObserver) return;
  var nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  _islandGuardObserver = new MutationObserver(function() {
    var anyOpen = !!nav.querySelector('.island-tray-open, .dropdown-open');
    document.body.classList.toggle('island-dropdown-guard', anyOpen);
  });
  _islandGuardObserver.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
}

// ── Unified Audio Pill ──

export function _getAudioState() {
  const { tab, tts, cc, mic } = window._audioUnifiedState.value;
  const micRecording = typeof _pillMicRecorder !== 'undefined' && !!_pillMicRecorder;
  const rainActive = getRainOn();
  const rainNoiseType = getRainNoiseType();
  return { tab, tts, cc, mic, micRecording, rainActive, rainNoiseType };
}
window._getAudioState = _getAudioState;

export function _pillNoiseCycle() {
  const types = typeof NOISE_PRESETS !== 'undefined' ? Object.keys(NOISE_PRESETS) : [];
  if (!types.length) return;
  const cur = getRainNoiseType();
  const idx = types.indexOf(cur);
  const next = types[(idx + 1) % types.length];
  setRainNoiseType(next);
}

export function _ttsCycleSpeed() {
  const cur = parseFloat(Settings.get('ttsSpeed')) || 1;
  let next = window._ttsSpeeds[0];
  for (let i = 0; i < window._ttsSpeeds.length; i++) {
    if (window._ttsSpeeds[i] > cur + 0.01) { next = window._ttsSpeeds[i]; break; }
    if (i === window._ttsSpeeds.length - 1) next = window._ttsSpeeds[0];
  }
  Settings.set('ttsSpeed', next);
  if (typeof window._ttsAudio !== 'undefined' && window._ttsAudio) window._ttsAudio.playbackRate = next;
  _renderAudioPill();
  const valEl = document.getElementById('tts-speed-val');
  if (valEl) valEl.textContent = next + 'x';
  const slider = document.querySelector('input[oninput*="ttsSpeed"]');
  if (slider) slider.value = next;
}

export function _updateAudioUnified(source, data) {
  window._audioUnifiedState.set(source, data);
  _renderAudioPill();
}

export function _clearAudioUnified(source) {
  window._audioUnifiedState.set(source, null);
  _renderAudioPill();
}

export function _renderAudioPill() {
  // Delegate to unified AI pill renderer
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
}

export function _islandRenderPill(a) {
  var V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack;
  if (a.type === 'feed-notif') {
    return H([R(icon('bell', { size: 14, stroke: 'var(--nr-accent)' })), T(a.label || '').foreground('var(--nr-accent)')]);
  } else if (a.done) {
    return H([new V('span').className('island-dot-done'), T(a.label || 'Done').foreground('#22c55e')]);
  } else if (a.type === 'download') {
    const pct = a.progress || 0;
    const circ = 2 * Math.PI * 6;
    const offset = circ * (1 - pct / 100);
    const ringHtml = pct > 0 ? '<svg class="island-ring" viewBox="0 0 16 16"><circle class="island-ring-bg" cx="8" cy="8" r="6"/><circle class="island-ring-fg" cx="8" cy="8" r="6" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 8 8)"/></svg>' : icon('download', { size: 14 });
    var dismiss = new V('span').className('island-dismiss').attr('data-island-dismiss', 'download')
      .styles({ marginLeft: '4px', opacity: '0.4', fontSize: '15px', lineHeight: '1', padding: '0 2px', cursor: 'pointer' });
    dismiss.el.textContent = '\u00d7';
    return H([R(ringHtml), T(a.label || pct + '%'), dismiss]);
  } else if (a.type === 'tts') {
    const ttsIconHtml = a.paused ? icon('play', { size: 14 }) : window._islandWaveformBars;
    const spd = parseFloat(Settings.get('ttsSpeed')) || 1;
    var spdBadge = T(spd.toFixed(1).replace(/\.0$/, '') + 'x').className('island-tts-speed').attr('title', 'Click to change speed')
      .onTap(function(e) { e.stopPropagation(); _ttsCycleSpeed(); });
    return H([R(ttsIconHtml), T(a.label || ''), spdBadge]);
  } else if (a.type === 'audio') {
    return H([R(window._islandAudioBars), T(a.label || '')]);
  } else if (a.type === 'ai') {
    return H([new V('span').className('island-ai-dot nr-breathe'), T(a.label || '')]);
  } else if (a.type === 'achievement') {
    return R(icon('help', { size: 14, stroke: '#caa12a' }));
  } else if (a.type === 'rss') {
    const rssIconHtml = a.subscribed
      ? icon('check', { size: 14, stroke: '#22c55e' })
      : icon('rssFeed', { size: 14, stroke: '#f97316' });
    return H([R(rssIconHtml), T(a.label || '').foreground(a.subscribed ? '#22c55e' : 'var(--aether-text)')]);
  } else if (a.type === 'tabs') {
    const tabItems = a.items || [];
    const nonBlank = [];
    for (let si = 0; si < tabItems.length; si++) {
      if (!tabItems[si].blank) nonBlank.push(tabItems[si]);
    }
    nonBlank.sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    if (nonBlank.length === 0) {
      return H([R(icon('windows', { size: 14 })), T('0 tabs').opacity(0.4)]);
    }
    const visible = nonBlank.slice(0, 3);
    var stripChildren = [];
    for (let ti = 0; ti < visible.length; ti++) {
      const t = visible[ti];
      const cls = 'island-strip-fav' + (t.active ? ' island-strip-fav-active' : '');
      if (t.favicon) {
        var favImg = new V('img').className(cls).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
        favImg.el.src = t.favicon;
        var _cls = cls;
        favImg.on('error', function() {
          var globe = R(icon('globe', { size: 16, strokeWidth: '1.5', class: _cls }));
          globe.attr('data-island-tab', t.id);
          this.replaceWith(globe.build());
        });
        if (t.active) {
          var wrap = new V('span').className('island-strip-fav-wrap').attr('data-island-tab', t.id);
          var closeBtn = new V('button').className('island-strip-fav-close').attr('data-island-tab-close', t.id).attr('title', 'Close tab');
          closeBtn.el.textContent = '\u00d7';
          wrap.add(favImg, closeBtn);
          stripChildren.push(wrap);
        } else {
          stripChildren.push(favImg);
        }
      } else {
        var globeView = R(icon('globe', { size: 16, strokeWidth: '1.5', class: cls })).attr('title', t.title || 'Tab').attr('data-island-tab', t.id);
        if (t.active) {
          var wrap = new V('span').className('island-strip-fav-wrap').attr('data-island-tab', t.id);
          var closeBtn = new V('button').className('island-strip-fav-close').attr('data-island-tab-close', t.id).attr('title', 'Close tab');
          closeBtn.el.textContent = '\u00d7';
          wrap.add(globeView, closeBtn);
          stripChildren.push(wrap);
        } else {
          stripChildren.push(globeView);
        }
      }
    }
    stripChildren.push(T(nonBlank.length + ' tab' + (nonBlank.length !== 1 ? 's' : '')).className('island-strip-overflow'));
    return new V('span').className('island-favicon-strip').add(stripChildren);
  } else if (a.type === 'insight') {
    if (a.offer) {
      return H([R(icon('comment', { size: 14, stroke: 'var(--nr-text-secondary)' })), T(a.label || 'Annotate').foreground('var(--nr-text-secondary)')]);
    }
    if (a.loading) {
      return H([new V('span').className('island-annotate-dot'), T(a.label || 'Analyzing\u2026')]);
    }
    const _annModeColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', EXAGGERATION: '#ffc107', AD: '#ff9800', CONNECTION: '#2196f3' };
    const annColor = _annModeColors[a.modeType] || '#4caf50';
    var children = [R(icon('comment', { size: 14, stroke: annColor })), T(a.label || '').foreground('var(--aether-text)')];
    if (a._paper && a._paperState && a._paperState.s2Data) {
      const cc = a._paperState.s2Data.citationCount;
      if (cc != null) children.push(T(cc + ' cit.').styles({ marginLeft: '6px', fontSize: '10px', padding: '1px 5px', borderRadius: '8px', background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }));
    }
    return H(children);
  } else if (a.type === 'pageinfo') {
    var children = [R(icon('clock', { size: 14, stroke: 'var(--nr-text-secondary)' }))];
    if (a.label) children.push(T(a.label));
    if (a.badges) children.push(T(a.badges).className('island-pageinfo-badges'));
    return H(children);
  } else if (a.type === 'calendar') {
    return H([R(icon('calendar', { size: 14, stroke: '#3b82f6' })), T(a.label || '').foreground('#3b82f6')]);
  } else if (a.type === 'bookmark') {
    return R(icon('bookmark', { size: 14, fill: 'var(--nr-accent)', stroke: 'var(--nr-accent)' }));
  } else if (a.type === 'pulse') {
    const pulseIntensity = (typeof Motion !== 'undefined') ? Math.min(Motion.pulse.rate / 5, 1) : 0;
    const pulseClass = pulseIntensity > 0.3 ? 'island-pulse-dot-active' : 'island-pulse-dot-idle';
    return new V('span').className('island-pulse-dot ' + pulseClass).cssVar('--pulse-intensity', pulseIntensity.toFixed(2));
  } else if (a.type === 'context') {
    return H([T('\u25CF').opacity(0.5), T(a.label || '').opacity(0.7)]);
  }
  return H([new V('span').className('island-dot'), T(a.label || '')]);
}

// Build tray content as a View for context/download/annotate/achievement/tabs pills
export function _islandBuildTray(a, isBrowse) {
  var V = window.View, T = window.Text, R = window.RawHTML, H = window.HStack, VS = window.VStack;

  function _divider() { return new V('div').styles({ height: '1px', background: 'var(--aether-border)', margin: '4px 0' }); }
  function _borderDivider() { return new V('div').styles({ height: '1px', background: 'var(--aether-border, var(--nr-border-default))', margin: '2px 0' }); }
  function _favImg(src) {
    var img = new V('img').frame({ width: 14, height: 14 }).cornerRadius('xs').styles({ flexShrink: '0' });
    img.el.src = src;
    img.on('error', function() { this.style.display = 'none'; });
    return img;
  }
  function _tabRow(item, showClose) {
    var title = item.title || 'New Tab';
    if (title.length > 36) title = title.slice(0, 34) + '\u2026';
    var children = [];
    if (item.favicon) children.push(_favImg(item.favicon));
    children.push(T(title).flex(1).styles({ minWidth: '0' }).truncate());
    if (showClose) {
      var cb = new V('button').className('island-tab-item-close').attr('data-island-tab-close', item.id).attr('title', 'Close');
      cb.el.textContent = '\u00d7';
      children.push(cb);
    }
    return H(children).className('island-ctx-item' + (item.active ? ' active' : '')).attr('data-island-tab', item.id);
  }

  if (a.type === 'context' && a.items && a.items.length) {
    var rows = [];
    if (isBrowse) {
      rows.push(H([R(icon('plus', { size: 12 })), T('New tab')]).className('island-tab-newtab').attr('data-island-tab-new', '1'));
      rows.push(_divider());
    }
    for (var ti = 0; ti < a.items.length; ti++) {
      rows.push(_tabRow(a.items[ti], isBrowse));
    }
    return VS(rows);
  } else if (a.type === 'download' && a.items && a.items.length) {
    var rows = [];
    rows.push(H([T('Downloads'), T('Clear all').className('island-dl-clear').attr('data-island-dl-clear', '1')]).className('island-dl-header'));
    for (var ti = 0; ti < a.items.length; ti++) {
      var item = a.items[ti];
      let fname = item.filename || 'Download';
      if (fname.length > 40) fname = fname.slice(0, 38) + '\u2026';
      const dlIconHtml = item.state === 'completed'
        ? icon('fileCheckmark', { size: 14, fill: '#22c55e', stroke: 'none' })
        : icon('filePlain', { size: 14 });
      const dlStatus = item.state === 'completed' ? 'Done' + (item.size ? ' \u00b7 ' + item.size : '')
        : item.state === 'cancelled' ? 'Cancelled'
        : item.pct + '% \u00b7 ' + item.received + (item.size ? ' / ' + item.size : '');
      var infoView = new V('div').className('island-dl-info').add(
        T(fname).className('island-dl-name'),
        T(dlStatus).className('island-dl-status')
      );
      if (item.state === 'progressing') {
        var bar = new V('div').className('island-dl-progress-bar').styles({ width: item.pct + '%' });
        infoView.add(new V('div').className('island-dl-progress').add(bar));
      }
      var removeBtn = new V('button').className('island-dl-remove').attr('data-island-dl-remove', item.id).attr('title', 'Remove');
      removeBtn.el.textContent = '\u00d7';
      rows.push(H([R(dlIconHtml).className('island-dl-icon'), infoView, removeBtn]).className('island-dl-item').attr('data-island-dl', item.id));
    }
    return VS(rows);
  } else if (a.type === 'insight' && ((a.items && a.items.length) || (a._paper && a._paperState))) {
    const annColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', CONNECTION: '#2196f3' };
    const annLabels = { ALPHA: 'Alpha', CONTRADICTION: 'Contradiction', AD: 'Ad', CONNECTION: 'Connection' };
    if (typeof window._customAnnotationCategories !== 'undefined') {
      for (let ci = 0; ci < window._customAnnotationCategories.length; ci++) {
        const cc = window._customAnnotationCategories[ci];
        annColors[cc.key] = cc.color;
        annLabels[cc.key] = cc.name;
      }
    }
    var rows = [];
    // Paper metadata at top of tray
    if (a._paper && a._paperState) {
      const ps = a._paperState;
      const s2 = ps.s2Data;
      const meta = ps.meta || {};
      const paperTitle = (s2 && s2.title) || meta.title || '';
      if (paperTitle) {
        rows.push(T(paperTitle).styles({ padding: '8px 10px 4px', fontSize: '13px', fontWeight: '600', color: 'var(--nr-text-primary)', lineHeight: '1.4' }));
      }
      if (s2) {
        const paperDetails = [];
        if (s2.year) paperDetails.push(s2.year);
        if (s2.venue) paperDetails.push(s2.venue);
        if (s2.citationCount != null) paperDetails.push(s2.citationCount + ' citation' + (s2.citationCount !== 1 ? 's' : ''));
        if (paperDetails.length) {
          rows.push(T(paperDetails.join(' \u00b7 ')).styles({ padding: '2px 10px 4px', fontSize: '11px', color: 'var(--nr-text-secondary)' }));
        }
      }
      const paperAuthors = (s2 && s2.authors) || [];
      const authorDetails = ps.authorDetails || [];
      if (paperAuthors.length || (meta.authors && meta.authors.length)) {
        rows.push(_borderDivider());
        const displayAuthors = paperAuthors.length ? paperAuthors.slice(0, 5) : meta.authors.slice(0, 5).map(function(n) { return { name: n }; });
        for (let pai = 0; pai < displayAuthors.length; pai++) {
          const pAuthor = displayAuthors[pai];
          const pName = pAuthor.name || '';
          let pDetail = null;
          for (let pdi = 0; pdi < authorDetails.length; pdi++) {
            if (authorDetails[pdi] && authorDetails[pdi].name === pName) { pDetail = authorDetails[pdi]; break; }
          }
          var authorChildren = [T(pName).flex(1).styles({ minWidth: '0' }).truncate()];
          if (pDetail && pDetail.hIndex != null) authorChildren.push(T('h-index: ' + pDetail.hIndex).styles({ fontSize: '10px', color: 'var(--nr-text-quaternary)', marginLeft: 'auto' }));
          if (pDetail && pDetail.citationCount != null) authorChildren.push(T(pDetail.citationCount.toLocaleString() + ' cit.').styles({ fontSize: '10px', color: 'var(--nr-text-quaternary)', marginLeft: '6px' }));
          rows.push(H(authorChildren).styles({ padding: '4px 10px', gap: '6px', fontSize: '12px', color: 'var(--nr-text-primary)' }));
        }
        if ((paperAuthors.length > 5) || (meta.authors && meta.authors.length > 5)) {
          const pExtra = (paperAuthors.length || meta.authors.length) - 5;
          rows.push(T('+' + pExtra + ' more').styles({ padding: '2px 10px 4px', fontSize: '11px', color: 'var(--nr-text-quaternary)' }));
        }
      }
      if (a.items && a.items.length) {
        rows.push(new V('div').styles({ height: '1px', background: 'var(--aether-border, var(--nr-border-default))', margin: '4px 0' }));
      }
    }
    if (a.insight) {
      rows.push(T(a.insight).styles({ padding: '8px 10px', fontSize: '12px', color: 'var(--aether-text, var(--nr-text-primary))', lineHeight: '1.5' }));
    }
    if (a.ocrText) {
      var ocrLabel = T('OCR').styles({ fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--aether-text-dim, var(--nr-text-secondary))' });
      var ocrContent = T(a.ocrText.length > 300 ? a.ocrText.slice(0, 297) + '\u2026' : a.ocrText);
      rows.push(VS([ocrLabel, ocrContent]).styles({ padding: '6px 10px', fontSize: '11px', color: 'var(--aether-text-dim, var(--nr-text-secondary))', lineHeight: '1.4', borderTop: '1px solid var(--aether-border, var(--nr-border-default))' }));
    }
    if ((a.insight || a.ocrText) && a.items && a.items.length) rows.push(_borderDivider());
    if (a.items && a.items.length) {
      rows.push(T('Annotations').className('island-ann-header'));
    }
    const thumbUpSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>';
    const thumbDownSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>';
    for (let ai = 0; ai < (a.items || []).length; ai++) {
      const ann = a.items[ai];
      const ac = annColors[ann.type] || '#888';
      const al = annLabels[ann.type] || ann.type;
      const isConnection = ann.type === 'CONNECTION';
      const displayText = isConnection ? ('Linked: ' + (ann.linkedTitle || 'Related content')) : (ann.explanation || ann.quote || '');
      const confStr = ann.confidence != null ? ann.confidence + '%' : '';
      var annChildren = [
        new V('span').className('island-ann-dot').styles({ background: ac }),
        T(al).className('island-ann-type').foreground(ac),
        T(displayText).className('island-ann-text')
      ];
      if (confStr) annChildren.push(T(confStr).className('island-ann-conf'));
      var goodBtn = new V('button').attr('data-ann-rate-good', ai).attr('title', 'Good annotation').html(thumbUpSvg);
      var badBtn = new V('button').attr('data-ann-rate-bad', ai).attr('title', 'Bad annotation').html(thumbDownSvg);
      annChildren.push(new V('span').className('island-ann-actions').add(goodBtn, badBtn));
      var annRow = new V('div').className('island-ann-item').attr('data-island-ann', ai).add(annChildren);
      if (isConnection && ann.linkedUrl) annRow.attr('data-island-ann-url', ann.linkedUrl);
      rows.push(annRow);
    }
    return VS(rows);
  } else if (a.type === 'pageinfo') {
    var rows = [];
    var m = a.meta || {};
    function _piRow(label, value) {
      if (!value) return null;
      return H([T(label).className('island-pageinfo-label'), T(value).className('island-pageinfo-value')]).className('island-pageinfo-row');
    }
    if (m.published) {
      try { var pd = new Date(m.published); rows.push(_piRow('Published', pd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))); } catch(e) { rows.push(_piRow('Published', m.published)); }
    }
    if (m.modified) {
      try { var md = new Date(m.modified); rows.push(_piRow('Modified', md.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))); } catch(e) { rows.push(_piRow('Modified', m.modified)); }
    }
    if (m.author) rows.push(_piRow('Author', m.author));
    if (m.type) rows.push(_piRow('Type', m.type));
    if (m.wordCount) {
      var mins = Math.max(1, Math.round(m.wordCount / 238));
      rows.push(_piRow('Reading time', mins + ' min (' + m.wordCount.toLocaleString() + ' words)'));
    }
    if (a.badges) rows.push(_piRow('Position', a.badges));
    if (m.description) {
      var desc = m.description.length > 200 ? m.description.slice(0, 197) + '\u2026' : m.description;
      rows.push(T(desc).className('island-pageinfo-desc'));
    }
    rows = rows.filter(Boolean);
    if (!rows.length) return T('No metadata available').styles({ padding: '8px 10px', opacity: '0.4', fontSize: '0.72rem' });
    return VS(rows);
  } else if (a.type === 'achievement') {
    return H([
      R(icon('help', { size: 18, stroke: '#caa12a', strokeWidth: '1.5' })).className('island-ach-tray-icon'),
      VS([
        T('Achievement Unlocked').className('island-ach-tray-subtitle'),
        T(a.label || 'Unlocked!').className('island-ach-tray-name'),
        T(a.detail || '').className('island-ach-tray-desc')
      ]).className('island-ach-tray-info')
    ]).className('island-ach-tray-content');
  } else if (a.type === 'tabs' && a.items && a.items.length) {
    var rows = [];
    rows.push(H([R(icon('plus', { size: 12 })), T('New tab')]).className('island-tab-newtab').attr('data-island-tab-new', '1'));
    rows.push(_divider());
    const pinnedItems = a.items.filter(function(it) { return it.pinned; });
    const unpinnedItems = a.items.filter(function(it) { return !it.pinned; }).slice().sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    function _trayTabItem(item, showClose) {
      var title = item.title || 'New Tab';
      if (title.length > 32) title = title.slice(0, 30) + '\u2026';
      var children = [];
      if (item.favicon) children.push(_favImg(item.favicon));
      if (item.hasAudio) children.push(R(icon('speakerSmall', { size: 12, style: 'flex-shrink:0;opacity:0.6' })));
      children.push(T(title).flex(1).styles({ minWidth: '0' }).truncate());
      if (showClose) {
        var cb = new V('button').className('island-tab-item-close' + (item.active ? ' island-tab-close-hover' : '')).attr('data-island-tab-close', item.id).attr('title', 'Close');
        cb.el.textContent = '\u00d7';
        children.push(cb);
      }
      return H(children).className('island-tab-item' + (item.active ? ' active' : '')).attr('data-island-tab', item.id);
    }
    if (pinnedItems.length) {
      for (let pi = 0; pi < pinnedItems.length; pi++) {
        rows.push(_trayTabItem(pinnedItems[pi], pinnedItems[pi].active));
      }
      if (unpinnedItems.length) rows.push(_divider());
    }
    for (var ti = 0; ti < unpinnedItems.length; ti++) {
      rows.push(_trayTabItem(unpinnedItems[ti], true));
    }
    return VS(rows);
  }
  if (a.type === 'pulse') {
    const recent = (typeof Motion !== 'undefined') ? Motion.pulse.recent : [];
    var rows = [];
    rows.push(T('Live Pulse').styles({ padding: '6px 8px', fontSize: '0.6rem', color: '#fff', opacity: '0.6', textTransform: 'uppercase', letterSpacing: '0.5px' }));
    const start = Math.max(0, recent.length - 30);
    for (let ri = recent.length - 1; ri >= start; ri--) {
      const ev = recent[ri];
      const catColors = { ai: '#a78bfa', feed: '#f97316', network: '#94a3b8', system: '#e879f9' };
      const col = catColors[ev.category] || '#94a3b8';
      const age = Math.round((Date.now() - ev.timestamp) / 1000);
      const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      const statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      rows.push(H([
        new V('span').styles({ width: '4px', height: '4px', borderRadius: '50%', background: statusDot, flexShrink: '0' }),
        T(ev.category).foreground(col).styles({ minWidth: '36px' }),
        T(ev.label).flex(1).styles({ minWidth: '0' }).truncate().opacity(0.7),
        T(ageStr).opacity(0.35).styles({ flexShrink: '0' })
      ]).className('island-ctx-item').styles({ fontSize: '0.65rem', gap: '6px', padding: '3px 8px' }));
    }
    if (!recent.length) rows.push(T('No events yet').styles({ padding: '8px', opacity: '0.3', fontSize: '0.65rem', textAlign: 'center' }));
    return VS(rows);
  }
  return null;
}
window._islandBuildTray = _islandBuildTray;

// ── Detail card (long-press) ──
let _activeDetailCard = null;

export function _islandCloseDetailCard() {
  if (!_activeDetailCard) return;
  const card = _activeDetailCard;
  _activeDetailCard = null;
  Motion.animate(card, { spring: 'snappy', to: { opacity: 0, scale: 0.92, y: -8 } }).onFinish(function() {
    card.remove();
  });
}

export function _islandShowDetailCard(pill, activity) {
  _islandCloseDetailCard();
  var V = window.View, T = window.Text, R = window.RawHTML;
  const typeLabels = { context: 'Context', download: 'Downloads', tabs: 'Tabs', insight: 'Annotations', achievement: 'Achievement', ai: 'AI', nowplaying: 'Now Playing', tts: 'Text to Speech', cc: 'Captions', audio: 'Audio', rss: 'Feed', bookmark: 'Bookmarked', 'feed-notif': 'Feed', pulse: 'Activity', qf: 'Quick Find', calendar: 'Calendar' };
  // Header
  var headerView = new V('div').className('island-detail-card-header').add(_islandRenderPill(activity));
  // Tray content
  const isBrowse = ((window._currentRouteHash || window.location.hash || '').match(/^#(browse|research|search)$/));
  const trayContentView = _islandBuildTray(activity, isBrowse);
  var trayWrapView = new V('div').className('island-ctx-tray');
  if (trayContentView) {
    trayWrapView.add(trayContentView);
  } else {
    var fallbackText = (typeLabels[activity.type] || activity.type) + (activity.label ? ' \u2014 ' + activity.label : '');
    if (activity.detail) fallbackText += '\n' + activity.detail;
    trayWrapView.add(T(fallbackText).styles({ padding: '8px', opacity: '0.4', fontSize: '0.72rem', whiteSpace: 'pre-line' }));
  }
  var cardView = new V('div').className('island-detail-card').add(headerView, trayWrapView);
  const card = cardView.build();
  document.body.appendChild(card);
  // Position below pill, clamped to viewport edges
  const pillRect = pill.getBoundingClientRect();
  let left = pillRect.left + pillRect.width / 2 - card.offsetWidth / 2;
  let top = pillRect.bottom + 8;
  // Clamp to viewport
  if (left < 8) left = 8;
  if (left + card.offsetWidth > window.innerWidth - 8) left = window.innerWidth - card.offsetWidth - 8;
  if (top + card.offsetHeight > window.innerHeight - 8) top = pillRect.top - card.offsetHeight - 8;
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  // Animate in
  Motion.animate(card, { spring: 'smooth', from: { opacity: 0, scale: 0.92, y: -8 }, to: { opacity: 1, scale: 1, y: 0 } });
  _activeDetailCard = card;
  // Attach click handlers on the card's interactive elements
  card.onclick = function(e) {
    _islandHandleTrayClicks(e, pill, activity);
  };
  // Close on outside click (deferred so this click doesn't close it)
  setTimeout(function() {
    document.addEventListener('mousedown', function _detailOutside(e) {
      if (_activeDetailCard && !_activeDetailCard.contains(e.target) && !pill.contains(e.target)) {
        document.removeEventListener('mousedown', _detailOutside);
        _islandCloseDetailCard();
      }
    });
  }, 10);
}

// Handle clicks on tray interactive elements (shared between pill onclick and detail card)
function _islandHandleTrayClicks(e, pill, a) {
  const dismissEl = e.target.closest('[data-island-dismiss]');
  if (dismissEl) {
    e.stopPropagation();
    const dismissId = dismissEl.getAttribute('data-island-dismiss');
    const act = window._islandActivities.value[dismissId];
    if (act && act.dismiss) act.dismiss();
    else islandRemove(dismissId);
    return true;
  }
  const tabCloseBtn = e.target.closest('[data-island-tab-close]');
  if (tabCloseBtn) {
    e.stopPropagation();
    const closeTabId = +tabCloseBtn.getAttribute('data-island-tab-close');
    if (typeof browseCloseTab === 'function') browseCloseTab(closeTabId);
    return true;
  }
  const tabNewBtn = e.target.closest('[data-island-tab-new]');
  if (tabNewBtn) {
    e.stopPropagation();
    if (typeof browseNewTab === 'function') browseNewTab();
    pill.classList.remove('island-tray-open');
    return true;
  }
  const tabItem = e.target.closest('[data-island-tab]');
  if (tabItem) {
    e.stopPropagation();
    const tabId = +tabItem.getAttribute('data-island-tab');
    if (typeof browseSelectTab === 'function') browseSelectTab(tabId);
    pill.classList.remove('island-tray-open');
    return true;
  }
  const rateGoodBtn = e.target.closest('[data-ann-rate-good]');
  const rateBadBtn = e.target.closest('[data-ann-rate-bad]');
  if (rateGoodBtn || rateBadBtn) {
    e.stopPropagation();
    const rIdx = +(rateGoodBtn || rateBadBtn).getAttribute(rateGoodBtn ? 'data-ann-rate-good' : 'data-ann-rate-bad');
    const rRating = rateGoodBtn ? 'good' : 'bad';
    const rAnn = a.items && a.items[rIdx];
    if (rAnn) {
      let rUrl = '';
      let rTitle = '';
      if (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
        const rTab = _browseTabs.find(function(t) { return t.id === _browseActiveTab; });
        if (rTab) { rUrl = rTab.url || ''; rTitle = rTab.title || ''; }
      }
      apiPost('/api/annotation-feedback', { quote: rAnn.quote || '', explanation: rAnn.explanation || '', annType: rAnn.type || '', rating: rRating, url: rUrl, pageTitle: rTitle })
        .catch(function() {});
      const rBtn = rateGoodBtn || rateBadBtn;
      rBtn.style.opacity = '1';
      rBtn.style.color = rateGoodBtn ? '#4caf50' : '#ef5350';
      AetherUI.mount(window.RawHTML(icon('check', { size: 12, strokeWidth: '2.5' })), rBtn);
    }
    return true;
  }
  const annItem = e.target.closest('[data-island-ann]');
  if (annItem) {
    e.stopPropagation();
    const annUrl = annItem.getAttribute('data-island-ann-url');
    if (annUrl && typeof browseNewTab === 'function') {
      browseNewTab(annUrl);
    } else {
      const annIdx = +annItem.getAttribute('data-island-ann');
      if (typeof scrollToAnnotation === 'function') scrollToAnnotation(annIdx);
    }
    return true;
  }
  const dlClear = e.target.closest('[data-island-dl-clear]');
  if (dlClear) {
    e.stopPropagation();
    if (typeof clearBrowseDownloads === 'function') clearBrowseDownloads();
    islandRemove('download');
    return true;
  }
  const dlRemove = e.target.closest('[data-island-dl-remove]');
  if (dlRemove) {
    e.stopPropagation();
    var dlId = dlRemove.getAttribute('data-island-dl-remove');
    if (typeof removeBrowseDownload === 'function') removeBrowseDownload(dlId);
    return true;
  }
  const dlItem = e.target.closest('[data-island-dl]');
  if (dlItem) {
    e.stopPropagation();
    var dlId = dlItem.getAttribute('data-island-dl');
    if (typeof openDownloadFile === 'function') openDownloadFile(dlId);
    return true;
  }
  return false;
}

// Attach click handlers and gesture behavior to pill
export function _islandAttachHandlers(pill, a, hasTray) {
  // Click handler for tray interactive elements
  pill.onclick = function(e) {
    if (_islandHandleTrayClicks(e, pill, a)) return;
    // If we get here and it's a direct click (not from gesture), handle action
    if (a.action && !pill._islandGestureHandled) a.action();
    pill._islandGestureHandled = false;
  };
  pill.style.cursor = 'pointer';

  // Unified gesture handler: mousedown disambiguates tap / long-press / drag
  if (!pill._islandGestureBound) {
    pill._islandGestureBound = true;
    const MOVE_THRESHOLD = 5;
    const LONG_PRESS_MS = 500;
    const DISMISS_DIST = 40;

    pill.addEventListener('mousedown', function(e) {
      // Skip if clicking on tray interactive elements
      if (e.target.closest('[data-island-tab], [data-island-tab-close], [data-island-tab-new], [data-island-dismiss], [data-island-dl], [data-island-dl-clear], [data-island-dl-remove], [data-ann-rate-good], [data-ann-rate-bad], [data-island-ann]')) return;
      if (e.button !== 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      let longPressTimer = null;
      const id = pill.getAttribute('data-island-id');
      const currentActivity = window._islandActivities.value[id] || a;

      // Start long-press timer
      pill.classList.add('island-pressing');
      longPressTimer = setTimeout(function() {
        longPressTimer = null;
        pill.classList.remove('island-pressing');
        // Long-press fired — show detail card
        pill._islandGestureHandled = true;
        cleanup();
        _islandShowDetailCard(pill, currentActivity);
      }, LONG_PRESS_MS);

      function onMouseMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isDragging && dist >= MOVE_THRESHOLD) {
          // Switch to drag mode — cancel long-press
          isDragging = true;
          pill.classList.remove('island-pressing');
          if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
          pill.classList.add('island-dragging');
          // Close tray if open
          pill.classList.remove('island-tray-open');
        }

        if (isDragging) {
          const tilt = (dx / 100) * 8;
          const opacity = Math.max(0.2, 1 - dist / 120);
          pill.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + tilt + 'deg)';
          pill.style.opacity = opacity;
        }
      }

      function onMouseUp(ev) {
        cleanup();
        pill.classList.remove('island-pressing');
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

        if (isDragging) {
          pill._islandGestureHandled = true;
          pill.classList.remove('island-dragging');
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist >= DISMISS_DIST) {
            // Dismiss: fly away in drag direction
            const angle = Math.atan2(dy, dx);
            const flyX = Math.cos(angle) * 200;
            const flyY = Math.sin(angle) * 200;
            pill.style.pointerEvents = 'none';
            Motion.animate(pill, {
              spring: 'snappy',
              to: { x: flyX, y: flyY, opacity: 0, scale: 0.5 }
            }).onFinish(function() {
              islandRemove(id);
            });
          } else {
            // Snap back
            Motion.animate(pill, {
              spring: 'bouncy',
              from: { x: parseFloat(pill.style.transform.match(/translate\(([-\d.]+)px/)?.[1]) || 0, y: parseFloat(pill.style.transform.match(/, ([-\d.]+)px/)?.[1]) || 0, rotate: parseFloat(pill.style.transform.match(/rotate\(([-\d.]+)deg/)?.[1]) || 0 },
              to: { x: 0, y: 0, rotate: 0 }
            });
            pill.style.opacity = '';
            pill.style.transform = '';
          }
        } else {
          // Tap — toggle tray or execute action
          pill.style.transform = '';
          pill.style.opacity = '';
          _islandHandleTap(pill, currentActivity, hasTray);
        }
      }

      function cleanup() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Close tray on outside click (debounced so tray interactions aren't swallowed)
    document.addEventListener('mousedown', function(e) {
      if (!pill.contains(e.target) && pill.classList.contains('island-tray-open')) {
        // Small delay: let click targets inside the tray process first
        setTimeout(function() {
          if (!pill.contains(document.activeElement)) {
            pill.classList.remove('island-tray-open');
          }
        }, 80);
      }
    });
    // Close on window blur (webview focus) — debounced to avoid premature close
    var _blurCloseTimer = 0;
    window.addEventListener('blur', function() {
      clearTimeout(_blurCloseTimer);
      _blurCloseTimer = setTimeout(function() {
        pill.classList.remove('island-tray-open');
      }, 300);
    });
    window.addEventListener('focus', function() {
      clearTimeout(_blurCloseTimer);
    });
  }
}

// Handle tap action for pill — click-to-toggle tray for all types
function _islandHandleTap(pill, a, hasTray) {
  if (hasTray) {
    if (a.type === 'tabs') {
      // Tabs pill in island mode: use connected pill dropdown
      if (typeof _showTabsInPillDropdown === 'function') {
        const pillDd = document.getElementById('pill-url-dropdown');
        const pillWrap = document.getElementById('pill-url-wrap');
        if (pillDd && pillWrap && pillWrap.classList.contains('pill-dropdown-open') && pillDd.querySelector('[data-pill-tab-switch]')) {
          if (typeof _browseUrlHideHistory === 'function') _browseUrlHideHistory();
        } else {
          _showTabsInPillDropdown();
        }
        return;
      }
    }
    // All tray types: click-to-toggle
    if (pill._islandAutoClose) { clearTimeout(pill._islandAutoClose); pill._islandAutoClose = null; }
    pill.classList.toggle('island-tray-open');
  } else if (a.action) {
    a.action();
  }
}

// FLIP-animate neighboring pills when one enters/exits/compacts
export function _islandFlipNeighbors(cont) {
  if (!cont) return;
  const pills = cont.querySelectorAll('.pill-island:not(.island-exiting)');
  pills.forEach(function(p) {
    if (p.classList.contains('island-entering')) return;
    if (!p._flipRect) return;
    const newRect = p.getBoundingClientRect();
    const dx = p._flipRect.left - newRect.left;
    if (Math.abs(dx) > 1) {
      Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
    }
  });
}

// Snapshot pill positions for FLIP
export function _islandSnapshotRects(cont) {
  if (!cont) return;
  cont.querySelectorAll('.pill-island').forEach(function(p) {
    p._flipRect = p.getBoundingClientRect();
  });
}

export function _islandRender() {
  _islandInitGuard();
  const container = document.getElementById('pill-island');
  if (!container) return;
  const rightContainer = document.getElementById('pill-island-right');

  let ids = Object.keys(window._islandActivities.value);

  // Filter out 'ai' and 'insight' types — they render inside the unified AI pill now
  ids = ids.filter(function(id) {
    const a = window._islandActivities.value[id];
    if (!a) return false;
    if (a.type === 'ai') return false;
    if (a.type === 'insight') return false;
    return true;
  });
  // Trigger unified pill re-render so it picks up the ai/insight data
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();

  if (!ids.length) {
    container.innerHTML = '';
    if (rightContainer) rightContainer.innerHTML = '';
    return;
  }

  // Pinned pills always first (far left): tabs → nowplaying
  const pinnedLeft = [];
  ['tabs', 'nowplaying'].forEach(function(pid) {
    const idx = ids.indexOf(pid);
    if (idx !== -1) { ids.splice(idx, 1); pinnedLeft.push(pid); }
  });
  const priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, ai: 3, rss: 2.6, bookmark: 2.55, insight: 2.5, 'feed-notif': 2, audio: 2, qf: 2, pageinfo: 1.5, feed: 1, context: 0 };
  ids.sort(function(a, b) {
    const pa = priority[window._islandActivities.value[a].type] || 0;
    const pb = priority[window._islandActivities.value[b].type] || 0;
    return pb - pa || window._islandActivities.value[b]._ts - window._islandActivities.value[a]._ts;
  });
  ids = pinnedLeft.concat(ids);

  // ── Auto-stack grouping ──
  // Eligible pills: non-tabs, non-nowplaying pills destined for left container
  const isIslandModeCheck = document.getElementById('sidebar-nav') && document.getElementById('sidebar-nav').classList.contains('island-mode');
  const stackEligible = ids.filter(function(id) { return id !== 'tabs' && id !== 'nowplaying' && id !== 'bookmark'; });
  const shouldStack = stackEligible.length >= 3 && !window._islandStackExpanded;
  // IDs to actually render (if stacked, only show top pill as stack + hide others)
  let stackedIds = null; // set of IDs hidden in stack
  let stackTopId = null; // the visible pill representing the stack
  if (shouldStack) {
    stackTopId = stackEligible[0]; // highest priority
    stackedIds = new Set(stackEligible.slice(1));
  }
  // If stack was just expanded, remove the old stack element
  const oldStackEl = container.querySelector('.pill-island[data-island-id="_stack"]');
  if (oldStackEl && !shouldStack) {
    _islandSnapshotRects(container);
    oldStackEl.classList.add('island-exiting');
    oldStackEl.addEventListener('animationend', function onExit(ev) {
      if (ev.animationName !== 'pill-exit') return;
      oldStackEl.removeEventListener('animationend', onExit);
      oldStackEl.remove();
      _islandFlipNeighbors(container);
    });
  }

  // Build pills — reuse existing DOM elements where possible
  const existingEls = {};
  container.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
    existingEls[el.getAttribute('data-island-id')] = el;
  });
  // Also check the tabs anchor (tabs pill may live there in island mode)
  const _tabsAnchorEl = document.getElementById('pill-island-tabs-anchor');
  if (_tabsAnchorEl) {
    _tabsAnchorEl.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
      existingEls[el.getAttribute('data-island-id')] = el;
    });
  }
  // Also check right overflow container
  if (rightContainer) {
    rightContainer.querySelectorAll('.pill-island[data-island-id]').forEach(function(el) {
      existingEls[el.getAttribute('data-island-id')] = el;
    });
  }

  ids.forEach(function(id) {
    const a = window._islandActivities.value[id];
    let pill = existingEls[id];
    const isNew = !pill;
    if (isNew) {
      const gooBg = window.VStack(
        new window.View('div').className('goo-shape goo-pill-shape'),
        new window.View('div').className('goo-shape goo-tray-shape')
      ).className('pill-goo-bg');
      const compactDiv = new window.View('div').className('pill-island-content');
      const itemsTray = new window.View('div').className('island-ctx-tray');
      const pillView = window.VStack(gooBg, compactDiv, itemsTray).className('pill-island');
      pillView.attr('data-island-id', id);
      pill = pillView.el;
    }
    delete existingEls[id];
    const compact = pill.querySelector('.pill-island-content');
    const tray = pill.querySelector('.island-ctx-tray');
    // Render pill as a View and mount into compact container
    const pillView = _islandRenderPill(a);
    AetherUI.mount(pillView, compact);
    // Download completion burst
    if (a.type === 'download' && a.progress >= 100 && !pill._dlCompleteFired) {
      pill._dlCompleteFired = true;
      pill.classList.add('download-complete');
      pill.addEventListener('animationend', function() { pill.classList.remove('download-complete'); }, { once: true });
    } else if (a.type === 'download' && a.progress < 100) {
      pill._dlCompleteFired = false;
    }
    // Fill items tray for context / download pills
    if (tray) {
      const isBrowse = ((window._currentRouteHash || window.location.hash || '').match(/^#(browse|research|search)$/));
      const trayView = _islandBuildTray(a, isBrowse);
      if (trayView) { AetherUI.mount(trayView, tray); } else { tray.innerHTML = ''; }
    }
    const hasItems = !!(a.items && a.items.length);
    const hasTray = (hasItems && (a.type === 'context' || a.type === 'download' || a.type === 'tabs' || a.type === 'insight')) || a.type === 'achievement' || a.type === 'pulse' || a.type === 'pageinfo' || (a.type === 'insight' && a._paper && a._paperState);
    pill.classList.toggle('island-context', a.type === 'context');
    pill.classList.toggle('island-download-pill', a.type === 'download');
    pill.classList.toggle('island-tabs-pill', a.type === 'tabs');
    pill.classList.toggle('island-has-items', hasTray);
    // Apply custom cssClass from activity data (e.g., nr-glow for achievements)
    if (a.cssClass) pill.classList.add(a.cssClass);

    // Attach event handlers
    _islandAttachHandlers(pill, a, hasTray);

    // ── Auto-stack: hide stacked pills, mark top pill as stack ──
    if (stackedIds && stackedIds.has(id)) {
      pill.style.display = 'none';
      pill.classList.remove('island-active');
    } else {
      pill.style.display = '';
      if (shouldStack && id === stackTopId) {
        pill.classList.add('island-stack');
        // Add or update +N badge
        let badge = pill.querySelector('.island-stack-badge');
        if (!badge) {
          badge = new window.View('span').className('island-stack-badge').build();
          const content = pill.querySelector('.pill-island-content');
          if (content) content.appendChild(badge);
        }
        badge.textContent = '+' + stackedIds.size;
        // Click stack to expand
        if (!pill._stackClickBound) {
          pill._stackClickBound = true;
          pill.addEventListener('click', function _stackClick(e) {
            if (!pill.classList.contains('island-stack')) return;
            e.stopPropagation();
            _islandSnapshotRects(container);
            window._islandStackExpanded = true;
            _islandRender();
            _islandFlipNeighbors(container);
          });
        }
      } else {
        pill.classList.remove('island-stack');
        const oldBadge = pill.querySelector('.island-stack-badge');
        if (oldBadge) oldBadge.remove();
      }
    }

    // Sync goo tray dimensions with actual tray content
    if (hasTray && tray && tray.innerHTML) {
      const syncGoo = function() {
        // Measure actual tray content height from children
        let h = 0;
        for (let ci = 0; ci < tray.children.length; ci++) {
          h += tray.children[ci].offsetHeight;
        }
        if (tray.children.length > 1) h += (tray.children.length - 1) * 1; // 1px gap
        h += 12; // tray padding (6px top + 6px bottom)
        let w = 0;
        for (let wi = 0; wi < tray.children.length; wi++) {
          const cw = tray.children[wi].offsetWidth;
          if (cw > w) w = cw;
        }
        w += 12; // tray padding
        if (h > 0) pill.style.setProperty('--goo-tray-h', h + 'px');
        if (w > 0) pill.style.setProperty('--goo-tray-w', w + 'px');
      };
      if (!pill._gooSyncBound) {
        pill._gooSyncBound = true;
        const obs = new MutationObserver(function() {
          if (pill.classList.contains('island-tray-open')) {
            setTimeout(function() { requestAnimationFrame(syncGoo); }, 50);
          }
        });
        obs.observe(pill, { attributes: true, attributeFilter: ['class'] });
      }
      requestAnimationFrame(syncGoo);
    }

    // Animate in
    const tabsAnchor = document.getElementById('pill-island-tabs-anchor');
    const isIslandMode = document.getElementById('sidebar-nav') && document.getElementById('sidebar-nav').classList.contains('island-mode');
    const targetContainer = (id === 'tabs' && isIslandMode && tabsAnchor) ? tabsAnchor : container;
    if (isNew) {
      // Pre-apply compact before entering so animation targets compact size
      if ((a.type === 'rss' && a.subscribed) || (a.type === 'insight' && !a.loading && !a.done && a._compact)) {
        pill.classList.add('island-compact');
      }
      // Snapshot neighbors before insert so FLIP can animate them
      _islandSnapshotRects(targetContainer);
      targetContainer.appendChild(pill);
      pill.classList.add('island-entering');
      const _enterAnims = { 'pill-enter': 1, 'pill-enter-browse': 1, 'pill-enter-compact': 1, 'pill-enter-anchor': 1 };
      pill.addEventListener('animationend', function onEnter(ev) {
        if (!_enterAnims[ev.animationName]) return;
        pill.removeEventListener('animationend', onEnter);
        pill.classList.remove('island-entering');
        pill.classList.add('island-active');
        // After entering, FLIP neighboring pills that shifted
        _islandFlipNeighbors(targetContainer);
      });
      // Achievement: auto-expand tray then collapse after delay
      if (a.type === 'achievement') {
        pill.classList.add('island-tray-open');
        pill._islandAutoClose = setTimeout(function() {
          pill.classList.remove('island-tray-open');
          pill._islandAutoClose = null;
        }, 7000);
      }
    } else {
      // Move tabs pill to correct container if needed (e.g. mode switch) — FLIP animate
      if (pill.parentNode !== targetContainer) {
        const oldRect = pill.getBoundingClientRect();
        targetContainer.appendChild(pill);
        const newRect = pill.getBoundingClientRect();
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          Motion.animate(pill, { spring: 'snappy', from: { x: dx, y: dy }, to: { x: 0, y: 0 } });
        }
      }
      pill.classList.add('island-active');
    }

    // Auto-dismiss on done — stagger so pills collapse one by one
    // Never auto-dismiss insight pill (it's always-on, user clicks to annotate)
    if (a.done && !window._islandDismissTimers[id] && a.type !== 'insight') {
      const baseDelay = a.type === 'achievement' ? 5000 : a.type === 'feed-notif' ? 10000 : 2500;
      const pendingCount = Object.keys(window._islandDismissTimers).length;
      const stagger = pendingCount * 500;
      window._islandDismissTimers[id] = setTimeout(function() {
        islandRemove(id);
      }, baseDelay + stagger);
    }

    // RSS: icon-only when subscribed immediately, otherwise collapse after 15s
    if (a.type === 'rss' && a.subscribed) {
      if (pill._rssCompactTimer) { clearTimeout(pill._rssCompactTimer); pill._rssCompactTimer = null; }
      if (!pill.classList.contains('island-compact')) {
        _islandSnapshotRects(targetContainer);
        pill.classList.add('island-compact');
        _islandFlipNeighbors(targetContainer);
      }
    } else if (a.type === 'rss') {
      if (!pill._rssCompactTimer && !pill.classList.contains('island-compact')) {
        pill._rssCompactTimer = setTimeout(function() {
          _islandSnapshotRects(targetContainer);
          pill.classList.add('island-compact');
          _islandFlipNeighbors(targetContainer);
        }, 15000);
      }
    }

    // Insight: compact to icon-only after 15s
    if (a.type === 'insight' && !a.loading && !a.done) {
      if (!pill._annCompactTimer) {
        pill._annCompactTimer = setTimeout(function() {
          _islandSnapshotRects(targetContainer);
          pill.classList.add('island-compact');
          _islandFlipNeighbors(targetContainer);
        }, 15000);
      }
    } else if (a.type === 'insight' && (a.loading || a.done)) {
      if (pill._annCompactTimer) { clearTimeout(pill._annCompactTimer); pill._annCompactTimer = null; }
      if (pill.classList.contains('island-compact')) {
        _islandSnapshotRects(targetContainer);
        pill.classList.remove('island-compact');
        _islandFlipNeighbors(targetContainer);
      }
    }
  });

  // Remove stale pills (with exit animation + FLIP neighbors)
  let hasStale = false;
  Object.keys(existingEls).forEach(function(id) {
    const staleEl = existingEls[id];
    if (!staleEl.classList.contains('island-exiting')) {
      const staleCont = staleEl.parentNode;
      if (!hasStale) { _islandSnapshotRects(container); if (rightContainer) _islandSnapshotRects(rightContainer); hasStale = true; }
      staleEl.classList.add('island-exiting');
      staleEl.addEventListener('animationend', function onExit(ev) {
        if (ev.animationName !== 'pill-exit') return;
        staleEl.removeEventListener('animationend', onExit);
        _islandSnapshotRects(staleCont);
        staleEl.remove();
        _islandFlipNeighbors(staleCont);
      });
    }
  });

  // Phase 7: FLIP reordering — capture positions before reorder
  const rects = {};
  container.querySelectorAll('.pill-island').forEach(function(p) {
    const pid = p.getAttribute('data-island-id');
    if (pid) rects[pid] = p.getBoundingClientRect();
  });

  // Force DOM order to match sorted ids — always tabs first (skip tabs pill if in anchor)
  const sortedPills = ids.filter(function(id) {
    // Don't reorder tabs pill if it's in the anchor container
    if (id === 'tabs' && _tabsAnchorEl && _tabsAnchorEl.querySelector('.pill-island[data-island-id="tabs"]')) return false;
    return true;
  }).map(function(id) {
    return container.querySelector('.pill-island[data-island-id="' + id + '"]');
  }).filter(Boolean);
  for (let si = 0; si < sortedPills.length; si++) {
    container.appendChild(sortedPills[si]);
  }

  // FLIP: animate from old to new position
  sortedPills.forEach(function(p) {
    const pid = p.getAttribute('data-island-id');
    if (!rects[pid]) return;
    const dx = rects[pid].left - p.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) {
      Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
    }
  });

  // Proximity detection: move overflow pills to right side of URL capsule
  const urlWrap = document.getElementById('pill-url-wrap');
  const isIslandNow = document.getElementById('sidebar-nav') && document.getElementById('sidebar-nav').classList.contains('island-mode');
  // Trigger unified AI pill render
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
  var islandMerged = container.closest('#pill-url-wrap') !== null;
  if (urlWrap && isIslandNow && rightContainer && !islandMerged) {
    const urlRect = urlWrap.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    // 12px gap between pills and URL capsule
    const availW = urlRect.left - contRect.left - 12;
    if (availW > 0) {
      container.style.setProperty('--island-pills-max-w', Math.floor(availW) + 'px');
    }
    // Constrain right container too — don't overlap right-side buttons (mic, more, new-window)
    const navBar = document.getElementById('sidebar-nav');
    const navRect = navBar ? navBar.getBoundingClientRect() : { right: window.innerWidth };
    // Measure width of right-side buttons so pills sit to their left
    let rightBtnsW = 0;
    ['pill-ai-unified', 'pill-browse-more', 'pill-browse-hamburger'].forEach(function(bid) {
      const b = document.getElementById(bid);
      if (b && b.offsetWidth > 0) rightBtnsW += b.offsetWidth + 2; // + gap
    });
    rightBtnsW += 8; // right padding
    rightContainer.style.setProperty('--island-right-offset', rightBtnsW + 'px');
    var hamburgerEl = document.getElementById('pill-browse-hamburger');
    var hamburgerW = (hamburgerEl && hamburgerEl.offsetWidth > 0) ? hamburgerEl.offsetWidth : 0;
    var pillBar = document.getElementById('sidebar-nav');
    if (pillBar) {
      pillBar.style.setProperty('--island-hamburger-right', '0px');
      pillBar.style.setProperty('--island-ai-right', (hamburgerW + 4) + 'px');
    }
    const rightAvail = navRect.right - urlRect.right - 20; // 12px gap + 8px right padding
    if (rightAvail > 0) {
      rightContainer.style.setProperty('--island-pills-right-max-w', Math.floor(rightAvail - rightBtnsW) + 'px');
    }
    // Check each pill — if it clips or goes past the URL capsule, move to right container
    const leftPills = Array.from(container.querySelectorAll('.pill-island:not(.island-exiting)'));
    leftPills.forEach(function(p) {
      const pr = p.getBoundingClientRect();
      const dist = urlRect.left - pr.right;
      // Pill clips the URL capsule (right edge past URL left edge minus gap)
      if (dist < 4) {
        const oldRect = p.getBoundingClientRect();
        rightContainer.appendChild(p);
        const newRect = p.getBoundingClientRect();
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          Motion.animate(p, { spring: 'snappy', from: { x: dx, y: dy }, to: { x: 0, y: 0 } });
        }
      }
      p.classList.toggle('near-url-bar', dist >= 0 && dist < 60);
    });
    // Find the left edge of the first visible right-side button
    let rightBoundary = navRect.right - 4;
    ['pill-ai-unified', 'pill-browse-more', 'pill-browse-hamburger'].forEach(function(bid) {
      const b = document.getElementById(bid);
      if (b && b.offsetWidth > 0) {
        const br = b.getBoundingClientRect();
        if (br.left < rightBoundary) rightBoundary = br.left;
      }
    });
    rightBoundary -= 6; // gap before buttons

    // Compact/expand right-side pills based on clipping
    const rightPills = Array.from(rightContainer.querySelectorAll('.pill-island:not(.island-exiting)'));
    rightPills.forEach(function(p) {
      const pr = p.getBoundingClientRect();
      if (pr.right > rightBoundary && !p.classList.contains('island-compact')) {
        p.classList.add('island-compact');
      } else if (pr.right <= rightBoundary - 40 && p.classList.contains('island-compact') && !p._userCompacted) {
        // Expand back if there's enough room (40px headroom)
        p.classList.remove('island-compact');
      }
    });

    // Move pills back to left container if there's now room
    if (rightPills.length > 0) {
      // Recalculate how much space is left
      const lastLeft = container.querySelector('.pill-island:last-child');
      const leftEdge = lastLeft ? lastLeft.getBoundingClientRect().right + 4 : contRect.left;
      let spaceLeft = urlRect.left - leftEdge - 12;
      rightPills.forEach(function(p) {
        const pw = p.getBoundingClientRect().width;
        if (pw > 0 && spaceLeft >= pw) {
          const oldRect = p.getBoundingClientRect();
          p.classList.remove('island-compact');
          container.appendChild(p);
          const newRect = p.getBoundingClientRect();
          const dx = oldRect.left - newRect.left;
          if (Math.abs(dx) > 1) {
            Motion.animate(p, { spring: 'snappy', from: { x: dx }, to: { x: 0 } });
          }
          spaceLeft -= (pw + 4);
        }
      });
    }
  } else {
    container.style.removeProperty('--island-pills-max-w');
    // Not in island mode — move any right-side pills back to main container
    if (rightContainer) {
      const strandedPills = Array.from(rightContainer.querySelectorAll('.pill-island'));
      strandedPills.forEach(function(p) { container.appendChild(p); });
    }
  }

  // ── Stack collapse on outside click ──
  if (window._islandStackExpanded && !shouldStack) {
    // Stack was expanded and pills fanned out — listen for outside click to collapse
    if (!container._stackCollapseHandler) {
      container._stackCollapseHandler = function _collapseStack(e) {
        if (!container.contains(e.target)) {
          document.removeEventListener('mousedown', _collapseStack);
          container._stackCollapseHandler = null;
          _islandSnapshotRects(container);
          window._islandStackExpanded = false;
          _islandRender();
          _islandFlipNeighbors(container);
        }
      };
      // Defer to avoid triggering on the click that expanded
      setTimeout(function() {
        if (container._stackCollapseHandler) {
          document.addEventListener('mousedown', container._stackCollapseHandler);
        }
      }, 10);
    }
  }

  // Sync pill-island position (inside capsule vs pill bar) after all pills placed
  if (typeof _syncIslandPillPosition === 'function') _syncIslandPillPosition();
}

// Re-check right-side pill clipping on resize
window.addEventListener('resize', function() {
  clearTimeout(window._islandResizeTimer);
  window._islandResizeTimer = setTimeout(function() {
    if (Object.keys(window._islandActivities.value).length) _islandRender();
  }, 100);
});

// ── Now Playing context pill (removed — not useful) ──
export function _updateNowPlayingContext() {
  islandRemove('nowplaying');
}

// ── Content safe bounds for popups ──