// panel.js — Panel UI builders, positioning, and main entry point
// State, TTS, Chat, and Commands extracted to separate modules
import Settings from '/js/core/core-settings.js';
import { apiGet, apiPost } from '/js/api.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';
import { icon } from '/js/core/icons.js';
import { islandUpdate, islandRemove } from '/js/core/core-ui.js';
import { _doLogout } from '/js/core/core-auth.js';
import { _isNewTabClick, _openInNewTab, _popupSafeBounds } from '/js/core/core-layout.js';
import { openUserProfile } from '/js/core/core-profile.js';
import { _addScreenshotToPanel, _browserCaptureRect, _handleImagePaste, _maybeDismissToIsland, _renderPopupChat, _saveChatMemory, _savePopupChatToHighlight, _screenshotRestoreIframes, _sendPopupChatMessage, _showTabContextMenu, _updateContextBar } from '/js/panel-chat.js';
import { _aetherExecCommand, _aetherFilterCommands, _aetherHideAgentDropdown, _aetherHideCmdDropdown, _aetherHideCursorOverlay, _aetherHideHistoryDropdown, _aetherHideModelDropdown, _aetherHideTabDropdown, _aetherRenderAgentDropdown, _aetherRenderCmdDropdown, _aetherRenderHistoryDropdown, _aetherRenderModelDropdown, _aetherRestoreFocus, _aetherSelectAgent, _aetherSelectHistory, _aetherSelectModel, _aetherSelectTab, _aetherShowCursor, _aetherSwitchToTab, _doAetherAgent, _doAetherCapture, _doAetherHelp, _doAetherHistory, _doAetherLinks, _doAetherModel, _doAetherTab, _doAetherTabs, _doAetherWebSearch, _fetchAuthorPreview, _fetchWikipediaPreview, _isAetherEligible, _isAuthorEligible } from '/js/panel-commands.js';
import { _browseToggleFindBar, _switchTabLeft, _switchTabRight } from '/js/browse/browse-features.js';
import { _extractTextFromFrame, injectSingleAnnotation } from '/js/browse/browse-annotations.js';
import { browseNewTab, openBrowse } from '/js/browse/browse-windows.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';
let _tabHoverDismissTimeout = window._tabHoverDismissTimeout ?? null;
import { _ttsChunkText, _ttsFetchAndQueue, _ttsStopAll, _ttsUpdateBtnIcon } from '/js/panel-tts.js';
import { allPapers, getSavedPosts, lastFilteredPapers, markPostAsRead } from '/js/feed.js';
import { openBrowseWithPaper } from '/js/browse/browse-ntp.js';
import { openChatPage } from '/js/chat-view.js';
import { openHelpPage } from '/js/browse-urlbar.js';
import { openSettings, _setSettingsSection } from '/js/settings/settings-core.js';
import { _getActiveBrowseTab, _saveTabPanelState } from '/js/panel-state.js';
import { _PDF_HL_COLORS, _pdfViewerAddHighlight } from '/js/browse/browse-pdf-viewer.js';
import { _tryMathAnswer } from '/js/urlbar/urlbar-instant.js';

// Global helper for chat error buttons to open Settings > AI
window._openSettingsToAI = function() {
  _setSettingsSection('ai');
  openSettings();
};

// ── Hold-to-Record: Option+Space (global, works without panel open) ──
// Standalone mic system separate from panel's closured mic button
let _holdMicStream = null;
let _holdMicCtx = null;
let _holdMicWorklet = null;
let _holdMicAccum = [];
let _holdMicActive = false;
let _holdRecording = false;

async function _holdMicStart() {
  if (_holdMicActive) return;
  try {
    _holdMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_e) { return; }
  _holdMicActive = true;
  _holdMicAccum = [];
  window._pillMicRecorder = true;
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
  if (typeof window.islandUpdate === 'function') window.islandUpdate('mic', { type: 'mic', label: 'Listening\u2026', lines: [], action: function() { _holdMicStop(); } });

  _holdMicCtx = new AudioContext({ sampleRate: 16000 });
  const processorCode = 'class P extends AudioWorkletProcessor{constructor(){super();this._b=new Float32Array(24000);this._p=0}process(i){var c=i[0]&&i[0][0];if(!c)return true;for(var j=0;j<c.length;j++){this._b[this._p++]=c[j];if(this._p>=24000){this.port.postMessage(this._b.buffer.slice(0));this._p=0}}return true}}registerProcessor("hold-mic",P);';
  const blob = new Blob([processorCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  await _holdMicCtx.audioWorklet.addModule(blobUrl);
  URL.revokeObjectURL(blobUrl);

  _holdMicWorklet = new AudioWorkletNode(_holdMicCtx, 'hold-mic');
  _holdMicWorklet.port.onmessage = async function(e) {
    if (!_holdMicActive || !window.electronAPI) return;
    try {
      const bytes = new Uint8Array(e.data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const result = await window.electronAPI.captionsTranscribe(base64, 16000);
      if (result && result.text && _holdMicActive) {
        _holdMicAccum.push(result.text);
        const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
        const micLines = (micAct && micAct.lines) ? micAct.lines.slice() : [];
        micLines.push(result.text);
        if (micLines.length > 12) micLines.shift();
        if (typeof window.islandUpdate === 'function') window.islandUpdate('mic', { type: 'mic', label: 'Listening\u2026', lines: micLines, action: function() { _holdMicStop(); } });
      }
    } catch (_e) {}
  };

  const source = _holdMicCtx.createMediaStreamSource(_holdMicStream);
  source.connect(_holdMicWorklet);

  // AnalyserNode for waveform visualization in AI pill
  window._micAnalyser = _holdMicCtx.createAnalyser();
  window._micAnalyser.fftSize = 64;
  source.connect(window._micAnalyser);
  _holdMicWaveformTick();
}

function _holdMicWaveformTick() {
  window._micRafId = requestAnimationFrame(_holdMicWaveformTick);
  if (!window._micAnalyser) return;
  const buf = new Uint8Array(window._micAnalyser.frequencyBinCount);
  window._micAnalyser.getByteFrequencyData(buf);
  const bars = document.querySelectorAll('.ai-unified-mic .island-waveform-bar');
  if (!bars.length) return;
  const step = Math.max(1, Math.floor(buf.length / bars.length));
  for (let i = 0; i < bars.length; i++) {
    const v = buf[i * step] / 255;
    bars[i].style.height = Math.max(2, v * 14) + 'px';
  }
}

async function _holdMicStop() {
  _holdMicActive = false;
  if (window._micRafId) { cancelAnimationFrame(window._micRafId); window._micRafId = null; }
  window._micAnalyser = null;
  if (_holdMicWorklet) { try { _holdMicWorklet.disconnect(); } catch (_e) {} _holdMicWorklet = null; }
  if (_holdMicCtx) { try { _holdMicCtx.close(); } catch (_e) {} _holdMicCtx = null; }
  if (_holdMicStream) { _holdMicStream.getTracks().forEach(function(t) { t.stop(); }); _holdMicStream = null; }
  window._pillMicRecorder = null;
  if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
  if (typeof window.islandRemove === 'function') window.islandRemove('mic');
}

async function _holdMicStopAndPaste() {
  // Grab text from accumulator + island mic lines as fallback
  let text = _holdMicAccum.join(' ').trim();
  if (!text) {
    const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
    if (micAct && micAct.lines && micAct.lines.length) text = micAct.lines.join(' ').trim();
  }
  await _holdMicStop();
  if (text) {
    // Defer so the mic pill removal render completes first
    setTimeout(function() {
      if (typeof window.islandUpdate === 'function') {
        window.islandUpdate('voice-result', { type: 'voice-result', label: text, text: text });
      }
    }, 50);
  }
}

// Send voice result to Aether chat
window._voiceResultToChat = function(text) {
  // If panel is open, insert into its input
  const askInput = document.querySelector('.aether-ask-input');
  if (askInput) {
    askInput.value = askInput.value + (askInput.value ? ' ' : '') + text;
    askInput.focus();
    return;
  }
  // Otherwise open panel with the text as a pending message
  if (typeof window._pendingVoiceText === 'undefined') window._pendingVoiceText = null;
  window._pendingVoiceText = text;
  // Trigger Aether panel open (Cmd+J or programmatic)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
};

// Listen for hold-to-record IPC from main process (Option+Space)
if (window.electronAPI && window.electronAPI.onVoiceHold) {
  window.electronAPI.onVoiceHold(function(_event, action) {
    if (action === 'start' && !_holdRecording && !_holdMicActive) {
      _holdRecording = true;
      _holdMicStart();
    } else if (action === 'stop' && _holdRecording) {
      _holdRecording = false;
      _holdMicStopAndPaste();
    }
  });
}

export function _positionAtCursor(cx, cy, w, h, preferLeft) {
  const bounds = _popupSafeBounds();
  // Try preferred placement first, then flip axes as needed
  let left, top;
  const fitsLeft  = cx - w >= bounds.left;
  const fitsRight = cx + w <= bounds.right;
  const fitsAbove = cy - h >= bounds.top;
  const fitsBelow = cy + h <= bounds.bottom;

  // Horizontal: prefer putting panel on the preferred side of cursor
  if (preferLeft) {
    left = fitsLeft ? cx - w : cx;  // left of cursor, else right
  } else {
    left = fitsRight ? cx : cx - w; // right of cursor, else left
  }
  // Vertical: prefer above cursor, else below
  top = fitsAbove ? cy - h : cy;

  return { left, top };
}

export function _repositionSelectionPopup() {
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) return;
  const rect = popup.getBoundingClientRect();

  // Tab context panel: anchor top-left below the tab
  if (popup._tabContextAnchor) {
    let left = popup._tabContextAnchor.left;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.top = popup._tabContextAnchor.top + 'px';
    popup.style.left = left + 'px';
    return;
  }

  // Aether panel: position relative to stored mouse position
  if (popup._isAetherPanel) {
    const anchorX = popup._aetherAnchorX ?? window._lastMouseX;
    const anchorY = popup._aetherAnchorY ?? window._lastMouseY;
    const pos = _positionAtCursor(anchorX, anchorY, rect.width, rect.height, false);
    popup.style.top = pos.top + 'px';
    popup.style.left = pos.left + 'px';
    return;
  }

  // Re-anchor relative to stored selection position so popup grows upward
  const bounds = _popupSafeBounds();
  let top;
  if (popup._aboveSelection) {
    top = popup._anchorTop - rect.height - 8;
    if (top < bounds.top) {
      top = popup._anchorBottom + 8;
      popup._aboveSelection = false;
    }
  } else {
    top = popup._anchorBottom + 8;
  }
  if (top + rect.height > bounds.bottom - 8) {
    top = bounds.bottom - rect.height - 8;
  }
  if (top < bounds.top) top = bounds.top;

  let left = popup._anchorLeft || parseFloat(popup.style.left);
  if (left + rect.width > bounds.right - 8) left = bounds.right - rect.width - 8;
  if (left < bounds.left) left = bounds.left;

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

// Text selection → floating popup; drag-to-screenshot when aether panel is open
export let _selPopupDragging = false;

document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) {
    return;
  }
  // In track mode with captureScreen available: start screenshot drag
  if (existing && window._aetherTrackMode && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
    e.preventDefault(); // prevent text selection during drag
    e.stopImmediatePropagation(); // prevent other mousedown handlers from running
    window._aetherTrackModeVal = false; // bypass setter — keep iframes disabled during drag
    _screenshotCapturing = true; // protect panel from removal throughout entire drag+capture
    _screenshotDragStart = { x: e.clientX, y: e.clientY };
    // Create selection rect + dim overlay elements
    const dimView = new window.View('div').className('screenshot-dim');
    AetherUI.append(dimView, document.body);
    _screenshotDim = dimView.el;
    const selView = new window.View('div').className('screenshot-selection');
    AetherUI.append(selView, document.body);
    _screenshotSelection = selView.el;
    return;
  }
  // If NOT in track mode and not pinned, remove existing panel
  if (existing && !window._aetherTrackMode && !_screenshotCapturing && !window._aetherPinned) {
    // Per-tab AI: save state to active tab before dismiss
    const _dismissTab = _getActiveBrowseTab();
    if (_dismissTab) _saveTabPanelState(_dismissTab);
    window._aetherBackgroundStreaming = false; islandRemove('aether');
    if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
    _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Skip interactive elements and navigation
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.target.isContentEditable) return;
  if (e.target.closest('#sidebar-nav')) return;
  if (e.target.closest('#browse-bar')) return;
  if (e.target.closest('.doc-selection-popup')) return;
  if (e.target.closest('a[href]')) return;
  if (e.target.closest('[onclick]')) return;
  _selPopupDragging = true;
});

