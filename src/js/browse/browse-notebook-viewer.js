/**
 * browse-notebook-viewer.js — Jupyter notebook renderer + kernel execution UI
 *
 * Exports:
 *   _notebookViewerInit(tab, viewerEl, notebookData)
 *   _notebookViewerDestroy(tab)
 *   _notebookViewerGetText(tab)
 *   _notebookViewerScrollToCell(tab, cellIndex)
 */

// ── ANSI → HTML helper ──────────────────────────────────────────────
var _ANSI_COLORS = [
  'ansi-black','ansi-red','ansi-green','ansi-yellow','ansi-blue','ansi-magenta','ansi-cyan','ansi-white',
  'ansi-bright-black','ansi-bright-red','ansi-bright-green','ansi-bright-yellow','ansi-bright-blue','ansi-bright-magenta','ansi-bright-cyan','ansi-bright-white'
];

function _ansiToHtml(text) {
  if (!text) return '';
  var result = '';
  var openSpans = 0;
  var i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 27 && text[i + 1] === '[') {
      var j = i + 2;
      while (j < text.length && text[j] !== 'm') j++;
      var codes = text.slice(i + 2, j).split(';').map(Number);
      i = j + 1;
      for (var ci = 0; ci < codes.length; ci++) {
        var c = codes[ci];
        if (c === 0) {
          while (openSpans > 0) { result += '</span>'; openSpans--; }
        } else if (c === 1) { result += '<span class="ansi-bold">'; openSpans++; }
        else if (c === 3) { result += '<span class="ansi-italic">'; openSpans++; }
        else if (c === 4) { result += '<span class="ansi-underline">'; openSpans++; }
        else if (c >= 30 && c <= 37) { result += '<span class="' + _ANSI_COLORS[c - 30] + '">'; openSpans++; }
        else if (c >= 90 && c <= 97) { result += '<span class="' + _ANSI_COLORS[c - 90 + 8] + '">'; openSpans++; }
      }
    } else {
      var ch = text[i];
      if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '&') result += '&amp;';
      else result += ch;
      i++;
    }
  }
  while (openSpans > 0) { result += '</span>'; openSpans--; }
  return result;
}

// ── Markdown + KaTeX rendering ──────────────────────────────────────
function _renderMarkdownCell(source) {
  var md = Array.isArray(source) ? source.join('') : source;
  var html = '';
  if (typeof marked !== 'undefined') {
    try { html = marked.parse(md); } catch (e) { html = md.replace(/</g,'&lt;').replace(/\n/g,'<br>'); }
  } else {
    html = md.replace(/</g,'&lt;').replace(/\n/g,'<br>');
  }
  return html;
}

function _processKatexInEl(el) {
  if (!el || typeof katex === 'undefined') return;
  var kopts = function(disp) { return { displayMode: disp, throwOnError: false, output: 'html' }; };
  function decode(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
  var html = el.innerHTML;
  html = html.replace(/\$\$([^$]+?)\$\$/g, function(_, tex) {
    try { return katex.renderToString(decode(tex), kopts(true)); } catch(e) { return _; }
  });
  html = html.replace(/\\\[(.+?)\\\]/gs, function(_, tex) {
    try { return katex.renderToString(decode(tex), kopts(true)); } catch(e) { return _; }
  });
  html = html.replace(/\$([^$]+?)\$/g, function(_, tex) {
    try { return katex.renderToString(decode(tex), kopts(false)); } catch(e) { return _; }
  });
  html = html.replace(/\\\((.+?)\\\)/g, function(_, tex) {
    try { return katex.renderToString(decode(tex), kopts(false)); } catch(e) { return _; }
  });
  el.innerHTML = html;
}

// ── Output MIME rendering ───────────────────────────────────────────
var _MIME_PRIORITY = ['image/png', 'image/jpeg', 'image/svg+xml', 'text/html', 'text/latex', 'text/markdown', 'text/plain', 'application/javascript'];

function _renderOutputData(data, outputEl) {
  if (!data) return;
  for (var mi = 0; mi < _MIME_PRIORITY.length; mi++) {
    var mime = _MIME_PRIORITY[mi];
    var val = data[mime];
    if (!val) continue;
    var content = Array.isArray(val) ? val.join('') : val;

    if (mime === 'image/png' || mime === 'image/jpeg') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-image';
      var img = document.createElement('img');
      img.src = 'data:' + mime + ';base64,' + content.trim();
      img.loading = 'lazy';
      div.appendChild(img);
      outputEl.appendChild(div);
      return;
    }
    if (mime === 'image/svg+xml') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-image';
      div.innerHTML = content;
      outputEl.appendChild(div);
      return;
    }
    if (mime === 'text/html') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-html';
      var iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.style.width = '100%';
      iframe.style.border = 'none';
      iframe.style.minHeight = '40px';
      iframe.srcdoc = '<!DOCTYPE html><html><head><style>body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;margin:8px;color:#222;}</style></head><body>' + content + '<script>requestAnimationFrame(function(){document.documentElement.style.height="auto";window.parent.postMessage({type:"nb-iframe-resize",height:document.body.scrollHeight},"*");})</' + 'script></body></html>';
      div.appendChild(iframe);
      outputEl.appendChild(div);
      return;
    }
    if (mime === 'text/latex') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-latex';
      div.innerHTML = content;
      _processKatexInEl(div);
      outputEl.appendChild(div);
      return;
    }
    if (mime === 'text/plain') {
      _renderTextOutput(content, outputEl);
      return;
    }
  }
}

