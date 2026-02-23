// toolbar-ai-pill.js — Unified AI/audio indicator + dropdown
// Replaces browse-ai-pill.js
import Settings from '/js/core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { aiPillState } from '/js/toolbar/toolbar-state.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';

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

  var hasInline = !!inline.modelLabel;
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
  var view;
  container.className = 'ai-unified-indicator';

  switch (primary) {
    case 'mic':
      view = RawHTML(icon('microphone', { size: 14, stroke: '#ef4444' }));
      container.classList.add('ai-unified-mic');
      break;
    case 'ai':
      view = new View('span').className('ai-unified-dot ai-unified-dot-ai nr-breathe');
      container.classList.add('ai-unified-ai');
      break;
    case 'audio':
      view = RawHTML(window._islandAudioBars || '');
      container.classList.add('ai-unified-audio');
      break;
    case 'pulse': {
      var lastEvent = pulseState.lastEvent;
      var col = lastEvent ? (_pulseCatColors[lastEvent.category] || '#94a3b8') : '#94a3b8';
      view = new View('span')
        .className('ai-unified-dot ai-unified-dot-pulse')
        .styles({ background: col, boxShadow: '0 0 6px ' + col });
      container.classList.add('ai-unified-pulse');
      break;
    }
    case 'pageinfo':
      view = new View('span').className('ai-unified-dot ai-unified-dot-idle nr-breathe');
      container.classList.add('ai-unified-idle');
      break;
    default:
      view = RawHTML(icon('sparkles', { size: 14 }));
      container.classList.add('ai-unified-idle');
      break;
  }

  AetherUI.mount(view, container);
}

// ── Inline labels ──
function _renderInlineLabels(container, inline) {
  if (!inline.modelLabel) {
    container.innerHTML = '';
    return;
  }

  var children = [];

  if (inline.modelLabel) {
    children.push(
      Text(escapeHtml(inline.modelLabel)).className('ai-unified-model-label')
    );
  }

  var row = HStack(children);
  AetherUI.mount(row, container);
}

// ── Secondary dots ──
function _renderSecondaryDots(container, secondary) {
  if (!secondary.length) {
    container.innerHTML = '';
    return;
  }

  var colorMap = { mic: '#ef4444', ai: '#a78bfa', audio: 'var(--nr-accent)', pulse: '#94a3b8' };
  var dots = secondary.map(function(s) {
    var col = colorMap[s] || '#94a3b8';
    return new View('span')
      .className('ai-unified-sec-dot')
      .styles({ background: col });
  });

  AetherUI.mount(HStack(dots), container);
}