document.addEventListener('selectionchange', function() {
  if (!_selPopupDragging) return;
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 3 || sel.rangeCount === 0) return;
  // User is actively selecting text — stop tracking, show selection preview
  window._aetherTrackMode = false;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing._isAetherPanel) existing.remove();
  const range = sel.getRangeAt(0);
  _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, finalized: false });
});

document.addEventListener('mouseup', async function(e) {
  // Screenshot drag completion
  if (_screenshotDragStart) {
    e.stopImmediatePropagation(); // prevent other mouseup handlers
    // Suppress the click event that follows mouseup
    document.addEventListener('click', function suppress(ce) { ce.stopImmediatePropagation(); }, { once: true, capture: true });
    const startPos = _screenshotDragStart;
    _screenshotDragStart = null;
    const x = Math.min(e.clientX, startPos.x);
    const y = Math.min(e.clientY, startPos.y);
    const w = Math.abs(e.clientX - startPos.x);
    const h = Math.abs(e.clientY - startPos.y);
    // Restore iframe pointer events and remove selection visuals before capture
    _screenshotRestoreIframes();
    if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
    if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
    if (w >= 10 && h >= 10 && (window.electronAPI?.captureScreen || typeof html2canvas !== 'undefined')) {
      // Small delay so overlay removal renders before capture
      await new Promise(r => setTimeout(r, 50));
      try {
        const popup = document.getElementById('doc-chat-ask-float');
        const base64 = window.electronAPI?.captureScreen
          ? await window.electronAPI.captureScreen({ x, y, width: w, height: h })
          : await _browserCaptureRect({ x, y, width: w, height: h });
        if (base64 && popup) {
          _addScreenshotToPanel(popup, base64);
        }
      } catch (err) {
        console.error('Screenshot capture failed:', err);
      }
    }
    _screenshotCapturing = false;
    return;
  }

  if (!_selPopupDragging) return;
  _selPopupDragging = false;

  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;

  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (text && text.length >= 3 && sel.rangeCount > 0) {
    // Text was selected → finalize selection popup
    window._aetherTrackMode = false;
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const inTextLayer = ancestor.closest ? !!ancestor.closest('.textLayer') : !!(ancestor.parentElement && ancestor.parentElement.closest('.textLayer'));
    _showPanel({ anchor: { selectionRect: range.getBoundingClientRect() }, selectionText: text, selectionRange: range.cloneRange(), inTextLayer, finalized: true });
    return;
  }

  // Single click, no selection → dismiss existing panel
  if (_screenshotCapturing) return;
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && existing.contains(e.target)) return; // click was inside the panel
  if (existing) { existing.remove(); window._aetherTrackMode = false; window._aetherPinned = false; }
});

// Any left-click dismisses the aether panel (capture phase to bypass stopPropagation)
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  if (_screenshotDragStart || _screenshotCapturing) return;
  const btn = document.getElementById('doc-chat-ask-float');
  if (!btn) return;
  // Clicks inside the panel should not dismiss it
  if (btn.contains(e.target)) return;
  // Pinned panels survive clicks — unless streaming, allow dismiss to island
  if (window._aetherPinned && !window._popupChatAbort) return;
  _maybeDismissToIsland(btn);
  if (!window._aetherBackgroundStreaming && window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
  window._aetherPinned = false;
  _savePopupChatToHighlight(btn);
  btn.remove();
  _aetherShowCursor();
}, true);

// Aether panel: tracks cursor + screenshot drag
document.addEventListener('mousemove', function(e) {
  window._lastMouseX = e.clientX;
  window._lastMouseY = e.clientY;

  // Screenshot drag in progress
  if (_screenshotDragStart && _screenshotSelection && _screenshotDim) {
    const sx = Math.min(e.clientX, _screenshotDragStart.x);
    const sy = Math.min(e.clientY, _screenshotDragStart.y);
    const sw = Math.abs(e.clientX - _screenshotDragStart.x);
    const sh = Math.abs(e.clientY - _screenshotDragStart.y);
    _screenshotSelection.style.display = 'block';
    _screenshotSelection.style.left = sx + 'px';
    _screenshotSelection.style.top = sy + 'px';
    _screenshotSelection.style.width = sw + 'px';
    _screenshotSelection.style.height = sh + 'px';
    const vw = window.innerWidth, vh = window.innerHeight;
    _screenshotDim.style.clipPath = `polygon(0 0,${vw}px 0,${vw}px ${vh}px,0 ${vh}px,0 0,${sx}px ${sy}px,${sx}px ${sy+sh}px,${sx+sw}px ${sy+sh}px,${sx+sw}px ${sy}px,${sx}px ${sy}px)`;
    return;
  }

  // Drag-to-move the aether panel
  if (window._aetherDragging) {
    const popup = window._aetherDragPopup || document.getElementById('doc-chat-ask-float');
    if (!popup) { window._aetherDragging = false; window._aetherDragPopup = null; return; }
    const bounds = _popupSafeBounds();
    let left = e.clientX - window._aetherDragOffset.x;
    let top = e.clientY - window._aetherDragOffset.y;
    if (left < bounds.left) left = bounds.left;
    if (top < bounds.top) top = bounds.top;
    if (left + popup.offsetWidth > bounds.right) left = bounds.right - popup.offsetWidth;
    if (top + popup.offsetHeight > bounds.bottom) top = bounds.bottom - popup.offsetHeight;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = top + popup.offsetHeight;
    return;
  }

  if (!window._aetherTrackMode) return;
  const popup = document.getElementById('doc-chat-ask-float');
  if (!popup) { window._aetherTrackMode = false; return; }

  // Snap to sidebar icon if hovering over one
  const hovered = e.target.closest && e.target.closest('.sidebar-icon');
  if (hovered) {
    const rect = hovered.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.bottom + 6;
    popup._aetherAnchorX = cx;
    popup._aetherAnchorY = cy;
    const pw = popup.offsetWidth;
    popup.style.left = Math.max(4, cx - pw / 2) + 'px';
    popup.style.top = cy + 'px';
    // Inject/remove profile items when hovering the profile icon
    const isProfile = hovered.id === 'sb-user-avatar';
    const hasProfileItems = !!popup.querySelector('.aether-profile-items');
    if (isProfile && !hasProfileItems) {
      _injectProfileItems(popup);
    } else if (!isProfile && hasProfileItems) {
      const pi = popup.querySelector('.aether-profile-items');
      if (pi) pi.remove();
    }
    return;
  }
  // Remove profile items when cursor leaves sidebar icons
  const pi = popup.querySelector('.aether-profile-items');
  if (pi) pi.remove();

  popup._aetherAnchorX = e.clientX;
  popup._aetherAnchorY = e.clientY;
  const pos = _positionAtCursor(e.clientX, e.clientY, popup.offsetWidth, popup.offsetHeight, false);
  popup.style.left = pos.left + 'px';
  popup.style.top = pos.top + 'px';
});

// End drag-to-move
document.addEventListener('mouseup', function(e) {
  if (window._aetherDragging) {
    window._aetherDragging = false;
    const draggedPopup = window._aetherDragPopup;
    window._aetherDragPopup = null;
    const topBar = draggedPopup ? draggedPopup.querySelector('.aether-top-actions') : document.querySelector('.aether-top-actions');
    if (topBar) topBar.style.cursor = 'grab';
  }
});

// Escape to dismiss from anywhere
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // Cancel screenshot drag if active
    if (_screenshotDragStart || _screenshotCapturing) {
      _screenshotDragStart = null;
      _screenshotCapturing = false;
      _screenshotRestoreIframes();
      if (_screenshotSelection) { _screenshotSelection.remove(); _screenshotSelection = null; }
      if (_screenshotDim) { _screenshotDim.remove(); _screenshotDim = null; }
      return;
    }
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) {
      // Per-tab AI: save state to active tab before ESC dismiss
      const _escTab = _getActiveBrowseTab();
      if (_escTab) _saveTabPanelState(_escTab);
      _maybeDismissToIsland(popup);
      if (!window._aetherBackgroundStreaming && window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
      window._aetherTrackMode = false;
      window._aetherPinned = false;
      window._pendingScreenshots = [];
      window._pendingTabContexts = [];
      window._pendingFileContexts = [];
      window._pendingElementContexts = [];
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
  }
  // Shift key handler removed - no longer dismisses panel
});

// Enter key with selection adds text to panel input
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    const popup = document.getElementById('doc-chat-ask-float');
    if (!popup) return;
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (!askInput) return;

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    // Only handle if text is selected and it's not inside the input
    if (selectedText && !selection.containsNode(askInput, true)) {
      e.preventDefault();
      e.stopPropagation();
      // Add selected text to input
      const currentVal = askInput.value.trim();
      askInput.value = currentVal ? currentVal + ' ' + selectedText : selectedText;
      askInput.focus();
      // Clear the selection
      if (selection) selection.removeAllRanges();
      return;
    }
  }
});

