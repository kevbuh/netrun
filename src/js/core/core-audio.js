// core-audio.js — Audio pill
// Extracted from core.js
if (window.AetherUI) AetherUI.globals();

// ── Unified Audio Pill ──

function _pillNoiseCycle() {
  const types = typeof NOISE_PRESETS !== 'undefined' ? Object.keys(NOISE_PRESETS) : [];
  if (!types.length) return;
  const cur = typeof _rainNoiseType !== 'undefined' ? _rainNoiseType : 'rain';
  const idx = types.indexOf(cur);
  const next = types[(idx + 1) % types.length];
  setRainNoiseType(next);
}

function _ttsCycleSpeed() {
  const cur = parseFloat(Settings.get('ttsSpeed')) || 1;
  let next = _ttsSpeeds[0];
  for (let i = 0; i < _ttsSpeeds.length; i++) {
    if (_ttsSpeeds[i] > cur + 0.01) { next = _ttsSpeeds[i]; break; }
    if (i === _ttsSpeeds.length - 1) next = _ttsSpeeds[0];
  }
  Settings.set('ttsSpeed', next);
  if (typeof _ttsAudio !== 'undefined' && _ttsAudio) _ttsAudio.playbackRate = next;
  _renderAudioPill();
  const valEl = document.getElementById('tts-speed-val');
  if (valEl) valEl.textContent = next + 'x';
  const slider = document.querySelector('input[oninput*="ttsSpeed"]');
  if (slider) slider.value = next;
}

function _updateAudioUnified(source, data) {
  _audioUnifiedState[source] = data;
  _renderAudioPill();
}

function _clearAudioUnified(source) {
  _audioUnifiedState[source] = null;
  _renderAudioPill();
}

function _renderAudioPill() {
  const el = document.getElementById('pill-audio-unified');
  if (!el) return;
  const tab = _audioUnifiedState.tab;
  const tts = _audioUnifiedState.tts;
  const cc = _audioUnifiedState.cc;
  const mic = _audioUnifiedState.mic;
  var micRecording = typeof _pillMicRecorder !== 'undefined' && _pillMicRecorder;
  const rainActive = typeof _rainOn !== 'undefined' && _rainOn;
  const active = !!(tab || tts || cc || mic || micRecording || rainActive);

  // Build pill indicator
  let indicator = el.querySelector('.audio-pill-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'audio-pill-indicator';
    el.appendChild(indicator);
  }

  if (micRecording) {
    AetherUI.mount(RawHTML(icon('microphone', { size: 14, stroke: '#ef4444' })), indicator);
    indicator.classList.add('audio-pill-active', 'nr-breathe');
    indicator.classList.remove('audio-pill-idle');
  } else if (active) {
    AetherUI.mount(RawHTML(_islandAudioBars), indicator);
    indicator.classList.add('audio-pill-active');
    indicator.classList.remove('audio-pill-idle', 'nr-breathe');
  } else {
    AetherUI.mount(new View('span').className('audio-pill-dot'), indicator);
    indicator.classList.remove('audio-pill-active', 'nr-breathe');
    indicator.classList.add('audio-pill-idle');
  }

  // Build dropdown
  let dropdown = el.querySelector('.audio-pill-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'audio-pill-dropdown';
    el.appendChild(dropdown);
  }

  function _audioBtn(iconName, label, action, opts) {
    opts = opts || {};
    var btn = new View('button');
    btn._appendChildren([RawHTML(icon(iconName, opts.iconOpts || { size: 14 }))]);
    btn._appendChildren([Text(' ' + label)]);
    if (opts.trailing) btn._appendChildren([opts.trailing]);
    if (opts.color) btn.style('color', opts.color);
    if (opts.disabled) btn.el.disabled = true;
    btn.onTap(function(e) { if (opts.stopProp) e.stopPropagation(); if (action) action(); });
    return btn;
  }

  var items = [];

  // Tab audio source
  if (tab) {
    var tabBtn = new View('button');
    tabBtn._appendChildren([RawHTML(_islandAudioBars), Text(' ' + escapeHtml(tab.label || 'Tab Audio'))]);
    tabBtn.onTap(function() { if (typeof goToAudioTab === 'function') goToAudioTab(); });
    items.push(tabBtn);
  }

  // TTS status
  if (tts) {
    var spdText = (parseFloat(Settings.get('ttsSpeed')) || 1).toFixed(1).replace(/\.0$/, '') + 'x';
    var spdSpan = new View('span').style('margin-left', 'auto').style('font-size', '0.7rem').style('opacity', '0.5')._bindText(spdText);
    items.push(_audioBtn(tts.paused ? 'play' : 'pause', tts.paused ? 'Resume TTS' : 'Pause TTS', function() { _ttsPauseResume(); _renderAudioPill(); }, { color: 'var(--nr-accent)', trailing: spdSpan }));
    items.push(_audioBtn('close', 'Stop TTS', function() { _ttsStopAll(); _renderAudioPill(); }));
  }

  // CC row
  if (cc) {
    items.push(_audioBtn('cc', escapeHtml(cc.label || 'CC'), function() { if (typeof toggleCaptions === 'function') toggleCaptions(); }, { color: 'var(--nr-accent)' }));
  } else if (tab) {
    items.push(_audioBtn('cc', 'Captions', function() { if (typeof toggleCaptions === 'function') toggleCaptions(); }));
  }

  // Mic
  if (micRecording) {
    items.push(_audioBtn('microphone', 'Stop recording', function() { _pillMicClick(); }, { color: '#ef4444', iconOpts: { size: 14, stroke: '#ef4444' } }));
  } else if (mic) {
    items.push(_audioBtn('microphone', escapeHtml(mic.label || 'Transcribing\u2026'), null, { disabled: true }));
  } else {
    items.push(_audioBtn('microphone', 'Voice input', function() { _pillMicClick(); }));
  }

  // White noise
  if (rainActive) {
    var noiseLabel = (typeof NOISE_PRESETS !== 'undefined' && typeof _rainNoiseType !== 'undefined' && NOISE_PRESETS[_rainNoiseType]) ? NOISE_PRESETS[_rainNoiseType].label : 'White noise';
    items.push(_audioBtn('rain', escapeHtml(noiseLabel), function() { _pillNoiseCycle(); _renderAudioPill(); }, { color: 'var(--nr-accent)', stopProp: true }));
    items.push(_audioBtn('close', 'Stop noise', function() { stopRain(); _renderAudioPill(); }));
  } else {
    items.push(_audioBtn('rain', 'White noise', function() { startRain(); _renderAudioPill(); }));
  }

  // Read aloud
  items.push(_audioBtn('speaker', 'Read aloud', function() { _readPageAloud(); }));

  AetherUI.mount(VStack(items), dropdown);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _renderAudioPill);
