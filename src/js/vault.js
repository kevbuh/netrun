// ── Vault (Obsidian-style notes + projects) ──

if (window.AetherUI) AetherUI.globals();

let _vaultNotes = [];
let _vaultTree = []; // Full recursive file tree from /api/vault/tree
let _vaultCurrentNote = null;
let _vaultPreviewMode = true; // Preview on by default
let _vaultGraphMode = false;
let _vaultSaveTimeout = null;
let _vaultMarimoActive = false; // Whether a marimo server is running for current note
let _vaultEditorMode = 'note'; // 'note' | 'file'
const _vaultExpandedProjects = new Set(); // project IDs currently expanded in tree
let _vaultGitMode = false;
let _vaultGitStatus = {}; // { 'path/file.md': 'M' }
let _vaultTerminal = null; // single terminal instance for right panel
let _vaultPath = null; // cached vault path
let _vaultTerminalMode = false;

// Open vault view
async function openVault() {
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

  // Fetch git status for file tree badges (non-blocking)
  if (typeof _vibeGit === 'function') _vaultFetchGitStatus();

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
    const note = await apiPost('/api/vault/notes', { title: 'Welcome', content: welcomeContent });
    _vaultNotes.push(note);

    // Create Ideas note
    const ideasContent = `# Ideas

A place for your creative thoughts and brainstorming.

## Links
- Back to [[Welcome]]
- See also [[Project Notes]]

#ideas #brainstorm`;
    const note2 = await apiPost('/api/vault/notes', { title: 'Ideas', content: ideasContent });
    _vaultNotes.push(note2);

    // Create Project Notes
    const projectContent = `# Project Notes

Document your projects here.

## Related
- [[Ideas]] for brainstorming
- [[Daily Log]] for progress tracking
- Back to [[Welcome]]

#projects`;
    const note3 = await apiPost('/api/vault/notes', { title: 'Project Notes', content: projectContent });
    _vaultNotes.push(note3);

    // Create Daily Log
    const dailyContent = `# Daily Log

Track your daily progress and thoughts.

## Today

- Started using the vault
- Explored [[Welcome]] tutorial
- Connected notes with [[Ideas]] and [[Project Notes]]

#daily #log`;
    const note4 = await apiPost('/api/vault/notes', { title: 'Daily Log', content: dailyContent });
    _vaultNotes.push(note4);
  } catch (e) {
    console.error('Failed to create welcome notes', e);
  }
}

// Load all notes from server
async function loadVaultNotes() {
  try {
    _vaultNotes = await apiGet('/api/vault/notes');
  } catch (e) {
    console.error('Failed to load vault notes', e);
    _vaultNotes = [];
  }
}

// Load full vault file tree (includes project folders)
async function loadVaultTree() {
  try {
    _vaultTree = await apiGet('/api/vault/tree');
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

  AetherUI.mount(RawHTML(html || '<div class="text-dimmer text-[0.75rem] px-3 py-2">No files yet</div>'), container);

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
      ${_vaultGitBadge(_vaultGitStatus[note.title + '.md'] || _vaultGitStatus[note.id + '.md'] || '')}
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
    await apiPut(`/api/vault/notes/${noteId}`, { folder: folderName });
    note.folder = folderName;
    renderVaultFileTree();
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
    await apiPut(`/api/vault/notes/${noteId}`, { title: newName.trim() });
    note.title = newName.trim();
    renderVaultFileTree();
    // Update title input if this note is currently open
    if (_vaultCurrentNote?.id === noteId) {
      const titleInput = document.getElementById('vault-title-input');
      if (titleInput) titleInput.value = newName.trim();
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
      await apiPut(`/api/vault/notes/${note.id}`, { folder: newName.trim() });
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
      await apiPut(`/api/vault/notes/${note.id}`, { folder: null });
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
    await apiPut(`/api/vault/notes/${note.id}`, { folder: folderName });
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
    if (typeof _cleanupDrawEditor === 'function') try { _cleanupDrawEditor(); } catch (e) { /* fire-and-forget */ }
    if (typeof _cleanupSlidesEditor === 'function') try { _cleanupSlidesEditor(); } catch (e) { /* fire-and-forget */ }
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
  if (typeof _updateNowPlayingContext === 'function') _updateNowPlayingContext();

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

  // Reset git view if active
  if (_vaultGitMode) {
    _vaultGitMode = false;
    document.getElementById('vault-git-btn')?.classList.remove('active');
    const gitC = document.getElementById('vault-git-container');
    if (gitC) gitC.style.display = 'none';
    document.removeEventListener('keydown', _vibeKeyHandler);
  }

  // Reset terminal view if active
  if (_vaultTerminalMode) {
    _vaultTerminalMode = false;
    document.getElementById('vault-terminal-btn')?.classList.remove('active');
    const termC = document.getElementById('vault-terminal-container');
    if (termC) termC.style.display = 'none';
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
      const data = await apiPost('/api/vault/marimo/start', { note_id: noteId });
      _vaultMarimoActive = true;
      const marimoUrl = `http://localhost:${data.port}`;
      // Poll until marimo is ready
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          // raw fetch: external localhost health check with no-cors mode
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
            if (loading) AetherUI.mount(RawHTML('<div class="text-dimmer text-sm">Failed to start marimo. Is it installed?</div>'), loading);
          }
        }
      }, 500);
    } catch (e) {
      console.error('Failed to start marimo', e);
      const loading = document.getElementById('vault-marimo-loading');
      if (loading) AetherUI.mount(RawHTML('<div class="text-dimmer text-sm">Failed to start marimo server</div>'), loading);
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
  if (blList) AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>'), blList);
  const tgList = document.getElementById('vault-tags-list');
  if (tgList) AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem] px-3">No tags</div>'), tgList);
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
    await apiPut(`/api/vault/notes/${_vaultCurrentNote.id}`, { title, content });
    renderVaultFileTree(document.getElementById('vault-search-input')?.value || '');
    // Embed note for semantic search (fire-and-forget)
    apiPost('/api/embed-content', { title, link: 'vault://' + _vaultCurrentNote.id, source: 'vault', description: content.slice(0, 500), type: 'note' })
      .catch((e) => { /* fire-and-forget */ });
  } catch (e) {
    console.error('Failed to save note', e);
  }
}