// "/" key opens aether panel with "/" pre-filled
document.addEventListener('keydown', function(e) {
  // Cmd+I or Ctrl+I toggles aether panel
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
    e.preventDefault();
    const popup = document.getElementById('doc-chat-ask-float');
    if (popup) { _maybeDismissToIsland(popup); if (!window._aetherBackgroundStreaming && window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; } popup.remove(); window._aetherTrackMode = false; window._aetherPinned = false; _aetherShowCursor(); _aetherRestoreFocus(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    _showPanel({ anchor: { x: window._lastMouseX, y: window._lastMouseY } });
    return;
  }
  if (e.key !== '/') return;
  // Skip if typing in an input, textarea, or contentEditable
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  // Skip if aether panel already open
  if (document.getElementById('doc-chat-ask-float')) return;
  e.preventDefault();
  // Open centered horizontally, near top of viewport
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  _showPanel({ anchor: { x, y }, initialValue: '/' });
});

// Right-click anywhere opens aether panel
export function _handleContextMenuChat(e) {
  if (!Settings.aiEnabled()) return;
  if (Settings.get('clickAether') === 'off') return;
  // Don't intercept on login or onboarding screens
  const loginGate = document.getElementById('login-gate');
  if (loginGate && loginGate.style.display !== 'none') return;
  const onboard = document.getElementById('onboard-view');
  if (onboard && onboard.style.display !== 'none') return;
  // Skip if right-clicking inside an existing popup
  const popup = document.getElementById('doc-chat-ask-float');
  if (popup && popup.contains(e.target)) return;
  // Skip if clicking inside the browse URL bar
  if (e.target.id === 'browse-url-input' || e.target.closest('#browse-bar')) return;
  // For inputs/textareas, show panel with paste support instead of native context menu
  const tag = e.target.tagName;
  const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
  if (isEditable) {
    e.preventDefault();
    if (popup) { popup.remove(); window._aetherTrackMode = false; }
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().trim() || '';
    _showPanel({ anchor: { x: e.clientX, y: e.clientY }, editableTarget: e.target, selectionText: selectedText, finalized: true });
    return;
  }
  // Intercept right-click on browse tabs for tab context menu
  const browseTab = e.target.closest('.browse-tab, .browse-vtab');
  if (browseTab) {
    e.preventDefault();
    _showTabContextMenu(e, browseTab);
    return;
  }
  // Skip browse view chrome — iframe/webview handles its own context menu
  if (e.target.closest('#browse-bar, #browse-tab-row, #browse-vtabs, #universal-panel')) return;
  // In browse content, skip only iframes/webviews (they have injected handlers)
  const browseContent = e.target.closest('#browse-content');
  if (browseContent && (e.target.tagName === 'IFRAME' || e.target.tagName === 'WEBVIEW')) return;
  e.preventDefault();
  // Capture the previously focused editable element before panel steals focus
  const active = document.activeElement;
  const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
  if (popup) { popup.remove(); window._aetherTrackMode = false; }
  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, priorEditable, trackCursor: true });
}
document.addEventListener('contextmenu', _handleContextMenuChat);

// Convert a rect from inside an iframe/webview to parent viewport coordinates
export function _iframeRectToParent(r, frame) {
  const f = frame.getBoundingClientRect();
  return { top: r.top + f.top, bottom: r.bottom + f.top, left: r.left + f.left, right: r.right + f.left, width: r.width, height: r.height };
}

// Inject context-menu, text-selection, and keyboard handlers into same-origin iframes
export function _injectIframeChatHandler(iframe) {
  const tryInject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || doc._chatHandlerInjected) return;
      doc._chatHandlerInjected = true;

      const isInteractive = (el) => {
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable;
      };

      // Right-click → aether panel
      doc.addEventListener('contextmenu', function(e) {
        if (Settings.get('clickAether') === 'off') return;
        const f = iframe.getBoundingClientRect();
        const tag = e.target.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
        if (isEditable) {
          e.preventDefault();
          const popup = document.getElementById('doc-chat-ask-float');
          if (popup) { popup.remove(); window._aetherTrackMode = false; }
          const sel = doc.getSelection();
          const selectedText = sel && sel.toString().trim() || '';
          _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, editableTarget: e.target, selectionText: selectedText, finalized: true });
          return;
        }
        if (isInteractive(e.target)) return;
        e.preventDefault();
        // Capture focused editable inside iframe before panel steals focus
        const active = doc.activeElement;
        const priorEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) ? active : null;
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) { popup.remove(); window._aetherTrackMode = false; }
        // Detect link/image targets for context menu
        const linkEl = e.target.closest('a[href]');
        const imgEl = e.target.tagName === 'IMG' ? e.target : e.target.closest('img');
        const contextMenu = (linkEl || imgEl) ? {
          linkUrl: linkEl ? linkEl.href : '',
          linkText: linkEl ? (linkEl.textContent || '').trim() : '',
          imgUrl: imgEl ? imgEl.src : ''
        } : null;
        _showPanel({ anchor: { x: e.clientX + f.left, y: e.clientY + f.top }, priorEditable, contextMenu, trackCursor: !contextMenu });
      });

      // Text selection → selection popup
      let dragging = false;
      doc.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing.contains(e.target)) return;
        if (existing && !window._aetherTrackMode) {
          window._aetherBackgroundStreaming = false; islandRemove('aether');
          if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
          _savePopupChatToHighlight(existing);
          existing.remove();
        }
        if (!isInteractive(e.target)) dragging = true;
      });
      doc.addEventListener('selectionchange', function() {
        if (!dragging) return;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || text.length < 3 || sel.rangeCount === 0) return;
        window._aetherTrackMode = false;
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing && existing._isAetherPanel) existing.remove();
        _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: false });
      });
      doc.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        const sel = doc.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (text && text.length >= 3 && sel.rangeCount > 0) {
          window._aetherTrackMode = false;
          _showPanel({ anchor: { selectionRect: _iframeRectToParent(sel.getRangeAt(0).getBoundingClientRect(), iframe) }, selectionText: text, finalized: true });
          return;
        }
        const existing = document.getElementById('doc-chat-ask-float');
        if (existing) { existing.remove(); window._aetherTrackMode = false; window._aetherPinned = false; }
      });

      // Cmd+click → open link in new tab
      doc.addEventListener('click', function(e) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const a = e.target.closest('a');
        if (!a || !a.href) return;
        e.preventDefault();
        e.stopPropagation();
        window.top.open(a.href, '_blank');
      }, true);

      // Keyboard shortcuts
      doc.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          if (typeof _browseToggleFindBar === 'function') _browseToggleFindBar();
        }
        if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); if (typeof _switchTabLeft === 'function') _switchTabLeft(); }
          if (e.key === 'ArrowRight') { e.preventDefault(); if (typeof _switchTabRight === 'function') _switchTabRight(); }
        }
      });
    } catch (e) {
      // Cross-origin — can't inject (webview uses executeJavaScript path instead)
    }
  };
  iframe.addEventListener('load', tryInject);
  tryInject();
}

// ── Screenshot drag-to-capture ──
// State for drag-to-screenshot (active when aether panel is open)
export let _screenshotDragStart = null; // {x, y} or null
export let _screenshotSelection = null; // DOM element
export let _screenshotDim = null; // DOM element
export let _screenshotCapturing = false; // true while capture is in progress

// ── Unified Popup Panel ──
// _showPanel(config) replaces both _showAetherPanel and _buildSelectionPopup.
// Config:
//   anchor: { x, y } | { selectionRect: DOMRect } | { tab: HTMLElement }
//   trackCursor: bool         — follow mouse until interaction
//   contextMenu: { items, linkUrl, linkText, imgUrl }
//   selectionText: string     — selected text preview
//   selectionRange: Range     — for highlight creation
//   inTextLayer: bool         — PDF text layer (show highlight dots)
//   initialValue: string      — pre-fill input (e.g. '/')
//   finalized: bool           — false = selection preview only (no buttons/input)
//   editableTarget: HTMLElement — the input/textarea/contentEditable element (for paste)
//   priorEditable: HTMLElement  — editable element that was focused before panel opened

// Focus an element that may be inside an iframe — focuses the iframe first if needed
export function _focusCrossFrame(el) {
  const ownerDoc = el.ownerDocument;
  if (ownerDoc && ownerDoc !== document) {
    const iframes = document.querySelectorAll('iframe, webview');
    for (const f of iframes) {
      try {
        if (f.contentDocument === ownerDoc) { f.focus(); break; }
      } catch (e) { /* cross-origin */ }
    }
  }
  el.focus();
}

// Paste text into an element, handling iframe ownership for execCommand
export function _pasteIntoElement(el, text) {
  _focusCrossFrame(el);
  if (el.isContentEditable) {
    // execCommand must be called on the element's ownerDocument (matters for iframes)
    const ownerDoc = el.ownerDocument || document;
    ownerDoc.execCommand('insertText', false, text);
  } else {
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = el.value || '';
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function _flashCopyBtn(popup) {
  // Find the right copy button: selection copy or chat copy
  const btn = popup.querySelector('.doc-selection-copy-btn')
    || (popup._copyChatBtn && popup._copyChatBtn.style.display !== 'none' ? popup._copyChatBtn : null);
  if (!btn) return;
  btn.textContent = 'Copied';
  btn.classList.remove('doc-copy-flash');
  // Force reflow so animation restarts if already playing
  void btn.offsetWidth;
  btn.classList.add('doc-copy-flash');
  setTimeout(() => {
    if (btn.isConnected) { btn.textContent = 'Copy'; btn.classList.remove('doc-copy-flash'); }
  }, 1200);
}

// ── Helper: inject profile menu items into the aether panel ──
export function _injectProfileItems(popup) {
  if (popup.querySelector('.aether-profile-items')) return;
  const email = (typeof window._authUserInfo !== 'undefined' && window._authUserInfo?.email) || '';
  const username = (typeof window._authUserInfo !== 'undefined' && (window._authUserInfo?.username || window._authUserInfo?.name)) || '';
  const ctxDiv = new window.View('div').className('doc-aether-context-items aether-profile-items');

  // User info header
  if (username || email) {
    const info = new window.View('div').className('doc-aether-ctx-item doc-aether-ctx-info')
      .html('<span class="doc-aether-ctx-label">' + escapeHtml(username) + '</span>' +
        (email ? '<span class="doc-aether-ctx-sub">' + escapeHtml(email) + '</span>' : ''));
    ctxDiv.add(info);
  }

  const items = [
    { label: 'View Profile', icon: icon('profile', { size: 14 }), fn: () => openUserProfile(username) },
    { label: 'Settings', icon: icon('settings', { size: 14 }), fn: () => openSettings() },
    { label: 'Help', icon: icon('helpCircle', { size: 14 }), fn: () => { openBrowse(); setTimeout(() => openHelpPage(), 50); } },
    { sep: true },
    { label: 'Sign Out', icon: icon('signOut', { size: 14 }), danger: true, fn: () => _doLogout() },
  ];

  for (const entry of items) {
    if (entry.sep) {
      ctxDiv.add(new window.View('div').className('doc-aether-ctx-sep'));
      continue;
    }
    const item = new window.View('div')
      .className('doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : ''))
      .html(entry.icon + ' ' + escapeHtml(entry.label))
      .on('mousedown', (ev) => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        window._aetherTrackMode = false;
        popup.remove();
        entry.fn();
      });
    ctxDiv.add(item);
  }

  // Insert before the chat input wrap (or at end)
  const inputWrap = popup.querySelector('.doc-ask-inline-wrap');
  if (inputWrap) popup.insertBefore(ctxDiv.el, inputWrap);
  else popup.append(ctxDiv.el);
}

// ── Helper: build generic context menu items (tab, custom items) ──
export function _panelBuildContextItems(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!(contextMenu && contextMenu.items)) return;
  const ctxDiv = new window.View('div').className('doc-aether-context-items');
  for (const entry of contextMenu.items) {
    if (entry.sep) {
      ctxDiv.add(new window.View('div').className('doc-aether-ctx-sep'));
      continue;
    }
    const cls = 'doc-aether-ctx-item' + (entry.danger ? ' doc-aether-ctx-danger' : '') + (entry.info ? ' doc-aether-ctx-info' : '');
    const item = new window.View('div').className(cls);
    if (entry.icon) {
      item.html(entry.icon + ' ' + escapeHtml(entry.label));
    } else if (entry.subtext) {
      item.html('<span class="doc-aether-ctx-label">' + escapeHtml(entry.label) + '</span><span class="doc-aether-ctx-sub">' + escapeHtml(entry.subtext) + '</span>');
    } else if (entry.colorDot) {
      item.html('<span class="browse-ctx-color-dot" style="background:' + escapeAttr(entry.colorDot) + '"></span>' + escapeHtml(entry.label));
    } else {
      item.text(entry.label);
    }
    if (!entry.info) {
      item.on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          entry.fn();
          window._aetherTrackMode = false;
          popup.remove();
        });
    }
    ctxDiv.add(item);
  }
  popup.append(ctxDiv.el);
}

