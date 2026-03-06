/**
 * browse-notebook-viewer.js — Jupyter notebook editor + kernel execution UI
 *
 * Exports:
 *   _notebookViewerInit(tab, viewerEl, notebookData)
 *   _notebookViewerDestroy(tab)
 *   _notebookViewerGetText(tab)
 *   _notebookViewerScrollToCell(tab, cellIndex)
 *   _notebookViewerSerialize(tab)
 */

import { toast } from '/js/core/core-utils.js';

// ── ANSI → HTML helper ──────────────────────────────────────────────
const _ANSI_COLORS = [
  'ansi-black','ansi-red','ansi-green','ansi-yellow','ansi-blue','ansi-magenta','ansi-cyan','ansi-white',
  'ansi-bright-black','ansi-bright-red','ansi-bright-green','ansi-bright-yellow','ansi-bright-blue','ansi-bright-magenta','ansi-bright-cyan','ansi-bright-white'
];

function _ansiToHtml(text) {
  if (!text) return '';
  let result = '';
  let openSpans = 0;
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 27 && text[i + 1] === '[') {
      let j = i + 2;
      while (j < text.length && text[j] !== 'm') j++;
      const codes = text.slice(i + 2, j).split(';').map(Number);
      i = j + 1;
      for (let ci = 0; ci < codes.length; ci++) {
        const c = codes[ci];
        if (c === 0) {
          while (openSpans > 0) { result += '</span>'; openSpans--; }
        } else if (c === 1) { result += '<span class="ansi-bold">'; openSpans++; }
        else if (c === 3) { result += '<span class="ansi-italic">'; openSpans++; }
        else if (c === 4) { result += '<span class="ansi-underline">'; openSpans++; }
        else if (c >= 30 && c <= 37) { result += '<span class="' + _ANSI_COLORS[c - 30] + '">'; openSpans++; }
        else if (c >= 90 && c <= 97) { result += '<span class="' + _ANSI_COLORS[c - 90 + 8] + '">'; openSpans++; }
      }
    } else {
      const ch = text[i];
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
  const md = Array.isArray(source) ? source.join('') : source;
  let html = '';
  if (typeof marked !== 'undefined') {
    try { html = marked.parse(md); } catch (e) { html = md.replace(/</g,'&lt;').replace(/\n/g,'<br>'); }
  } else {
    html = md.replace(/</g,'&lt;').replace(/\n/g,'<br>');
  }
  return html;
}