else setTimeout(_renderAudioPill, 0);

function _islandRenderPill(a) {
  if (a.type === 'feed-notif') {
    return icon('bell', { size: 14, stroke: 'var(--nr-accent)' }) + '<span style="color:var(--nr-accent)">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.done) {
    return '<span class="island-dot-done"></span><span style="color:#22c55e">' + escapeHtml(a.label || 'Done') + '</span>';
  } else if (a.type === 'download') {
    const pct = a.progress || 0;
    const circ = 2 * Math.PI * 6;
    const offset = circ * (1 - pct / 100);
    const ring = pct > 0 ? '<svg class="island-ring" viewBox="0 0 16 16"><circle class="island-ring-bg" cx="8" cy="8" r="6"/><circle class="island-ring-fg" cx="8" cy="8" r="6" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 8 8)"/></svg>' : icon('download', { size: 14 });
    return ring + '<span>' + escapeHtml(a.label || pct + '%') + '</span><span class="island-dismiss" data-island-dismiss="download" style="margin-left:4px;opacity:0.4;font-size:15px;line-height:1;padding:0 2px;cursor:pointer">&times;</span>';
  } else if (a.type === 'tts') {
    const ttsIconC = a.paused
      ? icon('play', { size: 14 })
      : _islandWaveformBars;
    const spd = parseFloat(Settings.get('ttsSpeed')) || 1;
    const spdBadge = '<span class="island-tts-speed" onclick="event.stopPropagation();_ttsCycleSpeed()" title="Click to change speed">' + spd.toFixed(1).replace(/\.0$/, '') + 'x</span>';
    return ttsIconC + '<span>' + escapeHtml(a.label || '') + '</span>' + spdBadge;
  } else if (a.type === 'audio') {
    return _islandAudioBars + '<span>' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'ai') {
    return '<span class="island-ai-dot nr-breathe"></span><span>' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'achievement') {
    return icon('help', { size: 14, stroke: '#caa12a' });
  } else if (a.type === 'rss') {
    const rssIcon = a.subscribed
      ? icon('check', { size: 14, stroke: '#22c55e' })
      : icon('rssFeed', { size: 14, stroke: '#f97316' });
    return rssIcon + '<span style="color:' + (a.subscribed ? '#22c55e' : 'var(--aether-text)') + '">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'tabs') {
    const tabItems = a.items || [];
    function _globeIcon(cls, attrs) {
      const opts = { size: 16, strokeWidth: '1.5' };
      if (cls) opts.class = cls;
      // attrs should be parsed, but for simplicity we'll ignore complex attribute merging
      return icon('globe', opts);
    }
    const tabIcon = icon('browserTab', { size: 14, strokeWidth: '1.5' });
    const ellIcon = _ELL_SVG;
    // Collect non-blank tabs sorted by lastVisited desc
    const nonBlank = [];
    for (let si = 0; si < tabItems.length; si++) {
      if (!tabItems[si].blank) nonBlank.push(tabItems[si]);
    }
    nonBlank.sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    // If no non-blank tabs (all NTP), show stacked-pages icon
    if (nonBlank.length === 0) {
      return icon('windows', { size: 14 }) + '<span style="opacity:0.4">0 tabs</span>';
    }
    // Pick up to 2 most recently visited non-blank tabs for favicon strip
    const visible = nonBlank.slice(0, 3);
    const overflow = tabItems.length - visible.length;
    let html = '<span class="island-favicon-strip">';
    for (let ti = 0; ti < visible.length; ti++) {
      const t = visible[ti];
      const cls = 'island-strip-fav' + (t.active ? ' island-strip-fav-active' : '');
      const tipAttr = ' title="' + escapeHtml(t.title || 'Tab') + '"';
      var favHtml;
      if (t.favicon) {
        const fallbackSvg = icon('globe', { size: 16, strokeWidth: '1.5', class: cls }).replace(/"/g, '&quot;');
        favHtml = '<img class="' + cls + '" src="' + escapeHtml(t.favicon) + '"' + tipAttr + ' data-island-tab="' + t.id + '" onerror="this.outerHTML=\'' + fallbackSvg.replace('>', ' data-island-tab=&quot;' + t.id + '&quot;>') + '\'">';
      } else {
        favHtml = icon('globe', { size: 16, strokeWidth: '1.5', class: cls }).replace('>', tipAttr + ' data-island-tab="' + t.id + '">');
      }
      if (t.active) {
        html += '<span class="island-strip-fav-wrap" data-island-tab="' + t.id + '">' + favHtml + '<button class="island-strip-fav-close" data-island-tab-close="' + t.id + '" title="Close tab">&times;</button></span>';
      } else {
        html += favHtml;
      }
    }
    html += '<span class="island-strip-overflow">' + nonBlank.length + ' tab' + (nonBlank.length !== 1 ? 's' : '') + '</span>';
    html += '</span>';
    return html;
  } else if (a.type === 'insight') {
    if (a.offer) {
      // Clickable offer pill — user clicks to trigger annotation
      const offerIcon = icon('comment', { size: 14, stroke: 'var(--nr-text-tertiary)' });
      return offerIcon + '<span style="color:var(--nr-text-tertiary)">' + escapeHtml(a.label || 'Annotate') + '</span>';
    }
    if (a.loading) {
      return '<span class="island-annotate-dot"></span><span>' + escapeHtml(a.label || 'Analyzing\u2026') + '</span>';
    }
    const _annModeColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', CONNECTION: '#2196f3' };
    const annColor = _annModeColors[a.modeType] || '#4caf50';
    const annIcon = a.insight ? icon('brain', { size: 14, stroke: annColor }) : icon('comment', { size: 14, stroke: annColor });
    // Paper mode — append citation badge after the normal label
    let paperBadge = '';
    if (a._paper && a._paperState && a._paperState.s2Data) {
      const cc = a._paperState.s2Data.citationCount;
      if (cc != null) paperBadge = '<span style="margin-left:6px;font-size:10px;padding:1px 5px;border-radius:8px;background:rgba(139,92,246,0.15);color:#8b5cf6">' + cc + ' cit.</span>';
    }
    return annIcon + '<span style="color:var(--aether-text)">' + escapeHtml(a.label || '') + '</span>' + paperBadge;
  } else if (a.type === 'calendar') {
    return icon('calendar', { size: 14, stroke: '#3b82f6' }) + '<span style="color:#3b82f6">' + escapeHtml(a.label || '') + '</span>';
  } else if (a.type === 'bookmark') {
    return icon('bookmark', { size: 14, fill: 'var(--nr-accent)', stroke: 'var(--nr-accent)' });
  } else if (a.type === 'pulse') {
    const pulseIntensity = (typeof Motion !== 'undefined') ? Math.min(Motion.pulse.rate / 5, 1) : 0;
    const pulseClass = pulseIntensity > 0.3 ? 'island-pulse-dot-active' : 'island-pulse-dot-idle';
    return '<span class="island-pulse-dot ' + pulseClass + '" style="--pulse-intensity:' + pulseIntensity.toFixed(2) + '"></span>';
  } else if (a.type === 'context') {
    return '<span style="opacity:0.5">\u25CF</span><span style="opacity:0.7">' + escapeHtml(a.label || '') + '</span>';
  }
  return '<span class="island-dot"></span><span>' + escapeHtml(a.label || '') + '</span>';
}

// Build tray HTML for context/download/annotate/achievement/tabs pills
function _islandBuildTray(a, isBrowse) {
  if (a.type === 'context' && a.items && a.items.length) {
    var trayHtml = '';
    if (isBrowse) {
      trayHtml += '<div class="island-tab-newtab" data-island-tab-new="1">' + icon('plus', { size: 12 }) + '<span>New tab</span></div>';
      trayHtml += '<div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    }
    for (var ti = 0; ti < a.items.length; ti++) {
      var item = a.items[ti];
      var t = item.title || 'New Tab';
      if (t.length > 36) t = t.slice(0, 34) + '\u2026';
      var fav = item.favicon ? '<img src="' + escapeHtml(item.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
      const closeBtn = isBrowse ? '<button class="island-tab-item-close" data-island-tab-close="' + item.id + '" title="Close">&times;</button>' : '';
      trayHtml += '<div class="island-ctx-item' + (item.active ? ' active' : '') + '" data-island-tab="' + item.id + '">' + fav + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(t) + '</span>' + closeBtn + '</div>';
    }
    return trayHtml;
  } else if (a.type === 'download' && a.items && a.items.length) {
    var trayHtml = '<div class="island-dl-header"><span>Downloads</span><span class="island-dl-clear" data-island-dl-clear="1">Clear all</span></div>';
    for (var ti = 0; ti < a.items.length; ti++) {
      var item = a.items[ti];
      let fname = item.filename || 'Download';
      if (fname.length > 40) fname = fname.slice(0, 38) + '\u2026';
      const dlIcon = item.state === 'completed'
        ? icon('fileCheckmark', { size: 14, fill: '#22c55e', stroke: 'none' })
        : icon('filePlain', { size: 14 });
      const dlStatus = item.state === 'completed' ? 'Done' + (item.size ? ' · ' + item.size : '')
        : item.state === 'cancelled' ? 'Cancelled'
        : item.pct + '% · ' + item.received + (item.size ? ' / ' + item.size : '');
      const progressHtml = item.state === 'progressing'
        ? '<div class="island-dl-progress"><div class="island-dl-progress-bar" style="width:' + item.pct + '%"></div></div>'
        : '';
      trayHtml += '<div class="island-dl-item" data-island-dl="' + escapeHtml(item.id) + '">'
        + '<div class="island-dl-icon">' + dlIcon + '</div>'
        + '<div class="island-dl-info"><div class="island-dl-name">' + escapeHtml(fname) + '</div><div class="island-dl-status">' + escapeHtml(dlStatus) + '</div>' + progressHtml + '</div>'
        + '<button class="island-dl-remove" data-island-dl-remove="' + escapeHtml(item.id) + '" title="Remove">&times;</button>'
        + '</div>';
    }
    return trayHtml;
  } else if (a.type === 'insight' && ((a.items && a.items.length) || (a._paper && a._paperState))) {
    const annColors = { ALPHA: '#4caf50', CONTRADICTION: '#ef5350', AD: '#ff9800', CONNECTION: '#2196f3' };
    const annLabels = { ALPHA: 'Alpha', CONTRADICTION: 'Contradiction', AD: 'Ad', CONNECTION: 'Connection' };
    // Extend with custom categories
    if (typeof _customAnnotationCategories !== 'undefined') {
      for (let ci = 0; ci < _customAnnotationCategories.length; ci++) {
        const cc = _customAnnotationCategories[ci];
        annColors[cc.key] = cc.color;
        annLabels[cc.key] = cc.name;
      }
    }
    var trayHtml = '';
    // Paper metadata at top of tray (when on an academic paper page)
    if (a._paper && a._paperState) {
      var ps = a._paperState;
      var s2 = ps.s2Data;
      var meta = ps.meta || {};
      var paperTitle = (s2 && s2.title) || meta.title || '';
      if (paperTitle) {
        trayHtml += '<div style="padding:8px 10px 4px;font-size:13px;font-weight:600;color:var(--nr-text-primary);line-height:1.4">' + escapeHtml(paperTitle) + '</div>';
      }
      if (s2) {
        var paperDetails = [];
        if (s2.year) paperDetails.push(s2.year);
        if (s2.venue) paperDetails.push(s2.venue);
        if (s2.citationCount != null) paperDetails.push(s2.citationCount + ' citation' + (s2.citationCount !== 1 ? 's' : ''));
        if (paperDetails.length) {
          trayHtml += '<div style="padding:2px 10px 4px;font-size:11px;color:var(--nr-text-tertiary)">' + escapeHtml(paperDetails.join(' \u00b7 ')) + '</div>';
        }
      }
      var paperAuthors = (s2 && s2.authors) || [];
      var authorDetails = ps.authorDetails || [];
      if (paperAuthors.length || (meta.authors && meta.authors.length)) {
        trayHtml += '<div style="height:1px;background:var(--aether-border, var(--nr-border-default));margin:2px 0"></div>';
        var displayAuthors = paperAuthors.length ? paperAuthors.slice(0, 5) : meta.authors.slice(0, 5).map(function(n) { return { name: n }; });
        for (var pai = 0; pai < displayAuthors.length; pai++) {
          var pAuthor = displayAuthors[pai];
          var pName = pAuthor.name || '';
          var pDetail = null;
          for (var pdi = 0; pdi < authorDetails.length; pdi++) {
            if (authorDetails[pdi] && authorDetails[pdi].name === pName) { pDetail = authorDetails[pdi]; break; }
          }
          var hBadge = pDetail && pDetail.hIndex != null ? '<span style="font-size:10px;color:var(--nr-text-quaternary);margin-left:auto">h-index: ' + pDetail.hIndex + '</span>' : '';
          var citBadge = pDetail && pDetail.citationCount != null ? '<span style="font-size:10px;color:var(--nr-text-quaternary);margin-left:6px">' + pDetail.citationCount.toLocaleString() + ' cit.</span>' : '';
          trayHtml += '<div style="padding:4px 10px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--nr-text-primary)">';
          trayHtml += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(pName) + '</span>';
          trayHtml += hBadge + citBadge;
          trayHtml += '</div>';
        }
        if ((paperAuthors.length > 5) || (meta.authors && meta.authors.length > 5)) {
          var pExtra = (paperAuthors.length || meta.authors.length) - 5;
          trayHtml += '<div style="padding:2px 10px 4px;font-size:11px;color:var(--nr-text-quaternary)">+' + pExtra + ' more</div>';
        }
      }
      if (a.items && a.items.length) {
        trayHtml += '<div style="height:1px;background:var(--aether-border, var(--nr-border-default));margin:4px 0"></div>';
      }
    }
    // Insight text
    if (a.insight) {
      trayHtml += '<div style="padding:8px 10px;font-size:12px;color:var(--nr-text-primary);line-height:1.5;opacity:0.9">' + escapeHtml(a.insight) + '</div>';
    }
    // OCR text
    if (a.ocrText) {
      trayHtml += '<div style="padding:6px 10px;font-size:11px;color:var(--nr-text-tertiary);line-height:1.4;border-top:1px solid var(--aether-border, var(--nr-border-default))">';
      trayHtml += '<span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--nr-text-quaternary)">OCR</span><br>';
      trayHtml += escapeHtml(a.ocrText.length > 300 ? a.ocrText.slice(0, 297) + '\u2026' : a.ocrText);
      trayHtml += '</div>';
    }
    if ((a.insight || a.ocrText) && a.items && a.items.length) trayHtml += '<div style="height:1px;background:var(--aether-border, var(--nr-border-default));margin:2px 0"></div>';
    for (let ai = 0; ai < (a.items || []).length; ai++) {
      const ann = a.items[ai];
      const ac = annColors[ann.type] || '#888';
      const al = annLabels[ann.type] || ann.type;
      const quote = ann.quote || '';
      const isConnection = ann.type === 'CONNECTION';
      const displayText = isConnection ? ('Linked: ' + (ann.linkedTitle || 'Related content')) : quote;
      const confBadge = ann.confidence != null ? '<span style="font-size:10px;color:var(--nr-text-quaternary);margin-left:auto;flex-shrink:0">' + ann.confidence + '%</span>' : '';
      trayHtml += '<div class="island-ann-item" data-island-ann="' + ai + '"' + (isConnection && ann.linkedUrl ? ' data-island-ann-url="' + escapeHtml(ann.linkedUrl) + '"' : '') + ' style="padding:6px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;">';
      trayHtml += '<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + ac + ';flex-shrink:0"></span><span style="font-size:11px;font-weight:600;color:' + ac + '">' + escapeHtml(al) + '</span>' + confBadge;
      // Rating buttons
      trayHtml += '<span style="margin-left:auto;display:flex;gap:2px">';
      const thumbUpSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>';
      const thumbDownSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/></svg>';
      trayHtml += '<button data-ann-rate-good="' + ai + '" title="Good annotation" style="background:none;border:none;cursor:pointer;padding:1px 3px;opacity:0.5;color:var(--nr-text-primary)" onmouseenter="this.style.opacity=1;this.style.color=\'#4caf50\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'var(--nr-text-primary)\'">' + thumbUpSvg + '</button>';
      trayHtml += '<button data-ann-rate-bad="' + ai + '" title="Bad annotation" style="background:none;border:none;cursor:pointer;padding:1px 3px;opacity:0.5;color:var(--nr-text-primary)" onmouseenter="this.style.opacity=1;this.style.color=\'#ef5350\'" onmouseleave="this.style.opacity=0.5;this.style.color=\'var(--nr-text-primary)\'">' + thumbDownSvg + '</button>';
      trayHtml += '</span></div>';
      trayHtml += '<div style="font-size:12px;color:var(--nr-text-primary);padding-left:14px;opacity:0.85">' + escapeHtml(displayText) + '</div>';
      if (ann.explanation) trayHtml += '<div style="font-size:11px;color:var(--nr-text-quaternary);padding-left:14px">' + escapeHtml(ann.explanation) + '</div>';
      trayHtml += '</div>';
    }
    return trayHtml;
  } else if (a.type === 'achievement') {
    return '<div class="island-ach-tray-content">'
      + '<div class="island-ach-tray-icon">' + icon('help', { size: 18, stroke: '#caa12a', strokeWidth: '1.5' }) + '</div>'
      + '<div class="island-ach-tray-info">'
      + '<div class="island-ach-tray-subtitle">Achievement Unlocked</div>'
      + '<div class="island-ach-tray-name">' + escapeHtml(a.label || 'Unlocked!') + '</div>'
      + '<div class="island-ach-tray-desc">' + escapeHtml(a.detail || '') + '</div>'
      + '</div></div>';
  } else if (a.type === 'tabs' && a.items && a.items.length) {
    var trayHtml = '<div class="island-tab-newtab" data-island-tab-new="1">' + icon('plus', { size: 12 }) + '<span>New tab</span></div><div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    const pinnedItems = a.items.filter(function(it) { return it.pinned; });
    const unpinnedItems = a.items.filter(function(it) { return !it.pinned; }).slice().sort(function(x, y) { return (y.lastVisited || 0) - (x.lastVisited || 0); });
    if (pinnedItems.length) {
      for (let pi = 0; pi < pinnedItems.length; pi++) {
        const pItem = pinnedItems[pi];
        let pTitle = pItem.title || 'New Tab';
        if (pTitle.length > 32) pTitle = pTitle.slice(0, 30) + '\u2026';
        const pFav = pItem.favicon ? '<img src="' + escapeHtml(pItem.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
        const pAudio = pItem.hasAudio ? icon('speakerSmall', { size: 12, style: 'flex-shrink:0;opacity:0.6' }) : '';
        const pClose = pItem.active ? '<button class="island-tab-item-close island-tab-close-hover" data-island-tab-close="' + pItem.id + '" title="Close">&times;</button>' : '';
        trayHtml += '<div class="island-tab-item' + (pItem.active ? ' active' : '') + '" data-island-tab="' + pItem.id + '">' + pFav + pAudio + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(pTitle) + '</span>' + pClose + '</div>';
      }
      if (unpinnedItems.length) trayHtml += '<div style="height:1px;background:var(--aether-border);margin:4px 0"></div>';
    }
    for (var ti = 0; ti < unpinnedItems.length; ti++) {
      var item = unpinnedItems[ti];
      var t = item.title || 'New Tab';
      if (t.length > 32) t = t.slice(0, 30) + '\u2026';
      var fav = item.favicon ? '<img src="' + escapeHtml(item.favicon) + '" width="14" height="14" style="border-radius:2px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
      const audioIcon = item.hasAudio ? icon('speakerSmall', { size: 12, style: 'flex-shrink:0;opacity:0.6' }) : '';
      trayHtml += '<div class="island-tab-item' + (item.active ? ' active' : '') + '" data-island-tab="' + item.id + '">' + fav + audioIcon + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(t) + '</span><button class="island-tab-item-close" data-island-tab-close="' + item.id + '" title="Close">&times;</button></div>';
    }
    return trayHtml;
  }
  if (a.type === 'pulse') {
    const recent = (typeof Motion !== 'undefined') ? Motion.pulse.recent : [];
    var trayHtml = '<div style="padding:6px 8px;font-size:0.6rem;color:#fff;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px">Live Pulse</div>';
    const start = Math.max(0, recent.length - 30);
    for (let ri = recent.length - 1; ri >= start; ri--) {
      const ev = recent[ri];
      const catColors = { ai: '#a78bfa', embed: '#38bdf8', feed: '#f97316', quality: '#22c55e', network: '#94a3b8', system: '#e879f9' };
      const col = catColors[ev.category] || '#94a3b8';
      const age = Math.round((Date.now() - ev.timestamp) / 1000);
      const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      const statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      trayHtml += '<div class="island-ctx-item" style="font-size:0.65rem;gap:6px;padding:3px 8px"><span style="width:4px;height:4px;border-radius:50%;background:' + statusDot + ';flex-shrink:0"></span><span style="color:' + col + ';min-width:36px">' + escapeHtml(ev.category) + '</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.7">' + escapeHtml(ev.label) + '</span><span style="opacity:0.35;flex-shrink:0">' + ageStr + '</span></div>';
    }
    if (!recent.length) trayHtml += '<div style="padding:8px;opacity:0.3;font-size:0.65rem;text-align:center">No events yet</div>';
    return trayHtml;
  }
  return '';
}

// Attach click handlers and hover/tray behavior to pill
function _islandAttachHandlers(pill, a, hasTray) {
  pill.onclick = function(e) {
    const dismissEl = e.target.closest('[data-island-dismiss]');
    if (dismissEl) {
      e.stopPropagation();
      const dismissId = dismissEl.getAttribute('data-island-dismiss');
      const act = _islandActivities[dismissId];
      if (act && act.dismiss) act.dismiss();
      else islandRemove(dismissId);
      return;
    }
    const tabCloseBtn = e.target.closest('[data-island-tab-close]');
    if (tabCloseBtn) {
      e.stopPropagation();
      const closeTabId = +tabCloseBtn.getAttribute('data-island-tab-close');
      if (typeof browseCloseTab === 'function') browseCloseTab(closeTabId);
      return;
    }
    const tabNewBtn = e.target.closest('[data-island-tab-new]');
    if (tabNewBtn) {
      e.stopPropagation();
      if (typeof browseNewTab === 'function') browseNewTab();
      pill.classList.remove('island-tray-open');
      return;
    }
    const tabItem = e.target.closest('[data-island-tab]');
    if (tabItem) {
      e.stopPropagation();
      const tabId = +tabItem.getAttribute('data-island-tab');
      if (typeof browseSelectTab === 'function') browseSelectTab(tabId);
      pill.classList.remove('island-tray-open');
      return;
    }
    // Annotation rating buttons
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
        AetherUI.mount(RawHTML(icon('check', { size: 12, strokeWidth: '2.5' })), rBtn);
      }
      return;
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
      return;
    }
    const dlClear = e.target.closest('[data-island-dl-clear]');
    if (dlClear) {
      e.stopPropagation();
      if (typeof clearBrowseDownloads === 'function') clearBrowseDownloads();
      islandRemove('download');
      return;
    }
    const dlRemove = e.target.closest('[data-island-dl-remove]');
    if (dlRemove) {
      e.stopPropagation();
      var dlId = dlRemove.getAttribute('data-island-dl-remove');
      if (typeof removeBrowseDownload === 'function') removeBrowseDownload(dlId);
      return;
    }
    const dlItem = e.target.closest('[data-island-dl]');
    if (dlItem) {
      e.stopPropagation();
      var dlId = dlItem.getAttribute('data-island-dl');
      if (typeof openDownloadFile === 'function') openDownloadFile(dlId);
      return;
    }
    if (a.action) a.action();
  };
  pill.style.cursor = (a.action || a.type === 'insight' || a.type === 'tabs') ? 'pointer' : 'default';

  // Hover/click management for tray
  if (hasTray) {
    if (a.type === 'tabs') {
      // Tabs uses click — in island mode, render into pill-url-dropdown
      if (!pill._islandClickBound) {
        pill._islandClickBound = true;
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', function(e) {
          if (e.target.closest('[data-island-tab], [data-island-tab-close], [data-island-tab-new], [data-island-dismiss]')) return;
          // Island mode: use connected pill dropdown
          if (typeof _showTabsInPillDropdown === 'function') {
            var pillDd = document.getElementById('pill-url-dropdown');
            var pillWrap = document.getElementById('pill-url-wrap');
            if (pillDd && pillWrap && pillWrap.classList.contains('pill-dropdown-open') && pillDd.querySelector('[data-pill-tab-switch]')) {
              // Already showing tabs — close it
              if (typeof _browseUrlHideHistory === 'function') _browseUrlHideHistory();
            } else {
              _showTabsInPillDropdown();
            }
            return;
          }
          pill.classList.toggle('island-tray-open');
        });
        // Close on outside click or focus loss (webview clicks don't bubble)
        document.addEventListener('click', function(e) {
          if (!pill.contains(e.target)) pill.classList.remove('island-tray-open');
        });
        window.addEventListener('blur', function() {
          pill.classList.remove('island-tray-open');
        });
        document.addEventListener('mousedown', function(e) {
          if (!pill.contains(e.target)) pill.classList.remove('island-tray-open');
        });
      }
    } else if (!pill._islandHoverBound) {
      pill._islandHoverBound = true;
      pill.addEventListener('mouseenter', function() {
        if (pill._islandLeaveTimer) { clearTimeout(pill._islandLeaveTimer); pill._islandLeaveTimer = null; }
        if (pill._islandAutoClose) { clearTimeout(pill._islandAutoClose); pill._islandAutoClose = null; }
        pill.classList.add('island-tray-open');
      });
      pill.addEventListener('mouseleave', function() {
        pill._islandLeaveTimer = setTimeout(function() { pill.classList.remove('island-tray-open'); }, 120);
      });
    }
  }
}

