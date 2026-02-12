// chat-threads.js — Document text extraction, sidebar tabs, insights

// ── Document context (used by popup chat in panel.js) ──
let _docText = '';
let _docTextLoading = false;
let _docChatAbort = null;
let _docChatPaperUrl = '';

function _chatUrl() {
  if (_docChatPaperUrl) return _docChatPaperUrl;
  if (typeof _browseTabs !== 'undefined' && typeof _browseActiveTab !== 'undefined') {
    const t = _browseTabs.find(t => t.id === _browseActiveTab);
    if (t && t.url) { _docChatPaperUrl = t.url; return t.url; }
  }
  return '';
}

let _extractSpinnerInterval = null;

// Store scroll positions per sidebar tab
let _sidebarScrollPositions = {};

function switchSidebarTab(tab) {
  switchPanelTab(tab);
}

let _sidebarTerminal = null;