function _processKatexInEl(el) {
  if (!el || typeof katex === 'undefined') return;
  const kopts = function(disp) { return { displayMode: disp, throwOnError: false, output: 'html' }; };
  function decode(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
  let html = el.innerHTML;
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
const _MIME_PRIORITY = ['image/png', 'image/jpeg', 'image/svg+xml', 'text/html', 'text/latex', 'text/markdown', 'text/plain', 'application/javascript'];

function _renderOutputData(data, outputEl) {
  if (!data) return;
  for (let mi = 0; mi < _MIME_PRIORITY.length; mi++) {
    const mime = _MIME_PRIORITY[mi];
    const val = data[mime];
    if (!val) continue;
    const content = Array.isArray(val) ? val.join('') : val;

    if (mime === 'image/png' || mime === 'image/jpeg') {
      var div = document.createElement('div');
      div.className = 'nb-output nb-output-image';
      const img = document.createElement('img');
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
      const iframe = document.createElement('iframe');
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
  const div = document.createElement('div');
  div.className = 'nb-output ' + (cssClass || 'nb-output-text');
  const pre = document.createElement('pre');
  const lines = text.split('\n');
  const MAX_LINES = 100;
  if (lines.length > MAX_LINES) {
    pre.textContent = lines.slice(0, MAX_LINES).join('\n');
    div.appendChild(pre);
    const trunc = document.createElement('div');
    trunc.className = 'nb-output-truncated';
    const btn = document.createElement('button');
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
  const outputs = cell.outputs || [];
  for (let oi = 0; oi < outputs.length; oi++) {
    const out = outputs[oi];
    if (out.output_type === 'stream') {
      const text = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
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
      const tb = (out.traceback || []).join('\n');
      pre.innerHTML = _ansiToHtml(tb || (out.ename + ': ' + out.evalue));
      div.appendChild(pre);
      outputEl.appendChild(div);
    }
  }
}

// ── SVG icons ───────────────────────────────────────────────────────
const _PLAY_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="4,2 14,8 4,14"/></svg>';
const _STOP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
const _CHEVRON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5,3 11,8 5,13"/></svg>';
const _CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,5 8,11 13,5"/></svg>';
const _DELETE_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';
const _MOVE_UP_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,10 8,5 12,10"/></svg>';
const _MOVE_DOWN_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,6 8,11 12,6"/></svg>';
const _PLUS_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>';
const _CLEAR_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4v9h6V4"/></svg>';

// ── Dirty tracking ──────────────────────────────────────────────────
function _markDirty(tab) {
  if (tab._nbDirty) return;
  tab._nbDirty = true;
  if (tab.title && !tab.title.startsWith('● ')) {
    tab.title = '● ' + tab.title;
    if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
  }
}

// ── Refresh indices after structural changes ────────────────────────
function _refreshCellIndices(tab) {
  if (!tab._nbCellsEl) return;
  const cells = tab._nbCellsEl.querySelectorAll('.nb-cell');
  for (let i = 0; i < cells.length; i++) {
    cells[i].dataset.cellIndex = i;
  }
  const codeCells = (tab._nbData.cells || []).filter(function(c) { return c.cell_type === 'code'; });
  if (tab._nbCellCounter) {
    tab._nbCellCounter.textContent = codeCells.length + ' code cells';
  }
}

function _refreshDividerIndices(tab) {
  if (!tab._nbCellsEl) return;
  const dividers = tab._nbCellsEl.querySelectorAll('.nb-add-cell-divider');
  for (let i = 0; i < dividers.length; i++) {
    dividers[i].dataset.insertIndex = i;
  }
}

// ── Cell action button helper ───────────────────────────────────────
function _cellActionBtn(svg, title, handler) {
  const btn = document.createElement('button');
  btn.className = 'nb-cell-action-btn';
  btn.innerHTML = svg;
  btn.title = title;
  btn.onclick = function(e) { e.stopPropagation(); handler(); };
  return btn;
}

// ── Build cell DOM ──────────────────────────────────────────────────
function _buildMarkdownCell(cell, cellIndex, tab) {
  const el = document.createElement('div');
  el.className = 'nb-cell nb-cell-markdown';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'markdown';

  const actions = document.createElement('div');
  actions.className = 'nb-cell-actions';
  actions.appendChild(_cellActionBtn(_MOVE_UP_SVG, 'Move up', function() { _moveCell(tab, parseInt(el.dataset.cellIndex, 10), -1); }));
  actions.appendChild(_cellActionBtn(_MOVE_DOWN_SVG, 'Move down', function() { _moveCell(tab, parseInt(el.dataset.cellIndex, 10), 1); }));
  actions.appendChild(_cellActionBtn(_DELETE_SVG, 'Delete cell', function() { _deleteCell(tab, parseInt(el.dataset.cellIndex, 10)); }));
  el.appendChild(actions);

  const rendered = document.createElement('div');
  rendered.className = 'nb-cell-rendered';
  const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  if (source.trim()) {
    rendered.innerHTML = _renderMarkdownCell(source);
    _processKatexInEl(rendered);
  } else {
    rendered.innerHTML = '<p class="nb-md-placeholder">Double-click to edit markdown</p>';
  }
  el.appendChild(rendered);

  rendered.addEventListener('dblclick', function() {
    _enterMarkdownEdit(tab, el);
  });

  return el;
}

function _buildCodeCell(cell, cellIndex, tab) {
  const el = document.createElement('div');
  el.className = 'nb-cell nb-cell-code';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'code';

  // Header
  const header = document.createElement('div');
  header.className = 'nb-cell-header';

  const runBtn = document.createElement('button');
  runBtn.className = 'nb-run-btn';
  runBtn.innerHTML = _PLAY_SVG;
  runBtn.title = 'Run cell (Shift+Enter)';
  runBtn.onclick = function() { _executeCell(tab, parseInt(el.dataset.cellIndex, 10)); };
  header.appendChild(runBtn);

  const execCount = document.createElement('span');
  execCount.className = 'nb-exec-count';
  const ec = cell.execution_count;
  execCount.textContent = ec != null ? 'In [' + ec + ']:' : 'In [ ]:';
  header.appendChild(execCount);

  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  header.appendChild(spacer);

  const headerActions = document.createElement('div');
  headerActions.className = 'nb-header-actions';
  headerActions.appendChild(_cellActionBtn(_CLEAR_SVG, 'Clear output', function() { _clearCellOutput(tab, parseInt(el.dataset.cellIndex, 10)); }));
  headerActions.appendChild(_cellActionBtn(_MOVE_UP_SVG, 'Move up', function() { _moveCell(tab, parseInt(el.dataset.cellIndex, 10), -1); }));
  headerActions.appendChild(_cellActionBtn(_MOVE_DOWN_SVG, 'Move down', function() { _moveCell(tab, parseInt(el.dataset.cellIndex, 10), 1); }));
  headerActions.appendChild(_cellActionBtn(_DELETE_SVG, 'Delete cell', function() { _deleteCell(tab, parseInt(el.dataset.cellIndex, 10)); }));
  header.appendChild(headerActions);

  const collapseBtn = document.createElement('button');
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
  const codeContainer = document.createElement('div');
  codeContainer.className = 'nb-code-source';
  const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  const pre = document.createElement('pre');
  pre.textContent = source;
  codeContainer.appendChild(pre);
  codeContainer._source = source;
  codeContainer._cmInitialized = false;
  el.appendChild(codeContainer);

  // Outputs
  const outputsEl = document.createElement('div');
  outputsEl.className = 'nb-outputs';
  _renderExistingOutputs(cell, outputsEl);
  el.appendChild(outputsEl);

  return el;
}

function _buildRawCell(cell, cellIndex) {
  const el = document.createElement('div');
  el.className = 'nb-cell nb-cell-raw';
  el.dataset.cellIndex = cellIndex;
  el.dataset.cellType = 'raw';
  const pre = document.createElement('pre');
  const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  pre.textContent = source;
  el.appendChild(pre);
  return el;
}

// ── Add cell divider ────────────────────────────────────────────────
function _buildAddCellDivider(tab, insertIndex) {
  const divider = document.createElement('div');
  divider.className = 'nb-add-cell-divider';
  divider.dataset.insertIndex = insertIndex;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'nb-add-cell-btns';

  const codeBtn = document.createElement('button');
  codeBtn.className = 'nb-add-cell-btn';
  codeBtn.innerHTML = _PLUS_SVG + ' Code';
  codeBtn.onclick = function(e) { e.stopPropagation(); _addCell(tab, parseInt(divider.dataset.insertIndex, 10), 'code'); };
  btnGroup.appendChild(codeBtn);

  const mdBtn = document.createElement('button');
  mdBtn.className = 'nb-add-cell-btn';
  mdBtn.innerHTML = _PLUS_SVG + ' Markdown';
  mdBtn.onclick = function(e) { e.stopPropagation(); _addCell(tab, parseInt(divider.dataset.insertIndex, 10), 'markdown'); };
  btnGroup.appendChild(mdBtn);

  divider.appendChild(btnGroup);
  return divider;
}

// ── Cell operations ─────────────────────────────────────────────────
function _addCell(tab, index, type) {
  const newCell = { cell_type: type, source: [], metadata: {} };
  if (type === 'code') {
    newCell.execution_count = null;
    newCell.outputs = [];
  }
  tab._nbData.cells.splice(index, 0, newCell);

  var cellEl;
  if (type === 'markdown') {
    cellEl = _buildMarkdownCell(newCell, index, tab);
  } else if (type === 'code') {
    cellEl = _buildCodeCell(newCell, index, tab);
  } else {
    cellEl = _buildRawCell(newCell, index);
  }

  const dividers = tab._nbCellsEl.querySelectorAll('.nb-add-cell-divider');
  const targetDivider = dividers[index];
  if (targetDivider) {
    const newDivider = _buildAddCellDivider(tab, index + 1);
    targetDivider.after(cellEl);
    cellEl.after(newDivider);
  }

  _refreshCellIndices(tab);
  _refreshDividerIndices(tab);

  const prev = tab._nbCellsEl.querySelector('.nb-cell-selected');
  if (prev) prev.classList.remove('nb-cell-selected');
  cellEl.classList.add('nb-cell-selected');
  cellEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (type === 'code') {
    const codeContainer = cellEl.querySelector('.nb-code-source');
    _initCodeMirror(codeContainer, tab);
    if (codeContainer._cm) {
      requestAnimationFrame(function() { codeContainer._cm.focus(); });
    }
  } else if (type === 'markdown') {
    _enterMarkdownEdit(tab, cellEl);
  }

  _markDirty(tab);
}

function _deleteCell(tab, cellIndex) {
  const cells = tab._nbData.cells;
  if (cells.length <= 1) { toast('Cannot delete the last cell'); return; }

  const deleted = cells.splice(cellIndex, 1)[0];
  tab._nbDeleteStack = tab._nbDeleteStack || [];
  tab._nbDeleteStack.push({ cell: deleted, index: cellIndex });

  const cellEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + cellIndex + '"]');
  if (cellEl) {
    const codeContainer = cellEl.querySelector('.nb-code-source');
    if (codeContainer && codeContainer._cm) { codeContainer._cm.toTextArea(); codeContainer._cm = null; }
    if (cellEl._mdCm) { cellEl._mdCm.toTextArea(); cellEl._mdCm = null; }
    const nextEl = cellEl.nextElementSibling;
    if (nextEl && nextEl.classList.contains('nb-add-cell-divider')) nextEl.remove();
    cellEl.remove();
  }

  _refreshCellIndices(tab);
  _refreshDividerIndices(tab);

  const remaining = tab._nbCellsEl.querySelectorAll('.nb-cell');
  if (remaining.length > 0) {
    const selectIdx = Math.min(cellIndex, remaining.length - 1);
    remaining[selectIdx].classList.add('nb-cell-selected');
  }

  _markDirty(tab);
}

function _undoDeleteCell(tab) {
  if (!tab._nbDeleteStack || tab._nbDeleteStack.length === 0) return;
  const entry = tab._nbDeleteStack.pop();
  const cell = entry.cell;
  const safeIndex = Math.min(entry.index, tab._nbData.cells.length);
  _addCell(tab, safeIndex, cell.cell_type);

  const restored = tab._nbData.cells[safeIndex];
  restored.source = cell.source;
  restored.outputs = cell.outputs || [];
  restored.execution_count = cell.execution_count;
  restored.metadata = cell.metadata;

  const cellEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + safeIndex + '"]');
  if (cellEl && cell.cell_type === 'code') {
    const codeContainer = cellEl.querySelector('.nb-code-source');
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    if (codeContainer && codeContainer._cm) codeContainer._cm.setValue(source);
    const outputsEl = cellEl.querySelector('.nb-outputs');
    if (outputsEl) { outputsEl.innerHTML = ''; _renderExistingOutputs(cell, outputsEl); }
  } else if (cellEl && cell.cell_type === 'markdown') {
    _exitMarkdownEdit(tab, cellEl);
    const rendered = cellEl.querySelector('.nb-cell-rendered');
    if (rendered) {
      const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      rendered.innerHTML = _renderMarkdownCell(source);
      _processKatexInEl(rendered);
    }
  }
  toast('Cell restored');
}

function _moveCell(tab, cellIndex, direction) {
  const cells = tab._nbData.cells;
  const newIndex = cellIndex + direction;
  if (newIndex < 0 || newIndex >= cells.length) return;

  const temp = cells[cellIndex];
  cells[cellIndex] = cells[newIndex];
  cells[newIndex] = temp;

  const cellEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + cellIndex + '"]');
  const otherEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + newIndex + '"]');
  if (!cellEl || !otherEl) return;

  if (direction === -1) {
    const prevDivider = otherEl.previousElementSibling;
    if (prevDivider) prevDivider.before(cellEl);
  } else {
    const nextDivider = otherEl.nextElementSibling;
    if (nextDivider) nextDivider.after(cellEl);
  }

  _refreshCellIndices(tab);
  _markDirty(tab);
  cellEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _changeCellType(tab, cellIndex, newType) {
  const cell = tab._nbData.cells[cellIndex];
  if (!cell || cell.cell_type === newType) return;

  const cellEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + cellIndex + '"]');
  let source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
  if (cellEl && cell.cell_type === 'code') {
    const codeContainer = cellEl.querySelector('.nb-code-source');
    if (codeContainer && codeContainer._cm) source = codeContainer._cm.getValue();
  } else if (cellEl && cellEl._mdCm) {
    source = cellEl._mdCm.getValue();
  }

  cell.cell_type = newType;
  cell.source = source ? source.split('\n').map(function(l, i, a) { return i < a.length - 1 ? l + '\n' : l; }) : [];
  if (newType === 'code') {
    cell.execution_count = cell.execution_count || null;
    cell.outputs = cell.outputs || [];
  } else {
    delete cell.execution_count;
    delete cell.outputs;
  }

  var newCellEl;
  if (newType === 'markdown') {
    newCellEl = _buildMarkdownCell(cell, cellIndex, tab);
  } else if (newType === 'code') {
    newCellEl = _buildCodeCell(cell, cellIndex, tab);
  } else {
    newCellEl = _buildRawCell(cell, cellIndex);
  }

  if (cellEl) {
    const codeContainer = cellEl.querySelector('.nb-code-source');
    if (codeContainer && codeContainer._cm) codeContainer._cm.toTextArea();
    if (cellEl._mdCm) { cellEl._mdCm.toTextArea(); cellEl._mdCm = null; }
    cellEl.replaceWith(newCellEl);
  }

  if (newType === 'code') {
    const codeContainer = newCellEl.querySelector('.nb-code-source');
    _initCodeMirror(codeContainer, tab);
  }

  newCellEl.classList.add('nb-cell-selected');
  _markDirty(tab);
}

function _clearCellOutput(tab, cellIndex) {
  const cell = tab._nbData.cells[cellIndex];
  if (!cell || cell.cell_type !== 'code') return;
  cell.outputs = [];
  cell.execution_count = null;
  const cellEl = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + cellIndex + '"]');
  if (cellEl) {
    const outputsEl = cellEl.querySelector('.nb-outputs');
    if (outputsEl) outputsEl.innerHTML = '';
    const execCount = cellEl.querySelector('.nb-exec-count');
    if (execCount) execCount.textContent = 'In [ ]:';
  }
}

