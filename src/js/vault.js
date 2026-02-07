// ── Vault (Obsidian-style notes + projects) ──

let _vaultNotes = [];
let _vaultTree = []; // Full recursive file tree from /api/vault/tree
let _vaultCurrentNote = null;
let _vaultPreviewMode = true; // Preview on by default
let _vaultGraphMode = false;
let _vaultSaveTimeout = null;
let _vaultMarimoActive = false; // Whether a marimo server is running for current note
let _vaultEditorMode = 'note'; // 'note' | 'file'
let _vaultExpandedProjects = new Set(); // project IDs currently expanded in tree

// Open vault view
async function openVault() {
  setSidebarLoading('sb-vault');
  hideAllViews();
  const view = await ensureView('vault-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'vault';
  setSidebarActive('sb-vault');
  initVault();
  showPanelForView('vault');
}

// Initialize vault
async function initVault() {
  await Promise.all([loadVaultNotes(), loadVaultTree()]);

  // Create welcome note for new vaults
  if (_vaultNotes.length === 0) {
    await createWelcomeNote();
  }

  renderVaultFileTree();

  // Load last opened note or first note
  const lastNote = localStorage.getItem('vaultLastNote');
  if (lastNote && _vaultNotes.find(n => n.id === lastNote)) {
    openVaultNote(lastNote);
  } else if (_vaultNotes.length > 0) {
    openVaultNote(_vaultNotes[0].id);
  } else {
    clearVaultEditor();
  }

  // Setup editor auto-save and blur-to-preview
  const editor = document.getElementById('vault-editor');
  if (editor && !editor._vaultInitialized) {
    editor._vaultInitialized = true;
    editor.addEventListener('input', () => {
      clearTimeout(_vaultSaveTimeout);
      _vaultSaveTimeout = setTimeout(saveCurrentNote, 1000);
      updateVaultPreview();
    });
    // Blur to switch back to preview mode
    editor.addEventListener('blur', (e) => {
      // Small delay to allow clicking on toolbar buttons
      setTimeout(() => {
        if (!document.activeElement || !document.activeElement.closest('.vault-toolbar')) {
          if (!_vaultPreviewMode && !_vaultGraphMode) {
            _vaultPreviewMode = true;
            const btn = document.getElementById('vault-preview-btn');
            const editorCont = document.getElementById('vault-editor-container');
            const previewCont = document.getElementById('vault-preview-container');
            if (btn) btn.classList.add('active');
            if (editorCont) editorCont.style.display = 'none';
            if (previewCont) previewCont.style.display = '';
            updateVaultPreview();
          }
        }
      }, 150);
    });
  }

  // Setup click-to-edit on preview container
  const previewContainer = document.getElementById('vault-preview-container');
  if (previewContainer && !previewContainer._vaultClickInitialized) {
    previewContainer._vaultClickInitialized = true;
    previewContainer.addEventListener('click', (e) => {
      // Don't switch to edit mode if clicking a link
      if (e.target.closest('a')) return;
      if (_vaultPreviewMode && !_vaultGraphMode) {
        vaultSwitchToEdit();
      }
    });
  }

  // Apply default preview state
  const previewBtn = document.getElementById('vault-preview-btn');
  const editorContainer = document.getElementById('vault-editor-container');
  if (previewBtn && _vaultPreviewMode) {
    previewBtn.classList.add('active');
    if (editorContainer) editorContainer.style.display = 'none';
    if (previewContainer) previewContainer.style.display = '';
    updateVaultPreview();
  }

}

// Create welcome note for new vaults (only if no notes exist)
async function createWelcomeNote() {
  // Double-check there are really no notes
  if (_vaultNotes.length > 0) return;

  // Check localStorage to prevent re-creating on subsequent loads
  if (localStorage.getItem('vaultWelcomeCreated')) return;
  localStorage.setItem('vaultWelcomeCreated', 'true');

  const welcomeContent = `# Welcome to your Vault

This is your personal knowledge base with **wiki-style linking** and a **graph view**.

## How to use wiki links

Link to other notes using double brackets: [[Ideas]] or [[Project Notes]]

Click a link to navigate to that note. If the note doesn't exist, you'll be prompted to create it.

## Try the Graph View

Click the graph icon in the toolbar to see how your notes connect. The graph shows:
- **Nodes** for each note
- **Lines** connecting linked notes
- Click any node to open that note

## Example notes to try

Here are some notes that link to each other:

- [[Ideas]] - A place for brainstorming
- [[Project Notes]] - Your project documentation
- [[Daily Log]] - Track your daily progress

## Tags

Use #tags to organize notes: #welcome #tutorial #getting-started

## Tips

- Use **bold** and *italic* for emphasis
- Create \`inline code\` or code blocks
- Use > for blockquotes
- Create lists with -

Happy note-taking!`;

  try {
    // Create Welcome note
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Welcome', content: welcomeContent })
    });
    if (res.ok) {
      const note = await res.json();
      _vaultNotes.push(note);
    }

    // Create Ideas note
    const ideasContent = `# Ideas

A place for your creative thoughts and brainstorming.

## Links
- Back to [[Welcome]]
- See also [[Project Notes]]

#ideas #brainstorm`;
    const res2 = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Ideas', content: ideasContent })
    });
    if (res2.ok) {
      const note = await res2.json();
      _vaultNotes.push(note);
    }

    // Create Project Notes
    const projectContent = `# Project Notes

Document your projects here.

## Related
- [[Ideas]] for brainstorming
- [[Daily Log]] for progress tracking
- Back to [[Welcome]]

#projects`;
    const res3 = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Project Notes', content: projectContent })
    });
    if (res3.ok) {
      const note = await res3.json();
      _vaultNotes.push(note);
    }

    // Create Daily Log
    const dailyContent = `# Daily Log

Track your daily progress and thoughts.

## Today

- Started using the vault
- Explored [[Welcome]] tutorial
- Connected notes with [[Ideas]] and [[Project Notes]]

#daily #log`;
    const res4 = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Daily Log', content: dailyContent })
    });
    if (res4.ok) {
      const note = await res4.json();
      _vaultNotes.push(note);
    }
  } catch (e) {
    console.error('Failed to create welcome notes', e);
  }
}

// Load all notes from server
async function loadVaultNotes() {
  try {
    const res = await fetch('/api/vault/notes', { headers: _authHeaders() });
    if (res.ok) {
      _vaultNotes = await res.json();
    }
  } catch (e) {
    console.error('Failed to load vault notes', e);
    _vaultNotes = [];
  }
}

// Load full vault file tree (includes project folders)
async function loadVaultTree() {
  try {
    const res = await fetch('/api/vault/tree', { headers: _authHeaders() });
    if (res.ok) {
      _vaultTree = await res.json();
    }
  } catch (e) {
    console.error('Failed to load vault tree', e);
    _vaultTree = [];
  }
}

