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
        '<button onclick="toggleTexMode()" id="tex-toggle-btn" class="px-2.5 py-1 rounded-md text-[0.8rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors">Preview</button>' +
        '<button onclick="compileLatex()" id="tex-compile-btn" class="px-2.5 py-1 rounded-md text-[0.8rem] font-medium bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors">Compile PDF</button>' +
      '</div>' +
    '</div>' +
    '<div id="tex-cm-wrap" class="flex-1 overflow-hidden border-t border-border-input">' +
      '<textarea id="tex-editor-textarea">' + escapeHtml(content) + '</textarea>' +
    '</div>' +
    '<div id="tex-preview-pane" class="hidden flex-1 bg-input items-center justify-center">' +
      '<span class="text-dimmer text-[0.85rem]">Click "Compile PDF" to build the preview</span>' +
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
  });
  _texCm.focus();
}

function toggleTexMode() {
  var wrap = document.getElementById('tex-cm-wrap');
  var pane = document.getElementById('tex-preview-pane');
  var btn = document.getElementById('tex-toggle-btn');
  if (_texMode === 'code') {
    _texMode = 'preview';
    wrap.style.display = 'none';
    pane.style.display = 'flex';
    pane.classList.remove('hidden');
    btn.textContent = 'Code';
  } else {
    _texMode = 'code';
    wrap.style.display = '';
    pane.style.display = 'none';
    btn.textContent = 'Preview';
    if (_texCm) _texCm.refresh();
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
    var pane = document.getElementById('tex-preview-pane');
    pane.innerHTML = '<iframe src="' + _texPdfUrl + '" class="w-full h-full rounded-lg" style="border:none"></iframe>';
    // Switch to preview mode
    if (_texMode === 'code') toggleTexMode();
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

// ── Notebook Editor ──
let nbData = null;
let kernelStatus = 'idle';
let cmInstances = [];

function renderNotebookEditor(fname, contentStr) {
  try { nbData = JSON.parse(contentStr); } catch(e) {
    nbData = { cells: [{cell_type:'code',source:'',outputs:[]}], metadata:{}, nbformat:4, nbformat_minor:5 };
  }
  const editor = document.getElementById('exp-file-editor');
  const pythonPath = (currentExp && currentExp.pythonPath) || 'python3';
  const hasVenv = pythonPath.includes('/venv/');
  editor.innerHTML = `
    <div class="flex items-center gap-2 mb-2">
      <span class="text-[0.7rem] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">nb</span>
      <span class="text-[0.85rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInEditor('${escapeHtml(fname).replace(/'/g, "\\'")}')" title="Click to rename">${escapeHtml(fname)}</span>
      <span class="text-[0.7rem] text-emerald-400 opacity-0 transition-opacity" id="nb-save-ind">Saved</span>
    </div>
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <span class="flex items-center gap-1 text-[0.7rem] text-dim">
        <span id="kernel-dot" class="w-1.5 h-1.5 rounded-full bg-gray-500 inline-block"></span>
        <span id="kernel-status-text">idle</span>
      </span>
      <span id="venv-info" class="text-[0.68rem] text-dimmer flex items-center gap-1"></span>
      <div class="ml-auto flex items-center gap-1.5">
        <button class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="restartKernel()">Restart</button>
        <select id="nb-venv-select" class="px-1.5 py-0.5 rounded border border-border-input bg-input text-primary text-[0.7rem] cursor-pointer focus:outline-none focus:border-accent" onchange="switchVenv(this.value)">
          <option value="python3" ${pythonPath === 'python3' ? 'selected' : ''}>System python3</option>
        </select>
        <button id="btn-create-venv" class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="createVenv()">+ venv</button>
        <button class="px-1.5 py-0.5 rounded border border-border-input bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="togglePackagesPanel()">Packages</button>
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
    <div id="nb-cells"></div>
    <div class="flex gap-2 mt-3 pb-40">
      <button class="px-3 py-1.5 rounded-md border border-border-input bg-transparent text-muted text-[0.8rem] cursor-pointer hover:text-primary" onclick="addNbCell('code')">+ Code</button>
      <button class="px-3 py-1.5 rounded-md border border-border-input bg-transparent text-muted text-[0.8rem] cursor-pointer hover:text-primary" onclick="addNbCell('markdown')">+ Markdown</button>
    </div>`;
  renderNbCells();
  loadVenvDropdown(pythonPath);
}

async function loadVenvDropdown(currentPath) {
  const select = document.getElementById('nb-venv-select') || document.getElementById('py-venv-select');
  if (!select) return;
  try {
    const resp = await fetch('/api/venvs');
    const venvs = await resp.json();
    let html = `<option value="python3" ${currentPath === 'python3' ? 'selected' : ''}>System python3</option>`;
    venvs.forEach(v => {
      const label = v.id === currentExpId ? `venv (this project)` : `venv (${v.title})`;
      html += `<option value="${escapeHtml(v.pythonPath)}" ${currentPath === v.pythonPath ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    });
    select.innerHTML = html;
  } catch(e) { /* keep default */ }
  loadVenvInfo();
}

async function loadVenvInfo() {
  const el = document.getElementById('venv-info');
  if (!el || !currentExpId) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/venv-info`);
    const info = await resp.json();
    if (!info.hasVenv) {
      el.innerHTML = '<span class="text-dimmer">No venv</span>';
      return;
    }
    el.innerHTML = `<span title="${escapeHtml(info.venvPath || '')}">${escapeHtml(info.pythonVersion || 'Python')}</span>`
      + `<span class="text-border-input">·</span>`
      + `<span>${info.packageCount || 0} pkg${info.packageCount !== 1 ? 's' : ''}</span>`
      + `<span class="text-border-input">·</span>`
      + `<span>${escapeHtml(info.diskSize || '?')}</span>`;
  } catch(e) {
    el.innerHTML = '';
  }
}

async function switchVenv(pythonPath) {
  await fetch(`/api/experiments/${currentExpId}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({pythonPath})
  });
  if (currentExp) currentExp.pythonPath = pythonPath;
  updateKernelStatus('dead');
  try {
    await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
    updateKernelStatus('idle');
  } catch(e) { /* will restart on next run */ }
  loadVenvInfo();
}

async function createVenv() {
  const btn = document.getElementById('btn-create-venv');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Creating...';
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/venv`, { method: 'POST' });
    const data = await resp.json();
    if (data.ok) {
      if (currentExp) currentExp.pythonPath = data.pythonPath;
      updateKernelStatus('dead');
      await loadVenvDropdown(data.pythonPath);
      btn.textContent = '+ venv';
      btn.disabled = false;
      try {
        await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
        updateKernelStatus('idle');
      } catch(e) { /* will restart on next run */ }
      loadVenvInfo();
    } else {
      btn.textContent = 'Failed';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '+ venv'; }, 2000);
    }
  } catch(e) {
    btn.textContent = 'Error';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = '+ venv'; }, 2000);
  }
}