function _clearAllOutputs(tab) {
  const cells = tab._nbData.cells || [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].cell_type === 'code') _clearCellOutput(tab, i);
  }
}

// ── Markdown cell editing ───────────────────────────────────────────
function _enterMarkdownEdit(tab, cellEl) {
  if (!cellEl || cellEl.classList.contains('nb-md-editing')) return;
  if (typeof CodeMirror === 'undefined') return;
  cellEl.classList.add('nb-md-editing');

  const rendered = cellEl.querySelector('.nb-cell-rendered');
  const cellIndex = parseInt(cellEl.dataset.cellIndex, 10);
  const cell = tab._nbData.cells[cellIndex];
  const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

  if (rendered) rendered.style.display = 'none';

  const editContainer = document.createElement('div');
  editContainer.className = 'nb-md-edit-container';
  const textarea = document.createElement('textarea');
  editContainer.appendChild(textarea);
  cellEl.appendChild(editContainer);

  const cm = CodeMirror.fromTextArea(textarea, {
    mode: 'markdown',
    theme: 'default',
    lineWrapping: true,
    lineNumbers: false,
    matchBrackets: true,
    viewportMargin: Infinity,
    extraKeys: {
      'Shift-Enter': function() {
        _exitMarkdownEdit(tab, cellEl);
        const idx = parseInt(cellEl.dataset.cellIndex, 10);
        const next = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + (idx + 1) + '"]');
        if (next) {
          cellEl.classList.remove('nb-cell-selected');
          next.classList.add('nb-cell-selected');
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      },
      'Escape': function() {
        _exitMarkdownEdit(tab, cellEl);
      }
    }
  });
  cm.setValue(source);
  cellEl._mdCm = cm;
  cm.on('change', function() { _markDirty(tab); });
  requestAnimationFrame(function() { cm.focus(); cm.setCursor(cm.lineCount(), 0); });
}

