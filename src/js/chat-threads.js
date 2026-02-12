// chat-threads.js — Document text extraction, sidebar tabs, insights

// ── Document context (used by popup chat in panel.js) ──
let _docText = '';
let _docTextLoading = false;
let _docChatAbort = null;
let _docChatPaperUrl = '';

let _extractSpinnerInterval = null;

// Store scroll positions per sidebar tab
let _sidebarScrollPositions = {};

let _sidebarTerminal = null;