// ── Dropdown rendering ──
function _renderDropdown(dropdown, state) {
  var audioState = state.audioState;
  var pulseState = state.pulseState;
  var pageInfoState = state.pageInfoState;
  var children = [];

  // 1. Ask AI
  children.push(_dropdownItem(
    icon('chatBubble', { size: 14 }),
    'Ask AI',
    function() { _closeDropdown(); if (typeof window._showPanel === 'function') window._showPanel({ anchor: _pillAnchor(), trackCursor: false }); },
    { highlight: true }
  ));

  // Conversations
  var _convTabs = _collectConversationTabs();
  if (_convTabs.length > 0) {
    children.push(_divider());
    children.push(_sectionLabel('Conversations'));
    for (var ci = 0; ci < _convTabs.length; ci++) {
      (function(ct) {
        var isActive = ct.active;
        var streaming = ct.streaming;
        var preview = ct.preview || '';
        var title = ct.title || 'New Tab';

        var convItem = VStack(
          Text(escapeHtml(title)).className('ai-unified-conv-title')
        );

        if (preview) {
          convItem.add(Text(escapeHtml(preview)).className('ai-unified-conv-preview'));
        }

        if (streaming) {
          convItem.add(new View('span').className('ai-unified-conv-stream nr-breathe'));
        }

        var cls = 'ai-unified-conv-item' + (isActive ? ' ai-unified-conv-active' : '');
        convItem.className(cls).onTap(function() { _closeDropdown(); browseSelectTab(ct.tabId); });
        children.push(convItem);
      })(_convTabs[ci]);
    }
  }

  children.push(_divider());

  // 2. AI section
  var tab = _getActiveTab();
  var hasTab = tab && !tab.blank && tab.url;
  var annEnabled = hasTab && typeof window._annotationsEnabled !== 'undefined' && window._annotationsEnabled.get(tab.id);

  children.push(_dropdownItem(
    icon('annotate', { size: 14 }),
    annEnabled ? 'Remove Annotations' : 'Annotate Page',
    function() { _closeDropdown(); if (typeof window.toggleAnnotations === 'function') window.toggleAnnotations(); },
    { disabled: !hasTab, color: annEnabled ? 'var(--nr-accent)' : undefined }
  ));
  children.push(_dropdownItem(
    icon('speaker', { size: 14 }),
    'Read Aloud',
    function() { _closeDropdown(); if (typeof window._readPageAloud === 'function') window._readPageAloud(); },
    { disabled: !hasTab }
  ));
  children.push(_dropdownItem(
    icon('eye', { size: 14 }),
    'AI View',
    function() { _closeDropdown(); if (typeof window.browseShowAIView === 'function') window.browseShowAIView(); },
    { disabled: !hasTab }
  ));

  // 3. Audio section
  children.push(_divider());
  children.push(_sectionLabel('Audio'));

  if (audioState.tab) {
    children.push(_dropdownItem(
      window._islandAudioBars || '',
      escapeHtml(audioState.tab.label || 'Tab Audio'),
      function() { _closeDropdown(); if (typeof window.goToAudioTab === 'function') window.goToAudioTab(); }
    ));
  }

  if (audioState.tts) {
    var spdText = (parseFloat(Settings.get('ttsSpeed')) || 1).toFixed(1).replace(/\.0$/, '') + 'x';
    children.push(_dropdownItem(
      icon(audioState.tts.paused ? 'play' : 'pause', { size: 14 }),
      audioState.tts.paused ? 'Resume TTS' : 'Pause TTS',
      function() { if (typeof window._ttsPauseResume === 'function') window._ttsPauseResume(); _scheduleRender(); },
      { color: 'var(--nr-accent)', trailing: Text(spdText).styles({ marginLeft: 'auto', fontSize: '0.7rem', opacity: '0.5' }) }
    ));
    children.push(_dropdownItem(
      icon('close', { size: 14 }),
      'Stop TTS',
      function() { if (typeof window._ttsStopAll === 'function') window._ttsStopAll(); _scheduleRender(); }
    ));
  }

  if (audioState.cc) {
    children.push(_dropdownItem(
      icon('cc', { size: 14 }),
      escapeHtml(audioState.cc.label || 'CC'),
      function() { _closeDropdown(); if (typeof window.toggleCaptions === 'function') window.toggleCaptions(); },
      { color: 'var(--nr-accent)' }
    ));
  } else if (audioState.tab) {
    children.push(_dropdownItem(icon('cc', { size: 14 }), 'Captions', function() { _closeDropdown(); if (typeof window.toggleCaptions === 'function') window.toggleCaptions(); }));
  }

  // Mic
  if (audioState.micRecording) {
    children.push(_dropdownItem(
      icon('microphone', { size: 14, stroke: '#ef4444' }),
      'Stop recording',
      function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); },
      { color: '#ef4444' }
    ));
  } else if (audioState.mic) {
    children.push(_dropdownItem(
      icon('microphone', { size: 14 }),
      escapeHtml(audioState.mic.label || 'Transcribing\u2026'),
      null,
      { disabled: true }
    ));
  } else {
    children.push(_dropdownItem(icon('microphone', { size: 14 }), 'Voice input', function() { _closeDropdown(); if (typeof window._pillMicClick === 'function') window._pillMicClick(); }));
  }

  // White noise
  if (audioState.rainActive) {
    var noiseLabel = (typeof window.NOISE_PRESETS !== 'undefined' && audioState.rainNoiseType && window.NOISE_PRESETS[audioState.rainNoiseType]) ? window.NOISE_PRESETS[audioState.rainNoiseType].label : 'White noise';
    children.push(_dropdownItem(
      icon('rain', { size: 14 }),
      escapeHtml(noiseLabel),
      function() { _pillNoiseCycle(); _scheduleRender(); },
      { color: 'var(--nr-accent)' }
    ));
    children.push(_dropdownItem(icon('close', { size: 14 }), 'Stop noise', function() { if (typeof window.stopRain === 'function') window.stopRain(); _scheduleRender(); }));
  } else {
    children.push(_dropdownItem(icon('rain', { size: 14 }), 'White noise', function() { if (typeof window.startRain === 'function') window.startRain(); _scheduleRender(); }));
  }

  // Read aloud
  children.push(_dropdownItem(icon('speaker', { size: 14 }), 'Read aloud', function() { _closeDropdown(); if (typeof window._readPageAloud === 'function') window._readPageAloud(); }));

  // 4. Page Info section
  if (pageInfoState.label || pageInfoState.badges || (pageInfoState.meta && Object.keys(pageInfoState.meta).length)) {
    children.push(_divider());
    children.push(_sectionLabel('Page Info'));

    var meta = pageInfoState.meta || {};
    if (meta.published) {
      try {
        var pd = new Date(meta.published);
        children.push(_infoRow('Published', pd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
      } catch(e) { children.push(_infoRow('Published', meta.published)); }
    }
    if (meta.author) children.push(_infoRow('Author', meta.author));
    if (meta.ip) children.push(_infoRow('Server IP', meta.ip));
    if (meta.location) children.push(_infoRow('Location', meta.location));
    if (meta.org) children.push(_infoRow('Org', meta.org));
    if (meta.wordCount) {
      var mins = Math.max(1, Math.round(meta.wordCount / 238));
      children.push(_infoRow('Reading time', mins + ' min (' + meta.wordCount.toLocaleString() + ' words)'));
    }
    if (pageInfoState.badges) children.push(_infoRow('Position', pageInfoState.badges));
    if (meta.description) {
      var desc = meta.description.length > 150 ? meta.description.slice(0, 147) + '\u2026' : meta.description;
      children.push(Text(escapeHtml(desc)).className('ai-unified-info-desc'));
    }
  }

  // 5. Activity section — pulse events
  var recent = pulseState.recent || [];
  if (recent.length) {
    children.push(_divider());
    children.push(_sectionLabel('Activity'));

    var activityScroll = new View('div').className('ai-unified-activity-scroll');
    var start = Math.max(0, recent.length - 30);
    for (var ri = recent.length - 1; ri >= start; ri--) {
      var ev = recent[ri];
      var col = _pulseCatColors[ev.category] || '#94a3b8';
      var age = Math.round((Date.now() - ev.timestamp) / 1000);
      var ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      var statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';

      var eventRow = HStack(
        new View('span').className('ai-unified-event-status').styles({ background: statusDot }),
        Text(escapeHtml(ev.category)).className('ai-unified-event-cat').styles({ color: col }),
        Text(escapeHtml(ev.label)).className('ai-unified-event-label'),
        Text(ageStr).className('ai-unified-event-age')
      ).className('ai-unified-event');

      activityScroll.add(eventRow);
    }
    children.push(activityScroll);
  }

  AetherUI.mount(VStack(children), dropdown);
}

// ── Dropdown helpers ──

function _divider() {
  return new View('div').className('ai-unified-divider');
}

function _sectionLabel(text) {
  return Text(text).className('ai-unified-section-label');
}

function _dropdownItem(iconHtml, label, action, opts) {
  opts = opts || {};

  var cls = 'ai-unified-item';
  if (opts.highlight) cls += ' ai-unified-item-highlight';
  if (opts.disabled) cls += ' ai-unified-item-disabled';

  var iconView = RawHTML(iconHtml || '');
  var labelView = Text(label);

  var row = HStack(iconView, labelView);
  if (opts.color) row.styles({ color: opts.color });
  if (opts.trailing) row.add(opts.trailing);
  row.className(cls);

  if (action && !opts.disabled) {
    row.onTap(function(e) { e.stopPropagation(); action(); });
  }

  return row;
}

function _infoRow(label, value) {
  return HStack(
    Text(escapeHtml(label)).className('ai-unified-info-label'),
    Text(escapeHtml(value)).className('ai-unified-info-value')
  ).className('ai-unified-info-row');
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
        var lastAssistant2 = _lastAssistantPreview(window._popupChatMessages);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant2, active: true, streaming: !!window._aetherBackgroundStreaming });
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
  if (dropdown) dropdown.innerHTML = '';
}

function _onOutsideClick(e) {
  var el = document.getElementById('pill-ai-unified');
  if (el && !el.contains(e.target)) {
    _closeDropdown();
  }
}

// ── Exported: render AI panel content into an arbitrary container ──
export function renderAIPanelContent(container, onAction) {
  var state = _resolveIndicatorState();
  _renderDropdown(container, state);
  if (onAction) {
    // onAction fires after any dropdown item tap — wrap by re-mounting with interceptor
    container.addEventListener('click', function(e) {
      var item = e.target.closest('.ai-unified-item, .ai-unified-conv-item');
      if (item) onAction();
    });
  }
}

// ── Init ──
export function _initUnifiedPill() {
  var el = document.getElementById('pill-ai-unified');
  if (!el || el._unifiedBound) return;
  el._unifiedBound = true;

  el.addEventListener('click', function(e) {
    if (e.target.closest('[data-ai-inline-annotate]')) {
      e.stopPropagation();
      if (typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
      return;
    }
    if (e.target.closest('.ai-unified-dropdown button')) return;
    // Item taps are handled by individual view .onTap() handlers; only toggle dropdown on pill body clicks
    if (e.target.closest('.ai-unified-item') || e.target.closest('.ai-unified-conv-item')) return;
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
