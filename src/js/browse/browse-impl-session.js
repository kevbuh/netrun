// browse-impl-session.js — Implementation session for Nerd Mode
// No overlay — file tree lives in the panel's Files tab, PDF stays visible
// Depends on: browse-nerd-mode.js, browse-nerd-panel.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { _paperState, _extractArxivId } from '/js/browse/browse-paper.js';
import { _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _getPdfPath } from '/js/toolbar/toolbar-menu.js';
import { switchPanelTab } from '/js/core/core-nav.js';
import { View } from '/aether/ui/aether-ui.js';

// ── Per-tab state ──
// tab._implSessionId, tab._implFolderPath, tab._implTermId

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
  _teardownSession(tab);
}

export function _isImplSessionActive(tabId) {
  var win = window._getCurrentWindow();
  if (!win) return false;
  var tab = win.tabs.find(function(t) { return t.id === tabId; });
  return !!(tab && tab._implSessionId);
}

// ── Create new session (with rich context) ──

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

  // Gather rich context
  var authors = (s2 && s2.authors) ? s2.authors.map(function(a) { return a.name; }) : [];
  var year = (s2 && s2.year) || '';
  var venue = (s2 && s2.venue) || '';
  var references = (state && state.refs) ? state.refs.slice(0, 20) : [];
  var highlights = tab._pdfHighlights || [];

  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Preparing implementation...');

  // Extract text content — notebook or PDF
  var isNotebook = typeof window._isNotebookTab === 'function' && window._isNotebookTab(tab);
  var textPromise;
  if (isNotebook) {
    // Notebooks: use _notebookViewerGetText synchronously
    var nbText = (typeof window._notebookViewerGetText === 'function') ? window._notebookViewerGetText(tab) : '';
    textPromise = Promise.resolve(nbText || '');
  } else {
    // PDF: extract structured markdown, falls back to raw PDF.js text extraction
    textPromise = _getPdfPath(tab).then(function(pdfPath) {
      if (!pdfPath) {
        console.log('[impl] no PDF path, falling back to PDF.js text extraction');
        return _pdfViewerGetText(tab).then(function(t) { return t || ''; });
      }
      console.log('[impl] extracting structured markdown via pdf:to-md');
      return electronAPI.pdfToMd(pdfPath).then(function(result) {
        if (result && result.ok && result.text) {
          console.log('[impl] pdf:to-md succeeded:', result.pageCount, 'pages,', result.text.length, 'chars');
          return result.text;
        }
        console.log('[impl] pdf:to-md failed, falling back to PDF.js:', result && result.error);
        return _pdfViewerGetText(tab).then(function(t) { return t || ''; });
      });
    }).catch(function(err) {
      console.log('[impl] pdf:to-md error, falling back to PDF.js:', err);
      return _pdfViewerGetText(tab).then(function(t) { return t || ''; }).catch(function() { return ''; });
    });
  }

  textPromise.then(function(fullText) {
    electronAPI.implCreate({
      paperUrl: url,
      paperTitle: title,
      paperAbstract: abstract,
      agentType: 'claude',
      authors: authors,
      year: year,
      venue: venue,
      references: references,
      highlights: highlights.map(function(hl) {
        return { text: hl.text || '', pageNum: hl.pageNum, note: hl.note || '' };
      }),
      fullText: fullText
    }).then(function(result) {
      console.log('[impl] create result:', result);
      if (result.error) {
        if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Failed to create session: ' + result.error);
        return;
      }
      tab._implSessionId = result.id;
      tab._implFolderPath = result.folderPath;
      if (tab._implRefreshBtn) tab._implRefreshBtn();
      if (typeof window._refreshFilesContent === 'function') window._refreshFilesContent();

      // Auto-switch to terminal tab and flag for auto-launch
      tab._implAutoLaunchClaude = true;
      switchPanelTab('nerd-terminal');
    });
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
    if (tab._implRefreshBtn) tab._implRefreshBtn();
    if (typeof window._refreshFilesContent === 'function') window._refreshFilesContent();
    switchPanelTab('nerd-terminal');
  });
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

    // Auto-launch claude CLI if flagged
    if (tab._implAutoLaunchClaude) {
      tab._implAutoLaunchClaude = false;
      setTimeout(function() {
        electronAPI.terminalInput(sessionId, 'claude\n');
      }, 800);
    }
  });
}

