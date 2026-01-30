// ── Markdown Editor ──
function renderMarkdownEditor(fname, content) {
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">md</span>
      <span class="text-[0.9rem] text-white_ font-medium">${escapeHtml(fname)}</span>
      <span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="md-save-ind">Saved</span>
    </div>
    <textarea id="md-editor-textarea" class="w-full min-h-[500px] px-4 py-3 rounded-lg border border-border-input bg-input text-primary text-[0.85rem] font-mono resize-y focus:outline-none focus:border-accent" spellcheck="false">${escapeHtml(content)}</textarea>`;
  const ta = document.getElementById('md-editor-textarea');
  ta.addEventListener('input', () => {
    clearTimeout(fileSaveTimer);
    fileSaveTimer = setTimeout(() => saveMarkdown(), 600);
  });
  ta.focus();
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

// ── Python File Editor ──
let pyEditorCm = null;

function renderPythonEditor(fname, content) {
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">py</span>
      <span class="text-[0.9rem] text-white_ font-medium">${escapeHtml(fname)}</span>
      <span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="py-save-ind">Saved</span>
    </div>
    <div class="rounded-lg border border-border-input overflow-hidden">
      <textarea id="py-editor-textarea">${escapeHtml(content)}</textarea>
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
    <div class="flex items-center gap-3 mb-4 flex-wrap">
      <span class="text-[0.75rem] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">nb</span>
      <span class="text-[0.9rem] text-white_ font-medium">${escapeHtml(fname)}</span>
      <span class="text-[0.75rem] text-emerald-400 opacity-0 transition-opacity" id="nb-save-ind">Saved</span>
      <div class="ml-auto flex items-center gap-3">
        <span class="flex items-center gap-1.5 text-[0.75rem] text-dim">
          <span id="kernel-dot" class="w-2 h-2 rounded-full bg-gray-500 inline-block"></span>
          <span id="kernel-status-text">idle</span>
        </span>
        <button class="px-2 py-1 rounded border border-border-input bg-transparent text-muted text-[0.75rem] cursor-pointer hover:text-primary" onclick="restartKernel()">Restart kernel</button>
        <select id="nb-venv-select" class="px-2 py-1 rounded border border-border-input bg-input text-primary text-[0.75rem] cursor-pointer focus:outline-none focus:border-accent" onchange="switchVenv(this.value)">
          <option value="python3" ${pythonPath === 'python3' ? 'selected' : ''}>System python3</option>
        </select>
        <button id="btn-create-venv" class="px-2 py-1 rounded border border-border-input bg-transparent text-muted text-[0.75rem] cursor-pointer hover:text-primary" onclick="createVenv()">+ venv</button>
        <button class="px-2 py-1 rounded border border-border-input bg-transparent text-muted text-[0.75rem] cursor-pointer hover:text-primary" onclick="togglePackagesPanel()">Packages</button>
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
    <div class="flex gap-2 mt-3">
      <button class="px-3 py-1.5 rounded-md border border-border-input bg-transparent text-muted text-[0.8rem] cursor-pointer hover:text-primary" onclick="addNbCell('code')">+ Code</button>
      <button class="px-3 py-1.5 rounded-md border border-border-input bg-transparent text-muted text-[0.8rem] cursor-pointer hover:text-primary" onclick="addNbCell('markdown')">+ Markdown</button>
    </div>`;
  renderNbCells();
  loadVenvDropdown(pythonPath);
}

async function loadVenvDropdown(currentPath) {
  const select = document.getElementById('nb-venv-select');
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
  container.innerHTML = nbData.cells.map((cell, i) => {
    const isCode = cell.cell_type === 'code';
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const outputs = renderCellOutputs(cell.outputs || []);

    return `<div class="mb-3 rounded-lg border border-border-dim overflow-hidden" data-cell="${i}">
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
      <div data-cell-editor="${i}"><textarea data-cell-input="${i}">${escapeHtml(src)}</textarea></div>
      <div data-cell-rendered="${i}" class="hidden px-4 py-3 nb-rendered-md text-[0.85rem] cursor-pointer" onclick="editMdCell(${i})" title="Click to edit"></div>
      ${outputs ? `<div class="px-4 py-2 bg-body/50 border-t border-border-dim text-[0.8rem] font-mono text-muted whitespace-pre-wrap" data-cell-output="${i}">${outputs}</div>` : `<div class="hidden" data-cell-output="${i}"></div>`}
    </div>`;
  }).join('');

  nbData.cells.forEach((cell, i) => {
    const ta = container.querySelector(`[data-cell-input="${i}"]`);
    if (!ta) { cmInstances.push(null); return; }
    const isCode = cell.cell_type === 'code';
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
    if (!isCode && src.trim()) {
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

async function runNbCell(i) {
  if (!nbData || !nbData.cells[i] || nbData.cells[i].cell_type !== 'code') return;
  const src = Array.isArray(nbData.cells[i].source) ? nbData.cells[i].source.join('') : nbData.cells[i].source;
  if (!src.trim()) return;

  updateKernelStatus('busy');
  const outEl = document.querySelector(`[data-cell-output="${i}"]`);
  if (outEl) { outEl.classList.remove('hidden'); outEl.textContent = 'Running...'; outEl.className = outEl.className.replace('hidden',''); }

  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/execute`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code: src})
    });
    const result = await resp.json();
    const cellOutputs = result.outputs || [];

    nbData.cells[i].outputs = cellOutputs;

    if (outEl) {
      const rendered = renderCellOutputs(cellOutputs);
      if (rendered) {
        outEl.classList.remove('hidden');
        outEl.style.display = '';
        outEl.innerHTML = rendered;
      } else {
        outEl.classList.add('hidden');
      }
    }
    updateKernelStatus('idle');
    scheduleNbSave();
  } catch(e) {
    if (outEl) { outEl.classList.remove('hidden'); outEl.innerHTML = `<span class="text-red-400">${escapeHtml(e.message)}</span>`; }
    updateKernelStatus('dead');
  }
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
  dot.className = `w-2 h-2 rounded-full inline-block ${colors[status]||'bg-gray-500'}`;
  text.textContent = status;
}

async function restartKernel() {
  updateKernelStatus('dead');
  await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST'});
  updateKernelStatus('idle');
}
