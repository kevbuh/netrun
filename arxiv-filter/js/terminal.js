// ── Terminal View ──
let _termInstance = null;
let _termWs = null;
let _termFitAddon = null;

function openTerminal() {
  hideAllViews();
  const view = document.getElementById('terminal-view');
  view.style.display = 'flex';
  view.classList.remove('hidden');
  setSidebarActive('sb-terminal');
  window.location.hash = '#terminal';

  if (!_termInstance) {
    _initTerminal();
  } else {
    // Reconnect if WS is closed
    if (!_termWs || _termWs.readyState !== WebSocket.OPEN) {
      _connectTerminalWs();
    }
    setTimeout(() => _termFitAddon && _termFitAddon.fit(), 50);
  }
}

function _initTerminal() {
  const container = document.getElementById('terminal-container');
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: {
      background: '#0d0d0d',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  _termInstance = term;
  _termFitAddon = fitAddon;

  // Auto-fit on resize
  const ro = new ResizeObserver(() => {
    try { fitAddon.fit(); } catch (_) {}
  });
  ro.observe(container);

  // Send resize to server after fit
  term.onResize(({ cols, rows }) => {
    if (_termWs && _termWs.readyState === WebSocket.OPEN) {
      _termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  _connectTerminalWs();
}

function _connectTerminalWs() {
  if (_termWs) {
    try { _termWs.close(); } catch (_) {}
  }
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}/ws/terminal`;
  console.log('[terminal] connecting to', wsUrl);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  _termWs = ws;

  ws.onopen = () => {
    console.log('[terminal] ws open');
    // Send initial size
    if (_termFitAddon) _termFitAddon.fit();
    const { cols, rows } = _termInstance;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };

  ws.onmessage = (ev) => {
    if (!_termInstance) return;
    if (ev.data instanceof ArrayBuffer) {
      _termInstance.write(new Uint8Array(ev.data));
    } else {
      _termInstance.write(ev.data);
    }
  };

  ws.onerror = (e) => {
    console.error('[terminal] ws error', e);
  };

  ws.onclose = (ev) => {
    console.log('[terminal] ws close', ev.code, ev.reason);
    if (_termInstance) _termInstance.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
  };

  // Forward terminal input to WS
  _termInstance.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}