// ── Helper: build link/image context menu + link preview ──
export function _panelBuildLinkContextMenu(popup, config) {
  const contextMenu = config.contextMenu || null;
  if (!contextMenu) return;

  // Link preview (async)
  if (contextMenu.linkUrl) {
    const previewDiv = new window.View('div').className('doc-link-preview');
    apiGet('/api/link-preview?url=' + encodeURIComponent(contextMenu.linkUrl))
      .then(data => {
        if (!popup.isConnected) return;
        if (!data.title && !data.description) return;
        const previewChildren = [];
        if (data.image) {
          const img = new window.View('img').className('doc-link-preview-img').attr('src', data.image);
          img.el.onerror = function() { this.remove(); };
          previewChildren.push(img);
        }
        const textChildren = [
          window.Text(data.site || data.domain || '').className('doc-link-preview-site'),
          window.Text(data.title).className('doc-link-preview-title'),
        ];
        if (data.description) {
          textChildren.push(window.Text(data.description).className('doc-link-preview-desc'));
        }
        previewChildren.push(window.VStack(...textChildren).className('doc-link-preview-text'));
        AetherUI.mount(window.VStack(...previewChildren), previewDiv.el);
        previewDiv.el.style.cursor = 'pointer';
        previewDiv.on('mousedown', (ev) => ev.stopPropagation())
          .on('click', (ev) => {
            ev.stopPropagation(); ev.preventDefault();
            if (typeof browseNewTab === 'function') browseNewTab(contextMenu.linkUrl);
            else window.open(contextMenu.linkUrl, '_blank');
          });
        popup.insertBefore(previewDiv.el, popup.firstChild);
        _repositionSelectionPopup();
      })
      .catch(() => {});
  }

  // Context menu items (links, images) — only when no custom items
  if ((contextMenu.linkUrl || contextMenu.imgUrl) && !contextMenu.items) {
    const ctxDiv = new window.View('div').className('doc-aether-context-items');
    const linkUrl = contextMenu.linkUrl || '';
    const linkText = contextMenu.linkText || '';
    const imgUrl = contextMenu.imgUrl || '';

    const addItem = (label, fn) => {
      const item = new window.View('div').className('doc-aether-ctx-item')
        .text(label)
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          fn();
          window._aetherTrackMode = false;
          popup.remove();
        });
      ctxDiv.add(item);
    };
    const addSep = () => {
      ctxDiv.add(new window.View('div').className('doc-aether-ctx-sep'));
    };

    if (linkUrl) {
      addItem('Open Link in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(linkUrl); });
      addItem('Open Link Here', () => { if (typeof browseNavigate === 'function') browseNavigate(linkUrl); });
      addSep();
      addItem('Copy Link Address', () => navigator.clipboard.writeText(linkUrl).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {}));
      if (linkUrl.startsWith('mailto:')) {
        const email = linkUrl.replace('mailto:', '').split('?')[0];
        addItem('Copy Email Address', () => navigator.clipboard.writeText(email).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {}));
      }
      if (linkText) addItem('Copy Link Text', () => navigator.clipboard.writeText(linkText).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {}));
    }
    if (imgUrl) {
      if (linkUrl) addSep();
      addItem('Open Image in New Tab', () => { if (typeof browseNewTab === 'function') browseNewTab(imgUrl); });
      addItem('Copy Image Address', () => navigator.clipboard.writeText(imgUrl).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {}));
      addItem('Copy Image', () => {
        // Use Electron's native clipboard to avoid user-gesture expiry
        const targetUrl = imgUrl.startsWith('/api/') ? 'http://localhost:8000' + imgUrl : imgUrl;
        if (window.electronAPI && electronAPI.copyImageToClipboard) {
          electronAPI.copyImageToClipboard(targetUrl).then(r => {
            if (r && r.ok && window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
          }).catch(() => {});
        }
      });
      addItem('Save Image As…', () => {
        const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
        const aView = new window.View('a').attr('href', proxyUrl);
        try { aView.attr('download', imgUrl.split('/').pop().split('?')[0] || 'image.png'); } catch(_) { aView.attr('download', 'image.png'); }
        AetherUI.append(aView, document.body);
        aView.el.click();
        aView.el.remove();
      });
      // "Add to Assistant" keeps the panel open and adds the image as chat context
      const assistItem = new window.View('div').className('doc-aether-ctx-item')
        .text('Add to Assistant')
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          window._aetherTrackMode = false;
          // Remove context menu items but keep the panel
          const ctxItems = popup.querySelector('.doc-aether-context-items');
          if (ctxItems) ctxItems.remove();
          const preview = popup.querySelector('.doc-link-preview');
          if (preview) preview.remove();
          const proxyUrl = imgUrl.startsWith('/api/') ? imgUrl : '/api/image-proxy?url=' + encodeURIComponent(imgUrl);
          const img = new window.Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            const base64 = c.toDataURL('image/png').split(',')[1];
            if (base64) _addScreenshotToPanel(popup, base64);
          };
          img.src = proxyUrl;
        });
      ctxDiv.add(assistItem);
    }
    if (linkText && linkUrl) {
      const truncated = linkText.length > 25 ? linkText.slice(0, 22) + '...' : linkText;
      addSep();
      addItem('Search Google for "' + truncated + '"', () => {
        if (typeof browseNewTab === 'function') browseNewTab('https://www.google.com/search?q=' + encodeURIComponent(linkText));
      });
    }

    popup.append(ctxDiv.el);
  }
}

