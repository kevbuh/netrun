// toolbar-ai-pill.js — Unified AI/audio indicator + dropdown
// Replaces browse-ai-pill.js
import Settings from '/js/core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { aiPillState } from '/js/toolbar/toolbar-state.js';

// ── State ──
var _dirty = false;
var _rafPending = false;
var _dropdownOpen = false;
var _outsideClickBound = false;

// Category colors for pulse events
var _pulseCatColors = { ai: '#a78bfa', feed: '#f97316', network: '#94a3b8', system: '#e879f9' };

// ── Throttled render ──
function _scheduleRender() {
  _dirty = true;
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(function() {
    _rafPending = false;
    if (_dirty) {
      _dirty = false;
      _renderUnifiedPill();
    }
  });
}

window._renderUnifiedPill = _scheduleRender;

// ── State priority resolver ──
function _resolveIndicatorState() {
  var audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  var pulseState = typeof window._getPulseState === 'function' ? window._getPulseState() : {};
  var pageInfoState = typeof window._getPageInfoState === 'function' ? window._getPageInfoState() : {};

  var micRecording = audioState.micRecording;
  var aiActive = _isAIActive();
  var audioPlaying = !!(audioState.tab || audioState.tts);
  var pulseFlashing = pulseState.isFlashing;
  var hasPageInfo = !!(pageInfoState.label || pageInfoState.badges);

  var primary = 'idle';
  if (micRecording) primary = 'mic';
  else if (aiActive) primary = 'ai';
  else if (audioPlaying) primary = 'audio';
  else if (pulseFlashing) primary = 'pulse';
  else if (hasPageInfo) primary = 'pageinfo';

  var secondary = [];
  if (primary !== 'mic' && micRecording) secondary.push('mic');
  if (primary !== 'ai' && aiActive) secondary.push('ai');
  if (primary !== 'audio' && audioPlaying) secondary.push('audio');
  if (primary !== 'pulse' && pulseFlashing) secondary.push('pulse');

  return { primary: primary, secondary: secondary, audioState: audioState, pulseState: pulseState, pageInfoState: pageInfoState };
}

