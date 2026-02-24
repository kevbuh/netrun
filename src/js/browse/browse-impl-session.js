// browse-impl-session.js — Implementation session workspace for Nerd Mode
// Spawns a coding CLI agent (claude/opencode) in a terminal with a live file tree
// Depends on: browse-nerd-mode.js, browse-nerd-panel.js
import { icon } from '/js/core/icons.js';
import { _paperState, _extractArxivId } from '/js/browse/browse-paper.js';
import { View } from '/aether/ui/aether-ui.js';

// ── Per-tab state ──
// tab._implSessionId, tab._implFolderPath, tab._implTermId, tab._implWorkspaceEl

// ── Public API ──

export function _implSessionEnable(tab, sessionId) {
  if (!tab) return;
  if (sessionId) {
    _resumeSession(tab, sessionId);
  } else {
    _createSession(tab);
  }
}

export function _implSessionDisable(tab) {
  if (!tab) return;
  _teardownWorkspace(tab);
}

export function _isImplSessionActive(tabId) {
  var win = window._getCurrentWindow();
  if (!win) return false;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  return !!(tab && tab._implSessionId);
}

// ── Create new session ──

function _createSession(tab) {
  var state = _paperState.get(tab.id);
  var s2 = state ? state.s2Data : null;
  var title = (s2 && s2.title) || tab.title || 'Paper';
  var abstract = (s2 && s2.abstract) || '';
  var url = tab.url || '';

  console.log('[impl] creating session, implCreate available:', typeof electronAPI.implCreate);
  if (!electronAPI.implCreate) {
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('implCreate not available — rebuild & restart needed');
    return;
  }
  electronAPI.implCreate({
    paperUrl: url,
    paperTitle: title,
    paperAbstract: abstract,
    agentType: 'claude'
  }).then(function(result) {
    console.log('[impl] create result:', result);
    if (result.error) {
      if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Failed to create session: ' + result.error);
      return;
    }
    tab._implSessionId = result.id;
    tab._implFolderPath = result.folderPath;
    _buildWorkspace(tab);
  });
}

// ── Resume existing session ──

function _resumeSession(tab, sessionId) {
  electronAPI.implGet(sessionId).then(function(session) {
    if (!session || session.error) {
      if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Session not found');
      return;
    }
    tab._implSessionId = session.id;
    tab._implFolderPath = session.folder_path;
    _buildWorkspace(tab);
  });
}

// ── Build workspace UI ──

function _buildWorkspace(tab) {
  var container = document.getElementById('browse-content');
  if (!container) return;

  // Hide PDF viewer and webview
  if (tab._nerdViewerEl) tab._nerdViewerEl.style.display = 'none';
  if (tab.el) tab.el.style.display = 'none';

  // Create workspace
  var workspace = new View('div').className('impl-workspace').id('impl-workspace-' + tab.id);

  // Toolbar
  var toolbar = new View('div').className('impl-toolbar');

  var backBtn = new View('button').className('impl-toolbar-btn').add(
    RawHTML(icon('chevronLeft', { size: 12 })),
    Text('Back to Paper')
  ).onTap(function() {
    _implSessionDisable(tab);
    // Restore PDF viewer
    if (tab._nerdViewerEl) tab._nerdViewerEl.style.display = 'flex';
    if (tab.el) tab.el.style.display = 'none';
  });

  var titleView = Text(tab._implFolderPath ? tab._implFolderPath.split('/').pop() : 'Implementation').className('impl-toolbar-title');

  toolbar.add(backBtn, titleView);
  workspace.add(toolbar);

  // Body: file tree + preview area
  var body = new View('div').className('impl-body');

  // File tree
  var fileTree = new View('div').className('impl-file-tree');
  body.add(fileTree);

  workspace.add(body);
  container.appendChild(workspace.el);
  tab._implWorkspaceEl = workspace.el;

  // Initialize file tree
  _refreshFileTree(tab, fileTree.el);

  // Start file watcher
  _startWatcher(tab, fileTree.el);
}

