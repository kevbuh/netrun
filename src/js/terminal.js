import Settings from '/js/core/core-settings.js';
import { icon } from '/js/core/icons.js';
import { _browseRenderTabs } from '/js/toolbar/toolbar-tabs.js';
import { _browseSetUrlDisplay } from '/js/browse-urlbar.js';
import { _browseUpdateNewTabPage, browseSelectTab } from '/js/browse/browse-passwords.js';
import { browseSelectWindow, openBrowse } from '/js/browse/browse-windows.js';
import { _browseWindows, getBrowseActiveWindow } from '/js/browse/browse-state.js';

// ── Terminal window.View(Multi-tab, Split Panes, Search, Themes) ──

// ─── Open terminal as a dedicated browse tab ─────────────────
export function openTerminalPage() {
  openBrowse();

  // Reuse existing terminal tab
  for (const w of _browseWindows) {
    const existing = w.tabs.find(t => t._terminalPage);
    if (existing) {
      if (w.id !== getBrowseActiveWindow()) browseSelectWindow(w.id);
      browseSelectTab(existing.id);
      return;
    }
  }

  const win = _browseWindows.find(w => w.id === getBrowseActiveWindow());
  if (!win) return;
  const tab = win.tabs.find(t => t.id === win.activeTab);
  if (!tab) return;

  tab.blank = false;
  tab.url = 'terminal://';
  tab.title = 'Terminal';
  tab.favicon = '';
  tab._terminalPage = true;

  if (tab.el) tab.el.remove();

  const container = document.getElementById('browse-content');
  const page = new window.View('div')
    .id('browse-terminal-' + tab.id)
    .className('nr-terminal-page')
    .cssText('position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;display:flex;flex-direction:column;');
  container.appendChild(page.el);
  tab.el = page.el;

  _browseUpdateNewTabPage(tab);
  _browseRenderTabs();

  const urlInput = document.getElementById('browse-url-input');
  _browseSetUrlDisplay(urlInput, 'terminal://');

  _renderTerminalPage(page.el);
}

function _renderTerminalPage(el) {
  _loadTerminalState();

  const tabBar = new window.View('div').className('nr-terminal-page-tabs');
  const pane = new window.View('div').className('nr-terminal-page-pane');
  el.appendChild(tabBar.el);
  el.appendChild(pane.el);

  // Create first terminal if none exist
  if (_terminals.length === 0) {
    createTerminal();
  }

  _renderTerminalPageTabs(tabBar.el);
  _renderTerminalPagePane(pane.el);
}

function _renderTerminalPageTabs(tabBar) {
  const paneEl = tabBar.nextElementSibling;
  _buildTabBar(
    tabBar,
    (id) => { _activeTerminalId = id; _renderTerminalPageTabs(tabBar); _mountTerminalInto(paneEl); _saveTerminalState(); },
    () => { createTerminal(); _renderTerminalPageTabs(tabBar); _mountTerminalInto(paneEl); }
  );
}

/** Core: init a terminal's pane into a parent element */
function _initTerminalPane(t, parentEl) {
  const pane = t.container;
  pane.style.width = '100%';
  pane.style.height = '100%';
  parentEl.appendChild(pane);

  if (!pane.querySelector('.xterm')) {
    t.term.open(pane);
    t.fitAddon.fit();
    _connectTerminalWs(t);
    const ro = new ResizeObserver(() => { try { t.fitAddon.fit(); } catch (_) {} });
    ro.observe(pane);
    t.term.onResize(({ cols, rows }) => _terminalSendResize(t, cols, rows));
  } else {
    setTimeout(() => { t.fitAddon.fit(); t.term.focus(); }, 50);
  }
}

/** Mount active terminal into a container, clearing it first */
function _mountTerminalInto(container) {
  if (!container) return;
  const t = _activeTerminal();
  if (!t) return;
  container.innerHTML = '';
  _initTerminalPane(t, container);
}

// Global state
export const _terminals = [];
export let _activeTerminalId = null;
export let _terminalLayout = null;
export let _termSearchTimeout = null;

/** Helper: get the currently active terminal object */
function _activeTerminal() {
  return _terminals.find(t => t.id === _activeTerminalId);
}

