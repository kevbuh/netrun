// toolbar-ai-pill.js — Unified AI/audio indicator + dropdown
// Replaces browse-ai-pill.js
import Settings from '/js/core/core-settings.js';
import { escapeHtml } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { aiPillState } from '/js/toolbar/toolbar-state.js';
import { browseSelectTab } from '/js/browse/browse-passwords.js';
import { toggleAnnotations, _annotationsEnabled, _insightAnalyzing } from '/js/browse/browse-annotations.js';
import { toggleCaptions } from '/js/browse/browse-captions.js';
import { _showPanel } from '/js/panel.js';
import { _browseToggleWebviewDarkMode } from '/js/browse/browse-frame-bind.js';
import { _nerdModeEnabled } from '/js/browse/browse-nerd-mode.js';

// ── State ──
let _dirty = false;
let _rafPending = false;
let _dropdownOpen = false;
let _outsideClickBound = false;
let _dropdownStateKey = '';  // fingerprint to avoid unnecessary dropdown re-renders
let _ccCenterKey = null;     // fingerprint for CC live captions in center column
let _micCenterKey = null;    // fingerprint for mic live transcript in center column

// Category colors for pulse events
const _pulseCatColors = { ai: '#a78bfa', feed: '#f97316', network: '#94a3b8', system: '#e879f9' };

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
  const audioState = typeof window._getAudioState === 'function' ? window._getAudioState() : {};
  const pulseState = typeof window._getPulseState === 'function' ? window._getPulseState() : {};
  const micRecording = audioState.micRecording;
  const aiActive = _isAIActive();
  const audioPlaying = !!(audioState.tab || audioState.tts);
  const pulseFlashing = pulseState.isFlashing;

  let primary = 'idle';
  if (micRecording) primary = 'mic';
  else if (aiActive) primary = 'ai';
  else if (audioPlaying) primary = 'audio';
  else if (pulseFlashing) primary = 'pulse';

  const secondary = [];
  if (primary !== 'mic' && micRecording) secondary.push('mic');
  if (primary !== 'ai' && aiActive) secondary.push('ai');
  if (primary !== 'audio' && audioPlaying) secondary.push('audio');
  if (primary !== 'pulse' && pulseFlashing) secondary.push('pulse');

  return { primary: primary, secondary: secondary, audioState: audioState, pulseState: pulseState };
}

function _isAIActive() {
  if (!window._islandActivities) return false;
  const acts = window._islandActivities.value;
  for (const id in acts) {
    const a = acts[id];
    if (a && (a.type === 'ai' || (a.type === 'insight' && a.loading))) return true;
  }
  return false;
}

// ── Gather inline content from island activities ──
function _getInlineContent() {
  if (!window._islandActivities) return { modelLabel: '', modelName: '', annotateOffer: false, annotateLabel: '', insightLoading: false };
  const acts = window._islandActivities.value;
  let modelLabel = '';
  let modelName = '';
  let annotateOffer = false;
  let annotateLabel = '';
  let insightLoading = false;
  for (const id in acts) {
    const a = acts[id];
    if (!a) continue;
    if (a.type === 'ai' && a.label) { modelLabel = a.label; if (a.detail) modelName = a.detail; }
    if (a.type === 'insight') {
      if (a.offer) { annotateOffer = true; annotateLabel = a.label || 'Annotate'; }
      else if (a.loading) {
        insightLoading = true;
        annotateLabel = a.label || 'Analyzing\u2026';
        // LLM activity: show label + model in the pill
        if (!modelLabel && a.label) modelLabel = a.label;
        if (!modelName && a.detail) modelName = a.detail;
      }
      else if (a.label) { annotateLabel = a.label; }
    }
  }
  return { modelLabel: modelLabel, modelName: modelName, annotateOffer: annotateOffer, annotateLabel: annotateLabel, insightLoading: insightLoading };
}