function togglePackagesPanel() {
  const panel = document.getElementById('packages-panel');
  if (!panel) return;
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (wasHidden) loadPackagesList();
}

async function loadPackagesList() {
  const listEl = document.getElementById('pkg-list');
  if (!listEl) return;
  listEl.textContent = 'Loading...';
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/packages`);
    const packages = await resp.json();
    if (!packages.length) {
      listEl.innerHTML = '<span class="text-dim">No packages installed</span>';
      return;
    }
    listEl.innerHTML = `<div class="flex flex-wrap gap-1.5">${packages.map(p =>
      `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface text-[0.75rem] border border-border-input">
        ${escapeHtml(p.name)} <span class="text-dim">${escapeHtml(p.version)}</span>
        <button class="ml-1 text-red-400 hover:text-red-300 cursor-pointer bg-transparent border-none p-0 text-[0.7rem]" onclick="uninstallPackage('${escapeHtml(p.name)}')" title="Uninstall">&times;</button>
      </span>`
    ).join('')}</div>`;
  } catch(e) {
    listEl.innerHTML = '<span class="text-red-400">Failed to load packages</span>';
  }
}

async function installPackages() {
  const input = document.getElementById('pkg-install-input');
  const statusEl = document.getElementById('pkg-install-status');
  if (!input || !input.value.trim()) return;
  const packages = input.value.trim();
  input.disabled = true;
  if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'text-[0.75rem] mb-2 text-muted'; statusEl.textContent = `Installing ${packages}...`; }
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/packages`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ packages })
    });
    const data = await resp.json();
    if (data.ok) {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-emerald-400'; statusEl.textContent = 'Installed — kernel restarting...'; }
      input.value = '';
      loadPackagesList();
      updateKernelStatus('dead');
      try {
        await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
        updateKernelStatus('idle');
      } catch(e) { /* kernel will be recreated on next run */ }
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-emerald-400'; statusEl.textContent = 'Installed — kernel ready'; }
      setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
    } else {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-red-400'; statusEl.textContent = data.error || 'Install failed'; }
    }
  } catch(e) {
    if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-red-400'; statusEl.textContent = 'Install failed'; }
  }
  input.disabled = false;
}