function _renderTextOutput(text, outputEl, cssClass) {
  var div = document.createElement('div');
  div.className = 'nb-output ' + (cssClass || 'nb-output-text');
  var pre = document.createElement('pre');
  var lines = text.split('\n');
  var MAX_LINES = 100;
  if (lines.length > MAX_LINES) {
    pre.textContent = lines.slice(0, MAX_LINES).join('\n');
    div.appendChild(pre);
    var trunc = document.createElement('div');
    trunc.className = 'nb-output-truncated';
    var btn = document.createElement('button');
    btn.textContent = 'Show all ' + lines.length + ' lines';
    btn.onclick = function() { pre.textContent = text; trunc.remove(); };
    trunc.appendChild(btn);
    div.appendChild(trunc);
  } else {
    pre.textContent = text;
    div.appendChild(pre);
  }
  outputEl.appendChild(div);
}

function _renderExistingOutputs(cell, outputEl) {
  var outputs = cell.outputs || [];
  for (var oi = 0; oi < outputs.length; oi++) {
    var out = outputs[oi];
    if (out.output_type === 'stream') {
      var text = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-stream';
      var pre = document.createElement('pre');
      if (out.name === 'stderr') pre.className = 'nb-stderr';
      pre.innerHTML = _ansiToHtml(text);
      div.appendChild(pre);
      outputEl.appendChild(div);
    } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
      _renderOutputData(out.data, outputEl);
    } else if (out.output_type === 'error') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-error';
      var pre = document.createElement('pre');
      var tb = (out.traceback || []).join('\n');
      pre.innerHTML = _ansiToHtml(tb || (out.ename + ': ' + out.evalue));
      div.appendChild(pre);
      outputEl.appendChild(div);
    }
  }
}

// ── Play icon SVG ───────────────────────────────────────────────────
var _PLAY_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14"/></svg>';
var _STOP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
var _CHEVRON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5,3 11,8 5,13"/></svg>';
var _CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,5 8,11 13,5"/></svg>';

// ── Build cell DOM ──────────────────────────────────────────────────
function _buildMarkdownCell(cell, cellIndex) {
  var el = document.createElement('div');
  el.className = 'nb-cell nb-cell-markdown';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'markdown';

  var rendered = document.createElement('div');
  rendered.className = 'nb-cell-rendered';
  var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  rendered.innerHTML = _renderMarkdownCell(source);
  _processKatexInEl(rendered);
  el.appendChild(rendered);
  return el;
}