// Terminal themes
export const TERMINAL_THEMES = {
  dark: {
    background: '#0d0d0d',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#0d0d0d',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  },
  light: {
    background: '#ffffff',
    foreground: '#1e1e1e',
    cursor: '#1e1e1e',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  solarized: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    cursorAccent: '#272822',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
};

// Settings
export let _termSettings = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'block',
};

export function _nextTerminalId() {
  const used = new Set(_terminals.map(t => t.id));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function createTerminal(name, skipLayoutUpdate = false) {
  const id = _nextTerminalId();
  const termName = name || `Terminal ${id}`;

  const containerView = new window.View('div')
    .className('term-pane')
    .attr('data-term-id', id)
    .cssText('width:100%;height:100%;position:relative;');
  const container = containerView.el;

  const theme = TERMINAL_THEMES[_termSettings.theme] || TERMINAL_THEMES.dark;
  const term = new Terminal({
    cursorBlink: _termSettings.cursorBlink,
    cursorStyle: _termSettings.cursorStyle,
    fontSize: _termSettings.fontSize,
    fontFamily: _termSettings.fontFamily,
    scrollback: _termSettings.scrollback,
    theme: theme,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  let searchAddon = null;
  if (typeof SearchAddon !== 'undefined') {
    searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(searchAddon);
  }

  const termObj = {
    id,
    name: termName,
    ws: null,
    term,
    fitAddon,
    searchAddon,
    container,
  };

  _terminals.push(termObj);

  if (!skipLayoutUpdate) {
    // If this is the first terminal or no layout exists, create simple layout
    if (!_terminalLayout) {
      _terminalLayout = { type: 'terminal', terminalId: id };
    }
    // For additional tabs (not splits), we keep the layout pointing to the new terminal
    // The old terminals remain in _terminals array for the tab bar

    _activeTerminalId = id;
    _renderTabs();
    _renderLayout();
    _saveTerminalState();
  }

  return termObj;
}

export function destroyTerminal(id) {
  const idx = _terminals.findIndex(t => t.id === id);
  if (idx === -1) return;

  const t = _terminals[idx];
  if (t.ws) {
    if (typeof t.ws === 'string' && window.electronAPI && window.electronAPI.terminalKill) {
      // IPC mode — t.ws is a session ID
      try { window.electronAPI.terminalKill(t.ws); } catch (_) {}
    } else if (t.ws.close) {
      // WebSocket mode
      try { t.ws.close(); } catch (_) {}
    }
  }
  if (t.term) {
    t.term.dispose();
  }
  if (t.container && t.container.parentNode) {
    t.container.parentNode.removeChild(t.container);
  }

  _terminals.splice(idx, 1);

  // Remove from layout
  _removeFromLayout(id);

  // Select another terminal if needed
  if (_activeTerminalId === id) {
    _activeTerminalId = _terminals.length > 0 ? _terminals[0].id : null;
  }

  if (_terminals.length === 0) {
    _terminalLayout = null;
  }

  _renderTabs();
  _renderLayout();

  // Update bottom panel if visible
  if (_bottomTerminalVisible) {
    _renderBottomTerminalTabs();
    if (_activeTerminalId) _renderBottomTerminalPane();
  }

  _saveTerminalState();
}

export function _removeFromLayout(termId) {
  if (!_terminalLayout) return;

  function remove(node, parent, key) {
    if (node.type === 'terminal') {
      if (node.terminalId === termId) {
        if (!parent) {
          _terminalLayout = _terminals.length > 0
            ? { type: 'terminal', terminalId: _terminals[0].id }
            : null;
        } else {
          // Replace parent split with sibling
          const siblingIdx = key === 0 ? 1 : 0;
          Object.assign(parent, parent.children[siblingIdx]);
          delete parent.children;
          delete parent.direction;
          delete parent.ratio;
        }
        return true;
      }
      return false;
    }
    if (node.type === 'split') {
      for (let i = 0; i < node.children.length; i++) {
        if (remove(node.children[i], node, i)) return true;
      }
    }
    return false;
  }

  remove(_terminalLayout, null, null);
}

export function selectTerminal(id) {
  const t = _terminals.find(t => t.id === id);
  if (!t) return;

  _activeTerminalId = id;
  _renderTabs();

  // Update bottom panel if visible
  if (_bottomTerminalVisible) {
    _renderBottomTerminalTabs();
    _renderBottomTerminalPane();
  }

  // Focus the terminal
  setTimeout(() => {
    t.term.focus();
    t.fitAddon.fit();
  }, 10);

  _saveTerminalState();
}

export function renameTerminal(id, name) {
  const t = _terminals.find(t => t.id === id);
  if (t) {
    t.name = name;
    _renderTabs();
    _saveTerminalState();
  }
}

export function _renderTabs() {
  const tabsEl = document.getElementById('vault-terminal-tabs') || document.getElementById('terminal-tabs');
  _buildTabBar(tabsEl, (id) => selectTerminal(id), () => createTerminal());
  // Add double-click rename to titles in the full tab bar
  if (tabsEl) {
    tabsEl.querySelectorAll('.term-tab-title').forEach(el => {
      const id = parseInt(el.parentElement.getAttribute('data-term-id'), 10);
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); _startRenameTab(id); });
    });
  }
}

export function _startRenameTab(id) {
  const t = _terminals.find(t => t.id === id);
  if (!t) return;

  const tabEl = document.querySelector(`.term-tab[data-term-id="${id}"] .term-tab-title`);
  if (!tabEl) return;

  const inputView = new window.View('input')
    .className('term-tab-rename-input')
    .attr('type', 'text')
    .cssText('width:80px;background:var(--nr-bg-input);border:1px solid var(--nr-accent);border-radius:3px;padding:1px 4px;font-size:0.75rem;color:var(--nr-text-primary);outline:none;');
  const input = inputView.el;
  input.value = t.name;

  const finish = () => {
    const newName = input.value.trim() || t.name;
    renameTerminal(id, newName);
  };

  inputView.on('blur', finish);
  inputView.on('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = t.name; input.blur(); }
  });

  tabEl.innerHTML = '';
  tabEl.appendChild(input);
  input.focus();
  input.select();
}