// Render file tree — combines vault notes with full file tree
function renderVaultFileTree(filter = '') {
  const container = document.getElementById('vault-file-tree');
  if (!container) return;

  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? _vaultNotes.filter(n => n.title.toLowerCase().includes(filterLower) || n.content?.toLowerCase().includes(filterLower))
    : _vaultNotes;

  // Build a set of note filenames (so we can avoid duplicating .md files from tree)
  const noteIds = new Set(_vaultNotes.map(n => n.id));

  // Group notes by folder (vault's note-folder system, not filesystem dirs)
  const folders = {};
  const rootNotes = [];

  filtered.forEach(note => {
    if (note.folder) {
      if (!folders[note.folder]) folders[note.folder] = [];
      folders[note.folder].push(note);
    } else {
      rootNotes.push(note);
    }
  });

  // Build set of note-folder names and note titles so we don't double-render them from the tree
  const noteFolders = new Set(Object.keys(folders));

  // Identify project folders from the tree (dirs that are NOT note-folders)
  const projectDirs = _vaultTree.filter(item =>
    item.type === 'dir' && !noteFolders.has(item.name)
  );

  let html = '';

  // Render project folders first (from vault tree) — expandable
  if (!filter || projectDirs.some(d => d.name.toLowerCase().includes(filterLower))) {
    const filteredProjects = filter ? projectDirs.filter(d => d.name.toLowerCase().includes(filterLower)) : projectDirs;
    filteredProjects.forEach(dir => {
      const expanded = _vaultExpandedProjects.has(dir.name);
      const chevronCls = expanded ? '' : ' collapsed';
      const escapedName = escapeHtml(dir.name).replace(/'/g, "\\'");
      html += `
        <div class="vault-project-folder${chevronCls}" data-project-id="${escapeAttr(dir.name)}">
          <div class="vault-file-item vault-project-item" onclick="vaultToggleProject('${escapedName}')" oncontextmenu="showVaultProjectMenu(event, '${escapedName}')">
            <svg class="vault-folder-chevron w-3 h-3 flex-shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
            <svg class="w-4 h-4 flex-shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>
            <span class="truncate">${escapeHtml(dir.name)}</span>
            <button class="vault-project-add-btn" onclick="event.stopPropagation(); vaultShowProjectNewMenu(event, '${escapedName}')" title="New file">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
            </button>
          </div>
          <div class="vault-project-children">
            ${expanded ? _renderProjectChildren(dir.children || [], dir.name) : ''}
          </div>
        </div>
      `;
    });
  }

  // Render note folders
  Object.keys(folders).sort().forEach(folder => {
    const notes = folders[folder].sort((a, b) => a.title.localeCompare(b.title));
    html += `
      <div class="vault-folder" data-folder="${escapeAttr(folder)}"
           ondragover="vaultDragOver(event)" ondragleave="vaultDragLeave(event)" ondrop="vaultDropOnFolder(event, '${escapeAttr(folder)}')">
        <div class="vault-folder-header" onclick="toggleVaultFolder(this.parentElement)" oncontextmenu="showVaultFolderMenu(event, '${escapeAttr(folder)}')">
          <svg class="vault-folder-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          <svg class="vault-folder-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>
          <span class="vault-folder-name">${escapeHtml(folder)}</span>
        </div>
        <div class="vault-folder-children">
          ${notes.map(n => renderVaultFileItem(n)).join('')}
        </div>
      </div>
    `;
  });

  // Render root notes
  rootNotes.sort((a, b) => a.title.localeCompare(b.title)).forEach(note => {
    html += renderVaultFileItem(note);
  });

  // Render loose files from tree (non-.md files at vault root, not already shown as vault notes)
  const noteFilenames = new Set(_vaultNotes.map(n => (n.title || 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '') + '.md'));
  const looseFiles = _vaultTree.filter(item =>
    item.type === 'file' && !item.name.endsWith('.md')
  );
  if (looseFiles.length) {
    const filteredLoose = filter ? looseFiles.filter(f => f.name.toLowerCase().includes(filterLower)) : looseFiles;
    filteredLoose.forEach(file => {
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
      const [badge, badgeCls] = typeof _fileExtBadge === 'function' ? _fileExtBadge(file.name) : [ext || '?', 'text-dimmer'];
      const escapedName = escapeHtml(file.name).replace(/'/g, "\\'");
      html += `
        <div class="vault-file-item" onclick="vaultOpenLooseFile('${escapedName}')">
          <span class="text-[0.6rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
          <span class="truncate">${escapeHtml(file.name)}</span>
        </div>
      `;
    });
  }

  container.innerHTML = html || '<div class="text-dimmer text-[0.75rem] px-3 py-2">No files yet</div>';

  // Setup root drop zone for moving notes out of folders
  container.ondragover = (e) => { e.preventDefault(); container.classList.add('vault-drop-target'); };
  container.ondragleave = (e) => { if (e.target === container) container.classList.remove('vault-drop-target'); };
  container.ondrop = (e) => {
    e.preventDefault();
    container.classList.remove('vault-drop-target');
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId && !e.target.closest('.vault-folder')) {
      vaultMoveNoteToFolder(noteId, null);
    }
  };
}

function renderVaultFileItem(note) {
  const isActive = _vaultCurrentNote?.id === note.id;
  const icon = note.type === 'marimo'
    ? '<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/></svg>'
    : '<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>';
  return `
    <div class="vault-file-item ${isActive ? 'active' : ''}" data-note-id="${note.id}"
         onclick="openVaultNote('${note.id}')"
         oncontextmenu="showVaultNoteMenu(event, '${note.id}')"
         draggable="true"
         ondragstart="vaultDragStart(event, '${note.id}')"
         ondragend="vaultDragEnd(event)">
      ${icon}
      <span class="truncate">${escapeHtml(note.title || 'Untitled')}</span>
    </div>
  `;
}

function toggleVaultFolder(el) {
  el.classList.toggle('collapsed');
}

// Drag and drop handlers
let _vaultDraggedNoteId = null;

function vaultDragStart(e, noteId) {
  _vaultDraggedNoteId = noteId;
  e.dataTransfer.setData('text/plain', noteId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('vault-dragging');
}

function vaultDragEnd(e) {
  _vaultDraggedNoteId = null;
  e.target.classList.remove('vault-dragging');
  document.querySelectorAll('.vault-drop-target').forEach(el => el.classList.remove('vault-drop-target'));
}

function vaultDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const folder = e.target.closest('.vault-folder');
  if (folder) folder.classList.add('vault-drop-target');
}

function vaultDragLeave(e) {
  const folder = e.target.closest('.vault-folder');
  if (folder && !folder.contains(e.relatedTarget)) {
    folder.classList.remove('vault-drop-target');
  }
}

function vaultDropOnFolder(e, folderName) {
  e.preventDefault();
  e.stopPropagation();
  const folder = e.target.closest('.vault-folder');
  if (folder) folder.classList.remove('vault-drop-target');

  const noteId = e.dataTransfer.getData('text/plain');
  if (noteId) {
    vaultMoveNoteToFolder(noteId, folderName);
  }
}

async function vaultMoveNoteToFolder(noteId, folderName) {
  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  // Don't move if already in the target folder
  if (note.folder === folderName) return;

  try {
    const res = await fetch(`/api/vault/notes/${noteId}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderName })
    });

    if (res.ok) {
      note.folder = folderName;
      renderVaultFileTree();
    }
  } catch (e) {
    console.error('Failed to move note', e);
  }
}

// Context menu for folders
function showVaultFolderMenu(e, folderName) {
  e.preventDefault();
  e.stopPropagation();
  hideVaultContextMenu();
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _aetherTrackMode = false; }

  const penIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>';
  const trashIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>';

  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, contextMenu: {
    items: [
      { label: 'Rename', icon: penIcon, fn: () => vaultRenameFolder(folderName) },
      { sep: true },
      { label: 'Delete', icon: trashIcon, fn: () => vaultDeleteFolder(folderName), danger: true },
    ]
  } });
}

// Context menu for notes
function showVaultNoteMenu(e, noteId) {
  e.preventDefault();
  e.stopPropagation();
  hideVaultContextMenu();

  // If aether panel is already open, attach note as context instead of showing menu
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing && typeof _addNoteContextToPanel === 'function') {
    const note = _vaultNotes.find(n => n.id === noteId);
    if (note) _addNoteContextToPanel(existing, note);
    return;
  }
  if (existing) { existing.remove(); _aetherTrackMode = false; }

  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  const penIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>';
  const folderIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>';
  const trashIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>';

  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, contextMenu: {
    items: [
      { label: 'Rename', icon: penIcon, fn: () => vaultRenameNotePrompt(noteId) },
      { label: 'Move to folder', icon: folderIcon, fn: () => vaultMoveNote(noteId) },
      { sep: true },
      { label: 'Delete', icon: trashIcon, fn: () => vaultDeleteNote(noteId), danger: true },
    ]
  } });
}

function hideVaultContextMenu() {
  document.querySelectorAll('.vault-context-menu').forEach(m => m.remove());
}

// Rename note via prompt
async function vaultRenameNotePrompt(noteId) {
  hideVaultContextMenu();
  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  const newName = prompt('Rename note:', note.title);
  if (!newName || newName.trim() === note.title) return;

  try {
    const res = await fetch(`/api/vault/notes/${noteId}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newName.trim() })
    });

    if (res.ok) {
      note.title = newName.trim();
      renderVaultFileTree();
      // Update title input if this note is currently open
      if (_vaultCurrentNote?.id === noteId) {
        const titleInput = document.getElementById('vault-title-input');
        if (titleInput) titleInput.value = newName.trim();
      }
    }
  } catch (e) {
    console.error('Failed to rename note', e);
  }
}

// Rename folder
async function vaultRenameFolder(oldName) {
  hideVaultContextMenu();
  const newName = prompt('Rename folder:', oldName);
  if (!newName || newName.trim() === oldName) return;

  // Update all notes in this folder
  const notesInFolder = _vaultNotes.filter(n => n.folder === oldName);
  for (const note of notesInFolder) {
    try {
      await fetch(`/api/vault/notes/${note.id}`, {
        method: 'PUT',
        headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: newName.trim() })
      });
      note.folder = newName.trim();
    } catch (e) {
      console.error('Failed to rename folder', e);
    }
  }
  renderVaultFileTree();
}

// Delete folder (moves notes to root or deletes them)
async function vaultDeleteFolder(folderName) {
  hideVaultContextMenu();
  const notesInFolder = _vaultNotes.filter(n => n.folder === folderName);
  const choice = confirm(`Delete folder "${folderName}"?\n\nThis will move ${notesInFolder.length} note(s) to the root level.\n\nClick OK to move notes, or Cancel to abort.`);

  if (!choice) return;

  // Move notes to root (remove folder)
  for (const note of notesInFolder) {
    try {
      await fetch(`/api/vault/notes/${note.id}`, {
        method: 'PUT',
        headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: null })
      });
      note.folder = null;
    } catch (e) {
      console.error('Failed to move note', e);
    }
  }
  renderVaultFileTree();
}

