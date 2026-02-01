// ── Rewrite relative image paths in rendered markdown to raw endpoint ──
function _rewriteExpImages(containerEl) {
  if (!currentExpId) return;
  containerEl.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('http') || src.startsWith('data:') || src.startsWith('/api/')) return;
    img.src = `/api/experiments/${currentExpId}/raw/${src}`;
  });
}

// ── Markdown Editor ──
let _mdMode = 'preview'; // 'preview' or 'edit'
let _mdRawContent = '';

function renderMarkdownEditor(fname, content) {
  _mdRawContent = content;
  _mdMode = 'preview';
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center gap-3 px-4 py-2 shrink-0">
      <span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">md</span>
      <span class="text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInEditor('${escapeHtml(fname).replace(/'/g, "\\'")}')" title="Click to rename">${escapeHtml(fname)}</span>
      <button id="md-toggle-btn" onclick="toggleMdMode()" class="ml-auto text-[0.75rem] px-2.5 py-1 rounded-md border border-border-input bg-transparent text-dimmer cursor-pointer hover:text-primary hover:border-accent transition-colors">Edit</button>
      <span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="md-save-ind">Saved</span>
    </div>
    <div id="md-preview" class="nb-rendered-md flex-1 overflow-y-auto px-4 py-3">${marked.parse(content)}</div>
    <textarea id="md-editor-textarea" class="hidden flex-1 w-full px-4 py-2 bg-transparent text-primary text-[0.85rem] font-mono resize-none focus:outline-none border-none" spellcheck="false">${escapeHtml(content)}</textarea>`;
  renderLatexIn('md-preview');
  _rewriteExpImages(document.getElementById('md-preview'));
}

function toggleMdMode() {
  const preview = document.getElementById('md-preview');
  const ta = document.getElementById('md-editor-textarea');
  const btn = document.getElementById('md-toggle-btn');
  if (!preview || !ta) return;
  if (_mdMode === 'preview') {
    _mdMode = 'edit';
    preview.classList.add('hidden');
    ta.classList.remove('hidden');
    btn.textContent = 'Preview';
    ta.value = _mdRawContent;
    ta.addEventListener('input', _mdOnInput);
    ta.focus();
  } else {
    _mdMode = 'preview';
    _mdRawContent = ta.value;
    preview.innerHTML = marked.parse(_mdRawContent);
    renderLatexIn('md-preview');
    _rewriteExpImages(preview);
    preview.classList.remove('hidden');
    ta.classList.add('hidden');
    btn.textContent = 'Edit';
  }
}

function _mdOnInput() {
  _mdRawContent = document.getElementById('md-editor-textarea').value;
  clearTimeout(fileSaveTimer);
  fileSaveTimer = setTimeout(() => saveMarkdown(), 600);
}

async function saveMarkdown() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId) return;
  const content = document.getElementById('md-editor-textarea').value;
  await fetch(`/api/experiments/${currentExpId}/files/${currentFile}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const ind = document.getElementById('md-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

// ── LaTeX Editor ──
let _texMode = 'code'; // 'code' or 'preview'
let _texPdfUrl = null;
let _texCm = null;
let _texPreviewEl = null;
let _texPreviewTimer = null;
let _texPdfChannel = null;
let _texLastPdfBytes = null;

function renderLatexEditor(fname, content) {
  _texMode = 'code';
  _texPdfUrl = null;
  _texCm = null;
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML =
    '<div class="flex items-center gap-3 px-4 py-2 shrink-0">' +
      '<span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">tex</span>' +
      '<span id="tex-editor-fname" class="text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameTexFile(\'' + escapeHtml(fname) + '\')" title="Click to rename">' + escapeHtml(fname) + '</span>' +
      '<span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="tex-save-ind">Saved</span>' +
      '<div class="ml-auto flex items-center gap-2">' +
        '<span id="tex-compile-status" class="text-[0.75rem] text-dimmer"></span>' +
        '<button onclick="cycleTexMode()" id="tex-toggle-btn" class="px-2.5 py-1 rounded-md text-[0.8rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors" title="Cycle: Code → Split → Preview">Split</button>' +
        '<button onclick="compileLatex()" id="tex-compile-btn" class="px-2.5 py-1 rounded-md text-[0.8rem] font-medium bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors" title="Compile PDF (⌘S)">Compile PDF</button>' +
        '<div class="relative">' +
          '<button onclick="toggleTexMenu()" id="tex-menu-btn" class="px-1.5 py-1 rounded-md text-[0.8rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors" title="More options">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>' +
          '</button>' +
          '<div id="tex-more-menu" class="hidden absolute right-0 top-full mt-1 z-50 bg-card border border-border-input rounded-lg shadow-lg py-1 min-w-[180px]">' +
            '<button onclick="openCompiledPdfNewTab(); hideTexMenu()" class="w-full text-left px-3 py-1.5 bg-transparent border-none text-[0.8rem] text-muted cursor-pointer hover:bg-hover hover:text-primary transition-colors">Open PDF in new tab</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="tex-body" class="flex-1 overflow-hidden border-t border-border-input flex">' +
      '<div id="tex-cm-wrap" class="overflow-hidden" style="flex:1 1 0%;min-width:0">' +
        '<textarea id="tex-editor-textarea">' + escapeHtml(content) + '</textarea>' +
      '</div>' +
      '<div id="tex-split-handle" class="hidden shrink-0" style="width:5px;cursor:col-resize;background:var(--border-input);transition:background 0.15s" onmouseenter="this.style.background=\'var(--accent)\'" onmouseleave="if(!this.dataset.dragging)this.style.background=\'var(--border-input)\'"></div>' +
      '<div id="tex-preview-pane" class="hidden bg-input items-center justify-center" style="flex:1 1 0%;min-width:0">' +
        '<span class="text-dimmer text-[0.85rem]">⌘S to compile</span>' +
      '</div>' +
    '</div>' +
    '<div id="tex-error-log" class="hidden p-3 shrink-0 bg-red-500/10 border-t border-red-500/20 text-red-400 text-[0.75rem] font-mono whitespace-pre-wrap max-h-[200px] overflow-auto"></div>';
  var ta = document.getElementById('tex-editor-textarea');
  _texCm = CodeMirror.fromTextArea(ta, {
    mode: 'stex',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: true,
    viewportMargin: Infinity
  });
  _texCm.on('change', function() {
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(function() { saveLatex(); }, 600);
    _scheduleTexPreview();
  });
  _texCm.on('cursorActivity', _scheduleTexPreview);
  // Cmd+S / Ctrl+S to compile
  _texCm.on('keydown', function(cm, e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      compileLatex();
    }
  });
  _texCm.focus();
  // Inline math preview tooltip
  _initTexInlinePreview();
  // Split drag handle
  _initTexSplitDrag();
}

