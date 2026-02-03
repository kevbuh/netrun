// ── Vault (Obsidian-style notes) ──

let _vaultNotes = [];
let _vaultCurrentNote = null;
let _vaultPreviewMode = true; // Preview on by default
let _vaultGraphMode = false;
let _vaultSaveTimeout = null;

// Open vault view
function openVault() {
  setSidebarLoading('sb-vault');
  hideAllViews();
  const view = document.getElementById('vault-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'vault';
  setSidebarActive('sb-vault');
  initVault();
}

// Initialize vault
async function initVault() {
  await loadVaultNotes();

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

// Render file tree
function renderVaultFileTree(filter = '') {
  const container = document.getElementById('vault-file-tree');
  if (!container) return;

  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? _vaultNotes.filter(n => n.title.toLowerCase().includes(filterLower) || n.content?.toLowerCase().includes(filterLower))
    : _vaultNotes;

  // Group by folder
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

  let html = '';

  // Render folders
  Object.keys(folders).sort().forEach(folder => {
    const notes = folders[folder].sort((a, b) => a.title.localeCompare(b.title));
    html += `
      <div class="vault-folder" data-folder="${escapeAttr(folder)}">
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

  container.innerHTML = html || '<div class="text-dimmer text-[0.75rem] px-3 py-2">No notes yet</div>';
}

function renderVaultFileItem(note) {
  const isActive = _vaultCurrentNote?.id === note.id;
  return `
    <div class="vault-file-item ${isActive ? 'active' : ''}" data-note-id="${note.id}" onclick="openVaultNote('${note.id}')" oncontextmenu="showVaultNoteMenu(event, '${note.id}')">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
      <span class="truncate">${escapeHtml(note.title || 'Untitled')}</span>
    </div>
  `;
}

function toggleVaultFolder(el) {
  el.classList.toggle('collapsed');
}

// Context menu for folders
function showVaultFolderMenu(e, folderName) {
  e.preventDefault();
  e.stopPropagation();
  hideVaultContextMenu();

  const menu = document.createElement('div');
  menu.className = 'vault-context-menu';
  menu.innerHTML = `
    <div class="vault-menu-item" onclick="vaultNewNoteInFolder('${escapeAttr(folderName)}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
      New note in folder
    </div>
    <div class="vault-menu-item" onclick="vaultRenameFolder('${escapeAttr(folderName)}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"/></svg>
      Rename folder
    </div>
    <div class="vault-menu-sep"></div>
    <div class="vault-menu-item vault-menu-danger" onclick="vaultDeleteFolder('${escapeAttr(folderName)}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
      Delete folder
    </div>
  `;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);

  // Adjust if off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  setTimeout(() => document.addEventListener('click', hideVaultContextMenu, { once: true }), 10);
}

// Context menu for notes
function showVaultNoteMenu(e, noteId) {
  e.preventDefault();
  e.stopPropagation();
  hideVaultContextMenu();

  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  const menu = document.createElement('div');
  menu.className = 'vault-context-menu';
  menu.innerHTML = `
    <div class="vault-menu-item" onclick="openVaultNote('${noteId}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
      Open
    </div>
    <div class="vault-menu-item" onclick="vaultMoveNote('${noteId}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.06-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>
      Move to folder...
    </div>
    <div class="vault-menu-sep"></div>
    <div class="vault-menu-item vault-menu-danger" onclick="vaultDeleteNote('${noteId}')">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
      Delete note
    </div>
  `;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  setTimeout(() => document.addEventListener('click', hideVaultContextMenu, { once: true }), 10);
}

function hideVaultContextMenu() {
  document.querySelectorAll('.vault-context-menu').forEach(m => m.remove());
}

// Create note in specific folder
function vaultNewNoteInFolder(folderName) {
  hideVaultContextMenu();
  vaultNewNote(folderName);
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
  // Save current note first
  if (_vaultCurrentNote) {
    await saveCurrentNote();
  }

  const note = _vaultNotes.find(n => n.id === noteId);
  if (!note) return;

  _vaultCurrentNote = note;
  localStorage.setItem('vaultLastNote', noteId);

  // Update UI
  document.getElementById('vault-note-title').value = note.title || '';
  document.getElementById('vault-editor').value = note.content || '';

  // Update file tree selection
  document.querySelectorAll('.vault-file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.noteId === noteId);
  });

  // If note is empty or newly created, switch to edit mode to show placeholder
  const isEmpty = !note.content || !note.content.trim();
  const isNew = note._isNew;
  if (isNew) delete note._isNew; // Clear the flag after use
  if ((isEmpty || isNew) && _vaultPreviewMode) {
    _vaultPreviewMode = false;
    const btn = document.getElementById('vault-preview-btn');
    const editorContainer = document.getElementById('vault-editor-container');
    const previewContainer = document.getElementById('vault-preview-container');
    if (btn) btn.classList.remove('active');
    if (editorContainer) editorContainer.style.display = '';
    if (previewContainer) previewContainer.style.display = 'none';
    document.getElementById('vault-editor')?.focus();
  }

  updateVaultPreview();
  updateVaultBacklinks();
  updateVaultTags();
  updateVaultPublishButton();

  // Reset graph view if active
  if (_vaultGraphMode) {
    _vaultGraphMode = false;
    document.getElementById('vault-graph-btn').classList.remove('active');
    document.getElementById('vault-graph-container').style.display = 'none';
    document.getElementById('vault-editor-container').style.display = '';
    document.getElementById('vault-preview-container').style.display = _vaultPreviewMode ? '' : 'none';
  }
}

// Clear editor (no note selected)
function clearVaultEditor() {
  _vaultCurrentNote = null;
  document.getElementById('vault-note-title').value = '';
  document.getElementById('vault-editor').value = '';
  document.getElementById('vault-backlinks-list').innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No backlinks</div>';
  document.getElementById('vault-tags-list').innerHTML = '<div class="text-dimmer text-[0.75rem] px-3">No tags</div>';
  const pubSection = document.getElementById('vault-published-section');
  if (pubSection) pubSection.style.display = 'none';
}

// Save current note
async function saveCurrentNote() {
  if (!_vaultCurrentNote) return;

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

// Delete current note from toolbar
function vaultDeleteCurrentNote() {
  if (!_vaultCurrentNote) return;
  vaultDeleteNote(_vaultCurrentNote.id);
}

// Create new folder (prompts for name and creates a note inside)
async function vaultNewFolder() {
  const name = prompt('New folder name:');
  if (!name || !name.trim()) return;

  const folderName = name.trim();

  // Create a new note in the folder
  try {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { ..._authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', content: '', folder: folderName })
    });

    if (res.ok) {
      const note = await res.json();
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
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

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
    }
  } catch (e) {
    console.error('Failed to toggle publish', e);
  }
}

// Update publish button state and sidebar section
function updateVaultPublishButton() {
  const btn = document.getElementById('vault-publish-btn');
  if (btn) {
    const isPublished = _vaultCurrentNote?.published;
    btn.classList.toggle('active', isPublished);
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
        <button onclick="window.open('${escapeAttr(url)}', '_blank')">View Post</button>
        <button onclick="this.closest('.vault-publish-modal').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// Open blog view (public)
async function openBlogPost(username, slug) {
  hideAllViews();
  const view = document.getElementById('blog-view');
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

  // Parse current blog URL to get author and slug
  const hash = window.location.hash.slice(1); // "blog/username/slug"
  const parts = hash.split('/');
  const author = parts[1];
  const slug = parts[2];

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
      const note = await res.json();
      // Show success feedback
      const btn = event.target.closest('button');
      const originalTitle = btn.title;
      btn.title = 'Forked!';
      btn.classList.add('active');
      setTimeout(() => {
        btn.title = originalTitle;
        btn.classList.remove('active');
      }, 2000);
    }
  } catch (e) {
    console.error('Failed to fork to vault', e);
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
    const res = await fetch(`/api/comments?paperLink=${encodeURIComponent(blogLink)}`);
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
