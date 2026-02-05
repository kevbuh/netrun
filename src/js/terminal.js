// ── Terminal View (Multi-tab, Split Panes, Search, Themes) ──

// Global state
let _terminals = [];
let _activeTerminalId = null;
let _terminalIdCounter = 0;
let _terminalLayout = null;
let _termSearchTimeout = null;

// Terminal themes
const TERMINAL_THEMES = {
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
let _termSettings = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'block',
};

function openTerminal() {
  setSidebarLoading('sb-terminal');
  hideAllViews();
  // Close bottom panel if open — terminals will be reparented to full view
  if (_bottomTerminalVisible) {
    _bottomTerminalVisible = false;
    const bp = document.getElementById('bottom-terminal-panel');
    if (bp) bp.style.display = 'none';
  }
  const view = document.getElementById('terminal-view');
  view.style.display = 'flex';
  view.classList.remove('hidden');
  setSidebarActive('sb-terminal');
  window.location.hash = '#terminal';

  _loadTerminalState();

  if (_terminals.length === 0) {
    createTerminal();
  } else {
    // Reconnect any closed WebSockets and refit
    _terminals.forEach(t => {
      if (!t.ws || t.ws.readyState !== WebSocket.OPEN) {
        _connectTerminalWs(t);
      }
      setTimeout(() => t.fitAddon && t.fitAddon.fit(), 50);
    });
  }

  _renderTabs();
  _renderLayout();
  _applyTerminalSettingsUI();
}

