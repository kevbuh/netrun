// ── Projects List (server-backed) ──
let allExperiments = [];

async function fetchExperiments() {
  const container = document.getElementById('ideas-list');
  container.innerHTML = '<div class="col-span-2 text-center py-20 text-dim text-base"><div class="spinner"></div><div>Loading...</div></div>';
  try {
    const resp = await fetch('/api/experiments');
    allExperiments = await resp.json();
    renderExperimentList();
    fetchUnstructuredFiles();
  } catch (err) {
    container.innerHTML = `<div class="col-span-2 text-center py-20 text-red-400"><p>Failed to load projects: ${err.message}</p></div>`;
  }
}

function _pixelArt(seed) {
  // Deterministic hash from string
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  // Use hash to seed a simple PRNG
  let s = Math.abs(h);
  function rand() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  // Pick two colors: one for the shape, one lighter variant for accents
  const hue = Math.floor(rand() * 360);
  const sat = 50 + Math.floor(rand() * 30);
  const col1 = `hsl(${hue},${sat}%,55%)`;
  const col2 = `hsl(${(hue + 40) % 360},${sat}%,70%)`;
  // Generate 5x5 grid, mirror left half to right for symmetry (only need cols 0-2)
  const size = 5, px = 4;
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < 3; x++) {
      if (rand() > 0.45) {
        const c = rand() > 0.5 ? col1 : col2;
        rects += `<rect x="${x*px}" y="${y*px}" width="${px}" height="${px}" fill="${c}"/>`;
        if (x < 2) rects += `<rect x="${(size-1-x)*px}" y="${y*px}" width="${px}" height="${px}" fill="${c}"/>`;
      }
    }
  }
  return `<svg width="${size*px}" height="${size*px}" viewBox="0 0 ${size*px} ${size*px}" class="shrink-0" style="image-rendering:pixelated">${rects}</svg>`;
}