function _exitMarkdownEdit(tab, cellEl) {
  if (!cellEl || !cellEl.classList.contains('nb-md-editing')) return;
  cellEl.classList.remove('nb-md-editing');

  const cm = cellEl._mdCm;
  const cellIndex = parseInt(cellEl.dataset.cellIndex, 10);

  if (cm) {
    const newSource = cm.getValue();
    const cell = tab._nbData.cells[cellIndex];
    if (cell) {
      cell.source = newSource ? newSource.split('\n').map(function(l, i, a) { return i < a.length - 1 ? l + '\n' : l; }) : [];
    }

    const rendered = cellEl.querySelector('.nb-cell-rendered');
    if (rendered) {
      if (newSource.trim()) {
        rendered.innerHTML = _renderMarkdownCell(newSource);
        _processKatexInEl(rendered);
      } else {
        rendered.innerHTML = '<p class="nb-md-placeholder">Double-click to edit markdown</p>';
      }
      rendered.style.display = '';
    }

    cm.toTextArea();
    cellEl._mdCm = null;
  }

  const editContainer = cellEl.querySelector('.nb-md-edit-container');
  if (editContainer) editContainer.remove();
}

// ── Lazy CodeMirror init via IntersectionObserver ────────────────────
function _setupLazyCM(tab) {
  if (typeof IntersectionObserver === 'undefined') return;
  tab._nbCMObserver = new IntersectionObserver(function(entries) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.isIntersecting) continue;
      const codeContainer = entry.target;
      if (codeContainer._cmInitialized) continue;
      _initCodeMirror(codeContainer, tab);
    }
  }, { root: tab._nbScrollContainer, rootMargin: '200px' });

  const codeCells = tab._nbCellsEl.querySelectorAll('.nb-code-source');
  for (let i = 0; i < codeCells.length; i++) {
    tab._nbCMObserver.observe(codeCells[i]);
  }
}

function _initCodeMirror(codeContainer, tab) {
  if (codeContainer._cmInitialized || typeof CodeMirror === 'undefined') return;
  codeContainer._cmInitialized = true;
  const source = codeContainer._source || '';
  const pre = codeContainer.querySelector('pre');
  const lang = tab._nbLanguage || 'python';
  const modeMap = { python: 'python', r: 'r', julia: 'julia', javascript: 'javascript', scala: 'text/x-scala', ruby: 'ruby' };
  const mode = modeMap[lang] || 'python';

  const textarea = document.createElement('textarea');
  codeContainer.appendChild(textarea);
  if (pre) pre.style.display = 'none';

  const cm = CodeMirror.fromTextArea(textarea, {
    mode: mode,
    theme: 'default',
    readOnly: false,
    lineNumbers: true,
    matchBrackets: true,
    closeBrackets: true,
    indentWithTabs: false,
    indentUnit: 4,
    tabSize: 4,
    viewportMargin: Infinity,
    extraKeys: {
      'Tab': function(cm) {
        if (cm.somethingSelected()) { cm.indentSelection('add'); }
        else { cm.replaceSelection('    ', 'end'); }
      },
      'Shift-Tab': function(cm) {
        cm.indentSelection('subtract');
      },
      'Shift-Enter': function() {
        const cellEl = codeContainer.closest('.nb-cell');
        if (!cellEl) return;
        const idx = parseInt(cellEl.dataset.cellIndex, 10);
        _executeCell(tab, idx);
        const next = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + (idx + 1) + '"]');
        if (next) {
          cellEl.classList.remove('nb-cell-selected');
          next.classList.add('nb-cell-selected');
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const nextCode = next.querySelector('.nb-code-source');
          if (nextCode && nextCode._cm) {
            requestAnimationFrame(function() { nextCode._cm.focus(); });
          }
        }
      },
      'Ctrl-Enter': function() {
        const cellEl = codeContainer.closest('.nb-cell');
        if (cellEl) _executeCell(tab, parseInt(cellEl.dataset.cellIndex, 10));
      },
      'Cmd-Enter': function() {
        const cellEl = codeContainer.closest('.nb-cell');
        if (cellEl) _executeCell(tab, parseInt(cellEl.dataset.cellIndex, 10));
      },
      'Alt-Enter': function() {
        const cellEl = codeContainer.closest('.nb-cell');
        if (!cellEl) return;
        const idx = parseInt(cellEl.dataset.cellIndex, 10);
        _executeCell(tab, idx);
        _addCell(tab, idx + 1, 'code');
      },
      'Escape': function() {
        cm.getInputField().blur();
      }
    }
  });
  cm.setValue(source);
  codeContainer._cm = cm;

  cm.on('change', function() {
    codeContainer._source = cm.getValue();
    _markDirty(tab);
  });
}

