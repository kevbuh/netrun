// browse-captions.js — Extracted from browse-tabs.js
// Depends on: browse-state.js
if (window.AetherUI) AetherUI.globals();

// ── Closed Captions ──

export const _ccPillDismissed = false;

export function _updateCCButton() {
  const hasAudio = _browseIsElectron && _browseAudioTabs.size > 0;
  const browseView = document.getElementById('browse-view');
  const isOnBrowse = browseView && browseView.style.display !== 'none';

  // Toolbar CC button — show when on browse view and audio playing
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) {
    ccBtn.style.display = (hasAudio && isOnBrowse) ? '' : 'none';
    ccBtn.style.color = _ccActive ? 'var(--nr-accent)' : '';
  }

  // CC state in unified audio pill
  if (typeof _updateAudioUnified === 'function') {
    if (hasAudio && isOnBrowse && !_ccActive && !_ccPillDismissed) {
      const win = _getCurrentWindow();
      const activeHasAudio = win && _browseAudioTabs.has(win.activeTab);
      if (activeHasAudio) {
        _updateAudioUnified('cc', { label: 'CC available' });
      } else {
        _clearAudioUnified('cc');
      }
    } else if (!_ccActive) {
      _clearAudioUnified('cc');
    }
  }
}

export async function toggleCaptions() {
  if (_ccActive) {
    stopCaptions();
    return;
  }

  if (!_browseIsElectron || !window.electronAPI) return;

  // Find the active tab's webview
  const win = _getCurrentWindow();
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab || !tab.el) return;
  if (typeof tab.el.getWebContentsId !== 'function') return;

  let wcId;
  try { wcId = tab.el.getWebContentsId(); } catch { return; }
  if (!wcId) return;
  _ccTabId = tab.id;
  _ccActive = true;
  _ccCaptionLines = [];

  // Update island and highlight CC button
  if (typeof _updateAudioUnified === 'function') _updateAudioUnified('cc', { label: 'CC Live', detail: 'Listening…', active: true });
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.style.color = 'var(--nr-accent)';

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
    _ccStream = new MediaStream(audioTracks);
    rawStream.getVideoTracks().forEach(t => t.stop());

    // Mark socket as active for the AudioWorklet to check (use a simple flag object)
    _ccSocket = { active: true };

    // Start AudioWorklet pipeline — sends PCM chunks via IPC instead of WebSocket
    await _ccStartAudioWorklet();
  } catch (err) {
    console.warn('CC start failed:', err);
    stopCaptions();
  }
}