// ── Terminal ──

export function _startTerminal(tab, container) {
  if (!window.Terminal) {
    // xterm.js not loaded yet, retry
    setTimeout(function() { _startTerminal(tab, container); }, 500);
    return;
  }

  electronAPI.terminalStart(tab._implFolderPath).then(function(result) {
    if (result.error) {
      container.textContent = 'Failed to start terminal: ' + result.error;
      return;
    }

    var sessionId = result.sessionId;
    tab._implTermId = sessionId;

    var term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: 'rgba(255,255,255,0.15)'
      },
      cursorBlink: true,
      allowProposedApi: true
    });

    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Fit after a frame
    requestAnimationFrame(function() {
      fitAddon.fit();
      electronAPI.terminalResize(sessionId, term.cols, term.rows);
    });

    // Resize observer
    var resizeObs = new ResizeObserver(function() {
      try {
        fitAddon.fit();
        electronAPI.terminalResize(sessionId, term.cols, term.rows);
      } catch (e) { /* ignore */ }
    });
    resizeObs.observe(container);
    tab._implResizeObs = resizeObs;

    // I/O
    term.onData(function(data) {
      electronAPI.terminalInput(sessionId, data);
    });

    var outputHandler = function(_ev, sid, data) {
      if (sid === sessionId) term.write(data);
    };
    electronAPI.onTerminalOutput(outputHandler);
    tab._implOutputHandler = outputHandler;

    var exitHandler = function(_ev, sid) {
      if (sid === sessionId) {
        term.write('\r\n\x1b[90m[Session ended]\x1b[0m\r\n');
      }
    };
    electronAPI.onTerminalExit(exitHandler);
    tab._implExitHandler = exitHandler;

    tab._implTerm = term;
  });
}

// ── File Tree ──

function _refreshFileTree(tab, container) {
  if (!tab._implFolderPath) return;

  electronAPI.implReadTree(tab._implFolderPath).then(function(tree) {
    if (!tree || tree.error) return;

    // Clear
    while (container.firstChild) container.removeChild(container.firstChild);

    _renderTreeNodes(tab, container, tree, 0, '');
  });
}

function _setTreeActive(treeContainer, activeRow) {
  var rows = treeContainer.querySelectorAll('.impl-tree-row');
  for (var i = 0; i < rows.length; i++) rows[i].classList.remove('active');
  if (activeRow) activeRow.classList.add('active');
}

function _renderTreeNodes(tab, container, nodes, depth, parentPath) {
  nodes.forEach(function(node) {
    var relativePath = parentPath ? parentPath + '/' + node.name : node.name;
    var row = document.createElement('div');
    row.className = 'impl-tree-row';
    row.style.paddingLeft = (8 + depth * 14) + 'px';

    var iconEl = document.createElement('span');
    iconEl.className = 'impl-tree-icon';
    iconEl.textContent = node.type === 'dir' ? '\u25B6' : '\u25CB';
    row.appendChild(iconEl);

    var nameEl = document.createElement('span');
    nameEl.className = 'impl-tree-name';
    nameEl.textContent = node.name;
    row.appendChild(nameEl);

    if (node.type === 'file') {
      row.addEventListener('click', function() {
        _previewFile(tab, relativePath, node.name);
        // Find the tree root container and update active state
        var treeRoot = row.closest('.impl-file-tree');
        if (treeRoot) _setTreeActive(treeRoot, row);
      });
    }

    container.appendChild(row);

    // Render children inline for dirs (expanded by default)
    if (node.type === 'dir' && node.children && node.children.length) {
      var expanded = true;
      var childContainer = document.createElement('div');
      _renderTreeNodes(tab, childContainer, node.children, depth + 1, relativePath);
      container.appendChild(childContainer);

      // Toggle on click
      row.addEventListener('click', function() {
        expanded = !expanded;
        childContainer.style.display = expanded ? '' : 'none';
        iconEl.textContent = expanded ? '\u25BC' : '\u25B6';
      });
      iconEl.textContent = '\u25BC';
    }
  });
}