async function uninstallPackage(name) {
  const statusEl = document.getElementById('pkg-install-status');
  if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'text-[0.75rem] mb-2 text-muted'; statusEl.textContent = `Uninstalling ${name}...`; }
  try {
    await fetch(`/api/experiments/${currentExpId}/packages/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadPackagesList();
    updateKernelStatus('dead');
    try {
      await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
      updateKernelStatus('idle');
    } catch(e) { /* kernel will be recreated on next run */ }
    if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-emerald-400'; statusEl.textContent = `${name} uninstalled`; }
    setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
  } catch(e) {
    if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-red-400'; statusEl.textContent = 'Uninstall failed'; }
  }
}

function renderCellOutputs(outputs) {
  return outputs.map(o => {
    if (o.output_type === 'stream') {
      const text = Array.isArray(o.text) ? o.text.join('') : (o.text || '');
      if (!text) return '';
      const cls = o.name === 'stderr' ? 'text-red-400' : '';
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    }
    if (o.output_type === 'error') {
      const tb = (o.traceback || []).join('\n');
      const clean = tb.replace(/\x1b\[[0-9;]*m/g, '');
      return `<div class="text-red-400">${escapeHtml(clean || (o.ename + ': ' + o.evalue))}</div>`;
    }
    if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
      const data = o.data || {};
      const parts = [];
      if (data['image/png']) {
        const imgSrc = `data:image/png;base64,${data['image/png']}`;
        parts.push(`<div class="relative nb-img-wrap inline-block"><img src="${imgSrc}" class="max-w-full rounded" /><div class="absolute top-2 right-2 flex gap-1 opacity-0 nb-img-btns transition-opacity"><button onclick="saveOutputImage(this.closest('.nb-img-wrap').querySelector('img').src, 'png')" class="px-2 py-1 rounded bg-black/70 text-white text-[0.7rem] border-none cursor-pointer hover:bg-black/90">Download</button><button onclick="saveOutputToProject(this.closest('.nb-img-wrap').querySelector('img').src, 'png', this)" class="px-2 py-1 rounded bg-black/70 text-white text-[0.7rem] border-none cursor-pointer hover:bg-black/90">Save to project</button></div></div>`);
      }
      if (data['image/svg+xml']) {
        const svg = Array.isArray(data['image/svg+xml']) ? data['image/svg+xml'].join('') : data['image/svg+xml'];
        parts.push(`<div class="relative nb-img-wrap inline-block max-w-full"><div class="nb-svg-output">${svg}</div><div class="absolute top-2 right-2 flex gap-1 opacity-0 nb-img-btns transition-opacity"><button onclick="saveOutputSvg(this.closest('.nb-img-wrap').querySelector('.nb-svg-output').innerHTML)" class="px-2 py-1 rounded bg-black/70 text-white text-[0.7rem] border-none cursor-pointer hover:bg-black/90">Download</button><button onclick="saveOutputSvgToProject(this.closest('.nb-img-wrap').querySelector('.nb-svg-output').innerHTML, this)" class="px-2 py-1 rounded bg-black/70 text-white text-[0.7rem] border-none cursor-pointer hover:bg-black/90">Save to project</button></div></div>`);
      }
      if (data['text/html']) {
        const html = Array.isArray(data['text/html']) ? data['text/html'].join('') : data['text/html'];
        parts.push(`<div class="nb-html-output">${html}</div>`);
      }
      if (data['text/latex']) {
        const latex = Array.isArray(data['text/latex']) ? data['text/latex'].join('') : data['text/latex'];
        parts.push(`<div class="text-muted">${escapeHtml(latex)}</div>`);
      }
      if (!parts.length && data['text/plain']) {
        const t = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
        parts.push(`<div>${escapeHtml(t)}</div>`);
      }
      return parts.join('');
    }
    return '';
  }).filter(Boolean).join('');
}

function saveOutputImage(dataUrl, ext) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `output.${ext}`;
  a.click();
}

function saveOutputSvg(svgHtml) {
  const blob = new Blob([svgHtml], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'output.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function saveOutputToProject(dataUrl, ext, btn) {
  if (!currentExpId) return;
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/files`);
    const existing = await resp.json();
    let name = `output.${ext}`, i = 2;
    while (existing.includes(name)) { name = `output-${i}.${ext}`; i++; }
    const saveResp = await fetch(`/api/experiments/${currentExpId}/files`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, content: dataUrl })
    });
    if (saveResp.ok) {
      if (btn) btn.textContent = 'Saved ✓';
      fetchExpFiles();
    } else {
      if (btn) btn.textContent = 'Failed';
    }
  } catch {
    if (btn) btn.textContent = 'Failed';
  }
  if (btn) setTimeout(() => { btn.textContent = 'Save to project'; btn.disabled = false; }, 2000);
}