function _initTexInlinePreview() {
  if (_texPreviewEl) _texPreviewEl.remove();
  _texPreviewEl = document.createElement('div');
  _texPreviewEl.id = 'tex-inline-preview';
  _texPreviewEl.className = 'tex-inline-preview';
  _texPreviewEl.style.display = 'none';
  document.body.appendChild(_texPreviewEl);
}

function _scheduleTexPreview() {
  clearTimeout(_texPreviewTimer);
  _texPreviewTimer = setTimeout(_updateTexInlinePreview, 80);
}

function _updateTexInlinePreview() {
  if (!_texCm || !_texPreviewEl || typeof katex === 'undefined') return;
  var cursor = _texCm.getCursor();
  var line = cursor.line;
  var ch = cursor.ch;

  // Gather context: scan outward from cursor to find math delimiters
  // Check a window of lines around the cursor for multi-line math environments
  var totalLines = _texCm.lineCount();
  var startLine = Math.max(0, line - 30);
  var endLine = Math.min(totalLines - 1, line + 30);

  // Build text block with line offsets
  var lines = [];
  var charOffset = 0;
  var cursorAbsPos = 0;
  for (var i = startLine; i <= endLine; i++) {
    var lt = _texCm.getLine(i);
    if (i === line) cursorAbsPos = charOffset + ch;
    lines.push(lt);
    charOffset += lt.length + 1; // +1 for newline
  }
  var text = lines.join('\n');

  // Find math region containing cursor
  var mathRegions = _findTexMathRegions(text);
  var region = null;
  for (var r = 0; r < mathRegions.length; r++) {
    if (cursorAbsPos >= mathRegions[r].start && cursorAbsPos <= mathRegions[r].end) {
      region = mathRegions[r];
      break;
    }
  }

  if (!region || !region.content.trim()) {
    _texPreviewEl.style.display = 'none';
    return;
  }

  // Render with KaTeX
  try {
    var rendered = katex.renderToString(region.content, {
      displayMode: region.display,
      throwOnError: false,
      strict: false
    });
    _texPreviewEl.innerHTML = rendered;
    _texPreviewEl.style.display = '';

    // Position above the current line using viewport coordinates (position: fixed)
    var coords = _texCm.cursorCoords(true, 'page');
    var previewH = _texPreviewEl.offsetHeight;
    var previewW = _texPreviewEl.offsetWidth;
    var topPos = coords.top - previewH - 6;
    var leftPos = Math.min(Math.max(8, coords.left), window.innerWidth - previewW - 8);

    // If tooltip goes above the viewport, show below instead
    if (topPos < 0) {
      topPos = coords.bottom + 6;
    }
    _texPreviewEl.style.top = topPos + 'px';
    _texPreviewEl.style.left = leftPos + 'px';
  } catch (e) {
    _texPreviewEl.style.display = 'none';
  }
}