// ── Main render ──
function _renderUnifiedPill() {
  const el = document.getElementById('pill-ai-unified');
  if (!el) return;

  // Hide entire pill when AI is disabled
  el.style.display = Settings.aiEnabled() ? '' : 'none';
  if (!Settings.aiEnabled()) return;

  const state = _resolveIndicatorState();
  const inline = _getInlineContent();

  // Indicator
  const indicator = el.querySelector('.ai-unified-indicator');
  if (indicator) _renderIndicator(indicator, state.primary, state.pulseState);

  // Inline labels
  const labelContainer = el.querySelector('.ai-unified-labels');
  if (labelContainer) _renderInlineLabels(labelContainer, inline);

  const hasInline = !!inline.modelLabel;
  el.classList.toggle('ai-unified-expanded', hasInline);

  // Secondary dots
  const secContainer = el.querySelector('.ai-unified-secondary');
  if (secContainer) _renderSecondaryDots(secContainer, state.secondary);

  // Dropdown — only re-render when audio/mic/tts/cc state actually changed
  if (_dropdownOpen) {
    const dropdown = el.querySelector('.ai-unified-dropdown');
    if (dropdown) {
      const as = state.audioState;
      const _liveCount = typeof window._getActiveLLMCalls === 'function' ? window._getActiveLLMCalls().length : 0;
      const _pulseCount = (state.pulseState.recent || []).length;
      const _activeTab = _getActiveTab();
      const _darkKey = _activeTab && _activeTab._webviewDarkMode;
      const _cssKey = Settings.get('autoRemoveCSS');
      const _nerdKey = _activeTab && _nerdModeEnabled.get(_activeTab.id);
      const _annKey = _activeTab && (_insightAnalyzing.get(_activeTab.id) || _annotationsEnabled.get(_activeTab.id));
      const key = [state.primary, !!as.tab, !!as.tts, as.tts && as.tts.paused, !!as.cc, !!as.mic, as.micRecording, _liveCount, _pulseCount, _darkKey, _cssKey, _nerdKey, _annKey].join(',');
      if (key !== _dropdownStateKey) {
        _dropdownStateKey = key;
        _renderDropdown(dropdown, state);
      }
    }
  }

  // Popup open — re-render CC/mic center column when state changes
  const wrap = document.getElementById('pill-url-wrap');
  if (wrap && window._urlPopupEl) {
    const as2 = state.audioState;

    // Center column — re-render when CC is active (live captions)
    if (as2.cc && as2.cc.active) {
      const ccAct = window._islandActivities ? window._islandActivities.value.cc : null;
      const ccLen = ccAct && ccAct.lines ? ccAct.lines.length : 0;
      const ccKey = 'cc:' + ccLen;
      if (ccKey !== _ccCenterKey) {
        _ccCenterKey = ccKey;
        if (typeof window._renderIslandActions === 'function') window._renderIslandActions();
      }
    } else if (_ccCenterKey) {
      _ccCenterKey = null;
      if (typeof window._renderIslandActions === 'function') window._renderIslandActions();
    }

    // Center column — re-render when mic is active (live transcript)
    if (as2.micRecording) {
      const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
      const micLen = micAct && micAct.lines ? micAct.lines.length : 0;
      const micKey = 'mic:' + micLen;
      if (micKey !== _micCenterKey) {
        _micCenterKey = micKey;
        if (typeof window._renderIslandActions === 'function') window._renderIslandActions();
      }
    } else if (_micCenterKey) {
      _micCenterKey = null;
      if (typeof window._renderIslandActions === 'function') window._renderIslandActions();
    }
  }
}