function renderExperimentList() {
  const container = document.getElementById('ideas-list');
  const query = (document.getElementById('exp-search')?.value || '').toLowerCase().trim();
  const filtered = query
    ? allExperiments.filter(exp => exp.title.toLowerCase().includes(query) || (exp.desc || '').toLowerCase().includes(query))
    : allExperiments;
  if (!filtered.length) {
    container.innerHTML = `<div class="col-span-2 text-center py-20 text-dimmest text-[0.95rem]">${query ? 'No matching projects.' : 'No projects yet. Create one to get started.'}</div>`;
    return;
  }
  container.innerHTML = filtered.map(exp => {
    const runCount = exp.runCount || 0;
    const runs = exp.runs || [];
    const lastUpdated = exp.lastUpdated ? new Date(exp.lastUpdated).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
    const statusCounts = { running: 0, completed: 0, killed: 0, crashed: 0 };
    runs.forEach(r => { if (statusCounts[r.status] !== undefined) statusCounts[r.status]++; });
    const total = runs.length || 1;
    const statusBar = runs.length ? `
      <div class="flex h-1.5 rounded-full overflow-hidden bg-border-dim mt-2">
        ${statusCounts.completed ? `<div class="bg-emerald-500" style="width:${statusCounts.completed/total*100}%"></div>` : ''}
        ${statusCounts.running ? `<div class="bg-blue-500" style="width:${statusCounts.running/total*100}%"></div>` : ''}
        ${statusCounts.killed ? `<div class="bg-amber-500" style="width:${statusCounts.killed/total*100}%"></div>` : ''}
        ${statusCounts.crashed ? `<div class="bg-red-500" style="width:${statusCounts.crashed/total*100}%"></div>` : ''}
      </div>` : '';
    return `
    <div class="p-4 rounded-xl border border-border-card bg-card cursor-pointer transition-all duration-150 hover:border-border-input hover:shadow-lg group relative" onclick="openExperimentDetail('${exp.id}')"
         ondragover="_onExpCardDragOver(event)" ondragleave="_onExpCardDragLeave(event)" ondrop="_onExpCardDrop(event, '${exp.id}')">
      <div class="flex items-center gap-2.5 mb-1">
        ${_pixelArt(exp.id)}
        <div class="text-[0.95rem] font-semibold text-white_ truncate">${escapeHtml(exp.title)}</div>
      </div>
      <div class="mb-2"></div>
      <div class="flex items-center gap-3 text-[0.75rem] text-dimmer">
        <span>${runCount} run${runCount !== 1 ? 's' : ''}</span>
        ${lastUpdated ? `<span>${lastUpdated}</span>` : ''}
      </div>
      ${statusBar}
      <button onclick="event.stopPropagation(); deleteExperiment('${exp.id}')" class="absolute top-3 right-3 w-7 h-7 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 hover:bg-body opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  }).join('');
}

function filterExperiments() {
  renderExperimentList();
}

// ── New Project Modal ──
async function createQuickProject() {
  const adjectives = ['red','blue','green','swift','bold','calm','dark','bright','wild','cold','warm','sharp','soft','deep','fast'];
  const nouns = ['fox','oak','river','stone','moon','sun','hawk','wolf','pine','star','wave','flame','cloud','peak','reef'];
  const adj = adjectives[Math.floor(Math.random()*adjectives.length)];
  const noun = nouns[Math.floor(Math.random()*nouns.length)];
  const num = Math.floor(Math.random()*900)+100;
  const title = `${adj}-${noun}-${num}`;
  const resp = await fetch('/api/experiments', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ title, desc: '', created: Date.now() })
  });
  if (resp.ok) {
    const exp = await resp.json();
    openExperimentDetail(exp.id);
  }
}

async function deleteExperiment(id) {
  if (!confirm('Delete this project and all its runs?')) return;
  await fetch(`/api/experiments/${id}`, { method: 'DELETE' });
  fetchExperiments();
}

// ── Project Detail ──
let currentExpId = null;
let currentExp = null;

async function fetchExperimentDetail(id) {
  try {
    const resp = await fetch(`/api/experiments/${id}`);
    currentExp = await resp.json();
    document.getElementById('exp-detail-title').innerHTML = marked.parseInline(currentExp.title);
    renderLatexIn('exp-detail-title');
    const descEl = document.getElementById('exp-detail-desc');
    if (currentExp.desc) {
      descEl.innerHTML = marked.parse(currentExp.desc);
      descEl.classList.remove('text-dimmest');
      descEl.classList.add('text-muted');
      renderLatexIn('exp-detail-desc');
      _rewriteExpImages(descEl);
    } else {
      descEl.textContent = 'No description. Double-click to add one.';
      descEl.classList.add('text-dimmest');
      descEl.classList.remove('text-muted');
    }
    document.getElementById('exp-file-editor').style.display = 'none';
    document.getElementById('exp-file-editor').innerHTML = '';
    document.getElementById('exp-default-content').style.display = '';
    currentFile = null;
    _renderExpMetadata();
    renderExpPapers();
    await fetchExpFiles();
    _renderExpMetadata();
    // Auto-open README.md if it exists and no file is open
    if (!currentFile) _autoOpenReadme();
  } catch (err) {
    document.getElementById('exp-detail-desc').innerHTML =
      `<div class="text-center py-10 text-red-400 text-[0.85rem]">Failed to load: ${err.message}</div>`;
  }
}

function _renderMetaTree(node, prefix) {
  let lines = [];
  const dirs = Object.keys(node.children).sort();
  const fileNames = node.files.map(f => f.split('/').pop()).sort();
  const entries = dirs.map(d => ({ name: d, isDir: true })).concat(fileNames.map(f => ({ name: f, isDir: false })));
  entries.forEach((entry, idx) => {
    const isLast = idx === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const icon = entry.isDir ? '<span class="text-amber-400/70">'+entry.name+'</span>' : escapeHtml(entry.name);
    lines.push(`${prefix}${connector}${icon}`);
    if (entry.isDir) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      lines.push(..._renderMetaTree(node.children[entry.name], childPrefix));
    }
  });
  return lines;
}

function _renderExpMetadata() {
  const el = document.getElementById('exp-metadata');
  if (!el || !currentExp) return;
  const created = currentExp.created ? new Date(currentExp.created).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const runs = (currentExp.runs || []).length;
  const papers = (currentExp.papers || []).length;
  const files = _expFiles ? _expFiles.length : 0;
  const parts = [];
  if (created) parts.push(`<span>Created ${created}</span>`);
  if (files) parts.push(`<span>${files} file${files !== 1 ? 's' : ''}</span>`);
  if (runs) parts.push(`<span>${runs} run${runs !== 1 ? 's' : ''}</span>`);
  if (papers) parts.push(`<span>${papers} paper${papers !== 1 ? 's' : ''}</span>`);
  el.innerHTML = parts.length ? `<div class="flex items-center gap-2 text-[0.75rem] text-dimmer flex-wrap">${parts.join('<span class="text-dimmest">·</span>')}</div>` : '';
  const treeEl = document.getElementById('exp-file-tree');
  if (treeEl) {
    if (_expFiles && _expFiles.length) {
      const tree = _buildFileTree(_expFiles, []);
      const treeLines = _renderMetaTree(tree, '');
      treeEl.innerHTML = `<div class="text-[0.72rem] text-dim uppercase tracking-wide mb-2">File tree</div><div class="text-[0.72rem] font-mono text-dim leading-relaxed whitespace-pre">${treeLines.join('\n')}</div>`;
    } else {
      treeEl.innerHTML = '';
    }
  }
}

// ── Linked Papers ──
function renderExpPapers() {
  const section = document.getElementById('exp-papers-section');
  const list = document.getElementById('exp-papers-list');
  if (!section || !list) return;
  const papers = (currentExp && currentExp.papers) || [];
  if (!papers.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = papers.map(p => {
    const title = p.title || p.link;
    const snippet = title.length > 50 ? title.slice(0, 50) + '…' : title;
    return `<div class="flex items-center gap-2 py-1.5 px-1 cursor-pointer rounded hover:bg-hover transition-colors group" onclick="openExpPaper('${escapeAttr(p.link)}', '${escapeAttr(p.title || '')}', '${escapeAttr(p.source || '')}')">
      <svg class="w-3.5 h-3.5 shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="text-[0.78rem] text-primary truncate flex-1">${escapeHtml(snippet)}</span>
      <button class="opacity-0 group-hover:opacity-100 bg-transparent border-none text-dimmest hover:text-red-400 cursor-pointer p-0 text-[0.85rem] leading-none shrink-0 transition-opacity" onclick="event.stopPropagation();removeExpPaper('${escapeAttr(p.link)}')" title="Remove">&times;</button>
    </div>`;
  }).join('');
}

function openExpPaper(link, title, source) {
  const paper = { link, title: title || link, source: source || '' };
  paperViewOrigin = 'experiment';
  _paperOriginExpId = currentExpId;
  showPaperView(paper, 'view/' + encodeURIComponent(link));
}

function removeExpPaper(link) {
  if (!currentExp || !currentExpId) return;
  const papers = (currentExp.papers || []).filter(p => p.link !== link);
  fetch(`/api/experiments/${currentExpId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ papers })
  }).then(() => {
    currentExp.papers = papers;
    renderExpPapers();
  });
}