// FLIP-animate neighboring pills when one enters/exits/compacts
function _islandFlipNeighbors(cont) {
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
function _islandSnapshotRects(cont) {
  if (!cont) return;
  cont.querySelectorAll('.pill-island').forEach(function(p) {
    p._flipRect = p.getBoundingClientRect();
  });
}

function _islandRender() {
  const container = document.getElementById('pill-island');
  if (!container) return;
  const rightContainer = document.getElementById('pill-island-right');

  let ids = Object.keys(_islandActivities);
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
  const priority = { achievement: 5, download: 4, calendar: 3.5, cc: 3, tts: 3, ai: 3, rss: 2.6, bookmark: 2.55, insight: 2.5, 'feed-notif': 2, audio: 2, qf: 2, feed: 1, context: 0 };
  ids.sort(function(a, b) {
    const pa = priority[_islandActivities[a].type] || 0;
    const pb = priority[_islandActivities[b].type] || 0;
    return pb - pa || _islandActivities[b]._ts - _islandActivities[a]._ts;
  });
  ids = pinnedLeft.concat(ids);

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

  const prevPill = null; // track insertion order
  ids.forEach(function(id) {
    const a = _islandActivities[id];
    let pill = existingEls[id];
    const isNew = !pill;
    if (isNew) {
      pill = document.createElement('div');
      pill.className = 'pill-island';
      pill.setAttribute('data-island-id', id);
      // Goo background layer — filtered shapes that merge pill + tray into organic blob
      const gooBg = document.createElement('div');
      gooBg.className = 'pill-goo-bg';
      const gooPill = document.createElement('div');
      gooPill.className = 'goo-shape goo-pill-shape';
      const gooTray = document.createElement('div');
      gooTray.className = 'goo-shape goo-tray-shape';
      gooBg.appendChild(gooPill);
      gooBg.appendChild(gooTray);
      pill.appendChild(gooBg);
      const compactDiv = document.createElement('div');
      compactDiv.className = 'pill-island-content';
      pill.appendChild(compactDiv);
      // Items tray for context pills (morphs inside the pill)
      const itemsTray = document.createElement('div');
      itemsTray.className = 'island-ctx-tray';
      pill.appendChild(itemsTray);
    }
    delete existingEls[id];
    const compact = pill.querySelector('.pill-island-content');
    const tray = pill.querySelector('.island-ctx-tray');
    // Smart content diffing: skip innerHTML if content unchanged
    const newCompactHtml = _islandRenderPill(a);
    if (compact._lastHtml !== newCompactHtml) { compact.innerHTML = newCompactHtml; compact._lastHtml = newCompactHtml; }
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
      const isBrowse = (typeof _browseTabLayout !== 'undefined') && ((_currentRouteHash || window.location.hash || '').match(/^#(browse|research|search)$/));
      tray.innerHTML = _islandBuildTray(a, isBrowse);
    }
    const hasItems = !!(a.items && a.items.length);
    const hasTray = (hasItems && (a.type === 'context' || a.type === 'download' || a.type === 'tabs' || a.type === 'insight')) || a.type === 'achievement' || a.type === 'pulse' || (a.type === 'insight' && a._paper && a._paperState);
    pill.classList.toggle('island-context', a.type === 'context');
    pill.classList.toggle('island-download-pill', a.type === 'download');
    pill.classList.toggle('island-tabs-pill', a.type === 'tabs');
    pill.classList.toggle('island-has-items', hasTray);
    // Apply custom cssClass from activity data (e.g., nr-glow for achievements)
    if (a.cssClass) pill.classList.add(a.cssClass);

    // Attach event handlers
    _islandAttachHandlers(pill, a, hasTray);

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
    // Never auto-dismiss insight pill when paper metadata is attached
    if (a.done && !_islandDismissTimers[id] && !(a.type === 'insight' && a._paper)) {
      const baseDelay = a.type === 'achievement' ? 5000 : a.type === 'feed-notif' ? 10000 : 2500;
      const pendingCount = Object.keys(_islandDismissTimers).length;
      const stagger = pendingCount * 500;
      _islandDismissTimers[id] = setTimeout(function() {
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
  if (urlWrap && isIslandNow && rightContainer) {
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
    ['pill-audio-unified', 'pill-browse-more'].forEach(function(bid) {
      const b = document.getElementById(bid);
      if (b && b.offsetWidth > 0) rightBtnsW += b.offsetWidth + 2; // + gap
    });
    rightBtnsW += 8; // right padding
    rightContainer.style.setProperty('--island-right-offset', rightBtnsW + 'px');
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
    ['pill-audio-unified', 'pill-browse-more'].forEach(function(bid) {
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
}

// Re-check right-side pill clipping on resize
window.addEventListener('resize', function() {
  clearTimeout(_islandResizeTimer);
  _islandResizeTimer = setTimeout(function() {
    if (Object.keys(_islandActivities).length) _islandRender();
  }, 100);
});

// ── Now Playing context pill (removed — not useful) ──
function _updateNowPlayingContext() {
  islandRemove('nowplaying');
}

// ── Content safe bounds for popups ──