function _findTexMathRegions(text) {
  var regions = [];
  // Order matters: match longer delimiters first
  // \[...\] display math
  // \(...\) inline math
  // $$...$$ display math
  // $...$ inline math
  // \begin{equation}...\end{equation}, \begin{align}...\end{align}, etc.
  var patterns = [
    { re: /\\\[([\s\S]*?)\\\]/g, display: true },
    { re: /\\\(([\s\S]*?)\\\)/g, display: false },
    { re: /\$\$([\s\S]*?)\$\$/g, display: true },
    { re: /(?<![\\$])\$(?!\$)((?:[^$\\]|\\.)+)\$/g, display: false },
    { re: /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, display: true, group: 0 },
  ];
  var used = []; // track covered ranges to avoid overlap
  for (var p = 0; p < patterns.length; p++) {
    var pat = patterns[p];
    var m;
    while ((m = pat.re.exec(text)) !== null) {
      var start = m.index;
      var end = m.index + m[0].length;
      // Skip if overlapping with already found region
      var overlap = false;
      for (var u = 0; u < used.length; u++) {
        if (start < used[u].end && end > used[u].start) { overlap = true; break; }
      }
      if (overlap) continue;
      var content = pat.group === 0 ? m[0] : (m[2] !== undefined ? m[2] : m[1]);
      regions.push({ start: start, end: end, content: content, display: pat.display });
      used.push({ start: start, end: end });
    }
  }
  return regions;
}

function cycleTexMode() {
  var wrap = document.getElementById('tex-cm-wrap');
  var pane = document.getElementById('tex-preview-pane');
  var handle = document.getElementById('tex-split-handle');
  var btn = document.getElementById('tex-toggle-btn');
  if (_texMode === 'code') {
    _texMode = 'split';
    wrap.style.display = '';
    wrap.style.flex = '1 1 0%';
    pane.style.display = 'flex';
    pane.style.flex = '1 1 0%';
    pane.classList.remove('hidden');
    handle.style.display = '';
    handle.classList.remove('hidden');
    btn.textContent = 'Preview';
    if (_texCm) _texCm.refresh();
  } else if (_texMode === 'split') {
    _texMode = 'preview';
    wrap.style.display = 'none';
    handle.style.display = 'none';
    pane.style.display = 'flex';
    pane.style.flex = '1 1 0%';
    pane.classList.remove('hidden');
    btn.textContent = 'Code';
  } else {
    _texMode = 'code';
    wrap.style.display = '';
    wrap.style.flex = '1 1 0%';
    pane.style.display = 'none';
    handle.style.display = 'none';
    btn.textContent = 'Split';
    if (_texCm) _texCm.refresh();
  }
}
function toggleTexMode() { cycleTexMode(); }