function _buildCodeCell(cell, cellIndex, tab) {
  var el = document.createElement('div');
  el.className = 'nb-cell nb-cell-code';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'code';

  // Header
  var header = document.createElement('div');
  header.className = 'nb-cell-header';

  var runBtn = document.createElement('button');
  runBtn.className = 'nb-run-btn';
  runBtn.innerHTML = _PLAY_SVG;
  runBtn.title = 'Run cell (Shift+Enter)';
  runBtn.onclick = function() { _executeCell(tab, cellIndex); };
  header.appendChild(runBtn);

  var execCount = document.createElement('span');
  execCount.className = 'nb-exec-count';
  var ec = cell.execution_count;
  execCount.textContent = ec != null ? 'In [' + ec + ']:' : 'In [ ]:';
  header.appendChild(execCount);

  var collapseBtn = document.createElement('button');
  collapseBtn.className = 'nb-collapse-btn';
  collapseBtn.innerHTML = _CHEVRON_DOWN_SVG;
  collapseBtn.title = 'Collapse cell';
  collapseBtn.onclick = function() {
    el.classList.toggle('nb-cell-collapsed');
    collapseBtn.innerHTML = el.classList.contains('nb-cell-collapsed') ? _CHEVRON_SVG : _CHEVRON_DOWN_SVG;
  };
  header.appendChild(collapseBtn);
  el.appendChild(header);

  // Code source
  var codeContainer = document.createElement('div');
  codeContainer.className = 'nb-code-source';
  var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  // Start with <pre>, lazy-upgrade to CodeMirror on intersection
  var pre = document.createElement('pre');
  pre.textContent = source;
  codeContainer.appendChild(pre);
  codeContainer._source = source;
  codeContainer._cmInitialized = false;
  el.appendChild(codeContainer);

  // Outputs
  var outputsEl = document.createElement('div');
  outputsEl.className = 'nb-outputs';
  _renderExistingOutputs(cell, outputsEl);
  el.appendChild(outputsEl);

  return el;
}

function _buildRawCell(cell, cellIndex) {
  var el = document.createElement('div');
  el.className = 'nb-cell nb-cell-raw';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'raw';
  var pre = document.createElement('pre');
  var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  pre.textContent = source;
  el.appendChild(pre);
  return el;
}

// ── Lazy CodeMirror init via IntersectionObserver ────────────────────
function _setupLazyCM(tab) {
  if (typeof IntersectionObserver === 'undefined') return;
  tab._nbCMObserver = new IntersectionObserver(function(entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isIntersecting) continue;
      var codeContainer = entry.target;
      if (codeContainer._cmInitialized) continue;
      _initCodeMirror(codeContainer, tab);
    }
  }, { root: tab._nbScrollContainer, rootMargin: '200px' });

  var codeCells = tab._nbCellsEl.querySelectorAll('.nb-code-source');
  for (var i = 0; i < codeCells.length; i++) {
    tab._nbCMObserver.observe(codeCells[i]);
  }
}

function _initCodeMirror(codeContainer, tab) {
  if (codeContainer._cmInitialized || typeof CodeMirror === 'undefined') return;
  codeContainer._cmInitialized = true;
  var source = codeContainer._source || '';
  var pre = codeContainer.querySelector('pre');
  var lang = tab._nbLanguage || 'python';
  var modeMap = { python: 'python', r: 'r', julia: 'julia', javascript: 'javascript', scala: 'text/x-scala', ruby: 'ruby' };
  var mode = modeMap[lang] || 'python';

  var textarea = document.createElement('textarea');
  codeContainer.appendChild(textarea);
  if (pre) pre.style.display = 'none';

  var cm = CodeMirror.fromTextArea(textarea, {
    value: source,
    mode: mode,
    theme: 'default',
    readOnly: true,
    lineNumbers: true,
    matchBrackets: true,
    viewportMargin: Infinity
  });
  cm.setValue(source);
  codeContainer._cm = cm;
}