// ── Rename ──
let renaming = false;
function startRenameExperiment() {
  if (!currentExpId || !currentExp || renaming) return;
  renaming = true;
  const h1 = document.getElementById('exp-detail-title');
  const current = currentExp.title;
  h1.outerHTML = `<input id="exp-rename-input" type="text" value="${escapeHtml(current)}" class="text-[1.1rem] font-semibold text-white_ bg-transparent border-b-2 border-accent outline-none w-full mb-3" />`;
  const input = document.getElementById('exp-rename-input');
  input.focus(); input.select();
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); await finishRename(input); }
    if (e.key === 'Escape') { cancelRename(); }
  });
  input.addEventListener('blur', () => finishRename(input));
}
async function finishRename(input) {
  if (!renaming) return;
  renaming = false;
  const newTitle = input.value.trim();
  if (!newTitle || !currentExpId) { cancelRename(); return; }
  await fetch(`/api/experiments/${currentExpId}`, {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ title: newTitle })
  });
  currentExp.title = newTitle;
  cancelRename();
}
function cancelRename() {
  const input = document.getElementById('exp-rename-input');
  if (!input) return;
  input.outerHTML = `<div id="exp-detail-title" class="text-[1.1rem] font-semibold text-white_ cursor-pointer hover:text-accent transition-colors nb-rendered-md mb-3" onclick="startRenameExperiment()" title="Click to rename">${marked.parseInline(currentExp.title)}</div>`;
  renderLatexIn('exp-detail-title');
}

// ── Edit Description (markdown) ──
let editingDesc = false;
function startEditDesc() {
  if (!currentExpId || !currentExp || editingDesc) return;
  editingDesc = true;
  const el = document.getElementById('exp-detail-desc');
  el.outerHTML = `<textarea id="exp-desc-input" class="text-[0.85rem] text-primary bg-transparent outline-none w-full flex-1 px-4 py-3 resize-none focus:outline-none border-none font-mono" placeholder="Add a description (markdown supported)...">${escapeHtml(currentExp.desc || '')}</textarea>`;
  const textarea = document.getElementById('exp-desc-input');
  textarea.focus();
  textarea.addEventListener('keydown', async e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); await finishEditDesc(textarea); }
    if (e.key === 'Escape') { cancelEditDesc(); }
  });
  textarea.addEventListener('blur', () => finishEditDesc(textarea));
}
async function finishEditDesc(textarea) {
  if (!editingDesc) return;
  editingDesc = false;
  const newDesc = textarea.value.trim();
  await fetch(`/api/experiments/${currentExpId}`, {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ desc: newDesc })
  });
  currentExp.desc = newDesc;
  cancelEditDesc();
}
function cancelEditDesc() {
  const textarea = document.getElementById('exp-desc-input');
  if (!textarea) return;
  const desc = currentExp.desc || '';
  const content = desc ? marked.parse(desc) : escapeHtml('No description. Double-click to add one.');
  textarea.outerHTML = `<div id="exp-detail-desc" class="text-[0.85rem] ${desc ? 'text-muted' : 'text-dimmest'} cursor-pointer hover:text-primary transition-colors nb-rendered-md flex-1 overflow-y-auto px-4 py-3" ondblclick="startEditDesc()" title="Double-click to edit description">${content}</div>`;
  if (desc) {
    renderLatexIn('exp-detail-desc');
    _rewriteExpImages(document.getElementById('exp-detail-desc'));
  }
}

// ── Files ──
let currentFile = null;
let fileSaveTimer = null;