function _initTexSplitDrag() {
  var handle = document.getElementById('tex-split-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.dataset.dragging = '1';
    handle.style.background = 'var(--accent)';
    var body = document.getElementById('tex-body');
    var wrap = document.getElementById('tex-cm-wrap');
    var pane = document.getElementById('tex-preview-pane');
    var bodyRect = body.getBoundingClientRect();
    function onMove(e2) {
      var x = e2.clientX - bodyRect.left;
      var leftPct = (x / bodyRect.width) * 100;
      if (leftPct < 10) {
        // Snap to preview-only
        onUp();
        _texMode = 'split'; // so cycleTexMode goes to preview
        cycleTexMode();
        return;
      }
      if (leftPct > 90) {
        // Snap to code-only
        onUp();
        _texMode = 'preview'; // so cycleTexMode goes to code
        cycleTexMode();
        return;
      }
      leftPct = Math.max(15, Math.min(85, leftPct));
      wrap.style.flex = 'none';
      wrap.style.width = leftPct + '%';
      pane.style.flex = 'none';
      pane.style.width = (100 - leftPct) + '%';
      if (_texCm) _texCm.refresh();
    }
    function onUp() {
      delete handle.dataset.dragging;
      handle.style.background = 'var(--border-input)';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

function toggleTexMenu() {
  var menu = document.getElementById('tex-more-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    setTimeout(function() {
      document.addEventListener('click', _closeTexMenuOutside, { once: true });
    }, 0);
  }
}
function hideTexMenu() {
  var menu = document.getElementById('tex-more-menu');
  if (menu) menu.classList.add('hidden');
}
function _closeTexMenuOutside(e) {
  var menu = document.getElementById('tex-more-menu');
  if (menu && !menu.parentElement.contains(e.target)) {
    menu.classList.add('hidden');
  }
}
function _ensurePdfChannel() {
  if (_texPdfChannel) return;
  _texPdfChannel = new BroadcastChannel('tex-pdf-preview');
  _texPdfChannel.onmessage = function(e) {
    // When preview tab signals ready, send the latest PDF if we have one
    if (e.data && e.data.type === 'preview-ready' && _texLastPdfBytes) {
      _broadcastPdf();
    }
  };
}
function _broadcastPdf() {
  if (!_texLastPdfBytes) return;
  _ensurePdfChannel();
  _texPdfChannel.postMessage({
    type: 'pdf-update',
    pdf: Array.from(_texLastPdfBytes),
    fname: currentFile || ''
  });
}
function openCompiledPdfNewTab() {
  _ensurePdfChannel();
  if (_texLastPdfBytes) {
    window.open('/tex-preview', '_blank');
  } else {
    compileLatex().then(function() {
      window.open('/tex-preview', '_blank');
    });
  }
}

async function saveLatex() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId || !_texCm) return;
  var content = _texCm.getValue();
  await fetch('/api/experiments/' + currentExpId + '/files/' + currentFile, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const ind = document.getElementById('tex-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

async function compileLatex() {
  if (!currentFile || !currentExpId || !_texCm) return;
  // Save first
  var content = _texCm.getValue();
  await fetch('/api/experiments/' + currentExpId + '/files/' + currentFile, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const btn = document.getElementById('tex-compile-btn');
  const status = document.getElementById('tex-compile-status');
  const errLog = document.getElementById('tex-error-log');
  btn.disabled = true;
  btn.textContent = 'Compiling...';
  status.textContent = '';
  errLog.classList.add('hidden');
  try {
    const resp = await fetch('/api/experiments/' + currentExpId + '/compile-tex/' + currentFile);
    if (!resp.ok) {
      const err = await resp.json();
      status.textContent = 'Failed';
      status.className = 'text-[0.75rem] text-red-400';
      errLog.textContent = err.log || err.error || 'Compilation failed';
      errLog.classList.remove('hidden');
      return;
    }
    const blob = await resp.blob();
    if (_texPdfUrl) URL.revokeObjectURL(_texPdfUrl);
    _texPdfUrl = URL.createObjectURL(blob);
    // Store bytes and broadcast to any open preview tabs
    blob.arrayBuffer().then(function(buf) {
      _texLastPdfBytes = new Uint8Array(buf);
      _broadcastPdf();
    });
    var pane = document.getElementById('tex-preview-pane');
    pane.innerHTML = '<iframe src="' + _texPdfUrl + '" class="w-full h-full" style="border:none"></iframe>';
    // Show preview if not visible
    if (_texMode === 'code') {
      cycleTexMode(); // code → split
    }
    status.textContent = 'Compiled';
    status.className = 'text-[0.75rem] text-emerald-400';
    setTimeout(function() { status.textContent = ''; }, 3000);
  } catch(e) {
    status.textContent = 'Error';
    status.className = 'text-[0.75rem] text-red-400';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Compile PDF';
  }
}

function startRenameTexFile(fname) {
  var span = document.getElementById('tex-editor-fname');
  if (!span) return;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = fname;
  input.className = 'bg-input border border-border-input rounded px-2 py-0.5 text-[0.9rem] text-primary font-medium outline-none focus:border-accent';
  span.replaceWith(input);
  input.focus();
  var dotIdx = fname.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : fname.length);

  async function commit() {
    var newName = input.value.trim();
    if (newName && newName !== fname) {
      var resp = await fetch('/api/experiments/' + currentExpId + '/files/' + fname, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rename: newName })
      });
      if (resp.ok) {
        currentFile = newName;
        fname = newName;
      }
    }
    var newSpan = document.createElement('span');
    newSpan.id = 'tex-editor-fname';
    newSpan.className = 'text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors';
    newSpan.title = 'Click to rename';
    newSpan.textContent = fname;
    newSpan.onclick = function() { startRenameTexFile(fname); };
    input.replaceWith(newSpan);
    fetchExpFiles();
  }
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { commit(); }
  });
  input.addEventListener('blur', function() { commit(); });
}

// ── Mermaid Diagram Editor ──
let _mermaidMode = 'split'; // 'code', 'split', 'preview'
let _mermaidCm = null;
let _mermaidRenderTimer = null;
let _mermaidIdCounter = 0;