// Move note to folder
async function vaultMoveNote(noteId) {
  hideVaultContextMenu();
  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  // Get existing folders
  const folders = [...new Set(_vaultNotes.filter(n => n.folder).map(n => n.folder))].sort();
  let folderName = prompt(
    'Move to folder:\n\n' +
    (folders.length ? 'Existing: ' + folders.join(', ') + '\n\n' : '') +
    'Enter folder name (or leave empty for root):',
    note.folder || ''
  );

  if (folderName === null) return; // Cancelled
  folderName = folderName.trim() || null;

  try {
    await fetch(`/api/vault/notes/${note.id}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: folderName })
    });
    note.folder = folderName;
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to move note', e);
  }
}

// Open a note
async function openVaultNote(noteId) {
  // If aether panel is open, attach note as context instead of opening it
  const aetherPanel = document.getElementById('doc-chat-ask-float');
  if (aetherPanel && typeof _addNoteContextToPanel === 'function') {
    const note = _vaultNotes.find(n => n.id === noteId);
    if (note) _addNoteContextToPanel(aetherPanel, note);
    return;
  }

  // If in file editor mode, close it first
  if (_vaultEditorMode === 'file') {
    if (typeof _cleanupDrawEditor === 'function') try { _cleanupDrawEditor(); } catch (e) {}
    if (typeof _cleanupSlidesEditor === 'function') try { _cleanupSlidesEditor(); } catch (e) {}
    if (typeof closeFileEditor === 'function') closeFileEditor();
    _vaultEditorMode = 'note';
    const pane = document.getElementById('vault-file-editor-pane');
    if (pane) { pane.style.display = 'none'; pane.style.position = ''; pane.style.inset = ''; pane.style.zIndex = ''; }
    const header = document.querySelector('.vault-editor-header');
    if (header) header.style.display = '';
    document.querySelectorAll('.vault-project-file-item.active').forEach(el => el.classList.remove('active'));
  }

  // Save current note first and stop marimo if active
  if (_vaultCurrentNote) {
    await _stopCurrentMarimo();
    await saveCurrentNote();
  }

  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  _vaultCurrentNote = note;
  localStorage.setItem('vaultLastNote', noteId);

  // Update UI
  document.getElementById('vault-note-title').value = note.title || '';

  // Update file tree selection
  document.querySelectorAll('.vault-file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.noteId === noteId);
  });

  const editorContainer = document.getElementById('vault-editor-container');
  const previewContainer = document.getElementById('vault-preview-container');
  const marimoContainer = document.getElementById('vault-marimo-container');
  const graphContainer = document.getElementById('vault-graph-container');

  // Reset graph view if active
  if (_vaultGraphMode) {
    _vaultGraphMode = false;
    document.getElementById('vault-graph-btn')?.classList.remove('active');
    if (graphContainer) graphContainer.style.display = 'none';
  }

  if (note.type === 'marimo') {
    // Hide editor/preview, show marimo container
    if (editorContainer) editorContainer.style.display = 'none';
    if (previewContainer) previewContainer.style.display = 'none';
    if (marimoContainer) marimoContainer.style.display = '';

    // Show loading, hide iframe
    const loading = document.getElementById('vault-marimo-loading');
    const iframe = document.getElementById('vault-marimo-iframe');
    if (loading) loading.style.display = '';
    if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }

    // Start marimo server
    try {
      const res = await fetch('/api/vault/marimo/start', {
        method: 'POST',
        headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId })
      });
      if (res.ok) {
        const data = await res.json();
        _vaultMarimoActive = true;
        const marimoUrl = `http://localhost:${data.port}`;
        // Poll until marimo is ready
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const check = await fetch(marimoUrl, { mode: 'no-cors' });
            clearInterval(poll);
            if (loading) loading.style.display = 'none';
            if (iframe) {
              iframe.src = marimoUrl;
              iframe.style.display = '';
            }
          } catch (e) {
            if (attempts > 30) { // ~15 seconds
              clearInterval(poll);
              if (loading) loading.innerHTML = '<div class="text-dimmer text-sm">Failed to start marimo. Is it installed?</div>';
            }
          }
        }, 500);
      } else {
        const err = await res.json();
        if (loading) loading.innerHTML = `<div class="text-dimmer text-sm">${escapeHtml(err.error || 'Failed to start marimo')}</div>`;
      }
    } catch (e) {
      console.error('Failed to start marimo', e);
      const loading = document.getElementById('vault-marimo-loading');
      if (loading) loading.innerHTML = '<div class="text-dimmer text-sm">Failed to start marimo server</div>';
    }
  } else {
    // Regular note — hide marimo, show editor/preview
    if (marimoContainer) marimoContainer.style.display = 'none';
    document.getElementById('vault-editor').value = note.content || '';

    // If note is empty or newly created, switch to edit mode to show placeholder
    const isEmpty = !note.content || !note.content.trim();
    const isNew = note._isNew;
    if (isNew) delete note._isNew; // Clear the flag after use
    if ((isEmpty || isNew) && _vaultPreviewMode) {
      _vaultPreviewMode = false;
      const btn = document.getElementById('vault-preview-btn');
      if (btn) btn.classList.remove('active');
      if (editorContainer) editorContainer.style.display = '';
      if (previewContainer) previewContainer.style.display = 'none';
      document.getElementById('vault-editor')?.focus();
    } else {
      if (editorContainer) editorContainer.style.display = _vaultPreviewMode ? 'none' : '';
      if (previewContainer) previewContainer.style.display = _vaultPreviewMode ? '' : 'none';
    }

    updateVaultPreview();
  }

  updateVaultBacklinks();
  updateVaultTags();
  updateVaultPublishButton();
}

// Clear editor (no note selected)
function clearVaultEditor() {
  _vaultCurrentNote = null;
  document.getElementById('vault-note-title').value = '';
  document.getElementById('vault-editor').value = '';
  const blList = document.getElementById('vault-backlinks-list');
  if (blList) blList.innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>';
  const tgList = document.getElementById('vault-tags-list');
  if (tgList) tgList.innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No tags</div>';
  const pubSection = document.getElementById('vault-published-section');
  if (pubSection) pubSection.style.display = 'none';
  // Reset publish button
  const pubBtn = document.getElementById('vault-publish-btn');
  if (pubBtn) {
    pubBtn.classList.remove('active');
    pubBtn.title = 'Publish as blog';
  }
}