// ── Toolbar ─────────────────────────────────────────────────────────
function _buildToolbar(tab) {
  var toolbar = document.createElement('div');
  toolbar.className = 'nb-toolbar';

  // New notebook button
  var newBtn = _tbBtn('New Notebook', function() { if (typeof window.createNewNotebook === 'function') window.createNewNotebook(); });
  newBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>';
  newBtn.title = 'New notebook';
  toolbar.appendChild(newBtn);

  toolbar.appendChild(_sep());

  // Kernel status
  var kernelStatus = document.createElement('div');
  kernelStatus.className = 'nb-kernel-status';
  var kernelDot = document.createElement('span');
  kernelDot.className = 'nb-kernel-dot disconnected';
  var kernelLabel = document.createElement('span');
  kernelLabel.textContent = 'No kernel';
  kernelStatus.appendChild(kernelDot);
  kernelStatus.appendChild(kernelLabel);
  kernelStatus.onclick = function() { _startKernel(tab); };
  toolbar.appendChild(kernelStatus);
  tab._nbKernelDot = kernelDot;
  tab._nbKernelLabel = kernelLabel;

  toolbar.appendChild(_sep());

  // Run All
  var runAllBtn = _tbBtn('Run All', function() { _executeAll(tab); });
  runAllBtn.innerHTML = _PLAY_SVG;
  runAllBtn.title = 'Run all cells';
  runAllBtn.classList.add('nb-tb-labeled');
  runAllBtn.insertAdjacentHTML('beforeend', ' Run All');
  toolbar.appendChild(runAllBtn);

  // Interrupt
  var intBtn = _tbBtn('Interrupt', function() { _interruptKernel(tab); });
  intBtn.innerHTML = _STOP_SVG;
  intBtn.title = 'Interrupt kernel';
  toolbar.appendChild(intBtn);

  // Restart
  var restartBtn = _tbBtn('Restart', function() { _restartKernel(tab); });
  restartBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3"/><polyline points="3,3 3,6 6,6"/><polyline points="13,13 13,10 10,10"/></svg>';
  restartBtn.title = 'Restart kernel';
  toolbar.appendChild(restartBtn);

  toolbar.appendChild(_sep());

  // Cell counter
  var cellCounter = document.createElement('span');
  cellCounter.className = 'nb-cell-counter';
  var codeCells = (tab._nbData.cells || []).filter(function(c) { return c.cell_type === 'code'; });
  cellCounter.textContent = codeCells.length + ' code cells';
  toolbar.appendChild(cellCounter);
  tab._nbCellCounter = cellCounter;

  // Spacer
  var spacer = document.createElement('span');
  spacer.style.flex = '1';
  toolbar.appendChild(spacer);

  // Outline toggle
  var outlineBtn = _tbBtn('Outline', function() {
    var panel = tab._nbOutlinePanel;
    if (panel) {
      panel.classList.toggle('visible');
      outlineBtn.classList.toggle('active', panel.classList.contains('visible'));
    }
  });
  outlineBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="4" x2="13" y2="4"/><line x1="5" y1="8" x2="13" y2="8"/><line x1="5" y1="12" x2="13" y2="12"/></svg>';
  outlineBtn.title = 'Toggle outline';
  toolbar.appendChild(outlineBtn);

  // Zoom
  var zoomOut = _tbBtn('Zoom out', function() { _zoom(tab, -0.1); });
  zoomOut.textContent = '−';
  zoomOut.title = 'Zoom out';
  toolbar.appendChild(zoomOut);
  var zoomIn = _tbBtn('Zoom in', function() { _zoom(tab, 0.1); });
  zoomIn.textContent = '+';
  zoomIn.title = 'Zoom in';
  toolbar.appendChild(zoomIn);

  // Collapse all
  var collapseAllBtn = _tbBtn('Collapse all', function() { _collapseAll(tab); });
  collapseAllBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,6 8,2 12,6"/><polyline points="4,10 8,14 12,10"/></svg>';
  collapseAllBtn.title = 'Collapse/expand all code cells';
  toolbar.appendChild(collapseAllBtn);
  tab._nbCollapseAllBtn = collapseAllBtn;

  return toolbar;
}

function _tbBtn(label, handler) {
  var btn = document.createElement('button');
  btn.className = 'nb-tb-btn';
  btn.setAttribute('aria-label', label);
  btn.onclick = handler;
  return btn;
}

function _sep() {
  var s = document.createElement('span');
  s.className = 'nb-tb-sep';
  return s;
}