// ── Toolbar ─────────────────────────────────────────────────────────
function _buildToolbar(tab) {
  const toolbar = document.createElement('div');
  toolbar.className = 'nb-toolbar';

  // Kernel status
  const kernelStatus = document.createElement('div');
  kernelStatus.className = 'nb-kernel-status';
  const kernelDot = document.createElement('span');
  kernelDot.className = 'nb-kernel-dot disconnected';
  const kernelLabel = document.createElement('span');
  kernelLabel.textContent = 'No kernel';
  kernelStatus.appendChild(kernelDot);
  kernelStatus.appendChild(kernelLabel);
  kernelStatus.onclick = function() { _startKernel(tab); };
  toolbar.appendChild(kernelStatus);
  tab._nbKernelDot = kernelDot;
  tab._nbKernelLabel = kernelLabel;

  toolbar.appendChild(_sep());

  // Run All
  const runAllBtn = _tbBtn('Run All', function() { _executeAll(tab); });
  runAllBtn.innerHTML = _PLAY_SVG;
  runAllBtn.title = 'Run all cells';
  runAllBtn.classList.add('nb-tb-labeled');
  runAllBtn.insertAdjacentHTML('beforeend', ' Run All');
  toolbar.appendChild(runAllBtn);

  // Interrupt
  const intBtn = _tbBtn('Interrupt', function() { _interruptKernel(tab); });
  intBtn.innerHTML = _STOP_SVG;
  intBtn.title = 'Interrupt kernel';
  toolbar.appendChild(intBtn);

  // Restart
  const restartBtn = _tbBtn('Restart', function() { _restartKernel(tab); });
  restartBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3"/><polyline points="3,3 3,6 6,6"/><polyline points="13,13 13,10 10,10"/></svg>';
  restartBtn.title = 'Restart kernel';
  toolbar.appendChild(restartBtn);

  toolbar.appendChild(_sep());

  // Add Code Cell
  const addCodeBtn = _tbBtn('Add code cell', function() {
    const selected = tab._nbCellsEl ? tab._nbCellsEl.querySelector('.nb-cell-selected') : null;
    const idx = selected ? parseInt(selected.dataset.cellIndex, 10) + 1 : tab._nbData.cells.length;
    _addCell(tab, idx, 'code');
  });
  addCodeBtn.innerHTML = _PLUS_SVG;
  addCodeBtn.title = 'Add code cell below selected';
  addCodeBtn.classList.add('nb-tb-labeled');
  addCodeBtn.insertAdjacentHTML('beforeend', ' Code');
  toolbar.appendChild(addCodeBtn);

  // Add Markdown Cell
  const addMdBtn = _tbBtn('Add markdown cell', function() {
    const selected = tab._nbCellsEl ? tab._nbCellsEl.querySelector('.nb-cell-selected') : null;
    const idx = selected ? parseInt(selected.dataset.cellIndex, 10) + 1 : tab._nbData.cells.length;
    _addCell(tab, idx, 'markdown');
  });
  addMdBtn.innerHTML = _PLUS_SVG;
  addMdBtn.title = 'Add markdown cell below selected';
  addMdBtn.classList.add('nb-tb-labeled');
  addMdBtn.insertAdjacentHTML('beforeend', ' Md');
  toolbar.appendChild(addMdBtn);

  toolbar.appendChild(_sep());

  // Clear All Outputs
  const clearBtn = _tbBtn('Clear All Outputs', function() { _clearAllOutputs(tab); });
  clearBtn.innerHTML = _CLEAR_SVG;
  clearBtn.title = 'Clear all outputs';
  toolbar.appendChild(clearBtn);

  toolbar.appendChild(_sep());

  // Cell counter
  const cellCounter = document.createElement('span');
  cellCounter.className = 'nb-cell-counter';
  const codeCells = (tab._nbData.cells || []).filter(function(c) { return c.cell_type === 'code'; });
  cellCounter.textContent = codeCells.length + ' code cells';
  toolbar.appendChild(cellCounter);
  tab._nbCellCounter = cellCounter;

  // Spacer
  const spacerEl = document.createElement('span');
  spacerEl.style.flex = '1';
  toolbar.appendChild(spacerEl);

  // Left panel toggle
  var outlineBtn = _tbBtn('Panel', function() {
    const panel = tab._nbLeftPanel;
    if (panel) {
      tab._nbLeftPanelVisible = !tab._nbLeftPanelVisible;
      panel.classList.toggle('visible', tab._nbLeftPanelVisible);
      outlineBtn.classList.toggle('active', tab._nbLeftPanelVisible);
    }
  });
  outlineBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="6" y1="2" x2="6" y2="14"/></svg>';
  outlineBtn.title = 'Toggle left panel';
  toolbar.appendChild(outlineBtn);

  // Zoom
  const zoomOut = _tbBtn('Zoom out', function() { _zoom(tab, -0.1); });
  zoomOut.textContent = '−';
  zoomOut.title = 'Zoom out';
  toolbar.appendChild(zoomOut);
  const zoomIn = _tbBtn('Zoom in', function() { _zoom(tab, 0.1); });
  zoomIn.textContent = '+';
  zoomIn.title = 'Zoom in';
  toolbar.appendChild(zoomIn);

  // Collapse all
  const collapseAllBtn = _tbBtn('Collapse all', function() { _collapseAll(tab); });
  collapseAllBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,6 8,2 12,6"/><polyline points="4,10 8,14 12,10"/></svg>';
  collapseAllBtn.title = 'Collapse/expand all code cells';
  toolbar.appendChild(collapseAllBtn);
  tab._nbCollapseAllBtn = collapseAllBtn;

  return toolbar;
}

function _tbBtn(label, handler) {
  const btn = document.createElement('button');
  btn.className = 'nb-tb-btn';
  btn.setAttribute('aria-label', label);
  btn.onclick = handler;
  return btn;
}

function _sep() {
  const s = document.createElement('span');
  s.className = 'nb-tb-sep';
  return s;
}

