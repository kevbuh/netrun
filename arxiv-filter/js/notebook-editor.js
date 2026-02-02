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
        <button onclick="restartKernel()" class="w-7 h-7 rounded flex items-center justify-center border-none bg-transparent text-dimmer cursor-pointer hover:text-primary" title="Restart kernel"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg></button>
        <div class="relative inline-flex items-center">
          <button class="px-1.5 py-0.5 rounded border-none bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="toggleVenvMenu()">Env</button>
          <div id="py-venv-menu" class="hidden absolute right-0 top-full mt-1 z-50 bg-card border border-border-card rounded-lg shadow-lg py-1 min-w-[220px]">
            <div id="venv-menu-status" class="px-3 py-1.5 text-[0.7rem] text-muted flex items-center gap-1.5"></div>
            <div class="h-px bg-border-subtle mx-2 my-0.5"></div>
            <div class="px-3 py-1.5 text-[0.68rem] text-dimmest uppercase tracking-wide">Environment</div>
            <div class="px-3 py-1"><select id="nb-venv-select" onchange="switchVenv(this.value)" class="w-full px-1.5 py-1 rounded border border-border-input bg-input text-primary text-[0.7rem] cursor-pointer focus:outline-none focus:border-accent"><option value="python3" ${pythonPath === 'python3' ? 'selected' : ''}>System python3</option></select></div>
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
        <button class="px-1.5 py-0.5 rounded border-none bg-transparent text-muted text-[0.7rem] cursor-pointer hover:text-primary" onclick="convertNbToPy()" title="Export all code cells as a .py file">Convert to .py</button>
      </div>
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
    // Render delete buttons for venvs in the menu
    const delContainer = document.getElementById('venv-delete-list');
    if (delContainer) {
      if (venvs.length === 0) {
        delContainer.innerHTML = '';
      } else {
        delContainer.innerHTML = venvs.map(v => {
          const label = v.id === currentExpId ? 'this project' : escapeHtml(v.title);
          return `<div class="flex items-center justify-between px-3 py-1 text-[0.7rem]"><span class="text-muted truncate">${label}</span><button onclick="deleteVenv('${escapeHtml(v.id)}','${escapeHtml(v.title).replace(/'/g, "\\'")}')" class="text-red-400 hover:text-red-300 bg-transparent border-none cursor-pointer text-[0.65rem] shrink-0">&times; delete</button></div>`;
        }).join('');
      }
    }
  } catch(e) { /* keep default */ }
  loadVenvInfo();
}

async function loadVenvInfo() {
  const el = document.getElementById('venv-info');
  if (!el || !currentExpId) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/venv-info`, { headers: _authHeaders() });
    const info = await resp.json();
    // Top bar: python version, pkg count, disk size (no path)
    const parts = [];
    parts.push(`<span>${escapeHtml(info.pythonVersion || 'Python')}</span>`);
    if (info.hasVenv) {
      parts.push(`<span>${info.packageCount || 0} pkg${info.packageCount !== 1 ? 's' : ''}</span>`);
      parts.push(`<span>${escapeHtml(info.diskSize || '?')}</span>`);
    }
    const sep = '<span class="text-border-input">·</span>';
    el.innerHTML = parts.join(sep);
    // Env popup: size info line
    const sizeEl = document.getElementById('venv-size-info');
    if (sizeEl) {
      const sizeParts = [];
      if (info.pythonVersion) sizeParts.push(escapeHtml(info.pythonVersion));
      if (info.hasVenv && info.diskSize) sizeParts.push(escapeHtml(info.diskSize));
      if (info.hasVenv && info.packageCount != null) sizeParts.push(`${info.packageCount} pkg${info.packageCount !== 1 ? 's' : ''}`);
      sizeEl.textContent = sizeParts.join(' · ') || '';
    }
    // Env popup: status with dot and path
    const statusEl = document.getElementById('venv-menu-status');
    if (statusEl) {
      const dotColor = kernelStatus === 'busy' ? 'bg-amber-500' : kernelStatus === 'dead' ? 'bg-red-500' : 'bg-emerald-500';
      const displayPath = info.venvPath || info.pythonPath || '';
      statusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full inline-block ${dotColor}"></span><span class="text-[0.68rem] text-muted truncate" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath || 'python3')}</span>`;
    }
  } catch(e) {
    el.innerHTML = '';
  }
}

