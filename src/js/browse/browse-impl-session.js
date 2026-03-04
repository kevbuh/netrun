// browse-impl-session.js — Implementation session for Nerd Mode
// No overlay — file tree lives in the panel's Files tab, PDF stays visible
// Depends on: browse-nerd-mode.js, browse-nerd-panel.js, browse-paper.js, browse-pdf-viewer.js
import { icon } from '/js/core/icons.js';
import { _paperState, _extractArxivId } from '/js/browse/browse-paper.js';
import { _pdfViewerGetText } from '/js/browse/browse-pdf-viewer.js';
import { _getPdfPath } from '/js/toolbar/toolbar-menu.js';
import { switchPanelTab } from '/js/core/core-nav.js';
import { View } from '/aether/ui/aether-ui.js';

// ── Prompt dialog (Electron has no window.prompt) ──
function _promptDialog(label, defaultValue) {
  return new Promise(function(resolve) {
    const backdrop = document.createElement('div');
    backdrop.className = 'nr-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'nr-modal';
    modal.style.maxWidth = '340px';
    const header = document.createElement('div');
    header.className = 'nr-modal-header';
    const title = document.createElement('span');
    title.className = 'nr-modal-title';
    title.textContent = label;
    header.appendChild(title);
    modal.appendChild(header);
    const body = document.createElement('div');
    body.className = 'nr-modal-body';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue || '';
    input.className = 'nr-input';
    input.style.cssText = 'width:100%;font-size:0.85rem;';
    body.appendChild(input);
    modal.appendChild(body);
    const footer = document.createElement('div');
    footer.className = 'nr-modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'nr-btn nr-btn-ghost';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'nr-btn nr-btn-primary';
    okBtn.textContent = 'OK';
    function dismiss(val) { backdrop.remove(); resolve(val); }
    cancelBtn.onclick = function() { dismiss(null); };
    okBtn.onclick = function() { dismiss(input.value); };
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') dismiss(input.value);
      if (e.key === 'Escape') dismiss(null);
    });
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) dismiss(null); });
    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    requestAnimationFrame(function() { input.focus(); input.select(); });
  });
}

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
  const win = window._getCurrentWindow();
  if (!win) return false;
  const tab = win.tabs.find(function(t) { return t.id === tabId; });
  return !!(tab && tab._implSessionId);
}

// ── Create new session (with rich context) ──