// ── Outline panel ───────────────────────────────────────────────────
function _buildOutline(tab) {
  var panel = document.createElement('div');
  panel.className = 'nb-outline-panel';
  var cells = tab._nbData.cells || [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    if (cell.cell_type !== 'markdown') continue;
    var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    var headingMatch = source.match(/^(#{1,6})\s+(.+)/m);
    if (!headingMatch) continue;
    var level = headingMatch[1].length;
    var text = headingMatch[2].replace(/[#*_`\[\]]/g, '').trim();
    var item = document.createElement('div');
    item.className = 'nb-outline-heading';
    item.dataset.level = level;
    item.textContent = text;
    item.dataset.cellIndex = i;
    item.onclick = (function(ci) { return function() { _notebookViewerScrollToCell(tab, ci); }; })(i);
    panel.appendChild(item);
  }
  return panel;
}

// ── Zoom ────────────────────────────────────────────────────────────
function _zoom(tab, delta) {
  tab._nbFontScale = Math.max(0.5, Math.min(2, (tab._nbFontScale || 1) + delta));
  if (tab._nbCellsEl) {
    tab._nbCellsEl.style.setProperty('--nb-font-scale', tab._nbFontScale);
  }
}

// ── Collapse all ────────────────────────────────────────────────────
function _collapseAll(tab) {
  var cells = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell-code') : [];
  var anyExpanded = false;
  for (var i = 0; i < cells.length; i++) {
    if (!cells[i].classList.contains('nb-cell-collapsed')) { anyExpanded = true; break; }
  }
  for (var i = 0; i < cells.length; i++) {
    if (anyExpanded) cells[i].classList.add('nb-cell-collapsed');
    else cells[i].classList.remove('nb-cell-collapsed');
    var btn = cells[i].querySelector('.nb-collapse-btn');
    if (btn) btn.innerHTML = anyExpanded ? _CHEVRON_SVG : _CHEVRON_DOWN_SVG;
  }
}

// ── Kernel management ───────────────────────────────────────────────
function _updateKernelStatus(tab, state) {
  tab._nbKernelState = state;
  if (tab._nbKernelDot) {
    tab._nbKernelDot.className = 'nb-kernel-dot ' + state;
  }
  if (tab._nbKernelLabel) {
    var labels = { idle: 'Idle', busy: 'Busy', disconnected: 'No kernel', starting: 'Starting...' };
    tab._nbKernelLabel.textContent = labels[state] || state;
  }
}

async function _startKernel(tab) {
  if (tab._nbKernelState === 'idle' || tab._nbKernelState === 'busy') return;
  if (typeof electronAPI === 'undefined' || !electronAPI.notebookStartKernel) return;
  _updateKernelStatus(tab, 'starting');
  tab._nbSessionId = 'nb-' + tab.id + '-' + Date.now();
  try {
    await electronAPI.notebookStartKernel(tab._nbSessionId);
    _updateKernelStatus(tab, 'idle');
  } catch (e) {
    console.error('Failed to start kernel:', e);
    _updateKernelStatus(tab, 'disconnected');
  }
}

async function _interruptKernel(tab) {
  if (!tab._nbSessionId || typeof electronAPI === 'undefined') return;
  try { await electronAPI.notebookInterrupt(tab._nbSessionId); } catch (e) { console.error('Interrupt failed:', e); }
}

async function _restartKernel(tab) {
  if (!tab._nbSessionId || typeof electronAPI === 'undefined') return;
  _updateKernelStatus(tab, 'starting');
  try {
    await electronAPI.notebookRestart(tab._nbSessionId);
    _updateKernelStatus(tab, 'idle');
    // Reset all execution counts
    var execCounts = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-exec-count') : [];
    for (var i = 0; i < execCounts.length; i++) {
      execCounts[i].textContent = 'In [ ]:';
      execCounts[i].classList.remove('nb-exec-running');
    }
  } catch (e) {
    console.error('Restart failed:', e);
    _updateKernelStatus(tab, 'disconnected');
  }
}

async function _shutdownKernel(tab) {
  if (!tab._nbSessionId || typeof electronAPI === 'undefined') return;
  try { await electronAPI.notebookShutdown(tab._nbSessionId); } catch (e) { /* ignore */ }
  _updateKernelStatus(tab, 'disconnected');
  tab._nbSessionId = null;
}

// ── Cell execution ──────────────────────────────────────────────────
async function _executeCell(tab, cellIndex) {
  var cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + cellIndex + '"]') : null;
  if (!cellEl || cellEl.dataset.cellType !== 'code') return;

  // Auto-start kernel if needed
  if (tab._nbKernelState !== 'idle' && tab._nbKernelState !== 'busy') {
    await _startKernel(tab);
    if (tab._nbKernelState !== 'idle') return;
  }

  var codeSource = cellEl.querySelector('.nb-code-source');
  var source = '';
  if (codeSource._cm) {
    source = codeSource._cm.getValue();
  } else {
    source = codeSource._source || '';
  }
  if (!source.trim()) return;

  var cellId = 'cell-' + cellIndex;
  var execCount = cellEl.querySelector('.nb-exec-count');
  var outputsEl = cellEl.querySelector('.nb-outputs');

  // Clear previous outputs
  outputsEl.innerHTML = '';
  cellEl.classList.add('nb-cell-executing');
  if (execCount) { execCount.textContent = 'In [*]:'; execCount.classList.add('nb-exec-running'); }

  try {
    await electronAPI.notebookExecute(tab._nbSessionId, source, cellId);
  } catch (e) {
    console.error('Execute failed:', e);
    cellEl.classList.remove('nb-cell-executing');
    if (execCount) { execCount.textContent = 'In [!]:'; execCount.classList.remove('nb-exec-running'); }
  }
}

async function _executeAll(tab) {
  var cells = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell-code') : [];
  for (var i = 0; i < cells.length; i++) {
    var idx = parseInt(cells[i].dataset.cellIndex, 10);
    await _executeCell(tab, idx);
    // Wait for completion before next cell
    await new Promise(function(resolve) {
      var check = function() {
        if (tab._nbKernelState !== 'busy') resolve();
        else setTimeout(check, 100);
      };
      setTimeout(check, 50);
    });
  }
}

// ── IPC event listeners ─────────────────────────────────────────────
function _setupIPCListeners(tab) {
  if (typeof electronAPI === 'undefined') return;

  tab._nbOutputHandler = function(_event, data) {
    if (data.sessionId !== tab._nbSessionId) return;
    var cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + data.cellId.replace('cell-', '') + '"]') : null;
    if (!cellEl) return;
    var outputsEl = cellEl.querySelector('.nb-outputs');
    if (!outputsEl) return;

    if (data.event === 'stream') {
      // Find or create last stream output of same name
      var lastStream = outputsEl.querySelector('.nb-output-stream:last-child pre' + (data.name === 'stderr' ? '.nb-stderr' : ':not(.nb-stderr)'));
      if (lastStream) {
        lastStream.innerHTML += _ansiToHtml(data.text);
      } else {
        var div = document.createElement('div');
        div.className = 'nb-output nb-output-stream';
        var pre = document.createElement('pre');
        if (data.name === 'stderr') pre.className = 'nb-stderr';
        pre.innerHTML = _ansiToHtml(data.text);
        div.appendChild(pre);
        outputsEl.appendChild(div);
      }
    } else if (data.event === 'execute_result' || data.event === 'display_data') {
      _renderOutputData(data.data, outputsEl);
    } else if (data.event === 'error') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-error';
      var pre = document.createElement('pre');
      var tb = (data.traceback || []).join('\n');
      pre.innerHTML = _ansiToHtml(tb || (data.ename + ': ' + data.evalue));
      div.appendChild(pre);
      outputsEl.appendChild(div);
    }
  };

  tab._nbStatusHandler = function(_event, data) {
    if (data.sessionId !== tab._nbSessionId) return;
    _updateKernelStatus(tab, data.state);
  };

  tab._nbExecCompleteHandler = function(_event, data) {
    if (data.sessionId !== tab._nbSessionId) return;
    var cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + data.cellId.replace('cell-', '') + '"]') : null;
    if (!cellEl) return;
    cellEl.classList.remove('nb-cell-executing');
    var execCount = cellEl.querySelector('.nb-exec-count');
    if (execCount) {
      execCount.textContent = data.executionCount != null ? 'In [' + data.executionCount + ']:' : 'In [ ]:';
      execCount.classList.remove('nb-exec-running');
    }
  };

  if (electronAPI.onNotebookOutput) electronAPI.onNotebookOutput(tab._nbOutputHandler);
  if (electronAPI.onNotebookStatus) electronAPI.onNotebookStatus(tab._nbStatusHandler);
  if (electronAPI.onNotebookExecuteComplete) electronAPI.onNotebookExecuteComplete(tab._nbExecCompleteHandler);
}