// ── File Preview ──

function _previewFile(tab, relativePath, fileName) {
  if (!tab._implFolderPath) return;

  // Remove existing preview
  _closePreview(tab);

  electronAPI.implReadFile(tab._implFolderPath, relativePath).then(function(result) {
    if (!result || result.error) {
      if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast(result ? result.error : 'Failed to read file');
      return;
    }

    // Hide terminal, show preview in its place
    var termEl = tab._implWorkspaceEl ? tab._implWorkspaceEl.querySelector('.impl-terminal') : null;
    var body = tab._implWorkspaceEl ? tab._implWorkspaceEl.querySelector('.impl-body') : null;
    if (!body) return;
    if (termEl) termEl.style.display = 'none';

    var preview = new View('div').className('impl-preview');

    var header = new View('div').className('impl-preview-header').add(
      Text(fileName).className('impl-preview-title'),
      new View('button').className('impl-preview-close').text('\u00d7').onTap(function() {
        _closePreview(tab);
      })
    );

    var content = new View('pre').className('impl-preview-content').text(result.content);

    preview.add(header, content);
    body.appendChild(preview.el);
    tab._implPreviewEl = preview.el;
  });
}

function _closePreview(tab) {
  if (tab._implPreviewEl) {
    tab._implPreviewEl.remove();
    tab._implPreviewEl = null;
  }
  // Restore terminal
  var termEl = tab._implWorkspaceEl ? tab._implWorkspaceEl.querySelector('.impl-terminal') : null;
  if (termEl) termEl.style.display = '';
}

// ── File Watcher ──

function _startWatcher(tab, fileTreeEl) {
  if (!tab._implSessionId || !tab._implFolderPath) return;

  electronAPI.implWatchStart(tab._implSessionId, tab._implFolderPath);

  var debounce = null;
  var handler = function(_ev, sid) {
    if (sid !== tab._implSessionId) return;
    clearTimeout(debounce);
    debounce = setTimeout(function() {
      _refreshFileTree(tab, fileTreeEl);
    }, 500);
  };
  electronAPI.onImplFileChanged(handler);
  tab._implFileHandler = handler;
}

// ── Teardown ──

function _teardownWorkspace(tab) {
  // Stop watcher
  if (tab._implSessionId) {
    electronAPI.implWatchStop(tab._implSessionId);
  }

  // Kill terminal
  if (tab._implTermId) {
    electronAPI.terminalKill(tab._implTermId);
    tab._implTermId = null;
  }

  // Dispose xterm
  if (tab._implTerm) {
    tab._implTerm.dispose();
    tab._implTerm = null;
  }

  // Remove resize observer
  if (tab._implResizeObs) {
    tab._implResizeObs.disconnect();
    tab._implResizeObs = null;
  }

  // Remove IPC listeners
  if (tab._implOutputHandler || tab._implExitHandler) {
    electronAPI.removeTerminalListeners();
    tab._implOutputHandler = null;
    tab._implExitHandler = null;
  }
  if (tab._implFileHandler) {
    electronAPI.removeImplFileListeners();
    tab._implFileHandler = null;
  }

  // Remove workspace element
  if (tab._implWorkspaceEl) {
    tab._implWorkspaceEl.remove();
    tab._implWorkspaceEl = null;
  }

  // Close preview
  _closePreview(tab);

  // Clear state (keep sessionId for resuming)
  tab._implFolderPath = null;
}

// ── Window bridge ──
console.log('[impl-session] module loaded successfully');
window._implSessionEnable = _implSessionEnable;
window._implSessionDisable = _implSessionDisable;
window._isImplSessionActive = _isImplSessionActive;