// ── Helper: build editable field actions (Cut/Copy/Paste for native + webview + prior editable) ──
export function _panelBuildEditableActions(popup, config, capturedText, hasContext) {
  const editableTarget = config.editableTarget || null;
  const webviewEditable = config.webviewEditable || null;

  // Native editable field actions (Cut, Copy, Paste)
  if (editableTarget) {
    const editCtx = new window.View('div').className('doc-aether-context-items');
    const addEditItem = (label, fn) => {
      editCtx.add(new window.View('div').className('doc-aether-ctx-item')
        .text(label)
        .on('mousedown', (ev) => ev.stopPropagation())
        .on('click', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          fn();
          popup.remove();
        }));
    };
    if (capturedText) {
      addEditItem('Cut', () => {
        navigator.clipboard.writeText(capturedText).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {});
        _focusCrossFrame(editableTarget);
        if (editableTarget.isContentEditable) {
          (editableTarget.ownerDocument || document).execCommand('delete');
        } else {
          const start = editableTarget.selectionStart;
          const end = editableTarget.selectionEnd;
          const val = editableTarget.value;
          editableTarget.value = val.slice(0, start) + val.slice(end);
          editableTarget.selectionStart = editableTarget.selectionEnd = start;
          editableTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      addEditItem('Copy', () => {
        navigator.clipboard.writeText(capturedText).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {});
      });
    }
    addEditItem('Paste', () => {
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        _pasteIntoElement(editableTarget, text);
      }).catch(() => {});
    });
    popup.append(editCtx.el);
  }

  // Webview editable field (cross-origin) — Cut/Copy/Paste via webview API
  if (webviewEditable) {
    const wvCtx = new window.View('div').className('doc-aether-context-items');
    const wv = webviewEditable.webview;
    const flags = webviewEditable.editFlags || {};
    const addWvItem = (label, fn) => {
      wvCtx.add(new window.View('div').className('doc-aether-ctx-item')
        .text(label)
        .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
        .on('mouseup', (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          fn();
        }));
    };
    const wvExec = (js) => { popup.remove(); wv.focus(); setTimeout(() => wv.executeJavaScript(js).catch(() => {}), 50); };
    if (flags.canCut) addWvItem('Cut', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(!el) return; el.focus();
        var text=document.getSelection().toString();
        if(text) navigator.clipboard.writeText(text).catch(function(){});
        if(el.isContentEditable) document.execCommand('delete');
        else if(el.selectionStart!==undefined){ var s=el.selectionStart,e=el.selectionEnd,v=el.value;
          el.value=v.slice(0,s)+v.slice(e); el.selectionStart=el.selectionEnd=s;
          el.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
    });
    if (flags.canCopy) addWvItem('Copy', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus();
        navigator.clipboard.writeText(document.getSelection().toString()).catch(function(){}); })()`);
    });
    if (flags.canPaste) addWvItem('Paste', () => {
      navigator.clipboard.readText().then(text => {
        if (!text) return;
        popup.remove();
        wv.focus();
        setTimeout(() => {
          wv.executeJavaScript(`(function(){ var el=window.__aetherLastEditable; if(el) el.focus(); })()`)
            .then(() => wv.insertText(text))
            .catch(() => {});
        }, 50);
      }).catch(() => {});
    });
    if (flags.canSelectAll) addWvItem('Select All', () => {
      wvExec(`(function(){ var el=window.__aetherLastEditable; if(el){el.focus();el.select();}else document.execCommand('selectAll'); })()`);
    });
    if (wvCtx.el.children.length) popup.append(wvCtx.el);
  }

  // Paste into nearby editable or chat input (only when near an editable field)
  if (!editableTarget && !hasContext && !capturedText && !webviewEditable && config.priorEditable) {
    const priorEditable = config.priorEditable;
    const pasteCtx = new window.View('div').className('doc-aether-context-items');
    const pasteItem = new window.View('div').className('doc-aether-ctx-item')
      .text('Paste text')
      .on('mousedown', (ev) => ev.stopPropagation())
      .on('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (!text) return;
          if (priorEditable && priorEditable.isConnected) {
            _pasteIntoElement(priorEditable, text);
            popup.remove();
          } else {
            const input = popup.querySelector('.doc-ask-inline-input');
            if (input) { input.value = text; input.focus(); }
          }
        }).catch(() => {});
      });
    pasteCtx.add(pasteItem);
    popup.append(pasteCtx.el);
  }
}

// ── Helper: build selection UI (Copy button + highlight dots) ──
export function _panelBuildSelectionUI(popup, config) {
  const capturedText = config.selectionText || '';
  const selectionRange = config.selectionRange || null;
  const inTextLayer = !!config.inTextLayer;
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false;

  if (!(finalized && capturedText && !editableTarget)) return;

  const btnRow = new window.View('div').className('doc-selection-popup-btns');

  // Copy button
  const copyBtn = new window.View('button').className('doc-selection-copy-btn')
    .attr('title', 'Copy')
    .html(icon('copy', { size: 14 }))
    .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      navigator.clipboard.writeText(capturedText).then(() => {
        AetherUI.mount(window.RawHTML(icon('check', { size: 14 })), copyBtn.el);
        setTimeout(() => { if (copyBtn.el.isConnected) AetherUI.mount(window.RawHTML(icon('copy', { size: 14 })), copyBtn.el); }, 1200);
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      }).catch(() => {});
    });
  btnRow.add(copyBtn);

  // PDF highlight color buttons — shown when selecting text in nerd mode PDF
  if (inTextLayer) {
    const tab = _getActiveBrowseTab();
    const _hlRange = selectionRange || (window.getSelection()?.rangeCount > 0 ? window.getSelection().getRangeAt(0) : null);
    if (tab && tab._pdfPagesContainer && _hlRange) {
      // Pre-compute page + rects from the live selection (before it gets cleared)
      const ancestor = _hlRange.commonAncestorContainer;
      const wrapperEl = (ancestor.closest ? ancestor.closest('.pdf-page-wrapper') : null)
        || (ancestor.parentElement ? ancestor.parentElement.closest('.pdf-page-wrapper') : null);
      if (wrapperEl) {
        const _hlPageNum = parseInt(wrapperEl.getAttribute('data-page-num'));
        const wrapperRect = wrapperEl.getBoundingClientRect();
        const _hlRects = [];
        const clientRects = _hlRange.getClientRects();
        for (let i = 0; i < clientRects.length; i++) {
          const cr = clientRects[i];
          _hlRects.push({ left: cr.left - wrapperRect.left, top: cr.top - wrapperRect.top, width: cr.width, height: cr.height });
        }
        if (_hlPageNum && _hlRects.length > 0) {
          _PDF_HL_COLORS.forEach((c) => {
            const hlBtn = new window.View('button').className('pdf-hl-color-btn')
              .style('background', c.color)
              .attr('title', 'Highlight ' + c.name)
              .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
              .on('click', (ev) => {
                ev.stopPropagation(); ev.preventDefault();
                _pdfViewerAddHighlight(tab, { text: capturedText, pageNum: _hlPageNum, rects: _hlRects.slice(), color: c.color, note: '', ts: Date.now() });
                AetherUI.mount(window.RawHTML(icon('check', { size: 14 })), hlBtn.el);
                hlBtn.el.style.background = 'none';
                setTimeout(() => { if (hlBtn.el.isConnected) { hlBtn.el.style.background = c.color; hlBtn.el.innerHTML = ''; } }, 800);
                window.getSelection().removeAllRanges();
              });
            btnRow.add(hlBtn);
          });
        }
      }
    }
  }

  // Read Aloud button — uses existing Kokoro TTS system
  const readBtn = new window.View('button').className('doc-selection-copy-btn')
    .attr('title', 'Read aloud')
    .html(icon('speaker', { size: 14 }))
    .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (window._ttsAudio || window._ttsPaused || window._ttsChunks.length > 0) {
        _ttsStopAll();
        AetherUI.mount(window.RawHTML(icon('speaker', { size: 14 })), readBtn.el);
        readBtn.el.title = 'Read aloud';
        return;
      }
      if (!capturedText || capturedText.length < 2) return;
      AetherUI.mount(window.RawHTML(icon('pauseRect', { size: 14 })), readBtn.el);
      readBtn.el.title = 'Stop';
      window._ttsStopped = false;
      window._ttsPaused = false;
      window._ttsChunks = _ttsChunkText(capturedText);
      window._ttsChunkIdx = 0;
      window._ttsPlayedDurations = [];
      window._ttsRemainingDurations = [];
      window._ttsQueue = [];
      _ttsFetchAndQueue();
      const checkDone = setInterval(() => {
        if (!window._ttsAudio && !window._ttsPaused && window._ttsChunks.length === 0) {
          clearInterval(checkDone);
          if (readBtn.el.isConnected) {
            AetherUI.mount(window.RawHTML(icon('speaker', { size: 14 })), readBtn.el);
            readBtn.el.title = 'Read aloud';
          }
        }
      }, 500);
    });
  btnRow.add(readBtn);

  // "Read from here" button — reads from selection to end of page
  if (typeof window._getCurrentWindow === 'function' && typeof _extractTextFromFrame === 'function') {
    const fromHereBtn = new window.View('button').className('doc-selection-copy-btn')
      .html(icon('play', { size: 14 }))
      .attr('title', 'Read from this point to the end of the page')
      .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
      .on('click', async (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        if (window._ttsAudio || window._ttsPaused || window._ttsChunks.length > 0) {
          _ttsStopAll();
          AetherUI.mount(window.RawHTML(icon('play', { size: 14 })), fromHereBtn.el);
          fromHereBtn.el.title = 'Read from this point to the end of the page';
          AetherUI.mount(window.RawHTML(icon('speaker', { size: 14 })), readBtn.el);
          readBtn.el.title = 'Read aloud';
          return;
        }
        const win = window._getCurrentWindow();
        if (!win) return;
        const tab = win.tabs.find(t => t.id === win.activeTab);
        if (!tab) return;
        AetherUI.mount(window.RawHTML(icon('pauseRect', { size: 14 })), fromHereBtn.el);
        fromHereBtn.el.title = 'Stop';
        const fullText = await _extractTextFromFrame(tab);
        if (!fullText || fullText.length < 10) {
          AetherUI.mount(window.RawHTML(icon('play', { size: 14 })), fromHereBtn.el);
          fromHereBtn.el.title = 'Read from this point to the end of the page';
          return;
        }
        const needle = capturedText.trim().replace(/\s+/g, ' ');
        const haystack = fullText.replace(/\s+/g, ' ');
        const idx = haystack.indexOf(needle);
        const textFromHere = idx >= 0 ? haystack.slice(idx) : needle + '\n' + haystack;
        window._ttsTabId = tab.id;
        window._ttsStopped = false;
        window._ttsPaused = false;
        window._ttsChunks = _ttsChunkText(textFromHere);
        window._ttsChunkIdx = 0;
        window._ttsPlayedDurations = [];
        window._ttsRemainingDurations = [];
        window._ttsQueue = [];
        _ttsUpdateBtnIcon();
        _ttsFetchAndQueue();
        const checkDone2 = setInterval(() => {
          if (!window._ttsAudio && !window._ttsPaused && window._ttsChunks.length === 0) {
            clearInterval(checkDone2);
            if (fromHereBtn.el.isConnected) {
              AetherUI.mount(window.RawHTML(icon('play', { size: 14 })), fromHereBtn.el);
              fromHereBtn.el.title = 'Read from this point to the end of the page';
            }
          }
        }, 500);
      });
    btnRow.add(fromHereBtn);
  }

  // Annotate "+" button — mark selected text as a specific annotation type
  const annotateBtn = new window.View('button').className('doc-selection-copy-btn')
    .attr('title', 'Mark as annotation')
    .html(icon('plus', { size: 14 }))
    .on('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); })
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      // Toggle dropdown
      let dropdown = btnRow.el.querySelector('.ann-type-dropdown');
      if (dropdown) { dropdown.remove(); return; }
      const ddView = new window.View('div').className('ann-type-dropdown')
        .cssText('position:absolute;top:100%;left:0;right:0;background:var(--aether-dropdown-bg, #1a1a2e);border:1px solid var(--aether-border, rgba(255,255,255,0.1));border-radius:8px;padding:4px;margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;z-index:10;');
      dropdown = ddView.el;
      const types = [
        { key: 'INSIGHT', name: 'Insight', color: '#4caf50' },
        { key: 'CONTRADICTION', name: 'Contradiction', color: '#ef5350' },
        { key: 'AD', name: 'Ad', color: '#ff9800' },
        { key: 'FACTCHECK', name: 'Fact Check', color: '#ec407a' },
        { key: 'EVIDENCE', name: 'Evidence', color: '#26a69a' },
      ];
      if (typeof window._customAnnotationCategories !== 'undefined') {
        for (const cc of window._customAnnotationCategories) {
          types.push({ key: cc.key, name: cc.name, color: cc.color });
        }
      }
      for (const t of types) {
        const chip = new window.View('button')
          .styles({ background: 'none', border: '1px solid ' + t.color + '40', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '11px', color: t.color, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' })
          .html('<span style="width:6px;height:6px;border-radius:50%;background:' + t.color + '"></span>' + escapeHtml(t.name))
          .on('mousedown', (mev) => { mev.stopPropagation(); mev.preventDefault(); })
          .on('click', (cev) => {
            cev.stopPropagation(); cev.preventDefault();
            let feedbackUrl = '';
            let feedbackTitle = '';
            if (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
              const fTab = _browseTabs.find(tb => tb.id === _browseActiveTab);
              if (fTab) { feedbackUrl = fTab.url || ''; feedbackTitle = fTab.title || ''; }
            }
            apiPost('/api/annotation-feedback', { quote: capturedText, annType: t.key, rating: 'good', url: feedbackUrl, pageTitle: feedbackTitle }).catch(e => logger.warn('[panel] Feedback failed:', e));
            if (typeof injectSingleAnnotation === 'function' && typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
              const hlTab = _browseTabs.find(tb => tb.id === _browseActiveTab);
              if (hlTab) injectSingleAnnotation(hlTab, { type: t.key, quote: capturedText });
            }
            dropdown.remove();
            AetherUI.mount(window.RawHTML(icon('check', { size: 14, stroke: t.color })), annotateBtn.el);
            annotateBtn.el.disabled = true;
          });
        dropdown.append(chip.el);
      }
      btnRow.el.style.position = 'relative';
      btnRow.el.append(dropdown);
    });
  btnRow.add(annotateBtn);

  // Clear button — positioned on far right
  const clearBtnIcon = new window.View('button').className('doc-selection-copy-btn')
    .attr('title', 'Clear conversation')
    .html(icon('close', { size: 14 }))
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      _saveChatMemory();
      window._popupChatMessages = [];
      window._chatMemoryRetrieved = false;
      window._chatStreamStart = 0;
      if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
      const cm = popup.querySelector('.doc-popup-chat-messages');
      if (cm) cm.replaceChildren();
      const ca = popup.querySelector('.doc-popup-chat-area');
      if (ca) ca.classList.remove('visible');
      popup.classList.remove('has-chat');
      const statsSpan = popup.querySelector('.doc-chat-stats');
      if (statsSpan) statsSpan.textContent = '';
      _repositionSelectionPopup();
    });
  clearBtnIcon.el.style.marginLeft = 'auto';
  btnRow.add(clearBtnIcon);

  popup.append(btnRow.el);

  // Author / Wikipedia preview (async)
  if (_isAuthorEligible(capturedText)) {
    const authorDiv = new window.View('div').className('doc-wiki-preview');
    authorDiv.el.style.display = 'none';
    popup.append(authorDiv.el);
    _fetchAuthorPreview(capturedText, authorDiv.el);
  } else if (_isAetherEligible(capturedText)) {
    const wikiDiv = new window.View('div').className('doc-wiki-preview');
    wikiDiv.el.style.display = 'none';
    popup.append(wikiDiv.el);
    _fetchWikipediaPreview(capturedText, wikiDiv.el);
  }

}

// ── Helper: build top actions bar (model label, clear, redo, copy, pin, sidebar, drag) ──
export function _panelBuildTopBar(popup) {
  const spacer = new window.View('span').styles({ flex: '1' });
  const statsSpan = new window.View('span').className('doc-chat-stats');

  // Redo button — resend last user message
  const redoBtn = new window.View('button').className('aether-topbar-btn')
    .text('Redo')
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      let lastUserIdx = -1;
      for (let i = window._popupChatMessages.length - 1; i >= 0; i--) {
        if (window._popupChatMessages[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx < 0) return;
      const lastUserMsg = window._popupChatMessages[lastUserIdx];
      window._popupChatMessages = window._popupChatMessages.slice(0, lastUserIdx);
      if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
      const input = popup.querySelector('.doc-ask-inline-input');
      if (input) input.value = lastUserMsg._display || lastUserMsg.content;
      _sendPopupChatMessage(popup, popup._capturedText || '');
    });
  redoBtn.el.style.display = 'none';
  popup._redoBtn = redoBtn.el;

  // Copy chat button — copy last AI response
  const copyChatBtn = new window.View('button').className('aether-topbar-btn')
    .text('Copy')
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      let lastAi = '';
      for (let i = window._popupChatMessages.length - 1; i >= 0; i--) {
        if (window._popupChatMessages[i].role === 'assistant' && !window._popupChatMessages[i]._thinking) {
          lastAi = window._popupChatMessages[i].content; break;
        }
      }
      if (!lastAi) return;
      navigator.clipboard.writeText(lastAi).then(() => {
        copyChatBtn.el.textContent = 'Copied';
        setTimeout(() => { if (copyChatBtn.el.isConnected) copyChatBtn.el.textContent = 'Copy'; }, 1200);
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      }).catch(() => {});
    });
  copyChatBtn.el.style.display = 'none';
  popup._copyChatBtn = copyChatBtn.el;

  // "Open in tab" button — opens the panel conversation in a dedicated chat tab
  const openInTabBtn = new window.View('button').className('aether-topbar-btn')
    .text('Open in tab')
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (window._panelThreadId && typeof openChatPage === 'function') {
        openChatPage(window._panelThreadId);
        popup.remove();
        window._aetherTrackMode = false;
        window._aetherPinned = false;
      }
    });
  openInTabBtn.el.style.display = 'none';
  popup._openInTabBtn = openInTabBtn.el;

  const topRightGroup = new window.View('span').className('aether-topbar-right');

  const topBar = window.HStack([spacer, statsSpan, redoBtn, copyChatBtn, openInTabBtn, topRightGroup])
    .className('doc-popup-chat-actions aether-top-actions');
  topBar.el.style.cursor = 'grab';

  // Drag to move
  topBar.on('mousedown', (ev) => {
    if (ev.target.closest('button')) return;
    ev.stopPropagation();
    ev.preventDefault();
    window._aetherDragging = true;
    window._aetherDragPopup = popup;
    window._aetherTrackMode = false;
    topBar.el.style.cursor = 'grabbing';
    const r = popup.getBoundingClientRect();
    window._aetherDragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });

  popup.append(topBar.el);
}

// ── Helper: build chat input area (textarea, model selector, send button, mic, dropdowns) ──
export function _panelBuildChatInput(popup, config) {
  const contextMenu = config.contextMenu || null;
  const capturedText = config.selectionText || '';
  const finalized = config.finalized !== false;
  if (!finalized) return;

  // Chat area (messages container)
  const chatAreaView = new window.View('div').className('doc-popup-chat-area');
  chatAreaView.el.style.borderTop = 'none';
  if (capturedText) {
    const contextTrunc = capturedText.length > 120 ? capturedText.slice(0, 120) + '…' : capturedText;
    chatAreaView.add(new window.View('div').className('doc-popup-chat-context').text(contextTrunc));
  }
  chatAreaView.add(new window.View('div').className('doc-popup-chat-messages'));
  popup.append(chatAreaView.el);

  // Context box (appears above chat, like Cursor)
  if (capturedText) {
    const contextContent = new window.View('div').className('aether-context-content');
    contextContent.add(
      new window.View('span').className('aether-context-label').text('CONTEXT'),
      new window.View('span').className('aether-context-text').text(' ' + capturedText)
    );

    const contextBox = new window.View('div').className('aether-context-box');
    contextBox.add(
      new window.View('div').className('aether-context-icon').html(icon('chatContext', { size: 11 })),
      new window.View('div').className('aether-context-close-icon').html(icon('close', { size: 11 })),
      contextContent
    );
    contextBox.on('mouseenter', () => { contextBox.el.classList.add('hover'); })
      .on('mouseleave', () => { contextBox.el.classList.remove('hover'); })
      .on('click', (ev) => {
        ev.stopPropagation();
        contextBox.el.remove();
        popup._capturedText = '';
      });

    popup.append(contextBox.el);
  }

  // Screenshot / attachment strip (for screenshots/files, not text context)
  popup.append(new window.View('div').className('doc-screenshot-attachments').el);

  // Ask input + send button
  const askWrap = new window.View('div').className('doc-ask-inline-wrap');
  if (!capturedText) {
    askWrap.styles({ borderTop: 'none', marginTop: '0', paddingTop: '0' });
  }
  const askInput = new window.View('input').className('doc-ask-inline-input')
    .attr('type', 'text')
    .attr('placeholder', 'Ask anything…')
    .on('paste', (ev) => _handleImagePaste(ev, popup));

  const sendBtn = new window.View('button').className('aether-input-btn doc-ask-inline-send')
    .html('↑')
    .attr('title', 'Send')
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; _renderPopupChat(popup, true); return; }
      _sendPopupChatMessage(popup, capturedText);
    });
  askInput.on('keydown', (ev) => {
    // Let Cmd+I bubble up to document handler for toggle
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'i') return;
    ev.stopPropagation();
    const val = askInput.el.value;
    const isCmd = val.startsWith('/');
    const dropdown = popup.querySelector('.aether-cmd-dropdown');
    const modelDropdown = popup.querySelector('.aether-model-dropdown');

    // Arrow keys navigate model dropdown
    if (modelDropdown && window._aetherModelList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') window._aetherModelIdx = Math.min(window._aetherModelIdx + 1, window._aetherModelList.length - 1);
      else window._aetherModelIdx = Math.max(window._aetherModelIdx - 1, 0);
      _aetherRenderModelDropdown(popup);
      const sel = modelDropdown.querySelector('.aether-note-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (modelDropdown && window._aetherModelList.length && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectModel(popup);
      return;
    }
    if (modelDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideModelDropdown(popup);
      return;
    }

    // Arrow keys navigate agent dropdown
    const agentDropdown = popup.querySelector('.aether-agent-dropdown');
    if (agentDropdown && window._aetherAgentList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') window._aetherAgentIdx = Math.min(window._aetherAgentIdx + 1, window._aetherAgentList.length - 1);
      else window._aetherAgentIdx = Math.max(window._aetherAgentIdx - 1, 0);
      _aetherRenderAgentDropdown(popup);
      const sel = agentDropdown.querySelector('.aether-note-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (agentDropdown && window._aetherAgentList.length && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectAgent(popup);
      return;
    }
    if (agentDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideAgentDropdown(popup);
      return;
    }

    // Arrow keys navigate tab dropdown
    const tabDropdown = popup.querySelector('.aether-tab-dropdown');
    if (tabDropdown && window._aetherTabList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') window._aetherTabIdx = Math.min(window._aetherTabIdx + 1, window._aetherTabList.length - 1);
      else window._aetherTabIdx = Math.max(window._aetherTabIdx - 1, 0);
      const items = tabDropdown.querySelectorAll('.aether-tab-item');
      items.forEach((el, i) => el.classList.toggle('selected', i === window._aetherTabIdx));
      const sel = items[window._aetherTabIdx];
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (tabDropdown && window._aetherTabList.length && ev.key === 'Enter') {
      ev.preventDefault();
      if (window._aetherTabSwitchMode) _aetherSwitchToTab(popup);
      else _aetherSelectTab(popup);
      return;
    }
    if (tabDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideTabDropdown(popup);
      return;
    }

    // Arrow keys navigate history dropdown
    const histDropdown = popup.querySelector('.aether-history-dropdown');
    if (histDropdown && window._aetherHistoryList.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      if (ev.key === 'ArrowDown') window._aetherHistoryIdx = Math.min(window._aetherHistoryIdx + 1, window._aetherHistoryList.length - 1);
      else window._aetherHistoryIdx = Math.max(window._aetherHistoryIdx - 1, -1);
      const items = histDropdown.querySelectorAll('.aether-note-item');
      items.forEach(el => el.classList.toggle('selected', parseInt(el.dataset.idx) === window._aetherHistoryIdx));
      const sel = histDropdown.querySelector(`.aether-note-item[data-idx="${window._aetherHistoryIdx}"]`);
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (histDropdown && ev.key === 'Enter') {
      ev.preventDefault();
      _aetherSelectHistory(popup);
      return;
    }
    if (histDropdown && ev.key === 'Escape') {
      ev.preventDefault();
      _aetherHideHistoryDropdown(popup);
      return;
    }

    // Arrow keys navigate command autocomplete
    if (isCmd && dropdown && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      ev.preventDefault();
      const items = dropdown.querySelectorAll('.aether-cmd-item');
      if (ev.key === 'ArrowDown') window._aetherCmdIdx = Math.min(window._aetherCmdIdx + 1, items.length - 1);
      else window._aetherCmdIdx = Math.max(window._aetherCmdIdx - 1, 0);
      _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      const dd = popup.querySelector('.aether-cmd-dropdown');
      const sel = dd && dd.querySelector('.aether-cmd-item.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (isCmd && dropdown && ev.key === 'Tab') {
      ev.preventDefault();
      const matches = _aetherFilterCommands(val.slice(1).trim());
      if (matches[window._aetherCmdIdx]) askInput.el.value = '/' + matches[window._aetherCmdIdx].name;
      _aetherRenderCmdDropdown(popup, matches[window._aetherCmdIdx]?.name || '');
      return;
    }

    if (ev.key === 'Enter' && ev.shiftKey) {
      ev.preventDefault();
      _aetherHideCmdDropdown(popup);
      _doAetherWebSearch(popup);
    } else if (ev.key === 'Enter') {
      // Check if user has text selected in the panel (not in the input)
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';
      if (selectedText && !selection.containsNode(askInput.el, true)) {
        ev.preventDefault();
        // Add selected text to input
        const currentVal = askInput.el.value.trim();
        askInput.el.value = currentVal ? currentVal + ' ' + selectedText : selectedText;
        askInput.el.focus();
        // Clear the selection
        if (selection) selection.removeAllRanges();
        return;
      }

      ev.preventDefault();
      if (isCmd && dropdown) {
        const matches = _aetherFilterCommands(val.slice(1).trim());
        const cmd = matches[window._aetherCmdIdx] || matches[0];
        if (cmd) {
          if (cmd.hasArgs) {
            askInput.el.value = '/' + cmd.name + ' ';
            _aetherHideCmdDropdown(popup);
          } else if (cmd._special) {
            _aetherHideCmdDropdown(popup);
            if (cmd.name === 'capture') _doAetherCapture(popup);
            else if (cmd.name === 'model') _doAetherModel(popup);
            else if (cmd.name === 'links') _doAetherLinks(popup);
            else if (cmd.name === 'tab') _doAetherTab(popup);
            else if (cmd.name === 'tabs') _doAetherTabs(popup);
            else if (cmd.name === 'notes') _doAetherNotesBrowse(popup);
            else if (cmd.name === 'history') _doAetherHistory(popup);
            else if (cmd.name === 'help') _doAetherHelp(popup);
          } else {
            _aetherHideCmdDropdown(popup);
            cmd.fn();
            window._aetherTrackMode = false;
            popup.remove();
          }
          return;
        }
      }
      if (isCmd && val.trim().length > 1) {
        _aetherExecCommand(popup, val);
      } else if (!isCmd) {
        _aetherHideCmdDropdown(popup);
        _sendPopupChatMessage(popup, capturedText);
      }
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (modelDropdown) { _aetherHideModelDropdown(popup); return; }
      if (agentDropdown) { _aetherHideAgentDropdown(popup); return; }
      if (dropdown) { _aetherHideCmdDropdown(popup); return; }
      window._aetherTrackMode = false;
      window._aetherPinned = false;
      _maybeDismissToIsland(popup);
      if (!window._aetherBackgroundStreaming && window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
      window._pendingScreenshots = [];
      window._pendingTabContexts = [];
      window._pendingFileContexts = [];
      window._pendingElementContexts = [];
      _savePopupChatToHighlight(popup);
      popup.remove();
      _aetherShowCursor();
      _aetherRestoreFocus();
    }
    // Shift key handler removed - no longer dismisses panel
  });
  askInput.on('input', () => {
    const val = askInput.el.value;
    if (val.startsWith('/')) {
      const histMatch = val.match(/^\/history(\s+(.*))?$/i);
      if (histMatch && histMatch[1] !== undefined) {
        _aetherHideCmdDropdown(popup);
        window._aetherHistoryIdx = -1;
        _aetherRenderHistoryDropdown(popup, (histMatch[2] || '').trim());
      } else {
        _aetherHideHistoryDropdown(popup);
        window._aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, val.slice(1).trim());
      }
    } else {
      _aetherHideCmdDropdown(popup);
      _aetherHideHistoryDropdown(popup);
      // Math calculator — compact result badge next to input
      let mathBadge = popup.querySelector('.aether-math-badge');
      const mathResult = _tryMathAnswer(val.trim());
      if (mathResult) {
        if (!mathBadge) {
          mathBadge = document.createElement('span');
          mathBadge.className = 'aether-math-badge';
          const inputWrap = popup.querySelector('.doc-ask-inline-wrap');
          if (inputWrap) inputWrap.appendChild(mathBadge);
        }
        // Extract just the formatted number from the result
        const m = mathResult.html.match(/font-weight:700[^>]*>([^<]+)/);
        mathBadge.textContent = '= ' + (m ? m[1] : '');
        mathBadge.style.display = '';
      } else if (mathBadge) {
        mathBadge.style.display = 'none';
      }
    }
  });
  askInput.on('mousedown', (ev) => ev.stopPropagation());

  // Mic button for voice input (AudioWorklet streaming + Parakeet TDT via IPC)
  let _micStream = null;
  let _micAudioCtx = null;
  let _micWorklet = null;
  let _micAccum = [];
  let _micActive = false;

  const micBtn = new window.View('button').className('aether-input-btn doc-ask-mic-btn')
    .html(icon('microphone', { size: 14 }))
    .attr('title', 'Voice input')
    .on('mousedown', (ev) => ev.stopPropagation())
    .on('click', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      if (_micActive) { _micStop(); return; }
      _micStart();
    });

  async function _micStop() {
    _micActive = false;
    if (_micWorklet) { try { _micWorklet.disconnect(); } catch (_e) {} _micWorklet = null; }
    if (_micAudioCtx) { try { _micAudioCtx.close(); } catch (_e) {} _micAudioCtx = null; }
    if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
    micBtn.el.classList.remove('doc-ask-mic-active');
    window._pillMicRecorder = null;
    if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
    if (typeof window.islandRemove === 'function') window.islandRemove('mic');
    // Insert accumulated text
    const text = _micAccum.join(' ').trim();
    _micAccum = [];
    if (text) {
      askInput.el.value = askInput.el.value + (askInput.el.value ? ' ' : '') + text;
      askInput.el.focus();
      if (Settings.get('voiceAutoSend') === 'on') {
        setTimeout(() => _sendPopupChatMessage(popup, text), 50);
      }
    }
  }

  async function _micStart() {
    try {
      _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_e) { return; }
    _micActive = true;
    _micAccum = [];
    micBtn.el.classList.add('doc-ask-mic-active');
    window._pillMicRecorder = true;
    if (typeof window._renderUnifiedPill === 'function') window._renderUnifiedPill();
    if (typeof window.islandUpdate === 'function') window.islandUpdate('mic', { type: 'mic', label: 'Listening\u2026', lines: [], action: function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); } });

    _micAudioCtx = new AudioContext({ sampleRate: 16000 });
    const processorCode = `
      class MicProcessor extends AudioWorkletProcessor {
        constructor() { super(); this._buf = new Float32Array(24000); this._pos = 0; }
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
      registerProcessor('mic-processor', MicProcessor);
    `;
    const blob = new Blob([processorCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await _micAudioCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    _micWorklet = new AudioWorkletNode(_micAudioCtx, 'mic-processor');
    _micWorklet.port.onmessage = async (e) => {
      if (!_micActive || !window.electronAPI) return;
      try {
        const bytes = new Uint8Array(e.data);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const result = await window.electronAPI.captionsTranscribe(base64, 16000);
        if (result && result.text && _micActive) {
          _micAccum.push(result.text);
          // Update island mic pill lines
          const micAct = window._islandActivities ? window._islandActivities.value.mic : null;
          const micLines = (micAct && micAct.lines) ? micAct.lines.slice() : [];
          micLines.push(result.text);
          if (micLines.length > 12) micLines.shift();
          if (typeof window.islandUpdate === 'function') window.islandUpdate('mic', { type: 'mic', label: 'Listening\u2026', lines: micLines, action: function() { if (typeof window._pillMicClick === 'function') window._pillMicClick(); } });
        }
      } catch (_e) {}
    };

    const source = _micAudioCtx.createMediaStreamSource(_micStream);
    source.connect(_micWorklet);
  }

  // Expose mic toggle for toolbar pill
  window._pillMicClick = function() { if (_micActive) _micStop(); else _micStart(); };

  askWrap.add(askInput);
  popup.append(askWrap.el);

  // Second row: model label + buttons
  // Agent chip — clickable to switch agents
  const agentNames = { 'research-assistant': 'Research Assistant', 'chat': 'Chat', 'browser': 'Browser' };
  const currentAgentId = Settings.get('chatAgent') || 'research-assistant';
  const agentLabel = new window.View('span').className('aether-agent-chip-label')
    .text(agentNames[currentAgentId] || currentAgentId);
  const agentChip = new window.View('span').className('aether-agent-chip')
    .attr('title', 'Switch agent')
    .on('click', (ev) => { ev.stopPropagation(); _doAetherAgent(popup); });
  agentChip.add(agentLabel);

  // Model label (secondary info beside agent chip)
  const cm = Settings.get('chatModel') || 'qwen2.5:3b';
  const modelLabel = new window.View('span').className('aether-model-label')
    .text(cm)
    .attr('title', 'Current model');

  // AI mode chip (Local/Cloud toggle)
  const isCloud = Settings.get('aiProvider') === 'openrouter';
  const cloudSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5h4.5l-3.5 2.5 1.5 4.5-4-3-4 3 1.5-4.5-3.5-2.5h4.5z"/></svg>';
  const localSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  const aiModeChip = new window.View('span').className('ai-mode-chip')
    .html((isCloud ? cloudSvg : localSvg) + '<span>' + (isCloud ? 'Cloud' : 'Local') + '</span>')
    .attr('title', 'Toggle Local/Cloud AI')
    .on('click', function(e) {
      e.stopPropagation();
      const cur = Settings.get('aiProvider') || 'ollama';
      const next = cur === 'openrouter' ? 'ollama' : 'openrouter';
      Settings.set('aiProvider', next);
      if (window.electronAPI && window.electronAPI.providerSetDefault) window.electronAPI.providerSetDefault(next);
      window.dispatchEvent(new CustomEvent('aimode-changed', { detail: { provider: next } }));
    });
  if (isCloud) aiModeChip.el.classList.add('ai-mode-cloud');

  // Listen for mode changes to update this chip
  function _updateAiModeChip() {
    const cloud = Settings.get('aiProvider') === 'openrouter';
    AetherUI.mount(window.HStack(window.RawHTML(cloud ? cloudSvg : localSvg), window.Text(cloud ? 'Cloud' : 'Local')), aiModeChip.el);
    aiModeChip.el.classList.toggle('ai-mode-cloud', cloud);
  }
  window.addEventListener('aimode-changed', _updateAiModeChip);

  const spacer = new window.View('span').styles({ flex: '1' });

  const buttonRow = window.HStack([agentChip, modelLabel, aiModeChip, spacer, micBtn, sendBtn])
    .className('aether-button-row');

  popup.append(buttonRow.el);

}

// ── Helper: install Cmd+C copy key handler ──
export function _panelBuildCopyKeyHandler(popup) {
  function _onCopyKey(e) {
    if (!((e.metaKey || e.ctrlKey) && e.key === 'c')) return;
    if (!popup.isConnected) { document.removeEventListener('keydown', _onCopyKey, true); return; }
    // Only intercept if focus is inside the popup
    if (!popup.contains(document.activeElement) && document.activeElement !== popup) return;
    const input = popup.querySelector('.doc-ask-inline-input');
    if (input && input.value) return;
    const text = popup._capturedText;
    if (text) {
      e.preventDefault();
      if (window.electronAPI && electronAPI.clipboardWriteText) {
        electronAPI.clipboardWriteText(text);
        if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6');
      } else {
        navigator.clipboard.writeText(text).then(() => { if (window.AetherCursor && AetherCursor.pulse) AetherCursor.pulse('#3b82f6'); }).catch(() => {});
      }
    }
    _flashCopyBtn(popup);
  }
  document.addEventListener('keydown', _onCopyKey, true);
}

// ── Helper: position panel and auto-focus input ──
export function _panelPositionAndFocus(popup, config) {
  const anchor = config.anchor || {};
  const finalized = config.finalized !== false;
  const initialValue = config.initialValue || '';
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isTabAnchor) {
    // Tab context: position below the tab element
    const tabEl = anchor.tab;
    const tabRect = tabEl.getBoundingClientRect();
    popup.classList.add('tab-context-panel');
    popup.style.maxWidth = '';
    popup._tabContextAnchor = { left: tabRect.left, top: tabRect.bottom, tabWidth: tabRect.width };
    let left = tabRect.left;
    const rect = popup.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    popup.style.left = left + 'px';
    popup.style.top = tabRect.bottom + 'px';
    popup.style.visibility = '';
    popup._aetherAnchorX = left;
    popup._aetherAnchorY = tabRect.bottom + rect.height;
    // Keep panel open while mouse is inside (matches hover tooltip behavior)
    popup.addEventListener('mouseenter', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') clearTimeout(_tabHoverDismissTimeout); });
    popup.addEventListener('mouseleave', () => { if (typeof _tabHoverDismissTimeout !== 'undefined') { clearTimeout(_tabHoverDismissTimeout); _tabHoverDismissTimeout = setTimeout(() => { if (popup.isConnected) popup.remove(); }, 150); } });
  } else if (isSelectionAnchor) {
    // Selection: above or below selection rect
    const selRect = anchor.selectionRect;
    popup._anchorTop = selRect.top;
    popup._anchorBottom = selRect.bottom;
    popup._anchorLeft = selRect.left;
    const popupRect = popup.getBoundingClientRect();
    let top = selRect.top - popupRect.height - 8;
    const fitsAbove = top >= 4;
    if (!fitsAbove) top = selRect.bottom + 8;
    popup._aboveSelection = fitsAbove;
    let left = selRect.left;
    if (left + popupRect.width > window.innerWidth - 8) left = window.innerWidth - popupRect.width - 8;
    if (left < 4) left = 4;
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.visibility = '';
  } else {
    // Cursor anchor: position so the input caret is at the click point
    const x = anchor.x || 0;
    const y = anchor.y || 0;
    popup._aetherAnchorX = x;
    popup._aetherAnchorY = y;
    const rect = popup.getBoundingClientRect();
    const askInput = popup.querySelector('.doc-ask-inline-input');
    let inputOffsetX = 0, inputOffsetY = 0;
    if (askInput) {
      const inputRect = askInput.getBoundingClientRect();
      // Offset from panel left to input's text start (left edge + padding)
      const inputPadLeft = parseFloat(getComputedStyle(askInput).paddingLeft) || 0;
      inputOffsetX = (inputRect.left - rect.left) + inputPadLeft;
      // Offset from panel top to input's vertical center
      inputOffsetY = (inputRect.top - rect.top) + inputRect.height / 2;
    }
    const _initLeft = false;
    // Desired panel position: input caret at (x, y)
    let left = x - inputOffsetX;
    let top = y - inputOffsetY;
    // Clamp to viewport
    const bounds = _popupSafeBounds();
    if (left + rect.width > bounds.right) left = bounds.right - rect.width;
    if (left < bounds.left) left = bounds.left;
    if (top + rect.height > bounds.bottom) top = bounds.bottom - rect.height;
    if (top < bounds.top) top = bounds.top;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.visibility = '';
  }

  // Auto-focus input
  if (finalized) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      if (isSelectionAnchor) {
        setTimeout(() => askInput.focus(), 10);
      } else {
        askInput.focus();
      }
    }
    _updateContextBar(popup);
  }

  // Pre-fill input and trigger command dropdown if initialValue provided
  if (finalized && initialValue) {
    const askInput = popup.querySelector('.doc-ask-inline-input');
    if (askInput) {
      askInput.value = initialValue;
      if (initialValue.startsWith('/')) {
        window._aetherCmdIdx = 0;
        _aetherRenderCmdDropdown(popup, initialValue.slice(1).trim());
      }
      // Reposition after dropdown renders
      if (isCursorAnchor) {
        const ax = anchor.x || 0, ay = anchor.y || 0;
        requestAnimationFrame(() => {
          const r2 = popup.getBoundingClientRect();
          let t2 = ay - r2.height;
          if (t2 < 0) t2 = 0;
          popup.style.top = t2 + 'px';
        });
      }
    }
  }
}

export function _showPanel(config) {
  if (!_authReady) return;
  if (!Settings.aiEnabled()) return;
  config = config || {};
  const anchor = config.anchor || {};
  const contextMenu = config.contextMenu || null;
  const selectionText = config.selectionText || '';
  const editableTarget = config.editableTarget || null;
  const finalized = config.finalized !== false; // default true

  // Save the currently focused element so Escape can restore it
  const ae = document.activeElement;
  if (ae && ae !== document.body && !ae.closest('#doc-chat-ask-float')) {
    window._aetherPrevFocus = { el: ae, selStart: ae.selectionStart, selEnd: ae.selectionEnd };
  }

  // Remove any existing active panel
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) {
    window._aetherBackgroundStreaming = false; islandRemove('aether');
    if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
    if (!selectionText) _savePopupChatToHighlight(existing);
    existing.remove();
  }
  // Remove any open note editor or help panel
  const existingEditor = document.getElementById('aether-note-editor');
  if (existingEditor) existingEditor.remove();
  const existingHelp = document.getElementById('aether-help-panel');
  if (existingHelp) existingHelp.remove();

  const popupView = new window.View('div').id('doc-chat-ask-float').className('doc-selection-popup');
  const popup = popupView.el;
  const _origRemove = popup.remove.bind(popup);
  popup.remove = function() { _origRemove(); };

  // Determine anchor mode
  const isSelectionAnchor = !!anchor.selectionRect;
  const isTabAnchor = !!anchor.tab;
  const isCursorAnchor = !isSelectionAnchor && !isTabAnchor;

  if (isCursorAnchor) popup._isAetherPanel = true;
  if (!finalized) popup.style.visibility = 'hidden';

  const hasContext = contextMenu && (contextMenu.linkUrl || contextMenu.imgUrl || contextMenu.items);
  window._aetherPinned = false;
  if (isCursorAnchor) {
    window._aetherTrackMode = config.trackCursor !== undefined ? config.trackCursor : false;
  } else {
    window._aetherTrackMode = false;
  }

  const capturedText = selectionText;
  popup._capturedText = capturedText || '';

  // Reset shared state for new panel (unless preview)
  // Per-tab AI: if globals already have a restored session (from tab switch), preserve it
  // But if opening with selection text, always start fresh
  const _hasRestoredState = !!(window._panelSession || window._panelThreadId) && !selectionText;
  if (finalized && !_hasRestoredState) {
    _saveChatMemory();
    window._popupChatMessages = [];
    window._chatMemoryRetrieved = false;
    window._pendingScreenshots = [];
    window._pendingTabContexts = [];
    window._pendingFileContexts = [];
    window._pendingElementContexts = [];
    window._aetherDragging = false;
    window._aetherDragPopup = null;
    window._aetherBackgroundStreaming = false; islandRemove('aether');
    if (window._popupChatAbort) { window._popupChatAbort.abort(); window._popupChatAbort = null; }
    // Reset engine session for new panel
    window._panelSession = null;
    window._panelThreadId = null;
    // Per-tab AI: clear active tab's saved panel state (starting fresh)
    const _freshTab = _getActiveBrowseTab();
    if (_freshTab) _freshTab._aiPanel = null;
  } else if (finalized && _hasRestoredState) {
    // Restored state — keep globals, just clean up drag/UI state
    window._aetherDragging = false;
    window._aetherDragPopup = null;
  }

  // ── Build panel sections via helpers ──
  _panelBuildContextItems(popup, config);
  _panelBuildLinkContextMenu(popup, config);
  _panelBuildEditableActions(popup, config, capturedText, hasContext);
  _panelBuildSelectionUI(popup, config);
  if (finalized) _panelBuildTopBar(popup);
  _panelBuildChatInput(popup, config);

  // Show "Save chat" button if in PDF text layer
  if (popup._inTextLayer && popup._saveChatBtn) {
    popup._saveChatBtn.style.display = '';
  }

  popup.addEventListener('mousedown', (ev) => {
    // Don't stop propagation — let clicks dismiss the panel
  });

  // Prevent wheel events from leaking to the webview underneath
  popup.addEventListener('wheel', (ev) => {
    const msgs = popup.querySelector('.doc-popup-chat-messages');
    if (msgs && msgs.scrollHeight > msgs.clientHeight) {
      ev.stopPropagation();
    }
  });

  AetherUI.append(popupView, document.body);

  // Hide cursor while panel is open
  if (isCursorAnchor && finalized && window._aetherTrackMode) {
    _aetherHideCursorOverlay();
  }

  // Per-tab AI: if restoring a previous conversation, render existing messages
  if (_hasRestoredState && window._popupChatMessages.length > 0) {
    popup.classList.add('has-chat');
    const chatArea = popup.querySelector('.doc-popup-chat-area');
    if (chatArea) chatArea.classList.add('visible');
    _renderPopupChat(popup, true);
    // Re-register session onUpdate for live streaming
    if (window._panelSession && window._panelSession.onUpdate) {
      window._panelSession.onUpdate((type) => {
        window._popupChatMessages = window._panelSession.messages;
        if (type === 'stream') { const p = document.getElementById('doc-chat-ask-float'); if (p) _renderPopupChat(p, false); }
        else if (type === 'done' || type === 'message') { const p = document.getElementById('doc-chat-ask-float'); if (p) _renderPopupChat(p, true); }
      });
    }
  }

  // ── Cmd+C handler + positioning ──
  _panelBuildCopyKeyHandler(popup);
  _panelPositionAndFocus(popup, config);

  return popup;
}

export function openPaper(index, e) {
  const paper = lastFilteredPapers[index];
  if (!paper) return;
  if (_isNewTabClick(e)) { _openInNewTab(paper.link); return; }
  markPostAsRead(paper.link);
  openBrowseWithPaper(paper.link, paper);
}

export function openPaperByUrl(url, e) {
  if (_isNewTabClick(e)) { _openInNewTab(url); return; }
  const paper = (typeof searchResultsCache !== 'undefined' && searchResultsCache || []).find(r => r && r.link === url)
    || (typeof getSavedPosts === 'function' && getSavedPosts()[url]?.paper)
    || (typeof allPapers !== 'undefined' && allPapers.find(p => p.link === url))
    || { title: 'Paper', link: url, description: '', authors: '', categories: [], source: url.includes('arxiv.org') ? 'arxiv' : '' };
  openBrowseWithPaper(url, paper);
}

