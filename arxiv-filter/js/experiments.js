// ── Projects List (server-backed) ──
let allExperiments = [];

async function fetchExperiments() {
  const container = document.getElementById('ideas-list');
  container.innerHTML = '<div class="col-span-2 text-center py-20 text-dim text-base"><div class="spinner"></div><div>Loading...</div></div>';
  try {
    const resp = await fetch('/api/experiments');
    allExperiments = await resp.json();
    renderExperimentList();
  } catch (err) {
    container.innerHTML = `<div class="col-span-2 text-center py-20 text-red-400"><p>Failed to load projects: ${err.message}</p></div>`;
  }
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
    <div class="p-4 rounded-xl border border-border-card bg-card cursor-pointer transition-all duration-150 hover:border-border-input hover:shadow-lg group relative" onclick="openExperimentDetail('${exp.id}')">
      <div class="text-[0.95rem] font-semibold text-white_ mb-1 truncate nb-rendered-md" data-latex>${marked.parseInline(exp.title)}</div>
      ${exp.desc ? `<div class="text-[0.8rem] text-muted line-clamp-2 mb-2 nb-rendered-md" data-latex>${marked.parse(exp.desc)}</div>` : '<div class="mb-2"></div>'}
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
  container.querySelectorAll('[data-latex]').forEach(el => {
    if (typeof katex !== 'undefined') {
      function decodeTex(t) { return t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"'); }
      let html = el.innerHTML;
      html = html.replace(/\$\$([^$]+?)\$\$/g, (_, tex) => { try { return katex.renderToString(decodeTex(tex), { displayMode: true, throwOnError: false }); } catch { return _; } });
      html = html.replace(/\$([^$]+?)\$/g, (_, tex) => { try { return katex.renderToString(decodeTex(tex), { displayMode: false, throwOnError: false }); } catch { return _; } });
      el.innerHTML = html;
    }
  });
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
    } else {
      descEl.textContent = 'No description. Double-click to add one.';
      descEl.classList.add('text-dimmest');
      descEl.classList.remove('text-muted');
    }
    document.getElementById('exp-file-editor').style.display = 'none';
    document.getElementById('exp-file-editor').innerHTML = '';
    document.getElementById('exp-default-content').style.display = '';
    currentFile = null;
    fetchExpTodos();
    fetchExpFiles();
  } catch (err) {
    document.getElementById('exp-todos-list').innerHTML =
      `<div class="text-center py-10 text-red-400 text-[0.85rem]">Failed to load: ${err.message}</div>`;
  }
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
  el.outerHTML = `<textarea id="exp-desc-input" class="text-[0.85rem] text-primary bg-input border border-border-input rounded-md outline-none w-full mb-5 p-3 resize-y focus:border-accent" rows="6" placeholder="Add a description (markdown supported)...">${escapeHtml(currentExp.desc || '')}</textarea>`;
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
  textarea.outerHTML = `<div id="exp-detail-desc" class="text-[0.85rem] ${desc ? 'text-muted' : 'text-dimmest'} mb-5 cursor-pointer hover:text-primary transition-colors nb-rendered-md" ondblclick="startEditDesc()" title="Double-click to edit description">${content}</div>`;
  if (desc) renderLatexIn('exp-detail-desc');
}

// ── Experiment Todos ──
let expTodos = [];

async function fetchExpTodos() {
  try {
    const resp = await fetch('/api/todos');
    const allTodos = await resp.json();
    expTodos = allTodos.filter(t => t.experimentId === currentExpId);
  } catch (e) { expTodos = []; }
  renderExpTodos();
}