// Create new note
async function vaultNewNote(folder = null) {
  const title = 'Untitled';

  try {
    const note = await apiPost('/api/vault/notes', { title, content: '', folder });
    note._isNew = true; // Mark as newly created
    _vaultNotes.push(note);
    renderVaultFileTree();
    openVaultNote(note.id);
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
    const note = await apiPost('/api/vault/notes', { title, content, folder, type: 'marimo' });
    note._isNew = true;
    _vaultNotes.push(note);
    renderVaultFileTree();
    openVaultNote(note.id);
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
    const exp = await apiPost('/api/experiments', { title, desc: '', created: Date.now() });
    await loadVaultTree();
    _vaultExpandedProjects.add(exp.id);
    renderVaultFileTree();
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
    await apiPost(`/api/experiments/${encodeURIComponent(projectId)}/files`, { name });
    await loadVaultTree();
    renderVaultFileTree();
    vaultOpenProjectFile(projectId, name);
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
  if (typeof _cleanupDrawEditor === 'function') try { _cleanupDrawEditor(); } catch (e) { /* fire-and-forget */ }
  if (typeof _cleanupSlidesEditor === 'function') try { _cleanupSlidesEditor(); } catch (e) { /* fire-and-forget */ }

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
        ${_vaultGitBadge(_vaultGitStatus[file.name] || '')}
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
        ${_vaultGitBadge(_vaultGitStatus[fullPath] || '')}
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
    await apiDelete(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`);
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
    await apiPut(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`, { rename: newPath });
    if (_vaultEditorMode === 'file' && currentExpId === projectId && currentFile === filePath) {
      currentFile = newPath;
    }
    await loadVaultTree();
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to rename project file', e);
  }
}