// ── Indicator rendering ──
function _renderIndicator(container, primary, pulseState) {
  let view;
  container.className = 'ai-unified-indicator';

  switch (primary) {
    case 'mic':
      view = RawHTML('<span class="island-waveform island-waveform-mic island-waveform-anim">' +
        '<span class="island-waveform-bar"></span>' +
        '<span class="island-waveform-bar"></span>' +
        '<span class="island-waveform-bar"></span>' +
        '<span class="island-waveform-bar"></span>' +
        '<span class="island-waveform-bar"></span>' +
        '</span>');
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
      const lastEvent = pulseState.lastEvent;
      const col = lastEvent ? (_pulseCatColors[lastEvent.category] || '#94a3b8') : '#94a3b8';
      view = new View('span')
        .className('ai-unified-dot ai-unified-dot-pulse')
        .styles({ background: col, boxShadow: '0 0 6px ' + col });
      container.classList.add('ai-unified-pulse');
      break;
    }
    case 'pageinfo':
      // fallthrough to idle

    default:
      view = RawHTML(icon('sparkles', { size: 14 }));
      container.classList.add('ai-unified-idle');
      break;
  }

  AetherUI.mount(view, container);
}

// ── Short model name for display ──
function _shortModelName(model) {
  if (!model) return '';
  let m = model;
  // Strip provider prefix (e.g. "google/gemini-2.0-flash-001" → "gemini-2.0-flash-001")
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  // Strip trailing version suffixes like "-001", "-20250219", ":latest"
  m = m.replace(/[-:](latest|\d{6,}|\d{3})$/i, '');
  // Strip ":7b", ":14b" etc. tag — keep as suffix
  const tagMatch = m.match(/:(\d+\.?\d*[bBmM])$/);
  const tag = tagMatch ? ' ' + tagMatch[1].toUpperCase() : '';
  if (tagMatch) m = m.replace(/:[\d.]+[bBmM]$/, '');
  // Capitalize first letter of each word segment
  m = m.split(/[-_]/).map(function(w) {
    if (/^\d/.test(w)) return w; // keep version numbers as-is
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  // Collapse redundant spaces
  m = m.replace(/\s+/g, ' ').trim();
  return m + tag;
}

// ── Inline labels ──
function _renderInlineLabels(container, inline) {
  if (!inline.modelLabel) {
    container.innerHTML = '';
    return;
  }

  // Show only the task label inline (e.g. "Chatting", "Analyzing…")
  // Model name is visible in the dropdown on click
  const label = Text(escapeHtml(inline.modelLabel)).className('ai-unified-model-label');
  AetherUI.mount(label, container);
}

// ── Secondary dots ──
function _renderSecondaryDots(container, secondary) {
  if (!secondary.length) {
    container.innerHTML = '';
    return;
  }

  const colorMap = { mic: '#ef4444', ai: '#a78bfa', audio: 'var(--nr-accent)', pulse: '#94a3b8' };
  const dots = secondary.map(function(s) {
    const col = colorMap[s] || '#94a3b8';
    return new View('span')
      .className('ai-unified-sec-dot')
      .styles({ background: col });
  });

  AetherUI.mount(HStack(dots), container);
}

// ── Dropdown rendering ──
function _renderDropdown(dropdown, state) {
  const audioState = state.audioState;
  const pulseState = state.pulseState;

  const children = [];

  // 1. Ask AI
  children.push(_dropdownItem(
    icon('chatBubble', { size: 16 }),
    'Ask AI',
    function() { _closeDropdown(); _showPanel({ anchor: _pillAnchor(), trackCursor: false }); },
    { highlight: true }
  ));

  // Conversations
  const _convTabs = _collectConversationTabs();
  if (_convTabs.length > 0) {
    children.push(_divider());
    children.push(_sectionLabel('Conversations'));
    for (let ci = 0; ci < _convTabs.length; ci++) {
      (function(ct) {
        const isActive = ct.active;
        const streaming = ct.streaming;
        const preview = ct.preview || '';
        const title = ct.title || 'New Tab';

        const convItem = VStack(
          Text(escapeHtml(title)).className('ai-unified-conv-title')
        );

        if (preview) {
          convItem.add(Text(escapeHtml(preview)).className('ai-unified-conv-preview'));
        }

        if (streaming) {
          convItem.add(new View('span').className('ai-unified-conv-stream nr-breathe'));
        }

        const cls = 'ai-unified-conv-item' + (isActive ? ' ai-unified-conv-active' : '');
        convItem.className(cls).onTap(function() { _closeDropdown(); browseSelectTab(ct.tabId); });
        children.push(convItem);
      })(_convTabs[ci]);
    }
  }

  children.push(_divider());

  // 2. Page Tools section
  children.push(_sectionLabel('Page Tools'));
  const tab = _getActiveTab();
  const hasTab = tab && !tab.blank && tab.url;

  const _darkOn = tab && tab._webviewDarkMode;
  children.push(_dropdownItem(
    icon('moon', { size: 16, strokeWidth: '1.5' }),
    'Dark Mode',
    function() { _browseToggleWebviewDarkMode(tab); _scheduleRender(); },
    { disabled: !hasTab, color: _darkOn ? 'var(--nr-accent)' : undefined, trailing: Text(_darkOn ? 'On' : 'Off').font('caption2').foreground('quaternary') }
  ));

  const _cssOn = Settings.get('autoRemoveCSS') === 'true';
  children.push(_dropdownItem(
    icon('code', { size: 16, strokeWidth: '1.5' }),
    'Auto Remove CSS',
    function() { if (typeof window.toggleAutoRemoveCSS === 'function') window.toggleAutoRemoveCSS(); _closeDropdown(); },
    { disabled: !hasTab, color: _cssOn ? 'var(--nr-accent)' : undefined, trailing: Text(_cssOn ? 'On' : 'Off').font('caption2').foreground('quaternary') }
  ));

  const annAnalyzing = hasTab && _insightAnalyzing.get(tab.id);
  const annEnabled = hasTab && !annAnalyzing && _annotationsEnabled.get(tab.id);
  const annLabel = annAnalyzing ? 'Stop Analyzing' : annEnabled ? 'Remove Annotations' : 'Annotate Page';
  children.push(_dropdownItem(
    icon('annotate', { size: 16 }),
    annLabel,
    function() { _closeDropdown(); toggleAnnotations(); },
    { disabled: !hasTab, color: (annEnabled || annAnalyzing) ? 'var(--nr-accent)' : undefined }
  ));

  const _nerdOn = tab && _nerdModeEnabled.get(tab.id);
  const isPdfForNerd = hasTab && (tab.pdfUrl || tab.localPath || tab._nbParsedData || (tab.url && tab.url.toLowerCase().endsWith('.pdf')) || (tab.url && tab.url.toLowerCase().endsWith('.ipynb')) || (tab.url && tab.url.includes('/pdf/') && tab.url.includes('arxiv.org')));
  children.push(_dropdownItem(
    icon('research', { size: 16 }),
    'Nerd Mode',
    function() { if (typeof window.toggleNerdMode === 'function') window.toggleNerdMode(tab); _closeDropdown(); },
    { disabled: !isPdfForNerd, color: _nerdOn ? 'var(--nr-accent)' : undefined, trailing: _nerdOn ? Text('On').font('caption2').foreground('quaternary') : undefined }
  ));

  const ttsActive = !!(window._ttsAudio || window._ttsPaused || (window._ttsChunks && window._ttsChunks.length > 0));
  children.push(_dropdownItem(
    icon(ttsActive ? 'close' : 'speaker', { size: 16 }),
    ttsActive ? 'Stop Reading' : 'Read Aloud',
    function() {
      if (ttsActive) { window._ttsStopAll(); _scheduleRender(); }
      else { _closeDropdown(); if (typeof window._readPageAloud === 'function') window._readPageAloud(); }
    },
    { disabled: !hasTab && !ttsActive, color: ttsActive ? '#ef4444' : undefined }
  ));

  children.push(_dropdownItem(
    icon('eye', { size: 16, strokeWidth: '1.5' }),
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
    const spdText = (parseFloat(Settings.get('ttsSpeed')) || 1).toFixed(1).replace(/\.0$/, '') + 'x';
    children.push(_dropdownItem(
      icon(audioState.tts.paused ? 'play' : 'pause', { size: 16 }),
      audioState.tts.paused ? 'Resume TTS' : 'Pause TTS',
      function() { window._ttsPauseResume(); _scheduleRender(); },
      { color: 'var(--nr-accent)', trailing: Text(spdText).font('caption2').foreground('quaternary') }
    ));
    children.push(_dropdownItem(
      icon('close', { size: 16 }),
      'Stop TTS',
      function() { window._ttsStopAll(); _scheduleRender(); }
    ));
  }

  if (audioState.cc) {
    children.push(_dropdownItem(
      icon('cc', { size: 16 }),
      escapeHtml(audioState.cc.label || 'CC'),
      function() { toggleCaptions(); _scheduleRender(); },
      { color: 'var(--nr-accent)' }
    ));
  } else if (audioState.tab) {
    children.push(_dropdownItem(icon('cc', { size: 16 }), 'Captions', function() { toggleCaptions(); _scheduleRender(); }));
  }

  // Mic
  if (audioState.micRecording) {
    children.push(_dropdownItem(
      icon('microphone', { size: 16, stroke: '#ef4444' }),
      'Stop recording',
      function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); },
      { color: '#ef4444' }
    ));
  } else if (audioState.mic) {
    children.push(_dropdownItem(
      icon('microphone', { size: 16 }),
      escapeHtml(audioState.mic.label || 'Transcribing\u2026'),
      null,
      { disabled: true }
    ));
  } else {
    children.push(_dropdownItem(icon('microphone', { size: 16 }), 'Voice input', function() {
      _closeDropdown();
      if (typeof window._pillMicClick === 'function') { window._pillMicClick(); }
      else { _showPanel({ anchor: _pillAnchor(), trackCursor: false }); setTimeout(function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); }, 100); }
      _scheduleRender();
    }));
  }

  // 4. Page Info — shown in expanded island, not here

  // 5. Activity section — live calls + pulse events (always visible)
  children.push(_divider());
  children.push(_sectionLabel('Activity'));

  const activityScroll = new View('div').className('ai-unified-activity-scroll');

  // Live LLM calls first
  const _liveCalls2 = typeof window._getActiveLLMCalls === 'function' ? window._getActiveLLMCalls() : [];
  for (let li2 = 0; li2 < _liveCalls2.length; li2++) {
    const lc2 = _liveCalls2[li2];
    const lcModel2 = _shortModelName(lc2.model);
    const lcAge2 = Math.round((Date.now() - lc2.startTs) / 1000);
    const lcAgeStr2 = lcAge2 < 60 ? lcAge2 + 's' : Math.round(lcAge2 / 60) + 'm';
    const lcChildren = [new View('span').className('ai-unified-dot ai-unified-dot-ai nr-breathe')];
    if (lcModel2) lcChildren.push(Text(escapeHtml(lcModel2)).className('ai-unified-event-cat').styles({ color: '#a78bfa' }));
    lcChildren.push(Text(escapeHtml(lc2.label + '\u2026')).className('ai-unified-event-label'));
    lcChildren.push(Text(lcAgeStr2).className('ai-unified-event-age'));
    activityScroll.add(HStack(lcChildren).className('ai-unified-event'));
  }

  // Historical pulse events
  const recent = pulseState.recent || [];
  const start = Math.max(0, recent.length - 30);
  for (let ri = recent.length - 1; ri >= start; ri--) {
    const ev = recent[ri];
    const col = _pulseCatColors[ev.category] || '#94a3b8';
    const age = Math.round((Date.now() - ev.timestamp) / 1000);
    const ageStr = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago';
    const statusDot = ev.ok === true ? '#22c55e' : ev.ok === false ? '#ef4444' : '#94a3b8';

    const evLabel = ev.label || '';
    const evModel = (ev.category === 'ai' && ev.detail) ? _shortModelName(ev.detail) : '';
    const labelText = evModel ? evLabel + ' \u00b7 ' + evModel : evLabel;

    const eventRow = HStack(
      new View('span').className('ai-unified-event-status').styles({ background: statusDot }),
      Text(escapeHtml(ev.category)).className('ai-unified-event-cat').styles({ color: col }),
      Text(escapeHtml(labelText)).className('ai-unified-event-label'),
      Text(ageStr).className('ai-unified-event-age')
    ).className('ai-unified-event');

    activityScroll.add(eventRow);
  }

  if (_liveCalls2.length === 0 && recent.length === 0) {
    activityScroll.add(Text('No recent activity').styles({ padding: '4px 10px', opacity: '0.3', fontSize: '0.65rem' }));
  }

  children.push(activityScroll);

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

  let cls = 'ai-unified-item';
  if (opts.highlight) cls += ' ai-unified-item-highlight';
  if (opts.disabled) cls += ' ai-unified-item-disabled';

  const iconView = RawHTML(iconHtml || '');
  const labelView = Text(label).flex(1);

  const row = HStack(iconView, labelView);
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
      if (t._aiPanel && t._aiPanel.hasChat) {
        const msgs = t._aiPanel.messages || [];
        const lastAssistant = _lastAssistantPreview(msgs);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant, active: isActive, streaming: !!(t._aiPanel.backgroundStreaming) });
      } else if (isActive && window._popupChatMessages && window._popupChatMessages.length > 0) {
        const lastAssistant2 = _lastAssistantPreview(window._popupChatMessages);
        results.push({ tabId: t.id, title: t.title || 'New Tab', preview: lastAssistant2, active: true, streaming: !!window._aetherBackgroundStreaming });
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
  if (!Settings.aiEnabled()) return;
  const el = document.getElementById('pill-ai-unified');
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
  const el = document.getElementById('pill-ai-unified');
  if (!el) return;
  _dropdownOpen = false;
  _dropdownStateKey = '';
  el.classList.remove('ai-unified-open');
  document.body.classList.remove('island-dropdown-guard');
  document.removeEventListener('mousedown', _onOutsideClick);
  _outsideClickBound = false;
  const dropdown = el.querySelector('.ai-unified-dropdown');
  if (dropdown) dropdown.innerHTML = '';
}