async function switchVenv(pythonPath) {
  await fetch(`/api/experiments/${currentExpId}`, {
    method:'PUT', headers:{ ..._authHeaders(), 'Content-Type':'application/json'},
    body: JSON.stringify({pythonPath})
  });
  if (currentExp) currentExp.pythonPath = pythonPath;
  updateKernelStatus('dead');
  try {
    await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST', headers: _authHeaders()});
    updateKernelStatus('idle');
  } catch(e) { /* will restart on next run */ }
  loadVenvInfo();
}

async function createVenv() {
  if (!confirm('Create a new virtual environment for this project?')) return;
  const btn = document.getElementById('btn-create-venv');
  const statusEl = document.getElementById('venv-create-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('hidden'); }
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/venv`, { method: 'POST', headers: _authHeaders() });
    const data = await resp.json();
    if (data.ok) {
      if (currentExp) currentExp.pythonPath = data.pythonPath;
      updateKernelStatus('dead');
      await loadVenvDropdown(data.pythonPath);
      if (btn) { btn.textContent = '+ Create venv'; btn.disabled = false; }
      if (statusEl) { statusEl.innerHTML = `<span class="text-emerald-400">Created at ${escapeHtml(data.pythonPath.replace(/\/bin\/python$/, ''))}</span>`; }
      try {
        await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST', headers: _authHeaders()});
        updateKernelStatus('idle');
      } catch(e) { /* will restart on next run */ }
      loadVenvInfo();
    } else {
      if (btn) { btn.textContent = 'Failed'; btn.disabled = false; setTimeout(() => { btn.textContent = '+ Create venv'; }, 2000); }
      if (statusEl) { statusEl.innerHTML = `<span class="text-red-400">${escapeHtml(data.error || 'Failed')}</span>`; }
    }
  } catch(e) {
    if (btn) { btn.textContent = 'Error'; btn.disabled = false; setTimeout(() => { btn.textContent = '+ Create venv'; }, 2000); }
    if (statusEl) { statusEl.innerHTML = '<span class="text-red-400">Error creating venv</span>'; }
  }
}

async function deleteVenv(expId, title) {
  if (!confirm(`Delete the virtual environment for "${title}"? This cannot be undone.`)) return;
  try {
    const resp = await fetch(`/api/experiments/${expId}/venv`, { method: 'DELETE', headers: _authHeaders() });
    const data = await resp.json();
    if (data.ok) {
      // If we deleted the venv we're currently using, switch to system python
      if (currentExp && currentExp.pythonPath && currentExp.pythonPath.includes(`/${expId}/venv/`)) {
        currentExp.pythonPath = 'python3';
        updateKernelStatus('dead');
      }
      const currentPath = (currentExp && currentExp.pythonPath) || 'python3';
      await loadVenvDropdown(currentPath);
      loadVenvInfo();
    }
  } catch(e) { /* best effort */ }
}

function togglePackagesPanel() {
  // Packages are now inside the Env menu — open it
  toggleVenvMenu();
}

async function loadPackagesList() {
  const listEl = document.getElementById('pkg-list');
  if (!listEl) return;
  listEl.textContent = 'Loading...';
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/packages`, { headers: _authHeaders() });
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

function _quickInstallPkgs(pkgs) {
  const input = document.getElementById('pkg-install-input');
  if (!input) return;
  input.value = pkgs;
  input.focus();
}

let _installAbort = null;

async function installPackages() {
  const input = document.getElementById('pkg-install-input');
  const statusEl = document.getElementById('pkg-install-status');
  const installBtn = document.getElementById('pkg-install-btn');
  if (!input || !input.value.trim()) return;
  const packages = input.value.trim();
  input.disabled = true;
  _installAbort = new AbortController();
  if (installBtn) { installBtn.disabled = false; installBtn.innerHTML = 'Cancel'; installBtn.onclick = cancelInstall; }
  if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'text-[0.75rem] mb-2 text-muted max-h-[200px] overflow-y-auto'; statusEl.innerHTML = `<span class="spinner"></span> Installing ${escapeHtml(packages)}...`; restartSpinners(); }
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/packages`, {
      method: 'POST', headers: { ..._authHeaders(), 'Content-Type':'application/json' },
      body: JSON.stringify({ packages }),
      signal: _installAbort.signal
    });
    const data = await resp.json();
    if (data.ok) {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-emerald-400'; statusEl.textContent = 'Installed — kernel restarting...'; }
      input.value = '';
      loadPackagesList();
      updateKernelStatus('dead');
      try {
        await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST', headers: _authHeaders()});
        updateKernelStatus('idle');
      } catch(e) { /* kernel will be recreated on next run */ }
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-emerald-400'; statusEl.textContent = 'Installed — kernel ready'; }
      setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 3000);
    } else {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-red-400 max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono'; statusEl.textContent = data.error || 'Install failed'; }
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-muted'; statusEl.textContent = 'Installation cancelled'; setTimeout(() => { if (statusEl) statusEl.classList.add('hidden'); }, 2000); }
    } else {
      if (statusEl) { statusEl.className = 'text-[0.75rem] mb-2 text-red-400'; statusEl.textContent = 'Install failed'; }
    }
  }
  _installAbort = null;
  input.disabled = false;
  if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Install'; installBtn.onclick = installPackages; }
}

function cancelInstall() {
  if (_installAbort) { _installAbort.abort(); _installAbort = null; }
}

async function uninstallPackage(name) {
  const statusEl = document.getElementById('pkg-install-status');
  if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'text-[0.75rem] mb-2 text-muted'; statusEl.textContent = `Uninstalling ${name}...`; }
  try {
    await fetch(`/api/experiments/${currentExpId}/packages/${encodeURIComponent(name)}`, { method: 'DELETE', headers: _authHeaders() });
    loadPackagesList();
    updateKernelStatus('dead');
    try {
      await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST', headers: _authHeaders()});
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
    const resp = await fetch(`/api/experiments/${currentExpId}/files`, { headers: _authHeaders() });
    const existing = await resp.json();
    let name = `output.${ext}`, i = 2;
    while (existing.includes(name)) { name = `output-${i}.${ext}`; i++; }
    const saveResp = await fetch(`/api/experiments/${currentExpId}/files`, {
      method: 'POST', headers: { ..._authHeaders(), 'Content-Type':'application/json' },
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

async function convertNbToPy() {
  if (!nbData || !currentExpId || !currentFile) return;
  // Sync live CodeMirror content back to nbData
  cmInstances.forEach(function(cm, i) {
    if (cm && nbData.cells[i]) {
      nbData.cells[i].source = cm.getValue();
    }
  });
  const chunks = [];
  for (const cell of nbData.cells) {
    if (cell.cell_type !== 'code') continue;
    const src = typeof cell.source === 'string' ? cell.source : (Array.isArray(cell.source) ? cell.source.join('') : '');
    if (src.trim()) chunks.push(src);
  }
  const pyContent = chunks.join('\n\n');
  const dir = currentFile.includes('/') ? currentFile.substring(0, currentFile.lastIndexOf('/') + 1) : '';
  const base = currentFile.includes('/') ? currentFile.substring(currentFile.lastIndexOf('/') + 1) : currentFile;
  const pyName = dir + base.replace(/\.ipynb$/, '.py');
  await fetch(`/api/experiments/${currentExpId}/files/${pyName}`, {
    method: 'PUT', headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: pyContent })
  });
  fetchExpFiles();
  openFile(pyName);
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
          ${isCode ? `<button class="w-6 h-6 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"/></svg></button>` : ''}
          ${!isCode ? `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-blue-500/20 text-blue-400 border-none cursor-pointer hover:bg-blue-500/30" onclick="renderMdCell(${i})" title="Render (Shift+Enter)">Render</button>` : ''}
          ${isCode ? `<button class="px-2 py-0.5 rounded text-[0.7rem] bg-blue-500/10 text-blue-400 border-none cursor-pointer hover:bg-blue-500/20" onclick="exportCellToPy(${i})" title="Export to .py file">.py</button>` : ''}
          <button class="w-6 h-6 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary" onclick="copyNbCell(${i})" title="Copy cell contents"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
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
    if (isCode) _attachGotoDef(cm);
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
    method:'PUT', headers:{ ..._authHeaders(), 'Content-Type':'application/json'},
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

function copyNbCell(i) {
  if (!nbData || !nbData.cells[i]) return;
  const cm = cmInstances[i];
  const src = cm ? cm.getValue() : (Array.isArray(nbData.cells[i].source) ? nbData.cells[i].source.join('') : nbData.cells[i].source || '');
  navigator.clipboard.writeText(src).then(() => {
    const cellEl = document.querySelector(`[data-cell="${i}"]`);
    const btn = cellEl && cellEl.querySelector('[title="Copy cell contents"]');
    if (btn) { const orig = btn.innerHTML; btn.innerHTML = '<svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'; setTimeout(() => btn.innerHTML = orig, 1200); }
  });
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
    await fetch(`/api/experiments/${currentExpId}/kernel/interrupt`, {method:'POST', headers: _authHeaders()});
  } catch(e) { /* best effort */ }
}