// Save current note
async function saveCurrentNote() {
  if (!_vaultCurrentNote) return;
  if (_vaultCurrentNote.type === 'marimo') return; // Marimo saves via its own editor

  const title = document.getElementById('vault-note-title').value.trim() || 'Untitled';
  const content = document.getElementById('vault-editor').value;

  _vaultCurrentNote.title = title;
  _vaultCurrentNote.content = content;

  try {
    await fetch(`/api/vault/notes/${_vaultCurrentNote.id}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    });
    renderVaultFileTree(document.getElementById('vault-search-input')?.value || '');
    // Embed note for semantic search (fire-and-forget)
    fetch('/api/embed-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, link: 'vault://' + _vaultCurrentNote.id, source: 'vault', description: content.slice(0, 500), type: 'note' })
    }).catch(() => {});
  } catch (e) {
    console.error('Failed to save note', e);
  }
}

// Create new note
async function vaultNewNote(folder = null) {
  const title = 'Untitled';

  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: '', folder })
    });

    if (res.ok) {
      const note = await res.json();
      note._isNew = true; // Mark as newly created
      _vaultNotes.push(note);
      renderVaultFileTree();
      openVaultNote(note.id);
    }
  } catch (e) {
    console.error('Failed to create note', e);
  }
}

// New note dropdown toggle
function vaultToggleNewDropdown() {
  const dd = document.getElementById('vault-new-dropdown');
  if (!dd) return;
  const show = dd.style.display === 'none';
  dd.style.display = show ? '' : 'none';
  if (show) {
    // Close on outside click
    const close = (e) => {
      if (!e.target.closest('.vault-new-dropdown-wrapper')) {
        dd.style.display = 'none';
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }
}

function vaultHideNewDropdown() {
  const dd = document.getElementById('vault-new-dropdown');
  if (dd) dd.style.display = 'none';
}

// Create a new marimo notebook note
async function vaultNewMarimoNote(folder = null) {
  const title = 'Untitled notebook';
  const content = `import marimo

app = marimo.App()

@app.cell
def _():
    import marimo as mo
    mo.md("# Hello marimo")
    return (mo,)

if __name__ == "__main__":
    app.run()
`;

  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, folder, type: 'marimo' })
    });

    if (res.ok) {
      const note = await res.json();
      note._isNew = true;
      _vaultNotes.push(note);
      renderVaultFileTree();
      openVaultNote(note.id);
    }
  } catch (e) {
    console.error('Failed to create marimo note', e);
  }
}

// Create a new project folder in the vault
async function vaultNewProject() {
  const adjectives = ['red','blue','green','swift','bold','calm','dark','bright','wild','cold','warm','sharp','soft','deep','fast'];
  const nouns = ['fox','oak','river','stone','moon','sun','hawk','wolf','pine','star','wave','flame','cloud','peak','reef'];
  const adj = adjectives[Math.floor(Math.random()*adjectives.length)];
  const noun = nouns[Math.floor(Math.random()*nouns.length)];
  const num = Math.floor(Math.random()*900)+100;
  const title = `${adj}-${noun}-${num}`;
  try {
    const resp = await fetch('/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ title, desc: '', created: Date.now() })
    });
    if (resp.ok) {
      const exp = await resp.json();
      await loadVaultTree();
      _vaultExpandedProjects.add(exp.id);
      renderVaultFileTree();
    }
  } catch (e) {
    console.error('Failed to create project', e);
  }
}

// Open a loose file from the vault root in-place
function vaultOpenLooseFile(fname) {
  vaultOpenProjectFile('_root', fname);
}

// Create a loose file in the vault root (opens in-place)
async function vaultCreateFile(ext) {
  vaultCreateProjectFile('_root', ext);
}

// Create a file in a project folder (or vault root for _root)
async function vaultCreateProjectFile(projectId, ext) {
  const base = ext === '.ipynb' ? 'notebook' : ext === '.py' ? 'script' : ext === '.tex' ? 'paper' : ext === '.mermaid' ? 'diagram' : ext === '.draw' ? 'drawing' : ext === '.slides' ? 'presentation' : 'file';
  let name = `${base}${ext}`;
  // Check existing files to find unique name
  let existingNames = new Set();
  if (projectId === '_root') {
    existingNames = new Set((_vaultTree || []).filter(f => f.type === 'file').map(f => f.name));
  } else {
    const dir = (_vaultTree || []).find(d => d.type === 'dir' && d.name === projectId);
    if (dir && dir.children) existingNames = new Set(dir.children.filter(f => f.type === 'file').map(f => f.name));
  }
  let i = 2;
  const sep = ext === '.py' ? '_' : '-';
  while (existingNames.has(name)) { name = `${base}${sep}${i}${ext}`; i++; }
  try {
    const resp = await fetch(`/api/experiments/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (resp.ok) {
      await loadVaultTree();
      renderVaultFileTree();
      vaultOpenProjectFile(projectId, name);
    }
  } catch (e) {
    console.error('Failed to create file', e);
  }
}

// ── Project file-editor mode (opens experiment editors in-place within vault) ──

// Open a project file in-place in the vault view
async function vaultOpenProjectFile(projectId, filePath) {
  // If currently editing a note, save it first
  if (_vaultEditorMode === 'note' && _vaultCurrentNote) {
    await _stopCurrentMarimo();
    await saveCurrentNote();
  }

  _vaultEditorMode = 'file';

  // Hide vault-specific containers
  const containers = ['vault-editor-container', 'vault-preview-container', 'vault-graph-container', 'vault-marimo-container'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Hide vault editor header (note-specific buttons don't apply to files)
  const header = document.querySelector('.vault-editor-header');
  if (header) header.style.display = 'none';

  // Show the file editor pane — use absolute positioning for definite dimensions
  const pane = document.getElementById('vault-file-editor-pane');
  if (pane) {
    pane.style.display = 'flex';
    pane.style.flexDirection = 'column';
    pane.style.position = 'absolute';
    pane.style.inset = '0';
    pane.style.overflow = 'hidden';
    pane.style.zIndex = '1';
  }

  // Set experiment context and open file
  currentExpId = projectId;
  if (typeof openFile === 'function') openFile(filePath);

  // Highlight active file in tree
  document.querySelectorAll('.vault-project-file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.projectId === projectId && el.dataset.filePath === filePath);
  });
}

// Close file editor, return to vault note mode
function vaultCloseFile() {
  if (_vaultEditorMode !== 'file') return;

  // Cleanup draw/slides editors if active
  if (typeof _cleanupDrawEditor === 'function') try { _cleanupDrawEditor(); } catch (e) {}
  if (typeof _cleanupSlidesEditor === 'function') try { _cleanupSlidesEditor(); } catch (e) {}

  // Close the experiment file editor
  if (typeof closeFileEditor === 'function') closeFileEditor();

  _vaultEditorMode = 'note';

  // Hide file editor pane and reset positioning
  const pane = document.getElementById('vault-file-editor-pane');
  if (pane) {
    pane.style.display = 'none';
    pane.style.position = '';
    pane.style.inset = '';
    pane.style.zIndex = '';
  }

  // Restore vault editor header
  const header = document.querySelector('.vault-editor-header');
  if (header) header.style.display = '';

  // Remove active highlight from project files
  document.querySelectorAll('.vault-project-file-item.active').forEach(el => el.classList.remove('active'));

  // Re-open current vault note or show empty
  if (_vaultCurrentNote) {
    openVaultNote(_vaultCurrentNote.id);
  } else if (_vaultNotes.length > 0) {
    openVaultNote(_vaultNotes[0].id);
  } else {
    clearVaultEditor();
    const editorContainer = document.getElementById('vault-editor-container');
    if (editorContainer) editorContainer.style.display = '';
  }
}

// Toggle project folder expand/collapse in tree
function vaultToggleProject(projectId) {
  if (_vaultExpandedProjects.has(projectId)) {
    _vaultExpandedProjects.delete(projectId);
  } else {
    _vaultExpandedProjects.add(projectId);
  }
  renderVaultFileTree(document.getElementById('vault-search-input')?.value || '');
}

// Expand a specific project in the tree (e.g. from route)
function vaultExpandProject(projectId) {
  _vaultExpandedProjects.add(projectId);
  renderVaultFileTree(document.getElementById('vault-search-input')?.value || '');
}

// Render children of a project folder
function _renderProjectChildren(children, projectId) {
  if (!children || !children.length) {
    return '<div class="text-dimmer text-[0.6rem] px-6 py-1">Empty project</div>';
  }
  let html = '';
  // Directories first, then files
  const dirs = children.filter(c => c.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = children.filter(c => c.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

  dirs.forEach(dir => {
    html += `
      <div class="vault-project-subfolder">
        <div class="vault-file-item vault-project-subdir-item" style="padding-left:28px;">
          <svg class="w-3.5 h-3.5 flex-shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>
          <span class="truncate text-muted">${escapeHtml(dir.name)}</span>
        </div>
        ${_renderProjectChildrenDeep(dir.children || [], projectId, dir.name, 2)}
      </div>
    `;
  });

  files.forEach(file => {
    const [badge, badgeCls] = typeof _fileExtBadge === 'function' ? _fileExtBadge(file.name) : ['?', 'text-dimmer'];
    const escapedProject = escapeHtml(projectId).replace(/'/g, "\\'");
    const escapedFile = escapeHtml(file.name).replace(/'/g, "\\'");
    const isActive = _vaultEditorMode === 'file' && currentExpId === projectId && currentFile === file.name;
    html += `
      <div class="vault-file-item vault-project-file-item${isActive ? ' active' : ''}" style="padding-left:28px;"
           data-project-id="${escapeAttr(projectId)}" data-file-path="${escapeAttr(file.name)}"
           onclick="vaultOpenProjectFile('${escapedProject}', '${escapedFile}')"
           oncontextmenu="showVaultProjectFileMenu(event, '${escapedProject}', '${escapedFile}')">
        <span class="text-[0.55rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
        <span class="truncate">${escapeHtml(file.name)}</span>
      </div>
    `;
  });

  return html;
}

// Recursive helper for subdirectories within a project
function _renderProjectChildrenDeep(children, projectId, parentPath, depth) {
  if (!children || !children.length) return '';
  let html = '';
  const pad = 16 + depth * 12;
  const dirs = children.filter(c => c.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = children.filter(c => c.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

  dirs.forEach(dir => {
    const fullPath = parentPath + '/' + dir.name;
    html += `
      <div class="vault-file-item vault-project-subdir-item" style="padding-left:${pad}px;">
        <svg class="w-3.5 h-3.5 flex-shrink-0 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>
        <span class="truncate text-muted">${escapeHtml(dir.name)}</span>
      </div>
      ${_renderProjectChildrenDeep(dir.children || [], projectId, fullPath, depth + 1)}
    `;
  });

  files.forEach(file => {
    const fullPath = parentPath + '/' + file.name;
    const [badge, badgeCls] = typeof _fileExtBadge === 'function' ? _fileExtBadge(file.name) : ['?', 'text-dimmer'];
    const escapedProject = escapeHtml(projectId).replace(/'/g, "\\'");
    const escapedFile = escapeHtml(fullPath).replace(/'/g, "\\'");
    const isActive = _vaultEditorMode === 'file' && currentExpId === projectId && currentFile === fullPath;
    html += `
      <div class="vault-file-item vault-project-file-item${isActive ? ' active' : ''}" style="padding-left:${pad}px;"
           data-project-id="${escapeAttr(projectId)}" data-file-path="${escapeAttr(fullPath)}"
           onclick="vaultOpenProjectFile('${escapedProject}', '${escapedFile}')"
           oncontextmenu="showVaultProjectFileMenu(event, '${escapedProject}', '${escapedFile}')">
        <span class="text-[0.55rem] px-1 py-0.5 rounded shrink-0 ${badgeCls}">${badge}</span>
        <span class="truncate">${escapeHtml(file.name)}</span>
      </div>
    `;
  });

  return html;
}

// Context menu for project folder header
function showVaultProjectMenu(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _aetherTrackMode = false; }

  const penIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>';
  const trashIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>';

  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, contextMenu: {
    items: [
      { label: 'Rename', icon: penIcon, fn: () => vaultRenameProject(projectId) },
      { sep: true },
      { label: 'Delete project', icon: trashIcon, fn: () => vaultDeleteProject(projectId), danger: true },
    ]
  } });
}

// Context menu for a file inside a project
function showVaultProjectFileMenu(e, projectId, filePath) {
  e.preventDefault();
  e.stopPropagation();
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _aetherTrackMode = false; }

  const penIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>';
  const copyIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"/></svg>';
  const trashIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>';

  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, contextMenu: {
    items: [
      { label: 'Rename', icon: penIcon, fn: () => vaultRenameProjectFile(projectId, filePath) },
      { label: 'Duplicate', icon: copyIcon, fn: () => vaultDuplicateProjectFile(projectId, filePath) },
      { sep: true },
      { label: 'Delete', icon: trashIcon, fn: () => vaultDeleteProjectFile(projectId, filePath), danger: true },
    ]
  } });
}

// Show "new file" sub-menu on project folder +
function vaultShowProjectNewMenu(e, projectId) {
  e.preventDefault();
  e.stopPropagation();
  const existing = document.getElementById('doc-chat-ask-float');
  if (existing) { existing.remove(); _aetherTrackMode = false; }

  const codeIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/></svg>';
  const docIcon = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>';

  _showPanel({ anchor: { x: e.clientX, y: e.clientY }, contextMenu: {
    items: [
      { label: 'Python', icon: codeIcon, fn: () => vaultCreateProjectFile(projectId, '.py') },
      { label: 'Notebook', icon: codeIcon, fn: () => vaultCreateProjectFile(projectId, '.ipynb') },
      { label: 'LaTeX', icon: docIcon, fn: () => vaultCreateProjectFile(projectId, '.tex') },
      { label: 'Drawing', icon: docIcon, fn: () => vaultCreateProjectFile(projectId, '.draw') },
      { label: 'Slides', icon: docIcon, fn: () => vaultCreateProjectFile(projectId, '.slides') },
      { label: 'Diagram', icon: docIcon, fn: () => vaultCreateProjectFile(projectId, '.mermaid') },
      { label: 'Markdown', icon: docIcon, fn: () => vaultCreateProjectFile(projectId, '.md') },
    ]
  } });
}

// File operations on project files
async function vaultDeleteProjectFile(projectId, filePath) {
  if (!confirm(`Delete ${filePath}?`)) return;
  try {
    await fetch(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`, {
      method: 'DELETE', headers: _authHeaders()
    });
    // If this file is currently open, close editor
    if (_vaultEditorMode === 'file' && currentExpId === projectId && currentFile === filePath) {
      vaultCloseFile();
    }
    await loadVaultTree();
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to delete project file', e);
  }
}

async function vaultRenameProjectFile(projectId, filePath) {
  const fileName = filePath.includes('/') ? filePath.split('/').pop() : filePath;
  const newName = prompt('Rename file:', fileName);
  if (!newName || newName.trim() === fileName) return;

  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  const newPath = dir + newName.trim();

  try {
    const resp = await fetch(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rename: newPath })
    });
    if (resp.ok) {
      if (_vaultEditorMode === 'file' && currentExpId === projectId && currentFile === filePath) {
        currentFile = newPath;
      }
      await loadVaultTree();
      renderVaultFileTree();
    }
  } catch (e) {
    console.error('Failed to rename project file', e);
  }
}

async function vaultDuplicateProjectFile(projectId, filePath) {
  try {
    const resp = await fetch(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`, { headers: _authHeaders() });
    const data = await resp.json();
    if (data.error) return;

    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    const base = filePath.includes('.') ? filePath.slice(0, filePath.lastIndexOf('.')) : filePath;
    const newName = base + '_copy' + ext;

    await fetch(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(newName)}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data.content })
    });
    await loadVaultTree();
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to duplicate project file', e);
  }
}

