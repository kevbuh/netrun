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
  const escapedFname = escapeHtml(fname).replace(/'/g, "\\'");
  editor.innerHTML = `
    <div class="flex items-center gap-2 px-4 py-2 shrink-0 flex-wrap">
      <span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">md</span>
      <span class="text-[0.9rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInEditor('${escapedFname}')" title="Click to rename">${escapeHtml(fname)}</span>
      <div class="w-px h-4 bg-border-dim mx-1"></div>
      <button onclick="_mdWrap('**','**')" class="md-tb-btn" title="Bold (⌘B)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg></button>
      <button onclick="_mdWrap('*','*')" class="md-tb-btn" title="Italic (⌘I)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg></button>
      <button onclick="_mdWrap('~~','~~')" class="md-tb-btn" title="Strikethrough"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/></svg></button>
      <div class="w-px h-4 bg-border-dim mx-1"></div>
      <button onclick="_mdLinePrefix('# ')" class="md-tb-btn" title="Heading 1"><span class="text-[0.7rem] font-bold">H1</span></button>
      <button onclick="_mdLinePrefix('## ')" class="md-tb-btn" title="Heading 2"><span class="text-[0.7rem] font-bold">H2</span></button>
      <button onclick="_mdLinePrefix('### ')" class="md-tb-btn" title="Heading 3"><span class="text-[0.7rem] font-bold">H3</span></button>
      <div class="w-px h-4 bg-border-dim mx-1"></div>
      <button onclick="_mdLinePrefix('- ')" class="md-tb-btn" title="Bullet list"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/></svg></button>
      <button onclick="_mdLinePrefix('1. ')" class="md-tb-btn" title="Numbered list"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg></button>
      <button onclick="_mdLinePrefix('- [ ] ')" class="md-tb-btn" title="Todo item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg></button>
      <div class="w-px h-4 bg-border-dim mx-1"></div>
      <button onclick="_mdWrap('\`','\`')" class="md-tb-btn" title="Inline code (⌘E)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg></button>
      <button onclick="_mdInsertCodeBlock()" class="md-tb-btn" title="Code block"><span class="text-[0.65rem] font-mono">{}</span></button>
      <button onclick="_mdLinePrefix('> ')" class="md-tb-btn" title="Blockquote"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg></button>
      <button onclick="_mdInsertLink()" class="md-tb-btn" title="Link (⌘K)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></button>
      <button onclick="_mdInsertHr()" class="md-tb-btn" title="Horizontal rule"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 11h20v2H2z"/></svg></button>
      <span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity ml-auto" id="md-save-ind">Saved</span>
      ${fileShareButton()}
    </div>
    <div id="md-preview" class="nb-rendered-md flex-1 overflow-y-auto px-4 py-3 cursor-text" onclick="_mdEnterEdit()">${marked.parse(content)}</div>
    <textarea id="md-editor-textarea" class="hidden flex-1 w-full px-4 py-2 bg-transparent text-primary text-[0.85rem] font-mono resize-none focus:outline-none border-none" spellcheck="false">${escapeHtml(content)}</textarea>`;
  renderLatexIn('md-preview');
  _rewriteExpImages(document.getElementById('md-preview'));
  // Prevent toolbar buttons from stealing focus from textarea
  editor.querySelectorAll('.md-tb-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
  });
}

function _mdEnterEdit() {
  if (_mdMode === 'edit') return;
  _mdMode = 'edit';
  const preview = document.getElementById('md-preview');
  const ta = document.getElementById('md-editor-textarea');
  if (!preview || !ta) return;
  preview.classList.add('hidden');
  ta.classList.remove('hidden');
  ta.value = _mdRawContent;
  ta.addEventListener('input', _mdOnInput);
  ta.addEventListener('keydown', _mdOnKeydown);
  ta.addEventListener('blur', _mdOnBlur);
  ta.focus();
}

function _mdOnBlur() {
  // Delay so toolbar button clicks don't trigger preview switch
  setTimeout(() => {
    const ta = document.getElementById('md-editor-textarea');
    if (!ta || document.activeElement === ta) return;
    // If focus went to a toolbar button, refocus textarea
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.md-tb-btn')) {
      ta.focus();
      return;
    }
    _mdEnterPreview();
  }, 150);
}