const MERMAID_DEFAULT_CONTENT = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Result 1]
    B -->|No| D[Result 2]
    C --> E[End]
    D --> E`;

function renderMermaidEditor(fname, content) {
  _mermaidMode = 'split';
  _mermaidCm = null;
  if (!content || !content.trim()) content = MERMAID_DEFAULT_CONTENT;
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML =
    '<div class="flex items-center gap-3 px-4 py-2 shrink-0">' +
      '<span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">dia</span>' +
      '<span id="mermaid-editor-fname" class="text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameMermaidFile(\'' + escapeHtml(fname).replace(/'/g, "\\'") + '\')" title="Click to rename">' + escapeHtml(fname) + '</span>' +
      '<span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="mermaid-save-ind">Saved</span>' +
      '<div class="ml-auto flex items-center gap-2">' +
        '<button onclick="cycleMermaidMode()" id="mermaid-toggle-btn" class="px-2.5 py-1 rounded-md text-[0.8rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors" title="Cycle: Code / Split / Preview">Preview</button>' +
      '</div>' +
    '</div>' +
    '<div id="mermaid-body" class="flex-1 overflow-hidden border-t border-border-input flex">' +
      '<div id="mermaid-cm-wrap" class="overflow-hidden" style="flex:1 1 0%;min-width:0">' +
        '<textarea id="mermaid-editor-textarea">' + escapeHtml(content) + '</textarea>' +
      '</div>' +
      '<div id="mermaid-split-handle" class="shrink-0" style="width:5px;cursor:col-resize;background:var(--border-input);transition:background 0.15s" onmouseenter="this.style.background=\'var(--accent)\'" onmouseleave="if(!this.dataset.dragging)this.style.background=\'var(--border-input)\'"></div>' +
      '<div id="mermaid-preview-pane" class="flex bg-input items-center justify-center overflow-auto" style="flex:1 1 0%;min-width:0">' +
        '<div id="mermaid-preview-content" class="p-4 flex items-center justify-center w-full h-full"></div>' +
      '</div>' +
    '</div>';
  var ta = document.getElementById('mermaid-editor-textarea');
  _mermaidCm = CodeMirror.fromTextArea(ta, {
    mode: null,
    lineNumbers: true,
    matchBrackets: false,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
    viewportMargin: Infinity
  });
  _mermaidCm.on('change', function() {
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(function() { saveMermaid(); }, 600);
    clearTimeout(_mermaidRenderTimer);
    _mermaidRenderTimer = setTimeout(function() { _renderMermaidPreview(); }, 500);
  });
  _mermaidCm.focus();
  _initMermaidSplitDrag();
  _renderMermaidPreview();
}

async function _renderMermaidPreview() {
  var el = document.getElementById('mermaid-preview-content');
  if (!el || !_mermaidCm) return;
  var code = _mermaidCm.getValue().trim();
  if (!code) { el.innerHTML = '<span class="text-dimmer text-[0.85rem]">Empty diagram</span>'; return; }
  try {
    _mermaidIdCounter++;
    var id = 'mermaid-svg-' + _mermaidIdCounter;
    var result = await mermaid.render(id, code);
    el.innerHTML = result.svg;
  } catch (e) {
    el.innerHTML = '<span class="text-red-400 text-[0.8rem]">' + escapeHtml(e.message || 'Invalid diagram syntax') + '</span>';
    // Clean up any leftover temp element mermaid may have created
    var temp = document.getElementById('dmermaid-svg-' + _mermaidIdCounter);
    if (temp) temp.remove();
  }
}

function cycleMermaidMode() {
  var wrap = document.getElementById('mermaid-cm-wrap');
  var pane = document.getElementById('mermaid-preview-pane');
  var handle = document.getElementById('mermaid-split-handle');
  var btn = document.getElementById('mermaid-toggle-btn');
  if (_mermaidMode === 'code') {
    _mermaidMode = 'split';
    wrap.style.display = '';
    wrap.style.flex = '1 1 0%';
    pane.style.display = 'flex';
    pane.style.flex = '1 1 0%';
    handle.style.display = '';
    btn.textContent = 'Preview';
    if (_mermaidCm) _mermaidCm.refresh();
    _renderMermaidPreview();
  } else if (_mermaidMode === 'split') {
    _mermaidMode = 'preview';
    wrap.style.display = 'none';
    handle.style.display = 'none';
    pane.style.display = 'flex';
    pane.style.flex = '1 1 0%';
    btn.textContent = 'Code';
  } else {
    _mermaidMode = 'code';
    wrap.style.display = '';
    wrap.style.flex = '1 1 0%';
    pane.style.display = 'none';
    handle.style.display = 'none';
    btn.textContent = 'Split';
    if (_mermaidCm) _mermaidCm.refresh();
  }
}

function _initMermaidSplitDrag() {
  var handle = document.getElementById('mermaid-split-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.dataset.dragging = '1';
    handle.style.background = 'var(--accent)';
    var body = document.getElementById('mermaid-body');
    var wrap = document.getElementById('mermaid-cm-wrap');
    var pane = document.getElementById('mermaid-preview-pane');
    var bodyRect = body.getBoundingClientRect();
    function onMove(e2) {
      var x = e2.clientX - bodyRect.left;
      var leftPct = (x / bodyRect.width) * 100;
      if (leftPct < 10) {
        onUp();
        _mermaidMode = 'split';
        cycleMermaidMode(); // goes to preview
        return;
      }
      if (leftPct > 90) {
        onUp();
        _mermaidMode = 'preview';
        cycleMermaidMode(); // goes to code
        return;
      }
      leftPct = Math.max(15, Math.min(85, leftPct));
      wrap.style.flex = 'none';
      wrap.style.width = leftPct + '%';
      pane.style.flex = 'none';
      pane.style.width = (100 - leftPct) + '%';
      if (_mermaidCm) _mermaidCm.refresh();
    }
    function onUp() {
      delete handle.dataset.dragging;
      handle.style.background = 'var(--border-input)';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

async function saveMermaid() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId || !_mermaidCm) return;
  var content = _mermaidCm.getValue();
  await fetch('/api/experiments/' + currentExpId + '/files/' + currentFile, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content: content})
  });
  var ind = document.getElementById('mermaid-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(function(){ind.style.opacity='0';},1500); }
}

function startRenameMermaidFile(fname) {
  var span = document.getElementById('mermaid-editor-fname');
  if (!span) return;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = fname;
  input.className = 'bg-input border border-border-input rounded px-2 py-0.5 text-[0.9rem] text-primary font-medium outline-none focus:border-accent';
  span.replaceWith(input);
  input.focus();
  var dotIdx = fname.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : fname.length);

  async function commit() {
    var newName = input.value.trim();
    if (newName && newName !== fname) {
      var resp = await fetch('/api/experiments/' + currentExpId + '/files/' + fname, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rename: newName })
      });
      if (resp.ok) {
        currentFile = newName;
        fname = newName;
      }
    }
    var newSpan = document.createElement('span');
    newSpan.id = 'mermaid-editor-fname';
    newSpan.className = 'text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors';
    newSpan.title = 'Click to rename';
    newSpan.textContent = fname;
    newSpan.onclick = function() { startRenameMermaidFile(fname); };
    input.replaceWith(newSpan);
    fetchExpFiles();
  }
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { commit(); }
  });
  input.addEventListener('blur', function() { commit(); });
}

// ── Python File Editor ──
let pyEditorCm = null;

function renderPythonEditor(fname, content) {
  const editor = document.getElementById('exp-file-editor');
  const pythonPath = (currentExp && currentExp.pythonPath) || 'python3';
  editor.innerHTML = `
    <div class="flex items-center gap-2 px-4 py-2 shrink-0">
      <span class="text-[0.7rem] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">py</span>
      <span class="text-[0.85rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInEditor('${escapeHtml(fname).replace(/'/g, "\\'")}')" title="Click to rename">${escapeHtml(fname)}</span>
      <span class="text-[0.7rem] text-emerald-400 opacity-0 transition-opacity" id="py-save-ind">Saved</span>
    </div>
    <div class="flex items-center gap-2 px-4 pb-2 flex-wrap shrink-0">
      <span class="flex items-center gap-1 text-[0.7rem] text-dimmer"><span id="py-kernel-dot" class="w-1.5 h-1.5 rounded-full inline-block bg-emerald-500"></span><span id="py-kernel-text">idle</span></span>
      <span id="venv-info" class="text-[0.68rem] text-dimmer flex items-center gap-1"></span>
      <div class="ml-auto flex items-center gap-1.5">
        <button class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="restartKernel()">Restart</button>
        <select id="py-venv-select" onchange="switchVenv(this.value)" class="px-1.5 py-0.5 rounded border border-border-input bg-input text-primary text-[0.7rem] cursor-pointer focus:outline-none focus:border-accent">
          <option value="python3" ${pythonPath === 'python3' ? 'selected' : ''}>System python3</option>
        </select>
        <button id="btn-create-venv" class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="createVenv()">+ venv</button>
        <button class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="togglePackagesPanel()">Packages</button>
        <button onclick="copyPyFile()" class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" id="py-copy-btn" title="Copy file contents">Copy</button>
        <button onclick="runPythonFile()" class="px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30 font-medium" id="py-run-btn" title="Run file (Shift+Enter)">Run</button>
      </div>
    </div>
    <div id="packages-panel" class="hidden mb-4 rounded-lg border border-border-input bg-surface-secondary p-4">
      <div class="flex items-center gap-2 mb-3">
        <input type="text" id="pkg-install-input" placeholder="Package names (e.g. numpy pandas)" class="flex-1 px-2 py-1.5 rounded border border-border-input bg-input text-primary text-[0.8rem] focus:outline-none focus:border-accent" onkeydown="if(event.key==='Enter')installPackages()" />
        <button class="px-3 py-1.5 rounded bg-accent text-white text-[0.8rem] cursor-pointer hover:opacity-90" onclick="installPackages()">Install</button>
      </div>
      <div id="pkg-install-status" class="text-[0.75rem] mb-2 hidden"></div>
      <div id="pkg-list" class="text-[0.8rem] text-muted">Loading...</div>
    </div>
    <div class="border-t border-border-dim overflow-hidden flex-1">
      <textarea id="py-editor-textarea">${escapeHtml(content)}</textarea>
    </div>
    <div id="py-output" class="hidden border-t border-border-dim overflow-hidden shrink-0">
      <div class="flex items-center justify-between px-3 py-1.5 bg-card/30 border-b border-border-dim">
        <span class="text-[0.7rem] text-muted font-medium">Output</span>
        <button onclick="document.getElementById('py-output').classList.add('hidden')" class="text-dimmer hover:text-primary text-[0.8rem] bg-transparent border-none cursor-pointer">&times;</button>
      </div>
      <div class="cell-output-wrap" id="py-output-scroll">
        <div id="py-output-content" class="px-4 py-2 bg-body/50 text-[0.8rem] font-mono text-muted whitespace-pre-wrap"></div>
        <div class="cell-output-toggle" onclick="togglePyOutputExpand()">Show all output</div>
      </div>
    </div>
    <div class="pb-40"></div>`;
  const ta = document.getElementById('py-editor-textarea');
  pyEditorCm = CodeMirror.fromTextArea(ta, {
    mode: 'python',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
    viewportMargin: Infinity,
    extraKeys: {
      'Shift-Enter': function() { runPythonFile(); },
      'Cmd-/': function(cm) { cm.toggleComment(); },
      'Ctrl-/': function(cm) { cm.toggleComment(); },
      'Tab': function(cm) {
        if (cm.somethingSelected()) cm.indentSelection('add');
        else cm.replaceSelection('    ', 'end');
      }
    }
  });
  pyEditorCm.setSize(null, '500px');
  pyEditorCm.on('change', () => {
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(() => savePythonFile(), 600);
  });
  _attachGotoDef(pyEditorCm);
  pyEditorCm.focus();
  loadVenvDropdown(pythonPath);
}

let _pyRunning = false;

function _pyBtnRun() {
  const btn = document.getElementById('py-run-btn');
  if (!btn) return;
  if (_pyCooldown) {
    btn.textContent = 'Stopping…';
    btn.className = 'px-2 py-0.5 rounded text-[0.7rem] bg-gray-500/20 text-dimmer border-none cursor-not-allowed opacity-60 font-medium';
    btn.disabled = true;
    btn.removeAttribute('onclick');
    setTimeout(() => {
      _pyCooldown = false;
      const b = document.getElementById('py-run-btn');
      if (b) {
        b.textContent = 'Run';
        b.className = 'px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30 font-medium';
        b.disabled = false;
        b.setAttribute('onclick', 'runPythonFile()');
      }
    }, 3000);
  } else {
    btn.textContent = 'Run';
    btn.className = 'px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30 font-medium';
    btn.disabled = false;
    btn.setAttribute('onclick', 'runPythonFile()');
  }
}

function _pyBtnStop() {
  const btn = document.getElementById('py-run-btn');
  if (btn) {
    btn.textContent = 'Stop';
    btn.className = 'px-2 py-0.5 rounded text-[0.7rem] bg-red-500/20 text-red-400 border-none cursor-pointer hover:bg-red-500/30 font-medium';
    btn.setAttribute('onclick', 'stopPythonFile()');
  }
}

function _gotoDefInCm(cm, token) {
  const text = cm.getValue();
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`^(\\s*)def\\s+${escaped}\\s*\\(`, 'm'),
    new RegExp(`^(\\s*)class\\s+${escaped}\\s*[:(]`, 'm'),
    new RegExp(`^(\\s*)${escaped}\\s*=`, 'm'),
  ];
  for (const pat of patterns) {
    const match = pat.exec(text);
    if (match) {
      const line = text.substring(0, match.index).split('\n').length - 1;
      cm.setCursor(line, match[1].length);
      cm.scrollIntoView({ line, ch: 0 }, 100);
      cm.addLineClass(line, 'background', 'cm-goto-highlight');
      setTimeout(() => cm.removeLineClass(line, 'background', 'cm-goto-highlight'), 1200);
      return true;
    }
  }
  return false;
}

function _attachGotoDef(cm) {
  cm.on('mousedown', (cm, e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
    const word = cm.findWordAt(pos);
    const token = cm.getRange(word.anchor, word.head).trim();
    if (!token || !/^[a-zA-Z_]\w*$/.test(token)) return;
    e.preventDefault();
    // Search current editor first
    if (_gotoDefInCm(cm, token)) return;
    // Search other notebook cells
    for (const other of cmInstances) {
      if (other && other !== cm && _gotoDefInCm(other, token)) return;
    }
    // Search other files in the project
    _gotoDefInProject(token);
  });
  const wrapper = cm.getWrapperElement();
  cm.on('keydown', (cm, e) => { if (e.metaKey || e.ctrlKey) wrapper.classList.add('cm-cmd-held'); });
  cm.on('keyup', (cm, e) => { if (!e.metaKey && !e.ctrlKey) wrapper.classList.remove('cm-cmd-held'); });
  wrapper.addEventListener('mouseleave', () => wrapper.classList.remove('cm-cmd-held'));
}

async function _gotoDefInProject(token) {
  if (!currentExpId || !_expFiles) return;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pyFiles = _expFiles.filter(f => f.endsWith('.py') && f !== currentFile);
  for (const fname of pyFiles) {
    try {
      const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`);
      const data = await resp.json();
      if (data.error) continue;
      const text = data.content || '';
      const defPat = new RegExp(`^\\s*(?:def|class)\\s+${escaped}\\s*[\\(:]`, 'm');
      if (defPat.test(text)) {
        await openFile(fname);
        await new Promise(r => setTimeout(r, 150));
        if (pyEditorCm) _gotoDefInCm(pyEditorCm, token);
        return;
      }
    } catch (e) { /* skip */ }
  }
}