async function vaultRenameProject(projectId) {
  const newName = prompt('Rename project:', projectId);
  if (!newName || newName.trim() === projectId) return;
  try {
    const resp = await fetch(`/api/experiments/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newName.trim() })
    });
    if (resp.ok) {
      // Update expanded set
      if (_vaultExpandedProjects.has(projectId)) {
        _vaultExpandedProjects.delete(projectId);
        _vaultExpandedProjects.add(newName.trim());
      }
      await loadVaultTree();
      renderVaultFileTree();
    }
  } catch (e) {
    console.error('Failed to rename project', e);
  }
}

async function vaultDeleteProject(projectId) {
  if (!confirm(`Delete project "${projectId}" and all its files?`)) return;
  try {
    await fetch(`/api/experiments/${encodeURIComponent(projectId)}`, {
      method: 'DELETE', headers: _authHeaders()
    });
    _vaultExpandedProjects.delete(projectId);
    if (_vaultEditorMode === 'file' && currentExpId === projectId) {
      vaultCloseFile();
    }
    await loadVaultTree();
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to delete project', e);
  }
}

// Escape key handler for vault file editor
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _vaultEditorMode === 'file') {
    // Don't close if an input, textarea, or CodeMirror is focused
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.closest('.CodeMirror'))) return;
    // Only if vault view is visible
    const vaultView = document.getElementById('vault-view');
    if (vaultView && vaultView.style.display !== 'none') {
      vaultCloseFile();
    }
  }
});

// Stop current marimo server if active
async function _stopCurrentMarimo() {
  if (!_vaultMarimoActive || !_vaultCurrentNote) return;
  try {
    await fetch('/api/vault/marimo/stop', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: _vaultCurrentNote.id })
    });
  } catch (e) {
    console.error('Failed to stop marimo', e);
  }
  _vaultMarimoActive = false;
  const container = document.getElementById('vault-marimo-container');
  if (container) container.style.display = 'none';
  const iframe = document.getElementById('vault-marimo-iframe');
  if (iframe) iframe.src = '';
}

// Delete current note from toolbar
function vaultDeleteCurrentNote() {
  if (!_vaultCurrentNote) return;
  vaultDeleteNote(_vaultCurrentNote.id);
}

// Show new folder modal
function vaultNewFolder() {
  const modal = document.getElementById('vault-folder-modal');
  const input = document.getElementById('vault-folder-name-input');
  if (modal && input) {
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    // Add keyboard handlers
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmVaultNewFolder();
      } else if (e.key === 'Escape') {
        hideVaultFolderModal();
      }
    };

    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) hideVaultFolderModal();
    };
  }
}

// Hide new folder modal
function hideVaultFolderModal() {
  const modal = document.getElementById('vault-folder-modal');
  if (modal) modal.style.display = 'none';
}

// Confirm folder creation from modal
async function confirmVaultNewFolder() {
  const input = document.getElementById('vault-folder-name-input');
  const name = input?.value?.trim();
  if (!name) return;

  hideVaultFolderModal();

  // Create a new note in the folder
  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', content: '', folder: name })
    });

    if (res.ok) {
      const note = await res.json();
      note._isNew = true;
      _vaultNotes.push(note);
      renderVaultFileTree();
      openVaultNote(note.id);
    }
  } catch (e) {
    console.error('Failed to create folder', e);
  }
}

// Rename current note
async function vaultRenameNote(newTitle) {
  if (!_vaultCurrentNote) return;
  _vaultCurrentNote.title = newTitle;
  clearTimeout(_vaultSaveTimeout);
  _vaultSaveTimeout = setTimeout(saveCurrentNote, 500);
}

// Delete note
async function vaultDeleteNote(noteId) {
  if (!confirm('Delete this note?')) return;

  try {
    await fetch(`/api/vault/notes/${noteId}`, {
      method: 'DELETE',
      headers: _authHeaders()
    });

    _vaultNotes = _vaultNotes.filter(n => n.id !== noteId);
    renderVaultFileTree();

    if (_vaultCurrentNote?.id === noteId) {
      if (_vaultNotes.length > 0) {
        openVaultNote(_vaultNotes[0].id);
      } else {
        clearVaultEditor();
      }
    }
  } catch (e) {
    console.error('Failed to delete note', e);
  }
}

// Filter notes
function vaultFilterNotes(query) {
  renderVaultFileTree(query);
}


// Toggle preview mode
function vaultTogglePreview() {
  _vaultPreviewMode = !_vaultPreviewMode;
  const btn = document.getElementById('vault-preview-btn');
  const editor = document.getElementById('vault-editor-container');
  const preview = document.getElementById('vault-preview-container');

  btn.classList.toggle('active', _vaultPreviewMode);

  if (_vaultGraphMode) return; // Don't change if in graph mode

  editor.style.display = _vaultPreviewMode ? 'none' : '';
  preview.style.display = _vaultPreviewMode ? '' : 'none';

  if (_vaultPreviewMode) {
    updateVaultPreview();
  } else {
    // Focus editor when switching to edit mode
    document.getElementById('vault-editor')?.focus();
  }
}

// Switch to edit mode (called when clicking on preview)
function vaultSwitchToEdit() {
  if (!_vaultPreviewMode || _vaultGraphMode) return;

  _vaultPreviewMode = false;
  const btn = document.getElementById('vault-preview-btn');
  const editorContainer = document.getElementById('vault-editor-container');
  const previewContainer = document.getElementById('vault-preview-container');
  const editor = document.getElementById('vault-editor');

  if (btn) btn.classList.remove('active');
  if (editorContainer) editorContainer.style.display = '';
  if (previewContainer) previewContainer.style.display = 'none';
  if (editor) editor.focus();
}

// Update preview content
function updateVaultPreview() {
  if (!_vaultPreviewMode) return;

  const content = document.getElementById('vault-editor').value;
  const preview = document.getElementById('vault-preview-container');

  let html = '';

  // Show forked from banner if note was forked from a blog
  if (_vaultCurrentNote?.forked_from) {
    const fork = _vaultCurrentNote.forked_from;
    html += `<div class="vault-fork-banner">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"/></svg>
      Forked from <a href="#blog/${encodeURIComponent(fork.author)}/${encodeURIComponent(fork.slug)}" class="vault-fork-link">${escapeHtml(fork.author)}'s "${escapeHtml(fork.title)}"</a>
    </div>`;
  }

  html += renderVaultMarkdown(content);
  preview.innerHTML = html;
}

// Render markdown with wiki links
function renderVaultMarkdown(content) {
  if (!content) return '';

  // Escape HTML first
  let html = escapeHtml(content);

  // Wiki links [[note]] or [[note|display]]
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, display) => {
    const noteExists = _vaultNotes.some(n => n.title.toLowerCase() === target.toLowerCase());
    const className = noteExists ? 'vault-wiki-link' : 'vault-wiki-link broken';
    return `<a class="${className}" onclick="vaultOpenLink('${escapeAttr(target)}')">${escapeHtml(display || target)}</a>`;
  });

  // Tags #tag
  html = html.replace(/#([a-zA-Z0-9_-]+)/g, '<span class="vault-tag">#$1</span>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');

  // Single newlines to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Open a wiki link
function vaultOpenLink(target) {
  const note = _vaultNotes.find(n => n.title.toLowerCase() === target.toLowerCase());
  if (note) {
    openVaultNote(note.id);
  } else {
    // Create new note with this title
    if (confirm(`Create new note "${target}"?`)) {
      vaultCreateNoteWithTitle(target);
    }
  }
}

async function vaultCreateNoteWithTitle(title) {
  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: '' })
    });

    if (res.ok) {
      const note = await res.json();
      _vaultNotes.push(note);
      renderVaultFileTree();
      openVaultNote(note.id);
    }
  } catch (e) {
    console.error('Failed to create note', e);
  }
}

// Update backlinks panel
function updateVaultBacklinks() {
  const container = document.getElementById('vault-backlinks-list');
  if (!container || !_vaultCurrentNote) return;

  const currentTitle = _vaultCurrentNote.title?.toLowerCase() || '';
  const backlinks = [];

  _vaultNotes.forEach(note => {
    if (note.id === _vaultCurrentNote.id) return;

    // Check for wiki links to current note
    const regex = new RegExp(`\\[\\[${escapeRegex(currentTitle)}(\\|[^\\]]+)?\\]\\]`, 'gi');
    const matches = note.content?.match(regex);

    if (matches) {
      // Find context around the link
      const idx = note.content.toLowerCase().indexOf(`[[${currentTitle}`);
      const start = Math.max(0, idx - 30);
      const end = Math.min(note.content.length, idx + 50);
      const context = (start > 0 ? '...' : '') + note.content.slice(start, end) + (end < note.content.length ? '...' : '');

      backlinks.push({ note, context: context.replace(/\n/g, ' ') });
    }
  });

  if (backlinks.length === 0) {
    container.innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>';
  } else {
    container.innerHTML = backlinks.map(bl => `
      <div class="vault-backlink-item" onclick="openVaultNote('${bl.note.id}')">
        <div class="vault-backlink-title">${escapeHtml(bl.note.title)}</div>
        <div class="vault-backlink-context">${escapeHtml(bl.context)}</div>
      </div>
    `).join('');
  }
}

// Update tags panel
function updateVaultTags() {
  const container = document.getElementById('vault-tags-list');
  if (!container || !_vaultCurrentNote) return;

  const content = _vaultCurrentNote.content || '';
  const tagMatches = content.match(/#([a-zA-Z0-9_-]+)/g) || [];
  const tags = [...new Set(tagMatches)];

  if (tags.length === 0) {
    container.innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No tags</div>';
  } else {
    container.innerHTML = '<div class="px-2">' + tags.map(tag => `
      <span class="vault-tag-item" onclick="vaultFilterByTag('${tag.slice(1)}')">${escapeHtml(tag)}</span>
    `).join('') + '</div>';
  }
}

function vaultFilterByTag(tag) {
  document.getElementById('vault-search-input').value = '#' + tag;
  vaultFilterNotes('#' + tag);
}

// Toggle graph view
function vaultToggleGraph() {
  _vaultGraphMode = !_vaultGraphMode;

  const btn = document.getElementById('vault-graph-btn');
  const editor = document.getElementById('vault-editor-container');
  const preview = document.getElementById('vault-preview-container');
  const graph = document.getElementById('vault-graph-container');

  btn.classList.toggle('active', _vaultGraphMode);

  if (_vaultGraphMode) {
    editor.style.display = 'none';
    preview.style.display = 'none';
    graph.style.display = '';
    renderVaultGraph();
  } else {
    graph.style.display = 'none';
    editor.style.display = _vaultPreviewMode ? 'none' : '';
    preview.style.display = _vaultPreviewMode ? '' : 'none';
  }
}

// Render graph view
function renderVaultGraph() {
  const container = document.getElementById('vault-graph-container');
  if (!container) return;

  // Build graph data
  const nodes = _vaultNotes.map(n => ({ id: n.id, title: n.title, current: n.id === _vaultCurrentNote?.id }));
  const links = [];
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.title?.toLowerCase()] = n.id; });

  _vaultNotes.forEach(note => {
    const matches = note.content?.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
    matches.forEach(match => {
      const target = match.match(/\[\[([^\]|]+)/)?.[1]?.toLowerCase();
      if (target && nodeMap[target] && nodeMap[target] !== note.id) {
        links.push({ source: note.id, target: nodeMap[target] });
      }
    });
  });

  // Simple force-directed graph using canvas
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 400;

  container.innerHTML = `<canvas id="vault-graph-canvas" width="${width}" height="${height}"></canvas>`;
  const canvas = document.getElementById('vault-graph-canvas');
  const ctx = canvas.getContext('2d');

  // Initialize positions
  nodes.forEach(n => {
    n.x = Math.random() * width;
    n.y = Math.random() * height;
    n.vx = 0;
    n.vy = 0;
  });

  const nodeById = {};
  nodes.forEach(n => { nodeById[n.id] = n; });

  // Simple force simulation
  function simulate() {
    // Repulsion between nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 500 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Attraction along links
    links.forEach(link => {
      const source = nodeById[link.source];
      const target = nodeById[link.target];
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 100) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    // Center gravity
    nodes.forEach(n => {
      n.vx += (width / 2 - n.x) * 0.001;
      n.vy += (height / 2 - n.y) * 0.001;
    });

    // Update positions
    nodes.forEach(n => {
      n.vx *= 0.9;
      n.vy *= 0.9;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(20, Math.min(width - 20, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    });
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Draw links
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-card') || '#333';
    ctx.lineWidth = 1;
    links.forEach(link => {
      const source = nodeById[link.source];
      const target = nodeById[link.target];
      if (!source || !target) return;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    });

    // Draw nodes
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#b4451a';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#888';

    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.current ? 8 : 5, 0, Math.PI * 2);
      ctx.fillStyle = n.current ? textColor : accent;
      ctx.fill();

      ctx.fillStyle = textColor;
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(n.title || 'Untitled', n.x, n.y + 16);
    });
  }

  // Run simulation
  let frame = 0;
  function tick() {
    simulate();
    draw();
    frame++;
    if (frame < 200 && _vaultGraphMode) {
      requestAnimationFrame(tick);
    }
  }
  tick();

  // Click handler
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const n of nodes) {
      const dist = Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2);
      if (dist < 15) {
        openVaultNote(n.id);
        break;
      }
    }
  };

  // Hover cursor handler
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let overNode = false;
    for (const n of nodes) {
      const dist = Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2);
      if (dist < 15) {
        overNode = true;
        break;
      }
    }
    canvas.style.cursor = overNode ? 'pointer' : 'default';
  };
}

// Helper: escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Blog Publishing ──

// Toggle publish state for current note
async function vaultTogglePublish() {
  if (!_vaultCurrentNote) return;

  const isPublished = _vaultCurrentNote.published;

  if (isPublished) {
    // Unpublish
    if (!confirm('Unpublish this post? The public URL will no longer work.')) return;
  }

  try {
    const res = await fetch(`/api/vault/notes/${_vaultCurrentNote.id}`, {
      method: 'PUT',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !isPublished })
    });

    if (res.ok) {
      const note = await res.json();
      Object.assign(_vaultCurrentNote, note);
      updateVaultPublishButton();

      if (note.published) {
        // Show the public URL
        const username = _authUserInfo?.username;
        if (username) {
          const url = `${location.origin}/#blog/${username}/${note.slug}`;
          vaultShowPublishModal(url);
        }
      }

      // Check for achievement unlock
      if (note.achievement) {
        // Trigger pixel pet celebration
        if (typeof petCelebrate === 'function') petCelebrate();
        // Show achievement toast
        vaultShowAchievementToast(note.achievement);
      }
    }
  } catch (e) {
    console.error('Failed to toggle publish', e);
  }
}