function _streamExecute(expId, code, onOutput, onDone, onError) {
  const abort = new AbortController();
  _execAbort = abort;
  fetch(`/api/experiments/${expId}/execute`, {
    method: 'POST', headers: { ..._authHeaders(), 'Content-Type':'application/json' },
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
    runBtn.outerHTML = `<button class="w-6 h-6 rounded flex items-center justify-center bg-red-500/20 text-red-400 border-none cursor-pointer hover:bg-red-500/30" onclick="stopNbCell(${i})" title="Stop cell">${_nbPauseIcon}</button>`;
  }
}

let _runCooldown = false;

const _nbPlayIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"/></svg>';
const _nbPauseIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 5.25v13.5m-7.5-13.5v13.5"/></svg>';

function _swapToRun(cellEl, i) {
  if (!cellEl) return;
  const header = cellEl.querySelector('.ml-auto');
  const btn = header && (header.querySelector('[onclick^="stopNbCell"]') || header.querySelector('[onclick^="runNbCell"]'));
  if (!btn) return;
  if (_runCooldown) {
    btn.outerHTML = `<button class="w-6 h-6 rounded flex items-center justify-center bg-gray-500/20 text-dimmer border-none cursor-not-allowed opacity-60" disabled id="nb-cooldown-btn-${i}">${_nbPauseIcon}</button>`;
    setTimeout(() => {
      const cb = document.getElementById(`nb-cooldown-btn-${i}`);
      if (cb) cb.outerHTML = `<button class="w-6 h-6 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)">${_nbPlayIcon}</button>`;
      _runCooldown = false;
    }, 3000);
  } else {
    btn.outerHTML = `<button class="w-6 h-6 rounded flex items-center justify-center bg-emerald-500/20 text-emerald-400 border-none cursor-pointer hover:bg-emerald-500/30" onclick="runNbCell(${i})" title="Run cell (Shift+Enter)">${_nbPlayIcon}</button>`;
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
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-not-allowed'); }
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
  await fetch(`/api/experiments/${currentExpId}/kernel/restart`, {method:'POST', headers: _authHeaders()});
  updateKernelStatus('idle');
}