let _expFiles = [];
async function fetchExpFiles() {
  if (!currentExpId) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/files`);
    const data = await resp.json();
    // Support both old (array) and new ({ files, emptyDirs }) response shapes
    const files = Array.isArray(data) ? data : data.files || [];
    const emptyDirs = Array.isArray(data) ? [] : data.emptyDirs || [];
    _expFiles = files;
    renderFilesList(files, emptyDirs);
  } catch(e) {
    _expFiles = [];
    document.getElementById('exp-sidebar-files').innerHTML = '';
  }
}

function _autoOpenReadme() {
  const readme = _expFiles.find(f => /^readme\.md$/i.test(f));
  if (readme) openFile(readme);
}

function _fileExtBadge(f) {
  const name = f.includes('/') ? f.split('/').pop() : f;
  if (name.endsWith('.ipynb')) return ['nb', 'bg-orange-500/20 text-orange-400'];
  if (name.endsWith('.py')) return ['py', 'bg-emerald-500/20 text-emerald-400'];
  if (name.endsWith('.tex')) return ['tex', 'bg-red-500/20 text-red-400'];
  if (name.endsWith('.mermaid')) return ['dia', 'bg-cyan-500/20 text-cyan-400'];
  if (name.endsWith('.draw')) return ['drw', 'bg-violet-500/20 text-violet-400'];
  if (name.endsWith('.slides')) return ['sld', 'bg-pink-500/20 text-pink-400'];
  if (/\.(png|svg|gif|jpg|jpeg|webp|bmp|ico)$/i.test(name)) {
    const ext = name.split('.').pop().toLowerCase();
    return [ext.slice(0, 3), 'bg-purple-500/20 text-purple-400'];
  }
  if (name.endsWith('.pdf')) return ['pdf', 'bg-red-500/20 text-red-400'];
  if (/\.(mp3|wav|ogg)$/i.test(name)) return ['aud', 'bg-yellow-500/20 text-yellow-400'];
  if (/\.(mp4|webm)$/i.test(name)) return ['vid', 'bg-indigo-500/20 text-indigo-400'];
  if (/\.(zip|tar|gz)$/i.test(name)) return ['zip', 'bg-gray-500/20 text-gray-400'];
  if (name.endsWith('.md')) return ['md', 'bg-blue-500/20 text-blue-400'];
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase().slice(0, 3) : '?';
  return [ext, 'bg-gray-500/20 text-gray-400'];
}

let _draggedFile = null;

function _buildFileTree(files, emptyDirs) {
  const root = { children: {}, files: [] };
  files.forEach(f => {
    const parts = f.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) node.children[parts[i]] = { children: {}, files: [] };
      node = node.children[parts[i]];
    }
    node.files.push(f);
  });
  (emptyDirs || []).forEach(d => {
    const parts = d.split('/');
    let node = root;
    for (const p of parts) {
      if (!node.children[p]) node.children[p] = { children: {}, files: [] };
      node = node.children[p];
    }
  });
  return root;
}

function _countTreeFiles(node) {
  let n = node.files.length;
  for (const k of Object.keys(node.children)) n += _countTreeFiles(node.children[k]);
  return n;
}

function renderFilesList(files, emptyDirs) {
  emptyDirs = emptyDirs || [];
  const el = document.getElementById('exp-sidebar-files');
  if (!files.length && !emptyDirs.length) {
    el.innerHTML = '<div class="text-dimmest text-[0.75rem] py-2">No files yet.</div>';
    return;
  }
  const tree = _buildFileTree(files, emptyDirs);

  function fileRow(f) {
    const isActive = currentFile === f;
    const activeCls = isActive ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent';
    const displayName = f.split('/').pop();
    const [badge, badgeCls] = _fileExtBadge(f);
    const escapedF = escapeHtml(f).replace(/'/g, "\\'");
    return `
    <div class="exp-file-row flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-card/50 cursor-pointer group transition-colors ${activeCls}" draggable="true" data-filepath="${escapeHtml(f)}" onclick="openFile('${escapedF}')" title="${escapeHtml(f)}"
         ondragstart="_draggedFile='${escapedF}'; this.style.opacity='0.5'"
         ondragend="_draggedFile=null; this.style.opacity=''">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
        <span class="text-[0.8rem] text-primary truncate">${escapeHtml(displayName)}</span>
      </div>
      <div class="flex items-center gap-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); duplicateExpFile('${escapedF}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary" title="Duplicate">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </button>
        <button draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); deleteExpFile('${escapedF}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400" title="Delete">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>`;
  }

  function renderNode(node, folderPath) {
    let html = '';
    // Files at this level
    html += node.files.map(fileRow).join('');
    // Subfolders
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      const childPath = folderPath ? folderPath + '/' + name : name;
      const folderId = 'folder-' + childPath.replace(/[^a-zA-Z0-9_-]/g, '_');
      const escapedFolder = escapeHtml(childPath).replace(/'/g, "\\'");
      const count = _countTreeFiles(child);
      const isTopLevel = !folderPath;
      html += `
      <div class="${isTopLevel ? 'mt-1' : 'mt-0.5'}" ondragover="_onFolderDragOver(event)" ondragleave="_onFolderDragLeave(event)" ondrop="_onFolderDrop(event, '${escapedFolder}')">
        <div class="flex items-center gap-1 w-full px-1 py-1 group">
          <button onclick="document.getElementById('${folderId}').classList.toggle('hidden'); this.querySelector('.chevron-icon').style.transform = document.getElementById('${folderId}').classList.contains('hidden') ? '' : 'rotate(90deg)'" class="flex items-center gap-1 flex-1 text-left bg-transparent border-none p-0 cursor-pointer text-dim hover:text-primary transition-colors min-w-0">
            <svg class="w-3 h-3 fill-current transition-transform shrink-0 chevron-icon" style="transform:rotate(90deg)" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
            <svg class="w-3.5 h-3.5 text-amber-400/70 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span class="text-[0.78rem] truncate folder-name-span" ondblclick="event.stopPropagation(); startRenameFolder('${escapedFolder}', this)">${escapeHtml(name)}</span>
          </button>
          <span class="text-[0.65rem] text-dimmer shrink-0">${count}</span>
          <button onclick="event.stopPropagation(); deleteExpFolder('${escapedFolder}')" class="w-5 h-5 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete folder">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div id="${folderId}" class="pl-3${isTopLevel ? '' : ''}">
          ${count ? renderNode(child, childPath) : '<div class="text-dimmest text-[0.7rem] py-1 px-2">Empty</div>'}
        </div>
      </div>`;
    }
    return html;
  }

  let html = `<div class="exp-root-drop" ondragover="_onFolderDragOver(event)" ondragleave="_onFolderDragLeave(event)" ondrop="_onFolderDrop(event, '')">`;
  html += renderNode(tree, '');
  html += `</div>`;
  el.innerHTML = html;
}

function startRenameFileInEditor(fname) {
  // Find the clickable filename span in the editor header by searching for matching text
  const editor = document.getElementById('exp-file-editor');
  const spans = editor.querySelectorAll('span');
  let spanEl = null;
  for (const s of spans) {
    if (s.textContent === fname && s.onclick) { spanEl = s; break; }
  }
  if (!spanEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = fname;
  input.className = 'bg-input border border-border-input rounded px-2 py-0.5 text-[0.85rem] text-primary font-medium outline-none focus:border-accent';
  input.onclick = e => e.stopPropagation();
  spanEl.replaceWith(input);
  input.focus();
  const dotIdx = fname.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : fname.length);

  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== fname) {
      const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rename: newName })
      });
      if (resp.ok) {
        currentFile = newName;
        openFile(newName);
        return;
      }
    }
    // Revert: put back the clickable span
    const newSpan = document.createElement('span');
    newSpan.className = spanEl ? spanEl.className : 'text-[0.85rem] text-white_ font-medium cursor-pointer hover:text-accent transition-colors';
    newSpan.textContent = fname;
    newSpan.title = 'Click to rename';
    newSpan.onclick = () => startRenameFileInEditor(fname);
    input.replaceWith(newSpan);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { commit(); }
  });
  input.addEventListener('blur', () => commit());
}

function startRenameFile(fname, spanEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = fname;
  input.className = 'bg-input border border-border-input rounded px-1 py-0.5 text-[0.8rem] text-primary outline-none focus:border-accent w-full';
  input.onclick = e => e.stopPropagation();
  spanEl.replaceWith(input);
  input.focus();
  // Select name without extension
  const dotIdx = fname.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : fname.length);

  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== fname) {
      const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rename: newName })
      });
      if (resp.ok) {
        if (currentFile === fname) currentFile = newName;
        fetchExpFiles();
        return;
      }
    }
    fetchExpFiles();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { fetchExpFiles(); }
  });
  input.addEventListener('blur', () => commit());
}