export function _renderLayout() {
  const container = document.getElementById('vault-terminal-panes') || document.getElementById('terminal-panes-container');
  if (!container) return;

  container.innerHTML = '';

  if (!_terminalLayout || _terminals.length === 0) {
    container.style.background = '#0d0d0d';
    return;
  }

  const theme = TERMINAL_THEMES[_termSettings.theme] || TERMINAL_THEMES.dark;
  container.style.background = theme.background;

  function render(node, parentEl) {
    if (node.type === 'terminal') {
      const t = _terminals.find(t => t.id === node.terminalId);
      if (!t) return;
      _initTerminalPane(t, parentEl);
      t.container.classList.toggle('term-pane-active', t.id === _activeTerminalId);
      t.container.addEventListener('click', () => {
        if (_activeTerminalId !== t.id) selectTerminal(t.id);
      });
      return;
    }

    if (node.type === 'split') {
      const wrapper = new window.View('div').className('term-split');
      wrapper.cssText('display:flex;flex-direction:' + (node.direction === 'horizontal' ? 'column' : 'row') + ';width:100%;height:100%;');

      const ratio = node.ratio || 0.5;

      const pane1 = new window.View('div').className('term-split-pane');
      pane1.cssText(node.direction === 'horizontal'
        ? 'height:' + (ratio * 100) + '%;width:100%;overflow:hidden;'
        : 'width:' + (ratio * 100) + '%;height:100%;overflow:hidden;');

      const handle = new window.View('div').className('term-split-handle');
      handle.cssText(node.direction === 'horizontal'
        ? 'height:4px;width:100%;cursor:row-resize;background:var(--nr-border-dim);flex-shrink:0;'
        : 'width:4px;height:100%;cursor:col-resize;background:var(--nr-border-dim);flex-shrink:0;');
      _initSplitResize(handle.el, node, pane1.el);

      const pane2 = new window.View('div').className('term-split-pane');
      pane2.cssText(node.direction === 'horizontal'
        ? 'height:' + ((1 - ratio) * 100) + '%;width:100%;overflow:hidden;'
        : 'width:' + ((1 - ratio) * 100) + '%;height:100%;overflow:hidden;');

      wrapper.add(pane1, handle, pane2);
      parentEl.appendChild(wrapper.el);

      render(node.children[0], pane1.el);
      render(node.children[1], pane2.el);
    }
  }

  render(_terminalLayout, container);
}

