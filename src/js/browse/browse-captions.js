// browse-captions.js — Extracted from browse-tabs.js
import { logger } from '/js/logger.js';
import { icon } from '/js/core/icons.js';
import { _clearAudioUnified, _updateAudioUnified } from '/js/core/core-audio.js';
import { _browseFocusPane, _browseGetFocusedPane, browseUnsplitPane } from '/js/browse/browse-split-panes.js';
import { _focusBrowseTabBar } from '/js/browse/browse-features.js';
import { browseCloseTab, browseSelectTab } from '/js/browse/browse-passwords.js';
import { toggleTabMute } from '/js/browse/browse-audio.js';
// Depends on: browse-state.js

// ── Closed Captions ──

export let _ccPillDismissed = false;
export function _resetCcPillDismissed() { _ccPillDismissed = false; }

// Reactive state for caption overlay
let _ccOverlayView = null;
let _ccTextState = null;
let _ccFadedState = null;

export function _updateCCButton() {
  const hasAudio = window._browseIsElectron && window._browseAudioTabs.size > 0;
  const browseView = document.getElementById('browse-view');
  const isOnBrowse = browseView && browseView.style.display !== 'none';

  // Toolbar CC button — show when on browse view and audio playing
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) {
    ccBtn.style.display = (hasAudio && isOnBrowse) ? '' : 'none';
    ccBtn.classList.toggle('active', !!window._ccActive);
  }

  // CC state in unified audio pill
  if (typeof _updateAudioUnified === 'function') {
    if (hasAudio && isOnBrowse && !window._ccActive && !_ccPillDismissed) {
      const win = window._getCurrentWindow();
      const activeHasAudio = win && window._browseAudioTabs.has(win.activeTab);
      if (activeHasAudio) {
        _updateAudioUnified('cc', { label: 'CC available' });
      } else {
        _clearAudioUnified('cc');
      }
    } else if (!window._ccActive) {
      _clearAudioUnified('cc');
    }
  }
}

export async function toggleCaptions() {
  if (window._ccActive) {
    stopCaptions();
    return;
  }

  if (!window._browseIsElectron || !window.electronAPI) return;

  // Find the active tab's webview
  const win = window._getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab || !tab.el) return;
  if (typeof tab.el.getWebContentsId !== 'function') return;

  let wcId;
  try { wcId = tab.el.getWebContentsId(); } catch { return; }
  if (!wcId) return;
  window._ccTabId = tab.id;
  window._ccActive = true;
  window._ccCaptionLines = [];

  // Update island CC pill and highlight CC button
  if (typeof _updateAudioUnified === 'function') _updateAudioUnified('cc', { label: 'CC Live', detail: 'Listening…', active: true });
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.classList.add('active');
  if (typeof window.islandUpdate === 'function') window.islandUpdate('cc', { type: 'cc', label: 'CC Live', lines: [], action: function() { toggleCaptions(); } });

  try {
    // Tell main process to route this webview's audio
    await electronAPI.startCC(wcId);

    // Request display media (audio from the target webview)
    const rawStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true
    });

    // Build an audio-only stream for the recorder, then kill video tracks
    const audioTracks = rawStream.getAudioTracks();
    if (!audioTracks.length) { rawStream.getTracks().forEach(t => t.stop()); throw new Error('No audio track'); }
    window._ccStream = new MediaStream(audioTracks);
    rawStream.getVideoTracks().forEach(t => t.stop());

    // Mark socket as active for the AudioWorklet to check (use a simple flag object)
    window._ccSocket = { active: true };

    // Start AudioWorklet pipeline — sends PCM chunks via IPC instead of WebSocket
    await _ccStartAudioWorklet();
  } catch (err) {
    logger.warn('CC start failed:', err);
    stopCaptions();
  }
}