async function vaultDuplicateProjectFile(projectId, filePath) {
  try {
    const data = await apiGet(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filePath)}`);
    if (data.error) return;

    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    const base = filePath.includes('.') ? filePath.slice(0, filePath.lastIndexOf('.')) : filePath;
    const newName = base + '_copy' + ext;

    await apiPut(`/api/experiments/${encodeURIComponent(projectId)}/files/${encodeURIComponent(newName)}`, { content: data.content });
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
    await apiPut(`/api/experiments/${encodeURIComponent(projectId)}`, { title: newName.trim() });
    // Update expanded set
    if (_vaultExpandedProjects.has(projectId)) {
      _vaultExpandedProjects.delete(projectId);
      _vaultExpandedProjects.add(newName.trim());
    }
    await loadVaultTree();
    renderVaultFileTree();
  } catch (e) {
    console.error('Failed to rename project', e);
  }
}

async function vaultDeleteProject(projectId) {
  if (!confirm(`Delete project "${projectId}" and all its files?`)) return;
  try {
    await apiDelete(`/api/experiments/${encodeURIComponent(projectId)}`);
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
    await apiPost('/api/vault/marimo/stop', { note_id: _vaultCurrentNote.id });
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
    const note = await apiPost('/api/vault/notes', { title: 'Untitled', content: '', folder: name });
    note._isNew = true;
    _vaultNotes.push(note);
    renderVaultFileTree();
    openVaultNote(note.id);
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
    await apiDelete(`/api/vault/notes/${noteId}`);
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
  AetherUI.mount(RawHTML(html), preview);
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
    const note = await apiPost('/api/vault/notes', { title, content: '' });
    _vaultNotes.push(note);
    renderVaultFileTree();
    openVaultNote(note.id);
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
    AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>'), container);
  } else {
    AetherUI.mount(RawHTML(backlinks.map(bl => `
      <div class="vault-backlink-item" onclick="openVaultNote('${bl.note.id}')">
        <div class="vault-backlink-title">${escapeHtml(bl.note.title)}</div>
        <div class="vault-backlink-context">${escapeHtml(bl.context)}</div>
      </div>
    `).join('')), container);
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
    AetherUI.mount(RawHTML('<div class="text-dimmer text-[0.75rem] px-3">No tags</div>'), container);
  } else {
    AetherUI.mount(RawHTML('<div class="px-2">' + tags.map(tag => `
      <span class="vault-tag-item" onclick="vaultFilterByTag('${tag.slice(1)}')">${escapeHtml(tag)}</span>
    `).join('') + '</div>'), container);
  }
}

function vaultFilterByTag(tag) {
  document.getElementById('vault-search-input').value = '#' + tag;
  vaultFilterNotes('#' + tag);
}

// Toggle graph view
function vaultToggleGraph() {
  // Deactivate git mode if active
  if (_vaultGitMode) {
    _vaultGitMode = false;
    document.getElementById('vault-git-btn')?.classList.remove('active');
    const gitC = document.getElementById('vault-git-container');
    if (gitC) gitC.style.display = 'none';
    document.removeEventListener('keydown', _vibeKeyHandler);
  }
  // Deactivate terminal mode if active
  if (_vaultTerminalMode) {
    _vaultTerminalMode = false;
    document.getElementById('vault-terminal-btn')?.classList.remove('active');
    const termC = document.getElementById('vault-terminal-container');
    if (termC) termC.style.display = 'none';
  }

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

// Toggle git dashboard view
function vaultToggleGit() {
  // Deactivate graph mode if active
  if (_vaultGraphMode) {
    _vaultGraphMode = false;
    document.getElementById('vault-graph-btn')?.classList.remove('active');
    const graphC = document.getElementById('vault-graph-container');
    if (graphC) graphC.style.display = 'none';
  }
  // Deactivate terminal mode if active
  if (_vaultTerminalMode) {
    _vaultTerminalMode = false;
    document.getElementById('vault-terminal-btn')?.classList.remove('active');
    const termC = document.getElementById('vault-terminal-container');
    if (termC) termC.style.display = 'none';
  }

  _vaultGitMode = !_vaultGitMode;

  const btn = document.getElementById('vault-git-btn');
  const editor = document.getElementById('vault-editor-container');
  const preview = document.getElementById('vault-preview-container');
  const gitContainer = document.getElementById('vault-git-container');
  const marimo = document.getElementById('vault-marimo-container');
  const filePane = document.getElementById('vault-file-editor-pane');

  btn.classList.toggle('active', _vaultGitMode);

  if (_vaultGitMode) {
    editor.style.display = 'none';
    preview.style.display = 'none';
    if (marimo) marimo.style.display = 'none';
    if (filePane) filePane.style.display = 'none';
    gitContainer.style.display = 'flex';
    _vibeActivePane = 0;
    _vibeSelectedIdx = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    document.addEventListener('keydown', _vibeKeyHandler);
    _vibeRefresh();
  } else {
    gitContainer.style.display = 'none';
    document.removeEventListener('keydown', _vibeKeyHandler);
    editor.style.display = _vaultPreviewMode ? 'none' : '';
    preview.style.display = _vaultPreviewMode ? '' : 'none';
  }
}

// Toggle terminal mode in vault
function vaultToggleTerminal() {
  // Deactivate graph mode if active
  if (_vaultGraphMode) {
    _vaultGraphMode = false;
    document.getElementById('vault-graph-btn')?.classList.remove('active');
    const graphC = document.getElementById('vault-graph-container');
    if (graphC) graphC.style.display = 'none';
  }
  // Deactivate git mode if active
  if (_vaultGitMode) {
    _vaultGitMode = false;
    document.getElementById('vault-git-btn')?.classList.remove('active');
    const gitC = document.getElementById('vault-git-container');
    if (gitC) gitC.style.display = 'none';
    document.removeEventListener('keydown', _vibeKeyHandler);
  }

  _vaultTerminalMode = !_vaultTerminalMode;

  const btn = document.getElementById('vault-terminal-btn');
  const editor = document.getElementById('vault-editor-container');
  const preview = document.getElementById('vault-preview-container');
  const termContainer = document.getElementById('vault-terminal-container');
  const marimo = document.getElementById('vault-marimo-container');
  const filePane = document.getElementById('vault-file-editor-pane');

  if (btn) btn.classList.toggle('active', _vaultTerminalMode);

  if (_vaultTerminalMode) {
    editor.style.display = 'none';
    preview.style.display = 'none';
    if (marimo) marimo.style.display = 'none';
    if (filePane) filePane.style.display = 'none';
    termContainer.style.display = 'flex';

    // Close bottom panel if open — terminals will be reparented
    if (_bottomTerminalVisible) {
      _bottomTerminalVisible = false;
      const bp = document.getElementById('bottom-terminal-panel');
      if (bp) bp.style.display = 'none';
    }

    _loadTerminalState();

    if (_terminals.length === 0) {
      createTerminal();
    } else {
      _terminals.forEach(t => {
        if (!t.ws || t.ws.readyState !== WebSocket.OPEN) {
          _connectTerminalWs(t);
        }
        setTimeout(() => t.fitAddon && t.fitAddon.fit(), 50);
      });
    }

    _renderTabs();
    _renderLayout();
    _applyTerminalSettingsUI();
  } else {
    termContainer.style.display = 'none';
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

  AetherUI.mount(RawHTML(`<canvas id="vault-graph-canvas" width="${width}" height="${height}"></canvas>`), container);
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
    const note = await apiPut(`/api/vault/notes/${_vaultCurrentNote.id}`, { published: !isPublished });
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
      if (typeof petCelebrate === 'function') petCelebrate();
      showAchievement(note.achievement.name, note.achievement.description);
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
      AetherUI.mount(RawHTML(`
        <div class="vault-published-date">${pubDate}</div>
        <a href="${url}" class="vault-published-link" onclick="location.hash='${url}';return false;">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
          View published post
        </a>
      `), info);
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
  modal.className = 'nr-modal-backdrop';
  AetherUI.mount(RawHTML(`
    <div class="nr-modal" style="max-width:400px">
      <div class="nr-modal-header"><span class="nr-modal-title">Published!</span></div>
      <div class="nr-modal-body">
        <p style="margin-bottom:var(--nr-space-3)">Your post is now live at:</p>
        <div style="display:flex;gap:var(--nr-space-2)">
          <input class="nr-input" type="text" value="${escapeAttr(url)}" readonly onclick="this.select()" style="flex:1">
          <button class="nr-btn nr-btn-primary" onclick="navigator.clipboard.writeText('${escapeAttr(url)}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1500)">Copy</button>
        </div>
      </div>
      <div class="nr-modal-footer">
        <button class="nr-btn nr-btn-secondary" onclick="location.hash='${escapeAttr(url.split('#')[1])}'; this.closest('.nr-modal-backdrop').remove()">View Post</button>
        <button class="nr-btn nr-btn-ghost" onclick="this.closest('.nr-modal-backdrop').remove()">Close</button>
      </div>
    </div>
  `), modal);
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
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
  AetherUI.mount(RawHTML(''), document.getElementById('blog-content'));
  document.getElementById('blog-author').textContent = '';
  document.getElementById('blog-date').textContent = '';

  try {
    const post = await apiGet(`/api/blog/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
    _currentBlogPost = post;
    document.getElementById('blog-title').textContent = post.title;
    AetherUI.mount(RawHTML(renderBlogMarkdown(post.content)), document.getElementById('blog-content'));
    AetherUI.mount(RawHTML(`
      ${post.picture ? `<img src="${escapeAttr(post.picture)}" class="blog-author-pic">` : ''}
      <a href="#profile/${encodeURIComponent(post.author)}">${escapeHtml(post.author)}</a>
    `), document.getElementById('blog-author'));
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
  } catch (e) {
    document.getElementById('blog-title').textContent = 'Post not found';
    AetherUI.mount(RawHTML('<p>This post may have been unpublished or deleted.</p>'), document.getElementById('blog-content'));
    const unpostBtn = document.getElementById('blog-unpost-btn');
    if (unpostBtn) unpostBtn.style.display = 'none';
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
  } catch (e) { /* fire-and-forget */ }

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
  } catch (e) { /* fire-and-forget */ }

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
    await apiPost('/api/vault/notes', {
      title: _currentBlogPost.title,
      content: _currentBlogPost.content,
      folder: 'Saved',
      forked_from: {
        author: author,
        slug: slug,
        title: _currentBlogPost.title
      }
    });

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
    const data = await apiPost(`/api/blog/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/vote`, { vote });
    _currentBlogPost.upvotes = data.upvotes;
    _currentBlogPost.downvotes = data.downvotes;
    _currentBlogPost.userVote = vote;
    updateBlogVoteButtons();
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
    await apiPost(`/api/blog/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/unpublish`, {});
    // Redirect to vault
    window.location.hash = 'vault';
  } catch (e) {
    console.error('Failed to unpublish', e);
    alert(e.message || 'Failed to unpublish');
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
    _blogComments = await apiGet(`/api/comments?paperLink=${encodeURIComponent(blogLink)}`);
    renderBlogComments();
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
    AetherUI.mount(RawHTML('<div class="blog-comments-empty">No comments yet. Be the first to comment!</div>'), list);
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

    const html = `
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

  AetherUI.mount(RawHTML(topLevel.map(c => renderComment(c)).join('')), list);
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
    await apiPost('/api/comments', { paperLink: blogLink, author, content, parentId: null });
    input.value = '';
    loadBlogComments();
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
    await apiPost('/api/comments', { paperLink: blogLink, author, content, parentId });
    textarea.value = '';
    hideBlogReplyForm(parentId);
    loadBlogComments();
  } catch (e) {
    console.error('Failed to post reply', e);
  }
}

async function deleteBlogComment(id) {
  try {
    await apiDelete('/api/comments/' + id);
    loadBlogComments();
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
  AetherUI.mount(RawHTML(`
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
  `), container);
  updateVaultBacklinks();
  updateVaultPublishButton();
}

function renderVaultTagsPanel(container) {
  AetherUI.mount(RawHTML(`
    <div class="vault-backlinks-header">
      <svg class="w-4 h-4 text-dimmer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5"/></svg>
      <span class="text-[0.75rem] font-medium text-muted">Tags</span>
    </div>
    <div id="vault-tags-list" class="vault-tags-list">
      <div class="text-dimmer text-[0.75rem] px-3">No tags</div>
    </div>
  `), container);
  updateVaultTags();
}

// ── Vault Chat (RAG over notes) ──

let _vaultChatMessages = [];
let _vaultChatAbort = null;

function _loadVaultChatMessages() {
  try {
    const raw = localStorage.getItem('vaultChatMessages');
    if (raw) _vaultChatMessages = JSON.parse(raw);
  } catch (e) { _vaultChatMessages = []; }
}

function _saveVaultChatMessages() {
  try {
    const toSave = _vaultChatMessages.filter(m => !m._thinking).map(m => ({
      role: m.role, content: m.content, _sources: m._sources
    }));
    localStorage.setItem('vaultChatMessages', JSON.stringify(toSave));
  } catch (e) { /* fire-and-forget */ }
}

function clearVaultChat() {
  _vaultChatMessages = [];
  _saveVaultChatMessages();
  const container = document.getElementById('vault-chat-panel');
  if (container) renderVaultChatPanel(container);
}

function renderVaultChatPanel(container) {
  _loadVaultChatMessages();
  AetherUI.mount(RawHTML(`
    <div class="doc-chat-messages vault-chat-messages" id="vault-chat-msgs"></div>
    <div style="padding:6px 8px; display:flex; gap:4px; border-top:1px solid var(--border-color);">
      <input class="nr-input vault-chat-input" id="vault-chat-input" type="text" placeholder="Ask about your notes…" style="flex:1; background:var(--nr-bg-surface); color:var(--nr-text-primary); border:1px solid var(--border-color); border-radius:6px; padding:5px 8px; font-size:0.75rem; outline:none;" />
      <button id="vault-chat-send" style="background:var(--nr-accent); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.7rem; cursor:pointer;">Send</button>
      <button id="vault-chat-clear" style="background:transparent; color:var(--nr-text-quaternary); border:1px solid var(--border-color); border-radius:6px; padding:4px 8px; font-size:0.7rem; cursor:pointer;" title="Clear chat">Clear</button>
    </div>
  `), container);
  _renderVaultChatMessages(true);

  const input = document.getElementById('vault-chat-input');
  const sendBtn = document.getElementById('vault-chat-send');
  const clearBtn = document.getElementById('vault-chat-clear');

  sendBtn.addEventListener('click', () => sendVaultChatMessage());
  clearBtn.addEventListener('click', () => clearVaultChat());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendVaultChatMessage(); }
  });
}

function _renderVaultChatMessages(final) {
  const container = document.getElementById('vault-chat-msgs');
  if (!container) return;
  if (_vaultChatMessages.length === 0) {
    AetherUI.mount(RawHTML('<div style="padding:16px; text-align:center; color:var(--nr-text-quaternary); font-size:0.75rem;">Ask a question about your vault notes</div>'), container);
    return;
  }
  AetherUI.mount(RawHTML(_vaultChatMessages.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="doc-msg-user">${escapeHtml(m.content)}</div>`;
    }
    if (m._thinking) {
      return '<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>';
    }
    let sourcesHtml = '';
    if (m._sources && m._sources.length) {
      sourcesHtml = '<div class="vault-chat-sources">' + m._sources.map(s =>
        `<span class="vault-chat-source-chip" data-note-id="${escapeAttr(s.id)}" title="${escapeAttr(s.title)} (${Math.round(s.score * 100)}%)">${escapeHtml(s.title.length > 25 ? s.title.slice(0, 22) + '…' : s.title)}</span>`
      ).join('') + '</div>';
    }
    const isLast = i === _vaultChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content)
      : escapeHtml(m.content);
    return sourcesHtml + `<div class="doc-msg-ai">${content}</div>`;
  }).join('')), container);

  // Attach click handlers for source chips
  container.querySelectorAll('.vault-chat-source-chip[data-note-id]').forEach(el => {
    el.addEventListener('click', () => {
      const noteId = el.getAttribute('data-note-id');
      if (typeof openVaultNote === 'function') openVaultNote(noteId);
    });
  });

  container.scrollTop = container.scrollHeight;
}