// Update publish button state and sidebar section
function updateVaultPublishButton() {
  const btn = document.getElementById('vault-publish-btn');
  if (btn) {
    const isPublished = _vaultCurrentNote?.published === true;
    if (isPublished) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    btn.title = isPublished ? 'Unpublish' : 'Publish as blog';
  }

  // Update sidebar published section
  const section = document.getElementById('vault-published-section');
  const info = document.getElementById('vault-published-info');
  if (!section || !info) return;

  if (_vaultCurrentNote?.published && _vaultCurrentNote?.slug) {
    const username = _authUserInfo?.username;
    if (username) {
      const url = `#blog/${encodeURIComponent(username)}/${encodeURIComponent(_vaultCurrentNote.slug)}`;
      const pubDate = _vaultCurrentNote.published_at
        ? new Date(_vaultCurrentNote.published_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      section.style.display = '';
      info.innerHTML = `
        <div class="vault-published-date">${pubDate}</div>
        <a href="${url}" class="vault-published-link" onclick="location.hash='${url}';return false;">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
          View published post
        </a>
      `;
    } else {
      section.style.display = 'none';
    }
  } else {
    section.style.display = 'none';
  }
}

// Show modal with public URL
function vaultShowPublishModal(url) {
  const modal = document.createElement('div');
  modal.className = 'vault-publish-modal';
  modal.innerHTML = `
    <div class="vault-publish-modal-content">
      <h3>Published!</h3>
      <p>Your post is now live at:</p>
      <div class="vault-publish-url">
        <input type="text" value="${escapeAttr(url)}" readonly onclick="this.select()">
        <button onclick="navigator.clipboard.writeText('${escapeAttr(url)}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500)">Copy</button>
      </div>
      <div class="vault-publish-actions">
        <button onclick="location.hash='${escapeAttr(url.split('#')[1])}'; this.closest('.vault-publish-modal').remove()">View Post</button>
        <button onclick="this.closest('.vault-publish-modal').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// Show achievement toast notification
function vaultShowAchievementToast(achievement) {
  if (!achievement) return;
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <div class="achievement-toast-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.27 1.772 6.003 6.003 0 01-4.27-1.772"/>
      </svg>
    </div>
    <div class="achievement-toast-content">
      <div class="achievement-toast-title">Achievement Unlocked!</div>
      <div class="achievement-toast-name">${achievement.name || 'Achievement'}</div>
      <div class="achievement-toast-desc">${achievement.description || ''}</div>
    </div>
  `;
  document.body.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));
  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Open blog view (public)
