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

async function extractDocText(url) {
  _docTextLoading = true;
  if (_extractSpinnerInterval) clearInterval(_extractSpinnerInterval);
  try {
    const data = await apiPost('/api/extract-text', { url });
    if (!data.error) {
      _docText = data.text || '';
    }
  } catch (e) {}
  _docTextLoading = false;
}

// Store scroll positions per sidebar tab
let _sidebarScrollPositions = {};

function switchSidebarTab(tab) {
  switchPanelTab(tab);
}

let _sidebarTerminal = null;

function _initSidebarTerminal() {
  const container = document.getElementById('sidebar-terminal-container');
  if (!container) return;
  // Already initialized and container still has the terminal
  if (_sidebarTerminal && _sidebarTerminal.term && container.querySelector('.xterm')) {
    _sidebarTerminal.fitAddon.fit();
    return;
  }
  // Clean up old instance
  if (_sidebarTerminal) {
    if (_sidebarTerminal.ws) try { _sidebarTerminal.ws.close(); } catch (_) {}
    if (_sidebarTerminal.term) _sidebarTerminal.term.dispose();
    _sidebarTerminal = null;
  }
  container.innerHTML = '';

  const theme = TERMINAL_THEMES[_termSettings.theme] || TERMINAL_THEMES.dark;
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    scrollback: 5000,
    theme: theme,
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const obj = { term, fitAddon, ws: null };
  _sidebarTerminal = obj;

  term.open(container);
  setTimeout(() => fitAddon.fit(), 50);

  // Connect WebSocket
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProto}//${location.host}/ws/terminal`);
  ws.binaryType = 'arraybuffer';
  obj.ws = ws;

  ws.onopen = () => {
    fitAddon.fit();
    const { cols, rows } = term;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    } else {
      term.write(ev.data);
    }
  };
  ws.onerror = (e) => console.error('[sidebar-terminal] ws error', e);
  ws.onclose = () => term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  // Re-fit on sidebar resize
  const observer = new ResizeObserver(() => {
    if (container.offsetWidth > 0 && container.offsetHeight > 0) fitAddon.fit();
  });
  observer.observe(container);
}