async function sendVaultChatMessage() {
  const input = document.getElementById('vault-chat-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  _vaultChatMessages.push({ role: 'user', content: q });
  _vaultChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderVaultChatMessages(false);

  input.disabled = true;
  const sendBtn = document.getElementById('vault-chat-send');
  if (sendBtn) sendBtn.disabled = true;

  _vaultChatAbort = new AbortController();
  const _vcModel = localStorage.getItem('chatModel') || 'default';
  islandUpdate('ai-vault', { type: 'ai', label: _vcModel, detail: 'Vault chat \u00B7 ' + _vcModel });

  try {
    const filteredMsgs = _vaultChatMessages.filter(m => !m._thinking).map(m => ({
      role: m.role, content: m.content
    }));
    const result = await apiPost('/api/vault-chat', { messages: filteredMsgs, query: q });

    let aiText = '';
    const aiIdx = _vaultChatMessages.length - 1;
    _vaultChatMessages[aiIdx]._thinking = false;

    if (result && result._stream) {
      await new Promise((resolve) => {
        const handler = (_ev, sid, evt) => {
          if (sid !== result.sessionId) return;
          if (evt.event === 'sources') {
            try { _vaultChatMessages[aiIdx]._sources = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data; } catch (e) {}
          } else if (evt.event === 'token') {
            aiText += (evt.data || '');
            _vaultChatMessages[aiIdx].content = aiText;
            _renderVaultChatMessages(false);
          } else if (evt.event === 'error') {
            _vaultChatMessages[aiIdx].content = 'Error: ' + (evt.data || 'unknown');
          } else if (evt.event === 'done') {
            window.electronAPI.removeVaultChatEventListener(handler);
            resolve();
          }
        };
        window.electronAPI.onVaultChatEvent(handler);
        if (_vaultChatAbort) {
          _vaultChatAbort.signal.addEventListener('abort', () => {
            window.electronAPI.removeVaultChatEventListener(handler);
            resolve();
          });
        }
      });
    }

    _vaultChatMessages[aiIdx].content = aiText;
    _renderVaultChatMessages(true);
    _saveVaultChatMessages();
  } catch (e) {
    if (e.name !== 'AbortError') {
      const last = _vaultChatMessages[_vaultChatMessages.length - 1];
      if (last && last.role === 'assistant') {
        last.content = 'Error: ' + e.message;
        last._thinking = false;
      }
      _renderVaultChatMessages(true);
      _saveVaultChatMessages();
    }
  } finally {
    islandRemove('ai-vault');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

// ── NTP Vault Panel (lightweight notes + chat for new-tab page) ──

async function renderNtpVaultPanel() {
  const container = document.getElementById('ntp-vault-container');
  if (!container) return;

  // Load notes if not already loaded
  if (!_vaultNotes.length) await loadVaultNotes();

  _loadVaultChatMessages();

  AetherUI.mount(RawHTML(`
    <div style="margin-bottom:10px;">
      <input type="text" id="ntp-vault-search" placeholder="Search notes…" autocomplete="off"
        class="w-full pl-3 pr-4 py-1.5 rounded-lg border border-border-input bg-card text-primary text-[0.8rem] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all" />
    </div>
    <div id="ntp-vault-notes" style="max-height:200px; overflow-y:auto; margin-bottom:12px;"></div>
    <div style="border-top:1px solid var(--border-color); padding-top:8px;">
      <div class="doc-chat-messages vault-chat-messages" id="ntp-vault-chat-msgs" style="max-height:200px; overflow-y:auto;"></div>
      <div style="display:flex; gap:4px; margin-top:6px;">
        <input class="nr-input" id="ntp-vault-chat-input" type="text" placeholder="Ask about your notes…"
          style="flex:1; background:var(--nr-bg-surface); color:var(--nr-text-primary); border:1px solid var(--border-color); border-radius:6px; padding:5px 8px; font-size:0.75rem; outline:none;" />
        <button id="ntp-vault-chat-send" style="background:var(--nr-accent); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.7rem; cursor:pointer;">Send</button>
        <button id="ntp-vault-chat-clear" style="background:transparent; color:var(--nr-text-quaternary); border:1px solid var(--border-color); border-radius:6px; padding:4px 8px; font-size:0.7rem; cursor:pointer;" title="Clear chat">Clear</button>
      </div>
    </div>
  `), container);

  // Render note list
  _renderNtpVaultNotes('');

  // Search filtering
  const searchInput = document.getElementById('ntp-vault-search');
  searchInput.addEventListener('input', () => _renderNtpVaultNotes(searchInput.value.trim()));

  // Chat handlers
  const chatInput = document.getElementById('ntp-vault-chat-input');
  const sendBtn = document.getElementById('ntp-vault-chat-send');
  const clearBtn = document.getElementById('ntp-vault-chat-clear');
  sendBtn.addEventListener('click', () => _sendNtpVaultChat());
  clearBtn.addEventListener('click', () => { clearVaultChat(); _renderNtpVaultChatMessages(true); });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendNtpVaultChat(); }
  });

  _renderNtpVaultChatMessages(true);
}