async function openBlogPost(username, slug) {
  hideAllViews();
  const view = await ensureView('blog-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = `blog/${username}/${slug}`;
  setSidebarActive('');

  // Reset current post
  _currentBlogPost = null;

  // Load blog post
  document.getElementById('blog-title').textContent = 'Loading...';
  document.getElementById('blog-content').innerHTML = '';
  document.getElementById('blog-author').textContent = '';
  document.getElementById('blog-date').textContent = '';

  try {
    const res = await fetch(`/api/blog/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`, {
      headers: _authHeaders()
    });
    if (res.ok) {
      const post = await res.json();
      _currentBlogPost = post;
      document.getElementById('blog-title').textContent = post.title;
      document.getElementById('blog-content').innerHTML = renderBlogMarkdown(post.content);
      document.getElementById('blog-author').innerHTML = `
        ${post.picture ? `<img src="${escapeAttr(post.picture)}" class="blog-author-pic">` : ''}
        <a href="#profile/${encodeURIComponent(post.author)}">${escapeHtml(post.author)}</a>
      `;
      if (post.published_at) {
        document.getElementById('blog-date').textContent = new Date(post.published_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
      updateBlogBookmarkButton();
      updateBlogVoteButtons();
      loadBlogComments();
      // Show unpost button if user is the author
      const unpostBtn = document.getElementById('blog-unpost-btn');
      const isAuthor = _authUserInfo && _authUserInfo.username === post.author;
      if (unpostBtn) unpostBtn.style.display = isAuthor ? '' : 'none';
    } else {
      document.getElementById('blog-title').textContent = 'Post not found';
      document.getElementById('blog-content').innerHTML = '<p>This post may have been unpublished or deleted.</p>';
      const unpostBtn = document.getElementById('blog-unpost-btn');
      if (unpostBtn) unpostBtn.style.display = 'none';
    }
  } catch (e) {
    document.getElementById('blog-title').textContent = 'Error';
    document.getElementById('blog-content').innerHTML = '<p>Failed to load post.</p>';
  }
}

// Current blog post data (for actions)
let _currentBlogPost = null;

// Toggle bookmark for current blog post
function toggleBlogBookmark() {
  if (!_currentBlogPost) return;

  const url = window.location.hash.slice(1); // e.g., "blog/username/slug"
  const fullUrl = window.location.origin + '/#' + url;

  // Use the existing savedPosts system
  let savedPosts = {};
  try {
    savedPosts = JSON.parse(localStorage.getItem('savedPosts') || '{}');
  } catch (e) {}

  const btn = document.getElementById('blog-bookmark-btn');

  if (savedPosts[fullUrl]) {
    delete savedPosts[fullUrl];
    btn?.classList.remove('active');
  } else {
    savedPosts[fullUrl] = {
      paper: {
        title: _currentBlogPost.title,
        link: fullUrl,
        source: 'blog',
        authors: _currentBlogPost.author
      },
      savedAt: Date.now(),
      read: false
    };
    btn?.classList.add('active');
  }

  localStorage.setItem('savedPosts', JSON.stringify(savedPosts));
  if (typeof syncToServer === 'function') syncToServer();
}

// Update bookmark button state
function updateBlogBookmarkButton() {
  if (!_currentBlogPost) return;

  const url = window.location.origin + '/#' + window.location.hash.slice(1);
  let savedPosts = {};
  try {
    savedPosts = JSON.parse(localStorage.getItem('savedPosts') || '{}');
  } catch (e) {}

  const btn = document.getElementById('blog-bookmark-btn');
  btn?.classList.toggle('active', !!savedPosts[url]);
}

// Copy blog post to user's vault (fork)
async function copyBlogToVault() {
  if (!_currentBlogPost) return;

  const btn = document.getElementById('blog-fork-btn');
  if (!btn || btn.classList.contains('forking')) return;

  // Parse current blog URL to get author and slug
  const hash = window.location.hash.slice(1); // "blog/username/slug"
  const parts = hash.split('/');
  const author = parts[1];
  const slug = parts[2];

  // Start animation
  btn.classList.add('forking');
  const forkIcon = btn.querySelector('.blog-fork-icon');
  const checkIcon = btn.querySelector('.blog-fork-check');

  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: _currentBlogPost.title,
        content: _currentBlogPost.content,
        folder: 'Saved',
        forked_from: {
          author: author,
          slug: slug,
          title: _currentBlogPost.title
        }
      })
    });

    if (res.ok) {
      // Show success animation
      if (forkIcon) forkIcon.style.display = 'none';
      if (checkIcon) checkIcon.style.display = '';
      btn.classList.add('forked');
      btn.title = 'Forked!';

      setTimeout(() => {
        if (forkIcon) forkIcon.style.display = '';
        if (checkIcon) checkIcon.style.display = 'none';
        btn.classList.remove('forking', 'forked');
        btn.title = 'Fork to my vault';
      }, 2000);
    } else {
      btn.classList.remove('forking');
    }
  } catch (e) {
    console.error('Failed to fork to vault', e);
    btn.classList.remove('forking');
  }
}