function _onOutsideClick(e) {
  const el = document.getElementById('pill-ai-unified');
  if (el && !el.contains(e.target)) {
    _closeDropdown();
  }
}

// ── Exported: render AI panel content into an arbitrary container ──
export function renderAIPanelContent(container, onAction) {
  const state = _resolveIndicatorState();
  _renderDropdown(container, state);
  if (onAction) {
    // onAction fires after any dropdown item tap — wrap by re-mounting with interceptor
    container.addEventListener('click', function(e) {
      const item = e.target.closest('.ai-unified-item, .ai-unified-conv-item');
      if (item) onAction();
    });
  }
}

// ── Init ──
export function _initUnifiedPill() {
  const el = document.getElementById('pill-ai-unified');
  if (!el || el._unifiedBound) return;
  el._unifiedBound = true;

  // React to AI master toggle
  Settings.on('aiMaster', function() { _renderUnifiedPill(); });

  el.addEventListener('click', function(e) {
    if (e.target.closest('[data-ai-inline-annotate]')) {
      e.stopPropagation();
      toggleAnnotations();
      return;
    }
    if (e.target.closest('.ai-unified-dropdown button')) return;
    // Item taps are handled by individual view .onTap() handlers; only toggle dropdown on pill body clicks
    if (e.target.closest('.ai-unified-item') || e.target.closest('.ai-unified-conv-item')) return;
    e.stopPropagation();
    if (_dropdownOpen) _closeDropdown();
    else _openDropdown();
  });

  let _blurTimer = 0;
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