function _removeIPCListeners(tab) {
  if (typeof electronAPI === 'undefined') return;
  if (electronAPI.removeNotebookListeners) electronAPI.removeNotebookListeners();
}

// ── iframe auto-resize listener ─────────────────────────────────────
function _setupIframeResize(tab) {
  tab._nbIframeResizeHandler = function(event) {
    if (!event.data || event.data.type !== 'nb-iframe-resize') return;
    var iframes = tab._nbViewerEl ? tab._nbViewerEl.querySelectorAll('.nb-output-html iframe') : [];
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === event.source) {
        iframes[i].style.height = Math.min(event.data.height + 16, 600) + 'px';
        break;
      }
    }
  };
  window.addEventListener('message', tab._nbIframeResizeHandler);
}

// ── Keyboard shortcuts ──────────────────────────────────────────────
function _setupKeyboard(tab) {
  tab._nbKeyHandler = function(e) {
    if (!tab._nbViewerEl || !tab._nbViewerEl.offsetParent) return;

    // Cmd+S / Ctrl+S — save notebook
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      _saveNotebook(tab);
      return;
    }

    // Find selected cell
    var selected = tab._nbCellsEl ? tab._nbCellsEl.querySelector('.nb-cell-selected') : null;
    var cellIndex = selected ? parseInt(selected.dataset.cellIndex, 10) : -1;

    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (cellIndex >= 0) {
        _executeCell(tab, cellIndex);
        // Advance to next cell
        var next = tab._nbCellsEl.querySelector('[data-cell-index="' + (cellIndex + 1) + '"]');
        if (next) {
          if (selected) selected.classList.remove('nb-cell-selected');
          next.classList.add('nb-cell-selected');
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (cellIndex >= 0) _executeCell(tab, cellIndex);
    }
  };
  document.addEventListener('keydown', tab._nbKeyHandler);
}