// Update blog vote button states
function updateBlogVoteButtons() {
  if (!_currentBlogPost) return;

  const upBtn = document.getElementById('blog-upvote-btn');
  const downBtn = document.getElementById('blog-downvote-btn');
  const upCount = document.getElementById('blog-upvote-count');
  const downCount = document.getElementById('blog-downvote-count');

  if (upCount) upCount.textContent = _currentBlogPost.upvotes || 0;
  if (downCount) downCount.textContent = _currentBlogPost.downvotes || 0;

  upBtn?.classList.toggle('active', _currentBlogPost.userVote === 1);
  downBtn?.classList.toggle('active', _currentBlogPost.userVote === -1);
}

// Vote on current blog post
async function voteBlog(vote) {
  if (!_currentBlogPost) return;

  // Parse current blog URL to get author and slug
  const hash = window.location.hash.slice(1);
  const parts = hash.split('/');
  const author = parts[1];
  const slug = parts[2];

  // Toggle vote if clicking same button
  if (_currentBlogPost.userVote === vote) {
    vote = 0; // Remove vote
  }

  try {
    const res = await fetch(`/api/blog/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/vote`, {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote })
    });

    if (res.ok) {
      const data = await res.json();
      _currentBlogPost.upvotes = data.upvotes;
      _currentBlogPost.downvotes = data.downvotes;
      _currentBlogPost.userVote = vote;
      updateBlogVoteButtons();
    }
  } catch (e) {
    console.error('Failed to vote', e);
  }
}

// Unpublish the current blog post
async function unpublishBlog() {
  if (!_currentBlogPost) return;
  if (!confirm('Unpublish this post? It will no longer be visible to others.')) return;

  const hash = window.location.hash.slice(1);
  const parts = hash.split('/');
  const author = parts[1];
  const slug = parts[2];

  try {
    const res = await fetch(`/api/blog/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/unpublish`, {
      method: 'POST',
      headers: _authHeaders()
    });

    if (res.ok) {
      // Redirect to vault
      window.location.hash = 'vault';
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to unpublish');
    }
  } catch (e) {
    console.error('Failed to unpublish', e);
  }
}

// Render markdown for blog (similar to vault but without wiki links interaction)
function renderBlogMarkdown(content) {
  if (!content) return '';
  let html = escapeHtml(content);

  // Remove wiki link syntax, just show text
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, display) => escapeHtml(display || target));

  // Tags
  html = html.replace(/#([a-zA-Z0-9_-]+)/g, '<span class="blog-tag">#$1</span>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ── Blog Comments ──

let _blogComments = [];

function _getBlogLink() {
  // Get blog link from current URL hash (e.g., "blog/username/slug")
  return window.location.hash.slice(1); // Remove #
}

async function loadBlogComments() {
  const blogLink = _getBlogLink();
  if (!blogLink) return;

  try {
    const res = await fetch(`/api/comments?paperLink=${encodeURIComponent(blogLink)}`, { headers: _authHeaders() });
    if (res.ok) {
      _blogComments = await res.json();
      renderBlogComments();
    }
  } catch (e) {
    console.error('Failed to load blog comments', e);
  }
}

function renderBlogComments() {
  const list = document.getElementById('blog-comments-list');
  const countEl = document.getElementById('blog-comment-count');
  if (!list) return;

  if (countEl) countEl.textContent = _blogComments.length;

  if (!_blogComments.length) {
    list.innerHTML = '<div class="blog-comments-empty">No comments yet. Be the first to comment!</div>';
    return;
  }

  // Build threaded tree
  const topLevel = _blogComments.filter(c => !c.parentId);
  const byParent = {};
  _blogComments.forEach(c => {
    if (c.parentId) {
      (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
    }
  });
  topLevel.sort((a, b) => a.timestamp - b.timestamp);

  function renderComment(comment, isReply = false) {
    const replies = (byParent[comment.id] || []).sort((a, b) => a.timestamp - b.timestamp);
    const initial = (comment.author || '?')[0].toUpperCase();
    const timeAgo = _blogRelativeTime(comment.timestamp);
    const currentUsername = (_authUserInfo && _authUserInfo.username) || '';
    const isOwn = comment.author === currentUsername;

    let html = `
      <div class="blog-comment-item" data-comment-id="${comment.id}">
        <div class="blog-comment-avatar">${escapeHtml(initial)}</div>
        <div class="blog-comment-body">
          <div class="blog-comment-header">
            <a href="#profile/${encodeURIComponent(comment.author)}" class="blog-comment-author">${escapeHtml(comment.author)}</a>
            <span class="blog-comment-time">${timeAgo}</span>
            ${isOwn ? `<button onclick="deleteBlogComment('${comment.id}')" class="blog-comment-delete" title="Delete">×</button>` : ''}
          </div>
          <div class="blog-comment-text">${escapeHtml(comment.content).replace(/\n/g, '<br>')}</div>
          <div class="blog-comment-actions">
            <button onclick="showBlogReplyForm('${comment.id}')" class="blog-comment-reply-btn">Reply</button>
          </div>
          <div id="blog-reply-form-${comment.id}" class="blog-reply-form">
            <textarea id="blog-reply-textarea-${comment.id}" class="blog-reply-textarea" placeholder="Write a reply..." rows="2"></textarea>
            <div class="blog-reply-actions">
              <button onclick="postBlogReply('${comment.id}')" class="blog-reply-submit">Reply</button>
              <button onclick="hideBlogReplyForm('${comment.id}')" class="blog-reply-cancel">Cancel</button>
            </div>
          </div>
          ${replies.length ? `<div class="blog-comment-replies">${replies.map(r => renderComment(r, true)).join('')}</div>` : ''}
        </div>
      </div>`;
    return html;
  }

  list.innerHTML = topLevel.map(c => renderComment(c)).join('');
}

function _blogRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

async function postBlogComment() {
  const input = document.getElementById('blog-comment-input');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const author = (_authUserInfo && _authUserInfo.username) || 'Anonymous';
  const blogLink = _getBlogLink();

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ paperLink: blogLink, author, content, parentId: null })
    });
    if (res.ok) {
      input.value = '';
      loadBlogComments();
    }
  } catch (e) {
    console.error('Failed to post comment', e);
  }
}

async function postBlogReply(parentId) {
  const textarea = document.getElementById('blog-reply-textarea-' + parentId);
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;

  const author = (_authUserInfo && _authUserInfo.username) || 'Anonymous';
  const blogLink = _getBlogLink();

  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ paperLink: blogLink, author, content, parentId })
    });
    if (res.ok) {
      textarea.value = '';
      hideBlogReplyForm(parentId);
      loadBlogComments();
    }
  } catch (e) {
    console.error('Failed to post reply', e);
  }
}

async function deleteBlogComment(id) {
  try {
    const res = await fetch('/api/comments/' + id, { method: 'DELETE', headers: _authHeaders() });
    if (res.ok) {
      loadBlogComments();
    }
  } catch (e) {
    console.error('Failed to delete comment', e);
  }
}

function showBlogReplyForm(id) {
  const form = document.getElementById('blog-reply-form-' + id);
  if (form) {
    form.classList.add('visible');
    form.querySelector('textarea')?.focus();
  }
}

function hideBlogReplyForm(id) {
  const form = document.getElementById('blog-reply-form-' + id);
  if (form) form.classList.remove('visible');
}

// ── Universal Panel: Vault tabs ──
function renderVaultBacklinksPanel(container) {
  container.innerHTML = `
    <div id="vault-published-section" class="vault-published-section" style="display:none;">
      <div class="vault-backlinks-header">
        <svg class="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>
        <span class="text-[0.75rem] font-medium text-accent">Published</span>
      </div>
      <div id="vault-published-info" class="vault-published-info"></div>
    </div>
    <div class="vault-backlinks-header">
      <svg class="w-4 h-4 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
      <span class="text-[0.75rem] font-medium text-muted">Backlinks</span>
    </div>
    <div id="vault-backlinks-list" class="vault-backlinks-list">
      <div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>
    </div>
  `;
  updateVaultBacklinks();
  updateVaultPublishButton();
}

function renderVaultTagsPanel(container) {
  container.innerHTML = `
    <div class="vault-backlinks-header">
      <svg class="w-4 h-4 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5"/></svg>
      <span class="text-[0.75rem] font-medium text-muted">Tags</span>
    </div>
    <div id="vault-tags-list" class="vault-tags-list">
      <div class="text-dimmer text-[0.75rem] px-3">No tags</div>
    </div>
  `;
  updateVaultTags();
}

registerPanelTabs('vault', {
  tabs: [
    {
      id: 'backlinks',
      label: 'Backlinks',
      icon: '<svg class="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>',
      render: renderVaultBacklinksPanel
    },
    {
      id: 'tags',
      label: 'Tags',
      icon: '<svg class="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5"/></svg>',
      render: renderVaultTagsPanel
    }
  ]
});