function toggleExpFileMenu() {
  const menu = document.getElementById('exp-file-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', hideExpFileMenuOnClick, { once: true }), 0);
  }
}
function hideExpFileMenu() {
  const menu = document.getElementById('exp-file-menu');
  if (menu) menu.classList.add('hidden');
}
function hideExpFileMenuOnClick(e) {
  const menu = document.getElementById('exp-file-menu');
  if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}

async function createExpFile(ext, content) {
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : ext === '.tex' ? 'paper' : ext === '.mermaid' ? 'diagram' : ext === '.draw' ? 'drawing' : ext === '.slides' ? 'presentation' : 'notes';
  let name = `${base}${ext}`;
  let i = 2;
  const resp = await fetch(`/api/experiments/${currentExpId}/files`);
  const data = await resp.json();
  const existing = Array.isArray(data) ? data : data.files || [];
  const sep = ext === '.py' ? '_' : '-';
  while (existing.includes(name)) { name = `${base}${sep}${i}${ext}`; i++; }
  const payload = {name};
  if (content !== undefined) payload.content = content;
  await fetch(`/api/experiments/${currentExpId}/files`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  fetchExpFiles();
  return name;
}

function promptCloneRepo() {
  const filesEl = document.getElementById('exp-sidebar-files');
  const existing = document.getElementById('clone-repo-bar');
  if (existing) { existing.querySelector('input').focus(); return; }
  const bar = document.createElement('div');
  bar.id = 'clone-repo-bar';
  bar.className = 'mb-2';
  bar.innerHTML = `<div class="flex items-center gap-1.5">
    <input id="clone-repo-url" type="text" class="flex-1 px-2 py-1 rounded border border-border-input bg-input text-primary text-[0.78rem] focus:outline-none focus:border-accent" placeholder="https://github.com/user/repo" autofocus />
    <button id="clone-repo-btn" onmousedown="event.preventDefault(); submitCloneRepo()" class="px-2 py-1 rounded border-none bg-accent text-white text-[0.75rem] cursor-pointer hover:bg-accent-hover whitespace-nowrap">Clone</button>
  </div>
  <div id="clone-repo-error" class="text-red-400 text-[0.72rem] mt-1 hidden"></div>`;
  filesEl.parentNode.insertBefore(bar, filesEl);
  const input = document.getElementById('clone-repo-url');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitCloneRepo(); }
    if (e.key === 'Escape') { bar.remove(); }
  });
}

async function submitCloneRepo() {
  const input = document.getElementById('clone-repo-url');
  const btn = document.getElementById('clone-repo-btn');
  const errEl = document.getElementById('clone-repo-error');
  if (!input || !btn) return;
  const url = input.value.trim();
  if (!url) return;
  btn.textContent = 'Cloning...';
  btn.disabled = true;
  input.disabled = true;
  errEl.classList.add('hidden');
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/clone-repo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120000)
    });
    const data = await resp.json();
    if (!resp.ok) {
      errEl.textContent = data.error || 'Clone failed';
      errEl.classList.remove('hidden');
      btn.textContent = 'Clone';
      btn.disabled = false;
      input.disabled = false;
      return;
    }
    const bar = document.getElementById('clone-repo-bar');
    if (bar) bar.remove();
    fetchExpFiles();
  } catch (e) {
    // Clone may have succeeded even if the connection dropped
    const bar = document.getElementById('clone-repo-bar');
    if (bar) bar.remove();
    fetchExpFiles();
  }
}

// ── Folder Management ──
function promptCreateFolder() {
  const filesEl = document.getElementById('exp-sidebar-files');
  const existing = document.getElementById('create-folder-bar');
  if (existing) { existing.querySelector('input').focus(); return; }
  const bar = document.createElement('div');
  bar.id = 'create-folder-bar';
  bar.className = 'mb-2';
  bar.innerHTML = `<div class="flex items-center gap-1.5">
    <input id="create-folder-name" type="text" class="flex-1 px-2 py-1 rounded border border-border-input bg-input text-primary text-[0.78rem] focus:outline-none focus:border-accent" placeholder="Folder name" autofocus />
    <button id="create-folder-btn" onmousedown="event.preventDefault(); submitCreateFolder()" class="px-2 py-1 rounded border-none bg-accent text-white text-[0.75rem] cursor-pointer hover:bg-accent-hover whitespace-nowrap">Create</button>
  </div>
  <div id="create-folder-error" class="text-red-400 text-[0.72rem] mt-1 hidden"></div>`;
  filesEl.parentNode.insertBefore(bar, filesEl);
  const input = document.getElementById('create-folder-name');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitCreateFolder(); }
    if (e.key === 'Escape') { bar.remove(); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (document.getElementById('create-folder-bar')) document.getElementById('create-folder-bar').remove(); }, 150);
  });
}

async function submitCreateFolder() {
  const input = document.getElementById('create-folder-name');
  const errEl = document.getElementById('create-folder-error');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/create-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await resp.json();
    if (!resp.ok) {
      errEl.textContent = data.error || 'Failed';
      errEl.classList.remove('hidden');
      return;
    }
    const bar = document.getElementById('create-folder-bar');
    if (bar) bar.remove();
    fetchExpFiles();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function deleteExpFolder(folder) {
  if (!confirm(`Delete folder "${folder}" and all its contents?`)) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/delete-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || 'Failed to delete folder');
      return;
    }
    // Close editor if current file was inside this folder
    if (currentFile && currentFile.startsWith(folder + '/')) {
      if (fileSaveTimer) { clearTimeout(fileSaveTimer); fileSaveTimer = null; }
      currentFile = null;
      pyEditorCm = null;
      cmInstances = [];
      document.getElementById('exp-file-editor').style.display = 'none';
      document.getElementById('exp-file-editor').innerHTML = '';
      document.getElementById('exp-default-content').style.display = '';
    }
    fetchExpFiles();
  } catch (e) { alert('Delete folder error: ' + e.message); }
}

