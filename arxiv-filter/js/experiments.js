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
  countEl.textContent = `${active.length} todo${active.length !== 1 ? 's' : ''}${done.length ? ` · ${done.length} done` : ''}`;

  if (!expTodos.length) {
    list.innerHTML = '';
    return;
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}`;
  };

  const renderItem = (t) => {
    const dateTag = t.date ? `<span class="text-[0.7rem] text-dimmer bg-body px-2 py-0.5 rounded-full">${formatDate(t.date)}</span>` : '';
    return `<div class="flex items-center gap-3 py-2.5 px-1 group border-b border-border-dim/50">
      <button onclick="toggleExpTodo('${t.id}')" class="w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center cursor-pointer bg-transparent transition-colors ${t.done ? 'border-emerald-500 bg-emerald-500/20' : 'border-border-input hover:border-accent'}">
        ${t.done ? '<svg class="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
      </button>
      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${t.color || '#b4451a'}"></span>
      <span class="flex-1 text-[0.85rem] ${t.done ? 'line-through text-dimmer' : 'text-primary'}">${escapeHtml(t.title)}</span>
      ${dateTag}
      <button onclick="deleteExpTodo('${t.id}')" class="w-6 h-6 rounded bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  };

  list.innerHTML = active.map(renderItem).join('') + done.map(renderItem).join('');
}

function addExpTodo() {
  const area = document.getElementById('exp-todo-input-area');
  if (area.querySelector('input')) { area.querySelector('input').focus(); return; }
  area.innerHTML = `<div class="flex items-center gap-2 mb-4">
    <input id="exp-todo-input" type="text" class="flex-1 px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] focus:outline-none focus:border-accent" placeholder="Todo title..." autofocus />
    <button onclick="submitExpTodo()" class="px-3 py-2 rounded-md border-none bg-accent text-white text-[0.85rem] cursor-pointer hover:bg-accent-hover">Add</button>
    <button onclick="document.getElementById('exp-todo-input-area').innerHTML=''" class="px-3 py-2 rounded-md border border-border-input bg-transparent text-muted text-[0.85rem] cursor-pointer hover:text-primary">Cancel</button>
  </div>`;
  const input = document.getElementById('exp-todo-input');
  input.focus();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitExpTodo(); }
    if (e.key === 'Escape') { area.innerHTML = ''; }
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
        <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${f.endsWith('.ipynb') ? 'bg-orange-500/20 text-orange-400' : f.endsWith('.py') ? 'bg-emerald-500/20 text-emerald-400' : f.endsWith('.png') || f.endsWith('.svg') ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}">${f.endsWith('.ipynb') ? 'nb' : f.endsWith('.py') ? 'py' : f.endsWith('.png') ? 'png' : f.endsWith('.svg') ? 'svg' : 'md'}</span>
        <span class="text-[0.8rem] text-primary truncate">${escapeHtml(f)}</span>
      </div>
      <button onclick="event.stopPropagation(); deleteExpFile('${escapeHtml(f)}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`;
  }).join('');
}

async function createExpFile(ext, content) {
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : 'notes';
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
  if (currentFile === fname) return;
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

  if (fname.endsWith('.png') || fname.endsWith('.svg')) {
    renderImageViewer(fname, data.content);
  } else if (fname.endsWith('.ipynb')) {
    renderNotebookEditor(fname, data.content);
  } else if (fname.endsWith('.py')) {
    renderPythonEditor(fname, data.content);
  } else {
    renderMarkdownEditor(fname, data.content);
  }
  fetchExpFiles();
}

function renderImageViewer(fname, dataUrl) {
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50">
      <span class="text-[0.85rem] text-primary font-medium">${escapeHtml(fname)}</span>
      <div class="flex gap-2">
        <a href="${dataUrl}" download="${escapeHtml(fname)}" class="px-2.5 py-1 rounded text-[0.75rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors no-underline">Download</a>
        <button onclick="closeFileEditor()" class="px-2.5 py-1 rounded text-[0.75rem] bg-card border border-border-input text-muted cursor-pointer hover:border-accent hover:text-primary transition-colors">Close</button>
      </div>
    </div>
    <div class="flex items-center justify-center p-8 min-h-[300px]">
      <img src="${dataUrl}" class="max-w-full max-h-[70vh] rounded shadow-lg" alt="${escapeHtml(fname)}" />
    </div>`;
}

function closeFileEditor() {
  if (fileSaveTimer) { clearTimeout(fileSaveTimer); fileSaveTimer = null; }
  currentFile = null;
  pyEditorCm = null;
  cmInstances = [];
  document.getElementById('exp-file-editor').style.display = 'none';
  document.getElementById('exp-file-editor').innerHTML = '';
  document.getElementById('exp-default-content').style.display = '';
  fetchExpFiles();
}
