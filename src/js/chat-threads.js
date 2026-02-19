// chat-threads.js — Document text extraction, sidebar tabs, insights

// ── Document context (used by popup chat in panel.js) ──
export const _docText = '';
export const _docTextLoading = false;
export const _docChatAbort = null;
export const _docChatPaperUrl = '';

export const _extractSpinnerInterval = null;

// Store scroll positions per sidebar tab
export const _sidebarScrollPositions = {};

export const _sidebarTerminal = null;

// ── Window exports ──
window._docText = _docText;
window._docTextLoading = _docTextLoading;
window._docChatAbort = _docChatAbort;
window._docChatPaperUrl = _docChatPaperUrl;
window._extractSpinnerInterval = _extractSpinnerInterval;
window._sidebarScrollPositions = _sidebarScrollPositions;
window._sidebarTerminal = _sidebarTerminal;