function _isAIActive() {
  if (!window._islandActivities) return false;
  var acts = window._islandActivities.value;
  for (var id in acts) {
    var a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

// ── Gather inline content from island activities ──
function _getInlineContent() {
  if (!window._islandActivities) return { modelLabel: '', annotateOffer: false, annotateLabel: '', insightLoading: false };
  var acts = window._islandActivities.value;
  var modelLabel = '';
  var annotateOffer = false;
  var annotateLabel = '';
  var insightLoading = false;
  for (var id in acts) {
    var a = acts[id];
    if (!a) continue;
    if (a.type === 'ai' && a.label) modelLabel = a.label;
    if (a.type === 'insight') {
      if (a.offer) { annotateOffer = true; annotateLabel = a.label || 'Annotate'; }
      else if (a.loading) { insightLoading = true; annotateLabel = a.label || 'Analyzing\u2026'; }
      else if (a.label) { annotateLabel = a.label; }
    }
  }
  return { modelLabel: modelLabel, annotateOffer: annotateOffer, annotateLabel: annotateLabel, insightLoading: insightLoading };
}

// ── Main render ──
function _renderUnifiedPill() {
  var el = document.getElementById('pill-ai-unified');
  if (!el) return;

  var state = _resolveIndicatorState();
  var inline = _getInlineContent();

  // Indicator
  var indicator = el.querySelector('.ai-unified-indicator');
  if (indicator) _renderIndicator(indicator, state.primary, state.pulseState);

  // Inline labels
  var labelContainer = el.querySelector('.ai-unified-labels');
  if (labelContainer) _renderInlineLabels(labelContainer, inline);

  var hasInline = !!(inline.modelLabel || inline.annotateLabel);
  el.classList.toggle('ai-unified-expanded', hasInline);

  // Secondary dots
  var secContainer = el.querySelector('.ai-unified-secondary');
  if (secContainer) _renderSecondaryDots(secContainer, state.secondary);

  // Dropdown
  if (_dropdownOpen) {
    var dropdown = el.querySelector('.ai-unified-dropdown');
    if (dropdown) _renderDropdown(dropdown, state);
  }
}

// ── Indicator rendering ──
function _renderIndicator(container, primary, pulseState) {
  var html = '';
  container.className = 'ai-unified-indicator';

  switch (primary) {
    case 'mic':
      html = icon('microphone', { size: 14, stroke: '#ef4444' });
      container.classList.add('ai-unified-mic');
      break;
    case 'ai':
      html = '<span class="ai-unified-dot ai-unified-dot-ai nr-breathe"></span>';
      container.classList.add('ai-unified-ai');
      break;
    case 'audio':
      html = window._islandAudioBars || '';
      container.classList.add('ai-unified-audio');
      break;
    case 'pulse': {
      var lastEvent = pulseState.lastEvent;
      var col = lastEvent ? (_pulseCatColors[lastEvent.category] || '#94a3b8') : '#94a3b8';
      html = '<span class="ai-unified-dot ai-unified-dot-pulse" style="background:' + col + ';box-shadow:0 0 6px ' + col + '"></span>';
      container.classList.add('ai-unified-pulse');
      break;
    }
    case 'pageinfo':
      html = '<span class="ai-unified-dot ai-unified-dot-idle nr-breathe"></span>';
      container.classList.add('ai-unified-idle');
      break;
    default:
      html = icon('sparkles', { size: 14 });
      container.classList.add('ai-unified-idle');
      break;
  }
  if (container._lastHtml !== html) {
    container.innerHTML = html;
    container._lastHtml = html;
  }
}

// ── Inline labels ──
function _renderInlineLabels(container, inline) {
  var html = '';
  if (inline.modelLabel) {
    html += '<span class="ai-unified-model-label">' + escapeHtml(inline.modelLabel) + '</span>';
  }
  if (inline.annotateLabel) {
    var annIcon = inline.annotateOffer
      ? icon('comment', { size: 12, stroke: 'var(--nr-text-secondary)' })
      : (inline.insightLoading ? '<span class="island-annotate-dot"></span>' : icon('comment', { size: 12 }));
    var cls = inline.annotateOffer ? ' ai-unified-annotate-offer' : '';
    html += '<span class="ai-unified-annotate-label' + cls + '" data-ai-inline-annotate="1">' + annIcon + '<span>' + escapeHtml(inline.annotateLabel) + '</span></span>';
  }
  if (container._lastHtml !== html) {
    container.innerHTML = html;
    container._lastHtml = html;
  }
}

// ── Secondary dots ──
function _renderSecondaryDots(container, secondary) {
  if (!secondary.length) {
    if (container.innerHTML) container.innerHTML = '';
    return;
  }
  var colorMap = { mic: '#ef4444', ai: '#a78bfa', audio: 'var(--nr-accent)', pulse: '#94a3b8' };
  var html = '';
  for (var i = 0; i < secondary.length; i++) {
    var col = colorMap[secondary[i]] || '#94a3b8';
    html += '<span class="ai-unified-sec-dot" style="background:' + col + '"></span>';
  }
  if (container._lastHtml !== html) {
    container.innerHTML = html;
    container._lastHtml = html;
  }
}

// ── Dropdown rendering ──
function _renderDropdown(dropdown, state) {
  var audioState = state.audioState;
  var pulseState = state.pulseState;
  var pageInfoState = state.pageInfoState;
  var items = [];

  // 1. Ask AI
  items.push(_dropdownItem(
    icon('chatBubble', { size: 14 }),
    'Ask AI',
    function() { _closeDropdown(); if (typeof window._showPanel === 'function') window._showPanel({ anchor: _pillAnchor(), trackCursor: false }); },
    { highlight: true }
  ));

  // Conversations
  var _convTabs = _collectConversationTabs();
  if (_convTabs.length > 0) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Conversations</div>');
    for (var ci = 0; ci < _convTabs.length; ci++) {
      (function(ct) {
        var isActive = ct.active;
        var streaming = ct.streaming;
        var preview = ct.preview ? escapeHtml(ct.preview) : '';
        var title = escapeHtml(ct.title || 'New Tab');
        var streamDot = streaming ? '<span class="ai-unified-conv-stream nr-breathe"></span>' : '';
        var activeCls = isActive ? ' ai-unified-conv-active' : '';
        var id = '_aia_' + (++_actionCounter);
        _actionMap[id] = function() { _closeDropdown(); if (typeof window.browseSelectTab === 'function') window.browseSelectTab(ct.tabId); };
        items.push('<div class="ai-unified-conv-item' + activeCls + '" data-ai-action="' + id + '">'
          + '<div class="ai-unified-conv-title">' + title + '</div>'
          + '<div class="ai-unified-conv-preview">' + preview + '</div>'
          + streamDot
          + '</div>');
      })(_convTabs[ci]);
    }
  }

  items.push('<div class="ai-unified-divider"></div>');

  // 2. AI section
  var tab = _getActiveTab();
  var hasTab = tab && !tab.blank && tab.url;
  var annEnabled = hasTab && typeof window._annotationsEnabled !== 'undefined' && window._annotationsEnabled.get(tab.id);

  items.push(_dropdownItem(
    icon('annotate', { size: 14 }),
    annEnabled ? 'Remove Annotations' : 'Annotate Page',
    function() { _closeDropdown(); if (typeof window.toggleAnnotations === 'function') window.toggleAnnotations(); },
    { disabled: !hasTab, color: annEnabled ? 'var(--nr-accent)' : undefined }
  ));
  items.push(_dropdownItem(
    icon('speaker', { size: 14 }),
    'Read Aloud',
    function() { _closeDropdown(); if (typeof window._readPageAloud === 'function') window._readPageAloud(); },
    { disabled: !hasTab }
  ));
  items.push(_dropdownItem(
    icon('eye', { size: 14 }),
    'AI View',
    function() { _closeDropdown(); if (typeof window.browseShowAIView === 'function') window.browseShowAIView(); },
    { disabled: !hasTab }
  ));

  // 3. Audio section
  items.push('<div class="ai-unified-divider"></div>');
  items.push('<div class="ai-unified-section-label">Audio</div>');

  if (audioState.tab) {
    items.push(_dropdownItem(
      window._islandAudioBars || '',
      escapeHtml(audioState.tab.label || 'Tab Audio'),
      function() { _closeDropdown(); if (typeof window.goToAudioTab === 'function') window.goToAudioTab(); }
    ));
  }

  if (audioState.tts) {
    var spdText = (parseFloat(Settings.get('ttsSpeed')) || 1).toFixed(1).replace(/\.0$/, '') + 'x';
    items.push(_dropdownItem(
      icon(audioState.tts.paused ? 'play' : 'pause', { size: 14 }),
      audioState.tts.paused ? 'Resume TTS' : 'Pause TTS',
      function() { if (typeof window._ttsPauseResume === 'function') window._ttsPauseResume(); _scheduleRender(); },
      { color: 'var(--nr-accent)', trailing: '<span style="margin-left:auto;font-size:0.7rem;opacity:0.5">' + spdText + '</span>' }
    ));
    items.push(_dropdownItem(
      icon('close', { size: 14 }),
      'Stop TTS',
      function() { if (typeof window._ttsStopAll === 'function') window._ttsStopAll(); _scheduleRender(); }
    ));
  }

  if (audioState.cc) {
    items.push(_dropdownItem(
      icon('cc', { size: 14 }),
      escapeHtml(audioState.cc.label || 'CC'),
      function() { _closeDropdown(); if (typeof window.toggleCaptions === 'function') window.toggleCaptions(); },
      { color: 'var(--nr-accent)' }
    ));
  } else if (audioState.tab) {
    items.push(_dropdownItem(icon('cc', { size: 14 }), 'Captions', function() { _closeDropdown(); if (typeof window.toggleCaptions === 'function') window.toggleCaptions(); }));
  }

  // Mic
  if (audioState.micRecording) {
    items.push(_dropdownItem(
      icon('microphone', { size: 14, stroke: '#ef4444' }),
      'Stop recording',
      function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); },
      { color: '#ef4444' }
    ));
  } else if (audioState.mic) {
    items.push(_dropdownItem(
      icon('microphone', { size: 14 }),
      escapeHtml(audioState.mic.label || 'Transcribing\u2026'),
      null,
      { disabled: true }
    ));
  } else {
    items.push(_dropdownItem(icon('microphone', { size: 14 }), 'Voice input', function() { _closeDropdown(); if (typeof window._pillMicClick === 'function') window._pillMicClick(); }));
  }

  // White noise
  if (audioState.rainActive) {
    var noiseLabel = (typeof window.NOISE_PRESETS !== 'undefined' && audioState.rainNoiseType && window.NOISE_PRESETS[audioState.rainNoiseType]) ? window.NOISE_PRESETS[audioState.rainNoiseType].label : 'White noise';
    items.push(_dropdownItem(
      icon('rain', { size: 14 }),
      escapeHtml(noiseLabel),
      function() { _pillNoiseCycle(); _scheduleRender(); },
      { color: 'var(--nr-accent)' }
    ));
    items.push(_dropdownItem(icon('close', { size: 14 }), 'Stop noise', function() { if (typeof window.stopRain === 'function') window.stopRain(); _scheduleRender(); }));
  } else {
    items.push(_dropdownItem(icon('rain', { size: 14 }), 'White noise', function() { if (typeof window.startRain === 'function') window.startRain(); _scheduleRender(); }));
  }

  // Read aloud
  items.push(_dropdownItem(icon('speaker', { size: 14 }), 'Read aloud', function() { _closeDropdown(); if (typeof window._readPageAloud === 'function') window._readPageAloud(); }));

  // 4. Page Info section
  console.log('[pill-dropdown] pageInfoState:', JSON.stringify(pageInfoState), 'direct call:', JSON.stringify(window._getPageInfoState()));
  if (pageInfoState.label || pageInfoState.badges || (pageInfoState.meta && Object.keys(pageInfoState.meta).length)) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Page Info</div>');

    var meta = pageInfoState.meta || {};
    if (meta.published) {
      try {
        var pd = new Date(meta.published);
        items.push(_infoRow('Published', pd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
      } catch(e) { items.push(_infoRow('Published', meta.published)); }
    }
    if (meta.author) items.push(_infoRow('Author', meta.author));
    if (meta.ip) items.push(_infoRow('Server IP', meta.ip));
    if (meta.location) items.push(_infoRow('Location', meta.location));
    if (meta.org) items.push(_infoRow('Org', meta.org));
    if (meta.wordCount) {
      var mins = Math.max(1, Math.round(meta.wordCount / 238));
      items.push(_infoRow('Reading time', mins + ' min (' + meta.wordCount.toLocaleString() + ' words)'));
    }
    if (pageInfoState.badges) items.push(_infoRow('Position', pageInfoState.badges));
    if (meta.description) {
      var desc = meta.description.length > 150 ? meta.description.slice(0, 147) + '\u2026' : meta.description;
      items.push('<div class="ai-unified-info-desc">' + escapeHtml(desc) + '</div>');
    }
  }

  // 5. Activity section — pulse events
  var recent = pulseState.recent || [];
  if (recent.length) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Activity</div>');
    items.push('<div class="ai-unified-activity-scroll">');
    var start = Math.max(0, recent.length - 30);
    for (var ri = recent.length - 1; ri >= start; ri--) {
      var ev = recent[ri];
      var col = _pulseCatColors[ev.category] || '#94a3b8';
      var age = Math.round((Date.now() - ev.timestamp) / 1000);
      var ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      var statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      items.push('<div class="ai-unified-event">'
        + '<span class="ai-unified-event-status" style="background:' + statusDot + '"></span>'
        + '<span class="ai-unified-event-cat" style="color:' + col + '">' + escapeHtml(ev.category) + '</span>'
        + '<span class="ai-unified-event-label">' + escapeHtml(ev.label) + '</span>'
        + '<span class="ai-unified-event-age">' + ageStr + '</span>'
        + '</div>');
    }
    items.push('</div>');
  }

  var html = items.join('');
  if (dropdown._lastHtml !== html) {
    dropdown.innerHTML = html;
    dropdown._lastHtml = html;
  }
}