function startRenameFolder(folderName, spanEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = folderName;
  input.className = 'bg-input border border-border-input rounded px-1 py-0.5 text-[0.78rem] text-primary outline-none focus:border-accent w-full';
  input.onclick = e => { e.stopPropagation(); e.preventDefault(); };
  spanEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== folderName) {
      try {
        const resp = await fetch(`/api/experiments/${currentExpId}/rename-folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldName: folderName, newName })
        });
        if (resp.ok) {
          // Update currentFile if it was inside the renamed folder
          if (currentFile && currentFile.startsWith(folderName + '/')) {
            currentFile = newName + currentFile.substring(folderName.length);
          }
        }
      } catch (e) { /* silently fail */ }
    }
    fetchExpFiles();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { fetchExpFiles(); }
  });
  input.addEventListener('blur', () => commit());
}

// ── Drag-and-drop file moving ──
function _onFolderDragOver(e) {
  if (!_draggedFile) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over-highlight');
}
function _onFolderDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-highlight');
}
async function _onFolderDrop(e, targetFolder) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over-highlight');
  if (!_draggedFile || !currentExpId) return;
  const oldPath = _draggedFile;
  const fileName = oldPath.includes('/') ? oldPath.split('/').pop() : oldPath;
  const newPath = targetFolder ? (targetFolder + '/' + fileName) : fileName;
  if (oldPath === newPath) return; // no-op: same location
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/move-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    if (resp.ok) {
      if (currentFile === oldPath) currentFile = newPath;
      fetchExpFiles();
    } else {
      const data = await resp.json();
      if (data.error) alert(data.error);
    }
  } catch (e) { /* silently fail */ }
  _draggedFile = null;
}

async function duplicateExpFile(fname) {
  const ext = fname.includes('.') ? '.' + fname.split('.').pop() : '';
  const base = fname.includes('.') ? fname.slice(0, fname.lastIndexOf('.')) : fname;
  const newName = base + '_copy' + ext;
  const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`);
  const data = await resp.json();
  if (data.error) return;
  await fetch(`/api/experiments/${currentExpId}/files/${newName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: data.content })
  });
  fetchExpFiles();
}

async function deleteExpFile(fname) {
  if (!confirm(`Delete ${fname}?`)) return;
  await fetch(`/api/experiments/${currentExpId}/files/${fname}`, {method:'DELETE'});
  if (currentFile === fname) {
    closeFileEditor();
  }
  fetchExpFiles();
}

async function openFile(fname) {
  if (currentFile === fname) { closeFileEditor(); return; }
  if (currentFile) {
    if (fileSaveTimer) { clearTimeout(fileSaveTimer); fileSaveTimer = null; }
    pyEditorCm = null;
    cmInstances = [];
  }
  currentFile = fname;
  const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`);
  const data = await resp.json();

  document.getElementById('exp-default-content').style.display = 'none';
  const editor = document.getElementById('exp-file-editor');
  editor.style.display = 'flex';
  editor.style.flexDirection = 'column';
  editor.style.height = '100%';
  var cp = document.getElementById('exp-content-pane');
  cp.style.overflow = 'hidden';
  cp.style.display = 'flex';
  cp.style.flexDirection = 'column';

  if (/\.(png|svg|gif|jpg|jpeg|webp|bmp|ico)$/i.test(fname)) {
    renderImageViewer(fname, data.content);
  } else if (/\.(mp4|webm)$/i.test(fname)) {
    renderMediaViewer(fname, data.content, 'video');
  } else if (/\.(mp3|wav|ogg)$/i.test(fname)) {
    renderMediaViewer(fname, data.content, 'audio');
  } else if (data.binary) {
    renderBinaryViewer(fname, data.content, data.mime);
  } else if (fname.endsWith('.ipynb')) {
    renderNotebookEditor(fname, data.content);
  } else if (fname.endsWith('.py')) {
    renderPythonEditor(fname, data.content);
  } else if (fname.endsWith('.tex')) {
    renderLatexEditor(fname, data.content);
  } else if (fname.endsWith('.mermaid')) {
    renderMermaidEditor(fname, data.content);
  } else if (fname.endsWith('.draw')) {
    renderDrawEditor(fname, data.content);
  } else if (fname.endsWith('.slides')) {
    renderSlidesEditor(fname, data.content);
  } else {
    renderMarkdownEditor(fname, data.content);
  }
  fetchExpFiles();
}

function renderImageViewer(fname, dataUrl) {
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50">
      <span id="img-viewer-fname" class="text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInViewer('${escapeHtml(fname)}')" title="Click to rename">${escapeHtml(fname)}</span>
      <a href="${dataUrl}" download="${escapeHtml(fname)}" id="img-viewer-download" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors no-underline" title="Download">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </a>
    </div>
    <div class="flex items-center justify-center p-8 min-h-[300px]">
      <img src="${dataUrl}" class="max-w-full max-h-[70vh] rounded shadow-lg" alt="${escapeHtml(fname)}" />
    </div>`;
}

function renderMediaViewer(fname, dataUrl, type) {
  const editor = document.getElementById('exp-file-editor');
  const tag = type === 'video'
    ? `<video src="${dataUrl}" controls class="max-w-full max-h-[70vh] rounded shadow-lg"></video>`
    : `<audio src="${dataUrl}" controls class="w-full max-w-[400px]"></audio>`;
  editor.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50">
      <span class="text-[0.85rem] text-primary font-medium">${escapeHtml(fname)}</span>
      <a href="${dataUrl}" download="${escapeHtml(fname)}" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors no-underline" title="Download">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </a>
    </div>
    <div class="flex items-center justify-center p-8 min-h-[300px]">
      ${tag}
    </div>`;
}

function renderBinaryViewer(fname, dataUrl, mime) {
  const editor = document.getElementById('exp-file-editor');
  const sizeInfo = dataUrl ? `~${Math.round(dataUrl.length * 3 / 4 / 1024)} KB` : '';
  editor.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50">
      <span class="text-[0.85rem] text-primary font-medium">${escapeHtml(fname)}</span>
      <a href="${dataUrl}" download="${escapeHtml(fname)}" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors no-underline" title="Download">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </a>
    </div>
    <div class="flex flex-col items-center justify-center p-8 min-h-[300px] gap-3 text-dimmer">
      <svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="text-[0.85rem] text-muted">${escapeHtml(fname)}</div>
      <div class="text-[0.75rem]">${escapeHtml(mime || 'Binary file')} ${sizeInfo ? '· ' + sizeInfo : ''}</div>
    </div>`;
}

function startRenameFileInViewer(fname) {
  const span = document.getElementById('img-viewer-fname');
  if (!span) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = fname;
  input.className = 'bg-input border border-border-input rounded px-2 py-0.5 text-[0.85rem] text-primary font-medium outline-none focus:border-accent';
  span.replaceWith(input);
  input.focus();
  const dotIdx = fname.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : fname.length);

  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== fname) {
      const resp = await fetch(`/api/experiments/${currentExpId}/files/${fname}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rename: newName })
      });
      if (resp.ok) {
        currentFile = newName;
        // Update the header and download link in place
        const newSpan = document.createElement('span');
        newSpan.id = 'img-viewer-fname';
        newSpan.className = 'text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors';
        newSpan.title = 'Click to rename';
        newSpan.textContent = newName;
        newSpan.onclick = () => startRenameFileInViewer(newName);
        input.replaceWith(newSpan);
        const dl = document.getElementById('img-viewer-download');
        if (dl) dl.download = newName;
        fetchExpFiles();
        return;
      }
    }
    // Revert
    const newSpan = document.createElement('span');
    newSpan.id = 'img-viewer-fname';
    newSpan.className = 'text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors';
    newSpan.title = 'Click to rename';
    newSpan.textContent = fname;
    newSpan.onclick = () => startRenameFileInViewer(fname);
    input.replaceWith(newSpan);
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { commit(); }
  });
  input.addEventListener('blur', () => commit());
}