function createTerminal(name, skipLayoutUpdate = false) {
  const id = ++_terminalIdCounter;
  const termName = name || `Terminal ${id}`;

  const container = document.createElement('div');
  container.className = 'term-pane';
  container.dataset.termId = id;
  container.style.cssText = 'width:100%;height:100%;position:relative;';

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

function destroyTerminal(id) {
  const idx = _terminals.findIndex(t => t.id === id);
  if (idx === -1) return;

  const t = _terminals[idx];
  if (t.ws) {
    try { t.ws.close(); } catch (_) {}
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

function _removeFromLayout(termId) {
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

function selectTerminal(id) {
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

function renameTerminal(id, name) {
  const t = _terminals.find(t => t.id === id);
  if (t) {
    t.name = name;
    _renderTabs();
    _saveTerminalState();
  }
}

function _renderTabs() {
  const tabsEl = document.getElementById('terminal-tabs');
  if (!tabsEl) return;

  tabsEl.innerHTML = _terminals.map(t => `
    <div class="term-tab ${t.id === _activeTerminalId ? 'active' : ''}" data-term-id="${t.id}" onclick="selectTerminal(${t.id})">
      <svg class="w-3 h-3 shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3"/></svg>
      <span class="term-tab-title" ondblclick="event.stopPropagation();_startRenameTab(${t.id})">${_escapeHtml(t.name)}</span>
      <button class="term-tab-close" onclick="event.stopPropagation();destroyTerminal(${t.id})" title="Close">×</button>
    </div>
  `).join('') + `<button class="term-tab-new" onclick="createTerminal()" title="New Tab">+</button>`;
}

function _startRenameTab(id) {
  const t = _terminals.find(t => t.id === id);
  if (!t) return;

  const tabEl = document.querySelector(`.term-tab[data-term-id="${id}"] .term-tab-title`);
  if (!tabEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = t.name;
  input.className = 'term-tab-rename-input';
  input.style.cssText = 'width:80px;background:var(--bg-input);border:1px solid var(--accent);border-radius:3px;padding:1px 4px;font-size:0.75rem;color:var(--text-primary);outline:none;';

  const finish = () => {
    const newName = input.value.trim() || t.name;
    renameTerminal(id, newName);
  };

  input.onblur = finish;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = t.name; input.blur(); }
  };

  tabEl.innerHTML = '';
  tabEl.appendChild(input);
  input.focus();
  input.select();
}

function _renderLayout() {
  const container = document.getElementById('terminal-panes-container');
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

      const pane = t.container;
      pane.style.width = '100%';
      pane.style.height = '100%';
      pane.classList.toggle('term-pane-active', t.id === _activeTerminalId);
      parentEl.appendChild(pane);

      // Initialize terminal if not already
      if (!pane.querySelector('.xterm')) {
        t.term.open(pane);
        t.fitAddon.fit();

        // Connect WebSocket
        _connectTerminalWs(t);

        // Auto-fit on resize
        const ro = new ResizeObserver(() => {
          try { t.fitAddon.fit(); } catch (_) {}
        });
        ro.observe(pane);

        // Send resize to server
        t.term.onResize(({ cols, rows }) => {
          if (t.ws && t.ws.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        });

        // Focus on click
        pane.addEventListener('click', () => {
          if (_activeTerminalId !== t.id) {
            selectTerminal(t.id);
          }
        });
      } else {
        setTimeout(() => t.fitAddon.fit(), 10);
      }
      return;
    }

    if (node.type === 'split') {
      const wrapper = document.createElement('div');
      wrapper.className = 'term-split';
      wrapper.style.cssText = `display:flex;flex-direction:${node.direction === 'horizontal' ? 'column' : 'row'};width:100%;height:100%;`;

      const ratio = node.ratio || 0.5;

      const pane1 = document.createElement('div');
      pane1.className = 'term-split-pane';
      if (node.direction === 'horizontal') {
        pane1.style.cssText = `height:${ratio * 100}%;width:100%;overflow:hidden;`;
      } else {
        pane1.style.cssText = `width:${ratio * 100}%;height:100%;overflow:hidden;`;
      }

      const handle = document.createElement('div');
      handle.className = 'term-split-handle';
      handle.style.cssText = node.direction === 'horizontal'
        ? 'height:4px;width:100%;cursor:row-resize;background:var(--border-sidebar);flex-shrink:0;'
        : 'width:4px;height:100%;cursor:col-resize;background:var(--border-sidebar);flex-shrink:0;';
      _initSplitResize(handle, node, pane1);

      const pane2 = document.createElement('div');
      pane2.className = 'term-split-pane';
      if (node.direction === 'horizontal') {
        pane2.style.cssText = `height:${(1 - ratio) * 100}%;width:100%;overflow:hidden;`;
      } else {
        pane2.style.cssText = `width:${(1 - ratio) * 100}%;height:100%;overflow:hidden;`;
      }

      wrapper.appendChild(pane1);
      wrapper.appendChild(handle);
      wrapper.appendChild(pane2);
      parentEl.appendChild(wrapper);

      render(node.children[0], pane1);
      render(node.children[1], pane2);
    }
  }

  render(_terminalLayout, container);
}

function _initSplitResize(handle, node, pane1) {
  let startPos = 0;
  let startRatio = node.ratio || 0.5;

  const onMove = (e) => {
    const container = document.getElementById('terminal-panes-container');
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

function splitTerminal(direction) {
  if (!_activeTerminalId) return;

  const activeT = _terminals.find(t => t.id === _activeTerminalId);
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

function closeSplit() {
  // Close active terminal (will merge panes automatically)
  if (_activeTerminalId) {
    destroyTerminal(_activeTerminalId);
  }
}

function _connectTerminalWs(t) {
  if (t.ws) {
    try { t.ws.close(); } catch (_) {}
  }

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}/ws/terminal`;
  console.log(`[terminal ${t.id}] connecting to`, wsUrl);

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  t.ws = ws;

  ws.onopen = () => {
    console.log(`[terminal ${t.id}] ws open`);
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
    console.error(`[terminal ${t.id}] ws error`, e);
  };

  ws.onclose = (ev) => {
    console.log(`[terminal ${t.id}] ws close`, ev.code, ev.reason);
    if (t.term) t.term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
  };

  t.term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// Tab navigation
function nextTerminalTab() {
  if (_terminals.length < 2) return;
  const idx = _terminals.findIndex(t => t.id === _activeTerminalId);
  const nextIdx = (idx + 1) % _terminals.length;
  selectTerminal(_terminals[nextIdx].id);
}

function prevTerminalTab() {
  if (_terminals.length < 2) return;
  const idx = _terminals.findIndex(t => t.id === _activeTerminalId);
  const prevIdx = (idx - 1 + _terminals.length) % _terminals.length;
  selectTerminal(_terminals[prevIdx].id);
}

function selectTerminalByIndex(n) {
  if (n < 1 || n > _terminals.length) return;
  selectTerminal(_terminals[n - 1].id);
}

// Actions
function clearTerminal() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (t && t.term) {
    t.term.clear();
  }
}

function copyTerminal() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (t && t.term) {
    const sel = t.term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel);
    }
  }
}

async function pasteTerminal() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
    try {
      const text = await navigator.clipboard.readText();
      t.ws.send(text);
    } catch (_) {}
  }
}

// Search
function _debounceTermSearch() {
  clearTimeout(_termSearchTimeout);
  _termSearchTimeout = setTimeout(() => {
    const query = document.getElementById('term-search-input')?.value || '';
    terminalSearch(query);
  }, 300);
}

function terminalSearch(query) {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (!t || !t.searchAddon) return;

  const countEl = document.getElementById('term-search-count');
  if (!query) {
    t.searchAddon.clearDecorations();
    if (countEl) countEl.textContent = '';
    return;
  }

  t.searchAddon.findNext(query, { decorations: { matchOverviewRuler: true } });
}

function terminalSearchNext() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (!t || !t.searchAddon) return;
  const query = document.getElementById('term-search-input')?.value || '';
  if (query) t.searchAddon.findNext(query);
}

function terminalSearchPrev() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (!t || !t.searchAddon) return;
  const query = document.getElementById('term-search-input')?.value || '';
  if (query) t.searchAddon.findPrevious(query);
}

function clearTerminalSearch() {
  const input = document.getElementById('term-search-input');
  if (input) {
    input.value = '';
    input.blur();
  }
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (t && t.searchAddon) {
    t.searchAddon.clearDecorations();
  }
  document.getElementById('term-search-count').textContent = '';
}

// Settings
function toggleTerminalSettings() {
  const dropdown = document.getElementById('term-settings-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
  }
}

function _applyTerminalSettingsUI() {
  const themeSelect = document.getElementById('term-theme-select');
  const fontSlider = document.getElementById('term-fontsize-slider');
  const fontValue = document.getElementById('term-fontsize-value');

  if (themeSelect) themeSelect.value = _termSettings.theme;
  if (fontSlider) fontSlider.value = _termSettings.fontSize;
  if (fontValue) fontValue.textContent = _termSettings.fontSize;
}

function applyTerminalTheme(themeName) {
  _termSettings.theme = themeName;
  const theme = TERMINAL_THEMES[themeName] || TERMINAL_THEMES.dark;

  _terminals.forEach(t => {
    t.term.options.theme = theme;
  });

  const container = document.getElementById('terminal-panes-container');
  if (container) container.style.background = theme.background;
  const bottomContainer = document.getElementById('bottom-terminal-container');
  if (bottomContainer) bottomContainer.style.background = theme.background;

  _saveTerminalState();
}

function applyTerminalFontSize(size) {
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
function _saveTerminalState() {
  const state = {
    settings: _termSettings,
    tabs: _terminals.map(t => ({ id: t.id, name: t.name })),
    activeId: _activeTerminalId,
    layout: _terminalLayout,
    idCounter: _terminalIdCounter,
  };
  try {
    localStorage.setItem('terminalState', JSON.stringify(state));
  } catch (_) {}
}

function _loadTerminalState() {
  try {
    const raw = localStorage.getItem('terminalState');
    if (!raw) return;

    const state = JSON.parse(raw);
    if (state.settings) {
      _termSettings = { ..._termSettings, ...state.settings };
    }
    if (state.idCounter) {
      _terminalIdCounter = state.idCounter;
    }
    // Note: We don't restore tabs/layout on load because WebSocket sessions don't persist
    // User will need to create new terminals after page reload
  } catch (_) {}
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Only handle if terminal view is visible
  const view = document.getElementById('terminal-view');
  if (!view || view.style.display === 'none') return;

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
    const input = document.getElementById('term-search-input');
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
  const dropdown = document.getElementById('term-settings-dropdown');
  const settingsBtn = e.target.closest('[onclick*="toggleTerminalSettings"]');
  if (dropdown && !dropdown.contains(e.target) && !settingsBtn) {
    dropdown.classList.add('hidden');
  }
});

// Utility
function _escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bottom Terminal Panel (Cmd+J) — shares terminals with the full terminal tab ──

let _bottomTerminalVisible = false;

function toggleBottomTerminal() {
  const panel = document.getElementById('bottom-terminal-panel');
  if (!panel) return;

  _bottomTerminalVisible = !_bottomTerminalVisible;

  if (_bottomTerminalVisible) {
    panel.style.display = 'flex';
    _showBottomTerminal();
  } else {
    panel.style.display = 'none';
    const t = _terminals.find(t => t.id === _activeTerminalId);
    if (t && t.term) t.term.blur();
  }
}

function _showBottomTerminal() {
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

function _renderBottomTerminalTabs() {
  const tabsEl = document.getElementById('bottom-terminal-tabs');
  if (!tabsEl) return;

  tabsEl.innerHTML = _terminals.map(t => `
    <div class="term-tab ${t.id === _activeTerminalId ? 'active' : ''}" data-term-id="${t.id}" onclick="_bottomSelectTerminal(${t.id})">
      <svg class="w-3 h-3 shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3"/></svg>
      <span class="term-tab-title">${_escapeHtml(t.name)}</span>
      ${_terminals.length > 1 ? `<button class="term-tab-close" onclick="event.stopPropagation();destroyTerminal(${t.id});_renderBottomTerminalTabs();_renderBottomTerminalPane()" title="Close">×</button>` : ''}
    </div>
  `).join('') + `<button class="term-tab-new" onclick="createTerminal();_renderBottomTerminalTabs();_renderBottomTerminalPane()" title="New Tab">+</button>`;
}

function _bottomSelectTerminal(id) {
  _activeTerminalId = id;
  _renderBottomTerminalTabs();
  _renderBottomTerminalPane();
  _saveTerminalState();
}

function _renderBottomTerminalPane() {
  const container = document.getElementById('bottom-terminal-container');
  if (!container) return;

  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (!t) return;

  // Clear container but don't dispose — just move the pane
  container.innerHTML = '';

  const pane = t.container;
  pane.style.width = '100%';
  pane.style.height = '100%';
  container.appendChild(pane);

  if (!pane.querySelector('.xterm')) {
    t.term.open(pane);
    t.fitAddon.fit();
    _connectTerminalWs(t);

    const ro = new ResizeObserver(() => {
      try { t.fitAddon.fit(); } catch (_) {}
    });
    ro.observe(pane);

    t.term.onResize(({ cols, rows }) => {
      if (t.ws && t.ws.readyState === WebSocket.OPEN) {
        t.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  } else {
    setTimeout(() => {
      t.fitAddon.fit();
      t.term.focus();
    }, 50);
  }
}

function clearBottomTerminal() {
  const t = _terminals.find(t => t.id === _activeTerminalId);
  if (t && t.term) t.term.clear();
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
      const t = _terminals.find(t => t.id === _activeTerminalId);
      if (t && t.fitAddon) {
        try { t.fitAddon.fit(); } catch (_) {}
      }
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
    // Don't toggle bottom panel when full terminal view is open — they share the same terminals
    const view = document.getElementById('terminal-view');
    if (view && view.style.display !== 'none' && !view.classList.contains('hidden')) return;
    e.preventDefault();
    toggleBottomTerminal();
  }
});
