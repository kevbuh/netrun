// ── Search View ──

import { _browseUrlHideHistory, _browseUrlShowHistory } from '/js/browse-urlbar.js';
import { _renderNtpFileChips } from '/js/browse/browse-ntp.js';
import { _sendPopupChatMessage } from '/js/panel-chat.js';
import { _showPanel } from '/js/panel.js';
import { browseNavigate } from '/js/toolbar/toolbar-url.js';

export function onSearchInput() {
  const input = document.getElementById('search-query');
  const query = (input?.value || '').trim();
  // If input cleared on new-tab page, hide dropdown but keep input focused
  if (!query && input && input.closest('.browse-ntp')) {
    _browseUrlHideHistory();
    return;
  }
  _browseUrlShowHistory();
}

export function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;

  // If files are uploaded on NTP, open Aether panel with file/image context
  if (window._ntpUploadedFiles?.length > 0) {
    const imageEntries = window._ntpUploadedFiles.filter(f => f.isImage && f.base64);
    const fileEntries = window._ntpUploadedFiles.filter(f => !f.isImage).map(f => ({ name: f.name, content: f.content || '' }));
    window._ntpUploadedFiles = [];
    _renderNtpFileChips();
    _showPanel({ anchor: { x: window.innerWidth / 2 - 200, y: 120 }, initialValue: query, finalized: true });
    // Set file contexts AFTER _showPanel (which clears them during reset)
    if (window._pendingFileContexts) {
      for (const f of fileEntries) window._pendingFileContexts.push(f);
    }
    // Add images as screenshots for vision
    if (window._pendingScreenshots) {
      for (const img of imageEntries) window._pendingScreenshots.push(img.base64);
    }
    // Auto-send the query once the panel has mounted
    setTimeout(() => {
      const popup = document.getElementById('doc-chat-ask-float');
      if (!popup) return;
      const input = popup.querySelector('.doc-ask-inline-input');
      if (input) input.value = query;
      _sendPopupChatMessage(popup);
    }, 50);
    return;
  }

  // Default: navigate via browseNavigate (Google search or URL)
  browseNavigate(query);
}

// ── Relative time helper (used across modules) ──
export function _relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Browse tabs moved to browse-tabs.js ──

// ── Browse URL bar moved to browse-urlbar.js ──