// ── Dropdown helpers ──
var _actionCounter = 0;
var _actionMap = {};

function _dropdownItem(iconHtml, label, action, opts) {
  opts = opts || {};
  var id = '_aia_' + (++_actionCounter);
  if (action) _actionMap[id] = action;
  var cls = 'ai-unified-item';
  if (opts.highlight) cls += ' ai-unified-item-highlight';
  if (opts.disabled) cls += ' ai-unified-item-disabled';
  var style = '';
  if (opts.color) style += 'color:' + opts.color + ';';
  var trailing = opts.trailing || '';
  return '<div class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + ' data-ai-action="' + id + '">'
    + iconHtml + '<span>' + label + '</span>' + trailing + '</div>';
}

function _infoRow(label, value) {
  return '<div class="ai-unified-info-row"><span class="ai-unified-info-label">' + escapeHtml(label) + '</span><span class="ai-unified-info-value">' + escapeHtml(value) + '</span></div>';
}

// ── Noise cycle ──
function _pillNoiseCycle() {
  var types = typeof window.NOISE_PRESETS !== 'undefined' ? Object.keys(window.NOISE_PRESETS) : [];
  if (!types.length) return;
  var audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  var cur = audioState.rainNoiseType || 'rain';
  var idx = types.indexOf(cur);
  var next = types[(idx + 1) % types.length];
  if (typeof window.setRainNoiseType === 'function') window.setRainNoiseType(next);
}

