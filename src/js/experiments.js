// ── RL Templates ──
if (window.AetherUI) AetherUI.globals();
const _RL_ENV_TEMPLATE = `import gymnasium as gym

# ── Classic Control (works out of the box with just gymnasium) ──
env = gym.make("CartPole-v1")
print("Observation Space:", env.observation_space)
print("Action Space:", env.action_space)

obs, info = env.reset(seed=42)
total_reward = 0
episodes = 0

for _ in range(10_000):
    action = env.action_space.sample()
    obs, reward, terminated, truncated, info = env.step(action)
    total_reward += reward

    if terminated or truncated:
        episodes += 1
        print(f"Episode {episodes} finished with reward: {total_reward}")
        obs, info = env.reset()
        total_reward = 0

env.close()

# ── Atari (requires extra setup) ──
# pip install ale-py AutoROM
# python -m AutoROM --accept-license
#
# import ale_py
# gym.register_envs(ale_py)
# env = gym.make("ALE/MsPacman-v5", frameskip=4)
`;

// ── Projects (vault-backed) ──
const allExperiments = [];

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

// ── Project Detail ──
const currentExpId = null;
const currentExp = null;


function _renderMetaTree(node, prefix) {
  const lines = [];
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

let _expContentTab = 'readme';

function switchExpContentTab(tab) {
  _expContentTab = tab;
  const tree = document.getElementById('exp-file-tree');
  const desc = document.getElementById('exp-detail-desc');
  const treeBtn = document.getElementById('exp-tab-tree');
  const readmeBtn = document.getElementById('exp-tab-readme');
  if (tree) tree.style.display = tab === 'tree' ? '' : 'none';
  if (desc) desc.style.display = tab === 'readme' ? '' : 'none';
  if (treeBtn) treeBtn.className = 'bg-transparent border-none cursor-pointer text-[0.75rem] px-1.5 py-0.5 rounded transition-colors ' + (tab === 'tree' ? 'text-accent' : 'text-dimmer hover:text-primary');
  if (readmeBtn) readmeBtn.className = 'bg-transparent border-none cursor-pointer text-[0.75rem] px-1.5 py-0.5 rounded transition-colors ' + (tab === 'readme' ? 'text-accent' : 'text-dimmer hover:text-primary');
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
${icon('fileText', { size: 14, class: 'shrink-0 text-dimmer' })}
      <span class="text-[0.78rem] text-primary truncate flex-1">${escapeHtml(snippet)}</span>
      <button class="opacity-0 group-hover:opacity-100 bg-transparent border-none text-dimmest hover:text-red-400 cursor-pointer p-0 text-[0.85rem] leading-none shrink-0 transition-opacity" onclick="event.stopPropagation();removeExpPaper('${escapeAttr(p.link)}')" title="Remove">&times;</button>
    </div>`;
  }).join('');
}

function openExpPaper(link, title, source) {
  _setBrowseReturnView('experiment');
  _paperOriginExpId = currentExpId;
  openBrowseWithPaper(link, { link, title: title || link, source: source || '', description: '', authors: '', categories: [] });
}

function removeExpPaper(link) {
  if (!currentExp || !currentExpId) return;
  const papers = (currentExp.papers || []).filter(p => p.link !== link);
  apiPut(`/api/experiments/${currentExpId}`, { papers }).then(() => {
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
  await apiPut(`/api/experiments/${currentExpId}`, { title: newTitle });
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
  await apiPut(`/api/experiments/${currentExpId}`, { desc: newDesc });
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

const _selectedFiles = new Set();
let _lastClickedFile = null;

let _expFiles = [];
async function fetchExpFiles() {
  if (!currentExpId) return;
  try {
    const data = await apiGet(`/api/experiments/${currentExpId}/files`);
    // Support both old (array) and new ({ files, emptyDirs }) response shapes
    const files = Array.isArray(data) ? data : data.files || [];
    const emptyDirs = Array.isArray(data) ? [] : data.emptyDirs || [];
    _expFiles = files;
    // Prune stale selections
    for (const f of [..._selectedFiles]) {
      if (!files.includes(f)) _selectedFiles.delete(f);
    }
    renderFilesList(files, emptyDirs);
    _renderBulkActionBar();
  } catch(e) {
    _expFiles = [];
    _selectedFiles.clear();
    document.getElementById('exp-sidebar-files').innerHTML = '';
  }
}


function _onFileRowClick(fname, event) {
  if (event.metaKey || event.ctrlKey) {
    // Toggle file in/out of selection
    event.preventDefault();
    if (_selectedFiles.has(fname)) {
      _selectedFiles.delete(fname);
    } else {
      _selectedFiles.add(fname);
    }
    _lastClickedFile = fname;
    renderFilesList(_expFiles);
    _renderBulkActionBar();
    return;
  }
  if (event.shiftKey && _lastClickedFile && _lastClickedFile !== fname) {
    // Range select
    event.preventDefault();
    // Flatten file list in display order (same order as _expFiles)
    const startIdx = _expFiles.indexOf(_lastClickedFile);
    const endIdx = _expFiles.indexOf(fname);
    if (startIdx !== -1 && endIdx !== -1) {
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      for (let i = lo; i <= hi; i++) {
        _selectedFiles.add(_expFiles[i]);
      }
    }
    renderFilesList(_expFiles);
    _renderBulkActionBar();
    return;
  }
  // Plain click — clear selection and open file
  _selectedFiles.clear();
  _lastClickedFile = fname;
  _renderBulkActionBar();
  openFile(fname);
}

function _renderBulkActionBar() {
  const sidebar = document.getElementById('exp-sidebar');
  if (!sidebar) return;
  let bar = document.getElementById('exp-bulk-action-bar');
  if (_selectedFiles.size === 0) {
    if (bar) bar.remove();
    sidebar.style.paddingBottom = '';
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'exp-bulk-action-bar';
    sidebar.style.position = 'relative';
    sidebar.appendChild(bar);
  }
  bar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;z-index:10;background:var(--nr-bg-surface);border-top:1px solid var(--nr-border-dim);';
  sidebar.style.paddingBottom = '44px';
  AetherUI.mount(HStack([
    Text(`${_selectedFiles.size} selected`).font('0.78rem').foreground('primary').fontWeight('500').flex(1),
    Button('Move').secondary().small().attr('title', 'Move selected files').onTap(() => _bulkMoveFiles()),
    Button('Delete').danger().small().attr('title', 'Delete selected files').onTap(() => _bulkDeleteFiles())
  ]).spacing(2).padding(2, 3).alignment('center'), bar);
}

async function _bulkDeleteFiles() {
  const count = _selectedFiles.size;
  if (!count || !confirm(`Delete ${count} file${count !== 1 ? 's' : ''}?`)) return;
  const files = [..._selectedFiles];
  for (const fname of files) {
    await apiDelete(`/api/experiments/${currentExpId}/files/${fname}`);
    if (currentFile === fname) {
      closeFileEditor();
    }
  }
  _selectedFiles.clear();
  _lastClickedFile = null;
  _renderBulkActionBar();
  fetchExpFiles();
}

async function _bulkMoveFiles() {
  const count = _selectedFiles.size;
  if (!count) return;
  const folder = prompt(`Move ${count} file${count !== 1 ? 's' : ''} to folder:`);
  if (folder === null) return; // cancelled
  const targetFolder = folder.trim();
  const files = [..._selectedFiles];
  for (const oldPath of files) {
    const fileName = oldPath.includes('/') ? oldPath.split('/').pop() : oldPath;
    const newPath = targetFolder ? (targetFolder + '/' + fileName) : fileName;
    if (oldPath === newPath) continue;
    try {
      await apiPost(`/api/experiments/${currentExpId}/move-file`, { oldPath, newPath });
      if (currentFile === oldPath) {
        currentFile = newPath;
      }
    } catch (e) {
      // Continue with remaining files
    }
  }
  _selectedFiles.clear();
  _lastClickedFile = null;
  _renderBulkActionBar();
  fetchExpFiles();
}

// Escape key clears multi-selection
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _selectedFiles.size > 0) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    _selectedFiles.clear();
    renderFilesList(_expFiles);
    _renderBulkActionBar();
  }
});

function _fileExtBadge(f) {
  const name = f.includes('/') ? f.split('/').pop() : f;
  if (name.endsWith('.ipynb')) return ['nb', 'bg-orange-500/20 text-orange-400'];
  if (name.endsWith('.py')) return ['py', 'bg-emerald-500/20 text-emerald-400'];
  if (name.endsWith('.tex') || name.endsWith('.sty') || name.endsWith('.bst')) return ['tex', 'bg-red-500/20 text-red-400'];
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
    el.innerHTML = '<div class="text-dimmest text-[0.75rem] py-2 px-2">No files yet.</div>';
    return;
  }
  const tree = _buildFileTree(files, emptyDirs);

  function fileRow(f) {
    const isActive = currentFile === f;
    const isSelected = _selectedFiles.has(f);
    const hasSelection = _selectedFiles.size > 0;
    const activeCls = isSelected ? 'bg-blue-500/15' : isActive ? 'bg-card' : '';
    const displayName = f.split('/').pop();
    const [badge, badgeCls] = _fileExtBadge(f);
    const escapedF = escapeHtml(f).replace(/'/g, "\\'");
    const checkbox = hasSelection ? `<span class="shrink-0 w-4 h-4 flex items-center justify-center rounded border ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-border-input bg-transparent text-transparent'} text-[0.65rem] leading-none transition-colors">&#10003;</span>` : '';
    return `
    <div class="exp-file-row relative flex items-center py-1.5 px-2 rounded-md hover:bg-card/50 cursor-pointer group transition-colors overflow-hidden ${activeCls}" draggable="true" data-filepath="${escapeHtml(f)}" onclick="_onFileRowClick('${escapedF}', event)" title="${escapeHtml(f)}"
         ondragstart="_draggedFile='${escapedF}'; this.style.opacity='0.5'"
         ondragend="_draggedFile=null; this.style.opacity=''">
      <div class="flex items-center gap-1.5 min-w-0">
        ${checkbox}
        <span class="text-[0.7rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
        <span class="text-[0.8rem] text-primary truncate">${escapeHtml(displayName)}</span>
      </div>
      <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 rounded-md">
        <button draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); duplicateExpFile('${escapedF}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-primary" title="Duplicate">
          ${icon('filePlus', { size: 12 })}
        </button>
        <button draggable="false" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); deleteExpFile('${escapedF}')" class="w-6 h-6 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400" title="Delete">
${icon('trash', { size: 12 })}
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
            ${icon('chevronRightSmall', { size: 12, class: 'fill-current transition-transform shrink-0 chevron-icon', style: 'transform:rotate(90deg)' })}
            ${icon('folderFilled', { size: 14, class: 'text-amber-400/70 shrink-0' })}
            <span class="text-[0.78rem] truncate folder-name-span" ondblclick="event.stopPropagation(); startRenameFolder('${escapedFolder}', this)">${escapeHtml(name)}</span>
          </button>
          <span class="text-[0.65rem] text-dimmer shrink-0">${count}</span>
          <button onclick="event.stopPropagation(); deleteExpFolder('${escapedFolder}')" class="w-5 h-5 rounded-md bg-transparent border-none text-dimmer cursor-pointer flex items-center justify-center hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete folder">
  ${icon('trash', { size: 12 })}
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
      try {
        await apiPut(`/api/experiments/${currentExpId}/files/${fname}`, { rename: newName });
        currentFile = newName;
        openFile(newName);
        return;
      } catch (e) {
        // Fall through to revert
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

async function createExpFile(ext, content, template) {
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : ext === '.tex' ? 'paper' : ext === '.mermaid' ? 'diagram' : ext === '.draw' ? 'drawing' : ext === '.slides' ? 'presentation' : 'notes';
  let name = `${base}${ext}`;
  let i = 2;
  const data = await apiGet(`/api/experiments/${currentExpId}/files`);
  const existing = Array.isArray(data) ? data : data.files || [];
  const sep = ext === '.py' ? '_' : '-';
  while (existing.includes(name)) { name = `${base}${sep}${i}${ext}`; i++; }
  const payload = {name};
  if (content !== undefined) payload.content = content;
  if (template) payload.template = template;
  const result = await apiPost(`/api/experiments/${currentExpId}/files`, payload).catch(() => null);
  const actualName = result?.name || name;
  await fetchExpFiles();
  openFile(actualName);
  return actualName;
}

function _expPromptBar(barId, placeholder, buttonLabel, onSubmit) {
  const filesEl = document.getElementById('exp-sidebar-files');
  const existing = document.getElementById(barId);
  if (existing) { existing.querySelector('input').focus(); return; }
  const bar = document.createElement('div');
  bar.id = barId;
  bar.className = 'mb-2';
  const inputId = barId + '-input';
  const errorId = barId + '-error';
  const errorText = Text('').font('0.72rem').foreground('red').id(errorId).visible(false).styles({ marginTop: 'var(--nr-space-1)' });
  const input = TextField(placeholder).id(inputId).font('0.78rem');
  const btn = Button(buttonLabel).primary().small().onTap(e => { e.preventDefault(); onSubmit(); });
  btn.el.addEventListener('mousedown', e => e.preventDefault());
  AetherUI.mount(VStack([
    HStack([input.flex(1), btn]).spacing(1.5),
    errorText
  ]), bar);
  filesEl.parentNode.insertBefore(bar, filesEl);
  input.el.focus();
  input.el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
    if (e.key === 'Escape') { bar.remove(); }
  });
  return { bar, input: input.el, errorEl: errorText.el };
}

function promptCloneRepo() {
  _expPromptBar('clone-repo-bar', 'https://github.com/user/repo', 'Clone', submitCloneRepo);
}

async function submitCloneRepo() {
  const input = document.getElementById('clone-repo-bar-input');
  if (!input) return;
  const url = input.value.trim();
  if (!url) return;
  input.disabled = true;
  try {
    await api(`/api/experiments/${currentExpId}/clone-repo`, {
      method: 'POST',
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (e) {
    // Clone may have succeeded even if the connection dropped
  }
  const bar = document.getElementById('clone-repo-bar');
  if (bar) bar.remove();
  fetchExpFiles();
}

// ── Folder Management ──
function promptCreateFolder() {
  const result = _expPromptBar('create-folder-bar', 'Folder name', 'Create', submitCreateFolder);
  if (!result) return;
  result.input.addEventListener('blur', () => {
    setTimeout(() => { const bar = document.getElementById('create-folder-bar'); if (bar) bar.remove(); }, 150);
  });
}

async function submitCreateFolder() {
  const input = document.getElementById('create-folder-bar-input');
  const errEl = document.getElementById('create-folder-bar-error');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  try {
    await apiPost(`/api/experiments/${currentExpId}/create-folder`, { name });
    const bar = document.getElementById('create-folder-bar');
    if (bar) bar.remove();
    fetchExpFiles();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message;
      errEl.style.display = '';
    }
  }
}

async function deleteExpFolder(folder) {
  if (!confirm(`Delete folder "${folder}" and all its contents?`)) return;
  try {
    await apiPost(`/api/experiments/${currentExpId}/delete-folder`, { folder });
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
        await apiPost(`/api/experiments/${currentExpId}/rename-folder`, { oldName: folderName, newName });
        // Update currentFile if it was inside the renamed folder
        if (currentFile && currentFile.startsWith(folderName + '/')) {
          currentFile = newName + currentFile.substring(folderName.length);
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
    await apiPost(`/api/experiments/${currentExpId}/move-file`, { oldPath, newPath });
    if (currentFile === oldPath) currentFile = newPath;
    fetchExpFiles();
  } catch (e) { /* silently fail */ }
  _draggedFile = null;
}

async function duplicateExpFile(fname) {
  const ext = fname.includes('.') ? '.' + fname.split('.').pop() : '';
  const base = fname.includes('.') ? fname.slice(0, fname.lastIndexOf('.')) : fname;
  const newName = base + '_copy' + ext;
  const data = await apiGet(`/api/experiments/${currentExpId}/files/${fname}`);
  if (data.error) return;
  await apiPut(`/api/experiments/${currentExpId}/files/${newName}`, { content: data.content });
  fetchExpFiles();
}

async function deleteExpFile(fname) {
  if (!confirm(`Delete ${fname}?`)) return;
  await apiDelete(`/api/experiments/${currentExpId}/files/${fname}`);
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
  const data = await apiGet(`/api/experiments/${currentExpId}/files/${fname}`);

  const _dc = document.getElementById('exp-default-content');
  if (_dc) _dc.style.display = 'none';
  const editor = document.getElementById('exp-file-editor');
  editor.style.display = 'flex';
  editor.style.flexDirection = 'column';
  editor.style.flex = '1 1 0%';
  editor.style.minHeight = '0';
  editor.style.overflow = 'hidden';
  const cp = document.getElementById('exp-content-pane');
  if (cp) {
    cp.style.overflow = 'hidden';
    cp.style.display = 'flex';
    cp.style.flexDirection = 'column';
    cp.style.flex = '1 1 0%';
    cp.style.minHeight = '0';
  }

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
  } else if (fname.endsWith('.tex') || fname.endsWith('.sty') || fname.endsWith('.bst')) {
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
  if (document.getElementById('exp-sidebar-files')) fetchExpFiles();
}

function renderImageViewer(fname, dataUrl) {
  const editor = document.getElementById('exp-file-editor');
  editor.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2 border-b border-border-dim bg-card/50">
      <span id="img-viewer-fname" class="text-[0.85rem] text-primary font-medium cursor-pointer hover:text-accent transition-colors" onclick="startRenameFileInViewer('${escapeHtml(fname)}')" title="Click to rename">${escapeHtml(fname)}</span>
      <div class="flex items-center gap-1.5">
        ${fileShareButton()}
        <a href="${dataUrl}" download="${escapeHtml(fname)}" id="img-viewer-download" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-transparent border-none text-muted cursor-pointer hover:text-primary transition-colors no-underline" title="Download">
${icon('download', { size: 14 })}
        </a>
      </div>
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
      <div class="flex items-center gap-1.5">
        ${fileShareButton()}
        <a href="${dataUrl}" download="${escapeHtml(fname)}" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-transparent border-none text-muted cursor-pointer hover:text-primary transition-colors no-underline" title="Download">
${icon('download', { size: 14 })}
        </a>
      </div>
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
      <a href="${dataUrl}" download="${escapeHtml(fname)}" class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[0.75rem] bg-transparent border-none text-muted cursor-pointer hover:text-primary transition-colors no-underline" title="Download">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>
    </div>
    <div class="flex flex-col items-center justify-center p-8 min-h-[300px] gap-3 text-dimmer">
${icon('fileText', { size: 48, strokeWidth: '1.5' })}
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
      try {
        await apiPut(`/api/experiments/${currentExpId}/files/${fname}`, { rename: newName });
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
      } catch (e) {
        // Fall through to revert
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
  if (typeof _texPreviewEl !== 'undefined' && _texPreviewEl) { _texPreviewEl.remove(); _texPreviewEl = null; }
  if (typeof _mermaidCm !== 'undefined') _mermaidCm = null;
  const el = document.getElementById('exp-file-editor');
  if (el) {
    el.style.display = 'none';
    el.style.flexDirection = '';
    el.style.flex = '';
    el.style.minHeight = '';
    el.style.overflow = '';
    el.innerHTML = '';
  }
  const cp = document.getElementById('exp-content-pane');
  if (cp) {
    cp.style.overflow = '';
    cp.style.display = '';
    cp.style.flexDirection = '';
    cp.style.flex = '';
    cp.style.minHeight = '';
  }
  const _dc2 = document.getElementById('exp-default-content');
  if (_dc2) _dc2.style.display = '';
  if (document.getElementById('exp-sidebar-files')) fetchExpFiles();
}

// ── Resizable Experiment Sidebar ──

function _initExpSidebarResize() {
  const handle = document.getElementById('exp-sidebar-resize');
  if (!handle) return;
  let dragging = false;
  let startX, startWidth;

  handle.addEventListener('mousedown', e => {
    const grid = document.querySelector('#exp-detail-view .grid');
    if (!grid || grid.classList.contains('exp-sidebar-collapsed')) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = document.getElementById('exp-sidebar').offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(600, startWidth + delta));
      grid.style.gridTemplateColumns = newWidth + 'px 1px 1fr';
    }
    function onUp() {
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist width
      const w = document.getElementById('exp-sidebar').offsetWidth;
      Settings.set('expSidebarWidth', w);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function _restoreExpSidebarWidth() {
  const grid = document.querySelector('#exp-detail-view .grid');
  if (!grid || grid.classList.contains('exp-sidebar-collapsed')) return;
  const saved = Settings.get('expSidebarWidth');
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= 160 && w <= 600) {
      grid.style.gridTemplateColumns = w + 'px 1px 1fr';
    }
  }
}

// ── Collapsible Experiment Sidebar (Desktop) ──

function toggleExpSidebar() {
  const grid = document.querySelector('#exp-detail-view .grid');
  if (!grid) return;
  grid.classList.toggle('exp-sidebar-collapsed');
  const collapsed = grid.classList.contains('exp-sidebar-collapsed');
  Settings.set('expSidebarCollapsed', collapsed ? '1' : '0');
  if (collapsed) {
    grid.style.gridTemplateColumns = '';
  } else {
    _restoreExpSidebarWidth();
  }
}

function _restoreExpSidebarState() {
  const grid = document.querySelector('#exp-detail-view .grid');
  if (!grid) return;
  if (Settings.get('expSidebarCollapsed') === '1') {
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
      headers: { 'Authorization': _authHeaders()['Authorization'] },
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

// Initialize sidebars when experiment detail loads
const _origOpenExperimentDetail = openExperimentDetail;
openExperimentDetail = async function(id) {
  _selectedFiles.clear();
  _lastClickedFile = null;
  await _origOpenExperimentDetail(id);
  _restoreExpSidebarState();
  _restoreExpSidebarWidth();
  _initExpSidebarResize();
  _initExpSidebarDrop();
};