function _mdEnterPreview() {
  if (_mdMode === 'preview') return;
  _mdMode = 'preview';
  const preview = document.getElementById('md-preview');
  const ta = document.getElementById('md-editor-textarea');
  if (!preview || !ta) return;
  _mdRawContent = ta.value;
  preview.innerHTML = marked.parse(_mdRawContent);
  renderLatexIn('md-preview');
  _rewriteExpImages(preview);
  preview.classList.remove('hidden');
  ta.classList.add('hidden');
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
    method:'PUT', headers:{ ..._authHeaders(), 'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const ind = document.getElementById('md-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

// ── Markdown Toolbar Helpers ──

function _mdWrap(before, after) {
  const ta = document.getElementById('md-editor-textarea');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = ta.value;
  const selected = text.slice(start, end);
  // If selection is already wrapped, unwrap it
  if (start >= before.length && text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
    ta.value = text.slice(0, start - before.length) + selected + text.slice(end + after.length);
    ta.selectionStart = start - before.length;
    ta.selectionEnd = end - before.length;
  } else {
    const replacement = before + (selected || 'text') + after;
    ta.value = text.slice(0, start) + replacement + text.slice(end);
    if (selected) {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = end + before.length;
    } else {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + 4; // select 'text'
    }
  }
  ta.focus();
  _mdOnInput();
}

function _mdLinePrefix(prefix) {
  const ta = document.getElementById('md-editor-textarea');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = ta.value;
  // Find the start of the current line
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const actualEnd = lineEnd === -1 ? text.length : lineEnd;
  const lines = text.slice(lineStart, actualEnd).split('\n');
  const prefixed = lines.map(line => {
    // If line already has this prefix, remove it (toggle)
    if (line.startsWith(prefix)) return line.slice(prefix.length);
    // For headings, remove any existing heading prefix first
    if (prefix.match(/^#{1,3} $/)) {
      const stripped = line.replace(/^#{1,6} /, '');
      return prefix + stripped;
    }
    return prefix + line;
  }).join('\n');
  ta.value = text.slice(0, lineStart) + prefixed + text.slice(actualEnd);
  ta.selectionStart = lineStart;
  ta.selectionEnd = lineStart + prefixed.length;
  ta.focus();
  _mdOnInput();
}

function _mdInsertCodeBlock() {
  const ta = document.getElementById('md-editor-textarea');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = ta.value;
  const selected = text.slice(start, end);
  const block = '\n```\n' + (selected || 'code') + '\n```\n';
  ta.value = text.slice(0, start) + block + text.slice(end);
  if (selected) {
    ta.selectionStart = start + 4;
    ta.selectionEnd = start + 4 + selected.length;
  } else {
    ta.selectionStart = start + 4;
    ta.selectionEnd = start + 8;
  }
  ta.focus();
  _mdOnInput();
}

function _mdInsertLink() {
  const ta = document.getElementById('md-editor-textarea');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = ta.value;
  const selected = text.slice(start, end);
  const link = '[' + (selected || 'text') + '](url)';
  ta.value = text.slice(0, start) + link + text.slice(end);
  if (selected) {
    // Select the 'url' part
    ta.selectionStart = start + selected.length + 3;
    ta.selectionEnd = start + selected.length + 6;
  } else {
    // Select 'text'
    ta.selectionStart = start + 1;
    ta.selectionEnd = start + 5;
  }
  ta.focus();
  _mdOnInput();
}

function _mdInsertHr() {
  const ta = document.getElementById('md-editor-textarea');
  if (!ta) return;
  const start = ta.selectionStart;
  const text = ta.value;
  const hr = '\n---\n';
  ta.value = text.slice(0, start) + hr + text.slice(start);
  ta.selectionStart = ta.selectionEnd = start + hr.length;
  ta.focus();
  _mdOnInput();
}

function _mdOnKeydown(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'b') { e.preventDefault(); _mdWrap('**', '**'); }
  else if (e.key === 'i') { e.preventDefault(); _mdWrap('*', '*'); }
  else if (e.key === 'k') { e.preventDefault(); _mdInsertLink(); }
  else if (e.key === 'e') { e.preventDefault(); _mdWrap('`', '`'); }
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
        fileShareButton() +
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
        fileShareButton() +
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
      <span class="flex items-center gap-1 text-[0.7rem] text-dimmer"><span id="py-kernel-dot" class="w-1.5 h-1.5 rounded-full inline-block bg-emerald-500"></span><span id="py-kernel-text">idle</span></span>
      <span id="venv-info" class="text-[0.68rem] text-dimmer flex items-center gap-1 truncate"></span>
      <span class="text-[0.7rem] text-emerald-400 opacity-0 transition-opacity" id="py-save-ind">Saved</span>
      <div class="ml-auto flex items-center gap-1.5 shrink-0">
        ${fileShareButton()}
        <button onclick="restartKernel()" class="w-7 h-7 rounded flex items-center justify-center border-none bg-transparent text-dimmer cursor-pointer hover:text-primary" title="Restart kernel"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg></button>
        <div class="relative inline-flex items-center">
          <button class="px-1.5 py-0.5 rounded border-none bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="toggleVenvMenu()">Env</button>
          <div id="py-venv-menu" class="hidden absolute right-0 top-full mt-1 z-50 bg-card border border-border-card rounded-lg shadow-lg py-1 min-w-[220px]">
            <div id="venv-menu-status" class="px-3 py-1.5 text-[0.7rem] text-muted flex items-center gap-1.5"></div>
            <div class="h-px bg-border-subtle mx-2 my-0.5"></div>
            <div class="px-3 py-1.5 text-[0.68rem] text-dimmest uppercase tracking-wide">Environment</div>
            <div class="px-3 py-1"><select id="py-venv-select" onchange="switchVenv(this.value)" class="w-full px-1.5 py-1 rounded border border-border-input bg-input text-primary text-[0.7rem] cursor-pointer focus:outline-none focus:border-accent"><option value="python3" ${pythonPath === 'python3' ? 'selected' : ''}>System python3</option></select></div>
            <button id="btn-create-venv" class="w-full text-left px-3 py-1.5 bg-transparent border-none text-[0.75rem] text-muted cursor-pointer hover:bg-hover hover:text-primary transition-colors" onclick="createVenv()">+ Create venv</button>
            <div id="venv-create-status" class="px-3 py-0.5 text-[0.68rem] hidden"></div>
            <div id="venv-delete-list"></div>
            <div id="venv-size-info" class="px-3 py-1 text-[0.68rem] text-dimmest"></div>
            <div class="h-px bg-border-subtle mx-2 my-1"></div>
            <div class="px-3 py-1.5 text-[0.68rem] text-dimmest uppercase tracking-wide">Packages</div>
            <div class="px-3 py-1">
              <div class="flex items-center gap-2 mb-1.5">
                <input type="text" id="pkg-install-input" placeholder="e.g. numpy pandas" class="flex-1 px-2 py-1 rounded border border-border-input bg-input text-primary text-[0.72rem] placeholder:text-dimmer focus:outline-none focus:border-accent" onkeydown="if(event.key==='Enter')installPackages()" />
                <button class="bg-transparent border-none text-muted text-[0.72rem] cursor-pointer hover:text-primary transition-colors whitespace-nowrap" id="pkg-install-btn" onclick="installPackages()">Install</button>
              </div>
              <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <span class="text-[0.65rem] text-dimmest">Quick:</span>
                <button class="px-1 py-0.5 rounded text-[0.65rem] bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover transition-colors" onclick="_quickInstallPkgs('gymnasium ale-py AutoROM')">RL</button>
                <button class="px-1 py-0.5 rounded text-[0.65rem] bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover transition-colors" onclick="_quickInstallPkgs('numpy pandas matplotlib')">Data Sci</button>
                <button class="px-1 py-0.5 rounded text-[0.65rem] bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover transition-colors" onclick="_quickInstallPkgs('torch torchvision')">PyTorch</button>
                <button class="px-1 py-0.5 rounded text-[0.65rem] bg-transparent border-none text-dimmer cursor-pointer hover:text-primary hover:bg-hover transition-colors" onclick="_quickInstallPkgs('jax jaxlib flax')">JAX</button>
              </div>
              <div id="pkg-install-status" class="text-[0.72rem] mb-1 hidden"></div>
              <div id="pkg-list" class="text-[0.72rem] text-muted max-h-[200px] overflow-y-auto">Loading...</div>
            </div>
          </div>
        </div>
        <button onclick="togglePyOutput()" class="w-7 h-7 rounded flex items-center justify-center border-none bg-transparent text-dimmer cursor-pointer hover:text-primary" title="Toggle output (⌘J)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/></svg></button>
        <button onclick="copyPyFile()" class="w-7 h-7 rounded flex items-center justify-center border-none bg-transparent text-dimmer cursor-pointer hover:text-primary" id="py-copy-btn" title="Copy file contents"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button onclick="runPythonFile()" class="w-7 h-7 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" id="py-run-btn" title="Run file (Shift+Enter)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"/></svg></button>
      </div>
    </div>
    <div class="border-t border-border-dim" style="flex:1 1 0%;min-height:0;overflow:hidden;display:flex;flex-direction:column">
      <textarea id="py-editor-textarea">${escapeHtml(content)}</textarea>
    </div>
    <div id="py-output" class="hidden border-t border-border-dim overflow-hidden shrink-0" style="height:200px">
      <div id="py-output-drag" class="py-output-drag-handle" title="Drag to resize"></div>
      <div class="flex items-center justify-between px-3 py-1 bg-card/30 border-b border-border-dim">
        <span class="text-[0.7rem] text-muted font-medium">Output</span>
        <button onclick="document.getElementById('py-output').classList.add('hidden')" class="text-dimmer hover:text-primary text-[0.8rem] bg-transparent border-none cursor-pointer">&times;</button>
      </div>
      <div id="py-output-scroll" class="overflow-y-auto" style="height:calc(100% - 34px)">
        <div id="py-output-content" class="px-4 py-2 bg-body/50 text-[0.8rem] font-mono text-muted whitespace-pre-wrap"></div>
      </div>
    </div>`;
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
  pyEditorCm.setSize(null, '100%');
  pyEditorCm.on('change', () => {
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(() => savePythonFile(), 600);
  });
  _attachGotoDef(pyEditorCm);
  pyEditorCm.focus();
  loadVenvDropdown(pythonPath);
  _initPyOutputDrag();
}

function _initPyOutputDrag() {
  const handle = document.getElementById('py-output-drag');
  if (!handle) return;
  handle.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const panel = document.getElementById('py-output');
    if (!panel) return;
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    handle.classList.add('active');
    function onMove(e2) {
      const delta = startY - e2.clientY;
      const newH = Math.max(60, Math.min(window.innerHeight * 0.8, startH + delta));
      panel.style.height = newH + 'px';
    }
    function onUp() {
      handle.classList.remove('active');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

function togglePyOutput() {
  const panel = document.getElementById('py-output');
  if (!panel) return;
  panel.classList.toggle('hidden');
}

// Global Cmd+J / Ctrl+J to toggle output when a .py file is open
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
    if (currentFile && currentFile.endsWith('.py') && !currentFile.endsWith('.ipynb')) {
      e.preventDefault();
      togglePyOutput();
    }
  }
});

let _pyRunning = false;

const _pyPlayIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"/></svg>';
const _pyPauseIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg>';

function _pyBtnRun() {
  const btn = document.getElementById('py-run-btn');
  if (!btn) return;
  if (_pyCooldown) {
    btn.innerHTML = _pyPauseIcon;
    btn.className = 'w-7 h-7 rounded flex items-center justify-center bg-gray-500/20 text-dimmer border-none cursor-not-allowed opacity-60';
    btn.disabled = true;
    btn.title = 'Stopping…';
    btn.removeAttribute('onclick');
    setTimeout(() => {
      _pyCooldown = false;
      const b = document.getElementById('py-run-btn');
      if (b) {
        b.innerHTML = _pyPlayIcon;
        b.className = 'w-7 h-7 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30';
        b.disabled = false;
        b.title = 'Run file (Shift+Enter)';
        b.setAttribute('onclick', 'runPythonFile()');
      }
    }, 3000);
  } else {
    btn.innerHTML = _pyPlayIcon;
    btn.className = 'w-7 h-7 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30';
    btn.disabled = false;
    btn.title = 'Run file (Shift+Enter)';
    btn.setAttribute('onclick', 'runPythonFile()');
  }
}

function _pyBtnStop() {
  const btn = document.getElementById('py-run-btn');
  if (btn) {
    btn.innerHTML = _pyPauseIcon;
    btn.className = 'w-7 h-7 rounded flex items-center justify-center bg-red-500/20 text-red-400 border-none cursor-pointer hover:bg-red-500/30';
    btn.title = 'Stop';
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
  let _defLinkMark = null;
  function _clearDefLink() {
    if (_defLinkMark) { _defLinkMark.clear(); _defLinkMark = null; }
  }
  function _updateDefLink(e) {
    _clearDefLink();
    if (!(e.metaKey || e.ctrlKey)) return;
    var pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
    if (pos.outside) return;
    var word = cm.findWordAt(pos);
    var token = cm.getRange(word.anchor, word.head).trim();
    if (!token || !/^[a-zA-Z_]\w*$/.test(token)) return;
    if (_PY_KEYWORDS.has(token)) return;
    // Check if definition exists
    var info = _findPyDefinition(cm, token);
    if (!info && typeof cmInstances !== 'undefined') {
      for (var i = 0; i < cmInstances.length; i++) {
        if (cmInstances[i] && cmInstances[i] !== cm) {
          info = _findPyDefinition(cmInstances[i], token);
          if (info) break;
        }
      }
    }
    if (!info) return;
    _defLinkMark = cm.markText(word.anchor, word.head, { className: 'cm-def-link' });
  }
  wrapper.addEventListener('mousemove', _updateDefLink);
  cm.on('keydown', (cm, e) => { if (e.metaKey || e.ctrlKey) wrapper.classList.add('cm-cmd-held'); });
  cm.on('keyup', (cm, e) => { if (!e.metaKey && !e.ctrlKey) { wrapper.classList.remove('cm-cmd-held'); _clearDefLink(); } });
  wrapper.addEventListener('mouseleave', () => { wrapper.classList.remove('cm-cmd-held'); _clearDefLink(); });
  _initPyHover(cm);
}

// ── Python Variable Hover Tooltips ──
let _pyHoverEl = null;
let _pyHoverTimer = null;
let _pyHoverMarks = [];   // occurrence highlight marks
let _pyHoverToken = null; // last highlighted token to avoid re-marking

const _PY_KEYWORDS = new Set([
  'if','else','elif','for','while','return','import','from','def','class',
  'with','as','try','except','finally','raise','yield','lambda','pass',
  'break','continue','and','or','not','in','is','True','False','None',
  'del','global','nonlocal','assert','async','await','print'
]);

function _clearPyHoverMarks() {
  for (var i = 0; i < _pyHoverMarks.length; i++) _pyHoverMarks[i].clear();
  _pyHoverMarks = [];
  _pyHoverToken = null;
}

function _markOccurrences(cm, token) {
  _clearPyHoverMarks();
  _pyHoverToken = token;
  var text = cm.getValue();
  var pat = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  var m;
  while ((m = pat.exec(text)) !== null) {
    var from = cm.posFromIndex(m.index);
    var to = cm.posFromIndex(m.index + token.length);
    _pyHoverMarks.push(cm.markText(from, to, { className: 'cm-hover-occurrence' }));
  }
}

function _countReferences(cm, token) {
  var text = cm.getValue();
  var pat = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  var count = 0;
  while (pat.exec(text) !== null) count++;
  return count;
}

function _initPyHover(cm) {
  if (!_pyHoverEl) {
    _pyHoverEl = document.createElement('div');
    _pyHoverEl.className = 'py-hover-tooltip';
    _pyHoverEl.style.display = 'none';
    document.body.appendChild(_pyHoverEl);
  }
  const wrapper = cm.getWrapperElement();
  wrapper.addEventListener('mousemove', function(e) {
    clearTimeout(_pyHoverTimer);
    _pyHoverTimer = setTimeout(function() { _updatePyHover(cm, e); }, 150);
  });
  wrapper.addEventListener('mouseleave', function() {
    clearTimeout(_pyHoverTimer);
    _clearPyHoverMarks();
    if (_pyHoverEl) _pyHoverEl.style.display = 'none';
  });
}

function _extractDocstring(lines, defLineIdx) {
  // Look for a docstring on the line(s) after the def/class
  for (var i = defLineIdx + 1; i < lines.length && i <= defLineIdx + 3; i++) {
    var trimmed = lines[i].trim();
    if (!trimmed) continue;
    // Triple-quoted docstring
    var q = null;
    if (trimmed.startsWith('"""')) q = '"""';
    else if (trimmed.startsWith("'''")) q = "'''";
    if (!q) break;
    // Single-line docstring
    var rest = trimmed.slice(3);
    var closeIdx = rest.indexOf(q);
    if (closeIdx >= 0) return rest.slice(0, closeIdx).trim();
    // Multi-line: gather up to 4 lines
    var parts = [rest];
    for (var j = i + 1; j < lines.length && j <= i + 4; j++) {
      var ci = lines[j].indexOf(q);
      if (ci >= 0) { if (lines[j].slice(0, ci).trim()) parts.push(lines[j].slice(0, ci).trim()); break; }
      if (lines[j].trim()) parts.push(lines[j].trim());
    }
    return parts.join(' ').trim();
  }
  return null;
}

function _findPyDefinition(cm, token) {
  var text = cm.getValue();
  var lines = text.split('\n');
  var escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // def token(params) -> returnType:
  var defPat = new RegExp('^([ \\t]*)(async\\s+)?def\\s+' + escaped + '\\s*\\([^)]*\\)(\\s*->\\s*[^:]+)?\\s*:', 'm');
  var m = defPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index).split('\n').length - 1;
    var typeHint = m[3] ? m[3].replace(/^\s*->\s*/, '').trim() : null;
    var defText = m[0].trim();
    // Extract params for count
    var paramsMatch = defText.match(/\(([^)]*)\)/);
    var params = paramsMatch ? paramsMatch[1].split(',').map(function(p){return p.trim();}).filter(function(p){return p && p !== 'self' && p !== 'cls';}) : [];
    var docstring = _extractDocstring(lines, defLine);
    return { kind: 'function', defLine: defLine, defText: defText, typeHint: typeHint ? '-> ' + typeHint : null, params: params, docstring: docstring };
  }

  // class token(bases):
  var clsPat = new RegExp('^([ \\t]*)class\\s+' + escaped + '\\s*(\\([^)]*\\))?\\s*:', 'm');
  m = clsPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index).split('\n').length - 1;
    var bases = m[2] ? m[2].replace(/^\(|\)$/g, '').trim() : null;
    // Count methods in class body
    var indent = m[1].length;
    var methodCount = 0;
    for (var i = defLine + 1; i < lines.length; i++) {
      var lt = lines[i];
      if (lt.trim() === '') continue;
      var li = lt.search(/\S/);
      if (li >= 0 && li <= indent) break; // left the class body
      if (/^\s+(?:async\s+)?def\s+/.test(lt)) methodCount++;
    }
    var docstring = _extractDocstring(lines, defLine);
    return { kind: 'class', defLine: defLine, defText: m[0].trim(), typeHint: bases ? 'extends ' + bases : null, methodCount: methodCount, docstring: docstring };
  }

  // token: Type = value
  var annPat = new RegExp('^([ \\t]*)' + escaped + '\\s*:\\s*([^=\\n]+?)\\s*=', 'm');
  m = annPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index).split('\n').length - 1;
    var fullLine = lines[defLine].trim();
    return { kind: 'variable', defLine: defLine, defText: fullLine, typeHint: m[2].trim() };
  }

  // token = value (simple assignment)
  var assignPat = new RegExp('^([ \\t]*)' + escaped + '\\s*=(?!=)', 'm');
  m = assignPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index).split('\n').length - 1;
    var fullLine = lines[defLine].trim();
    // Try to infer type from RHS
    var rhs = fullLine.slice(fullLine.indexOf('=') + 1).trim();
    var inferred = null;
    if (/^-?\d+$/.test(rhs)) inferred = 'int';
    else if (/^-?\d+\.\d*$/.test(rhs)) inferred = 'float';
    else if (/^(True|False)$/.test(rhs)) inferred = 'bool';
    else if (/^(["'])/.test(rhs) || /^f["']/.test(rhs)) inferred = 'str';
    else if (/^\[/.test(rhs)) inferred = 'list';
    else if (/^\{/.test(rhs)) inferred = rhs.indexOf(':') >= 0 ? 'dict' : 'set';
    else if (/^\(/.test(rhs)) inferred = 'tuple';
    else if (/^None$/.test(rhs)) inferred = 'None';
    return { kind: 'variable', defLine: defLine, defText: fullLine, typeHint: inferred };
  }

  // for token in ... (loop variable)
  var forPat = new RegExp('^([ \\t]*)for\\s+' + escaped + '\\s+(in)\\s+', 'm');
  m = forPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index).split('\n').length - 1;
    var fullLine = lines[defLine].trim();
    return { kind: 'variable', defLine: defLine, defText: fullLine, typeHint: 'loop variable' };
  }

  // import token or from ... import token
  var impPat = new RegExp('(?:^|\\n)\\s*(?:from\\s+\\S+\\s+)?import\\s+(?:[\\w.,\\s]*\\b)' + escaped + '\\b', 'm');
  m = impPat.exec(text);
  if (m) {
    var defLine = text.substring(0, m.index + (m[0].startsWith('\n') ? 1 : 0)).split('\n').length - 1;
    var fullLine = lines[defLine].trim();
    return { kind: 'import', defLine: defLine, defText: fullLine, typeHint: 'module' };
  }

  return null;
}

function _updatePyHover(cm, e) {
  if (!_pyHoverEl) return;
  var pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
  if (pos.outside) { _clearPyHoverMarks(); _pyHoverEl.style.display = 'none'; return; }
  var word = cm.findWordAt(pos);
  var token = cm.getRange(word.anchor, word.head).trim();
  if (!token || !/^[a-zA-Z_]\w*$/.test(token)) { _clearPyHoverMarks(); _pyHoverEl.style.display = 'none'; return; }
  if (_PY_KEYWORDS.has(token)) { _clearPyHoverMarks(); _pyHoverEl.style.display = 'none'; return; }

  // Highlight all occurrences only when Cmd/Ctrl held
  if (e.metaKey || e.ctrlKey) {
    if (_pyHoverToken !== token) _markOccurrences(cm, token);
  } else {
    if (_pyHoverMarks.length) _clearPyHoverMarks();
  }

  var info = _findPyDefinition(cm, token);
  // Search notebook cells if not found
  if (!info && typeof cmInstances !== 'undefined') {
    for (var i = 0; i < cmInstances.length; i++) {
      if (cmInstances[i] && cmInstances[i] !== cm) {
        info = _findPyDefinition(cmInstances[i], token);
        if (info) break;
      }
    }
  }
  if (!info) { _pyHoverEl.style.display = 'none'; return; }

  // Count references and bytes
  var refCount = _countReferences(cm, token);
  var byteSize = new Blob([token]).size;

  // Render
  var kindLabel = info.kind === 'function' ? 'function' : info.kind === 'class' ? 'class' : info.kind === 'import' ? 'import' : 'variable';
  var kindColor = info.kind === 'function' ? '#dcdcaa' : info.kind === 'class' ? '#4ec9b0' : info.kind === 'import' ? '#c586c0' : '#9cdcfe';
  var html = '<div class="py-hover-kind" style="color:' + kindColor + '">' + kindLabel + '</div>';
  html += '<div class="py-hover-def">' + escapeHtml(info.defText) + '</div>';
  if (info.typeHint) {
    html += '<div class="py-hover-type">' + escapeHtml(info.typeHint) + '</div>';
  }
  if (info.kind === 'function' && info.params && info.params.length > 0) {
    html += '<div class="py-hover-detail">' + info.params.length + ' param' + (info.params.length === 1 ? '' : 's') + ': ' + escapeHtml(info.params.join(', ')) + '</div>';
  }
  if (info.kind === 'class' && info.methodCount > 0) {
    html += '<div class="py-hover-detail">' + info.methodCount + ' method' + (info.methodCount === 1 ? '' : 's') + '</div>';
  }
  if (info.docstring) {
    html += '<div class="py-hover-doc">' + escapeHtml(info.docstring) + '</div>';
  }
  html += '<div class="py-hover-meta">';
  html += '<span>line ' + (info.defLine + 1) + '</span>';
  html += '<span>' + refCount + ' ref' + (refCount === 1 ? '' : 's') + '</span>';
  html += '<span>' + byteSize + ' byte' + (byteSize === 1 ? '' : 's') + '</span>';
  html += '</div>';
  _pyHoverEl.innerHTML = html;
  _pyHoverEl.style.display = '';

  // Position above hovered word
  var coords = cm.charCoords(pos, 'page');
  var h = _pyHoverEl.offsetHeight;
  var w = _pyHoverEl.offsetWidth;
  var top = coords.top - h - 6;
  var left = Math.min(Math.max(8, coords.left), window.innerWidth - w - 8);
  if (top < 0) top = coords.bottom + 6;
  _pyHoverEl.style.top = top + 'px';
  _pyHoverEl.style.left = left + 'px';
}

async function _gotoDefInProject(token) {
  if (!currentExpId || !_expFiles) return;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pyFiles = _expFiles.filter(f => f.endsWith('.py') && f !== currentFile);
  for (const fname of pyFiles) {
    try {
      const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`, { headers: _authHeaders() });
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

const _copyIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
const _checkIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function copyPyFile() {
  if (!pyEditorCm) return;
  navigator.clipboard.writeText(pyEditorCm.getValue()).then(() => {
    const btn = document.getElementById('py-copy-btn');
    if (btn) { btn.innerHTML = _checkIcon; btn.classList.add('text-emerald-400'); setTimeout(() => { btn.innerHTML = _copyIcon; btn.classList.remove('text-emerald-400'); }, 1000); }
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
  outPanel.classList.remove('hidden');
  outContent.innerHTML = '<span class="text-dim">Running…</span>';

  await savePythonFile();
  let firstOutput = true;

  _streamExecute(currentExpId, code,
    (out) => {
      if (firstOutput) { outContent.innerHTML = ''; firstOutput = false; }
      outContent.innerHTML += renderCellOutputs([out]);
      const scrollEl = document.getElementById('py-output-scroll');
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
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

// ── Venv Menu ──

function toggleVenvMenu() {
  const menu = document.getElementById('py-venv-menu');
  if (!menu) return;
  const wasHidden = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if (wasHidden) {
    loadPackagesList();
    loadVenvInfo();
    // Close on click outside — use mousedown so it fires before focus changes
    setTimeout(() => {
      document.addEventListener('mousedown', _closeVenvMenuOutside);
    }, 0);
  } else {
    document.removeEventListener('mousedown', _closeVenvMenuOutside);
  }
}

function _closeVenvMenuOutside(e) {
  const menu = document.getElementById('py-venv-menu');
  if (!menu) return;
  // Check if click is inside the menu or its parent (the Env button wrapper)
  if (menu.parentElement.contains(e.target)) return;
  menu.classList.add('hidden');
  document.removeEventListener('mousedown', _closeVenvMenuOutside);
}

async function savePythonFile() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId || !pyEditorCm) return;
  const content = pyEditorCm.getValue();
  await fetch(`/api/experiments/${currentExpId}/files/${currentFile}`, {
    method:'PUT', headers:{ ..._authHeaders(), 'Content-Type':'application/json'},
    body: JSON.stringify({content})
  });
  const ind = document.getElementById('py-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