function _createSession(tab) {
  const state = _paperState.get(tab.id);
  const s2 = state ? state.s2Data : null;
  const title = (s2 && s2.title) || tab.title || 'Paper';
  const abstract = (s2 && s2.abstract) || '';
  const url = tab.url || '';

  console.log('[impl] creating session, implCreate available:', typeof electronAPI.implCreate);
  if (!electronAPI.implCreate) {
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('implCreate not available — rebuild & restart needed');
    return;
  }

  // Gather rich context
  const authors = (s2 && s2.authors) ? s2.authors.map(function(a) { return a.name; }) : [];
  const year = (s2 && s2.year) || '';
  const venue = (s2 && s2.venue) || '';
  const references = (state && state.refs) ? state.refs.slice(0, 20) : [];
  const highlights = tab._pdfHighlights || [];

  if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Preparing implementation...');

  // Extract text content — notebook or PDF
  const isNotebook = typeof window._isNotebookTab === 'function' && window._isNotebookTab(tab);
  let textPromise;
  if (isNotebook) {
    // Notebooks: use _notebookViewerGetText synchronously
    const nbText = (typeof window._notebookViewerGetText === 'function') ? window._notebookViewerGetText(tab) : '';
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

    const sessionId = result.sessionId;
    tab._implTermId = sessionId;

    const term = new Terminal({
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

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    // Fit after a frame
    requestAnimationFrame(function() {
      fitAddon.fit();
      electronAPI.terminalResize(sessionId, term.cols, term.rows);
    });

    // Resize observer
    const resizeObs = new ResizeObserver(function() {
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

    const outputHandler = function(_ev, sid, data) {
      if (sid === sessionId) term.write(data);
    };
    electronAPI.onTerminalOutput(outputHandler);
    tab._implOutputHandler = outputHandler;

    const exitHandler = function(_ev, sid) {
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
  const tab = getTabFn();

  const wrap = new View('div').className('nerd-files-wrap');

  if (!tab) {
    wrap.add(Text('No tab').className('nerd-empty'));
    AetherUI.mount(wrap, container);
    return;
  }

  if (tab._implSessionId) {
    // Sync highlights button
    const syncBtn = new View('button').className('nerd-sync-btn').add(
      RawHTML(icon('highlighter', { size: 12 })),
      Text('Sync highlights')
    ).onTap(function() {
      _syncHighlightsToClaude(tab).then(function(ok) {
        if (typeof Aether !== 'undefined' && Aether.toast) {
          Aether.toast(ok ? 'Highlights synced to CLAUDE.md' : 'Failed to sync highlights');
        }
      });
    });
    // New file dropdown
    const _newFileTypes = [
      { label: 'Python', ext: '.py' }, { label: 'JavaScript', ext: '.js' }, { label: 'TypeScript', ext: '.ts' },
      { label: 'Go', ext: '.go' }, { label: 'Rust', ext: '.rs' }, { label: 'C', ext: '.c' },
      { label: 'C++', ext: '.cpp' }, { label: 'Java', ext: '.java' },
      { divider: true },
      { label: 'HTML', ext: '.html' }, { label: 'CSS', ext: '.css' }, { label: 'JSON', ext: '.json' }, { label: 'YAML', ext: '.yaml' },
      { divider: true },
      { label: 'Markdown', ext: '.md' }, { label: 'Text', ext: '.txt' },
      { divider: true },
      { label: 'Jupyter Notebook', ext: '.ipynb' },
      { divider: true },
      { label: 'Dockerfile', ext: '' }, { label: '.env', ext: '' }, { label: '.gitignore', ext: '' }, { label: 'Makefile', ext: '' }
    ];
    const _newFileItems = _newFileTypes.map(function(t) {
      if (t.divider) return t;
      const defaultName = t.ext ? 'untitled' + t.ext : t.label;
      const iconInfo = _getFileIcon(defaultName);
      return {
        icon: icon(iconInfo.iconName, { size: 14 }),
        label: t.label + (t.ext ? ' (' + t.ext + ')' : ''),
        handler: async function() {
          const name = await _promptDialog('File name:', defaultName);
          if (!name) return;
          let content = '';
          if (name.endsWith('.ipynb')) {
            content = JSON.stringify({ cells: [{ cell_type: 'code', source: [], metadata: {}, outputs: [], execution_count: null }], metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.10.0' } }, nbformat: 4, nbformat_minor: 5 }, null, 2);
          }
          electronAPI.implWriteFile(tab._implFolderPath, name, content).then(function() {
            _refreshFileTree(tab, fileTree.el);
            _previewFileInContent(tab, name, name);
          });
        }
      };
    });
    const plusBtn = Dropdown(null, _newFileItems, { placeholder: 'New file' });
    plusBtn.el.style.cssText = 'border:none;padding:2px 6px;font-size:0.7rem;';

    const headerRow = new View('div').styles({ display: 'flex', gap: '4px' }).add(syncBtn, plusBtn);
    wrap.add(headerRow);

    // File tree container
    var fileTree = new View('div').className('impl-file-tree-panel');
    wrap.add(fileTree);
  }

  // Implementation dropdown at bottom
  const implBtn = new View('button')
    .className('pdf-tb-btn pdf-tb-labeled pdf-tb-impl')
    .styles({ marginTop: 'auto', alignSelf: 'flex-start', margin: '12px var(--nr-space-3) var(--nr-space-2)' });
  const implLabel = Text('Implement').cssText('font-size:0.72rem;');
  const implChevron = RawHTML(icon('chevronDown', { size: 10 }));
  implChevron.el.style.marginLeft = '2px';
  implChevron.el.style.opacity = '0.5';
  implChevron.el.style.display = 'none';
  implBtn.add(implLabel, implChevron);
  wrap.add(implBtn);

  AetherUI.mount(wrap, container);

  // Load file tree if session active
  if (tab._implSessionId && fileTree) {
    _refreshFileTree(tab, fileTree.el);
    if (!tab._implFileHandler) {
      _startWatcher(tab, fileTree.el);
    }
  }

  function _implSessionLabel(s) {
    if (s.name) return s.name;
    const parts = s.id.split('-');
    return parts.length > 1 ? parts[1].slice(0, 8) : s.id.slice(0, 8);
  }

  let _implHasSessions = false;

  function _implRefreshBtn() {
    if (!window.electronAPI || !window.electronAPI.implList) return;
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      _implHasSessions = sessions.length > 0;
      if (tab._implSessionId) {
        const active = sessions.find(function(s) { return s.id === tab._implSessionId; });
        implLabel.el.textContent = active ? _implSessionLabel(active) : 'Active';
        implBtn.el.classList.add('active');
        implChevron.el.style.display = '';
      } else if (sessions.length > 0) {
        implLabel.el.textContent = 'Implement';
        implBtn.el.classList.remove('active');
        implChevron.el.style.display = '';
      } else {
        implLabel.el.textContent = 'Implement';
        implBtn.el.classList.remove('active');
        implChevron.el.style.display = 'none';
      }
    });
  }

  implBtn.onTap(function() {
    if (!_implHasSessions && !tab._implSessionId) {
      if (window._implSessionEnable) window._implSessionEnable(tab);
      setTimeout(_implRefreshBtn, 1500);
      return;
    }
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      const items = [];

      sessions.forEach(function(s) {
        const age = (Date.now() / 1000 - s.created_at);
        const ageStr = age < 3600 ? Math.floor(age / 60) + 'm ago' : age < 86400 ? Math.floor(age / 3600) + 'h ago' : Math.floor(age / 86400) + 'd ago';
        const isActive = tab._implSessionId === s.id;
        items.push({
          label: _implSessionLabel(s) + (isActive ? ' ●' : ''),
          trailing: function() { return Text(ageStr).cssText('font-size:0.65rem; opacity:0.5;'); },
          handler: function() {
            if (window._implSessionEnable) window._implSessionEnable(tab, s.id);
          }
        });
      });

      if (sessions.length) items.push({ divider: true });

      if (tab._implSessionId) {
        items.push({
          icon: icon('edit', { size: 14 }),
          label: 'Rename…',
          handler: async function() {
            const current = sessions.find(function(s) { return s.id === tab._implSessionId; });
            const currentName = current ? _implSessionLabel(current) : '';
            const newName = await _promptDialog('Session name:', currentName);
            if (newName !== null && newName !== currentName) {
              electronAPI.implRename(tab._implSessionId, newName.trim()).then(function() {
                _implRefreshBtn();
              });
            }
          }
        });
      }

      items.push({
        icon: icon('plus', { size: 14 }),
        label: 'New implementation',
        handler: function() {
          if (window._implSessionEnable) window._implSessionEnable(tab);
          setTimeout(_implRefreshBtn, 1500);
        }
      });

      const menu = Menu(null, items);
      const rect = implBtn.el.getBoundingClientRect();
      menu.showAt(rect.left, rect.bottom + 4);
    });
  });

  tab._implRefreshBtn = _implRefreshBtn;
  _implRefreshBtn();
}

// ── Sync Highlights to CLAUDE.md ──

export function _syncHighlightsToClaude(tab) {
  if (!tab || !tab._implFolderPath) return Promise.resolve(false);

  const highlights = tab._pdfHighlights || [];
  if (!highlights.length) return Promise.resolve(false);

  return electronAPI.implReadFile(tab._implFolderPath, 'CLAUDE.md').then(function(result) {
    if (!result || result.error) return false;

    let content = result.content;
    const hlSection = _buildHighlightsSection(highlights);

    // Replace existing Implementation Guidance section or insert before Notes
    const guidanceStart = content.indexOf('## Implementation Guidance');
    const notesStart = content.indexOf('## Notes');

    if (guidanceStart !== -1) {
      // Find end of guidance section (next ## or end)
      let guidanceEnd = content.indexOf('\n## ', guidanceStart + 1);
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
  const lines = ['## Implementation Guidance', '', 'User-highlighted passages from the paper:', ''];
  highlights.forEach(function(hl) {
    const page = hl.pageNum ? ' (p. ' + hl.pageNum + ')' : '';
    lines.push('> ' + (hl.text || '') + page);
    if (hl.note) lines.push('> **Note:** ' + hl.note);
    lines.push('');
  });
  return lines.join('\n');
}

// ── File Icon Helper ──

function _getFileIcon(filename) {
  const ext = filename.lastIndexOf('.') !== -1 ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
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
  const rows = treeContainer.querySelectorAll('.impl-tree-row');
  for (let i = 0; i < rows.length; i++) rows[i].classList.remove('active');
  if (activeRow) activeRow.classList.add('active');
}

function _renderTreeNodes(tab, container, nodes, depth, parentPath) {
  nodes.forEach(function(node) {
    const relativePath = parentPath ? parentPath + '/' + node.name : node.name;
    const row = document.createElement('div');
    row.className = 'impl-tree-row';

    // Indent guides
    for (let i = 0; i < depth; i++) {
      const guide = document.createElement('span');
      guide.className = 'impl-tree-indent';
      row.appendChild(guide);
    }

    const isDir = node.type === 'dir';
    const hasChildren = isDir && node.children && node.children.length;

    // Spacer
    const chevronEl = document.createElement('span');
    chevronEl.className = 'impl-tree-chevron';
    row.appendChild(chevronEl);

    // Icon
    const iconEl = document.createElement('span');
    iconEl.className = 'impl-tree-icon';
    if (isDir) {
      iconEl.innerHTML = icon('folderOpen', { size: 14 });
      iconEl.classList.add('impl-icon-folder');
    } else {
      const fi = _getFileIcon(node.name);
      iconEl.innerHTML = icon(fi.iconName, { size: 14 });
      if (fi.colorClass) iconEl.classList.add(fi.colorClass);
    }
    row.appendChild(iconEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'impl-tree-name';
    nameEl.textContent = node.name;
    row.appendChild(nameEl);

    if (!isDir) {
      row.addEventListener('click', function() {
        _previewFileInContent(tab, relativePath, node.name);
        const treeRoot = row.closest('.impl-file-tree-panel');
        if (treeRoot) _setTreeActive(treeRoot, row);
        // Also clear paper row active state
        const parentContainer = treeRoot ? treeRoot.parentElement : null;
        if (parentContainer) {
          const paperRow = parentContainer.querySelector('.impl-tree-paper');
          if (paperRow) paperRow.classList.remove('active');
        }
      });
    }

    container.appendChild(row);

    // Render children inline for dirs (expanded by default)
    if (hasChildren) {
      let expanded = true;
      const childContainer = document.createElement('div');
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
    const pagesContainer = tab._pdfPagesContainer;
    if (!pagesContainer) return;
    const wrapper = pagesContainer.parentElement;
    if (!wrapper) return;

    // Remove any existing preview
    if (tab._implPreviewEl) {
      tab._implPreviewEl.remove();
      tab._implPreviewEl = null;
    }

    // Hide PDF pages
    pagesContainer.style.display = 'none';

    // Create preview element
    const preview = new View('div').className('impl-content-preview');

    const header = new View('div').className('impl-preview-header').add(
      new View('button').className('impl-preview-close').text('\u2190').onTap(function() {
        _restorePdfView(tab);
      }),
      Text(fileName).className('impl-preview-title')
    );

    if (fileName.endsWith('.ipynb')) {
      let nbData;
      try { nbData = JSON.parse(result.content); } catch (e) { nbData = null; }
      if (nbData && typeof window._notebookViewerInit === 'function') {
        const nbContainer = new View('div').className('impl-preview-notebook');
        nbContainer.el.style.cssText = 'flex:1;overflow:auto;';
        tab._nbParsedData = nbData;
        tab.localPath = tab._implFolderPath + '/' + relativePath;
        preview.add(header, nbContainer);
        wrapper.appendChild(preview.el);
        tab._implPreviewEl = preview.el;
        window._notebookViewerInit(tab, nbContainer.el, nbData);
        return;
      }
    }

    const content = new View('pre').className('impl-preview-content').text(result.content);

    preview.add(header, content);
    wrapper.appendChild(preview.el);
    tab._implPreviewEl = preview.el;
  });
}

function _restorePdfView(tab) {
  if (typeof window._notebookViewerDestroy === 'function') {
    window._notebookViewerDestroy(tab);
  }
  tab._nbParsedData = null;
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

  // Position container for absolute plus button
  container.style.position = 'relative';

  // New file dropdown (top-right)
  const _newFileTypes = [
    { label: 'Python', ext: '.py' }, { label: 'JavaScript', ext: '.js' }, { label: 'TypeScript', ext: '.ts' },
    { label: 'Go', ext: '.go' }, { label: 'Rust', ext: '.rs' }, { label: 'C', ext: '.c' },
    { label: 'C++', ext: '.cpp' }, { label: 'Java', ext: '.java' },
    { divider: true },
    { label: 'HTML', ext: '.html' }, { label: 'CSS', ext: '.css' }, { label: 'JSON', ext: '.json' }, { label: 'YAML', ext: '.yaml' },
    { divider: true },
    { label: 'Markdown', ext: '.md' }, { label: 'Text', ext: '.txt' },
    { divider: true },
    { label: 'Jupyter Notebook', ext: '.ipynb' },
    { divider: true },
    { label: 'Dockerfile', ext: '' }, { label: '.env', ext: '' }, { label: '.gitignore', ext: '' }, { label: 'Makefile', ext: '' }
  ];
  // fileTreeEl declared later, referenced in closure (fine)
  let fileTreeEl;
  const _newFileItems = _newFileTypes.map(function(t) {
    if (t.divider) return t;
    const defaultName = t.ext ? 'untitled' + t.ext : t.label;
    const iconInfo = _getFileIcon(defaultName);
    return {
      icon: icon(iconInfo.iconName, { size: 14 }),
      label: t.label + (t.ext ? ' (' + t.ext + ')' : ''),
      handler: async function() {
        const name = await _promptDialog('File name:', defaultName);
        if (!name) return;
        let content = '';
        if (name.endsWith('.ipynb')) {
          content = JSON.stringify({ cells: [{ cell_type: 'code', source: [], metadata: {}, outputs: [], execution_count: null }], metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.10.0' } }, nbformat: 4, nbformat_minor: 5 }, null, 2);
        }
        electronAPI.implWriteFile(tab._implFolderPath, name, content).then(function() {
          _refreshFileTree(tab, fileTreeEl);
          _previewFileInContent(tab, name, name);
        });
      }
    };
  });
  const newFileDropdown = Dropdown(null, _newFileItems, { placeholder: 'New file' });
  newFileDropdown.el.style.cssText = 'position:absolute;top:4px;right:6px;z-index:1;border:none;padding:2px;opacity:0.5;';
  newFileDropdown.el.title = 'New file';
  newFileDropdown.el.addEventListener('mouseenter', function() { newFileDropdown.el.style.opacity = '1'; });
  newFileDropdown.el.addEventListener('mouseleave', function() { newFileDropdown.el.style.opacity = '0.5'; });
  container.appendChild(newFileDropdown.el);

  // Paper source row
  const paperRow = document.createElement('div');
  paperRow.className = 'impl-tree-row impl-tree-paper';
  const paperChevron = document.createElement('span');
  paperChevron.className = 'impl-tree-chevron';
  paperRow.appendChild(paperChevron);
  const paperIcon = document.createElement('span');
  paperIcon.className = 'impl-tree-icon';
  paperIcon.innerHTML = icon('fileText', { size: 14 });
  paperRow.appendChild(paperIcon);
  const paperName = document.createElement('span');
  paperName.className = 'impl-tree-name';
  paperName.textContent = tab.title || (tab.url ? tab.url.split('/').pop() : 'Paper');
  paperName.title = tab.url || tab.localPath || '';
  paperRow.appendChild(paperName);
  paperRow.classList.add('active');
  paperRow.addEventListener('click', function() {
    _restorePdfView(tab);
    // Set paper row active, clear file tree active states
    paperRow.classList.add('active');
    const treePanel = container.querySelector('.impl-file-tree-panel');
    if (treePanel) _setTreeActive(treePanel, null);
    if (typeof window._pdfViewerScrollToPage === 'function') window._pdfViewerScrollToPage(tab, 1);
  });
  container.appendChild(paperRow);

  // Highlights folder (collapsible)
  const highlights = tab._pdfHighlights || [];
  if (highlights.length) {
    const hlRow = document.createElement('div');
    hlRow.className = 'impl-tree-row';
    const hlFolderIcon = document.createElement('span');
    hlFolderIcon.className = 'impl-tree-icon impl-icon-folder';
    hlFolderIcon.innerHTML = icon('folderOpen', { size: 14 });
    hlRow.appendChild(hlFolderIcon);
    const hlName = document.createElement('span');
    hlName.className = 'impl-tree-name';
    hlName.textContent = 'Highlights (' + highlights.length + ')';
    hlRow.appendChild(hlName);
    container.appendChild(hlRow);

    const hlChildren = document.createElement('div');
    highlights.forEach(function(hl, idx) {
      const row = document.createElement('div');
      row.className = 'impl-tree-row';
      const hlIndent = document.createElement('span');
      hlIndent.className = 'impl-tree-indent';
      row.appendChild(hlIndent);
      const badge = document.createElement('span');
      badge.className = 'impl-tree-icon';
      badge.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;background:' + (hl.color || 'rgba(255,235,59,0.6)');
      row.appendChild(badge);
      const text = document.createElement('span');
      text.className = 'impl-tree-name';
      text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      text.textContent = (hl.text || '').slice(0, 60) + (hl.text && hl.text.length > 60 ? '\u2026' : '');
      text.title = hl.text || '';
      row.appendChild(text);
      const page = document.createElement('span');
      page.style.cssText = 'margin-left:auto;font-size:0.7rem;opacity:0.5;flex-shrink:0;';
      page.textContent = 'p.' + hl.pageNum;
      row.appendChild(page);
      row.addEventListener('click', function() {
        if (typeof window._pdfViewerScrollToPage === 'function') window._pdfViewerScrollToPage(tab, hl.pageNum);
      });
      hlChildren.appendChild(row);
    });
    container.appendChild(hlChildren);

    let hlExpanded = true;
    hlRow.addEventListener('click', function() {
      hlExpanded = !hlExpanded;
      hlChildren.style.display = hlExpanded ? '' : 'none';
      hlFolderIcon.innerHTML = icon(hlExpanded ? 'folderOpen' : 'folderClosed', { size: 14 });
    });
  }

  // File tree
  fileTreeEl = document.createElement('div');
  fileTreeEl.className = 'impl-file-tree-panel';
  container.appendChild(fileTreeEl);

  _refreshFileTree(tab, fileTreeEl);

  if (!tab._implFileHandler) {
    _startWatcher(tab, fileTreeEl);
  }

  // Implementation session dropdown at bottom
  _renderImplDropdown(tab, container);
}

function _implSessionLabel(s) {
  if (s.name) return s.name;
  const parts = s.id.split('-');
  return parts.length > 1 ? parts[1].slice(0, 8) : s.id.slice(0, 8);
}

function _renderImplDropdown(tab, container) {
  if (!window.electronAPI || !window.electronAPI.implList) return;

  const dropdown = Dropdown(null, null, { placeholder: 'Implement' });
  dropdown.el.style.cssText = 'margin-top:auto;border-top:1px solid var(--nr-border-dim);padding-top:6px;margin-top:8px;width:100%;';
  dropdown.el.title = 'Switch implementation session';

  container.appendChild(dropdown.el);

  let _implHasSessions = false;
  const _labelSpan = dropdown.el.querySelector('.nr-dropdown-label');
  const _chevronSpan = dropdown.el.querySelector('.nr-dropdown-chevron');

  function refresh() {
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      _implHasSessions = sessions.length > 0;
      if (tab._implSessionId) {
        const active = sessions.find(function(s) { return s.id === tab._implSessionId; });
        _labelSpan.textContent = active ? _implSessionLabel(active) : 'Active';
        _labelSpan.style.color = 'var(--nr-accent)';
        _chevronSpan.style.display = '';
      } else if (sessions.length > 0) {
        _labelSpan.textContent = 'Implement';
        _labelSpan.style.color = '';
        _chevronSpan.style.display = '';
      } else {
        _labelSpan.textContent = 'Implement';
        _labelSpan.style.color = '';
        _chevronSpan.style.display = 'none';
      }
    });
  }

  dropdown.onOpen(function() {
    if (!_implHasSessions && !tab._implSessionId) {
      if (window._implSessionEnable) window._implSessionEnable(tab);
      setTimeout(refresh, 1500);
      return;
    }
    electronAPI.implList({ paperUrl: tab.url }).then(function(sessions) {
      if (!sessions || sessions.error) sessions = [];
      const items = [];

      sessions.forEach(function(s) {
        const age = (Date.now() / 1000 - s.created_at);
        const ageStr = age < 3600 ? Math.floor(age / 60) + 'm ago' : age < 86400 ? Math.floor(age / 3600) + 'h ago' : Math.floor(age / 86400) + 'd ago';
        const isActive = tab._implSessionId === s.id;
        items.push({
          label: _implSessionLabel(s) + (isActive ? ' \u25cf' : ''),
          trailing: function() { return Text(ageStr).cssText('font-size:0.65rem; opacity:0.5;'); },
          handler: function() {
            if (window._implSessionEnable) window._implSessionEnable(tab, s.id);
          }
        });
      });

      if (sessions.length) items.push({ divider: true });

      if (tab._implSessionId) {
        items.push({
          icon: icon('edit', { size: 14 }),
          label: 'Rename\u2026',
          handler: async function() {
            const current = sessions.find(function(s) { return s.id === tab._implSessionId; });
            const currentName = current ? _implSessionLabel(current) : '';
            const newName = await _promptDialog('Session name:', currentName);
            if (newName !== null && newName !== currentName) {
              electronAPI.implRename(tab._implSessionId, newName.trim()).then(refresh);
            }
          }
        });
      }

      items.push({
        icon: icon('plus', { size: 14 }),
        label: 'New implementation',
        handler: function() {
          if (window._implSessionEnable) window._implSessionEnable(tab);
          setTimeout(refresh, 1500);
        }
      });

      Menu(dropdown, items);
    });
  });

  tab._implRefreshBtn = refresh;
  refresh();
}

// ── File Watcher ──

function _startWatcher(tab, fileTreeEl) {
  if (!tab._implSessionId || !tab._implFolderPath) return;

  electronAPI.implWatchStart(tab._implSessionId, tab._implFolderPath);

  let debounce = null;
  const handler = function(_ev, sid) {
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