async function saveOutputSvgToProject(svgHtml, btn) {
  if (!currentExpId) return;
  const b64 = btoa(unescape(encodeURIComponent(svgHtml)));
  const dataUrl = `data:image/svg+xml;base64,${b64}`;
  await saveOutputToProject(dataUrl, 'svg', btn);
}

function renderNbCells() {
  const container = document.getElementById('nb-cells');
  if (!container || !nbData) return;
  cmInstances = [];
  const cellDivider = (idx) => `<div class="nb-cell-divider group/div flex items-center justify-center h-2 -my-0.5 relative z-10">
      <div class="hidden group-hover/div:flex items-center gap-1 absolute bg-[var(--bg-body)] px-2 z-10">
        <button onclick="insertNbCell(${idx},'code')" class="px-2 py-0.5 rounded text-[0.65rem] border border-border-dim bg-card/50 text-dimmer cursor-pointer hover:text-emerald-400 hover:border-emerald-400/40 transition-colors">+ Code</button>
        <button onclick="insertNbCell(${idx},'markdown')" class="px-2 py-0.5 rounded text-[0.65rem] border border-border-dim bg-card/50 text-dimmer cursor-pointer hover:text-blue-400 hover:border-blue-400/40 transition-colors">+ Markdown</button>
      </div>
      <div class="hidden group-hover/div:block absolute inset-x-0 top-1/2 border-t border-border-dim -z-0"></div>
    </div>`;

  container.innerHTML = nbData.cells.map((cell, i) => {
    const isCode = cell.cell_type === 'code';
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const cellOutputs = cell.outputs || [];
    const hasOutput = cellOutputs.length > 0;
    // Only render a lightweight preview (first 20 outputs max)
    const previewOutputs = cellOutputs.slice(0, 20);
    const outputs = renderCellOutputs(previewOutputs);
    const hasMore = cellOutputs.length > 20;

    return (i === 0 ? cellDivider(0) : '') + `<div class="mb-0 rounded-lg border border-border-dim overflow-hidden" data-cell="${i}">
      <div class="flex items-center gap-2 px-3 py-1.5 bg-card/30 border-b border-border-dim">
        <span class="text-[0.7rem] ${isCode ? 'text-emerald-400' : 'text-blue-400'} font-medium">${isCode ? 'Code' : 'Markdown'}</span>
        <span class="text-[0.65rem] text-dimmer">[${i+1}]</span>
        <div class="ml-auto flex gap-1">
          ${isCode ? `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)">Run</button>` : ''}
          ${!isCode ? `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-blue-500/20 text-blue-400 border-none cursor-pointer hover:bg-blue-500/30" onclick="renderMdCell(${i})" title="Render (Shift+Enter)">Render</button>` : ''}
          ${isCode ? `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-blue-500/10 text-blue-400 border-none cursor-pointer hover:bg-blue-500/20" onclick="exportCellToPy(${i})" title="Export to .py file">.py</button>` : ''}
          ${i > 0 ? `<button class="w-6 h-6 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary text-[0.8rem]" onclick="moveNbCell(${i},-1)" title="Move up">&uarr;</button>` : ''}
          ${i < nbData.cells.length-1 ? `<button class="w-6 h-6 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary text-[0.8rem]" onclick="moveNbCell(${i},1)" title="Move down">&darr;</button>` : ''}
          <button class="w-6 h-6 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 text-[0.8rem]" onclick="deleteNbCell(${i})" title="Delete">&times;</button>
        </div>
      </div>
      <div data-cell-editor="${i}"><textarea data-cell-input="${i}" class="w-full bg-[var(--bg-body)] text-[var(--text-primary)] border-none outline-none resize-none p-3 font-mono text-[0.85rem]" rows="3">${escapeHtml(src)}</textarea></div>
      <div data-cell-rendered="${i}" class="hidden px-4 py-3 nb-rendered-md text-[0.85rem] cursor-pointer" onclick="editMdCell(${i})" title="Click to edit"></div>
      <div class="${hasOutput ? '' : 'hidden '}border-t border-border-dim" data-cell-output-wrap="${i}">
        <div class="cell-output-wrap" data-cell-output-scroll="${i}">
          <div class="px-4 py-2 bg-body/50 text-[0.8rem] font-mono text-muted whitespace-pre-wrap" data-cell-output="${i}">${outputs || ''}</div>
          <div class="cell-output-toggle" onclick="toggleOutputExpand(${i})">${hasMore ? `Show all output (${cellOutputs.length} items)` : 'Show all output'}</div>
        </div>
      </div>
    </div>` + cellDivider(i + 1);
  }).join('');

  nbData.cells.forEach((cell, i) => {
    const ta = container.querySelector(`[data-cell-input="${i}"]`);
    if (!ta) { cmInstances.push(null); return; }
    const isCode = cell.cell_type === 'code';
    const cellSrc = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const cm = CodeMirror.fromTextArea(ta, {
      mode: isCode ? 'python' : 'markdown',
      lineNumbers: true,
      matchBrackets: isCode,
      autoCloseBrackets: isCode,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      lineWrapping: true,
      viewportMargin: Infinity,
      extraKeys: {
        'Shift-Enter': function() { if (isCode) runNbCell(i); else renderMdCell(i); },
        'Cmd-/': function(cm) { cm.toggleComment(); },
        'Ctrl-/': function(cm) { cm.toggleComment(); },
        'Tab': function(cm) {
          if (cm.somethingSelected()) cm.indentSelection('add');
          else cm.replaceSelection('    ', 'end');
        }
      }
    });
    cm.on('change', () => {
      if (!nbData || !nbData.cells[i]) return;
      nbData.cells[i].source = cm.getValue();
      scheduleNbSave();
    });
    cmInstances.push(cm);
    // Auto-render markdown cells that have content
    if (!isCode && cellSrc.trim()) {
      renderMdCell(i);
    }
  });
}

function updateNbCellSource(i, val) {
  if (!nbData || !nbData.cells[i]) return;
  nbData.cells[i].source = val;
  scheduleNbSave();
}

function scheduleNbSave() {
  clearTimeout(fileSaveTimer);
  fileSaveTimer = setTimeout(() => saveNotebook(), 600);
}

async function saveNotebook() {
  fileSaveTimer = null;
  if (!currentFile || !currentExpId || !nbData) return;
  await fetch(`/api/experiments/${currentExpId}/files/${currentFile}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content: JSON.stringify(nbData, null, 2)})
  });
  const ind = document.getElementById('nb-save-ind');
  if (ind) { ind.style.opacity='1'; setTimeout(()=>ind.style.opacity='0',1500); }
}

