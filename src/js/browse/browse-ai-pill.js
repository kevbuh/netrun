// browse-ai-pill.js — Unified AI pill combining audio, pulse, page info, and AI
// Renders into #pill-ai-unified on the right side of the nav bar
import Settings from '/js/core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { _annotationsEnabled, _readPageAloud, toggleAnnotations } from '/js/browse/browse-annotations.js';
import { browseShowAIView } from '/js/browse/browse-menu.js';
import { _pillMicClick, _pillMicRecorder } from '/js/browse/browse-island.js';
import { _ttsStopAll } from '/js/panel-tts.js';
import { _showPanel } from '/js/panel.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
import { goToAudioTab } from '/js/browse/browse-audio.js';
import { toggleCaptions } from '/js/browse/browse-captions.js';
import { NOISE_PRESETS, startRain, stopRain, setRainNoiseType } from '/js/core/core-sounds.js';

// ── State ──
let _dirty = false;
let _rafPending = false;
let _dropdownOpen = false;
let _outsideClickBound = false;

// Category colors for pulse events
const _pulseCatColors = { ai: '#a78bfa', feed: '#f97316', network: '#94a3b8', system: '#e879f9' };

// ── State priority resolver ──
// Returns dominant visual mode based on active subsystems
function _resolveIndicatorState() {
  const audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  const pulseState = typeof window._getPulseState === 'function' ? window._getPulseState() : {};
  const pageInfoState = typeof window._getPageInfoState === 'function' ? window._getPageInfoState() : {};

  // Check active subsystems
  const micRecording = audioState.micRecording;
  const aiActive = _isAIActive();
  const audioPlaying = !!(audioState.tab || audioState.tts);
  const pulseFlashing = pulseState.isFlashing;
  const hasPageInfo = !!(pageInfoState.label || pageInfoState.badges);

  // Priority order: mic > AI > audio > pulse > pageinfo > idle
  let primary = 'idle';
  if (micRecording) primary = 'mic';
  else if (aiActive) primary = 'ai';
  else if (audioPlaying) primary = 'audio';
  else if (pulseFlashing) primary = 'pulse';
  else if (hasPageInfo) primary = 'pageinfo';

  // Secondary dots for simultaneously active systems
  const secondary = [];
  if (primary !== 'mic' && micRecording) secondary.push('mic');
  if (primary !== 'ai' && aiActive) secondary.push('ai');
  if (primary !== 'audio' && audioPlaying) secondary.push('audio');
  if (primary !== 'pulse' && pulseFlashing) secondary.push('pulse');

  return { primary, secondary, audioState, pulseState, pageInfoState };
}