function renderExpTodos() {
  const list = document.getElementById('exp-todos-list');
  const countEl = document.getElementById('exp-todo-count');
  const active = expTodos.filter(t => !t.done);
  const done = expTodos.filter(t => t.done);
  const total = active.length + done.length;
  countEl.textContent = total ? `${active.length}/${total}` : '';

  if (!expTodos.length) {
    list.innerHTML = '<div class="text-[0.75rem] text-dimmer pl-1 py-1">No todos</div>';
    return;
  }

  const renderItem = (t) => {
    return `<div class="flex items-center gap-2 py-1 pl-1 group hover:bg-hover rounded transition-colors">
      <button onclick="toggleExpTodo('${t.id}')" class="w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer bg-transparent transition-colors ${t.done ? 'border-emerald-500 bg-emerald-500/20' : 'border-border-input hover:border-accent'}">
        ${t.done ? '<svg class="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
      </button>
      <span class="flex-1 text-[0.78rem] truncate ${t.done ? 'line-through text-dimmer' : 'text-muted'}">${escapeHtml(t.title)}</span>
      <button onclick="deleteExpTodo('${t.id}')" class="w-4 h-4 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" title="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  };

  list.innerHTML = active.map(renderItem).join('') + done.map(renderItem).join('');
}

function toggleExpTodosFolder() {
  const folder = document.getElementById('exp-todos-folder');
  const chevron = document.getElementById('exp-todos-chevron');
  if (!folder) return;
  const collapsed = folder.classList.toggle('hidden');
  if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(90deg)';
}

function addExpTodo() {
  // Expand folder if collapsed
  const folder = document.getElementById('exp-todos-folder');
  const chevron = document.getElementById('exp-todos-chevron');
  if (folder && folder.classList.contains('hidden')) {
    folder.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(90deg)';
  }
  const area = document.getElementById('exp-todo-input-area');
  if (area.querySelector('input')) { area.querySelector('input').focus(); return; }
  area.innerHTML = `<div class="flex items-center gap-1.5 mb-1">
    <input id="exp-todo-input" type="text" class="flex-1 px-2 py-1 rounded border border-border-input bg-input text-primary text-[0.78rem] focus:outline-none focus:border-accent" placeholder="New todo…" autofocus />
    <button onmousedown="event.preventDefault(); submitExpTodo()" class="px-2 py-1 rounded border-none bg-accent text-white text-[0.75rem] cursor-pointer hover:bg-accent-hover">Add</button>
  </div>`;
  const input = document.getElementById('exp-todo-input');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitExpTodo(); }
    if (e.key === 'Escape') { area.innerHTML = ''; }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (area.querySelector('#exp-todo-input')) area.innerHTML = ''; }, 100);
  });
}

async function submitExpTodo() {
  const input = document.getElementById('exp-todo-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  try {
    const resp = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, experimentId: currentExpId })
    });
    const created = await resp.json();
    expTodos.push(created);
    if (typeof todos !== 'undefined') todos.push(created);
    document.getElementById('exp-todo-input-area').innerHTML = '';
    renderExpTodos();
  } catch (e) { /* silently fail */ }
}

async function toggleExpTodo(id) {
  const todo = expTodos.find(t => t.id === id);
  if (!todo) return;
  try {
    const resp = await fetch('/api/todos/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !todo.done })
    });
    const updated = await resp.json();
    const idx = expTodos.findIndex(t => t.id === id);
    if (idx !== -1) expTodos[idx] = updated;
    if (typeof todos !== 'undefined') {
      const gi = todos.findIndex(t => t.id === id);
      if (gi !== -1) todos[gi] = updated;
    }
    renderExpTodos();
  } catch (e) { /* silently fail */ }
}

async function deleteExpTodo(id) {
  if (!confirm('Delete this todo?')) return;
  try {
    await fetch('/api/todos/' + id, { method: 'DELETE' });
    expTodos = expTodos.filter(t => t.id !== id);
    if (typeof todos !== 'undefined') todos = todos.filter(t => t.id !== id);
    renderExpTodos();
  } catch (e) { /* silently fail */ }
}

// ── Files ──
let currentFile = null;
let fileSaveTimer = null;

async function fetchExpFiles() {
  if (!currentExpId) return;
  try {
    const resp = await fetch(`/api/experiments/${currentExpId}/files`);
    const files = await resp.json();
    renderFilesList(files);
  } catch(e) {
    document.getElementById('exp-sidebar-files').innerHTML = '';
  }
}

function renderFilesList(files) {
  const el = document.getElementById('exp-sidebar-files');
  if (!files.length) {
    el.innerHTML = '<div class="text-dimmest text-[0.75rem] py-2">No files yet.</div>';
    return;
  }
  el.innerHTML = files.map(f => {
    const isActive = currentFile === f;
    const activeCls = isActive ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent';
    return `
    <div class="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-card/50 cursor-pointer group transition-colors ${activeCls}" onclick="openFile('${escapeHtml(f)}')">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${f.endsWith('.ipynb') ? 'bg-orange-500/20 text-orange-400' : f.endsWith('.py') ? 'bg-emerald-500/20 text-emerald-400' : f.endsWith('.tex') ? 'bg-red-500/20 text-red-400' : f.endsWith('.png') || f.endsWith('.svg') ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}">${f.endsWith('.ipynb') ? 'nb' : f.endsWith('.py') ? 'py' : f.endsWith('.tex') ? 'tex' : f.endsWith('.png') ? 'png' : f.endsWith('.svg') ? 'svg' : 'md'}</span>
        <span class="text-[0.8rem] text-primary truncate">${escapeHtml(f)}</span>
      </div>
      <button onclick="event.stopPropagation(); deleteExpFile('${escapeHtml(f)}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  }).join('');
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
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : ext === '.tex' ? 'paper' : 'notes';
  let name = `${base}${ext}`;
  let i = 2;
  const resp = await fetch(`/api/experiments/${currentExpId}/files`);
  const existing = await resp.json();
  while (existing.includes(name)) { name = `${base}-${i}${ext}`; i++; }
  const payload = {name};
  if (content !== undefined) payload.content = content;
  await fetch(`/api/experiments/${currentExpId}/files`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  fetchExpFiles();
  return name;
}

async function deleteExpFile(fname) {
  if (!confirm(`Delete ${fname}?`)) return;
  await fetch(`/api/experiments/${currentExpId}/files/${fname}`, {method:'DELETE'});
  if (currentFile === fname) {
    if (fileSaveTimer) { clearTimeout(fileSaveTimer); fileSaveTimer = null; }
    currentFile = null;
    pyEditorCm = null;
    cmInstances = [];
    document.getElementById('exp-file-editor').style.display = 'none';
    document.getElementById('exp-file-editor').innerHTML = '';
    document.getElementById('exp-default-content').style.display = '';
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
  editor.style.display = 'block';
  editor.style.flexDirection = '';
  editor.style.height = '';
  var cp = document.getElementById('exp-content-pane');
  cp.style.overflow = '';
  cp.style.padding = '';

  if (fname.endsWith('.png') || fname.endsWith('.svg')) {
    renderImageViewer(fname, data.content);
  } else if (fname.endsWith('.ipynb')) {
    renderNotebookEditor(fname, data.content);
  } else if (fname.endsWith('.py')) {
    renderPythonEditor(fname, data.content);
  } else if (fname.endsWith('.tex')) {
    renderLatexEditor(fname, data.content);
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
  const el = document.getElementById('exp-file-editor');
  el.style.display = 'none';
  el.style.flexDirection = '';
  el.style.height = '';
  var cp = document.getElementById('exp-content-pane');
  cp.style.overflow = '';
  cp.style.padding = '';
  el.innerHTML = '';
  document.getElementById('exp-default-content').style.display = '';
  fetchExpFiles();
}