function addNbCell(type) {
  if (!nbData) return;
  nbData.cells.push({cell_type: type, source: '', outputs: []});
  renderNbCells();
  scheduleNbSave();
  setTimeout(() => {
    const cm = cmInstances[nbData.cells.length - 1];
    if (cm) cm.focus();
  }, 50);
}

function insertNbCell(atIndex, type) {
  if (!nbData) return;
  nbData.cells.splice(atIndex, 0, {cell_type: type, source: '', outputs: []});
  renderNbCells();
  scheduleNbSave();
  setTimeout(() => {
    const cm = cmInstances[atIndex];
    if (cm) cm.focus();
  }, 50);
}

function deleteNbCell(i) {
  if (!nbData || nbData.cells.length <= 1) return;
  nbData.cells.splice(i, 1);
  renderNbCells();
  scheduleNbSave();
}

function moveNbCell(i, dir) {
  if (!nbData) return;
  const j = i + dir;
  if (j < 0 || j >= nbData.cells.length) return;
  [nbData.cells[i], nbData.cells[j]] = [nbData.cells[j], nbData.cells[i]];
  renderNbCells();
  scheduleNbSave();
}

async function exportCellToPy(i) {
  if (!nbData || !nbData.cells[i]) return;
  const src = Array.isArray(nbData.cells[i].source) ? nbData.cells[i].source.join('') : nbData.cells[i].source;
  if (!src.trim()) return;
  const name = await createExpFile('.py', src);
  const btn = document.querySelector(`[data-cell="${i}"] .text-blue-400`);
  if (btn && btn.textContent === '.py') { btn.textContent = 'Saved!'; setTimeout(() => { btn.textContent = '.py'; }, 1500); }
}