export function _initSplitResize(handle, node, pane1) {
  let startPos = 0;
  let startRatio = node.ratio || 0.5;

  const onMove = (e) => {
    const container = document.getElementById('vault-terminal-panes') || document.getElementById('terminal-panes-container');
    const rect = container.getBoundingClientRect();
    const clientPos = node.direction === 'horizontal' ? e.clientY : e.clientX;
    const size = node.direction === 'horizontal' ? rect.height : rect.width;
    const offset = clientPos - (node.direction === 'horizontal' ? rect.top : rect.left);
    const newRatio = Math.max(0.1, Math.min(0.9, offset / size));

    node.ratio = newRatio;
    pane1.style[node.direction === 'horizontal' ? 'height' : 'width'] = `${newRatio * 100}%`;
    pane1.nextElementSibling.nextElementSibling.style[node.direction === 'horizontal' ? 'height' : 'width'] = `${(1 - newRatio) * 100}%`;

    // Refit terminals
    _terminals.forEach(t => {
      try { t.fitAddon.fit(); } catch (_) {}
    });
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    _saveTerminalState();
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startPos = node.direction === 'horizontal' ? e.clientY : e.clientX;
    startRatio = node.ratio || 0.5;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function splitTerminal(direction) {
  if (!_activeTerminalId) return;

  const activeT = _activeTerminal();
  if (!activeT) return;

  // Create new terminal without modifying layout
  const newT = createTerminal(null, true);

  // Find active terminal in layout and wrap in split
  function findAndSplit(node, parent, key) {
    if (node.type === 'terminal' && node.terminalId === activeT.id) {
      const newNode = {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'terminal', terminalId: activeT.id },
          { type: 'terminal', terminalId: newT.id },
        ],
      };
      if (!parent) {
        _terminalLayout = newNode;
      } else {
        parent.children[key] = newNode;
      }
      return true;
    }
    if (node.type === 'split') {
      for (let i = 0; i < node.children.length; i++) {
        if (findAndSplit(node.children[i], node, i)) return true;
      }
    }
    return false;
  }

  findAndSplit(_terminalLayout, null, null);

  // Select the new terminal in the split
  _activeTerminalId = newT.id;
  _renderTabs();
  _renderLayout();
  _saveTerminalState();
}

/** Send input data to terminal (IPC or WebSocket) */
export function _terminalSendInput(t, data) {
  if (typeof t.ws === 'string' && window.electronAPI && window.electronAPI.terminalInput) {
    window.electronAPI.terminalInput(t.ws, data);
  } else if (t.ws && t.ws.readyState === WebSocket.OPEN) {
    t.ws.send(data);
  }
}