// ── Cell click selection ────────────────────────────────────────────
function _setupCellSelection(tab) {
  tab._nbCellClickHandler = function(e) {
    var cell = e.target.closest('.nb-cell');
    if (!cell) return;
    var prev = tab._nbCellsEl.querySelector('.nb-cell-selected');
    if (prev) prev.classList.remove('nb-cell-selected');
    cell.classList.add('nb-cell-selected');
  };
  tab._nbCellsEl.addEventListener('click', tab._nbCellClickHandler);
}

// ── Public API ──────────────────────────────────────────────────────
export function _notebookViewerInit(tab, viewerEl, notebookData) {
  tab._nbData = notebookData;
  tab._nbViewerEl = viewerEl;
  tab._nbFontScale = tab._nbFontScale || 1;

  // Detect language from kernelspec
  var meta = notebookData.metadata || {};
  var kernelspec = meta.kernelspec || {};
  tab._nbLanguage = kernelspec.language || (meta.language_info && meta.language_info.name) || 'python';

  viewerEl.style.display = 'flex';
  viewerEl.style.flexDirection = 'column';
  viewerEl.style.height = '100%';

  // Toolbar
  var toolbar = _buildToolbar(tab);
  viewerEl.appendChild(toolbar);
  tab._nbToolbar = toolbar;

  // Body wrapper
  var bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'nb-body-wrapper';

  // Outline panel
  var outlinePanel = _buildOutline(tab);
  bodyWrapper.appendChild(outlinePanel);
  tab._nbOutlinePanel = outlinePanel;

  // Scroll container
  var scrollContainer = document.createElement('div');
  scrollContainer.className = 'nb-scroll-container';
  tab._nbScrollContainer = scrollContainer;

  // Cells
  var cellsEl = document.createElement('div');
  cellsEl.className = 'nb-cells';
  cellsEl.style.setProperty('--nb-font-scale', tab._nbFontScale);
  tab._nbCellsEl = cellsEl;

  var cells = notebookData.cells || [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var cellEl;
    if (cell.cell_type === 'markdown') {
      cellEl = _buildMarkdownCell(cell, i);
    } else if (cell.cell_type === 'code') {
      cellEl = _buildCodeCell(cell, i, tab);
    } else {
      cellEl = _buildRawCell(cell, i);
    }
    cellsEl.appendChild(cellEl);
  }

  scrollContainer.appendChild(cellsEl);
  bodyWrapper.appendChild(scrollContainer);
  viewerEl.appendChild(bodyWrapper);

  // Setup lazy CodeMirror, keyboard, selection, IPC, iframe resize
  _setupLazyCM(tab);
  _setupKeyboard(tab);
  _setupCellSelection(tab);
  _setupIPCListeners(tab);
  _setupIframeResize(tab);
}

export function _notebookViewerDestroy(tab) {
  // Shutdown kernel
  _shutdownKernel(tab);

  // Remove event listeners
  if (tab._nbKeyHandler) {
    document.removeEventListener('keydown', tab._nbKeyHandler);
    tab._nbKeyHandler = null;
  }
  if (tab._nbIframeResizeHandler) {
    window.removeEventListener('message', tab._nbIframeResizeHandler);
    tab._nbIframeResizeHandler = null;
  }
  _removeIPCListeners(tab);

  // Dispose CodeMirror instances
  if (tab._nbCellsEl) {
    var cms = tab._nbCellsEl.querySelectorAll('.nb-code-source');
    for (var i = 0; i < cms.length; i++) {
      if (cms[i]._cm) { cms[i]._cm.toTextArea(); cms[i]._cm = null; }
    }
  }

  // Disconnect observer
  if (tab._nbCMObserver) { tab._nbCMObserver.disconnect(); tab._nbCMObserver = null; }

  // Clear DOM
  if (tab._nbViewerEl) tab._nbViewerEl.innerHTML = '';

  // Null references
  tab._nbData = null;
  tab._nbCellsEl = null;
  tab._nbScrollContainer = null;
  tab._nbOutlinePanel = null;
  tab._nbToolbar = null;
  tab._nbKernelDot = null;
  tab._nbKernelLabel = null;
  tab._nbCellCounter = null;
}