let _nbRunningCell = -1;
let _execAbort = null;

async function interruptKernel() {
  if (!currentExpId) return;
  if (_execAbort) { _execAbort.abort(); _execAbort = null; }
  try {
    await fetch(`/api/experiments/${currentExpId}/kernel/interrupt`, {method:'POST'});
  } catch(e) { /* best effort */ }
}

function _streamExecute(expId, code, onOutput, onDone, onError) {
  const abort = new AbortController();
  _execAbort = abort;
  fetch(`/api/experiments/${expId}/execute`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ code, stream: true }),
    signal: abort.signal
  }).then(resp => {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    function pump() {
      reader.read().then(({done, value}) => {
        if (done) { onDone(); return; }
        buf += decoder.decode(value, {stream: true});
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const lines = part.split('\n');
          let event = '', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (event === 'output' && data) {
            try { onOutput(JSON.parse(data)); } catch(e) {}
          } else if (event === 'done') {
            onDone();
            return;
          }
        }
        pump();
      }).catch(e => {
        if (e.name !== 'AbortError') onError(e);
        else onDone();
      });
    }
    pump();
  }).catch(e => {
    if (e.name !== 'AbortError') onError(e);
    else onDone();
  });
  return abort;
}

function _swapToStop(cellEl, i) {
  if (!cellEl) return;
  const header = cellEl.querySelector('.ml-auto');
  const runBtn = header && header.querySelector('[onclick^="runNbCell"]');
  if (runBtn) {
    runBtn.outerHTML = `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-red-500/20 text-red-400 border-none cursor-pointer hover:bg-red-500/30" onclick="stopNbCell(${i})" title="Stop cell">Stop</button>`;
  }
}

let _runCooldown = false;

function _swapToRun(cellEl, i) {
  if (!cellEl) return;
  const header = cellEl.querySelector('.ml-auto');
  const btn = header && (header.querySelector('[onclick^="stopNbCell"]') || header.querySelector('[onclick^="runNbCell"]'));
  if (!btn) return;
  if (_runCooldown) {
    btn.outerHTML = `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-gray-500/20 text-dimmer border-none cursor-not-allowed opacity-60" disabled id="nb-cooldown-btn-${i}">Stopping…</button>`;
    setTimeout(() => {
      const cb = document.getElementById(`nb-cooldown-btn-${i}`);
      if (cb) cb.outerHTML = `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)">Run</button>`;
      _runCooldown = false;
    }, 3000);
  } else {
    btn.outerHTML = `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)">Run</button>`;
  }
}

async function runNbCell(i) {
  if (!nbData || !nbData.cells[i] || nbData.cells[i].cell_type !== 'code') return;
  const src = Array.isArray(nbData.cells[i].source) ? nbData.cells[i].source.join('') : nbData.cells[i].source;
  if (!src.trim()) return;

  _nbRunningCell = i;
  updateKernelStatus('busy');
  const outWrap = document.querySelector(`[data-cell-output-wrap="${i}"]`);
  const outEl = document.querySelector(`[data-cell-output="${i}"]`);
  const outScroll = document.querySelector(`[data-cell-output-scroll="${i}"]`);
  if (outWrap) outWrap.classList.remove('hidden');
  if (outEl) { outEl.innerHTML = '<span class="text-dim">Running…</span>'; delete outEl.dataset.full; }
  if (outScroll) outScroll.classList.remove('expanded');

  const cellEl = document.querySelector(`[data-cell="${i}"]`);
  _swapToStop(cellEl, i);

  const collectedOutputs = [];
  let firstOutput = true;

  _streamExecute(currentExpId, src,
    (out) => {
      collectedOutputs.push(out);
      if (outEl) {
        if (firstOutput) { outEl.innerHTML = ''; firstOutput = false; }
        outEl.innerHTML += renderCellOutputs([out]);
      }
      if (outWrap) outWrap.classList.remove('hidden');
    },
    () => {
      nbData.cells[i].outputs = collectedOutputs;
      if (!collectedOutputs.length && outWrap) outWrap.classList.add('hidden');
      if (outEl) outEl.dataset.full = '1';
      updateKernelStatus('idle');
      _nbRunningCell = -1;
      _execAbort = null;
      _swapToRun(document.querySelector(`[data-cell="${i}"]`), i);
      scheduleNbSave();
    },
    (e) => {
      if (outEl) outEl.innerHTML = `<span class="text-red-400">${escapeHtml(e.message)}</span>`;
      if (outWrap) outWrap.classList.remove('hidden');
      updateKernelStatus('dead');
      _nbRunningCell = -1;
      _execAbort = null;
      _swapToRun(document.querySelector(`[data-cell="${i}"]`), i);
    }
  );
}

