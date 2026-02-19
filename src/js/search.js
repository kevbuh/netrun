// ── Search View ──

export function onSearchInput() {
  const input = document.getElementById('search-query');
  const query = (input?.value || '').trim();
  // If input cleared on new-tab page, hide dropdown but keep input focused
  if (!query && input && input.closest('.browse-ntp')) {
    if (typeof _browseUrlHideHistory === 'function') _browseUrlHideHistory();
    return;
  }
  if (typeof _browseUrlShowHistory === 'function') _browseUrlShowHistory();
}

export function submitSearch() {
  const query = (document.getElementById('search-query')?.value || '').trim();
  if (!query) return;

  // If files are uploaded on NTP, open Aether panel with file context
  if (typeof _ntpUploadedFiles !== 'undefined' && _ntpUploadedFiles.length > 0) {
    const fileEntries = _ntpUploadedFiles.map(f => ({ name: f.name, content: f.content || '' }));
    _ntpUploadedFiles = [];
    _renderNtpFileChips();
    if (typeof _showPanel === 'function') {
      _showPanel({ anchor: { x: window.innerWidth / 2 - 200, y: 120 }, initialValue: query, finalized: true });
      // Set file contexts AFTER _showPanel (which clears them during reset)
      if (typeof _pendingFileContexts !== 'undefined') {
        for (const f of fileEntries) _pendingFileContexts.push(f);
      }
      // Auto-send the query
      setTimeout(() => {
        const popup = document.getElementById('doc-chat-ask-float');
        if (popup) {
          const input = popup.querySelector('.doc-ask-inline-input');
          if (input) { input.value = query; }
          if (typeof _sendPopupChatMessage === 'function') _sendPopupChatMessage(popup);
        }
      }, 50);
    }
    return;
  }

  // Default: navigate via browseNavigate (Google search or URL)
  if (typeof browseNavigate === 'function') browseNavigate(query);
}

// ── Relative time helper (used across modules) ──
export function _relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Browse tabs moved to browse-tabs.js ──

// ── Browse URL bar moved to browse-urlbar.js ──

// ── Window exports ──
window.onSearchInput = onSearchInput;
window.submitSearch = submitSearch;
window._relativeTime = _relativeTime;