function closeFileEditor() {
  if (fileSaveTimer) { clearTimeout(fileSaveTimer); fileSaveTimer = null; }
  currentFile = null;
  pyEditorCm = null;
  cmInstances = [];
  if (typeof _texCm !== 'undefined') _texCm = null;
  if (typeof _mermaidCm !== 'undefined') _mermaidCm = null;
  const el = document.getElementById('exp-file-editor');
  el.style.display = 'none';
  el.style.flexDirection = '';
  el.style.height = '';
  var cp = document.getElementById('exp-content-pane');
  cp.style.overflow = '';
  cp.style.display = '';
  cp.style.flexDirection = '';
  el.innerHTML = '';
  document.getElementById('exp-default-content').style.display = '';
  fetchExpFiles();
}

// ── Unstructured Files (loose files on experiments page) ──
let _unstructuredFiles = [];
let _draggedUnstructuredFile = null;

async function fetchUnstructuredFiles() {
  try {
    const resp = await fetch('/api/experiments/_unstructured/files');
    const data = await resp.json();
    const files = Array.isArray(data) ? data : data.files || [];
    _unstructuredFiles = files;
    renderUnstructuredFiles();
  } catch (e) {
    _unstructuredFiles = [];
    renderUnstructuredFiles();
  }
}

function renderUnstructuredFiles() {
  const section = document.getElementById('unstructured-section');
  const container = document.getElementById('unstructured-files');
  const countEl = document.getElementById('unstructured-count');
  if (!section || !container) return;
  if (!_unstructuredFiles.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  countEl.textContent = `(${_unstructuredFiles.length})`;
  container.innerHTML = _unstructuredFiles.map(f => {
    const displayName = f.includes('/') ? f.split('/').pop() : f;
    const [badge, badgeCls] = _fileExtBadge(f);
    const escapedF = escapeHtml(f).replace(/'/g, "\\'");
    return `
    <div class="flex items-center gap-2 p-3 rounded-lg border border-border-card bg-card cursor-pointer hover:border-border-input hover:shadow-md transition-all group"
         draggable="true" data-unstructured-file="${escapeHtml(f)}"
         onclick="openUnstructuredFile('${escapedF}')"
         ondragstart="_draggedUnstructuredFile='${escapedF}'; this.style.opacity='0.5'"
         ondragend="_draggedUnstructuredFile=null; this.style.opacity=''">
      <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
      <span class="text-[0.82rem] text-primary truncate flex-1">${escapeHtml(displayName)}</span>
      <button onclick="event.stopPropagation(); deleteUnstructuredFile('${escapedF}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  }).join('');
}

function openUnstructuredFile(fname) {
  currentExpId = '_unstructured';
  openExperimentDetail('_unstructured');
  // After detail view loads, open the file
  setTimeout(() => openFile(fname), 300);
}

async function createUnstructuredFile(ext) {
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : ext === '.tex' ? 'paper' : ext === '.mermaid' ? 'diagram' : ext === '.draw' ? 'drawing' : ext === '.slides' ? 'presentation' : 'notes';
  let name = `${base}${ext}`;
  let i = 2;
  const resp = await fetch('/api/experiments/_unstructured/files');
  const data = await resp.json();
  const existing = Array.isArray(data) ? data : data.files || [];
  const sep = ext === '.py' ? '_' : '-';
  while (existing.includes(name)) { name = `${base}${sep}${i}${ext}`; i++; }
  await fetch('/api/experiments/_unstructured/files', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name })
  });
  openUnstructuredFile(name);
}

async function createUnstructuredFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  await fetch('/api/experiments/_unstructured/create-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  fetchUnstructuredFiles();
}

async function deleteUnstructuredFile(fname) {
  if (!confirm(`Delete ${fname}?`)) return;
  await fetch(`/api/experiments/_unstructured/files/${fname}`, { method: 'DELETE' });
  fetchUnstructuredFiles();
}

function triggerUnstructuredFileUpload() {
  const input = document.getElementById('unstructured-upload-input');
  if (input) { input.value = ''; input.click(); }
}

async function uploadUnstructuredFiles(files) {
  if (!files || !files.length) return;
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  try {
    const resp = await fetch('/api/experiments/_unstructured/upload', {
      method: 'POST',
      body: formData
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || 'Upload failed');
    }
    fetchUnstructuredFiles();
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
}

function createNewProjectFromGithub() {
  const url = prompt('GitHub repository URL:\n(e.g. https://github.com/user/repo)');
  if (!url || !url.trim()) return;
  const match = url.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!match) { alert('Invalid GitHub URL. Expected: https://github.com/user/repo'); return; }
  const repoName = match[2].replace(/\.git$/, '');
  // Create a new project named after the repo, then clone into it
  fetch('/api/experiments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: repoName, desc: `Cloned from ${url.trim()}`, created: Date.now() })
  }).then(r => r.json()).then(async exp => {
    if (!exp.id) { alert('Failed to create project'); return; }
    const cloneResp = await fetch(`/api/experiments/${exp.id}/clone-repo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() })
    });
    if (!cloneResp.ok) {
      const err = await cloneResp.json().catch(() => ({}));
      alert(err.error || 'Clone failed');
    }
    openExperimentDetail(exp.id);
  });
}