// ── Collect tabs with active AI conversations ──
function _collectConversationTabs() {
  if (typeof window._browseWindows === 'undefined') return [];
  var results = [];
  var activeTabId = typeof window._browseActiveTab !== 'undefined' ? window._browseActiveTab : null;
  for (var wi = 0; wi < window._browseWindows.length; wi++) {
    var win = window._browseWindows[wi];
    for (var ti = 0; ti < win.tabs.length; ti++) {
      var t = win.tabs[ti];
      var isActive = t.id === activeTabId;
      if (t._aiPanel && t._aiPanel.hasChat) {
        var msgs = t._aiPanel.messages || [];
        var lastAssistant = _lastAssistantPreview(msgs);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant, active: isActive, streaming: !!(t._aiPanel.backgroundStreaming) });
      } else if (isActive && window._popupChatMessages && window._popupChatMessages.length > 0) {
        var lastAssistant = _lastAssistantPreview(window._popupChatMessages);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant, active: true, streaming: !!window._aetherBackgroundStreaming });
      }
    }
  }
  return results;
}

function _lastAssistantPreview(messages) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content) {
      var text = messages[i].content.replace(/[#*_`~\[\]]/g, '').trim();
      return text.length > 60 ? text.slice(0, 57) + '\u2026' : text;
    }
  }
  return '';
}