/** Send resize to terminal (IPC or WebSocket) */
export function _terminalSendResize(t, cols, rows) {
  if (typeof t.ws === 'string' && window.electronAPI && window.electronAPI.terminalResize) {
    window.electronAPI.terminalResize(t.ws, cols, rows);
  } else if (t.ws && t.ws.readyState === WebSocket.OPEN) {
    t.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

export function _connectTerminalWs(t, cwd) {
  // Clean up previous session
  if (t.ws) {
    // t.ws is now the IPC session ID (string), not a WebSocket
    try { window.electronAPI.terminalKill(t.ws); } catch (_) {}
  }
  if (t._onDataDisposable) {
    try { t._onDataDisposable.dispose(); } catch (_) {}
  }

  if (window.electronAPI && window.electronAPI.terminalStart) {
    // IPC mode (Electron) — use node-pty via main process
    _connectTerminalIpc(t, cwd);
  } else {
    // Fallback: WebSocket mode (should not be needed after migration)
    _connectTerminalWsFallback(t, cwd);
  }
}

export async function _connectTerminalIpc(t, cwd) {
  console.debug(`terminal ${t.id} connecting via IPC, cwd=${cwd}`);

  try {
    const result = await window.electronAPI.terminalStart({ sandboxed: true });
    if (result.error) {
      if (t.term) t.term.write(`\r\n\x1b[91m[error: ${result.error}]\x1b[0m\r\n`);
      return;
    }

    const sessionId = result.sessionId;
    t.ws = sessionId;

    // Listen for output from main process
    const onOutput = (_event, id, data) => {
      if (id === sessionId && t.term) {
        t.term.write(data);
      }
    };
    const onExit = (_event, id, exitCode) => {
      if (id === sessionId && t.term) {
        t.term.write(`\r\n\x1b[90m[exited with code ${exitCode}]\x1b[0m\r\n`);
      }
      if (window.electronAPI.removeTerminalListeners) {
        window.electronAPI.removeTerminalListeners(sessionId);
      }
    };

    window.electronAPI.onTerminalOutput(onOutput);
    window.electronAPI.onTerminalExit(onExit);
    t._ipcOutputListener = onOutput;
    t._ipcExitListener = onExit;

    // Send initial resize
    t.fitAddon.fit();
    const { cols, rows } = t.term;
    window.electronAPI.terminalResize(sessionId, cols, rows);

    // Forward user input to main process
    t._onDataDisposable = t.term.onData((data) => {
      window.electronAPI.terminalInput(sessionId, data);
    });

    // Forward resize events
    t._onResizeDisposable = t.term.onResize(({ cols, rows }) => {
      window.electronAPI.terminalResize(sessionId, cols, rows);
    });

    console.debug(`terminal ${t.id} connected, session=${sessionId}`);
  } catch (err) {
    console.error(`terminal ${t.id} IPC connect failed`, err);
    if (t.term) t.term.write(`\r\n\x1b[91m[connection failed]\x1b[0m\r\n`);
  }
}

export function _connectTerminalWsFallback(t, cwd) {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}/ws/terminal` + (cwd ? '?cwd=' + encodeURIComponent(cwd) : '');
  console.debug(`terminal ${t.id} connecting to`, wsUrl);

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  t.ws = ws;

  ws.onopen = () => {
    console.debug(`terminal ${t.id} ws open`);
    t.fitAddon.fit();
    const { cols, rows } = t.term;
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };

  ws.onmessage = (ev) => {
    if (!t.term) return;
    if (ev.data instanceof ArrayBuffer) {
      t.term.write(new Uint8Array(ev.data));
    } else {
      t.term.write(ev.data);
    }
  };

  ws.onerror = (e) => {
    console.error(`terminal ${t.id} ws error`, e);
  };

  ws.onclose = (ev) => {
    console.debug(`terminal ${t.id} ws close`, ev.code, ev.reason);
    if (t.term) t.term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
  };

  t._onDataDisposable = t.term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// Tab navigation
export function nextTerminalTab() {
  if (_terminals.length < 2) return;
  const idx = _terminals.findIndex(t => t.id === _activeTerminalId);
  const nextIdx = (idx + 1) % _terminals.length;
  selectTerminal(_terminals[nextIdx].id);
}

export function prevTerminalTab() {
  if (_terminals.length < 2) return;
  const idx = _terminals.findIndex(t => t.id === _activeTerminalId);
  const prevIdx = (idx - 1 + _terminals.length) % _terminals.length;
  selectTerminal(_terminals[prevIdx].id);
}

export function selectTerminalByIndex(n) {
  if (n < 1 || n > _terminals.length) return;
  selectTerminal(_terminals[n - 1].id);
}

// Actions
export function clearTerminal() {
  const t = _activeTerminal();
  if (t?.term) t.term.clear();
}

export function copyTerminal() {
  const t = _activeTerminal();
  const sel = t?.term?.getSelection();
  if (sel) {
    navigator.clipboard.writeText(sel).then(() => {
      if (window.AetherCursor?.pulse) AetherCursor.pulse('#3b82f6');
    }).catch(() => {});
  }
}

export async function pasteTerminal() {
  const t = _activeTerminal();
  if (t?.ws) {
    try {
      const text = await navigator.clipboard.readText();
      _terminalSendInput(t, text);
    } catch (_) {}
  }
}

// Search
function _searchInput() {
  return document.getElementById('vault-term-search-input') || document.getElementById('term-search-input');
}

export function _debounceTermSearch() {
  clearTimeout(_termSearchTimeout);
  _termSearchTimeout = setTimeout(() => terminalSearch(_searchInput()?.value || ''), 300);
}

export function terminalSearch(query) {
  const t = _activeTerminal();
  if (!t?.searchAddon) return;
  if (!query) {
    t.searchAddon.clearDecorations();
    return;
  }
  t.searchAddon.findNext(query, { decorations: { matchOverviewRuler: true } });
}

export function terminalSearchNext() {
  const t = _activeTerminal();
  const query = _searchInput()?.value || '';
  if (t?.searchAddon && query) t.searchAddon.findNext(query);
}

export function terminalSearchPrev() {
  const t = _activeTerminal();
  const query = _searchInput()?.value || '';
  if (t?.searchAddon && query) t.searchAddon.findPrevious(query);
}

export function clearTerminalSearch() {
  const input = _searchInput();
  if (input) { input.value = ''; input.blur(); }
  _activeTerminal()?.searchAddon?.clearDecorations();
}

// Settings
export function toggleTerminalSettings() {
  const dropdown = document.getElementById('vault-term-settings-dropdown') || document.getElementById('term-settings-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

export function _applyTerminalSettingsUI() {
  const themeSelect = document.getElementById('vault-term-theme-select') || document.getElementById('term-theme-select');
  const fontSlider = document.getElementById('vault-term-fontsize-slider') || document.getElementById('term-fontsize-slider');
  const fontValue = document.getElementById('vault-term-fontsize-value') || document.getElementById('term-fontsize-value');

  if (themeSelect) themeSelect.value = _termSettings.theme;
  if (fontSlider) fontSlider.value = _termSettings.fontSize;
  if (fontValue) fontValue.textContent = _termSettings.fontSize;
}

export function applyTerminalTheme(themeName) {
  _termSettings.theme = themeName;
  const theme = TERMINAL_THEMES[themeName] || TERMINAL_THEMES.dark;

  _terminals.forEach(t => {
    t.term.options.theme = theme;
  });

  const container = document.getElementById('vault-terminal-panes') || document.getElementById('terminal-panes-container');
  if (container) container.style.background = theme.background;
  const bottomContainer = document.getElementById('bottom-terminal-container');
  if (bottomContainer) bottomContainer.style.background = theme.background;

  _saveTerminalState();
}

export function applyTerminalFontSize(size) {
  _termSettings.fontSize = parseInt(size, 10);
  const fontValue = document.getElementById('term-fontsize-value');
  if (fontValue) fontValue.textContent = size;

  _terminals.forEach(t => {
    t.term.options.fontSize = _termSettings.fontSize;
    t.fitAddon.fit();
  });

  _saveTerminalState();
}

// Persistence
export function _saveTerminalState() {
  const state = {
    settings: _termSettings,
    tabs: _terminals.map(t => ({ id: t.id, name: t.name })),
    activeId: _activeTerminalId,
    layout: _terminalLayout,
  };
  try {
    Settings.setJSON('terminalState', state);
  } catch (_) {}
}

export function _loadTerminalState() {
  try {
    const state = Settings.getJSON('terminalState', null);
    if (!state) return;
    if (state.settings) {
      _termSettings = { ..._termSettings, ...state.settings };
    }
    // Note: We don't restore tabs/layout on load because WebSocket sessions don't persist
    // User will need to create new terminals after page reload
  } catch (_) {}
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Only handle if vault terminal mode is active
  if (typeof _vaultTerminalMode === 'undefined' || !_vaultTerminalMode) return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? e.metaKey : e.ctrlKey;

  if (cmdKey && e.key === 't') {
    e.preventDefault();
    createTerminal();
  } else if (cmdKey && e.key === 'w') {
    e.preventDefault();
    if (_activeTerminalId && _terminals.length > 1) {
      destroyTerminal(_activeTerminalId);
    }
  } else if (cmdKey && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    splitTerminal('horizontal');
  } else if (cmdKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    splitTerminal('vertical');
  } else if (cmdKey && e.key === ']') {
    e.preventDefault();
    nextTerminalTab();
  } else if (cmdKey && e.key === '[') {
    e.preventDefault();
    prevTerminalTab();
  } else if (cmdKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    selectTerminalByIndex(parseInt(e.key, 10));
  } else if (cmdKey && e.key === 'f') {
    e.preventDefault();
    const input = document.getElementById('vault-term-search-input') || document.getElementById('term-search-input');
    if (input) input.focus();
  } else if (cmdKey && e.key === 'k') {
    e.preventDefault();
    clearTerminal();
  } else if (e.key === 'Escape') {
    clearTerminalSearch();
  }
});

// Close settings dropdown when clicking outside
document.addEventListener('click', (e) => {
  const settingsBtn = e.target.closest('[onclick*="toggleTerminalSettings"]');
  [document.getElementById('vault-term-settings-dropdown'), document.getElementById('term-settings-dropdown')].forEach(dropdown => {
    if (dropdown && !dropdown.contains(e.target) && !settingsBtn) {
      dropdown.classList.add('hidden');
    }
  });
});

// ── Bottom Terminal Panel (Cmd+J) — shares terminals with the full terminal tab ──

export let _bottomTerminalVisible = false;

export function toggleBottomTerminal() {
  const panel = document.getElementById('bottom-terminal-panel');
  if (!panel) return;

  _bottomTerminalVisible = !_bottomTerminalVisible;

  if (_bottomTerminalVisible) {
    panel.style.display = 'flex';
    _showBottomTerminal();
  } else {
    panel.style.display = 'none';
    _activeTerminal()?.term?.blur();
  }
}

export function _showBottomTerminal() {
  _loadTerminalState();

  // Create first terminal if none exist
  if (_terminals.length === 0) {
    createTerminal();
  } else {
    // Reconnect any closed WebSockets
    _terminals.forEach(t => {
      if (!t.ws || t.ws.readyState !== WebSocket.OPEN) {
        _connectTerminalWs(t);
      }
    });
  }

  _renderBottomTerminalTabs();
  _renderBottomTerminalPane();
}

/** Shared tab bar builder for both full-page and bottom panel */
function _buildTabBar(tabsEl, onSelect, onNew, showClose) {
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  _terminals.forEach(function(t) {
    const tabSvg = icon('terminal', {size: 12, class: 'shrink-0 text-dimmer', strokeWidth: '1.5'});
    const tab = new window.View('div').className('term-tab' + (t.id === _activeTerminalId ? ' active' : ''));
    tab.attr('data-term-id', t.id);
    tab.onTap(function() { onSelect(t.id); });
    const title = window.Text(t.name).className('term-tab-title');
    tab.add(window.RawHTML(tabSvg), title);
    if (showClose !== false && _terminals.length > 1) {
      const closeBtn = window.Button('\u00d7').className('term-tab-close').attr('title', 'Close');
      closeBtn.onTap(function(e) { e.stopPropagation(); destroyTerminal(t.id); });
      tab.add(closeBtn);
    }
    tabsEl.appendChild(tab.el);
  });
  const newBtn = window.Button('+').className('term-tab-new').attr('title', 'New Tab');
  newBtn.onTap(function() { onNew(); });
  tabsEl.appendChild(newBtn.el);
}

export function _renderBottomTerminalTabs() {
  _buildTabBar(
    document.getElementById('bottom-terminal-tabs'),
    (id) => _bottomSelectTerminal(id),
    () => { createTerminal(); _renderBottomTerminalTabs(); _renderBottomTerminalPane(); }
  );
}

export function _bottomSelectTerminal(id) {
  _activeTerminalId = id;
  _renderBottomTerminalTabs();
  _renderBottomTerminalPane();
  _saveTerminalState();
}

export function _renderBottomTerminalPane() {
  _mountTerminalInto(document.getElementById('bottom-terminal-container'));
}

export function clearBottomTerminal() {
  clearTerminal();
}

// Bottom terminal resize handle
(function initBottomTerminalResize() {
  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('bottom-terminal-resize');
    const panel = document.getElementById('bottom-terminal-panel');
    if (!handle || !panel) return;

    let startY = 0;
    let startHeight = 0;

    const onMove = (e) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight - 100, startHeight + delta));
      panel.style.height = newHeight + 'px';
      try { _activeTerminal()?.fitAddon?.fit(); } catch (_) {}
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = panel.offsetHeight;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();

// Global Cmd+J shortcut (works from anywhere except the full terminal tab)
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? e.metaKey : e.ctrlKey;

  if (cmdKey && e.key === 'j') {
    // Don't toggle bottom panel when vault terminal mode is active — they share the same terminals
    if (typeof _vaultTerminalMode !== 'undefined' && _vaultTerminalMode) return;
    // Don't toggle on vibe page — it has its own embedded terminals
    if (window.location.hash === '#vibe') { e.preventDefault(); return; }
    e.preventDefault();
    toggleBottomTerminal();
  }
});

// ── Action registry ──
registerActions({
  clearBottomTerminal: () => clearBottomTerminal(),
  toggleBottomTerminal: () => toggleBottomTerminal(),
});
window.toggleBottomTerminal = toggleBottomTerminal;