// ── New File menu toggle ──
function toggleNewFileMenu() {
  const menu = document.getElementById('new-file-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', _hideNewFileMenuOnClick, { once: true }), 0);
  }
}
function hideNewFileMenu() {
  const menu = document.getElementById('new-file-menu');
  if (menu) menu.classList.add('hidden');
}
function _hideNewFileMenuOnClick(e) {
  const menu = document.getElementById('new-file-menu');
  if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}

// ── Drag unstructured files onto project cards ──
function _onExpCardDragOver(e) {
  if (!_draggedUnstructuredFile) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over-highlight');
}
function _onExpCardDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-highlight');
}
async function _onExpCardDrop(e, targetExpId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over-highlight');
  if (!_draggedUnstructuredFile) return;
  const filename = _draggedUnstructuredFile;
  _draggedUnstructuredFile = null;
  try {
    const resp = await fetch('/api/experiments/move-unstructured-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, targetExp: targetExpId })
    });
    if (resp.ok) {
      fetchUnstructuredFiles();
    } else {
      const data = await resp.json().catch(() => ({}));
      if (data.error) alert(data.error);
    }
  } catch (e) { /* silently fail */ }
}

// ── Collapsible Experiment Sidebar (Desktop) ──

function toggleExpSidebar() {
  const grid = document.querySelector('#exp-detail-view .grid');
  if (!grid) return;
  grid.classList.toggle('exp-sidebar-collapsed');
  const collapsed = grid.classList.contains('exp-sidebar-collapsed');
  localStorage.setItem('expSidebarCollapsed', collapsed ? '1' : '0');
}

function _restoreExpSidebarState() {
  const grid = document.querySelector('#exp-detail-view .grid');
  if (!grid) return;
  if (localStorage.getItem('expSidebarCollapsed') === '1') {
    grid.classList.add('exp-sidebar-collapsed');
  } else {
    grid.classList.remove('exp-sidebar-collapsed');
  }
}

// ── File Upload ──

function triggerExpFileUpload() {
  const input = document.getElementById('exp-file-upload-input');
  if (input) { input.value = ''; input.click(); }
}

async function uploadExpFiles(files) {
  if (!files || !files.length || !currentExpId) return;
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/upload`, {
      method: 'POST',
      body: formData
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(data.error || 'Upload failed');
    }
    fetchExpFiles();
    _renderExpMetadata();
  } catch (e) {
    alert('Upload error: ' + e.message);
  }
}

function _initExpSidebarDrop() {
  const filesEl = document.getElementById('exp-sidebar-files');
  const sidebar = document.getElementById('exp-sidebar');
  if (!sidebar) return;

  function onDragOver(e) {
    // Only handle external file drags, not internal file reorder
    if (_draggedFile) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    sidebar.classList.add('exp-upload-drop-active');
  }
  function onDragLeave(e) {
    if (!e.relatedTarget || !sidebar.contains(e.relatedTarget)) {
      sidebar.classList.remove('exp-upload-drop-active');
    }
  }
  function onDrop(e) {
    sidebar.classList.remove('exp-upload-drop-active');
    if (_draggedFile) return; // internal reorder, not upload
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    uploadExpFiles(e.dataTransfer.files);
  }
  sidebar.addEventListener('dragover', onDragOver);
  sidebar.addEventListener('dragleave', onDragLeave);
  sidebar.addEventListener('drop', onDrop);
}

// ── Mobile Experiment Sidebar ──

function initExpSidebarMobile() {
  const sidebar = document.getElementById('exp-sidebar');
  if (!sidebar || window.innerWidth >= 768) return;

  // Add toggle button if it doesn't exist
  if (!document.getElementById('exp-sidebar-toggle-mobile')) {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'exp-sidebar-toggle-mobile';
    toggleBtn.style.display = 'none'; // Controlled by CSS
    toggleBtn.innerHTML = `
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Files</span>
    `;
    toggleBtn.onclick = toggleExpSidebarMobile;

    // Wrap existing content in a container
    const content = sidebar.innerHTML;
    sidebar.innerHTML = '';
    sidebar.appendChild(toggleBtn);

    const contentWrap = document.createElement('div');
    contentWrap.id = 'exp-sidebar-content';
    contentWrap.innerHTML = content;
    sidebar.appendChild(contentWrap);

    // Start collapsed on mobile
    sidebar.classList.add('collapsed');
  }
}

function toggleExpSidebarMobile() {
  const sidebar = document.getElementById('exp-sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed');
}

// Initialize sidebars when experiment detail loads
const _origOpenExperimentDetail = openExperimentDetail;
openExperimentDetail = function(id) {
  _origOpenExperimentDetail(id);
  _restoreExpSidebarState();
  _initExpSidebarDrop();
  setTimeout(() => initExpSidebarMobile(), 100);
};