function _renderNtpVaultNotes(filter) {
  const container = document.getElementById('ntp-vault-notes');
  if (!container) return;
  const lc = filter.toLowerCase();
  const filtered = lc ? _vaultNotes.filter(n =>
    (n.title || '').toLowerCase().includes(lc) ||
    (n.content || '').toLowerCase().includes(lc)
  ) : _vaultNotes;

  if (!filtered.length) {
    AetherUI.mount(RawHTML(`<div style="padding:12px; text-align:center; color:var(--nr-text-quaternary); font-size:0.75rem;">${lc ? 'No matching notes' : 'No notes yet'}</div>`), container);
    return;
  }

  AetherUI.mount(RawHTML(filtered.slice(0, 30).map(n => {
    const preview = (n.content || '').replace(/[#*_`>\-\[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const snippet = preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
    return `<div class="ntp-vault-note-row" data-note-id="${escapeAttr(n.id)}">` +
      `<div style="font-size:0.8rem; color:var(--nr-text-primary); font-weight:500;">${escapeHtml(n.title || 'Untitled')}</div>` +
      (snippet ? `<div style="font-size:0.7rem; color:var(--nr-text-quaternary); margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(snippet)}</div>` : '') +
      `</div>`;
  }).join('')), container);

  container.querySelectorAll('.ntp-vault-note-row[data-note-id]').forEach(el => {
    el.addEventListener('click', () => {
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
    });
  });
}

function _renderNtpVaultChatMessages(final) {
  const container = document.getElementById('ntp-vault-chat-msgs');
  if (!container) return;
  if (!_vaultChatMessages.length) {
    AetherUI.mount(RawHTML('<div style="padding:12px; text-align:center; color:var(--nr-text-quaternary); font-size:0.75rem;">Ask a question about your notes</div>'), container);
    return;
  }
  AetherUI.mount(RawHTML(_vaultChatMessages.map((m, i) => {
    if (m.role === 'user') return `<div class="doc-msg-user">${escapeHtml(m.content)}</div>`;
    if (m._thinking) return '<div class="doc-msg-ai"><span class="doc-chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>';
    let sourcesHtml = '';
    if (m._sources && m._sources.length) {
      sourcesHtml = '<div class="vault-chat-sources">' + m._sources.map(s =>
        `<span class="vault-chat-source-chip" data-note-id="${escapeAttr(s.id)}" title="${escapeAttr(s.title)} (${Math.round(s.score * 100)}%)">${escapeHtml(s.title.length > 25 ? s.title.slice(0, 22) + '…' : s.title)}</span>`
      ).join('') + '</div>';
    }
    const isLast = i === _vaultChatMessages.length - 1;
    const content = (final || !isLast) && typeof marked !== 'undefined'
      ? marked.parse(m.content) : escapeHtml(m.content);
    return sourcesHtml + `<div class="doc-msg-ai">${content}</div>`;
  }).join('')), container);

  container.querySelectorAll('.vault-chat-source-chip[data-note-id]').forEach(el => {
    el.addEventListener('click', () => {
      const noteId = el.getAttribute('data-note-id');
      window.location.hash = 'vault';
      setTimeout(() => { if (typeof openVaultNote === 'function') openVaultNote(noteId); }, 100);
    });
  });
  container.scrollTop = container.scrollHeight;
}

async function _sendNtpVaultChat() {
  const input = document.getElementById('ntp-vault-chat-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  _vaultChatMessages.push({ role: 'user', content: q });
  _vaultChatMessages.push({ role: 'assistant', content: '', _thinking: true });
  _renderNtpVaultChatMessages(false);

  input.disabled = true;
  const sendBtn = document.getElementById('ntp-vault-chat-send');
  if (sendBtn) sendBtn.disabled = true;

  _vaultChatAbort = new AbortController();
  const _vcModel2 = localStorage.getItem('chatModel') || 'default';
  islandUpdate('ai-vault', { type: 'ai', label: _vcModel2, detail: 'Vault chat \u00B7 ' + _vcModel2 });

  try {
    const filteredMsgs = _vaultChatMessages.filter(m => !m._thinking).map(m => ({
      role: m.role, content: m.content
    }));
    const result = await apiPost('/api/vault-chat', { messages: filteredMsgs, query: q });

    let aiText = '';
    const aiIdx = _vaultChatMessages.length - 1;
    _vaultChatMessages[aiIdx]._thinking = false;

    if (result && result._stream) {
      await new Promise((resolve) => {
        const handler = (_ev, sid, evt) => {
          if (sid !== result.sessionId) return;
          if (evt.event === 'sources') {
            try { _vaultChatMessages[aiIdx]._sources = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data; } catch (e) {}
          } else if (evt.event === 'token') {
            aiText += (evt.data || '');
            _vaultChatMessages[aiIdx].content = aiText;
            _renderNtpVaultChatMessages(false);
          } else if (evt.event === 'error') {
            _vaultChatMessages[aiIdx].content = 'Error: ' + (evt.data || 'unknown');
          } else if (evt.event === 'done') {
            window.electronAPI.removeVaultChatEventListener(handler);
            resolve();
          }
        };
        window.electronAPI.onVaultChatEvent(handler);
        if (_vaultChatAbort) {
          _vaultChatAbort.signal.addEventListener('abort', () => {
            window.electronAPI.removeVaultChatEventListener(handler);
            resolve();
          });
        }
      });
    }

    _vaultChatMessages[aiIdx].content = aiText;
    _renderNtpVaultChatMessages(true);
    _saveVaultChatMessages();
  } catch (e) {
    if (e.name !== 'AbortError') {
      const last = _vaultChatMessages[_vaultChatMessages.length - 1];
      if (last && last.role === 'assistant') { last.content = 'Error: ' + e.message; last._thinking = false; }
      _renderNtpVaultChatMessages(true);
      _saveVaultChatMessages();
    }
  } finally {
    islandRemove('ai-vault');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

// ── Git status badges for file tree ──

function _vaultGitBadge(status) {
  if (!status) return '';
  const colors = { M: 'color:#e5a50a', A: 'color:#22c55e', D: 'color:#ef4444', '?': 'color:#22c55e', R: 'color:#3b82f6', U: 'color:#ef4444' };
  const c = colors[status] || 'color:var(--nr-text-quaternary)';
  return `<span class="vault-git-badge" style="${c}">${escapeHtml(status)}</span>`;
}

async function _ensureVaultPath() {
  if (_vaultPath) return _vaultPath;
  try {
    const data = await apiGet('/api/vault/path');
    _vaultPath = data.path || null;
  } catch (e) { console.warn('ensureVaultPath:', e); }
  return _vaultPath;
}

async function _vaultFetchGitStatus() {
  try {
    const data = await _vibeGit('status');
    if (data.error) return;
    const lines = (data.output || '').split('\n').filter(Boolean);
    const map = {};
    for (const line of lines) {
      if (line.startsWith('## ')) continue;
      const code = line.substring(0, 2).trim();
      const path = line.substring(3).trim();
      if (code && path) map[path] = code[0] === '?' ? '?' : code.replace(/\s/g, '');
    }
    _vaultGitStatus = map;
    renderVaultFileTree(document.getElementById('vault-search-input')?.value || '');
  } catch (e) { console.warn('vaultFetchGitStatus:', e); }
}

// Terminal in right panel
function renderVaultTerminalPanel(container) {
  if (typeof createTerminal !== 'function') {
    AetherUI.mount(RawHTML('<div class="p-4 text-dimmer text-sm">Terminal not available</div>'), container);
    return;
  }
  container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';
  // Reuse single terminal instance
  if (!_vaultTerminal) {
    _vaultTerminal = createTerminal('Vault', true);
  }
  const pane = _vaultTerminal.container;
  pane.style.cssText = 'width:100%;flex:1;min-height:0;position:relative;';
  AetherUI.mount(pane, container);

  if (!pane.querySelector('.xterm')) {
    _vaultTerminal.term.open(pane);
    _vaultTerminal.fitAddon.fit();
    _ensureVaultPath().then(vp => _connectTerminalWs(_vaultTerminal, vp));
  } else {
    setTimeout(() => { try { _vaultTerminal.fitAddon.fit(); } catch (e) { /* fire-and-forget */ } }, 50);
  }

  const ro = new ResizeObserver(() => {
    try { _vaultTerminal.fitAddon.fit(); } catch (e) { /* fire-and-forget */ }
  });
  ro.observe(pane);
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
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: '<svg class="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>',
      render: renderVaultChatPanel
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: '<svg class="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3"/></svg>',
      render: renderVaultTerminalPanel
    }
  ]
});