export async function _ccStartAudioWorklet() {
  if (!_ccActive || !_ccStream) return;

  // Create AudioContext at 16kHz — Chrome auto-resamples the input stream
  _ccAudioCtx = new AudioContext({ sampleRate: 16000 });

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
  await _ccAudioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  _ccWorkletNode = new AudioWorkletNode(_ccAudioCtx, 'cc-processor');
  _ccWorkletNode.port.onmessage = async (e) => {
    if (!_ccSocket || !_ccSocket.active || !window.electronAPI) return;
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

  const source = _ccAudioCtx.createMediaStreamSource(_ccStream);
  source.connect(_ccWorkletNode);
  // Don't connect to destination — we don't want to play back the audio
}

export function stopCaptions() {
  if (!_ccActive && !_ccStream && !_ccSocket && !_ccWorkletNode) return;
  _ccActive = false;

  if (_ccWorkletNode) {
    try { _ccWorkletNode.disconnect(); } catch {}
    _ccWorkletNode = null;
  }
  if (_ccAudioCtx) {
    try { _ccAudioCtx.close(); } catch {}
    _ccAudioCtx = null;
  }
  if (_ccStream) {
    _ccStream.getTracks().forEach(t => t.stop());
    _ccStream = null;
  }
  if (_ccSocket) {
    _ccSocket.active = false;
    _ccSocket = null;
  }
  if (_browseIsElectron && window.electronAPI) {
    electronAPI.stopCC();
  }

  // Remove overlay
  const overlay = document.getElementById('browse-cc-overlay');
  if (overlay) overlay.remove();
  if (_ccFadeTimer) { clearTimeout(_ccFadeTimer); _ccFadeTimer = null; }
  _ccCaptionLines = [];
  _ccTabId = null;

  // Reset CC button and island
  const ccBtn = document.getElementById('browse-cc-btn');
  if (ccBtn) ccBtn.style.color = '';
  if (typeof _clearAudioUnified === 'function') _clearAudioUnified('cc');
}

export function _showCaption(text) {
  _ccCaptionLines.push(text);
  if (_ccCaptionLines.length > 3) _ccCaptionLines.shift();

  const container = document.getElementById('browse-content');
  if (!container) return;

  let overlay = document.getElementById('browse-cc-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'browse-cc-overlay';
    container.appendChild(overlay);
  }

  overlay.textContent = _ccCaptionLines.join(' ');
  overlay.classList.remove('fade-out');

  // Update unified audio pill with latest caption snippet
  if (typeof _updateAudioUnified === 'function') {
    const snippet = text.length > 30 ? text.slice(0, 30) + '…' : text;
    _updateAudioUnified('cc', { label: 'CC Live', detail: snippet, active: true });
  }

  // Reset fade timer
  if (_ccFadeTimer) clearTimeout(_ccFadeTimer);
  _ccFadeTimer = setTimeout(() => {
    if (overlay) overlay.classList.add('fade-out');
  }, 8000);
}

export function _browseRenderTabView(t, activeTab) {
  const active = t.id === activeTab;
  const hasAudio = _browseAudioTabs.has(t.id);
  const audioInfo = _browseAudioTabs.get(t.id);
  const isMuted = audioInfo?.muted;
  const isPinned = !!t.pinned;
  const groupColor = t.groupId != null ? _browseGetGroupColor(t.groupId) : null;

  const children = [];

  // Favicon
  if (t.favicon) {
    children.push(
      Image(t.favicon).className('browse-tab-favicon')
        .on('error', function() { this.style.display = 'none'; })
    );
  } else if (t.blank) {
    children.push(RawHTML(_ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"')));
  }

  // Audio button
  if (hasAudio) {
    const muteIcon = isMuted
      ? '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
      : '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    children.push(
      RawHTML('<button class="browse-tab-audio ' + (isMuted ? 'muted' : '') + '" title="' + (isMuted ? 'Unmute' : 'Mute') + '">' + muteIcon + '</button>')
        .on('click', function(e) { e.stopPropagation(); toggleTabMute(t.id); })
    );
  }

  // Title
  children.push(Text(t.title || 'New Tab').className('browse-tab-title'));

  // Close button
  const closeBtn = new View('button');
  closeBtn.className('browse-tab-close');
  closeBtn.el.title = 'Close tab';
  closeBtn.el.textContent = '\u00d7';
  closeBtn.on('click', function(e) { e.stopPropagation(); browseCloseTab(t.id); });
  children.push(closeBtn);

  const classes = ['browse-tab', active ? 'active' : '', hasAudio ? 'has-audio' : '', isPinned ? 'browse-tab-pinned' : '', groupColor ? 'browse-tab-grouped' : ''].filter(Boolean).join(' ');

  const row = HStack(children).className(classes).attr('data-tab-id', t.id);
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
        Image(t.favicon).className('browse-tab-favicon')
          .on('error', function() { this.style.display = 'none'; })
      );
    } else if (t.blank) {
      tabChildren.push(RawHTML(_ELL_SVG.replace('class="ell-favicon"', 'class="browse-tab-favicon ell-favicon"')));
    }
    // Title
    tabChildren.push(Text(t.title || 'New Tab').className('browse-tab-title'));
    // Close
    const closeBtn = new View('button');
    closeBtn.className('browse-tab-close');
    closeBtn.el.title = 'Close split pane';
    closeBtn.el.textContent = '\u00d7';
    closeBtn.on('click', function(e) { e.stopPropagation(); browseUnsplitPane(pane.id); });
    tabChildren.push(closeBtn);

    const paneView = HStack(tabChildren)
      .className('browse-split-pill-tab' + (focused ? ' focused' : ''))
      .attr('data-tab-id', t.id)
      .attr('data-pane-id', pane.id)
      .onTap(function(e) { e.stopPropagation(); _browseFocusPane(pane.id); });
    children.push(paneView);

    if (i < panes.length - 1) {
      children.push(new View('div').className('browse-split-pill-sep'));
    }
  });

  return HStack(children).className('browse-split-pill active').attr('data-split-pill', '1');
}


export function _browseGetGroupColor(groupId) {
  const win = _getCurrentWindow();
  if (!win) return null;
  const group = (win.groups || []).find(g => g.id === groupId);
  return group ? (_BROWSE_GROUP_COLOR_MAP[group.color] || group.color) : null;
}

window._ccPillDismissed = _ccPillDismissed;
window._updateCCButton = _updateCCButton;
window.toggleCaptions = toggleCaptions;
window._ccStartAudioWorklet = _ccStartAudioWorklet;
window.stopCaptions = stopCaptions;
window._showCaption = _showCaption;
window._browseRenderTabView = _browseRenderTabView;
window._browseRenderSplitPillView = _browseRenderSplitPillView;
window._browseGetGroupColor = _browseGetGroupColor;