export async function _ccStartAudioWorklet() {
  if (!window._ccActive || !window._ccStream) return;

  // Create AudioContext at 16kHz — Chrome auto-resamples the input stream
  window._ccAudioCtx = new AudioContext({ sampleRate: 16000 });

  // Inline AudioWorklet processor (no separate file, fits no-build-step architecture)
  const processorCode = `
    class CCProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buf = new Float32Array(24000); // 1.5s at 16kHz
        this._pos = 0;
      }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        for (let i = 0; i < ch.length; i++) {
          this._buf[this._pos++] = ch[i];
          if (this._pos >= 24000) {
            this.port.postMessage(this._buf.buffer.slice(0));
            this._pos = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('cc-processor', CCProcessor);
  `;
  const blob = new Blob([processorCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await window._ccAudioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  window._ccWorkletNode = new AudioWorkletNode(window._ccAudioCtx, 'cc-processor');
  window._ccWorkletNode.port.onmessage = async (e) => {
    if (!window._ccSocket || !window._ccSocket.active || !window.electronAPI) return;
    try {
      // Convert ArrayBuffer to base64 for IPC transport
      const bytes = new Uint8Array(e.data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const result = await window.electronAPI.captionsTranscribe(base64, 16000);
      if (result && result.text) _showCaption(result.text);
    } catch {}
  };

  const source = window._ccAudioCtx.createMediaStreamSource(window._ccStream);
  source.connect(window._ccWorkletNode);
  // Don't connect to destination — we don't want to play back the audio
}

export function stopCaptions() {
  if (!window._ccActive && !window._ccStream && !window._ccSocket && !window._ccWorkletNode) return;
  window._ccActive = false;

  if (window._ccWorkletNode) {
    try { window._ccWorkletNode.disconnect(); } catch {}
    window._ccWorkletNode = null;
  }
  if (window._ccAudioCtx) {
    try { window._ccAudioCtx.close(); } catch {}
    window._ccAudioCtx = null;
  }
  if (window._ccStream) {
    window._ccStream.getTracks().forEach(t => t.stop());
    window._ccStream = null;
  }
  if (window._ccSocket) {
    window._ccSocket.active = false;
    window._ccSocket = null;
  }
  if (window._browseIsElectron && window.electronAPI) {
    electronAPI.stopCC();
  }

  // Remove overlay
  if (_ccOverlayView) {
    _ccOverlayView.el.remove();
    _ccOverlayView = null;
    _ccTextState = null;
    _ccFadedState = null;
  }
  if (window._ccFadeTimer) { clearTimeout(window._ccFadeTimer); window._ccFadeTimer = null; }
  window._ccCaptionLines = [];
  window._ccTabId = null;

  // Reset CC button and island
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.classList.remove('active');
  if (typeof _clearAudioUnified === 'function') _clearAudioUnified('cc');
  if (typeof window.islandRemove === 'function') window.islandRemove('cc');
}

export function _showCaption(text) {
  // Update island CC pill lines
  var act = window._islandActivities ? window._islandActivities.value.cc : null;
  var lines = (act && act.lines) ? act.lines.slice() : [];
  lines.push(text);
  if (lines.length > 12) lines.shift();
  var snippet = text.length > 30 ? text.slice(0, 30) + '…' : text;
  if (typeof window.islandUpdate === 'function') window.islandUpdate('cc', { type: 'cc', label: 'CC Live', lines: lines, detail: snippet, action: function() { if (typeof window.toggleCaptions === 'function') window.toggleCaptions(); } });

  // Keep browse overlay for in-page captions
  window._ccCaptionLines.push(text);
  if (window._ccCaptionLines.length > 3) window._ccCaptionLines.shift();

  const container = document.getElementById('browse-content');
  if (!container) return;

  if (!_ccOverlayView) {
    _ccTextState = window.State('');
    _ccFadedState = window.State(false);
    _ccOverlayView = window.Text('').id('browse-cc-overlay');
    window.Effect(() => { _ccOverlayView.el.textContent = _ccTextState.value; });
    window.Effect(() => { _ccOverlayView.el.classList.toggle('fade-out', _ccFadedState.value); });
    AetherUI.append(_ccOverlayView, container);
  }

  _ccTextState.value = window._ccCaptionLines.join(' ');
  _ccFadedState.value = false;

  // Update unified audio pill
  if (typeof _updateAudioUnified === 'function') {
    _updateAudioUnified('cc', { label: 'CC Live', detail: snippet, active: true });
  }

  if (window._ccFadeTimer) clearTimeout(window._ccFadeTimer);
  window._ccFadeTimer = setTimeout(() => {
    if (_ccFadedState) _ccFadedState.value = true;
  }, 8000);
}

export function _browseRenderTabView(t, activeTab) {
  const active = t.id === activeTab;
  const hasAudio = window._browseAudioTabs.has(t.id);
  const audioInfo = window._browseAudioTabs.get(t.id);
  const isMuted = audioInfo?.muted;
  const isPinned = !!t.pinned;
  const groupColor = t.groupId != null ? _browseGetGroupColor(t.groupId) : null;

  const children = [];

  // Favicon
  if (t.favicon) {
    children.push(
      window.Image(t.favicon).className('browse-tab-favicon')
        .on('error', function() { this.style.display = 'none'; })
    );
  } else if (t.blank) {
    children.push(window.RawHTML(window._ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"')));
  }

  // Audio button
  if (hasAudio) {
    const muteIcon = isMuted
      ? icon('speakerMuted', {size: 12})
      : icon('speakerVolume', {size: 12});
    children.push(
      window.RawHTML('<button class="browse-tab-audio ' + (isMuted ? 'muted' : '') + '" title="' + (isMuted ? 'Unmute' : 'Mute') + '">' + muteIcon + '</button>')
        .on('click', function(e) { e.stopPropagation(); toggleTabMute(t.id); })
    );
  }

  // Title
  children.push(window.Text(t.title || 'New Tab').className('browse-tab-title'));

  // Close button
  const closeBtn = new window.View('button').className('browse-tab-close')
    .attr('title', 'Close tab').text('\u00d7')
    .on('click', function(e) { e.stopPropagation(); browseCloseTab(t.id); });
  children.push(closeBtn);

  const classes = ['browse-tab', active ? 'active' : '', hasAudio ? 'has-audio' : '', isPinned ? 'browse-tab-pinned' : '', groupColor ? 'browse-tab-grouped' : ''].filter(Boolean).join(' ');

  const row = window.HStack(children).className(classes).attr('data-tab-id', t.id);
  if (groupColor) row.el.style.setProperty('--group-color', groupColor);
  row.onTap(function() { _focusBrowseTabBar(); browseSelectTab(t.id); });

  return row;
}

export function _browseRenderSplitPillView(panes, tabs, activeTab) {
  const focusedPaneId = _browseGetFocusedPane();
  const children = [];
  panes.forEach((pane, i) => {
    const t = tabs.find(tab => tab.id === pane.tabId);
    if (!t) return;
    const focused = pane.id === focusedPaneId;

    const tabChildren = [];
    // Favicon
    if (t.favicon) {
      tabChildren.push(
        window.Image(t.favicon).className('browse-tab-favicon')
          .on('error', function() { this.style.display = 'none'; })
      );
    } else if (t.blank) {
      tabChildren.push(window.RawHTML(window._ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"')));
    }
    // Title
    tabChildren.push(window.Text(t.title || 'New Tab').className('browse-tab-title'));
    // Close
    const closeBtn = new window.View('button').className('browse-tab-close')
      .attr('title', 'Close split pane').text('\u00d7')
      .on('click', function(e) { e.stopPropagation(); browseUnsplitPane(pane.id); });
    tabChildren.push(closeBtn);

    const paneView = window.HStack(tabChildren)
      .className('browse-split-pill-tab' + (focused ? ' focused' : ''))
      .attr('data-tab-id', t.id)
      .attr('data-pane-id', pane.id)
      .onTap(function(e) { e.stopPropagation(); _browseFocusPane(pane.id); });
    children.push(paneView);

    if (i < panes.length - 1) {
      children.push(new window.View('div').className('browse-split-pill-sep'));
    }
  });

  return window.HStack(children).className('browse-split-pill active').attr('data-split-pill', '1');
}

export function _browseGetGroupColor(groupId) {
  const win = window._getCurrentWindow();
  if (!win) return null;
  const group = (win.groups || []).find(g => g.id === groupId);
  return group ? (window._BROWSE_GROUP_COLOR_MAP[group.color] || group.color) : null;
}

// ── Action registry ──
registerActions({
  toggleCaptions: () => toggleCaptions(),
});