function copyPyFile() {
  if (!pyEditorCm) return;
  navigator.clipboard.writeText(pyEditorCm.getValue()).then(() => {
    const btn = document.getElementById('py-copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1000); }
  });
}

async function runPythonFile() {
  if (!currentExpId || !pyEditorCm) return;
  const code = pyEditorCm.getValue();
  if (!code.trim()) return;

  _pyRunning = true;
  const dot = document.getElementById('py-kernel-dot');
  const text = document.getElementById('py-kernel-text');
  _pyBtnStop();
  if (dot) dot.className = 'w-1.5 h-1.5 rounded-full inline-block bg-amber-500';
  if (text) text.textContent = 'busy';

  const outPanel = document.getElementById('py-output');
  const outContent = document.getElementById('py-output-content');
  const outScroll = document.getElementById('py-output-scroll');
  outPanel.classList.remove('hidden');
  if (outScroll) outScroll.classList.remove('expanded');
  outContent.innerHTML = '<span class="text-dim">Running…</span>';

  await savePythonFile();
  let firstOutput = true;

  _streamExecute(currentExpId, code,
    (out) => {
      if (firstOutput) { outContent.innerHTML = ''; firstOutput = false; }
      outContent.innerHTML += renderCellOutputs([out]);
    },
    () => {
      if (firstOutput) outContent.innerHTML = '<span class="text-dim">No output</span>';
      if (dot) dot.className = 'w-1.5 h-1.5 rounded-full inline-block bg-emerald-500';
      if (text) text.textContent = 'idle';
      _pyRunning = false;
      _execAbort = null;
      _pyBtnRun();
    },
    (e) => {
      outContent.innerHTML = `<span class="text-red-400">${escapeHtml(e.message)}</span>`;
      if (dot) dot.className = 'w-1.5 h-1.5 rounded-full inline-block bg-red-500';
      if (text) text.textContent = 'dead';
      _pyRunning = false;
      _execAbort = null;
      _pyBtnRun();
    }
  );
}

let _pyCooldown = false;

async function stopPythonFile() {
  _pyCooldown = true;
  const btn = document.getElementById('py-run-btn');
  if (btn) { btn.textContent = 'Stopping…'; btn.disabled = true; btn.classList.add('opacity-60'); }
  await interruptKernel();
}

async function savePythonFile() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId || !pyEditorCm) return;
  const content = pyEditorCm.getValue();
  await fetch(`/api/experiments/${currentExpId}/files/${currentFile}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const ind = document.getElementById('py-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