export function _notebookViewerGetText(tab) {
  if (!tab._nbData) return '';
  var cells = tab._nbData.cells || [];
  var parts = [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    if (cell.cell_type === 'markdown') {
      parts.push(source);
    } else if (cell.cell_type === 'code') {
      parts.push('```' + (tab._nbLanguage || 'python') + '\n' + source + '\n```');
      // Include text outputs
      var outputs = cell.outputs || [];
      for (var j = 0; j < outputs.length; j++) {
        var out = outputs[j];
        if (out.output_type === 'stream') {
          var text = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
          if (text.trim()) parts.push('Output:\n' + text.trim());
        } else if (out.output_type === 'execute_result' && out.data && out.data['text/plain']) {
          var text = Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : out.data['text/plain'];
          if (text.trim()) parts.push('Output:\n' + text.trim());
        }
      }
    }
  }
  return parts.join('\n\n');
}

export function _notebookViewerScrollToCell(tab, cellIndex) {
  if (!tab._nbCellsEl) return;
  var cellEl = tab._nbCellsEl.querySelector('[data-cell-index="' + cellIndex + '"]');
  if (cellEl) {
    cellEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Select it
    var prev = tab._nbCellsEl.querySelector('.nb-cell-selected');
    if (prev) prev.classList.remove('nb-cell-selected');
    cellEl.classList.add('nb-cell-selected');
  }
}

// ── Serialize notebook to .ipynb JSON ────────────────────────────────
export function _notebookViewerSerialize(tab) {
  if (!tab._nbData) return null;
  var nb = {
    nbformat: tab._nbData.nbformat || 4,
    nbformat_minor: tab._nbData.nbformat_minor || 5,
    metadata: tab._nbData.metadata || {},
    cells: []
  };
  var cells = tab._nbData.cells || [];
  var cellEls = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell') : [];
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var cellEl = cellEls[i];
    var source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    // Pull live source from CodeMirror if available
    if (cellEl && cell.cell_type === 'code') {
      var codeContainer = cellEl.querySelector('.nb-code-source');
      if (codeContainer && codeContainer._cm) {
        source = codeContainer._cm.getValue();
      }
    }
    var outCell = {
      cell_type: cell.cell_type,
      source: source.split('\n').map(function(line, idx, arr) { return idx < arr.length - 1 ? line + '\n' : line; }),
      metadata: cell.metadata || {}
    };
    if (cell.cell_type === 'code') {
      outCell.execution_count = cell.execution_count || null;
      outCell.outputs = cell.outputs || [];
    }
    nb.cells.push(outCell);
  }
  return JSON.stringify(nb, null, 1);
}

// ── Save notebook ────────────────────────────────────────────────────
async function _saveNotebook(tab) {
  if (typeof electronAPI === 'undefined') return;
  var filePath = tab.localPath;
  if (!filePath || tab._nbUnsaved) {
    filePath = await electronAPI.showSaveDialog({
      defaultPath: tab.title || 'Untitled.ipynb',
      filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }]
    });
    if (!filePath) return;
  }
  var json = _notebookViewerSerialize(tab);
  if (!json) return;
  try {
    await electronAPI.notebookSave(filePath, json);
    tab.localPath = filePath;
    tab._nbUnsaved = false;
    tab.title = filePath.split('/').pop();
    if (typeof _browseRenderTabs === 'function') _browseRenderTabs();
    else if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Notebook saved');
  } catch (e) {
    console.error('Failed to save notebook:', e);
    if (typeof Aether !== 'undefined' && Aether.toast) Aether.toast('Save failed: ' + e.message);
  }
}

// ── Window bridge (for non-module access) ───────────────────────────
window._notebookViewerInit = _notebookViewerInit;
window._notebookViewerDestroy = _notebookViewerDestroy;
window._notebookViewerGetText = _notebookViewerGetText;
window._notebookViewerScrollToCell = _notebookViewerScrollToCell;
window._notebookViewerSerialize = _notebookViewerSerialize;