// ── Helpers ──
function _getActiveTab() {
  if (typeof window._browseTabs === 'undefined' || typeof window._browseActiveTab === 'undefined') return null;
  return window._browseTabs.find(function(t) { return t.id === window._browseActiveTab; });
}

function _pillAnchor() {
  var el = document.getElementById('pill-ai-unified');
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.bottom + 4 };
}

// ── Open/close dropdown ──
function _openDropdown() {
  var el = document.getElementById('pill-ai-unified');
  if (!el) return;
  _dropdownOpen = true;
  _actionCounter = 0;
  for (var k in _actionMap) delete _actionMap[k];
  el.classList.add('ai-unified-open');
  _renderUnifiedPill();
  document.body.classList.add('island-dropdown-guard');
  if (!_outsideClickBound) {
    _outsideClickBound = true;
    setTimeout(function() {
      document.addEventListener('mousedown', _onOutsideClick);
    }, 10);
  }
}

function _closeDropdown() {
  var el = document.getElementById('pill-ai-unified');
  if (!el) return;
  _dropdownOpen = false;
  el.classList.remove('ai-unified-open');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _onOutsideClick);
  _outsideClickBound = false;
  var dropdown = el.querySelector('.ai-unified-dropdown');
  if (dropdown) { dropdown.innerHTML = ''; dropdown._lastHtml = ''; }
}

function _onOutsideClick(e) {
  var el = document.getElementById('pill-ai-unified');
  if (el && !el.contains(e.target)) {
    _closeDropdown();
  }
}

// ── Exported: render AI panel content into an arbitrary container ──
export function renderAIPanelContent(container, onAction) {
  _actionCounter = 0;
  for (var k in _actionMap) delete _actionMap[k];
  var state = _resolveIndicatorState();
  _renderDropdown(container, state);
  container.addEventListener('click', function(e) {
    var actionEl = e.target.closest('[data-ai-action]');
    if (actionEl) {
      e.stopPropagation();
      var actionId = actionEl.getAttribute('data-ai-action');
      if (_actionMap[actionId]) _actionMap[actionId]();
      if (onAction) onAction();
    }
  });
}

// ── Init ──
export function _initUnifiedPill() {
  var el = document.getElementById('pill-ai-unified');
  if (!el || el._unifiedBound) return;
  el._unifiedBound = true;

  el.addEventListener('click', function(e) {
    var actionEl = e.target.closest('[data-ai-action]');
    if (actionEl) {
      e.stopPropagation();
      var actionId = actionEl.getAttribute('data-ai-action');
      if (_actionMap[actionId]) _actionMap[actionId]();
      return;
    }
    if (e.target.closest('[data-ai-inline-annotate]')) {
      e.stopPropagation();
      if (typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
      return;
    }
    if (e.target.closest('.ai-unified-dropdown button')) return;
    e.stopPropagation();
    if (_dropdownOpen) _closeDropdown();
    else _openDropdown();
  });

  var _blurTimer = 0;
  window.addEventListener('blur', function() {
    clearTimeout(_blurTimer);
    _blurTimer = setTimeout(function() {
      if (_dropdownOpen) _closeDropdown();
    }, 300);
  });
  window.addEventListener('focus', function() { clearTimeout(_blurTimer); });

  _renderUnifiedPill();

  // Hook into pulse system
  if (typeof Motion !== 'undefined' && Motion.pulse) {
    var _pulseThrottle = null;
    Motion.pulse.on(function() {
      if (_pulseThrottle) return;
      _pulseThrottle = setTimeout(function() {
        _pulseThrottle = null;
        _scheduleRender();
      }, 500);
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initUnifiedPill);
else setTimeout(_initUnifiedPill, 0);