// ── Files Panel Tab (rendered inside nerd panel) ──

export function _renderFilesTab(container, getTabFn) {
  var tab = getTabFn();

  var wrap = new View('div').className('nerd-files-wrap');

  if (!tab || !tab._implSessionId) {
    wrap.add(Text('Click Implement in the toolbar to start').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  // Sync highlights button
  var syncBtn = new View('button').className('nerd-sync-btn').add(
    RawHTML(icon('highlighter', { size: 12 })),
    Text('Sync highlights')
  ).onTap(function() {
    _syncHighlightsToClaude(tab).then(function(ok) {
      if (typeof Aether !== 'undefined' && Aether.toast) {
        Aether.toast(ok ? 'Highlights synced to CLAUDE.md' : 'Failed to sync highlights');
      }
    });
  });
  wrap.add(syncBtn);

  // File tree container
  var fileTree = new View('div').className('impl-file-tree-panel');
  wrap.add(fileTree);

  AetherUI.mount(wrap, container);

  // Load file tree
  _refreshFileTree(tab, fileTree.el);

  // Start file watcher (guard against duplicates)
  if (!tab._implFileHandler) {
    _startWatcher(tab, fileTree.el);
  }
}

// ── Sync Highlights to CLAUDE.md ──

export function _syncHighlightsToClaude(tab) {
  if (!tab || !tab._implFolderPath) return Promise.resolve(false);

  var highlights = tab._pdfHighlights || [];
  if (!highlights.length) return Promise.resolve(false);

  return electronAPI.implReadFile(tab._implFolderPath, 'CLAUDE.md').then(function(result) {
    if (!result || result.error) return false;

    var content = result.content;
    var hlSection = _buildHighlightsSection(highlights);

    // Replace existing Implementation Guidance section or insert before Notes
    var guidanceStart = content.indexOf('## Implementation Guidance');
    var notesStart = content.indexOf('## Notes');

    if (guidanceStart !== -1) {
      // Find end of guidance section (next ## or end)
      var guidanceEnd = content.indexOf('\n## ', guidanceStart + 1);
      if (guidanceEnd === -1) guidanceEnd = content.length;
      content = content.slice(0, guidanceStart) + hlSection + content.slice(guidanceEnd);
    } else if (notesStart !== -1) {
      content = content.slice(0, notesStart) + hlSection + '\n' + content.slice(notesStart);
    } else {
      content += '\n' + hlSection;
    }

    return electronAPI.implWriteFile(tab._implFolderPath, 'CLAUDE.md', content).then(function(res) {
      return !!(res && res.ok);
    });
  }).catch(function() { return false; });
}

function _buildHighlightsSection(highlights) {
  var lines = ['## Implementation Guidance', '', 'User-highlighted passages from the paper:', ''];
  highlights.forEach(function(hl) {
    var page = hl.pageNum ? ' (p. ' + hl.pageNum + ')' : '';
    lines.push('> ' + (hl.text || '') + page);
    if (hl.note) lines.push('> **Note:** ' + hl.note);
    lines.push('');
  });
  return lines.join('\n');
}

// ── File Icon Helper ──

function _getFileIcon(filename) {
  var ext = filename.lastIndexOf('.') !== -1 ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  if (filename === 'CLAUDE.md') return { iconName: 'fileText', colorClass: 'impl-icon-accent' };
  switch (ext) {
    case '.py': return { iconName: 'code', colorClass: 'impl-icon-blue' };
    case '.js': case '.ts': case '.tsx': case '.jsx': return { iconName: 'code', colorClass: 'impl-icon-yellow' };
    case '.json': return { iconName: 'fileText', colorClass: 'impl-icon-green' };
    case '.css': case '.scss': return { iconName: 'code', colorClass: 'impl-icon-purple' };
    case '.html': case '.htm': return { iconName: 'code', colorClass: 'impl-icon-orange' };
    case '.md': case '.txt': case '.rst': return { iconName: 'fileText', colorClass: '' };
    default: return { iconName: 'fileText', colorClass: '' };
  }
}

// ── File Tree ──

function _refreshFileTree(tab, treeContainer) {
  if (!tab._implFolderPath) return;

  electronAPI.implReadTree(tab._implFolderPath).then(function(tree) {
    if (!tree || tree.error) return;

    // Clear
    while (treeContainer.firstChild) treeContainer.removeChild(treeContainer.firstChild);

    _renderTreeNodes(tab, treeContainer, tree, 0, '');
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

    // Indent guides
    for (var i = 0; i < depth; i++) {
      var guide = document.createElement('span');
      guide.className = 'impl-tree-indent';
      row.appendChild(guide);
    }

    var isDir = node.type === 'dir';
    var hasChildren = isDir && node.children && node.children.length;

    // Spacer
    var chevronEl = document.createElement('span');
    chevronEl.className = 'impl-tree-chevron';
    row.appendChild(chevronEl);

    // Icon
    var iconEl = document.createElement('span');
    iconEl.className = 'impl-tree-icon';
    if (isDir) {
      iconEl.innerHTML = icon('folderOpen', { size: 14 });
      iconEl.classList.add('impl-icon-folder');
    } else {
      var fi = _getFileIcon(node.name);
      iconEl.innerHTML = icon(fi.iconName, { size: 14 });
      if (fi.colorClass) iconEl.classList.add(fi.colorClass);
    }
    row.appendChild(iconEl);

    var nameEl = document.createElement('span');
    nameEl.className = 'impl-tree-name';
    nameEl.textContent = node.name;
    row.appendChild(nameEl);

    if (!isDir) {
      row.addEventListener('click', function() {
        _previewFileInContent(tab, relativePath, node.name);
        var treeRoot = row.closest('.impl-file-tree-panel');
        if (treeRoot) _setTreeActive(treeRoot, row);
        // Also clear paper row active state
        var parentContainer = treeRoot ? treeRoot.parentElement : null;
        if (parentContainer) {
          var paperRow = parentContainer.querySelector('.impl-tree-paper');
          if (paperRow) paperRow.classList.remove('active');
        }
      });
    }

    container.appendChild(row);

    // Render children inline for dirs (expanded by default)
    if (hasChildren) {
      var expanded = true;
      var childContainer = document.createElement('div');
      _renderTreeNodes(tab, childContainer, node.children, depth + 1, relativePath);
      container.appendChild(childContainer);

      // Toggle on click
      row.addEventListener('click', function() {
        expanded = !expanded;
        childContainer.style.display = expanded ? '' : 'none';
        iconEl.innerHTML = icon(expanded ? 'folderOpen' : 'folderClosed', { size: 14 });
      });
    }
  });
}

// ── File Preview (in main content area) ──

function _previewFileInContent(tab, relativePath, fileName) {
  if (!tab._implFolderPath) return;

  electronAPI.implReadFile(tab._implFolderPath, relativePath).then(function(result) {
    if (!result || result.error) {
      if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast(result ? result.error : 'Failed to read file');
      return;
    }

    // Insert preview as sibling of pages container in pdf-body-wrapper
    var pagesContainer = tab._pdfPagesContainer;
    if (!pagesContainer) return;
    var wrapper = pagesContainer.parentElement;
    if (!wrapper) return;

    // Remove any existing preview
    if (tab._implPreviewEl) {
      tab._implPreviewEl.remove();
      tab._implPreviewEl = null;
    }

    // Hide PDF pages
    pagesContainer.style.display = 'none';

    // Create preview element
    var preview = new View('div').className('impl-content-preview');

    var header = new View('div').className('impl-preview-header').add(
      new View('button').className('impl-preview-close').text('\u2190').onTap(function() {
        _restorePdfView(tab);
      }),
      Text(fileName).className('impl-preview-title')
    );

    var content = new View('pre').className('impl-preview-content').text(result.content);

    preview.add(header, content);
    wrapper.appendChild(preview.el);
    tab._implPreviewEl = preview.el;
  });
}

function _restorePdfView(tab) {
  if (tab._implPreviewEl) {
    tab._implPreviewEl.remove();
    tab._implPreviewEl = null;
  }
  if (tab._pdfPagesContainer) {
    tab._pdfPagesContainer.style.display = '';
  }
}

// ── Inline tree renderer (for left sidebar) ──

export function _renderImplTreeInline(tab, container) {
  if (!tab || !tab._implSessionId || !tab._implFolderPath) return;

  // Paper source row
  var paperRow = document.createElement('div');
  paperRow.className = 'impl-tree-row impl-tree-paper';
  var paperChevron = document.createElement('span');
  paperChevron.className = 'impl-tree-chevron';
  paperRow.appendChild(paperChevron);
  var paperIcon = document.createElement('span');
  paperIcon.className = 'impl-tree-icon';
  paperIcon.innerHTML = icon('fileText', { size: 14 });
  paperRow.appendChild(paperIcon);
  var paperName = document.createElement('span');
  paperName.className = 'impl-tree-name';
  paperName.textContent = tab.title || (tab.url ? tab.url.split('/').pop() : 'Paper');
  paperName.title = tab.url || tab.localPath || '';
  paperRow.appendChild(paperName);
  paperRow.classList.add('active');
  paperRow.addEventListener('click', function() {
    _restorePdfView(tab);
    // Set paper row active, clear file tree active states
    paperRow.classList.add('active');
    var treePanel = container.querySelector('.impl-file-tree-panel');
    if (treePanel) _setTreeActive(treePanel, null);
    if (typeof window._pdfViewerScrollToPage === 'function') window._pdfViewerScrollToPage(tab, 1);
  });
  container.appendChild(paperRow);

  // Highlights folder (collapsible)
  var highlights = tab._pdfHighlights || [];
  if (highlights.length) {
    var hlRow = document.createElement('div');
    hlRow.className = 'impl-tree-row';
    var hlFolderIcon = document.createElement('span');
    hlFolderIcon.className = 'impl-tree-icon impl-icon-folder';
    hlFolderIcon.innerHTML = icon('folderOpen', { size: 14 });
    hlRow.appendChild(hlFolderIcon);
    var hlName = document.createElement('span');
    hlName.className = 'impl-tree-name';
    hlName.textContent = 'Highlights (' + highlights.length + ')';
    hlRow.appendChild(hlName);
    container.appendChild(hlRow);

    var hlChildren = document.createElement('div');
    highlights.forEach(function(hl, idx) {
      var row = document.createElement('div');
      row.className = 'impl-tree-row';
      var hlIndent = document.createElement('span');
      hlIndent.className = 'impl-tree-indent';
      row.appendChild(hlIndent);
      var badge = document.createElement('span');
      badge.className = 'impl-tree-icon';
      badge.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;background:' + (hl.color || 'rgba(255,235,59,0.6)');
      row.appendChild(badge);
      var text = document.createElement('span');
      text.className = 'impl-tree-name';
      text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      text.textContent = (hl.text || '').slice(0, 60) + (hl.text && hl.text.length > 60 ? '\u2026' : '');
      text.title = hl.text || '';
      row.appendChild(text);
      var page = document.createElement('span');
      page.style.cssText = 'margin-left:auto;font-size:0.7rem;opacity:0.5;flex-shrink:0;';
      page.textContent = 'p.' + hl.pageNum;
      row.appendChild(page);
      row.addEventListener('click', function() {
        if (typeof window._pdfViewerScrollToPage === 'function') window._pdfViewerScrollToPage(tab, hl.pageNum);
      });
      hlChildren.appendChild(row);
    });
    container.appendChild(hlChildren);

    var hlExpanded = true;
    hlRow.addEventListener('click', function() {
      hlExpanded = !hlExpanded;
      hlChildren.style.display = hlExpanded ? '' : 'none';
      hlFolderIcon.innerHTML = icon(hlExpanded ? 'folderOpen' : 'folderClosed', { size: 14 });
    });
  }

  // File tree
  var fileTreeEl = document.createElement('div');
  fileTreeEl.className = 'impl-file-tree-panel';
  container.appendChild(fileTreeEl);

  _refreshFileTree(tab, fileTreeEl);

  if (!tab._implFileHandler) {
    _startWatcher(tab, fileTreeEl);
  }
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

function _teardownSession(tab) {
  // Restore PDF if preview is active
  _restorePdfView(tab);

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

  // Clear state (keep sessionId for resuming)
  tab._implFolderPath = null;
}

// ── Window bridge ──
console.log('[impl-session] module loaded successfully');
window._implSessionEnable = _implSessionEnable;
window._implSessionDisable = _implSessionDisable;
window._isImplSessionActive = _isImplSessionActive;