function _isAIActive() {
  // Check island activities for ai or insight types
  if (!window._islandActivities) return false;
  const acts = window._islandActivities.value;
  for (const id in acts) {
    const a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

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

// ── Gather inline content from island activities ──
function _getInlineContent() {
  if (!window._islandActivities) return { modelLabel: '', annotateOffer: false, annotateLabel: '', insightLoading: false };
  const acts = window._islandActivities.value;
  let modelLabel = '';
  let annotateOffer = false;
  let annotateLabel = '';
  let insightLoading = false;
  for (const id in acts) {
    const a = acts[id];
    if (!a) continue;
    if (a.type === 'ai' && a.label) modelLabel = a.label;
    if (a.type === 'insight') {
      if (a.offer) { annotateOffer = true; annotateLabel = a.label || 'Annotate'; }
      else if (a.loading) { insightLoading = true; annotateLabel = a.label || 'Analyzing\u2026'; }
      else if (a.label) { annotateLabel = a.label; }
    }
  }
  return { modelLabel, annotateOffer, annotateLabel, insightLoading };
}

// ── Main render ──
function _renderUnifiedPill() {
  const el = document.getElementById('pill-ai-unified');
  if (!el) return;

  const state = _resolveIndicatorState();
  const { primary, secondary, audioState, pulseState } = state;
  const inline = _getInlineContent();

  // ── Indicator ──
  const indicator = el.querySelector('.ai-unified-indicator');
  if (indicator) {
    _renderIndicator(indicator, primary, pulseState);
  }

  // ── Inline labels (model + annotate) ──
  const labelContainer = el.querySelector('.ai-unified-labels');
  if (labelContainer) {
    _renderInlineLabels(labelContainer, inline);
  }

  // Toggle expanded class when there's inline content
  const hasInline = !!(inline.modelLabel || inline.annotateLabel);
  el.classList.toggle('ai-unified-expanded', hasInline);

  // ── Secondary dots ──
  const secContainer = el.querySelector('.ai-unified-secondary');
  if (secContainer) {
    _renderSecondaryDots(secContainer, secondary);
  }

  // ── Dropdown content (only when open) ──
  if (_dropdownOpen) {
    const dropdown = el.querySelector('.ai-unified-dropdown');
    if (dropdown) _renderDropdown(dropdown, state);
  }
}

// ── Inline labels rendering ──
function _renderInlineLabels(container, inline) {
  let html = '';
  if (inline.modelLabel) {
    html += '<span class="ai-unified-model-label">' + escapeHtml(inline.modelLabel) + '</span>';
  }
  if (inline.annotateLabel) {
    const annIcon = inline.annotateOffer
      ? icon('comment', { size: 12, stroke: 'var(--nr-text-secondary)' })
      : (inline.insightLoading ? '<span class="island-annotate-dot"></span>' : icon('comment', { size: 12 }));
    const cls = inline.annotateOffer ? ' ai-unified-annotate-offer' : '';
    html += '<span class="ai-unified-annotate-label' + cls + '" data-ai-inline-annotate="1">' + annIcon + '<span>' + escapeHtml(inline.annotateLabel) + '</span></span>';
  }
  if (container._lastHtml !== html) {
    container.innerHTML = html;
    container._lastHtml = html;
  }
}

// ── Indicator rendering ──
function _renderIndicator(container, primary, pulseState) {
  let html = '';
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
      const lastEvent = pulseState.lastEvent;
      const col = lastEvent ? (_pulseCatColors[lastEvent.category] || '#94a3b8') : '#94a3b8';
      html = '<span class="ai-unified-dot ai-unified-dot-pulse" style="background:' + col + ';box-shadow:0 0 6px ' + col + '"></span>';
      container.classList.add('ai-unified-pulse');
      break;
    }
    case 'pageinfo':
      html = '<span class="ai-unified-dot ai-unified-dot-idle nr-breathe"></span>';
      container.classList.add('ai-unified-idle');
      break;
    default: // idle
      html = icon('sparkles', { size: 14 });
      container.classList.add('ai-unified-idle');
      break;
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
  const colorMap = { mic: '#ef4444', ai: '#a78bfa', audio: 'var(--nr-accent)', pulse: '#94a3b8' };
  let html = '';
  for (let i = 0; i < secondary.length; i++) {
    const col = colorMap[secondary[i]] || '#94a3b8';
    html += '<span class="ai-unified-sec-dot" style="background:' + col + '"></span>';
  }
  if (container._lastHtml !== html) {
    container.innerHTML = html;
    container._lastHtml = html;
  }
}

// ── Dropdown rendering ──
function _renderDropdown(dropdown, state) {
  const { audioState, pulseState, pageInfoState } = state;
  const items = [];

  // 1. Ask AI — always at top
  items.push(_dropdownItem(
    icon('chatBubble', { size: 14 }),
    'Ask AI',
    function() { _closeDropdown(); _showPanel({ anchor: _pillAnchor(), trackCursor: false }); },
    { highlight: true }
  ));

  // Conversations section — tabs with active AI chats
  const _convTabs = _collectConversationTabs();
  if (_convTabs.length > 0) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Conversations</div>');
    for (let ci = 0; ci < _convTabs.length; ci++) {
      (function(ct) {
        const isActive = ct.active;
        const streaming = ct.streaming;
        const preview = ct.preview ? escapeHtml(ct.preview) : '';
        const title = escapeHtml(ct.title || 'New Tab');
        const streamDot = streaming ? '<span class="ai-unified-conv-stream nr-breathe"></span>' : '';
        const activeCls = isActive ? ' ai-unified-conv-active' : '';
        const id = '_aia_' + (++_actionCounter);
        _actionMap[id] = function() { _closeDropdown(); browseSelectTab(ct.tabId); };
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
  const tab = _getActiveTab();
  const hasTab = tab && !tab.blank && tab.url;
  const annEnabled = hasTab && typeof _annotationsEnabled !== 'undefined' && _annotationsEnabled.get(tab.id);

  items.push(_dropdownItem(
    icon('annotate', { size: 14 }),
    annEnabled ? 'Remove Annotations' : 'Annotate Page',
    function() { _closeDropdown(); toggleAnnotations(); },
    { disabled: !hasTab, color: annEnabled ? 'var(--nr-accent)' : undefined }
  ));
  items.push(_dropdownItem(
    icon('speaker', { size: 14 }),
    'Read Aloud',
    function() { _closeDropdown(); _readPageAloud(); },
    { disabled: !hasTab }
  ));
  items.push(_dropdownItem(
    icon('eye', { size: 14 }),
    'AI View',
    function() { _closeDropdown(); browseShowAIView(); },
    { disabled: !hasTab }
  ));

  // 3. Audio section (only when sources exist)
  const hasAudio = !!(audioState.tab || audioState.tts || audioState.cc || audioState.mic || audioState.micRecording || audioState.rainActive);
  if (hasAudio || true) { // Always show audio section for mic/noise access
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Audio</div>');

    if (audioState.tab) {
      items.push(_dropdownItem(
        window._islandAudioBars || '',
        escapeHtml(audioState.tab.label || 'Tab Audio'),
        function() { _closeDropdown(); if (typeof goToAudioTab === 'function') goToAudioTab(); }
      ));
    }

    if (audioState.tts) {
      const spdText = (parseFloat(Settings.get('ttsSpeed')) || 1).toFixed(1).replace(/\.0$/, '') + 'x';
      items.push(_dropdownItem(
        icon(audioState.tts.paused ? 'play' : 'pause', { size: 14 }),
        audioState.tts.paused ? 'Resume TTS' : 'Pause TTS',
        function() { _ttsPauseResume(); _scheduleRender(); },
        { color: 'var(--nr-accent)', trailing: '<span style="margin-left:auto;font-size:0.7rem;opacity:0.5">' + spdText + '</span>' }
      ));
      items.push(_dropdownItem(
        icon('close', { size: 14 }),
        'Stop TTS',
        function() { _ttsStopAll(); _scheduleRender(); }
      ));
    }

    if (audioState.cc) {
      items.push(_dropdownItem(
        icon('cc', { size: 14 }),
        escapeHtml(audioState.cc.label || 'CC'),
        function() { _closeDropdown(); toggleCaptions(); },
        { color: 'var(--nr-accent)' }
      ));
    } else if (audioState.tab) {
      items.push(_dropdownItem(icon('cc', { size: 14 }), 'Captions', function() { _closeDropdown(); toggleCaptions(); }));
    }

    // Mic
    if (audioState.micRecording) {
      items.push(_dropdownItem(
        icon('microphone', { size: 14, stroke: '#ef4444' }),
        'Stop recording',
        function() { _pillMicClick(); },
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
      items.push(_dropdownItem(icon('microphone', { size: 14 }), 'Voice input', function() { _closeDropdown(); _pillMicClick(); }));
    }

    // White noise
    if (audioState.rainActive) {
      const noiseLabel = (typeof NOISE_PRESETS !== 'undefined' && audioState.rainNoiseType && NOISE_PRESETS[audioState.rainNoiseType]) ? NOISE_PRESETS[audioState.rainNoiseType].label : 'White noise';
      items.push(_dropdownItem(
        icon('rain', { size: 14 }),
        escapeHtml(noiseLabel),
        function() { _pillNoiseCycle(); _scheduleRender(); },
        { color: 'var(--nr-accent)' }
      ));
      items.push(_dropdownItem(icon('close', { size: 14 }), 'Stop noise', function() { stopRain(); _scheduleRender(); }));
    } else {
      items.push(_dropdownItem(icon('rain', { size: 14 }), 'White noise', function() { startRain(); _scheduleRender(); }));
    }

    // Read aloud
    items.push(_dropdownItem(icon('speaker', { size: 14 }), 'Read aloud', function() { _closeDropdown(); _readPageAloud(); }));
  }

  // 4. Page Info section (only when data exists)
  if (pageInfoState.label || pageInfoState.badges || (pageInfoState.meta && Object.keys(pageInfoState.meta).length)) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Page Info</div>');

    const meta = pageInfoState.meta || {};
    if (meta.published) {
      try {
        const pd = new Date(meta.published);
        items.push(_infoRow('Published', pd.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
      } catch(e) { items.push(_infoRow('Published', meta.published)); }
    }
    if (meta.author) items.push(_infoRow('Author', meta.author));
    if (meta.wordCount) {
      const mins = Math.max(1, Math.round(meta.wordCount / 238));
      items.push(_infoRow('Reading time', mins + ' min (' + meta.wordCount.toLocaleString() + ' words)'));
    }
    if (pageInfoState.badges) items.push(_infoRow('Position', pageInfoState.badges));
    if (meta.description) {
      const desc = meta.description.length > 150 ? meta.description.slice(0, 147) + '\u2026' : meta.description;
      items.push('<div class="ai-unified-info-desc">' + escapeHtml(desc) + '</div>');
    }
  }

  // 5. Activity section — last 30 pulse events
  const recent = pulseState.recent || [];
  if (recent.length) {
    items.push('<div class="ai-unified-divider"></div>');
    items.push('<div class="ai-unified-section-label">Activity</div>');
    items.push('<div class="ai-unified-activity-scroll">');
    const start = Math.max(0, recent.length - 30);
    for (let ri = recent.length - 1; ri >= start; ri--) {
      const ev = recent[ri];
      const col = _pulseCatColors[ev.category] || '#94a3b8';
      const age = Math.round((Date.now() - ev.timestamp) / 1000);
      const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
      const statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';
      items.push('<div class="ai-unified-event">'
        + '<span class="ai-unified-event-status" style="background:' + statusDot + '"></span>'
        + '<span class="ai-unified-event-cat" style="color:' + col + '">' + escapeHtml(ev.category) + '</span>'
        + '<span class="ai-unified-event-label">' + escapeHtml(ev.label) + '</span>'
        + '<span class="ai-unified-event-age">' + ageStr + '</span>'
        + '</div>');
    }
    items.push('</div>');
  }

  const html = items.join('');
  if (dropdown._lastHtml !== html) {
    dropdown.innerHTML = html;
    dropdown._lastHtml = html;
    // Bind click handlers on the dropdown items
    dropdown.querySelectorAll('[data-ai-action]').forEach(function(el) {
      // Already handled via inline onclick
    });
  }
}

// ── Dropdown helpers ──
let _actionCounter = 0;
const _actionMap = {};

function _dropdownItem(iconHtml, label, action, opts) {
  opts = opts || {};
  const id = '_aia_' + (++_actionCounter);
  if (action) _actionMap[id] = action;
  let cls = 'ai-unified-item';
  if (opts.highlight) cls += ' ai-unified-item-highlight';
  if (opts.disabled) cls += ' ai-unified-item-disabled';
  let style = '';
  if (opts.color) style += 'color:' + opts.color + ';';
  const trailing = opts.trailing || '';
  return '<div class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + ' data-ai-action="' + id + '">'
    + iconHtml + '<span>' + label + '</span>' + trailing + '</div>';
}

function _infoRow(label, value) {
  return '<div class="ai-unified-info-row"><span class="ai-unified-info-label">' + escapeHtml(label) + '</span><span class="ai-unified-info-value">' + escapeHtml(value) + '</span></div>';
}

// ── Pill noise cycle (from core-audio.js) ──
function _pillNoiseCycle() {
  const types = typeof NOISE_PRESETS !== 'undefined' ? Object.keys(NOISE_PRESETS) : [];
  if (!types.length) return;
  const audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  const cur = audioState.rainNoiseType || 'rain';
  const idx = types.indexOf(cur);
  const next = types[(idx + 1) % types.length];
  setRainNoiseType(next);
}

// ── TTS pause/resume (global) ──
function _ttsPauseResume() {
  if (typeof window._ttsPauseResume === 'function') window._ttsPauseResume();
}

// ── Collect tabs with active AI conversations ──
function _collectConversationTabs() {
  if (typeof window._browseWindows === 'undefined') return [];
  const results = [];
  const activeTabId = typeof window._browseActiveTab !== 'undefined' ? window._browseActiveTab : null;
  for (let wi = 0; wi < window._browseWindows.length; wi++) {
    const win = window._browseWindows[wi];
    for (let ti = 0; ti < win.tabs.length; ti++) {
      const t = win.tabs[ti];
      const isActive = t.id === activeTabId;
      // Check saved _aiPanel state
      if (t._aiPanel && t._aiPanel.hasChat) {
        const msgs = t._aiPanel.messages || [];
        const lastAssistant = _lastAssistantPreview(msgs);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant, active: isActive, streaming: !!(t._aiPanel.backgroundStreaming) });
      }
      // Also check if active tab has messages in globals (not yet saved to _aiPanel)
      else if (isActive && window._popupChatMessages && window._popupChatMessages.length > 0) {
        const lastAssistant = _lastAssistantPreview(window._popupChatMessages);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant, active: true, streaming: !!window._aetherBackgroundStreaming });
      }
    }
  }
  return results;
}

function _lastAssistantPreview(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content) {
      const text = messages[i].content.replace(/[#*_`~\[\]]/g, '').trim();
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
  const el = document.getElementById('pill-ai-unified');
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.bottom + 4 };
}

// ── Open/close dropdown ──
function _openDropdown() {
  const el = document.getElementById('pill-ai-unified');
  if (!el) return;
  _dropdownOpen = true;
  _actionCounter = 0; // reset action map
  for (const k in _actionMap) delete _actionMap[k];
  el.classList.add('ai-unified-open');
  _renderUnifiedPill();
  document.body.classList.add('island-dropdown-guard');
  // Bind outside click
  if (!_outsideClickBound) {
    _outsideClickBound = true;
    setTimeout(function() {
      document.addEventListener('mousedown', _onOutsideClick);
    }, 10);
  }
}

function _closeDropdown() {
  const el = document.getElementById('pill-ai-unified');
  if (!el) return;
  _dropdownOpen = false;
  el.classList.remove('ai-unified-open');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _onOutsideClick);
  _outsideClickBound = false;
  // Clear dropdown content
  const dropdown = el.querySelector('.ai-unified-dropdown');
  if (dropdown) { dropdown.innerHTML = ''; dropdown._lastHtml = ''; }
}

function _onOutsideClick(e) {
  const el = document.getElementById('pill-ai-unified');
  if (el && !el.contains(e.target)) {
    _closeDropdown();
  }
}

// ── Init ──
function _initUnifiedPill() {
  const el = document.getElementById('pill-ai-unified');
  if (!el || el._unifiedBound) return;
  el._unifiedBound = true;

  // Click indicator to toggle dropdown
  el.addEventListener('click', function(e) {
    // Don't toggle if clicking inside dropdown on an action
    const actionEl = e.target.closest('[data-ai-action]');
    if (actionEl) {
      e.stopPropagation();
      const actionId = actionEl.getAttribute('data-ai-action');
      if (_actionMap[actionId]) _actionMap[actionId]();
      return;
    }
    // Inline annotate label click → toggle annotations directly
    if (e.target.closest('[data-ai-inline-annotate]')) {
      e.stopPropagation();
      toggleAnnotations();
      return;
    }
    // Don't toggle if clicking a button inside dropdown
    if (e.target.closest('.ai-unified-dropdown button')) return;
    e.stopPropagation();
    if (_dropdownOpen) _closeDropdown();
    else _openDropdown();
  });

  // Close on window blur (webview stealing focus)
  let _blurTimer = 0;
  window.addEventListener('blur', function() {
    clearTimeout(_blurTimer);
    _blurTimer = setTimeout(function() {
      if (_dropdownOpen) _closeDropdown();
    }, 300);
  });
  window.addEventListener('focus', function() { clearTimeout(_blurTimer); });

  // Initial render
  _renderUnifiedPill();

  // Hook into pulse system if available
  if (typeof Motion !== 'undefined' && Motion.pulse) {
    let _pulseThrottle = null;
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