async function stopNbCell(i) {
  _runCooldown = true;
  const cellEl = document.querySelector(`[data-cell="${i}"]`);
  if (cellEl) {
    const btn = cellEl.querySelector('[onclick^="stopNbCell"]');
    if (btn) { btn.textContent = 'Stopping…'; btn.disabled = true; btn.classList.add('opacity-60'); }
  }
  await interruptKernel();
}

function toggleOutputExpand(i) {
  const wrap = document.querySelector(`[data-cell-output-scroll="${i}"]`);
  if (!wrap) return;
  const expanded = wrap.classList.toggle('expanded');
  const toggle = wrap.querySelector('.cell-output-toggle');
  if (expanded && nbData && nbData.cells[i]) {
    // Lazily render full output on first expand
    const outEl = document.querySelector(`[data-cell-output="${i}"]`);
    if (outEl && !outEl.dataset.full) {
      outEl.innerHTML = renderCellOutputs(nbData.cells[i].outputs || []);
      outEl.dataset.full = '1';
    }
    if (toggle) toggle.textContent = 'Collapse output';
  } else {
    if (toggle) toggle.textContent = 'Show all output';
  }
}

function togglePyOutputExpand() {
  const wrap = document.getElementById('py-output-scroll');
  if (!wrap) return;
  const expanded = wrap.classList.toggle('expanded');
  const toggle = wrap.querySelector('.cell-output-toggle');
  if (toggle) toggle.textContent = expanded ? 'Collapse output' : 'Show all output';
}

function renderMdCell(i) {
  if (!nbData || !nbData.cells[i] || nbData.cells[i].cell_type !== 'markdown') return;
  const src = Array.isArray(nbData.cells[i].source) ? nbData.cells[i].source.join('') : nbData.cells[i].source;
  if (!src.trim()) return;
  const editorEl = document.querySelector(`[data-cell-editor="${i}"]`);
  const renderedEl = document.querySelector(`[data-cell-rendered="${i}"]`);
  if (!editorEl || !renderedEl) return;
  renderedEl.innerHTML = marked.parse(src);
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(renderedEl, {delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]});
  } else if (typeof katex !== 'undefined') {
    renderedEl.querySelectorAll('code.language-math').forEach(el => {
      try { katex.render(el.textContent, el, {throwOnError:false}); } catch(e) {}
    });
  }
  editorEl.classList.add('hidden');
  renderedEl.classList.remove('hidden');
}

function editMdCell(i) {
  const editorEl = document.querySelector(`[data-cell-editor="${i}"]`);
  const renderedEl = document.querySelector(`[data-cell-rendered="${i}"]`);
  if (!editorEl || !renderedEl) return;
  renderedEl.classList.add('hidden');
  editorEl.classList.remove('hidden');
  if (cmInstances[i]) cmInstances[i].focus();
}

function updateKernelStatus(status) {
  kernelStatus = status;
  const dot = document.getElementById('kernel-dot');
  const text = document.getElementById('kernel-status-text');
  if (!dot || !text) return;
  const colors = {idle:'bg-emerald-500', busy:'bg-amber-500', dead:'bg-red-500'};
  dot.className = `w-1.5 h-1.5 rounded-full inline-block ${colors[status]||'bg-gray-500'}`;
  text.textContent = status;
}

async function restartKernel() {
  updateKernelStatus('dead');
  await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
  updateKernelStatus('idle');
}