// ── Left panel (Files | Outline) ────────────────────────────────────
function _buildNbLeftPanel(tab) {
  const panel = document.createElement('div');
  panel.className = 'nb-left-panel';

  const tabBar = document.createElement('div');
  tabBar.className = 'pdf-left-panel-tabs';

  const filesScroll = document.createElement('div');
  filesScroll.className = 'pdf-thumb-scroll nerd-files-scroll';
  const outlineScroll = document.createElement('div');
  outlineScroll.className = 'pdf-outline-scroll';
  outlineScroll.style.display = 'none';

  tab._nbFilesScroll = filesScroll;

  const filesBtn = document.createElement('button');
  filesBtn.className = 'pdf-left-panel-tab active';
  filesBtn.textContent = 'Files';
  const outlineBtn = document.createElement('button');
  outlineBtn.className = 'pdf-left-panel-tab';
  outlineBtn.textContent = 'Outline';

  filesBtn.onclick = function() {
    filesBtn.classList.add('active'); outlineBtn.classList.remove('active');
    filesScroll.style.display = ''; outlineScroll.style.display = 'none';
    if (typeof window._buildFilesContent === 'function') window._buildFilesContent(filesScroll);
  };
  outlineBtn.onclick = function() {
    outlineBtn.classList.add('active'); filesBtn.classList.remove('active');
    outlineScroll.style.display = ''; filesScroll.style.display = 'none';
  };

  tabBar.appendChild(filesBtn);
  tabBar.appendChild(outlineBtn);
  panel.appendChild(tabBar);

  const content = document.createElement('div');
  content.className = 'pdf-left-panel-content';
  content.appendChild(filesScroll);
  content.appendChild(outlineScroll);
  panel.appendChild(content);

  // Fill outline
  const cells = tab._nbData.cells || [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.cell_type !== 'markdown') continue;
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const headingMatch = source.match(/^(#{1,6})\s+(.+)/m);
    if (!headingMatch) continue;
    const level = headingMatch[1].length;
    const text = headingMatch[2].replace(/[#*_`\[\]]/g, '').trim();
    const item = document.createElement('div');
    item.className = 'nb-outline-heading';
    item.dataset.level = level;
    item.textContent = text;
    item.dataset.cellIndex = i;
    item.onclick = (function(ci) { return function() { _notebookViewerScrollToCell(tab, ci); }; })(i);
    outlineScroll.appendChild(item);
  }

  filesBtn.onclick();

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
  const cells = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell-code') : [];
  let anyExpanded = false;
  for (var i = 0; i < cells.length; i++) {
    if (!cells[i].classList.contains('nb-cell-collapsed')) { anyExpanded = true; break; }
  }
  for (var i = 0; i < cells.length; i++) {
    if (anyExpanded) cells[i].classList.add('nb-cell-collapsed');
    else cells[i].classList.remove('nb-cell-collapsed');
    const btn = cells[i].querySelector('.nb-collapse-btn');
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
    const labels = { idle: 'Idle', busy: 'Busy', disconnected: 'No kernel', starting: 'Starting...' };
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
    const execCounts = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-exec-count') : [];
    for (let i = 0; i < execCounts.length; i++) {
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
  const cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + cellIndex + '"]') : null;
  if (!cellEl || cellEl.dataset.cellType !== 'code') return;

  if (tab._nbKernelState !== 'idle' && tab._nbKernelState !== 'busy') {
    await _startKernel(tab);
    if (tab._nbKernelState !== 'idle') return;
  }

  const codeSource = cellEl.querySelector('.nb-code-source');
  let source = '';
  if (codeSource._cm) {
    source = codeSource._cm.getValue();
  } else {
    source = codeSource._source || '';
  }
  if (!source.trim()) return;

  // Sync source back to data
  const cell = tab._nbData.cells[cellIndex];
  if (cell) {
    cell.source = source.split('\n').map(function(l, i, a) { return i < a.length - 1 ? l + '\n' : l; });
  }

  const cellId = 'cell-' + cellIndex;
  const execCount = cellEl.querySelector('.nb-exec-count');
  const outputsEl = cellEl.querySelector('.nb-outputs');

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
  const cells = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell-code') : [];
  for (let i = 0; i < cells.length; i++) {
    const idx = parseInt(cells[i].dataset.cellIndex, 10);
    await _executeCell(tab, idx);
    await new Promise(function(resolve) {
      const check = function() {
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
    const cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + data.cellId.replace('cell-', '') + '"]') : null;
    if (!cellEl) return;
    const outputsEl = cellEl.querySelector('.nb-outputs');
    if (!outputsEl) return;

    if (data.event === 'stream') {
      const lastStream = outputsEl.querySelector('.nb-output-stream:last-child pre' + (data.name === 'stderr' ? '.nb-stderr' : ':not(.nb-stderr)'));
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
      const tb = (data.traceback || []).join('\n');
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
    const cellEl = tab._nbCellsEl ? tab._nbCellsEl.querySelector('[data-cell-index="' + data.cellId.replace('cell-', '') + '"]') : null;
    if (!cellEl) return;
    cellEl.classList.remove('nb-cell-executing');
    const execCount = cellEl.querySelector('.nb-exec-count');
    if (execCount) {
      execCount.textContent = data.executionCount != null ? 'In [' + data.executionCount + ']:' : 'In [ ]:';
      execCount.classList.remove('nb-exec-running');
    }
    // Store execution count in data
    const cellIndex = parseInt(cellEl.dataset.cellIndex, 10);
    const cell = tab._nbData.cells[cellIndex];
    if (cell) cell.execution_count = data.executionCount;
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
    const iframes = tab._nbViewerEl ? tab._nbViewerEl.querySelectorAll('.nb-output-html iframe') : [];
    for (let i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === event.source) {
        iframes[i].style.height = Math.min(event.data.height + 16, 600) + 'px';
        break;
      }
    }
  };
  window.addEventListener('message', tab._nbIframeResizeHandler);
}

// ── Keyboard shortcuts (command mode + global) ──────────────────────
function _setupKeyboard(tab) {
  let dPending = false;

  tab._nbKeyHandler = function(e) {
    if (!tab._nbViewerEl || !tab._nbViewerEl.offsetParent) return;

    // Cmd+S / Ctrl+S — save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      _saveNotebook(tab);
      return;
    }

    const selected = tab._nbCellsEl ? tab._nbCellsEl.querySelector('.nb-cell-selected') : null;
    const cellIndex = selected ? parseInt(selected.dataset.cellIndex, 10) : -1;

    // Check if we're in an editor
    const activeEl = document.activeElement;
    const inEditor = activeEl && (activeEl.closest && activeEl.closest('.CodeMirror'));

    // Skip command mode if typing in an input/textarea outside CodeMirror
    const tag = activeEl ? activeEl.tagName : '';
    if (!inEditor && (tag === 'INPUT' || tag === 'TEXTAREA' || (activeEl && activeEl.isContentEditable))) return;

    if (inEditor) {
      // Edit mode — only Escape exits
      if (e.key === 'Escape') {
        e.preventDefault();
        const cmEl = activeEl.closest('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) cmEl.CodeMirror.getInputField().blur();
      }
      return;
    }

    // ── Command mode shortcuts ──

    // Enter → edit mode
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selected) {
        if (selected.dataset.cellType === 'code') {
          const cc = selected.querySelector('.nb-code-source');
          if (cc && cc._cm) cc._cm.focus();
        } else if (selected.dataset.cellType === 'markdown') {
          _enterMarkdownEdit(tab, selected);
        }
      }
      dPending = false;
      return;
    }

    // Navigation: Up/k, Down/j
    if (e.key === 'ArrowUp' || e.key === 'k') {
      if (e.altKey && cellIndex >= 0) {
        e.preventDefault();
        _moveCell(tab, cellIndex, -1);
      } else if (cellIndex > 0) {
        e.preventDefault();
        const prev = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + (cellIndex - 1) + '"]');
        if (prev) {
          selected.classList.remove('nb-cell-selected');
          prev.classList.add('nb-cell-selected');
          prev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      dPending = false;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'j') {
      if (e.altKey && cellIndex >= 0) {
        e.preventDefault();
        _moveCell(tab, cellIndex, 1);
      } else {
        e.preventDefault();
        const next = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + (cellIndex + 1) + '"]');
        if (next) {
          if (selected) selected.classList.remove('nb-cell-selected');
          next.classList.add('nb-cell-selected');
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      dPending = false;
      return;
    }

    // a — add cell above
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _addCell(tab, cellIndex >= 0 ? cellIndex : 0, 'code');
      dPending = false;
      return;
    }
    // b — add cell below
    if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _addCell(tab, cellIndex >= 0 ? cellIndex + 1 : tab._nbData.cells.length, 'code');
      dPending = false;
      return;
    }

    // dd — delete cell
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (dPending) {
        if (cellIndex >= 0) _deleteCell(tab, cellIndex);
        dPending = false;
      } else {
        dPending = true;
        setTimeout(function() { dPending = false; }, 500);
      }
      return;
    }

    // m — to markdown
    if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (cellIndex >= 0) _changeCellType(tab, cellIndex, 'markdown');
      dPending = false;
      return;
    }
    // y — to code
    if (e.key === 'y' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (cellIndex >= 0) _changeCellType(tab, cellIndex, 'code');
      dPending = false;
      return;
    }

    // z — undo delete
    if (e.key === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _undoDeleteCell(tab);
      dPending = false;
      return;
    }

    // Shift+Enter — run and advance
    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      if (cellIndex >= 0) {
        if (selected && selected.dataset.cellType === 'markdown') {
          _exitMarkdownEdit(tab, selected);
        } else {
          _executeCell(tab, cellIndex);
        }
        const next = tab._nbCellsEl.querySelector('.nb-cell[data-cell-index="' + (cellIndex + 1) + '"]');
        if (next) {
          if (selected) selected.classList.remove('nb-cell-selected');
          next.classList.add('nb-cell-selected');
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      dPending = false;
      return;
    }
    // Ctrl+Enter — run in place
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (cellIndex >= 0) _executeCell(tab, cellIndex);
      dPending = false;
      return;
    }

    dPending = false;
  };
  document.addEventListener('keydown', tab._nbKeyHandler);
}

// ── Cell click selection ────────────────────────────────────────────
function _setupCellSelection(tab) {
  tab._nbCellClickHandler = function(e) {
    const cell = e.target.closest('.nb-cell');
    if (!cell) return;
    const prev = tab._nbCellsEl.querySelector('.nb-cell-selected');
    if (prev && prev !== cell) prev.classList.remove('nb-cell-selected');
    cell.classList.add('nb-cell-selected');
  };
  tab._nbCellsEl.addEventListener('click', tab._nbCellClickHandler);
}

// ── Public API ──────────────────────────────────────────────────────
export function _notebookViewerInit(tab, viewerEl, notebookData) {
  tab._nbData = notebookData;
  tab._nbViewerEl = viewerEl;
  tab._nbFontScale = tab._nbFontScale || 1;
  tab._nbDirty = false;
  tab._nbDeleteStack = [];

  const meta = notebookData.metadata || {};
  const kernelspec = meta.kernelspec || {};
  tab._nbLanguage = kernelspec.language || (meta.language_info && meta.language_info.name) || 'python';

  viewerEl.style.display = 'flex';
  viewerEl.style.flexDirection = 'column';
  viewerEl.style.height = '100%';

  // Toolbar
  const toolbar = _buildToolbar(tab);
  viewerEl.appendChild(toolbar);
  tab._nbToolbar = toolbar;

  // Body wrapper
  const bodyWrapper = document.createElement('div');
  bodyWrapper.className = 'nb-body-wrapper';

  // Left panel
  const leftPanel = _buildNbLeftPanel(tab);
  bodyWrapper.appendChild(leftPanel);
  tab._nbLeftPanel = leftPanel;
  tab._nbLeftPanelVisible = false;

  // Drag handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pdf-left-panel-resize';
  bodyWrapper.appendChild(resizeHandle);
  resizeHandle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftPanel.offsetWidth;
    function onMove(ev) {
      const w = Math.max(100, Math.min(500, startW + ev.clientX - startX));
      leftPanel.style.width = w + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Scroll container
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'nb-scroll-container';
  tab._nbScrollContainer = scrollContainer;

  // Cells
  const cellsEl = document.createElement('div');
  cellsEl.className = 'nb-cells';
  cellsEl.style.setProperty('--nb-font-scale', tab._nbFontScale);
  tab._nbCellsEl = cellsEl;

  const cells = notebookData.cells || [];

  // Initial divider
  cellsEl.appendChild(_buildAddCellDivider(tab, 0));

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    var cellEl;
    if (cell.cell_type === 'markdown') {
      cellEl = _buildMarkdownCell(cell, i, tab);
    } else if (cell.cell_type === 'code') {
      cellEl = _buildCodeCell(cell, i, tab);
    } else {
      cellEl = _buildRawCell(cell, i);
    }
    cellsEl.appendChild(cellEl);
    cellsEl.appendChild(_buildAddCellDivider(tab, i + 1));
  }

  // Select first cell
  const firstCell = cellsEl.querySelector('.nb-cell');
  if (firstCell) firstCell.classList.add('nb-cell-selected');

  scrollContainer.appendChild(cellsEl);
  bodyWrapper.appendChild(scrollContainer);
  viewerEl.appendChild(bodyWrapper);

  _setupLazyCM(tab);
  _setupKeyboard(tab);
  _setupCellSelection(tab);
  _setupIPCListeners(tab);
  _setupIframeResize(tab);
}

export function _notebookViewerDestroy(tab) {
  _shutdownKernel(tab);

  if (tab._nbKeyHandler) {
    document.removeEventListener('keydown', tab._nbKeyHandler);
    tab._nbKeyHandler = null;
  }
  if (tab._nbIframeResizeHandler) {
    window.removeEventListener('message', tab._nbIframeResizeHandler);
    tab._nbIframeResizeHandler = null;
  }
  _removeIPCListeners(tab);

  if (tab._nbCellsEl) {
    const cms = tab._nbCellsEl.querySelectorAll('.nb-code-source');
    for (let i = 0; i < cms.length; i++) {
      if (cms[i]._cm) { cms[i]._cm.toTextArea(); cms[i]._cm = null; }
    }
    const mdCells = tab._nbCellsEl.querySelectorAll('.nb-cell-markdown');
    for (let i = 0; i < mdCells.length; i++) {
      if (mdCells[i]._mdCm) { mdCells[i]._mdCm.toTextArea(); mdCells[i]._mdCm = null; }
    }
  }

  if (tab._nbCMObserver) { tab._nbCMObserver.disconnect(); tab._nbCMObserver = null; }

  if (tab._nbViewerEl) tab._nbViewerEl.innerHTML = '';

  tab._nbData = null;
  tab._nbCellsEl = null;
  tab._nbScrollContainer = null;
  tab._nbLeftPanel = null;
  tab._nbLeftPanelVisible = false;
  tab._nbFilesScroll = null;
  tab._nbToolbar = null;
  tab._nbKernelDot = null;
  tab._nbKernelLabel = null;
  tab._nbCellCounter = null;
  tab._nbDirty = false;
  tab._nbDeleteStack = null;
}

export function _notebookViewerGetText(tab) {
  if (!tab._nbData) return '';
  const cells = tab._nbData.cells || [];
  const cellEls = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell') : [];
  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    let source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const cellEl = cellEls[i];
    // Pull live source from editors
    if (cellEl && cell.cell_type === 'code') {
      const cc = cellEl.querySelector('.nb-code-source');
      if (cc && cc._cm) source = cc._cm.getValue();
    } else if (cellEl && cellEl._mdCm) {
      source = cellEl._mdCm.getValue();
    }
    if (cell.cell_type === 'markdown') {
      parts.push(source);
    } else if (cell.cell_type === 'code') {
      parts.push('```' + (tab._nbLanguage || 'python') + '\n' + source + '\n```');
      const outputs = cell.outputs || [];
      for (let j = 0; j < outputs.length; j++) {
        const out = outputs[j];
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
  const cellEl = tab._nbCellsEl.querySelector('[data-cell-index="' + cellIndex + '"]');
  if (cellEl) {
    cellEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const prev = tab._nbCellsEl.querySelector('.nb-cell-selected');
    if (prev) prev.classList.remove('nb-cell-selected');
    cellEl.classList.add('nb-cell-selected');
  }
}

// ── Serialize notebook to .ipynb JSON ────────────────────────────────
export function _notebookViewerSerialize(tab) {
  if (!tab._nbData) return null;
  const nb = {
    nbformat: tab._nbData.nbformat || 4,
    nbformat_minor: tab._nbData.nbformat_minor || 5,
    metadata: tab._nbData.metadata || {},
    cells: []
  };
  const cells = tab._nbData.cells || [];
  const cellEls = tab._nbCellsEl ? tab._nbCellsEl.querySelectorAll('.nb-cell') : [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const cellEl = cellEls[i];
    let source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    if (cellEl && cell.cell_type === 'code') {
      const codeContainer = cellEl.querySelector('.nb-code-source');
      if (codeContainer && codeContainer._cm) {
        source = codeContainer._cm.getValue();
      }
    } else if (cellEl && cellEl._mdCm) {
      source = cellEl._mdCm.getValue();
    }
    const outCell = {
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
  let filePath = tab.localPath;
  if (!filePath || tab._nbUnsaved) {
    filePath = await electronAPI.showSaveDialog({
      defaultPath: tab.title ? tab.title.replace(/^● /, '') : 'Untitled.ipynb',
      filters: [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }]
    });
    if (!filePath) return;
  }
  const json = _notebookViewerSerialize(tab);
  if (!json) return;
  try {
    await electronAPI.notebookSave(filePath, json);
    tab.localPath = filePath;
    tab._nbUnsaved = false;
    tab._nbDirty = false;
    tab.title = filePath.split('/').pop();
    if (typeof _browseRenderTabs === 'function') _browseRenderTabs();
    else if (typeof window._browseRenderTabs === 'function') window._browseRenderTabs();
    toast('Notebook saved');
  } catch (e) {
    console.error('Failed to save notebook:', e);
    toast('Save failed: ' + e.message);
  }
}

// ── Window bridge (for non-module access) ───────────────────────────
window._notebookViewerInit = _notebookViewerInit;
window._notebookViewerDestroy = _notebookViewerDestroy;
window._notebookViewerGetText = _notebookViewerGetText;
window._notebookViewerScrollToCell = _notebookViewerScrollToCell;
window._notebookViewerSerialize = _notebookViewerSerialize;
